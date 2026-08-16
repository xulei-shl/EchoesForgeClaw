import { generateText } from 'ai';
import type { VisionModelConfig } from '../types.js';
import { LLM_REQUEST_TIMEOUT_MS } from '../types.js';
import { createAIProvider } from '../provider.js';
import { classifyAIError } from '../errors.js';
import { logUsage, normalizeUsage } from '../usage.js';

/**
 * 多模态分析封面/参考图（图片分析节点 LLM 模式，对应 Python `llm_service.analyze_cover`）。
 *
 * - 输入图片字节 → data URL（MIME 由文件头魔数推断，与 Python `_detect_mime` 一致）；
 * - 无 API Key 返回 Mock 分析文本；
 * - 分析失败返回空串（不抛错，Python 契约：失败时前端仅基于元数据继续）；
 * - 封面分析要求完整 JSON（art_style + 配色 + 核心元素 + 构图），max_tokens=800。
 */

/** 通过文件头魔数推断图片 MIME（对应 Python `_detect_mime`）。 */
export function detectMime(head: Uint8Array): string {
  const h = (offset: number, len: number) =>
    String.fromCharCode(...head.subarray(offset, offset + len));
  if (head.length >= 12 && h(0, 4) === 'RIFF' && h(8, 4) === 'WEBP') return 'image/webp';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 6 && (h(0, 6) === 'GIF87a' || h(0, 6) === 'GIF89a')) return 'image/gif';
  if (head.length >= 4 && head[0] === 0x89 && h(1, 3) === 'PNG') return 'image/png';
  return 'image/png';
}

const MOCK_ANALYSIS =
  'Mock 分析：主题色 #D4945A 和 #2C1810，复古文艺风格，核心元素为书名、作者和装饰纹样。';

/** 多模态分析封面图片，返回主题色/设计风格/核心元素分析文本；失败或未配置返回 Mock/空串。 */
export async function analyzeCover(
  imageBytes: Uint8Array,
  config?: VisionModelConfig | null
): Promise<string> {
  const apiKey = config?.apiKey ?? '';
  if (!apiKey) return MOCK_ANALYSIS;

  const modelName = config?.model_name || 'gpt-4o-mini';
  const systemPrompt = config?.system_prompt || '';
  const dataUrl = `data:${detectMime(imageBytes.subarray(0, 12))};base64,${toBase64(imageBytes)}`;
  const provider = createAIProvider({ apiKey, base_url: config?.base_url ?? '' });

  try {
    const result = await generateText({
      model: provider(modelName),
      system: systemPrompt || undefined,
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', image: dataUrl }],
        },
      ],
      maxOutputTokens: 800,
      maxRetries: 0,
      timeout: LLM_REQUEST_TIMEOUT_MS,
    });
    const u = normalizeUsage(result.usage);
    logUsage({ model: modelName, provider: 'openai-compatible', ...u });
    return result.text || '';
  } catch (err) {
    // 与 Python 一致：分析失败记日志并返回空串，不阻断流程
    console.warn(`[ai] 封面分析失败: ${classifyAIError(err)}: ${messageOf(err)}`);
    return '';
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return Buffer.from(binary, 'binary').toString('base64');
}
