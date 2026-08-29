import { afterEach, describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import {
  killPiProcess,
  registerPiProcess,
  sendExtensionUiResponse,
} from '../../src/services/pi-agent-service.js';

/** 可写的假 stdin：捕获写出的全部 JSON 行。 */
function makeFakeStdin(): { stdin: Writable; lines: string[] } {
  const lines: string[] = [];
  const stdin = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString('utf-8'));
      cb();
    },
  });
  return { stdin, lines };
}

const noopKill = () => {};

function lastJson(lines: string[]): Record<string, unknown> | null {
  if (!lines.length) return null;
  try {
    return JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('piProcessRegistry（RPC 子进程注册表）', () => {
  const unregs: Array<() => void> = [];
  afterEach(() => {
    for (const u of unregs) unregs.pop()!();
  });

  it('注册后可按 userId+workspaceId 复合 key 写回 extension_ui_response', () => {
    const { stdin, lines } = makeFakeStdin();
    unregs.push(registerPiProcess(7, 'ws-1', stdin, 101, noopKill));
    expect(sendExtensionUiResponse(7, 'ws-1', { id: 'u1', value: '选项A' })).toBe(true);
    expect(lastJson(lines)).toEqual({
      type: 'extension_ui_response',
      id: 'u1',
      value: '选项A',
    });
  });

  it('复合 key 隔离：同名 workspace 不同 userId 不串扰', () => {
    const a = makeFakeStdin();
    const b = makeFakeStdin();
    unregs.push(registerPiProcess(1, 'ws-shared', a.stdin, 1, noopKill));
    unregs.push(registerPiProcess(2, 'ws-shared', b.stdin, 2, noopKill));
    expect(sendExtensionUiResponse(1, 'ws-shared', { id: 'u1', value: 'A' })).toBe(true);
    expect(sendExtensionUiResponse(2, 'ws-shared', { id: 'u1', value: 'B' })).toBe(true);
    // A 的 stdin 只收到 A 的作答
    expect(JSON.parse(a.lines[0]!)['value']).toBe('A');
    expect(JSON.parse(b.lines[0]!)['value']).toBe('B');
  });

  it('confirmed/cancelled 应答与组合一致性', () => {
    const yes = makeFakeStdin();
    const no = makeFakeStdin();
    unregs.push(registerPiProcess(3, 'ws-c', yes.stdin, 3, noopKill));
    unregs.push(registerPiProcess(3, 'ws-d', no.stdin, 3, noopKill));
    expect(sendExtensionUiResponse(3, 'ws-c', { id: 'u1', confirmed: true })).toBe(true);
    expect(sendExtensionUiResponse(3, 'ws-d', { id: 'u1', cancelled: true })).toBe(true);
    expect(lastJson(yes.lines)).toEqual({
      type: 'extension_ui_response',
      id: 'u1',
      confirmed: true,
    });
    expect(lastJson(no.lines)).toEqual({
      type: 'extension_ui_response',
      id: 'u1',
      cancelled: true,
    });
  });

  it('注销后（ended）写回返回 false（404 语义）', () => {
    const { stdin } = makeFakeStdin();
    const unreg = registerPiProcess(9, 'ws-dead', stdin, 9, noopKill);
    unreg();
    expect(sendExtensionUiResponse(9, 'ws-dead', { id: 'u1', value: 'x' })).toBe(false);
    // 未注册的 key 同样 false
    expect(sendExtensionUiResponse(9, 'never-registered', { id: 'u1', value: 'x' })).toBe(false);
  });

  it('同一 key 重新注册后覆盖旧进程（新一轮 spawn 顶替）', () => {
    const old = makeFakeStdin();
    const fresh = makeFakeStdin();
    let oldKilled = 0;
    unregs.push(registerPiProcess(5, 'ws-cycle', old.stdin, 501, () => { oldKilled += 1; }));
    const unregFresh = registerPiProcess(5, 'ws-cycle', fresh.stdin, 502, noopKill);
    unregs.push(unregFresh);
    // 顶替即终止仍存活的旧进程：防两进程共写同一会话文件
    expect(oldKilled).toBe(1);
    // 旧条目已被顶替：写回落在新 stdin
    expect(sendExtensionUiResponse(5, 'ws-cycle', { id: 'u1', value: 'new' })).toBe(true);
    expect(old.lines.length).toBe(0);
    expect(JSON.parse(fresh.lines[0]!)['value']).toBe('new');
  });

  it('过期轮的注销不误删新进程的注册项（identity 校验）', () => {
    const stale = makeFakeStdin();
    const fresh = makeFakeStdin();
    const unregStale = registerPiProcess(8, 'ws-ident', stale.stdin, 801, noopKill);
    const unregFresh = registerPiProcess(8, 'ws-ident', fresh.stdin, 802, noopKill);
    // 旧轮（如错误路径延迟清理）此刻才执行 finally 注销 → 不得删除新条目
    unregStale();
    expect(sendExtensionUiResponse(8, 'ws-ident', { id: 'u1', value: 'alive' })).toBe(true);
    expect(JSON.parse(fresh.lines[0]!)['value']).toBe('alive');
    unregFresh();
  });

  it('killPiProcess 终止并注销：写回随即 404，kill 回调被调用', () => {
    const { stdin } = makeFakeStdin();
    let killed = 0;
    const unreg = registerPiProcess(6, 'ws-kill', stdin, 6, () => {
      killed += 1;
    });
    unregs.push(unreg);
    expect(killPiProcess(6, 'ws-kill')).toBe(true);
    expect(killed).toBe(1);
    expect(sendExtensionUiResponse(6, 'ws-kill', { id: 'u1', value: 'x' })).toBe(false);
    // 二次 kill 无效果（已注销）
    expect(killPiProcess(6, 'ws-kill')).toBe(false);
    expect(killed).toBe(1);
  });
});
