---
name: canvas-node-catalog
description: "33 个默认内置节点与 4 类受管 AI 节点的类型、端口契约、data 参数速查表。当需要挑选节点类型、确认 canvas_create_node 的 data 字段名、或判断两端端口能否连线时使用。"
---

# 画布节点类型目录与接线规范

画板系统节点分为两层：
- **33 个默认内置节点**：无需单独后台算力配置，Agent 可直接推荐参数并调用 `canvas_create_node` 创建，支持使用 `canvas_connect_nodes` 进行简单连线。
- **4 类受管自定义 AI 节点**：依赖特定模型权重与后台提示词绑定，普通用户不可直接在前端空白创建。当用户提出此类定制需求时，Agent 应协助梳理参数并调用 `canvas_send_feedback` 推送到管理员企业微信。

---
> [!IMPORTANT]
> **`book_info` vs `book_card`**：录入图书数据一律用 `book_info`（`data: { isbn: "9787556130979" }`，创建时自动向豆瓣拉取书名/作者/出版社/封面）；`book_card` 是末端排版节点，靠上游连线喂图文。

---

## 一、33 个默认内置节点速查表

### 1. 输入类节点（5 个）
| 节点类型 (`type`) | 中文名称 | 输入端口 | 输出端口 | 关键配置与说明 |
| :--- | :--- | :---: | :---: | :--- |
| `book_info` | 图书元数据 | 无（上游直接输入） | `text` | 豆瓣图书元数据，输入 ISBN 后获取书名/作者/出版社/封面等 |
| `text` | 文本输入 | `text`（仅本节点为空时继承） | `text` | 手动输入或编辑 Markdown 多行文本；正文写入 `data.content` |
| `image_upload` | 图片加载 | `image` (继承) | `image` | 用户上传图片、继承上级图片或选择 AI 产物 |
| `prompt_search` | 提示词检索 | 无 | `text` | 从 Bifrost 提示词库检索选用提示词后供下游使用 |
| `skill_search` | Skill 检索 | 无 | `document` | 从 Bifrost 检索或上传本地 Skill 压缩包传入 Agent |

### 2. 文本工具类节点（7 个）
| 节点类型 (`type`) | 中文名称 | 输入端口 | 输出端口 | 关键配置与说明 |
| :--- | :--- | :---: | :---: | :--- |
| `text_aggregate` | 文本聚合 | `text` (多路) | `text` | 用占位符模板 `{上级别名}` 把多个上级文本按自定义格式拼接 |
| `calendar` | 万年历 | 无 | `text` | 查询指定日期的农历黄历、节假日与万年历信息 |
| `weather` | 天气查询 | `text` (城市名) | `text` | 查询指定城市的天气状况（可连线上级文本节点输入城市） |
| `zhihu_search` | 知乎检索 | `text` (关键词) | `text` | 知乎站内搜索 / 全网搜索 / 直答检索 |
| `wikipedia_search` | Wikipedia 检索 | `text` (关键词) | `text` | Wikipedia 官方公开词条检索，获取条目全文或简介 |
| `text_translation` | 文本翻译 | `text` (待译文本) | `text` | 多引擎翻译，支持 Google / DeepLX 自动降级 |
| `web_search` | 网络搜索 | `text` (关键词) | `text` | 多源全网网络检索（知乎全网 / Tavily / Exa 等） |

