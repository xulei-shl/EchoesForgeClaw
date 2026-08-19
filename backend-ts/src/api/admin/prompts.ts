import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../../config/database.js';
import { nodeConfigs, promptTemplates, skillAgentConfigs } from '../../db/schema.js';
import { now, toIso } from '../../shared/datetime.js';

/**
 * 提示词模板管理（对应 Python `app/api/admin/prompts.py`）：
 * - GET /api/admin/prompts?node_type=（列表）
 * - POST /api/admin/prompts（新建）
 * - PATCH/DELETE /api/admin/prompts/:id（修改/删除，删除时解除节点与 Skill Agent 引用）
 */

interface PromptPayload {
  name?: string;
  node_type?: string;
  content?: string;
  is_active?: boolean;
}

interface PromptOut {
  id: number;
  key: string | null;
  name: string;
  node_type: string;
  content: string;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

function toOut(row: typeof promptTemplates.$inferSelect): PromptOut {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    node_type: row.nodeType,
    content: row.content,
    is_active: !!row.isActive,
    created_at: toIso(row.createdAt),
    updated_at: toIso(row.updatedAt),
  };
}

export async function registerPromptsAdminRouter(app: FastifyInstance): Promise<void> {
  const admin = { preHandler: app.requireAdmin };

  // 列表（可按 node_type 过滤，id 倒序）
  app.get('/api/admin/prompts', admin, async (request) => {
    const q = (request.query ?? {}) as { node_type?: string };
    const db = getDb();
    const query = q.node_type
      ? db.select().from(promptTemplates).where(eq(promptTemplates.nodeType, q.node_type))
      : db.select().from(promptTemplates);
    return query.orderBy(desc(promptTemplates.id)).all().map(toOut);
  });

  // 新建
  app.post(
    '/api/admin/prompts',
    admin,
    async (request, reply) => {
      const p = (request.body ?? {}) as PromptPayload;
      if (!p.name?.trim()) return reply.code(400).send({ detail: '提示词名称不能为空' });
      const row = getDb()
        .insert(promptTemplates)
        .values({
          name: p.name.trim(),
          nodeType: p.node_type ?? 'text_generation',
          content: p.content ?? '',
          isActive: p.is_active ?? true,
          createdAt: now(),
          updatedAt: now(),
        })
        .returning()
        .get();
      return toOut(row);
    }
  );

  // 修改
  app.patch(
    '/api/admin/prompts/:id',
    admin,
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const p = (request.body ?? {}) as PromptPayload;
      const db = getDb();
      const item = db.select().from(promptTemplates).where(eq(promptTemplates.id, id)).get();
      if (!item) return reply.code(404).send({ detail: '提示词模板不存在' });
      const set: Record<string, unknown> = {};
      if (p.name != null) set.name = p.name;
      if (p.node_type != null) set.nodeType = p.node_type;
      if (p.content != null) set.content = p.content;
      if (p.is_active != null) set.isActive = p.is_active;
      set.updatedAt = now();
      db.update(promptTemplates).set(set).where(eq(promptTemplates.id, id)).run();
      return toOut(db.select().from(promptTemplates).where(eq(promptTemplates.id, id)).get()!);
    }
  );

  // 删除（解除引用：NodeConfig + SkillAgentConfig）
  app.delete('/api/admin/prompts/:id', admin, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const db = getDb();
    const item = db.select().from(promptTemplates).where(eq(promptTemplates.id, id)).get();
    if (!item) return reply.code(404).send({ detail: '提示词模板不存在' });
    db.update(nodeConfigs).set({ promptId: null }).where(eq(nodeConfigs.promptId, id)).run();
    db.update(skillAgentConfigs).set({ promptId: null }).where(eq(skillAgentConfigs.promptId, id)).run();
    db.delete(promptTemplates).where(eq(promptTemplates.id, id)).run();
    return { message: '提示词模板已删除' };
  });
}
