import type { FastifyInstance } from 'fastify';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { imageService, userMapPosterDir } from '../../../services/image-service.js';
import { RUNTIME_ROOT } from '../../../services/skill-agent-service.js';

const MAP_POSTER_STATIC_PREFIX = '/static/map-posters';

/** Python maptoposter API base URL（默认 localhost:8100，可通过环境变量覆盖） */
const MAPTOPoster_API = process.env.MAPTOPoster_API ?? 'http://127.0.0.1:8100';

export async function register(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/modules/bookplate/map-poster/generate
   * 代理请求到 Python maptoposter FastAPI 服务，生成海报 PNG 并落盘到 map-posters 目录。
   * 请求体透传给 Python 服务（城市、主题、尺寸等）。
   * 返回 { image_url } 供前端展示。
   */
  app.post(
    '/api/modules/bookplate/map-poster/generate',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, any>;
      const userId = request.authUser!.id;

      try {
        const resp = await fetch(`${MAPTOPoster_API}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(300000),
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => 'Unknown error');
          return reply.code(resp.status).send({ detail: `Python API error: ${errText}` });
        }

        const contentType = resp.headers.get('content-type') ?? 'image/png';
        const buffer = Buffer.from(await resp.arrayBuffer());

        if (!buffer.length) {
          return reply.code(502).send({ detail: 'Python API returned empty image' });
        }

        // 落盘到 map-posters 目录
        const dir = userMapPosterDir(userId);
        mkdirSync(dir, { recursive: true });
        const ts = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const timestamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
        const rand = Date.now() % 100000;
        const name = `map_poster_${timestamp}_${rand}.png`;
        writeFileSync(path.join(dir, name), buffer);

        return { image_url: `${MAP_POSTER_STATIC_PREFIX}/${userId}/${name}` };
      } catch (err: any) {
        // Python 服务未启动或网络错误
        const msg = err?.cause?.code === 'ECONNREFUSED'
          ? '地图海报生成服务未启动（Python API not running）'
          : err?.message || String(err);
        return reply.code(502).send({ detail: msg });
      }
    }
  );

  /**
   * GET /api/modules/bookplate/map-poster/themes
   * 代理请求到 Python maptoposter 服务获取可用主题列表。
   */
  app.get(
    '/api/modules/bookplate/map-poster/themes',
    { preHandler: app.authenticate },
    async (_request, reply) => {
      try {
        const resp = await fetch(`${MAPTOPoster_API}/themes`);
        if (!resp.ok) {
          return reply.code(resp.status).send({ detail: 'Failed to fetch themes' });
        }
        return await resp.json();
      } catch (err: any) {
        return reply.code(502).send({ detail: '地图海报生成服务未启动' });
      }
    }
  );
}
