# 图书小票节点（Receipt Printer）开发完成 Walkthrough

在 EchoesForgeClaw 画板中新增了专门用于阅读推广、书目推荐与复古借阅打卡凭证生成的 **「图书小票节点（`receipt_printer`）」**。

---

## 一、模块化架构设计（KISS · 高内聚低耦合）

遵循高内聚低耦合原则，核心小票功能集中于 `frontend/src/modules/multimodal/receipt/` 独立子模块中，支持未来灵活扩展新模板与配色：

```
frontend/src/modules/multimodal/receipt/
├── types.ts              # 小票核心数据结构接口（ReceiptState, ReceiptItem, Theme 等）
├── themes.ts             # 5 款热敏纸经典配色方案（素白、米黄、淡粉、薄荷绿、浅紫）及动态注册表
├── dither.ts             # 轻量纯 Canvas 图片点阵化（Floyd-Steinberg/Atkinson）算法
├── barcode.ts            # 轻量 Code 128 / EAN13 条形码与二维码绘制引擎（零外部库依赖）
├── templates.ts          # 3 类预设模板（书目推荐、借阅打卡、经典清单）与图书元数据自动映射器
├── exportReceipt.ts      # 高清小票图片 Canvas 离屏合成与 PNG 导出引擎（含锯齿边缘）
├── index.ts              # 统一导出入口
└── components/
    ├── ReceiptPaper.tsx        # 纯视觉与所见即所得内联编辑的小票纸张组件（锯齿边缘、就地修改、增删条目）
    ├── ReceiptToolbar.tsx      # 顶部快捷工具栏（模板切换、颜色选择、点阵开关、同步元数据）
    └── ReceiptPrinterNode.tsx  # 节点主容器组件（负责画板连线数据流集成、历史记录保存与操作分发）
```

---

## 二、核心功能与特性

### 1. 声明式接线与多源图片支持
* **端口声明**：`output_type: 'image'`，`input_types: ['text', 'image']`；
* **图片多源自动注入**：
  * 支持接收上游图片节点输出（如 `image_generation` 藏书票图、`art_image_search` 艺术画、`image_upload` 上传图）；
  * 支持从连线或根节点的 `book_info` 自动加载图书封面；
  * 支持节点内直接点击上传/替换本地图片；
* **Lo-Fi 热敏点阵化（Dithered Print）**：
  * 内置纯前端 Atkinson 误差扩散点阵化算法，一键呈现复古热敏打印机黑白颗粒质感。

### 2. 图书元数据多级穿透继承、根节点兜底与人工二次编辑
* **多级穿透与根节点兜底**：
  * 支持沿连线链路向上多级 BFS 追溯（如 `book_info` → `image_generation` / `chat` → `receipt_printer`）自动穿透继承连通的图书元数据；
  * 无上游连线时，默认自动兜底使用画布根图书元数据节点（`book_info`）的信息自动填充小票；
  * 与系统中 `ChatNode`、`execution.ts` 和 `useGenerationHistory.ts` 保持完全一致的继承逻辑；
* **自动映射与异步刷新响应**：
  * 精准感知上游图书元数据异步抓取完成或切换书籍，自动提取题名、作者、译者、出版社、出品方、丛书、年份、豆瓣评分、ISBN 条形码与封面；
* **就地内联编辑**：所有字段直接在小票上点击即可就地修改；
* **索书号与评分**：索书号（Call No）专设字段，默认留空，支持人工输入；
* **顶部工具栏「重置为默认」与「点阵滤镜」**：内聚在小票卡片顶部工具栏，随时一键将小票重置回当前模板初始态或切换黑白热敏点阵。

