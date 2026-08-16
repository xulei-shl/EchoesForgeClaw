import { streamText } from 'ai';
import type { TextModelConfig } from '../types.js';
import { LLM_REQUEST_TIMEOUT_MS } from '../types.js';
import { createAIProvider } from '../provider.js';
import { toAIMessages } from '../messages.js';
import { LLMGenerationError, classifyAIError } from '../errors.js';
import { logUsage, normalizeUsage } from '../usage.js';

/**
 * 多轮对话流式生成（AI 对话节点 LLM 模式，对应 Python `llm_service.chat_stream`）。
 *
 * 输入：OpenAI 格式消息数组（不含 system，由 config 的提示词模板注入）+ TextModelConfig。
 * 每个增量产出 `{ type: 'content' | 'reasoning', delta }`：
 * - content = 回答正文（前端拼入消息内容）；
 * - reasoning = 思考过程（DeepSeek 等端点的 thinking token，AI SDK openai-compatible
 *   provider 内置支持，产出 `reasoning-delta` part；前端独立折叠展示，不混入正文）。
 *
 * 语义保持（Python 契约）：
 * - system 提示词（节点绑定的提示词模板）经 `system` 选项注入，未绑定则不注入；
 * - 携带图片的 user 消息转为多模态 content（text + image data URL）；
 * - 缺 user 消息抛 LLMGenerationError('AI 对话缺少用户消息')；
 * - 超时（60s）即失败、不自动重试（maxRetries: 0）。
 */

export interface ChatDelta {
  type: 'content' | 'reasoning';
  delta: string;
}

export async function* chatStream(
  messages: unknown[],
  config?: TextModelConfig | null,
  abortSignal?: AbortSignal
): AsyncGenerator<ChatDelta, void, unknown> {
  const apiKey = config?.apiKey ?? '';
  if (!apiKey) {
    // 无 API Key：Mock 打字机流（与 Python 行为一致，含回复引导文案）
    yield* mockChatStream(messages);
    return;
  }

  const modelName = config?.model_name || 'gpt-3.5-turbo';
  const systemPrompt = (config?.system_prompt ?? '').trim();
  const provider = createAIProvider({ apiKey, base_url: config?.base_url ?? '' });

  // 携带图片的 user 消息经 toAIMessages 转为多模态 content（text + image）
  const modelMessages = toAIMessages(messages ?? []);
  if (!modelMessages.some((m) => m.role === 'user')) {
    throw new LLMGenerationError('AI 对话缺少用户消息');
  }

  const startedAt = performance.now();
  try {
    const result = streamText({
      model: provider(modelName),
      system: systemPrompt || undefined,
      messages: modelMessages,
      maxRetries: 0,
      timeout: LLM_REQUEST_TIMEOUT_MS,
      ...(abortSignal ? { abortSignal } : {}),
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
      if (part.type === 'text-delta') {
        yield { type: 'content', delta: part.text };
      } else if (part.type === 'reasoning-delta') {
        yield { type: 'reasoning', delta: part.text };
      }
      // 其余 part（finish / tool 等）本轮不使用：LLM 模式无工具
    }
  } catch (err) {
    // AI SDK 错误 → 项目错误体系（LLMGenerationError），不泄漏 SDK 类型
    const category = classifyAIError(err);
    throw new LLMGenerationError(`AI 对话失败: ${messageOf(err)}`, category, err);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 无 API Key 时的 Mock 流式回复（与 Python chat_stream Mock 分支逐字一致）。 */
async function* mockChatStream(messages: unknown[]): AsyncGenerator<ChatDelta, void, unknown> {
  let lastUser = '';
  for (const m of [...(messages ?? [])].reverse()) {
    if (typeof m === 'object' && m !== null && (m as { role?: string }).role === 'user') {
      const c = (m as { content?: unknown }).content;
      lastUser = typeof c === 'string' ? c : '';
      break;
    }
  }
  yield { type: 'content', delta: '【Mock 对话】\n' };
  await sleep(400);
  yield {
    type: 'content',
    delta:
      '当前未配置 LLM API Key / Agent，以下为演示回复。\n\n' +
      '你刚才说：\n\n' +
      `> ${lastUser.slice(0, 200)}\n\n` +
      '在管理后台「节点管理」为 AI 对话节点绑定模型（+提示词）或 FastClaw Agent 后，' +
      '即可获得真实的多轮对话回复。\n',
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
