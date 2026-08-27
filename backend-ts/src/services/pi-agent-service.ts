import { spawn, type ChildProcess } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatStreamEvent } from '../modules/bookplate/stream.js';
import {
  REAL_AGENTS_ROOT,
  REAL_SKILLS_ROOT,
  nodeWorkspace,
  symlinkOrCopy,
  userSkillsRoot,
} from './skill-agent-service.js';

/**
 * pi CLI Skill Agent 执行器（chat 节点第三模式）。
 *
 * 运行模型：每次对话把 admin 提示词（AGENTS.md 软链）、选中 skills（.pi-agent/skills/ 软链/复制）、
 * 对话大模型（.pi-agent/models.json）与绘图模型（.pi-agent/settings.json 的 pi-image-gen 段）
 * 装配进 runtime/{uid}/workspace/{chatid}/，以该目录为 cwd 子进程运行：
 *
 *   pi --mode json --no-context-files [--append-system-prompt AGENTS.md] [-e pi-image-gen]
 *      --session .pi-agent/run/chat.jsonl --provider bookforge --model bookforge/<model> <消息>
 *
 * JSONL 事件流归一化为 ChatStreamEvent；进程退出后快照差分工作区产物 → agent_file 事件。
 * 多轮记忆由 pi 会话文件承载（忽略前端回传的 messages）；abort = 杀进程树。
 */

// 仓库根 = 本文件（backend-ts/src/services/）向上三层；后端根 = 仓库根/backend-ts
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BACKEND_ROOT = path.join(REPO_ROOT, 'backend-ts');

/** pi-image-gen 扩展在 models.json 之外的 settings 键名（其自身约定）。 */
const IMAGE_GEN_SETTINGS_KEY = 'pi-image-gen';
/** 绘图产物目录（相对工作区根；默认隐藏目录不利于差分上报与下载卡片）。 */
const IMAGE_OUTPUT_DIR = 'outputs';

// ---------------------------------------------------------------------------
// 运行时调优默认值（env 可覆盖；写入 .pi-agent/settings.json 固化，防上游默认漂移）
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/** 压缩触发预留 token（阈值 = 模型上下文窗 − 该值；pi 默认 16384）。 */
const COMPACTION_RESERVE_TOKENS = envInt('PI_COMPACTION_RESERVE_TOKENS', 16384);
/** 压缩切割时保留的近期原文 token 量（pi 默认 20000）。 */
const COMPACTION_KEEP_RECENT_TOKENS = envInt('PI_COMPACTION_KEEP_RECENT_TOKENS', 20000);
/** 上游请求失败自动重试次数（pi 默认 3；云端限流场景适当放宽）。 */
const RETRY_MAX_RETRIES = envInt('PI_RETRY_MAX_RETRIES', 5);
/** 重试退避基值 ms（pi 默认 2000，指数退避）。 */
const RETRY_BASE_DELAY_MS = envInt('PI_RETRY_BASE_DELAY_MS', 2000);
/**
 * 工具黑名单（逗号分隔工具名，如 "bash,write"）→ 运行参数 -xt 注入。
 * pi 子进程模式没有审批门，多租户风险收敛只能靠 allowlist/denylist。
 */
const DISABLED_TOOLS = (process.env.PI_DISABLED_TOOLS ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);

/** 合法 thinking level（与 pi CLI --thinking 取值一致）。 */
export const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/**
 * 节点「思考」开关 → pi CLI --thinking 参数：
 * - 'on' → --thinking high（启用思考，取高推理档；pi 会按模型能力钳制）；
 * - 'off' → --thinking off（关闭思考；pi 对多数格式省略 reasoning 参数，能否真正关闭取决于模型/服务商）；
 * - 历史遗留档位字符串（minimal..max）原样透传，兼容旧节点已保存的设置；
 * - 其余（空/非法）→ 不传，跟随 pi/模型默认。
 */
export function resolveThinkingArgs(thinkingLevel: string | null | undefined): string[] {
  if (thinkingLevel === 'on') return ['--thinking', 'high'];
  if (thinkingLevel === 'off') return ['--thinking', 'off'];
  if (
    typeof thinkingLevel === 'string' &&
    (PI_THINKING_LEVELS as readonly string[]).includes(thinkingLevel)
  ) {
    return ['--thinking', thinkingLevel];
  }
  return [];
}

