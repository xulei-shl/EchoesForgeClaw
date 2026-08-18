# NASA Images API 集成参考指南

> 基于 NASA 官方公开图片库 API 的完整集成说明，适用于需要检索、获取 NASA 公有领域图片的项目。

---

## 1. 概述

NASA Images API 是 NASA 官方提供的公开图片检索接口，无需注册、无需 API Key，所有返回内容均为**美国政府作品，属于公有领域（Public Domain）**。

- **API 根地址**：`https://images-api.nasa.gov`
- **数据格式**：JSON
- **认证要求**：无
- **速率限制**：未公开明确的 QPS 限制，建议自行限流（如 1~5 req/s），避免被临时封禁
- **图片托管域名**：`https://images-assets.nasa.gov`

---

## 2. 接口一览

| 接口 | 方法 | 用途 |
|------|------|------|
| `/search` | GET | 按关键词搜索图片/音频/视频 |
| `/asset/{nasa_id}` | GET | 获取指定资源的多尺寸图片直链 |
| `/metadata/{nasa_id}` | GET | 获取指定资源的完整元数据 JSON |
| `/captions/{nasa_id}` | GET | 获取视频字幕（SRT） |

---

## 3. 搜索接口 `/search`

### 3.1 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `q` | string | 是 | - | 搜索关键词 |
| `media_type` | string | 否 | 全部 | 媒体类型：`image` / `audio` / `video`，多个用逗号分隔 |
| `page_size` | number | 否 | 100 | 每页返回数量，**最大 100**，超过按 100 处理 |
| `page` | number | 否 | 1 | 页码，从 1 开始 |
| `year_start` | string | 否 | - | 起始年份（如 `2020`） |
| `year_end` | string | 否 | - | 结束年份（如 `2024`） |
| `center` | string | 否 | - | NASA 中心过滤（如 `JSC`、`GSFC`） |
| `keywords` | string | 否 | - | 关键词过滤，多个用逗号分隔 |
| `nasa_id` | string | 否 | - | 按 NASA ID 精确查询 |
| `photographer` | string | 否 | - | 按摄影师过滤 |
| `secondary_creator` | string | 否 | - | 按第二创作者过滤 |
| `location` | string | 否 | - | 按地点过滤 |
| `title` | string | 否 | - | 按标题过滤 |
| `description` | string | 否 | - | 按描述过滤 |

### 3.2 请求示例

```
https://images-api.nasa.gov/search?q=mars&media_type=image&page_size=100&page=1
```

### 3.3 返回结构

```json
{
  "collection": {
    "version": "1.0",
    "href": "https://images-api.nasa.gov/search?...",
    "metadata": {
      "total_hits": 26836
    },
    "links": [
      {
        "rel": "next",
        "prompt": "Next",
        "href": "https://images-api.nasa.gov/search?q=mars&media_type=image&page_size=100&page=2"
      }
    ],
    "items": [
      {
        "href": "https://images-assets.nasa.gov/image/NHQ201906010007/collection.json",
        "data": [
          {
            "nasa_id": "NHQ201906010007",
            "title": "Mars Celebration",
            "photographer": "NASA/Bill Ingalls",
            "secondary_creator": null,
            "center": "HQ",
            "date_created": "2019-06-01T00:00:00Z",
            "description": "...",
            "keywords": ["Mars", "Celebration"],
            "media_type": "image"
          }
        ],
        "links": [
          {
            "href": "https://images-assets.nasa.gov/image/NHQ201906010007/NHQ201906010007~medium.jpg",
            "render": "image",
            "rel": "preview"
          }
        ]
      }
    ]
  }
}
```

### 3.4 关键字段说明

