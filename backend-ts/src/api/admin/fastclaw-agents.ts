import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../../config/database.js';
import { fastclawAgentConfigs, nodeConfigs } from '../../db/schema.js';
import { now, toIso } from '../../shared/datetime.js';
import { fastclawAgentService } from '../../services/fastclaw-service.js';

/**
 * FastClaw Agent 配置管理（对应 Python `app/api/admin/fastclaw_agents.py`）：
 * - GET /api/admin/fastclaw-agents（列表，缺 agent_name 时懒解析回填）
 * - POST /api/admin/fastclaw-agents（新建）
 * - POST /api/admin/fastclaw-agents/:id/duplicate（复制，名字加「(副本)」）
 * - PATCH/DELETE /api/admin/fastclaw-agents/:id（修改/删除，删除时解除节点引用）
 */

interface FastClawPayload {
  name?: string;
  agent_name?: string;
  base_url?: string;
  api_key?: string;
  agent_id?: string;
  is_active?: boolean;
}

interface FastClawOut {
  id: number;
  name: string;
  agent_name: string;
  base_url: string;
  agent_id: string;
  is_active: boolean;
  has_api_key: boolean;
  created_at: string | null;
  updated_at: string | null;
}

function toOut(row: typeof fastclawAgentConfigs.$inferSelect): FastClawOut {
  return {
    id: row.id,
    name: row.name,
    agent_name: row.agentName ?? '',
    base_url: row.baseUrl,
    agent_id: row.agentId,
    is_active: !!row.isActive,
    has_api_key: !!row.apiKey,
    created_at: toIso(row.createdAt),
    updated_at: toIso(row.updatedAt),
  };
}

export async function registerFastClawAgentsAdminRouter(app: FastifyInstance): Promise<void> {
  const admin = { preHandler: app.requireAdmin };

  // 列表（存量配置缺 agent_name 时懒解析回填，best-effort 不影响列表返回）
  app.get('/api/admin/fastclaw-agents', admin, async () => {
    const db = getDb();
    const configs = db.select().from(fastclawAgentConfigs).orderBy(fastclawAgentConfigs.id).all();
    const pending = configs.filter((c) => c.agentId && !c.agentName);
    if (pending.length) {
      const results = await Promise.allSettled(
        pending.map((c) => fastclawAgentService.resolveAgentName(c.baseUrl, c.apiKey, c.agentId))
      );
      let changed = false;
      pending.forEach((c, i) => {
        const settled = results[i]!;
        const name = settled.status === 'fulfilled' ? settled.value : null;
        if (name) {
          db.update(fastclawAgentConfigs).set({ agentName: name, updatedAt: now() }).where(eq(fastclawAgentConfigs.id, c.id)).run();
          changed = true;
        }
      });
      if (changed) {
        return db.select().from(fastclawAgentConfigs).orderBy(fastclawAgentConfigs.id).all().map(toOut);
      }
    }
    return configs.map(toOut);
  });

  // 新建
  app.post(
    '/api/admin/fastclaw-agents',
    admin,
    async (request, reply) => {
      const p = (request.body ?? {}) as FastClawPayload;
      if (!p.name?.trim()) return reply.code(400).send({ detail: '配置名称不能为空' });
      const row = getDb()
        .insert(fastclawAgentConfigs)
        .values({
          name: p.name.trim(),
          agentName: p.agent_name ?? '',
          baseUrl: p.base_url ?? '',
          apiKey: p.api_key ?? '',
          agentId: p.agent_id ?? '',
          isActive: p.is_active ?? true,
          createdAt: now(),
          updatedAt: now(),
        })
        .returning()
        .get();
      return toOut(row);
    }
  );

  // 复制（沿用 Base URL / API Key / Agent ID，名字加「(副本)」）
  app.post('/api/admin/fastclaw-agents/:id/duplicate', admin, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const db = getDb();
    const cfg = db.select().from(fastclawAgentConfigs).where(eq(fastclawAgentConfigs.id, id)).get();
    if (!cfg) return reply.code(404).send({ detail: 'FastClaw Agent 配置不存在' });
    const row = db
      .insert(fastclawAgentConfigs)
      .values({
        name: `${cfg.name} (副本)`,
        agentName: cfg.agentName,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        agentId: cfg.agentId,
        isActive: cfg.isActive,
        createdAt: now(),
        updatedAt: now(),
      })
      .returning()
      .get();
    return toOut(row);
  });

  // 修改（api_key 留空 = 不修改）
  app.patch(
    '/api/admin/fastclaw-agents/:id',
    admin,
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const p = (request.body ?? {}) as FastClawPayload;
      const db = getDb();
      const cfg = db.select().from(fastclawAgentConfigs).where(eq(fastclawAgentConfigs.id, id)).get();
      if (!cfg) return reply.code(404).send({ detail: 'FastClaw Agent 配置不存在' });
      const set: Record<string, unknown> = {};
      if (p.name != null) set.name = p.name;
      if (p.agent_name != null) set.agentName = p.agent_name;
      if (p.base_url != null) set.baseUrl = p.base_url;
      if (p.api_key != null && p.api_key !== '') set.apiKey = p.api_key;
      if (p.agent_id != null) set.agentId = p.agent_id;
      if (p.is_active != null) set.isActive = p.is_active;
      set.updatedAt = now();
      db.update(fastclawAgentConfigs).set(set).where(eq(fastclawAgentConfigs.id, id)).run();
      return toOut(db.select().from(fastclawAgentConfigs).where(eq(fastclawAgentConfigs.id, id)).get()!);
    }
  );

  // 删除（解除节点引用）
  app.delete('/api/admin/fastclaw-agents/:id', admin, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const db = getDb();
    const cfg = db.select().from(fastclawAgentConfigs).where(eq(fastclawAgentConfigs.id, id)).get();
    if (!cfg) return reply.code(404).send({ detail: 'FastClaw Agent 配置不存在' });
    db.update(nodeConfigs).set({ agentConfigId: null }).where(eq(nodeConfigs.agentConfigId, id)).run();
    db.delete(fastclawAgentConfigs).where(eq(fastclawAgentConfigs.id, id)).run();
    return { message: 'FastClaw Agent 配置已删除' };
  });
}
