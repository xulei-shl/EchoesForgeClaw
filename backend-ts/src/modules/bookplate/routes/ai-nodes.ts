import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { statSync } from 'node:fs';
import { llmService } from '../../../services/llm-service.js';
import { imageService } from '../../../services/image-service.js';
import {
  fastclawAgentService,
  FastClawAgentError,
  extractImageUrl,
  type FastClawRuntimeConfig,
} from '../../../services/fastclaw-service.js';
import {
  textConfigFrom,
  visionConfigFrom,
  imageConfigFrom,
  agentConfigFrom,
  agentConfigFromWithOverride,
  skillAgentConfigFrom,
} from '../../../services/node-config-service.js';
import {
  appendArtifactManifest,
  clearPiSession,
  listWorkspaceArtifacts,
  preparePiWorkspace,
  runPiAgent,
  mimeOf,
  skillFileDownloadUrl,
} from '../../../services/pi-agent-service.js';
import { hydratePiSession, readSessionImageBlock } from '../../../services/pi-session-hydrate.js';
import { nodeWorkspace, sanitizeWorkspaceId } from '../../../services/skill-agent-service.js';
import { fastclawDataRoot, harvestFastclawArtifacts } from '../../../services/fastclaw-artifacts.js';
import { chatStreamToResponse, type ChatStreamEvent } from '../stream.js';
import { NODE_TYPES } from '../node-types.js';
import { ImageGenerationError } from '../../../infrastructure/ai/errors.js';
import type { ImageModelConfig } from '../../../infrastructure/ai/types.js';
import { fetchCoverBytes } from '../covers.js';
import {
  hasSkillAgentBinding,
  agentSessionKey,
  agentEventToStream,
  requestAbortSignal,
  decodeUploadedImage,
  detectImageExt,
  agentPromptMessage,
  doubanClientConfig,
  type ChatRequest,
  type AnalyzeImageRequest,
  type PromptRequest,
  type ImageGenRequest,
} from '../helpers.js';

