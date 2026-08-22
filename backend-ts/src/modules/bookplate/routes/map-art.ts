import type { FastifyInstance } from 'fastify';
import { getDb } from '../../../config/database.js';
import { getAppSettingsMap } from '../../../repositories/index.js';
import { imageService } from '../../../services/image-service.js';

/** 获取 Python prettymaps API base URL（优先系统设置，次选环境变量，最后默认 localhost:8101） */
function getMapArtApiUrl(): string {
  const s = getAppSettingsMap(getDb());
  const configured = s['service.map_art.base_url']?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return (process.env.PRETTYMAPS_API ?? 'http://127.0.0.1:8101').replace(/\/+$/, '');
}

export async function register(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/modules/bookplate/generate-map-art
   * 代理请求到 Python prettymaps FastAPI 服务，生成艺术地图 PNG 并落盘到 map-arts 目录。
   * 请求体包含坐标/半径/预设等参数。
   * 返回 { image_url } 供前端展示。
   */
  app.post(
    '/api/modules/bookplate/generate-map-art',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, any>;
      const userId = request.authUser!.id;

      try {
        const apiUrl = getMapArtApiUrl();
        const resp = await fetch(`${apiUrl}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: body.lat,
            lon: body.lon,
            query: body.query ?? '',
            radius: body.radius ?? 0.75,
            circle: body.circle ?? false,
            preset: body.preset ?? 'default',
            figsize_width: body.figsize_width ?? 8.27,
            figsize_height: body.figsize_height ?? 8.27,
          }),
          signal: AbortSignal.timeout(120000),
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => 'Unknown error');
          return reply.code(resp.status).send({ detail: `Python API error: ${errText}` });
        }

        const buffer = Buffer.from(await resp.arrayBuffer());
        if (!buffer.length) {
          return reply.code(502).send({ detail: 'Python API returned empty image' });
        }

        const imageUrl = imageService.saveMapArtImage(userId, buffer);
        return { image_url: imageUrl };
      } catch (err: any) {
        const msg = err?.cause?.code === 'ECONNREFUSED'
          ? '艺术地图生成服务未启动（Prettymaps API not running）'
          : err?.message || String(err);
        return reply.code(502).send({ detail: msg });
      }
    }
  );

  /**
   * GET /api/modules/bookplate/map-art/presets
   * 代理请求到 Python prettymaps 服务获取可用预设列表。
   */
  app.get(
    '/api/modules/bookplate/map-art/presets',
    { preHandler: app.authenticate },
    async (_request, reply) => {
      try {
        const apiUrl = getMapArtApiUrl();
        const resp = await fetch(`${apiUrl}/presets/simple`);
        if (!resp.ok) {
          return reply.code(resp.status).send({ detail: 'Failed to fetch themes' });
        }
        return await resp.json();
      } catch (err: any) {
        return reply.code(502).send({ detail: '艺术地图生成服务未启动' });
      }
    }
  );
}