# AI Agent 里的文件流转:上传与产物存储的完整设计

做 Agent 平台时,文件处理是一个看似简单、却最容易在架构上踩坑的环节。它分两个方向:**用户上传的文件如何到达模型**,以及 **Agent 执行过程中生成的产物如何被记录和交付** 。这两件事表面上是"一进一出",但底层遵循同一条原则。本文把这条链路从原理到实现讲清楚,并附上关键代码与数据结构。

贯穿全文的一条主线:

> **文件本体永远存放在上下文之外(对象存储 / 沙箱 / 网络盘),对话里流动的只是引用。需要时再按引用取回。**

下文涉及的实现细节,部分来自对两个开源 Agent(hermes、openclaw)的源码分析,会标注其做法作为参照。

---

## 一、文件上传:如何把用户文件递给模型

### 1.1 前提认知:上传 ≠ 自动给模型

一个常见误解是"用户上传了文件,模型就能看到了"。实际上:

- • 用户上传文件,只是文件落到了你的存储/磁盘里;
- • **模型(及底层 API)对这个文件一无所知**;
- • 必须由你的后端代码,在构造请求时主动把文件内容"递"给模型。

模型本身不执行任何 I/O,它只能看到你放进请求里的东西。所以"怎么递",是一个需要按文件类型、大小、用途分流的设计问题。

### 1.2 上传文件先落存储,拿到 file\_id

在把文件递给模型之前,必须先把它持久化——这一步和产物存储是对称的:

- • 文件本体上传对象存储:`tenants/<tenant_id>/files/<file_id>` (租户隔离);
- • 元数据写入数据库(文件名、类型、大小、归属会话);
- • 后续无论哪种递送方式,都用 file\_id 引用,不依赖临时路径。

上传文件和生成产物可以 **共用一张 files 表** (用 `origin` 区分),也可拆成独立的 uploads / artifacts 表。统一表示例:

```
CREATE TABLE files (
  id              TEXT PRIMARY KEY,   -- file_id
  tenant_id       TEXT NOT NULL,
  conversation_id TEXT,
  origin          TEXT NOT NULL,      -- 'upload' | 'artifact'
  message_id      TEXT,               -- 上传:对应用户消息;产物:生成那轮
  filename        TEXT,
  content_type    TEXT,
  size_bytes      BIGINT,
  storage_key     TEXT,               -- 对象存储 key
  sha256          TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

> 参照 hermes:用户上传的文件存磁盘(`~/.hermes/kanban/attachments/<task_id>/`)+ SQLite `task_attachments` 表(`stored_path` 、 `content_type` 、 `size`)。但 hermes 是单机存磁盘;分布式平台必须存对象存储 + file\_id,理由见 §2.3。

对走沙箱那条路的大文件,worker 会把对象存储里的文件"注水"到沙箱工作区供模型用工具读取—— **沙箱本身不持有对象存储凭证**,由 worker 中转。

### 1.3 三类文件,三种递送方式

| 类型                 | 递送方式                          | 第一次请求就给?      | 谁读取内容       |
| -------------------- | --------------------------------- | -------------------- | ---------------- |
| 图片                 | 多模态内容块(base64 或文件引用)   | 是                   | 模型原生解码     |
| 小文本               | 读出内容,作为文本块放进 user 消息 | 是                   | 后端读取         |
| 大文件 / 数据 / 代码 | 不注入,落沙箱,提供 read/grep 工具 | 否(模型多轮调工具读) | 模型自己用工具读 |

判断"走哪条路"是后端在请求前完成的,不是模型决定。

### 1.4 图片:多模态内容块

模型原生支持视觉输入,图片作为 `image` 类型的内容块传入即可。推荐用文件引用(file\_id)而非每轮重发 base64:

```prolog
{
  "role": "user",
  "content": [
    { "type": "text", "text": "分析这张图表" },
    { "type": "image", "source": { "type": "url", "url": "https://cdn.example.com/chart.png" } }
  ]
}
```

> 注意:图片也消耗 token,高分辨率更多。用 file\_id / URL 引用的好处是"上传一次、多轮复用",不必每轮重发。

### 1.5 小文本:注入到 user 消息(而非系统提示)

几 KB 的配置、代码片段,后端读出内容,作为文本块放进 **当前这一轮的 user 消息**:

```prolog
{
  "role": "user",
  "content": [
    { "type": "text", "text": "这是配置文件 config.yaml:" },
    { "type": "text", "text": "<文件内容>" },
    { "type": "text", "text": "帮我检查配置是否有问题" }
  ]
}
```

**关键:放进 user 消息,不要放进 system prompt。** 系统提示需要保持稳定以命中 prompt cache;文件内容是本次会话特有的、易变的,塞进系统提示会使缓存前缀变化,导致整段缓存失效、成本升高。

### 1.6 大文件:落沙箱 + 工具按需读取(控制流的核心)

几万行日志、CSV、整个代码目录,**绝不整块注入上下文** 。正确做法是把文件放进沙箱工作区,只告诉模型路径,由模型通过工具按需读取。控制流如下:

```
第 1 次请求:不放文件内容,只给"文件在 /workspace/data.log + 可用工具"
  ↓