### 3. 多模态工具类节点（19 个）
| 节点类型 (`type`) | 中文名称 | 输入端口 | 输出端口 | 关键配置与说明 |
| :--- | :--- | :---: | :---: | :--- |
| `image_search` | 图片检索 | `text` (关键词) | `image` | 免版权图片检索，支持 Unsplash、Pixabay 及 NASA 图片库（`data: { provider: 'nasa-image' }`） |
| `map_poster` | 城市地图海报 | 无 / `text` | `image` | 搜索城市名称，在前端渲染高保真矢量地图海报 |
| `map_art` | 艺术地图生成 | `text` (地点) | `image` | 基于 prettymaps 生成艺术风格地图图片 |
| `pattern_search` | 中国传统纹样 | `text` (关键词) | `image + text` (复合输出) | 100 款传统纹样分类/检索，下游图片节点取图，文本节点取说明 |
| `color_search` | 中国传统配色 | `text` (关键词) | `image + text` (复合输出) | 742 款中国传统色检索，支持 5 色调色板生成器 |
| `receipt_printer` | 图书小票 | `text`, `image` | `image` | 热敏纸小票、借书卡、古籍排版卡片，浏览器端合成图片 |
| `book_card` | 图书卡片 | `text`, `image` | `image` | 书目元数据+封面填入 HTML 模板截图输出，内置 20 种卡片模板 |
| `editorial_layout`| 杂志排版 | `image`, `text` | `image` | Pretext 动态图文避让混排，输出杂志风格高保真海报 |
| `journal_maker` | 手账制作 | `image`, `text` (多图并集) | `image` | 多图拼贴排版（自由缩放/旋转/图层/渐变背景/随机布局） |
| `text_image` | 文本成图 | 无 / `text` | `image` | 手动输入文字调整排版字体/颜色/横竖排，渲染为 1080p 图片 |
| `stamp_cutter` | 邮票制作 | `image`, `text` | `image` | 锯齿邮票框自由截取，生成带打孔边缘与边框的邮票图片 |
| `sticker_maker` | 贴纸制作 | `image`, `text` | `image` | 纯前端 U²-Net AI 抠图去背，生成带白边描边与投影的贴纸 |
| `image_bg_remove` | 抠图 | `image`, `text` | `image` | AI 抠图移除背景，输出透明通道 PNG 或纯色背景图 |
| `image_process` | 图片处理 | `image`, `text` | `image` | 噪点 / ASCII / 网点 / 抖动 / CRT 等滤镜风格化效果 |
| `oil_paint` | 湿油彩效果 | `image`, `text` | `image` | WebGL 流场笔触合成具有颜料厚度与高光的油画效果 |
| `emboss_foil` | 微浮雕高光 | `image`, `text` | `image` | 等高线/浮雕肌理与全息微光反光，内置 8 款材质预设 |
| `glass_refract` | 玻璃折射 | `image`, `text` | `image` | 长虹/十字格/水波/雨夜等 9 种物理玻璃折射高光效果 |
| `watercolor_brush`| 物理水彩手绘 | `image`, `text` | `image` | p5.brush 物理水彩晕染、排线与流场手绘，内置 12 款构图 |
| `ink_wash` | 水墨写意 | `image`, `text` | `image` | 流体动力学水墨晕染、笔触手绘与意境生成，内置 7 款预设 |

### 4. GLAM 工具类节点（2 个）
| 节点类型 (`type`) | 中文名称 | 输入端口 | 输出端口 | 关键配置与说明 |
| :--- | :--- | :---: | :---: | :--- |
| `art_image_search`| 艺术图片检索 | `text` (关键词) | `image` | 聚合 13 家国际知名博物馆（MET / 荷兰国立 / 克利夫兰等）开放藏品；`all` 聚合全部已配置来源，`provider` 可指定其中 11 家（`ai-chicago` / `harvard` 只出现在聚合结果里，不在来源下拉里） |
| `vufind_call_number`| VuFind 馆藏 | `text` (ISBN) | `text` | 根据图书 ISBN 获取中图法分类索书号与馆藏信息 |

---

## 二、4 类受管自定义 AI 节点（不可直接创建，转企业微信工单）

| 节点类型 (`type`) | 中文名称 | 标准输入端口 | 标准输出端口 | 为什么普通用户不能直接创建 |
| :--- | :--- | :---: | :---: | :--- |
| `image_analysis` | 图片分析 | `image`, `text` | `text` | 依赖 Vision 视觉多模态模型与专用提示词 |
| `text_generation` | AI 文本生成 | `text` | `text` | 依赖后台大语言模型配置、采样参数及模版绑定 |
| `image_generation`| 图像生成 | `text`, `image` | `image` | 依赖 SD / FLUX 专用画图通道与配额管理 |
| `chat` | AI 对话 | `text`, `image`, `document` | `text` | 依赖分配独立子进程、会话持久化与专属技能挂载 |

**处理方式**：向用户说明这 4 类节点由管理员在管理端配置与分配算力，画布上无法空白创建；然后帮他梳理模型/提示词/端口方案，按 `canvas-feedback-guide` 的四段式提交工单（`category: "custom_ai_node"`）。

---

## 三、端口匹配与接线规则

