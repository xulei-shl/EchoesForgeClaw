import { and, count, desc, eq, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../config/database.js';
import { generations, publicShares } from '../db/schema.js';
import { now } from '../shared/datetime.js';
import { toGenerationOut, type GenerationPage, type GenerationRow } from './generations.js';

/**
 * 公开画廊接口（对应 Python `app/api/public.py`）：
 * - POST /api/public（公开自己的生成记录到画廊，幂等）
 * - GET /api/public（画廊列表：所有用户公开记录，keyword / node_type / 分页）
 * - DELETE /api/public/:generation_id（从画廊撤下）
 */

export async function registerPublicRouter(app: FastifyInstance): Promise<void> {
  // 公开到画廊（幂等，仅限自己的记录）
  app.post(
    '/api/public',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const genId = Number((request.body as { generation_id?: number } | undefined)?.generation_id);
      const db = getDb();
      const gen = db
        .select()
        .from(generations)
        .where(and(eq(generations.id, genId), eq(generations.userId, request.authUser!.id)))
        .get();
      if (!gen) return reply.code(404).send({ detail: '生成记录不存在' });
      const share = db.select().from(publicShares).where(eq(publicShares.generationId, gen.id)).get();
      if (!share) {
        db.insert(publicShares).values({ userId: request.authUser!.id, generationId: gen.id, createdAt: now() }).run();
      }
      return toGenerationOut(db, gen, request.authUser!.id, true);
    }
  );

  // 画廊列表（所有用户）
  app.get('/api/public', { preHandler: app.authenticate }, async (request) => {
    const q = (request.query ?? {}) as { keyword?: string; node_type?: string; skip?: string; limit?: string };
    const keyword = (q.keyword ?? '').trim();
    const nodeType = (q.node_type ?? '').trim();
    const skip = Number(q.skip ?? 0) || 0;
    const limit = Math.min(Number(q.limit ?? 20) || 20, 100);
    const db = getDb();
    const uid = request.authUser!.id;

    const filters = [eq(publicShares.generationId, generations.id)];
    if (keyword) filters.push(like(generations.name, `%${keyword}%`));
    if (nodeType) filters.push(eq(generations.nodeType, nodeType));
    const where = and(...filters);

    const total = db
      .select({ c: count() })
      .from(publicShares)
      .innerJoin(generations, eq(publicShares.generationId, generations.id))
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
      .from(publicShares)
      .innerJoin(generations, eq(publicShares.generationId, generations.id))
      .where(where)
      .orderBy(desc(publicShares.createdAt), desc(publicShares.id))
      .limit(limit)
      .offset(skip)
      .all();

    const counts = db
      .select({ nodeType: generations.nodeType, c: count(generations.id) })
      .from(generations)
      .innerJoin(publicShares, eq(publicShares.generationId, generations.id))
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

  // 从画廊撤下（仅限自己的记录）
  app.delete('/api/public/:generation_id', { preHandler: app.authenticate }, async (request, reply) => {
    const genId = Number((request.params as { generation_id: string }).generation_id);
    const db = getDb();
    const gen = db
      .select()
      .from(generations)
      .where(and(eq(generations.id, genId), eq(generations.userId, request.authUser!.id)))
      .get();
    if (!gen) return reply.code(404).send({ detail: '生成记录不存在' });
    db.delete(publicShares)
      .where(and(eq(publicShares.generationId, gen.id), eq(publicShares.userId, request.authUser!.id)))
      .run();
    return toGenerationOut(db, gen, request.authUser!.id, true);
  });
}
