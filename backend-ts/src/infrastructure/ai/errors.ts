import { APICallError } from '@ai-sdk/provider';
import { RetryError } from 'ai';

/**
 * AI 能力层统一错误（业务层可见的错误体系，对应 Python：
 * - `LLMGenerationError`（文本/多模态/对话，SSE error 事件）
 * - `ImageGenerationError`（图像，HTTP 502）
 *
 * AI SDK / Provider 错误不得直接泄漏到业务层（设计文档第十七节）。
 */

export class AICapabilityError extends Error {
  /** 错误分类（对应设计文档第十七节至少区分的类别）。 */
  readonly category:
    | 'argument'
    | 'authentication'
    | 'rate_limit'
    | 'timeout'
    | 'network'
    | 'provider'
    | 'model'
    | 'tool'
    | 'stream'
    | 'validation'
    | 'unknown';

  constructor(
    message: string,
    category: AICapabilityError['category'] = 'unknown',
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'AICapabilityError';
    this.category = category;
  }
}

/** 提示词/对话生成失败（SSE error 事件，对应 Python LLMGenerationError）。 */
export class LLMGenerationError extends AICapabilityError {
  constructor(message: string, category: AICapabilityError['category'] = 'unknown', cause?: unknown) {
    super(message, category, { cause });
    this.name = 'LLMGenerationError';
  }
}

/** 图片生成失败（对外暴露为 HTTP 502，对应 Python ImageGenerationError）。 */
export class ImageGenerationError extends AICapabilityError {
  constructor(message: string, category: AICapabilityError['category'] = 'unknown', cause?: unknown) {
    super(message, category, { cause });
    this.name = 'ImageGenerationError';
  }
}

/** 把 AI SDK / Provider 抛出的任意异常映射为 AICapabilityError 分类。 */
export function classifyAIError(err: unknown): AICapabilityError['category'] {
  if (err instanceof AICapabilityError) return err.category;
  const name = err instanceof Error ? err.name : typeof err;

  // 超时：Node AbortSignal.timeout / 底层 fetch abort 以 TimeoutError 呈现
  if (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    (err instanceof Error && /timed? ?out/i.test(err.message))
  ) {
    return 'timeout';
  }
  // 鉴权（401）
  if (
    err instanceof APICallError &&
    (err.statusCode === 401 || err.statusCode === 403)
  ) {
    return err.statusCode === 401 ? 'authentication' : 'rate_limit';
  }
  if (err instanceof APICallError) {
    if (err.statusCode === 429) return 'rate_limit';
    if (err.statusCode === 400) return 'argument';
    if (err.statusCode === 404) return 'model';
    // AI SDK 将 fetch 网络错误（ECONNRESET/ECONNREFUSED/超时等）包装为 APICallError（无 statusCode），
    // 需先检测消息中的网络错误关键词，再回退到 'provider'
    if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|other side closed|connect.*fail|fetch.*fail/i.test(err.message)) {
      return 'network';
    }
    return 'provider';
  }
  if (err instanceof RetryError) return 'network';
  if (err instanceof Error && /fetch|network|connect|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(err.message)) {
    return 'network';
  }
  if (err instanceof Error && /invalid.*message|message.*invalid|role/i.test(err.message)) {
    return 'validation';
  }
  return 'unknown';
}

/** 统一的错误分类 → 用户可读消息（中文，与现有前端展示风格一致）。 */
export function aiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof AICapabilityError) return err.message;
  const category = classifyAIError(err);
  const raw = err instanceof Error && err.message ? err.message : String(err);
  switch (category) {
    case 'authentication':
      return `模型鉴权失败（API Key 无效或已过期）: ${raw}`;
    case 'rate_limit':
      return `模型限流（Rate Limit）: ${raw}`;
    case 'timeout':
      return `${fallback}: 请求超时`;
    case 'network':
      return `${fallback}: 网络连接失败或被重置，请检查模型地址与网络代理（${raw}）`;
    case 'argument':
      return `${fallback}: 请求参数错误（${raw}）`;
    case 'model':
      return `${fallback}: 模型不存在或不可用（${raw}）`;
    default:
      return `${fallback}: ${raw}`;
  }
}

