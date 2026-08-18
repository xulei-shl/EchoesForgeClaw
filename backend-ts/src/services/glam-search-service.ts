/**
 * 博物馆图片检索服务（GLAM 工具：艺术图片检索节点）。
 *
 * 集成 museo-main（docs/GLAM/museo-main）聚合的 12 家博物馆 / 图书馆开放 API，
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
 * 明尼阿波利斯美术馆（MIA）/ 克利夫兰美术馆 / 丹麦国立美术馆（SMK）/ Wellcome 收藏。
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
  | 'europeana';

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
  /** 艺术类别 id（GLAM_CATEGORIES 之一；缺省 = 不限类别） */
  category?: string;
  /** 随机抽样条数上限（默认 30） */
  limit?: number;
}

/** 艺术类别：各源的原生过滤值 + 无原生过滤源的降级关键词。
 *  filters 里是构建该源 URL 用的原生过滤片段（能真过滤的源）；
 *  缺失该条目的源（如 SMK / Wellcome / NYPL / Paris）退化为把 keyword 拼进检索词。 */
export interface GlamCategory {
  id: string;
  label: string;
  /** 无原生过滤的源降级用：拼进检索词的关键词 */
  keyword: string;
  /** 各源原生过滤片段（URL 参数或查询片段） */
  filters: Partial<Record<GlamProvider, string>>;
}

/** 类别 + 关键词可叠加：关键词照常检索，类别作为过滤条件同时生效。 */
export const GLAM_CATEGORIES: GlamCategory[] = [
  {
    id: 'painting',
    label: '绘画',
    keyword: 'painting',
    filters: {
      met: 'medium=Paintings',
      rijks: 'type=schilderij',
      'ai-chicago': 'artwork_type_id=1',
      artsmia: 'object_name:"painting"',
      cleveland: 'type=Painting',
      harvard: 'classification:Paintings',
      smithsonian: 'object_type:"Paintings"',
      europeana: 'what:painting',
    },
  },
  {
    id: 'sculpture',
    label: '雕塑',
    keyword: 'sculpture',
    filters: {
      met: 'medium=Sculpture',
      rijks: 'type=sculpture',
      'ai-chicago': 'artwork_type_id=3',
      artsmia: 'object_name:"sculpture"',
      cleveland: 'type=Sculpture',
      harvard: 'classification:Sculpture',
      smithsonian: 'object_type:"Sculpture"',
      europeana: 'what:sculpture',
    },
  },
  {
    id: 'photography',
    label: '摄影',
    keyword: 'photograph',
    filters: {
      met: 'medium=Photographs',
      rijks: 'type=photograph',
      'ai-chicago': 'artwork_type_id=2',
      artsmia: 'object_name:"photograph"',
      cleveland: 'type=Photograph',
      harvard: 'classification:Photographs',
      smithsonian: 'object_type:"Photographs"',
      europeana: 'what:photograph',
    },
  },
  {
    id: 'print',
    label: '版画',
    keyword: 'print',
    filters: {
      met: 'medium=Prints',
      rijks: 'type=prent',
      'ai-chicago': 'artwork_type_id=18',
      artsmia: 'object_name:"print"',
      cleveland: 'type=Print',
      harvard: 'classification:Prints',
      smithsonian: 'object_type:"Prints"',
      europeana: 'what:prints',
    },
  },
  {
    id: 'drawing',
    label: '素描 / 水彩',
    keyword: 'drawing',
    filters: {
      met: 'medium=Drawings',
      rijks: 'type=tekening',
      'ai-chicago': 'artwork_type_id=14',
      artsmia: 'object_name:"drawing"',
      cleveland: 'type=Drawing',
      harvard: 'classification:Drawings',
      smithsonian: 'object_type:"Drawings"',
      europeana: 'what:drawings',
    },
  },
  {
    id: 'ceramic',
    label: '陶瓷',
    keyword: 'ceramic',
    filters: {
      met: 'medium=Ceramics',
      'ai-chicago': 'artwork_type_id=36',
      artsmia: 'object_name:"ceramic"',
      cleveland: 'type=Ceramic',
      harvard: 'classification:Ceramics',
      smithsonian: 'object_type:"Ceramics"',
      europeana: 'what:ceramics',
    },
  },
  {
    id: 'textile',
    label: '纺织品',
    keyword: 'textile',
    filters: {
      met: 'medium=Textiles',
      'ai-chicago': 'artwork_type_id=5',
      artsmia: 'object_name:"textile"',
      cleveland: 'type=Textile',
      harvard: 'classification:Textiles',
      smithsonian: 'object_type:"Textiles"',
      europeana: 'what:textiles',
    },
  },
];

