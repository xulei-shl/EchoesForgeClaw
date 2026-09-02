import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { ChatStreamEvent } from '../../modules/bookplate/stream.js';
import { PI_PROCESS_IDLE_MS } from './config.js';
import type { PiEventMapperState } from './events.js';

/**
 * pi 子进程会话注册表（多租户并发核心）。
 *
 * 跟踪每个 {userId}:{workspaceId} 的常驻 RPC 子进程及其生命周期：
 * - registerPiProcess / 注销（identity 校验，防过期轮误删新条目）
 * - killPiProcess（清空对话 / 主动释放 / 配置变更重拉）
 * - sendExtensionUiResponse（前端交互作答写回 stdin）
 * - 进程复用（runPiAgent 同一配置代数）：entry 带 generation/lastUsed，
 *   复用路径直接向存活进程 stdin 发 prompt，跳过 spawn 冷启动
 * - 空闲回收（reapIdlePiProcesses，后台定时器）与全局并发上限（LRU 驱逐）
 *
 * worker 进程内单态注册表；key 口径与 nodeWorkspace 一致，杜绝跨账号同名 workspace 串扰。
 */

/** 一轮 RPC 交互（一次 prompt 命令）的流式状态；由 runPiAgent 设置、stdout 解析器更新。 */
export interface PiRoundState {
  /** 本轮已归一化、待消费的 ChatStreamEvent 队列。 */
  queue: ChatStreamEvent[];
  /** agent_settled 已到（本轮完全落定，会话已落盘）。 */
  settled: boolean;
  /** prompt 命令已被受理（response prompt success）。 */
  promptAccepted: boolean;
  /** 本轮曾收到任何事件（零输出诊断）。 */
  sawAnyEvent: boolean;
  /** 本轮已产出错误（prompt 拒绝 / 模型失败），继续等无意义。 */
  emittedError: boolean;
  /** 消费方等待通知（stdout 行/状态变化时唤醒）。 */
  notify: (() => void) | null;
  /** abort 已请求。 */
  aborted: boolean;
  /** 写 stdin 失败（子进程已退出）。 */
  writeFailed: boolean;
  /**
   * 空闲监听态：主轮 settled 后、存在运行中的后台子代理时置位。
   * 置位期间 consumeLine 继续消费 stdout（捕获扩展 triggerTurn 自动触发的新轮），
   * 且 runPiAgent 复用判定据此不杀进程（用户新消息进前端队列，SSE 关闭后自动续发）。
   */
  listening: boolean;
  /**
   * 监听态下捕获到 pi 自动触发的新轮起始（agent_start）。续轮开始时消费方据此
   * 重置 settled=false 并继续 yield 事件直至下一次 agent_settled。
   */
  turnStarted: boolean;
  /** 是否存在运行中的后台子代理（subagent_fleet 快照 / tool_result asyncId 判定）。 */
  backgroundRunsActive: boolean;
}

export function createPiRoundState(): PiRoundState {
  return {
    queue: [],
    settled: false,
    promptAccepted: false,
    sawAnyEvent: false,
    emittedError: false,
    notify: null,
    aborted: false,
    writeFailed: false,
    listening: false,
    turnStarted: false,
    backgroundRunsActive: false,
  };
}

