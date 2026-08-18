# Library of Congress API — 影像类资源集成说明

> 适用范围：仅检索照片 / 印刷品 / 绘画 / 胶片 / 视频等视觉影像资源，含关键词检索、IIIF 图像处理、元数据解析、限流与错误处理。
>
> 官方文档：https://www.loc.gov/apis/json-and-yaml/

---

## 1. 概述

美国国会图书馆（Library of Congress, LoC）提供公开的 JSON/YAML API，无需 API Key 或认证即可调用。底层基于 Solr 搜索引擎，返回结构化的馆藏元数据和 IIIF 图像资源链接。

**关键特性：**
- 无需认证，公开访问
- 支持关键词全文检索（元数据 + 可用全文，含视频字幕）
- 支持按原始格式（original-format）过滤影像类资源
- 图像通过 IIIF 标准提供，可动态控制尺寸
- 大多数影像条目为公共领域（Public Domain）

---

## 2. 端点（Endpoints）

### 2.1 搜索类端点（返回多条结果）

| 端点 | 说明 | 影像检索适用 |
|---|---|---|
| `GET /search/?fo=json` | 全站搜索，可通过 `fa` 参数过滤格式 | 推荐，最灵活 |
| `GET /photos/?fo=json` | 照片 / 印刷品 / 绘画专类端点 | 仅静态影像 |
| `GET /film-and-videos/?fo=json` | 胶片 / 视频专类端点 | 仅动态影像 |
| `GET /collections/{name}/?fo=json` | 指定馆藏搜索 | 需已知馆藏名 |

> **建议**：项目集成统一使用 `/search/` + `fa=original-format:photo, print, drawing|original-format:film, video`，一次请求覆盖所有影像类型。专类端点适合只需要某一类的场景。

### 2.2 条目类端点（返回单条详情）

| 端点 | 说明 |
|---|---|
| `GET /item/{id}/?fo=json` | 条目详情，含完整元数据、所有资源版本 |
| `GET /resource/{id}/?fo=json` | 资源详情，含具体文件信息 |

搜索结果中的 `id` 或 `url` 字段可直接用于构造条目详情请求。

---

## 3. 关键词检索

### 3.1 基本用法

使用 `q` 参数进行关键词搜索，搜索范围包括元数据和所有可用全文（含视频字幕）。

```
GET https://www.loc.gov/search/?fo=json&q=vintage car&fa=original-format:photo, print, drawing|original-format:film, video&c=25
```

**多关键词**：空格分隔，默认 AND 关系。
```
q=world war 2 poster
```

### 3.2 支持的端点

`q` 参数在以下端点均可用：
- `/search/`
- `/{format}/`（如 `/photos/`、`/film-and-videos/`）
- `/collections/{name}/`
- `/item/{id}/`、`/resource/{id}/`

### 3.3 检索语法提示

LoC 搜索底层为 Solr，支持常见的查询语法：

| 语法 | 说明 | 示例 |
|---|---|---|
| 空格 | 默认 AND | `cat dog` → 同时包含 cat 和 dog |
| 引号 | 短语匹配 | `"civil war"` |
| `*` | 通配符 | `photograph*` |
| `OR` | 逻辑或 | `cat OR kitten` |
| `NOT` | 逻辑非 | `cat NOT dog` |
| `field:` | 字段限定 | `title:Lincoln` |

> 注意：官方文档未在 `q` 参数页完整列出布尔语法，以上为 Solr 通用语法，复杂查询建议先小范围验证。

---

## 4. 影像格式过滤（fa 参数）

### 4.1 基本格式

`fa`（facet）参数格式为 `filter-name:value`，多个过滤条件用 `|` 分隔表示 OR。

### 4.2 影像类原始格式值

| fa 值 | 对应资源类型 |
|---|---|
| `original-format:photo, print, drawing` | 照片、印刷品、绘画 |
| `original-format:film, video` | 胶片、视频 |
| `original-format:map` | 地图（含图像） |
| `original-format:3d object` | 3D 对象（含图像） |

