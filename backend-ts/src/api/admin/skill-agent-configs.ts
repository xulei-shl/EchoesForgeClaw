import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb, type DB } from '../../config/database.js';
import { llmConfigs, nodeConfigs, promptTemplates, skillAgentConfigs } from '../../db/schema.js';
import { now, toIso } from '../../shared/datetime.js';
import { ensureAgentMd, writeAgentMd } from '../../services/skill-agent-files.js';

/**
 * Skill Agent 配置管理（对应 Python `app/api/admin/skill_agent_configs.py`）：
 * - GET/POST /api/admin/skill-agent-configs（列表/新建，必须引用模型配置）
 * - POST /api/admin/skill-agent-configs/:id/duplicate（复制）
 * - PATCH/DELETE /api/admin/skill-agent-configs/:id（修改/删除）
 *
 * 模型 url/key 复用于「模型配置」，系统提示词复用于「提示词模板」；保存/复制/删除时
 * 同步物化 runtime/.agent/agents/{id}/AGENTS.md（与运行时读取口径一致）。
 */

type SkillAgentRow = typeof skillAgentConfigs.$inferSelect;

interface SkillAgentPayload {
  name?: string;
  llm_config_id?: number | null;
  prompt_id?: number | null;
  /** 绘图模型配置（kind='image'）引用；可空 = 不启用绘图工具。 */
  image_llm_config_id?: number | null;
  is_active?: boolean;
}

interface SkillAgentOut {
  id: number;
  name: string;
  llm_config_id: number | null;
  prompt_id: number | null;
  image_llm_config_id: number | null;
  llm_config_name: string | null;
  prompt_name: string | null;
  image_llm_config_name: string | null;
  base_url: string;
  model_name: string;
  system_prompt: string;
  is_active: boolean;
  has_api_key: boolean;
  created_at: string | null;
  updated_at: string | null;
}

function toOut(db: DB, cfg: SkillAgentRow): SkillAgentOut {
  const llm = cfg.llmConfigId != null ? db.select().from(llmConfigs).where(eq(llmConfigs.id, cfg.llmConfigId)).get() : undefined;
  const prompt = cfg.promptId != null ? db.select().from(promptTemplates).where(eq(promptTemplates.id, cfg.promptId)).get() : undefined;
  const imageLlm = cfg.imageLlmConfigId != null ? db.select().from(llmConfigs).where(eq(llmConfigs.id, cfg.imageLlmConfigId)).get() : undefined;
  return {
    id: cfg.id,
    name: cfg.name,
    llm_config_id: cfg.llmConfigId,
    prompt_id: cfg.promptId,
    image_llm_config_id: cfg.imageLlmConfigId,
    llm_config_name: llm?.name ?? null,
    prompt_name: prompt?.name ?? null,
    image_llm_config_name: imageLlm?.name ?? null,
    // 展示用：引用优先（存在引用即以其为准），无引用时回退旧字段（存量数据兼容）
    base_url: llm?.baseUrl ?? cfg.baseUrl,
    model_name: llm?.modelName ?? cfg.modelName,
    system_prompt: prompt?.content ?? cfg.systemPrompt,
    is_active: !!cfg.isActive,
    has_api_key: !!llm?.apiKey || !!cfg.apiKey,
    created_at: toIso(cfg.createdAt),
    updated_at: toIso(cfg.updatedAt),
  };
}

/** 按最终生效提示词物化 / 删除 AGENTS.md。 */
function syncAgentMd(db: DB, cfg: SkillAgentRow): void {
  ensureAgentMd(db, cfg);
}

/** 校验引用的模型配置存在且启用（Skill Agent 的 url/key/model 全部来自它）。 */
function requireLLMConfig(db: DB, llmConfigId: number | null | undefined): string | null {
  if (llmConfigId == null) return null;
  const llm = db.select().from(llmConfigs).where(eq(llmConfigs.id, llmConfigId)).get();
  if (!llm || !llm.isActive || !llm.apiKey) {
    return '所选模型配置不存在 / 未启用 / 未配置 API Key';
  }
  return null;
}

/** 校验绘图模型引用：必须存在、启用、有 Key 且 kind='image'。 */
function requireImageLLMConfig(db: DB, imageLlmConfigId: number | null | undefined): string | null {
  if (imageLlmConfigId == null) return null;
  const llm = db.select().from(llmConfigs).where(eq(llmConfigs.id, imageLlmConfigId)).get();
  if (!llm || !llm.isActive || !llm.apiKey) {
    return '所选绘图模型配置不存在 / 未启用 / 未配置 API Key';
  }
  if (llm.kind !== 'image') {
    return '绘图模型必须引用「图像生成」类型的模型配置';
  }
  return null;
}

