import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { createUIMessageStream } from 'ai';

import { preparePiWorkspace, runPiAgent } from '../../src/services/pi-agent-service.js';

/** 与 stream.ts chatStreamToResponse 相同的映射（内联复制以隔离验证线协议）。 */
function mapToUIStream(events: AsyncIterable<any>) {
  let textStarted = false;
  let reasoningStarted = false;
  const MESSAGE_ID = 'assistant';
  return createUIMessageStream({
    execute: async ({ writer }) => {
      for await (const evt of events) {
        switch (evt.type) {
          case 'content_delta':
            if (evt.delta === '') break;
            if (!textStarted) { writer.write({ type: 'text-start', id: MESSAGE_ID }); textStarted = true; }
            writer.write({ type: 'text-delta', id: MESSAGE_ID, delta: evt.delta });
            break;
          case 'reasoning_delta':
            if (evt.delta === '') break;
            if (!reasoningStarted) { writer.write({ type: 'reasoning-start', id: MESSAGE_ID }); reasoningStarted = true; }
            writer.write({ type: 'reasoning-delta', id: MESSAGE_ID, delta: evt.delta });
            break;
          case 'tool_call':
            writer.write({ type: 'data-agent_tool_call', data: { id: evt.id, name: evt.name, arguments: evt.arguments }, transient: true });
            break;
          case 'tool_result':
            writer.write({ type: 'data-agent_tool_result', data: { id: evt.id, name: evt.name, result: evt.result }, transient: true });
            break;
          case 'agent_file':
            writer.write({ type: 'data-agent_file', data: evt.file, transient: true });
            break;
        }
      }
      if (textStarted) writer.write({ type: 'text-end', id: MESSAGE_ID });
      if (reasoningStarted) writer.write({ type: 'reasoning-end', id: MESSAGE_ID });
      writer.write({ type: 'finish', finishReason: 'stop' });
    },
  });
}

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

describe('runPiAgent → UI Message Stream 线协议（工具日志到达前端）', () => {
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
    '绘图轮：SSE 线上出现 data-agent_tool_call / data-agent_tool_result / data-agent_file',
    async () => {
      const prepared = preparePiWorkspace(UID, WS_ID, {
        agentId: 1,
        chatModel: { baseUrl: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'k', modelName: 'test-model', multimodal: true },
        imageModel: { baseUrl: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'k', modelName: 'img-model' },
        skillNames: [],
      });

      async function* events() {
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

      const types: string[] = [];
      const details: string[] = [];
      for await (const raw of mapToUIStream(events()) as unknown as AsyncIterable<unknown>) {
        // createUIMessageStream 产出 chunk 对象；SSE 序列化由 JsonToSseTransformStream 完成，这里等价复现
        const text = `data: ${JSON.stringify(raw)}\n\n`;
        for (const line of text.split('\n')) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const obj = JSON.parse(payload);
            types.push(obj.type);
            if (obj.type.startsWith('data-')) details.push(`${obj.type} transient=${!!obj.transient}`);
          } catch {
            /* 跨块截断行忽略（本测试关注类型序列） */
          }
        }
      }

      console.log('线上 chunk 序列:', types.join(' → '));
      console.log('data parts:', details.join(' | '));
      expect(types).toContain('data-agent_tool_call');
      expect(types).toContain('data-agent_tool_result');
      expect(types).toContain('data-agent_file');
    },
    120_000
  );
});
