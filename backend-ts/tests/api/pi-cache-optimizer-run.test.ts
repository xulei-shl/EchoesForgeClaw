import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, rmSync } from 'node:fs';

import { killPiProcess, preparePiWorkspace, runPiAgent } from '../../src/services/pi-agent-service.js';

// runtime/ 在仓库根目录下，测试文件位于 backend-ts/tests/api/，向上三层
const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime');

const UID = 990005;
const WS_ID = `pi-cache-optimizer_${Date.now()}`;

/** 进程内 mock：openai-completions SSE，回 'pong'（不依赖真实 Key）。 */
async function startMock(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta: unknown, finish?: string) =>
        `data: ${JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'test-model',
          choices: [{ index: 0, delta, finish_reason: finish ?? null }],
        })}\n\n`;
      res.write(chunk({ role: 'assistant', content: 'pong' }));
      res.write(chunk({}, 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  return { server, port };
}

/** 临时设置 pi 扩展白名单 env，运行后还原（防污染其它用例；vitest 不加载 .env）。 */
async function withPiExtensionsEnv(
  whitelist: string,
  fn: () => void | Promise<void>
): Promise<void> {
  const prevExt = process.env.PI_EXTENSIONS;
  try {
    process.env.PI_EXTENSIONS = whitelist;
    await fn();
  } finally {
    if (prevExt === undefined) delete process.env.PI_EXTENSIONS;
    else process.env.PI_EXTENSIONS = prevExt;
  }
}

describe('runPiAgent 加载 pi-cache-optimizer（RPC 冒烟）', () => {
  let mock: { server: Server; port: number };

  beforeEach(async () => {
    await killPiProcess(UID, WS_ID);
    rmSync(path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID), {
      recursive: true,
      force: true,
    });
    mock = await startMock();
  });

  afterEach(async () => {
    await killPiProcess(UID, WS_ID);
    mock.server.close();
    rmSync(path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID), {
      recursive: true,
      force: true,
    });
  });

  it(
    '白名单装配 + models.json 长缓存保留关闭 → 真实 RPC 子进程加载扩展，正常文本轮无错误、无 400',
    async () => {
      await withPiExtensionsEnv('pi-cache-optimizer', async () => {
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
        // 扩展已装配（resolvePiExtensions 候选③ = ~/.pi/agent/npm/node_modules，pi install 落点）
        expect(prepared.mountedExtensions).toContain(
          path.join(prepared.ws, '.pi-agent', 'extensions', 'pi-cache-optimizer')
        );
        // 装配的 models.json 显式关闭长缓存保留（pi 核心据此不注入 prompt_cache_key/retention）
        const provider = JSON.parse(
          readFileSync(path.join(prepared.ws, '.pi-agent', 'models.json'), 'utf-8')
        ).providers.bookforge;
        expect(provider.models[0].compat).toEqual({ supportsLongCacheRetention: false });

        // 真实 spawn pi --mode rpc：扩展加载失败会以「零输出」/ 启动错误暴露
        const events: Array<{ type: string; delta?: string }> = [];
        for await (const evt of runPiAgent({
          userId: UID,
          workspaceId: WS_ID,
          ws: prepared.ws,
          hasPrompt: false,
          chatModelName: 'test-model',
          imageGenEnabled: false,
          extensions: prepared.mountedExtensions,
          message: 'ping',
        })) {
          events.push(evt as { type: string; delta?: string });
        }
        expect(events.some((e) => e.type === 'content_delta' && e.delta?.includes('pong'))).toBe(true);
        // 无错误事件（扩展加载 / prompt 重排 / cache-retention 均不报错）
        expect(events.some((e) => e.type === 'error')).toBe(false);
      });
    },
    90_000
  );
});
