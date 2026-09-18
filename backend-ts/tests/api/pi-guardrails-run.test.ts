import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

import {
  killPiProcess,
  preparePiWorkspace,
  runPiAgent,
  sendExtensionUiResponse,
} from '../../src/services/ai/pi-agent-service.js';

// runtime/ 在仓库根目录下，测试文件位于 backend-ts/tests/api/，向上三层
const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime');

const UID = 990004;
const WS_ID = `pi-guardrails_${Date.now()}`;

/**
 * 进程内 mock：openai-completions SSE（无需外部依赖与真实 Key）。
 * interactive=true 时：首轮提示「remove the build directory」触发 bash 工具调用
 * （rm -rf ./build，命中 permission-gate 危险命令）；工具结果轮回复 'done'。
 */
async function startMock(interactive = false): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
      const last = msgs[msgs.length - 1];
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
      if (interactive && last?.role === 'tool') {
        res.write(chunk({ role: 'assistant', content: 'done' }));
        res.write(chunk({}, 'stop'));
      } else if (interactive && lastText.includes('remove the build directory')) {
        res.write(
          chunk(
            {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_rm',
                  type: 'function',
                  function: {
                    name: 'bash',
                    arguments: JSON.stringify({ command: 'rm -rf ./build' }),
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

describe('runPiAgent 加载 pi-guardrails（RPC 冒烟）', () => {
  let mock: { server: Server; port: number };
  // mock 在 prepare 之前就要拼出工作区路径（与 preparePiWorkspace 的落盘口径一致）
  const wsDir = path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID);

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
    await killPiProcess(UID, WS_ID);
    mock.server.close();
    rmSync(path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID), {
      recursive: true,
      force: true,
    });
  });

  it(
    '白名单装配 + 自动配置落盘 → 真实 RPC 子进程加载 guardrails 扩展，正常文本轮无错误',
    async () => {
      await withPiExtensionsEnv('@aliou/pi-guardrails', async () => {
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
        // 扩展挂载 + 自动配置文件都已就位（完全自动，无需人工 onboarding）
        expect(prepared.mountedExtensions).toContain(
          path.join(prepared.ws, '.pi-agent', 'extensions', 'pi-guardrails')
        );
        const cfgPath = path.join(prepared.ws, '.pi-agent', 'extensions', 'guardrails.json');
        expect(existsSync(cfgPath)).toBe(true);

        // 真实 spawn pi --mode rpc：扩展加载失败会以「零输出」/ 启动错误暴露
        const events = [];
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
          events.push(evt);
        }
        expect(events.some((e) => e.type === 'content_delta' && e.delta.includes('pong'))).toBe(true);
        expect(events.some((e) => e.type === 'error')).toBe(false);
      });
    },
    90_000
  );

  it(
    'agent-runtime 规则：read 技能正文放行、运行态放行，读到 .pi-agent 密钥文件被拦（画板助手卡死的根因回归）',
    async () => {
      // 四轮 mock：read 技能 → read models.json → read .pi-agent/run/* → done。判定依据是 messages 里 tool 轮数
      const skillMock = await startMock();
      skillMock.server.removeAllListeners('request');
      skillMock.server.on('request', (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}') as { messages?: { role?: string }[] };
          const toolTurns = (parsed.messages ?? []).filter((m) => m.role === 'tool').length;
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          const chunk = (delta: unknown, finish?: string) =>
            `data: ${JSON.stringify({
              id: 'chatcmpl-mock',
              object: 'chat.completion.chunk',
              created: 0,
              model: 'test-model',
              choices: [{ index: 0, delta, finish_reason: finish ?? null }],
            })}\n\n`;
          const callRead = (filePath: string) =>
            chunk(
              {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    index: 0,
                    id: `call_read_${toolTurns}`,
                    type: 'function',
                    function: { name: 'read', arguments: JSON.stringify({ path: filePath }) },
                  },
                ],
              },
              'tool_calls'
            );
          try {
            if (toolTurns === 0) {
              res.write(callRead(path.join(wsDir, '.pi-agent', 'skills', 'canvas-node-catalog', 'SKILL.md')));
            } else if (toolTurns === 1) {
              res.write(callRead(path.join(wsDir, '.pi-agent', 'models.json')));
            } else if (toolTurns === 2) {
              res.write(callRead(path.join(wsDir, '.pi-agent', 'run', 'marker.txt')));
            } else {
              res.write(chunk({ role: 'assistant', content: 'done' }));
              res.write(chunk({}, 'stop'));
            }
          } finally {
            res.write('data: [DONE]\n\n');
            res.end();
          }
        });
      });

      try {
        await withPiExtensionsEnv('@aliou/pi-guardrails', async () => {
          const prepared = preparePiWorkspace(UID, WS_ID, {
            agentId: 1,
            chatModel: {
              baseUrl: `http://127.0.0.1:${skillMock.port}/v1`,
              apiKey: 'k',
              modelName: 'test-model',
              multimodal: false,
            },
            imageModel: null,
            // 技能真实挂载：正是画板助手装配到 .pi-agent/skills 的那棵资源树
            skillNames: ['canvas-node-catalog'],
          });
          expect(prepared.mountedSkills).toContain('canvas-node-catalog');
          // 收窄校验：.pi-agent/run（Agent 自身不含密钥的运行态）应可读——
          // 它不随装配被清理（仅 clearPiSession 清空对话时删），故此处写入的标记可稳定读到
          const runDir = path.join(prepared.ws, '.pi-agent', 'run');
          mkdirSync(runDir, { recursive: true });
          writeFileSync(path.join(runDir, 'marker.txt'), 'RUN_MARKER_OK', 'utf-8');

          const events = [];
          for await (const evt of runPiAgent({
            userId: UID,
            workspaceId: WS_ID,
            ws: prepared.ws,
            hasPrompt: false,
            chatModelName: 'test-model',
            imageGenEnabled: false,
            extensions: prepared.mountedExtensions,
            message: 'read your skill, models.json, then run/marker.txt',
          })) {
            events.push(evt);
            if (evt.type === 'extension_ui_request' && evt.method === 'select') {
              sendExtensionUiResponse(UID, WS_ID, { id: evt.id, value: 'Allow once' });
            }
          }

          const results = events.filter(
            (e): e is typeof e & { result: string } => e.type === 'tool_result'
          );
          expect(results.length).toBeGreaterThanOrEqual(3);
          // 1) 技能正文读到（这才是渐进式披露能工作的前提）
          expect(results[0]!.result).toContain('画布节点类型目录');
          // 2) 同一棵 .pi-agent 下的密钥文件被策略拦下
          expect(results[1]!.result).toContain('is not allowed');
          expect(results[1]!.result).toContain('models.json');
          // 3) 收窄后运行态不再被封（曾使 Agent 找上下文时空转）
          expect(results[2]!.result).toContain('RUN_MARKER_OK');
          expect(results[2]!.result).not.toContain('is not allowed');
        });
      } finally {
        await new Promise<void>((ok) => skillMock.server.close(() => ok()));
      }
    },
    90_000
  );

  it(
    '危险命令轮：permission-gate 走 RPC dialog（select 回退）→ 作答后命令放行、轮次正常落定',
    async () => {
      const interactiveMock = await startMock(true);
      try {
        await withPiExtensionsEnv('@aliou/pi-guardrails', async () => {
          const prepared = preparePiWorkspace(UID, WS_ID, {
            agentId: 1,
            chatModel: {
              baseUrl: `http://127.0.0.1:${interactiveMock.port}/v1`,
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
            extensions: prepared.mountedExtensions,
            message: 'remove the build directory',
          })) {
            events.push(evt);
            // RPC dialog 到达：写回答（Allow once）驱动工具继续，模拟前端 POST /chat/ui-response
            if (evt.type === 'extension_ui_request' && evt.method === 'select') {
              const ok = sendExtensionUiResponse(UID, WS_ID, {
                id: evt.id,
                value: 'Allow once',
              });
              expect(ok).toBe(true);
            }
          }
          // bash 工具调用可见，且 permission-gate 以 select dialog 提问（RPC 下 custom() 不可用）
          expect(events.some((e) => e.type === 'tool_call' && e.name === 'bash')).toBe(true);
          const dialogs = events.filter(
            (e): e is typeof e & { method: string; options: string[] } =>
              e.type === 'extension_ui_request' && e.method === 'select'
          );
          expect(dialogs.length).toBe(1);
          expect(dialogs[0]!.options).toContain('Allow once');
          expect(dialogs[0]!.options).toContain('Deny');
          // 作答后命令执行、工具结果回传模型、轮次正常落定（无 error）
          expect(events.some((e) => e.type === 'tool_result' && e.name === 'bash')).toBe(true);
          expect(events.some((e) => e.type === 'content_delta' && e.delta.includes('done'))).toBe(true);
          expect(events.some((e) => e.type === 'error')).toBe(false);
        });
      } finally {
        await new Promise<void>((ok) => interactiveMock.server.close(() => ok()));
      }
    },
    90_000
  );
});

