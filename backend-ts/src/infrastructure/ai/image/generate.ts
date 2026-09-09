import { generateImage } from 'ai';
import type { ImageModelConfig } from '../types.js';
import { IMAGE_REQUEST_TIMEOUT_MS } from '../types.js';
import { createAIProvider, resolveBaseURL, resolveEnvProxy } from '../provider.js';
import { ImageGenerationError, classifyAIError } from '../errors.js';
import { fetchWithProxy } from '../../../services/platform/http-proxy.js';

/**
 * 图像生成（对应 Python `image_service.generate_image` 的底层 API 调用部分）。
 *
 * - 文生图：AI SDK `generateImage`（openai-compatible 标准 JSON 端点）；
 * - 图生图：Agnes 契约直连（JSON 顶层 `extra_body.image`，见 generateImageEditBytes）。
 *
 * 参数映射（设计文档第十五节：不能简单认为 AI SDK Image API 与 OpenAI Images API
 * 一一对应，须以实际 Provider/Model 验证）：
 * - size：标准尺寸（1024x1024）走 AI SDK 顶层 size；档位式（1K/2K）经 providerOptions
 *   透传顶层 size；
 * - ratio：openai-compatible 图像模型不发送 aspectRatio（告警并丢弃），故一律经
 *   providerOptions 以顶层 ratio 透传（Agnes 契约，见 docs/llm-api/图像生成api.md）；
 * - 文生图顶层 `return_base64: true`：Agnes 等兼容端点需显式请求 base64 输出，
 *   否则默认 URL/二进制返回，AI SDK 无法解析（"Invalid JSON response"）。
 *   实测 Agnes 可能忽略该参数仍返回 URL 格式——此时从错误响应体中捞取
 *   `data[0].url` 下载兜底（见 salvageFromResponseBody），图已生成不应报解析失败；
 * - 图生图（带参考图）：AI SDK openai-compatible 为 multipart `/images/edits` 语义，
 *   无法表达 Agnes 的 `extra_body.image` JSON 契约，故绕过 SDK 直连（见 generateImageEditBytes）。
 *
 * 返回：图像字节 + MIME（由服务层落盘 static/generated）。
 */

export interface GeneratedImageBytes {
  bytes: Uint8Array;
  mediaType: string;
}

