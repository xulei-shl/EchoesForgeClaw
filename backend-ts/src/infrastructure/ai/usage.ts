import type { LanguageModelUsage } from 'ai';

/**
 * Usage 与调用追踪（设计文档第二十章 / 二十一章）。
 * 每次 AI 调用记录：model / provider / input/output/total tokens / 耗时 / 错误。
 * 当前落到结构化日志；后续可接入现有监控体系。
 */

export interface UsageLogEntry {
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  requestId?: string;
}

export function logUsage(entry: UsageLogEntry): void {
  const { model, provider, inputTokens, outputTokens, totalTokens, latencyMs, requestId } = entry;
  const parts = [
    `model=${model}`,
    `provider=${provider}`,
    inputTokens !== undefined ? `in=${inputTokens}` : '',
    outputTokens !== undefined ? `out=${outputTokens}` : '',
    totalTokens !== undefined ? `total=${totalTokens}` : '',
    latencyMs !== undefined ? `latency=${latencyMs}ms` : '',
    requestId ? `requestId=${requestId}` : '',
  ].filter(Boolean);
  // 保持与 Python logger.info 同级可见性；统一日志格式后续接入 logger 时替换
  console.info(`[usage] ${parts.join(' ')}`);
}

/** 归一化 AI SDK usage 对象。 */
export function normalizeUsage(usage: LanguageModelUsage | undefined): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} {
  if (!usage) return {};
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}