0. **先读后连**：连线或引用节点内容前，用 `canvas_list_nodes` 确认节点 ID 与 `has_output` 状态；`canvas_read_node_output` 可读取文本类节点的当前输出。`has_output=false` 时先按本文件第六节判断该类型是否需要 `canvas_run_node` 触发运行；仍为空则如实告知用户节点没有产出，不要编造内容。
1. **类型一致性原则**：
   - `text` 输出 → 连向接受 `text` 的输入端口；
   - `image` 输出 → 连向接受 `image` 的输入端口；
   - 复合输出（`pattern_search`, `color_search` 输出 `image + text`）：当下游是图片节点时自动取图，下游是文本节点时自动取说明文本。
2. **软提示约束**：
   - 当源节点与目标节点端口类型不匹配时（例如 `image_upload` 输出 `image` 连向 `weather` 接受 `text`），连线将标红，并在运行时被忽略。
   - Agent 在推荐或执行 `canvas_connect_nodes` 时，必须确保源节点产出类型落在目标节点的接受列表中。

---

## 四、常用节点创建与 `data` 参数速查字典 (Cheat Sheet)

`canvas_create_node` 的 `data` 参数是扁平 JSON 对象，键名以下表为准：

> [!IMPORTANT]
> **文本类节点的正文键是 `content`，不是 `text`**：`text` / `text_generation` 的正文一律写入 `data.content`。服务端对历史文档误写的 `text` 键做了归一（并在工具回执里返回 `warnings`），但请直接使用 `content`。

| 节点类型 (`type`) | 典型场景 | `canvas_create_node` 标准入参示例 |
| :--- | :--- | :--- |
| `book_info` | 录入图书/ISBN查书 | `{ "type": "book_info", "data": { "isbn": "9787556130979" } }` |
| `text` | 录入自定义文本 | `{ "type": "text", "data": { "content": "欢迎阅读本书" } }` |
| `weather` | 查询指定城市天气 | `{ "type": "weather", "data": { "city": "北京" } }` |
| `calendar` | 万年历/黄历查询 | `{ "type": "calendar", "data": { "date": "2026-09-18" } }` (date可选) |
| `zhihu_search` | 知乎检索 | `{ "type": "zhihu_search", "data": { "query": "藏书票设计" } }` |
| `wikipedia_search` | 维基百科检索 | `{ "type": "wikipedia_search", "data": { "query": "藏书票" } }` |
| `image_search` | 免版权图片检索 | `{ "type": "image_search", "data": { "query": "vintage library", "provider": "unsplash" } }` |
| `map_poster` | 城市地图海报 | `{ "type": "map_poster", "data": { "city": "Shanghai" } }` |
| `glass_refract` | 玻璃折射效果 | `{ "type": "glass_refract", "data": { "presetId": "vintage_cross" } }` |
| `emboss_foil` | 微浮雕高光效果 | `{ "type": "emboss_foil", "data": { "presetId": "topography_opal" } }` |
| `watercolor_brush` | 物理水彩手绘 | `{ "type": "watercolor_brush", "data": { "mode": "spiral_vortex" } }` |
| `ink_wash` | 水墨写意 | `{ "type": "ink_wash", "data": { "mode": "zen_splash" } }` |
| `image_process` | 滤镜处理 | `{ "type": "image_process", "data": { "effectId": "crt" } }` |
| `book_card` | 图书卡片排版 | `{ "type": "book_card", "data": { "templateId": "默认" } }` |
| `receipt_printer` | 图书小票排版 | `{ "type": "receipt_printer", "data": { "templateId": "book_recommend" } }` |

---

## 五、就地修正已有节点（改内容 / 断线 / 删节点）

> [!IMPORTANT]
> **改优先于建、改优先于删**：用户说「换成 / 改成 / 补上 / 去掉」时，先在原节点上改正，**不要新建节点绕过**——新节点会与旧节点并存，画布越改越乱。

