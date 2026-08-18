import { curlFetch, fetchWithProxy } from './http-proxy.js';

/**
 * 博物馆图片检索服务（GLAM 工具：艺术图片检索节点）。
 *
 * 集成 museo-main（docs/GLAM/museo-main）聚合的 13 家博物馆 / 图书馆开放 API
 * （含美国国会图书馆 LoC，对接说明见 docs/GLAM/loc-api），
 * 每张图均为公有领域 / CC0 作品，检索与图片均免费使用（署名来源机构更佳）。
 *
 * 凭据来源（在 /admin/settings「系统设置」配置，未配置的源自动跳过）：
 * - harvard.api_key      Harvard Art Museums（https://harvardartmuseums.org/collections/api）
 * - nypl.api_key         NYPL Digital Collections（https://api.repo.nypl.org/）
 * - smithsonian.api_key  Smithsonian Open Access（https://api.data.gov/signup/）
 * - paris.api_key        Paris Musées（https://www.parismusees.paris.fr/fr/les-collections-en-ligne/lapi-collections）
 * - europeana.api_key    Europeana（https://apis.europeana.eu/en/apis）
 *
 * 无需凭据的源：大都会（MET）/ 荷兰国立（Rijksmuseum）/ 芝加哥艺术学院（AIC）/
 * 明尼阿波利斯美术馆（MIA）/ 克利夫兰美术馆 / 丹麦国立美术馆（SMK）/ Wellcome 收藏 /
 * 美国国会图书馆（LoC，需在「系统设置」配置 loc.proxy 代理出网）。
 *
 * 随机检索：关键词为空时各源尽力返回随机一批作品（MET 从全量 Object ID 中随机抽样，
 * 其余源取随机页 / 浏览全量），与图片检索节点「无关键词默认随机」交互一致。
 * 返回统一归一化的 GlamSearchItem，前端不感知各家 API 的字段差异。
 */

/** 外部检索请求超时（ms）：与图片检索一致。 */
const SEARCH_TIMEOUT_MS = 20_000;

/** 单源单批最大条数（部分源单次请求上限 100 / 60）。 */
export const MAX_PER_PAGE = 30;

/** 博物馆图片检索外部 API 调用失败，由路由映射为 502 + detail。 */
export class GlamSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GlamSearchError';
  }
}

export type GlamProvider =
  | 'met'
  | 'rijks'
  | 'ai-chicago'
  | 'artsmia'
  | 'cleveland'
  | 'smk'
  | 'wellcome'
  | 'harvard'
  | 'nypl'
  | 'smithsonian'
  | 'paris'
  | 'europeana'
  | 'loc';

/** 检索结果项（与 ImageSearchItem 同形，便于前端复用交互；downloadUrl 恒为 null，博物馆无需下载追踪） */
export interface GlamSearchItem {
  id: string;
  source: GlamProvider;
  /** 小图（网格缩略图） */
  thumbUrl: string;
  /** 中图（点击查看大图 / 保存到本地作为节点输出） */
  previewUrl: string;
  /** 原图（IIIF 可推导时尽量给大尺寸；否则与 previewUrl 相同） */
  fullUrl: string;
  width: number;
  height: number;
  /** 艺术家 / 作者（署名；多数源未提供，回退标题） */
  photographer: string;
  /** 作品标题（描述） */
  description: string;
  /** 源站作品页（署名链接） */
  pageUrl: string;
  downloadUrl: null;
}

export interface GlamSearchParams {
  query?: string;
  /** 随机抽样条数上限（默认 30） */
  limit?: number;
  /** 关键词检索的分页偏移（0 起；无关键词随机模式下忽略） */
  offset?: number;
}

/** 检索结果（含是否可能还有更多，供前端「加载更多」）。 */
export interface GlamSearchResult {
  items: GlamSearchItem[];
  /** 关键词检索且来源支持分页时，是否还有更多可继续拉取 */
  hasMore: boolean;
}

/** 无可靠分页的来源：Rijks（单批上限 24、检索接口无分页）、Paris（GraphQL 不支持 offset），
 *  这两个源不参与「加载更多」。 */
const NO_PAGINATION_PROVIDERS: GlamProvider[] = ['rijks', 'paris'];


export interface GlamCredentials {
  harvardApiKey: string;
  nyplApiKey: string;
  smithsonianApiKey: string;
  parisApiKey: string;
  europeanaApiKey: string;
  /** LoC 检索 HTTP 代理（如 http://127.0.0.1:7890；空 = 直连）。 */
  locProxy: string;
}