模型返回 tool_call: grep("ERROR", "/workspace/data.log")   ← 模型自己决定怎么读
  ↓
harness 在沙箱执行,返回命中行 + 行号
  ↓
模型返回 tool_call: read("/workspace/data.log", offset=1200, limit=50)
  ↓
harness 执行,返回该片段
  ↓
模型给出最终答案
```

对应的 Agent 循环(伪代码):

```
let messages = [
  { role: "system", content: SYSTEM },
  { role: "user", content: "用户上传了 /workspace/data.log,帮我找出所有报错并分析" },
];

while (true) {
  const resp = await llm.create({ messages, tools: [grepTool, readTool] });
  if (resp.stop_reason !== "tool_use") break;          // 没有工具调用 = 结束

  messages.push({ role: "assistant", content: resp.content });
  const results = [];
  for (const call of resp.content.filter(b => b.type === "tool_use")) {
    const out = await runInSandbox(call.name, call.input);  // 在沙箱执行 grep/read
    results.push({ type: "tool_result", tool_use_id: call.id, content: out });
  }
  messages.push({ role: "user", content: results });
}
```

要点:大文件场景 **不是"第一次就把内容给模型",而是"给路径 + 给工具,模型自己多轮读取"** 。读取顺序通常是 `glob 找文件 → grep 定位 → read 读局部`,把"大"在进入上下文之前就过滤掉。

### 1.7 红线:不要把文件 base64 内联进消息历史

把文件内容 base64 塞进消息是最差的做法:

- • 每一轮请求都会重发一遍,token 反复消耗;
- • 它会永久驻留在对话历史里,上下文压缩也带不走;
- • 文件稍大就会撑爆请求体。

无论哪种类型,**上传的文件一律先落对象存储拿到 file\_id**,再按上面三类决定如何递送。

### 1.8 两个开源项目的实际做法

| 类型   | hermes                                           | openclaw                                                     |
| ------ | ------------------------------------------------ | ------------------------------------------------------------ |
| 图片   | 读出转 base64,作为 `image_url` 多模态块,第一轮给 | base64 多模态块,第一轮给                                     |
| 文本   | **冷引用**  :只给路径,模型用 `read_file` 自己读  | **热注入**  :读出内容拼进系统提示(`extraSystemPrompt`)       |
| 大文件 | 磁盘 + `read_file` (500 行,offset/limit 分页)    | 工作区挂沙箱 + `read` (自适应分页 32KB/最多 4 页/offset 续读) |

值得注意的分歧:文本文件 openclaw 选择热注入到系统提示——这会破坏 prompt cache。若要热注入,应放 user 消息;若文件大或需跨轮复用,hermes 的冷引用更省。

---

## 二、产物存储:如何记录 Agent 生成的文件

### 2.1 反直觉:shell 命令生成的文件不会自动被捕获

假设 Agent 执行 `python make_report.py` 生成了 `report.pdf`:

```julia
工具调用:bash("python make_report.py")
工具结果:只返回 stdout / stderr 文本
report.pdf:静静躺在工作区,没有任何机制记录它
```

**普通 shell/exec 命令只返回文本输出,生成的文件不会被自动暴露给用户。** 这是设计产物存储时必须先意识到的前提。

### 2.2 产物检测的三种方式

| 方式                         | 做法                                                         | 特点                                              |
| ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------- |
| (a) 工具结果带路径           | 生成类工具(画图、生成文件)在结果里返回路径                   | 结构化、可靠,但只覆盖"专门工具"                   |
| (b) 模型声明                 | 模型在文本里输出 `MEDIA:/path` 之类标记                      | 最简单,但 **靠模型自觉,会漏**                     |
| (c) 约定输出目录 + diff 检测 | 约定 `/workspace/outputs`,执行前后对工作区拍快照,扫描新增/变更文件 | **最可靠,能捕获 shell 写的文件**  ,不依赖模型自觉 |

两个开源项目分别用了 (a) 和 (b):

- • **hermes**:模型在回复文本里写 `MEDIA:/path`,后端用正则提取(`prompt_builder.py:448` 、 `mcp_serve.py:176`);
- • **openclaw**:特定生成类工具返回 `mediaUrls`,记录到 assistant 消息的 `MediaPath` 字段(`embedded-agent-subscribe.ts:137` 、 `chat.ts:1121`)。

两者都依赖"声明",普通 shell 写的文件都会漏。要可靠捕获,推荐 (c) 为主、(a)/(b) 为补充。diff 检测的实现(伪代码):

```cpp
// 执行前:记录输出目录基线(路径 → mtime/size)
const before = snapshotDir("/workspace/outputs");