/**
 * pi 会话文件落点（相对工作区根）。必须放在 .pi-agent 根目录之下的子目录：
 * pi 每次启动都会把 {agentDir} 根下散落的 *.jsonl 迁移进 sessions/{cwd编码}/
 * （migrateSessionsFromAgentRoot），放根下会导致下一轮运行开始时历史被移走、
 * 上下文静默重置一次。子目录不在迁移扫描范围内，且 .pi-agent/ 整体被产物差分排除。
 */
const PI_SESSION_REL = path.join('.pi-agent', 'run', 'chat.jsonl');

// ---------------------------------------------------------------------------
// 二进制 / 扩展定位
// ---------------------------------------------------------------------------

export interface PiCommand {
  cmd: string;
  args: string[];
}

const PI_PKG_CANDIDATES = [
  path.join(BACKEND_ROOT, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js'),
  path.join(REPO_ROOT, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js'),
];
const IMAGE_GEN_EXT_CANDIDATES = [
  path.join(BACKEND_ROOT, 'node_modules', '@amaster.ai', 'pi-image-gen', 'dist', 'index.js'),
  path.join(REPO_ROOT, 'node_modules', '@amaster.ai', 'pi-image-gen', 'dist', 'index.js'),
];

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      /* 忽略不可访问候选 */
    }
  }
  return null;
}

/**
 * 解析 pi CLI 启动命令：PI_BIN 环境变量优先（直接作为可执行命令），
 * 否则从 backend-ts 依赖树解析包内 bin 入口用当前 node 运行。缺失抛中文错误。
 */
export function resolvePiBin(): PiCommand {
  const override = process.env.PI_BIN?.trim();
  if (override) return { cmd: override, args: [] };
  const cliJs = firstExisting(PI_PKG_CANDIDATES);
  if (cliJs) return { cmd: process.execPath, args: [cliJs] };
  throw new Error(
    '未找到 pi CLI：请在 backend-ts 安装 @earendil-works/pi-coding-agent，或通过 PI_BIN 指定可执行的 pi 命令'
  );
}

/** 解析 pi-image-gen 扩展入口（未安装返回 null = 不加载绘图工具）。 */
export function resolveImageGenExtension(): string | null {
  return firstExisting(IMAGE_GEN_EXT_CANDIDATES);
}

// ---------------------------------------------------------------------------
// 工作区装配
// ---------------------------------------------------------------------------

/** 对话模型运行时配置（来自 llm_configs，kind='text'|'multimodal'）。 */
export interface PiChatModelConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  /** 多模态模型声明 input:["text","image"]，pi 才会附加 @file 图片。 */
  multimodal: boolean;
  /** pi provider api 格式：'anthropic' = anthropic-messages，空/其它 = openai-completions。 */
  apiFormat?: string | null;
  /** OpenAI 兼容路径的思考 wire 格式（pi compat.thinkingFormat，空 = 默认 reasoning_effort）。 */
  thinkingFormat?: string | null;
  /** 模型上下文窗口大小（token，默认 128000）。 */
  contextWindow?: number | null;
  /** 模型最大输出 token（默认 16384）。 */
  maxTokens?: number | null;
}

/** 绘图模型运行时配置（llm_configs kind='image'）。 */
export interface PiImageModelConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

export interface PreparePiWorkspaceOptions {
  agentId: number;
  chatModel: PiChatModelConfig;
  imageModel: PiImageModelConfig | null;
  /** 上游 skill_search 选中的 skill 名（空 = 不装配任何技能）。 */
  skillNames: string[];
}

export interface PreparedWorkspaceInfo {
  ws: string;
  /** 该 Skill Agent 配置引用的提示词是否已物化（决定 pi 是否注入 AGENTS.md）。 */
  hasPrompt: boolean;
  mountedSkills: string[];
  skippedSkills: string[];
}

/** skill 名合法性（与 skill-agent-service 校验口径一致）：拒绝路径分隔符/相对跳转/控制字符。 */
function isValidSkillName(name: string): boolean {
  return (
    !!name &&
    name.length <= 100 &&
    !name.includes('/') &&
    !name.includes('\\') &&
    name !== '.' &&
    name !== '..' &&
    ![...name].some((ch) => ch.charCodeAt(0) < 32)
  );
}

