import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  applyWidgetCap,
  createWidgetStore,
  MAX_WIDGET_CHARS,
  MAX_WIDGET_LINE_CHARS,
  MAX_WIDGET_LINES,
  MAX_WIDGETS_PER_TURN,
  registerToolWidgetProducer,
  unregisterToolWidgetProducer,
  withWidgetBridge,
  type WidgetSnapshot,
  type WidgetStore,
} from '../../src/services/pi-widgets.js';
import type { ChatStreamEvent } from '../../src/modules/bookplate/stream.js';

/** 驱动 withWidgetBridge 处理输入事件，返回全部产出事件。 */
async function runBridge(
  input: ChatStreamEvent[],
  opts?: { ws: string; store?: WidgetStore }
): Promise<ChatStreamEvent[]> {
  async function* gen(): AsyncGenerator<ChatStreamEvent> {
    for (const e of input) yield e;
  }
  const store = opts?.store ?? new FakeStore();
  const out: ChatStreamEvent[] = [];
  for await (const e of withWidgetBridge(gen(), { ws: opts?.ws ?? 'ws-test', store })) out.push(e);
  return out;
}

function callResult(name: string, id: string, result: unknown, isError = false): ChatStreamEvent[] {
  return [
    { type: 'tool_call', id, name, arguments: '{}' },
    { type: 'tool_result', id, name, result: JSON.stringify(result), ...(isError ? { isError: true } : {}) },
  ];
}

/** rpiv-todo tool 返回 envelope（details.tasks 为权威快照）。 */
function todoResult(tasks: unknown[]): Record<string, unknown> {
  return {
    content: [{ type: 'text', text: 'ok' }],
    details: { action: 'update', params: {}, tasks, nextId: tasks.length + 1 },
  };
}

class FakeStore implements WidgetStore {
  snapshots: WidgetSnapshot[] = [];
  async commit(s: ReadonlyMap<string, WidgetSnapshot>): Promise<void> {
    this.snapshots = [...s.values()];
  }
  snapshot(): WidgetSnapshot[] {
    return this.snapshots;
  }
  clear(): void {
    this.snapshots = [];
  }
}

describe('applyWidgetCap（尺寸上限 + 净化）', () => {
  it('超长行截断、超行数截断、控制字符/ANSI 剥除', () => {
    const draft = {
      key: 'k',
      lines: [
        `plain \u001b[31mred\u001b[0m`,
        'a'.repeat(MAX_WIDGET_LINE_CHARS + 20),
        ...Array.from({ length: MAX_WIDGET_LINES }, () => 'x'),
      ],
    };
    applyWidgetCap(draft);
    expect(draft.lines.length).toBeLessThanOrEqual(MAX_WIDGET_LINES);
    expect(draft.lines[0]).toBe('plain red'); // ANSI 剥除
    const long = draft.lines[1]!;
    expect(long.length).toBeLessThanOrEqual(MAX_WIDGET_LINE_CHARS + 1);
    expect(long.endsWith('…')).toBe(true);
  });

  it('总字符预算（≈MAX_WIDGET_CHARS）', () => {
    const draft = {
      key: 'k',
      lines: Array.from({ length: 60 }, (_, i) => `line-${i}-${'x'.repeat(120)}`),
    };
    applyWidgetCap(draft);
    const total = draft.lines.reduce((s, l) => s + l.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_WIDGET_CHARS + MAX_WIDGET_LINE_CHARS);
  });
});

