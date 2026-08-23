# 手账制作节点（journal_maker）实施跟踪

> 方案：纯前端拼贴编辑器（多图装载 → 拖移/缩放/旋转/图层排序/随机布局 → Canvas 合成整张 PNG），复用贴纸的 U²-Net 抠图引擎与 /save-image 落库链路，服务器零新增端点。

## 需求要点

- 多模态工具类别；输入输出与右下角按钮逻辑对齐 `sticker_maker`；
- **多图来源并集**（不走单图优先级）：所有直连图片上级各一张 + 图书元数据封面（连线穿透或根节点兜底）一并装入；
- 本地多选一次性上传；**任意 item 可删除**（上传图彻底移除；上级/封面来源图记入 `dismissedSources` 防自动回填）；
- 点击选中：拖移位置、手柄缩放/旋转；悬浮按钮：上移一层/下移一层/置顶/置底/删除；
- 「随机布局」：位置/大小/旋转/z 序全量随机；
- 输出唯一整张图（预设画布 3:4 / 1:1 / 4:3 + 预设底色可切换 + 可选全局 AI 抠图）。

## 任务清单

- [x] 1. 后端 `backend-ts/src/modules/bookplate/node-types.ts`：JOURNAL_MAKER 常量 + 模板声明（multimodal / image / ['image','text']）
- [x] 2. 前端接线六处：platform/types CanvasNodeType、nodeLayout（NodeType+NODE_SIZES）、nodeTypes（COLORS/TEMPLATES/PORT_TYPES）、seedData
- [x] 3. 新建 `frontend/src/modules/multimodal/journal/` 引擎模块
  - [x] types.ts（JournalMakerItem/JournalMakerState/PAGE_PRESETS/BG_PRESETS/JOURNAL_DEFAULTS）
  - [x] engine.ts（randomizeLayout / defaultPlacement / composeJournalPage）
  - [x] downloadJournal.ts + index.ts
- [x] 4. 新建 `components/JournalMakerNode.tsx`（装载同步/删除语义/交互/两态 action bar）
- [x] 5. 渲染与 handler 注册
  - [x] CanvasNodeViews.tsx（resolveUpstreamImages 复数版 + case 分支 + helpers 声明）
  - [x] useNodeHandlers.ts（useEditorPatchHandler 一行 + 导出）
  - [x] useImageOutputHandlers.ts（useImageExportHandler + 接口 + return）
  - [x] routes/BookplatePage.tsx（isImageResultNode + 解构注入 ×2 处）
  - [x] useGenerationHistory.ts（promptText 链 + stage2 白名单）
  - [x] platform/utils/generation.ts（generationNodeTypeLabel 标签）
- [x] 6. docs/节点输入输出声明式接线.md §2 表格加行 + multimodal 注记补一段
- [x] 7. 验证：frontend build+lint、backend-ts typecheck+test、模板注册冒烟

## 关键决策记录

| 决策 | 结论 |
|---|---|
| 类型名 | `journal_maker`，标签「手账制作」 |
| 来源语义 | 并集装载（区别于其他节点的优先级链）；封面不再被覆盖 |
| 删除记忆 | uploadedImages 彻底删；上级/封面 src 入 dismissedSources 持久化 |
| item 坐标 | 中心点 x/y %、宽 w %、angle deg、z 序；高度按图片固有比例换算 |
| 画布预设 | 3:4(1200×1600) / 1:1(1400×1400) / 4:3(1600×1200)；背景为渐变预设（含全息幻彩）+ 自定义纯色 |
| 抠图 | 全局开关默认关，生成时逐图串行过 removeImageBackground（进度 i/n，会话级缓存同 src 不重跑） |
| 后端改动 | 仅 node-types.ts 声明注册；save-image/generations 复用 |

## 实现补充决策（实施中）

| 决策 | 结论 |
|---|---|
| 手势提交 | 本地态渲染 + pointerup 一次性 commit（一次手势一条撤销历史）；itemsRef 镜像避免 updater 内副作用 |
| 撤销历史 | editorPatch 默认不记历史——排版动作（拖移/缩放/旋转/图层/删除/上传/随机）显式传 undoable=true |
| 旋转 | 指针方向角增量补偿（抓取瞬间不跳变），以上方为 0°顺时针 |
| 页面自适应 | ResizeObserver 实测容器 + 按预设比例 contain-fit 计算（纯 CSS aspect-ratio 双向约束不可靠） |
| 装载持久化 | 自动装载的素材仅入本地态；任何用户编辑/生成时随全量 state 持久化（未编辑过则刷新后重新落位） |
| 渐变背景 | `JournalBackground` 描述符（solid/linear + angle，CSS 角度口径）为单一事实来源：DOM 预览走 `journalBackgroundCss`、Canvas 导出走 `paintBackground`（梯度线长 |W·sinθ|+|H·cosθ| 与 CSS 对齐）；旧 hex 字符串经 `normalizeJournalBackground` 兼容 |

## 验证记录

| 检查 | 结果 |
|---|---|
| `npm run build`（frontend：tsc -b && vite build） | ✅ 通过（chunk >1MB 警告为既有现象，与本变更无关） |
| `npm run lint`（oxlint，journal 相关文件） | ✅ 0 问题（maplibre vendor 警告既有且无关） |
| `npm run typecheck`（backend-ts） | ✅ 通过 |
| `npm test`（backend-ts vitest） | ✅ 8 文件 87 用例全过 |
| 模板注册冒烟（tsx 直载 NODE_TEMPLATES） | ✅ journal_maker 条目正确：multimodal / configurable:false / output image / inputs [image,text]，共 29 模板 |
| 渐变背景冒烟（tsx 直载 types.ts） | ✅ 8 个渐变预设 CSS 输出正确；旧 hex 兼容归一为 solid 描述符；非法值回退默认渐变 |

## 评审记录

- 与贴纸制作链路一致性：输入优先级语义改为**多图并集**（封面不被覆盖）为本节点特有；
  编辑/成品两态、右下角按钮组两态布局、hasDownstream 全守卫（action bar 由 NodeActionBar.Custom
  自动禁用 + 页面悬浮按钮手动判断）、保存落库走 useImageExportHandler——逐项对齐。
- 删除语义按用户修正实现：任意 item 可删；上传图彻底移除；上级/封面来源图 src 入
  `dismissedSources` 持久化防自动回填；重置清空记忆恢复全量装载。
- 未验证项（需运行时人工确认）：真实浏览器中的完整交互链路（多图拖移/缩放/旋转手感、
  图层按钮、随机布局、切换尺寸底色后生成、AI 抠图 i/n 进度、保存落库→收藏/公开、Ctrl+Z 撤销排版、
  下游连线消费）。建议启动前后端按上述链路走查一遍。
- 残留风险：
  1. 素材含远程 HTTP 图片时合成依赖 crossOrigin 匿名可加载（本地部署同源场景无影响，
     与贴纸 loadImage 同口径）；
  2. 会话级抠图缓存以 src 为键存 Data URL，超大量素材下内存占用上升（会话级，可接受）；
  3. 自动装载的初始落位每次进入随机抖动，未编辑即刷新会变化——属预期（用户意图未落盘）。
