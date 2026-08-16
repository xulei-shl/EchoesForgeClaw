import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb, type DB } from '../../config/database.js';
import {
  fastclawAgentConfigs,
  llmConfigs,
  nodeConfigs,
  promptTemplates,
  skillAgentConfigs,
} from '../../db/schema.js';
import { NODE_TEMPLATES } from '../../modules/bookplate/node-types.js';
import { now, toIso } from '../../shared/datetime.js';

/**
 * 节点配置管理（对应 Python `app/api/admin/node_configs.py`）：
 * - GET/POST /api/admin/node-configs（列表/新建，同一节点模板可建多条配置）
 * - PATCH/DELETE /api/admin/node-configs/:id（修改/删除）
 * - POST /api/admin/node-configs/reorder-groups（批量更新自定义分组排序）
 *
 * 校验：节点模板类型必须为代码内置；模式互斥（Agent/Skill Agent 与「提示词+大模型」二选一）；
 * 引用字段必须指向已存在的配置。
 */

type NodeConfigRow = typeof nodeConfigs.$inferSelect;

interface NodeConfigPayload {
  node_type?: string | null;
  name?: string | null;
  group?: string | null;
  llm_config_id?: number | null;
  prompt_id?: number | null;
  agent_config_id?: number | null;
  skill_agent_config_id?: number | null;
  is_active?: boolean | null;
}

