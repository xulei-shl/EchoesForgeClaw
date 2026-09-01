import type { ModelMessage } from 'ai';
import {
  COMPACTION_KEEP_RECENT_TOKENS,
  COMPACTION_RESERVE_TOKENS,
} from '../../services/pi/config.js';

/**
 * LLM 模式（AI SDK）多轮对话的上下文自动压缩。
 *
 * 复用 pi Skill Agent 的压缩语义（文档 `docs/skill-agent/pi-docs-playbook/pi-compaction-strategy-and-optimization.md`）：
 * - 触发：估算上下文 token 超过 `contextWindow - reserveTokens`（阈值由所选模型 context_window 推导）；
 * - 切割：从最新消息向前累加 token 到 `keepRecentTokens` 预算，其边界之前的历史被摘要注意，
 *   之后的消息原样保留（近距不二次过压缩 LLM）；
 * - 摘要注意：调用 LLM 生成结构化 summary，插入为对话历史起始消息，形成
 *   `summary + 近距原样消息` 的新上下文。
 *
 * 与 pi 的差异：本实现是无状态即时压缩（每轮对超出保留窗口的旧历史做一次性摘要注意，
 * 不做跨轮 `running_summary` 迭代合并），对应方案 A。token 估算用启发式（CJK 每字符≈1 token、
 * 其它字符≈1/4 token），非 tiktoken 精确计数。
 *
 * 压缩预算旋钮复用 pi 的环境变量（`PI_COMPACTION_RESERVE_TOKENS` / `PI_COMPACTION_KEEP_RECENT_TOKENS`），
 * 阈值随 selected 模型的 context_window（来自 llm_configs）变化。
 */

/** 模型上下文窗口缺省（与 pi `contextWindow || 128000` 一致，DB 未填时兜底）。 */
export const DEFAULT_CONTEXT_WINDOW = 128000;

/** CJK（含全角）字符一个字符≈1 token；其余字符≈1/4 token；加少量指令缓冲。 */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (CJK_RE.test(ch)) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4) + 4;
}

/** 单条 ModelMessage 内容贡献的 token：文本按字数，图片按固定配额。 */
function contentTokens(content: ModelMessage['content']): number {
  if (typeof content === 'string') return estimateTokens(content);
  if (Array.isArray(content)) {
    let sum = 0;
    for (const part of content) {
      if (part.type === 'text') sum += estimateTokens(part.text);
      else if (part.type === 'image') sum += 850; // OpenAI 视觉 token 配额近似
    }
    return sum;
  }
  return 0;
}

export function estimateMessageTokens(m: ModelMessage): number {
  const roleTokens = m.role === 'user' || m.role === 'assistant' || m.role === 'system' ? 4 : 8;
  return roleTokens + contentTokens(m.content);
}

