---
name: canvas-workflow-patterns
description: "典型画布链路组合模板。当用户想要一整条创作流程（做图书卡片、国风绘画、多源信息汇总、纹样配色排版），而不只是单个节点时使用。"
---

# 典型链路组合

每条链路只使用 **33 个默认内置节点**——可直接 `canvas_create_node` 创建。`→` 表示用 `canvas_connect_nodes` 连线。

**动手前先看现状**：落地任何链路前，先用 `canvas_list_nodes` 摸清画布上已有哪些节点（`has_output` 标记是否已有产出），避免重复创建；链路各环节跑完后，用 `canvas_read_node_output` 抽查关键节点产出（如 `book_info` 的图书元数据是否已拉到、上游文本是否非空）再继续接线或向用户交付。

**已有链路要调整时先改后建**：链路跑通后，用户要改内容/换预设用 `canvas_update_node`（先 `canvas_get_node_details` 读现状）、断开某条连线用 `canvas_disconnect_nodes`、删掉多余节点用 `canvas_delete_node`（会先弹确认框）。不要把「改一下」做成「再建一个」，否则画布上会留下重复节点与冗余连线。

**链路跑之前先把节点跑起来**：除 `book_info`（创建即拉元数据）与 4 个自动检索类节点（`image_search` / `art_image_search` / `pattern_search` / `color_search`）的**检索部分**外，检索类（`web_search` / `zhihu_search` / `wikipedia_search` / `weather` / `calendar` / `text_translation` / `vufind_call_number`）、AI 类（`image_analysis` / `text_generation` / `image_generation`）与 16 个「需渲染出图」的产物类节点（`book_card` / `receipt_printer` / `watercolor_brush` / `map_poster` 等）**创建与连线都不会自动运行**，必须调用 `canvas_run_node` 触发，再用 `canvas_read_node_output` 读产出；输入已就绪时也可以 `canvas_create_node(..., run: true)` 一次到位。`status=not_started` 表示缺少输入（补关键词/上游图片后重试），`status=timeout` 只是还没跑完、**不是失败**。链路下游依赖上游产出：先让上游跑完再接线或向用户交付，不要拿空输出继续往下做（产物类节点不生成就没有图，下游排版节点会一直是空的）。

**候选类节点要「选定」才有产物**：`image_search` / `art_image_search` / `pattern_search` / `color_search` 自动检索出的只是候选列表，`imageUrl` 仍为空——先 `canvas_run_node`（不传 `select_index`）拿回候选清单，选定后带上 `select_index` 再调一次，图/色板才落盘；没选定的图**不能**接给下游排版节点。

## 1. 图书卡片流
`book_info` → `book_card`
- 场景：按 ISBN 或书名生成一张分享卡片。
- 要点：`book_info` 只负责录数据（`data: { isbn: "9787556130979" }`，创建后自动拉取书名/作者/封面）；`book_card` 只负责排版呈现，**必须接收上游连线**，绝不能用它来录图书。
- 延伸：`book_info` → `text_aggregate`（套推荐语模板）→ `book_card`。

## 2. 图书小票流
`book_info` → `receipt_printer`
- 场景：热敏纸风格的推荐小票、借阅记录卡、摘录折页。`data: { templateId: "book_recommend" }`。

## 3. 国风水彩 / 水墨流
`image_upload` → `watercolor_brush`（或 `ink_wash`）→ `stamp_cutter`
- 场景：把用户上传的照片转成水彩或水墨质感，再套邮票边框。
- 要点：先问用户想要的气质（如「朦胧」「写意」「复古」），再据此从 `canvas-multimodal-presets` 选 `mode`。

## 4. 多源信息聚合流
`book_info` + `weather` + `calendar` → `text_aggregate`
- 场景：把图书信息、天气、黄历拼成一段成稿文案。
- 要点：`text_aggregate` 的 `data: { template: "..." }` 用 `{别名}` 占位符引用各上级文本。

## 5. 传统纹样 / 配色排版流
`pattern_search`（或 `color_search`）→ `editorial_layout`
- 场景：用传统纹样或传统色做杂志感海报。
- 要点：这两个节点输出 `image + text` 复合结果，下游是图片节点时自动取图、是文本节点时自动取说明文本。
- 要点：**先选定一个纹样/配色再排版**（`canvas_run_node` 取候选 → 带 `select_index` 再调一次），否则 `editorial_layout` 拿到的是空图。

## 需要受管 AI 节点时

以上链路若用户还想插入 AI 生成与视觉分析，那 4 类受管节点（`image_generation`、`text_generation`、`image_analysis`、`chat`）普通用户建不了。做法：说明原因 → 用 `canvas-feedback-guide` 的四段式把方案提交成工单 → 管理员在管理端建好后再接入链路。
