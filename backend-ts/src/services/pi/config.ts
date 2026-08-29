import path from 'node:path';

/**
 * pi Skill Agent 运行时配置（零耦合纯常量/纯函数）。
 *
 * 集中管理：
 * - 环境变量驱动的调优默认值（自动压缩 / 自动重试 / 工具黑名单 / RPC 超时）
 * - thinking 档位映射（resolveThinkingArgs）
 * - 会话文件落点等路径常量
 */

// ---------------------------------------------------------------------------
// 运行时调优默认值（env 可覆盖；写入 .pi-agent/settings.json 固化，防上游默认漂移）
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/** 压缩触发预留 token（阈值 = 模型上下文窗 − 该值；pi 默认 16384）。 */
export const COMPACTION_RESERVE_TOKENS = envInt('PI_COMPACTION_RESERVE_TOKENS', 16384);
/** 压缩切割时保留的近期原文 token 量（pi 默认 20000）。 */
export const COMPACTION_KEEP_RECENT_TOKENS = envInt('PI_COMPACTION_KEEP_RECENT_TOKENS', 20000);
/** 上游请求失败自动重试次数（pi 默认 3；云端限流场景适当放宽）。 */
export const RETRY_MAX_RETRIES = envInt('PI_RETRY_MAX_RETRIES', 5);
/** 重试退避基值 ms（pi 默认 2000，指数退避）。 */
export const RETRY_BASE_DELAY_MS = envInt('PI_RETRY_BASE_DELAY_MS', 2000);
/**
 * 工具黑名单（逗号分隔工具名，如 "bash,write"）→ 运行参数 -xt 注入。
 * pi 子进程模式没有审批门，多租户风险收敛只能靠 allowlist/denylist。
 */
export const DISABLED_TOOLS = (process.env.PI_DISABLED_TOOLS ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);

/** RPC 模式对话总超时（毫秒，默认 10 分钟）：agent_settled 始终未达时的防死等兜底。 */
export const RPC_AGENT_TIMEOUT_MS = envInt('PI_RPC_TIMEOUT_MS', 10 * 60 * 1000);

// ---------------------------------------------------------------------------
// thinking 档位映射
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 路径常量
// ---------------------------------------------------------------------------

/**
 * pi 会话文件落点（相对工作区根）。必须放在 .pi-agent 根目录之下的子目录：
 * pi 每次启动都会把 {agentDir} 根下散落的 *.jsonl 迁移进 sessions/{cwd编码}/
 * （migrateSessionsFromAgentRoot），放根下会导致下一轮运行开始时历史被移走、
 * 上下文静默重置一次。子目录不在迁移扫描范围内，且 .pi-agent/ 整体被产物差分排除。
 */
export const PI_SESSION_REL = path.join('.pi-agent', 'run', 'chat.jsonl');