import type { ChatStreamEvent } from '../../modules/bookplate/stream.js';

/**
 * pi json 事件 → ChatStreamEvent 归一化映射（纯函数，可单测）。
 *
 * 覆盖：流式增量 / 工具调用 / 自动重试（结构化）/ 上下文压缩（开始与完成）/
 * 错误捕获 / RPC 交互 dialog 桥接；未知事件静默忽略。
 */

export interface PiJsonEvent {
  type: string;
  [key: string]: unknown;
}

/** 事件映射的跨事件状态（message_end 捕获的最新模型错误，供 auto_retry_end / 收尾判定）。 */
export interface PiEventMapperState {
  lastError: string | null;
}

const COMPACTION_REASON_TEXT: Record<string, string> = {
  manual: '手动',
  threshold: '达到上下文阈值',
  overflow: '上下文溢出',
};

/** RPC dialog 方法白名单（extension_ui_request 只桥这些；setWidget/notify/setStatus 等不桥）。 */
const DIALOG_METHODS: ReadonlySet<string> = new Set(['select', 'confirm', 'input', 'editor']);

/**
 * pi json 事件 → ChatStreamEvent 归一化映射。
 * 失败/异常事件由其调用方（runPiAgent 收尾逻辑）负责转 error。
 */
export function* mapPiJsonEvent(
  evt: PiJsonEvent,
  state: PiEventMapperState
): Generator<ChatStreamEvent> {
  switch (evt.type) {
    case 'message_update': {
      const ame = evt.assistantMessageEvent as { type?: string; delta?: string } | undefined;
      if (ame?.type === 'text_delta' && typeof ame.delta === 'string') {
        yield { type: 'content_delta', delta: ame.delta };
      } else if (ame?.type === 'thinking_delta' && typeof ame.delta === 'string') {
        yield { type: 'reasoning_delta', delta: ame.delta };
      }
      break;
    }
    case 'tool_execution_start': {
      yield {
        type: 'tool_call',
        id: String(evt.toolCallId ?? ''),
        name: String(evt.toolName ?? ''),
        arguments: JSON.stringify(evt.args ?? {}),
      };
      break;
    }
    case 'tool_execution_end': {
      yield {
        type: 'tool_result',
        id: String(evt.toolCallId ?? ''),
        name: String(evt.toolName ?? ''),
        result: JSON.stringify(evt.result ?? null),
      };
      break;
    }
    case 'compaction_start': {
      const reason = String(evt.reason ?? 'threshold');
      yield {
        type: 'status',
        message: `上下文压缩中（${COMPACTION_REASON_TEXT[reason] ?? reason}），正在摘要归档更早日志…`,
      };
      break;
    }
    case 'compaction_end': {
      // aborted：用户中断导致的压缩放弃，不提示；失败细节由 errorMessage 承载
      if (evt.aborted) break;
      if (typeof evt.errorMessage === 'string' && evt.errorMessage) {
        yield { type: 'status', message: `上下文压缩失败：${evt.errorMessage}` };
        break;
      }
      yield { type: 'status', message: '上下文压缩完成，更早对话已摘要归档' };
      break;
    }
    case 'extension_ui_request': {
      // RPC 交互 dialog（select/confirm/input/editor）：只透传白名单字段，
      // 未知方法（setWidget/notify/setStatus/setTitle/set_editor_text/custom）静默忽略。
      const method = String(evt.method ?? '');
      if (!DIALOG_METHODS.has(method)) break;
      const id = String(evt.id ?? '');
      if (!id) break;
      const title = String(evt.title ?? '');
      if (!title && method !== 'confirm') break;
      const out: Record<string, unknown> = {
        type: 'extension_ui_request',
        id,
        method,
        title,
      };
      if (Array.isArray(evt.options)) {
        out['options'] = evt.options.filter((o) => typeof o === 'string');
      }
      if (typeof evt.message === 'string') out['message'] = evt.message;
      if (typeof evt.placeholder === 'string') out['placeholder'] = evt.placeholder;
      if (typeof evt.prefill === 'string') out['prefill'] = evt.prefill;
      if (typeof evt.timeout === 'number' && Number.isFinite(evt.timeout)) out['timeout'] = evt.timeout;
      yield out as ChatStreamEvent & { type: 'extension_ui_request' };
      break;
    }
    case 'message_end': {
      const msg = evt.message as { role?: string; errorMessage?: string } | undefined;
      if (msg?.role !== 'assistant') break;
      // 每条 assistant message_end 视为最新结果：auto-retry 恢复后的成功消息必须
      // 覆盖此前失败尝试的 errorMessage，否则进程正常结束后仍会误报
      // 「执行失败」——前端会在收尾 error chunk 上回滚整轮已流出的内容。
      state.lastError = msg.errorMessage ?? null;
      break;
    }
    case 'auto_retry_start': {
      // 结构化重试事件：前端渲染倒计时横幅（attempt/delayMs 驱动），不再用纯文本步骤
      const attempt = Number(evt.attempt ?? 0);
      const maxAttempts = Number(evt.maxAttempts ?? 0);
      const delaySec = Math.max(1, Math.round(Number(evt.delayMs ?? 0) / 1000));
      const reason =
        typeof evt.errorMessage === 'string' ? friendlyProviderError(evt.errorMessage) : '上游请求失败';
      yield { type: 'agent_retry', attempt, maxAttempts, delaySec, reason };
      break;
    }
    case 'auto_retry_end': {
      if (evt.success === false && state.lastError) {
        yield { type: 'error', message: formatPiFailure(state.lastError) };
      } else if (evt.success === true) {
        yield { type: 'status', message: '已自动恢复，继续生成…' };
      }
      break;
    }
    default:
      break;
  }
}

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