await runAgentTurn();  // 跑一轮,期间可能生成文件

// 执行后:扫描新增/变更
const after = snapshotDir("/workspace/outputs");
const changed = diff(before, after);   // 新增 + mtime 变化的文件

for (const filePath of changed) {
  await captureArtifact(filePath);     // 见 2.4:上传对象存储 + 入库
}
```

> 实现要点:diff 只比"新增/mtime 变化",不要每次全量 hash 整棵树;大项目场景配合 2.5 的网络盘 + 遍历,不必逐文件 diff。

### 2.3 分布式平台不能照搬单机方案

hermes / openclaw 都是单机运行:文件留在本地磁盘,按路径访问,天然可行。它们的存储策略是"留本地 + 路径引用 + 一个带白名单校验的读盘端点",**既不上传对象存储,也不入库** 。

但多租户分布式平台不能照抄,原因有三:

- • worker / 沙箱是临时的,任务结束即回收,本地文件随之消失;
- • 用户下次交互可能落到另一台 worker,本地路径无法访问;
- • 多副本横向扩展,文件在哪台机器不确定。

**结论:分布式平台必须把产物上传到公共对象存储,并入库用 file\_id 寻址,不能依赖本地路径。**

### 2.4 单文件产物:对象存储 + artifacts 表

检测到产物后,由 worker(宿主机侧,有文件系统访问和存储凭证)完成:

```
worker 读出文件
  → 上传对象存储 tenants/<tenant_id>/files/<file_id>
  → 写 artifacts 表(挂 message_id,记录"哪一轮产生")
  → 工具结果里带 file_id + 预览给模型;前端按记录渲染下载/预览
