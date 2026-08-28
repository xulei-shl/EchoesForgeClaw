import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

import { preparePiWorkspace, runPiAgent } from '../../src/services/pi-agent-service.js';
import { chatStreamToSseResponse, type ChatStreamEvent } from '../../src/modules/bookplate/stream.js';

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function startMock(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/v1/images/generations') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
        return;
      }
      const parsed = JSON.parse(body || '{}');
      const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
      const last = msgs[msgs.length - 1];
      const isToolTurn = last && last.role === 'tool';
      const lastText = last ? JSON.stringify(last.content ?? '') : '';
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta: unknown, finish?: string) =>
        `data: ${JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'test-model',
          choices: [{ index: 0, delta, finish_reason: finish ?? null }],
        })}\n\n`;
      if (isToolTurn) {
        res.write(chunk({ role: 'assistant', content: 'done' }));
        res.write(chunk({}, 'stop'));
      } else if (lastText.includes('draw')) {
        res.write(
          chunk(
            {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_mock',
                  type: 'function',
                  function: {
                    name: 'image_generate',
                    arguments: JSON.stringify({ prompt: 'a cat', filename: 'mock' }),
                  },
                },
              ],
            },
            'tool_calls'
          )
        );
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  return { server, port };
}

const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime');
const UID = 990004;
const WS_ID = `pi-sse_${Date.now()}`;

/** 解析 chatStreamToSseResponse 产出的 `data: <JSON>` 行序列。 */
function parseSse(body: string): ChatStreamEvent[] {
  const events: ChatStreamEvent[] = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const payload = t.slice('data:'.length).trim();
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload) as ChatStreamEvent);
    } catch {
      /* 跨块截断行忽略（本测试关注类型序列） */
    }
  }
  return events;
}

describe('runPiAgent → 原始 SSE 线协议（工具日志/产物事件到达前端）', () => {
  let mock: { server: Server; port: number };

  beforeEach(async () => {
    rmSync(path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID), { recursive: true, force: true });
    mock = await startMock();
  });

  afterEach(() => {
    mock.server.close();
    rmSync(path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID), { recursive: true, force: true });
  });

  it(
    '绘图轮：SSE 线上出现 tool_call / tool_result / agent_file 事件',
    async () => {
      const prepared = preparePiWorkspace(UID, WS_ID, {
        agentId: 1,
        chatModel: { baseUrl: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'k', modelName: 'test-model', multimodal: true },
        imageModel: { baseUrl: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'k', modelName: 'img-model' },
        skillNames: [],
      });

      async function* events(): AsyncGenerator<ChatStreamEvent, void, unknown> {
        for await (const evt of runPiAgent({
          userId: UID,
          workspaceId: WS_ID,
          ws: prepared.ws,
          hasPrompt: false,
          chatModelName: 'test-model',
          imageGenEnabled: true,
          message: 'draw a cat please',
        })) {
          yield evt;
        }
      }

      const resp = chatStreamToSseResponse(events());
      const body = await resp.text();
      const parsed = parseSse(body);

      console.log('线上事件序列:', parsed.map((e) => e.type).join(' → '));
      expect(parsed.some((e) => e.type === 'tool_call')).toBe(true);
      expect(parsed.some((e) => e.type === 'tool_result')).toBe(true);
      expect(parsed.some((e) => e.type === 'agent_file')).toBe(true);
    },
    120_000
  );
});
