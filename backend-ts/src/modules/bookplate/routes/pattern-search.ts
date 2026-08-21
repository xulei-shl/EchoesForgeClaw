import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { userSearchImageDir } from '../../../services/image-service.js';
import { ImageGenerationError } from '../../../infrastructure/ai/errors.js';

/** Python Chinese Traditional Patterns API base URL（默认 localhost:8102，可通过环境变量覆盖） */
const PATTERNS_API = process.env.PATTERNS_API ?? 'http://127.0.0.1:8102';

/** 动态查找 services/chinese-traditional-patterns 真实路径 */
function findPatternsDir(): string {
  let curr = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 7; i++) {
    const candidate = path.join(curr, 'services', 'chinese-traditional-patterns');
    if (existsSync(path.join(candidate, 'data', 'patterns.json'))) return candidate;
    curr = path.dirname(curr);
  }
  const cwd1 = path.resolve(process.cwd(), '../services/chinese-traditional-patterns');
  if (existsSync(path.join(cwd1, 'data', 'patterns.json'))) return cwd1;
  const cwd2 = path.resolve(process.cwd(), 'services/chinese-traditional-patterns');
  if (existsSync(path.join(cwd2, 'data', 'patterns.json'))) return cwd2;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../services/chinese-traditional-patterns');
}

/** 本地传统纹样数据目录 */
const BASE_DIR = findPatternsDir();
const DATA_FILE = path.join(BASE_DIR, 'data', 'patterns.json');

interface RawPatternItem {
  id: string;
  name_cn: string;
  name_en: string;
  category: string;
  summary: string;
  meaning: string;
  visual_keywords: string[];
  batch?: string;
  card_image?: string;
  detail_page?: string;
  meta_json?: string;
  image_size?: string;
  image_sha256?: string;
  source_note?: string;
}

let _localPatterns: RawPatternItem[] = [];
let _localCategories: string[] = [];

function loadLocalData(): void {
  if (!existsSync(DATA_FILE)) return;
  try {
    const raw = readFileSync(DATA_FILE, 'utf-8');
    const data = JSON.parse(raw) as RawPatternItem[];
    _localPatterns = Array.isArray(data) ? data : [];
    const cats: string[] = [];
    for (const item of _localPatterns) {
      if (item.category && !cats.includes(item.category)) {
        cats.push(item.category);
      }
    }
    _localCategories = cats;
  } catch (err) {
    console.error('Failed to load local patterns data:', err);
  }
}

// 启动时初次加载
loadLocalData();