export async function generateImageBytes(
  prompt: string,
  config: ImageModelConfig,
  abortSignal?: AbortSignal
): Promise<GeneratedImageBytes> {
  const apiKey = config.apiKey;
  if (!apiKey) throw new ImageGenerationError('未配置图像生成 API Key');
  if (!config.model_name) throw new ImageGenerationError('未配置图像模型名称（model_name）');

  const provider = createAIProvider({ apiKey, base_url: config.base_url ?? '' });
  const refImages = config.image?.length ? config.image : undefined;

  try {
    // 显式超时（120s）+ 外部 abort 合并（AI SDK v7 无 generateImage.timeout，用 abortSignal 组合）
    const combinedSignal = abortSignal
      ? AbortSignal.any([abortSignal, AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS);
    // 图生图：Agnes 契约走 JSON 顶层 extra_body.image（AI SDK openai-compatible 的图生图
    // 为 multipart /images/edits，语义不兼容，无法表达该契约），按文档直连请求 b64_json
    if (refImages && refImages.length > 0) {
      return await generateImageEditBytes(prompt, config, refImages, combinedSignal);
    }
    // 文生图：标准尺寸（如 1024x1024）走顶层 size；非标准（如 1K/2K）经 providerOptions 透传
    const standardSize = config.size?.match(/^\d+x\d+$/) ? config.size : undefined;
    const result = await generateImage({
      model: provider.imageModel(config.model_name),
      prompt: prompt.slice(0, 4000),
      ...(standardSize ? { size: standardSize as `${number}x${number}` } : {}),
      providerOptions: {
        bookforge: {
          // 文生图：顶层 return_base64 显式请求 base64 输出（Agnes 契约）。
          // 不传时提供方默认 URL/二进制返回，AI SDK 解析失败 → "Invalid JSON response"
          return_base64: true,
          // 档位式尺寸（1K/2K）与宽高比（1:1）经顶层字段透传
          ...(config.size && !standardSize ? { size: config.size } : {}),
          ...(config.ratio ? { ratio: config.ratio } : {}),
        },
      },
      maxRetries: 0,
      abortSignal: combinedSignal,
    });
    const image = result.images[0];
    if (!image) throw new ImageGenerationError('图片生成 API 未返回有效数据');
    return { bytes: image.uint8Array, mediaType: image.mediaType };
  } catch (err) {
    if (err instanceof ImageGenerationError) throw err;
    const category = classifyAIError(err);
    // 提供方可能忽略 b64 请求参数而返回 URL 格式（Agnes 实测 HTTP 200 + data[0].url，
    // b64_json 为 null）——AI SDK 只认 b64_json 会抛 "Invalid JSON response"，
    // 但图片其实已生成：从错误携带的响应体中捞取 url 下载，避免「已生成却报解析失败」。
    const salvaged = await salvageFromResponseBody(err);
    if (salvaged) return salvaged;
    throw new ImageGenerationError(`图片生成失败: ${messageOf(err)}`, category, err);
  }
}

/**
 * 从 APICallError.responseBody（AI SDK 解析失败时携带的原始响应文本）中
 * 解析图像响应并兜底取字节（适用于返回 URL 格式的提供方）。
 */
async function salvageFromResponseBody(err: unknown): Promise<GeneratedImageBytes | null> {
  const apiErr = err as Error & { responseBody?: string };
  if (typeof apiErr?.responseBody !== 'string' || !apiErr.responseBody.trim()) return null;
  let parsed: { data?: Array<{ b64_json?: string; url?: string }> };
  try {
    parsed = JSON.parse(apiErr.responseBody) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
  } catch {
    return null;
  }
  return bytesFromImageResponse(parsed?.data);
}

/**
 * 从图像响应 data[0] 提取字节：b64_json 优先，缺失时下载 url（60s 超时）。
 * 两者都没有返回 null，由调用方决定报错还是继续。
 */
async function bytesFromImageResponse(
  data: Array<{ b64_json?: string; url?: string }> | undefined
): Promise<GeneratedImageBytes | null> {
  const item = data?.[0];
  if (!item) return null;
  if (typeof item.b64_json === 'string' && item.b64_json) {
    return { bytes: Buffer.from(item.b64_json, 'base64'), mediaType: 'image/png' };
  }
  if (item.url) {
    const resp = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    if (!buf.byteLength) return null;
    return {
      bytes: new Uint8Array(buf),
      mediaType: resp.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png',
    };
  }
  return null;
}

/**
 * 图生图（Agnes 契约，见 docs/llm-api/图像生成api.md）：
 * `POST {baseURL}/images/generations`，参考图数组放 JSON 顶层 `extra_body.image`，
 * 输出经 `extra_body.response_format: "b64_json"` 显式请求（不得放顶层 response_format）。
 */
async function generateImageEditBytes(
  prompt: string,
  config: ImageModelConfig,
  refImages: string[],
  signal: AbortSignal
): Promise<GeneratedImageBytes> {
  const url = `${resolveBaseURL(config.base_url)}/images/generations`;
  const body: Record<string, unknown> = {
    model: config.model_name,
    prompt: prompt.slice(0, 4000),
    extra_body: {
      image: refImages,
      response_format: 'b64_json',
    },
  };
  if (config.size) body.size = config.size;
  if (config.ratio) body.ratio = config.ratio;

  const proxy = resolveEnvProxy();
  const resp = await fetchWithProxy(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    },
    proxy
  );

  const text = (await resp.text()).trim();
  if (!resp.ok) {
    // 优先取提供方的 JSON 错误消息，否则附状态码 + 响应体片段（可能是 HTML 报错页）
    let reason = `HTTP ${resp.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
      reason = parsed?.error?.message || parsed?.message || reason;
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new ImageGenerationError(
      `图片生成失败: ${reason}（HTTP ${resp.status}，响应内容: ${snippetOf(text)}）`
    );
  }

  let parsed: { data?: Array<{ b64_json?: string; url?: string }> };
  try {
    parsed = JSON.parse(text) as { data?: Array<{ b64_json?: string; url?: string }> };
  } catch {
    throw new ImageGenerationError(
      `图片生成失败: Invalid JSON response（HTTP ${resp.status}，响应内容: ${snippetOf(text)}）`
    );
  }
  const bytes = await bytesFromImageResponse(parsed?.data);
  if (!bytes) {
    throw new ImageGenerationError(
      `图片生成失败: 响应缺少 data[0].b64_json/url（响应内容: ${snippetOf(text)}）`
    );
  }
  return bytes;
}

/** 响应体片段（截断 200 字符，可能为二进制）。 */
function snippetOf(text: string): string {
  const s = text.replace(/\s+/g, ' ').slice(0, 200);
  return text.length > 200 ? `${s}…` : s;
}

/**
 * 错误消息提取：AI SDK 的 APICallError（如「Invalid JSON response」）通常还带
 * statusCode / url / responseBody，仅取 message 会把真实原因（网关 HTML 报错页、
 * 明文错误、或返回了非 b64_json 格式的 JSON/二进制）全部丢掉，导致无法定位。
 * 这里附上状态码、请求 URL 与响应体片段；响应体可能为二进制，截断展示。
 */
function messageOf(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const apiErr = err as Error & { statusCode?: number; url?: string; responseBody?: string };
  const detail: string[] = [];
  if (typeof apiErr.statusCode === 'number') detail.push(`HTTP ${apiErr.statusCode}`);
  if (apiErr.url) detail.push(apiErr.url);
  const body = typeof apiErr.responseBody === 'string' ? apiErr.responseBody.trim() : '';
  if (body) detail.push(`响应内容: ${snippetOf(body)}`);
  return detail.length ? `${err.message}（${detail.join('，')}）` : err.message;
}
