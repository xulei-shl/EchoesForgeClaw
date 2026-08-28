import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { generateText } from 'ai';
import { APICallError } from '@ai-sdk/provider';
import { getDb, type DB } from '../../config/database.js';
import { llmConfigs, nodeConfigs, skillAgentConfigs } from '../../db/schema.js';
import { now, toIso } from '../../shared/datetime.js';
import { createAIProvider, resolveEnvProxy } from '../../infrastructure/ai/provider.js';
import { classifyAIError } from '../../infrastructure/ai/errors.js';
import { fetchWithProxy } from '../../services/http-proxy.js';

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
  /** pi 集成 API 格式：'anthropic' | 'openai' | 空（默认 openai 兼容） */
  api_format?: string;
  /** pi 集成 OpenAI 兼容路径思考 wire 格式（deepseek/qwen-chat-template/...，空 = 默认 reasoning_effort） */
  thinking_format?: string;
  context_window?: number | null;
  max_tokens?: number | null;
  is_active?: boolean;
}

interface LLMConfigOut {
  id: number;
  name: string;
  kind: string;
  base_url: string;
  model_name: string;
  api_format: string | null;
  thinking_format: string | null;
  context_window: number | null;
  max_tokens: number | null;
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
    api_format: row.apiFormat ?? null,
    thinking_format: row.thinkingFormat ?? null,
    context_window: row.contextWindow ?? null,
    max_tokens: row.maxTokens ?? null,
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
          apiFormat: p.api_format || null,
          thinkingFormat: p.thinking_format || null,
          contextWindow: p.context_window ?? null,
          maxTokens: p.max_tokens ?? null,
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
        apiFormat: cfg.apiFormat,
        thinkingFormat: cfg.thinkingFormat,
        contextWindow: cfg.contextWindow,
        maxTokens: cfg.maxTokens,
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
      if (p.api_format != null) set.apiFormat = p.api_format || null;
      if (p.thinking_format != null) set.thinkingFormat = p.thinking_format || null;
      if (p.context_window !== undefined) set.contextWindow = p.context_window;
      if (p.max_tokens !== undefined) set.maxTokens = p.max_tokens;
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

