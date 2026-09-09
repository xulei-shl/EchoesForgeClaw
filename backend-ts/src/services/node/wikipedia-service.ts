/**
 * Wikipedia 检索节点外部 API（Wikipedia 官方公开 MediaWiki API，匿名、无需密钥）。
 *
 * 两条路径（均无需 HTML 解析，上游直接返回纯文本）：
 * - 检索：`GET /w/api.php?action=query&list=search` 关键词检索（标题 / pageid / 摘要片段 / 词数）；
 * - 全文：`GET /w/api.php?action=query&prop=extracts&explaintext=true` 文章正文纯文本。
 *
 * 合规要求：请求带 `User-Agent` 头（Wikimedia 政策）；匿名有速率限制，超时自动重试。
 * 实现参考 `docs/文本工具/wikipedia-api/wikipedia-client.ts`（零依赖 standalone 客户端），
 * 按本项目服务层约定改写（fetch + AbortSignal.timeout + 自定义错误类，与 zhihu-service 同口径）。
 */

/** Wikimedia 政策要求的 User-Agent（必带，标明客户端身份与用途）。 */
const WIKIPEDIA_USER_AGENT = 'BookForge-Bookplate/1.0 (BookForge bookplate wikipedia-search node)';

/** 外部请求超时（ms）：检索 / 全文均为轻量请求，15s 足够。 */
const WIKIPEDIA_TIMEOUT_MS = 15_000;

/** 单次检索最大条数（服务端上限 50） */
const SEARCH_MAX_LIMIT = 50;

/** 文章正文截断上限（字符）：避免一次性返回超大正文（如 "World War II"）。 */
const ARTICLE_MAX_CHARS = 50_000;

/** Wikipedia 外部 API 调用失败（网络 / 响应异常 / 业务错误码），由路由映射为 502 + detail。 */
export class WikipediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WikipediaError';
  }
}

/** 检索结果项 */
export interface WikipediaSearchItem {
  title: string;
  pageid: number;
  /** 摘要片段（已剥离 <span class="searchmatch"> 高亮标签与 HTML 实体解码） */
  snippet: string;
  wordcount: number;
}

/** 根据 language 拼出根域名（https://<language>.wikipedia.org） */
function baseUrl(language: string): string {
  return `https://${language.toLowerCase().trim() || 'zh'}.wikipedia.org`;
}

/** 带超时的 fetch（请求失败直接抛 WikipediaError；限流/维护时上游返回 HTML 错误页，重映射为可重试错误） */
async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': WIKIPEDIA_USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(WIKIPEDIA_TIMEOUT_MS),
  });
  const text = await res.text();
  // 限流 / 维护时上游会返回 HTML 错误页，需重映射为可读错误。
  if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
    throw new WikipediaError('Wikipedia 返回了 HTML 而非 JSON（可能被限流或维护中，请稍后重试）');
  }
  if (!res.ok) throw new WikipediaError(`Wikipedia 请求失败（HTTP ${res.status}）`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new WikipediaError('Wikipedia 返回了无法解析的内容');
  }
}

/** 解码 Action API 搜索片段里的 HTML 实体（命名 + 十进制 + 十六进制） */
function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
    const map: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
    if (name) return map[name.toLowerCase()] ?? m;
    const code = dec === undefined ? parseInt(hex, 16) : Number(dec);
    return code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

type ActionSearchRaw = {
  query?: {
    searchinfo?: { totalhits?: number };
    search?: Array<{ title: string; pageid: number; snippet: string; wordcount?: number }>;
  };
};

type ActionExtractsRaw = {
  query?: {
    pages?: Record<string, { pageid?: number; title?: string; extract?: string; missing?: string }>;
  };
};

type RestSummaryRaw = {
  title?: string;
  pageid?: number;
  extract?: string;
  description?: string;
  content_urls?: { desktop?: { page?: string } };
};

/**
 * 关键词检索：返回标题、pageid、摘要片段、词数与总命中数。
 * @param query  关键词（必填）
 * @param opts.language 语言子域（zh / en / ja …，默认 zh）
 * @param opts.limit    请求数量（1-50，服务端超出自动截断 / 非法回退 10）
 */
