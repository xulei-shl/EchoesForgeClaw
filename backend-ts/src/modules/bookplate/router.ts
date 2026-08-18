import type { FastifyInstance, FastifyRequest } from 'fastify';
import { llmService } from '../../services/llm-service.js';
import { imageService } from '../../services/image-service.js';
import {
  fastclawAgentService,
  FastClawAgentError,
  extractImageUrl,
  type FastClawEvent,
  type FastClawRuntimeConfig,
} from '../../services/fastclaw-service.js';
import {
  textConfigFrom,
  visionConfigFrom,
  imageConfigFrom,
  agentConfigFrom,
  agentConfigFromWithOverride,
} from '../../services/node-config-service.js';
import { chatStreamToResponse, type ChatStreamEvent } from './stream.js';
import { NODE_TEMPLATES, NODE_TYPES } from './node-types.js';
import { env } from '../../config/env.js';
import { fetchCalendar, fetchWeather, SmallToolError } from '../../services/tool-service.js';
import { getDb } from '../../config/database.js';
import {
  findNodeConfigById,
  findLLMConfigById,
  findFastClawAgentConfigById,
  listActiveFastClawAgents,
  listActiveLLMConfigModelNames,
  listActiveNodeConfigs,
  findBookByIsbn,
  insertBookByIsbn,
  rowToBook,
  updateBookRow,
  getAppSettingsMap,
} from '../../repositories/index.js';
import { ImageGenerationError } from '../../infrastructure/ai/errors.js';
import type { ImageModelConfig } from '../../infrastructure/ai/types.js';
import { DoubanIsbnClient, DOUBAN_BASE_URL, type DoubanClientConfig } from '../../services/douban-service.js';
import {
  cachedCoverUrl,
  coverLocalMissing,
  downloadDoubanCover,
  fetchCoverBytes,
  backgroundCoverTask,
} from './covers.js';
import {
  BifrostError,
  BifrostNotConfiguredError,
  BifrostNotFoundError,
  downloadBifrostSkillZip,
  getPrompt,
  listPrompts,
  searchBifrostSkills,
} from '../../services/bifrost-service.js';
import {
  SkillNotFoundError,
  SkillValidationError,
  getSkillNote,
  installSkillZip,
  registerExistingBifrostSkill,
  installUserSkillZip,
  listInstalledSkills,
  nodeWorkspace,
  removeSkill,
  resolveSkillAbs,
} from '../../services/skill-agent-service.js';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * bookplate 模块路由（对应 Python `app/modules/bookplate/router.py`）。
 *
 * 流式协议（AI SDK UI Message Stream，前端 useChat 消费）：
 * - chat / generate-prompt / analyze-image / generate-image(agent)：统一流式输出，
 *   正文走 text parts，Agent 中间步骤走 `data-agent_*` 自定义 part；
 * - generate-image(LLM)：单结果 JSON（{ image_url, mock }）。
 *
 * 执行模式由节点配置决定：Skill Agent（第二阶段）> FastClaw Agent > LLM（AI SDK）> Mock。
 * 已移植：isbn/cover（豆瓣客户端）、skills（列表/检索/安装/上传/移除/文件下载）。
 * 尚未移植：Skill Agent 执行模式（第二阶段，deepseek harness）。
 */

// ---------------------------------------------------------------------------
// 请求体（对应 Python Pydantic 模型）
// ---------------------------------------------------------------------------

export interface ChatRequest {
  messages?: unknown[];
  message?: string;
  images?: string[];
  config_id?: number | null;
  node_id?: string | null;
  epoch?: number;
  skills?: string[];
  workspace_id?: string | null;
  /** 节点内手动覆盖的模型名（仅 LLM 模式生效；空/缺省 = 跟随节点配置的默认模型） */
  model_name?: string | null;
  /** 节点内手动选择的 FastClaw Agent 配置 id（仅 Agent 模式生效；空/缺省 = 跟随节点配置） */
  agent_config_id?: number | null;
}

export interface AnalyzeImageRequest {
  image?: string | null;
  cover_url?: string | null;
  config_id?: number | null;
  node_id?: string | null;
  /** 节点内手动覆盖的模型名（仅 LLM 模式生效；空/缺省 = 跟随节点配置的默认模型） */
  model_name?: string | null;
}

export interface PromptRequest {
  metadata?: Record<string, unknown>;
  analysis?: string | null;
  text?: string | null;
  config_id?: number | null;
  node_id?: string | null;
  /** 节点内手动覆盖的模型名（仅 LLM 模式生效；空/缺省 = 跟随节点配置的默认模型） */
  model_name?: string | null;
}

