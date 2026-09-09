import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ChatStreamEvent } from '../../../api/canvas/stream.js';
import { isSecretFileRel, isSecretWorkspaceFile, mimeOf, skillFileDownloadUrl } from '../../platform/file-utils.js';
import { REAL_AGENTS_ROOT, REAL_SKILLS_ROOT } from '../skill-agent-service.js';

/**
 * 工作区快照差分（产物探测）与产物清单（manifest）。
 *
 * - snapshotWorkspace / walkWorkspace：递归盘点工作区文件（size + mtimeMs）；
 *   排除目录不递归（.agents/ .pi/ .pi-agent/ inputs/ 属装配物/会话，不产出且通常体积大）；
 * - readWorkspaceBaseline / writeWorkspaceBaseline：轮末快照落盘为下一轮基线，
 *   把「每轮双次全量 walk」降为「每轮单次 walk」（仅首轮/基线缺失时回退遍历）；
 * - isDiffExcluded：装配物/会话配置排除（.agents/ .pi/ .pi-agent/ inputs/ AGENTS.md）；
 * - diffWorkspace：前后快照差分 → agent_file 事件 + manifest 记录（runner.ts 调用）；
 * - appendArtifactManifest：本轮差分产物追加进 append-only JSONL 清单；
 * - readArtifactManifest：读取清单（水合产物绑定 / 产物列表共用）；
 * - listWorkspaceArtifacts：当前快照与 manifest 历史合并（已删文件保留 exists=false）；
 *   includeAgentResources 时穿透列出 .pi-agent 装配资源（skills/prompts，@ 引用检索用）；
 *   includeAgentRuntime 时补列「全部文件」完整清单（.pi-agent 运行态配置与任意深度 .env*，
 *   敏感文件标 previewable=false：名字可见但预览/下载拒）。
 */

// ---------------------------------------------------------------------------
// 快照差分（产物探测）
// ---------------------------------------------------------------------------

export interface FileStamp {
  size: number;
  mtimeMs: number;
}

/** 差分排除前缀/文件：装配物与会话配置不算「agent 产物」。
 *  conversation.jsonl：LLM / FastClaw 模式的会话 transcript（后端写入，见 chat-conversations.ts），
 *  非 agent 产物，不得出现在「AI 产物」列表。
 *  密钥文件（.env*，任意深度）经 isSecretFileRel 一并排除（与 skill-files 下载守卫同口径）。 */
const DIFF_EXCLUDED_PREFIXES = ['.agents/', '.pi/', '.pi-agent/', 'inputs/'];
const DIFF_EXCLUDED_FILES = new Set(['AGENTS.md', 'conversation.jsonl']);

export function isDiffExcluded(rel: string): boolean {
  if (DIFF_EXCLUDED_FILES.has(rel)) return true;
  if (DIFF_EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) return true;
  return isSecretFileRel(rel);
}

function walkWorkspace(root: string, out: Map<string, FileStamp>, dir = root, prefix = ''): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    let lst;
    try {
      lst = lstatSync(full);
    } catch {
      continue;
    }
    if (lst.isSymbolicLink()) {
      // 软链不递归（防目录软链穿透到工作区外/成环/膨胀）；指向文件的软链按目标 stat 列出
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isFile()) out.set(rel, { size: st.size, mtimeMs: st.mtimeMs });
      continue;
    }
    if (lst.isDirectory()) {
      // 排除目录不递归：.pi-agent（会话 jsonl / artifacts / 基线 / skills 软链目标）与
      // inputs/ 等不产出且体积大，跳过遍历；与 diff/列表侧 isDiffExcluded 口径一致
      if (isDiffExcluded(`${rel}/`)) continue;
      walkWorkspace(root, out, full, rel);
    } else if (lst.isFile()) out.set(rel, { size: lst.size, mtimeMs: lst.mtimeMs });
  }
}

/** 递归盘点工作区文件的 size + mtimeMs（供差分探测与产物清单共用）。 */
export function snapshotWorkspace(ws: string): Map<string, FileStamp> {
  const map = new Map<string, FileStamp>();
  walkWorkspace(ws, map);
  return map;
}

/**
 * 产物差分（纯函数，runner.ts 调用）：前后快照对比，产出 agent_file 事件与
 * manifest 记录（新增/修改文件；未变化文件跳过）。manifest 落盘在此完成。
 */
