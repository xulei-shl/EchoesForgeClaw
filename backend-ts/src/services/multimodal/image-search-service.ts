/**
 * 图片检索服务（多模态工具：Unsplash / Pixabay 图片检索节点 + NASA 图片检索节点）。
 *
 * - Unsplash：Access Key 在 `/admin/settings`（unsplash.access_key）配置。
 *   无关键词默认 `/photos/random`（随机加载最近热门图），有关键词走 `/search/photos`。
 * - Pixabay：API Key 在 `/admin/settings`（pixabay.api_key）配置。
 *   无关键词返回全部图片（order=popular，最热），有关键词走 q 检索。
 * - NASA Images：官方公开图片库（images-api.nasa.gov），无需注册 / 无需 API Key，
 *   全部为公有领域作品。节点两个类别 = 图片库（media_type=image）/ 视频库（media_type=video，
 *   以预览帧图形式展示）。支持关键词检索（留空随机浏览）+ page 分页。
 *
 * 前两家 API 的凭据均由系统设置提供（不在 .env 配置），经路由读取后传入。
 * 返回统一归一化的 ImageSearchItem，前端不感知各家 API 的字段差异。
 */

const UNSPLASH_API = 'https://api.unsplash.com';
const PIXABAY_API = 'https://pixabay.com/api';
/** NASA Images API（官方公开图片库，无需认证）；图片托管域名为 images-assets.nasa.gov。 */
const NASA_IMAGES_API = 'https://images-api.nasa.gov';
/** NASA 图片库详情页（源站页面署名链接，按 nasa_id 拼接）。 */
const NASA_IMAGES_DETAIL_BASE = 'https://images.nasa.gov/details';

/** 外部检索请求超时（ms）：各接口均为轻量 JSON，20s 足够。 */
const SEARCH_TIMEOUT_MS = 20_000;

/** 单页最大条数（Unsplash random 单次上限 30；Pixabay per_page 上限 200；NASA page_size 上限 100）。 */
export const MAX_PER_PAGE = 30;

/** 图片检索外部 API 调用失败（网络 / 响应异常 / 未配置），由路由映射为 502 + detail。 */
export class ImageSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageSearchError';
  }
}

export type ImageSearchProvider = 'unsplash' | 'pixabay' | 'nasa-image' | 'nasa-video';

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
  // NASA Images：官方公开图片库，无需凭据。nasa-image = 图片库，nasa-video = 视频库（预览帧图）
  if (provider === 'nasa-image') return searchNasaImages('image', params);
  return searchNasaImages('video', params);
}

/* ========================================================================= */
/* NASA Images（官方公开图片库：图片 / 视频，无需凭据）                        */
/* ========================================================================= */

/** NASA Images 媒体类型：image = 图片库；video = 视频库（以预览帧图展示）。 */
export type NasaMediaType = 'image' | 'video';

interface NasaLink {
  href?: string;
  rel?: string;
  render?: string;
  width?: number;
  height?: number;
}

interface NasaItem {
  data?: Array<{
    nasa_id?: string;
    title?: string;
    photographer?: string | null;
    secondary_creator?: string | null;
    center?: string | null;
    description?: string;
    media_type?: string;
  }>;
  links?: NasaLink[];
}

interface NasaSearchResponse {
  collection?: {
    metadata?: { total_hits?: number };
    items?: NasaItem[];
  };
}

/** 从资源 links 里按文件名后缀挑选目标尺寸直链（缺失返回空串）。 */
function nasaLinkBySuffix(links: NasaLink[], suffix: string): string {
  return links.find((l) => l.href?.includes(suffix))?.href ?? '';
}

/**
 * 归一化一个 NASA Images 条目：
 * - 缩略图 = ~thumb（搜索接口返回 rel="preview" 即 thumb）；
 * - 预览图 = ~large（无则 ~medium）；
 * - 原图   = ~orig.tif（无则回退 ~large / ~medium）。
 * 搜索接口 links 已含全部尺寸（thumb/medium/large/orig），无需再调 asset 接口。
 */
