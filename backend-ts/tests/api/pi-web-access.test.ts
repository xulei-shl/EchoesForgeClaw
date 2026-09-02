import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import {
  killPiProcess,
  preparePiWorkspace,
  resolvePiExtensions,
  runPiAgent,
} from '../../src/services/pi-agent-service.js';

// runtime/ 在仓库根目录下，测试文件位于 backend-ts/tests/api/，向上三层
const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime');

const UID = 990003;
const WS_ID = `pi-web-access_${Date.now()}`;

/**
 * 进程内 mock：非工具轮一律返回 web_search tool_call（provider=duckduckgo，keyless、无需额外凭据，
 * 避免 Exa MCP 依赖与真实 Key）；工具轮返回纯文本收尾。pi 扩展的真实执行（网络成败）不影响断言——
 * 断言的是「扩展装载 → web_search 工具路由 → tool_call/tool_result 穿流」这一集成闭环。
 */
function startMock(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}') as { messages?: Array<{ role?: string; content?: unknown }> };
      const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
      const last = msgs[msgs.length - 1];
      const isToolTurn = last && last.role === 'tool';
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
        res.write(chunk({ role: 'assistant', content: 'search-round-done' }));
        res.write(chunk({}, 'stop'));
      } else {
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
                    name: 'web_search',
                    arguments: JSON.stringify({ query: 'pi-web-access smoke', provider: 'duckduckgo', numResults: 3 }),
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
  return new Promise<{ server: Server; port: number }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as { port: number }).port });
    });
  });
}

/** 临时设置 PI_EXTENSIONS，运行后还原当前值。 */
function withPiExtensions<T>(whitelist: string, fn: () => T): T {
  const prev = process.env.PI_EXTENSIONS;
  process.env.PI_EXTENSIONS = whitelist;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.PI_EXTENSIONS;
    else process.env.PI_EXTENSIONS = prev;
  }
}

/** pi-web-access 是否在本机可解析（pi install 落点 / 依赖树）；缺失时整体跳过。 */
const PI_WEB_ACCESS_AVAILABLE = withPiExtensions('pi-web-access', () =>
  resolvePiExtensions().some((e) => e.name === 'pi-web-access')
);

describe('pi-web-access 扩展 RPC 冒烟（真实包 + web-search.json 装配）', () => {
  let mock: { server: Server; port: number };

  beforeEach(async () => {
    await killPiProcess(UID, WS_ID);
    rmSync(path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID), { recursive: true, force: true });
    mock = await startMock();
  });

  afterEach(async () => {
    withPiExtensions('', () => {});
    await killPiProcess(UID, WS_ID);
    mock.server.close();
    rmSync(path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID), { recursive: true, force: true });
  });

  it.skipIf(!PI_WEB_ACCESS_AVAILABLE)(
    'web-search.json 正确落盘（key + workflow=auto-summary + 保留未知键）+ web_search 工具端到端穿流、无 error',
    async () => {
      const ws = path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID);
      const agentDir = path.join(ws, '.pi-agent');
      mkdirSync(agentDir, { recursive: true });
      // 预置未知键（验证装配保留）；provider 定向 duckduckgo（keyless，无需外部凭据）
      writeFileSync(path.join(agentDir, 'web-search.json'), JSON.stringify({ provider: 'duckduckgo' }), 'utf-8');

      const prepared = withPiExtensions('pi-web-access', () =>
        preparePiWorkspace(UID, WS_ID, {
          agentId: 1,
          chatModel: {
            baseUrl: `http://127.0.0.1:${mock.port}/v1`,
            apiKey: 'k',
            modelName: 'test-model',
            multimodal: false,
          },
          imageModel: null,
          skillNames: [],
          webSearchConfig: { exaApiKey: 'exa-smoke', anysearchApiKey: 'any-smoke', tavilyApiKey: 'tvly-smoke' },
        })
      );
      // pi-web-access 被白名单装配进 {ws}/.pi-agent/extensions/
      expect(prepared.mountedExtensions.some((d) => d.includes('pi-web-access'))).toBe(true);

      // web-search.json：受支持 key 写入 + 固定 workflow + 保留未知键 provider
      const wsCfg = JSON.parse(readFileSync(path.join(agentDir, 'web-search.json'), 'utf-8')) as Record<string, unknown>;
      expect(wsCfg.exaApiKey).toBe('exa-smoke');
      expect(wsCfg.anysearchApiKey).toBe('any-smoke');
      expect(wsCfg.tavilyApiKey).toBe('tvly-smoke');
      expect(wsCfg.workflow).toBe('auto-summary');
      expect(wsCfg.provider).toBe('duckduckgo');
      expect(wsCfg.zhihuAccessSecret).toBeUndefined();

      const events: Array<{ type: string; name?: string; result?: string }> = [];
      for await (const evt of runPiAgent({
        userId: UID,
        workspaceId: WS_ID,
        ws: prepared.ws,
        hasPrompt: false,
        chatModelName: 'test-model',
        imageGenEnabled: false,
        extensions: prepared.mountedExtensions,
        message: 'search something for me',
      })) {
        events.push(evt as { type: string; name?: string; result?: string });
      }

      // 扩展装载 + 工具路由闭环：tool_call / tool_result 均以 web_search 出现，且无流级 error
      expect(events.some((e) => e.type === 'tool_call' && e.name === 'web_search')).toBe(true);
      expect(events.some((e) => e.type === 'tool_result' && e.name === 'web_search')).toBe(true);
      expect(events.some((e) => e.type === 'error')).toBe(false);
      // pi-web-access 实际执行过搜索：结果信封非空（无论网络成败——离线时也是错误信封而非空）
      const searchResult = events.find((e) => e.type === 'tool_result' && e.name === 'web_search')?.result;
      expect(typeof searchResult).toBe('string');
      expect(searchResult!.length).toBeGreaterThan(0);
    },
    180_000
  );
});