### 3. 灵活的预设模板与主题配色
* **4 套预设场景模板**：
  1. `book_recommend`：**书目推荐小票**（阅读推广、馆藏推荐、图书凭证）；
  2. `reading_log`：**借阅记录卡**（借阅记录、打卡心得、阅读星级）；
  3. `itemized`：**经典清单小票**（品名、数量、价格、TOTAL 总计）；
  4. `retro_menu`：**复古菜单**（复刻复古纸质菜单排版，上下双图并支持点阵滤镜，具备锯齿边框缺口样式，文本映射图书元数据为菜品）。
* **5 套热敏纸配色**：
  * 经典素白 (`#FDFDFC`)
  * 复古米黄 (`#F6EFE1`)
  * 淡雅粉红 (`#FCE7EB`)
  * 薄荷淡绿 (`#E2F4EA`)
  * 梦幻浅紫 (`#EDE7F6`)

### 4. 高清图片导出、数据库持久化与全局操作栏联动（完全对齐 ImageNode）
* **高保真导出与落盘**：Canvas 离屏渲染，带有真实锯齿撕纸边缘（Zigzag Edge）、点阵图、虚线分割线和标准条形码；调用后端 `/modules/bookplate/save-image` 落盘；
* **右下角操作栏（NodeActionBar）对齐 ImageNode 标准**：
  * **生成 / 重新生成**：未生成时显示「生成并保存小票」，生成后显示「重新生成并保存小票」；
  * **收藏（Heart）**：支持切换收藏状态（`onToggleFavorite` + `runToggle` 操作提示）；
  * **公开到画廊（Globe）**：支持切换公开到画廊（`onTogglePublic` + `runToggle` 操作提示）；
  * **下载（Download）**：一键导出 2x 高清 PNG 文件；
  * **删除（Trash2）**：删除节点；
* **全画板选中与全局操作栏联动**：
  * 生成小票落盘后，自动通过 `setSelectedImageId` 选中当前节点并外框高亮；
  * 画布顶部全局操作栏可无缝识别并对选中的小票执行收藏/公开/查看；
* **数据库持久化（generations 表）**：自动创建 Generation 记录（stage1 图书元数据、stage2 小票信息、stage3 生成的图片），并在跨 tab 同步与恢复时具备完整性。

---

## 三、修改与新建的文件清单

