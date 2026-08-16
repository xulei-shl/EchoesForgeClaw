import { compareSync } from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { getDb } from '../config/database.js';
import { findUserByUsername } from '../repositories/index.js';

/**
 * 认证安全（对应 Python `app/core/security.py` + `app/core/deps.py`）：
 * - bcrypt 口令校验（兼容 passlib 生成的 $2b$ hash）；
 * - JWT（HS256，sub=username, role, exp），经 @fastify/jwt 签名/校验；
 * - `authenticate` / `requireAdmin` preHandler（get_current_active_user / get_current_admin_user）。
 */

/** 校验明文密码（bcrypt，同步，兼容 passlib 生成的 $2b$ hash）。 */
export function verifyPassword(plain: string, hashed: string): boolean {
  try {
    return compareSync(plain, hashed);
  } catch {
    return false;
  }
}

export interface AuthUser {
  id: number;
  username: string;
  role: string;
  is_active: boolean;
  created_at: string | null;
}

/** 用户行 → 对外响应结构（password_hash 永不回传）。 */
export function toAuthUser(row: {
  id: number;
  username: string;
  role: string;
  isActive: boolean | null;
  createdAt: string | null;
}): AuthUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    is_active: !!row.isActive,
    created_at: row.createdAt,
  };
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: string };
    user: { sub: string; role: string };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    /** 当前登录用户（authenticate/requireAdmin 后可用，请求级存储，防并发泄漏）。 */
    authUser?: AuthUser;
  }
  interface FastifyInstance {
    /** 鉴权 preHandler：校验 Bearer token 并挂载 req.authUser（对应 get_current_active_user）。 */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** 管理员鉴权（对应 get_current_admin_user）。 */
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** 注册 JWT + 鉴权装饰器（必须在根实例调用，使 @fastify/jwt 对所有路由生效）。 */
export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(import('@fastify/jwt'), {
    secret: env.secretKey,
    sign: { algorithm: env.algorithm, expiresIn: `${env.accessTokenExpireMinutes}m` },
  });

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ detail: 'Could not validate credentials' });
    }
    const username = req.user?.sub;
    const row = username ? findUserByUsername(getDb(), username) : undefined;
    if (!row || !row.isActive) {
      return reply.code(401).send({ detail: 'Could not validate credentials' });
    }
    req.authUser = toAuthUser(row);
  });

  app.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(req, reply);
    if (reply.sent) return;
    if (req.authUser?.role !== 'admin') {
      return reply.code(403).send({ detail: "The user doesn't have enough privileges" });
    }
  });
}
