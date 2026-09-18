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
 *   规则禁止工具访问 .pi-agent 下的密钥装配物（models.json / settings.json /
 *   web-search.json / auth.json / extensions，含真实 API Key）。
 *   保留理由：pi 内核完全没有文件保护概念（dist/ 内无任何等价机制），且 Agent 手里
 *   就有 read 工具——不拦就等于把明文密钥送进模型上下文。这是三项里最硬的一项。
 *   收窄：整棵 .pi-agent 仍默认全封（fail-closed），仅显式豁免 skills/prompts
 *   与不含密钥的 run/sessions，不做无安全收益的封禁。
 * - permissionGate（危险命令）：开启 + requireConfirmation=true（内置默认）。
 *   RPC 模式下 `ctx.ui.custom()` 返回 undefined，permission-gate 自带
 *   `ctx.ui.select(...)` 回退（Allow once / session / Deny / Stop），走后端
 *   既有 extension_ui_request → dialog 桥（无需前端改动）。
 * - pathAccess（越界路径）：开启 + mode 归一为 block。RPC 下 custom() 不可用，ask
 *   与 block 同为拒绝却多出误导遥测（见 resolvePathAccessMode），故装配期把 ask
 *   归一为 block 并记一条 notice；管理员若确实要放宽，唯一有意义的取值是 allow。
 *   保留理由：这是文件工具层的跨租户隔离（工作区外路径一律拒绝，其它租户工作区落在
 *   此范围内）。越界访问仅由白名单放行；工作区内恒放行，且扩展会另外自动豁免 pi 文档
 *   路径与全部 skill 的 filePath/baseDir（extensions/path-access/index.ts:35 / dynamic-resources.ts）。
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
  /**
   * 越界路径模式。`ask` 仅为兼容既有 app_settings 数据保留：装配期归一为 `block`
   * （headless RPC 下 ctx.ui.custom() 不可用，ask 与 block 同为拒绝，却多一次无用
   * 交互尝试与一条 source:'user' 的误导遥测——见 resolvePathAccessMode）。
   */
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
 * agent-runtime 规则：保护 .pi-agent/（含 models.json/settings.json/web-search.json 等
 * 真实密钥装配物）。
 *
 * 黑名单粒度（fail-closed + 显式豁免）：.pi-agent 整棵默认全封，仅 allowedPatterns
 * 显式放行两类可读资源——① pi 渐进式披露要求「模型经 read tool 按需读取」的
 * skills/prompts（若被 noAccess 封死，装配到 .pi-agent/skills 的技能形同虚设）；
 * ② Agent 自身不含密钥的运行态 run/sessions（封禁无安全收益，只会让 Agent 找上下文时
 * 被反复拒绝而空转，见 docs/skill-agent/pi-guardrails管理员策略控制模型.md §9）。
 * models.json / settings.json / web-search.json / auth.json / extensions 等密钥装配物
 * 保持封禁；后续新增敏感文件默认仍受保护，无需修改本规则。
 *
 * 前缀通配：guardrails 的 bash 路径提取是 best-effort 的——含 shell 展开的 token
 * （如 `cat "$base/.pi-agent/run/chat.jsonl"`）不会被解析成真实路径，而是按字面相对 cwd
 * 解析，得到 `<cwd>/$base/.pi-agent/...` 这类「带垃圾前缀但落在工作区内」的候选。
 * 首段模式（`.pi-agent` 与 `.pi-agent` 子树）匹配不到这种形态（Node matchesGlob 要求
 * 首段就是 `.pi-agent`），故补齐「任意前缀 + .pi-agent」的两条模式；
 * 豁免模式仍优先命中，不受影响。
 *
 * 注：本文件注释内不得出现 `**` 紧跟 `/` 的字面串（会提前闭合块注释）。
 */
export interface GuardrailsAgentRuntimeRule {
  id: 'agent-runtime';
  description: string;
  patterns: { pattern: string }[];
  allowedPatterns: { pattern: string }[];
  protection: 'noAccess';
  onlyIfExists: true;
  blockMessage: string;
}

