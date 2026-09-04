import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, writeFileSync } from 'node:fs';

import {
  killPiProcess,
  preparePiWorkspace,
  runPiAgent,
} from '../../src/services/pi-agent-service.js';

// runtime/ 在仓库根目录下，测试文件位于 backend-ts/tests/api/，向上三层
const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime');

const UID = 990002;
const WS_ID = `pi-run_${Date.now()}`;
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 进程内 mock：openai-completions SSE + images generations（无需外部依赖与真实 Key）。
 *  failFirstCompletion > 0 时，前 N 次 chat completions 返回 429（模拟限流，触发 pi auto-retry）；
 *  failFirstCompletion < 0 时，所有 chat completions 一律 429（模拟上游持续不可用）。 */
async function startMock(failFirstCompletion = 0): Promise<{ server: Server; port: number }> {
  let completions = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/v1/images/generations') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
        return;
      }
      completions += 1;
      if (failFirstCompletion > 0 ? completions <= failFirstCompletion : failFirstCompletion < 0) {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 429, message: 'Provider returned error' }));
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
    // 常驻进程会在正常轮次后保留：先杀掉，避免与旧测试轮/文件锁冲突
    await killPiProcess(UID, WS_ID);
    rmSync(path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID), {
      recursive: true,
      force: true,
    });
    mock = await startMock();
  });

  afterEach(async () => {
    // runPiAgent 正常收尾不再 kill 子进程（复用语义）——测试必须显式释放，否则
    // 目录删除撞文件锁、vitest 退出挂起
    await killPiProcess(UID, WS_ID);
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
      // 会话文件必须落在 .pi-agent/run/ 子目录：agentDir 根下的 *.jsonl 会被 pi 启动迁移移入
      // sessions/{cwd编码}/，导致下一轮上下文静默重置
      expect(existsSync(path.join(prepared.ws, '.pi-agent', 'run', 'chat.jsonl'))).toBe(true);
      expect(existsSync(path.join(prepared.ws, '.pi-agent', 'chat.jsonl'))).toBe(false);
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

  it(
    '跨轮基线：产物只上报一次（换进程后不重复上报既有文件，轮末基线落盘持久）',
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
      // 第 1 轮：生图 → 差分上报 agent_file，并落盘基线
      const run1 = [];
      for await (const evt of runPiAgent({
        userId: UID,
        workspaceId: WS_ID,
        ws: prepared.ws,
        hasPrompt: false,
        chatModelName: 'test-model',
        imageGenEnabled: true,
        message: 'draw a cat',
      })) {
        run1.push(evt);
      }
      const files1 = run1.filter((e) => e.type === 'agent_file');
      expect(files1.length).toBeGreaterThanOrEqual(1);
      expect(existsSync(path.join(prepared.ws, '.pi-agent', 'snapshot.json'))).toBe(true);

      // 模拟进程重启：杀掉常驻子进程，下一轮按 generation 重拉新进程
      await killPiProcess(UID, WS_ID);

      // 第 2 轮：纯文本轮，无新文件 → 既有产物不得重复上报（基线跨进程/重启持久）
      const run2 = [];
      for await (const evt of runPiAgent({
        userId: UID,
        workspaceId: WS_ID,
        ws: prepared.ws,
        hasPrompt: false,
        chatModelName: 'test-model',
        imageGenEnabled: true,
        message: 'ping',
      })) {
        run2.push(evt);
      }
      const files2 = run2.filter((e) => e.type === 'agent_file');
      expect(files2).toEqual([]);
      expect(run2.some((e) => e.type === 'content_delta' && e.delta.includes('pong'))).toBe(true);
    },
    120_000
  );

  it(
    '限流重试轮：429 失败后 auto-retry 恢复成功，不得在流末尾误报 error',
    async () => {
      const failMock = await startMock(1);
      try {
        const prepared = preparePiWorkspace(UID, WS_ID, {
          agentId: 1,
          chatModel: {
            baseUrl: `http://127.0.0.1:${failMock.port}/v1`,
            apiKey: 'k',
            modelName: 'test-model',
            multimodal: false,
          },
          imageModel: null,
          skillNames: [],
        });
        // 缩短 pi auto-retry 退避（默认 2s 起指数退避），并禁用 SDK 层重试以走 pi 的 message_end 错误路径
        writeFileSync(
          path.join(prepared.ws, '.pi-agent', 'settings.json'),
          JSON.stringify({ retry: { enabled: true, maxRetries: 3, baseDelayMs: 20, provider: { maxRetries: 0 } } }),
          'utf-8'
        );
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
      } finally {
        await new Promise<void>((ok) => failMock.server.close(() => ok()));
      }
    },
    90_000
  );

  it(
    '持续限流轮：重试期间推 status 进展，最终错误文案友好可读',
    async () => {
      const failMock = await startMock(-1);
      try {
        const prepared = preparePiWorkspace(UID, WS_ID, {
          agentId: 1,
          chatModel: {
            baseUrl: `http://127.0.0.1:${failMock.port}/v1`,
            apiKey: 'k',
            modelName: 'test-model',
            multimodal: false,
          },
          imageModel: null,
          skillNames: [],
        });
        // 快速退避：总耗时可控，仍走完「失败 → 重试 → 再失败」完整链路
        writeFileSync(
          path.join(prepared.ws, '.pi-agent', 'settings.json'),
          JSON.stringify({ retry: { enabled: true, maxRetries: 2, baseDelayMs: 20, provider: { maxRetries: 0 } } }),
          'utf-8'
        );
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
        // 重试进展对用户可见：结构化 agent_retry 事件（前端渲染倒计时横幅）
        const retryEvents = events.flatMap((e) => (e.type === 'agent_retry' ? [e] : []));
        expect(retryEvents.length).toBeGreaterThanOrEqual(1);
        expect(retryEvents[0]).toMatchObject({
          attempt: 1,
          maxAttempts: 2,
          reason: '模型服务繁忙（限流）',
        });
        expect(typeof retryEvents[0]!.delaySec).toBe('number');
        // 收尾 error 事件恰好一条：友好原因 + 原始细节都在
        const errMsgs = events.flatMap((e) => (e.type === 'error' ? [e.message] : []));
        expect(errMsgs.length).toBe(1);
        expect(errMsgs[0]).toContain('模型服务繁忙（限流）');
        expect(errMsgs[0]).toContain('429');
      } finally {
        await new Promise<void>((ok) => failMock.server.close(() => ok()));
      }
    },
    90_000
  );
});