### 4.3 推荐过滤表达式

同时检索所有影像类资源：
```
fa=original-format:photo, print, drawing|original-format:film, video
```

仅静态影像：
```
fa=original-format:photo, print, drawing
```

仅动态影像：
```
fa=original-format:film, video
```

### 4.4 其他有用的过滤维度

| fa 字段 | 示例值 | 说明 |
|---|---|---|
| `online-format:image` | 在线格式为图片 | 确保有图像文件 |
| `online-format:video` | 在线格式为视频 | 确保有视频文件 |
| `digitized:true` | 已数字化 | 排除仅馆藏记录 |
| `access-restricted:false` | 无访问限制 | 排除受限资源 |
| `partof:{collection}` | 指定馆藏 | 如 `partof:farm security administration` |
| `dates:{start}/{end}` | 日期范围 | `dates=1900/1950` |
| `location:{place}` | 地点 | `location:new york` |
| `subject:{topic}` | 主题 | `subject:portraits` |

---

## 5. 请求参数完整参考

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `fo` | string | — | **必填**。输出格式，`json` 或 `yaml` |
| `q` | string | — | 关键词检索 |
| `fa` | string | — | 分面过滤，格式 `name:value`，多个用 `\|` 做 OR |
| `c` | integer | 25 | 每页结果数，最大 1000 |
| `sp` | integer | 1 | 页码（start page） |
| `sb` | string | — | 排序字段，如 `date`、`title_s` |
| `at` | string | — | 属性选择，指定返回哪些字段；可用 `at!=` 排除 |
| `dates` | string | — | 日期范围，如 `1900/1950` |
| `all` | boolean | — | `true` 时包含未数字化的记录 |

### 5.1 属性选择（at）优化响应体积

搜索结果默认返回大量字段。使用 `at` 可只返回需要的字段，显著减小响应体积：

```
# 只返回结果列表中的关键字段
at=results,results.title,results.image_url,results.url,results.contributor,results.rights,results.dates,pagination
```

或排除不需要的大字段：
```
at!=facets
```

---

## 6. 响应结构与元数据

### 6.1 顶层结构

```json
{
  "results": [ ... ],
  "pagination": { ... },
  "facets": [ ... ],
  "options": { ... }
}
```

| 字段 | 说明 |
|---|---|
| `results` | 条目数组，核心数据 |
| `pagination` | 分页信息（总数、当前页、上下页链接） |
| `facets` | 分面统计（各维度 top 5 值及计数） |
| `options` | 请求回显参数 |

### 6.2 分页对象（pagination）

```json
{
  "current": 1,
  "total": 471,
  "perpage": 25,
  "from": 1,
  "to": 25,
  "next": "https://www.loc.gov/search/?...&sp=2",
  "previous": null,
  "of": 471
}
```

> 注意：使用 `fa` 含 `|`（OR）时，`pagination.total` 可能返回不准确的值（实测出现过 total=1 但 results 有 3 条的情况）。建议以 `results` 数组长度和 `next` 链接是否存在来判断是否还有下一页。

### 6.3 条目元数据字段（results[i]）

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | string \| string[] | 标题。可能是字符串或数组，数组取第一个 |
| `image_url` | string \| string[] | 图像 URL（IIIF）。可能是字符串或数组，数组含多种尺寸变体 |
| `url` | string | 条目详情页 URL（可用于构造 `/item/{id}/?fo=json`） |
| `id` | string | 条目唯一标识 |
| `contributor` | string \| string[] | 贡献者 / 创作者 |
| `creator` | string \| string[] | 创建者（部分条目用此字段而非 contributor） |
| `rights` | string \| string[] | 版权声明文本 |
| `rights_information` | string | 版权信息（部分条目的替代字段） |
| `rights_advisory` | string | 版权建议（部分条目的替代字段） |
| `date` | string | 日期（单值） |
| `dates` | string[] | 日期数组 |
| `description` | string[] | 描述文本数组 |
| `subject` | string[] | 主题标签 |
| `location` | string[] | 地点 |
| `language` | string[] | 语言 |
| `original_format` | string[] | 原始格式 |
| `online_format` | string[] | 在线格式 |
| `partof` | string[] | 所属馆藏 / 部门 |
| `access_restricted` | boolean | 是否有访问限制 |
| `digitized` | boolean | 是否已数字化 |
| `aka` | string[] | 别名 URL 列表 |
| `mime_type` | string[] | MIME 类型 |

