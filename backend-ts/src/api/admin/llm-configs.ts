import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { generateText } from 'ai';
import { APICallError } from '@ai-sdk/provider';
import { getDb, type DB } from '../../config/database.js';
import { llmConfigs, nodeConfigs, skillAgentConfigs } from '../../db/schema.js';
import { now, toIso } from '../../shared/datetime.js';
import { createAIProvider } from '../../infrastructure/ai/provider.js';
import { classifyAIError } from '../../infrastructure/ai/errors.js';

/**
 * 大模型配置管理（对应 Python `app/api/admin/llm_configs.py`）：
 * - GET/POST /api/admin/llm-configs（列表/新建）
 * - POST /api/admin/llm-configs/:id/duplicate（复制，名字加「(副本)」）
 * - PATCH/DELETE /api/admin/llm-configs/:id（修改/删除，删除时解除节点与 Skill Agent 引用）
 * - POST /api/admin/llm-configs/test（连通性测试，不落库）
 */

type LLMKind = 'text' | 'multimodal' | 'image' | 'video' | 'audio';

interface LLMConfigPayload {
  name?: string;
  kind?: LLMKind;
  api_key?: string;
  base_url?: string;
  model_name?: string;
  is_active?: boolean;
}

interface LLMConfigOut {
  id: number;
  name: string;
  kind: string;
  base_url: string;
  model_name: string;
  is_active: boolean;
  has_api_key: boolean;
  created_at: string | null;
  updated_at: string | null;
}

function toOut(row: typeof llmConfigs.$inferSelect): LLMConfigOut {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    base_url: row.baseUrl,
    model_name: row.modelName,
    is_active: !!row.isActive,
    has_api_key: !!row.apiKey,
    created_at: toIso(row.createdAt),
    updated_at: toIso(row.updatedAt),
  };
}

function findConfig(db: DB, id: number): (typeof llmConfigs.$inferSelect) | undefined {
  return db.select().from(llmConfigs).where(eq(llmConfigs.id, id)).get();
}

export async function registerLLMConfigsAdminRouter(app: FastifyInstance): Promise<void> {
  const admin = { preHandler: app.requireAdmin };

  // 列表
  app.get('/api/admin/llm-configs', admin, async () => {
    const rows = getDb().select().from(llmConfigs).orderBy(llmConfigs.id).all();
    return rows.map(toOut);
  });

  // 新建
  app.post(
    '/api/admin/llm-configs',
    admin,
    async (request, reply) => {
      const p = (request.body ?? {}) as LLMConfigPayload;
      if (!p.name?.trim()) return reply.code(400).send({ detail: '配置名称不能为空' });
      const row = getDb()
        .insert(llmConfigs)
        .values({
          name: p.name.trim(),
          kind: p.kind ?? 'text',
          apiKey: p.api_key ?? '',
          baseUrl: p.base_url ?? '',
          modelName: p.model_name ?? '',
          isActive: p.is_active ?? true,
          createdAt: now(),
          updatedAt: now(),
        })
        .returning()
        .get();
      return toOut(row);
    }
  );

  // 复制（沿用 Base URL / API Key / 模型名称，名字加「(副本)」）
  app.post('/api/admin/llm-configs/:id/duplicate', admin, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const db = getDb();
    const cfg = findConfig(db, id);
    if (!cfg) return reply.code(404).send({ detail: '模型配置不存在' });
    const row = db
      .insert(llmConfigs)
      .values({
        name: `${cfg.name} (副本)`,
        kind: cfg.kind,
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        modelName: cfg.modelName,
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
    '/api/admin/llm-configs/:id',
    admin,
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const p = (request.body ?? {}) as LLMConfigPayload;
      const db = getDb();
      const cfg = findConfig(db, id);
      if (!cfg) return reply.code(404).send({ detail: '模型配置不存在' });
      const set: Record<string, unknown> = {};
      if (p.name != null) set.name = p.name;
      if (p.kind != null) set.kind = p.kind;
      if (p.api_key != null && p.api_key !== '') set.apiKey = p.api_key; // 空字符串 = 保留原 key
      if (p.base_url != null) set.baseUrl = p.base_url;
      if (p.model_name != null) set.modelName = p.model_name;
      if (p.is_active != null) set.isActive = p.is_active;
      set.updatedAt = now();
      db.update(llmConfigs).set(set).where(eq(llmConfigs.id, id)).run();
      return toOut(findConfig(db, id)!);
    }
  );

  // 删除（解除引用：NodeConfig + SkillAgentConfig）
  app.delete('/api/admin/llm-configs/:id', admin, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const db = getDb();
    if (!findConfig(db, id)) return reply.code(404).send({ detail: '模型配置不存在' });
    db.update(nodeConfigs).set({ llmConfigId: null }).where(eq(nodeConfigs.llmConfigId, id)).run();
    db.update(skillAgentConfigs).set({ llmConfigId: null }).where(eq(skillAgentConfigs.llmConfigId, id)).run();
    db.delete(llmConfigs).where(eq(llmConfigs.id, id)).run();
    return { message: '模型配置已删除' };
  });

  // 连通性测试（不落库）
  app.post(
    '/api/admin/llm-configs/test',
    admin,
    async (request, reply) => {
      const p = (request.body ?? {}) as LLMConfigTestPayload;
      const db = getDb();
      let cfg: (typeof llmConfigs.$inferSelect) | undefined;
      if (p.id != null) {
        cfg = findConfig(db, p.id);
        if (!cfg) return reply.code(404).send({ detail: '模型配置不存在' });
      }
      const apiKey = (p.api_key ?? '').trim() || (cfg?.apiKey ?? '');
      const baseUrl = p.base_url != null ? p.base_url : cfg?.baseUrl ?? '';
      const modelName = p.model_name != null ? p.model_name : cfg?.modelName ?? '';
      const kind: LLMKind = p.kind ?? (cfg?.kind as LLMKind) ?? 'text';

      if (!apiKey) return reply.code(400).send({ detail: '未配置 API Key：请先在表单中填写，或保存配置后再测试' });
      if (!modelName) return reply.code(400).send({ detail: '未填写模型名称（model_name）' });

      try {
        const message = await runConnectivityTest(apiKey, baseUrl, modelName, kind);
        return { ok: true, message };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.warn({ id: p.id }, '模型配置连通性测试失败: %s', msg);
        return reply.code(502).send({ detail: msg });
      }
    }
  );
}

