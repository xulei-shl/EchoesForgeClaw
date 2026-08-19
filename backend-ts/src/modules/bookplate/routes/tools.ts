import type { FastifyInstance } from 'fastify';
import { env } from '../../../config/env.js';
import { getDb } from '../../../config/database.js';
import { getAppSettingsMap, getServiceProxy } from '../../../repositories/index.js';
import { fetchCalendar, fetchWeather, SmallToolError } from '../../../services/tool-service.js';
import {
  ZhihuError,
  globalSearch,
  zhihuSearch,
  zhidaAnswer,
} from '../../../services/zhihu-service.js';
import {
  WikipediaError,
  fetchWikipediaArticle,
  fetchWikipediaSummary,
  searchWikipedia,
} from '../../../services/wikipedia-service.js';
import {
  TranslationError,
  translateText,
  type TranslationSource,
} from '../../../services/translation-service.js';
import {
  WebSearchError,
  searchTavily,
  searchExa,
  searchAnySearch,
  searchDoubao,
  type WebSearchResult,
} from '../../../services/web-search-service.js';
import { globalSearch as zhihuGlobalSearch } from '../../../services/zhihu-service.js';

export async function register(app: FastifyInstance): Promise<void> {
  // ---- 小工具节点：万年历 / 天气查询（无需配置，直接调用第三方公开 API） ----

  app.post(
    '/api/modules/bookplate/calendar',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as { date?: string };
      // 凭据与基础地址：优先 /admin/settings（mxnzp.*，种子自 .env），纯 .env 值作回退
      const s = getAppSettingsMap(getDb());
      const appId = (s['mxnzp.app_id'] ?? '').trim() || env.mxnzpAppId;
      const appSecret = (s['mxnzp.app_secret'] ?? '').trim() || env.mxnzpAppSecret;
      const baseUrl = (s['mxnzp.base_url'] ?? '').trim();
      if (!appId || !appSecret) {
        return reply.code(503).send({
          detail: '万年历服务未配置：请在管理端「系统设置」配置 mxnzp.app_id / mxnzp.app_secret（或设置 .env 的 MXNZP_APP_ID / MXNZP_APP_SECRET 后重启后端）',
        });
      }
      try {
        return await fetchCalendar(payload.date, appId, appSecret, baseUrl);
      } catch (err) {
        if (err instanceof SmallToolError) {
          return reply.code(502).send({ detail: err.message });
        }
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  app.post(
    '/api/modules/bookplate/weather',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as { city?: string };
      try {
        return await fetchWeather(payload.city);
      } catch (err) {
        if (err instanceof SmallToolError) {
          return reply.code(502).send({ detail: err.message });
        }
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // ---- 文本工具：知乎检索节点（站内搜索 / 全网搜索 / 直答；Access Secret 在 /admin/settings 配置，回退 .env） ----

  app.post(
    '/api/modules/bookplate/zhihu-search',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as {
        mode?: string;
        query?: string;
        count?: number;
        filter?: string;
        search_db?: string;
        model?: string;
      };
      const s = getAppSettingsMap(getDb());
      const accessSecret = (s['zhihu.access_secret'] ?? '').trim() || env.zhihuAccessSecret;
      if (!accessSecret) {
        return reply.code(503).send({
          detail: '知乎检索未配置：请在管理端「系统设置」配置 zhihu.access_secret（或设置 .env 的 ZHIHU_ACCESS_SECRET 后重启后端）',
        });
      }
      const mode = payload.mode === 'global' || payload.mode === 'zhida' ? payload.mode : 'zhihu';
      const query = (payload.query ?? '').trim();
      if (!query) {
        return reply.code(400).send({ detail: mode === 'zhida' ? '直答问题不能为空' : '检索关键词不能为空' });
      }
      try {
        if (mode === 'zhida') {
          return await zhidaAnswer(accessSecret, payload.model ?? 'zhida-fast-1p5', query);
        }
        if (mode === 'global') {
          return await globalSearch(
            accessSecret,
            query,
            payload.count ?? 5,
            payload.filter ?? '',
            payload.search_db ?? 'all'
          );
        }
        return await zhihuSearch(accessSecret, query, payload.count ?? 5);
      } catch (err) {
        if (err instanceof ZhihuError) {
          return reply.code(502).send({ detail: err.message });
        }
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // ---- 文本工具：Wikipedia 检索节点（官方公开 MediaWiki API，匿名无需密钥） ----

  // 关键词检索：返回标题 / 摘要片段 / 词数 / 总命中数（前端列表展示，选中后拉全文）
  app.post(
    '/api/modules/bookplate/wikipedia-search',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as { query?: string; language?: string; limit?: number };
      const query = (payload.query ?? '').trim();
      if (!query) {
        return reply.code(400).send({ detail: '检索关键词不能为空' });
      }
      try {
        return await searchWikipedia(query, {
          language: payload.language ?? 'zh',
          limit: payload.limit ?? 10,
        });
      } catch (err) {
        if (err instanceof WikipediaError) {
          return reply.code(502).send({ detail: err.message });
        }
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // 文章全文 / 简介：summary=true 走 REST API 精简摘要，否则返回完整正文
  app.post(
    '/api/modules/bookplate/wikipedia-article',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as { title?: string; language?: string; summary?: boolean };
      const title = (payload.title ?? '').trim();
      if (!title) {
        return reply.code(400).send({ detail: '文章标题不能为空' });
      }
      try {
        if (payload.summary) {
          return await fetchWikipediaSummary(title, payload.language ?? 'zh');
        }
        return await fetchWikipediaArticle(title, payload.language ?? 'zh');
      } catch (err) {
        if (err instanceof WikipediaError) {
          return reply.code(502).send({ detail: err.message });
        }
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  // ---- 文本工具：网络搜索节点（知乎全网 / Tavily / Exa；凭据在 /admin/settings 配置） ----

  app.post(
    '/api/modules/bookplate/web-search',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as {
        query?: string;
        count?: number;
        source?: string;
      };
      const query = (payload.query ?? '').trim();
      if (!query) {
        return reply.code(400).send({ detail: '检索关键词不能为空' });
      }
      const count = payload.count ?? 5;
      const source: 'zhihu_global' | 'tavily' | 'exa' | 'anysearch' | 'doubao' | 'random' =
        payload.source === 'zhihu_global' || payload.source === 'tavily' || payload.source === 'exa' || payload.source === 'anysearch' || payload.source === 'doubao' ? payload.source : 'random';

      const s = getAppSettingsMap(getDb());
      const accessSecret = (s['zhihu.access_secret'] ?? '').trim() || env.zhihuAccessSecret;
      const tavilyKey = (s['tavily.api_key'] ?? '').trim() || '';
      const exaKey = (s['exa.api_key'] ?? '').trim() || '';
      const anysearchKey = (s['anysearch.api_key'] ?? '').trim() || '';
      const doubaoKey = (s['doubao.api_key'] ?? '').trim() || '';

      // 手动指定知乎全网：直接调 zhihu globalSearch
      if (source === 'zhihu_global') {
        if (!accessSecret) {
          return reply.code(503).send({
            detail: '知乎全网搜索未配置：请在管理端「系统设置」配置 zhihu.access_secret',
          });
        }
        try {
          const result = await zhihuGlobalSearch(accessSecret, query, count, '', 'all');
          return { output: result.output, source: 'zhihu_global' };
        } catch (err) {
          if (err instanceof ZhihuError) {
            return reply.code(502).send({ detail: err.message });
          }
          if (err instanceof TypeError) {
            return reply.code(502).send({ detail: '知乎全网搜索请求失败，请检查网络连接' });
          }
          return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
        }
      }

      // 手动指定 Tavily / Exa / AnySearch / 豆包
      if (source === 'tavily' || source === 'exa' || source === 'anysearch' || source === 'doubao') {
        const key = source === 'tavily' ? tavilyKey : source === 'exa' ? exaKey : source === 'anysearch' ? anysearchKey : doubaoKey;
        if (!key) {
          return reply.code(503).send({ detail: `检索源 ${source} 未配置 API Key` });
        }
        try {
          let result: WebSearchResult;
          if (source === 'tavily') {
            result = await searchTavily(key, query, count);
          } else if (source === 'exa') {
            result = await searchExa(key, query, count);
          } else if (source === 'anysearch') {
            result = await searchAnySearch(key, query, count);
          } else {
            result = await searchDoubao(key, query, count);
          }
          return { output: result.output, source: result.source };
        } catch (err) {
          if (err instanceof WebSearchError) {
            return reply.code(502).send({ detail: err.message });
          }
          return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
        }
      }

      // 随机模式：从所有已配置的源中随机选（知乎全网 / Tavily / Exa / AnySearch / 豆包）
      const candidates: Array<'zhihu_global' | 'tavily' | 'exa' | 'anysearch' | 'doubao'> = [];
      if (accessSecret) candidates.push('zhihu_global');
      if (tavilyKey) candidates.push('tavily');
      if (exaKey) candidates.push('exa');
      if (anysearchKey) candidates.push('anysearch');
      if (doubaoKey) candidates.push('doubao');
      if (candidates.length === 0) {
        return reply.code(503).send({
          detail: '网络搜索未配置：请在管理端「系统设置」配置至少一个检索源的凭据（zhihu.access_secret / tavily.api_key / exa.api_key / anysearch.api_key / doubao.api_key）',
        });
      }
      const shuffled = [...candidates].sort(() => Math.random() - 0.5);
      const errors: string[] = [];
      for (const src of shuffled) {
        try {
          let result: { output: string; source: string };
          if (src === 'zhihu_global') {
            const r = await zhihuGlobalSearch(accessSecret!, query, count, '', 'all');
            result = { output: r.output, source: 'zhihu_global' };
          } else if (src === 'tavily') {
            if (!tavilyKey) continue;
            result = await searchTavily(tavilyKey, query, count);
          } else if (src === 'exa') {
            if (!exaKey) continue;
            result = await searchExa(exaKey, query, count);
          } else if (src === 'anysearch') {
            if (!anysearchKey) continue;
            result = await searchAnySearch(anysearchKey, query, count);
          } else {
            if (!doubaoKey) continue;
            result = await searchDoubao(doubaoKey, query, count);
          }
          return { output: result.output, source: result.source };
        } catch (err) {
          const msg = err instanceof WebSearchError || err instanceof ZhihuError ? err.message : (err instanceof TypeError ? '网络请求失败' : (err instanceof Error ? err.message : String(err)));
          errors.push(`${src}: ${msg}`);
        }
      }
      return reply.code(502).send({
        detail: `全部检索源均失败：${errors.join('；')}`,
      });
    }
  );

  // ---- 文本工具：文本翻译节点（Google 翻译 / DeepLX；DeepLX URL 在 /admin/settings 配置） ----

  app.post(
    '/api/modules/bookplate/translate',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const payload = (request.body ?? {}) as {
        text?: string;
        from?: string;
        to?: string;
        source?: string;
      };
      const text = (payload.text ?? '').trim();
      if (!text) {
        return reply.code(400).send({ detail: '翻译文本不能为空' });
      }
      const from = (payload.from ?? 'auto').trim();
      const to = (payload.to ?? '').trim();
      if (!to) {
        return reply.code(400).send({ detail: '目标语言不能为空' });
      }
      const source: TranslationSource =
        payload.source === 'google' || payload.source === 'deeplx' ? payload.source : 'random';

      const s = getAppSettingsMap(getDb());
      const deeplxUrl = (s['deeplx.url'] ?? '').trim();
      const proxies: Partial<Record<TranslationSource, string>> = {
        google: getServiceProxy(s, 'google_translate'),
        deeplx: getServiceProxy(s, 'deeplx'),
      };

      try {
        const result = await translateText({ text, from, to, source, deeplxUrl, proxies });
        return { output: result.output, source: result.source };
      } catch (err) {
        if (err instanceof TranslationError) {
          return reply.code(502).send({ detail: err.message });
        }
        return reply.code(502).send({ detail: err instanceof Error ? err.message : String(err) });
      }
    }
  );
}
