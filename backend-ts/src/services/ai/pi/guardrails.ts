import path from 'node:path';

/**
 * pi-guardrails（@aliou/pi-guardrails）自动装配配置。
 *
 * 机制：guardrails 的 ConfigLoader（@aliou/pi-utils-settings）把「全局」配置读自
 * `{agentDir}/extensions/guardrails.json`，其中 agentDir = getAgentDir() =
 * `PI_CODING_AGENT_DIR` 环境变量优先。runner 把 `PI_CODING_AGENT_DIR` 指向
 * `{ws}/.pi-agent`（见 runner.ts），因此 preparePiWorkspace 在此写入
 * `{ws}/.pi-agent/extensions/guardrails.json` 即自动生效——无需用户手动跑
 * `/guardrails:onboarding`（`onboarding.completed: true` 已标记，扩展不再注册
 * 引导命令），也无需任何人工配置。
 *
 * 设计取向（headless 多租户服务端，完全自动执行）：
 * - policies（文件保护）：开启。内置规则保护 .env/私钥等，另加 agent-runtime
 *   规则禁止工具访问 `.pi-agent/**`（models.json / web-search.json 等装配了真实
 *   API Key，Agent 不应通过 read/bash 等工具读到）。
 * - permissionGate（危险命令）：开启 + requireConfirmation=true（内置默认）。
 *   RPC 模式下 `ctx.ui.custom()` 返回 undefined，permission-gate 自带
 *   `ctx.ui.select(...)` 回退（Allow once / session / Deny / Stop），走后端
 *   既有 extension_ui_request → dialog 桥（无需前端改动）。
 * - pathAccess（越界路径）：开启 + mode=block。RPC 下 custom() 不可用，ask 模式
 *   会退化为「一律拒绝」且语义含糊；block 模式确定性更强（完全自动、零交互），
 *   越界访问仅由后端装配物/白名单放行（工作区内访问恒放行；pi 文档路径与
 *   skill 文件路径由扩展自动豁免）。
 *
 * 版本锁定：config.version 在装配期从已安装包 package.json 读取（升级 =
 * 固定 npm 版本 + 回归，见 docs/skill-agent/pi-extension-integration.md）。
 */

/** 白名单包名（resolvePiExtensions 按此解析安装目录；装配时仅当命中才写配置）。 */
export const GUARDRAILS_PACKAGE_NAME = '@aliou/pi-guardrails';

/** guardrails 全局配置落点（相对 {ws}/.pi-agent，即 PI_CODING_AGENT_DIR）。 */
export const GUARDRAILS_CONFIG_REL = path.join('extensions', 'guardrails.json');

/** 默认 pathAccess 策略：完全自动执行（无交互），越界一律拒绝。管理员可在 admin/settings 的 Pi Agent 分类覆盖。 */
export const GUARDRAILS_PATH_ACCESS_MODE = 'block' as const;

/** pathAccess 越界允许路径条目（对应扩展 AllowedPath：file 精确匹配 / directory 目录及其后代）。 */
export interface GuardrailsAllowedPath {
  kind: 'file' | 'directory';
  path: string;
}

/**
 * admin/settings 的 Pi Agent 分类下、guardrails 配置键的固定前缀。
 * 后端 preparePiWorkspace 装配期从 app_settings（pi.guardrails.*）读取这些键，
 * 映射为 guardrails.json 的配置——管理员可维护、普通 web 用户直接加载。
 */
export const GUARDRAILS_SETTING_PREFIX = 'pi.guardrails.';

/** guardrails 可选配置键（值均为字符串：布尔用 'true'/'false'，mode 用 block/ask/allow，allowedPaths 用 JSON 数组）。 */
export const GUARDRAILS_SETTING_KEYS = {
  enabled: `${GUARDRAILS_SETTING_PREFIX}enabled`,
  featuresPolicies: `${GUARDRAILS_SETTING_PREFIX}features.policies`,
  featuresPermissionGate: `${GUARDRAILS_SETTING_PREFIX}features.permission_gate`,
  featuresPathAccess: `${GUARDRAILS_SETTING_PREFIX}features.path_access`,
  pathAccessMode: `${GUARDRAILS_SETTING_PREFIX}path_access.mode`,
  pathAccessAllowedPaths: `${GUARDRAILS_SETTING_PREFIX}path_access.allowed_paths`,
} as const;

