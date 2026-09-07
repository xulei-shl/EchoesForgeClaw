import { mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ChatStreamEvent } from '../../modules/bookplate/stream.js';
import { mimeOf, skillFileDownloadUrl } from '../file-utils.js';

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
 *   includeAgentResources 时穿透列出 .pi-agent 装配资源（skills/prompts，@ 引用检索用）。
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
 *  非 agent 产物，不得出现在「AI 产物」列表。 */
const DIFF_EXCLUDED_PREFIXES = ['.agents/', '.pi/', '.pi-agent/', 'inputs/'];
const DIFF_EXCLUDED_FILES = new Set(['AGENTS.md', 'conversation.jsonl']);

export function isDiffExcluded(rel: string): boolean {
  if (DIFF_EXCLUDED_FILES.has(rel)) return true;
  return DIFF_EXCLUDED_PREFIXES.some((p) => rel.startsWith(p));
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
    let st;
    try {
      st = statSync(full); // statSync 跟随软链（目录软链按目标目录统计）
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // 排除目录不递归：.pi-agent（会话 jsonl / artifacts / 基线 / skills 软链目标）与
      // inputs/ 等不产出且体积大，跳过遍历；与 diff/列表侧 isDiffExcluded 口径一致
      if (isDiffExcluded(`${rel}/`)) continue;
      walkWorkspace(root, out, full, rel);
    } else if (st.isFile()) out.set(rel, { size: st.size, mtimeMs: st.mtimeMs });
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

/**
 * 列出工作区当前产物（差分同口径排除装配物/会话），并与 manifest 历史条目合并
 * （文件已被删除的历史产物保留并标 exists=false，维持可追溯）。
 * opts.includeInputs 为 true 时把 inputs/ 目录下的用户上传文件一并列出（@ 引用检索与
 * 工作区文件面板共用同一数据源；inputs 默认不出现在产物列表——上传文件不是 agent 产物）。
 * opts.includeAgentResources 为 true 时额外穿透列出 .pi-agent 装配资源（skills/prompts，
 * 含子目录；会话/配置/扩展仍排除）供 @ 引用检索。产物差分不受影响——snapshotWorkspace
 * 对 .pi-agent 整体剪枝，此处为列表侧独立补列，不写 manifest。
 */
export function listWorkspaceArtifacts(
  ws: string,
  workspaceId: string,
  opts?: { includeInputs?: boolean; includeAgentResources?: boolean }
): WorkspaceArtifact[] {
  const byRel = new Map<string, WorkspaceArtifact>();
  for (const [rel, stamp] of snapshotWorkspace(ws)) {
    if (isDiffExcluded(rel)) continue;
    byRel.set(rel, {
      path: rel,
      mime: mimeOf(rel),
      size: stamp.size,
      mtimeMs: stamp.mtimeMs,
      name: path.basename(rel),
      url: skillFileDownloadUrl(rel, workspaceId),
      exists: true,
    });
  }
  if (opts?.includeAgentResources) {
    const resources = new Map<string, FileStamp>();
    walkAgentResources(ws, resources);
    for (const [rel, stamp] of resources) {
      byRel.set(rel, {
        path: rel,
        mime: mimeOf(rel),
        size: stamp.size,
        mtimeMs: stamp.mtimeMs,
        name: path.basename(rel),
        url: skillFileDownloadUrl(rel, workspaceId),
        exists: true,
      });
    }
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
      byRel.set(rel, {
        path: rel,
        mime: mimeOf(entry),
        size: st.size,
        mtimeMs: st.mtimeMs,
        name: entry,
        url: skillFileDownloadUrl(rel, workspaceId),
        exists: true,
      });
    }
  }
  for (const rec of readArtifactManifest(ws)) {
    if (!rec.rel || byRel.has(rec.rel)) continue;
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