export function diffWorkspace(
  before: Map<string, FileStamp>,
  after: Map<string, FileStamp>,
  ws: string,
  workspaceId: string
): { artifacts: ArtifactRecord[]; events: ChatStreamEvent[] } {
  const artifacts: ArtifactRecord[] = [];
  const events: ChatStreamEvent[] = [];
  for (const [rel, stamp] of after) {
    if (isDiffExcluded(rel)) continue;
    const prev = before.get(rel);
    if (prev && prev.size === stamp.size && prev.mtimeMs === stamp.mtimeMs) continue;
    artifacts.push({ rel, mime: mimeOf(rel), size: stamp.size, mtimeMs: stamp.mtimeMs });
    events.push({
      type: 'agent_file',
      file: {
        url: skillFileDownloadUrl(rel, workspaceId),
        name: path.basename(rel),
        mime: mimeOf(rel),
        size: stamp.size,
        path: rel,
      },
    });
  }
  appendArtifactManifest(ws, artifacts);
  return { artifacts, events };
}

// ---------------------------------------------------------------------------
// 快照基线（单次遍历：轮末快照 → 下一轮 before）
// ---------------------------------------------------------------------------

/** 工作区快照基线落点（相对工作区根）。放 .pi-agent/ 下复用差分排除前缀，不自报自录。 */
export const PI_BASELINE_REL = path.join('.pi-agent', 'snapshot.json');

/**
 * 读取上一轮结束时落盘的快照基线。缺失/损坏返回 null，调用方回退为整树遍历
 * （语义与旧「轮首遍历」一致，行为不退化）。
 */
export function readWorkspaceBaseline(ws: string): Map<string, FileStamp> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path.join(ws, PI_BASELINE_REL), 'utf-8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = new Map<string, FileStamp>();
  for (const [rel, stamp] of Object.entries(raw as Record<string, unknown>)) {
    const s = stamp as { size?: unknown; mtimeMs?: unknown } | null;
    if (!s || typeof s !== 'object' || typeof s.size !== 'number' || typeof s.mtimeMs !== 'number') {
      continue;
    }
    out.set(rel, { size: s.size, mtimeMs: s.mtimeMs });
  }
  return out;
}

/** 把轮末快照落盘为下一轮基线（best-effort：失败下一轮回退遍历，行为不退化）。 */
export function writeWorkspaceBaseline(ws: string, stamps: Map<string, FileStamp>): void {
  try {
    const file = path.join(ws, PI_BASELINE_REL);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(Object.fromEntries(stamps)), 'utf-8');
  } catch {
    /* 磁盘异常等：基线是可再生的辅助索引，静默跳过 */
  }
}

// ---------------------------------------------------------------------------
// 产物清单（manifest）与AI 产物列表
// ---------------------------------------------------------------------------

/**
 * AI 产物清单落点（相对工作区根）。放 .pi-agent/ 下可复用差分排除前缀，
 * 清单不会自报自录；append-only JSONL，读取端按 rel 去重取最新。
 */
export const PI_ARTIFACTS_REL = path.join('.pi-agent', 'artifacts.jsonl');

export interface ArtifactRecord {
  rel: string;
  mime: string;
  size: number;
  mtimeMs: number;
}

/** manifest 行条目：ts = 轮末差分时刻（水合产物绑定的轮次锚点；历史行可能缺省）。 */
export interface ArtifactManifestEntry extends ArtifactRecord {
  ts?: number;
}

/** 把本轮差分出的产物追加进 manifest（best-effort：失败不影响对话流）。 */
export function appendArtifactManifest(ws: string, records: ArtifactRecord[]): void {
  if (!records.length) return;
  const file = path.join(ws, PI_ARTIFACTS_REL);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const lines = records
      .map((r) => JSON.stringify({ ...r, ts: Date.now() }))
      .join('\n');
    writeFileSync(file, `${lines}\n`, { flag: 'a', encoding: 'utf-8' });
  } catch {
    /* 磁盘异常等：清单是可再生的辅助索引，静默跳过 */
  }
}

/** 读取产物清单（append-only JSONL，按行容错解析；供水合产物绑定与产物列表共用）。 */
export function readArtifactManifest(ws: string): ArtifactManifestEntry[] {
  const out: ArtifactManifestEntry[] = [];
  let raw: string;
  try {
    raw = readFileSync(path.join(ws, PI_ARTIFACTS_REL), 'utf-8');
  } catch {
    return out;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let rec: { rel?: unknown; mime?: unknown; size?: unknown; mtimeMs?: unknown; ts?: unknown };
    try {
      rec = JSON.parse(trimmed) as typeof rec;
    } catch {
      continue;
    }
    if (typeof rec.rel !== 'string' || !rec.rel) continue;
    out.push({
      rel: rec.rel,
      mime: typeof rec.mime === 'string' ? rec.mime : mimeOf(rec.rel),
      size: typeof rec.size === 'number' ? rec.size : 0,
      mtimeMs: typeof rec.mtimeMs === 'number' ? rec.mtimeMs : 0,
      ...(typeof rec.ts === 'number' ? { ts: rec.ts } : {}),
    });
  }
  return out;
}

