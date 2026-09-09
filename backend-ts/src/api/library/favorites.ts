import { and, count, desc, eq, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../../config/database.js';
import { favorites, generations } from '../../db/schema.js';
import { now } from '../../shared/datetime.js';
import { toGenerationOut, type GenerationPage, type GenerationRow } from './generations.js';

/**
 * 收藏接口（对应 Python `app/api/favorites.py`）：
 * - POST /api/favorites（收藏，可收藏画廊中他人作品，幂等）
 * - GET /api/favorites（当前用户收藏列表，keyword / node_type / 分页）
 * - DELETE /api/favorites/:generation_id（取消收藏）
 */

export async function registerFavoritesRouter(app: FastifyInstance): Promise<void> {
  // 收藏（幂等）
  app.post(
    '/api/favorites',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const genId = Number((request.body as { generation_id?: number } | undefined)?.generation_id);
      const db = getDb();
      const gen = db.select().from(generations).where(eq(generations.id, genId)).get();
      if (!gen) return reply.code(404).send({ detail: '生成记录不存在' });
      const existing = db
        .select({ id: favorites.id })
        .from(favorites)
        .where(and(eq(favorites.userId, request.authUser!.id), eq(favorites.generationId, gen.id)))
        .get();
      if (!existing) {
        try {
          db.insert(favorites).values({ userId: request.authUser!.id, generationId: gen.id, createdAt: now() }).run();
        } catch {
          // 并发重复收藏命中唯一约束：按已收藏处理（无唯一索引时忽略即可）
        }
      }
      return toGenerationOut(db, gen, request.authUser!.id, true);
    }
  );

  // 收藏列表（含生成记录内容）
  app.get('/api/favorites', { preHandler: app.authenticate }, async (request) => {
    const q = (request.query ?? {}) as { keyword?: string; node_type?: string; skip?: string; limit?: string };
    const keyword = (q.keyword ?? '').trim();
    const nodeType = (q.node_type ?? '').trim();
    const skip = Number(q.skip ?? 0) || 0;
    const limit = Math.min(Number(q.limit ?? 20) || 20, 100);
    const db = getDb();
    const uid = request.authUser!.id;

    const filters = [eq(favorites.userId, uid)];
    if (keyword) filters.push(like(generations.name, `%${keyword}%`));
    if (nodeType) filters.push(eq(generations.nodeType, nodeType));
    const where = and(...filters);

    const total = db
      .select({ c: count() })
      .from(favorites)
      .innerJoin(generations, eq(favorites.generationId, generations.id))
      .where(where)
      .get()!.c;

    const rows = db
      .select({
        id: generations.id,
        userId: generations.userId,
        nodeType: generations.nodeType,
        name: generations.name,
        stageResults: generations.stageResults,
        resultUrl: generations.resultUrl,
        status: generations.status,
        createdAt: generations.createdAt,
      })
      .from(favorites)
      .innerJoin(generations, eq(favorites.generationId, generations.id))
      .where(where)
      .orderBy(desc(favorites.createdAt), desc(favorites.id))
      .limit(limit)
      .offset(skip)
      .all();

    const counts = db
      .select({ nodeType: generations.nodeType, c: count(generations.id) })
      .from(generations)
      .innerJoin(favorites, eq(favorites.generationId, generations.id))
      .where(eq(favorites.userId, uid))
      .groupBy(generations.nodeType)
      .all();

    return {
      items: rows.map((r) => toGenerationOut(db, r as GenerationRow, uid, true)),
      total,
      skip,
      limit,
      node_type_counts: counts.map((r) => ({ node_type: r.nodeType, count: r.c })),
    } satisfies GenerationPage;
  });

  // 取消收藏
  app.delete('/api/favorites/:generation_id', { preHandler: app.authenticate }, async (request, reply) => {
    const genId = Number((request.params as { generation_id: string }).generation_id);
    const db = getDb();
    db.delete(favorites)
      .where(and(eq(favorites.userId, request.authUser!.id), eq(favorites.generationId, genId)))
      .run();
    const gen = db.select().from(generations).where(eq(generations.id, genId)).get();
    if (!gen) return reply.code(404).send({ detail: '生成记录不存在' });
    return toGenerationOut(db, gen, request.authUser!.id, true);
  });
}