| 意图 | 工具 | 要点 |
| :--- | :--- | :--- |
| 改内容 / 换预设 / 调参数 | `canvas_update_node` | `data` 为**浅合并** patch；动手前先用 `canvas_get_node_details` 读现状（避免猜错键名、避免覆盖已有内容）；不确定字段名时用 `canvas_get_node_params` |
| 查某类节点可配哪些字段 | `canvas_get_node_params` | 返回字段名 + 默认值（与节点初始值同源）；预设 ID 的取值域用 `canvas_get_presets` |
| 读某节点的字段现状 | `canvas_get_node_details` | 返回当前 `data`（长文本截断）+ 输入/输出端口 + `has_output` + `config_id` |
| 断开一条连线 | `canvas_disconnect_nodes` | 用 `edge_id`，或用 `source_id` + `target_id` 定位；非破坏、可撤销，无需先向用户确认 |
| 删除节点 | `canvas_delete_node` | 默认 `cascade=true`（连同全部下游子孙一起删，与画布 UI 一致）；工具会**先弹确认框**（含级联数量），用户确认后才执行 |

**不可写的字段**（写入会被拒绝并返回原因）：`isGenerating` / `error` / `output` / `imageUrl`——生成状态与产物只能由节点自身运行产生（防止伪造生成结果）；受管 4 类节点的 `configId` 也不可由助手修改，需要调整请走 `canvas_send_feedback`。

**可撤销**：以上写操作都进入画布撤销栈，改错了用户可以 Ctrl+Z 回退——这一点可以明确告诉用户。

### 常用可写字段速查

完整字段列表（含默认值）以 `canvas_get_node_params(node_type)` 为准，下表只列高频字段：

| 节点类型 | 可写字段 | 取值域 / 说明 |
| :--- | :--- | :--- |
| `text` / `text_generation` | `content` | 正文键就是 `content`（不是 `text`） |
| `text_aggregate` | `template`、`placeholders` | 模板用 `{别名}` 引用各上级 |
| `book_info` | `isbn` | 改 ISBN 会重新拉取书名/作者/封面 |
| `weather` | `city` | 城市名 |
| `calendar` | `date` | `YYYY-MM-DD`，可留空 |
| `zhihu_search` / `wikipedia_search` | `query`、`mode`/`language`、`limit` | 检索关键词与模式 |
| `web_search` | `source`、`count` | `source`: `random`（默认；从后端已配置凭据的源里随机挑一个）/ `zhihu_global` 知乎全网 / `tavily` / `exa` / `anysearch` / `doubao`。**每源结果分开缓存**（`tabData[源]`），切源只换输出不会重检 |
| `text_translation` | `source`、`from`、`to` | `source`: `random` / `google` / `deeplx` |
| `image_search` | `provider` | `provider`: `unsplash`（默认）/ `pixabay` / `nasa-image` |
| `art_image_search` | `provider` | `provider`: `all`（默认，聚合全部已配置博物馆，结果按源轮转交错）/ 单馆：`met` / `rijks` / `artsmia` / `cleveland` / `smk` / `wellcome` / `nypl` / `smithsonian` / `paris` / `europeana` / `loc`（`nypl` / `smithsonian` / `paris` / `europeana` 需配置 Key，未配置选了会报 503） |

> [!IMPORTANT]
> **有固定取值域的字段不要猜**：这些字段的当前可选值用 `canvas_get_node_params(node_type)` 查（返回 `options`）——`art_image_search` 的 `provider` 选项由后端现查（只列已配置凭据、且前端来源下拉支持的博物馆）。写错取值会**静默回退默认源**（`web_search` 非法 `source` → `random`；`image_search` 非法 `provider` → `unsplash`），排查时先核对一次。
| `map_art` | `query`、`preset`、`radius`、`circle` | 地点与样式 |
| `glass_refract` | `presetId`、`scale`、`relief`、`thickness`、`angle`、`dispersion`、`specular` | 预设 ID 见 `canvas_get_presets('glass_refract')` |
| `emboss_foil` | `presetId`、`reliefStyle`、`depth`、`brightness`、`radius`、`lightAngle` | 预设见 `canvas_get_presets('emboss_foil')` |
| `watercolor_brush` | `mode`、`paletteId`、`wiggle`、`bleedStrength`、`textureStrength` | 构图（mode）见 `canvas_get_presets('watercolor_brush')` |
| `ink_wash` | `mode`、`size`、`flow`、`bleed`、`dry`、`color` | 预设见 `canvas_get_presets('ink_wash')` |
| `image_process` | `effectId`、`fxParams` | 滤镜见 `canvas_get_presets('image_process')` |
| `book_card` | `templateId`、`decorIndex` | 模板见 `canvas_get_presets('book_card')` |
| `receipt_printer` | `templateId`、`themeId`、`ditherEnabled` | 模板见 `canvas_get_presets('receipt_printer')` |

