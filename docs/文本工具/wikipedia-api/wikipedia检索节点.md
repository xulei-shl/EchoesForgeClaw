# Wikipedia 检索节点（`wikipedia_search`）

> 文本工具节点：检索 Wikipedia 官方公开词条（多语言），点击结果拉取**文章全文**，
> 全文以 **Markdown 文本** 写入 `data.output`，供下游节点（文本聚合 / 提示词生成 /
> 图像生成 / AI 对话…）按「端口类型声明」自动消费，无需逐个枚举节点类型。
>
> 数据来源为 Wikipedia 官方公开 **MediaWiki API**（匿名、无需密钥、无需配置），
> 实现参考本目录 `wikipedia-client.ts`（零依赖 standalone 客户端）与 `README.md`。

## 一、集成概览

| 层 | 文件 | 改动 |
|---|---|---|
| 后端服务 | `backend-ts/src/services/wikipedia-service.ts`（新增） | 检索 + 全文两条 API 调用（零密钥，含超时 / 错误类） |
| 后端执行 | `backend-ts/src/modules/bookplate/router.ts` | 新增 `POST /wikipedia-search` / `POST /wikipedia-article` |
| 后端模板 | `backend-ts/src/modules/bookplate/node-types.ts` | `WIKIPEDIA_SEARCH` 模板：`tool` / 输出 `text` / 接受 `text` |
| 前端类型 | `frontend/src/platform/types/index.ts` | `CanvasNodeType` 增加 `'wikipedia_search'` |
| 前端展示 | `frontend/src/modules/bookplate/nodeTypes.ts` + `nodeLayout.ts` | 尺寸 / 颜色 / 模板 / 端口静态镜像 |
| 前端组件 | `frontend/src/modules/bookplate/components/WikipediaSearchNode.tsx`（新增） | 节点交互 UI（语言 / 关键词 / 结果列表 / 全文视图） |
| 画板接线 | `BookplatePage.tsx` / `CanvasNodeViews.tsx` / `useNodeExecution.ts` | `seedDataFor` / `handleSearchWikipediaFor` / `handleOpenWikipediaArticleFor` / 渲染分支 / `runNode` 分支 |
| 展示名 | `frontend/src/platform/utils/generation.ts` | `wikipedia_search: 'Wikipedia 检索'` |

**端口声明（唯一权威：后端模板）**

```python
{
    "type": "wikipedia_search",
    "name": "Wikipedia 检索",
    "category": "tool",            # 「+」菜单 → 文本工具 分组
    "configurable": false,         # 不绑定 llm/agent 配置，也无需任何凭据
    "output_type": "text",         # 全文以文本输出（占位符引用 / 文本上下文自动生效）
    "input_types": ["text"],       # 可连线上级文本节点传入检索关键词
}
```

> 按「节点输入输出声明式接线」约定：声明 `output_type: "text"` 且把对外文本存入
> `data.output` 后，文本聚合占位符引用、提示词生成 / 图像生成 / AI 对话的「文本上下文」
> 收集均**零改动自动生效**；连线上级文本作为检索关键词与天气 / 知乎节点同口径（连线即输入，1 级）。

## 二、无需配置

- Wikipedia 公开 API 匿名开放，无需注册、无需 token、无需任何系统设置项；
- 唯一合规要求：请求带 `User-Agent` 头（Wikimedia 政策，服务内已内置）；
- 匿名有速率限制，超时 15s；批量高频可能被临时限流（错误文案会提示稍后重试）。

## 三、两个后端契约

### 1) 关键词检索

`POST /api/modules/bookplate/wikipedia-search`，请求体：

```jsonc
{
  "query": "TypeScript",     // 检索关键词（必填；页面以连线上级文本优先覆盖）
  "language": "en",          // 语言子域：zh / en / ja / fr / de / es / ru（默认 zh）
  "limit": 10                // 请求数量 1-50（默认 10）
}
```

响应：