/**
 * 按 Agent 收敛工具面（`runPiAgent.excludeTools` → pi `--exclude-tools`）。
 * 画板助手不需要 shell，而 shell 是 guardrails 路径提取唯一可绕过的面
 * （见 docs/skill-agent/pi-guardrails管理员策略控制模型.md 第 8 节）。
 */
describe('runPiAgent excludeTools（按 Agent 收敛工具面）', () => {
  // 独立 workspaceId：避免与上一个 describe 留下的常驻进程/代数复用搅在一起
  const WS_ID_EXCLUDED = `pi-exclude-tools_${Date.now()}`;
  let mock: { server: Server; port: number };
  let seenTools: string[] = [];

  beforeEach(async () => {
    await killPiProcess(UID, WS_ID_EXCLUDED);
    rmSync(path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID_EXCLUDED), {
      recursive: true,
      force: true,
    });
    seenTools = [];
    // 复用 startMock 的监听端口，换成「记录工具清单后回 pong」的处理器
    mock = await startMock();
    mock.server.removeAllListeners('request');
    mock.server.on('request', (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}') as { tools?: { function?: { name?: string } }[] };
        seenTools = (parsed.tools ?? []).map((t) => String(t.function?.name ?? ''));
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
  });

  afterEach(async () => {
    await killPiProcess(UID, WS_ID_EXCLUDED);
    mock.server.close();
    rmSync(path.join(RUNTIME_ROOT, String(UID), 'workspace', WS_ID_EXCLUDED), {
      recursive: true,
      force: true,
    });
  });

  it(
    'excludeTools: ["bash"] 时 bash 不再出现在发给模型的工具清单里，其它内置工具保留',
    async () => {
      const prepared = preparePiWorkspace(UID, WS_ID_EXCLUDED, {
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
        workspaceId: WS_ID_EXCLUDED,
        ws: prepared.ws,
        hasPrompt: false,
        chatModelName: 'test-model',
        imageGenEnabled: false,
        extensions: prepared.mountedExtensions,
        excludeTools: ['bash'],
        message: 'ping',
      })) {
        events.push(evt);
      }

      expect(events.some((e) => e.type === 'error')).toBe(false);
      expect(seenTools.length).toBeGreaterThan(0);
      expect(seenTools).not.toContain('bash');
      expect(seenTools).toContain('read');
    },
    90_000
  );
});