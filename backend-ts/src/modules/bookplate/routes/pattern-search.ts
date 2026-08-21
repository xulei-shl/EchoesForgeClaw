import type { FastifyInstance } from 'fastify';
import { imageService } from '../../../services/image-service.js';
import { ImageGenerationError } from '../../../infrastructure/ai/errors.js';

/** Python Chinese Traditional Patterns API base URL（默认 localhost:8102，可通过环境变量覆盖） */
const PATTERNS_API = process.env.PATTERNS_API ?? 'http://127.0.0.1:8102';

export async function register(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/modules/bookplate/pattern-search/categories
   * 获取纹样分类列表
   */
  app.get(
    '/api/modules/bookplate/pattern-search/categories',
    { preHandler: app.authenticate },
    async (_request, reply) => {
      try {
        const resp = await fetch(`${PATTERNS_API}/categories`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) {
          return reply.code(resp.status).send({ detail: 'Failed to fetch categories' });
        }
        const data = await resp.json();
        return data;
      } catch (err: any) {
        const msg =
          err?.cause?.code === 'ECONNREFUSED'
            ? '纹样检索服务未启动（Patterns API not running on port 8102）'
            : err?.message || String(err);
        return reply.code(502).send({ detail: msg });
      }
    }
  );

  /**
   * POST /api/modules/bookplate/pattern-search
   * 检索/随机获取纹样列表
   */
  app.post(
    '/api/modules/bookplate/pattern-search',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as {
        category?: string;
        query?: string;
        page?: number;
        per_page?: number;
        random?: boolean;
      };

      try {
        const resp = await fetch(`${PATTERNS_API}/patterns/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: payload.category ?? null,
            query: payload.query ?? null,
            page: payload.page ?? 1,
            per_page: payload.per_page ?? 24,
            random: Boolean(payload.random),
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => 'Unknown error');
          return reply.code(resp.status).send({ detail: `Patterns API error: ${errText}` });
        }

        const data = (await resp.json()) as {
          items: any[];
          total: number;
          page: number;
          per_page: number;
        };

        // 为每个 item 补齐完整的图片 URL
        const items = (data.items || []).map((item) => {
          const cardImg = item.card_image ? item.card_image.replace(/^\//, '') : '';
          const fullImageUrl = cardImg ? `${PATTERNS_API}/static/${cardImg}` : '';
          return {
            ...item,
            full_image_url: fullImageUrl,
            thumb_url: fullImageUrl,
            preview_url: fullImageUrl,
          };
        });

        return {
          items,
          total: data.total,
          page: data.page,
          per_page: data.per_page,
        };
      } catch (err: any) {
        const msg =
          err?.cause?.code === 'ECONNREFUSED'
            ? '纹样检索服务未启动（Patterns API not running on port 8102）'
            : err?.message || String(err);
        return reply.code(502).send({ detail: msg });
      }
    }
  );

  /**
   * GET /api/modules/bookplate/pattern-search/:id
   * 获取单款纹样详情（包含完整 Markdown 介绍与解析）
   */
  app.get(
    '/api/modules/bookplate/pattern-search/:id',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const resp = await fetch(`${PATTERNS_API}/patterns/${encodeURIComponent(id)}`, {
          signal: AbortSignal.timeout(10000),
        });

        if (!resp.ok) {
          if (resp.status === 404) {
            return reply.code(404).send({ detail: '未找到指定纹样' });
          }
          return reply.code(resp.status).send({ detail: 'Failed to fetch pattern detail' });
        }

        const data = (await resp.json()) as Record<string, any>;
        const cardImg = data.card_image ? data.card_image.replace(/^\//, '') : '';
        const fullImageUrl = cardImg ? `${PATTERNS_API}/static/${cardImg}` : '';

        return {
          ...data,
          full_image_url: fullImageUrl,
          thumb_url: fullImageUrl,
          preview_url: fullImageUrl,
        };
      } catch (err: any) {
        const msg =
          err?.cause?.code === 'ECONNREFUSED'
            ? '纹样检索服务未启动（Patterns API not running on port 8102）'
            : err?.message || String(err);
        return reply.code(502).send({ detail: msg });
      }
    }
  );

  /**
   * POST /api/modules/bookplate/pattern-search/save
   * 选中纹样：下载卡片图片并落盘到本地 search-images 目录，同时返回详情 Markdown 文本供节点双输出
   */
  app.post(
    '/api/modules/bookplate/pattern-search/save',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as {
        id: string;
        image_url?: string;
      };
      const userId = request.authUser!.id;

      if (!payload.id) {
        return reply.code(400).send({ detail: '缺少纹样 id' });
      }

      try {
        // 1. 获取详情（含 Markdown）
        const detailResp = await fetch(`${PATTERNS_API}/patterns/${encodeURIComponent(payload.id)}`, {
          signal: AbortSignal.timeout(10000),
        });

        let detailMarkdown = '';
        let patternData: any = null;
        if (detailResp.ok) {
          patternData = await detailResp.json();
          detailMarkdown = patternData.detail_markdown || '';
        }

        // 2. 获取图片 URL
        let downloadUrl = payload.image_url;
        if (!downloadUrl && patternData?.card_image) {
          const cardImg = patternData.card_image.replace(/^\//, '');
          downloadUrl = `${PATTERNS_API}/static/${cardImg}`;
        }

        if (!downloadUrl) {
          return reply.code(400).send({ detail: '无法获取纹样图片下载地址' });
        }

        // 3. 将图片下载保存到本地 runtime/{userId}/search-images
        const savedImageUrl = await imageService.saveSearchImage(userId, downloadUrl);

        return {
          image_url: savedImageUrl,
          detail_markdown: detailMarkdown,
          pattern: patternData,
        };
      } catch (err: any) {
        if (err instanceof ImageGenerationError) {
          return reply.code(502).send({ detail: err.message });
        }
        const msg =
          err?.cause?.code === 'ECONNREFUSED'
            ? '纹样检索服务未启动（Patterns API not running on port 8102）'
            : err?.message || String(err);
        return reply.code(502).send({ detail: msg });
      }
    }
  );
}
