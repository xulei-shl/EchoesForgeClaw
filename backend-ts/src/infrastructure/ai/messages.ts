import type { ModelMessage } from 'ai';

/**
 * 消息转换：前端 wire 格式（OpenAI 风格）→ AI SDK `ModelMessage[]`。
 *
 * 对应 Python `app/services/llm_service.py::_multimodal_messages`：
 * - user 消息携带 `images`（data URL）时 → 多模态 content parts
 *   （text + image），不携带图片的消息原样透传；
 * - assistant / system 消息保持字符串 content。
 *
 * system 提示词不放进 messages（AI SDK v7 默认 `allowSystemInMessages: false`），
 * 由调用方经 `streamText({ system })` 选项注入——语义与 Python
 * 「把 system 提示词注入到消息开头」保持一致。
 */

/** 前端 wire 消息（`/api/modules/bookplate/chat` 请求体 messages 元素）。 */
export interface WireMessage {
  role?: string;
  content?: unknown;
  /** user 消息携带的图片（data URL，可为空）。 */
  images?: string[];
}

const isWireMessage = (m: unknown): m is WireMessage =>
  typeof m === 'object' && m !== null && 'role' in m;

/** 把 OpenAI 风格消息数组转换为 AI SDK ModelMessage[]（跳过非对象/未知角色）。 */
export function toAIMessages(messages: unknown[] | undefined | null): ModelMessage[] {
  const result: ModelMessage[] = [];
  for (const raw of messages ?? []) {
    if (!isWireMessage(raw)) continue;
    const role = raw.role;
    if (role === 'user') {
      const images = Array.isArray(raw.images) ? raw.images.filter(Boolean) : [];
      const text = typeof raw.content === 'string' ? raw.content : '';
      if (images.length > 0) {
        const parts: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = [];
        if (text) parts.push({ type: 'text', text });
        for (const img of images) parts.push({ type: 'image', image: img });
        result.push({ role: 'user', content: parts });
      } else {
        result.push({ role: 'user', content: text });
      }
    } else if (role === 'assistant') {
      result.push({
        role: 'assistant',
        content: typeof raw.content === 'string' ? raw.content : '',
      });
    }
    // system 角色：跳过（由 system 选项注入）；其他角色（tool 等）暂未使用，跳过
  }
  return result;
}