### 6.4 字段类型注意事项

LoC API 的字段类型**不稳定**，同一字段在不同条目间可能是字符串、数组或缺失：

```typescript
// title 可能是 string、string[] 或 undefined
const title = typeof r.title === "string"
  ? r.title
  : Array.isArray(r.title) ? r.title[0] : undefined;

// image_url 可能是 string、string[] 或 undefined
// contributor / creator 同理
// rights 可能是 string、string[] 或 undefined
```

集成时必须对每个字段做类型守卫，不能假设固定类型。

---

## 7. IIIF 图像处理（重点）

### 7.1 图像 URL 格式

LoC 的图像通过 IIIF（International Image Interoperability Framework）标准提供，基础 URL 形如：

```
https://tile.loc.gov/image-services/iiif/{identifier}/full/{size}/{rotation}/{quality}.{format}
```

示例（全尺寸原图）：
```
https://tile.loc.gov/image-services/iiif/service:vhp:1021:102163:ph0001001/full/pct:100/0/default.jpg#h=4000&w=2676
```

### 7.2 URL 参数解析

| 位置 | 参数 | 说明 |
|---|---|---|
| 1 | `{identifier}` | 图像唯一标识，如 `service:vhp:1021:102163:ph0001001` |
| 2 | `full` | 区域（region），`full` 表示整图 |
| 3 | `{size}` | 尺寸控制（见下表） |
| 4 | `0` | 旋转角度，`0` 为不旋转 |
| 5 | `default` | 画质，`default` / `color` / `gray` / `bitonal` |
| 6 | `jpg` | 格式，`jpg` / `png` / `gif` / `webp` |

### 7.3 尺寸参数（size）详解

这是项目集成最关键的部分。**原图（pct:100）可能高达数千像素、数 MB，直接使用会严重影响加载性能和带宽。**

| 写法 | 说明 | 示例 | 适用场景 |
|---|---|---|---|
| `pct:100` | 百分比，100% = 原图全尺寸 | `pct:100` | 下载原图，**不建议前端直接用** |
| `pct:10` | 缩小到 10% | `pct:10` | 粗略预览 |
| `w,` | 指定宽度，高度自适应 | `512,` | 列表缩略图 |
| `,h` | 指定高度，宽度自适应 | `,512` | 列表缩略图 |
| `w,h` | 精确宽高（可能拉伸） | `300,300` | 固定尺寸卡片 |
| `!w,h` | 适配到 w×h 框内，保持比例 | `!256,256` | **推荐缩略图** |
| `max` | 服务器支持的最大尺寸 | `max` | 不推荐 |

### 7.4 推荐尺寸策略

```
缩略图（列表/网格）:  !256,256   →  约 10-30KB
中等预览（详情页）:   !800,800   →  约 50-150KB
大图查看（灯箱）:     !1600,1600 →  约 200-500KB
原图下载:             pct:100    →  可能 5-50MB（仅提供下载链接，不直接渲染）
```

### 7.5 从搜索结果构造合适尺寸的 URL

搜索结果的 `image_url` 字段通常返回的是**最大尺寸变体**（`pct:100`）。**不要直接使用这个 URL 展示图片**，应解析并替换 size 部分：

