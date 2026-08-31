import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChatStreamEvent } from '../modules/bookplate/stream.js';
import { SUBAGENT_FLEET_WIDGET_KEY, subagentFleetDraft } from './pi/subagents/fleet.js';
import { subagentWidgetProducer } from './pi/subagents/result.js';

/**
 * 工具事件桥 → 扩展 widget（ExtensionWidgets 通用机制的服务端实现）。
 *
 * 设计前提（见 docs/skill-agent/extension-widgets-implementation-plan.md）：
 * - 服务端无 TUI，不订阅 pi 的 setWidget/extension_ui_request 等本地 UI 机制（C1）；
 * - widget 只从已归一化的 `tool_call` / `tool_result` 事件二次加工而来（C4）；
 * - 扩展 = 服务端代码执行，走管理员白名单 + 显式 `-e` 装配（C2 / §4.3）；
 * - widget 以服务端 per-workspace 快照为真相源，随水合恢复（C3 / §4.2）。
 *
 * 新增一个扩展包的 widget 展示：注册一个生产者即可（registerToolWidgetProducer），
 * 不改 mapPiJsonEvent / runPiAgent / SSE 管线。
 */

// ---------------------------------------------------------------------------
// 资源上限（§6.2）
// ---------------------------------------------------------------------------

/** 单 widget 显示行数上限。 */
export const MAX_WIDGET_LINES = 40;
/** 单行长度上限（字符）。 */
export const MAX_WIDGET_LINE_CHARS = 200;
/** 单 widget 总字符预算（≈4KB 量级，防超大结果打爆 SSE）。 */
export const MAX_WIDGET_CHARS = 4000;
/** 每轮 widget 总数上限：超出丢弃新 key（保留已有）。 */
export const MAX_WIDGETS_PER_TURN = 16;
/** 同 key 更新节流间隔（ms）：合并中间帧，只发最终值。 */
export const WIDGET_THROTTLE_MS = 250;

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

/** widget 布局提示（宿主按此分组）。 */
export type WidgetPlacement = 'aboveEditor' | 'belowEditor';

/** 生产者产出（后端内部形态；字段均为安全白名单字段）。 */
export interface WidgetDraft {
  /** widget 唯一标识（如 "rpiv-todos"）。 */
  key: string;
  /** 显示标签（如 "任务列表"，缺省时由前端兜底回退为 key）。 */
  label?: string;
  /** 纯文本行（非 ANSI；服务端无渲染器）。 */
  lines: string[];
  /** 布局提示（默认 aboveEditor）。 */
  placement?: WidgetPlacement;
  /** 可选结构化载荷（仅注册表挑选的安全字段；不随 SSE 下发，仅持久化备用）。 */
  data?: Record<string, unknown>;
}

/** 服务端持久化的每 key 快照（真相源；随水合下发）。 */
export interface WidgetSnapshot {
  key: string;
  label?: string;
  lines: string[];
  placement: WidgetPlacement;
  data?: Record<string, unknown>;
  /** 排序 / 审计时间戳。 */
  updatedAt: number;
  /** 溯源：由哪次工具调用产生。 */
  toolCallId?: string;
  /** 溯源：产出该 widget 的工具名（跨轮 clear 时定位 key）。 */
  toolName?: string;
}

/** 一次工具调用的入参（tool_call 事件归一化后）。 */
export interface ToolCallInfo {
  id: string;
  name: string;
  /** JSON 字符串（参数对象）。 */
  arguments: string;
}

/** 一次工具调用的结果（tool_result 事件归一化后）。 */
export interface ToolResultInfo {
  id: string;
  name: string;
  /** JSON 字符串（结果对象，可为 "null"）。 */
  result: string;
  isError?: boolean;
}

/** 生产者：把一次工具调用映射为 widget 更新。返回 null = 本工具不产生 widget / 空状态（→ 清空）。 */
export type ToolWidgetProducer = (call: ToolCallInfo, result?: ToolResultInfo) => WidgetDraft | null;

// ---------------------------------------------------------------------------
// 生产者注册表
// ---------------------------------------------------------------------------