| 字段路径 | 说明 |
|----------|------|
| `collection.metadata.total_hits` | 搜索总命中数（所有页合计） |
| `collection.links[].rel` | 分页链接类型：`next` / `prev` / `first` / `last` |
| `collection.items[].data[0]` | 资源元数据（数组通常只有 1 个元素） |
| `collection.items[].data[0].nasa_id` | 资源唯一 ID，用于 asset/metadata 接口 |
| `collection.items[].data[0].title` | 标题 |
| `collection.items[].data[0].photographer` | 摄影师 |
| `collection.items[].data[0].secondary_creator` | 第二创作者 |
| `collection.items[].data[0].center` | 发布中心（如 HQ、JSC、GSFC） |
| `collection.items[].data[0].date_created` | 创建时间（ISO 8601） |
| `collection.items[].data[0].description` | 描述文本 |
| `collection.items[].data[0].keywords` | 关键词数组 |
| `collection.items[].links[]` | 资源链接数组 |
| `collection.items[].links[?render=="image"]` | 图片预览链接（通常是 medium 尺寸） |
| `collection.items[].links[].href` | 图片直链 |

### 3.5 分页机制

- 通过 `page` 参数翻页，或直接使用返回的 `collection.links` 中 `rel="next"` 的 `href`
- 当没有 `next` 链接时，表示已到最后一页
- 每页最多 100 条，总结果可能上万条（如 `mars` 有 26,836 条）

---

## 4. 资源详情接口 `/asset/{nasa_id}`

获取指定图片的**所有可用尺寸直链**，包括原图。

### 4.1 请求示例

```
https://images-api.nasa.gov/asset/NHQ201906010007
```

### 4.2 返回结构

```json
{
  "collection": {
    "items": [
      { "href": "https://images-assets.nasa.gov/image/.../...~orig.tif" },
      { "href": "https://images-assets.nasa.gov/image/.../...~large.jpg" },
      { "href": "https://images-assets.nasa.gov/image/.../...~medium.jpg" },
      { "href": "https://images-assets.nasa.gov/image/.../...~small.jpg" },
      { "href": "https://images-assets.nasa.gov/image/.../...~thumb.jpg" },
      { "href": "https://images-assets.nasa.gov/image/.../metadata.json" }
    ]
  }
}
```

### 4.3 尺寸说明

| 文件名后缀 | 格式 | 说明 |
|------------|------|------|
| `~orig.tif` | TIFF | 原始无损大图（可能很大，几十 MB） |
| `~large.jpg` | JPEG | 大图，适合高清展示 |
| `~medium.jpg` | JPEG | 中图，搜索接口默认返回的就是这个 |
| `~small.jpg` | JPEG | 小图 |
| `~thumb.jpg` | JPEG | 缩略图，适合列表预览 |
| `metadata.json` | JSON | 该资源的完整元数据文件 |

> **注意**：并非所有图片都有全部尺寸，部分老资源可能只有 medium/small/thumb。

---

## 5. 元数据接口 `/metadata/{nasa_id}`

获取指定资源的完整元数据，返回内容与 asset 接口中的 `metadata.json` 一致。

```
https://images-api.nasa.gov/metadata/NHQ201906010007
```

---

## 6. 完整代码示例

### 6.1 基础搜索（TypeScript）

对应原始代码的标准实现：

```typescript
interface ImageCandidate {
  url: string;
  thumbnailUrl: string;
  source: string;
  sourcePageUrl?: string;
  title?: string;
  author?: string;
  license: string;
  licenseUrl?: string;
  confidence: number;
}

interface SearchOptions {
  maxPerProvider?: number;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}

const NASA_SEARCH_URL = "https://images-api.nasa.gov/search";
const NASA_DETAIL_BASE = "https://images.nasa.gov/details";

async function searchNasa(
  query: string,
  opts: SearchOptions = {}
): Promise<ImageCandidate[]> {
  const fetcher = opts.fetcher ?? fetch;
  const pageSize = Math.min(opts.maxPerProvider ?? 10, 100);

  const url = `${NASA_SEARCH_URL}?${new URLSearchParams({
    q: query,
    media_type: "image",
    page_size: String(pageSize),
  })}`;

  const resp = await fetcher(url, { signal: opts.signal });
  if (!resp.ok) throw new Error(`NASA API HTTP ${resp.status}`);

  const json = await resp.json() as any;
  const items = json?.collection?.items ?? [];

  const results: ImageCandidate[] = [];
  for (const item of items) {
    const data = item.data?.[0];
    const link = item.links?.find((l: any) => l.render === "image")
      ?? item.links?.[0];

    if (!data || !link?.href) continue;

    results.push({
      url: link.href,
      thumbnailUrl: link.href,
      source: "nasa",
      sourcePageUrl: data.nasa_id
        ? `${NASA_DETAIL_BASE}/${data.nasa_id}`
        : undefined,
      title: data.title,
      author: data.photographer ?? data.secondary_creator ?? data.center,
      license: "PUBLIC_DOMAIN",
      licenseUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
      confidence: 0.95,
    });
  }

  return results;
}
```