function toNasaItem(
  item: NasaItem,
  mediaType: NasaMediaType,
  index: number
): ImageSearchItem | null {
  const d = item.data?.[0];
  const links = Array.isArray(item.links) ? item.links : [];
  if (!d || links.length === 0) return null;
  const nasaId = d.nasa_id ?? '';
  const thumbUrl = nasaLinkBySuffix(links, '~thumb');
  const mediumUrl = nasaLinkBySuffix(links, '~medium');
  const largeUrl = nasaLinkBySuffix(links, '~large');
  const origUrl = nasaLinkBySuffix(links, '~orig');
  if (!thumbUrl && !mediumUrl) return null;
  const previewUrl = largeUrl || mediumUrl || thumbUrl;
  const fullUrl = origUrl || previewUrl;
  const dimLink =
    links.find((l) => l.href === previewUrl) ??
    links.find((l) => l.href === mediumUrl) ??
    links.find((l) => l.href === thumbUrl);
  // NASA 可能返回 http:// 链接，统一提升为 https（托管域名支持 HTTPS）
  const toHttps = (u: string) => u.replace(/^http:/, 'https:');
  return {
    id: `nasa-${mediaType}-${nasaId || index}`,
    source: `nasa-${mediaType}`,
    thumbUrl: toHttps(thumbUrl || previewUrl),
    previewUrl: toHttps(previewUrl),
    fullUrl: toHttps(fullUrl),
    width: dimLink?.width ?? 0,
    height: dimLink?.height ?? 0,
    photographer: d.photographer ?? d.secondary_creator ?? d.center ?? 'NASA',
    description: d.title ?? '',
    pageUrl: nasaId ? `${NASA_IMAGES_DETAIL_BASE}/${encodeURIComponent(nasaId)}` : 'https://images.nasa.gov/',
    downloadUrl: toHttps(fullUrl),
  };
}

/**
 * 检索 NASA Images 图片库（media_type=image）或视频库（media_type=video，预览帧图）：
 * - query 为空：不传 q，返回库内默认条目（浏览模式）；
 * - 其余：关键词检索（q），按相关度排序。
 * 全部为公有领域作品，无需 API Key。分页：page 从 1 起，每页 page_size ≤ 100。
 */
export async function searchNasaImages(
  mediaType: NasaMediaType,
  params: ImageSearchParams
): Promise<{ items: ImageSearchItem[]; total: number | null }> {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(Math.max(1, params.perPage ?? 24), MAX_PER_PAGE);
  const query = (params.query ?? '').trim();
  const url = new URL(`${NASA_IMAGES_API}/search`);
  if (query) url.searchParams.set('q', query);
  url.searchParams.set('media_type', mediaType);
  url.searchParams.set('page_size', String(perPage));
  url.searchParams.set('page', String(page));

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
  if (!res.ok) {
    let detail = `NASA Images 请求失败（HTTP ${res.status}）`;
    try {
      const body: any = await res.json();
      const reason = body?.reason ?? body?.message;
      if (typeof reason === 'string' && reason) detail = `NASA Images：${reason}`;
    } catch {
      /* 非 JSON 响应，保留默认信息 */
    }
    throw new ImageSearchError(detail);
  }
  let body: NasaSearchResponse;
  try {
    body = (await res.json()) as NasaSearchResponse;
  } catch {
    throw new ImageSearchError('NASA Images 服务返回了无法解析的内容');
  }
  const items = Array.isArray(body.collection?.items) ? body.collection.items : [];
  const mapped = items
    .map((it, i) => toNasaItem(it, mediaType, i))
    .filter((x): x is ImageSearchItem => x !== null);
  const total = typeof body.collection?.metadata?.total_hits === 'number'
    ? body.collection.metadata.total_hits
    : (mapped.length > 0 ? mapped.length : null);
  return { items: mapped, total };
}
