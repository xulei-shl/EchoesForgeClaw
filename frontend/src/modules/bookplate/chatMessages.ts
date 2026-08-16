import type { UIMessage, UIMessagePart, UIDataTypes, UITools } from 'ai';
import type { ChatMessage } from '../../platform/types';

/**
 * useChat 迁移的纯转换助手：节点持久化的 `ChatMessage[]` ↔ AI SDK `UIMessage[]`。
 *
 * 字段搬运约定：
 * - 正文 / 思考过程 → UIMessage parts（text / reasoning），useChat 流式增量天然落在这里；
 * - 其余自定义字段（context / contextImages / images / agentSteps / files / interrupted /
 *   streaming）→ 挂在 `metadata.bookplate` 上随消息携带，避免与 useChat 的 parts 语义冲突。
 *
 * `uiToStore` 不依赖旧消息做索引合并（撤销/重试后消息列表会错位），
 * 自定义字段一律从 metadata 读取；agentSteps / files 的实时写入走
 * onData 同时更新 store 与 UI metadata（见 ChatNodeHost），保证镜像不丢。
 */

/** 挂在 UIMessage.metadata.bookplate 上的自定义字段。 */
export interface BookplateMeta {
  context?: string;
  contextImages?: string[];
  images?: string[];
  agentSteps?: unknown[];
  files?: unknown[];
  interrupted?: boolean;
  streaming?: boolean;
}

const metaOf = (m: UIMessage): BookplateMeta =>
  (m.metadata as { bookplate?: BookplateMeta } | undefined)?.bookplate ?? {};

/** 取消息正文（所有 text part 拼接）。 */
export function uiMessageText(m: UIMessage): string {
  return m.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text: string }).text)
    .join('');
}

/** 取消息思考过程（所有 reasoning part 拼接）。 */
export function uiMessageReasoning(m: UIMessage): string {
  return m.parts
    .filter((p) => p.type === 'reasoning')
    .map((p) => (p as { text: string }).text)
    .join('');
}

/** 节点持久化消息 → useChat 消息（含 metadata 搬运）。 */
export function storeToUI(msgs: ChatMessage[]): UIMessage[] {
  return msgs.map((m, i) => {
    const parts: UIMessagePart<UIDataTypes, UITools>[] = [];
    if (m.content) parts.push({ type: 'text', text: m.content });
    if (m.reasoning) parts.push({ type: 'reasoning', text: m.reasoning });
    const meta: BookplateMeta = {};
    if (m.context) meta.context = m.context;
    if (m.contextImages?.length) meta.contextImages = m.contextImages;
    if (m.images?.length) meta.images = m.images;
    if (m.agentSteps?.length) meta.agentSteps = m.agentSteps;
    if (m.files?.length) meta.files = m.files;
    if (m.interrupted) meta.interrupted = true;
    if (m.streaming) meta.streaming = true;
    return {
      id: `bookplate-${i}-${m.role}`,
      role: m.role,
      parts,
      ...(Object.keys(meta).length ? { metadata: { bookplate: meta } } : {}),
    };
  });
}

/** useChat 消息 → 节点持久化消息（自定义字段从 metadata 读取）。 */
export function uiToStore(ui: UIMessage[]): ChatMessage[] {
  return ui.map((m) => {
    const meta = metaOf(m);
    const msg: ChatMessage = {
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: uiMessageText(m),
    };
    const reasoning = uiMessageReasoning(m);
    if (reasoning) msg.reasoning = reasoning;
    if (meta.context) msg.context = meta.context;
    if (meta.contextImages?.length) msg.contextImages = meta.contextImages;
    if (meta.images?.length) msg.images = meta.images;
    if (meta.agentSteps?.length) msg.agentSteps = meta.agentSteps as ChatMessage['agentSteps'];
    if (meta.files?.length) msg.files = meta.files as ChatMessage['files'];
    if (meta.interrupted) msg.interrupted = true;
    if (meta.streaming) msg.streaming = true;
    return msg;
  });
}

/** 把上下文（文本 + 上下文图片）附加到首条 user 消息的 metadata 上（每次发送前注入一次）。 */
export function attachContextToFirstUser(
  ui: UIMessage[],
  context: string,
  contextImages: string[]
): UIMessage[] {
  const idx = ui.findIndex((m) => m.role === 'user');
  if (idx === -1) return ui;
  const first = ui[idx];
  const meta: BookplateMeta = { ...metaOf(first) };
  if (context) meta.context = context;
  if (contextImages.length) meta.contextImages = contextImages;
  const next = [...ui];
  next[idx] = { ...first, metadata: { bookplate: meta } };
  return next;
}

/** 首条 user 消息是否已注入上下文（决定本轮是否重新注入）。 */
export function hasContextInStore(msgs: ChatMessage[]): boolean {
  const first = msgs.find((m) => m.role === 'user');
  return !!first && !!(first.context || first.contextImages?.length);
}
