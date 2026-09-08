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

/** 装配期固定 pathAccess 策略：完全自动执行（无交互），越界一律拒绝。 */
export const GUARDRAILS_PATH_ACCESS_MODE = 'block' as const;

/**
 * 装配期写入的 guardrails 配置（与扩展 schema.json 对齐；字段白名单见
 * GuardrailsConfig：除已用字段外一律不写，未覆盖项跟随扩展内置默认值）。
 */
export interface GuardrailsAutoConfig {
  $schema: string;
  version: string;
  enabled: true;
  applyBuiltinDefaults: true;
  onboarding: { completed: true; version: string };
  features: { policies: true; permissionGate: true; pathAccess: true };
  pathAccess: { mode: typeof GUARDRAILS_PATH_ACCESS_MODE; allowedPaths: [{ kind: 'file'; path: '/dev/null' }] };
  policies: { rules: GuardrailsAgentRuntimeRule[] };
}

/** agent-runtime 规则：保护 .pi-agent/（含 models.json/web-search.json 等真实密钥装配物）。 */
export interface GuardrailsAgentRuntimeRule {
  id: 'agent-runtime';
  description: string;
  patterns: [{ pattern: '.pi-agent' }, { pattern: '.pi-agent/**' }];
  protection: 'noAccess';
  onlyIfExists: true;
  blockMessage: string;
}

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
      protection: 'noAccess',
      onlyIfExists: true,
      blockMessage:
        'Accessing {file} is not allowed. This file is part of the agent runtime ' +
        'configuration and may contain API keys. If changes are needed, ask the user.',
    },
  ];
}

/**
 * 构建自动装配的 guardrails 全局配置。version 应为已安装包版本（如 '0.17.1'），
 * 高于所有内置迁移版本（≤0.16.2），写入后扩展加载不会触发迁移改写。
 */
export function buildGuardrailsConfig(version: string): GuardrailsAutoConfig {
  return {
    $schema: `https://unpkg.com/${GUARDRAILS_PACKAGE_NAME}@${version}/schema.json`,
    version,
    enabled: true,
    applyBuiltinDefaults: true,
    onboarding: { completed: true, version },
    features: { policies: true, permissionGate: true, pathAccess: true },
    pathAccess: {
      mode: GUARDRAILS_PATH_ACCESS_MODE,
      allowedPaths: [{ kind: 'file', path: '/dev/null' }],
    },
    policies: { rules: guardrailsPolicyRules() },
  };
}