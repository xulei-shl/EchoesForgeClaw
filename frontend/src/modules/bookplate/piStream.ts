import type { AgentFile, AgentStep } from '../../platform/types';

/**
 * Skill Agent（pi）模式流式线协议（与后端 stream.ts chatStreamToSseResponse 对齐）：
 *
 * 后端把归一化 `ChatStreamEvent` 逐条以 `data: <JSON>\n\n` 推给前端，
 * 前端以纯 reducer 归约为「按助手消息拆分」的流式步骤列表——借鉴 pi-web 的
 * streamReducer 设计：SSE 事件 → 纯函数归约 → 逐条 assistant 消息，流结束后
 * 由水合历史原子替换。
 *
 * 步骤边界由事件序推导（服务端 RPC 子进程线性推进）：
 * - 每条 assistant 消息 = 思考（reasoning_delta）+ 正文（content_delta）+ 可选的
 *   工具步骤（tool_call / tool_result，含 ask_user_question 交互）；
 * - 消息以 tool_result 收尾（sealed）；此后第一条 content/reasoning/status 增量
 *   开启下一条消息。平行工具结果仍归并回同一条消息，与 pi-session-hydrate 口径一致。
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
  | {
      type: 'extension_widget';
      key: string;
      label?: string;
      lines: string[];
      placement?: 'aboveEditor' | 'belowEditor';
    }
  | { type: 'extension_widget_clear'; key: string }
  /** 扩展交互请求（后端 RPC 桥透传；作答经 POST /chat/ui-response 写回） */
  | {
      type: 'extension_ui_request';
      id: string;
      method: 'select' | 'confirm' | 'input' | 'editor';
      title: string;
      options?: string[];
      message?: string;
      placeholder?: string;
      prefill?: string;
      timeout?: number;
    }
  | { type: 'error'; message: string }
  /** 空闲监听续轮起始（后台子代理完成后 pi 自动触发的新一轮；前端据此开新步骤气泡） */
  | { type: 'turn_start' }
  /** 空闲监听期心跳（保持 SSE 连接活跃；前端仅重置 idle 计时，不渲染） */
  | { type: 'heartbeat' }
  /** 本轮 Token 用量与上下文窗口占比（由后端 message_end 产出） */
  | {
      type: 'token_usage';
      input: number;
      output: number;
      totalTokens: number;
      contextWindow: number;
      percent: number;
    };

/** 扩展 widget 展示项（服务端快照 / SSE 事件归约后的纯展示形态）。 */
export interface ExtensionWidgetItem {
  key: string;
  label?: string;
  lines: string[];
  placement: 'aboveEditor' | 'belowEditor';
  data?: Record<string, unknown>;
}

/** 待作答的扩展交互请求（前端唯一活跃弹层数据；RPC 逐题阻塞，同轮最多一个）。 */
export interface PendingUiRequest {
  id: string;
  method: 'select' | 'confirm' | 'input' | 'editor';
  title: string;
  options?: string[];
  message?: string;
  placeholder?: string;
  prefill?: string;
  timeout?: number;
}

/** 当轮单条助手消息的流式累积（对应服务端一个 assistant message = 思考 + 正文 + 工具步骤）。 */
export interface LiveAssistantStep {
  /** 思考过程（reasoning_delta 累加；随消息独立折叠展示） */
  reasoning: string;
  /** 正文（content_delta 累加；随消息独立气泡展示） */
  content: string;
  /** 工具步骤（tool_call / tool_result / status，与 pi-session-hydrate 的 agentSteps 同构） */
  agentSteps: AgentStep[];
  /** 本轮 Token 用量与上下文窗口占比 */
  tokenUsage?: {
    input?: number;
    output?: number;
    totalTokens: number;
    contextWindow?: number;
    percent?: number;
  };
  /**
   * 已收到本条消息的 tool_result（服务端侧该消息已完结）。sealed 后到达的
   * content/reasoning/status 增量开启下一条消息（步骤边界）；工具增量继续归并回本条。
   */
  sealed: boolean;
}

