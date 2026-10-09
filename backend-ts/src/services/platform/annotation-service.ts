import { and, count, desc, eq, gt, inArray, ne } from 'drizzle-orm';
import type { DB } from '../../config/database.js';
import { skillTags, userAnnotations, users } from '../../db/schema.js';
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
  isPublic: boolean;
}

export interface SetAnnotationPayload {
  rating?: number;
  note?: string;
  tags?: string[];
  is_public?: boolean;
}

export interface PublicNoteOut {
  user_id: number;
  username: string;
  display_name: string;
  note: string;
  updated_at: string | null;
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

/** 批量获取用户在特定资源类型下的打标与备注映射表：resourceId → { rating, note, tags, isPublic } */
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
      isPublic: Boolean(r.isPublic),
    });
  }
  return map;
}

/** 单个查询用户对指定资源的打标与备注（无则返回默认 { rating: 0, note: '', tags: [], isPublic: false }）。 */
export function getUserAnnotation(
  db: DB,
  userId: number,
  resourceType: string,
  resourceId: string
): UserAnnotationData {
  const rid = (resourceId ?? '').trim();
  if (!rid || !userId) return { rating: 0, note: '', tags: [], isPublic: false };

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
    isPublic: Boolean(row?.isPublic),
  };
}

/**
 * 写入或更新用户的打标/备注/标签与公开状态。
 * 若 rating 为 0 且 note 为空串且 tags 为空，则自动物理删除记录以精简数据库。
 * 若 note 为空，则自动强制 isPublic 为 false。
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

  // 校验逻辑：备忘为空时禁用公开开关
  const nextIsPublic = !nextNote
    ? false
    : payload.is_public !== undefined
      ? Boolean(payload.is_public)
      : Boolean(existing?.isPublic);

  const timestamp = now();

  // 若无星级、无备注且无标签，删除行以保持库表紧凑
  if (nextRating === 0 && !nextNote && nextTags.length === 0) {
    if (existing) {
      db.delete(userAnnotations)
        .where(eq(userAnnotations.id, existing.id))
        .run();
    }
    return { rating: 0, note: '', tags: [], isPublic: false };
  }

  const tagsJson = JSON.stringify(nextTags);

  if (existing) {
    db.update(userAnnotations)
      .set({
        rating: nextRating,
        note: nextNote,
        tags: tagsJson,
        isPublic: nextIsPublic,
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
        isPublic: nextIsPublic,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }

  return { rating: nextRating, note: nextNote, tags: nextTags, isPublic: nextIsPublic };
}

/* ===================================================================== */
/* 全局统一标签（Admin 管控）                                              */
/* ===================================================================== */

/** 管理员设置资源的全局分类标签（去重、清洗、字典序排序） */
export function setGlobalTags(db: DB, skillName: string, tags: string[]): string[] {
  const name = (skillName ?? '').trim();
  if (!name) throw new Error('skill_name 不能为空');
  const cleaned = normalizeTags(tags).sort();
  const tagsJson = JSON.stringify(cleaned);
  const timestamp = now();

  const existing = db.select().from(skillTags).where(eq(skillTags.skillName, name)).get();
  if (existing) {
    db.update(skillTags)
      .set({ tags: tagsJson, updatedAt: timestamp })
      .where(eq(skillTags.skillName, name))
      .run();
  } else {
    db.insert(skillTags)
      .values({ skillName: name, tags: tagsJson, updatedAt: timestamp })
      .run();
  }
  return cleaned;
}

/** 单个获取资源的全局分类标签 */
export function getGlobalTags(db: DB, skillName: string): string[] {
  const name = (skillName ?? '').trim();
  if (!name) return [];
  const row = db.select().from(skillTags).where(eq(skillTags.skillName, name)).get();
  return parseTags(row?.tags);
}

