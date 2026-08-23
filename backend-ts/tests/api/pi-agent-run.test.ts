import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync } from 'node:fs';

import {
  preparePiWorkspace,
  runPiAgent,
} from '../../src/services/pi-agent-service.js';

// runtime/ 在仓库根目录下，测试文件位于 backend-ts/tests/api/，向上三层
const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime');

const UID = 990002;
const WS_ID = `pi-run_${Date.now()}`;
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 进程内 mock：openai-completions SSE + images generations（无需外部依赖与真实 Key）。 */
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
        const text = 'done';
        res.write(chunk({ role: 'assistant', content: text }));
        res.write(chunk({}, 'stop'));
      } else if (lastText.includes('draw a cat')) {
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
      } else {
        res.write(chunk({ role: 'assistant', content: 'pong' }));
        res.write(chunk({}, 'stop'));
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  return { server, port };
}

describe('runPiAgent（pi CLI 子进程端到端）', () => {
  let mock: { server: Server; port: number };

  beforeEach(async () => {
    rmSync(path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID), {
      recursive: true,
      force: true,
    });
    mock = await startMock();
  });

  afterEach(() => {
    mock.server.close();
    rmSync(path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID), {
      recursive: true,
      force: true,
    });
  });

  it(
    '文本轮：流式产出 content_delta 且无错误',
    async () => {
      const prepared = preparePiWorkspace(UID, WS_ID, {
        agentId: 1,
        chatModel: {
          baseUrl: `http://127.0.0.1:${mock.port}/v1`,
          apiKey: 'k',
          modelName: 'test-model',
          multimodal: false,
        },
        imageModel: null,
        skillNames: [],
      });
      const events = [];
      for await (const evt of runPiAgent({
        userId: UID,
        workspaceId: WS_ID,
        ws: prepared.ws,
        hasPrompt: false,
        chatModelName: 'test-model',
        imageGenEnabled: false,
        message: 'ping',
      })) {
        events.push(evt);
      }
      expect(events.some((e) => e.type === 'content_delta' && e.delta.includes('pong'))).toBe(true);
      expect(events.some((e) => e.type === 'error')).toBe(false);
    },
    90_000
  );

  it(
    '绘图轮：image_generate 工具调用可见，产物经差分推 agent_file',
    async () => {
      const prepared = preparePiWorkspace(UID, WS_ID, {
        agentId: 1,
        chatModel: {
          baseUrl: `http://127.0.0.1:${mock.port}/v1`,
          apiKey: 'k',
          modelName: 'test-model',
          multimodal: true,
        },
        imageModel: {
          baseUrl: `http://127.0.0.1:${mock.port}/v1`,
          apiKey: 'k',
          modelName: 'img-model',
        },
        skillNames: [],
      });
      const events = [];
      for await (const evt of runPiAgent({
        userId: UID,
        workspaceId: WS_ID,
        ws: prepared.ws,
        hasPrompt: false,
        chatModelName: 'test-model',
        imageGenEnabled: true,
        message: 'draw a cat',
      })) {
        events.push(evt);
      }
      expect(events.some((e) => e.type === 'tool_call' && e.name === 'image_generate')).toBe(true);
      expect(events.some((e) => e.type === 'tool_result' && e.name === 'image_generate')).toBe(true);
      expect(events.some((e) => e.type === 'error')).toBe(false);

      const files = events.filter((e) => e.type === 'agent_file');
      expect(files.length).toBeGreaterThanOrEqual(1);
      const f = files[0]!;
      expect(f.file.path).toMatch(/^outputs\/.+\.png$/);
      expect(f.file.mime).toBe('image/png');
      expect(f.file.url).toContain(`workspace_id=${encodeURIComponent(WS_ID)}`);
      expect(existsSync(path.join(prepared.ws, f.file.path))).toBe(true);
    },
    120_000
  );
});
