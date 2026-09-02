import { z } from 'zod';

/**
 * pi RPC stdout 事件 schema（多租户外部进程边界校验）。
 *
 * 策略：schema 是「未知事件静默忽略」策略的载体——未知 `type` 直接不匹配
 * （consumeLine 只对 safeParse 成功的事件继续处理，与 mapPiJsonEvent 的 default
 * 分支兜底一致）；已知类型的坏字段同样不吞不报错，由下游 mapPiJsonEvent 的
 * 自然收窄兜底。除 `response.success` / `extension_ui_request.method` 两个契约
 * 字段外，其余字段一律 z.unknown().optional() + passthrough，保证消费方
 * String()/Number() 等宽容强制转换的行为不被破坏（升级 pi-coding-agent 后
 * 事件字段可能增删，见 docs/skill-agent/rpc-invariants.md）。
 *
 * 0.84.0 起 `message_update` 只发 deltas（CHANGELOG），assistantMessageEvent 的
 * 窄断言在 events.ts 用 assistantMessageEventSchema 单独校验。
 */

export const assistantMessageEventSchema = z
  .object({
    type: z.enum(['text_delta', 'thinking_delta']),
    delta: z.string(),
  })
  .partial()
  .passthrough();

export const rpcEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('response'),
      command: z.literal('prompt'),
      success: z.boolean(),
      error: z.unknown().optional(),
    })
    .passthrough(),
  z.object({ type: z.literal('agent_settled') }).passthrough(),
  z.object({ type: z.literal('agent_start') }).passthrough(),
  z
    .object({
      type: z.literal('message_update'),
      assistantMessageEvent: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('tool_execution_start'),
      toolCallId: z.unknown().optional(),
      toolName: z.unknown().optional(),
      args: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('tool_execution_end'),
      toolCallId: z.unknown().optional(),
      toolName: z.unknown().optional(),
      result: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('compaction_start'),
      reason: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('compaction_end'),
      aborted: z.unknown().optional(),
      errorMessage: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('extension_ui_request'),
      method: z.string(),
      id: z.unknown().optional(),
      title: z.unknown().optional(),
      options: z.unknown().optional(),
      message: z.unknown().optional(),
      placeholder: z.unknown().optional(),
      prefill: z.unknown().optional(),
      timeout: z.unknown().optional(),
      widgetKey: z.unknown().optional(),
      widgetLines: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('message_end'),
      message: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('auto_retry_start'),
      attempt: z.unknown().optional(),
      maxAttempts: z.unknown().optional(),
      delayMs: z.unknown().optional(),
      errorMessage: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('auto_retry_end'),
      success: z.unknown().optional(),
    })
    .passthrough(),
]);
