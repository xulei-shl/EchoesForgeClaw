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
| `text` | 文本输入 | 无 | `text` | 手动输入或编辑 Markdown 多行文本 |
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
| `art_image_search`| 艺术图片检索 | `text` (关键词) | `image` | 聚合 13 家国际知名博物馆（MET / 大都会 / 荷兰国立等）开放藏品 |
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

0. **先读后连**：连线或引用节点内容前，用 `canvas_list_nodes` 确认节点 ID 与 `has_output` 状态；`canvas_read_node_output` 可读取文本类节点的当前输出（`has_output=false` 说明节点尚未运行或输出为空，先提示用户运行，不要编造内容）。
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

| 节点类型 (`type`) | 典型场景 | `canvas_create_node` 标准入参示例 |
| :--- | :--- | :--- |
| `book_info` | 录入图书/ISBN查书 | `{ "type": "book_info", "data": { "isbn": "9787556130979" } }` |
| `text` | 录入自定义文本 | `{ "type": "text", "data": { "text": "欢迎阅读本书" } }` |
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
