import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  REAL_AGENTS_ROOT,
  REAL_SKILLS_ROOT,
  userSkillsRoot,
  nodeWorkspace,
  symlinkOrCopy,
} from '../skill-agent-service.js';
import {
  COMPACTION_KEEP_RECENT_TOKENS,
  COMPACTION_RESERVE_TOKENS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_RETRIES,
} from './config.js';
import {
  buildGuardrailsConfig,
  GUARDRAILS_CONFIG_REL,
  GUARDRAILS_PACKAGE_NAME,
  type GuardrailsConfigOverrides,
} from './guardrails.js';
import { resolvePiExtensions, extensionDirName } from './resolve.js';
import { killPiProcess } from './registry.js';
import { cleanupSubagentAsyncRuns } from './subagents/cleanup.js';
import { removePathSafe } from '../file-utils.js';

/**
 * pi 运行时工作区装配（幂等）。
 *
 * - AGENTS.md：真实提示词文件存在 → 软链到工作区根（否则清理残留链接）；
 * - .pi-agent/skills/{name}：登记为软链（Bifrost 共享包）→ 软链共享区；真实目录（上传）→ 复制。
 *   目标目录必须是 .pi-agent/skills/：这是 pi 的 user-scope 技能目录（agentDir=PI_CODING_AGENT_DIR），
 *   无条件扫描；.agents/skills 属 project scope，需 project trust，headless json 模式下不会加载；
 * - .pi-agent/extensions/{name}：白名单扩展包装配（symlinkOrCopy）；
 * - .pi-agent/extensions/guardrails.json：pi-guardrails 安全护栏自动配置（文件保护策略 /
 *   危险命令确认 / 越界路径 block；onboarding 标记完成，完全自动执行，无需手动引导）；
 * - .pi-agent/models.json：对话模型物化（provider=bookforge）；
 * - .pi-agent/settings.json：pi-image-gen 段物化 + 运行时调优（自动压缩 / 自动重试）固化；
 * - .pi-agent/web-search.json：pi-web-access 扩展配置物化（DB 映射的 web search API Key +
 *   固定 workflow=auto-summary，headless 下不开 curator/浏览器）。
 */

/** pi-image-gen 扩展在 models.json 之外的 settings 键名（其自身约定）。 */
const IMAGE_GEN_SETTINGS_KEY = 'pi-image-gen';
/** 绘图产物目录（相对工作区根；默认隐藏目录不利于差分上报与下载卡片）。 */
const IMAGE_OUTPUT_DIR = 'outputs';

/**
 * pi-web-access 扩展 web-search.json 的 DB 映射：app_settings 键 → 扩展配置键。
 * 仅收录「后端有凭据且扩展支持」的 web search 源；扩展无 zhihu / doubao provider，
 * 故 `zhihu.access_secret` / `doubao.api_key` 不映射（写入扩展也不会读取）。
 */
export const PI_WEB_SEARCH_SETTINGS_MAP: Record<string, string> = {
  'tavily.api_key': 'tavilyApiKey',
  'exa.api_key': 'exaApiKey',
  'anysearch.api_key': 'anysearchApiKey',
};

/** web-search.json 中由后端固定管理的键（映射键 + workflow）；装配时先删再按权威值写入。 */
const PI_WEB_SEARCH_MANAGED_KEYS = new Set<string>([
  ...Object.values(PI_WEB_SEARCH_SETTINGS_MAP),
  'workflow',
]);

/**
 * headless 后端固定工作流：summary-review（默认）会启动本地 curator 服务并尝试拉浏览器，
 * 在无头服务器上每次 web_search 阻塞至 curatorTimeoutSeconds（默认 20s）。固定
 * auto-summary：保留合成摘要但不启动 curator/浏览器。模型仍可经工具参数按次覆盖。
 */
const PI_WEB_SEARCH_WORKFLOW = 'auto-summary';

/**
 * 由 app_settings 键值对映射出 pi-web-access 扩展配置（仅非空、受支持字段；trim 后写入）。
 * 不含固定项（workflow）——该固定项由装配期注入。
 */