export interface PiProcessEntry {
  stdin: import('node:stream').Writable;
  /** 置位后视为已结束（API 404）；保证对已死进程不写 stdin（D5 竞态） */
  ended: boolean;
  procId: number;
  /** 终止回调（killTree；供 clearPiSession / abort / LRU / 空闲回收使用） */
  kill: () => void;
  /** 子进程引用（alive 判定）。 */
  child: ChildProcess | null;
  /** 子进程是否仍在运行（close/error 后置 false）。 */
  alive: boolean;
  /** 该进程 spawn 时的配置代数（preparePiWorkspace 装配物哈希）；复用的判据。 */
  generation: string | null;
  /** 最近一次完成交互的时间戳（空闲回收 / LRU 驱逐依据）。 */
  lastUsed: number;
  /** 当前活跃轮次（无则为 null）。 */
  round: PiRoundState | null;
  /** 事件映射跨轮状态（message_end 捕获的最新模型错误）。 */
  mapper: PiEventMapperState;
  /** stdout 行缓冲（跨块拼接 JSON 行）。 */
  lineBuf: string;
  /** stderr 尾部捕获（诊断用，最多 2000 字符）。 */
  stderrTail: string;
  /** stdout 已结束（end/error）。 */
  stdoutEnded: boolean;
  /** 子进程已关闭（close 事件）。 */
  closed: boolean;
  /** 子进程退出码（null = 尚未退出）。 */
  exitCode: number | null;
}

const piProcessRegistry = new Map<string, PiProcessEntry>();

function piProcessKey(userId: number, workspaceId: string): string {
  return `${userId}:${workspaceId}`;
}

function markKilled(entry: PiProcessEntry): void {
  entry.ended = true;
  try {
    entry.kill();
  } catch {
    /* 进程可能已亡 */
  }
}

/**
 * 注册常驻 RPC 子进程（runPiAgent spawn 后调用）；返回注销函数（仅当仍是本次条目时移除）。
 * 顶替语义：同 key 旧进程若仍存活（错误路径下旧轮清理被跳过/延迟），立即终止老进程，
 * 防止两个 pi 进程共写同一会话文件导致上下文损坏；注销做 identity 校验，过期轮的
 * finally 清理不得误删新进程的注册项（否则 ui-response 会对新轮 404）。
 * 见 docs/skill-agent/rpc-invariants.md #3。
 */
export function registerPiProcess(
  userId: number,
  workspaceId: string,
  entry: PiProcessEntry
): () => void {
  const key = piProcessKey(userId, workspaceId);
  const prev = piProcessRegistry.get(key);
  if (prev && !prev.ended) markKilled(prev);
  piProcessRegistry.set(key, entry);
  return () => {
    if (piProcessRegistry.get(key) === entry) {
      entry.ended = true;
      piProcessRegistry.delete(key);
    }
  };
}

/** 读取某工作区可复用的存活 RPC 进程（已结束/已退出 → null）。 */
export function getPiProcess(userId: number, workspaceId: string): PiProcessEntry | null {
  const entry = piProcessRegistry.get(piProcessKey(userId, workspaceId));
  if (!entry || entry.ended || !entry.alive || !entry.child) return null;
  return entry;
}

/** 刷新某工作区进程的 lastUsed（本轮完成时调用；空闲回收据此判定）。 */
export function touchPiProcess(userId: number, workspaceId: string): void {
  const entry = piProcessRegistry.get(piProcessKey(userId, workspaceId));
  if (entry && !entry.ended) entry.lastUsed = Date.now();
}

/** 当前存活的 RPC 进程数（并发上限判定）。 */
export function countActivePiProcesses(): number {
  let n = 0;
  for (const entry of piProcessRegistry.values()) {
    if (!entry.ended && entry.alive) n += 1;
  }
  return n;
}

/** 回收空闲进程（距 lastUsed 超过 idleMs）；返回被杀进程数。 */
export function reapIdlePiProcesses(idleMs: number): number {
  const now = Date.now();
  let killed = 0;
  for (const [key, entry] of [...piProcessRegistry]) {
    if (entry.ended || !entry.alive) continue;
    if (now - entry.lastUsed >= idleMs) {
      piProcessRegistry.delete(key);
      markKilled(entry);
      killed += 1;
    }
  }
  return killed;
}

/**
 * 终止并注销全部已注册 RPC 子进程（后端退出时统一回收，防孤儿进程永久驻留）。
 * pi CLI RPC 模式会一直等 stdin，后端死亡后不回收即变孤儿。仅在进程退出路径调用，
 * 不等待子进程真正退出（exit 钩子内禁止异步；taskkill 是同步 fire 的，足够）。
 */