interface NodeConfigOut {
  id: number;
  node_type: string;
  name: string;
  group: string | null;
  group_order: number;
  llm_config_id: number | null;
  prompt_id: number | null;
  agent_config_id: number | null;
  skill_agent_config_id: number | null;
  llm_config_name: string | null;
  prompt_name: string | null;
  agent_config_name: string | null;
  skill_agent_config_name: string | null;
  agent_config_agent_name: string | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

function toOut(db: DB, nc: NodeConfigRow): NodeConfigOut {
  const llm = nc.llmConfigId != null ? db.select().from(llmConfigs).where(eq(llmConfigs.id, nc.llmConfigId)).get() : undefined;
  const prompt = nc.promptId != null ? db.select().from(promptTemplates).where(eq(promptTemplates.id, nc.promptId)).get() : undefined;
  const agent = nc.agentConfigId != null ? db.select().from(fastclawAgentConfigs).where(eq(fastclawAgentConfigs.id, nc.agentConfigId)).get() : undefined;
  const skillAgent = nc.skillAgentConfigId != null ? db.select().from(skillAgentConfigs).where(eq(skillAgentConfigs.id, nc.skillAgentConfigId)).get() : undefined;
  return {
    id: nc.id,
    node_type: nc.nodeType,
    name: nc.name,
    group: nc.group,
    group_order: nc.groupOrder,
    llm_config_id: nc.llmConfigId,
    prompt_id: nc.promptId,
    agent_config_id: nc.agentConfigId,
    skill_agent_config_id: nc.skillAgentConfigId,
    llm_config_name: llm?.name ?? null,
    prompt_name: prompt?.name ?? null,
    agent_config_name: agent?.name ?? null,
    skill_agent_config_name: skillAgent?.name ?? null,
    agent_config_agent_name: agent?.agentName ?? null,
    is_active: !!nc.isActive,
    created_at: toIso(nc.createdAt),
    updated_at: toIso(nc.updatedAt),
  };
}

function loadNodeConfig(db: DB, id: number): NodeConfigRow | undefined {
  return db.select().from(nodeConfigs).where(eq(nodeConfigs.id, id)).get();
}

function validateNodeType(nodeType: string): string | null {
  if (!NODE_TEMPLATES.some((t) => t.type === nodeType)) {
    return `未知的节点模板类型: ${nodeType}`;
  }
  return null;
}

/** 模式互斥校验：Agent / Skill Agent 与「提示词 + 大模型」只能选一组；两种 Agent 互斥。 */
function validateMode(hasLlm: boolean, hasPrompt: boolean, hasAgent: boolean, hasSkillAgent: boolean): string | null {
  if ((hasAgent || hasSkillAgent) && (hasLlm || hasPrompt)) {
    return 'Agent / Skill Agent 模式与「提示词 + 大模型」互斥，只能选择一组';
  }
  if (hasAgent && hasSkillAgent) {
    return 'FastClaw Agent 与 Skill Agent 模式互斥，只能选择一组';
  }
  return null;
}

function validateRefs(
  db: DB,
  llmConfigId: number | null | undefined,
  promptId: number | null | undefined,
  agentConfigId: number | null | undefined,
  skillAgentConfigId: number | null | undefined
): string | null {
  if (llmConfigId != null && !db.select().from(llmConfigs).where(eq(llmConfigs.id, llmConfigId)).get()) {
    return '所选模型配置不存在';
  }
  if (promptId != null && !db.select().from(promptTemplates).where(eq(promptTemplates.id, promptId)).get()) {
    return '所选提示词模板不存在';
  }
  if (agentConfigId != null && !db.select().from(fastclawAgentConfigs).where(eq(fastclawAgentConfigs.id, agentConfigId)).get()) {
    return '所选 FastClaw Agent 配置不存在';
  }
  if (skillAgentConfigId != null && !db.select().from(skillAgentConfigs).where(eq(skillAgentConfigs.id, skillAgentConfigId)).get()) {
    return '所选 DeepSeek Agent 配置不存在';
  }
  return null;
}

export async function registerNodeConfigsAdminRouter(app: FastifyInstance): Promise<void> {
  const admin = { preHandler: app.requireAdmin };

  // 列表（可按 node_type 过滤）
  app.get('/api/admin/node-configs', admin, async (request) => {
    const q = (request.query ?? {}) as { node_type?: string };
    const db = getDb();
    const query = q.node_type
      ? db.select().from(nodeConfigs).where(eq(nodeConfigs.nodeType, q.node_type))
      : db.select().from(nodeConfigs);
    return query.orderBy(nodeConfigs.id).all().map((nc) => toOut(db, nc));
  });

  // 新建
  app.post(
    '/api/admin/node-configs',
    admin,
    async (request, reply) => {
      const p = (request.body ?? {}) as NodeConfigPayload;
      const nodeType = p.node_type ?? '';
      if (nodeType) {
        const err = validateNodeType(nodeType);
        if (err) return reply.code(400).send({ detail: err });
      }
      if (!p.name?.trim()) return reply.code(400).send({ detail: '节点名称不能为空' });

      const modeErr = validateMode(
        p.llm_config_id != null,
        p.prompt_id != null,
        p.agent_config_id != null,
        p.skill_agent_config_id != null
      );
      if (modeErr) return reply.code(400).send({ detail: modeErr });
      const refErr = validateRefs(getDb(), p.llm_config_id, p.prompt_id, p.agent_config_id, p.skill_agent_config_id);
      if (refErr) return reply.code(400).send({ detail: refErr });

      const db = getDb();
      const row = db
        .insert(nodeConfigs)
        .values({
          nodeType,
          name: p.name.trim(),
          group: p.group ?? null,
          llmConfigId: p.llm_config_id ?? null,
          promptId: p.prompt_id ?? null,
          agentConfigId: p.agent_config_id ?? null,
          skillAgentConfigId: p.skill_agent_config_id ?? null,
          isActive: p.is_active ?? true,
          createdAt: now(),
          updatedAt: now(),
        })
        .returning()
        .get();
      return toOut(db, row);
    }
  );

  // 修改（合并现有字段后校验）
  app.patch(
    '/api/admin/node-configs/:id',
    admin,
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const p = (request.body ?? {}) as NodeConfigPayload;
      const db = getDb();
      const nc = loadNodeConfig(db, id);
      if (!nc) return reply.code(404).send({ detail: '节点配置不存在' });

      if (p.node_type != null) {
        const err = validateNodeType(p.node_type);
        if (err) return reply.code(400).send({ detail: err });
      }
      if (p.name != null && !String(p.name).trim()) return reply.code(400).send({ detail: '节点名称不能为空' });

      const merged: NodeConfigPayload = {
        node_type: p.node_type ?? nc.nodeType,
        llm_config_id: p.llm_config_id !== undefined ? p.llm_config_id : nc.llmConfigId,
        prompt_id: p.prompt_id !== undefined ? p.prompt_id : nc.promptId,
        agent_config_id: p.agent_config_id !== undefined ? p.agent_config_id : nc.agentConfigId,
        skill_agent_config_id: p.skill_agent_config_id !== undefined ? p.skill_agent_config_id : nc.skillAgentConfigId,
      };
      const modeErr = validateMode(
        merged.llm_config_id != null,
        merged.prompt_id != null,
        merged.agent_config_id != null,
        merged.skill_agent_config_id != null
      );
      if (modeErr) return reply.code(400).send({ detail: modeErr });
      const refErr = validateRefs(db, merged.llm_config_id, merged.prompt_id, merged.agent_config_id, merged.skill_agent_config_id);
      if (refErr) return reply.code(400).send({ detail: refErr });

      const set: Record<string, unknown> = {};
      if (p.node_type != null) set.nodeType = p.node_type;
      if (p.name != null) set.name = p.name;
      if (p.group !== undefined) set.group = p.group;
      if (p.llm_config_id !== undefined) set.llmConfigId = p.llm_config_id;
      if (p.prompt_id !== undefined) set.promptId = p.prompt_id;
      if (p.agent_config_id !== undefined) set.agentConfigId = p.agent_config_id;
      if (p.skill_agent_config_id !== undefined) set.skillAgentConfigId = p.skill_agent_config_id;
      if (p.is_active !== undefined) set.isActive = p.is_active;
      set.updatedAt = now();
      db.update(nodeConfigs).set(set).where(eq(nodeConfigs.id, id)).run();
      return toOut(db, loadNodeConfig(db, id)!);
    }
  );

  // 批量更新自定义分组排序
  app.post(
    '/api/admin/node-configs/reorder-groups',
    admin,
    async (request, reply) => {
      const groups = (request.body as { groups?: { group?: string; order?: number }[] } | undefined)?.groups ?? [];
      const db = getDb();
      const seen = new Set<string>();
      for (const item of groups) {
        const g = (item.group ?? '').trim();
        if (!g || seen.has(g)) return reply.code(400).send({ detail: '分组名不能为空或重复' });
        seen.add(g);
        const order = item.order ?? 0;
        const rows = db.select().from(nodeConfigs).where(eq(nodeConfigs.group, g)).all();
        for (const nc of rows) {
          db.update(nodeConfigs).set({ groupOrder: order, updatedAt: now() }).where(eq(nodeConfigs.id, nc.id)).run();
        }
      }
      return { message: '分组排序已更新' };
    }
  );

  // 删除
  app.delete('/api/admin/node-configs/:id', admin, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const db = getDb();
    if (!loadNodeConfig(db, id)) return reply.code(404).send({ detail: '节点配置不存在' });
    db.delete(nodeConfigs).where(eq(nodeConfigs.id, id)).run();
    return { message: '节点配置已删除' };
  });
}