```typescript
/**
 * 将 LoC IIIF 图像 URL 调整为指定尺寸。
 * @param url 原始 IIIF URL
 * @param size IIIF size 参数，如 "!256,256"、"512,"、"pct:10"
 */
function resizeIiifUrl(url: string, size: string): string {
  // IIIF 路径格式: .../iiif/{id}/full/{size}/{rotation}/{quality}.{format}
  // 用正则替换 size 段
  return url.replace(
    /(\/iiif\/[^/]+\/full\/)[^/]+(\/\d+\/[^/]+\.\w+)/,
    `$1${size}$2`,
  );
}

// 用法
const original = "https://tile.loc.gov/image-services/iiif/service:vhp:1021:102163:ph0001001/full/pct:100/0/default.jpg";
const thumb = resizeIiifUrl(original, "!256,256");
// → https://tile.loc.gov/image-services/iiif/service:vhp:1021:102163:ph0001001/full/!256,256/0/default.jpg
```

### 7.6 视频帧截图

胶片/视频条目的 `image_url` 可能返回视频帧截图，URL 中含 `streaming-services`：
```
https://tile.loc.gov/streaming-services/iiif/service:vhp:0244:024489:.../full/512,/0/300,0/default.jpg
```
这类 URL 同样遵循 IIIF 尺寸规范，可按上述方法调整。

### 7.7 图像服务限流

Image Services（tile.loc.gov）有独立的限流策略，比 JSON API 更宽松但仍需注意。大量并发拉取原图可能触发封禁。建议：
- 前端使用缩略图尺寸，避免请求原图
- 服务端缓存已下载的图像
- 批量下载时控制并发数（建议 ≤ 5）

---

## 8. 版权与许可（Rights）

### 8.1 版权字段

条目可能在以下字段中包含版权信息（优先级从高到低）：
1. `rights`
2. `rights_information`
3. `rights_advisory`

很多影像条目**没有版权字段**，LoC 的默认立场是公共领域。

### 8.2 保守映射策略

```typescript
function mapRights(raw: unknown): "PUBLIC_DOMAIN" | "CC0" | "UNKNOWN" {
  if (!raw) return "PUBLIC_DOMAIN"; // 无字段 → 默认 PD
  const s = String(Array.isArray(raw) ? raw[0] : raw).toLowerCase();

  if (s.includes("no known restrictions") || s.includes("public domain"))
    return "PUBLIC_DOMAIN";
  if (s.includes("cc0") || s.includes("publicdomain/zero"))
    return "CC0";
  if (
    s.includes("rights") &&
    (s.includes("restrict") || s.includes("may apply") || s.includes("copyright"))
  )
    return "UNKNOWN";

  return "UNKNOWN"; // 字段存在但含义模糊 → 保守标记为未知
}
```

### 8.3 置信度建议

| 判定结果 | 建议置信度 | 说明 |
|---|---|---|
| `PUBLIC_DOMAIN`（无 rights 字段） | 0.85 | LoC 大部分影像为 PD，但非 100% 保证 |
| `PUBLIC_DOMAIN`（明确标注） | 0.95 | 字段明确写了 "no known restrictions" |
| `CC0` | 0.95 | 明确标注 CC0 |
| `UNKNOWN` | 0.2 | 有版权限制提示，需人工复核 |

### 8.4 合规建议

- 即使标记为 PUBLIC_DOMAIN，展示时仍应保留来源链接（`url` 字段）和创作者信息
- 对 `UNKNOWN` 的条目，建议在 UI 上标注"版权状态需核实"，或直接过滤掉
- `licenseUrl` 可设为 `rights` 字段的原始字符串（如果是 URL）

---

## 9. 分页

### 9.1 基本分页

```
# 第 1 页，每页 25 条
GET /search/?fo=json&q=cat&fa=...&c=25&sp=1

# 第 2 页
GET /search/?fo=json&q=cat&fa=...&c=25&sp=2
```

### 9.2 翻页判断

```typescript
const hasNext = !!json.pagination?.next;
// 或：当前 results 长度 === c 且 pagination.total > current * perpage
```

