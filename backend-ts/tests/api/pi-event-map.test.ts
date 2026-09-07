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
    // 坏字段静默忽略（非对象 / 缺 delta）→ 不产出
    expect(collect({ type: 'message_update', assistantMessageEvent: 'garbage' }, state)).toEqual([]);
    expect(collect({ type: 'message_update', assistantMessageEvent: { type: 'text_delta' } }, state)).toEqual([]);
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

  it('message_end 携带 usage 时正确产出 token_usage 事件与上下文占比', () => {
    const state: PiEventMapperState = { lastError: null, contextWindow: 200_000 };
    const events = collect(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          usage: { input: 3000, output: 1000, totalTokens: 4000 },
        },
      },
      state
    );
    expect(events).toEqual([
      {
        type: 'token_usage',
        input: 3000,
        output: 1000,
        totalTokens: 4000,
        contextWindow: 200_000,
        percent: 2.0, // 4000 / 200000 * 100 = 2.0
      },
    ]);

    // 缺省 contextWindow 时回退 128000
    const defaultState: PiEventMapperState = { lastError: null };
    const defaultEvents = collect(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          usage: { input: 1280, output: 0, totalTokens: 1280 },
        },
      },
      defaultState
    );
    expect(defaultEvents).toEqual([
      {
        type: 'token_usage',
        input: 1280,
        output: 0,
        totalTokens: 1280,
        contextWindow: 128000,
        percent: 1.0, // 1280 / 128000 * 100 = 1.0
      },
    ]);
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

  it('extension_ui_request setWidget 窄缝：仅 subagent-async 快照产出 subagent_fleet，其余静默', () => {
    const state: PiEventMapperState = { lastError: null };
    const snapshotLine = `PI_SUBAGENT_ASYNC_JSON:${JSON.stringify({
      kind: 'pi-subagents.async-status-snapshot',
      version: 1,
      generatedAt: 1,
      caps: {},
      omitted: {},
      runs: [
        {
          id: 'r1',
          kind: 'subagent',
          label: 'reviewer',
          state: 'running',
          activity: { currentTool: 'read' },
          children: [{ id: 'r1-1', kind: 'step', label: 'worker', state: 'complete' }],
        },
      ],
    })}`;
    expect(
      collect(
        {
          type: 'extension_ui_request',
          id: 'u1',
          method: 'setWidget',
          widgetKey: 'subagent-async',
          widgetLines: [snapshotLine],
        },
        state
      )
    ).toEqual([
      {
        type: 'subagent_fleet',
        runs: [
          {
            id: 'r1',
            kind: 'subagent',
            label: 'reviewer',
            state: 'running',
            activity: { currentTool: 'read' },
            children: [{ id: 'r1-1', kind: 'step', label: 'worker', state: 'complete' }],
          },
        ],
      },
    ]);
    // 非 subagent-async key / 坏 JSON → 静默忽略
    expect(
      collect(
        { type: 'extension_ui_request', id: 'u2', method: 'setWidget', widgetKey: 'other', widgetLines: [snapshotLine] },
        state
      )
    ).toEqual([]);
    expect(
      collect(
        { type: 'extension_ui_request', id: 'u3', method: 'setWidget', widgetKey: 'subagent-async', widgetLines: ['PI_SUBAGENT_ASYNC_JSON:{bad'] },
        state
      )
    ).toEqual([]);
    // subagent-async 空快照 / 清除 widget（后台任务全部结束信号）→ 产出空 subagent_fleet
    expect(
      collect(
        { type: 'extension_ui_request', id: 'u4', method: 'setWidget', widgetKey: 'subagent-async', widgetLines: [] },
        state
      )
    ).toEqual([{ type: 'subagent_fleet', runs: [] }]);
    expect(
      collect(
        { type: 'extension_ui_request', id: 'u5', method: 'setWidget', widgetKey: 'subagent-async', widgetLines: ['plain line'] },
        state
      )
    ).toEqual([{ type: 'subagent_fleet', runs: [] }]);
  });
});
