import { spawn } from 'node:child_process';

/**
 * pi 子进程管理（多租户并发核心）。
 *
 * 跟踪每个 {userId}:{workspaceId} 的活跃 RPC 子进程，提供：
 * - registerPiProcess / 注销（identity 校验，防过期轮误删新条目）
 * - killPiProcess（清空对话 / 主动释放）
 * - sendExtensionUiResponse（前端交互作答写回 stdin）
 *
 * worker 进程内单态注册表；key 口径与 nodeWorkspace 一致，杜绝跨账号同名 workspace 串扰。
 */

export interface PiProcessEntry {
  stdin: import('node:stream').Writable;
  /** 置位后视为已结束（API 404）；保证对已死进程不写 stdin（D5 竞态） */
  ended: boolean;
  procId: number;
  /** 终止回调（killTree；供 clearPiSession / abort 等外部语境使用） */
  kill: () => void;
}

const piProcessRegistry = new Map<string, PiProcessEntry>();

function piProcessKey(userId: number, workspaceId: string): string {
  return `${userId}:${workspaceId}`;
}

/**
 * 注册活跃 RPC 子进程（runPiAgent spawn 后调用）；返回注销函数（仅当仍是本次条目时移除）。
 * 顶替语义：同 key 旧进程若仍存活（错误路径下旧轮清理被跳过/延迟），立即终止老进程，
 * 防止两个 pi 进程共写同一会话文件导致上下文损坏；注销做 identity 校验，过期轮的
 * finally 清理不得误删新进程的注册项（否则 ui-response 会对新轮 404）。
 */
export function registerPiProcess(
  userId: number,
  workspaceId: string,
  stdin: PiProcessEntry['stdin'],
  procId: number,
  kill: () => void
): () => void {
  const key = piProcessKey(userId, workspaceId);
  const entry: PiProcessEntry = { stdin, ended: false, procId, kill };
  const prev = piProcessRegistry.get(key);
  if (prev && !prev.ended) {
    prev.ended = true;
    try {
      prev.kill();
    } catch {
      /* 进程可能已亡 */
    }
  }
  piProcessRegistry.set(key, entry);
  return () => {
    if (piProcessRegistry.get(key) === entry) {
      entry.ended = true;
      piProcessRegistry.delete(key);
    }
  };
}

/** 终止并注销某工作区的活跃 RPC 子进程（清空对话 / 主动释放语义）。 */
export function killPiProcess(userId: number, workspaceId: string): boolean {
  const entry = piProcessRegistry.get(piProcessKey(userId, workspaceId));
  if (!entry || entry.ended) return false;
  entry.ended = true;
  piProcessRegistry.delete(piProcessKey(userId, workspaceId));
  try {
    entry.kill();
  } catch {
    /* kill 失败忽略（进程可能已亡） */
  }
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
export function killTree(child: import('node:child_process').ChildProcess): void {
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