export interface ImageGenRequest {
  prompt: string;
  size?: string | null;
  ratio?: string | null;
  image?: string[] | null;
  config_id?: number | null;
  node_id?: string | null;
  /** 节点内手动覆盖的模型名（仅 LLM 模式生效；空/缺省 = 跟随节点配置的默认模型） */
  model_name?: string | null;
}

// ---------------------------------------------------------------------------
// 工具函数（对应 Python router.py 内联逻辑）
// ---------------------------------------------------------------------------

const MAX_UPLOAD_IMAGE_BYTES = 8 * 1024 * 1024;

const _IMAGE_MAGIC_PREFIXES: Array<[number[], string]> = [
  [[0xff, 0xd8, 0xff], '.jpg'],
  [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], '.png'],
  [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], '.gif'],
  [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], '.gif'],
];

/** 节点类型 → 可用的 LLM 配置 kind（模型候选列表过滤用）；未列出的节点类型返回空 = 不限。 */
function llmKindsForNodeType(nodeType: string): string[] {
  switch (nodeType) {
    case NODE_TYPES.CHAT:
      return ['text', 'multimodal']; // 多轮对话：文本 / 多模态（可带图）
    case NODE_TYPES.IMAGE_ANALYSIS:
      return ['multimodal']; // 视觉分析（需要视觉能力）
    case NODE_TYPES.PROMPT:
      return ['text', 'multimodal']; // 提示词生成：多模态模型同样可做文本生成
    case NODE_TYPES.IMAGE:
      return ['image']; // 图像生成
    default:
      return [];
  }
}

/** 通过文件头魔数判断字节是否为真实图片；是则返回扩展名，否则 null。 */
function detectImageExt(content: Uint8Array): string | null {
  if (!content.length) return null;
  for (const [magic, ext] of _IMAGE_MAGIC_PREFIXES) {
    if (magic.every((b, i) => content[i] === b)) return ext;
  }
  if (content.length >= 12 && String.fromCharCode(...content.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...content.subarray(8, 12)) === 'WEBP') {
    return '.webp';
  }
  return null;
}

/** 解析前端上传图片的 base64 data URL，返回原始图片字节（非法返回 null）。 */
function decodeUploadedImage(dataUrl: string): Uint8Array | null {
  try {
    const idx = dataUrl.indexOf(',');
    const meta = dataUrl.slice(0, idx);
    const b64 = dataUrl.slice(idx + 1);
    if (!meta.includes('image/') || !b64) return null;
    const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    if (!bytes.length || bytes.length > MAX_UPLOAD_IMAGE_BYTES) return null;
    if (!detectImageExt(bytes.subarray(0, 12))) return null;
    return bytes;
  } catch {
    return null;
  }
}

/** FastClaw 会话 key（同用户同节点重试共享上下文；epoch 清空对话后递增）。 */
function agentSessionKey(userId: number, nodeId?: string | null, epoch = 0): string {
  return `bookplate-${userId}-${nodeId || 'anon'}-${epoch}`;
}

/** 元数据 + 图片分析文本 + 文本节点内容 → Agent 模式用户消息（不传图片，防 SSRF）。 */
function agentPromptMessage(
  metadata: Record<string, unknown>,
  analysis = '',
  text = ''
): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(metadata)) {
    if (['cover_image', 'cover_image_local', 'coverUrl', 'image_url', 'image_url_local'].includes(k)) {
      continue;
    }
    lines.push(`${k}: ${String(v)}`);
  }
  let message = lines.length ? lines.join('\n') : JSON.stringify(metadata);
  if (analysis) message += '\n\n图片分析结果：\n' + analysis;
  if (text) message += '\n\n文本节点内容：\n' + text;
  return message;
}

/** FastClaw 归一化事件 → 统一 ChatStreamEvent（data-agent_* part 语义沿用旧事件名）。 */
function* agentEventToStream(evt: FastClawEvent, contentEvent: 'content_delta' | 'text' = 'content_delta'): Generator<ChatStreamEvent> {
  switch (evt.type) {
    case 'content_delta':
    case 'content':
      yield { type: 'content_delta', delta: evt.data.delta };
      break;
    case 'tool_call':
      yield { type: 'tool_call', id: evt.data.id, name: evt.data.name, arguments: evt.data.arguments };
      break;
    case 'tool_result':
      yield { type: 'tool_result', id: evt.data.id, name: evt.data.name, result: evt.data.result };
      break;
    case 'status':
      yield { type: 'status', message: evt.data.message };
      break;
    case 'subagent_progress':
      yield { type: 'status', message: `子任务: ${String(evt.data.phase ?? '')}` };
      break;
    case 'error':
      yield { type: 'error', message: evt.data.message };
      break;
    case 'done':
      break;
  }
}

