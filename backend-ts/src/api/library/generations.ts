import { and, count, desc, eq, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb, type DB } from '../../config/database.js';
import { favorites, generations, publicShares, users } from '../../db/schema.js';
import { now, parseJsonColumn, stringifyJsonColumn, toIso } from '../../shared/datetime.js';
import { extractRuntimeImageUrls, imageService } from '../../services/multimodal/image-service.js';

/**
 * 生成记录接口（对应 Python `app/api/generations.py`）：
 * - POST /api/generations（保存一次画布生成结果）
 * - GET /api/generations（历史列表，keyword / node_type / 分页）
 * - GET /api/generations/:id（单条详情）
 * - DELETE /api/generations/:id（删除，级联清理收藏/公开 + 静态文件）
 */

export type GenerationRow = typeof generations.$inferSelect;

export interface GenerationOut {
  id: number;
  node_type: string;
  name: string;
  stage_results: Record<string, unknown>;
  result_url: string | null;
  status: string;
  created_at: string;
  is_favorited: boolean;
  is_public: boolean;
  username: string | null;
}

export interface GenerationPage {
  items: GenerationOut[];
  total: number;
  skip: number;
  limit: number;
  node_type_counts: { node_type: string; count: number }[];
}

/** 从 stage_results 中提取题名（按 node_type 分发；新节点类型在此登记取名字段）。 */
export function extractGenerationName(stageResults: unknown, nodeType: string): string {
  if (nodeType === 'image_generation' || nodeType === 'receipt_printer') {
    const sr = (stageResults && typeof stageResults === 'object' ? stageResults : {}) as Record<string, any>;
    const metadata = sr.stage1?.metadata;
    if (metadata && typeof metadata === 'object' && typeof metadata.title === 'string') {
      return metadata.title.trim();
    }
    if (nodeType === 'receipt_printer') {
      const prompt = sr.stage3?.prompt || sr.stage2?.prompt;
      if (typeof prompt === 'string' && prompt.trim()) {
        return prompt.trim();
      }
    }
  }
  return '';
}

/** 收集生成记录关联的静态资源 URL（删除时一并清理文件；覆盖 stage_results 任意嵌套位置，如 agent_steps / markdown 内嵌）。 */
function collectArtifactUrls(gen: GenerationRow): string[] {
  return extractRuntimeImageUrls([gen.resultUrl, gen.stageResults]);
}

/** 生成记录 → 对外响应（附带当前用户的收藏/公开状态，可选用户名）。 */
export function toGenerationOut(
  db: DB,
  gen: GenerationRow,
  currentUserId: number,
  includeUsername = false
): GenerationOut {
  const fav = db
    .select({ id: favorites.id })
    .from(favorites)
    .where(and(eq(favorites.userId, currentUserId), eq(favorites.generationId, gen.id)))
    .get();
  const share = db
    .select({ id: publicShares.id })
    .from(publicShares)
    .where(eq(publicShares.generationId, gen.id))
    .get();
  let username: string | null = null;
  if (includeUsername) {
    const u = db.select({ username: users.username }).from(users).where(eq(users.id, gen.userId)).get();
    username = u?.username ?? null;
  }
  return {
    id: gen.id,
    node_type: gen.nodeType,
    name: gen.name || '',
    stage_results: parseJsonColumn(gen.stageResults),
    result_url: gen.resultUrl,
    status: gen.status ?? 'completed',
    created_at: toIso(gen.createdAt) ?? '',
    is_favorited: !!fav,
    is_public: !!share,
    username,
  };
}

interface ListQuery {
  keyword?: string;
  node_type?: string;
  skip?: string;
  limit?: string;
}