/** 受保护路径模式（fail-closed；前后两种形态都封，防变量拼接绕过）。 */
const AGENT_RUNTIME_PATTERNS: GuardrailsAgentRuntimeRule['patterns'] = [
  { pattern: '.pi-agent' },
  { pattern: '.pi-agent/**' },
  { pattern: '**/.pi-agent' },
  { pattern: '**/.pi-agent/**' },
];

/**
 * 可读资源树（带裸目录模式：`/**` 在 Node matchesGlob 下不匹配无尾斜杠的目录本身）。
 *
 * 安全性质：这四条/八条都是「字面首段」模式。guardrails 的 normalizeTarget 把工作区内的
 * 目标归一为相对 cwd 路径，工作区外（含其它租户工作区）则保留绝对路径形态
 * （extensions/guardrails/rules.ts:62），故只有本工作区的路径能命中豁免——
 * 其它租户的 .pi-agent 仍被 AGENT_RUNTIME_PATTERNS 的任意前缀形态封禁。
 */
const AGENT_RUNTIME_ALLOWED_PATTERNS: GuardrailsAgentRuntimeRule['allowedPatterns'] = [
  { pattern: '.pi-agent/skills' },
  { pattern: '.pi-agent/skills/**' },
  { pattern: '.pi-agent/prompts' },
  { pattern: '.pi-agent/prompts/**' },
  { pattern: '.pi-agent/run' },
  { pattern: '.pi-agent/run/**' },
  { pattern: '.pi-agent/sessions' },
  { pattern: '.pi-agent/sessions/**' },
];

/** 装配期注入的策略规则（按 id 与扩展内置/用户规则去重合并，见 loader afterMerge）。 */
export function guardrailsPolicyRules(): GuardrailsAgentRuntimeRule[] {
  return [
    {
      id: 'agent-runtime',
      description:
        'Agent runtime configuration (backend-materialized API keys under .pi-agent/)',
      patterns: AGENT_RUNTIME_PATTERNS.map((p) => ({ ...p })),
      allowedPatterns: AGENT_RUNTIME_ALLOWED_PATTERNS.map((p) => ({ ...p })),
      protection: 'noAccess',
      onlyIfExists: true,
      blockMessage:
        'Accessing {file} is not allowed. This file holds agent runtime credentials ' +
        '(API keys), so it stays unreadable. Continue without it and do not ask the ' +
        'user for its contents.',
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
 * 归一化 pathAccess 模式：`ask` 在本部署恒等于拒绝，故直接落 `block`。
 *
 * 证据（guardrails 0.17.1）：mode 非 'allow' 时工作区内恒放行（src/core/paths/access.ts:42）；
 * 工作区外若无 UI 立即拒绝（access.ts:53-58）；即便有 UI，RPC 下 ctx.ui.custom() 返回
 * undefined，最终仍落到「User denied access outside working directory」并以
 * source:'user' 上报（extensions/path-access/index.ts:96-160）——语义与 block 完全相同，
 * 却多出一次无用的交互尝试和一条误导性遥测（看起来像用户拒绝，实为无人可问）。
 * 管理员若要放宽，唯一有意义的取值是 allow。
 */
function resolvePathAccessMode(
  mode: GuardrailsConfigOverrides['pathAccessMode']
): 'block' | 'allow' {
  return mode === 'allow' ? 'allow' : GUARDRAILS_PATH_ACCESS_MODE;
}

/**
 * 装配期应透传给管理员/用户的护栏配置提示（空数组 = 无异常）。
 * 目前只覆盖一种静默归一：管理员设置了 ask，而实际按 block 生效。
 */
export function guardrailsConfigNotices(overrides: GuardrailsConfigOverrides): string[] {
  if (overrides.pathAccessMode !== 'ask') return [];
  return [
    'Pi Agent 越界路径模式配置为 ask，但服务端无交互通道（ask 在本部署与 block 等价，均为拒绝），' +
      '已按 block 生效；如需放宽请在 admin/settings 的 Pi Agent 分类改为 allow。',
  ];
}

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
      mode: resolvePathAccessMode(overrides.pathAccessMode),
      allowedPaths: overrides.allowedPaths?.length
        ? overrides.allowedPaths
        : GUARDRAILS_DEFAULT_ALLOWED_PATHS,
    },
    policies: { rules: guardrailsPolicyRules() },
  };
}