export async function registerSkillAgentConfigsAdminRouter(app: FastifyInstance): Promise<void> {
  const admin = { preHandler: app.requireAdmin };

  // 列表
  app.get('/api/admin/skill-agent-configs', admin, async () => {
    const db = getDb();
    return db.select().from(skillAgentConfigs).orderBy(skillAgentConfigs.id).all().map((c) => toOut(db, c));
  });

  // 新建：必须引用模型配置
  app.post(
    '/api/admin/skill-agent-configs',
    admin,
    async (request, reply) => {
      const p = (request.body ?? {}) as SkillAgentPayload;
      if (!p.name?.trim()) return reply.code(400).send({ detail: '配置名称不能为空' });
      if (p.llm_config_id == null) {
        return reply.code(400).send({ detail: '请选择模型配置（模型 url/key 复用于「模型配置」）' });
      }
      const db = getDb();
      const refErr = requireLLMConfig(db, p.llm_config_id);
      if (refErr) return reply.code(400).send({ detail: refErr });
      const imageRefErr = requireImageLLMConfig(db, p.image_llm_config_id);
      if (imageRefErr) return reply.code(400).send({ detail: imageRefErr });
      const row = db
        .insert(skillAgentConfigs)
        .values({
          name: p.name.trim(),
          llmConfigId: p.llm_config_id,
          promptId: p.prompt_id ?? null,
          imageLlmConfigId: p.image_llm_config_id ?? null,
          // 旧字段仅作存量兼容回退，新配置写空串（对应 Python 模型 default=""）
          apiKey: '',
          baseUrl: '',
          modelName: '',
          systemPrompt: '',
          isActive: p.is_active ?? true,
          createdAt: now(),
          updatedAt: now(),
        })
        .returning()
        .get();
      syncAgentMd(db, row);
      return toOut(db, row);
    }
  );

  // 复制（沿用模型/提示词引用，名字加「(副本)」）
  app.post('/api/admin/skill-agent-configs/:id/duplicate', admin, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const db = getDb();
    const cfg = db.select().from(skillAgentConfigs).where(eq(skillAgentConfigs.id, id)).get();
    if (!cfg) return reply.code(404).send({ detail: 'Skill Agent 配置不存在' });
      const row = db
        .insert(skillAgentConfigs)
        .values({
          name: `${cfg.name} (副本)`,
          llmConfigId: cfg.llmConfigId,
          promptId: cfg.promptId,
          imageLlmConfigId: cfg.imageLlmConfigId,
          apiKey: '',
        baseUrl: '',
        modelName: '',
        systemPrompt: '',
        isActive: cfg.isActive,
        createdAt: now(),
        updatedAt: now(),
      })
      .returning()
      .get();
    syncAgentMd(db, row);
    return toOut(db, row);
  });

  // 修改（引用字段；prompt_id 传 null 表示清除提示词）
  app.patch(
    '/api/admin/skill-agent-configs/:id',
    admin,
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const p = (request.body ?? {}) as SkillAgentPayload;
      const db = getDb();
      const cfg = db.select().from(skillAgentConfigs).where(eq(skillAgentConfigs.id, id)).get();
      if (!cfg) return reply.code(404).send({ detail: 'Skill Agent 配置不存在' });
      if (p.llm_config_id !== undefined) {
        const refErr = requireLLMConfig(db, p.llm_config_id);
        if (refErr) return reply.code(400).send({ detail: refErr });
      }
      if (p.image_llm_config_id !== undefined) {
        const imageRefErr = requireImageLLMConfig(db, p.image_llm_config_id);
        if (imageRefErr) return reply.code(400).send({ detail: imageRefErr });
      }
      const set: Record<string, unknown> = {};
      if (p.name != null) set.name = p.name;
      if (p.llm_config_id !== undefined) set.llmConfigId = p.llm_config_id;
      if (p.prompt_id !== undefined) set.promptId = p.prompt_id;
      if (p.image_llm_config_id !== undefined) set.imageLlmConfigId = p.image_llm_config_id;
      if (p.is_active !== undefined) set.isActive = p.is_active;
      set.updatedAt = now();
      db.update(skillAgentConfigs).set(set).where(eq(skillAgentConfigs.id, id)).run();
      const updated = db.select().from(skillAgentConfigs).where(eq(skillAgentConfigs.id, id)).get()!;
      syncAgentMd(db, updated);
      return toOut(db, updated);
    }
  );

  // 删除（解除节点引用 + 清理 AGENTS.md）
  app.delete('/api/admin/skill-agent-configs/:id', admin, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const db = getDb();
    const cfg = db.select().from(skillAgentConfigs).where(eq(skillAgentConfigs.id, id)).get();
    if (!cfg) return reply.code(404).send({ detail: 'Skill Agent 配置不存在' });
    db.update(nodeConfigs).set({ skillAgentConfigId: null }).where(eq(nodeConfigs.skillAgentConfigId, id)).run();
    writeAgentMd(id, ''); // 空内容 = 删除文件
    db.delete(skillAgentConfigs).where(eq(skillAgentConfigs.id, id)).run();
    return { message: 'Skill Agent 配置已删除' };
  });
}
