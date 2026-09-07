import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';

import {
  computeWorkspaceGeneration,
  getPiProcess,
  killPiProcess,
  preparePiWorkspace,
  runPiAgent,
  registerPiProcess,
  countActivePiProcesses,
  reapIdlePiProcesses,
  evictLeastRecentlyUsedPiProcess,
  type PiProcessEntry,
} from '../../src/services/pi-agent-service.js';
import { createPiRoundState } from '../../src/services/pi/registry.js';

const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime');
const UID = 990005;
const WS_ID = `pi-reuse_${Date.now()}`;

/** openai-completions SSE mock：记录每轮请求中的 user 消息数（验证上下文不重复）。 */
async function startMock(): Promise<{ server: Server; port: number; userCounts: number[] }> {
  const userCounts: number[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
      userCounts.push(msgs.filter((m: { role?: string }) => m && m.role === 'user').length);
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
  return { server, port, userCounts };
}

function chatModel(port: number, modelName = 'test-model') {
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: 'k',
    modelName,
    multimodal: false,
  };
}

async function runTurn(opts: {
  port: number;
  generation: string;
  message: string;
  signal?: AbortSignal;
}): Promise<{ procId: number | null; events: { type: string }[] }> {
  const prepared = preparePiWorkspace(UID, WS_ID, {
    agentId: 1,
    chatModel: chatModel(opts.port),
    imageModel: null,
    skillNames: [],
  });
  const events: { type: string }[] = [];
  for await (const evt of runPiAgent({
    userId: UID,
    workspaceId: WS_ID,
    ws: prepared.ws,
    hasPrompt: prepared.hasPrompt,
    chatModelName: 'test-model',
    imageGenEnabled: false,
    message: opts.message,
    generation: opts.generation,
    signal: opts.signal,
  })) {
    events.push(evt);
  }
  return { procId: getPiProcess(UID, WS_ID)?.procId ?? null, events };
}

describe('computeWorkspaceGeneration（配置代数）', () => {
  const base = () => ({
    userId: 1,
    agentId: 7,
    skillNames: [] as string[],
    chatModel: {
      baseUrl: 'http://x/v1',
      apiKey: 'k',
      modelName: 'm',
      multimodal: false,
      apiFormat: null,
      thinkingFormat: null,
      contextWindow: 128000,
      maxTokens: 16384,
    },
    imageModel: null,
    extensionNames: [] as string[],
  });

  it('相同配置 → 代数稳定；互不影响的字段不变动时不变', () => {
    expect(computeWorkspaceGeneration(base())).toBe(computeWorkspaceGeneration(base()));
  });

  it('模型名 / 提示词所属 agentId / skill / 扩展任一变化 → 代数变化', () => {
    const gen = computeWorkspaceGeneration(base());
    expect(computeWorkspaceGeneration({ ...base(), chatModel: { ...base().chatModel, modelName: 'm2' } })).not.toBe(gen);
    expect(computeWorkspaceGeneration({ ...base(), agentId: 8 })).not.toBe(gen);
    expect(computeWorkspaceGeneration({ ...base(), skillNames: ['s1'] })).not.toBe(gen);
    expect(computeWorkspaceGeneration({ ...base(), extensionNames: ['@x/y'] })).not.toBe(gen);
  });

  it('绘图模型有无 / 内容变化 → 代数变化', () => {
    const gen = computeWorkspaceGeneration(base());
    const withImg = {
      ...base(),
      imageModel: { baseUrl: 'http://img/v1', apiKey: 'ik', modelName: 'img' },
    };
    expect(computeWorkspaceGeneration(withImg)).not.toBe(gen);
    expect(
      computeWorkspaceGeneration({ ...withImg, imageModel: { ...withImg.imageModel!, modelName: 'img2' } })
    ).not.toBe(computeWorkspaceGeneration(withImg));
  });
});