const producers = new Map<string, ToolWidgetProducer>();

/** 注册一个工具 → widget 生产者（新增扩展包只需这一步）。 */
export function registerToolWidgetProducer(toolName: string, producer: ToolWidgetProducer): void {
  producers.set(toolName, producer);
}

/** 移除生产者（供测试清理 / 停用扩展）。 */
export function unregisterToolWidgetProducer(toolName: string): void {
  producers.delete(toolName);
}

// ---------------------------------------------------------------------------
// 内置生产者：rpiv-todo 的 `todo` 工具
// ---------------------------------------------------------------------------
//
// 以 result.details.tasks（rpiv-todo tool-schema.md 的持久化快照）为权威；
// 空列表（如 clear 后）→ 返回 null，由桥清空面板。字段解析属于生产者内部实现，
// 实际包版本升级仅影响本函数。

function parseTodoResult(resultJson: string): { tasks: unknown[] } | null {
  if (!resultJson || resultJson === 'null') return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(resultJson) as Record<string, unknown>;
  } catch {
    return null;
  }
  const details = (parsed?.details ?? parsed?.state) as { tasks?: unknown } | undefined;
  const tasks = Array.isArray(details?.tasks) ? (details.tasks as unknown[]) : null;
  if (!tasks) return null;
  return { tasks };
}

function statusIcon(status: string): string {
  switch (status) {
    case 'completed':
      return '✓';
    case 'in_progress':
      return '◐';
    case 'pending':
      return '○';
    default:
      return '·';
  }
}

function todoWidgetProducer(call: ToolCallInfo, result?: ToolResultInfo): WidgetDraft | null {
  if (!result) return null;
  const parsed = parseTodoResult(result.result);
  if (!parsed) return null;
  const tasks = parsed.tasks
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .filter((t) => t.status !== 'deleted');
  if (!tasks.length) return null;

  const done = tasks.filter((t) => t.status === 'completed').length;
  const lines = [
    `Todos (${done}/${tasks.length})`,
    ...tasks.map((t) => {
      const subject = String(t.subject ?? t.task ?? '').trim();
      return ` ${statusIcon(String(t.status ?? ''))} ${subject}`;
    }),
  ];
  return {
    key: 'rpiv-todos',
    label: '任务列表',
    lines,
    placement: 'aboveEditor',
    data: {
      tasks: tasks.map((t) => ({
        id: t.id,
        subject: String(t.subject ?? t.task ?? ''),
        status: String(t.status ?? ''),
      })),
    },
  };
}

registerToolWidgetProducer('todo', todoWidgetProducer);
registerToolWidgetProducer('subagent', subagentWidgetProducer);

// ---------------------------------------------------------------------------
// 尺寸上限（§6.2：applyCap 截断 + 剥除控制字符/ANSI）
// ---------------------------------------------------------------------------