**删除的定位纪律**：`node_id` 必须来自 `canvas_list_nodes` 的返回清单，不要凭记忆引用可能已删除的 ID；级联范围由工具在确认框中列出，不要自行推断「删了会少什么」。

---

## 六、运行节点（创建与连线都不会自动运行）

> [!IMPORTANT]
> **除了 `book_info` 与 4 个自动检索类节点的「检索」部分，节点不会自己跑**：创建与连线都不会触发运行，必须调用 `canvas_run_node`。漏掉这一步，节点会一直是 `has_output=false`，用户会以为检索失败。

| 节点类型 | 需要 `canvas_run_node` 吗 | 说明 |
| :--- | :---: | :--- |
| `book_info` | 否 | 创建（或改 `isbn` 后重跑）时自动拉取豆瓣元数据 |
| `image_search` / `art_image_search` / `pattern_search` / `color_search` | **是（选定候选）** | 检索会自动跑（挂载或上游关键词变化时），但**候选只是列表、不是产物**：必须先 `canvas_run_node`（不带 `select_index`）拿到候选清单，选定后**再调一次并传 `select_index`**，图/色板才落到 `imageUrl`；不选就一直没图，下游取不到 |
| `web_search` / `zhihu_search` / `wikipedia_search` / `weather` / `calendar` / `text_translation` / `vufind_call_number` | **是** | 与画布上点「检索 / 查询」按钮同口径 |
| `image_analysis` / `text_generation` / `image_generation` | **是** | 与画布上点「运行」按钮同口径（这 3 类是受管节点，普通用户建不了） |
| `book_card` / `receipt_printer` / `stamp_cutter` / `image_bg_remove` / `sticker_maker` / `journal_maker` / `text_image` / `oil_paint` / `image_process` / `emboss_foil` / `glass_refract` / `watercolor_brush` / `ink_wash` / `editorial_layout` / `map_poster` / `map_art`（16 类） | **是** | 与画布上点「生成 / 导出」同口径：图靠前端渲染或后端生成，**不触发就一直是 `imageUrl=null`**（下游拿不到图）；生成较慢（抠图/水彩/地图尤其），可能回 `status=timeout`——那不是失败 |

调用要点：
- **候选类要先选一个才出图**：`canvas_run_node` 不传 `select_index` 时返回 `status=candidates_ready` 与候选清单（含 `index` / `title` / `subtitle`，供你挑），**此时 `has_output` 仍为 `false`**；挑好后带上 `select_index`（从 0 开始）再调一次，才算选定。挑候选时不要编造：以清单里的标题为依据，必要时把候选描述给用户看。
- **候选可能「不完整」**：`art_image_search` 的 `all` 聚合下，若部分地区性博物馆没取到，回执会带 `warnings`（哪些来源失败、为什么）——候选仍然可用，但这批结果**不是全部来源的**：交付时如实说明，必要时改用单个博物馆（`provider`）或重试；全部来源都失败时工具直接报错（不会返回空候选让你误以为「没有结果」）。
- **创建时一次到位**：输入已就绪（如带 `parent_id` 一起创建检索节点）时，直接 `canvas_create_node(..., run: true)` 一次完成「建 + 跑 + 等产物」；先建后连的场景不传 `run`（会回 warnings「已创建但未运行」），连好上游再 `canvas_run_node`。注意 `run: true` 对候选类节点只完成「检索出候选」，仍要再调 `canvas_run_node(select_index)` 才算定稿。
- **先连后跑**：先确认上游已连线且有产出（`canvas_list_nodes` 看 `has_output`、`canvas_read_node_output` 读上游内容），再运行；缺少输入时工具回 `status=not_started` 与具体原因（如「缺少关键词」），先补输入（`canvas_update_node` 写 `query`，或连线文本节点）再重试，不要空跑。
- **默认等 60 秒**：`status=completed` ＝运行已结束，接着用 `canvas_read_node_output` 读正文；`status=timeout` ＝还没跑完（**不是失败**），稍后直接读输出即可；传 `timeout_ms: 0` 只触发不等待。
- **不要重复触发**：节点 `is_generating=true` 或刚触发过的不要再调。
- 运行结束但没有输出时，如实告知用户「该节点没有产出」，不要编造检索结果。
