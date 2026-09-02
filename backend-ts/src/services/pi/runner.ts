import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ChatStreamEvent } from '../../modules/bookplate/stream.js';
import {
  DISABLED_TOOLS,
  PI_MAX_PROCESSES,
  PI_SESSION_REL,
  PI_SUBAGENT_LISTEN_HEARTBEAT_MS,
  PI_SUBAGENT_LISTEN_TIMEOUT_MS,
  RPC_AGENT_TIMEOUT_MS,
  resolveThinkingArgs,
} from './config.js';
import { resolveImageGenExtension, resolvePiBin } from './resolve.js';
import {
  createPiRoundState,
  countActivePiProcesses,
  evictLeastRecentlyUsedPiProcess,
  getPiProcess,
  killPiProcess,
  killTree,
  registerPiProcess,
  touchPiProcess,
  type PiProcessEntry,
} from './registry.js';
import { diffWorkspace, snapshotWorkspace } from './snapshot.js';
import { endgameDiagnostic } from './errors.js';
import { mapPiJsonEvent, type PiJsonEvent } from './events.js';
import { rpcEventSchema } from './schema.js';
import { resolveSubagentsTempRoot } from './subagents/cleanup.js';

/**
 * runPiAgent 运行器（RPC 模式编排，进程常驻复用）。
 *
 * 以 `pi --mode rpc` 常驻子进程运行（交互扩展通道所需）。子进程由 registry 持有并
 * 跨轮复用：同一配置代数（generation）直接向存活进程 stdin 发 prompt，跳过 spawn
 * 冷启动；代数变化（上游改接提示词/skill/模型/扩展）才杀旧进程重拉。空闲进程由
 * registry 后台定时器回收，全局并发上限按 LRU 驱逐。
 *
 * 事件面消费 mapPiJsonEvent，进程生命周期委托 registry，产物差分委托 snapshotWorkspace +
 * isDiffExcluded + appendArtifactManifest。
 */

export interface RunPiAgentOptions {
  userId: number;
  workspaceId: string;
  ws: string;
  hasPrompt: boolean;
  chatModelName: string;
  imageGenEnabled: boolean;
  message: string;
  images?: string[];
  /** 白名单扩展已装配目录（preparePiWorkspace.mountedExtensions；逐个追加 -e） */
  extensions?: string[];
  /** thinking 开关（'on'='--thinking high'、'off'、遗留档位透传；空/非法 = 跟随 pi 默认） */
  thinkingLevel?: string | null;
  signal?: AbortSignal;
  /** 进程复用判据：preparePiWorkspace 装配物的配置代数（computeWorkspaceGeneration）。
   *  相同 → 复用存活进程；不同/缺省空 → 重拉。 */
  generation?: string | null;
}

/** 组装 pi 启动参数（spawn 时一次性固化；复用的进程不重建）。 */
function buildSpawnArgs(opts: RunPiAgentOptions): { cmd: string; args: string[] } {
  const { cmd, args: binArgs } = resolvePiBin();
  const args = [...binArgs, '--mode', 'rpc', '--no-context-files'];
  const agentsMd = path.join(opts.ws, 'AGENTS.md');
  if (opts.hasPrompt && existsSync(agentsMd)) {
    args.push('--append-system-prompt', agentsMd);
  }
  if (opts.imageGenEnabled) {
    const ext = resolveImageGenExtension();
    if (ext) args.push('-e', ext);
  }
  // 白名单扩展（显式 -e，与 pi-image-gen 并列；-e 可重复）
  for (const extDir of opts.extensions ?? []) {
    args.push('-e', extDir);
  }
  // thinking（节点设置 on/off/遗留档位 → pi CLI；非法值静默忽略 = pi 默认）
  args.push(...resolveThinkingArgs(opts.thinkingLevel));
  // 工具黑名单（多租户风险收敛；pi 子进程模式无审批门，仅 allowlist/denylist 可控）
  for (const tool of DISABLED_TOOLS) {
    args.push('--exclude-tools', tool);
  }
  const sessionFile = path.join(opts.ws, PI_SESSION_REL);
  mkdirSync(path.dirname(sessionFile), { recursive: true });
  args.push('--session', sessionFile, '--provider', 'bookforge', '--model', `bookforge/${opts.chatModelName}`);
  return { cmd, args };
}