/** 各源展示名（前端来源下拉 / 署名展示） */
export const GLAM_PROVIDER_LABELS: Record<GlamProvider, string> = {
  met: '大都会艺术博物馆 (MET)',
  rijks: '荷兰国立博物馆 (Rijksmuseum)',
  'ai-chicago': '芝加哥艺术学院 (AIC)',
  artsmia: '明尼阿波利斯美术馆 (MIA)',
  cleveland: '克利夫兰美术馆',
  smk: '丹麦国立美术馆 (SMK)',
  wellcome: 'Wellcome 收藏',
  harvard: '哈佛艺术博物馆',
  nypl: '纽约公共图书馆 (NYPL)',
  smithsonian: '史密森尼学会',
  paris: '巴黎博物馆 (Paris Musées)',
  europeana: 'Europeana',
  loc: '美国国会图书馆 (LoC)',
};

/** 需要凭据的源 → 设置键（错误提示用） */
const KEYED_PROVIDERS: Partial<Record<GlamProvider, { key: string; url: string }>> = {
  harvard: { key: 'harvard.api_key', url: 'https://harvardartmuseums.org/collections/api' },
  nypl: { key: 'nypl.api_key', url: 'https://api.repo.nypl.org/' },
  smithsonian: { key: 'smithsonian.api_key', url: 'https://api.data.gov/signup/' },
  paris: { key: 'paris.api_key', url: 'https://www.parismusees.paris.fr/fr/les-collections-en-ligne/lapi-collections' },
  europeana: { key: 'europeana.api_key', url: 'https://apis.europeana.eu/en/apis' },
};

/** 全部 12 家来源（「全部来源」聚合检索按此顺序并发拉取）。 */
const ALL_PROVIDERS: GlamProvider[] = [
  'met',
  'rijks',
  'ai-chicago',
  'artsmia',
  'cleveland',
  'smk',
  'wellcome',
  'harvard',
  'nypl',
  'smithsonian',
  'paris',
  'europeana',
  'loc',
];

/** 聚合检索（provider='all'）统一显示名（路由 label 用）。 */
export const GLAM_ALL_LABEL = '全部来源（13 家博物馆聚合）';

/** 取某源已配置的 API Key（无需凭据或未配置返回空串）。 */
function apiKeyOf(provider: GlamProvider, creds: GlamCredentials): string {
  const keyed = KEYED_PROVIDERS[provider];
  if (!keyed) return '';
  return (keyed.key === 'harvard.api_key' ? creds.harvardApiKey
    : keyed.key === 'nypl.api_key' ? creds.nyplApiKey
    : keyed.key === 'smithsonian.api_key' ? creds.smithsonianApiKey
    : keyed.key === 'paris.api_key' ? creds.parisApiKey
    : creds.europeanaApiKey).trim();
}

/** 可用来源（provider='all' 聚合与前端来源下拉共用）：免凭据源 + 已配置 Key 的凭据源。 */
export function availableGlamProviders(creds: GlamCredentials): GlamProvider[] {
  return ALL_PROVIDERS.filter((p) => !KEYED_PROVIDERS[p] || apiKeyOf(p, creds) !== '');
}

/** 带超时的 JSON 请求（非 2xx 抛 GlamSearchError） */
async function jsonGet(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new GlamSearchError(`请求失败（HTTP ${res.status}）`);
  }
  return res.json();
}

/** IIIF 尺寸推导：把 `/full/xxx,/` 之类的尺寸段替换为缩略 / 原图尺寸；非 IIIF 链接原样返回。 */
function iiifVariant(url: string, variant: 'thumb' | 'full'): string {
  if (!url) return url;
  const sized = url.replace(/\/full\/[^/]+(\/0\/)/, (m, suffix) => `/full/${variant === 'thumb' ? '300,' : 'max'}${suffix}`);
  if (sized !== url) return sized;
  return url;
}

function toItem(source: GlamProvider, title: string, image: string, pageUrl: string, artist = ''): GlamSearchItem | null {
  if (!title || !image) return null;
  return {
    id: `${source}-${encodeURIComponent(image)}`,
    source,
    thumbUrl: iiifVariant(image, 'thumb'),
    previewUrl: image,
    fullUrl: iiifVariant(image, 'full'),
    width: 0,
    height: 0,
    photographer: artist,
    description: title,
    pageUrl: pageUrl || '',
    downloadUrl: null,
  };
}