function formatPatternItem(item: RawPatternItem) {
  const cardImg = item.card_image ? item.card_image.replace(/^\//, '') : '';
  const staticUrl = cardImg ? `/static/${cardImg}` : '';
  return {
    ...item,
    full_image_url: staticUrl,
    thumb_url: staticUrl,
    preview_url: staticUrl,
  };
}

function searchLocal(
  category?: string | null,
  query?: string | null,
  page = 1,
  perPage = 24,
  isRandom = false
) {
  if (_localPatterns.length === 0) loadLocalData();

  let results = [..._localPatterns];

  if (category && category.trim() && category !== '全部') {
    const targetCat = category.trim();
    results = results.filter((p) => p.category === targetCat);
  }

  if (query && query.trim()) {
    const keywords = query.trim().toLowerCase().split(/\s+/);
    results = results.filter((p) => {
      const corpus = [
        p.id,
        p.name_cn,
        p.name_en,
        p.category,
        p.summary,
        p.meaning,
        ...(p.visual_keywords || []),
        p.source_note || '',
      ]
        .join(' ')
        .toLowerCase();
      return keywords.every((kw) => corpus.includes(kw));
    });
  } else if (isRandom) {
    // 简单洗牌
    results = [...results].sort(() => Math.random() - 0.5);
  }

  const total = results.length;
  const start = (page - 1) * perPage;
  const end = start + perPage;
  const pagedItems = results.slice(start, end).map(formatPatternItem);

  return {
    items: pagedItems,
    total,
    page,
    per_page: perPage,
  };
}

function getLocalDetail(id: string) {
  if (_localPatterns.length === 0) loadLocalData();
  const rawId = String(id || '').trim();
  const padId = rawId.padStart(3, '0');
  const target = _localPatterns.find((p) => p.id === rawId || String(p.id).padStart(3, '0') === padId);
  if (!target) return null;

  let detailMarkdown = '';
  if (target.detail_page) {
    const mdPath = path.join(BASE_DIR, target.detail_page.replace(/^\//, ''));
    if (existsSync(mdPath)) {
      try {
        detailMarkdown = readFileSync(mdPath, 'utf-8');
      } catch {
        detailMarkdown = '';
      }
    }
  }

  return {
    ...formatPatternItem(target),
    detail_markdown: detailMarkdown,
  };
}

export async function register(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/modules/bookplate/pattern-search/categories
   * 获取纹样分类列表（优先请求 Python 微服务，微服务未就绪时自动降级走本地数据）
   */
  app.get(
    '/api/modules/bookplate/pattern-search/categories',
    { preHandler: app.authenticate },
    async (_request, _reply) => {
      try {
        const resp = await fetch(`${PATTERNS_API}/categories`, {
          signal: AbortSignal.timeout(2000),
        });
        if (resp.ok) {
          const data = (await resp.json()) as { categories?: string[] };
          if (Array.isArray(data?.categories) && data.categories.length > 0) {
            return data;
          }
        }
      } catch {
        // 微服务未启动，平滑降级走本地
      }

      if (_localCategories.length === 0) loadLocalData();
      return { categories: _localCategories };
    }
  );

  /**
   * POST /api/modules/bookplate/pattern-search
   * 检索/随机获取纹样列表（微服务优先，未启动时平滑降级走本地引擎）
   */
  app.post(
    '/api/modules/bookplate/pattern-search',
    { preHandler: app.authenticate },
    async (request, _reply) => {
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
          signal: AbortSignal.timeout(3000),
        });

        if (resp.ok) {
          const data = (await resp.json()) as {
            items: any[];
            total: number;
            page: number;
            per_page: number;
          };

          const items = (data.items || []).map((item) => {
            const cardImg = item.card_image ? item.card_image.replace(/^\//, '') : '';
            const fullImageUrl = cardImg ? `/static/${cardImg}` : '';
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
        }
      } catch {
        // 微服务未启动，平滑降级走本地
      }

      // 本地检索引擎降级响应
      return searchLocal(
        payload.category,
        payload.query,
        payload.page ?? 1,
        payload.per_page ?? 24,
        Boolean(payload.random)
      );
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
          signal: AbortSignal.timeout(2000),
        });

        if (resp.ok) {
          const data = (await resp.json()) as Record<string, any>;
          const cardImg = data.card_image ? data.card_image.replace(/^\//, '') : '';
          const fullImageUrl = cardImg ? `/static/${cardImg}` : '';

          return {
            ...data,
            full_image_url: fullImageUrl,
            thumb_url: fullImageUrl,
            preview_url: fullImageUrl,
          };
        }
      } catch {
        // 微服务未启动，平滑降级走本地
      }

      const localData = getLocalDetail(id);
      if (!localData) {
        return reply.code(404).send({ detail: '未找到指定纹样' });
      }
      return localData;
    }
  );

  /**
   * POST /api/modules/bookplate/pattern-search/save
   * 选中纹样：保存卡片图片到本地 search-images 目录并返回 Markdown 说明文本
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
        const detail = getLocalDetail(payload.id);
        if (!detail) {
          return reply.code(404).send({ detail: '未找到指定纹样' });
        }

        // 保存图片到 runtime/{userId}/search-images/
        const cardRel = detail.card_image ? detail.card_image.replace(/^\//, '') : '';
        const localSourceImg = path.join(BASE_DIR, cardRel);

        const destDir = userSearchImageDir(userId);
        mkdirSync(destDir, { recursive: true });

        const ext = path.extname(localSourceImg) || '.png';
        const filename = `pattern_${payload.id}_${Date.now()}${ext}`;
        const destPath = path.join(destDir, filename);

        if (existsSync(localSourceImg)) {
          copyFileSync(localSourceImg, destPath);
        } else {
          // 若本地文件不存在，尝试 fetch 外部静态地址
          const downloadUrl = payload.image_url || `${PATTERNS_API}/static/${cardRel}`;
          const resp = await fetch(downloadUrl);
          if (!resp.ok) throw new Error('下载纹样图片失败');
          const buf = Buffer.from(await resp.arrayBuffer());
          writeFileSync(destPath, buf);
        }

        const savedImageUrl = `/static/search-images/${userId}/${filename}`;

        return {
          image_url: savedImageUrl,
          detail_markdown: detail.detail_markdown || '',
          pattern: detail,
        };
      } catch (err: any) {
        console.error('Failed to save pattern image:', err);
        return reply.code(500).send({ detail: '保存纹样失败，请重试' });
      }
    }
  );
}
