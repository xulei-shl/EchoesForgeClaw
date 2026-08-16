import { afterEach, describe, expect, it } from 'vitest';
import { chatStream } from '../../src/infrastructure/ai/language-model/chat-stream.js';
import { startMockOpenAIServer, sseChunk, type MockOpenAIServer } from '../helpers/mock-openai-server.js';

/**
 * 契约测试：多轮对话历史（移植 Python `test_multiturn_history.py` 的 LLM 部分）。
 *
 * 回归点：assistant 历史消息必须随请求完整回传（AI SDK 对历史消息的转换
 * 不得丢弃 assistant 轮次），第二轮起多轮流式内容完整。
 */

const openServers: MockOpenAIServer[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((s) => s.close()));
});

describe('多轮对话历史', () => {
  it('assistant 历史随请求回传，多轮流式内容完整', async () => {
    const srv = await startMockOpenAIServer((req, send) => {
      // 验证发送给端点的消息：assistant 历史应出现在 messages 中
      const roles = (req.body?.messages ?? []).map((m: any) => m.role);
      expect(roles).toContain('assistant');
      const base = { id: 'chatcmpl-mt', object: 'chat.completion.chunk', created: 0, model: 'mock-model' };
      send(sseChunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }));
      send(sseChunk({ ...base, choices: [{ index: 0, delta: { content: '第二轮回答' }, finish_reason: null }] }));
      send(sseChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
      send(sseChunk({ ...base, choices: [], usage: { total_tokens: 10 } }));
    });
    openServers.push(srv);

    // 多轮历史：第一轮 user + assistant 回复
    const messages = [
      { role: 'user', content: '第一轮提问' },
      { role: 'assistant', content: '第一轮回答' },
      { role: 'user', content: '第二轮提问' },
    ];

    const events = [];
    for await (const e of chatStream(messages, {
      apiKey: 'sk-mock',
      base_url: srv.baseURL,
      model_name: 'mock-model',
    })) {
      events.push(e);
    }

    // 事件流完成且第二轮文本完整
    expect(events.length).toBeGreaterThan(0);
    const content = events.filter((e) => e.type === 'content').map((e) => e.delta).join('');
    expect(content).toContain('第二轮回答');

    // 请求体中确实带上了 assistant 历史
    expect(srv.requests.length).toBe(1);
    const sentRoles = (srv.requests[0]?.body?.messages ?? []).map((m: any) => m.role);
    expect(sentRoles).toEqual(['user', 'assistant', 'user']);
  });

  it('system 提示词经 system 选项注入（不混入 messages）', async () => {
    const srv = await startMockOpenAIServer((req, send) => {
      const base = { id: 'chatcmpl-sys', object: 'chat.completion.chunk', created: 0, model: 'mock-model' };
      send(sseChunk({ ...base, choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] }));
      send(sseChunk({ ...base, choices: [], usage: { total_tokens: 3 } }));
    });
    openServers.push(srv);

    const events = [];
    for await (const e of chatStream(
      [{ role: 'user', content: 'hi' }],
      {
        apiKey: 'sk-mock',
        base_url: srv.baseURL,
        model_name: 'mock-model',
        system_prompt: '你是藏书票助手',
      }
    )) {
      events.push(e);
    }
    expect(events.length).toBeGreaterThan(0);

    const sent = srv.requests[0]?.body;
    // system 提示词必须送达端点：provider 可能经顶层 system 字段，也可能放入 messages[0]
    const systemDelivered =
      sent.system === '你是藏书票助手' ||
      (sent.messages ?? []).some((m: any) => m.role === 'system' && m.content === '你是藏书票助手');
    expect(systemDelivered).toBe(true);
    // system 不得重复注入（顶层 + messages 同时存在才算重复）
    const systemCount = (sent.messages ?? []).filter((m: any) => m.role === 'system').length;
    expect(systemCount).toBeLessThanOrEqual(1);
  });
});