| 状态 | 文件路径 | 职责说明 |
|---|---|---|
| **NEW** | [`frontend/src/modules/multimodal/receipt/types.ts`](file:///f:/Github/EchoesForgeClaw/frontend/src/modules/multimodal/receipt/types.ts) | 核心数据结构与契约定义 |
| **NEW** | [`frontend/src/modules/multimodal/receipt/themes.ts`](file:///f:/Github/EchoesForgeClaw/frontend/src/modules/multimodal/receipt/themes.ts) | 5 款热敏纸配色与主题注册表 |
| **NEW** | [`frontend/src/modules/multimodal/receipt/dither.ts`](file:///f:/Github/EchoesForgeClaw/frontend/src/modules/multimodal/receipt/dither.ts) | Canvas 像素级热敏点阵抖动算法 |
| **NEW** | [`frontend/src/modules/multimodal/receipt/barcode.ts`](file:///f:/Github/EchoesForgeClaw/frontend/src/modules/multimodal/receipt/barcode.ts) | Code 128 条形码生成与绘制引擎 |
| **NEW** | [`frontend/src/modules/multimodal/receipt/templates.ts`](file:///f:/Github/EchoesForgeClaw/frontend/src/modules/multimodal/receipt/templates.ts) | 模板定义与图书元数据映射器 |
| **NEW** | [`frontend/src/modules/multimodal/receipt/exportReceipt.ts`](file:///f:/Github/EchoesForgeClaw/frontend/src/modules/multimodal/receipt/exportReceipt.ts) | 高清小票 Canvas 离屏导出引擎 |
| **NEW** | [`frontend/src/modules/multimodal/receipt/index.ts`](file:///f:/Github/EchoesForgeClaw/frontend/src/modules/multimodal/receipt/index.ts) | 模块统一导出入口 |
| **NEW** | [`frontend/src/modules/multimodal/receipt/components/ReceiptPaper.tsx`](file:///f:/Github/EchoesForgeClaw/frontend/src/modules/multimodal/receipt/components/ReceiptPaper.tsx) | 小票纸张渲染与内联编辑组件 |
| **NEW** | [`frontend/src/modules/multimodal/receipt/components/papers/RetroMenuPaper.tsx`](file:///f:/Github/EchoesForgeClaw/frontend/src/modules/multimodal/receipt/components/papers/RetroMenuPaper.tsx) | 复古菜单模板 |
| **NEW** | [`frontend/src/modules/multimodal/receipt/components/ReceiptToolbar.tsx`](file:///f:/Github/EchoesForgeClaw/frontend/src/modules/multimodal/receipt/components/ReceiptToolbar.tsx) | 模板、配色、点阵滤镜与重置快捷切换工具栏 |
| **NEW** | [`frontend/src/modules/multimodal/components/ReceiptPrinterNode.tsx`](file:///f:/Github/EchoesForgeClaw/frontend/src/modules/multimodal/components/ReceiptPrinterNode.tsx) | 节点主容器组件（对齐 ImageNode 的操作栏、收藏/公开与全局联动） |
| **MODIFY** | [`backend-ts/src/modules/bookplate/node-types.ts`](file:///f:/Github/EchoesForgeClaw/backend-ts/src/modules/bookplate/node-types.ts) | 注册 `receipt_printer` 模板与端口声明 |
| **MODIFY** | [`frontend/src/platform/types/index.ts`](file:///f:/Github/EchoesForgeClaw/frontend/src/platform/types/index.ts) | `CanvasNodeType` 追加 `'receipt_printer'` |
| **MODIFY** | [`frontend/src/modules/bookplate/nodeTypes.ts`](file:///f:/Github/EchoesForgeClaw/frontend/src/modules/bookplate/nodeTypes.ts) | 注册节点尺寸、颜色、模板与端口静态镜像 |
| **MODIFY** | [`frontend/src/modules/bookplate/nodeLayout.ts`](file:///f:/Github/EchoesForgeClaw/frontend/src/modules/bookplate/nodeLayout.ts) | 注册节点布局尺寸 |
| **MODIFY** | [`frontend/src/modules/bookplate/seedData.ts`](file:///f:/Github/EchoesForgeClaw/frontend/src/modules/bookplate/seedData.ts) | 注册节点初始种子数据 |
| **MODIFY** | [`frontend/src/modules/bookplate/CanvasNodeViews.tsx`](file:///f:/Github/EchoesForgeClaw/frontend/src/modules/bookplate/CanvasNodeViews.tsx) | 节点渲染树接入 `receipt_printer` 并注入收藏/公开等标准回调 |
| **MODIFY** | [`frontend/src/modules/bookplate/useNodeHandlers.ts`](file:///f:/Github/EchoesForgeClaw/frontend/src/modules/bookplate/useNodeHandlers.ts) | 增加小票保存、落盘、选中与数据库持久化回调 |
| **MODIFY** | [`frontend/src/modules/bookplate/useGenerationHistory.ts`](file:///f:/Github/EchoesForgeClaw/frontend/src/modules/bookplate/useGenerationHistory.ts) | `buildStageResults` 适配 `receipt_printer` 数据组装 |
| **MODIFY** | [`frontend/src/app/routes/BookplatePage.tsx`](file:///f:/Github/EchoesForgeClaw/frontend/src/app/routes/BookplatePage.tsx) | 全局图片结果判定支持 `receipt_printer` |

---

## 四、验证结果

1. **前端静态检查与类型检查**：
   - `npm run lint`：通过（0 errors）；
   - `npx tsc --noEmit`：通过（0 errors）。
2. **后端测试与类型检查**：
   - `backend-ts` 测试套件：8 个测试文件，86 个测试用例全部通过（86 passed）。
