import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../../config/database.js';
import { appSettings } from '../../db/schema.js';
import { now, toIso } from '../../shared/datetime.js';

/**
 * 系统设置管理（对应 Python `app/api/admin/settings.py`）：
 * - GET /api/admin/settings（列表，敏感键值返回掩码）
 * - POST /api/admin/settings（新建/覆盖，key 重复则更新）
 * - PUT/DELETE /api/admin/settings/:key（修改/删除）
 *
 * 敏感键（键名含 api_key / secret / password）：明文永不回传；空串 / 掩码保存视为不修改。
 */

const SENSITIVE_MARKERS = ['api_key', 'secret', 'password'];

function isSensitive(key: string): boolean {
  const lowered = key.toLowerCase();
  return SENSITIVE_MARKERS.some((marker) => lowered.includes(marker));
}

interface SettingOut {
  id: number;
  key: string;
  value: string;
  description: string;
  updated_at: string | null;
  sensitive: boolean;
}

function toOut(row: typeof appSettings.$inferSelect): SettingOut {
  const sensitive = isSensitive(row.key);
  const value = sensitive && row.value ? '********' : row.value;
  return {
    id: row.id,
    key: row.key,
    value,
    description: row.description,
    updated_at: toIso(row.updatedAt),
    sensitive,
  };
}

export async function registerSettingsAdminRouter(app: FastifyInstance): Promise<void> {
  const admin = { preHandler: app.requireAdmin };

  // 列表
  app.get('/api/admin/settings', admin, async () => {
    const rows = getDb().select().from(appSettings).orderBy(appSettings.id).all();
    return rows.map(toOut);
  });

  // 新建 / 覆盖（key 重复则更新）
  app.post(
    '/api/admin/settings',
    admin,
    async (request, reply) => {
      const p = (request.body ?? {}) as { key?: string; value?: string; description?: string };
      const key = (p.key ?? '').trim();
      if (!key) return reply.code(400).send({ detail: '设置键不能为空' });
      let value = p.value ?? '';
      const description = p.description ?? '';
      if (isSensitive(key) && value === '********') value = ''; // 敏感键不允许写入掩码字面量

      const db = getDb();
      const existing = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
      if (existing) {
        db.update(appSettings).set({ value, description, updatedAt: now() }).where(eq(appSettings.key, key)).run();
        return toOut(db.select().from(appSettings).where(eq(appSettings.key, key)).get()!);
      }
      const row = db.insert(appSettings).values({ key, value, description, updatedAt: now() }).returning().get();
      return toOut(row);
    }
  );

  // 修改（按 key；敏感键留空 / 掩码保存时不修改密钥）
  app.put(
    '/api/admin/settings/:key',
    admin,
    async (request, reply) => {
      const key = (request.params as { key: string }).key;
      const p = (request.body ?? {}) as { value?: string | null; description?: string | null };
      const db = getDb();
      const item = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
      if (!item) return reply.code(404).send({ detail: '设置项不存在' });

      const set: Record<string, unknown> = {};
      if (p.description != null) set.description = p.description;
      if (p.value != null) {
        if (isSensitive(key) && (!p.value || p.value === '********')) {
          // 敏感键：空串 / 掩码 = 不修改密钥，保留原值
        } else {
          set.value = p.value;
        }
      }
      // 无实际变更（如敏感键仅传掩码）时跳过 UPDATE，避免空 SET 生成非法 SQL
      if (Object.keys(set).length) {
        set.updatedAt = now();
        db.update(appSettings).set(set).where(eq(appSettings.key, key)).run();
      }
      return toOut(db.select().from(appSettings).where(eq(appSettings.key, key)).get()!);
    }
  );

  // 删除
  app.delete('/api/admin/settings/:key', admin, async (request, reply) => {
    const key = (request.params as { key: string }).key;
    const db = getDb();
    const item = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
    if (!item) return reply.code(404).send({ detail: '设置项不存在' });
    db.delete(appSettings).where(eq(appSettings.key, key)).run();
    return { message: '设置项已删除' };
  });
}
