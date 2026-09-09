import { and, eq, inArray } from 'drizzle-orm';
import type { DB } from '../../config/database.js';
import { userAnnotations } from '../../db/schema.js';
import { now } from '../../shared/datetime.js';

export const RESOURCE_TYPE_BIFROST_PROMPT = 'bifrost_prompt';
export const RESOURCE_TYPE_BIFROST_SKILL = 'bifrost_skill';

export const VALID_RESOURCE_TYPES = new Set([
  RESOURCE_TYPE_BIFROST_PROMPT,
  RESOURCE_TYPE_BIFROST_SKILL,
]);

export interface UserAnnotationData {
  rating: number;
  note: string;
}

export interface SetAnnotationPayload {
  rating?: number;
  note?: string;
}

/** 校验并规范化评分值（0~5 整数，0 表示未打标/清除打标）。 */
export function normalizeRating(rating: unknown): number {
  if (rating === undefined || rating === null) return 0;
  const num = Number(rating);
  if (Number.isNaN(num)) return 0;
  return Math.min(5, Math.max(0, Math.floor(num)));
}

/** 批量获取用户在特定资源类型下的打标与备注映射表：resourceId → { rating, note } */
export function getUserAnnotationMap(
  db: DB,
  userId: number,
  resourceType: string,
  resourceIds: string[]
): Map<string, UserAnnotationData> {
  const map = new Map<string, UserAnnotationData>();
  const validIds = resourceIds.map((id) => (id ?? '').trim()).filter(Boolean);
  if (!validIds.length || !userId) return map;

  const rows = db
    .select()
    .from(userAnnotations)
    .where(
      and(
        eq(userAnnotations.userId, userId),
        eq(userAnnotations.resourceType, resourceType),
        inArray(userAnnotations.resourceId, validIds)
      )
    )
    .all();

  for (const r of rows) {
    map.set(r.resourceId, {
      rating: r.rating ?? 0,
      note: r.note ?? '',
    });
  }
  return map;
}

/** 单个查询用户对指定资源的打标与备注（无则返回默认 { rating: 0, note: '' }）。 */
export function getUserAnnotation(
  db: DB,
  userId: number,
  resourceType: string,
  resourceId: string
): UserAnnotationData {
  const rid = (resourceId ?? '').trim();
  if (!rid || !userId) return { rating: 0, note: '' };

  const row = db
    .select()
    .from(userAnnotations)
    .where(
      and(
        eq(userAnnotations.userId, userId),
        eq(userAnnotations.resourceType, resourceType),
        eq(userAnnotations.resourceId, rid)
      )
    )
    .get();

  return {
    rating: row?.rating ?? 0,
    note: row?.note ?? '',
  };
}

/**
 * 写入或更新用户的打标/备注。
 * 若 rating 为 0 且 note 为空串，则自动物理删除记录以精简数据库。
 */
export function setUserAnnotation(
  db: DB,
  userId: number,
  resourceType: string,
  resourceId: string,
  payload: SetAnnotationPayload
): UserAnnotationData {
  const rid = (resourceId ?? '').trim();
  if (!rid) {
    throw new Error('resource_id 不能为空');
  }
  if (!VALID_RESOURCE_TYPES.has(resourceType)) {
    throw new Error(`不支持的 resource_type: ${resourceType}`);
  }

  const existing = db
    .select()
    .from(userAnnotations)
    .where(
      and(
        eq(userAnnotations.userId, userId),
        eq(userAnnotations.resourceType, resourceType),
        eq(userAnnotations.resourceId, rid)
      )
    )
    .get();

  const nextRating =
    payload.rating !== undefined
      ? normalizeRating(payload.rating)
      : existing?.rating ?? 0;
  const nextNote =
    payload.note !== undefined
      ? (payload.note ?? '').trim()
      : existing?.note ?? '';

  const timestamp = now();

  // 若无星级且无备注，删除行以保持库表紧凑
  if (nextRating === 0 && !nextNote) {
    if (existing) {
      db.delete(userAnnotations)
        .where(eq(userAnnotations.id, existing.id))
        .run();
    }
    return { rating: 0, note: '' };
  }

  if (existing) {
    db.update(userAnnotations)
      .set({
        rating: nextRating,
        note: nextNote,
        updatedAt: timestamp,
      })
      .where(eq(userAnnotations.id, existing.id))
      .run();
  } else {
    db.insert(userAnnotations)
      .values({
        userId,
        resourceType,
        resourceId: rid,
        rating: nextRating,
        note: nextNote,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }

  return { rating: nextRating, note: nextNote };
}
