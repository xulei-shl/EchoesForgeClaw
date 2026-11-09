import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../../config/database.js';
import { fastclawAgentConfigs, nodeConfigs } from '../../db/schema.js';
import { now, toIso } from '../../shared/datetime.js';
import { fastclawAgentService } from '../../services/ai/fastclaw-service.js';
import { getAppSettingsMap } from '../../repositories/index.js';
import {
  FASTCLAW_DATA_ROOT_SETTING_KEY,
  fastclawDataRoot,
} from '../../services/ai/fastclaw-artifacts.js';
import {
  listSyncableSkills,
  MAX_AGENT_SKILLS,
  syncFastClawAgentSkills,
  type FastClawSkillSyncResult,
} from '../../services/ai/fastclaw-skills.js';
import { isValidSkillName } from '../../services/ai/skill-agent-service.js';

/**
 * FastClaw Agent 配置管理（对应 Python `app/api/admin/fastclaw_agents.py`）：
 * - GET /api/admin/fastclaw-agents（列表，缺 agent_name 时懒解析回填）
 * - GET /api/admin/fastclaw-agents/skills（可同步的共享 skill 候选）
 * - POST /api/admin/fastclaw-agents（新建，保存即同步选中 skill）
 * - POST /api/admin/fastclaw-agents/:id/duplicate（复制，名字加「(副本)」）
 * - POST /api/admin/fastclaw-agents/:id/sync-skills（按当前配置手动重推）
 * - PATCH/DELETE /api/admin/fastclaw-agents/:id（修改/删除，删除时解除节点引用）
 */

interface FastClawPayload {
  name?: string;
  agent_name?: string;
  base_url?: string;
  api_key?: string;
  agent_id?: string;
  is_active?: boolean;
  /** 管理端选中的共享 skill 名（agent 级共享，不随会话隔离）。 */
  skills?: string[];
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
  /** 该 agent 绑定的共享 skill 名列表 */
  skills: string[];
  /** 仅 POST/PATCH 且发生同步时回带，供管理端提示落盘结果 */
  skill_sync?: FastClawSkillSyncResult;
}

/** 存量库可能是 NULL/非法 JSON；一律安全降级为空列表。 */
function parseSkills(raw: unknown): string[] {
  try {
    const arr = JSON.parse(String(raw ?? '[]'));
    if (!Array.isArray(arr)) return [];
    const out: string[] = [];
    for (const item of arr) {
      if (typeof item !== 'string') continue;
      const name = item.trim();
      if (isValidSkillName(name) && !out.includes(name)) out.push(name);
    }
    return out.slice(0, MAX_AGENT_SKILLS);
  } catch {
    return [];
  }
}

/** 校验管理端提交的 skill 名单；非法返回 null（路由回 400）。 */
function normalizeSkills(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') return null;
    const name = item.trim();
    if (!isValidSkillName(name)) return null;
    if (!out.includes(name)) out.push(name);
  }
  return out.slice(0, MAX_AGENT_SKILLS);
}

/** best-effort：任何失败都只回 warning，绝不让 skill 同步阻断配置保存 / 对话。 */
function syncFor(agentId: string, skills: string[]): FastClawSkillSyncResult {
  try {
    const configured = getAppSettingsMap(getDb())[FASTCLAW_DATA_ROOT_SETTING_KEY];
    return syncFastClawAgentSkills({
      root: fastclawDataRoot(configured),
      agentId,
      skillNames: skills,
    });
  } catch (err) {
    return {
      root: null,
      target_dir: '',
      synced: [],
      skipped: skills,
      removed: [],
      unchanged: 0,
      warning: `技能同步失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
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
    skills: parseSkills(row.skills),
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

  // 可同步到 Agent 的共享 skill 候选（本地共享区 + 同捆包；与画布侧按用户安装的列表无关）
  app.get('/api/admin/fastclaw-agents/skills', admin, async () => {
    return { skills: listSyncableSkills() };
  });

  // 新建
  app.post(
    '/api/admin/fastclaw-agents',
    admin,
    async (request, reply) => {
      const p = (request.body ?? {}) as FastClawPayload;
      if (!p.name?.trim()) return reply.code(400).send({ detail: '配置名称不能为空' });
      const skills = p.skills === undefined ? [] : normalizeSkills(p.skills);
      if (skills === null) return reply.code(400).send({ detail: '技能列表包含非法名称' });
      const row = getDb()
        .insert(fastclawAgentConfigs)
        .values({
          name: p.name.trim(),
          agentName: p.agent_name ?? '',
          baseUrl: p.base_url ?? '',
          apiKey: p.api_key ?? '',
          agentId: p.agent_id ?? '',
          isActive: p.is_active ?? true,
          skills: JSON.stringify(skills),
          createdAt: now(),
          updatedAt: now(),
        })
        .returning()
        .get();
      // 保存即同步：FastClaw 的 skills 是 agent 级共享目录，只由管理端配置决定
      return { ...toOut(row), skill_sync: syncFor(row.agentId ?? '', skills) };
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
        skills: cfg.skills ?? '[]',
        createdAt: now(),
        updatedAt: now(),
      })
      .returning()
      .get();
    // 副本与原配置指向同一 agent_id，磁盘目录已同步，无需重复写盘
    return toOut(row);
  });

  // 按当前配置手动重推（skill 包更新 / 目录被外部清理后使用）
  app.post('/api/admin/fastclaw-agents/:id/sync-skills', admin, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const cfg = getDb().select().from(fastclawAgentConfigs).where(eq(fastclawAgentConfigs.id, id)).get();
    if (!cfg) return reply.code(404).send({ detail: 'FastClaw Agent 配置不存在' });
    return syncFor(cfg.agentId, parseSkills(cfg.skills));
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
      // 仅当技能名单或 agent_id 变化时才同步：单纯启停 / 改名不应触发磁盘写入
      let skills: string[] | null = null;
      if (p.skills !== undefined) {
        skills = normalizeSkills(p.skills);
        if (skills === null) return reply.code(400).send({ detail: '技能列表包含非法名称' });
        set.skills = JSON.stringify(skills);
      }
      set.updatedAt = now();
      db.update(fastclawAgentConfigs).set(set).where(eq(fastclawAgentConfigs.id, id)).run();
      const updated = db.select().from(fastclawAgentConfigs).where(eq(fastclawAgentConfigs.id, id)).get()!;
      // 换绑 agent_id 时只同步新目录：旧 agent 的 skills 是共享目录，可能被其它配置引用，
      // 不在此处清理（管理员可在旧配置上清空技能名单手动重推）。
      const syncNeeded = skills !== null || p.agent_id !== undefined;
      return {
        ...toOut(updated),
        ...(syncNeeded ? { skill_sync: syncFor(updated.agentId, parseSkills(updated.skills)) } : {}),
      };
    }
  );

  // 删除（解除节点引用）。不清理 FastClaw 数据目录里的 skill：同一 agent_id 可能被其它配置
  // 引用，且目录里可能还有管理员在 FastClaw 自行安装的技能，误删不可逆。
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
