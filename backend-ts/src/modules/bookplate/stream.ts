import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageChunk,
} from 'ai';
import { AICapabilityError, aiErrorMessage } from '../../infrastructure/ai/errors.js';

/**
 * AI 对话流式输出（AI SDK UI Message Stream，前端 `@ai-sdk/react useChat` 消费）。
 *
 * 把所有执行模式（LLM / FastClaw Agent / 未来 Skill Agent）归一化为统一的
 * `ChatStreamEvent` 事件流，再映射为 AI SDK UI Message Stream chunks：
 *
 * | ChatStreamEvent        | UI Message Stream chunk        | 前端消费 |
 * | ---------------------- | ------------------------------ | -------- |
 * | content_delta          | text-start / text-delta / text-end | 消息正文 |
 * | reasoning_delta        | reasoning-start / reasoning-delta / reasoning-end | 思考折叠块 |
 * | tool_call              | data-agent_tool_call           | AgentStep |
 * | tool_result            | data-agent_tool_result         | AgentStep |
 * | status                 | data-agent_status              | AgentStep |
 * | agent_file             | data-agent_file                | 文件卡片 |
 * | agent_image            | data-agent_image               | 图片节点落图（image_url 事件语义） |
 * | error                  | error chunk（onError 映射）    | 错误态 |
 *
 * 自定义 data part 名称沿用现有 `agent_*` 事件名（transient，不进入持久化消息），
 * 保证 FastClaw / deepseek harness（未来 skill agent）接入时前端消费逻辑不变。
 */

/** Agent 中间步骤 / 文件事件（对应前端 AgentStep / AgentFile 结构）。 */
export interface AgentFilePayload {
  url: string;
  name: string;
  mime: string;
  size: number;
  path: string;
}

/**
 * pi-subagents 后台运行快照的安全投影节点（Skill Agent RPC 模式）。
 * 只含展示字段（id/kind/label/state/activity/startedAt/children），
 * 不暴露 run/async/tool 等内部 id 与原始载荷（契约见 services/pi/subagents/snapshot.ts）。
 */
export interface SubagentFleetRun {
  id: string;
  kind: string;
  label: string;
  state: string;
  activity?: { state?: string; currentTool?: string };
  startedAt?: number;
  children?: SubagentFleetRun[];
}

/** 归一化的 AI 对话流式事件（所有执行模式的统一内部表达）。 */
export type ChatStreamEvent =
  | { type: 'content_delta'; delta: string }
  | { type: 'reasoning_delta'; delta: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'tool_result'; id: string; name: string; result: string }
  | { type: 'status'; message: string }
  /** pi 自动重试结构化事件（前端渲染倒计时横幅；仅 Skill Agent 模式产生） */
  | {
      type: 'agent_retry';
      attempt: number;
      maxAttempts: number;
      delaySec: number;
      reason: string;
    }
  | { type: 'agent_file'; file: AgentFilePayload }
  | { type: 'agent_image'; url: string }
  /** 扩展 widget 更新（Skill Agent 模式；由 pi-widgets.ts 工具事件桥产出） */
  | {
      type: 'extension_widget';
      key: string;
      label?: string;
      lines: string[];
      placement?: 'aboveEditor' | 'belowEditor';
    }
  /** 扩展 widget 清空（空状态 / 清空聊天） */
  | { type: 'extension_widget_clear'; key: string }
  /** 扩展交互请求（Skill Agent RPC 模式；select/confirm/input/editor dialog）
   *
   * 服务端只透传白名单字段（契约见 pi-agent-service.ts mapPiJsonEvent 的
   * extension_ui_request case）；前端作答后经 POST /chat/ui-response 写回子进程。
   */
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
  /** pi-subagents 后台运行快照（Skill Agent RPC 模式；由 pi/events.ts setWidget 窄缝产出） */
  | { type: 'subagent_fleet'; runs: SubagentFleetRun[] }
  /** 空闲监听续轮起始（后台子代理完成后 pi 自动触发的新一轮；前端据此开新步骤气泡） */
  | { type: 'turn_start' }
  /** 空闲监听期心跳（保持前端 SSE 连接活跃；前端仅重置 idle 计时，不渲染） */
  | { type: 'heartbeat' }
  /** 本轮 Token 使用量及上下文窗口占比（Skill Agent 模式；由 pi/events.ts message_end 产出） */
  | {
      type: 'token_usage';
      input: number;
      output: number;
      totalTokens: number;
      contextWindow: number;
      percent: number;
    }
  | { type: 'error'; message: string };