export function buildWebSearchConfig(settings: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [dbKey, extKey] of Object.entries(PI_WEB_SEARCH_SETTINGS_MAP)) {
    const value = (settings[dbKey] ?? '').trim();
    if (value) out[extKey] = value;
  }
  return out;
}

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
  /** pi-web-access 扩展配置（buildWebSearchConfig 产物；含 API Key，来自 app_settings 映射，仅受支持字段）。 */
  webSearchConfig?: Record<string, string>;
  /**
   * pi-guardrails 安全护栏管理员覆盖项（来自 app_settings 的 `pi.guardrails.*`，
   * guardrailsOverridesFromSettings 解析；缺省 = 内置安全默认）。装配期写入 guardrails.json。
   */
  guardrailsOverrides?: GuardrailsConfigOverrides;
}

export interface PreparedWorkspaceInfo {
  ws: string;
  /** 该 Skill Agent 配置引用的提示词是否已物化（决定 pi 是否注入 AGENTS.md）。 */
  hasPrompt: boolean;
  mountedSkills: string[];
  skippedSkills: string[];
  /** 装配期可诊断问题（如绘图模型 API Key 缺失/退化），调用方应以 status 事件透传给用户。 */
  warnings: string[];
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
 * 绘图模型配置的可诊断性检查：返回「配置有问题、不应装配 pi-image-gen 段」的原因文案，
 * 无问题时返回 null。退化配置（缺模型名 / 缺 Key / Key 是模型名本身）写入 settings 只会
 * 让每次生成都 401「API key 问题」——这里在装配期就拦截并给出可操作提示。
 */
function imageModelConfigProblem(image: PiImageModelConfig | null): string | null {
  if (!image) return null;
  const model = (image.modelName ?? '').trim();
  const key = (image.apiKey ?? '').trim();
  if (!model) {
    return '绘图模型未配置模型名称（model_name），已跳过绘图工具加载，请到「模型配置」编辑对应的图像模型填写模型名。';
  }
  if (!key) {
    return `绘图模型 ${model} 未配置 API Key，已跳过绘图工具加载，请到「模型配置」编辑该图像模型填写 API Key。`;
  }
  if (key.toLowerCase() === model.toLowerCase()) {
    return `绘图模型 ${model} 的 API Key 与模型名相同——疑似把模型名填进了 API Key 字段，已跳过绘图工具加载；请到「模型配置」编辑该图像模型，填入真实 API Key，否则每次生成都会因鉴权失败（HTTP 401）。`;
  }
  return null;
}

/**
 * 装配 pi 运行时工作区（幂等）。见文件头部注释的装配清单。
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

  // 2) skills 条件装配（仅显式选中项；目录口径见文件头部注释——必须 .pi-agent/skills）
  const mountedSkills: string[] = [];
  const skippedSkills: string[] = [];
  const warnings: string[] = [];
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

  // 3.6) pi-guardrails 自动配置（{agentDir}/extensions/guardrails.json）
  // guardrails 的「全局」配置读自 {PI_CODING_AGENT_DIR}/extensions/guardrails.json
  // （ConfigLoader globalPath），而 runner 把 PI_CODING_AGENT_DIR 指向 {ws}/.pi-agent——
  // 此处写入即自动生效（完全自动：onboarding.completed=true，无需手动引导；pathAccess
  // 固定 block，零交互）。仅当白名单命中且已安装时装配；未装配清理残留文件防误导。
  const guardrailsConfigPath = path.join(agentDir, GUARDRAILS_CONFIG_REL);
  const guardrailsSpec = extSpecs.find((s) => s.name === GUARDRAILS_PACKAGE_NAME);
  if (guardrailsSpec) {
    let version = '';
    try {
      const pkg = JSON.parse(
        readFileSync(path.join(guardrailsSpec.dir, 'package.json'), 'utf-8')
      ) as { version?: unknown };
      version = typeof pkg.version === 'string' ? pkg.version : '';
    } catch {
      /* package.json 不可读：视为未装配 */
    }
    if (version) {
      writeFileSync(
        guardrailsConfigPath,
        JSON.stringify(buildGuardrailsConfig(version, opts.guardrailsOverrides), null, 2),
        'utf-8'
      );
    } else {
      removePathSafe(guardrailsConfigPath);
    }
  } else {
    removePathSafe(guardrailsConfigPath);
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
  // 同时显式关闭长缓存保留：pi 核心在 cacheRetention=long 且 compat.supportsLongCacheRetention
  // （第三方 openai-completions 默认 true）时会自行注入 prompt_cache_key / prompt_cache_retention，
  // 而 pi-cache-optimizer 扩展加载即强制 PI_CACHE_RETENTION=long —— 未知端点可能 400。显式 false
  // 从源头关闭，零风险；官方 OpenAI baseUrl 分支独立不受影响。见 docs/skill-agent/pi-cache-optimizer-plan.md §4.2。
  if (opts.chatModel.apiFormat !== 'anthropic') {
    chatModelEntry.compat = {
      ...(opts.chatModel.thinkingFormat ? { thinkingFormat: opts.chatModel.thinkingFormat } : {}),
      supportsLongCacheRetention: false,
    };
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
  // 绘图模型装配前做可诊断性守卫：退化配置（缺模型名 / 缺 Key / Key 是模型名的复制品）
  // 写入 pi-image-gen 段只会让模型每次调用都 401「API key 问题」，这里直接拒绝装配该段，
  // 并把可操作的原因交给调用方以 status 事件透传，避免把运行时谜题丢给用户。
  const imageProblem = imageModelConfigProblem(opts.imageModel);
  if (imageProblem) {
    delete settings[IMAGE_GEN_SETTINGS_KEY];
    warnings.push(imageProblem);
  } else if (opts.imageModel) {
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

  // pi-web-access 扩展配置（web-search.json）：扩展从 {PI_CODING_AGENT_DIR}/web-search.json 热读，
  // 而 runner 把 PI_CODING_AGENT_DIR 指向 {ws}/.pi-agent——此处写入即自动生效，与 models.json/
  // settings.json 同款装配。复用 settings.json 的「读旧 → 删受管键 → 合并当前值」模式：
  // 保留 curator/扩展运行时（如 /curator）写入的其它键，同时确保受管键（API key + workflow）
  // 始终为后端权威值（扩展按次 loadConfig，API key 变动无需重拉 RPC 进程）。
  const webSearchPath = path.join(agentDir, 'web-search.json');
  let webSearch: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(webSearchPath, 'utf-8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) webSearch = parsed;
  } catch {
    /* 无文件或非法 JSON：重建 */
  }
  for (const key of PI_WEB_SEARCH_MANAGED_KEYS) delete webSearch[key];
  Object.assign(webSearch, opts.webSearchConfig ?? {});
  webSearch['workflow'] = PI_WEB_SEARCH_WORKFLOW;
  writeFileSync(webSearchPath, JSON.stringify(webSearch, null, 2), 'utf-8');

  return {
    ws,
    hasPrompt: existsSync(realAgentsMd),
    mountedSkills,
    skippedSkills,
    warnings,
    mountedExtensions,
  };
}

/**
 * 清空 Skill Agent 节点会话（「清空对话」语义）：删除全部会话历史，下次对话从零开始；
 * 保留 skills/models/settings 等装配物与 outputs/inputs 产物。
 * 覆盖三处：当前会话（.pi-agent/run/）、历史版本落在 agentDir 根的 chat.jsonl、
 * pi 自管/启动迁移产生的 .pi-agent/sessions/。幂等；无任何会话残留时返回 false。
 */
export async function clearPiSession(userId: number, workspaceId: string): Promise<boolean> {
  const ws = nodeWorkspace(userId, workspaceId);
  const agentDir = path.join(ws, '.pi-agent');
  let cleared = false;
  // 清空对话 = 作废本轮交互：先终止活跃 RPC 子进程（问卷等待中 / 流式中），
  // 并等其真正退出（Windows taskkill 异步），避免后续删除会话目录撞文件锁
  if (await killPiProcess(userId, workspaceId)) cleared = true;
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
  // pi-subagents 后台（分离）子代理残留：父 RPC 进程已杀，这里按 temp 根终止残留 runner
  // 并删除该工作区专属产物（归属按 userId:workspaceId 收敛，见 subagents/cleanup.ts）
  try {
    cleanupSubagentAsyncRuns(userId, workspaceId);
  } catch {
    /* 清理失败不阻塞清会话主流程 */
  }
  return cleared;
}