export interface WorkspaceArtifact extends Omit<ArtifactRecord, 'rel'> {
  /** 工作区相对路径（正斜杠口径，与 agent_file 事件的 path 字段一致） */
  path: string;
  name: string;
  url: string;
  exists: boolean;
  /** false = 密钥/装配敏感文件（「全部文件」列表仅展示名字与目录结构，预览/下载被 skill-files 拒绝） */
  previewable?: boolean;
  /** true = 目录软链占位（「全部文件」完整清单：仅展示目录节点，不穿透目标） */
  isDir?: boolean;
  /** true = 条目本身是符号链接（指向工作区外的文件软链仅展示名字） */
  link?: boolean;
}

// ---------------------------------------------------------------------------
// .pi-agent 装配资源（@ 引用穿透检索）
// ---------------------------------------------------------------------------

/** 装配资源白名单子目录：.pi-agent 下仅这两棵树可被 @ 引用检索（含子目录穿透）。 */
const AGENT_RESOURCE_DIRS = ['skills', 'prompts'] as const;

/**
 * 递归盘点 .pi-agent 装配资源（skills/ prompts/，含子目录穿透）。
 * 只遍历白名单子树：会话/配置/扩展（chat.jsonl、run/、sessions/、extensions/、
 * models.json 等）天然不进入列表。visited 按 realpath 防软链成环——装配的 skills
 * 可能是指向共享区的目录软链，穿透遍历时目标内容一并盘点。
 */
function walkAgentResources(root: string, out: Map<string, FileStamp>): void {
  const visited = new Set<string>();
  const walk = (dir: string, prefix: string): void => {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      const rel = `${prefix}/${entry}`;
      let st;
      try {
        st = statSync(full); // 跟随软链（目录软链按目标内容盘点，与 walkWorkspace 一致）
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        let real: string;
        try {
          real = realpathSync(full);
        } catch {
          real = full;
        }
        if (visited.has(real)) continue; // 软链成环防护
        visited.add(real);
        walk(full, rel);
      } else if (st.isFile()) {
        if (isSecretFileRel(rel)) continue;
        out.set(rel, { size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  };
  for (const sub of AGENT_RESOURCE_DIRS) {
    const dir = path.join(root, '.pi-agent', sub);
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      continue; // 目录不存在：无装配资源
    }
    if (visited.has(real)) continue;
    visited.add(real);
    walk(dir, `.pi-agent/${sub}`);
  }
}

/** .pi-agent/ 顶层不逐目录遍历的子树：装配资源（skills/prompts 由 walkAgentResources 覆盖）与运行态/软链包子树。 */
const PI_AGENT_SKIP_DIRS = new Set(['skills', 'prompts', 'run', 'sessions', 'extensions']);

/**
 * 递归盘点 .pi-agent/ 的运行态配置与装配文件（「全部文件」完整清单用）：
 * - 不跟随软链目录（skills 指向共享区等，防穿透/成环/膨胀）；指向文件的软链按目标 stat 列出；
 * - skills/ prompts/ 跳过（装配资源内容由 walkAgentResources 覆盖）；
 * - run/ sessions/ extensions/ 跳过（会话 jsonl 走会话水合；extensions 为软链扩展包子树）。
 */
function walkPiAgentFiles(root: string, out: Map<string, FileStamp>): void {
  const walk = (dir: string, prefix: string, topLevel: boolean): void => {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      let lst;
      try {
        lst = lstatSync(full);
      } catch {
        continue;
      }
      if (lst.isSymbolicLink()) {
        // 目录软链不递归（防穿透）；指向文件的软链按目标 stat 列出
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isFile()) out.set(rel, { size: st.size, mtimeMs: st.mtimeMs });
        continue;
      }
      if (lst.isDirectory()) {
        if (topLevel && PI_AGENT_SKIP_DIRS.has(entry)) continue;
        walk(full, rel, false);
      } else if (lst.isFile()) {
        out.set(rel, { size: lst.size, mtimeMs: lst.mtimeMs });
      }
    }
  };
  walk(root, '.pi-agent', true);
}

