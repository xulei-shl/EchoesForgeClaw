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
import { homedir } from 'node:os';
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

/** RPC 模式对话总超时（毫秒，默认 10 分钟）：agent_settled 始终未达时的防死等兜底。 */
const RPC_AGENT_TIMEOUT_MS = envInt('PI_RPC_TIMEOUT_MS', 10 * 60 * 1000);

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
// 扩展包白名单装配（§4.3：管理员白名单 + 版本锁定 + 显式 -e 加载）
// ---------------------------------------------------------------------------

/**
 * pi 全局 agent 目录（同 pi-coding-agent 的 getAgentDir 口径）：
 * PI_CODING_AGENT_DIR 显式指定时优先，否则 ~/.pi/agent。
 * 注意：这是「后端发现管理员已装扩展」用的宿主目录，与 runPiAgent 给子进程
 * 注入的 {ws}/.pi-agent（每工作区 agentDir）不同。
 */
function piAgentHomeDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR?.trim();
  return envDir ? path.resolve(envDir) : path.join(homedir(), '.pi', 'agent');
}

/**
 * `pi install npm:<pkg>` 的全局落点（同 pi-coding-agent package-manager 的
 * resolveManagedPath 口径）：{agentDir}/npm/node_modules。作为白名单扩展的
 * 候选解析位置之一，使「管理员用 pi install 装包 + PI_EXTENSIONS 白名单」
 * 即可接入，无需再手动复制进 backend-ts 依赖树。
 */
function piNpmPackagesDir(): string {
  return path.join(piAgentHomeDir(), 'npm', 'node_modules');
}

export interface PiExtensionSpec {
  /** 包名（如 "@juicesharp/rpiv-todo"）。 */
  name: string;
  /** 已安装包目录（backend-ts/node_modules、仓库根 node_modules 或 pi 全局 npm 目录）。 */
  dir: string;
}

/**
 * 解析白名单内已安装的扩展包（未安装的静默跳过；返回按白名单顺序）。
 * 白名单 = 管理员批准的服务端代码扩展（多租户最高风险），运行期从
 * PI_EXTENSIONS 读取（逗号分隔的 npm 包名）；用户技能（纯提示词/工具声明）
 * 继续走 skills 流程，二者互不混用。
 * 版本锁定：升级 = 固定包版本（pi install / npm 安装锁定版本） + 回归验证。
 * 解析顺序：backend-ts 依赖树 → 仓库根依赖树 → pi 全局 npm 目录（首个命中生效）。
 */
export function resolvePiExtensions(): PiExtensionSpec[] {
  const whitelist = (process.env.PI_EXTENSIONS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const specs: PiExtensionSpec[] = [];
  for (const raw of whitelist) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    // 按 node_modules 布局展开 scoped 包名（@scope/pkg → @scope/pkg）
    const segs = name.split('/').filter(Boolean);
    const rel = path.join('node_modules', ...segs);
    const dir = firstExisting([
      path.join(BACKEND_ROOT, rel),
      path.join(REPO_ROOT, rel),
      path.join(piNpmPackagesDir(), ...segs),
    ]);
    if (dir) specs.push({ name, dir });
  }
  return specs;
}

/**
 * 扩展在工作区 .pi-agent/extensions/ 下的扁平目录名：
 * scoped 包展平为包名（@juicesharp/rpiv-todo → rpiv-todo），
 * 避免嵌套目录（pi 自动发现仅一层，且显式 -e 解析 package.json 入口不依赖目录层级）。
 */
