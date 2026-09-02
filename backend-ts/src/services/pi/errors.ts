/**
 * pi / provider 错误文案与终局诊断（纯字符串表 + 终局状态 → 事件，与 RPC 协议映射无关）。
 *
 * 从 events.ts / runner.ts 拆出（audit [STRUCT]）：events.ts 只保留协议映射 + 跨轮状态；
 * runner.ts 只保留编排，终局诊断逻辑收敛于此。
 */
import type { ChatStreamEvent } from '../../modules/bookplate/stream.js';

/** 把 pi/provider 的原始错误摘要为用户可读的中文短语（原始细节仍附在最终错误里）。 */
export function friendlyProviderError(raw: string): string {
  if (/\b429\b|rate.?limit|too many requests/i.test(raw)) return '模型服务繁忙（限流）';
  if (/\b40[13]\b|unauthorized|forbidden|invalid.{0,12}api.?key/i.test(raw)) return '模型鉴权失败（请检查 API Key）';
  if (/\b404\b|not found|no endpoints|model.*not.*exist/i.test(raw)) return '模型不存在或不可用';
  if (/\b402\b|insufficient|quota|credit|balance/i.test(raw)) return '模型配额/余额不足';
  if (/timed? ?out|timeout/i.test(raw)) return '模型请求超时';
  if (/\b5\d\d\b|bad gateway|service unavailable/i.test(raw)) return '模型服务异常';
  if (/aborted/i.test(raw)) return '请求已中断';
  return '模型请求失败';
}

/** 组装节点展示的失败文案：友好原因在前，原始错误细节在后（便于排查）。 */
export function formatPiFailure(lastError: string): string {
  return `${friendlyProviderError(lastError)}：${lastError}`;
}

/**
 * 错误终局诊断（纯函数）：把一轮 RPC 交互的终局状态映射为错误/状态事件。
 * 正常收尾产出空。streamRound 只负责调用并 yield，并在 yield 到 error 事件时
 * 置 round.emittedError（与 consumeLine 的口径一致）。
 * 零输出兜底诊断（依赖产物差分后的 emittedAny）留在 runner.ts 编排处。
 */
export function* endgameDiagnostic(inp: {
  settled: boolean;
  aborted: boolean;
  timedOut: boolean;
  emittedError: boolean;
  promptAccepted: boolean;
  sawAnyEvent: boolean;
  exitCode: number | null;
  lastError: string | null;
  stderrTail: string;
}): Generator<ChatStreamEvent> {
  let emittedError = inp.emittedError;
  const fail = (message: string): ChatStreamEvent => ({ type: 'error', message });

  if (!emittedError) {
    if (inp.aborted) {
      yield { type: 'status', message: '已中断' };
    } else if (inp.timedOut) {
      emittedError = true;
      yield fail('pi agent 对话超时已强制结束，请重试');
    } else {
      // settled 已收到（会话落盘完成）后，无论 pi 退出码如何都视为正常；
      // Windows 下强制 kill 会留非 0 退出码/断言崩溃码，不应误报。
      if (!inp.settled && (inp.exitCode !== 0 || inp.lastError)) {
        emittedError = true;
        if (inp.lastError) {
          yield fail(formatPiFailure(inp.lastError));
        } else {
          const tail = inp.stderrTail.trim();
          yield fail(`pi agent 执行失败（退出码 ${inp.exitCode}）${tail ? `\n${tail.split('\n').at(-1)}` : ''}`);
        }
      } else if (!inp.promptAccepted && !inp.sawAnyEvent) {
        // 进程正常退出但 prompt 未被受理且无任何事件：多半是扩展加载异常 / 参数错
        const tail = inp.stderrTail.trim();
        yield fail(`pi agent 未受理本轮消息（可能扩展装配异常）${tail ? `\n${tail.split('\n').at(-1)}` : ''}`);
      }
    }
  }
}