interface LLMConfigTestPayload {
  id?: number | null;
  kind?: LLMKind | null;
  api_key?: string | null;
  base_url?: string | null;
  model_name?: string | null;
}

/** 连通性测试超时（秒）：比正式调用更短，让管理员快速拿到结果。 */
const TEST_TIMEOUT_MS = 20_000;

/** 把 AI SDK / fetch 异常翻译成面向管理员的可读原因。 */
function explainError(err: unknown): string {
  if (err instanceof APICallError) {
    if (err.statusCode === 401 || err.statusCode === 403) return '认证失败：API Key 无效或无权限';
    if (err.statusCode === 404) return '地址或模型不存在：请检查 Base URL 与模型名称';
    if (err.statusCode === 429) return '请求被限流（Rate Limit），请稍后再试';
    return `调用失败（HTTP ${err.statusCode}）：${err.message}`;
  }
  const category = classifyAIError(err);
  if (category === 'timeout') return '请求超时：请检查网络与地址';
  if (category === 'network') return '无法连接：网络不通或 Base URL 有误（请检查地址、端口与网络代理）';
  return `调用失败：${err instanceof Error ? err.message : String(err)}`;
}

/** GET {base_url}/models 验证地址与 Key；失败抛 Error（带原因）。 */
async function probeModels(baseUrl: string, apiKey: string): Promise<string> {
  const url = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/models` : 'https://api.openai.com/v1/models';
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`无法连接：网络不通或 Base URL 有误（${err instanceof Error ? err.name : '网络错误'}）`);
  }
  if (resp.status === 200) {
    let data: unknown = null;
    try {
      data = await resp.json();
    } catch {
      data = null;
    }
    const models = data && typeof data === 'object' && Array.isArray((data as { data?: unknown[] }).data)
      ? (data as { data: unknown[] }).data
      : [];
    const count = models.filter((m) => m && typeof m === 'object').length;
    return `连接正常：Base URL 与 API Key 有效（该服务暴露 ${count} 个模型）`;
  }
  if (resp.status === 401 || resp.status === 403) throw new Error('认证失败：API Key 无效或无访问权限');
  if (resp.status === 404) throw new Error('地址不可达：Base URL 路径有误，或该服务未提供 /models 接口');
  throw new Error(`连接异常：HTTP ${resp.status}`);
}

/** 对一组 OpenAI 兼容三要素发起连通性测试；失败抛 Error（带原因）。 */
async function runConnectivityTest(apiKey: string, baseUrl: string, modelName: string, kind: LLMKind): Promise<string> {
  const cleanBaseUrl = (baseUrl ?? '').trim();
  const cleanModel = (modelName ?? '').trim();
  if (!apiKey) throw new Error('未配置 API Key：请先在表单中填写，或保存配置后再测试');

  if (kind === 'text' || kind === 'multimodal') {
    const fallbackModel = cleanModel || 'gpt-3.5-turbo';
    try {
      const provider = createAIProvider({ apiKey, base_url: cleanBaseUrl });
      await generateText({
        model: provider(cleanModel || 'gpt-3.5-turbo'),
        prompt: 'ping',
        maxOutputTokens: 1,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      });
      return `连接正常：模型「${fallbackModel}」可正常响应`;
    } catch (err) {
      const chatMsg = explainError(err);
      try {
        const modelsMsg = await probeModels(cleanBaseUrl, apiKey);
        return `${modelsMsg}（对话接口调用失败：${chatMsg}）`;
      } catch (probeErr) {
        const probeMsg = probeErr instanceof Error ? probeErr.message : String(probeErr);
        throw new Error(`${chatMsg}；${probeMsg}`);
      }
    }
  }
  // image / video / audio
  return probeModels(cleanBaseUrl, apiKey);
}
