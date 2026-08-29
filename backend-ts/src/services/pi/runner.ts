import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ChatStreamEvent } from '../../modules/bookplate/stream.js';
import {
  DISABLED_TOOLS,
  PI_SESSION_REL,
  RPC_AGENT_TIMEOUT_MS,
  resolveThinkingArgs,
} from './config.js';
import { resolveImageGenExtension, resolvePiBin } from './resolve.js';
import { killTree, registerPiProcess } from './registry.js';
import {
  appendArtifactManifest,
  isDiffExcluded,
  snapshotWorkspace,
  type ArtifactRecord,
} from './snapshot.js';
import {
  formatPiFailure,
  mapPiJsonEvent,
  type PiEventMapperState,
  type PiJsonEvent,
} from './events.js';
import { mimeOf, skillFileDownloadUrl } from '../file-utils.js';

/**
 * runPiAgent 运行器（RPC 模式编排）。
 *
 * 以 `pi --mode rpc` 常驻子进程运行（交互扩展通道所需）；json 一次性模式已废弃
 * （RPC 事件面是 json 事件面的超集）。事件面消费 mapPiJsonEvent，进程生命周期
 * 委托 registerPiProcess / killPiProcess，产物差分委托 snapshotWorkspace +
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
}

export async function* runPiAgent(opts: RunPiAgentOptions): AsyncGenerator<ChatStreamEvent> {
  const { cmd, args: binArgs } = resolvePiBin();

  // RPC 模式图片经 prompt 命令 images 字段直传（data URL → {type:"image",data,mimeType}），
  // 不落盘 inputs/（RPC 禁 @file argv；saveInputImages 留给 json 兼容路径不复用）。
  const images = opts.images?.length ? opts.images.slice(0, 4) : [];

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

  const agentDirEnv = path.join(opts.ws, '.pi-agent');
  const child = spawn(cmd, args, {
    cwd: opts.ws,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDirEnv,
      PI_AGENT_HOME: agentDirEnv,
      PI_TELEMETRY: '0',
    },
  });
  const childStdin = child.stdin;
  // 子进程 stdio 管道在进程崩溃/提前退出时会被异步销毁并 emit 'error'。stdout 已有
  // markStdoutEnd('error') 兜底，但 stdin/stderr 若无监听，Node 会把该 error 升级为未捕获
  // 异常——直接带崩整个后端 worker（多租户共享进程，影响面是全服）。补空监听防崩；
  // 真实诊断信息仍从 stderrTail（尾部捕获）与退出码给出。
  childStdin?.on('error', () => {});
  const unregister = registerPiProcess(
    opts.userId,
    opts.workspaceId,
    childStdin,
    child.pid ?? 0,
    () => killTree(child)
  );

  let abortRequested = false;
  const onAbort = () => {
    abortRequested = true;
    try {
      childStdin.write(JSON.stringify({ type: 'abort', id: 'abort-current' }) + '\n');
    } catch {
      /* stdin 已关：直接杀树 */
    }
    killTree(child);
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  const before = snapshotWorkspace(opts.ws);
  const stdout = child.stdout;
  const stderr = child.stderr;
  const stderrTailRef = { value: '' };
  stderr?.on('data', (c: Buffer) => {
    stderrTailRef.value = (stderrTailRef.value + c.toString('utf-8')).slice(-2000);
  });
  // 防崩：stderr 管道断裂时若无监听会升级为未捕获异常（见 childStdin 注释）
  stderr?.on('error', () => {});

  // 事件队列：stdout 行解析线程安全地入队，生成器按序出队
  const queue: ChatStreamEvent[] = [];
  const mapperState: PiEventMapperState = { lastError: null };
  let emittedError = false;
  let emittedAny = false;
  let stdoutEnded = false;
  let childClosed = false;
  /** prompt 已受理（response 命令 prompt success:true） */
  let promptAccepted = false;
  /** agent_settled（本轮完全落定；RPC 进程常驻，靠它驱动收尾） */
  let settledReceived = false;
  /** 本轮是否曾收到任何事件（零输出诊断） */
  let sawAnyEvent = false;
  /** 本轮超时强制收尾（RPC 进程常驻防死等；abort 后由 killTree 兜底） */
  let runTimedOut = false;
  /** 总超时定时器（try 内臂装；finally 清理）。 */
  let runTimeout: ReturnType<typeof setTimeout> | undefined;
  let rpcExitCode: number | null = null;
  let notify: (() => void) | null = null;
  const wake = (): void => {
    const n = notify;
    notify = null;
    n?.();
  };
  const pushEvent = (e: ChatStreamEvent): void => {
    queue.push(e);
    wake();
  };

  let lineBuf = '';
  const consumeLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    let evt: PiJsonEvent;
    try {
      evt = JSON.parse(trimmed) as PiJsonEvent;
    } catch {
      return;
    }
    if (evt.type === 'response') {
      // RPC 命令响应：只认 prompt 受理状态；其余事件面与本模式无关
      if (evt.command === 'prompt') {
        if (evt.success === true) promptAccepted = true;
        else {
          emittedError = true;
          pushEvent({
            type: 'error',
            message: `pi agent 已拒绝本轮消息${evt.error ? `：${String(evt.error)}` : ''}`,
          });
        }
      }
      wake();
      return;
    }
    if (evt.type === 'agent_settled') {
      settledReceived = true;
      sawAnyEvent = true;
      wake();
      return;
    }
    for (const e of mapPiJsonEvent(evt, mapperState)) {
      sawAnyEvent = true;
      if (e.type === 'error') emittedError = true;
      pushEvent(e);
    }
    wake();
  };

  stdout?.on('data', (c: Buffer) => {
    lineBuf += c.toString('utf-8');
    let idx: number;
    while ((idx = lineBuf.indexOf('\n')) >= 0) {
      const line = lineBuf.slice(0, idx);
      lineBuf = lineBuf.slice(idx + 1);
      consumeLine(line);
    }
  });
  const markStdoutEnd = (): void => {
    if (stdoutEnded) return;
    stdoutEnded = true;
    if (lineBuf) {
      const rest = lineBuf;
      lineBuf = '';
      consumeLine(rest);
    }
    wake();
  };
  stdout?.on('end', markStdoutEnd);
  stdout?.on('error', markStdoutEnd);
  const exitCode = new Promise<number | null>((resolve) => {
    child.on('close', (code) => {
      childClosed = true;
      wake();
      resolve(code);
    });
    child.on('error', () => {
      childClosed = true;
      wake();
      resolve(-1);
    });
  });

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
      childStdin.write(JSON.stringify(promptCmd) + '\n');
    } catch {
      // 子进程已退出/管道已断（如扩展装配失败启动即崩）：写回失败即本轮无法进行，
      // 记 emitError 走终局收尾，后续 by 出队循环的 error 终局条件立即 cleanup。
      emittedError = true;
      pushEvent({ type: 'error', message: 'pi agent 子进程已退出，无法受理本轮消息' });
    }

    // 总超时兜底（RPC 进程常驻防死等）：RPC_AGENT_TIMEOUT_MS，默认 10 分钟
    runTimeout = setTimeout(() => {
      runTimedOut = true;
      wake();
    }, RPC_AGENT_TIMEOUT_MS);
    runTimeout.unref?.();

    // 2) 出队循环：队列空且（agent_settled 已到 或 子进程已退出）时结束
    //    RPC 进程常驻——等待 agent_settled 信号后收尾。
    //    注意：不用 stdin.end() 让 pi 优雅退出——Windows 下 pi 的 shutdown 与
    //    扩展（pi-image-gen 等）的 async handle 存在 libuv 竞态（0xC0000409
    //    async.c Assertion），直接 killTree 更稳；agent_settled 即会话文件已
    //    落盘的权威信号（消息/工具结果/usage 均在起前写完）。
    let finalized = false;
    // 触发 kill 收尾的信号状态：agent_settled（本轮完全落定）｜超时｜已产出 error（prompt 被拒 /
    // 重试耗尽——继续等无意义）。RPC 进程常驻，靠这些信号主动收尾；abort 由 onAbort 的
    // killTree 兜底。收尾后等子进程真正退出（child close + stdout end）再 break：Windows 下
    // taskkill /F 后文件句柄释放有时延，过早返回会撞上删除/差分对工作区的并发访问。
    const isFinal = (): boolean => settledReceived || runTimedOut || emittedError;
    while (true) {
      if (queue.length) {
        emittedAny = true;
        yield queue.shift()!;
        continue;
      }
      if (isFinal() && !finalized) {
        finalized = true;
        // 直接用 killTree：绕开 pi 的 shutdown/exit 路径（Windows libuv async 竞态崩点）；
        // agent_settled 已给出会话落盘完成语义，kill 不丢数据。
        killTree(child);
      }
      if (childClosed && stdoutEnded) break;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }

    if (!emittedError) {
      if (abortRequested) {
        yield { type: 'status', message: '已中断' };
      } else if (runTimedOut) {
        emittedError = true;
        yield { type: 'error', message: 'pi agent 对话超时已强制结束，请重试' };
      } else {
        rpcExitCode = await exitCode;
        const lastError = mapperState.lastError;
        // settled 已收到（会话落盘完成）后，无论 pi 退出码如何都视为正常；
        // Windows 下强制 kill 会留非 0 退出码/断言崩溃码，不应误报。
        if ((!settledReceived && (rpcExitCode !== 0 || lastError))) {
          emittedError = true;
          if (lastError) {
            yield { type: 'error', message: formatPiFailure(lastError) };
          } else {
            const tail = stderrTailRef.value.trim();
            yield {
              type: 'error',
              message: `pi agent 执行失败（退出码 ${rpcExitCode}）${tail ? `\n${tail.split('\n').at(-1)}` : ''}`,
            };
          }
        } else if (!promptAccepted && !sawAnyEvent) {
          // 进程正常退出但 prompt 未被受理且无任何事件：多半是扩展加载异常 / 参数错
          const tail = stderrTailRef.value.trim();
          yield {
            type: 'error',
            message: `pi agent 未受理本轮消息（可能扩展装配异常）${
              tail ? `\n${tail.split('\n').at(-1)}` : ''
            }`,
          };
        }
      }
    }

    // 产物差分（新增或修改的文件）→ agent_file 卡片 + manifest 落盘（服务端可再到达）
    const after = snapshotWorkspace(opts.ws);
    const artifacts: ArtifactRecord[] = [];
    for (const [rel, stamp] of after) {
      if (isDiffExcluded(rel)) continue;
      const prev = before.get(rel);
      if (prev && prev.size === stamp.size && prev.mtimeMs === stamp.mtimeMs) continue;
      artifacts.push({ rel, mime: mimeOf(rel), size: stamp.size, mtimeMs: stamp.mtimeMs });
      emittedAny = true;
      yield {
        type: 'agent_file',
        file: {
          url: skillFileDownloadUrl(rel, opts.workspaceId),
          name: path.basename(rel),
          mime: mimeOf(rel),
          size: stamp.size,
          path: rel,
        },
      };
    }
    appendArtifactManifest(opts.ws, artifacts);

    // 零输出兜底诊断：pi 以 0 退出、无错误事件，但全程未产出任何事件（连会话文件都没落盘）。
    if (!emittedError && !abortRequested && !emittedAny) {
      const tail = stderrTailRef.value.trim();
      yield {
        type: 'error',
        message: `pi agent 执行结束但未产生任何输出，请检查扩展装配与模型配置${
          tail ? `\n${tail.split('\n').at(-1)}` : ''
        }`,
      };
    }
  } finally {
    clearTimeout(runTimeout);
    unregister();
    opts.signal?.removeEventListener('abort', onAbort);
    try {
      childStdin.end();
    } catch {
      /* stdin 已关：忽略 */
    }
    killTree(child);
  }
}