export function killAllPiProcesses(): number {
  let killed = 0;
  for (const [key, entry] of [...piProcessRegistry]) {
    if (entry.ended || !entry.alive) continue;
    piProcessRegistry.delete(key);
    markKilled(entry);
    killed += 1;
  }
  return killed;
}

/** 驱逐最近最久未使用的存活进程（LRU）；无存活进程返回 false。 */
export function evictLeastRecentlyUsedPiProcess(): boolean {
  let oldestKey: string | null = null;
  let oldestUsed = Infinity;
  for (const [key, entry] of piProcessRegistry) {
    if (entry.ended || !entry.alive) continue;
    if (entry.lastUsed < oldestUsed) {
      oldestUsed = entry.lastUsed;
      oldestKey = key;
    }
  }
  if (!oldestKey) return false;
  const entry = piProcessRegistry.get(oldestKey);
  if (entry) {
    piProcessRegistry.delete(oldestKey);
    markKilled(entry);
  }
  return true;
}

/** 等待条目子进程真正退出（taskkill /F 异步；供 killPiProcess 后续 rmSync 不撞文件锁）。 */
function waitForPiExit(entry: PiProcessEntry): Promise<void> {
  const child = entry.child;
  if (!child || entry.closed) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => resolve();
    child.once('close', done);
    // 兜底：极端场景 close 延迟/丢失时短超时放行，不阻塞调用方
    const t = setTimeout(done, 2000);
    t.unref?.();
  });
}

/**
 * 终止并注销某工作区的常驻 RPC 子进程（清空对话 / 主动释放语义），
 * 并等待子进程真正退出（Windows taskkill 异步，保证后续删除工作区不撞文件锁）。
 */
export async function killPiProcess(userId: number, workspaceId: string): Promise<boolean> {
  const entry = piProcessRegistry.get(piProcessKey(userId, workspaceId));
  if (!entry || entry.ended) return false;
  piProcessRegistry.delete(piProcessKey(userId, workspaceId));
  markKilled(entry);
  await waitForPiExit(entry);
  return true;
}

/** 前端作答 → 写回活跃 RPC 子进程 stdin。返回 false = 进程不存在/已结束（404 语义）。 */
export function sendExtensionUiResponse(
  userId: number,
  workspaceId: string,
  body: { id: string; value?: string; confirmed?: boolean; cancelled?: boolean }
): boolean {
  const entry = piProcessRegistry.get(piProcessKey(userId, workspaceId));
  if (!entry || entry.ended) return false;
  const payload: Record<string, unknown> = { type: 'extension_ui_response', id: body.id };
  if (body.value !== undefined) payload['value'] = body.value;
  if (body.confirmed !== undefined) payload['confirmed'] = body.confirmed;
  if (body.cancelled !== undefined) payload['cancelled'] = body.cancelled;
  try {
    entry.stdin.write(JSON.stringify(payload) + '\n');
  } catch {
    // 管道已断（进程刚死、清理未及）：与「会话已结束」等效，置 ended 防后续重复写
    entry.ended = true;
    piProcessRegistry.delete(piProcessKey(userId, workspaceId));
    return false;
  }
  return true;
}

/** Windows 下 taskkill 杀整棵进程树；POSIX 直接 SIGKILL（pi 子进程组随之终止）。 */
export function killTree(child: ChildProcess): void {
  if (child.pid == null || child.exitCode != null) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch {
      /* 回退普通 kill */
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* 已退出 */
  }
}

// 后台空闲回收：周期性杀超时进程，防内存随活跃节点线性增长。
// unref：不阻塞进程退出；测试可显式调 reapIdlePiProcesses 验证。
const REAP_INTERVAL_MS = 60_000;
const reaper = setInterval(() => {
  try {
    reapIdlePiProcesses(PI_PROCESS_IDLE_MS);
  } catch {
    /* 回收失败不致命，下轮再试 */
  }
}, REAP_INTERVAL_MS);
reaper.unref?.();