### 6.2 分页搜索（获取超过 100 条）

```typescript
async function searchNasaPaginated(
  query: string,
  maxResults: number = 200
): Promise<ImageCandidate[]> {
  const all: ImageCandidate[] = [];
  let page = 1;
  const pageSize = Math.min(maxResults, 100);

  while (all.length < maxResults) {
    const url = `${NASA_SEARCH_URL}?${new URLSearchParams({
      q: query,
      media_type: "image",
      page_size: String(pageSize),
      page: String(page),
    })}`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`NASA API HTTP ${resp.status}`);
    const json = await resp.json() as any;

    const items = json?.collection?.items ?? [];
    if (items.length === 0) break;

    for (const item of items) {
      const data = item.data?.[0];
      const link = item.links?.find((l: any) => l.render === "image")
        ?? item.links?.[0];
      if (!data || !link?.href) continue;

      all.push({
        url: link.href,
        thumbnailUrl: link.href,
        source: "nasa",
        sourcePageUrl: data.nasa_id
          ? `${NASA_DETAIL_BASE}/${data.nasa_id}`
          : undefined,
        title: data.title,
        author: data.photographer ?? data.secondary_creator ?? data.center,
        license: "PUBLIC_DOMAIN",
        licenseUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
        confidence: 0.95,
      });

      if (all.length >= maxResults) break;
    }

    // 检查是否有下一页
    const hasNext = json?.collection?.links?.some(
      (l: any) => l.rel === "next"
    );
    if (!hasNext) break;

    page++;
    // 礼貌延迟，避免触发限流
    await new Promise((r) => setTimeout(r, 200));
  }

  return all;
}
```

### 6.3 获取原图高清地址

```typescript
interface NasaAsset {
  original?: string;   // ~orig.tif
  large?: string;      // ~large.jpg
  medium?: string;     // ~medium.jpg
  small?: string;      // ~small.jpg
  thumbnail?: string;  // ~thumb.jpg
}

async function getNasaAsset(nasaId: string): Promise<NasaAsset> {
  const url = `https://images-api.nasa.gov/asset/${nasaId}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`NASA asset HTTP ${resp.status}`);
  const json = await resp.json() as any;

  const items: string[] = (json?.collection?.items ?? [])
    .map((i: any) => i.href);

  const pick = (suffix: string) =>
    items.find((h) => h.includes(suffix));

  return {
    original: pick("~orig"),
    large: pick("~large"),
    medium: pick("~medium"),
    small: pick("~small"),
    thumbnail: pick("~thumb"),
  };
}
```

### 6.4 搜索 + 原图一体化（推荐）

搜索后自动补充原图地址：

```typescript
async function searchNasaWithOriginal(
  query: string,
  maxResults: number = 10
): Promise<ImageCandidate[]> {
  const results = await searchNasa(query, { maxPerProvider: maxResults });

  // 并发获取每个结果的原图地址（控制并发数）
  const CONCURRENCY = 5;
  for (let i = 0; i < results.length; i += CONCURRENCY) {
    const batch = results.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (r) => {
        const nasaId = r.sourcePageUrl?.split("/").pop();
        if (!nasaId) return;
        try {
          const asset = await getNasaAsset(nasaId);
          if (asset.large) r.url = asset.large;
          if (asset.thumbnail) r.thumbnailUrl = asset.thumbnail;
        } catch {
          // 原图获取失败，保留搜索接口的 medium 图
        }
      })
    );
  }

  return results;
}
```

---

## 7. 字段映射表

| 业务字段 (ImageCandidate) | NASA API 字段 | 说明 |
|---------------------------|---------------|------|
| `url` | `items[].links[?render=="image"].href` | 搜索接口返回 medium 图；需原图请调 asset 接口 |
| `thumbnailUrl` | 同上 | 建议用 asset 接口的 `~thumb.jpg` |
| `source` | 固定值 `"nasa"` | - |
| `sourcePageUrl` | `https://images.nasa.gov/details/{nasa_id}` | 由 `data[0].nasa_id` 拼接 |
| `title` | `data[0].title` | - |
| `author` | `data[0].photographer` → `secondary_creator` → `center` | 三级回退 |
| `license` | 固定值 `"PUBLIC_DOMAIN"` | 美国政府作品 |
| `licenseUrl` | 固定值 NASA 品牌中心页面 | - |
| `confidence` | 自定义 | NASA 不提供此字段，按业务需要赋值 |