describe('withWidgetBridge（工具事件桥）', () => {
  it('未知工具不产生 widget 事件，原事件透传', async () => {
    const evts = await runBridge(callResult('read', 'c1', { content: 'x' }));
    expect(evts).toEqual(callResult('read', 'c1', { content: 'x' }));
  });

  it('内置 todo 生产者：合法结果产出 rpiv-todos widget；空列表发 clear', async () => {
    const store = new FakeStore();
    const first = await runBridge(
      callResult('todo', 'c1', todoResult([
        { id: 1, subject: '完成任务1', status: 'pending' },
        { id: 2, subject: '进行中任务2', status: 'in_progress' },
        { id: 3, subject: '完成的任务', status: 'completed' },
        { id: 4, subject: '已删除', status: 'deleted' },
      ])),
      { ws: 'ws-test', store }
    );
    const widget = first.find((e) => e.type === 'extension_widget');
    expect(widget).toBeDefined();
    const w = widget as { key: string; lines: string[]; placement?: string };
    expect(w.key).toBe('rpiv-todos');
    expect(w.lines[0]).toBe('Todos (1/3)'); // deleted 不计入
    expect(w.lines.join('\n')).toContain('✓ 完成的任务');
    expect(w.lines.join('\n')).toContain('◐ 进行中任务2');
    expect(w.lines.join('\n')).toContain('○ 完成任务1');
    expect(w.lines.join('\n')).not.toContain('已删除');
    // 收尾快照落库
    expect(store.snapshots.some((s) => s.key === 'rpiv-todos')).toBe(true);

    // 空列表（clear 后）→ extension_widget_clear
    const second = await runBridge(callResult('todo', 'c2', todoResult([])), { ws: 'ws-test', store });
    expect(second.some((e) => e.type === 'extension_widget_clear' && e.key === 'rpiv-todos')).toBe(true);
    // 收尾快照里已无 rpiv-todos
    expect(store.snapshots.some((s) => s.key === 'rpiv-todos')).toBe(false);
  });

  it('非法/错误结果不产出 widget（返回 null 语义）；isError 透传不影响', async () => {
    const store = new FakeStore();
    const evts = await runBridge(callResult('todo', 'c1', 'null'), { ws: 'ws-test', store });
    expect(evts.some((e) => e.type === 'extension_widget')).toBe(false);
    const errEvts = await runBridge(callResult('todo', 'c2', 'not json', true), { ws: 'ws-test', store });
    expect(errEvts.some((e) => e.type === 'extension_widget')).toBe(false);
  });

  it('同 key 更新节流：250ms 内只发一次；间隔后恢复', async () => {
    const store = new FakeStore();
    // 单条流内：两条结果紧挨（同一 ms 区间）→ 只发一次；随后等待 300ms 再发 → 恢复发射
    async function* delayed(): AsyncGenerator<ChatStreamEvent> {
      yield* callResult('todo', 'c1', todoResult([{ id: 1, subject: 'a', status: 'pending' }]));
      yield* callResult('todo', 'c2', todoResult([{ id: 1, subject: 'a', status: 'completed' }]));
      await new Promise((r) => setTimeout(r, 300));
      yield* callResult('todo', 'c3', todoResult([{ id: 1, subject: 'b', status: 'pending' }]));
    }
    const out: ChatStreamEvent[] = [];
    for await (const e of withWidgetBridge(delayed(), { ws: 'ws-test', store })) out.push(e);
    const widgets = out.filter((e) => e.type === 'extension_widget');
    expect(widgets.length).toBe(2);
    // 节流合并的中间帧不发，但收尾快照为最终值
    const snap = store.snapshots.find((s) => s.key === 'rpiv-todos');
    expect(snap?.lines.join('\n')).toContain('○ b');
  });

  it('每轮 widget 总数上限：超出丢弃新 key（保留已有）', async () => {
    const store = new FakeStore();
    const input: ChatStreamEvent[] = [];
    for (let i = 0; i < MAX_WIDGETS_PER_TURN + 2; i++) {
      input.push(
        { type: 'tool_call', id: `c${i}`, name: 'custom_tool', arguments: '{}' },
        {
          type: 'tool_result',
          id: `c${i}`,
          name: 'custom_tool',
          result: JSON.stringify({ key: `w${i}`, lines: ['x'] }),
        }
      );
    }
    registerToolWidgetProducer('custom_tool', (call, result) => {
      const d = JSON.parse(result?.result ?? '{}') as { key: string; lines: string[] };
      return { key: d.key, lines: d.lines, placement: 'aboveEditor' };
    });
    try {
      const evts = await runBridge(input, { ws: 'ws-test', store });
      const widgets = evts.filter((e) => e.type === 'extension_widget');
      expect(widgets.length).toBe(MAX_WIDGETS_PER_TURN);
      // 前 MAX 个 key 保留，超出的被丢弃
      for (let i = 0; i < MAX_WIDGETS_PER_TURN; i++) {
        expect(widgets.some((w) => (w as { key: string }).key === `w${i}`)).toBe(true);
      }
    } finally {
      unregisterToolWidgetProducer('custom_tool');
    }
  });
});

describe('createWidgetStore（per-workspace 快照）', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'pi-widgets-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('commit → snapshot 往返；clear 清空', async () => {
    const ws = path.join(tmp, 'ws');
    mkdirSync(ws, { recursive: true });
    const store = createWidgetStore(ws);
    await store.commit(
      new Map([
        ['rpiv-todos', {
          key: 'rpiv-todos',
          lines: ['Todos (1/2)', '✓ a', '○ b'],
          placement: 'aboveEditor',
          updatedAt: 100,
          toolCallId: 'c1',
        }],
      ])
    );
    const snap = store.snapshot();
    expect(snap.length).toBe(1);
    expect(snap[0]).toMatchObject({ key: 'rpiv-todos', placement: 'aboveEditor', toolCallId: 'c1' });
    store.clear();
    expect(store.snapshot()).toEqual([]);
  });

  it('损坏文件回退空快照（不阻塞会话）', () => {
    const ws = path.join(tmp, 'ws-corrupt');
    mkdirSync(path.join(ws, '.pi-agent'), { recursive: true });
    writeFileSync(path.join(ws, '.pi-agent', 'widgets.json'), '{ not valid json', 'utf-8');
    const store = createWidgetStore(ws);
    expect(store.snapshot()).toEqual([]);
  });

  it('空 lines 的 widget 不落库（last-value-wins 语义）', async () => {
    const ws = path.join(tmp, 'ws-empty');
    mkdirSync(ws, { recursive: true });
    const store = createWidgetStore(ws);
    await store.commit(
      new Map([
        ['k', { key: 'k', lines: [], placement: 'aboveEditor', updatedAt: 1 }],
      ])
    );
    expect(store.snapshot()).toEqual([]);
  });
});