// ---------------------------------------------------------------------------
// 「全部文件」完整清单 walk（软链接识别）
// ---------------------------------------------------------------------------

/** 「全部文件」完整 walk 的排除前缀：装配/运行态目录（.pi-agent 由 walkPiAgentFiles + walkAgentResources 覆盖）。 */
const EVERYTHING_PRUNE_PREFIXES = ['.agents/', '.pi/', '.pi-agent/', 'inputs/'];

/** 目录 rel（无尾斜杠）是否命中排除前缀。 */
function isEverythingPrune(rel: string): boolean {
  return EVERYTHING_PRUNE_PREFIXES.some((p) => rel === p.slice(0, -1) || rel.startsWith(p));
}

/**
 * 真实路径是否落在工作区内或装配共享根内（REAL_SKILLS_ROOT / REAL_AGENTS_ROOT）：
 * 决定文件软链是否可预览——指向共享提示词（AGENTS.md）等允许根内链接可预览，
 * 指向工作区外任意路径的软链仅展示名字（previewable=false），下载层 resolveSkillAbs 亦会拒绝。
 */
function isRealpathWithinWorkspaceRoots(ws: string, full: string): boolean {
  let rp: string;
  try {
    rp = realpathSync(full);
  } catch {
    return false;
  }
  const bases: string[] = [ws];
  for (const root of [REAL_SKILLS_ROOT, REAL_AGENTS_ROOT]) {
    try {
      bases.push(realpathSync(root));
    } catch {
      /* 共享根不存在 */
    }
  }
  return bases.some((b) => rp === b || rp.startsWith(b + path.sep));
}

export interface EverythingEntry extends FileStamp {
  /** 目录软链占位：仅展示目录节点，不穿透目标（防越界/成环/膨胀） */
  isDir?: boolean;
  /** 条目本身是符号链接 */
  isLink?: boolean;
  /** false = 仅展示名字，不可预览/下载 */
  previewable?: boolean;
}

/**
 * 递归盘点工作区根与各子目录的完整文件（含符号链接），供「全部文件」清单：
 * - 基于 lstat（不跟随）：文件软链 / 悬空软链 / 目录软链都能被识别并展示；
 * - 文件软链 / 悬空软链：按名字展示（previewable 取决于 realpath 是否落在允许根内）；
 * - 目录软链：仅展示目录占位（isDir），不递归目标；
 * - 排除装配/运行态/上传目录（.agents/ .pi/ .pi-agent/ inputs/，后两者由专门 walk 覆盖）；
 * - 保留 .env*、AGENTS.md、conversation.jsonl 等常规视图隐藏的文件（全部文件要看到名字）。
 */
function walkEverything(
  ws: string,
  out: Map<string, EverythingEntry>,
  dir = ws,
  prefix = ''
): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    let lst;
    try {
      lst = lstatSync(full);
    } catch {
      continue;
    }
    if (lst.isSymbolicLink()) {
      let st;
      try {
        st = statSync(full);
      } catch {
        st = null;
      }
      if (!st) {
        // 悬空软链：名字可见、不可预览
        out.set(rel, { size: 0, mtimeMs: lst.mtimeMs, isLink: true, previewable: false });
        continue;
      }
      if (st.isDirectory()) {
        // 目录软链：占位节点，不穿透目标
        out.set(rel, { size: 0, mtimeMs: lst.mtimeMs, isDir: true, isLink: true, previewable: false });
        continue;
      }
      out.set(rel, {
        size: st.size,
        mtimeMs: st.mtimeMs,
        isLink: true,
        ...(isSecretWorkspaceFile(rel) || !isRealpathWithinWorkspaceRoots(ws, full)
          ? { previewable: false }
          : {}),
      });
      continue;
    }
    if (lst.isDirectory()) {
      if (isEverythingPrune(rel)) continue;
      walkEverything(ws, out, full, rel);
    } else if (lst.isFile()) {
      out.set(rel, {
        size: lst.size,
        mtimeMs: lst.mtimeMs,
        ...(isSecretWorkspaceFile(rel) ? { previewable: false } : {}),
      });
    }
  }
}

