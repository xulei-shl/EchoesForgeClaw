import type { FastifyInstance } from 'fastify';
import { hashSync } from 'bcryptjs';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../config/database.js';
import { users } from '../db/schema.js';
import { now } from '../shared/datetime.js';
import { toAuthUser } from '../shared/security.js';

/**
 * 用户接口（对应 Python `app/api/users.py`）：
 * - GET /api/users/me（登录用户）
 * - GET/POST /api/users（管理员列表/创建）
 * - PATCH/DELETE /api/users/:id（管理员修改/删除）
 */

export interface UserPayload {
  username?: string;
  password?: string;
  role?: 'admin' | 'user';
  is_active?: boolean;
}

export async function registerUsersRouter(app: FastifyInstance): Promise<void> {
  // 当前用户信息
  app.get('/api/users/me', { preHandler: app.authenticate }, async (request) => {
    return request.authUser;
  });

  // 用户列表（管理员）
  app.get(
    '/api/users',
    { preHandler: app.requireAdmin },
    async (request) => {
      const q = (request.query ?? {}) as { skip?: string; limit?: string };
      const skip = Number(q.skip ?? 0) || 0;
      const limit = Math.min(Number(q.limit ?? 100) || 100, 1000);
      const rows = getDb().select().from(users).limit(limit).offset(skip).all();
      return rows.map(toAuthUser);
    }
  );

  // 创建用户（管理员）
  app.post(
    '/api/users',
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      const payload = (request.body ?? {}) as UserPayload;
      const username = (payload.username ?? '').trim();
      if (!username || !payload.password) {
        return reply.code(400).send({ detail: 'username 与 password 必填' });
      }
      const db = getDb();
      const exists = db.select().from(users).where(eq(users.username, username)).get();
      if (exists) return reply.code(400).send({ detail: 'Username already registered' });

      const row = db
        .insert(users)
        .values({
          username,
          passwordHash: hashSync(payload.password!, 12),
          role: payload.role ?? 'user',
          isActive: payload.is_active ?? true,
          createdAt: now(),
          updatedAt: now(),
        })
        .returning()
        .get();
      return toAuthUser(row);
    }
  );

  // 修改用户（管理员）
  app.patch(
    '/api/users/:id',
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const payload = (request.body ?? {}) as UserPayload;
      const db = getDb();
      const row = db.select().from(users).where(eq(users.id, id)).get();
      if (!row) return reply.code(404).send({ detail: 'User not found' });

      const set: Record<string, unknown> = {};
      if (payload.username != null) set.username = payload.username;
      if (payload.role != null) set.role = payload.role;
      if (payload.is_active != null) set.isActive = payload.is_active;
      if (payload.password) set.passwordHash = hashSync(payload.password, 12);
      set.updatedAt = now();
      db.update(users).set(set).where(eq(users.id, id)).run();
      const updated = db.select().from(users).where(eq(users.id, id)).get()!;
      return toAuthUser(updated);
    }
  );

  // 删除用户（管理员）
  app.delete(
    '/api/users/:id',
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const db = getDb();
      const row = db.select().from(users).where(eq(users.id, id)).get();
      if (!row) return reply.code(404).send({ detail: 'User not found' });
      db.delete(users).where(eq(users.id, id)).run();
      return { message: 'User deleted successfully' };
    }
  );
}

// 供其他模块引用（避免重复 import）
export { and };