/**
 * 装配 pi 运行时工作区（幂等）：
 * - AGENTS.md：真实提示词文件存在 → 软链到工作区根（否则清理残留链接）；
 * - .pi-agent/skills/{name}：登记为软链（Bifrost 共享包）→ 软链共享区；真实目录（上传）→ 复制。
 *   目标目录必须是 .pi-agent/skills/：这是 pi 的 user-scope 技能目录（agentDir=PI_CODING_AGENT_DIR），
 *   无条件扫描；.agents/skills 属 project scope，需 project trust，headless json 模式下不会加载；
 * - .pi-agent/models.json：对话模型物化（provider=bookforge）；
 * - .pi-agent/settings.json：pi-image-gen 段物化（defaultModel + customProviders.bookforge）。
 */
export function preparePiWorkspace(
  userId: number,
  workspaceId: string,
  opts: PreparePiWorkspaceOptions
): PreparedWorkspaceInfo {
  const ws = nodeWorkspace(userId, workspaceId);

  // 1) AGENTS.md 条件软链
  const wsAgentsMd = path.join(ws, 'AGENTS.md');
  const realAgentsMd = path.join(REAL_AGENTS_ROOT, String(opts.agentId), 'AGENTS.md');
  removePathSafe(wsAgentsMd);
  if (existsSync(realAgentsMd)) {
    symlinkOrCopy(realAgentsMd, wsAgentsMd);
  }

  // 2) skills 条件装配（仅显式选中项；目录口径见 preparePiWorkspace 注释——必须 .pi-agent/skills）
  const mountedSkills: string[] = [];
  const skippedSkills: string[] = [];
  const skillsDir = path.join(ws, '.pi-agent', 'skills');
  rmSync(skillsDir, { recursive: true, force: true });
  if (opts.skillNames.length) {
    mkdirSync(skillsDir, { recursive: true });
    const registryRoot = userSkillsRoot(userId);
    for (const raw of opts.skillNames) {
      const name = String(raw ?? '').trim();
      if (!isValidSkillName(name)) {
        skippedSkills.push(String(raw ?? ''));
        continue;
      }
      const source = path.join(registryRoot, name);
      try {
        if (!statSync(source).isDirectory() || !existsSync(path.join(source, 'SKILL.md'))) {
          skippedSkills.push(name);
          continue;
        }
      } catch {
        skippedSkills.push(name);
        continue;
      }
      const dest = path.join(skillsDir, name);
      let isLink = false;
      try {
        isLink = lstatSync(source).isSymbolicLink();
      } catch {
        isLink = false;
      }
      if (isLink) {
        // Bifrost 检索装：软链共享区真实包（Windows 无权限时退化为复制的功能等价语义）
        symlinkOrCopy(path.join(REAL_SKILLS_ROOT, name), dest);
      } else {
        // 用户上传装：保持「工作区内真实目录」私有语义，强制复制
        mkdirSync(path.dirname(dest), { recursive: true });
        rmSync(dest, { recursive: true, force: true });
        cpSync(source, dest, { recursive: true });
      }
      mountedSkills.push(name);
    }
  }

  // 3) .pi-agent 配置目录
  const agentDir = path.join(ws, '.pi-agent');
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(path.join(ws, 'inputs'), { recursive: true });

  // 对话模型 → models.json（api 按配置选 openai-completions / anthropic-messages；与后端 LLM 服务同协议）
  const chatModelEntry: Record<string, unknown> = {
    id: opts.chatModel.modelName,
    // 兜底声明支持推理：让节点「启用思考」真正把档位传给 provider；
    // 模型实际不支持时由 pi 按能力钳制/省略参数，走服务商默认。
    reasoning: true,
    input: opts.chatModel.multimodal ? ['text', 'image'] : ['text'],
    contextWindow: opts.chatModel.contextWindow || 128000,
    maxTokens: opts.chatModel.maxTokens || 16384,
  };
  // OpenAI 兼容路径：按模型声明思考 wire 格式（agnes → qwen-chat-template、deepseek → deepseek 等；
  // 空 = pi 默认 reasoning_effort）。Anthropic 路径由 pi 适配器原生映射，无需 compat。
  if (opts.chatModel.apiFormat !== 'anthropic' && opts.chatModel.thinkingFormat) {
    chatModelEntry.compat = { thinkingFormat: opts.chatModel.thinkingFormat };
  }
  const modelsJson = {
    providers: {
      bookforge: {
        baseUrl: opts.chatModel.baseUrl,
        api: opts.chatModel.apiFormat === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
        apiKey: opts.chatModel.apiKey,
        models: [chatModelEntry],
      },
    },
  };
  writeFileSync(path.join(agentDir, 'models.json'), JSON.stringify(modelsJson, null, 2), 'utf-8');

  // 绘图模型 → settings.json 的 pi-image-gen 段（保留既有其它键）
  const settingsPath = path.join(agentDir, 'settings.json');
  let settings: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed;
  } catch {
    /* 无文件或非法 JSON：重建 */
  }
  if (opts.imageModel) {
    settings[IMAGE_GEN_SETTINGS_KEY] = {
      defaultModel: opts.imageModel.modelName,
      outputDir: IMAGE_OUTPUT_DIR,
      customProviders: {
        bookforge: {
          api: 'openai',
          baseUrl: opts.imageModel.baseUrl,
          apiKey: opts.imageModel.apiKey,
          models: [{ id: opts.imageModel.modelName }],
        },
      },
    };
  } else {
    delete settings[IMAGE_GEN_SETTINGS_KEY];
  }

  // 运行时调优段：自动压缩 + 自动重试（显式固化，json 子进程模式同样生效）
  settings['compaction'] = {
    ...(typeof settings['compaction'] === 'object' && settings['compaction'] !== null
      ? (settings['compaction'] as Record<string, unknown>)
      : {}),
    enabled: true,
    reserveTokens: COMPACTION_RESERVE_TOKENS,
    keepRecentTokens: COMPACTION_KEEP_RECENT_TOKENS,
  };
  settings['retry'] = {
    ...(typeof settings['retry'] === 'object' && settings['retry'] !== null
      ? (settings['retry'] as Record<string, unknown>)
      : {}),
    enabled: true,
    maxRetries: RETRY_MAX_RETRIES,
    baseDelayMs: RETRY_BASE_DELAY_MS,
  };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

  return { ws, hasPrompt: existsSync(realAgentsMd), mountedSkills, skippedSkills };
}

