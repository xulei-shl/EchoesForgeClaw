import type { FastifyInstance } from 'fastify';
import { getDb } from '../config/database.js';
import {
  VALID_RESOURCE_TYPES,
  setUserAnnotation,
  getUserAnnotation,
  getPublicNotes,
  revokePublicNote,
} from '../services/platform/annotation-service.js';

export async function registerAnnotationRouter(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: app.authenticate };

  /**
   * 写入 / 更新用户的打标（1-5星）与私有备注及公开共享状态。
   * 自动与当前登录用户上下文绑定，实现用户级隔离与自愿公开。
   */
  app.put('/api/annotations', auth, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) {
      return reply.code(401).send({ detail: '未登录用户' });
    }

    const body = (request.body ?? {}) as {
      resource_type?: string;
      resource_id?: string;
      rating?: number;
      note?: string;
      tags?: string[];
      is_public?: boolean;
    };

    const resourceType = (body.resource_type ?? '').trim();
    const resourceId = (body.resource_id ?? '').trim();

    if (!resourceType || !VALID_RESOURCE_TYPES.has(resourceType)) {
      return reply.code(400).send({
        detail: `非法或不支持的 resource_type: ${resourceType}，必须为 bifrost_prompt 或 bifrost_skill`,
      });
    }

    if (!resourceId) {
      return reply.code(400).send({ detail: 'resource_id 不能为空' });
    }

    try {
      const result = setUserAnnotation(getDb(), userId, resourceType, resourceId, {
        rating: body.rating,
        note: body.note,
        tags: body.tags,
        is_public: body.is_public,
      });

      return {
        resource_type: resourceType,
        resource_id: resourceId,
        rating: result.rating,
        note: result.note,
        tags: result.tags,
        is_public: result.isPublic,
      };
    } catch (err: any) {
      return reply.code(400).send({ detail: err?.message || '设置打标或备注失败' });
    }
  });

  /**
   * 获取当前用户对特定资源的打标与备注。
   */
  app.get('/api/annotations/:resource_type/:resource_id', auth, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) {
      return reply.code(401).send({ detail: '未登录用户' });
    }

    const params = request.params as { resource_type: string; resource_id: string };
    const resourceType = (params.resource_type ?? '').trim();
    const resourceId = (params.resource_id ?? '').trim();

    if (!resourceType || !VALID_RESOURCE_TYPES.has(resourceType)) {
      return reply.code(400).send({ detail: `不支持的 resource_type: ${resourceType}` });
    }

    const result = getUserAnnotation(getDb(), userId, resourceType, resourceId);
    return {
      resource_type: resourceType,
      resource_id: resourceId,
      rating: result.rating,
      note: result.note,
      tags: result.tags,
      is_public: result.isPublic,
    };
  });

  /**
   * 获取特定资源的团队公开经验与备忘列表。
   */
  app.get('/api/annotations/:resource_type/:resource_id/public-notes', auth, async (request, reply) => {
    const params = request.params as { resource_type: string; resource_id: string };
    const resourceType = (params.resource_type ?? '').trim();
    const resourceId = (params.resource_id ?? '').trim();

    if (!resourceType || !VALID_RESOURCE_TYPES.has(resourceType)) {
      return reply.code(400).send({ detail: `不支持的 resource_type: ${resourceType}` });
    }

    const notes = getPublicNotes(getDb(), resourceType, resourceId);
    return {
      resource_type: resourceType,
      resource_id: resourceId,
      public_notes: notes,
    };
  });

  /**
   * 当前用户撤回/取消自己在该资源的公开备忘。
   */
  app.delete('/api/annotations/:resource_type/:resource_id/public-note', auth, async (request, reply) => {
    const userId = request.authUser?.id;
    if (!userId) {
      return reply.code(401).send({ detail: '未登录用户' });
    }

    const params = request.params as { resource_type: string; resource_id: string };
    const resourceType = (params.resource_type ?? '').trim();
    const resourceId = (params.resource_id ?? '').trim();

    if (!resourceType || !VALID_RESOURCE_TYPES.has(resourceType)) {
      return reply.code(400).send({ detail: `不支持的 resource_type: ${resourceType}` });
    }

    const ok = revokePublicNote(getDb(), resourceType, resourceId, userId);
    return { ok, message: ok ? '已撤回公开备忘' : '未找到需撤回的公开备忘' };
  });
}