```jsonc
{
  "query": "TypeScript",
  "language": "en",
  "total": 84210,                      // 总命中数（searchinfo.totalhits）
  "results": [
    { "title": "TypeScript", "pageid": 1, "snippet": "…", "wordcount": 120 },
    { "title": "TypeScript (band)", "pageid": 2, "snippet": "…", "wordcount": 8 }
  ]
}
```

上游为 `action=query&list=search&formatversion=2&srprop=snippet|wordcount`；
`pageid` 供列表 key 使用，`snippet` 已剥离 `<span class="searchmatch">` 高亮并解码 HTML 实体。

### 2) 文章全文

`POST /api/modules/bookplate/wikipedia-article`，请求体：

```jsonc
{
  "title": "TypeScript",     // 文章标题（可传别名，redirects=true 自动解析重定向）
  "language": "en"
}
```

响应：

```jsonc
{
  "title": "TypeScript",     // 解析重定向后的实际标题
  "pageid": 1,
  "content": "TypeScript is a …"   // 全文纯文本（explaintext=true，无需 HTML 解析）
}
```

- 上游为 `action=query&prop=extracts&explaintext=true&exsectionformat=wiki`；
- 超长正文按 50_000 字符截断并追加「文章过长，已截断」说明（避免一次性返回超大文本）；
- 未收录词条（`missing`）统一映射为 502 + `detail`。

错误码统一映射：业务/网络错误 → 502 + `detail`；参数缺失 → 400。前端以 `error.detail`
展示并可重试。超时前端 30s（`SMALL_TOOL_TIMEOUT_MS`）、后端 15s。

## 四、节点交互设计

```
┌─ Wikipedia 检索 ● ─────────────────────────┐
│ [中文▾] [English▾]                         │
│ [关键词输入………………………] [🔍]            │
│                                            │
│ 共 5 条结果 · 点击词条查看全文   zh         │
│ ┌ ① TypeScript ～约 120 词 ─────────────┐ │
│ │ TypeScript is a language …              │ │
│ └────────────────────────────────────────┘ │
│ ┌ ② TypeScript (band) …                 ┐ │
│                                            │
│ （点击词条后 → 全文视图）                   │
│ ← 返回结果（5 条）  TypeScript             │
│ ┌ 全文（Streamdown Markdown 渲染）──────┐ │
└───────────────────────────────────────────┘
```

- **语言下拉**：中文 / English / 日本語 / Français / Deutsch / Español / Русский（默认中文）；
- **连线即输入**：连接文本输出上级后，表单收敛为「上级连线输入关键词」高光卡片
  （与天气节点一致），查询以上级文本为准；断开连线即回到手动输入；
- **数量档位**：5 / 10 / 20 条（对应服务端上限 50）；
- **结果列表**：每条展示标题 + 摘要片段 + 词数，点击条目拉取该词条全文；
- **全文视图**：正文以 Streamdown Markdown 渲染，顶部「返回结果（N 条）」可切回列表
  （仅切视图，不清空输出）；点击其他词条直接替换全文；
- **结果区**：加载态（BeamGlow + 旋转指示 + 当前关键词 / 文章标题）、错误态（原因 + 重试，
  全文视图失败重试拉全文，否则重试检索）、结果态（可复制）；右上角操作栏提供「重试 / 复制」；
  有下级节点时禁用影响输出的操作（检索 / 打开词条）；
- **对外输出**：文章全文存入 `data.output`，不写入历史记录（与万年历 / 天气查询同口径，
  纯文本工具节点）；检索结果列表存入 `data.results` 供切回列表展示。

## 五、新增同类节点的接线检查清单

1. 后端 `node-types.ts` 声明模板 + 端口类型（唯一权威）；
2. 前端 `types/index.ts` `CanvasNodeType` + `nodeTypes.ts`（尺寸/颜色/模板/端口）+ `nodeLayout.ts`；
3. 组件 + `CanvasNodeViews.tsx` 渲染分支 + `BookplatePage.tsx`（`seedDataFor` / 稳定回调）+ `useNodeExecution.ts`；
4. `generation.ts` 展示名；
5. 声明 `output_type: "text"` + 写入 `data.output` 后，占位符 / 文本上下文自动生效。
