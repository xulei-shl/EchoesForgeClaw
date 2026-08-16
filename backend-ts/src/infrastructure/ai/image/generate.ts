import { generateImage } from 'ai';
import type { ImageModelConfig } from '../types.js';
import { IMAGE_REQUEST_TIMEOUT_MS } from '../types.js';
import { createAIProvider } from '../provider.js';
import { ImageGenerationError, classifyAIError } from '../errors.js';

/**
 * 图像生成（对应 Python `image_service.generate_image` 的底层 API 调用部分）。
 *
 * - 文生图：`prompt` 为字符串；
 * - 图生图：`prompt: { text, images: [参考图 URL/data URL] }`（AI SDK openai-compatible
 *   走 `/images/edits` 语义）。
 *
 * 参数映射（设计文档第十五节：不能简单认为 AI SDK Image API 与 OpenAI Images API
 * 一一对应，须以实际 Provider/Model 验证）：
 * - size / ratio（aspectRatio）原样透传；
 * - Python 实现的 litellm 特判（`extra_body.image` + 不传 response_format）与 AI SDK
 *   图生图语义不同——如有真实 Key 环境需按 Provider 验证，必要时经 `providerOptions`
 *   或 `transformRequestBody` 兜底。
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
    // 标准尺寸（如 1024x1024）走顶层 size；非标准（如 1K/2K）经 providerOptions 透传
    const standardSize = config.size?.match(/^\d+x\d+$/) ? config.size : undefined;
    const result = await generateImage({
      model: provider.imageModel(config.model_name),
      prompt:
        refImages && refImages.length > 0
          ? { text: prompt.slice(0, 4000), images: refImages }
          : prompt.slice(0, 4000),
      ...(standardSize ? { size: standardSize as `${number}x${number}` } : {}),
      ...(config.ratio?.match(/^\d+:\d+$/) ? { aspectRatio: config.ratio as `${number}:${number}` } : {}),
      providerOptions: {
        bookforge: {
          ...(config.size && !standardSize ? { size: config.size } : {}),
          ...(config.ratio && !config.ratio.match(/^\d+:\d+$/) ? { aspect_ratio: config.ratio } : {}),
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
    throw new ImageGenerationError(`图片生成失败: ${messageOf(err)}`, category, err);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