export async function register(app: FastifyInstance): Promise<void> {
  // ---- AI 对话节点：多轮对话流式 ----
  app.post(
    '/api/modules/bookplate/chat',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as ChatRequest;
      const configId = payload.config_id ?? null;

      if (hasSkillAgentBinding(configId)) {
        // Skill Agent 模式（pi CLI 子进程）：装配 chatid 工作区 → pi --mode json 流式执行
        const saCfg = skillAgentConfigFrom(configId);
        async function* skillAgentEvents(): AsyncGenerator<ChatStreamEvent, void, unknown> {
          if (!saCfg?.chat) {
            yield {
              type: 'error',
              message: 'Skill Agent 配置无效：请检查绑定的模型配置（需启用且已配置 API Key）',
            };
            return;
          }
          const workspaceId =
            payload.workspace_id ?? `${payload.node_id ?? 'node'}_${Date.now()}`;
          let prepared;
          try {
            prepared = preparePiWorkspace(request.authUser!.id, workspaceId, {
              agentId: saCfg.configId,
              chatModel: {
                baseUrl: saCfg.chat.baseUrl,
                apiKey: saCfg.chat.apiKey,
                modelName: saCfg.chat.modelName,
                multimodal: saCfg.chat.kind === 'multimodal',
                apiFormat: saCfg.chat.apiFormat,
                thinkingFormat: saCfg.chat.thinkingFormat,
              },
              imageModel: saCfg.image,
              skillNames: payload.skills ?? [],
            });
          } catch (err) {
            yield {
              type: 'error',
              message: `Skill Agent 工作区装配失败: ${err instanceof Error ? err.message : String(err)}`,
            };
            return;
          }
          if (prepared.skippedSkills.length) {
            yield {
              type: 'status',
              message: `以下技能未安装，已跳过：${prepared.skippedSkills.join('、')}`,
            };
          }
          try {
            for await (const evt of runPiAgent({
              userId: request.authUser!.id,
              workspaceId,
              ws: prepared.ws,
              hasPrompt: prepared.hasPrompt,
              chatModelName: saCfg.chat.modelName,
              imageGenEnabled: !!saCfg.image,
              message: payload.message ?? '',
              images: payload.images?.length ? payload.images : undefined,
              thinkingLevel: payload.thinking ?? null,
              signal: requestAbortSignal(request),
            })) {
              yield evt;
            }
          } catch (err) {
            yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
          }
        }
        return reply.send(chatStreamToResponse(skillAgentEvents()));
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
        // 节点工作区（FastClaw 产物桥接的落盘目标；workspace_id 由前端首轮生成并持久化）
        const ws = nodeWorkspace(request.authUser!.id, payload.workspace_id ?? `${payload.node_id ?? 'node'}_${Date.now()}`);
        // 收集本轮 tool_result 与最终正文，供流结束后做产物路径收割
        const turnTexts: string[] = [];
        async function* agentEvents(): AsyncGenerator<ChatStreamEvent, void, unknown> {
          let finalText = '';
          try {
            for await (const evt of fastclawAgentService.runAgent(
              cfg,
              payload.message ?? '',
              sessionKey,
              payload.images?.length ? payload.images : undefined,
              { module: 'bookplate', node_type: NODE_TYPES.CHAT }
            )) {
              if (evt.type === 'tool_result') turnTexts.push(evt.data.result);
              else if (evt.type === 'content_delta' || evt.type === 'content') finalText += evt.data.delta;
              yield* agentEventToStream(evt);
            }
          } catch (err) {
            yield { type: 'error', message: err instanceof FastClawAgentError ? err.message : String(err) };
            return;
          }
          // 产物桥接（同机部署）：FastClaw 引用的本机文件拷入节点工作区 → 以
          // skill-files URL 发 agent_file，前端预览/下载与 Skill Agent 模式同构。
          // best-effort：任何失败不影响已完成的对话流。
          const fcRoot = fastclawDataRoot();
          if (fcRoot) {
            turnTexts.push(finalText);
            try {
              for (const art of harvestFastclawArtifacts({
                root: fcRoot,
                texts: turnTexts,
                destDir: path.join(ws, 'outputs'),
              })) {
                // manifest 落盘（best-effort）：产物在服务端可再到达（与 pi 模式同构）
                let mtimeMs = 0;
                try {
                  mtimeMs = statSync(path.join(ws, art.rel)).mtimeMs;
                } catch {
                  /* 刚拷入的文件 stat 失败不影响记录 */
                }
                appendArtifactManifest(ws, [
                  { rel: art.rel, mime: mimeOf(art.rel), size: art.size, mtimeMs },
                ]);
                yield {
                  type: 'agent_file',
                  file: {
                    url: skillFileDownloadUrl(art.rel, path.basename(ws)),
                    name: art.rel.slice(art.rel.lastIndexOf('/') + 1),
                    mime: mimeOf(art.rel),
                    size: art.size,
                    path: art.rel,
                  },
                };
              }
            } catch (err) {
              yield { type: 'status', message: `产物文件桥接失败: ${err instanceof Error ? err.message : String(err)}` };
            }
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

  // ---- AI 对话节点：清空会话（Skill Agent 模式删除 pi 会话历史，下次对话从零开始）----
  app.post(
    '/api/modules/bookplate/chat/clear',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as ChatRequest;
      const workspaceId = sanitizeWorkspaceId(payload.workspace_id ?? '');
      if (!workspaceId) {
        return reply.code(400).send({ detail: 'workspace_id 不能为空' });
      }
      return { cleared: clearPiSession(request.authUser!.id, workspaceId) };
    }
  );

  // ---- AI 对话节点：会话水合（服务端 pi 会话 jsonl → UI 历史；服务端为真相源）----
  // uid 取自鉴权态（非查询参数），workspace 经 sanitize + nodeWorkspace 防目录穿越
  app.get(
    '/api/modules/bookplate/chat/session',
    { preHandler: app.authenticate },
    async (request) => {
      const q = (request.query ?? {}) as { workspace_id?: string };
      const ws = nodeWorkspace(request.authUser!.id, sanitizeWorkspaceId(q.workspace_id ?? ''));
      return hydratePiSession(ws, sanitizeWorkspaceId(q.workspace_id ?? ''));
    }
  );

  // ---- 会话内联图片块（水合历史的鉴权取图：<img> 无法带 Authorization，前端 fetch→blob）----
  app.get(
    '/api/modules/bookplate/chat/session/image',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const q = (request.query ?? {}) as {
        workspace_id?: string;
        entry?: string;
        block?: string;
      };
      const block = Number(q.block);
      if (!q.entry || !Number.isInteger(block)) {
        return reply.code(400).send({ detail: 'entry 与 block 参数不能为空' });
      }
      const ws = nodeWorkspace(request.authUser!.id, sanitizeWorkspaceId(q.workspace_id ?? ''));
      const img = readSessionImageBlock(ws, q.entry, block);
      if (!img) return reply.code(404).send({ detail: '图片不存在' });
      reply.type(img.mime);
      return reply.send(img.data);
    }
  );

  // ---- 工作区产物列表（当前快照 ∪ manifest 历史；「工作区文件」面板数据源）----
  app.get(
    '/api/modules/bookplate/chat/files',
    { preHandler: app.authenticate },
    async (request) => {
      const q = (request.query ?? {}) as { workspace_id?: string };
      const workspaceId = sanitizeWorkspaceId(q.workspace_id ?? '');
      const ws = nodeWorkspace(request.authUser!.id, workspaceId);
      return { files: listWorkspaceArtifacts(ws, workspaceId) };
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

      // 图片来源：上传 base64 > 豆瓣封面 URL（本地缓存 + Referer 下载）；无图片时允许纯文本分析
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
      const text = (payload.text ?? '').trim();
      if (!imageBytes && !text) {
        return reply.code(400).send({ detail: '未提供可分析的图片或文本（上传 / 封面 URL / 上游文本均无效）' });
      }

      const dataUrl = imageBytes
        ? `data:image/${detectImageExt(imageBytes.subarray(0, 12)) || 'jpg'};base64,${Buffer.from(imageBytes).toString('base64')}`
        : null;

      if (agentConfig) {
        const cfg = agentConfig;
        const sessionKey = agentSessionKey(request.authUser!.id, payload.node_id);
        async function* agentEvents(): AsyncGenerator<ChatStreamEvent, void, unknown> {
          let analysis = '';
          try {
            for await (const evt of fastclawAgentService.runAgent(
              cfg,
              text,
              sessionKey,
              dataUrl ? [dataUrl] : undefined,
              { module: 'bookplate', node_type: NODE_TYPES.IMAGE_ANALYSIS }
            )) {
              if (evt.type === 'content_delta' || evt.type === 'content') {
                analysis += evt.data.delta;
                continue; // 分析文本最后统一产出（避免与中间步骤交错）
              }
              yield* agentEventToStream(evt);
            }
            if (analysis.trim()) yield { type: 'content_delta', delta: analysis };
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
          const analysis = await llmService.analyzeCover(imageBytes, config, text);
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
    '/api/modules/bookplate/generate-text',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as PromptRequest;
      const metadata = payload.metadata ?? {};
      const analysis = payload.analysis ?? '';
      const text = payload.text ?? '';
      const configId = payload.config_id ?? null;

      const agentConfig = agentConfigFrom(configId, NODE_TYPES.TEXT_GENERATION, request.authUser!.id);
      const textConfig = textConfigFrom(configId, NODE_TYPES.TEXT_GENERATION);

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
              { module: 'bookplate', node_type: NODE_TYPES.TEXT_GENERATION }
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
          for await (const delta of llmService.generateTextStream(
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

  // ---- 保存/导出图片落盘（小票等节点：base64 data URL → runtime/{userId}/generated/） ----
  app.post(
    '/api/modules/bookplate/save-image',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as { image?: string };
      const image = payload.image;
      if (!image || typeof image !== 'string') {
        return reply.code(400).send({ detail: 'image 字段不能为空' });
      }
      try {
        const imageUrl = await imageService.saveRemoteImage(image, request.authUser!.id);
        return { image_url: imageUrl };
      } catch (err) {
        if (err instanceof ImageGenerationError) {
          return reply.code(400).send({ detail: err.message });
        }
        return reply.code(500).send({
          detail: `保存图片失败: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  );
}
