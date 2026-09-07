import type { ChatStreamEvent } from '../../modules/bookplate/stream.js';
import { subagentFleetRunsFromUiRequest } from './subagents/snapshot.js';
import { assistantMessageEventSchema } from './schema.js';
import { formatPiFailure, friendlyProviderError } from './errors.js';

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
  /** 当前模型上下文窗口大小（token；缺省 128000） */
  contextWindow?: number | null;
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
      // 0.84.0 起 message_update 只发 deltas；用 schema 收窄断言（不再手写 as）。
      // 未知/坏 assistantMessageEvent（如非对象）静默忽略，不产出。
      const ame = evt.assistantMessageEvent;
      if (ame && typeof ame === 'object') {
        const parsed = assistantMessageEventSchema.safeParse(ame);
        if (parsed.success) {
          if (parsed.data.type === 'text_delta' && typeof parsed.data.delta === 'string') {
            yield { type: 'content_delta', delta: parsed.data.delta };
          } else if (parsed.data.type === 'thinking_delta' && typeof parsed.data.delta === 'string') {
            yield { type: 'reasoning_delta', delta: parsed.data.delta };
          }
        }
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
      // 未知方法（setWidget/notify/setStatus/setTitle/set_editor_text/custom）静默忽略；
      // 例外：pi-subagents 的 setWidget 窄缝——RPC 模式下扩展把后台运行快照编码为
      // PI_SUBAGENT_ASYNC_JSON 行，本项目只认这一个 key+前缀，解析成 subagent_fleet。
      const method = String(evt.method ?? '');
      if (!DIALOG_METHODS.has(method)) {
        if (method === 'setWidget') {
          const { valid, runs } = subagentFleetRunsFromUiRequest(evt);
          // 有效快照（含空快照=后台全部结束）都产出 subagent_fleet；
          // 非 subagent-async key / 坏 JSON 则静默忽略。
          if (valid) yield { type: 'subagent_fleet', runs };
        }
        break;
      }
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
      const msg = evt.message as {
        role?: string;
        errorMessage?: string;
        usage?: { input?: unknown; output?: unknown; totalTokens?: unknown };
      } | undefined;
      if (msg?.role !== 'assistant') break;
      // 每条 assistant message_end 视为最新结果：auto-retry 恢复后的成功消息必须
      // 覆盖此前失败尝试的 errorMessage，否则进程正常结束后仍会误报
      // 「执行失败」——前端会在收尾 error chunk 上回滚整轮已流出的内容。
      // 见 docs/skill-agent/rpc-invariants.md #2。
      state.lastError = msg.errorMessage ?? null;

      // 提取本轮 Token 用量并结合模型 contextWindow 计算上下文窗口占比
      if (msg.usage && typeof msg.usage === 'object') {
        const u = msg.usage as Record<string, unknown>;
        const input = typeof u.input === 'number' && Number.isFinite(u.input) ? u.input : 0;
        const output = typeof u.output === 'number' && Number.isFinite(u.output) ? u.output : 0;
        const totalTokens =
          typeof u.totalTokens === 'number' && Number.isFinite(u.totalTokens)
            ? u.totalTokens
            : input + output;
        const contextWindow =
          typeof state.contextWindow === 'number' && state.contextWindow > 0
            ? state.contextWindow
            : 128000;
        const percent = Number(((totalTokens / contextWindow) * 100).toFixed(1));
        if (totalTokens > 0) {
          yield {
            type: 'token_usage',
            input,
            output,
            totalTokens,
            contextWindow,
            percent,
          };
        }
      }
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