/** 把归一化事件流映射为 AI SDK UI Message Stream 的 Response。 */
export function chatStreamToResponse(
  events: AsyncIterable<ChatStreamEvent>,
  opts: { onError?: (err: unknown) => string } = {}
): Response {
  const stream = createUIMessageStream({
    // 默认隐藏服务端错误细节；传入 onError 可透出更丰富的信息（当前保持中文可读）
    onError: (err) => aiErrorMessage(err, 'AI 对话失败'),
    execute: async ({ writer }) => {
      let textStarted = false;
      let reasoningStarted = false;
      try {
        for await (const evt of events) {
          switch (evt.type) {
            case 'content_delta':
              if (evt.delta === '') break;
              if (!textStarted) {
                writer.write({ type: 'text-start', id: MESSAGE_ID });
                textStarted = true;
              }
              writer.write({ type: 'text-delta', id: MESSAGE_ID, delta: evt.delta });
              break;
            case 'reasoning_delta':
              if (evt.delta === '') break;
              if (!reasoningStarted) {
                writer.write({ type: 'reasoning-start', id: MESSAGE_ID });
                reasoningStarted = true;
              }
              writer.write({ type: 'reasoning-delta', id: MESSAGE_ID, delta: evt.delta });
              break;
            case 'tool_call':
              writer.write({
                type: 'data-agent_tool_call',
                data: { id: evt.id, name: evt.name, arguments: evt.arguments },
                transient: true,
              });
              break;
            case 'tool_result':
              writer.write({
                type: 'data-agent_tool_result',
                data: { id: evt.id, name: evt.name, result: evt.result },
                transient: true,
              });
              break;
            case 'status':
              writer.write({ type: 'data-agent_status', data: { message: evt.message }, transient: true });
              break;
            case 'agent_retry':
              writer.write({
                type: 'data-agent_retry',
                data: {
                  attempt: evt.attempt,
                  maxAttempts: evt.maxAttempts,
                  delaySec: evt.delaySec,
                  reason: evt.reason,
                },
                transient: true,
              });
              break;
            case 'agent_file':
              writer.write({ type: 'data-agent_file', data: evt.file, transient: true });
              break;
            case 'agent_image':
              writer.write({
                type: 'data-agent_image',
                data: { url: evt.url, mock: false },
                transient: true,
              });
              break;
            case 'token_usage':
              writer.write({
                type: 'data-agent_token_usage',
                data: evt,
                transient: true,
              });
              break;
            case 'error':
              throw new AICapabilityError(evt.message);
          }
        }
        if (textStarted) writer.write({ type: 'text-end', id: MESSAGE_ID });
        if (reasoningStarted) writer.write({ type: 'reasoning-end', id: MESSAGE_ID });
        writer.write({ type: 'finish', finishReason: 'stop' });
      } catch (err) {
        // 事件流错误：createUIMessageStream 会经 onError 转为 error chunk 并正常收尾
        throw err;
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
}

/**
 * 把归一化事件流映射为原始 SSE（`data: <ChatStreamEvent JSON>\n\n`）。
 *
 * 仅 Skill Agent（pi）模式专用：前端以纯 reducer（piStream）消费，直接拿到
 * content_delta / reasoning_delta / tool_call / agent_file 等细粒度事件，
 * 不再经 AI SDK UI Message Stream 中转。LLM / FastClaw Agent 模式保持
 * `chatStreamToResponse`（AI SDK UI Message Stream，useChat 原生消费）不变。
 *
 * 事件流内出现 error 事件即终止（与 chatStreamToResponse 的 error 语义一致，
 * 后续产物差分事件不再投递）；生成器抛错时兜底发一条 error 事件后收尾。
 */
export function chatStreamToSseResponse(events: AsyncIterable<ChatStreamEvent>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const evt of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
          if (evt.type === 'error') break;
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'error', message: aiErrorMessage(err, 'AI 对话失败') })}\n\n`
          )
        );
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** 单轮回复消息 id（createUIMessageStream 会在 start chunk 注入其生成的 messageId）。 */
const MESSAGE_ID = 'assistant';

/** 便捷类型：UI message chunk（供路由层引用，避免直接 import ai）。 */
export type { UIMessageChunk };