/**
 * 管理员可覆盖的 guardrails 配置（缺省 = 跟随内置安全默认；字段与 schema.json / GuardrailsAutoConfig 对齐）。
 */
export interface GuardrailsConfigOverrides {
  enabled?: boolean;
  features?: { policies?: boolean; permissionGate?: boolean; pathAccess?: boolean };
  pathAccessMode?: 'block' | 'ask' | 'allow';
  allowedPaths?: GuardrailsAllowedPath[];
}

/**
 * 从 app_settings（admin/settings Pi Agent 分类）解析 guardrails 覆盖项。
 * 未配置 / 非法值一律忽略（undefined），保持内置默认，绝不让脏数据弱化安全。
 */
export function guardrailsOverridesFromSettings(settings: Record<string, string>): GuardrailsConfigOverrides {
  const bool = (v: string | undefined): boolean | undefined =>
    v === 'true' ? true : v === 'false' ? false : undefined;

  const overrides: GuardrailsConfigOverrides = {};
  const enabled = bool(settings[GUARDRAILS_SETTING_KEYS.enabled]);
  if (enabled !== undefined) overrides.enabled = enabled;

  const policies = bool(settings[GUARDRAILS_SETTING_KEYS.featuresPolicies]);
  const permissionGate = bool(settings[GUARDRAILS_SETTING_KEYS.featuresPermissionGate]);
  const pathAccess = bool(settings[GUARDRAILS_SETTING_KEYS.featuresPathAccess]);
  if (policies !== undefined || permissionGate !== undefined || pathAccess !== undefined) {
    overrides.features = {};
    if (policies !== undefined) overrides.features.policies = policies;
    if (permissionGate !== undefined) overrides.features.permissionGate = permissionGate;
    if (pathAccess !== undefined) overrides.features.pathAccess = pathAccess;
  }

  const mode = (settings[GUARDRAILS_SETTING_KEYS.pathAccessMode] ?? '').trim();
  if (mode === 'block' || mode === 'ask' || mode === 'allow') overrides.pathAccessMode = mode;

  const raw = (settings[GUARDRAILS_SETTING_KEYS.pathAccessAllowedPaths] ?? '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const paths = parsed
          .filter(
            (p): p is { kind: unknown; path: unknown } =>
              typeof p === 'object' && p !== null && 'kind' in p && 'path' in p
          )
          .map((p) => ({ kind: p.kind as GuardrailsAllowedPath['kind'], path: String(p.path) }))
          .filter(
            (p): p is GuardrailsAllowedPath =>
              (p.kind === 'file' || p.kind === 'directory') && p.path.length > 0
          );
        if (paths.length) overrides.allowedPaths = paths;
      }
    } catch {
      /* 非法 JSON：忽略，保持默认 */
    }
  }
  return overrides;
}

/**
 * 装配期写入的 guardrails 配置（与扩展 schema.json 对齐；字段白名单见
 * GuardrailsAutoConfig：除已用字段外一律不写，未覆盖项跟随扩展内置默认值）。
 */
export interface GuardrailsAutoConfig {
  $schema: string;
  version: string;
  enabled: boolean;
  applyBuiltinDefaults: true;
  onboarding: { completed: true; version: string };
  features: { policies: boolean; permissionGate: boolean; pathAccess: boolean };
  pathAccess: { mode: 'block' | 'ask' | 'allow'; allowedPaths: GuardrailsAllowedPath[] };
  policies: { rules: GuardrailsAgentRuntimeRule[] };
}

