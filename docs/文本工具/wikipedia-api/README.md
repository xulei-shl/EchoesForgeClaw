# 将 Wikipedia 检索 + 文章内容集成到普通 TypeScript 后端

> 目标：不通过 MCP / skill，仅把「关键词检索 → 返回文章内容」的能力接入自己的 TS 后端。
> 数据来源：Wikipedia 官方公开 **MediaWiki API**（匿名、无需密钥）。

---

## 1. 结论速览

- 本项目原 `WikipediaService` 逻辑独立，但强依赖框架 `@cyanheads/mcp-ts-core`。
- **检索 + 全文** 这条路径不需要那套复杂的 HTML→纯文本管线：上游 `explaintext` / `extract` 已经是纯文本。
- 因此可以直接抽出一个**零框架依赖**的 standalone 客户端，仅需运行时的全局 `fetch`（Node ≥18 / Bun / Deno 内置），无需任何 DOM / 解析库。

---

## 2. 原服务的框架耦合点（需剥离）

| 框架导入 | 用途 | 替代方案 |
|:---|:---|:---|
| `fetchWithTimeout` / `withRetry` | 网络 + 重试 | 原生 `fetch` + 自写超时/退避 |
| `logger` | 日志 | `console` 或你的 logger |
| `notFound` / `serviceUnavailable` / `validationError` / `McpError` / `JsonRpcErrorCode` | 错误 | 普通 `Error` / 自定义 `WikipediaError` |
| `StorageService` | edition 索引缓存 | 内存缓存或去掉 |
| `RequestContextLike` | 贯穿所有方法的 `ctx` | 删除，或仅保留 `AbortSignal` |

> 不建议直接 import 原 `WikipediaService`：它把 `ctx` / `StorageService` / `McpError` 绑死，抽离成本高于重写。真正可复用的只有 `types.ts`（纯类型）和「按章节读取」的 HTML 解析函数。

---

## 3. 是爬虫吗？—— 不是，是官方 API 客户端

| 维度 | 本项目 | 爬虫 |
|:---|:---|:---|
| 请求目标 | `api.php` / `rest_v1` 接口 | 文章 HTML 页面 |
| 返回格式 | JSON | HTML |
| 解析 | 基本无（全文已是纯文本） | 需解析 DOM / 正则 |
| 稳定性 | 高（官方契约） | 低（页面改版即崩） |

唯一跟 HTML 沾边的是 **「按章节读取」**（`htmlSectionToPlainText`）：请求 `action=parse&prop=text` 拿到章节 HTML 再转纯文本。检索 + 全文线完全不需要。

---

## 4. 需要密钥吗？—— 不需要

- Wikipedia 公开 API 匿名开放，无需注册、无需 token。
- 原 `server-config.ts` 只有 `userAgent`（必带，Wikimedia 政策）、可选的 `baseUrl` 覆盖、`articleOverflowBytes`，**无 secret 字段**。
- 唯一合规要求：请求带 `User-Agent` 头（示例代码已带）。
- 匿名有速率限制，批量高频可能被临时限流（原项目因此有 `withRetry`，示例也已保留）。
- 仅写操作 / 更高配额才需 OAuth / BotPassword，纯读场景用不到。

---

## 5. 三个核心 API 端点

```
检索： GET https://<lang>.wikipedia.org/w/api.php?action=query&list=search&srsearch=<q>&format=json
全文： GET https://<lang>.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=true&titles=<t>&format=json
概要： GET https://<lang>.wikipedia.org/api/rest_v1/page/summary/<title>
```

`<lang>` 即语言子域：`en`（默认）、`zh`、`fr`、`ja` 等。

---

## 6. 目录内容

```
docs/wikipedia-api/
├── README.md                          # 本文档
├── wikipedia-client.ts                # 零依赖 standalone 客户端（推荐直接用这个）
├── reference-types.ts                 # 原项目框架无关的 API 原始类型（可复用）
├── reference-wikipedia-service.ts     # 原项目完整 WikipediaService（含 HTML→文本管线，作参考）
└── reference-server-config.ts         # 原项目 server 配置（userAgent / baseUrl 等，无密钥）
```

### 用法示例

```ts
import { search, getArticle } from './wikipedia-client';

// 1) 关键词检索
const { results } = await search('TypeScript', { limit: 5 });
const firstTitle = results[0].title; // 例如 "TypeScript"

// 2) 取全文（纯文本）
const article = await getArticle(firstTitle);
console.log(article.content);

// 3) 取概要（"什么是 X"）
const summary = await getSummary('TypeScript');
console.log(summary.extract);

// 多语言
const zh = await getArticle('北京', 'zh');
```

---

## 7. 如果还需要「按章节读取」

`reference-wikipedia-service.ts` 中的 `htmlSectionToPlainText` 与 `splitArticleIntoSections`
是框架无关的纯函数，可直接拷进你的项目，配合 Action API `action=parse&prop=text&section=<i>`
实现按章节拉取并转纯文本。该路径才会真正用到 HTML 解析。

---

## 8. 进阶（可选）

- **多语言 edition 合法性校验 + 缓存**：原项目用 `action=sitematrix` 拉取全量语言版列表并缓存。
  普通场景直接用 `https://<lang>.wikipedia.org` 拼域即可；若要严格拒绝非法语言码，
  可参考 `reference-wikipedia-service.ts` 的 `parseSiteMatrix` / `editionIndex` 实现一份内存版。
- **超长文章截断**：原项目用 `articleOverflowBytes`（默认 80_000）在超限时改为返回章节大纲，
  避免一次性返回超大正文（如 "World War II"）。如需可在 `getArticle` 返回后自行裁剪。