describe('runPiAgent 进程复用（配置代数 + 常驻 RPC）', () => {
  let mock: { server: Server; port: number; userCounts: number[] };

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
    '同一代数两轮：第二轮回用同进程（procId 不变），且模型侧上下文不重复（user 消息数 1→2）',
    async () => {
      const generation = computeWorkspaceGeneration({
        userId: UID,
        agentId: 1,
        skillNames: [],
        chatModel: chatModel(mock.port),
        imageModel: null,
        extensionNames: [],
      });
      const t1 = await runTurn({ port: mock.port, generation, message: '第一问' });
      expect(t1.events.some((e) => e.type === 'content_delta')).toBe(true);
      expect(t1.procId).toBeTruthy();

      const t2 = await runTurn({ port: mock.port, generation, message: '第二问' });
      expect(t2.events.some((e) => e.type === 'content_delta')).toBe(true);
      expect(t2.events.some((e) => e.type === 'error')).toBe(false);
      // 关键断言：复用，未重拉进程
      expect(t2.procId).toBe(t1.procId);
      // 上下文不重复：第 1 轮模型收到 1 条 user，第 2 轮恰好 2 条（无重复注入）
      expect(mock.userCounts).toEqual([1, 2]);
    },
    120_000
  );

  it(
    '代数变化（改模型）→ 杀旧进程重拉（procId 变化）',
    async () => {
      const gen1 = computeWorkspaceGeneration({
        userId: UID,
        agentId: 1,
        skillNames: [],
        chatModel: chatModel(mock.port, 'test-model'),
        imageModel: null,
        extensionNames: [],
      });
      const gen2 = computeWorkspaceGeneration({
        userId: UID,
        agentId: 1,
        skillNames: [],
        chatModel: chatModel(mock.port, 'other-model'),
        imageModel: null,
        extensionNames: [],
      });
      expect(gen1).not.toBe(gen2);

      const t1 = await runTurn({ port: mock.port, generation: gen1, message: 'hi' });
      const t2 = await runTurn({ port: mock.port, generation: gen2, message: 'bye' });
      expect(t1.procId).toBeTruthy();
      expect(t2.procId).toBeTruthy();
      // 代数不同 → 必须重拉，进程 pid 变化
      expect(t2.procId).not.toBe(t1.procId);
      // 重拉后新进程从会话文件恢复历史：第 2 轮仍只含 2 条 user（历史延续不重复、不丢失）
      expect(mock.userCounts).toEqual([1, 2]);
    },
    120_000
  );

  it(
    '复用进程仍忙（entry.round 活跃，中断 kill 尚未收尾）→ 不复用，杀旧重拉，新轮不被 pi 拒绝',
    async () => {
      const generation = computeWorkspaceGeneration({
        userId: UID,
        agentId: 1,
        skillNames: [],
        chatModel: chatModel(mock.port),
        imageModel: null,
        extensionNames: [],
      });
      // 先跑一轮得到真实存活进程
      const t1 = await runTurn({ port: mock.port, generation, message: '第一问' });
      expect(t1.procId).toBeTruthy();
      expect(mock.userCounts).toEqual([1]);

      // 模拟中断竞态：上一轮 streamRound 尚未收尾（kill 异步），注册表里仍是活进程且 round 活跃。
      // 若此刻复用该进程发新 prompt，pi 会以「Agent is already processing」拒绝。
      let killed = 0;
      const busyChild = new EventEmitter() as unknown as PiProcessEntry['child'];
      const busyEntry: PiProcessEntry = {
        stdin: new Writable({ write(_c, _e, cb) { cb(); } }),
        procId: t1.procId!,
        ended: false,
        kill: () => {
          killed += 1;
          // 模拟 taskkill 后子进程 close（waitForPiExit 得以尽快返回，测试不空等 2s 兜底）
          (busyChild as unknown as EventEmitter).emit('close');
        },
        child: busyChild,
        alive: true,
        generation,
        lastUsed: Date.now(),
        round: createPiRoundState(),
        mapper: { lastError: null },
        lineBuf: '',
        stderrTail: '',
        stdoutEnded: false,
        closed: false,
        exitCode: null,
      };
      registerPiProcess(UID, WS_ID, busyEntry);

      const t2 = await runTurn({ port: mock.port, generation, message: '继续' });
      // 忙进程被杀掉重拉：不复用，且新轮成功产出（不再被「Agent is already processing」拒绝）
      expect(killed).toBe(1);
      expect(t2.procId).toBeTruthy();
      expect(t2.procId).not.toBe(t1.procId);
      expect(t2.events.some((e) => e.type === 'content_delta')).toBe(true);
      expect(t2.events.some((e) => e.type === 'error')).toBe(false);
      // 会话历史仍延续：第 2 轮模型收到 2 条 user（首轮 + 继续）
      expect(mock.userCounts).toEqual([1, 2]);
    },
    120_000
  );

  it(
    '手动暂停（signal abort）后发送新消息：旧进程注销退出，新轮重拉不报错且上下文延续',
    async () => {
      const generation = computeWorkspaceGeneration({
        userId: UID,
        agentId: 1,
        skillNames: [],
        chatModel: chatModel(mock.port),
        imageModel: null,
        extensionNames: [],
      });
      // 第 1 轮：流式中途中断（模拟用户点击停止/暂停按钮）
      const controller = new AbortController();
      const prepared = preparePiWorkspace(UID, WS_ID, {
        agentId: 1,
        chatModel: chatModel(mock.port),
        imageModel: null,
        skillNames: [],
      });
      const t1Events: { type: string }[] = [];
      for await (const evt of runPiAgent({
        userId: UID,
        workspaceId: WS_ID,
        ws: prepared.ws,
        hasPrompt: prepared.hasPrompt,
        chatModelName: 'test-model',
        imageGenEnabled: false,
        message: '第一问（中途中断）',
        generation,
        signal: controller.signal,
      })) {
        t1Events.push(evt);
        if (evt.type === 'content_delta') {
          controller.abort();
          break;
        }
      }

      // 第 2 轮：用户暂停后立即发送新消息
      const t2 = await runTurn({ port: mock.port, generation, message: '第二问（继续输出）' });
      // 关键断言：绝不报「Agent is already processing」
      expect(t2.events.some((e) => e.type === 'error')).toBe(false);
      expect(t2.events.some((e) => e.type === 'content_delta')).toBe(true);
      expect(t2.procId).toBeTruthy();
      // 上下文延续：模型收到了第 1 轮（未丢失）+ 第 2 轮
      expect(mock.userCounts).toEqual([1, 2]);
    },
    120_000
  );
});

