/**
 * 复用式空闲超时（SSE 流式执行共用）：
 * 每次 arm() 重置计时；超时置 timedOut 并中止流。
 * isTimedOut() 供 catch 分支区分「超时」与「用户取消 / 节点删除」。
 */
export function makeIdleTimeout(controller: AbortController, timeoutMs: number) {
  let timedOut = false;
  let timer: number | null = null;
  const arm = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timedOut = true;
      timer = null;
      controller.abort();
    }, timeoutMs);
  };
  const clear = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  return { arm, clear, isTimedOut: () => timedOut };
}