export async function searchWikipedia(
  query: string,
  opts: { language?: string; limit?: number } = {}
): Promise<{ query: string; language: string; total: number; results: WikipediaSearchItem[] }> {
  const q = query.trim();
  if (!q) throw new WikipediaError('检索关键词不能为空');
  const language = (opts.language ?? 'zh').toLowerCase().trim() || 'zh';
  const limit = Math.max(1, Math.min(Math.trunc(opts.limit ?? 10) || 10, SEARCH_MAX_LIMIT));
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    format: 'json',
    formatversion: '2',
    srsearch: q,
    srlimit: String(limit),
    srprop: 'snippet|wordcount',
  });
  const raw = await fetchJson<ActionSearchRaw>(`${baseUrl(language)}/w/api.php?${params}`);
  const results = (raw.query?.search ?? []).map((r) => ({
    title: r.title,
    pageid: r.pageid,
    // 去掉 <span class="searchmatch"> 高亮标记并解码 HTML 实体
    snippet: decodeEntities(r.snippet.replace(/<[^>]+>/g, '')),
    wordcount: r.wordcount ?? 0,
  }));
  return {
    query: q,
    language,
    total: raw.query?.searchinfo?.totalhits ?? results.length,
    results,
  };
}

/**
 * 文章全文（纯文本）：prop=extracts&explaintext=true 让上游直接返回纯文本（无需 HTML 解析）。
 * 超长正文按 ARTICLE_MAX_CHARS 截断并追加说明，避免一次性返回超大文本。
 * @param title    文章标题（可传别名，redirects=true 自动解析重定向）
 * @param language 语言子域（默认 zh）
 */
export async function fetchWikipediaArticle(
  title: string,
  language = 'zh'
): Promise<{ title: string; pageid?: number; content: string }> {
  const t = title.trim();
  if (!t) throw new WikipediaError('文章标题不能为空');
  const lang = language.toLowerCase().trim() || 'zh';
  const params = new URLSearchParams({
    action: 'query',
    titles: t,
    prop: 'extracts',
    format: 'json',
    formatversion: '2',
    explaintext: 'true',
    exsectionformat: 'wiki',
    redirects: 'true', // 解析别名重定向，如 "NYC" → "New York City"
  });
  const raw = await fetchJson<ActionExtractsRaw>(`${baseUrl(lang)}/w/api.php?${params}`);
  const pages = raw.query?.pages;
  const page = pages && Object.values(pages)[0];
  if (!page || page.missing !== undefined) throw new WikipediaError(`未找到文章：${t}`);
  if (!page.extract) throw new WikipediaError(`文章无可读内容：${t}`);
  let content = page.extract.trim();
  if (content.length > ARTICLE_MAX_CHARS) {
    content = `${content.slice(0, ARTICLE_MAX_CHARS).trimEnd()}\n\n> （文章过长，已截断，可访问 Wikipedia 查看全文）`;
  }
  return { title: page.title ?? t, pageid: page.pageid, content };
}

/**
 * 文章简介（摘要）：使用 Wikipedia REST API（/api/rest_v1/page/summary/{title}），
 * 返回精简的 lead section（通常 1-3 段），适合快速浏览。
 * @param title    文章标题
 * @param language 语言子域（默认 zh）
 */
export async function fetchWikipediaSummary(
  title: string,
  language = 'zh'
): Promise<{ title: string; pageid?: number; content: string; description?: string }> {
  const t = title.trim();
  if (!t) throw new WikipediaError('文章标题不能为空');
  const lang = language.toLowerCase().trim() || 'zh';
  const encoded = encodeURIComponent(t);
  const raw = await fetchJson<RestSummaryRaw>(
    `${baseUrl(lang)}/api/rest_v1/page/summary/${encoded}`
  );
  if (!raw.extract) throw new WikipediaError(`未找到文章：${t}`);
  return {
    title: raw.title ?? t,
    pageid: raw.pageid,
    content: raw.extract.trim(),
    description: raw.description ?? undefined,
  };
}