> 注意：如前所述，`fa` 含 OR 时 `pagination.total` 可能不准确。最可靠的方式是检查 `pagination.next` 是否为非 null。

### 9.3 深分页限制

LoC 搜索索引深度有限制（`MAX_INDEX_DEPTH: 100000`），超过第 100000 条结果可能无法访问。对于大结果集，建议通过增加过滤条件（日期、地点、主题等）来缩小范围，而非深分页。

---

## 10. 限流与最佳实践

### 10.1 官方限流

| 服务 | 速率限制 | 超限封禁时长 |
|---|---|---|
| JSON/YAML API（www.loc.gov） | **20 次/分钟** | 1 小时 |
| Text Services | 150 次/分钟 | 1 小时 |
| Image Services（tile.loc.gov） | 独立策略，较宽松 | — |

### 10.2 限流实现建议

```typescript
// 简单的令牌桶限流
class RateLimiter {
  private tokens = 20;
  private lastRefill = Date.now();
  private readonly refillRate = 20 / 60000; // 20 tokens per minute

  async take(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(20, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;

    if (this.tokens < 1) {
      const waitMs = (1 - this.tokens) / this.refillRate;
      await new Promise((r) => setTimeout(r, waitMs));
      return this.take();
    }
    this.tokens -= 1;
  }
}
```

建议实际速率控制在 **15 次/分钟**（留 25% 余量），避免高峰期被误封。

### 10.3 高负载时的额外保护

官方文档指出，API 高负载时限流阈值可能临时下调，可能出现：
- HTTP 429（Too Many Requests）
- 返回 HTML 页面含 CAPTCHA（而非 JSON）

**处理策略：**
```typescript
async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const resp = await fetch(url);
    if (resp.status === 429) {
      const wait = (i + 1) * 60000; // 429 → 等 1/2/3 分钟
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("json")) {
      // 可能是 CAPTCHA 页面，退避重试
      await new Promise((r) => setTimeout(r, 30000 * (i + 1)));
      continue;
    }
    return resp;
  }
  throw new Error("LoC API request failed after retries");
}
```

### 10.4 其他最佳实践

1. **设置 User-Agent**：虽然不强制，但设置可识别的 UA 有助于 LoC 识别合法流量
2. **使用 `at` 参数精简响应**：只请求需要的字段，减少传输和解析开销
3. **缓存结果**：相同查询的结果变化不频繁，建议缓存数小时至数天
4. **批量获取用 `c=100`**：减少请求次数，但注意单页响应体积
5. **避免并发请求**：JSON API 建议串行或低并发（≤ 2）

---

## 11. 错误处理

| HTTP 状态 | 原因 | 处理 |
|---|---|---|
| 200 | 成功 | 正常解析 JSON |
| 302 | 重定向（常见于 `fa` 过滤） | 跟随重定向（fetch 默认跟随，curl 需 `-L`） |
| 429 | 触发限流 | 退避重试（≥ 60 秒） |
| 4xx | 请求参数错误 | 检查参数格式 |
| 5xx | 服务端错误 | 指数退避重试 |
| 非 JSON 响应 | CAPTCHA 或维护页 | 退避重试，人工检查 |

**解析前校验：**
```typescript
const json = await resp.json();
if (!json || !Array.isArray(json.results)) {
  throw new Error("Unexpected LoC API response structure");
}
```

---

## 12. 完整集成示例（TypeScript）