/**
 * 清空 Skill Agent 节点会话（「清空对话」语义）：删除全部会话历史，下次对话从零开始；
 * 保留 skills/models/settings 等装配物与 outputs/inputs 产物。
 * 覆盖三处：当前会话（.pi-agent/run/）、历史版本落在 agentDir 根的 chat.jsonl、
 * pi 自管/启动迁移产生的 .pi-agent/sessions/。幂等；无任何会话残留时返回 false。
 */
export function clearPiSession(userId: number, workspaceId: string): boolean {
  const ws = nodeWorkspace(userId, workspaceId);
  const agentDir = path.join(ws, '.pi-agent');
  let cleared = false;
  const targets = [path.join(agentDir, 'run'), path.join(agentDir, 'sessions')];
  for (const dir of targets) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      cleared = true;
    }
  }
  const legacyRootSession = path.join(agentDir, 'chat.jsonl');
  if (existsSync(legacyRootSession)) {
    removePathSafe(legacyRootSession);
    cleared = true;
  }
  return cleared;
}

// ---------------------------------------------------------------------------
// 快照差分（产物探测）
// ---------------------------------------------------------------------------

interface FileStamp {
  size: number;
  mtimeMs: number;
}

/** 差分排除前缀/文件：装配物与会话配置不算「agent 产物」。 */
const DIFF_EXCLUDED_PREFIXES = ['.agents/', '.pi/', '.pi-agent/', 'inputs/'];
const DIFF_EXCLUDED_FILES = new Set(['AGENTS.md']);

function isDiffExcluded(rel: string): boolean {
  if (DIFF_EXCLUDED_FILES.has(rel)) return true;
  return DIFF_EXCLUDED_PREFIXES.some((p) => rel.startsWith(p));
}