---

## 8. 许可证与版权

- **所有 NASA API 返回的图片均为公有领域（Public Domain）**，可自由使用、修改、分发，包括商业用途
- **无需署名**，但建议注明 "Courtesy of NASA" 或图片来源
- **例外情况**：
  - 部分图片可能包含受第三方版权保护的内容（如海报中出现的非 NASA 商标）
  - 人物肖像权可能适用，商用时需注意
- 参考：[NASA Images and Media Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/)

---

## 9. 注意事项与最佳实践

### 9.1 速率限制

- NASA 未公开明确的 QPS 上限，但高频请求可能被临时封禁（HTTP 429）
- 建议：单实例 **1~5 req/s**，分页遍历间加 100~500ms 延迟
- 生产环境建议加令牌桶限流（对应原代码中的 `getBucket("nasa").take()`）

### 9.2 图片地址

- 搜索接口返回的 `link.href` 是 **medium 尺寸**，不是原图
- 原图（`~orig.tif`）通常很大（几 MB 到几十 MB），不适合直接在网页展示
- 推荐组合：列表用 `~thumb.jpg` / `~small.jpg`，详情用 `~large.jpg`，下载提供 `~orig.tif`

### 9.3 错误处理

| HTTP 状态 | 含义 | 处理建议 |
|-----------|------|----------|
| 200 | 成功 | 正常解析 |
| 400 | 参数错误 | 检查 query/page_size 等参数 |
| 404 | 资源不存在 | nasa_id 无效或已被移除 |
| 429 | 请求过多 | 退避重试（指数退避） |
| 500/502/503 | 服务端错误 | 重试，最多 3 次 |

### 9.4 数据一致性

- `data` 是数组，通常只有 1 个元素，取 `data[0]` 即可
- `links` 可能为空（极少数资源没有预览图），需做判空
- `photographer` / `secondary_creator` 可能为 `null`，需回退到 `center`

### 9.5 搜索质量

- 简单关键词（如 `mars`）可能返回大量同一事件的组照
- 可组合 `year_start` / `year_end` / `center` / `keywords` 缩小范围
- 用双引号包裹短语可做精确匹配（如 `"mars rover"`）

---

## 10. 常见问题

**Q: 为什么搜索结果全是同一主题的照片？**
A: NASA API 默认按相关性排序，同一事件的组照标题相同会排在一起。可加 `year_start`/`center` 过滤，或翻页查看更多。

**Q: page_size 传 200 为什么只返回 100 条？**
A: API 单页上限是 100，超过会被截断。需要更多结果请用 `page` 参数分页。

**Q: 图片链接是 http 还是 https？**
A: API 返回的链接可能是 `http://`，建议统一替换为 `https://`（图片托管域名支持 HTTPS）。

**Q: 可以直接 hotlink 图片吗？**
A: 可以，`images-assets.nasa.gov` 支持直接引用。但高流量场景建议下载到自己的 CDN。

**Q: total_hits 准确吗？**
A: 是估算值，翻到最后一页时可能与实际有微小差异。

---

## 11. 参考链接

- NASA Images API 官方文档：https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf
- NASA 图片库官网：https://images.nasa.gov/
- NASA 媒体使用指南：https://www.nasa.gov/nasa-brand-center/images-and-media/