/** 客户端断开 → AbortSignal（停止生成/删除节点/关闭页面时中止底层流）。 */
function requestAbortSignal(request: FastifyRequest): AbortSignal {
  const abort = new AbortController();
  request.raw.on('close', () => {
    if (request.raw.destroyed) abort.abort();
  });
  return abort.signal;
}

/** 豆瓣客户端配置（按系统设置组装；对应 Python _douban_client_config）。 */
function doubanClientConfig(db = getDb()): Partial<DoubanClientConfig> {
  const s = getAppSettingsMap(db);
  const config: Partial<DoubanClientConfig> = {};
  if (s['douban.base_url']) config.base_url = s['douban.base_url'];
  if (s['douban.proxy']) config.proxy = s['douban.proxy'];
  const qps = Number(s['douban.qps'] ?? '0.5');
  if (Number.isFinite(qps) && qps > 0) config.qps = Math.min(qps, 2.0);
  return config;
}

/** 封面代理 URL（前端 <img> 经此加载，后端带 Referer 下载缓存）。 */
function proxyCoverUrl(request: FastifyRequest, coverImage: string): string {
  return `${request.protocol}://${request.host}/api/modules/bookplate/cover?url=${encodeURIComponent(coverImage)}`;
}

/** 节点是否绑定 Skill Agent 模式（第二阶段迁移，暂不支持）。 */
function hasSkillAgentBinding(configId: number | null): boolean {
  if (configId == null) return false;
  const nc = findNodeConfigById(getDb(), configId);
  return !!nc && nc.skillAgentConfigId != null && !!nc.isActive;
}

// ---------------------------------------------------------------------------
// 路由注册
// ---------------------------------------------------------------------------

