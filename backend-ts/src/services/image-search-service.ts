/**
 * 图片检索服务（多模态工具：Unsplash / Pixabay 图片检索节点 + NASA 图片检索节点）。
 *
 * - Unsplash：Access Key 在 `/admin/settings`（unsplash.access_key）配置。
 *   无关键词默认 `/photos/random`（随机加载最近热门图），有关键词走 `/search/photos`。
 * - Pixabay：API Key 在 `/admin/settings`（pixabay.api_key）配置。
 *   无关键词返回全部图片（order=popular，最热），有关键词走 q 检索。
 * - NASA APOD（每日天文图）：API Key 在 `/admin/settings`（nasa.api_key，https://api.nasa.gov 免费注册）配置。
 *   留空随机返回 count 张；输入 YYYY-MM-DD 返回该日期；其余按关键词在近 30 天窗口内匹配标题/说明。
 * - NASA EPIC（地球影像）：公开接口，无需凭据。留空随机取一天；输入 YYYY-MM-DD 返回该日期影像。
 *
 * 前两家 API 的凭据均由系统设置提供（不在 .env 配置），经路由读取后传入。
 * 返回统一归一化的 ImageSearchItem，前端不感知各家 API 的字段差异。
 */

const UNSPLASH_API = 'https://api.unsplash.com';
const PIXABAY_API = 'https://pixabay.com/api';
const APOD_API = 'https://api.nasa.gov/planetary/apod';
const EPIC_API = 'https://epic.gsfc.nasa.gov/api';
const EPIC_ARCHIVE = 'https://epic.gsfc.nasa.gov/archive';

/** 外部检索请求超时（ms）：各接口均为轻量 JSON，20s 足够。 */
const SEARCH_TIMEOUT_MS = 20_000;

/** 单页最大条数（Unsplash random 单次上限 30；Pixabay per_page 上限 200；APOD count 上限 100）。 */
export const MAX_PER_PAGE = 30;

/** YYYY-MM-DD 日期格式（NASA 两个接口均按日期浏览）。 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** APOD 关键词检索的近 N 天窗口（APOD 无关键词搜索接口，在窗口内匹配标题/说明）。 */
const APOD_KEYWORD_WINDOW_DAYS = 30;

/** 图片检索外部 API 调用失败（网络 / 响应异常 / 未配置），由路由映射为 502 + detail。 */
export class ImageSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageSearchError';
  }
}

export type ImageSearchProvider = 'unsplash' | 'pixabay' | 'nasa-apod' | 'nasa-epic';

/** 检索结果项（两家 API 归一化后的统一形态） */
export interface ImageSearchItem {
  id: string;
  source: ImageSearchProvider;
  /** 小图（网格缩略图） */
  thumbUrl: string;
  /** 中图（点击查看大图 / 保存到本地作为节点输出） */
  previewUrl: string;
  /** 原图（下载用，可能很大；Pixabay 需完整 API 权限才有） */
  fullUrl: string;
  width: number;
  height: number;
  /** 摄影师 / 作者（署名） */
  photographer: string;
  /** 描述 / 标签 */
  description: string;
  /** 源站页面（署名链接） */
  pageUrl: string;
  /** Unsplash 下载追踪地址（触发下载时需调用，遵守 API Guidelines）；Pixabay 为 null */
  downloadUrl: string | null;
}

export interface ImageSearchParams {
  query?: string;
  page?: number;
  perPage?: number;
}

/* ========================================================================= */
/* Unsplash                                                                   */
/* ========================================================================= */

interface UnsplashPhoto {
  id?: string;
  width?: number;
  height?: number;
  alt_description?: string | null;
  description?: string | null;
  urls?: {
    thumb?: string;
    small?: string;
    regular?: string;
    full?: string;
    raw?: string;
  };
  links?: {
    html?: string;
    download_location?: string;
  };
  user?: {
    name?: string;
  };
}

function toUnsplashItem(p: UnsplashPhoto): ImageSearchItem {
  const urls = p.urls ?? {};
  return {
    id: `unsplash-${p.id ?? ''}`,
    source: 'unsplash',
    thumbUrl: urls.thumb ?? '',
    previewUrl: urls.regular ?? urls.small ?? urls.full ?? '',
    fullUrl: urls.full ?? urls.raw ?? urls.regular ?? '',
    width: p.width ?? 0,
    height: p.height ?? 0,
    photographer: p.user?.name ?? '',
    description: p.alt_description ?? p.description ?? '',
    pageUrl: p.links?.html ?? '',
    downloadUrl: p.links?.download_location ?? null,
  };
}