```typescript
// loc-image-provider.ts
// LoC 影像类资源搜索 Provider — 生产可用版本

export type License = "PUBLIC_DOMAIN" | "CC0" | "UNKNOWN";

export interface ImageCandidate {
  url: string;           // 原图 URL（IIIF full size）
  thumbnailUrl: string;  // 缩略图 URL（IIIF !256,256）
  source: string;        // "library-of-congress"
  sourcePageUrl: string; // 条目详情页
  title?: string;
  author?: string;
  license: License;
  licenseUrl?: string;
  confidence: number;
  date?: string;
  description?: string;
}

export interface SearchOptions {
  maxPerProvider?: number;
  page?: number;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}

const BASE = "https://www.loc.gov/search/";
const FA_IMAGE = "original-format:photo, print, drawing|original-format:film, video";

// ---- 限流 ----
class TokenBucket {
  private tokens = 15;           // 留余量，15/min
  private last = Date.now();
  private readonly rate = 15 / 60000;

  async take(): Promise<void> {
    const now = Date.now();
    this.tokens = Math.min(15, this.tokens + (now - this.last) * this.rate);
    this.last = now;
    if (this.tokens < 1) {
      await new Promise((r) => setTimeout(r, (1 - this.tokens) / this.rate));
      return this.take();
    }
    this.tokens -= 1;
  }
}
const bucket = new TokenBucket();

// ---- IIIF 尺寸调整 ----
function resizeIiif(url: string, size: string): string {
  return url.replace(
    /(\/iiif\/[^/]+\/full\/)[^/]+(\/\d+\/[^/]+\.\w+)/,
    `$1${size}$2`,
  );
}

// ---- 字段提取 ----
function pickImageUrl(r: any): string | undefined {
  const iu = r.image_url;
  if (!iu) return undefined;
  if (typeof iu === "string") return iu;
  if (Array.isArray(iu) && iu.length > 0) {
    // 最长字符串通常对应最大尺寸变体
    return iu.reduce(
      (a: string, b: string) => (String(b).length > String(a).length ? b : a),
      iu[0],
    );
  }
  return undefined;
}

function pickAuthor(r: any): string | undefined {
  const c = r.contributor ?? r.creator;
  if (!c) return undefined;
  if (typeof c === "string") return c;
  if (Array.isArray(c) && c.length > 0) return String(c[0]);
  return undefined;
}

function pickString(r: any, field: string): string | undefined {
  const v = r[field];
  if (!v) return undefined;
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0) return String(v[0]);
  return undefined;
}

// ---- 版权映射 ----
function mapRights(raw: unknown): License {
  if (!raw) return "PUBLIC_DOMAIN";
  const s = String(Array.isArray(raw) ? raw[0] : raw).toLowerCase();
  if (s.includes("no known restrictions") || s.includes("public domain"))
    return "PUBLIC_DOMAIN";
  if (s.includes("cc0") || s.includes("publicdomain/zero")) return "CC0";
  if (
    s.includes("rights") &&
    (s.includes("restrict") || s.includes("may apply") || s.includes("copyright"))
  )
    return "UNKNOWN";
  return "UNKNOWN";
}

// ---- 主搜索函数 ----
export async function searchImages(
  query: string,
  opts: SearchOptions = {},
): Promise<{ results: ImageCandidate[]; hasNext: boolean; total?: number }> {
  await bucket.take();

  const fetcher = opts.fetcher ?? fetch;
  const params = new URLSearchParams({
    fo: "json",
    q: query,
    fa: FA_IMAGE,
    c: String(opts.maxPerProvider ?? 25),
    sp: String(opts.page ?? 1),
    // 精简返回字段，减小响应体积
    at: "results,results.title,results.image_url,results.url,results.id,results.contributor,results.creator,results.rights,results.rights_information,results.rights_advisory,results.date,results.dates,results.description,results.subject,results.location,results.original_format,results.online_format,results.partof,results.access_restricted,pagination",
  });

  const url = `${BASE}?${params}`;
  const resp = await fetcher(url, { signal: opts.signal });

  if (resp.status === 429) {
    throw new Error("LoC API rate limited (429). Wait 60s and retry.");
  }
  if (!resp.ok) throw new Error(`LoC API HTTP ${resp.status}`);

  const ct = resp.headers.get("content-type") ?? "";
  if (!ct.includes("json")) {
    throw new Error("LoC API returned non-JSON (possible CAPTCHA).");
  }

  const json = await resp.json();
  const rawResults: any[] = json?.results ?? [];

  const results: ImageCandidate[] = [];
  for (const r of rawResults) {
    const imgUrl = pickImageUrl(r);
    if (!imgUrl) continue;

    const rightsRaw = r.rights ?? r.rights_information ?? r.rights_advisory;
    const license = mapRights(rightsRaw);

    results.push({
      url: imgUrl,
      thumbnailUrl: resizeIiif(imgUrl, "!256,256"),
      source: "library-of-congress",
      sourcePageUrl: r.url ?? r.id,
      title: pickString(r, "title"),
      author: pickAuthor(r),
      license,
      licenseUrl: typeof r.rights === "string" ? r.rights : undefined,
      confidence: license === "PUBLIC_DOMAIN" ? 0.85 : license === "CC0" ? 0.95 : 0.2,
      date: pickString(r, "date") ?? (Array.isArray(r.dates) ? r.dates[0] : undefined),
      description: Array.isArray(r.description) ? r.description[0] : undefined,
    });
  }

  return {
    results,
    hasNext: !!json?.pagination?.next,
    total: json?.pagination?.of ?? json?.pagination?.total,
  };
}
```