/** 唤醒条目当前轮的等待者（消费循环）。 */
function wakeRound(entry: PiProcessEntry): void {
  const round = entry.round;
  if (!round) return;
  const n = round.notify;
  if (n) {
    round.notify = null;
    n();
  }
}

/** 解析 stdout 一行 JSON 事件 → 分发到当前轮状态（无活跃轮则忽略，防跨轮串扰）。 */
function consumeLine(entry: PiProcessEntry, line: string): void {
  const round = entry.round;
  if (!round) return;
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return;
  }
  // 多租户外部进程边界：把 JSON.parse 后的宽断言收窄为 schema 校验（0.84.x 协议假设见
  // docs/skill-agent/rpc-invariants.md）。未知 type / 已知类型坏字段 → 静默忽略（与现状一致）。
  const parsed = rpcEventSchema.safeParse(raw);
  if (!parsed.success) return;
  const evt = parsed.data as PiJsonEvent;
  if (evt.type === 'response') {
    // RPC 命令响应：只认 prompt 受理状态；其余事件面与本模式无关
    if (evt.command === 'prompt') {
      if (evt.success === true) round.promptAccepted = true;
      else {
        round.emittedError = true;
        round.queue.push({
          type: 'error',
          message: `pi agent 已拒绝本轮消息${evt.error ? `：${String(evt.error)}` : ''}`,
        });
      }
    }
    wakeRound(entry);
    return;
  }
  if (evt.type === 'agent_settled') {
    round.settled = true;
    round.sawAnyEvent = true;
    wakeRound(entry);
    return;
  }
  if (evt.type === 'agent_start') {
    // 空闲监听态下：pi-subagents 后台子代理完成触发 triggerTurn 自动开的新轮起始。
    // 置 turnStarted 让监听循环重置 settled 并继续 yield 新一轮事件；同时向前端
    // 透传 turn_start（前端据此强制开启一条新的步骤气泡，避免续轮正文混入上一气泡）。
    if (round.listening) {
      round.turnStarted = true;
      round.queue.push({ type: 'turn_start' });
    }
    wakeRound(entry);
    return;
  }
  for (const e of mapPiJsonEvent(evt, entry.mapper)) {
    round.sawAnyEvent = true;
    if (e.type === 'error') round.emittedError = true;
    // 后台子代理运行状态：subagent_fleet 快照非空 = 有运行中后台任务（续轮监听依据）；
    // 快照为空 = 全部结束。tool_result 携带 asyncId/background 视为仍有后台任务。
    if (e.type === 'subagent_fleet') {
      round.backgroundRunsActive = e.runs.length > 0;
    } else if (e.type === 'tool_result' && e.name === 'subagent') {
      let bg = false;
      try {
        const parsed = JSON.parse(e.result) as {
          details?: { background?: unknown; asyncId?: unknown };
        };
        bg = parsed?.details?.background === true || typeof parsed?.details?.asyncId === 'string';
      } catch {
        /* 半截/非 JSON 信封：不据此判定 */
      }
      if (bg) round.backgroundRunsActive = true;
    }
    round.queue.push(e);
  }
  wakeRound(entry);
}

