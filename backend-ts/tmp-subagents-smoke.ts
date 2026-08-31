/**
 * 临时冒烟脚本（真实 pi 子进程 e2e）：验证 pi-subagents 扩展装配 + subagent 工具 + widget 桥。
 * 运行：cd backend-ts && tsx --env-file=.env tmp-subagents-smoke.ts
 * 用进程内 mock provider（openai-completions SSE），无需真实 API Key。
 */
// git-bash 下 .bin/tsx shim 会把 system32 从 PATH 弄丢，导致 killTree 里 spawn('taskkill') ENOENT
// （生产走 npm run（cmd）PATH 正常；此处仅为本脚本在 git-bash 直跑时兜底）
if (process.env.SystemRoot && !(process.env.PATH ?? '').toLowerCase().includes('system32')) {
  process.env.PATH = `${process.env.PATH};${process.env.SystemRoot}\\System32`;
}
// .env 配置了 HTTP(S)_PROXY；对本地 mock server 的请求必须绕过代理（pi 子进程继承本进程 env）
process.env.NO_PROXY = '127.0.0.1,localhost,0.0.0.0';

import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import {
  killPiProcess,
  preparePiWorkspace,
  runPiAgent,
} from './src/services/pi-agent-service.js';
import { withWidgetBridge, createWidgetStore } from './src/services/pi-widgets.js';

const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runtime');
const UID = 990003;
const WS_ID = `pi-subagents-smoke_${Date.now()}`;

/** mock：openai-completions SSE；返回 subagent tool_call（第一次非工具轮）。 */
async function startMock(): Promise<{ server: Server; port: number }> {
  let completions = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      completions += 1;
      const parsed = JSON.parse(body || '{}');
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
        // 工具结果返回后：模型给出总结文本
        res.write(chunk({ role: 'assistant', content: 'done' }));
        res.write(chunk({}, 'stop'));
      } else if (completions === 1) {
        // 第一轮：让模型调用 subagent 工具
        res.write(
          chunk({
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                index: 0,
                id: 'call_subagent',
                type: 'function',
                function: {
                  name: 'subagent',
                  arguments: JSON.stringify({ agent: 'reviewer', task: 'review this diff' }),
                },
              },
            ],
          }, 'tool_calls')
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

async function main(): Promise<void> {
  const mock = await startMock();
  const wsRoot = path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID);
  rmSync(wsRoot, { recursive: true, force: true });
  try {
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
    console.log('mounted extensions:', prepared.mountedExtensions.map((p) => path.basename(p)).join(', '));

    // 包 withWidgetBridge：验证 subagent 工具结果 → extension_widget(subagent-result)
    const events: Array<Record<string, unknown>> = [];
    for await (const evt of withWidgetBridge(
      runPiAgent({
        userId: UID,
        workspaceId: WS_ID,
        ws: prepared.ws,
        hasPrompt: prepared.hasPrompt,
        chatModelName: 'test-model',
        imageGenEnabled: false,
        extensions: prepared.mountedExtensions,
        message: 'ping',
        generation: `smoke-${Date.now()}`,
      }),
      { ws: prepared.ws, store: createWidgetStore(prepared.ws) }
    )) {
      events.push(evt as Record<string, unknown>);
    }

    const types = events.map((e) => e.type);
    console.log('event types:', [...new Set(types)].join(', '));
    const errors = events.filter((e) => e.type === 'error');
    if (errors.length) console.log('ERRORS:', JSON.stringify(errors.map((e) => e.message), null, 1));

    const subCall = events.find((e) => e.type === 'tool_call' && e.name === 'subagent');
    const subResult = events.find((e) => e.type === 'tool_result' && e.name === 'subagent');
    const widgets = events.filter((e) => e.type === 'extension_widget');
    const widget = widgets[0];

    console.log('--- smoke results ---');
    console.log('subagent tool_call seen:', !!subCall);
    if (subCall) console.log('  args:', String(subCall.arguments).slice(0, 120));
    console.log('subagent tool_result seen:', !!subResult);
    if (subResult) console.log('  result:', String(subResult.result));
    console.log('extension_widget count:', widgets.length);
    for (const w of widgets) {
      console.log('  key:', w.key, 'lines:', JSON.stringify((w as { lines?: unknown[] }).lines));
    }
    console.log('error events:', errors.length);

    const ok = !!subCall && !!subResult && !!widget && errors.length === 0;
    console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
    if (!ok) process.exitCode = 1;
  } finally {
    // 释放：杀常驻 RPC 子进程（taskkill 整树）+ 关 mock + 删工作区
    await killPiProcess(UID, WS_ID);
    await new Promise<void>((ok) => mock.server.close(() => ok()));
    rmSync(wsRoot, { recursive: true, force: true });
    // 清理 subagent temp 根（扩展可能 spawn 了子代理 runner；os.tmpdir 与扩展 TEMP_ROOT_DIR 口径一致）
    rmSync(path.join(os.tmpdir(), `pi-subagents-${UID}-${WS_ID}`), { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('smoke crashed:', err);
  process.exitCode = 1;
});