export interface PiStreamState {
  /** 当前是否有正在进行的运行（send 后置位；流结束/错误后清除） */
  isStreaming: boolean;
  /**
   * 当轮按助手消息拆分的流式步骤（流式期逐条独立气泡展示，与水合后的分消息形态对齐；
   * 流结束后保留至水合提交，消除「实时已清、持久未到」的闪烁空档）。
   */
  steps: LiveAssistantStep[];
  /** 当轮错误信息（error 事件；展示后由水合提交 / 下一轮发送清除） */
  error: string | null;
  /** 扩展 widget（服务端为真相源；跨轮保留，随水合 widget_set_all 对齐） */
  widgets: ExtensionWidgetItem[];
  /** 待作答扩展交互（null = 无；SSE 断线/新轮 start 时清除） */
  pendingUi: PendingUiRequest | null;
}

export const INITIAL_PI_STREAM: PiStreamState = {
  isStreaming: false,
  steps: [],
  error: null,
  widgets: [],
  pendingUi: null,
};

export type PiStreamAction =
  | { type: 'start' }
  | { type: 'content'; delta: string }
  | { type: 'reasoning'; delta: string }
  /** 工具调用 / 返回：归并到当前消息步骤（tool_result 之后的下一条正文/思考增量开启新步骤） */
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'tool_result'; id: string; name: string; result: string }
  /** agent 状态事件（compaction 等）：作为 agent_status 步骤归并（sealed 后独立成步骤） */
  | { type: 'status'; message: string }
  | { type: 'error'; message: string }
  /** 流自然结束：保持 steps 供水合窗口内继续展示，仅停流式标记 */
  | { type: 'settle' }
  /** 水合提交 / 新轮开始 / 工作区切换：整体复位（含 error） */
  | { type: 'end' }
  /** 扩展 widget 更新 / 覆盖（同 key 幂等） */
  | {
      type: 'widget_update';
      key: string;
      label?: string;
      lines: string[];
      placement?: 'aboveEditor' | 'belowEditor';
    }
  /** 扩展 widget 清空 */
  | { type: 'widget_clear'; key: string }
  /** 水合快照对齐（服务端 per-workspace 快照全量覆盖） */
  | { type: 'widget_set_all'; widgets: ExtensionWidgetItem[] }
  /** 扩展交互请求到达（SSE extension_ui_request → 弹层） */
  | { type: 'ui_request'; request: PendingUiRequest }
  /** 作答已回写（POST 成功）→ 关闭弹层 */
  | { type: 'ui_response'; id: string }
  /** 本地取消（SSE 断线/新轮/取消回写失败）→ 关闭弹层 */
  | { type: 'ui_cancel' }
  /** 空闲监听续轮起始（后台子代理完成自动续轮）：强制开启一条新的消息步骤 */
  | { type: 'turn_start' }
  /** 空闲监听期心跳（仅保持连接活跃，reducer 忽略） */
  | { type: 'heartbeat' }
  /** 本轮 Token 用量与上下文窗口占比 */
  | {
      type: 'token_usage';
      input: number;
      output: number;
      totalTokens: number;
      contextWindow: number;
      percent: number;
    };

function emptyLiveStep(): LiveAssistantStep {
  return { reasoning: '', content: '', agentSteps: [], sealed: false };
}

/** 更新最后一条步骤（steps 为空时原样返回 state，防御性兜底）。 */
function withLastStep(
  state: PiStreamState,
  update: (step: LiveAssistantStep) => LiveAssistantStep
): PiStreamState {
  const lastIdx = state.steps.length - 1;
  if (lastIdx < 0) return state;
  const steps = [...state.steps];
  steps[lastIdx] = update(steps[lastIdx]!);
  return { ...state, steps };
}

/** 若最后一步已 sealed（上一条消息因 tool_result 完结），开启一条新消息步骤 */
function openStepIfSealed(state: PiStreamState): PiStreamState {
  const lastIdx = state.steps.length - 1;
  if (lastIdx >= 0 && !state.steps[lastIdx]!.sealed) return state;
  return { ...state, steps: [...state.steps, emptyLiveStep()] };
}

