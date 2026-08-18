/**
 * @fileoverview 零依赖 Wikipedia 客户端：关键词检索 + 文章内容。
 * 仅使用全局 fetch（Node ≥18 / Bun / Deno 内置），不依赖 @cyanheads/mcp-ts-core。
 *
 * 说明：本项目原始 WikipediaService 强依赖 MCP 框架（fetchWithTimeout/withRetry/logger/
 * McpError/StorageService/RequestContextLike）。本文件将上述能力用原生 fetch + 最小实现
 * 替代，便于直接集成到普通 TypeScript 后端（无需 MCP / skill）。
 *
 * 数据来源是 Wikipedia 官方公开 MediaWiki API（匿名、无需密钥）：
 *   - 检索：   /w/api.php?action=query&list=search
 *   - 全文：   /w/api.php?action=query&prop=extracts&explaintext=true  （上游直接返回纯文本）
 *   - 概要：   /api/rest_v1/page/summary/{title}                        （extract 字段为纯文本）
 *
 * 注意：本文件不含「按章节读取」所需的 HTML→纯文本管线（htmlSectionToPlainText），
 * 因为检索 + 全文这条路径完全不需要解析 HTML。如需按章节读取，参见 reference-wikipedia-service.ts。
 */

const WIKIPEDIA_USER_AGENT =
  'my-ts-backend/1.0 (https://example.com)';

/** 进程内 edition 索引缓存（替代原 StorageService，可选）。 */
let editionIndex: { hosts: Record<string, string>; expiresAt: number } | undefined;

export class WikipediaError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'WikipediaError';
  }
}

/** 带超时 + 指数退避重试的 fetch（替代原 fetchWithTimeout / withRetry）。 */
async function fetchJson<T>(
  url: string,
  opts: { timeoutMs?: number; maxRetries?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const { timeoutMs = 15_000, maxRetries = 3, signal } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': WIKIPEDIA_USER_AGENT, Accept: 'application/json' },
        signal: signal ?? ctrl.signal,
      });
      clearTimeout(timer);
      const text = await res.text();
      // 限流 / 维护时上游会返回 HTML 错误页，需重映射为可重试错误。
      if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
        throw new WikipediaError('Wikipedia 返回了 HTML 而非 JSON（可能被限流或维护中）', 503);
      }
      if (!res.ok) throw new WikipediaError(`Wikipedia 请求失败: ${res.status}`, res.status);
      return JSON.parse(text) as T;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/** 根据 language 拼出根域名（https://<language>.wikipedia.org）。 */
function baseUrl(language: string): string {
  return `https://${language.toLowerCase()}.wikipedia.org`;
}

// ---- Action API / REST API 原始类型（只取用到的字段）----
type ActionSearchRaw = {
  query?: {
    searchinfo?: { totalhits?: number };
    search?: Array<{ title: string; pageid: number; snippet: string; wordcount?: number }>;
  };
  continue?: { sroffset?: number };
};

type ActionExtractsRaw = {
  query?: {
    pages?: Record<string, { pageid?: number; title?: string; extract?: string; missing?: string }>;
  };
};

type RestSummaryRaw = {
  title?: string;
  pageid?: number;
  description?: string;
  extract?: string;
  thumbnail?: { source?: string };
};

/** 1) 关键词检索。返回标题、pageid、摘要片段、词数，以及分页游标 nextOffset。 */
export async function search(
  query: string,
  opts: { limit?: number; language?: string; offset?: number } = {},
): Promise<{
  results: Array<{ title: string; pageid: number; snippet: string; wordcount: number }>;
  totalResults: number;
  nextOffset?: number;
}> {
  const { limit = 10, language = 'en', offset = 0 } = opts;
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    format: 'json',
    formatversion: '2',
    srsearch: query,
    srlimit: String(Math.min(limit, 50)),
    sroffset: String(offset),
    srprop: 'snippet|wordcount',
  });
  const raw = await fetchJson<ActionSearchRaw>(`${baseUrl(language)}/w/api.php?${params}`);
  const results = (raw.query?.search ?? []).map((r) => ({
    title: r.title,
    pageid: r.pageid,
    snippet: decodeEntities(r.snippet.replace(/<[^>]+>/g, '')), // 去掉 <span class="searchmatch"> 高亮标记
    wordcount: r.wordcount ?? 0,
  }));
  return {
    results,
    totalResults: raw.query?.searchinfo?.totalhits ?? results.length,
    nextOffset: raw.continue?.sroffset,
  };
}

/** 2) 全文内容。prop=extracts&explaintext=true 让上游直接返回纯文本（无需 HTML 解析）。 */
export async function getArticle(
  title: string,
  language = 'en',
): Promise<{ title: string; pageid?: number; content: string }> {
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'extracts',
    format: 'json',
    formatversion: '2',
    explaintext: 'true',
    exsectionformat: 'wiki',
    redirects: 'true', // 解析别名重定向，如 "NYC" → "New York City"
  });
  const raw = await fetchJson<ActionExtractsRaw>(`${baseUrl(language)}/w/api.php?${params}`);
  const pages = raw.query?.pages;
  const page = pages && Object.values(pages)[0];
  if (!page || page.missing !== undefined) throw new WikipediaError(`未找到文章: ${title}`, 404);
  if (!page.extract) throw new WikipediaError(`文章无可读内容: ${title}`, 404);
  return { title: page.title ?? title, pageid: page.pageid, content: page.extract };
}

/** 3) 概要（适合 "什么是 X"）。REST 接口，extract 字段即纯文本摘要。 */
export async function getSummary(
  title: string,
  language = 'en',
): Promise<{ title: string; description?: string; extract: string; thumbnailUrl?: string }> {
  const enc = encodeURIComponent(title.replace(/ /g, '_'));
  const raw = await fetchJson<RestSummaryRaw>(`${baseUrl(language)}/api/rest_v1/page/summary/${enc}`);
  if (!raw.extract) throw new WikipediaError(`未找到文章: ${title}`, 404);
  return {
    title: raw.title ?? title,
    description: raw.description,
    extract: raw.extract,
    thumbnailUrl: raw.thumbnail?.source,
  };
}

/** 解码 Action API 搜索片段里的 HTML 实体（命名 + 十进制 + 十六进制）。 */
function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
    const map: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
    if (name) return map[name.toLowerCase()] ?? m;
    const code = dec === undefined ? parseInt(hex, 16) : Number(dec);
    return code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}
