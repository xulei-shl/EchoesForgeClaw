import { afterEach, describe, expect, it } from 'vitest';
import { chatStream } from '../../src/infrastructure/ai/language-model/chat-stream.js';
import { startMockOpenAIServer, sseChunk, type MockOpenAIServer } from '../helpers/mock-openai-server.js';

/**
 * 契约测试：reasoning / content 拆分（移植 Python `test_llm_reasoning_split.py`）。
 *
 * 验证 AI SDK openai-compatible provider 对 DeepSeek 等端点
 * `delta.reasoning_content` 的处理：
 * - reasoning 增量 → { type: 'reasoning', delta }（不混入正文）；
 * - content 增量 → { type: 'content', delta }；
 * - 无 API Key 的 Mock 路径全部为 content 事件；
 * - 普通端点（无 reasoning_content）不产出 reasoning 事件。
 */

const openServers: MockOpenAIServer[] = [];

async function startServer(
  respond: (req: { path: string; body: any }, send: (chunk: string) => void) => void
): Promise<MockOpenAIServer> {
  const srv = await startMockOpenAIServer(respond);
  openServers.push(srv);
  return srv;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((s) => s.close()));
});

function chatChunks(base: Record<string, unknown>, deltas: Record<string, unknown>[]) {
  const id = base.id as string;
  return deltas.map((delta) =>
    sseChunk({
      id,
      object: 'chat.completion.chunk',
      created: 0,
      model: 'mock-model',
      choices: [{ index: 0, delta, finish_reason: null }],
    })
  );
}

describe('reasoning / content 拆分（DeepSeek 兼容端点）', () => {
  it('按 reasoning → content 顺序产出归一化事件，内容完整且不混入正文', async () => {
    const srv = await startServer((req, send) => {
      for (const c of chatChunks(
        { id: 'chatcmpl-r' },
        [
          { reasoning_content: 'think-a' },
          { reasoning_content: 'think-b' },
          { content: 'hello ' },
          { content: 'world' },
        ]
      )) {
        send(c);
      }
      send(
        sseChunk({
          id: 'chatcmpl-r',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'mock-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })
      );
      send(
        sseChunk({
          id: 'chatcmpl-r',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'mock-model',
          choices: [],
          usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
        })
      );
    });

    const events = [];
    for await (const e of chatStream(
      [{ role: 'user', content: 'hi' }],
      { apiKey: 'sk-mock', base_url: srv.baseURL, model_name: 'mock-model' }
    )) {
      events.push(e);
    }

    const types = events.map((e) => e.type);
    expect(types).toEqual(['reasoning', 'reasoning', 'content', 'content']);
    expect(
      events.filter((e) => e.type === 'reasoning').map((e) => e.delta).join('')
    ).toBe('think-athink-b');
    expect(events.filter((e) => e.type === 'content').map((e) => e.delta).join('')).toBe(
      'hello world'
    );
    // 推理不混入正文
    expect(
      events.filter((e) => e.type === 'content').every((e) => !e.delta.includes('think'))
    ).toBe(true);
  });

  it('普通端点（无 reasoning_content）不产出 reasoning 事件', async () => {
    const srv = await startServer((req, send) => {
      for (const c of chatChunks({ id: 'chatcmpl-p' }, [{ content: '仅正文' }])) {
        send(c);
      }
      send(
        sseChunk({
          id: 'chatcmpl-p',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'mock-model',
          choices: [],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        })
      );
    });

    const events = [];
    for await (const e of chatStream(
      [{ role: 'user', content: 'hi' }],
      { apiKey: 'sk-mock', base_url: srv.baseURL, model_name: 'mock-model' }
    )) {
      events.push(e);
    }
    expect(events.every((e) => e.type === 'content')).toBe(true);
    expect(events.map((e) => e.delta).join('')).toBe('仅正文');
  });

  it('缺 user 消息抛 LLMGenerationError', async () => {
    const srv = await startServer((req, send) => {
      /* 不会到达 */
    });
    await expect(
      (async () => {
        for await (const _ of chatStream([], {
          apiKey: 'sk-mock',
          base_url: srv.baseURL,
          model_name: 'mock-model',
        })) {
          /* noop */
        }
      })()
    ).rejects.toThrow('AI 对话缺少用户消息');
  });
});

describe('Mock 路径（无 API Key）', () => {
  it('全部为 content 事件且包含引导文案', async () => {
    const events = [];
    for await (const e of chatStream([{ role: 'user', content: 'x' }], null)) {
      events.push(e);
    }
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.type === 'content')).toBe(true);
    expect(events.map((e) => e.delta).join('')).toContain('【Mock 对话】');
  });
});