async function unsplashGet(path: string, accessKey: string): Promise<any> {
  const res = await fetch(`${UNSPLASH_API}${path}`, {
    headers: { Authorization: `Client-ID ${accessKey}` },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    let detail = `Unsplash 请求失败（HTTP ${res.status}）`;
    try {
      const body: any = await res.json();
      const errors = Array.isArray(body?.errors) ? body.errors : [];
      if (errors.length > 0) detail = errors[0];
    } catch {
      /* 非 JSON 响应，保留默认信息 */
    }
    throw new ImageSearchError(detail);
  }
  return res.json();
}

/** 检索 Unsplash 图片；query 为空时走 /photos/random 随机加载。 */
export async function searchUnsplash(
  accessKey: string,
  params: ImageSearchParams
): Promise<{ items: ImageSearchItem[]; total: number | null }> {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(Math.max(1, params.perPage ?? 24), MAX_PER_PAGE);
  const query = (params.query ?? '').trim();

  if (query) {
    // 关键词检索
    const data = await unsplashGet(
      `/search/photos?query=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}&order_by=relevant&content_filter=low`,
      accessKey
    );
    const results: UnsplashPhoto[] = Array.isArray(data?.results) ? data.results : [];
    const totalPages = Number(data?.total_pages ?? 0);
    const total = totalPages > 0 ? totalPages * perPage : (results.length > 0 ? results.length : null);
    return { items: results.map(toUnsplashItem), total };
  }

  // 随机加载（count>1 返回数组；单次上限 30）
  const data = await unsplashGet(
    `/photos/random?count=${perPage}&content_filter=low`,
    accessKey
  );
  const photos: UnsplashPhoto[] = Array.isArray(data) ? data : [];
  return { items: photos.map(toUnsplashItem), total: null };
}

/** 触发 Unsplash 下载追踪（API Guidelines 要求下载时调用；best-effort，失败忽略）。 */
export async function trackUnsplashDownload(accessKey: string, downloadUrl: string): Promise<void> {
  try {
    await fetch(downloadUrl, {
      headers: { Authorization: `Client-ID ${accessKey}` },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
  } catch {
    /* 追踪失败不影响主流程 */
  }
}

/* ========================================================================= */
/* Pixabay                                                                    */
/* ========================================================================= */

interface PixabayHit {
  id?: number;
  pageURL?: string;
  tags?: string;
  previewURL?: string;
  webformatURL?: string;
  largeImageURL?: string;
  fullHDURL?: string;
  imageURL?: string;
  imageWidth?: number;
  imageHeight?: number;
  webformatWidth?: number;
  webformatHeight?: number;
  user?: string;
}

function toPixabayItem(h: PixabayHit): ImageSearchItem {
  return {
    id: `pixabay-${h.id ?? ''}`,
    source: 'pixabay',
    thumbUrl: h.previewURL ?? '',
    previewUrl: h.largeImageURL ?? h.webformatURL ?? '',
    // 原图优先（完整 API 权限才有 imageURL / fullHDURL），否则回退大图
    fullUrl: h.imageURL ?? h.fullHDURL ?? h.largeImageURL ?? h.webformatURL ?? '',
    width: h.imageWidth ?? h.webformatWidth ?? 0,
    height: h.imageHeight ?? h.webformatHeight ?? 0,
    photographer: h.user ?? '',
    description: h.tags ?? '',
    pageUrl: h.pageURL ?? '',
    downloadUrl: null,
  };
}

/** 检索 Pixabay 图片；query 为空返回全部图片（order=popular，最热）。 */
export async function searchPixabay(
  apiKey: string,
  params: ImageSearchParams
): Promise<{ items: ImageSearchItem[]; total: number | null }> {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(Math.max(3, params.perPage ?? 24), 200);
  const query = (params.query ?? '').trim();
  const url = new URL(PIXABAY_API);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(perPage));
  // 图片检索节点只面向照片类素材：限制 photo 类型 + 安全搜索
  url.searchParams.set('image_type', 'photo');
  url.searchParams.set('safesearch', 'true');
  url.searchParams.set('order', 'popular');
  if (query) url.searchParams.set('q', query);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
  if (!res.ok) {
    let detail = `Pixabay 请求失败（HTTP ${res.status}）`;
    try {
      const text = await res.text();
      if (text) detail = text;
    } catch {
      /* 保持默认信息 */
    }
    throw new ImageSearchError(detail);
  }
  let body: { hits?: PixabayHit[]; totalHits?: number };
  try {
    body = (await res.json()) as { hits?: PixabayHit[]; totalHits?: number };
  } catch {
    throw new ImageSearchError('Pixabay 服务返回了无法解析的内容');
  }
  const hits = Array.isArray(body.hits) ? body.hits : [];
  return {
    items: hits.map(toPixabayItem),
    total: typeof body.totalHits === 'number' ? body.totalHits : null,
  };
}

/* ========================================================================= */
/* 统一入口                                                                    */
/* ========================================================================= */

export interface ImageSearchCredentials {
  unsplashAccessKey: string;
  pixabayApiKey: string;
  /** NASA APOD API Key（https://api.nasa.gov 免费注册；EPIC 公开接口不需要） */
  nasaApiKey: string;
}

/** 按 provider 分发检索（未配置凭据时给出明确指引）。 */
export async function searchImages(
  provider: ImageSearchProvider,
  creds: ImageSearchCredentials,
  params: ImageSearchParams
): Promise<{ items: ImageSearchItem[]; total: number | null }> {
  if (provider === 'unsplash') {
    const accessKey = creds.unsplashAccessKey.trim();
    if (!accessKey) {
      throw new ImageSearchError(
        'Unsplash 未配置：请在管理端「系统设置」配置 unsplash.access_key（https://unsplash.com/developers 注册获取）'
      );
    }
    return searchUnsplash(accessKey, params);
  }
  if (provider === 'pixabay') {
    const apiKey = creds.pixabayApiKey.trim();
    if (!apiKey) {
      throw new ImageSearchError(
        'Pixabay 未配置：请在管理端「系统设置」配置 pixabay.api_key（https://pixabay.com/api/docs 获取）'
      );
    }
    return searchPixabay(apiKey, params);
  }
  if (provider === 'nasa-apod') {
    const apiKey = creds.nasaApiKey.trim();
    if (!apiKey) {
      throw new ImageSearchError(
        'NASA APOD 未配置：请在管理端「系统设置」配置 nasa.api_key（https://api.nasa.gov 注册免费获取）'
      );
    }
    return searchApod(apiKey, params);
  }
  // nasa-epic：NASA EPIC 公开接口，无需凭据
  return searchEpic(params);
}

/* ========================================================================= */
/* NASA APOD（每日天文图）                                                     */
/* ========================================================================= */

interface ApodEntry {
  date?: string;
  title?: string;
  explanation?: string;
  url?: string;
  hdurl?: string;
  media_type?: string;
  copyright?: string;
}

function toApodItem(e: ApodEntry): ImageSearchItem {
  const date = e.date ?? '';
  const url = e.url ?? '';
  const hdurl = e.hdurl ?? url;
  // APOD 站点图片页：https://apod.nasa.gov/apod/ap{YY}{MM}{DD}.html
  const pageUrl = date
    ? `https://apod.nasa.gov/apod/ap${date.replace(/-/g, '').slice(2)}.html`
    : 'https://apod.nasa.gov/';
  return {
    id: `nasa-apod-${date}`,
    source: 'nasa-apod',
    thumbUrl: url,
    previewUrl: url,
    fullUrl: hdurl || url,
    width: 0,
    height: 0,
    photographer: e.copyright ? `© ${e.copyright}` : 'NASA',
    description: e.title ?? '',
    pageUrl,
    downloadUrl: hdurl || url,
  };
}

function apodMatches(e: ApodEntry, q: string): boolean {
  return `${e.title ?? ''} ${e.explanation ?? ''}`.toLowerCase().includes(q);
}

/** 调用 APOD 接口：date 单条返回对象，count / 日期范围返回数组。 */
async function apodGet(url: URL): Promise<ApodEntry | ApodEntry[]> {
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
  if (!res.ok) {
    let detail = `NASA APOD 请求失败（HTTP ${res.status}）`;
    try {
      const body: any = await res.json();
      const msg = body?.error?.message ?? body?.msg;
      if (typeof msg === 'string' && msg) detail = `NASA APOD：${msg}`;
    } catch {
      /* 非 JSON 响应，保留默认信息 */
    }
    throw new ImageSearchError(detail);
  }
  return res.json() as Promise<ApodEntry | ApodEntry[]>;
}

/**
 * 检索 NASA APOD 图片：
 * - query 为空：随机 count 张（count 上限 100，实际按每页条数取）；
 * - query 为 YYYY-MM-DD：该日期的一张 APOD；
 * - 其余：按关键词在近 30 天窗口内匹配标题 / 说明（NASA 无关键词检索接口，视频条目过滤）。
 */
export async function searchApod(
  apiKey: string,
  params: ImageSearchParams
): Promise<{ items: ImageSearchItem[]; total: number | null }> {
  const perPage = Math.min(Math.max(1, params.perPage ?? 24), MAX_PER_PAGE);
  const query = (params.query ?? '').trim();
  const url = new URL(APOD_API);
  url.searchParams.set('api_key', apiKey);

  if (query) {
    if (DATE_RE.test(query)) {
      // 指定日期
      url.searchParams.set('date', query);
      const data = await apodGet(url);
      const list = Array.isArray(data) ? data : [data];
      const items = list.filter((e) => e?.media_type === 'image').map(toApodItem);
      return { items, total: items.length > 0 ? items.length : null };
    }
    // 关键词：近 30 天窗口内匹配标题 / 说明
    const end = new Date();
    const start = new Date(end.getTime() - APOD_KEYWORD_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    url.searchParams.set('start_date', fmt(start));
    url.searchParams.set('end_date', fmt(end));
    const data = await apodGet(url);
    const list = Array.isArray(data) ? data : [data];
    const q = query.toLowerCase();
    const items = list
      .filter((e) => e?.media_type === 'image' && apodMatches(e, q))
      .map(toApodItem);
    return { items, total: items.length };
  }

  // 随机浏览
  url.searchParams.set('count', String(perPage));
  const data = await apodGet(url);
  const list = Array.isArray(data) ? data : [data];
  const items = list.filter((e) => e?.media_type === 'image').map(toApodItem);
  return { items, total: null };
}

/* ========================================================================= */
/* NASA EPIC（地球影像）                                                       */
/* ========================================================================= */

interface EpicEntry {
  identifier?: string;
  image?: string;
  date?: string;
  caption?: string;
}

/** 从 EPIC 元数据（date 形如 "2026-08-15 00:41:06"）拼装归档图片地址（natural 系列）。 */
function toEpicItem(e: EpicEntry): ImageSearchItem {
  const image = e.image ?? e.identifier ?? '';
  const date = e.date ?? '';
  const ymd = date.slice(0, 10); // YYYY-MM-DD
  const [y, m, d] = ymd.split('-');
  const base = `${EPIC_ARCHIVE}/natural/${y}/${m}/${d}`;
  return {
    id: `nasa-epic-${e.identifier ?? image}`,
    source: 'nasa-epic',
    thumbUrl: `${base}/thumbs/${image}.jpg`,
    previewUrl: `${base}/jpg/${image}.jpg`,
    fullUrl: `${base}/png/${image}.png`,
    width: 2048,
    height: 2048,
    photographer: 'NASA EPIC / DSCOVR',
    description: e.caption ? `${e.caption}（${ymd}）` : ymd,
    pageUrl: 'https://epic.gsfc.nasa.gov/',
    downloadUrl: null,
  };
}

async function epicGet(path: string): Promise<any> {
  const res = await fetch(`${EPIC_API}${path}`, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new ImageSearchError(`NASA EPIC 请求失败（HTTP ${res.status}）`);
  }
  return res.json();
}

/**
 * 检索 NASA EPIC 地球影像（公开接口，无需凭据）：
 * - query 为空：随机取一天（/natural/available 中随机选日期）；
 * - query 为 YYYY-MM-DD：该日期影像；
 * - 其他：EPIC 不支持关键词检索，给出明确指引。
 */
export async function searchEpic(
  params: ImageSearchParams
): Promise<{ items: ImageSearchItem[]; total: number | null }> {
  const query = (params.query ?? '').trim();
  let date: string;
  if (!query) {
    const dates = await epicGet('/natural/available');
    if (!Array.isArray(dates) || dates.length === 0) {
      throw new ImageSearchError('NASA EPIC 暂无可用影像数据，请稍后重试');
    }
    date = dates[Math.floor(Math.random() * dates.length)];
  } else if (DATE_RE.test(query)) {
    date = query;
  } else {
    throw new ImageSearchError('NASA EPIC 不支持关键词检索：请输入日期（YYYY-MM-DD）或留空随机浏览');
  }

  let data: any;
  try {
    data = await epicGet(`/natural/date/${date}`);
  } catch {
    throw new ImageSearchError(`NASA EPIC 该日期（${date}）暂无影像，请尝试其他日期或留空随机浏览`);
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new ImageSearchError(`NASA EPIC 该日期（${date}）暂无影像，请尝试其他日期或留空随机浏览`);
  }
  return { items: data.map(toEpicItem), total: data.length };
}