// ---------------------------------------------------------------------------
// 产物清单（manifest）与工作区产物列表
// ---------------------------------------------------------------------------

/**
 * 工作区产物清单落点（相对工作区根）。放 .pi-agent/ 下可复用差分排除前缀，
 * 清单不会自报自录；append-only JSONL，读取端按 rel 去重取最新。
 */
export const PI_ARTIFACTS_REL = path.join('.pi-agent', 'artifacts.jsonl');

export interface ArtifactRecord {
  rel: string;
  mime: string;
  size: number;
  mtimeMs: number;
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

export interface WorkspaceArtifact extends Omit<ArtifactRecord, 'rel'> {
  /** 工作区相对路径（正斜杠口径，与 agent_file 事件的 path 字段一致） */
  path: string;
  name: string;
  url: string;
  exists: boolean;
}

/**
 * 列出工作区当前产物（差分同口径排除装配物/会话/inputs），并与 manifest 历史
 * 条目合并（文件已被删除的历史产物保留并标 exists=false，维持可追溯）。
 */
export function listWorkspaceArtifacts(ws: string, workspaceId: string): WorkspaceArtifact[] {
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
  const manifestFile = path.join(ws, PI_ARTIFACTS_REL);
  try {
    const raw = readFileSync(manifestFile, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      let rec: Partial<ArtifactRecord>;
      try {
        rec = JSON.parse(trimmed) as Partial<ArtifactRecord>;
      } catch {
        continue;
      }
      if (typeof rec.rel !== 'string' || !rec.rel || byRel.has(rec.rel)) continue;
      byRel.set(rec.rel, {
        path: rec.rel,
        mime: rec.mime ?? mimeOf(rec.rel),
        size: rec.size ?? 0,
        mtimeMs: rec.mtimeMs ?? 0,
        name: path.basename(rec.rel),
        url: skillFileDownloadUrl(rec.rel, workspaceId),
        exists: false,
      });
    }
  } catch {
    /* 无 manifest 或不可读：仅返回当前快照 */
  }
  return [...byRel.values()].sort((a, b) => a.path.localeCompare(b.path));
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
      st = statSync(full); // 跟随软链不穿透目标内容统计（skills 已被前缀排除）
    } catch {
      continue;
    }
    if (st.isDirectory()) walkWorkspace(root, out, full, rel);
    else if (st.isFile()) out.set(rel, { size: st.size, mtimeMs: st.mtimeMs });
  }
}

function snapshotWorkspace(ws: string): Map<string, FileStamp> {
  const map = new Map<string, FileStamp>();
  walkWorkspace(ws, map);
  return map;
}

// ---------------------------------------------------------------------------
// 杂项
// ---------------------------------------------------------------------------

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