/**
 * 列出工作区当前产物（差分同口径排除装配物/会话），并与 manifest 历史条目合并
 * （文件已被删除的历史产物保留并标 exists=false，维持可追溯）。
 * opts.includeInputs 为 true 时把 inputs/ 目录下的用户上传文件一并列出（@ 引用检索与
 * 工作区文件面板共用同一数据源；inputs 默认不出现在产物列表——上传文件不是 agent 产物）。
 * opts.includeAgentResources 为 true 时额外穿透列出 .pi-agent 装配资源（skills/prompts，
 * 含子目录；会话/配置/扩展仍排除）供 @ 引用检索。产物差分不受影响——snapshotWorkspace
 * 对 .pi-agent 整体剪枝，此处为列表侧独立补列，不写 manifest。
 * opts.includeAgentRuntime 为 true 时补列「全部文件」完整清单：.pi-agent 运行态配置（不穿软链
 * 目录、剪 run/sessions/extensions）与任意深度 .env*、AGENTS.md 等常规视图排除的文件；
 * 所有敏感文件（.pi-agent 密钥 json / .env*）标 previewable=false——名字与目录结构可见，
 * 预览/下载由 skill-files 的 isWorkspaceFileServable 拒绝。
 */
export function listWorkspaceArtifacts(
  ws: string,
  workspaceId: string,
  opts?: {
    includeInputs?: boolean;
    includeAgentResources?: boolean;
    includeAgentRuntime?: boolean;
  }
): WorkspaceArtifact[] {
  const byRel = new Map<string, WorkspaceArtifact>();
  const put = (
    rel: string,
    stamp: FileStamp,
    extra?: { previewable?: boolean; isDir?: boolean; isLink?: boolean }
  ): void => {
    byRel.set(rel, {
      path: rel,
      mime: extra?.isDir ? '' : mimeOf(rel),
      size: stamp.size,
      mtimeMs: stamp.mtimeMs,
      name: path.basename(rel),
      url: extra?.isDir ? '' : skillFileDownloadUrl(rel, workspaceId),
      exists: true,
      ...(extra?.previewable !== undefined ? { previewable: extra.previewable } : {}),
      ...(extra?.isDir ? { isDir: true } : {}),
      ...(extra?.isLink ? { link: true } : {}),
    });
  };

  // 常规产物（差分同口径：排除装配物/会话/密钥文件）
  for (const [rel, stamp] of snapshotWorkspace(ws)) {
    if (isDiffExcluded(rel)) continue;
    put(rel, stamp);
  }
  // 装配资源子树（skills/prompts，含子目录穿透）
  if (opts?.includeAgentResources || opts?.includeAgentRuntime) {
    const resources = new Map<string, FileStamp>();
    walkAgentResources(ws, resources);
    for (const [rel, stamp] of resources) put(rel, stamp);
  }
  if (opts?.includeInputs) {
    const inputsDir = path.join(ws, 'inputs');
    let entries: string[] = [];
    try {
      entries = readdirSync(inputsDir).sort();
    } catch {
      /* inputs/ 尚未创建：无上传文件 */
    }
    for (const entry of entries) {
      const full = path.join(inputsDir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      const rel = `inputs/${entry}`;
      const secret = isSecretFileRel(rel);
      if (secret && !opts?.includeAgentRuntime) continue; // 常规视图隐藏密钥；完整清单保留名字
      put(rel, st, secret ? { previewable: false } : undefined);
    }
  }
  // 「全部文件」完整清单：.pi-agent 运行态配置 + 根与子目录完整文件（含符号链接识别）
  if (opts?.includeAgentRuntime) {
    const piFiles = new Map<string, FileStamp>();
    walkPiAgentFiles(path.join(ws, '.pi-agent'), piFiles);
    for (const [rel, stamp] of piFiles) {
      put(rel, stamp, isSecretWorkspaceFile(rel) ? { previewable: false } : undefined);
    }
    const everything = new Map<string, EverythingEntry>();
    walkEverything(ws, everything);
    for (const [rel, e] of everything) {
      // 覆盖而非跳过：完整清单的软链识别标记（link/isDir/previewable）优先于默认视图的普通条目
      put(rel, e, {
        ...(e.isDir ? { isDir: true, previewable: false } : {}),
        ...(e.isLink ? { isLink: true } : {}),
        ...(e.previewable === false ? { previewable: false } : {}),
      });
    }
  }
  for (const rec of readArtifactManifest(ws)) {
    if (!rec.rel || isSecretFileRel(rec.rel) || byRel.has(rec.rel)) continue;
    byRel.set(rec.rel, {
      path: rec.rel,
      mime: rec.mime,
      size: rec.size,
      mtimeMs: rec.mtimeMs,
      name: path.basename(rec.rel),
      url: skillFileDownloadUrl(rec.rel, workspaceId),
      exists: false,
    });
  }
  return [...byRel.values()].sort((a, b) => a.path.localeCompare(b.path));
}