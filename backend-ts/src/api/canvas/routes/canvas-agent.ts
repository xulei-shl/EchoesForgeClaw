import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../../../config/database.js';
import { getAppSettingsMap } from '../../../repositories/index.js';
import { llmConfigs } from '../../../db/schema.js';
import {
  preparePiWorkspace,
  runPiAgent,
  resolvePiExtensions,
  computeWorkspaceGeneration,
  clearPiSession,
  buildWebSearchConfig,
  sendExtensionUiResponse,
} from '../../../services/ai/pi-agent-service.js';
import { guardrailsOverridesFromSettings } from '../../../services/ai/pi/guardrails.js';
import { chatStreamToSseResponse, type ChatStreamEvent } from '../stream.js';
import type { PiChatModelConfig } from '../../../services/ai/pi/workspace.js';

interface CanvasAgentChatRequest {
  prompt: string;
  chat_id?: string;
  workspace_id?: string;
}

/**
 * Mascot Agent（Canvas Assistant）专属后端路由：
 *
 * - POST /api/modules/bookplate/canvas-agent/chat（多轮对话流式，挂载 canvas-assistant 提示词与专用技能）
 * - POST /api/modules/bookplate/canvas-agent/ui-response（前端 dialog 作答 / 画布操作执行结果写回）
 * - POST /api/modules/bookplate/canvas-agent/clear（清空助手工作区会话）
 */
export async function register(app: FastifyInstance): Promise<void> {
  // 1) Canvas Assistant 对话流
  app.post(
    '/api/modules/bookplate/canvas-agent/chat',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as CanvasAgentChatRequest;
      const prompt = (payload.prompt ?? '').trim();
      if (!prompt) {
        return reply.code(400).send({ detail: 'prompt 不能为空' });
      }

      const db = getDb();
      // 获取当前激活的对话大模型（文本优先，回退多模态）
      const activeLlm =
        db
          .select()
          .from(llmConfigs)
          .where(and(eq(llmConfigs.isActive, true), eq(llmConfigs.kind, 'text')))
          .orderBy(llmConfigs.id)
          .get() ||
        db
          .select()
          .from(llmConfigs)
          .where(and(eq(llmConfigs.isActive, true), eq(llmConfigs.kind, 'multimodal')))
          .orderBy(llmConfigs.id)
          .get();

      if (!activeLlm || !activeLlm.apiKey) {
        async function* noModelEvent(): AsyncGenerator<ChatStreamEvent, void, unknown> {
          yield {
            type: 'error',
            message: '未检测到可用的对话大模型，请在管理后台「模型配置」中启用至少一个文本或多模态模型。',
          };
        }
        return reply.send(chatStreamToSseResponse(noModelEvent()));
      }

      const chatModel: PiChatModelConfig = {
        baseUrl: activeLlm.baseUrl ?? '',
        apiKey: activeLlm.apiKey,
        modelName: activeLlm.modelName,
        multimodal: activeLlm.kind === 'multimodal',
        apiFormat: activeLlm.apiFormat,
        thinkingFormat: activeLlm.thinkingFormat,
        contextWindow: activeLlm.contextWindow,
        maxTokens: activeLlm.maxTokens,
      };

      const chatId = (payload.chat_id || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
      const workspaceId = payload.workspace_id || `canvas-agent_${chatId}`;
      const defaultSkills = [
        'canvas-node-catalog',
        'canvas-feedback-guide',
        'canvas-multimodal-presets',
        'canvas-workflow-patterns',
      ];

      const settingsMap = getAppSettingsMap(db);
      const prepared = preparePiWorkspace(request.authUser!.id, workspaceId, {
        agentId: 'canvas-assistant',
        chatModel,
        imageModel: null,
        skillNames: defaultSkills,
        extraExtensions: ['pi-canvas-tools'],
        webSearchConfig: buildWebSearchConfig(settingsMap),
        guardrailsOverrides: guardrailsOverridesFromSettings(settingsMap),
      });

      const generation = computeWorkspaceGeneration({
        userId: request.authUser!.id,
        agentId: 'canvas-assistant',
        skillNames: defaultSkills,
        chatModel,
        imageModel: null,
        extensionNames: resolvePiExtensions(['pi-canvas-tools']).map((s) => s.name),
        guardrailsOverrides: guardrailsOverridesFromSettings(settingsMap),
      });

      const stream = runPiAgent({
        userId: request.authUser!.id,
        workspaceId,
        ws: prepared.ws,
        hasPrompt: prepared.hasPrompt,
        chatModelName: chatModel.modelName,
        imageGenEnabled: false,
        message: prompt,
        extensions: prepared.mountedExtensions,
        generation,
        contextWindow: chatModel.contextWindow,
      });

      return reply.send(chatStreamToSseResponse(stream));
    }
  );

  // 2) UI 交互响应写回
  app.post(
    '/api/modules/bookplate/canvas-agent/ui-response',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as {
        workspace_id?: string;
        id?: string;
        value?: string;
        confirmed?: boolean;
        cancelled?: boolean;
        answer?: string | boolean;
      };
      const workspaceId = payload.workspace_id?.trim();
      const id = payload.id?.trim();
      if (!workspaceId || !id) {
        return reply.code(400).send({ detail: '参数不完整 (workspace_id, id 必填)' });
      }

      let val = payload.value;
      if (val === undefined && typeof payload.answer === 'string') {
        val = payload.answer;
      }
      let confirmed = payload.confirmed;
      if (confirmed === undefined && typeof payload.answer === 'boolean') {
        confirmed = payload.answer;
      }

      const ok = sendExtensionUiResponse(request.authUser!.id, workspaceId, {
        id,
        ...(val !== undefined ? { value: val } : {}),
        ...(confirmed !== undefined ? { confirmed } : {}),
        ...(payload.cancelled !== undefined ? { cancelled: payload.cancelled } : {}),
      });
      return { success: ok };
    }
  );

  // 3) 清空助手会话
  app.post(
    '/api/modules/bookplate/canvas-agent/clear',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as { workspace_id?: string };
      const workspaceId = payload.workspace_id?.trim() || 'canvas-agent_default';
      const cleared = await clearPiSession(request.authUser!.id, workspaceId);
      return { cleared };
    }
  );
}
