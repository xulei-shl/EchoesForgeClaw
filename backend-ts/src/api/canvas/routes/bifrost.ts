import type { FastifyInstance } from 'fastify';
import { getDb } from '../../../config/database.js';
import {
  RESOURCE_TYPE_BIFROST_PROMPT,
  getUserAnnotation,
  getUserAnnotationMap,
} from '../../../services/platform/annotation-service.js';
import {
  BifrostError,
  BifrostNotConfiguredError,
  BifrostNotFoundError,
  getPrompt,
  listPrompts,
} from '../../../services/ai/bifrost-service.js';

export async function register(app: FastifyInstance): Promise<void> {
  // ---- Bifrost 提示词检索（供「提示词检索」PromptSearchNode 节点使用） ----

  // 提示词列表（支持 q 搜索与 folder_id 过滤；富化当前用户的 user_rating 与 user_note）
  app.get(
    '/api/modules/bookplate/bifrost/prompts',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const q = (request.query ?? {}) as { folder_id?: string; q?: string; force?: string };
      try {
        const prompts = await listPrompts(getDb(), q.folder_id || null, q.q ?? '', q.force === '1' || q.force === 'true');
        const userId = request.authUser?.id;
        if (userId && prompts.length) {
          const pids = prompts.map((p) => String(p.id ?? '')).filter(Boolean);
          const annotations = getUserAnnotationMap(getDb(), userId, RESOURCE_TYPE_BIFROST_PROMPT, pids);
          for (const p of prompts) {
            const ann = annotations.get(String(p.id ?? ''));
            p.user_rating = ann?.rating ?? 0;
            p.user_note = ann?.note ?? '';
          }
        }
        return { prompts };
      } catch (err) {
        if (err instanceof BifrostNotFoundError) return reply.code(404).send({ detail: err.message });
        if (err instanceof BifrostNotConfiguredError) return reply.code(503).send({ detail: err.message });
        if (err instanceof BifrostError) return reply.code(502).send({ detail: err.message });
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // 提示词详情（提取正文文本与本地预览图，富化当前用户的 user_rating 与 user_note）
  app.get(
    '/api/modules/bookplate/bifrost/prompts/:prompt_id',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const promptId = (request.params as { prompt_id: string }).prompt_id;
      try {
        const prompt = await getPrompt(getDb(), promptId);
        const userId = request.authUser?.id;
        if (userId) {
          const ann = getUserAnnotation(getDb(), userId, RESOURCE_TYPE_BIFROST_PROMPT, promptId);
          prompt.user_rating = ann.rating;
          prompt.user_note = ann.note;
        } else {
          prompt.user_rating = 0;
          prompt.user_note = '';
        }
        return prompt;
      } catch (err) {
        if (err instanceof BifrostNotFoundError) return reply.code(404).send({ detail: err.message });
        if (err instanceof BifrostNotConfiguredError) return reply.code(503).send({ detail: err.message });
        if (err instanceof BifrostError) return reply.code(502).send({ detail: err.message });
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );
}
