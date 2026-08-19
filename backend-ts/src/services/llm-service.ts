import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { streamText } from 'ai';
import type { TextModelConfig, VisionModelConfig } from '../infrastructure/ai/types.js';
import { LLM_REQUEST_TIMEOUT_MS } from '../infrastructure/ai/types.js';
import { createAIProvider } from '../infrastructure/ai/provider.js';
import { chatStream, type ChatDelta } from '../infrastructure/ai/language-model/chat-stream.js';
import { analyzeCover } from '../infrastructure/ai/language-model/text.js';
import { LLMGenerationError, classifyAIError } from '../infrastructure/ai/errors.js';
import { logUsage, normalizeUsage } from '../infrastructure/ai/usage.js';

/**
 * LLM 调用代理（对应 Python `app/services/llm_service.py` 的 LLMService）。
 *
 * 支持两种配置来源（优先级从高到低）：
 * 1. 管理后台 NodeConfig 解析出的 TextModelConfig / VisionModelConfig；
 * 2. 环境变量 OPENAI_API_KEY（无 Key 时启用 Mock 响应）。
 *
 * 业务层只依赖本服务，不直接接触 AI SDK（设计文档 ADR-014）。
 */

/** 默认提示词目录：backend-ts/prompts/（复用 Python 的 prompts 文件）。 */
const PROMPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../prompts');

function loadDefaultPrompt(filename: string): string {
  try {
    return readFileSync(path.join(PROMPTS_DIR, filename), 'utf-8').trim();
  } catch {
    return '';
  }
}

export const DEFAULT_SYSTEM_PROMPT = loadDefaultPrompt('藏书票图像提示词.md');
export const DEFAULT_COVER_SYSTEM_PROMPT = loadDefaultPrompt('藏书票封面图分析.md');

/** 环境变量回退 Key（无 Key 时 Mock，与 Python `os.getenv("OPENAI_API_KEY")` 一致）。 */
const envApiKey = () => process.env.OPENAI_API_KEY ?? '';

export class LLMService {
  /** 多模态分析封面图片，返回主题色/设计风格/核心元素分析文本。 */
  async analyzeCover(
    imageBytes: Uint8Array,
    config?: VisionModelConfig | null
  ): Promise<string> {
    const apiKey = (config?.apiKey ?? '') || envApiKey();
    const resolved: VisionModelConfig | null = apiKey
      ? {
          apiKey,
          base_url: config?.base_url ?? '',
          model_name: config?.model_name || 'gpt-4o-mini',
          system_prompt: config?.system_prompt || DEFAULT_COVER_SYSTEM_PROMPT,
        }
      : null;
    return analyzeCover(imageBytes, resolved);
  }

  /** 文本流式生成（AI 文本生成节点 LLM 模式，对应 Python `generate_text_stream`）。 */
  async *generateTextStream(
    metadata: Record<string, unknown>,
    config?: TextModelConfig | null,
    coverAnalysis = '',
    text = ''
  ): AsyncGenerator<string, void, unknown> {
    const apiKey = (config?.apiKey ?? '') || envApiKey();
    if (!apiKey) {
      // Mock 打字机流（与 Python 行为一致）
      yield* mockPromptStream(metadata, coverAnalysis, text);
      return;
    }
    const modelName = config?.model_name || 'gpt-3.5-turbo';
    const systemPrompt = config?.system_prompt || DEFAULT_SYSTEM_PROMPT;
    const provider = createAIProvider({ apiKey, base_url: config?.base_url ?? '' });

    // 用户消息只携带数据，不含指令（与 Python 一致：指令来自 system 提示词模板）
    const parts: string[] = [];
    for (const [k, v] of Object.entries(metadata)) {
      if (['cover_image', 'cover_image_local', 'coverUrl'].includes(k)) continue;
      parts.push(`${k}: ${String(v)}`);
    }
    if (coverAnalysis) parts.push(`封面分析结果：\n${coverAnalysis}`);
    if (text) parts.push(`文本节点内容：\n${text}`);
    const prompt = parts.join('\n');

    const startedAt = performance.now();
    try {
      const result = streamText({
        model: provider(modelName),
        system: systemPrompt || DEFAULT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
        maxRetries: 0,
        timeout: LLM_REQUEST_TIMEOUT_MS,
        onFinish: (evt) => {
          const u = normalizeUsage(evt.usage);
          logUsage({
            model: modelName,
            provider: 'openai-compatible',
            ...u,
            latencyMs: Math.round(performance.now() - startedAt),
          });
        },
      });
      for await (const part of result.stream) {
        if (part.type === 'text-delta') yield part.text;
      }
    } catch (err) {
      throw new LLMGenerationError(`提示词生成失败: ${messageOf(err)}`, classifyAIError(err), err);
    }
  }

  /** 多轮对话流式生成（AI 对话节点 LLM 模式）。 */
  async *chatStream(
    messages: unknown[],
    config?: TextModelConfig | null,
    abortSignal?: AbortSignal
  ): AsyncGenerator<ChatDelta, void, unknown> {
    const apiKey = (config?.apiKey ?? '') || envApiKey();
    const resolved: TextModelConfig | null = apiKey
      ? {
          apiKey,
          base_url: config?.base_url ?? '',
          model_name: config?.model_name || 'gpt-3.5-turbo',
          system_prompt: config?.system_prompt ?? '',
        }
      : null;
    yield* chatStream(messages, resolved, abortSignal);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 无 API Key 时的 Mock 打字机流（与 Python `generate_text_stream` Mock 分支一致）。 */
async function* mockPromptStream(
  metadata: Record<string, unknown>,
  coverAnalysis: string,
  text: string
): AsyncGenerator<string, void, unknown> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  yield '【Mock 响应开始】\n';
  await sleep(500);
  yield '基于您提供的图书元数据：\n';
  for (const [key, value] of Object.entries(metadata)) {
    yield `- ${key}: ${String(value)}\n`;
    await sleep(300);
  }
  if (coverAnalysis) {
    yield `\n封面分析结果：\n${coverAnalysis}\n`;
    await sleep(500);
  }
  if (text) {
    yield `\n文本节点内容：\n${text}\n`;
    await sleep(500);
  }
  yield '\n为您生成以下提示词片段：\n';
  await sleep(500);
  yield '1. 柔和的灯光\n';
  await sleep(300);
  yield '2. 细腻的笔触\n';
  await sleep(300);
  yield '3. 高清 4K 画质\n';
  yield '【Mock 响应结束】';
}

/** 单例（对应 Python 模块级 `llm_service = LLMService()`）。 */
export const llmService = new LLMService();
