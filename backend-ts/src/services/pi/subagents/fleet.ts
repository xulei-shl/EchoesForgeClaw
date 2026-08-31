/**
 * subagent fleet 面板：把投影后的 runs 树渲染为纯文本行 + 组装 WidgetDraft。
 *
 * 服务端无 TUI，只产出纯文本行（非 ANSI）；行数/长度由 withWidgetBridge 的
 * applyWidgetCap 统一兜底。state 图标映射对未知状态降级，不因扩展枚举演进报错。
 */
import type { SubagentFleetRun } from '../../../modules/bookplate/stream.js';
import type { WidgetDraft } from '../../pi-widgets.js';

/** fleet 面板 widget key / label（与扩展自身 widget 无冲突；扩展 RPC 下不产出本 key）。 */
export const SUBAGENT_FLEET_WIDGET_KEY = 'subagent-fleet';
export const SUBAGENT_FLEET_WIDGET_LABEL = '子代理队列';

/** 运行状态 → 文本图标（未知状态降级 ·）。 */
const STATE_ICONS: Record<string, string> = {
  running: '◐',
  queued: '○',
  pending: '○',
  complete: '✓',
  completed: '✓',
  done: '✓',
  failed: '✗',
  rejected: '✗',
  paused: '■',
  stopped: '■',
  cancelled: '■',
  error: '✗',
};

export function subagentFleetStateIcon(state: string): string {
  return STATE_ICONS[state] ?? '·';
}

/** 把 fleet runs 树渲染为纯文本行（缩进表示层级；每行「图标 label · 状态/活动」）。 */
export function renderSubagentFleetLines(runs: SubagentFleetRun[]): string[] {
  const lines: string[] = [];
  for (const run of runs) appendNode(lines, run, 0);
  return lines;
}

function appendNode(lines: string[], run: SubagentFleetRun, depth: number): void {
  const icon = subagentFleetStateIcon(run.state);
  const indent = '  '.repeat(depth);
  const activity = run.activity?.currentTool ? ` · ${run.activity.currentTool}` : '';
  lines.push(`${indent}${icon} ${run.label} · ${run.state}${activity}`);
  for (const child of run.children ?? []) appendNode(lines, child, depth + 1);
}

/**
 * runs 树 → fleet 面板 draft；无任何活跃/可见运行（runs 为空）→ null（调用方清面板）。
 * data 携带安全投影的 runs 树，随服务端快照持久化，供水合/前端可选消费。
 */
export function subagentFleetDraft(runs: SubagentFleetRun[]): WidgetDraft | null {
  const lines = renderSubagentFleetLines(runs);
  if (lines.length === 0) return null;
  return {
    key: SUBAGENT_FLEET_WIDGET_KEY,
    label: SUBAGENT_FLEET_WIDGET_LABEL,
    lines,
    placement: 'belowEditor',
    data: { runs },
  };
}