describe('pi 进程生命周期（空闲回收 / LRU 上限）', () => {
  const unregs: Array<() => void> = [];
  afterEach(() => {
    for (const u of unregs) unregs.pop()!();
  });

  function fakeEntry(procId: number, lastUsed: number): PiProcessEntry {
    const stdin = new Writable({ write(_c, _e, cb) { cb(); } });
    return {
      stdin,
      procId,
      ended: false,
      kill: () => {},
      child: { pid: procId } as unknown as PiProcessEntry['child'],
      alive: true,
      generation: 'g',
      lastUsed,
      round: null,
      mapper: { lastError: null },
      lineBuf: '',
      stderrTail: '',
      stdoutEnded: false,
      closed: false,
      exitCode: null,
    };
  }

  it('空闲回收：超过 idleMs 未用的进程被杀并注销', () => {
    const now = Date.now();
    unregs.push(registerPiProcess(1, 'ws-a', fakeEntry(1, now - 60_000)));
    unregs.push(registerPiProcess(1, 'ws-b', fakeEntry(2, now - 1_000)));
    expect(countActivePiProcesses()).toBe(2);
    expect(reapIdlePiProcesses(10_000)).toBe(1);
    expect(countActivePiProcesses()).toBe(1);
  });

  it('LRU 上限：驱逐最近最久未用', () => {
    const now = Date.now();
    unregs.push(registerPiProcess(2, 'ws-lru-a', fakeEntry(1, now - 30_000)));
    unregs.push(registerPiProcess(2, 'ws-lru-b', fakeEntry(2, now - 5_000)));
    unregs.push(registerPiProcess(2, 'ws-lru-c', fakeEntry(3, now - 1000)));
    expect(evictLeastRecentlyUsedPiProcess()).toBe(true);
    expect(countActivePiProcesses()).toBe(2);
    // 最久未用的 ws-lru-a 被驱逐
    expect(getPiProcess(2, 'ws-lru-a')).toBeNull();
    expect(getPiProcess(2, 'ws-lru-b')).not.toBeNull();
  });
});
