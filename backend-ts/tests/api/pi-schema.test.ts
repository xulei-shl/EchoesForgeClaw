import { describe, expect, it } from 'vitest';
import { assistantMessageEventSchema, rpcEventSchema } from '../../src/services/ai/pi/schema.js';

/**
 * 进程边界 schema 校验（P1-3）：
 * - 未知 type / 已知类型坏字段 → safeParse 失败（consumeLine 据此静默忽略，与现状一致）；
 * - 合法事件 → 通过，未知额外字段透传（消费方 String()/Number() 宽容转换不受影响）。
 */

describe('rpcEventSchema（RPC stdout 事件边界校验）', () => {
  it('全部已消费事件类型均通过校验', () => {
    const cases: unknown[] = [
      { type: 'response', command: 'prompt', success: true },
      { type: 'response', command: 'prompt', success: false, error: 'boom' },
      { type: 'agent_settled' },
      { type: 'agent_start' },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'a' } },
      { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'read', args: { path: 'x' } },
      { type: 'tool_execution_end', toolCallId: 'c1', toolName: 'read', result: { ok: true } },
      { type: 'compaction_start', reason: 'threshold' },
      { type: 'compaction_end', aborted: false },
      { type: 'extension_ui_request', method: 'select', id: 'u1', title: 't' },
      { type: 'extension_ui_request', method: 'setWidget', widgetKey: 'k', widgetLines: ['x'] },
      { type: 'message_end', message: { role: 'assistant', errorMessage: 'e' } },
      { type: 'auto_retry_start', attempt: 2, maxAttempts: 5, delayMs: 4000, errorMessage: '429' },
      { type: 'auto_retry_end', success: true },
    ];
    for (const c of cases) {
      expect(rpcEventSchema.safeParse(c).success, JSON.stringify(c)).toBe(true);
    }
  });

  it('未知 type 不匹配（consumeLine 静默忽略）', () => {
    expect(rpcEventSchema.safeParse({ type: 'queue_update', steering: [] }).success).toBe(false);
    expect(rpcEventSchema.safeParse({ type: 'nope', anything: 1 }).success).toBe(false);
  });

  it('已知类型坏字段 → 校验失败（不吞不报错，静默忽略）', () => {
    expect(rpcEventSchema.safeParse({ type: 'response', command: 'prompt', success: 'yes' }).success).toBe(false);
    expect(rpcEventSchema.safeParse({ type: 'response', command: 'other', success: true }).success).toBe(false);
    expect(rpcEventSchema.safeParse({ type: 'extension_ui_request', method: 42 }).success).toBe(false);
  });

  it('未知额外字段透传（消费方宽容转换不受影响）', () => {
    const r = rpcEventSchema.safeParse({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      extraField: { nested: [1, 2] },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data['extraField']).toEqual({ nested: [1, 2] });
  });
});

describe('assistantMessageEventSchema（message_update 窄断言）', () => {
  it('text/thinking delta 通过；未知类型/缺字段静默（partial）', () => {
    expect(assistantMessageEventSchema.safeParse({ type: 'text_delta', delta: 'a' }).success).toBe(true);
    expect(assistantMessageEventSchema.safeParse({ type: 'thinking_delta', delta: 'b' }).success).toBe(true);
    // 0.84.x 可能带更多字段：透传不报错
    expect(assistantMessageEventSchema.safeParse({ type: 'text_delta', delta: 'a', partial: true }).success).toBe(true);
    // 未知 delta 类型 → 校验失败（events.ts 据此不产出，等价于静默忽略）；缺 delta → partial 容错但无输出
    expect(assistantMessageEventSchema.safeParse({ type: 'toolcall_start' }).success).toBe(false);
    expect(assistantMessageEventSchema.safeParse({ type: 'text_delta' }).success).toBe(true);
  });
});
