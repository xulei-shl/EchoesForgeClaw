/**
 * pi-subagents 后台运行残留清理（「清空对话」语义的安全项）。
 *
 * 后台（async）子代理是**分离 runner 进程**：父 RPC 进程被 kill（清会话/超时/LRU）后
 * 可能残留，继续消耗服务器资源。子进程 env 注入的 `PI_SUBAGENTS_TEMP_ROOT` 按
 * {userId}:{workspaceId} 收敛（见 runner.ts buildSpawnArgs），因此本模块按同一派生路径
 * 删除该工作区专属的 temp 根，并在删除前终止其中记录的 runner pid（status.json.pid）。
 *
 * 防御：仅当目录名确实带 workspaceId 特征时才删除（防 env 未生效时误删共享 temp 根）；
 * 删除失败不抛出（清理是尽力而为，不阻塞清会话主流程）。
 */
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/** 每用户/工作区 temp 根目录名（runner.ts 注入的 PI_SUBAGENTS_TEMP_ROOT 派生同一名字）。 */
export function subagentsTempRootName(userId: number, workspaceId: string): string {
  const safeWs = String(workspaceId).replace(/[^A-Za-z0-9._-]+/g, '-') || 'ws';
  return `pi-subagents-${userId}-${safeWs}`;
}

/** 扩展默认 temp 根派生自 TEMP_ROOT_DIR；本模块统一派生函数与 runner.ts 注入一致。 */
export function resolveSubagentsTempRoot(userId: number, workspaceId: string): string {
  return path.join(os.tmpdir(), subagentsTempRootName(userId, workspaceId));
}

/** 终止单个 runner 进程（POSIX SIGKILL；Windows taskkill /T /F 杀整树）。 */
function killRunnerPid(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* 进程可能已亡 */
    }
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* 已退出 */
  }
}

/**
 * 清理某用户/工作区的 subagent temp 根：先按 status.json 记录终止残留 runner，再删除目录。
 * 目录不存在 → 返回 0；归属特征不匹配（env 未生效的异常场景）→ 不动并返回 0。
 */
export function cleanupSubagentAsyncRuns(userId: number, workspaceId: string): number {
  const root = resolveSubagentsTempRoot(userId, workspaceId);
  if (!existsSync(root)) return 0;
  const base = path.basename(root);
  // 防御：归属不可证明 → 不动（保守）。精确全等匹配（不用 includes 真子串：语义不准——
  // userId 恒在 basename 中，includes 闸几乎永不触发）。正常路径（派生名一致）行为不变。
  if (base !== subagentsTempRootName(userId, workspaceId)) return 0;

  let killed = 0;
  const runsDir = path.join(root, 'async-subagent-runs');
  if (existsSync(runsDir)) {
    for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const statusFile = path.join(runsDir, entry.name, 'status.json');
      try {
        if (existsSync(statusFile)) {
          const parsed = JSON.parse(readFileSync(statusFile, 'utf-8')) as { pid?: unknown };
          if (typeof parsed.pid === 'number') {
            killRunnerPid(parsed.pid);
            killed += 1;
          }
        }
      } catch {
        /* 坏 status.json：跳过 pid 终止，目录仍随根删除 */
      }
    }
  }

  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* 尽力而为 */
  }
  return killed;
}