/** 列表过滤 + 分页 + 类型计数（generations / favorites / public 共用）。 */
function listPage(
  db: DB,
  baseWhere: Parameters<typeof and>[number] | undefined,
  keyword: string,
  nodeType: string,
  skip: number,
  limit: number,
  orderBy: ReturnType<typeof desc>[]
): { rows: GenerationRow[]; total: number; nodeTypeCounts: { node_type: string; count: number }[] } {
  const filters = [baseWhere];
  if (keyword) filters.push(like(generations.name, `%${keyword}%`));
  if (nodeType) filters.push(eq(generations.nodeType, nodeType));
  const where = and(...filters);
  const total = db.select({ c: count() }).from(generations).where(where).get()!.c;
  const rows = db
    .select()
    .from(generations)
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(skip)
    .all();
  const typeWhere = and(baseWhere);
  const counts = db
    .select({ nodeType: generations.nodeType, c: count(generations.id) })
    .from(generations)
    .where(typeWhere)
    .groupBy(generations.nodeType)
    .all();
  return {
    rows,
    total,
    nodeTypeCounts: counts.map((r) => ({ node_type: r.nodeType, count: r.c })),
  };
}

export async function registerGenerationsRouter(app: FastifyInstance): Promise<void> {
  // 保存一次生成结果
  app.post(
    '/api/generations',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as GenerationCreatePayload;
      const db = getDb();
      const nodeType = payload.node_type || 'image_generation';
      const stageResults = payload.stage_results ?? {};
      const row = db
        .insert(generations)
        .values({
          userId: request.authUser!.id,
          nodeType,
          name: extractGenerationName(stageResults, nodeType),
          stageResults: stringifyJsonColumn(stageResults),
          resultUrl: payload.result_url || '',
          status: payload.status || 'completed',
          createdAt: now(),
        })
        .returning()
        .get();
      return toGenerationOut(db, row, request.authUser!.id);
    }
  );

  // 历史列表
  app.get('/api/generations', { preHandler: app.authenticate }, async (request) => {
    const q = (request.query ?? {}) as ListQuery;
    const skip = Number(q.skip ?? 0) || 0;
    const limit = Math.min(Number(q.limit ?? 20) || 20, 100);
    const db = getDb();
    const scope = and(eq(generations.userId, request.authUser!.id));
    const page = listPage(
      db,
      scope,
      (q.keyword ?? '').trim(),
      (q.node_type ?? '').trim(),
      skip,
      limit,
      [desc(generations.createdAt), desc(generations.id)]
    );
    return {
      items: page.rows.map((g) => toGenerationOut(db, g, request.authUser!.id)),
      total: page.total,
      skip,
      limit,
      node_type_counts: page.nodeTypeCounts,
    } satisfies GenerationPage;
  });

  // 单条详情
  app.get('/api/generations/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const db = getDb();
    const gen = db
      .select()
      .from(generations)
      .where(and(eq(generations.id, id), eq(generations.userId, request.authUser!.id)))
      .get();
    if (!gen) return reply.code(404).send({ detail: '生成记录不存在' });
    return toGenerationOut(db, gen, request.authUser!.id);
  });

  // 删除（级联清理收藏/公开 + 对应静态文件）
  app.delete('/api/generations/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const db = getDb();
    const gen = db
      .select()
      .from(generations)
      .where(and(eq(generations.id, id), eq(generations.userId, request.authUser!.id)))
      .get();
    if (!gen) return reply.code(404).send({ detail: '生成记录不存在' });
    const urls = collectArtifactUrls(gen);
    // 级联清理：该记录的收藏与公开分享（对应 Python ORM cascade="all, delete-orphan"）
    db.delete(favorites).where(eq(favorites.generationId, id)).run();
    db.delete(publicShares).where(eq(publicShares.generationId, id)).run();
    db.delete(generations).where(eq(generations.id, id)).run();
    for (const url of urls) imageService.deleteFile(url);
    return { message: '生成记录已删除' };
  });
}

interface GenerationCreatePayload {
  node_type?: string;
  stage_results?: Record<string, unknown>;
  result_url?: string;
  status?: string;
}