/** 按扩展名返回 MIME（未知扩展名按二进制处理）；供 skill-files 接口与 agent_file 事件共用。 */
export function mimeOf(fileName: string): string {
  return MIME_BY_EXT[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

/** skill-files 下载/预览 URL（工作区相对路径 + workspace_id；agent_file 事件统一口径）。 */
export function skillFileDownloadUrl(rel: string, workspaceId: string): string {
  return `/api/modules/bookplate/skill-files?path=${encodeURIComponent(rel)}&workspace_id=${encodeURIComponent(workspaceId)}`;
}

/** 解析 data URL 图片并落盘到 ws/inputs/img-N.ext；返回供 @file 附加的相对路径。 */
export function saveInputImages(ws: string, images: string[]): string[] {
  const dir = path.join(ws, 'inputs');
  mkdirSync(dir, { recursive: true });
  const rels: string[] = [];
  for (const dataUrl of images.slice(0, 4)) {
    const idx = typeof dataUrl === 'string' ? dataUrl.indexOf(',') : -1;
    if (idx < 0 || !dataUrl.startsWith('data:image/')) continue;
    const meta = dataUrl.slice(0, idx);
    const extMatch = /^data:image\/([a-z0-9.+-]+)/i.exec(meta);
    if (!extMatch?.[1]) continue;
    const ext = extMatch[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    let buf: Buffer;
    try {
      buf = Buffer.from(dataUrl.slice(idx + 1), 'base64');
    } catch {
      continue;
    }
    if (!buf.length) continue;
    const rel = `inputs/img-${rels.length + 1}.${ext}`;
    writeFileSync(path.join(ws, rel), buf);
    rels.push(rel);
  }
  return rels;
}

function removePathSafe(p: string): void {
  try {
    rmSync(p, { force: true });
  } catch {
    /* 目录残留或不存在：忽略 */
  }
}

/** Windows 下 taskkill 杀整棵进程树；POSIX 直接 SIGKILL（pi 子进程组随之终止）。 */
function killTree(child: ChildProcess): void {
  if (child.pid == null || child.exitCode != null) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch {
      /* 回退普通 kill */
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* 已退出 */
  }
}

// ---------------------------------------------------------------------------
// 运行器
// ---------------------------------------------------------------------------

export interface RunPiAgentOptions {
  userId: number;
  workspaceId: string;
  ws: string;
  hasPrompt: boolean;
  chatModelName: string;
  imageGenEnabled: boolean;
  message: string;
  images?: string[];
  /** thinking 开关（'on'='--thinking high'、'off'、遗留档位透传；空/非法 = 跟随 pi 默认） */
  thinkingLevel?: string | null;
  signal?: AbortSignal;
}

interface PiJsonEvent {
  type: string;
  [key: string]: unknown;
}

/** 事件映射的跨事件状态（message_end 捕获的最新模型错误，供 auto_retry_end / 收尾判定）。 */
export interface PiEventMapperState {
  lastError: string | null;
}

const COMPACTION_REASON_TEXT: Record<string, string> = {
  manual: '手动',
  threshold: '达到上下文阈值',
  overflow: '上下文溢出',
};

/**
 * pi json 事件 → ChatStreamEvent 归一化映射（纯函数，可单测）。
 * 覆盖：流式增量 / 工具调用 / 自动重试（结构化）/ 上下文压缩（开始与完成）/
 * 错误捕获；未知事件静默忽略。
 */
export function* mapPiJsonEvent(
  evt: PiJsonEvent,
  state: PiEventMapperState
): Generator<ChatStreamEvent> {
  switch (evt.type) {
    case 'message_update': {
      const ame = evt.assistantMessageEvent as { type?: string; delta?: string } | undefined;
      if (ame?.type === 'text_delta' && typeof ame.delta === 'string') {
        yield { type: 'content_delta', delta: ame.delta };
      } else if (ame?.type === 'thinking_delta' && typeof ame.delta === 'string') {
        yield { type: 'reasoning_delta', delta: ame.delta };
      }
      break;
    }
    case 'tool_execution_start': {
      yield {
        type: 'tool_call',
        id: String(evt.toolCallId ?? ''),
        name: String(evt.toolName ?? ''),
        arguments: JSON.stringify(evt.args ?? {}),
      };
      break;
    }
    case 'tool_execution_end': {
      yield {
        type: 'tool_result',
        id: String(evt.toolCallId ?? ''),
        name: String(evt.toolName ?? ''),
        result: JSON.stringify(evt.result ?? null),
      };
      break;
    }
    case 'compaction_start': {
      const reason = String(evt.reason ?? 'threshold');
      yield {
        type: 'status',
        message: `上下文压缩中（${COMPACTION_REASON_TEXT[reason] ?? reason}），正在摘要归档更早日志…`,
      };
      break;
    }
    case 'compaction_end': {
      // aborted：用户中断导致的压缩放弃，不提示；失败细节由 errorMessage 承载
      if (evt.aborted) break;
      if (typeof evt.errorMessage === 'string' && evt.errorMessage) {
        yield { type: 'status', message: `上下文压缩失败：${evt.errorMessage}` };
        break;
      }
      yield { type: 'status', message: '上下文压缩完成，更早对话已摘要归档' };
      break;
    }
    case 'message_end': {
      const msg = evt.message as { role?: string; errorMessage?: string } | undefined;
      if (msg?.role !== 'assistant') break;
      // 每条 assistant message_end 视为最新结果：auto-retry 恢复后的成功消息必须
      // 覆盖此前失败尝试的 errorMessage，否则进程正常结束后仍会误报
      // 「执行失败」——前端会在收尾 error chunk 上回滚整轮已流出的内容。
      state.lastError = msg.errorMessage ?? null;
      break;
    }
    case 'auto_retry_start': {
      // 结构化重试事件：前端渲染倒计时横幅（attempt/delayMs 驱动），不再用纯文本步骤
      const attempt = Number(evt.attempt ?? 0);
      const maxAttempts = Number(evt.maxAttempts ?? 0);
      const delaySec = Math.max(1, Math.round(Number(evt.delayMs ?? 0) / 1000));
      const reason =
        typeof evt.errorMessage === 'string' ? friendlyProviderError(evt.errorMessage) : '上游请求失败';
      yield { type: 'agent_retry', attempt, maxAttempts, delaySec, reason };
      break;
    }
    case 'auto_retry_end': {
      if (evt.success === false && state.lastError) {
        yield { type: 'error', message: formatPiFailure(state.lastError) };
      } else if (evt.success === true) {
        yield { type: 'status', message: '已自动恢复，继续生成…' };
      }
      break;
    }
    default:
      break;
  }
}

/** 把 pi/provider 的原始错误摘要为用户可读的中文短语（原始细节仍附在最终错误里）。 */
function friendlyProviderError(raw: string): string {
  if (/\b429\b|rate.?limit|too many requests/i.test(raw)) return '模型服务繁忙（限流）';
  if (/\b40[13]\b|unauthorized|forbidden|invalid.{0,12}api.?key/i.test(raw)) return '模型鉴权失败（请检查 API Key）';
  if (/\b404\b|not found|no endpoints|model.*not.*exist/i.test(raw)) return '模型不存在或不可用';
  if (/\b402\b|insufficient|quota|credit|balance/i.test(raw)) return '模型配额/余额不足';
  if (/timed? ?out|timeout/i.test(raw)) return '模型请求超时';
  if (/\b5\d\d\b|bad gateway|service unavailable/i.test(raw)) return '模型服务异常';
  if (/aborted/i.test(raw)) return '请求已中断';
  return '模型请求失败';
}

/** 组装节点展示的失败文案：友好原因在前，原始错误细节在后（便于排查）。 */
function formatPiFailure(lastError: string): string {
  return `${friendlyProviderError(lastError)}：${lastError}`;
}

/** pi json 事件流 → ChatStreamEvent 异步生成器；结束后差分产物推 agent_file。 */
export async function* runPiAgent(opts: RunPiAgentOptions): AsyncGenerator<ChatStreamEvent> {
  const { cmd, args: binArgs } = resolvePiBin();

  const imageRels = opts.images?.length ? saveInputImages(opts.ws, opts.images) : [];

  const args = [...binArgs, '--mode', 'json', '--no-context-files'];
  const agentsMd = path.join(opts.ws, 'AGENTS.md');
  if (opts.hasPrompt && existsSync(agentsMd)) {
    args.push('--append-system-prompt', agentsMd);
  }
  if (opts.imageGenEnabled) {
    const ext = resolveImageGenExtension();
    if (ext) args.push('-e', ext);
  }
  // thinking（节点设置 on/off/遗留档位 → pi CLI；非法值静默忽略 = pi 默认）
  args.push(...resolveThinkingArgs(opts.thinkingLevel));
  // 工具黑名单（多租户风险收敛；pi 子进程模式无审批门，仅 allowlist/denylist 可控）
  for (const tool of DISABLED_TOOLS) {
    args.push('--exclude-tools', tool);
  }
  const sessionFile = path.join(opts.ws, PI_SESSION_REL);
  mkdirSync(path.dirname(sessionFile), { recursive: true });
  args.push(
    '--session',
    sessionFile,
    '--provider',
    'bookforge',
    '--model',
    `bookforge/${opts.chatModelName}`,
    ...imageRels.map((rel) => `@${rel}`),
    opts.message
  );

  const agentDirEnv = path.join(opts.ws, '.pi-agent');
  const child = spawn(cmd, args, {
    cwd: opts.ws,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDirEnv,
      PI_AGENT_HOME: agentDirEnv,
      PI_TELEMETRY: '0',
    },
  });

  let abortRequested = false;
  const onAbort = () => {
    abortRequested = true;
    killTree(child);
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  const before = snapshotWorkspace(opts.ws);
  const stdout = child.stdout;
  const stderr = child.stderr;
  const stderrTailRef = { value: '' };
  stderr?.on('data', (c: Buffer) => {
    stderrTailRef.value = (stderrTailRef.value + c.toString('utf-8')).slice(-2000);
  });

  // 事件队列：stdout 行解析线程安全地入队，生成器按序出队
  const queue: ChatStreamEvent[] = [];
  const mapperState: PiEventMapperState = { lastError: null };
  let emittedError = false;
  let stdoutEnded = false;
  let childClosed = false;

  // 事件唤醒：入队 / stdout 结束 / 进程退出时唤醒等待中的生成器（单线程语义下无竞态）
  let notify: (() => void) | null = null;
  const wake = (): void => {
    const n = notify;
    notify = null;
    n?.();
  };
  const pushEvent = (e: ChatStreamEvent): void => {
    queue.push(e);
    wake();
  };

  let lineBuf = '';
  const consumeLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    let evt: PiJsonEvent;
    try {
      evt = JSON.parse(trimmed) as PiJsonEvent;
    } catch {
      return;
    }
    for (const e of mapPiJsonEvent(evt, mapperState)) {
      if (e.type === 'error') emittedError = true;
      pushEvent(e);
    }
  };

  stdout?.on('data', (c: Buffer) => {
    lineBuf += c.toString('utf-8');
    let idx: number;
    while ((idx = lineBuf.indexOf('\n')) >= 0) {
      const line = lineBuf.slice(0, idx);
      lineBuf = lineBuf.slice(idx + 1);
      consumeLine(line);
    }
  });
  const markStdoutEnd = (): void => {
    if (stdoutEnded) return;
    stdoutEnded = true;
    if (lineBuf) {
      const rest = lineBuf;
      lineBuf = '';
      consumeLine(rest);
    }
    wake();
  };
  stdout?.on('end', markStdoutEnd);
  stdout?.on('error', markStdoutEnd);
  const exitCode = new Promise<number | null>((resolve) => {
    child.on('close', (code) => {
      childClosed = true;
      wake();
      resolve(code);
    });
    child.on('error', () => {
      childClosed = true;
      wake();
      resolve(-1);
    });
  });

  try {
    // 出队循环：队列空且（进程已退出且 stdout 已排空）时结束
    while (true) {
      if (queue.length) {
        yield queue.shift()!;
        continue;
      }
      if (childClosed && stdoutEnded) break;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }

    if (!emittedError) {
      if (abortRequested) {
        yield { type: 'status', message: '已中断' };
      } else {
        const code = await exitCode;
        const lastError = mapperState.lastError;
        if (code !== 0 || lastError) {
          emittedError = true;
          if (lastError) {
            yield { type: 'error', message: formatPiFailure(lastError) };
          } else {
            // 无模型错误（进程崩溃 / CLI 缺失等）：附 stderr 末行辅助定位
            const tail = stderrTailRef.value.trim();
            yield {
              type: 'error',
              message: `pi agent 执行失败（退出码 ${code}）${tail ? `\n${tail.split('\n').at(-1)}` : ''}`,
            };
          }
        }
      }
    }

    // 产物差分（新增或修改的文件）→ agent_file 卡片 + manifest 落盘（服务端可再到达）
    const after = snapshotWorkspace(opts.ws);
    const artifacts: ArtifactRecord[] = [];
    for (const [rel, stamp] of after) {
      if (isDiffExcluded(rel)) continue;
      const prev = before.get(rel);
      if (prev && prev.size === stamp.size && prev.mtimeMs === stamp.mtimeMs) continue;
      artifacts.push({ rel, mime: mimeOf(rel), size: stamp.size, mtimeMs: stamp.mtimeMs });
      yield {
        type: 'agent_file',
        file: {
          url: skillFileDownloadUrl(rel, opts.workspaceId),
          name: path.basename(rel),
          mime: mimeOf(rel),
          size: stamp.size,
          path: rel,
        },
      };
    }
    appendArtifactManifest(opts.ws, artifacts);
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    killTree(child);
  }
}