export interface GlamCredentials {
  harvardApiKey: string;
  nyplApiKey: string;
  smithsonianApiKey: string;
  parisApiKey: string;
  europeanaApiKey: string;
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
];

/** 聚合检索（provider='all'）统一显示名（路由 label 用）。 */
export const GLAM_ALL_LABEL = '全部来源（12 家博物馆聚合）';

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

/** 各源搜索 / 随机实现（返回已过滤公有领域 + 有图的作品列表）。
 *  category 传入时：该源有原生过滤片段则真过滤，否则把 category.keyword 拼进检索词降级。 */

async function searchMet(query: string, limit: number, category?: GlamCategory): Promise<GlamSearchItem[]> {
  const filter = category?.filters.met ? `&${category.filters.met}` : '';
  if (query || filter) {
    const json = await jsonGet(
      `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(query)}&hasImages=true${filter}`
    );
    const ids: number[] = Array.isArray(json.objectIDs) ? json.objectIDs.slice(0, MAX_PER_PAGE * 2) : [];
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

async function searchRijks(query: string, limit: number, category?: GlamCategory): Promise<GlamSearchItem[]> {
  const filter = category?.filters.rijks ? `&${category.filters.rijks}` : '';
  // 关键词检索：title / description 两字段；仅类别（无关键词）：单次 type 过滤检索
  const urls = query
    ? ['title', 'description'].map(
        (field) =>
          `https://data.rijksmuseum.nl/search/collection?${field}=${encodeURIComponent(query)}&imageAvailable=true${filter}`
      )
    : filter
      ? [`https://data.rijksmuseum.nl/search/collection?${filter.slice(1)}&imageAvailable=true`]
      : [];
  const searches = await Promise.allSettled(urls.map((url) => jsonGet(url)));
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
async function searchAiChicago(query: string, limit: number, category?: GlamCategory): Promise<GlamSearchItem[]> {
  const IMAGE_URL = (id: string) => `https://www.artic.edu/iiif/2/${id}/full/843,/0/default.jpg`;
  const shape = (data: any[]): GlamSearchItem[] =>
    data
      .filter((item) => item.is_public_domain && item.image_id && item._score > 0.5)
      .map((item) =>
        toItem('ai-chicago', item.title || '', IMAGE_URL(item.image_id), `https://www.artic.edu/artworks/${item.id}`)
      )
      .filter((i): i is GlamSearchItem => i !== null);

  // 类别过滤：term 查询参数（filters 值为如 artwork_type_id=1 → query[term][artwork_type_id]=1）
  const aicFilter = category?.filters['ai-chicago'];
  const term = aicFilter
    ? `&query[term][${aicFilter.split('=')[0]}]=${aicFilter.split('=')[1]}`
    : '';

  if (query) {
    const json = await jsonGet(
      `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(query)}&limit=100&fields=title,image_id,id,is_public_domain,_score${term}`
    );
    let items = shape(json.data ?? []);
    const last = (json.data ?? [])[json.data.length - 1];
    if (last && last._score > 0.5 && json.pagination?.total_pages > 1) {
      const json2 = await jsonGet(
        `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(query)}&limit=100&page=2&fields=title,image_id,id,is_public_domain,_score${term}`
      );
      items = items.concat(shape(json2.data ?? []));
    }
    return items.slice(0, limit);
  }
  if (term) {
    // 仅类别（无关键词）：term 过滤检索整类作品
    const json = await jsonGet(
      `https://api.artic.edu/api/v1/artworks/search?q=&limit=100&fields=title,image_id,id,is_public_domain${term}`
    );
    return shape((json.data ?? []).map((d: any) => ({ ...d, _score: 1 }))).slice(0, limit);
  }
  // 随机：浏览列表随机页（作品约 10 万件，页 1..100）
  const page = 1 + Math.floor(Math.random() * 100);
  const json = await jsonGet(
    `https://api.artic.edu/api/v1/artworks?page=${page}&limit=100&fields=title,image_id,id,is_public_domain`
  );
  return shape((json.data ?? []).map((d: any) => ({ ...d, _score: 1 }))).slice(0, limit);
}

// 明尼阿波利斯美术馆：Elasticsearch 接口（query 为空 = 全量公有领域有图作品）
async function searchArtsmia(query: string, limit: number, category?: GlamCategory): Promise<GlamSearchItem[]> {
  const IMAGE_URL = (id: string) => `https://${Number(id) % 7}.api.artsmia.org/800/${id}.jpg`;
  const filter = category?.filters.artsmia ? ` ${category.filters.artsmia}` : '';
  const q = `${query}${filter} rights_type:"Public Domain" image:valid`.trim();
  const json = await jsonGet(
    `https://search.artsmia.org/${encodeURIComponent(q)}?size=${Math.min(limit * 3, 300)}`
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
async function searchCleveland(query: string, limit: number, category?: GlamCategory): Promise<GlamSearchItem[]> {
  const filter = category?.filters.cleveland ? `&${category.filters.cleveland}` : '';
  const skip = query || filter ? 0 : Math.floor(Math.random() * 500) * 100;
  const json = await jsonGet(
    `https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(query)}&has_image=1&limit=${Math.min(limit * 3, 100)}&cc0=1&skip=${skip}${filter}`
  );
  return (json.data ?? [])
    .filter((item: any) => item.images?.web?.url)
    .map((item: any) =>
      toItem('cleveland', item.title || '', item.images.web.url, item.url || '')
    )
    .filter((i: any): i is GlamSearchItem => i !== null)
    .slice(0, limit);
}

// 丹麦国立美术馆（SMK）：公有领域 + 有图；随机 = keys=* 全量；无原生类别过滤 → 关键词降级
async function searchSmk(query: string, limit: number, category?: GlamCategory): Promise<GlamSearchItem[]> {
  const keys = query || category?.keyword || '*';
  const json = await jsonGet(
    `https://api.smk.dk/api/v1/art/search?keys=${encodeURIComponent(keys)}&filters=%5Bpublic_domain%3Atrue%5D,%5Bhas_image%3Atrue%5D&rows=${Math.min(limit * 3, 100)}`
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

// Wellcome 收藏：CC0 / PDM 图像；随机 = 无关键词全量；无原生类别过滤 → 关键词降级
async function searchWellcome(query: string, limit: number, category?: GlamCategory): Promise<GlamSearchItem[]> {
  const IMAGE_URL = (infoUrl: string) => infoUrl.replace('/info.json', '/full/!760,760/0/default.jpg');
  const q = query || category?.keyword ? `${query} ${category?.keyword ?? ''}`.trim() : '';
  const json = await jsonGet(
    `https://api.wellcomecollection.org/catalogue/v2/images?${q ? `query=${encodeURIComponent(q)}&` : ''}locations.license=cc0,pdm&pageSize=${Math.min(limit * 3, 100)}`
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
async function searchHarvard(apiKey: string, query: string, limit: number, category?: GlamCategory): Promise<GlamSearchItem[]> {
  const filter = category?.filters.harvard ? ` ${category.filters.harvard}` : '';
  const json = await jsonGet(
    `https://api.harvardartmuseums.org/object?apikey=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(`${query}${filter}`.trim())}&hasimage=1&size=${Math.min(limit * 3, 100)}`
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

// 纽约公共图书馆（需 nypl.api_key）；无原生类别过滤 → 关键词降级
async function searchNypl(apiKey: string, query: string, limit: number, category?: GlamCategory): Promise<GlamSearchItem[]> {
  const IMAGE_URL = (id: string) => `http://images.nypl.org/index.php?id=${id}&t=w`;
  const q = query || category?.keyword ? `${query} ${category?.keyword ?? ''}`.trim() : '';
  const json = await jsonGet(
    `http://api.repo.nypl.org/api/v2/items/search?q=${encodeURIComponent(q)}&publicDomainOnly=true&per_page=${Math.min(limit * 3, 100)}`,
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
async function searchSmithsonian(apiKey: string, query: string, limit: number, category?: GlamCategory): Promise<GlamSearchItem[]> {
  const IMAGE_URL = (mediaUrl: string) => `${mediaUrl}&max_w=800`;
  const filter = category?.filters.smithsonian ? `%20AND%20${encodeURIComponent(category.filters.smithsonian)}` : '';
  const json = await jsonGet(
    `https://api.si.edu/openaccess/api/v1.0/search?q=${encodeURIComponent(query)}${filter}%20AND%20online_media_type:%22Images%22%20AND%20media_usage:%22CC0%22&api_key=${encodeURIComponent(apiKey)}&rows=${Math.min(limit * 3, 100)}`
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

// 巴黎博物馆（需 paris.api_key）；无原生类别过滤 → 关键词降级
async function searchParis(apiKey: string, query: string, limit: number, category?: GlamCategory): Promise<GlamSearchItem[]> {
  const term = query || category?.keyword ? `${query} ${category?.keyword ?? ''}`.trim() : '';
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
    body: JSON.stringify({ query: gql(term) }),
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
async function searchEuropeana(apiKey: string, query: string, limit: number, category?: GlamCategory): Promise<GlamSearchItem[]> {
  const filter = category?.filters.europeana ? `&qf=${encodeURIComponent(category.filters.europeana)}` : '';
  const json = await jsonGet(
    `https://api.europeana.eu/record/v2/search.json?wskey=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&qf=TYPE:IMAGE&reusability=open&media=true&thumbnail=true&rows=${Math.min(limit * 3, 100)}${filter}`
  );
  return (json?.items ?? [])
    .filter((item: any) => item.title?.[0] && item.edmPreview?.[0])
    .map((item: any) =>
      toItem('europeana', item.title[0], item.edmPreview[0], item.guid || '')
    )
    .filter((i: any): i is GlamSearchItem => i !== null)
    .slice(0, limit);
}

/** 统一入口：按源分发检索（无关键词 = 随机；未配置凭据给出明确指引）。
 *  provider='all' 时并发聚合全部已配置来源，跳过未配置 Key 的源，单源失败不影响其余。 */
export async function searchGlamImages(
  provider: GlamProvider | 'all',
  creds: GlamCredentials,
  params: GlamSearchParams
): Promise<GlamSearchItem[]> {
  const query = (params.query ?? '').trim();
  const limit = Math.min(Math.max(1, params.limit ?? MAX_PER_PAGE), MAX_PER_PAGE);
  const category = params.category ? GLAM_CATEGORIES.find((c) => c.id === params.category) : undefined;

  if (provider === 'all') {
    const included = ALL_PROVIDERS.filter((p) => !KEYED_PROVIDERS[p] || apiKeyOf(p, creds) !== '');
    const perSource = Math.max(4, Math.ceil(limit / Math.max(1, included.length)));
    const settled = await Promise.allSettled(
      included.map((p) => searchGlamImages(p, creds, { query, category: category?.id, limit: perSource }))
    );
    return settled
      .filter((r): r is PromiseFulfilledResult<GlamSearchItem[]> => r.status === 'fulfilled')
      .flatMap((r) => r.value);
  }

  const keyed = KEYED_PROVIDERS[provider];
  if (keyed && apiKeyOf(provider, creds) === '') {
    throw new GlamSearchError(
      `${GLAM_PROVIDER_LABELS[provider]} 未配置：请在管理端「系统设置」配置 ${keyed.key}（${keyed.url}）`
    );
  }
  try {
    switch (provider) {
      case 'met':
        return await searchMet(query, limit, category);
      case 'rijks':
        return await searchRijks(query, limit, category);
      case 'ai-chicago':
        return await searchAiChicago(query, limit, category);
      case 'artsmia':
        return await searchArtsmia(query, limit, category);
      case 'cleveland':
        return await searchCleveland(query, limit, category);
      case 'smk':
        return await searchSmk(query, limit, category);
      case 'wellcome':
        return await searchWellcome(query, limit, category);
      case 'harvard':
        return await searchHarvard(creds.harvardApiKey, query, limit, category);
      case 'nypl':
        return await searchNypl(creds.nyplApiKey, query, limit, category);
      case 'smithsonian':
        return await searchSmithsonian(creds.smithsonianApiKey, query, limit, category);
      case 'paris':
        return await searchParis(creds.parisApiKey, query, limit, category);
      case 'europeana':
        return await searchEuropeana(creds.europeanaApiKey, query, limit, category);
    }
  } catch (err) {
    // 源级失败（网络 / 服务异常）：包装为可读错误，供路由返回 502
    if (err instanceof GlamSearchError) throw err;
    throw new GlamSearchError(`${GLAM_PROVIDER_LABELS[provider]} 检索失败：${err instanceof Error ? err.message : String(err)}`);
  }
}
