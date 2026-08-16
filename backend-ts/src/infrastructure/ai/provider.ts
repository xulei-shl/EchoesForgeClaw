import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible';

/**
 * Provider 工厂（AI SDK 边界内，对应 Python 每次调用 `AsyncOpenAI(...)` 的构造）。
 *
 * 设计文档第五/二十五节：Provider 与业务解耦、模型配置独立管理。
 * - LLMConfig 表存任意 OpenAI 兼容端点（DeepSeek / litellm / 自建网关）的三要素
 *   （api_key / base_url / model_name），这里按配置运行时构造 provider 实例；
 * - `includeUsage: true`：流式响应携带 usage，供 usage.ts 统计；
 * - 无 Key 时不构造 provider（调用方走 Mock），与 Python `if not api_key` 分支一致。
 *
 * 超时/重试不在此处配置：超时用 AI SDK v7 调用级 `timeout` 选项（chat 60s / image 120s），
 * 重试在调用级 `maxRetries: 0`（与 Python max_retries=0 行为一致：超时即失败、不自动重试）。
 */

export interface ProviderConfig {
  apiKey: string;
  base_url: string;
}

/** 进程内 provider 实例缓存（key = baseURL + apiKey；baseURL 为空时不缓存）。 */
const providerCache = new Map<string, OpenAICompatibleProvider>();

/** 按配置创建（或复用）openai-compatible provider 实例。 */
export function createAIProvider(cfg: ProviderConfig): OpenAICompatibleProvider {
  // createOpenAICompatible 的 baseURL 为必填：空 base_url 时回退 OpenAI 官方端点
  // （与 Python `AsyncOpenAI(base_url=None)` 的默认行为一致）
  const baseURL = (cfg.base_url.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1');
  const cacheKey = `${baseURL}\u0000${cfg.apiKey}`;
  let provider = providerCache.get(cacheKey);
  if (!provider) {
    provider = createOpenAICompatible({
      name: 'bookforge',
      apiKey: cfg.apiKey,
      baseURL,
      includeUsage: true,
    });
    providerCache.set(cacheKey, provider);
  }
  return provider;
}