function extensionDirName(pkgName: string): string {
  return pkgName
    .replace(/^@[^/]+\//, '')
    .replace(/[/\\]/g, '_')
    .slice(0, 100);
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
  /** 白名单内已装配到 {ws}/.pi-agent/extensions/ 的扩展目录（runPiAgent 据此追加 -e）。 */
  mountedExtensions: string[];
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

  // 3.5) 扩展包装配（白名单 + 显式 -e 加载；仅管理员批准的包）
  const mountedExtensions: string[] = [];
  const extRoot = path.join(agentDir, 'extensions');
  rmSync(extRoot, { recursive: true, force: true });
  const extSpecs = resolvePiExtensions();
  if (extSpecs.length) {
    mkdirSync(extRoot, { recursive: true });
    for (const spec of extSpecs) {
      const dest = path.join(extRoot, extensionDirName(spec.name));
      try {
        if (!statSync(spec.dir).isDirectory() || !existsSync(path.join(spec.dir, 'package.json'))) {
          continue;
        }
      } catch {
        continue;
      }
      // 复用 symlinkOrCopy（Bifrost 共享包 → 软链共享区；Windows 无权限时退化为复制）
      symlinkOrCopy(spec.dir, dest);
      mountedExtensions.push(dest);
    }
  }

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
  const modelContext = opts.chatModel.contextWindow || 128000;
  // 动态安全保护：预留 token 不能超过总窗口的 20%，且不小于 512（防小模型如 8k/16k 首轮陷入压缩死循环）
  const safeReserveTokens = Math.min(
    COMPACTION_RESERVE_TOKENS,
    Math.max(512, Math.floor(modelContext * 0.2))
  );
  const safeKeepTokens = Math.min(
    COMPACTION_KEEP_RECENT_TOKENS,
    Math.max(1024, Math.floor((modelContext - safeReserveTokens) * 0.5))
  );

  settings['compaction'] = {
    ...(typeof settings['compaction'] === 'object' && settings['compaction'] !== null
      ? (settings['compaction'] as Record<string, unknown>)
      : {}),
    enabled: true,
    reserveTokens: safeReserveTokens,
    keepRecentTokens: safeKeepTokens,
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

  return { ws, hasPrompt: existsSync(realAgentsMd), mountedSkills, skippedSkills, mountedExtensions };
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
  // 清空对话 = 作废本轮交互：先终止活跃 RPC 子进程（问卷等待中 / 流式中）
  if (killPiProcess(userId, workspaceId)) cleared = true;
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
  // 扩展 widget 快照随会话一并清除（跨轮真相源，清空对话即清空）
  const widgetsFile = path.join(agentDir, 'widgets.json');
  if (existsSync(widgetsFile)) {
    removePathSafe(widgetsFile);
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

/**
 * 运行器：v2 起 pi 以 `--mode rpc` 常驻子进程运行（交互扩展通道所需）；
 * json 一次性模式已废弃（RPC 事件面是 json 事件面的超集，兼容由 git 历史兜底）。
 */

export interface RunPiAgentOptions {
  userId: number;
  workspaceId: string;
  ws: string;
  hasPrompt: boolean;
  chatModelName: string;
  imageGenEnabled: boolean;
  message: string;
  images?: string[];
  /** 白名单扩展已装配目录（preparePiWorkspace.mountedExtensions；逐个追加 -e） */
  extensions?: string[];
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

/** RPC dialog 方法白名单（extension_ui_request 只桥这些；setWidget/notify/setStatus 等不桥）。 */
const DIALOG_METHODS: ReadonlySet<string> = new Set(['select', 'confirm', 'input', 'editor']);

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
    case 'extension_ui_request': {
      // RPC 交互 dialog（select/confirm/input/editor）：只透传白名单字段，
      // 未知方法（setWidget/notify/setStatus/setTitle/set_editor_text/custom）静默忽略。
      const method = String(evt.method ?? '');
      if (!DIALOG_METHODS.has(method)) break;
      const id = String(evt.id ?? '');
      if (!id) break;
      const title = String(evt.title ?? '');
      if (!title && method !== 'confirm') break;
      const out: Record<string, unknown> = {
        type: 'extension_ui_request',
        id,
        method,
        title,
      };
      if (Array.isArray(evt.options)) {
        out['options'] = evt.options.filter((o) => typeof o === 'string');
      }
      if (typeof evt.message === 'string') out['message'] = evt.message;
      if (typeof evt.placeholder === 'string') out['placeholder'] = evt.placeholder;
      if (typeof evt.prefill === 'string') out['prefill'] = evt.prefill;
      if (typeof evt.timeout === 'number' && Number.isFinite(evt.timeout)) out['timeout'] = evt.timeout;
      yield out as ChatStreamEvent & { type: 'extension_ui_request' };
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

/**
 * pi RPC 子进程注册表（worker 进程内单态）。
 * 多租户并发核心：key = `${userId}:${workspaceId}`，与 nodeWorkspace(userId, workspaceId)
 * 同一口径，杜绝跨账号同名 workspace 串扰（pi-web 是各用户本地进程，无此问题）。
 */
interface PiProcessEntry {
  stdin: import('node:stream').Writable;
  /** 置位后视为已结束（API 404）；保证对已死进程不写 stdin（D5 竞态） */
  ended: boolean;
  procId: number;
  /** 终止回调（killTree；供 clearPiSession / abort 等外部语境使用） */
  kill: () => void;
}

const piProcessRegistry = new Map<string, PiProcessEntry>();

function piProcessKey(userId: number, workspaceId: string): string {
  return `${userId}:${workspaceId}`;
}

/**
 * 注册活跃 RPC 子进程（runPiAgent spawn 后调用）；返回注销函数（仅当仍是本次条目时移除）。
 * 顶替语义：同 key 旧进程若仍存活（错误路径下旧轮清理被跳过/延迟），立即终止老进程，
 * 防止两个 pi 进程共写同一会话文件导致上下文损坏；注销做 identity 校验，过期轮的
 * finally 清理不得误删新进程的注册项（否则 ui-response 会对新轮 404）。
 */
export function registerPiProcess(userId: number, workspaceId: string, stdin: PiProcessEntry['stdin'], procId: number, kill: () => void): () => void {
  const key = piProcessKey(userId, workspaceId);
  const entry: PiProcessEntry = { stdin, ended: false, procId, kill };
  const prev = piProcessRegistry.get(key);
  if (prev && !prev.ended) {
    prev.ended = true;
    try {
      prev.kill();
    } catch {
      /* 进程可能已亡 */
    }
  }
  piProcessRegistry.set(key, entry);
  return () => {
    if (piProcessRegistry.get(key) === entry) {
      entry.ended = true;
      piProcessRegistry.delete(key);
    }
  };
}

/** 终止并注销某工作区的活跃 RPC 子进程（清空对话 / 主动释放语义）。 */
export function killPiProcess(userId: number, workspaceId: string): boolean {
  const entry = piProcessRegistry.get(piProcessKey(userId, workspaceId));
  if (!entry || entry.ended) return false;
  entry.ended = true;
  piProcessRegistry.delete(piProcessKey(userId, workspaceId));
  try {
    entry.kill();
  } catch {
    /* kill 失败忽略（进程可能已亡） */
  }
  return true;
}

/** 前端作答 → 写回活跃 RPC 子进程 stdin。返回 false = 进程不存在/已结束（404 语义）。 */
export function sendExtensionUiResponse(
  userId: number,
  workspaceId: string,
  body: { id: string; value?: string; confirmed?: boolean; cancelled?: boolean }
): boolean {
  const entry = piProcessRegistry.get(piProcessKey(userId, workspaceId));
  if (!entry || entry.ended) return false;
  const payload: Record<string, unknown> = { type: 'extension_ui_response', id: body.id };
  if (body.value !== undefined) payload['value'] = body.value;
  if (body.confirmed !== undefined) payload['confirmed'] = body.confirmed;
  if (body.cancelled !== undefined) payload['cancelled'] = body.cancelled;
  try {
    entry.stdin.write(JSON.stringify(payload) + '\n');
  } catch {
    // 管道已断（进程刚死、清理未及）：与「会话已结束」等效，置 ended 防后续重复写
    entry.ended = true;
    piProcessRegistry.delete(piProcessKey(userId, workspaceId));
    return false;
  }
  return true;
}

/** pi json 事件流 → ChatStreamEvent 异步生成器；结束后差分产物推 agent_file。 */
export async function* runPiAgent(opts: RunPiAgentOptions): AsyncGenerator<ChatStreamEvent> {
  const { cmd, args: binArgs } = resolvePiBin();

  // RPC 模式图片经 prompt 命令 images 字段直传（data URL → {type:"image",data,mimeType}），
  // 不落盘 inputs/（RPC 禁 @file argv；saveInputImages 留给 json 兼容路径不复用）。
  const images = opts.images?.length ? opts.images.slice(0, 4) : [];

  const args = [...binArgs, '--mode', 'rpc', '--no-context-files'];
  const agentsMd = path.join(opts.ws, 'AGENTS.md');
  if (opts.hasPrompt && existsSync(agentsMd)) {
    args.push('--append-system-prompt', agentsMd);
  }
  if (opts.imageGenEnabled) {
    const ext = resolveImageGenExtension();
    if (ext) args.push('-e', ext);
  }
  // 白名单扩展（显式 -e，与 pi-image-gen 并列；-e 可重复）
  for (const extDir of opts.extensions ?? []) {
    args.push('-e', extDir);
  }
  // thinking（节点设置 on/off/遗留档位 → pi CLI；非法值静默忽略 = pi 默认）
  args.push(...resolveThinkingArgs(opts.thinkingLevel));
  // 工具黑名单（多租户风险收敛；pi 子进程模式无审批门，仅 allowlist/denylist 可控）
  for (const tool of DISABLED_TOOLS) {
    args.push('--exclude-tools', tool);
  }
  const sessionFile = path.join(opts.ws, PI_SESSION_REL);
  mkdirSync(path.dirname(sessionFile), { recursive: true });
  args.push('--session', sessionFile, '--provider', 'bookforge', '--model', `bookforge/${opts.chatModelName}`);

  const agentDirEnv = path.join(opts.ws, '.pi-agent');
  const child = spawn(cmd, args, {
    cwd: opts.ws,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDirEnv,
      PI_AGENT_HOME: agentDirEnv,
      PI_TELEMETRY: '0',
    },
  });
  const childStdin = child.stdin;
  // 子进程 stdio 管道在进程崩溃/提前退出时会被异步销毁并 emit 'error'。stdout 已有
  // markStdoutEnd('error') 兜底，但 stdin/stderr 若无监听，Node 会把该 error 升级为未捕获
  // 异常——直接带崩整个后端 worker（多租户共享进程，影响面是全服）。补空监听防崩；
  // 真实诊断信息仍从 stderrTail（尾部捕获）与退出码给出。
  childStdin?.on('error', () => {});
  const unregister = registerPiProcess(
    opts.userId,
    opts.workspaceId,
    childStdin,
    child.pid ?? 0,
    () => killTree(child)
  );

  let abortRequested = false;
  const onAbort = () => {
    abortRequested = true;
    try {
      childStdin.write(JSON.stringify({ type: 'abort', id: 'abort-current' }) + '\n');
    } catch {
      /* stdin 已关：直接杀树 */
    }
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
  // 防崩：stderr 管道断裂时若无监听会升级为未捕获异常（见 childStdin 注释）
  stderr?.on('error', () => {});

  // 事件队列：stdout 行解析线程安全地入队，生成器按序出队
  const queue: ChatStreamEvent[] = [];
  const mapperState: PiEventMapperState = { lastError: null };
  let emittedError = false;
  let emittedAny = false;
  let stdoutEnded = false;
  let childClosed = false;
  /** prompt 已受理（response 命令 prompt success:true） */
  let promptAccepted = false;
  /** agent_settled（本轮完全落定；RPC 进程常驻，靠它驱动收尾） */
  let settledReceived = false;
  /** 本轮是否曾收到任何事件（零输出诊断） */
  let sawAnyEvent = false;
  /** 本轮超时强制收尾（RPC 进程常驻防死等；abort 后由 killTree 兜底） */
  let runTimedOut = false;
  /** 总超时定时器（try 内臂装；finally 清理）。 */
  let runTimeout: ReturnType<typeof setTimeout> | undefined;
  let rpcExitCode: number | null = null;
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
    if (evt.type === 'response') {
      // RPC 命令响应：只认 prompt 受理状态；其余事件面与本模式无关
      if (evt.command === 'prompt') {
        if (evt.success === true) promptAccepted = true;
        else {
          emittedError = true;
          pushEvent({
            type: 'error',
            message: `pi agent 已拒绝本轮消息${evt.error ? `：${String(evt.error)}` : ''}`,
          });
        }
      }
      wake();
      return;
    }
    if (evt.type === 'agent_settled') {
      settledReceived = true;
      sawAnyEvent = true;
      wake();
      return;
    }
    for (const e of mapPiJsonEvent(evt, mapperState)) {
      sawAnyEvent = true;
      if (e.type === 'error') emittedError = true;
      pushEvent(e);
    }
    wake();
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
    // 1) 发送 prompt 命令（图片走 images 字段；RPC 禁止 @file）
    const promptCmd: Record<string, unknown> = { type: 'prompt', id: 'prompt-1', message: opts.message };
    const imageContents: Array<{ type: string; data: string; mimeType: string }> = [];
    for (const img of images) {
      const idx = typeof img === 'string' ? img.indexOf(',') : -1;
      if (idx < 0 || !img.startsWith('data:image/')) continue;
      const meta = img.slice(0, idx);
      const mime = /^data:image\/([a-z0-9.+-]+)/i.exec(meta)?.[1] ?? 'image/png';
      imageContents.push({ type: 'image', data: img.slice(idx + 1), mimeType: mime.replace('jpeg', 'jpg') });
    }
    if (imageContents.length) promptCmd['images'] = imageContents;
    try {
      childStdin.write(JSON.stringify(promptCmd) + '\n');
    } catch {
      // 子进程已退出/管道已断（如扩展装配失败启动即崩）：写回失败即本轮无法进行，
      // 记 emitError 走终局收尾，后续 by 出队循环的 error 终局条件立即 cleanup。
      emittedError = true;
      pushEvent({ type: 'error', message: 'pi agent 子进程已退出，无法受理本轮消息' });
    }

    // 总超时兜底（RPC 进程常驻防死等）：RPC_AGENT_TIMEOUT_MS，默认 10 分钟
    runTimeout = setTimeout(() => {
      runTimedOut = true;
      wake();
    }, RPC_AGENT_TIMEOUT_MS);
    runTimeout.unref?.();

    // 2) 出队循环：队列空且（agent_settled 已到 或 子进程已退出）时结束
    //    RPC 进程常驻——等待 agent_settled 信号后收尾。
    //    注意：不用 stdin.end() 让 pi 优雅退出——Windows 下 pi 的 shutdown 与
    //    扩展（pi-image-gen 等）的 async handle 存在 libuv 竞态（0xC0000409
    //    async.c Assertion），直接 killTree 更稳；agent_settled 即会话文件已
    //    落盘的权威信号（消息/工具结果/usage 均在起前写完）。
    let finalized = false;
    // 触发 kill 收尾的信号：agent_settled（本轮完全落定）｜超时｜已产出 error（prompt 被拒 /
    // 重试耗尽——继续等无意义）。RPC 进程常驻，靠这些信号主动收尾；abort 由 onAbort 的
    // killTree 兜底。收尾后等子进程真正退出（child close + stdout end）再 break：Windows 下
    // taskkill /F 后文件句柄释放有时延，过早返回会撞上删除/差分对工作区的并发访问。
    const isFinal = (): boolean => settledReceived || runTimedOut || emittedError;
    while (true) {
      if (queue.length) {
        emittedAny = true;
        yield queue.shift()!;
        continue;
      }
      if (isFinal() && !finalized) {
        finalized = true;
        // 直接用 killTree：绕开 pi 的 shutdown/exit 路径（Windows libuv async 竞态崩点）；
        // agent_settled 已给出会话落盘完成语义，kill 不丢数据。
        killTree(child);
      }
      if (childClosed && stdoutEnded) break;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }

    if (!emittedError) {
      if (abortRequested) {
        yield { type: 'status', message: '已中断' };
      } else if (runTimedOut) {
        emittedError = true;
        yield { type: 'error', message: 'pi agent 对话超时已强制结束，请重试' };
      } else {
        rpcExitCode = await exitCode;
        const lastError = mapperState.lastError;
        // settled 已收到（会话落盘完成）后，无论 pi 退出码如何都视为正常；
        // Windows 下强制 kill 会留非 0 退出码/断言崩溃码，不应误报。
        if ((!settledReceived && (rpcExitCode !== 0 || lastError))) {
          emittedError = true;
          if (lastError) {
            yield { type: 'error', message: formatPiFailure(lastError) };
          } else {
            const tail = stderrTailRef.value.trim();
            yield {
              type: 'error',
              message: `pi agent 执行失败（退出码 ${rpcExitCode}）${tail ? `\n${tail.split('\n').at(-1)}` : ''}`,
            };
          }
        } else if (!promptAccepted && !sawAnyEvent) {
          // 进程正常退出但 prompt 未被受理且无任何事件：多半是扩展加载异常 / 参数错
          const tail = stderrTailRef.value.trim();
          yield {
            type: 'error',
            message: `pi agent 未受理本轮消息（可能扩展装配异常）${
              tail ? `\n${tail.split('\n').at(-1)}` : ''
            }`,
          };
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
      emittedAny = true;
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

    // 零输出兜底诊断：pi 以 0 退出、无错误事件，但全程未产出任何事件（连会话文件都没落盘）。
    if (!emittedError && !abortRequested && !emittedAny) {
      const tail = stderrTailRef.value.trim();
      yield {
        type: 'error',
        message: `pi agent 执行结束但未产生任何输出，请检查扩展装配与模型配置${
          tail ? `\n${tail.split('\n').at(-1)}` : ''
        }`,
      };
    }
  } finally {
    clearTimeout(runTimeout);
    unregister();
    opts.signal?.removeEventListener('abort', onAbort);
    try {
      childStdin.end();
    } catch {
      /* stdin 已关：忽略 */
    }
    killTree(child);
  }
}