```

artifacts 表设计(与 §1.2 的 files 表对称,可合并为一张表用 `origin` 区分,这里单列以展示产物特有字段):

```
CREATE TABLE artifacts (
  id              TEXT PRIMARY KEY,   -- file_id
  tenant_id       TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id      TEXT,               -- 哪一轮/哪条消息产生的
  filename        TEXT,
  content_type    TEXT,
  size_bytes      BIGINT,
  storage_key     TEXT,               -- 对象存储 key
  sha256          TEXT,               -- 校验/去重
  source          TEXT,               -- 哪个工具产生(exec/write/code)
  kind            TEXT,               -- 'file' | 'project_snapshot'
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

注意:**产物只给模型 file\_id + 预览,不要把整块内容回灌上下文** (大文件会爆 token)。

### 2.5 项目产物:持久网络盘 + 遍历生成树

如果 Agent 生成的是一整个项目(几百上千文件 + 目录结构),逐个文件入库是错误的——文件频繁增删改,记录立刻过期,且与文件系统重复。

正确做法是把工作区做成持久的:

- • **持久网络盘(EFS/NFS)**:工作区挂进沙箱 `/workspace`,文件写入即落盘、不丢、换 worker 可重新挂载——这是"不能丢"的最强保证;
- • **目录树**:由后端遍历文件系统生成(不靠模型声明),可缓存 manifest;
- • **快照**:里程碑把整个项目打包成 zip 上传对象存储,作为一个 `project_snapshot` 类型的 artifact 入库(用于下载、版本、备份)。

工作区记录单独建表,与 artifacts 分开:

```
-- 工作区:跟踪"项目在网络盘的哪个位置"(一行)
CREATE TABLE workspaces (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  fs_location     TEXT,               -- 网络盘上的路径/卷
  status          TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 可选:目录树缓存(派生数据,非权威)
CREATE TABLE workspace_manifests (
  workspace_id TEXT NOT NULL,
  turn_id      TEXT NOT NULL,
  tree_json    JSONB,
  created_at   TIMESTAMPTZ DEFAULT now()
);
```

三者分工:`workspaces` 表记录项目位置,网络盘存文件本体(权威),`artifacts` 表只记录离散交付物(单产物文件 + 项目导出 zip)。

### 2.6 单文件 vs 项目(分水岭)

|              | 单个产物文件                          | 整个项目工作区                 |
| ------------ | ------------------------------------- | ------------------------------ |
| 怎么发现     | 工具吐路径 / 模型声明 / 约定目录+diff | worker 遍历文件系统            |
| 持久化       | 对象存储 + artifacts 表(一行一个)     | 持久网络盘 + 快照 zip          |
| 是否逐个入表 | 是                                    | 否(文件不入表;仅导出 zip 一行) |
| 展示         | 内联 / 下载链接                       | 目录树 + 文件浏览              |
| 适合         | 一两个交付文件                        | 几十上百文件的项目             |

---

## 三、渲染与展示

### 3.1 渲染格式:优先成熟库,不要手搓

前端要渲染 Markdown、代码高亮、表格、图片、数学公式、图表等。两个开源项目的对比很说明问题:

- • **hermes**:为支持更多格式(KaTeX 公式、Mermaid 图表、PDF 缩略图等),Markdown 解析和 XSS 防护 **都自己手写** (无 DOMPurify),功能丰富但维护成本高、安全风险大;
- • **openclaw**:全部用成熟库(markdown-it / highlight.js / DOMPurify),功能更克制但更稳。

#### 可渲染的内容类型(完整清单)

一个成熟的 Agent 前端通常要覆盖以下内容类型(综合两个开源项目的实现):

**文本类**

| 类型              | 说明                                                         |
| ----------------- | ------------------------------------------------------------ |
| Markdown 全特性   | 标题、有序/无序列表、加粗、斜体、删除线、引用块、水平线、链接、行内代码 |
| 任务列表          | `- [x] / - [ ]`  勾选项                                      |
| 代码块 + 语法高亮 | 多语言,带语言标签、复制按钮                                  |
| 表格              | Markdown GFM 表格;CSV 块可转表格                             |
| 数学公式          | 行内 `$...$` / 块级 `$$...$$` (KaTeX),含 `\[...\]` 、 `\(...\)` |
| 图表 / 流程图     | Mermaid:流程图、时序图、类图、状态图、ER 图、甘特图、饼图等  |

**媒体类**

| 类型        | 说明                                                         |
| ----------- | ------------------------------------------------------------ |
| 图片        | 内联(URL / file\_id)、点击放大(lightbox)、下载;PNG/JPG/GIF/WebP/SVG/AVIF 等 |
| 音频 / 视频 | HTML5 播放器,支持 range 拖动进度                             |
| PDF         | 首页缩略图预览,或下载链接                                    |

**工具结果专门卡片** (代码执行类平台尤其重要)

| 类型              | 说明                                 |
| ----------------- | ------------------------------------ |
| diff 高亮         | 增 / 删 / hunk 行着色                |
| 终端输出          | 命令 + stdout/stderr + 退出码,可折叠 |
| JSON / YAML       | 可折叠树视图、自动检测纯 JSON 消息   |
| CSV / 数据        | 表格化展示                           |
| 文件预览          | 读文件结果、生成的图片产物           |
| HTML 沙箱         | `iframe sandbox`  隔离渲染           |
| Excalidraw / 画板 | JSON 渲染为图形(部分实现)            |

**其他**

| 类型                | 说明                                                 |
| ------------------- | ---------------------------------------------------- |
| 思考 / reasoning 块 | 可折叠展示模型推理过程                               |
| 引用 citation       | 来源标注                                             |
| 流式渲染            | 边生成边渲染(streaming markdown)                     |
| HTML 消毒           | DOMPurify 白名单过滤(渲染任何含 HTML 内容的安全前提) |

> 不必全做。基础是 Markdown + 代码高亮 + 图片 + 表格;技术/学术类再加 KaTeX、Mermaid;代码执行类优先做 diff / 终端 / 文件预览这些工具结果卡片。

#### 落地建议——一律用成熟库

| 能力      | 用什么                                   | 必要性                  |
| --------- | ---------------------------------------- | ----------------------- |
| Markdown  | `markdown-it`  (+ GFM / task-lists 插件) | 基础                    |
| 代码高亮  | `highlight.js`  或 `shiki`               | 基础                    |
| HTML 消毒 | **`DOMPurify` (强制)**                   | **必须,不要手写黑名单** |
| 数学公式  | `KaTeX`  (按需)                          | 技术/学术类才上         |
| 图表      | `mermaid`  (按需)                        | 需要流程图才上          |
| 流式渲染  | streaming-markdown 方案                  | 体验加分                |

**为什么不手搓**:手写 Markdown parser 边界 case 多、易出 bug;**手写 XSS 黑名单是真实安全风险** ——黑名单永远防不全,必须用经过审计的成熟库。

另外,代码执行类平台,**工具结果的专门卡片(diff 高亮、终端输出、文件预览、JSON 折叠)比花哨格式更有价值**,优先做这些。

### 3.2 目录树:阈值自适应(兼容文件少 / 文件多)

后端遍历时统计节点数,返回里带 `mode`,前端按 mode 渲染:

| 规模              | mode   | 做法                                                    |
| ----------------- | ------ | ------------------------------------------------------- |
| 少(< 阈值,如 500) | `full` | 返回完整嵌套树,前端一次性渲染                           |
| 多(≥ 阈值)        | `lazy` | 只返回根层,目录标 `hasChildren`;展开才拉子层 + 虚拟滚动 |

大项目的关键手段:

- • **懒加载**:点开文件夹才请求那一层;
- • **虚拟滚动**:只渲染视口内的 DOM(react-window / TanStack Virtual),防几千节点卡死;
- • **搜索代替手动展开**:按文件名查,不必逐层点;
- • **剪枝**:跳过 `.git` / `node_modules` / `dist`,否则节点数爆炸。

节点结构:

```json
{
  "name": "index.ts",
  "path": "/src/index.ts",
  "type": "file",
  "size": 1240,
  "hasChildren": true,
  "childCount": 42
}
```

`hasChildren` 让你不加载子项也能正确显示展开箭头。

三个接口:

```elixir
GET /workspaces/:id/tree                    → { mode: "full"|"lazy", tree }
GET /workspaces/:id/tree?path=/src&depth=1  → 懒加载单层 { children, hasMore }
GET /workspaces/:id/tree/search?q=user      → 搜索命中文件
```

### 3.3 文件查看:点击才取,单独接口,按类型分流

目录树只携带元数据,**文件内容在点击时才单独请求**,且按类型/大小分流(与"大文件喂模型"同一套原则):

| 文件              | 取法                                                         | 前端展示                    |
| ----------------- | ------------------------------------------------------------ | --------------------------- |
| 小文本/代码       | `GET /file?path=`  → JSON `{content, mime, size}`            | 语法高亮                    |
| 大文本/大日志     | 分页:`?path=&offset=0&limit=2000` → `{content, nextOffset, hasMore}` | 增量加载 / 虚拟滚动         |
| 图片              | 流式 URL                                                     | `<img src="/raw?path=">`    |
| 音视频            | 流式 URL(支持 range)                                         | `<audio>/<video>`  可拖进度 |
| PDF               | 流式 URL                                                     | PDF 预览器                  |
| 大二进制/不可预览 | 签名下载 URL                                                 | 仅"下载"按钮                |

接口示例:

```elixir
# 文本类:走 JSON
GET /workspaces/:id/file?path=/src/index.ts
→ { "content": "...", "mime": "text/typescript", "size": 1240 }

# 大文本:分页 / range
GET /workspaces/:id/file?path=/huge.log&offset=0&limit=2000
→ { "content": "...", "nextOffset": 2000, "hasMore": true }

# 媒体/二进制:流式端点,支持 HTTP 206 Partial Content
GET /workspaces/:id/raw?path=/demo.mp4
→ (二进制流,Content-Type + Range)
```

要点:

- • 文本走 JSON;图片/媒体/二进制 **不要塞进 JSON**,走流式端点 + range 请求,前端把 `<img>/<video>` 直接指过去;
- • 大文本 **不要整块返回**,用 offset 分页(与 Agent 的 read 工具同理),几十 MB 日志整块塞前端会卡死;
- • 前端配合:加载态、客户端缓存(配 ETag,打开过秒开)、取消在途请求、超大文件兜底仅给下载。

---

## 四、统一模型与安全红线

把"进"和"出"合起来看,是同一个模型:

> **文件本体始终在上下文之外(对象存储 / 沙箱 / 网络盘),对话里流动的只是引用,需要时按引用取回。**
>
> - • 进来的文件:按类型决定如何递给模型(图片多模态块 / 小文本进消息 / 大文件落沙箱给工具);
> - • 出去的产物:主动检测(优先约定目录 + diff)→ 上传对象存储 + 入库 → 给用户可下载、可预览的入口;
> - • 多文件项目:持久网络盘 + 遍历生成树,只把导出 zip 入库。

贯穿全链路的安全约束:

| 约束                     | 说明                                       |
| ------------------------ | ------------------------------------------ |
| 产物读写由 worker 完成   | 沙箱容器不持有对象存储凭证                 |
| 文件名做 basename        | 防路径穿越;`path` 必须落在工作区目录内     |
| 大文件给 file\_id + 预览 | 不整块回灌上下文                           |
| 所有文件/树/下载端点     | 租户鉴权 + 路径白名单;大文件重定向签名 URL |
| HTML 渲染                | 必须 DOMPurify,不手写黑名单                |
| 文件/工具结果内容        | 当数据处理,不当指令(防 prompt injection)   |

文件是 Agent 系统里最占空间、最该"收进抽屉"的资源。把它们留在上下文之外、只在对话里传引用,是这套设计的根本。