function sanitizeWidgetLine(raw: string): string {
  // 先剥 ANSI 转义序列（CSI/OSC），再剥剩余控制字符（含单独残留的 ESC），防换行注入 / 终端渲染干扰
  return raw
    .replace(/\r/g, '')
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/** 对 draft 就地收敛：行数 / 行长度 / 总字符预算（尾部省略）。 */
export function applyWidgetCap(draft: WidgetDraft): void {
  const clipped: string[] = [];
  for (const raw of draft.lines) {
    if (clipped.length >= MAX_WIDGET_LINES) break;
    const line = sanitizeWidgetLine(String(raw ?? ''));
    const cut = line.slice(0, MAX_WIDGET_LINE_CHARS);
    clipped.push(line.length > MAX_WIDGET_LINE_CHARS ? `${cut}…` : cut);
  }
  const total = clipped.reduce((sum, l) => sum + l.length, 0);
  if (total > MAX_WIDGET_CHARS) {
    const kept: string[] = [];
    let used = 0;
    for (const l of clipped) {
      if (used + l.length > MAX_WIDGET_CHARS) break;
      kept.push(l);
      used += l.length;
    }
    if (!kept.length && clipped.length) kept.push(clipped[0]!.slice(0, MAX_WIDGET_CHARS));
    if (kept.length && kept.length < clipped.length) kept.push('…（内容过长已截断）');
    clipped.length = 0;
    clipped.push(...kept);
  }
  draft.lines = clipped;
}

// ---------------------------------------------------------------------------
// widget 持久化（服务端真相源，§4.2 / §6.4）
// ---------------------------------------------------------------------------

/** 快照落点（相对工作区根）；复用 .pi-agent/ 差分排除前缀，不污染产物清单。 */
const WIDGETS_FILE_REL = path.join('.pi-agent', 'widgets.json');

export interface WidgetStore {
  /** 原子写（临时文件 + rename）；收尾/中止都提交一次最终快照。 */
  commit(snapshots: ReadonlyMap<string, WidgetSnapshot>): Promise<void>;
  /** 读最近快照（损坏文件回退空数组，不阻塞会话）。 */
  snapshot(): WidgetSnapshot[];
  /** 清空（随「清空对话」一并调用）。 */
  clear(): void;
}

export function createWidgetStore(ws: string): WidgetStore {
  const file = path.join(ws, WIDGETS_FILE_REL);
  return {
    async commit(snapshots) {
      const list = [...snapshots.values()]
        .filter((s) => Array.isArray(s.lines) && s.lines.length > 0)
        .sort((a, b) => a.updatedAt - b.updatedAt);
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify({ widgets: list }, null, 2), 'utf-8');
      await rename(tmp, file);
    },
    snapshot() {
      try {
        const raw = readFileSync(file, 'utf-8');
        const parsed = JSON.parse(raw) as { widgets?: unknown };
        const list = Array.isArray(parsed?.widgets) ? (parsed.widgets as WidgetSnapshot[]) : [];
        return list.filter(
          (w) => !!w && typeof w.key === 'string' && Array.isArray(w.lines)
        );
      } catch {
        return [];
      }
    },
    clear() {
      try {
        rmSync(file, { force: true });
      } catch {
        /* 忽略 */
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 流包装器（单一接缝）
// ---------------------------------------------------------------------------

interface LiveWidget {
  draft: WidgetDraft;
  updatedAt: number;
  toolCallId?: string;
  toolName?: string;
}

/** 把 ChatStreamEvent 流包装为「聚合工具调用 → 驱动生产者 → 产出 widget 事件」的流。 */
export async function* withWidgetBridge(
  events: AsyncGenerator<ChatStreamEvent>,
  opts: { ws: string; store?: WidgetStore }
): AsyncGenerator<ChatStreamEvent> {
  const store = opts.store ?? createWidgetStore(opts.ws);
  const pending = new Map<string, ToolCallInfo>(); // callId → call
  const live = new Map<string, LiveWidget>(); // widgetKey → 最新快照
  const lastEmitAt = new Map<string, number>(); // widgetKey → 最近发射时间（节流）
  const producedKey = new Map<string, string>(); // toolName → 最近产出的 widgetKey

  // 从持久化快照恢复上一轮的 widget 真相源：跨轮保留（未触发的 widget 仍存在于快照）
  // 且跨轮 clear 可溯源到其产出工具（工具空状态 → 清掉它上一轮挂出的面板）。
  for (const s of store.snapshot()) {
    live.set(s.key, {
      draft: {
        key: s.key,
        ...(s.label ? { label: s.label } : {}),
        lines: s.lines,
        placement: s.placement,
        ...(s.data !== undefined ? { data: s.data } : {}),
      },
      updatedAt: s.updatedAt,
      toolCallId: s.toolCallId,
      toolName: s.toolName,
    });
    if (s.toolName) producedKey.set(s.toolName, s.key);
  }

  try {
    for await (const evt of events) {
      if (evt.type === 'tool_call') {
        pending.set(evt.id, { id: evt.id, name: evt.name, arguments: evt.arguments });
        yield evt;
        continue;
      }
      if (evt.type === 'tool_result') {
        const call = pending.get(evt.id);
        if (call && call.name === evt.name) {
          yield* maybeEmitWidget(call, evt, live, lastEmitAt, producedKey);
          pending.delete(evt.id);
        }
        yield evt;
        continue;
      }
      if (evt.type === 'subagent_fleet') {
        // pi-subagents 后台运行快照 → fleet 面板（固定单 key，last-value-wins）
        const draft = subagentFleetDraft(evt.runs);
        const now = Date.now();
        if (!draft) {
          const prev = live.get(SUBAGENT_FLEET_WIDGET_KEY);
          if (prev) {
            live.delete(SUBAGENT_FLEET_WIDGET_KEY);
            lastEmitAt.delete(SUBAGENT_FLEET_WIDGET_KEY);
            yield { type: 'extension_widget_clear', key: SUBAGENT_FLEET_WIDGET_KEY };
          }
          yield evt;
          continue;
        }
        applyWidgetCap(draft);
        const prev = live.get(SUBAGENT_FLEET_WIDGET_KEY);
        live.set(SUBAGENT_FLEET_WIDGET_KEY, { draft, updatedAt: now, toolName: 'subagent' });
        const last = lastEmitAt.get(SUBAGENT_FLEET_WIDGET_KEY) ?? 0;
        if (!prev || now - last >= WIDGET_THROTTLE_MS) {
          lastEmitAt.set(SUBAGENT_FLEET_WIDGET_KEY, now);
          yield {
            type: 'extension_widget',
            key: draft.key,
            ...(draft.label ? { label: draft.label } : {}),
            lines: draft.lines,
            placement: draft.placement,
          };
        }
        yield evt;
        continue;
      }
      yield evt;
    }
  } finally {
    // 收尾/中止都提交一次最终快照（服务端真相源）
    try {
      const snapshots = new Map<string, WidgetSnapshot>();
      for (const [key, lw] of live) {
        snapshots.set(key, {
          key,
          ...(lw.draft.label ? { label: lw.draft.label } : {}),
          lines: lw.draft.lines,
          placement: lw.draft.placement ?? 'aboveEditor',
          ...(lw.draft.data !== undefined ? { data: lw.draft.data } : {}),
          updatedAt: lw.updatedAt,
          ...(lw.toolCallId ? { toolCallId: lw.toolCallId } : {}),
          ...(lw.toolName ? { toolName: lw.toolName } : {}),
        });
      }
      await store.commit(snapshots);
    } catch {
      /* 磁盘异常等：widget 快照是会话辅助索引，失败不阻塞对话流 */
    }
  }
}

function* maybeEmitWidget(
  call: ToolCallInfo,
  resultEvt: { id: string; name: string; result: string; isError?: boolean },
  live: Map<string, LiveWidget>,
  lastEmitAt: Map<string, number>,
  producedKey: Map<string, string>
): Generator<ChatStreamEvent> {
  const producer = producers.get(call.name);
  if (!producer) return;

  const draft = producer(call, resultEvt);
  if (!draft) {
    // 空状态 → 清空该工具最近产出的 widget
    const key = producedKey.get(call.name);
    if (key) {
      producedKey.delete(call.name);
      const prev = live.get(key);
      if (prev) {
        live.delete(key);
        lastEmitAt.delete(key);
        yield { type: 'extension_widget_clear', key };
      }
    }
    return;
  }

  applyWidgetCap(draft);
  producedKey.set(call.name, draft.key);
  const now = Date.now();
  const prev = live.get(draft.key);
  // 每轮 widget 总数上限：新 key 且已满 → 丢弃（保留已有）
  if (!prev && live.size >= MAX_WIDGETS_PER_TURN) return;
  live.set(draft.key, { draft, updatedAt: now, toolCallId: resultEvt.id, toolName: call.name });

  // 同 key 更新节流：≥250ms 才发射，中间帧合并（最终快照由 store.commit 兜底）
  const last = lastEmitAt.get(draft.key) ?? 0;
  if (now - last >= WIDGET_THROTTLE_MS) {
    lastEmitAt.set(draft.key, now);
    yield {
      type: 'extension_widget',
      key: draft.key,
      ...(draft.label ? { label: draft.label } : {}),
      lines: draft.lines,
      placement: draft.placement,
    };
  }
}
