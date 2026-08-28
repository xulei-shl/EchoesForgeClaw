import type { AgentFile } from '../../platform/types';

/**
 * Skill Agent（pi）模式流式线协议（与后端 stream.ts chatStreamToSseResponse 对齐）：
 *
 * 后端把归一化 `ChatStreamEvent` 逐条以 `data: <JSON>\n\n` 推给前端，
 * 前端以纯 reducer 累积为一条正在生成的 assistant 消息——借鉴 pi-web 的
 * streamReducer 设计：SSE 事件 → 纯函数归约 → 单一流式消息，流结束后提交。
 *
 * 仅用于 PiChatNodeHost；LLM / FastClaw Agent 模式仍走 AI SDK useChat（ChatNodeHost）。
 */

/** 后端 ChatStreamEvent 在 SSE 线上的 JSON 形态（type 字段标识事件类型）。 */
export type PiStreamEvent =
  | { type: 'content_delta'; delta: string }
  | { type: 'reasoning_delta'; delta: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'tool_result'; id: string; name: string; result: string }
  | { type: 'status'; message: string }
  | {
      type: 'agent_retry';
      attempt: number;
      maxAttempts: number;
      delaySec: number;
      reason: string;
    }
  | { type: 'agent_file'; file: AgentFile }
  | { type: 'agent_image'; url: string }
  | { type: 'error'; message: string };

export interface PiStreamState {
  /** 当前是否有正在进行的运行（send 后置位；流结束/错误后清除） */
  isStreaming: boolean;
  /** 当轮已累积的正文（流式期间随 content_delta 增长；流结束后保留至水合提交） */
  content: string;
  /** 当轮已累积的思考过程（reasoning_delta） */
  reasoning: string;
  /** 当轮错误信息（error 事件；展示后由水合提交 / 下一轮发送清除） */
  error: string | null;
}

export const INITIAL_PI_STREAM: PiStreamState = {
  isStreaming: false,
  content: '',
  reasoning: '',
  error: null,
};

export type PiStreamAction =
  | { type: 'start' }
  | { type: 'content'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'error'; message: string }
  /** 流自然结束：保持 content/reasoning 供水合窗口内继续展示，仅停流式标记 */
  | { type: 'settle' }
  /** 水合提交 / 新轮开始 / 工作区切换：整体复位（含 error） */
  | { type: 'end' };

export function piStreamReducer(state: PiStreamState, action: PiStreamAction): PiStreamState {
  switch (action.type) {
    case 'start':
      return { isStreaming: true, content: '', reasoning: '', error: null };
    case 'content':
      return { ...state, content: state.content + action.delta };
    case 'reasoning':
      return { ...state, reasoning: state.reasoning + action.delta };
    case 'error':
      return { ...state, isStreaming: false, error: action.message };
    case 'settle':
      return { ...state, isStreaming: false };
    case 'end':
      return INITIAL_PI_STREAM;
    default:
      return state;
  }
}

/** 把 fetch response body 按行解析为 `data:` 载荷（JSON.parse 失败的行静默忽略）。 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<PiStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice('data:'.length).trim();
        if (!payload) continue;
        try {
          yield JSON.parse(payload) as PiStreamEvent;
        } catch {
          /* 半行/非 JSON 忽略 */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