/** spawn 一个常驻 RPC 子进程并注册（stdout/stderr/close 解析挂在进程级，跨轮存活）。 */
function spawnPiProcess(opts: RunPiAgentOptions): PiProcessEntry {
  const { cmd, args } = buildSpawnArgs(opts);
  const agentDirEnv = path.join(opts.ws, '.pi-agent');
  const child = spawn(cmd, args, {
    cwd: opts.ws,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDirEnv,
      PI_AGENT_HOME: agentDirEnv,
      PI_TELEMETRY: '0',
      // pi-subagents 后台运行 temp 根按用户/工作区收敛：可枚举、可清理、多租户隔离
      // （扩展源码读 PI_SUBAGENTS_TEMP_ROOT 派生 async 运行目录）
      PI_SUBAGENTS_TEMP_ROOT: resolveSubagentsTempRoot(opts.userId, opts.workspaceId),
      // v1 关闭 wait 工具（其轮询/订阅增加后台驻留面；subagent_wait 不作为默认能力）
      PI_SUBAGENT_WAIT_TOOL_ENABLED: 'false',
    },
  });
  const childStdin = child.stdin;
  if (!childStdin) {
    throw new Error('pi agent 子进程 stdin 不可用');
  }
  // 子进程 stdio 管道在进程崩溃/提前退出时会被异步销毁并 emit 'error'。stdout 已有
  // markStdoutEnd('error') 兜底，但 stdin/stderr 若无监听，Node 会把该 error 升级为未捕获
  // 异常——直接带崩整个后端 worker（多租户共享进程，影响面是全服）。补监听防崩；
  // 真实诊断信息仍从 stderrTail（尾部捕获）与退出码给出。stdin error 同时标记写失败
  // 以驱动本轮收尾（复用竞态：进程在 getPiProcess 与写之间死去）。
  childStdin.on('error', () => {
    entry.alive = false;
    entry.closed = true;
    const round = entry.round;
    if (round && !round.writeFailed) {
      round.writeFailed = true;
      round.emittedError = true;
      round.queue.push({ type: 'error', message: 'pi agent 子进程已退出，无法受理本轮消息' });
    }
    wakeRound(entry);
  });
  const entry: PiProcessEntry = {
    stdin: childStdin,
    procId: child.pid ?? 0,
    ended: false,
    kill: () => killTree(child),
    child,
    alive: true,
    generation: opts.generation ?? null,
    lastUsed: Date.now(),
    round: null,
    mapper: { lastError: null },
    lineBuf: '',
    stderrTail: '',
    stdoutEnded: false,
    closed: false,
    exitCode: null,
  };

  child.stdout?.on('data', (c: Buffer) => {
    entry.lineBuf += c.toString('utf-8');
    let idx: number;
    while ((idx = entry.lineBuf.indexOf('\n')) >= 0) {
      const line = entry.lineBuf.slice(0, idx);
      entry.lineBuf = entry.lineBuf.slice(idx + 1);
      consumeLine(entry, line);
    }
  });
  const markStdoutEnd = (): void => {
    if (entry.stdoutEnded) return;
    entry.stdoutEnded = true;
    if (entry.lineBuf) {
      const rest = entry.lineBuf;
      entry.lineBuf = '';
      consumeLine(entry, rest);
    }
    wakeRound(entry);
  };
  child.stdout?.on('end', markStdoutEnd);
  child.stdout?.on('error', markStdoutEnd);
  child.stderr?.on('data', (c: Buffer) => {
    entry.stderrTail = (entry.stderrTail + c.toString('utf-8')).slice(-2000);
  });
  child.stderr?.on('error', () => {});
  child.on('close', (code) => {
    entry.closed = true;
    entry.exitCode = code;
    entry.alive = false;
    wakeRound(entry);
  });
  child.on('error', () => {
    entry.closed = true;
    entry.alive = false;
    wakeRound(entry);
  });
  registerPiProcess(opts.userId, opts.workspaceId, entry);
  return entry;
}

/**
 * 单轮流式执行：往（复用或新 spawn 的）RPC 进程发 prompt，消费事件直到 agent_settled。
 * 正常收尾不杀进程（保活供下一轮复用）；超时/错误/abort 才杀树报废。
 */