  // Models.dev / 本地预设模型参数查询（辅助前端自动填充 context_window / max_tokens）
  app.post(
    '/api/admin/llm-configs/lookup-model',
    admin,
    async (request, reply) => {
      const { model_name } = (request.body ?? {}) as { model_name?: string };
      if (!model_name?.trim()) return reply.code(400).send({ detail: '模型名称不能为空' });
      const rawName = model_name.trim();

      // 第一层：本地离线预设字典精确匹配（0 延迟、抗断网）
      const localMatch = matchLocalPreset(rawName);
      if (localMatch) {
        return {
          found: true,
          source: 'local' as const,
          ...localMatch,
        };
      }

      // 第二层：Models.dev 全量线上查询（覆盖 10,000+ 原生与 Provider 模型）
      try {
        const index = await getModelsDevIndex();
        const normalized = normalizeModelName(rawName);
        const lowerRaw = rawName.toLowerCase();

        // 匹配优先级：
        // 1. 原始名精确查找（如 agnes-2.5-flash 或 deepseek-v4-flash-vision-exp）
        // 2. 归一化名称精确查找（去厂商前缀/去日期后缀）
        // 3. 遍历寻找末段完全匹配项（key.endsWith('/' + normalized)）
        let m = index.get(lowerRaw) ?? index.get(normalized);
        if (!m) {
          for (const [k, val] of index.entries()) {
            if (k.endsWith('/' + lowerRaw) || k.endsWith('/' + normalized)) {
              m = val;
              break;
            }
          }
        }

        if (!m) return { found: false };

        const limit = m.limit as Record<string, number> | undefined;
        const modalities = m.modalities as { input?: string[]; output?: string[] } | undefined;
        const isMultimodal = Array.isArray(modalities?.input) && modalities.input.includes('image');

        return {
          found: true,
          source: 'remote' as const,
          context_window: limit?.context ?? null,
          max_tokens: limit?.output ?? null,
          reasoning: m.reasoning === true,
          is_multimodal: isMultimodal,
        };
      } catch (err) {
        request.log.warn('Models.dev 查询失败: %s', err instanceof Error ? err.message : String(err));
        return { found: false };
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
    const proxy = resolveEnvProxy();
    resp = await fetchWithProxy(
      url,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      },
      proxy
    );
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

// ---------------------------------------------------------------------------
// 本地离线预设字典 + Models.dev 全量索引（双层容灾）
// ---------------------------------------------------------------------------

interface PresetModelSpec {
  context_window: number;
  max_tokens: number;
  reasoning: boolean;
  is_multimodal: boolean;
}

/** 常见主流大模型离线预设（抗断网、0 延迟、严格精确匹配） */
const LOCAL_PRESETS: Record<string, PresetModelSpec> = {
  // Agnes
  'agnes-2.0-flash': { context_window: 512_000, max_tokens: 65_536, reasoning: true, is_multimodal: true },
  'agnes-2.5-flash': { context_window: 512_000, max_tokens: 65_536, reasoning: true, is_multimodal: true },
  'agnes-2.5-pro-alpha': { context_window: 1_000_000, max_tokens: 65_536, reasoning: true, is_multimodal: true },

  // DeepSeek
  'deepseek-chat': { context_window: 1_000_000, max_tokens: 384_000, reasoning: false, is_multimodal: false },
  'deepseek-reasoner': { context_window: 1_000_000, max_tokens: 384_000, reasoning: true, is_multimodal: false },
  'deepseek-v3': { context_window: 1_000_000, max_tokens: 384_000, reasoning: false, is_multimodal: false },
  'deepseek-r1': { context_window: 1_000_000, max_tokens: 384_000, reasoning: true, is_multimodal: false },
  'deepseek-v4-pro': { context_window: 1_000_000, max_tokens: 384_000, reasoning: true, is_multimodal: false },
  'deepseek-v4-flash': { context_window: 1_000_000, max_tokens: 384_000, reasoning: true, is_multimodal: false },
  'deepseek-v4-flash-vision-exp': { context_window: 1_000_000, max_tokens: 384_000, reasoning: true, is_multimodal: true },

  // OpenAI
  'gpt-4o': { context_window: 128_000, max_tokens: 16_384, reasoning: false, is_multimodal: true },
  'gpt-4o-mini': { context_window: 128_000, max_tokens: 16_384, reasoning: false, is_multimodal: true },
  'gpt-4-turbo': { context_window: 128_000, max_tokens: 4_096, reasoning: false, is_multimodal: true },
  'o1': { context_window: 200_000, max_tokens: 100_000, reasoning: true, is_multimodal: true },
  'o3-mini': { context_window: 200_000, max_tokens: 100_000, reasoning: true, is_multimodal: false },

  // Anthropic
  'claude-3-5-sonnet': { context_window: 200_000, max_tokens: 8_192, reasoning: false, is_multimodal: true },
  'claude-3-7-sonnet': { context_window: 200_000, max_tokens: 64_000, reasoning: true, is_multimodal: true },
  'claude-3-opus': { context_window: 200_000, max_tokens: 4_096, reasoning: false, is_multimodal: true },
  'claude-opus-4-6': { context_window: 200_000, max_tokens: 32_000, reasoning: true, is_multimodal: true },
  'claude-3-5-haiku': { context_window: 200_000, max_tokens: 8_192, reasoning: false, is_multimodal: true },

  // Google
  'gemini-2.0-flash': { context_window: 1_048_576, max_tokens: 8_192, reasoning: false, is_multimodal: true },
  'gemini-2.5-flash': { context_window: 1_048_576, max_tokens: 65_536, reasoning: true, is_multimodal: true },
  'gemini-1.5-pro': { context_window: 2_097_152, max_tokens: 8_192, reasoning: false, is_multimodal: true },
  'gemini-2.5-pro': { context_window: 1_048_576, max_tokens: 65_536, reasoning: true, is_multimodal: true },

  // 通义千问 / Qwen
  'qwen-2.5-72b-instruct': { context_window: 131_072, max_tokens: 8_192, reasoning: false, is_multimodal: false },
  'qwen-plus': { context_window: 131_072, max_tokens: 8_192, reasoning: false, is_multimodal: false },
  'qwen-max': { context_window: 32_768, max_tokens: 8_192, reasoning: false, is_multimodal: false },
  'qwen-turbo': { context_window: 131_072, max_tokens: 8_192, reasoning: false, is_multimodal: false },

  // 智谱 / GLM
  'glm-4-plus': { context_window: 128_000, max_tokens: 4_096, reasoning: false, is_multimodal: false },
  'glm-4-flash': { context_window: 128_000, max_tokens: 4_096, reasoning: false, is_multimodal: false },
};

/** 名称归一化：小写、去除厂商前缀、去除日期快照后缀（如 -20241022、-0125 等） */
function normalizeModelName(raw: string): string {
  let name = raw.trim().toLowerCase();
  // 去除组织/路径前缀（如 openai/gpt-4o → gpt-4o, deepseek-ai/deepseek-v3 → deepseek-v3）
  if (name.includes('/')) {
    name = name.split('/').pop()!;
  }
  // 去除常见日期/版本后缀（如 -20241022, -20250514, -0125, -0806 等 4-8 位纯数字结尾）
  name = name.replace(/-\d{4,8}$/, '');
  // 去除常见 preview/latest 冗余修饰以提高命中率
  name = name.replace(/-(preview|latest)$/, '');
  return name;
}

/** 本地预设匹配（严格精确匹配，禁止贪婪包含，防止特化模型被基础底模截胡） */
function matchLocalPreset(rawName: string): PresetModelSpec | null {
  const norm = normalizeModelName(rawName);
  // 1. 归一化精确匹配
  if (LOCAL_PRESETS[norm]) return LOCAL_PRESETS[norm];
  // 2. 原始输入小写精确匹配
  const lower = rawName.trim().toLowerCase();
  if (LOCAL_PRESETS[lower]) return LOCAL_PRESETS[lower];
  return null;
}

let _modelsDevIndex: Map<string, Record<string, unknown>> | null = null;
let _modelsDevIndexTs = 0;
const MODELS_DEV_TTL_MS = 30 * 60 * 1000;

/** 获取 Models.dev 全量模型索引（从 api.json 平铺 10,000+ 原生与 Provider 模型） */
async function getModelsDevIndex(): Promise<Map<string, Record<string, unknown>>> {
  if (_modelsDevIndex && Date.now() - _modelsDevIndexTs < MODELS_DEV_TTL_MS) {
    return _modelsDevIndex;
  }
  // 5 秒超时拉取 api.json（包含全部 100+ Provider）
  const resp = await fetch('https://models.dev/api.json', {
    signal: AbortSignal.timeout(5_000),
  });
  if (!resp.ok) throw new Error(`Models.dev HTTP ${resp.status}`);
  const providers = (await resp.json()) as Record<string, { models?: Record<string, Record<string, unknown>> }>;

  const index = new Map<string, Record<string, unknown>>();
  for (const [providerId, p] of Object.entries(providers)) {
    if (!p.models || typeof p.models !== 'object') continue;
    for (const [modelId, modelSpec] of Object.entries(p.models)) {
      const cleanModelId = modelId.toLowerCase();
      // 支持裸 model_id 查找
      index.set(cleanModelId, modelSpec);
      // 支持 provider/model_id 完整路径查找
      index.set(`${providerId.toLowerCase()}/${cleanModelId}`, modelSpec);
    }
  }

  _modelsDevIndex = index;
  _modelsDevIndexTs = Date.now();
  return _modelsDevIndex;
}