/** 各源搜索 / 随机实现（返回已过滤公有领域 + 有图的作品列表） */

async function searchMet(query: string, limit: number, offset: number): Promise<GlamSearchItem[]> {
  if (query) {
    const json = await jsonGet(
      `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(query)}&hasImages=true`
    );
    // 分页：MET 检索一次性返回全部 objectID，按 offset 切片取下一批
    const ids: number[] = Array.isArray(json.objectIDs) ? json.objectIDs.slice(offset, offset + MAX_PER_PAGE * 2) : [];
    const objects = await Promise.allSettled(
      ids.map(async (id) => jsonGet(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`))
    );
    return objects
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((o) => o.isPublicDomain && o.primaryImageSmall)
      .slice(0, limit)
      .map((o) =>
        toItem(
          'met',
          o.title,
          o.primaryImageSmall,
          o.objectURL,
          o.artistDisplayName || o.artistAlphaSort || ''
        )
      )
      .filter((i): i is GlamSearchItem => i !== null);
  }
  // 随机：从全量 Object ID 抽样（每张图一次请求，控制并发与条数）
  const all = await jsonGet('https://collectionapi.metmuseum.org/public/collection/v1/objects');
  const ids: number[] = Array.isArray(all.objectIDs) ? all.objectIDs : [];
  const picked: number[] = [];
  for (let i = 0; i < ids.length && picked.length < limit * 3; i++) {
    const id = ids[Math.floor(Math.random() * ids.length)];
    if (id != null) picked.push(id);
  }
  const objects = await Promise.allSettled(
    [...new Set(picked)].slice(0, MAX_PER_PAGE * 3).map(async (id) =>
      jsonGet(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`)
    )
  );
  return objects
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((o) => o.isPublicDomain && o.primaryImageSmall)
    .slice(0, limit)
    .map((o) =>
      toItem('met', o.title, o.primaryImageSmall, o.objectURL, o.artistDisplayName || '')
    )
    .filter((i): i is GlamSearchItem => i !== null);
}

// Rijksmuseum 新一代 Linked Art API：检索只回 Object ID，每件作品需 2~3 次子请求
const RIJKS_OBJECT_CAP = 24;

async function searchRijks(query: string, limit: number): Promise<GlamSearchItem[]> {
  const fields = query ? ['title', 'description'] : [];
  const searches = await Promise.allSettled(
    fields.map((field) =>
      jsonGet(
        `https://data.rijksmuseum.nl/search/collection?${field}=${encodeURIComponent(query)}&imageAvailable=true`
      )
    )
  );
  const ids = [
    ...new Set(
      searches
        .filter((r) => r.status === 'fulfilled')
        .flatMap((r) => (Array.isArray(r.value?.orderedItems) ? r.value.orderedItems.map((x: any) => x.id) : []))
    ),
  ].slice(0, RIJKS_OBJECT_CAP);

  const visualItemUrl = (url: string) => url.replace('id.rijksmuseum.nl/200', 'id.rijksmuseum.nl/202');
  const getImage = async (objectUrl: string): Promise<string | null> => {
    try {
      const visual = await jsonGet(visualItemUrl(objectUrl), { headers: { Accept: 'application/ld+json' } });
      const digitalId = visual.digitally_shown_by?.[0]?.id;
      if (!digitalId) return null;
      const digital = await jsonGet(digitalId, { headers: { Accept: 'application/ld+json' } });
      const imageUrl = digital.access_point?.[0]?.id;
      return imageUrl ? imageUrl.replace('/full/max/', '/full/800,/') : null;
    } catch {
      return null;
    }
  };

  const objects = await Promise.allSettled(
    ids.map(async (id: string) => {
      try {
        const object = await jsonGet(id, { headers: { Accept: 'application/ld+json' } });
        const isPublic = JSON.stringify(object.subject_of || '').includes('creativecommons.org/publicdomain');
        if (!isPublic) return null;
        const image = await getImage(id);
        if (!image) return null;
        const name = (object.identified_by || []).find((x: any) => x.type === 'Name');
        const webPage =
          (object.subject_of || [])
            .flatMap((s: any) => s.digitally_carried_by || [])
            .find((c: any) => c.format === 'text/html' && c.access_point?.[0])?.access_point?.[0]?.id || id;
        return toItem('rijks', name?.content || '', image, webPage);
      } catch {
        return null;
      }
    })
  );
  return objects
    .filter((r): r is PromiseFulfilledResult<GlamSearchItem | null> => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value as GlamSearchItem)
    .slice(0, limit);
}

// 芝加哥艺术学院：全文检索（is_public_domain 客户端过滤）；随机取浏览列表随机页
async function searchAiChicago(query: string, limit: number, offset: number): Promise<GlamSearchItem[]> {
  const IMAGE_URL = (id: string) => `https://www.artic.edu/iiif/2/${id}/full/843,/0/default.jpg`;
  const shape = (data: any[]): GlamSearchItem[] =>
    data
      .filter((item) => item.is_public_domain && item.image_id && item._score > 0.5)
      .map((item) =>
        toItem('ai-chicago', item.title || '', IMAGE_URL(item.image_id), `https://www.artic.edu/artworks/${item.id}`)
      )
      .filter((i): i is GlamSearchItem => i !== null);

  if (query) {
    // 分页：AIC 每页最多 100 条，页 = offset/100 + 1，页内从 offset%100 起切片
    const page = Math.floor(offset / 100) + 1;
    const within = offset % 100;
    const json = await jsonGet(
      `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(query)}&limit=100&page=${page}&fields=title,image_id,id,is_public_domain,_score`
    );
    let items = shape(json.data ?? []);
    const last = (json.data ?? [])[json.data.length - 1];
    // 首页尾条分数仍高且有下一页时再拉一页补足（与原来的页 2 增强逻辑一致）
    if (page === 1 && last && last._score > 0.5 && json.pagination?.total_pages > page) {
      const json2 = await jsonGet(
        `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(query)}&limit=100&page=${page + 1}&fields=title,image_id,id,is_public_domain,_score`
      );
      items = items.concat(shape(json2.data ?? []));
    }
    return items.slice(within, within + limit);
  }
  // 随机：浏览列表随机页（作品约 10 万件，页 1..100）
  const page = 1 + Math.floor(Math.random() * 100);
  const json = await jsonGet(
    `https://api.artic.edu/api/v1/artworks?page=${page}&limit=100&fields=title,image_id,id,is_public_domain`
  );
  return shape((json.data ?? []).map((d: any) => ({ ...d, _score: 1 }))).slice(0, limit);
}

// 明尼阿波利斯美术馆：Elasticsearch 接口（query 为空 = 全量公有领域有图作品）
async function searchArtsmia(query: string, limit: number, offset: number): Promise<GlamSearchItem[]> {
  const IMAGE_URL = (id: string) => `https://${Number(id) % 7}.api.artsmia.org/800/${id}.jpg`;
  const q = `${query} rights_type:"Public Domain" image:valid`.trim();
  const json = await jsonGet(
    `https://search.artsmia.org/${encodeURIComponent(q)}?size=${Math.min(limit * 3, 300)}&from=${offset}`
  );
  return (json.hits?.hits ?? [])
    .filter((item: any) => item._score > 0.5)
    .map((item: any) =>
      toItem('artsmia', item._source?.title || '', IMAGE_URL(item._id), `https://collections.artsmia.org/art/${item._id}`)
    )
    .filter((i: any): i is GlamSearchItem => i !== null)
    .slice(0, limit);
}

// 克利夫兰美术馆：cc0 + 有图；随机 = 随机 skip 偏移浏览
async function searchCleveland(query: string, limit: number, offset: number): Promise<GlamSearchItem[]> {
  // 分页：关键词检索时 skip = offset；随机浏览时随机 skip 偏移
  const skip = query ? offset : Math.floor(Math.random() * 500) * 100;
  const json = await jsonGet(
    `https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(query)}&has_image=1&limit=${Math.min(limit * 3, 100)}&cc0=1&skip=${skip}`
  );
  return (json.data ?? [])
    .filter((item: any) => item.images?.web?.url)
    .map((item: any) =>
      toItem('cleveland', item.title || '', item.images.web.url, item.url || '')
    )
    .filter((i: any): i is GlamSearchItem => i !== null)
    .slice(0, limit);
}

// 丹麦国立美术馆（SMK）：公有领域 + 有图；随机 = keys=* 全量
async function searchSmk(query: string, limit: number, offset: number): Promise<GlamSearchItem[]> {
  const keys = query || '*';
  const json = await jsonGet(
    `https://api.smk.dk/api/v1/art/search?keys=${encodeURIComponent(keys)}&filters=%5Bpublic_domain%3Atrue%5D,%5Bhas_image%3Atrue%5D&rows=${Math.min(limit * 3, 100)}&offset=${offset}`
  );
  return (json.items ?? [])
    .filter((item: any) => item.image_thumbnail && item.titles?.[0]?.title)
    .map((item: any) =>
      toItem(
        'smk',
        item.titles[0].title,
        item.image_thumbnail,
        `https://open.smk.dk/en/artwork/image/${item.object_number}`
      )
    )
    .filter((i: any): i is GlamSearchItem => i !== null)
    .slice(0, limit);
}

// Wellcome 收藏：CC0 / PDM 图像；随机 = 无关键词全量
async function searchWellcome(query: string, limit: number, offset: number): Promise<GlamSearchItem[]> {
  const IMAGE_URL = (infoUrl: string) => infoUrl.replace('/info.json', '/full/!760,760/0/default.jpg');
  const pageSize = Math.min(limit * 3, 100);
  const page = Math.floor(offset / pageSize) + 1;
  const json = await jsonGet(
    `https://api.wellcomecollection.org/catalogue/v2/images?${query ? `query=${encodeURIComponent(query)}&` : ''}locations.license=cc0,pdm&pageSize=${pageSize}&page=${page}`
  );
  return (json.results ?? [])
    .filter((item: any) => item.thumbnail?.url && item.source?.title)
    .map((item: any) =>
      toItem('wellcome', item.source.title, IMAGE_URL(item.thumbnail.url), `https://wellcomecollection.org/works/${item.source.id}`)
    )
    .filter((i: any): i is GlamSearchItem => i !== null)
    .slice(0, limit);
}

// 哈佛艺术博物馆（需 harvard.api_key）
async function searchHarvard(apiKey: string, query: string, limit: number, offset: number): Promise<GlamSearchItem[]> {
  const size = Math.min(limit * 3, 100);
  const page = Math.floor(offset / size) + 1;
  const json = await jsonGet(
    `https://api.harvardartmuseums.org/object?apikey=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&hasimage=1&size=${size}&page=${page}`
  );
  return (json.records ?? [])
    .filter((item: any) => Array.isArray(item.images) && item.images.length > 0)
    .map((item: any) => {
      const imgs = item.images.filter((i: any) => i.baseimageurl);
      const image = imgs.length ? imgs[imgs.length - 1].baseimageurl : null;
      return image ? toItem('harvard', item.title || '', image, item.url || '') : null;
    })
    .filter((i: any): i is GlamSearchItem => i !== null)
    .slice(0, limit);
}

// 纽约公共图书馆（需 nypl.api_key）
async function searchNypl(apiKey: string, query: string, limit: number, offset: number): Promise<GlamSearchItem[]> {
  // 注意：必须用 https。api.repo.nypl.org 对 http 返回 301 跳转 https，跨源跳转时 fetch 会剥掉
  // Authorization 头导致 401（token 本身有效）。images.nypl.org 同样仅用 https。
  const IMAGE_URL = (id: string) => `https://images.nypl.org/index.php?id=${id}&t=w`;
  const perPage = Math.min(limit * 3, 100);
  const page = Math.floor(offset / perPage) + 1;
  const json = await jsonGet(
    `https://api.repo.nypl.org/api/v2/items/search?q=${encodeURIComponent(query)}&publicDomainOnly=true&per_page=${perPage}&page=${page}`,
    { headers: { Authorization: `Token token="${apiKey}"` } }
  );
  const result = json?.nyplAPI?.response?.result;
  const list = Array.isArray(result) ? result : result ? [result] : [];
  return list
    .map((item: any) =>
      item?.imageID ? toItem('nypl', item.title || '', IMAGE_URL(item.imageID), item.itemLink || '') : null
    )
    .filter((i: any): i is GlamSearchItem => i !== null)
    .slice(0, limit);
}

// 史密森尼学会（需 smithsonian.api_key）
async function searchSmithsonian(apiKey: string, query: string, limit: number, offset: number): Promise<GlamSearchItem[]> {
  const IMAGE_URL = (mediaUrl: string) => `${mediaUrl}&max_w=800`;
  const json = await jsonGet(
    `https://api.si.edu/openaccess/api/v1.0/search?q=${encodeURIComponent(query)}%20AND%20online_media_type:%22Images%22%20AND%20media_usage:%22CC0%22&api_key=${encodeURIComponent(apiKey)}&rows=${Math.min(limit * 3, 100)}&start=${offset}`
  );
  return (json?.response?.rows ?? [])
    .map((item: any) => {
      const record = item?.content?.descriptiveNonRepeating;
      const media = record?.online_media?.media;
      const image = media?.[0]?.content;
      return image
        ? toItem('smithsonian', item.title || '', IMAGE_URL(image), record?.record_link || record?.guid || '')
        : null;
    })
    .filter((i: any): i is GlamSearchItem => i !== null)
    .slice(0, limit);
}

// 巴黎博物馆（需 paris.api_key）
async function searchParis(apiKey: string, query: string, limit: number): Promise<GlamSearchItem[]> {
  const gql = (term: string) => `{
    nodeQuery(
      filter: {
        conditions: [
          {field: "title", value: "%${term.replace(/[\\\\"%]/g, '')}%", operator: LIKE},
          {field: "type", value: "oeuvre"},
          {field: "field_visuels", operator: IS_NOT_NULL},
          {field: "field_visuels.entity.field_image_libre", value: "1"}
        ]
      },
      limit: ${Math.min(limit * 3, 100)}
    ) {
      entities {
        ... on NodeOeuvre {
          title
          url: absolutePath
          fieldVisuels { entity { url: publicUrl } }
        }
      }
    }
  }`;
  const res = await fetch('http://apicollections.parismusees.paris.fr/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'auth-token': apiKey },
    body: JSON.stringify({ query: gql(query) }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new GlamSearchError(`Paris Musées 请求失败（HTTP ${res.status}）`);
  const json: any = await res.json();
  return (json?.data?.nodeQuery?.entities ?? [])
    .map((item: any) => {
      const visuel = item?.fieldVisuels?.[0]?.entity;
      return item?.title && visuel?.url ? toItem('paris', item.title, visuel.url, item.url || '') : null;
    })
    .filter((i: any): i is GlamSearchItem => i !== null)
    .slice(0, limit);
}

// Europeana（需 europeana.api_key）
async function searchEuropeana(apiKey: string, query: string, limit: number, offset: number): Promise<GlamSearchItem[]> {
  // Europeana 的 start 从 1 开始
  const json = await jsonGet(
    `https://api.europeana.eu/record/v2/search.json?wskey=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&qf=TYPE:IMAGE&reusability=open&media=true&thumbnail=true&rows=${Math.min(limit * 3, 100)}&start=${offset + 1}`
  );
  return (json?.items ?? [])
    .filter((item: any) => item.title?.[0] && item.edmPreview?.[0])
    .map((item: any) =>
      toItem('europeana', item.title[0], item.edmPreview[0], item.guid || '')
    )
    .filter((i: any): i is GlamSearchItem => i !== null)
    .slice(0, limit);
}

// 美国国会图书馆（LoC）：无需凭据。JSON API 官方限流 20 次/分钟（建议 ≤15），
// 重查询（全文索引）响应可能超过 20s，超时单独放宽（前端 30s 上限内）。
const LOC_SEARCH_TIMEOUT_MS = 28_000;
const LOC_RATE_PER_MIN = 15;

/** LoC JSON API 令牌桶限流（15 次/分钟，留 25% 余量）。 */
class LocTokenBucket {
  private tokens = LOC_RATE_PER_MIN;
  private last = Date.now();
  private readonly rate = LOC_RATE_PER_MIN / 60_000;

  async take(): Promise<void> {
    const now = Date.now();
    this.tokens = Math.min(LOC_RATE_PER_MIN, this.tokens + (now - this.last) * this.rate);
    this.last = now;
    if (this.tokens < 1) {
      await new Promise((r) => setTimeout(r, (1 - this.tokens) / this.rate));
      return this.take();
    }
    this.tokens -= 1;
  }
}
const locBucket = new LocTokenBucket();

/**
 * LoC 影像类原始格式过滤。只取静态影像（照片/印刷品/绘画）：
 * 文档推荐的 OR 表达式（含胶片/视频）在 sp>1 时会把分面丢成只剩一个、且分页 total 失真
 * （实测 page 2 偶发 404），对「艺术图片检索」节点本就不需要视频帧；单分面分页稳定。
 */
const LOC_FA = 'original-format:photo, print, drawing';
/** 只请求需要的字段，减小响应体积（at 参数）。 */
const LOC_AT =
  'results,results.title,results.image_url,results.url,results.id,results.contributor,results.creator,results.description,results.date,pagination';

/** LoC 字段取值：可能是 string / string[] / 缺失，一律取首个字符串。 */
function locField(r: any, field: string): string {
  const v = r?.[field];
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return String(v[0]);
  return '';
}

/** LoC 图片变体：image_url 数组按尺寸升序（如 150px → 640 → 1024），取最小做缩略图、最大做预览。 */
function locImageVariants(r: any): { thumb: string; preview: string } | null {
  const iu = r?.image_url;
  if (iu == null) return null;
  const urls = (Array.isArray(iu) ? iu : [iu]).filter(
    (u: unknown): u is string => typeof u === 'string' && u.startsWith('http')
  );
  if (!urls.length) return null;
  return { thumb: urls[0]!, preview: urls[urls.length - 1]! };
}

// 美国国会图书馆（LoC）：无需凭据；检索静态影像（照片/印刷品/绘画，见 LOC_FA）。
// 随机浏览（空关键词）= 无 q 检索 + 随机页；分页：c=每页条数、sp=页（offset 换算），
// 用「拉满整页」判断是否还有更多（与其余各源口径一致）。

/** LoC 请求 UA：可识别的自定义 UA（undici 与 curl 回退共用；实测可正常通过反爬）。 */
const LOC_UA = 'bookforge-glam/0.1 (art image search)';

/**
 * LoC JSON API 请求：undici 优先，命中 Cloudflare 反爬（403/503 + HTML challenge，
 * undici 的 TLS 指纹被识别；CONNECT 代理不改变客户端指纹，代理下同样会命中）时回退 curl。
 */
async function fetchLocJson(url: string, proxy: string): Promise<any> {
  const res = await fetchWithProxy(
    url,
    {
      headers: { 'User-Agent': LOC_UA },
      signal: AbortSignal.timeout(LOC_SEARCH_TIMEOUT_MS),
    },
    proxy
  );
  const ct = res.headers.get('content-type') ?? '';
  if (res.ok && ct.includes('json')) {
    return res.json();
  }
  if (res.status === 429) throw new GlamSearchError('LoC 检索触发限流（429），请稍后重试');
  // 注意：不要用浏览器 UA —— curl 的 TLS 指纹与浏览器 UA 不匹配反而更易被 CF 拦截；
  // 实测可识别的自定义 UA（如 bookforge-glam）能正常通过（与 LoC 官方建议一致）
  const cr = await curlFetch(url, { proxy, timeoutMs: LOC_SEARCH_TIMEOUT_MS, userAgent: LOC_UA });
  if (cr.status === 429) throw new GlamSearchError('LoC 检索触发限流（429），请稍后重试');
  if (cr.status !== 200 || !cr.contentType.includes('json')) {
    // 403/503 + HTML = Cloudflare 反爬 challenge；其余（302/404/500 等）多为 LoC 限流/重定向异常，提示重试
    const hint =
      (cr.status === 403 || cr.status === 503) && cr.contentType.includes('html')
        ? '：疑似触发 Cloudflare 反爬，请确认服务器出口网络可访问 loc.gov（或检查系统设置 loc.proxy）'
        : '：LoC 服务端异常或限流，请稍后重试';
    throw new GlamSearchError(`LoC 检索失败（HTTP ${cr.status}）${hint}`);
  }
  const parse = (bytes: Uint8Array): any | null => {
    try {
      return JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
      return null;
    }
  };
  const json = parse(cr.body);
  if (json) return json;
  // LoC 慢查询可能被 --max-time 截断（响应不完整）：同参数重试一次
  const cr2 = await curlFetch(url, { proxy, timeoutMs: LOC_SEARCH_TIMEOUT_MS, userAgent: LOC_UA });
  const json2 = cr2.status === 200 && cr2.contentType.includes('json') ? parse(cr2.body) : null;
  if (json2) return json2;
  throw new GlamSearchError('LoC 检索返回异常（响应不完整或超时），请重试');
}

async function searchLoc(query: string, limit: number, offset: number, proxy: string): Promise<GlamSearchItem[]> {
  await locBucket.take();
  const c = Math.min(Math.max(limit * 3, 3), 100);
  let sp: number;
  let within = 0;
  if (query) {
    sp = Math.floor(offset / c) + 1;
    within = offset % c;
  } else {
    // 随机浏览：全量影像约百万级，随机页 1..500（控制在 LoC 深分页上限 10 万条内）
    sp = 1 + Math.floor(Math.random() * 500);
  }
  const qs = new URLSearchParams({ fo: 'json', fa: LOC_FA, c: String(c), sp: String(sp), at: LOC_AT });
  if (query) qs.set('q', query);
  const json = await fetchLocJson(`https://www.loc.gov/search/?${qs.toString()}`, proxy);
  const raw: any[] = Array.isArray(json?.results) ? json.results : [];
  const filtered: GlamSearchItem[] = [];
  for (const r of raw) {
    const variants = locImageVariants(r);
    if (!variants) continue;
    const item = toItem('loc', locField(r, 'title'), variants.preview, locField(r, 'url'));
    if (!item) continue;
    // 缩略图优先用 LoC 提供的最小变体（如 150px）；IIIF 型 URL 会再被 iiifVariant 收窄
    item.thumbUrl = variants.thumb;
    item.photographer = locField(r, 'contributor') || locField(r, 'creator');
    filtered.push(item);
  }
  return query ? filtered.slice(within, within + limit) : filtered.slice(0, limit);
}

/** 统一入口：按源分发检索（无关键词 = 随机；未配置凭据给出明确指引）。
 *  provider='all' 时并发聚合全部已配置来源，跳过未配置 Key 的源，单源失败不影响其余。
 *  关键词检索支持按 offset 继续拉取（「加载更多」）：hasMore 仅在有关键词且来源可分页时成立，
 *  用「是否拉满整批」作为可能还有更多的信号（无关键词随机模式不提供加载更多）。 */
export async function searchGlamImages(
  provider: GlamProvider | 'all',
  creds: GlamCredentials,
  params: GlamSearchParams
): Promise<GlamSearchResult> {
  const query = (params.query ?? '').trim();
  const limit = Math.min(Math.max(1, params.limit ?? MAX_PER_PAGE), MAX_PER_PAGE);
  const offset = Math.max(0, params.offset ?? 0);

  if (provider === 'all') {
    const included = availableGlamProviders(creds);
    const perSource = Math.max(4, Math.ceil(limit / Math.max(1, included.length)));
    const settled = await Promise.allSettled(
      included.map((p) => searchGlamImages(p, creds, { query, offset, limit: perSource }))
    );
    const fulfilled = settled.filter(
      (r): r is PromiseFulfilledResult<GlamSearchResult> => r.status === 'fulfilled'
    );
    return {
      items: fulfilled.flatMap((r) => r.value.items),
      // 聚合：任一源还有更多即可继续加载（各源按同一 offset 继续拉）
      hasMore: fulfilled.some((r) => r.value.hasMore),
    };
  }

  const keyed = KEYED_PROVIDERS[provider];
  if (keyed && apiKeyOf(provider, creds) === '') {
    throw new GlamSearchError(
      `${GLAM_PROVIDER_LABELS[provider]} 未配置：请在管理端「系统设置」配置 ${keyed.key}（${keyed.url}）`
    );
  }
  try {
    let items: GlamSearchItem[];
    switch (provider) {
      case 'met':
        items = await searchMet(query, limit, offset);
        break;
      case 'rijks':
        items = await searchRijks(query, limit);
        break;
      case 'ai-chicago':
        items = await searchAiChicago(query, limit, offset);
        break;
      case 'artsmia':
        items = await searchArtsmia(query, limit, offset);
        break;
      case 'cleveland':
        items = await searchCleveland(query, limit, offset);
        break;
      case 'smk':
        items = await searchSmk(query, limit, offset);
        break;
      case 'wellcome':
        items = await searchWellcome(query, limit, offset);
        break;
      case 'harvard':
        items = await searchHarvard(creds.harvardApiKey, query, limit, offset);
        break;
      case 'nypl':
        items = await searchNypl(creds.nyplApiKey, query, limit, offset);
        break;
      case 'smithsonian':
        items = await searchSmithsonian(creds.smithsonianApiKey, query, limit, offset);
        break;
      case 'paris':
        items = await searchParis(creds.parisApiKey, query, limit);
        break;
      case 'europeana':
        items = await searchEuropeana(creds.europeanaApiKey, query, limit, offset);
        break;
      case 'loc':
        items = await searchLoc(query, limit, offset, creds.locProxy);
        break;
    }
    return {
      items,
      hasMore: !!query && !NO_PAGINATION_PROVIDERS.includes(provider) && items.length === limit,
    };
  } catch (err) {
    // 源级失败（网络 / 服务异常）：包装为可读错误，供路由返回 502
    if (err instanceof GlamSearchError) throw err;
    throw new GlamSearchError(`${GLAM_PROVIDER_LABELS[provider]} 检索失败：${err instanceof Error ? err.message : String(err)}`);
  }
}