export async function registerBookplateRouter(app: FastifyInstance): Promise<void> {
  // ---- AI 对话节点：多轮对话流式 ----
  app.post(
    '/api/modules/bookplate/chat',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as ChatRequest;
      const configId = payload.config_id ?? null;

      if (hasSkillAgentBinding(configId)) {
        return reply.send(
          chatStreamToResponse(
            (async function* () {
              yield {
                type: 'error',
                message: 'Skill Agent 模式将在第二阶段迁移（当前请改用 LLM / FastClaw Agent 配置）',
              };
            })()
          )
        );
      }

      const agentConfig: FastClawRuntimeConfig | null = agentConfigFromWithOverride(
        configId,
        payload.agent_config_id ?? null,
        NODE_TYPES.CHAT,
        request.authUser!.id
      );
      const textConfig = textConfigFrom(configId, NODE_TYPES.CHAT);

      // FastClaw Agent 模式：SSE 客户端 → 归一化事件 → UI Message Stream
      if (agentConfig) {
        const cfg = agentConfig;
        const sessionKey = agentSessionKey(request.authUser!.id, payload.node_id, payload.epoch ?? 0);
        async function* agentEvents(): AsyncGenerator<ChatStreamEvent, void, unknown> {
          try {
            for await (const evt of fastclawAgentService.runAgent(
              cfg,
              payload.message ?? '',
              sessionKey,
              payload.images?.length ? payload.images : undefined,
              { module: 'bookplate', node_type: NODE_TYPES.CHAT }
            )) {
              yield* agentEventToStream(evt);
            }
          } catch (err) {
            yield { type: 'error', message: err instanceof FastClawAgentError ? err.message : String(err) };
          }
        }
        return reply.send(chatStreamToResponse(agentEvents()));
      }

      // LLM 模式：AI SDK streamText → 归一化事件 → UI Message Stream
      async function* llmEvents(): AsyncGenerator<ChatStreamEvent, void, unknown> {
        try {
          // 节点内手动选择的模型名覆盖默认模型（保留配置的 apiKey / base_url / 系统提示词）
          const config =
            payload.model_name && textConfig
              ? { ...textConfig, model_name: payload.model_name }
              : textConfig;
          for await (const chunk of llmService.chatStream(
            payload.messages ?? [],
            config,
            requestAbortSignal(request)
          )) {
            yield chunk.type === 'reasoning'
              ? { type: 'reasoning_delta', delta: chunk.delta }
              : { type: 'content_delta', delta: chunk.delta };
          }
        } catch (err) {
          yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
        }
      }
      return reply.send(chatStreamToResponse(llmEvents()));
    }
  );

  // ---- 图片分析节点 ----
  app.post(
    '/api/modules/bookplate/analyze-image',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as AnalyzeImageRequest;
      const configId = payload.config_id ?? null;
      const agentConfig = agentConfigFrom(configId, NODE_TYPES.IMAGE_ANALYSIS, request.authUser!.id);
      const visionConfig = visionConfigFrom(configId, NODE_TYPES.IMAGE_ANALYSIS);

      // 图片来源：上传 base64 > 豆瓣封面 URL（本地缓存 + Referer 下载）
      let imageBytes: Uint8Array | null = null;
      if (payload.image) {
        imageBytes = decodeUploadedImage(payload.image);
      } else if (payload.cover_url) {
        const clientConfig = doubanClientConfig();
        imageBytes = await fetchCoverBytes(payload.cover_url, {
          proxy: clientConfig.proxy,
          isDisconnected: async () => requestAbortSignal(request).aborted,
        });
      }
      if (!imageBytes) {
        return reply.code(400).send({ detail: '未提供可分析的图片（上传或封面 URL 均无效）' });
      }

      const ext = detectImageExt(imageBytes.subarray(0, 12)) || 'jpg';
      const dataUrl = `data:image/${ext};base64,${Buffer.from(imageBytes).toString('base64')}`;

      if (agentConfig) {
        const cfg = agentConfig;
        const sessionKey = agentSessionKey(request.authUser!.id, payload.node_id);
        async function* agentEvents(): AsyncGenerator<ChatStreamEvent, void, unknown> {
          let text = '';
          try {
            for await (const evt of fastclawAgentService.runAgent(
              cfg,
              '',
              sessionKey,
              [dataUrl],
              { module: 'bookplate', node_type: NODE_TYPES.IMAGE_ANALYSIS }
            )) {
              if (evt.type === 'content_delta' || evt.type === 'content') {
                text += evt.data.delta;
                continue; // 分析文本最后统一产出（避免与中间步骤交错）
              }
              yield* agentEventToStream(evt);
            }
            if (text.trim()) yield { type: 'content_delta', delta: text };
          } catch (err) {
            yield { type: 'error', message: err instanceof FastClawAgentError ? err.message : String(err) };
          }
        }
        return reply.send(chatStreamToResponse(agentEvents()));
      }

      // LLM 模式：generateText 单结果 → 以单个 text 增量输出
      async function* llmEvents(): AsyncGenerator<ChatStreamEvent, void, unknown> {
        try {
          // 节点内手动选择的模型名覆盖默认模型（保留配置的 apiKey / base_url / 系统提示词）
          const config =
            payload.model_name && visionConfig
              ? { ...visionConfig, model_name: payload.model_name }
              : visionConfig;
          const analysis = await llmService.analyzeCover(imageBytes!, config);
          if (analysis) yield { type: 'content_delta', delta: analysis };
        } catch (err) {
          yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
        }
      }
      return reply.send(chatStreamToResponse(llmEvents()));
    }
  );

  // ---- 提示词生成节点 ----
  app.post(
    '/api/modules/bookplate/generate-prompt',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as PromptRequest;
      const metadata = payload.metadata ?? {};
      const analysis = payload.analysis ?? '';
      const text = payload.text ?? '';
      const configId = payload.config_id ?? null;

      const agentConfig = agentConfigFrom(configId, NODE_TYPES.PROMPT, request.authUser!.id);
      const textConfig = textConfigFrom(configId, NODE_TYPES.PROMPT);

      if (agentConfig) {
        const cfg = agentConfig;
        const sessionKey = agentSessionKey(request.authUser!.id, payload.node_id);
        async function* agentEvents(): AsyncGenerator<ChatStreamEvent, void, unknown> {
          try {
            for await (const evt of fastclawAgentService.runAgent(
              cfg,
              agentPromptMessage(metadata, analysis, text),
              sessionKey,
              undefined,
              { module: 'bookplate', node_type: NODE_TYPES.PROMPT }
            )) {
              yield* agentEventToStream(evt);
            }
          } catch (err) {
            yield { type: 'error', message: err instanceof FastClawAgentError ? err.message : String(err) };
          }
        }
        return reply.send(chatStreamToResponse(agentEvents()));
      }

      async function* llmEvents(): AsyncGenerator<ChatStreamEvent, void, unknown> {
        try {
          // 节点内手动选择的模型名覆盖默认模型（保留配置的 apiKey / base_url / 系统提示词）
          const config =
            payload.model_name && textConfig
              ? { ...textConfig, model_name: payload.model_name }
              : textConfig;
          for await (const delta of llmService.generatePromptStream(
            metadata,
            config,
            analysis,
            text
          )) {
            yield { type: 'content_delta', delta };
          }
        } catch (err) {
          yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
        }
      }
      return reply.send(chatStreamToResponse(llmEvents()));
    }
  );

  // ---- 图像生成节点 ----
  app.post(
    '/api/modules/bookplate/generate-image',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as ImageGenRequest;
      const prompt = (payload.prompt ?? '').trim();
      if (!prompt) return reply.code(400).send({ detail: 'prompt 不能为空' });
      const configId = payload.config_id ?? null;

      const agentConfig = agentConfigFrom(configId, NODE_TYPES.IMAGE, request.authUser!.id);

      // Agent 模式：流式透传中间步骤 + 最终 image_url 事件
      if (agentConfig) {
        const cfg = agentConfig;
        const sessionKey = agentSessionKey(request.authUser!.id, payload.node_id);
        async function* agentEvents(): AsyncGenerator<ChatStreamEvent, void, unknown> {
          let imageUrl: string | null = null;
          let finalText = '';
          try {
            for await (const evt of fastclawAgentService.runAgent(
              cfg,
              prompt,
              sessionKey,
              payload.image?.length ? payload.image : undefined,
              { module: 'bookplate', node_type: NODE_TYPES.IMAGE, prompt }
            )) {
              if (evt.type === 'content_delta' || evt.type === 'content') {
                finalText += evt.data.delta;
              } else if (evt.type === 'tool_result') {
                const candidate = extractImageUrl(evt.data.result);
                if (candidate && !imageUrl) imageUrl = candidate;
              }
              yield* agentEventToStream(evt);
            }
            if (!imageUrl) imageUrl = extractImageUrl(finalText);
            if (!imageUrl) {
              yield { type: 'error', message: 'Agent 未返回图片地址' };
              return;
            }
            try {
              const localUrl = await imageService.saveRemoteImage(imageUrl, request.authUser!.id);
              // 结构化图片事件（前端 image_url 语义）：本地落盘 URL + mock=false；
              // status 消息仅作日志/展示，前端以 agent_image 为准
              yield { type: 'agent_image', url: localUrl };
              yield {
                type: 'status',
                message: `图片已保存: ${localUrl}`,
              };
            } catch (err) {
              yield { type: 'error', message: err instanceof ImageGenerationError ? err.message : String(err) };
            }
          } catch (err) {
            yield { type: 'error', message: err instanceof FastClawAgentError ? err.message : String(err) };
          }
        }
        return reply.send(chatStreamToResponse(agentEvents()));
      }

      // LLM 模式：单结果 JSON
      if (requestAbortSignal(request).aborted) {
        return reply.code(499).send({ detail: '客户端已断开连接' });
      }
      const imageConfig: ImageModelConfig = imageConfigFrom(configId, NODE_TYPES.IMAGE) ?? {
        apiKey: '',
        base_url: '',
        model_name: '',
      };
      imageConfig.size = payload.size || imageConfig.size;
      imageConfig.ratio = payload.ratio || imageConfig.ratio;
      imageConfig.image = payload.image?.length ? payload.image : imageConfig.image;
      // 节点内手动选择的模型名覆盖默认模型（保留配置的 apiKey / base_url）
      if (payload.model_name) imageConfig.model_name = payload.model_name;
      try {
        const result = await imageService.generateImage(prompt, imageConfig, request.authUser!.id);
        return result;
      } catch (err) {
        if (err instanceof ImageGenerationError) {
          return reply.code(502).send({ detail: err.message });
        }
        return reply.code(502).send({ detail: `图片生成失败: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  );

  // ---- 豆瓣封面代理（公开：<img> 无法携带鉴权头，必须公开） ----
  app.get('/api/modules/bookplate/cover', async (request, reply) => {
    const url = (request.query as { url?: string }).url ?? '';
    let hostname = '';
    try {
      hostname = new URL(url).hostname;
    } catch {
      /* 非法 URL */
    }
    if (!hostname.endsWith('.doubanio.com')) {
      return reply.code(400).send({ detail: 'Only douban image URLs are allowed' });
    }
    const cached = cachedCoverUrl(url);
    if (cached) return reply.redirect(cached);

    const clientConfig = doubanClientConfig();
    const local = await downloadDoubanCover(url, {
      proxy: clientConfig.proxy,
      isDisconnected: async () => requestAbortSignal(request).aborted,
    });
    if (local) return reply.redirect(local);
    return reply.code(502).send({ detail: 'Failed to fetch cover image' });
  });

  // ---- 图书元数据（ISBN → 豆瓣 API，book_cache 持久化缓存） ----
  app.get(
    '/api/modules/bookplate/isbn/:isbn',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = request.params as { isbn: string };
      const isbn = params.isbn;
      const force = (request.query as { force?: string }).force === 'true';
      const db = getDb();
      const clientConfig = doubanClientConfig(db);
      const proxy = clientConfig.proxy ?? '';

      if (requestAbortSignal(request).aborted) {
        return reply.code(499).send({ detail: '客户端已断开连接' });
      }

      // 非强制更新：先查库，命中即返回缓存
      if (!force) {
        const row = findBookByIsbn(db, isbn);
        if (row) {
          const book = rowToBook(row);
          book.isbn = isbn;
          if (book.cover_image && coverLocalMissing(row.coverImageLocal)) {
            // 本地封面缺失：先用代理 URL 兜底展示，同时后台补图回写
            book.cover_image_local = proxyCoverUrl(request, String(book.cover_image));
            void backgroundCoverTask(isbn, String(book.cover_image), proxy);
          }
          return book;
        }
      }

      // 未命中缓存或强制更新：调用豆瓣 API
      const client = new DoubanIsbnClient({ base_url: clientConfig.base_url ?? DOUBAN_BASE_URL, ...clientConfig });
      const book = await client.fetch(isbn);
      if (!book) return reply.code(404).send({ detail: 'Book not found' });

      // 写库：force 覆盖更新；否则以唯一 isbn 查重插入
      const existing = findBookByIsbn(db, isbn);
      if (existing) {
        updateBookRow(db, isbn, book);
      } else {
        insertBookByIsbn(db, isbn);
        updateBookRow(db, isbn, book);
      }

      if (book.cover_image) {
        book.cover_image_local = proxyCoverUrl(request, String(book.cover_image));
        void backgroundCoverTask(isbn, String(book.cover_image), proxy);
      }
      book.isbn = isbn;
      return book;
    }
  );

  // ---- 小工具节点：万年历 / 天气查询（无需配置，直接调用第三方公开 API） ----

  app.post(
    '/api/modules/bookplate/calendar',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as { date?: string };
      // 凭据与基础地址：优先 /admin/settings（mxnzp.*，种子自 .env），纯 .env 值作回退
      const s = getAppSettingsMap(getDb());
      const appId = (s['mxnzp.app_id'] ?? '').trim() || env.mxnzpAppId;
      const appSecret = (s['mxnzp.app_secret'] ?? '').trim() || env.mxnzpAppSecret;
      const baseUrl = (s['mxnzp.base_url'] ?? '').trim();
      if (!appId || !appSecret) {
        return reply.code(503).send({
          detail: '万年历服务未配置：请在管理端「系统设置」配置 mxnzp.app_id / mxnzp.app_secret（或设置 .env 的 MXNZP_APP_ID / MXNZP_APP_SECRET 后重启后端）',
        });
      }
      try {
        return await fetchCalendar(payload.date, appId, appSecret, baseUrl);
      } catch (err) {
        if (err instanceof SmallToolError) {
          return reply.code(502).send({ detail: err.message });
        }
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  app.post(
    '/api/modules/bookplate/weather',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as { city?: string };
      try {
        return await fetchWeather(payload.city);
      } catch (err) {
        if (err instanceof SmallToolError) {
          return reply.code(502).send({ detail: err.message });
        }
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // ---- 多模态工具：地图海报图片落盘（客户端渲染导出 → data URL → 独立子目录，不写历史记录） ----
  app.post(
    '/api/modules/bookplate/save-image',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as { image?: string };
      const image = (payload.image ?? '').trim();
      if (!image || !image.startsWith('data:image/')) {
        return reply.code(400).send({ detail: 'image 必须为 base64 data URL' });
      }
      try {
        // 中间结果目录（runtime/{userId}/map-posters），与图像生成产物（generated）分开
        const imageUrl = imageService.saveMapPosterImage(request.authUser!.id, image);
        return { image_url: imageUrl };
      } catch (err) {
        if (err instanceof ImageGenerationError) {
          return reply.code(502).send({ detail: err.message });
        }
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // ---- 节点注册表（画板「+」菜单数据源） ----
  app.get(
    '/api/modules/bookplate/node-registry',
    { preHandler: app.authenticate },
    async () => {
      const db = getDb();
      const configs = listActiveNodeConfigs(db);
      const items = [];
      for (const nc of configs) {
        if (!nc.isActive || !NODE_TEMPLATES.some((t) => t.type === nc.nodeType)) continue;
        let mode: 'skill_agent' | 'agent' | 'llm' = 'llm';
        if (nc.skillAgentConfigId != null) mode = 'skill_agent';
        else if (nc.agentConfigId != null) mode = 'agent';
        items.push({
          id: nc.id,
          node_type: nc.nodeType,
          name: nc.name,
          group: nc.group,
          group_order: nc.groupOrder,
          mode,
          agent_name: null,
          skill_agent_config_name: null,
          llm_config_name: null,
          is_active: !!nc.isActive,
        });
      }
      return { templates: NODE_TEMPLATES, configs: items };
    }
  );

  // ---- 模型列表（各节点「模型」下拉数据源：admin llm-configs 已配置的模型名，不调服务商 API） ----
  app.get(
    '/api/modules/bookplate/llm-models',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const q = (request.query ?? {}) as { config_id?: string };
      const configId = Number(q.config_id) || null;
      if (configId == null) return reply.code(400).send({ detail: '缺少 config_id' });
      const db = getDb();
      const nc = findNodeConfigById(db, configId);
      // 不限节点类型：chat / prompt_generation / image_generation 等绑定模型配置的节点通用
      if (!nc || nc.llmConfigId == null || !nc.isActive) {
        return reply.code(400).send({ detail: '节点未绑定可用的模型配置' });
      }
      const llm = findLLMConfigById(db, nc.llmConfigId);
      if (!llm || !llm.apiKey || !llm.isActive) {
        return reply.code(400).send({ detail: '模型配置不可用（未启用或缺少 API Key）' });
      }

      // 候选列表 = admin 启用配置中、与节点类型匹配 kind 的模型名（去重，默认模型恒在首位）；
      // 覆盖仅改 model_name，保留节点自身配置的 apiKey / base_url，故不跨服务商拉全量模型
      const defaultModel = llm.modelName || '';
      const models = [
        ...new Set([defaultModel, ...listActiveLLMConfigModelNames(db, llmKindsForNodeType(nc.nodeType))]),
      ].filter(Boolean);
      return { default_model: defaultModel, models };
    }
  );

  // ---- FastClaw Agent 列表（AI 对话节点「Agent」下拉数据源；不含 api_key 等敏感字段） ----
  app.get(
    '/api/modules/bookplate/fastclaw-agents',
    { preHandler: app.authenticate },
    async (request) => {
      const q = (request.query ?? {}) as { config_id?: string };
      const configId = Number(q.config_id) || null;
      // 默认 Agent = 节点配置绑定的 Agent（供前端展示「默认」项）
      let defaultAgent: { id: number; name: string; agent_name: string | null } | null = null;
      if (configId != null) {
        const nc = findNodeConfigById(getDb(), configId);
        if (nc && nc.nodeType === NODE_TYPES.CHAT && nc.agentConfigId != null && nc.isActive) {
          const bound = findFastClawAgentConfigById(getDb(), nc.agentConfigId);
          if (bound) {
            defaultAgent = { id: bound.id, name: bound.name, agent_name: bound.agentName };
          }
        }
      }
      const agents = listActiveFastClawAgents(getDb()).map((a) => ({
        id: a.id,
        name: a.name,
        agent_name: a.agentName,
      }));
      return { default_agent: defaultAgent, agents };
    }
  );

  // ---- FastClaw 探测（admin 配置页「拉取」用） ----
  app.get(
    '/api/modules/bookplate/fastclaw-probe',
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      const query = (request.query ?? {}) as { base_url?: string; api_key?: string };
      const baseUrl = query.base_url ?? '';
      const apiKey = query.api_key ?? '';
      if (!baseUrl || !apiKey) {
        return reply.code(400).send({ detail: '请填写 Base URL 与 API Key' });
      }
      try {
        const agents = await fastclawAgentService.listAgents(baseUrl, apiKey);
        return { agents };
      } catch (err) {
        return reply.code(502).send({ detail: err instanceof FastClawAgentError ? err.message : String(err) });
      }
    }
  );

  // ---- Bifrost 提示词检索（供「提示词检索」PromptSearchNode 节点使用） ----

  // 提示词列表（支持 q 搜索与 folder_id 过滤；force=1 绕过 TTL 缓存，供节点打开选择器时强制刷新）
  app.get(
    '/api/modules/bookplate/bifrost/prompts',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const q = (request.query ?? {}) as { folder_id?: string; q?: string; force?: string };
      try {
        const prompts = await listPrompts(getDb(), q.folder_id || null, q.q ?? '', q.force === '1' || q.force === 'true');
        return { prompts };
      } catch (err) {
        if (err instanceof BifrostNotFoundError) return reply.code(404).send({ detail: err.message });
        if (err instanceof BifrostNotConfiguredError) return reply.code(503).send({ detail: err.message });
        if (err instanceof BifrostError) return reply.code(502).send({ detail: err.message });
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // 提示词详情（提取正文文本与本地预览图）
  app.get(
    '/api/modules/bookplate/bifrost/prompts/:prompt_id',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const promptId = (request.params as { prompt_id: string }).prompt_id;
      try {
        return await getPrompt(getDb(), promptId);
      } catch (err) {
        if (err instanceof BifrostNotFoundError) return reply.code(404).send({ detail: err.message });
        if (err instanceof BifrostNotConfiguredError) return reply.code(503).send({ detail: err.message });
        if (err instanceof BifrostError) return reply.code(502).send({ detail: err.message });
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // ---- Skill 工作区（Skill Agent 的 skill 来源） ----

  // 列出当前用户已安装的 skill
  app.get(
    '/api/modules/bookplate/skills',
    { preHandler: app.authenticate },
    async (request) => {
      return { skills: listInstalledSkills(request.authUser!.id) };
    }
  );

  // 检索 Bifrost Skills 仓库（普通用户可用，供 Skill 检索节点 / Skill Agent 管理弹层）
  app.get(
    '/api/modules/bookplate/skills/bifrost-search',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const q = (request.query ?? {}) as { q?: string; limit?: string };
      const limit = Number(q.limit ?? 50) || 50;
      try {
        const skills = await searchBifrostSkills(getDb(), q.q ?? '', limit);
        // 合并管理员全局备注（纯展示，不进入 skill 包本体）
        const withNotes = skills.map((s) => {
          const note = getSkillNote(String(s.name ?? ''));
          return note ? { ...s, note } : s;
        });
        return { skills: withNotes };
      } catch (err) {
        if (err instanceof BifrostNotConfiguredError) return reply.code(503).send({ detail: err.message });
        if (err instanceof BifrostError) return reply.code(502).send({ detail: err.message });
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // 从 Bifrost 安装 skill（按 name 下载 zip 并安装到当前用户工作区）
  app.post(
    '/api/modules/bookplate/skills/install',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as { name?: string };
      const name = (payload.name ?? '').trim();
      if (!name) return reply.code(400).send({ detail: 'skill 名称不能为空' });
      try {
        // 本地共享缓存优先：runtime/.agent/skills/{name} 已存在则跳过网络下载直接登记（毫秒级）
        let meta: Record<string, unknown>;
        const cached = registerExistingBifrostSkill(request.authUser!.id, name);
        if (cached) {
          meta = cached;
        } else {
          const zipBytes = await downloadBifrostSkillZip(getDb(), name);
          if (!zipBytes.length || zipBytes.length > 20 * 1024 * 1024) {
            return reply.code(400).send({ detail: 'skill 压缩包为空或超过 20MB 上限' });
          }
          meta = installSkillZip(request.authUser!.id, zipBytes);
        }
        const note = getSkillNote(String(meta.name ?? ''));
        if (note) meta.note = note;
        return meta;
      } catch (err) {
        if (err instanceof BifrostNotConfiguredError) return reply.code(503).send({ detail: err.message });
        if (err instanceof BifrostNotFoundError) return reply.code(404).send({ detail: err.message });
        if (err instanceof BifrostError) return reply.code(502).send({ detail: err.message });
        if (err instanceof SkillValidationError) return reply.code(400).send({ detail: err.message });
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // 上传本地 skill zip 并安装到当前用户工作区（私有登记目录，真实解压）
  app.post(
    '/api/modules/bookplate/skills/upload',
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        const data = await request.file();
        if (!data) return reply.code(400).send({ detail: '缺少上传文件（字段名 file）' });
        const bytes = new Uint8Array(await data.toBuffer());
        if (!bytes.length || bytes.length > 20 * 1024 * 1024) {
          return reply.code(400).send({ detail: '文件为空或超过 20MB 上限' });
        }
        const meta = installUserSkillZip(request.authUser!.id, bytes);
        const note = getSkillNote(String(meta.name ?? ''));
        if (note) meta.note = note;
        return meta;
      } catch (err) {
        if (err instanceof SkillValidationError) return reply.code(400).send({ detail: err.message });
        return reply.code(400).send({ detail: `读取上传文件失败: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  );

  // 从用户工作区移除一个已安装的 skill
  app.delete(
    '/api/modules/bookplate/skills/:skill_name',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const skillName = (request.params as { skill_name: string }).skill_name;
      if (!skillName || skillName.includes('/') || skillName.includes('\\')) {
        return reply.code(400).send({ detail: '非法 skill 名称' });
      }
      try {
        removeSkill(request.authUser!.id, skillName);
        return { message: `已移除 skill：${skillName}` };
      } catch (err) {
        if (err instanceof SkillNotFoundError) return reply.code(404).send({ detail: err.message });
        return reply.code(400).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // 下载 skill 执行产生的文件（工作区内相对路径；workspace_id 可选，缺省回退工作区根）
  app.get(
    '/api/modules/bookplate/skill-files',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const q = (request.query ?? {}) as { path?: string; workspace_id?: string };
      const workspaceId = q.workspace_id ?? '';
      const workspace = workspaceId ? nodeWorkspace(request.authUser!.id, workspaceId) : undefined;
      const target = resolveSkillAbs(request.authUser!.id, q.path ?? '', workspace);
      if (!target || !existsSync(target) || !statSync(target).isFile()) {
        return reply.code(404).send({ detail: '文件不存在' });
      }
      reply.type('application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${path.basename(target)}"`);
      return reply.send(readFileSync(target));
    }
  );
}