export function piStreamReducer(state: PiStreamState, action: PiStreamAction): PiStreamState {
  switch (action.type) {
    case 'start':
      // 保留 widgets：跨轮/widget 来自服务端快照，新轮开始不清（服务端会在水合时对齐）
      // 新轮 = 旧交互作废（RPC 子进程本轮独占；pendingUi 随 start 清除）
      return { ...state, isStreaming: true, steps: [emptyLiveStep()], error: null, pendingUi: null };
    case 'content':
      if (!action.delta) return state;
      return withLastStep(openStepIfSealed(state), (step) => ({
        ...step,
        content: step.content + action.delta,
      }));
    case 'reasoning':
      if (!action.delta) return state;
      return withLastStep(openStepIfSealed(state), (step) => ({
        ...step,
        reasoning: step.reasoning + action.delta,
      }));
    case 'tool_call':
      return withLastStep(state, (step) => ({
        ...step,
        agentSteps: [
          ...step.agentSteps,
          { type: 'agent_tool_call', id: action.id, name: action.name, arguments: action.arguments },
        ],
      }));
    case 'tool_result':
      // 结果归并到发起调用的同一步骤并 sealed（平行工具结果仍归并回同一消息）
      return withLastStep(state, (step) => ({
        ...step,
        sealed: true,
        agentSteps: [
          ...step.agentSteps,
          { type: 'agent_tool_result', id: action.id, name: action.name, result: action.result },
        ],
      }));
    case 'status':
      return withLastStep(openStepIfSealed(state), (step) => ({
        ...step,
        agentSteps: [...step.agentSteps, { type: 'agent_status', message: action.message }],
      }));
    case 'token_usage':
      return withLastStep(state, (step) => ({
        ...step,
        tokenUsage: {
          input: action.input,
          output: action.output,
          totalTokens: action.totalTokens,
          contextWindow: action.contextWindow,
          percent: action.percent,
        },
      }));
    case 'error':
      return { ...state, isStreaming: false, error: action.message };
    case 'settle':
      return { ...state, isStreaming: false };
    case 'end':
      // ★不清空 widgets：steps 复位，widgets 交给服务端快照维护
      return { ...INITIAL_PI_STREAM, widgets: state.widgets };
    case 'widget_update': {
      const idx = state.widgets.findIndex((w) => w.key === action.key);
      const next: ExtensionWidgetItem = {
        key: action.key,
        ...(action.label !== undefined ? { label: action.label } : {}),
        lines: action.lines,
        placement: action.placement ?? 'aboveEditor',
      };
      if (idx >= 0) {
        const arr = [...state.widgets];
        arr[idx] = next;
        return { ...state, widgets: arr };
      }
      return { ...state, widgets: [...state.widgets, next] };
    }
    case 'widget_clear':
      return { ...state, widgets: state.widgets.filter((w) => w.key !== action.key) };
    case 'widget_set_all': {
      const incoming = action.widgets.map((w) => ({
        ...w,
        placement: w.placement ?? 'aboveEditor' as const,
      }));
      const same =
        incoming.length === state.widgets.length &&
        incoming.every((w, i) => JSON.stringify(w) === JSON.stringify(state.widgets[i]));
      return same ? state : { ...state, widgets: incoming };
    }
    case 'ui_request':
      // 同轮多请求（RPC 理论逐题阻塞；万一并发）：只保留最新，避免弹层重叠
      return { ...state, pendingUi: action.request };
    case 'ui_response':
      return state.pendingUi?.id === action.id ? { ...state, pendingUi: null } : state;
    case 'ui_cancel':
      return state.pendingUi ? { ...state, pendingUi: null } : state;
    case 'turn_start':
      // 空闲监听续轮起始：后台子代理完成自动续轮，强制开启一条新的消息步骤，
      // 使续轮正文进入独立气泡（不等「上一条已 sealed」边界，直接开新步骤）。
      return { ...state, steps: [...state.steps, emptyLiveStep()] };
    case 'heartbeat':
      // 心跳事件仅用于保持 SSE 连接活跃（PiChatNodeHost 收到任意事件即重置 idle），
      // reducer 无状态变更。
      return state;
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