export function estimateMessagesTokens(messages: ModelMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

export interface CompactionBudgets {
  /** 触发阈值 = contextWindow - reserveTokens。 */
  triggerTokens: number;
  reserveTokens: number;
  keepRecentTokens: number;
}

/**
 * 压缩预算：总窗口（缺省 128000）+ 预留 token + 保留近距 token。
 * 与 pi 装配逻辑（services/pi/workspace.ts）同一套安全钳制：
 * - reserve 不超过总窗口 20%，且不小于 512（防小模型首轮陷入压缩死循环）；
 * - keep 不超过 `(窗口-预留)*0.5`，且不小于 1024。
 */
export function computeCompactionBudgets(contextWindow: number | null | undefined): CompactionBudgets {
  const modelContext = contextWindow || DEFAULT_CONTEXT_WINDOW;
  const reserveTokens = Math.min(
    COMPACTION_RESERVE_TOKENS,
    Math.max(512, Math.floor(modelContext * 0.2))
  );
  const keepRecentTokens = Math.min(
    COMPACTION_KEEP_RECENT_TOKENS,
    Math.max(1024, Math.floor((modelContext - reserveTokens) * 0.5))
  );
  return {
    triggerTokens: modelContext - reserveTokens,
    reserveTokens,
    keepRecentTokens,
  };
}

/** 把待摘要消息序列化为纯文本「对话存档」（避免模型把它当成待继续的对话）。 */
function serializeMessages(messages: ModelMessage[], systemPrompt?: string): string {
  const lines: string[] = [];
  for (const m of messages) {
    const text =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter((p) => p.type === 'text')
              .map((p) => (p.type === 'text' ? p.text : ''))
              .join('\n')
          : '';
    const tag =
      m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : m.role;
    lines.push(`[${tag}]: ${text}`);
  }
  const head = systemPrompt?.trim() ? `[System]: ${systemPrompt.trim()}\n` : '';
  return head + lines.join('\n');
}

/** 结构化摘要 instructions（沿用 pi compaction §Summary Format 的承载位）。 */
export const SUMMARY_INSTRUCTIONS = `你是对话压缩助手。把下方 [User]/[Assistant] 对话记录压缩为结构化档案，只保留继续工作/对话必需的要点，不得增删事实。严格输出以下 Markdown 结构：

## Goal
[用户想要达成的目标]

## Progress
### Done
- [已完成事项]
### In Progress
- [进行中事项]
### Blocked
- [阻塞项，如有]

## Key Decisions
- **[决策]**: [理由]

## Next Steps
1. [接下来该做什么]

## Critical Context
- [继续所需的硬事实：编号、路径、约束、偏好，如有]`;

/**
 * 无状态压缩：估算当前上下文，超过触发阈值则把旧历史摘要注意，近距原样保留。
 *
 * @param messages 完整多轮消息（已转 ModelMessage，不含 system；system 走 system 选项注入）
 * @param systemPrompt system 提示词（计入上下文占用，但注入方式不变）
 * @param contextWindow 模型上下文窗口（null/undefined → 缺省 128000）
 * @param summarize 摘要函数：输入待摘要的序列化文本，返回结构化概要；由调用方接真实 LLM
 * @param anchor 用量锚点（API 返回的真实 token 计数 + 对应消息索引），用于校准上下文估算
 * @returns 压缩后的消息 + 是否发生了压缩
 */
export interface CompactResult {
  messages: ModelMessage[];
  compacted: boolean;
  /** 本轮的摘要文本（未压缩时为 null）。 */
  summary: string | null;
}

/**
 * 用量锚点：API 返回的真实 token 计数，用于校准上下文估算。
 * pi-agent 用最后一条 assistant 消息的 usage 作为锚点，只对尾部新消息做启发式估算，
 * 避免纯启发式在长会话中累积漂移。
 */
export interface UsageAnchor {
  /** 锚点对应的 usage.totalTokens（API 返回的真实上下文 token 数）。 */
  totalTokens: number;
  /** 锚点对应的消息索引（usage 覆盖到该索引，含）。 */
  messageIndex: number;
}

/**
 * 用锚点校准的上下文 token 估算（对齐 pi-agent estimateContextTokens 语义）。
 *
 * - 有锚点：锚点前的 token 直接用 usage.totalTokens，锚点后逐条启发式估算；
 * - 无锚点：全部逐条启发式估算（回退到当前行为）。
 */
export function estimateContextTokens(
  messages: ModelMessage[],
  anchor?: UsageAnchor | null
): number {
  if (anchor && anchor.messageIndex >= 0 && anchor.messageIndex < messages.length) {
    // 锚点前（含）用真实 usage，锚点后逐条启发式
    let trailingTokens = 0;
    for (let i = anchor.messageIndex + 1; i < messages.length; i++) {
      trailingTokens += estimateMessageTokens(messages[i]!);
    }
    return anchor.totalTokens + trailingTokens;
  }
  // 无锚点：全部启发式
  return estimateMessagesTokens(messages);
}

export async function compactModelMessages(
  messages: ModelMessage[],
  systemPrompt: string | undefined,
  contextWindow: number | null | undefined,
  summarize: (text: string) => Promise<string>,
  anchor?: UsageAnchor | null
): Promise<CompactResult> {
  const { triggerTokens, keepRecentTokens } = computeCompactionBudgets(contextWindow);
  const totalTokens = estimateContextTokens(messages, anchor) + estimateTokens(systemPrompt ?? '');
  if (totalTokens <= triggerTokens) {
    return { messages, compacted: false, summary: null };
  }

  // 从最新向前保留，直到填满 keepRecentTokens 预算（至少保留最后一条消息，保证回答可达）
  const kept: ModelMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    const t = estimateMessageTokens(msg);
    if (kept.length === 0 || used + t <= keepRecentTokens) {
      kept.unshift(msg);
      used += t;
    } else {
      break;
    }
  }
  const toSummarize = messages.slice(0, messages.length - kept.length);
  if (toSummarize.length === 0) {
    return { messages, compacted: false, summary: null };
  }

  const summary = await summarize(serializeMessages(toSummarize, systemPrompt));
  // 摘要注意失败/为空：不替换消息（宁可保留原历史，也不塞入空摘要丢信息）
  if (!summary) {
    return { messages, compacted: false, summary: null };
  }
  const out: ModelMessage[] = [
    { role: 'user', content: `[对话历史摘要]\n${summary}` },
    ...kept,
  ];
  return { messages: out, compacted: true, summary };
}