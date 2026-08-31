/**
 * pi-subagents 扩展的后端契约常量与原始快照读取类型。
 *
 * 与扩展源码对齐（docs/skill-agent/pi-subagents-main）：
 * - WIDGET_KEY = "subagent-async"（src/shared/types.ts）
 * - setWidget 行前缀 = "PI_SUBAGENT_ASYNC_JSON:"（src/runs/background/async-status-snapshot.ts）
 * - 快照结构 = AsyncStatusSnapshotV1（src/runs/shared/async-status-projection.ts）
 *
 * 只声明本项目消费的字段；扩展版本演进不影响本项目（未知字段一律忽略）。
 */

/** 扩展在 RPC 模式下更新后台运行状态的 widget key。 */
export const SUBAGENT_ASYNC_WIDGET_KEY = 'subagent-async';

/** setWidget 载荷行的 JSON 快照前缀。 */
export const SUBAGENT_ASYNC_SNAPSHOT_PREFIX = 'PI_SUBAGENT_ASYNC_JSON:';

/** 原始快照读取形态（仅声明用到的顶层字段）。 */
export interface RawAsyncStatusSnapshot {
  kind?: unknown;
  version?: unknown;
  runs?: unknown;
}

/** 原始快照节点读取形态（仅声明用到的字段；activity 只读 state/currentTool）。 */
export interface RawAsyncStatusNode {
  id?: unknown;
  kind?: unknown;
  label?: unknown;
  state?: unknown;
  startedAt?: unknown;
  activity?: { state?: unknown; currentTool?: unknown } | null;
  children?: unknown;
}