### 使用示例

```typescript
// 搜索 "vintage car" 的影像资源
const { results, hasNext, total } = await searchImages("vintage car", {
  maxPerProvider: 25,
  page: 1,
});

for (const item of results) {
  console.log(item.title);
  console.log("  缩略图:", item.thumbnailUrl);  // !256,256，适合列表展示
  console.log("  原图:", item.url);             // pct:100，仅用于下载
  console.log("  版权:", item.license, `(${item.confidence})`);
  console.log("  来源:", item.sourcePageUrl);
}
```

---

## 13. 集成检查清单

- [ ] **认证**：无需 API Key，确认网络可访问 `www.loc.gov` 和 `tile.loc.gov`
- [ ] **限流**：实现 ≤ 20 次/分钟的速率控制（建议 15 次/分钟），处理 429
- [ ] **关键词**：使用 `q` 参数，空格分隔多词
- [ ] **格式过滤**：使用 `fa=original-format:photo, print, drawing|original-format:film, video`
- [ ] **图像尺寸**：**不要直接用 `image_url` 原图展示**，通过 IIIF size 参数生成缩略图（`!256,256`）
- [ ] **字段类型**：对 `title`、`image_url`、`contributor`、`rights` 等字段做 string/array/undefined 类型守卫
- [ ] **版权**：保守映射，无 rights 字段默认 PD（置信度 0.85），含限制词标记 UNKNOWN
- [ ] **分页**：用 `sp` 参数翻页，通过 `pagination.next` 判断是否有下一页（不要依赖 total）
- [ ] **响应精简**：用 `at` 参数只请求需要的字段
- [ ] **错误处理**：处理 302 重定向、429 限流、非 JSON 响应（CAPTCHA）
- [ ] **缓存**：对搜索结果和图像做适当缓存
- [ ] **来源标注**：展示时保留 `sourcePageUrl` 链接和创作者信息

---

## 14. 参考链接

- API 总览：https://www.loc.gov/apis/
- JSON/YAML API：https://www.loc.gov/apis/json-and-yaml/
- 请求参数：https://www.loc.gov/apis/json-and-yaml/requests/parameters/
- 端点说明：https://www.loc.gov/apis/json-and-yaml/requests/endpoints/
- 搜索结果响应：https://www.loc.gov/apis/json-and-yaml/responses/search-results/
- 条目/资源响应：https://www.loc.gov/apis/json-and-yaml/responses/item-and-resource/
- 限流说明：https://www.loc.gov/apis/json-and-yaml/working-within-limits/
- IIIF 图像服务：https://www.loc.gov/apis/micro-services/image-services/
- 动态示例：https://www.loc.gov/apis/json-and-yaml/examples/
