import type { FastifyInstance } from 'fastify';
import { getDb } from '../../../config/database.js';
import { getAppSettingsMap, getServiceProxy } from '../../../repositories/index.js';
import { imageService } from '../../../services/image-service.js';
import { ImageGenerationError } from '../../../infrastructure/ai/errors.js';
import {
  ImageSearchError,
  searchImages,
  trackUnsplashDownload,
  type ImageSearchProvider,
} from '../../../services/image-search-service.js';
import {
  GlamSearchError,
  GLAM_ALL_LABEL,
  GLAM_PROVIDER_LABELS,
  availableGlamProviders,
  searchGlamImages,
  type GlamProvider,
} from '../../../services/glam-search-service.js';
import { GLAM_PROVIDERS, GLAM_IMAGE_HOSTS } from '../helpers.js';

export async function register(app: FastifyInstance): Promise<void> {
  // ---- 多模态工具：图片检索（Unsplash / Pixabay / NASA Images 图片/视频；凭据在 /admin/settings 配置，NASA 公开接口无需凭据） ----

  app.post(
    '/api/modules/bookplate/image-search',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as {
        provider?: string;
        query?: string;
        page?: number;
        per_page?: number;
      };
      const provider: ImageSearchProvider =
        payload.provider === 'nasa-image' || payload.provider === 'nasa-video' || payload.provider === 'pixabay'
          ? payload.provider
          : 'unsplash';
      const s = getAppSettingsMap(getDb());
      try {
        const { items, total } = await searchImages(
          provider,
          {
            unsplashAccessKey: s['unsplash.access_key'] ?? '',
            pixabayApiKey: s['pixabay.api_key'] ?? '',
          },
          {
            query: payload.query,
            page: payload.page,
            perPage: payload.per_page,
          }
        );
        return { provider, items, total };
      } catch (err) {
        if (err instanceof ImageSearchError) {
          return reply.code(502).send({ detail: err.message });
        }
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // 选中图片 → 下载到本地独立子目录（search-images），返回本地 URL 作为节点输出
  app.post(
    '/api/modules/bookplate/image-search/save',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as {
        url?: string;
        source?: string;
        download_url?: string | null;
      };
      const url = (payload.url ?? '').trim();
      if (!url) return reply.code(400).send({ detail: 'url 不能为空' });
      // SSRF 防护：仅允许本节点检索结果来源域名（unsplash.com / pixabay.com / images-assets.nasa.gov 及其子域）
      let hostname = '';
      try {
        hostname = new URL(url).hostname;
      } catch {
        return reply.code(400).send({ detail: '非法图片 URL' });
      }
      const isUnsplash = hostname === 'unsplash.com' || hostname.endsWith('.unsplash.com');
      const isPixabay = hostname === 'pixabay.com' || hostname.endsWith('.pixabay.com');
      // NASA Images 图片托管域名
      const isNasa =
        hostname === 'images-assets.nasa.gov' || hostname.endsWith('.images-assets.nasa.gov');
      if (!isUnsplash && !isPixabay && !isNasa) {
        return reply.code(400).send({ detail: '仅支持 Unsplash / Pixabay / NASA 图片 URL' });
      }
      // Unsplash 下载追踪（API Guidelines 要求；best-effort 并行触发，失败不影响主流程）
      if (payload.source === 'unsplash' && payload.download_url) {
        const s = getAppSettingsMap(getDb());
        const accessKey = (s['unsplash.access_key'] ?? '').trim();
        if (accessKey) {
          void trackUnsplashDownload(accessKey, payload.download_url).catch(() => {});
        }
      }
      try {
        const imageUrl = await imageService.saveSearchImage(request.authUser!.id, url);
        return { image_url: imageUrl };
      } catch (err) {
        if (err instanceof ImageGenerationError) {
          return reply.code(502).send({ detail: err.message });
        }
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // ---- GLAM 工具：艺术图片检索（12 家博物馆开放 API；无关键词 = 随机浏览，凭据在 /admin/settings 配置） ----

  // 可用来源列表（节点来源下拉按配置过滤：未配置 Key 的源不展示）
  app.get(
    '/api/modules/bookplate/glam-providers',
    { preHandler: app.authenticate },
    async () => {
      const s = getAppSettingsMap(getDb());
      return {
        providers: availableGlamProviders({
          harvardApiKey: s['harvard.api_key'] ?? '',
          nyplApiKey: s['nypl.api_key'] ?? '',
          smithsonianApiKey: s['smithsonian.api_key'] ?? '',
          parisApiKey: s['paris.api_key'] ?? '',
          europeanaApiKey: s['europeana.api_key'] ?? '',
          locProxy: getServiceProxy(s, 'loc'),
        }),
      };
    }
  );

  app.post(
    '/api/modules/bookplate/glam-search',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as {
        provider?: string;
        query?: string;
        limit?: number;
        offset?: number;
        offsets?: Record<string, number>;
      };
      const provider: GlamProvider | 'all' =
        payload.provider === 'all' || GLAM_PROVIDERS.includes(payload.provider as GlamProvider)
          ? (payload.provider as GlamProvider | 'all')
          : 'all';
      const s = getAppSettingsMap(getDb());
      try {
        const result = await searchGlamImages(
          provider,
          {
            harvardApiKey: s['harvard.api_key'] ?? '',
            nyplApiKey: s['nypl.api_key'] ?? '',
            smithsonianApiKey: s['smithsonian.api_key'] ?? '',
            parisApiKey: s['paris.api_key'] ?? '',
            europeanaApiKey: s['europeana.api_key'] ?? '',
            locProxy: getServiceProxy(s, 'loc'),
          },
          { query: payload.query, limit: payload.limit, offset: payload.offset, offsets: payload.offsets }
        );
        return {
          provider,
          label: provider === 'all' ? GLAM_ALL_LABEL : GLAM_PROVIDER_LABELS[provider],
          items: result.items,
          has_more: result.hasMore,
          total: result.total,
          next_offset: result.nextOffset,
          ...(result.perSource ? { per_source: result.perSource } : {}),
        };
      } catch (err) {
        if (err instanceof GlamSearchError) {
          return reply.code(502).send({ detail: err.message });
        }
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // 选中图片 → 下载到本地独立子目录（search-images，与图片检索共用），返回本地 URL 作为节点输出
  app.post(
    '/api/modules/bookplate/glam-search/save',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as { url?: string };
      const url = (payload.url ?? '').trim();
      if (!url) return reply.code(400).send({ detail: 'url 不能为空' });
      const s = getAppSettingsMap(getDb());
      // SSRF 防护：仅允许本节点检索结果来源域名（13 家博物馆图片服务器）
      let hostname = '';
      try {
        hostname = new URL(url).hostname.toLowerCase();
      } catch {
        return reply.code(400).send({ detail: '非法图片 URL' });
      }
      const allowed = GLAM_IMAGE_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
      if (!allowed) {
        return reply.code(400).send({ detail: '仅支持博物馆开放图片 URL' });
      }
      // LoC 图片（loc.gov 域名）可能需代理出网（loc.proxy，如 http://127.0.0.1:7890），其余源直连
      const isLoc = hostname === 'loc.gov' || hostname.endsWith('.loc.gov');
      const proxy = isLoc ? getServiceProxy(s, 'loc') : '';
      try {
        const imageUrl = await imageService.saveSearchImage(request.authUser!.id, url, proxy);
        return { image_url: imageUrl };
      } catch (err) {
        if (err instanceof ImageGenerationError) {
          return reply.code(502).send({ detail: err.message });
        }
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

}