/** 批量获取资源的全局分类标签映射表 */
export function getGlobalTagsMap(db: DB, skillNames: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const validNames = skillNames.map((n) => (n ?? '').trim()).filter(Boolean);
  if (!validNames.length) return map;

  const rows = db
    .select()
    .from(skillTags)
    .where(inArray(skillTags.skillName, validNames))
    .all();

  for (const r of rows) {
    map.set(r.skillName, parseTags(r.tags));
  }
  return map;
}

/** 聚合全站所有已设置过的全局标签池（供筛选器下拉框及候选云使用） */
export function getAllAvailableTags(db: DB): string[] {
  const rows = db.select({ tags: skillTags.tags }).from(skillTags).all();
  const set = new Set<string>();
  for (const r of rows) {
    for (const t of parseTags(r.tags)) {
      if (t) set.add(t);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/* ===================================================================== */
/* 团队经验公开共享与评星统计                                              */
/* ===================================================================== */

/** 查询某资源的所有同事公开备忘列表（关联 users 表，按更新时间倒序） */
export function getPublicNotes(db: DB, resourceType: string, resourceId: string): PublicNoteOut[] {
  const rid = (resourceId ?? '').trim();
  if (!rid) return [];

  const rows = db
    .select({
      userId: userAnnotations.userId,
      username: users.username,
      note: userAnnotations.note,
      updatedAt: userAnnotations.updatedAt,
    })
    .from(userAnnotations)
    .innerJoin(users, eq(userAnnotations.userId, users.id))
    .where(
      and(
        eq(userAnnotations.resourceType, resourceType),
        eq(userAnnotations.resourceId, rid),
        eq(userAnnotations.isPublic, true),
        ne(userAnnotations.note, '')
      )
    )
    .orderBy(desc(userAnnotations.updatedAt))
    .all();

  return rows.map((r) => ({
    user_id: r.userId,
    username: r.username,
    display_name: r.username,
    note: r.note,
    updated_at: r.updatedAt ? String(r.updatedAt) : null,
  }));
}

/** 批量统计各资源的评星人数（rating > 0） */
export function getStarCountMap(
  db: DB,
  resourceType: string,
  resourceIds: string[]
): Map<string, number> {
  const map = new Map<string, number>();
  const validIds = resourceIds.map((id) => (id ?? '').trim()).filter(Boolean);
  if (!validIds.length) return map;

  const rows = db
    .select({
      resourceId: userAnnotations.resourceId,
      starCount: count(userAnnotations.id),
    })
    .from(userAnnotations)
    .where(
      and(
        eq(userAnnotations.resourceType, resourceType),
        gt(userAnnotations.rating, 0),
        inArray(userAnnotations.resourceId, validIds)
      )
    )
    .groupBy(userAnnotations.resourceId)
    .all();

  for (const r of rows) {
    map.set(r.resourceId, r.starCount);
  }
  return map;
}

/** 单个统计某资源的评星人数 */
export function getStarCount(db: DB, resourceType: string, resourceId: string): number {
  const rid = (resourceId ?? '').trim();
  if (!rid) return 0;
  const res = db
    .select({ starCount: count(userAnnotations.id) })
    .from(userAnnotations)
    .where(
      and(
        eq(userAnnotations.resourceType, resourceType),
        eq(userAnnotations.resourceId, rid),
        gt(userAnnotations.rating, 0)
      )
    )
    .get();
  return res?.starCount ?? 0;
}

/** 撤销/清退公开备忘（将 is_public 置为 false） */
export function revokePublicNote(
  db: DB,
  resourceType: string,
  resourceId: string,
  userId: number
): boolean {
  const rid = (resourceId ?? '').trim();
  if (!rid || !userId) return false;

  const annot = db
    .select()
    .from(userAnnotations)
    .where(
      and(
        eq(userAnnotations.resourceType, resourceType),
        eq(userAnnotations.resourceId, rid),
        eq(userAnnotations.userId, userId)
      )
    )
    .get();

  if (annot) {
    db.update(userAnnotations)
      .set({ isPublic: false, updatedAt: now() })
      .where(eq(userAnnotations.id, annot.id))
      .run();
    return true;
  }
  return false;
}
