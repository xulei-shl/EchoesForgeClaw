import type { FastifyInstance } from 'fastify';
import { getDb } from '../../../config/database.js';
import {
  BifrostError,
  BifrostNotConfiguredError,
  BifrostNotFoundError,
  getPrompt,
  listPrompts,
} from '../../../services/bifrost-service.js';

export async function register(app: FastifyInstance): Promise<void> {
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
}
