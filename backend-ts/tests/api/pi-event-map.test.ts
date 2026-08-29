import { describe, expect, it } from 'vitest';
import { mapPiJsonEvent, type PiEventMapperState } from '../../src/services/pi-agent-service.js';

/** 收集生成器产出的全部事件。 */
function collect(evt: Record<string, unknown>, state: PiEventMapperState) {
  return [...mapPiJsonEvent(evt as never, state)];
}

describe('mapPiJsonEvent（pi json 事件 → ChatStreamEvent）', () => {
  it('message_update：text/thinking delta 分流', () => {
    const state: PiEventMapperState = { lastError: null };
    expect(collect({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'a' } }, state)).toEqual([
      { type: 'content_delta', delta: 'a' },
    ]);
    expect(
      collect({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'b' } }, state)
    ).toEqual([{ type: 'reasoning_delta', delta: 'b' }]);
    // 其他 assistantMessageEvent 类型静默
    expect(collect({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start' } }, state)).toEqual([]);
  });

  it('auto_retry_start 产出结构化 agent_retry；成功恢复推 status；失败转 error', () => {
    const state: PiEventMapperState = { lastError: null };
    expect(
      collect(
        { type: 'auto_retry_start', attempt: 2, maxAttempts: 5, delayMs: 4000, errorMessage: 'Provider returned error 429' },
        state
      )
    ).toEqual([
      { type: 'agent_retry', attempt: 2, maxAttempts: 5, delaySec: 4, reason: '模型服务繁忙（限流）' },
    ]);

    const state2: PiEventMapperState = { lastError: null };
    expect(collect({ type: 'auto_retry_end', success: true }, state2)).toEqual([
      { type: 'status', message: '已自动恢复，继续生成…' },
    ]);

    const state3: PiEventMapperState = { lastError: 'boom 520' };
    const events = collect({ type: 'auto_retry_end', success: false }, state3);
    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe('error');
  });

  it('compaction_start/end 按原因提示；aborted 静默；失败带 errorMessage', () => {
    const state: PiEventMapperState = { lastError: null };
    expect(collect({ type: 'compaction_start', reason: 'threshold' }, state)[0]).toMatchObject({
      type: 'status',
    });
    expect((collect({ type: 'compaction_start', reason: 'overflow' }, state)[0] as { message: string }).message).toContain('溢出');
    expect(collect({ type: 'compaction_end', aborted: true }, state)).toEqual([]);
    expect((collect({ type: 'compaction_end', errorMessage: 'x' }, state)[0] as { message: string }).message).toContain('压缩失败');
    expect((collect({ type: 'compaction_end' }, state)[0] as { message: string }).message).toContain('压缩完成');
  });

  it('message_end 捕获最新 errorMessage；未知事件静默；工具调用透传', () => {
    const state: PiEventMapperState = { lastError: null };
    collect({ type: 'message_end', message: { role: 'assistant', errorMessage: 'e1' } }, state);
    collect({ type: 'message_end', message: { role: 'assistant', errorMessage: null } }, state);
    expect(state.lastError).toBeNull();
    collect({ type: 'message_end', message: { role: 'assistant', errorMessage: 'latest' } }, state);
    expect(state.lastError).toBe('latest');

    expect(collect({ type: 'agent_start' }, state)).toEqual([]);
    expect(collect({ type: 'queue_update', steering: [], followUp: [] }, state)).toEqual([]);

    const tools = collect(
      { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'read', args: { path: 'x' } },
      state
    );
    expect(tools[0]).toMatchObject({ type: 'tool_call', id: 'c1', name: 'read' });
  });

  it('extension_ui_request：四类 dialog 透传白名单字段；非 dialog 方法静默', () => {
    const state: PiEventMapperState = { lastError: null };
    expect(
      collect(
        {
          type: 'extension_ui_request',
          id: 'u1',
          method: 'select',
          title: '选择方案',
          options: ['A', 'B'],
          timeout: 10000,
          extraneous: 1,
        },
        state
      )
    ).toEqual([
      { type: 'extension_ui_request', id: 'u1', method: 'select', title: '选择方案', options: ['A', 'B'], timeout: 10000 },
    ]);
    expect(
      collect({ type: 'extension_ui_request', id: 'u2', method: 'input', title: '输入', placeholder: 'hint' }, state)
    ).toEqual([
      { type: 'extension_ui_request', id: 'u2', method: 'input', title: '输入', placeholder: 'hint' },
    ]);
    expect(
      collect({ type: 'extension_ui_request', id: 'u3', method: 'confirm', title: '确认', message: 'ok?' }, state)
    ).toEqual([
      { type: 'extension_ui_request', id: 'u3', method: 'confirm', title: '确认', message: 'ok?' },
    ]);
    expect(
      collect({ type: 'extension_ui_request', id: 'u4', method: 'editor', title: '编辑', prefill: 'text' }, state)
    ).toEqual([
      { type: 'extension_ui_request', id: 'u4', method: 'editor', title: '编辑', prefill: 'text' },
    ]);
    // 非 dialog 方法 / 缺 id / 非法 options 元素：静默或过滤
    expect(collect({ type: 'extension_ui_request', id: 'u5', method: 'setWidget', widgetKey: 'k' }, state)).toEqual([]);
    expect(collect({ type: 'extension_ui_request', method: 'select', title: 'x' }, state)).toEqual([]);
    expect(
      collect(
        { type: 'extension_ui_request', id: 'u6', method: 'select', title: 't', options: ['a', 42, null, 'b'] },
        state
      )
    ).toEqual([{ type: 'extension_ui_request', id: 'u6', method: 'select', title: 't', options: ['a', 'b'] }]);
  });
});
