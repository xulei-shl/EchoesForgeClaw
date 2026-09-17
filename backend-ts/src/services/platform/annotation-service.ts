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
  tags: string[];
}

export interface SetAnnotationPayload {
  rating?: number;
  note?: string;
  tags?: string[];
}

/** 校验并规范化评分值（0~5 整数，0 表示未打标/清除打标）。 */
export function normalizeRating(rating: unknown): number {
  if (rating === undefined || rating === null) return 0;
  const num = Number(rating);
  if (Number.isNaN(num)) return 0;
  return Math.min(5, Math.max(0, Math.floor(num)));
}

/** 规范化标签列表：去重、去除空白字符、过滤空串 */
export function normalizeTags(tags: unknown[]): string[] {
  const set = new Set<string>();
  for (const t of tags) {
    if (typeof t === 'string') {
      const trimmed = t.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return Array.from(set);
}

/** 解析数据库存储的 tags 原始值（JSON 字符串或数组） */
export function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return normalizeTags(raw);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalizeTags(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

/** 批量获取用户在特定资源类型下的打标与备注映射表：resourceId → { rating, note, tags } */
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
      tags: parseTags(r.tags),
    });
  }
  return map;
}

/** 单个查询用户对指定资源的打标与备注（无则返回默认 { rating: 0, note: '', tags: [] }）。 */
export function getUserAnnotation(
  db: DB,
  userId: number,
  resourceType: string,
  resourceId: string
): UserAnnotationData {
  const rid = (resourceId ?? '').trim();
  if (!rid || !userId) return { rating: 0, note: '', tags: [] };

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
    tags: parseTags(row?.tags),
  };
}

/**
 * 写入或更新用户的打标/备注/标签。
 * 若 rating 为 0 且 note 为空串且 tags 为空，则自动物理删除记录以精简数据库。
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
  const nextTags =
    payload.tags !== undefined
      ? normalizeTags(payload.tags)
      : parseTags(existing?.tags);

  const timestamp = now();

  // 若无星级、无备注且无标签，删除行以保持库表紧凑
  if (nextRating === 0 && !nextNote && nextTags.length === 0) {
    if (existing) {
      db.delete(userAnnotations)
        .where(eq(userAnnotations.id, existing.id))
        .run();
    }
    return { rating: 0, note: '', tags: [] };
  }

  const tagsJson = JSON.stringify(nextTags);

  if (existing) {
    db.update(userAnnotations)
      .set({
        rating: nextRating,
        note: nextNote,
        tags: tagsJson,
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
        tags: tagsJson,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }

  return { rating: nextRating, note: nextNote, tags: nextTags };
}
