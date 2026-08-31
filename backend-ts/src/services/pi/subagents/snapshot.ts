/**
 * pi-subagents setWidget 快照 → 安全投影的 fleet runs（纯函数，可单测）。
 *
 * 输入是扩展在 RPC 模式下经 `setWidget("subagent-async", [...])` 送出的
 * `PI_SUBAGENT_ASYNC_JSON:{AsyncStatusSnapshotV1}` 行；输出只保留展示字段
 * （id/kind/label/state/activity/startedAt/children），不暴露任何内部 run/async/tool id
 * 语义字段之外的原始载荷，并与扩展快照的 caps（runs≤20、children≤8、depth≤3、
 * label≤160）同量级收敛，防损坏/恶意快照打爆内存或 SSE。
 */
import type { SubagentFleetRun } from '../../../modules/bookplate/stream.js';
import {
  SUBAGENT_ASYNC_SNAPSHOT_PREFIX,
  SUBAGENT_ASYNC_WIDGET_KEY,
  type RawAsyncStatusNode,
  type RawAsyncStatusSnapshot,
} from './types.js';

/** 投影上限（与扩展快照 caps 同量级）。 */
const MAX_RUNS = 20;
const MAX_CHILDREN = 8;
const MAX_DEPTH = 3;
const MAX_LABEL_CHARS = 160;

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.slice(0, max);
  return s.length > 0 ? s : undefined;
}

function activityOf(raw: RawAsyncStatusNode): SubagentFleetRun['activity'] {
  if (!isRecord(raw.activity)) return undefined;
  const out: NonNullable<SubagentFleetRun['activity']> = {};
  const state = str(raw.activity.state, 32);
  if (state) out.state = state;
  const tool = str(raw.activity.currentTool, 64);
  if (tool) out.currentTool = tool;
  return Object.keys(out).length > 0 ? out : undefined;
}

function projectNode(raw: unknown, depth: number): SubagentFleetRun | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id, 96);
  const label = str(raw.label, MAX_LABEL_CHARS);
  const state = str(raw.state, 32);
  if (!id || !state) return null;
  const startedAt =
    typeof raw.startedAt === 'number' && Number.isSafeInteger(raw.startedAt) && raw.startedAt >= 0
      ? raw.startedAt
      : undefined;
  const children =
    depth < MAX_DEPTH && Array.isArray(raw.children)
      ? projectRuns(raw.children, depth + 1, MAX_CHILDREN)
      : [];
  const activity = activityOf(raw as RawAsyncStatusNode);
  return {
    id,
    kind: str(raw.kind, 24) ?? 'subagent',
    label: label ?? id,
    state,
    ...(activity ? { activity } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

function projectRuns(raw: unknown[], depth: number, limit: number): SubagentFleetRun[] {
  const runs: SubagentFleetRun[] = [];
  for (const node of raw) {
    if (runs.length >= limit) break;
    const projected = projectNode(node, depth);
    if (projected) runs.push(projected);
  }
  return runs;
}

/** 从一条 setWidget 载荷行解析出安全投影的 fleet runs；非本扩展行 / 坏 JSON → []。 */
export function parseSubagentAsyncWidgetLine(line: string): SubagentFleetRun[] {
  if (!line.startsWith(SUBAGENT_ASYNC_SNAPSHOT_PREFIX)) return [];
  const payload = line.slice(SUBAGENT_ASYNC_SNAPSHOT_PREFIX.length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    return []; // 损坏载荷：静默忽略（不卡流）
  }
  const snapshot = isRecord(parsed) ? (parsed as RawAsyncStatusSnapshot) : {};
  if (!Array.isArray(snapshot.runs)) return [];
  return projectRuns(snapshot.runs, 0, MAX_RUNS);
}

/**
 * 从 extension_ui_request(setWidget) 事件提取 fleet runs。
 * 非 subagent-async key / 无快照行 → []（events.ts 据此静默忽略，不影响其他 setWidget）。
 */
export function subagentFleetRunsFromUiRequest(evt: Record<string, unknown>): SubagentFleetRun[] {
  if (String(evt.widgetKey ?? '') !== SUBAGENT_ASYNC_WIDGET_KEY) return [];
  const lines = Array.isArray(evt.widgetLines)
    ? evt.widgetLines.filter((l): l is string => typeof l === 'string')
    : [];
  for (const line of lines) {
    if (!line.startsWith(SUBAGENT_ASYNC_SNAPSHOT_PREFIX)) continue;
    return parseSubagentAsyncWidgetLine(line);
  }
  return [];
}
