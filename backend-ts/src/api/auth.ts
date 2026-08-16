import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getDb } from '../config/database.js';
import { findUserByUsername } from '../repositories/index.js';
import { verifyPassword, toAuthUser } from '../shared/security.js';
import { env } from '../config/env.js';

/**
 * 认证接口（对应 Python `app/api/auth.py`）。
 * POST /api/auth/login → { token, user }
 */

export interface LoginRequest {
  username: string;
  password: string;
}

export async function registerAuthRouter(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', async (request: FastifyRequest<{ Body: LoginRequest }>, reply) => {
    const payload = request.body ?? {};
    const username = typeof payload.username === 'string' ? payload.username : '';
    const password = typeof payload.password === 'string' ? payload.password : '';

    const user = username ? findUserByUsername(getDb(), username) : undefined;
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer')
        .send({ detail: '用户名或密码错误' });
    }
    if (!user.isActive) {
      return reply.code(400).send({ detail: '账号已被停用' });
    }

    const token = app.jwt.sign(
      { sub: user.username, role: user.role },
      { expiresIn: `${env.accessTokenExpireMinutes}m` }
    );
    return { token, user: toAuthUser(user) };
  });
}