async function* streamRound(
  entry: PiProcessEntry,
  opts: RunPiAgentOptions
): AsyncGenerator<ChatStreamEvent> {
  const round = createPiRoundState();
  entry.round = round;
  entry.mapper.lastError = null;

  // RPC 模式图片经 prompt 命令 images 字段直传（data URL → {type:"image",data,mimeType}），
  // 不落盘 inputs/（RPC 禁 @file argv；saveInputImages 留给 json 兼容路径不复用）。
  const images = opts.images?.length ? opts.images.slice(0, 4) : [];

  const onAbort = () => {
    round.aborted = true;
    try {
      entry.stdin.write(JSON.stringify({ type: 'abort', id: 'abort-current' }) + '\n');
    } catch {
      /* stdin 已关：直接杀树 */
    }
    killTree(entry.child!);
    wakeRound(entry);
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  const before = snapshotWorkspace(opts.ws);
  let emittedAny = false;
  let runTimeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  try {
    // 1) 发送 prompt 命令（图片走 images 字段；RPC 禁止 @file）
    const promptCmd: Record<string, unknown> = { type: 'prompt', id: 'prompt-1', message: opts.message };
    const imageContents: Array<{ type: string; data: string; mimeType: string }> = [];
    for (const img of images) {
      const idx = typeof img === 'string' ? img.indexOf(',') : -1;
      if (idx < 0 || !img.startsWith('data:image/')) continue;
      const meta = img.slice(0, idx);
      const mime = /^data:image\/([a-z0-9.+-]+)/i.exec(meta)?.[1] ?? 'image/png';
      imageContents.push({ type: 'image', data: img.slice(idx + 1), mimeType: mime.replace('jpeg', 'jpg') });
    }
    if (imageContents.length) promptCmd['images'] = imageContents;
    try {
      entry.stdin.write(JSON.stringify(promptCmd) + '\n');
    } catch {
      // 子进程已退出/管道已断（复用竞态：getPiProcess 与写之间进程死亡）：本轮无法进行，
      // 置 writeFailed 走终局收尾。
      round.writeFailed = true;
      round.emittedError = true;
      round.queue.push({ type: 'error', message: 'pi agent 子进程已退出，无法受理本轮消息' });
    }
    if (!round.writeFailed && entry.closed) {
      round.writeFailed = true;
      round.emittedError = true;
      round.queue.push({ type: 'error', message: 'pi agent 子进程已退出，无法受理本轮消息' });
    }

    // 总超时兜底（RPC 进程常驻防死等）：RPC_AGENT_TIMEOUT_MS，默认 10 分钟
    runTimeout = setTimeout(() => {
      timedOut = true;
      wakeRound(entry);
    }, RPC_AGENT_TIMEOUT_MS);
    runTimeout.unref?.();

    // 2) 出队循环：队列空且（agent_settled 已到 或 子进程已退出）时结束本轮。
    //    正常收尾（settled）不杀进程——RPC 进程常驻，保留供下一轮复用；
    //    超时/错误/abort/写失败才杀树报废（下轮按 generation 重拉）。
    //    注意：不用 stdin.end() 让 pi 优雅退出——Windows 下 pi 的 shutdown 与
    //    扩展（pi-image-gen 等）的 async handle 存在 libuv 竞态（0xC0000409
    //    async.c Assertion），杀树更稳；agent_settled 即会话文件已落盘的权威信号。
    //    见 docs/skill-agent/rpc-invariants.md #1 / #5。
    const isFinal = (): boolean =>
      round.settled ||
      timedOut ||
      round.emittedError ||
      round.aborted ||
      round.writeFailed ||
      (entry.closed && entry.stdoutEnded);
    const isNormalSettle = (): boolean =>
      round.settled && !timedOut && !round.emittedError && !round.aborted && !round.writeFailed;

    // 单轮出队：消费事件直到 settled/异常终局；返回值表示是否正常收尾（settled 且无异常）。
    async function* drainRound(): AsyncGenerator<ChatStreamEvent, boolean> {
      let finalized = false;
      while (true) {
        if (round.queue.length) {
          emittedAny = true;
          yield round.queue.shift()!;
          continue;
        }
        if (isFinal() && !finalized) {
          finalized = true;
          if (isNormalSettle()) {
            // 正常收尾：进程保活复用
            entry.lastUsed = Date.now();
            return true;
          }
          // 异常/超时/abort：杀树报废（Windows taskkill /F 后文件句柄释放有时延，
          // 仍等 child close + stdout end 再返回，避免撞上删除/差分对工作区的并发访问）
          killTree(entry.child!);
          await killPiProcess(opts.userId, opts.workspaceId);
          return false;
        }
        if (finalized && entry.closed && entry.stdoutEnded) return false;
        await new Promise<void>((resolve) => {
          round.notify = resolve;
        });
      }
    }

    // 主轮：发送 prompt 后消费到 settled
    const mainNormal = yield* drainRound();

    // 3) 空闲监听续轮：主轮正常收尾且存在运行中的后台子代理 → 保持监听，
    //    捕获 pi-subagents triggerTurn 自动触发的新一轮（agent_start → turnStarted），
    //    续轮事件继续 yield 直至下一次 settled；后台任务全部结束 / 监听超时 / 异常才退出。
    //    监听期持续 touchPiProcess（防空闲回收 / LRU 误杀监听中的进程）。
    if (mainNormal && round.backgroundRunsActive) {
      round.listening = true;
      const listenStart = Date.now();
      let lastHeartbeat = 0;
      try {
        while (round.listening) {
          // 队列事件（fleet 更新 / turn_start / status 等）照常 yield（先于续轮判定，
          // 确保 turn_start 本身先送达前端，再进入新一轮出队）
          if (round.queue.length) {
            emittedAny = true;
            yield round.queue.shift()!;
            continue;
          }
          // 捕获到续轮起始：重置本轮，消费新一轮直到 settled
          if (round.turnStarted) {
            round.turnStarted = false;
            round.settled = false;
            const contNormal = yield* drainRound();
            if (!contNormal) break; // 续轮异常：收尾诊断走主流程
            // 续轮正常：若仍有后台任务继续监听，否则退出
            if (!round.backgroundRunsActive) break;
            continue;
          }
          // 退出条件：后台任务全部结束 / 异常终局 / 监听超时
          if (
            !round.backgroundRunsActive ||
            timedOut ||
            round.emittedError ||
            round.aborted ||
            round.writeFailed ||
            (entry.closed && entry.stdoutEnded)
          ) {
            round.listening = false;
            break;
          }
          if (Date.now() - listenStart >= PI_SUBAGENT_LISTEN_TIMEOUT_MS) {
            round.listening = false;
            break;
          }
          // 心跳：保持前端 SSE 连接活跃（重置前端 idle 超时，防后台长跑误杀连接）
          if (Date.now() - lastHeartbeat >= PI_SUBAGENT_LISTEN_HEARTBEAT_MS) {
            lastHeartbeat = Date.now();
            touchPiProcess(opts.userId, opts.workspaceId);
            yield { type: 'heartbeat' };
            continue;
          }
          await new Promise<void>((resolve) => {
            round.notify = resolve;
          });
        }
      } finally {
        round.listening = false;
      }
    }

    // 4) 错误终局诊断（正常收尾路径此处不产出）；逻辑收敛在 errors.endgameDiagnostic
    for (const e of endgameDiagnostic({
      settled: round.settled,
      aborted: round.aborted,
      timedOut,
      emittedError: round.emittedError,
      promptAccepted: round.promptAccepted,
      sawAnyEvent: round.sawAnyEvent,
      exitCode: entry.exitCode,
      lastError: entry.mapper.lastError,
      stderrTail: entry.stderrTail,
    })) {
      if (e.type === 'error') round.emittedError = true;
      yield e;
    }

    // 4) 产物差分（新增或修改的文件）→ agent_file 卡片 + manifest 落盘（服务端可再到达）
    const after = snapshotWorkspace(opts.ws);
    const { events: diffEvents } = diffWorkspace(before, after, opts.ws, opts.workspaceId);
    for (const e of diffEvents) {
      emittedAny = true;
      yield e;
    }

    // 5) 零输出兜底诊断：pi 以 0 退出、无错误事件，但全程未产出任何事件（连会话文件都没落盘）。
    if (!round.emittedError && !round.aborted && !emittedAny) {
      const tail = entry.stderrTail.trim();
      yield {
        type: 'error',
        message: `pi agent 执行结束但未产生任何输出，请检查扩展装配与模型配置${
          tail ? `\n${tail.split('\n').at(-1)}` : ''
        }`,
      };
    }
  } finally {
    clearTimeout(runTimeout);
    opts.signal?.removeEventListener('abort', onAbort);
    entry.round = null;
  }
}

export async function* runPiAgent(opts: RunPiAgentOptions): AsyncGenerator<ChatStreamEvent> {
  const generation = opts.generation ?? null;
  let entry = getPiProcess(opts.userId, opts.workspaceId);
  // 复用进程必须空闲（无活跃轮）。中断/abort 的 kill 是异步的：上一轮 streamRound 尚未
  // 收尾时 entry.round 仍活跃，直接把新 prompt 写到忙进程会被 pi 以
  // 「Agent is already processing. Specify streamingBehavior...」拒绝。忙则杀旧重拉，
  // 保证新轮独占空闲进程（会话文件仍延续，历史上下文不丢）。
  if (entry && entry.round) {
    await killPiProcess(opts.userId, opts.workspaceId);
    entry = null;
  }
  if (!entry || entry.generation !== generation) {
    // 无存活进程或配置代数变化：杀旧进程重拉（顶替语义防双写会话文件）
    if (entry) await killPiProcess(opts.userId, opts.workspaceId);
    // 全局并发上限：超限按 LRU 驱逐最近最久未用（多租户内存兜底）
    while (countActivePiProcesses() >= PI_MAX_PROCESSES) {
      if (!evictLeastRecentlyUsedPiProcess()) break;
    }
    entry = spawnPiProcess(opts);
  }
  touchPiProcess(opts.userId, opts.workspaceId);
  entry.lastUsed = Date.now();
  yield* streamRound(entry, opts);
}