/**
 * agent-runtime 规则：保护 .pi-agent/（含 models.json/web-search.json 等真实密钥装配物）。
 *
 * 黑名单粒度（fail-closed + 显式豁免）：.pi-agent/** 默认全封，但技能/提示词是
 * pi 渐进式披露机制要求「模型经 read tool 按需读取」的可读资源（索引已注入系统提示词，
 * 正文由 read 读取）——若被 noAccess 封死，装配到 .pi-agent/skills 的技能形同虚设。
 * 故经 allowedPatterns 显式放行 skills/prompts 两棵资源树；models.json / web-search.json /
 * settings.json / auth.json / extensions / sessions / run 等运行态与密钥装配物保持封禁。
 * 后续新增敏感文件默认仍受保护，无需修改本规则。
 */
export interface GuardrailsAgentRuntimeRule {
  id: 'agent-runtime';
  description: string;
  patterns: [{ pattern: '.pi-agent' }, { pattern: '.pi-agent/**' }];
  allowedPatterns: { pattern: string }[];
  protection: 'noAccess';
  onlyIfExists: true;
  blockMessage: string;
}

/** 可读资源树（带裸目录模式：`/**` 在 Node matchesGlob 下不匹配无尾斜杠的目录本身）。 */
const AGENT_RUNTIME_ALLOWED_PATTERNS = [
  { pattern: '.pi-agent/skills' },
  { pattern: '.pi-agent/skills/**' },
  { pattern: '.pi-agent/prompts' },
  { pattern: '.pi-agent/prompts/**' },
] as const;

/** 装配期注入的策略规则（按 id 与扩展内置/用户规则去重合并，见 loader afterMerge）。 */
export function guardrailsPolicyRules(): GuardrailsAgentRuntimeRule[] {
  return [
    {
      id: 'agent-runtime',
      description:
        'Agent runtime configuration (backend-materialized API keys under .pi-agent/)',
      patterns: [
        { pattern: '.pi-agent' },
        { pattern: '.pi-agent/**' },
      ],
      allowedPatterns: [...AGENT_RUNTIME_ALLOWED_PATTERNS],
      protection: 'noAccess',
      onlyIfExists: true,
      blockMessage:
        'Accessing {file} is not allowed. This file is part of the agent runtime ' +
        'configuration and may contain API keys. If changes are needed, ask the user.',
    },
  ];
}

/**
 * 默认 pathAccess 越界允许路径：既有 `/dev/null` 占位条目（保持向后兼容，不额外放行真实路径）。
 */
const GUARDRAILS_DEFAULT_ALLOWED_PATHS: GuardrailsAllowedPath[] = [
  { kind: 'file', path: '/dev/null' },
];

/**
 * 构建自动装配的 guardrails 全局配置。version 应为已安装包版本（如 '0.17.1'），
 * 高于所有内置迁移版本（≤0.16.2），写入后扩展加载不会触发迁移改写。
 * overrides 来自 admin/settings 的 Pi Agent 分类（guardrailsOverridesFromSettings），
 * 缺省 = 内置安全默认：全功能开启 / pathAccess 仅放行占位路径。
 */
export function buildGuardrailsConfig(
  version: string,
  overrides: GuardrailsConfigOverrides = {}
): GuardrailsAutoConfig {
  return {
    $schema: `https://unpkg.com/${GUARDRAILS_PACKAGE_NAME}@${version}/schema.json`,
    version,
    enabled: overrides.enabled ?? true,
    applyBuiltinDefaults: true,
    onboarding: { completed: true, version },
    features: {
      policies: overrides.features?.policies ?? true,
      permissionGate: overrides.features?.permissionGate ?? true,
      pathAccess: overrides.features?.pathAccess ?? true,
    },
    pathAccess: {
      mode: overrides.pathAccessMode ?? GUARDRAILS_PATH_ACCESS_MODE,
      allowedPaths: overrides.allowedPaths?.length
        ? overrides.allowedPaths
        : GUARDRAILS_DEFAULT_ALLOWED_PATHS,
    },
    policies: { rules: guardrailsPolicyRules() },
  };
}