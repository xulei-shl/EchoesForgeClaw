# 解除节点「有下级不可操作」限制 + 上下文注入实时化

## 背景

- 原模型：节点有下游时冻结一切影响输出的操作，改输出必须删连线重连。
- 新模型：源头随时可改；下游手动点「运行」时从连线现场读取上游最新输出（机制已存在：`resolveNodeRunInputs` 点击时实时收集，无需新增逻辑）。
- 上下文注入展示：非 chat 节点已实时（渲染期派生）；chat/PiChat 需从首条消息快照改为始终实时计算展示。

## 任务清单

### 阶段 1 — 解除限制
- [x] 1.1 `CanvasNodeViews.tsx`：删除 `hasDownstreamOf`（:219-223）及 ~30 处计算与传递
- [x] 1.2 `ChatNodeHost.tsx:584` / `PiChatNodeHost.tsx:669`：删除 import 与传递
- [x] 1.3 `useNodeHandlers.ts` `handleImageChangeFor`（:327-341）：移除自算 descendants 的「有下游禁替换图片」守卫

### 阶段 2 — 组件侧彻底清理
- [x] 2.1 `NodeActionBar.tsx`：删除 `hasDownstream/downstreamTooltip` 禁用管道与默认禁用文案
- [x] 2.2 bookplate 节点组件（~19 文件）：删 prop 接收与内部守卫（知乎提交守卫等）
- [x] 2.3 multimodal 节点组件（~7 文件）+ `useSearchNode.ts`：isLocked 移除 `hasDownstream &&`

### 阶段 3 — Chat 注入展示实时化
- [x] 3.1 `ChatNodeHost.tsx:536-561` / `PiChatNodeHost.tsx:627-660`：contextBlocks 始终实时计算，不再读首条消息快照
- [x] 3.2 保持不变：发送时首轮快照注入（attachContextToFirstUser）

### 阶段 4 — 验证
- [x] 4.1 `npm run build`（tsc 类型检查兜底）+ `npm run lint`（2026-08-26 均通过，exit 0）
- [ ] 4.2 手动场景：上游可运行/重试/编辑；下游重跑吃新值；chat 注入卡片同步；分支新建回归

## 边界（非缺陷）
- 下游旧结果不自动失效，需手动重跑（本次选择的模型）。
- chat 已开始对话的注入卡片显示最新值，但该会话实际用发送时快照；清空对话后下一轮注入最新。
- 分支新建行为（图像分析/图像生成已有结果时重试建兄弟节点）与 hasDownstream 正交，不受影响。

## 评审记录
- 2026-08-26：阶段 1-3 全部完成，8 个 multimodal 残留文件已清理，`frontend/src` 下 grep `hasDownstream`/`downstreamTooltip` 为 0。`npm run build` + `npm run lint` 通过（lint 仅 public/maplibre vendor 预存在警告）。
- 遗留：任务 4.2 手动场景验证（需在浏览器实测）。文档 `docs/多模态工具/图片处理/图片处理节点效果接入指南.md:105,188` 仍描述旧门禁行为，可顺手同步。

---

# pi Skill Agent 节点首轮慢优化：RPC 进程复用（配置代数 + 空闲回收 + LRU）

## 背景
- 原 `runPiAgent` 每轮 `spawn` 一个新 pi CLI 子进程（RPC 模式），settled 后即 `killTree`——进程从不复用，每轮都有 Node+CLI+扩展加载的冷启动开销；首轮体验最差。
- 目标：多用户 web 应用里既快（复用热进程）又省（空闲回收 + 并发上限）。

## 任务清单
### 阶段 1 — 配置代数
- [x] 1.1 新增 `pi/generation.ts`：`computeWorkspaceGeneration`（agentId + AGENTS.md 哈希 + 技能 SKILL.md 哈希 + 对话/绘图模型 + 扩展白名单的 sha256）
### 阶段 2 — 生命周期
- [x] 2.1 `config.ts`：`PI_PROCESS_IDLE_MS`（默认 5 分钟）、`PI_MAX_PROCESSES`（默认 20）
- [x] 2.2 `registry.ts`：`PiProcessEntry` 加 generation/lastUsed/round/child 等常驻字段；新增 `getPiProcess`/`touchPiProcess`/`countActivePiProcesses`/`reapIdlePiProcesses`/`evictLeastRecentlyUsedPiProcess`；后台定时器空闲回收；`killPiProcess` 改 async 并等待子进程退出（防 kill 后 rmSync 撞文件锁）
### 阶段 3 — 运行器改造
- [x] 3.1 `runner.ts`：spawn/解析/事件队列提升为跨轮常驻；`runPiAgent` 按代数判定复用/重拉；正常 settled 不杀进程，异常/超时/abort 才杀树；复用轮不重复注入上下文（每轮只发新消息，历史以会话文件为真相源）
### 阶段 4 — 接入与验证
- [x] 4.1 `ai-nodes.ts`：计算 generation 传入 runPiAgent；每轮仍全量 `preparePiWorkspace`（幂等、毫秒级），复用/重拉完全由 runner 内部判定——避免「跳过重装后又重拉」产生缺提示词/扩展的进程竞态
- [x] 4.2 `pi-agent-service.ts` 门面导出新增项；既有测试适配 async kill/clear
- [x] 4.3 新增 `pi-agent-reuse.test.ts`：同代数两轮回用同 pid 且上下文不重复（user 数 1→2）；代数变化重拉；空闲回收/LRU 生效；generation 稳定性/敏感性
- [x] 4.4 `npm run build`（仅预存在 2 个前端错误）+ pi 相关 6 测试文件 46 用例全过（fastclaw-artifacts 3 个失败为预存在、与本次无关）

## 设计要点 / 边界
- **上下文不重复**：进程复用/重拉只由配置代数决定；对话状态永远以 `.pi-agent/run/chat.jsonl` 为唯一真相源，多轮各写一次、不多不少。
- **配置变更即重拉**：上游节点改接提示词/skill/模型/扩展 → 代数变化 → 自动 kill 旧进程重拉，无需额外信号。
- **资源有界**：空闲超时 + 全局上限 LRU 驱逐，防多租户内存随活跃节点线性增长。
- 遗留：`PI_TIMING=1` 量化冷启动占比后再评估是否做「预拉起」增强（动态接上游场景收益有限）；`docs/skill-agent` 可补一段进程复用说明。

## 评审记录
- 2026-08-29：阶段 1-4 全部完成并验证。复用路径**未跳过 preparePiWorkspace**（保守偏差：每轮仍幂等重装配，换取「重拉竞态为零」的正确性；spawn 冷启动这一主导成本已消除）。生产代码 tsc 通过，pi 相关 46 用例全过。
- 2026-08-29：一并修复 2 个预存在编译错误——根因是 `frontend/src/platform/types` 是目录（`types/index.ts`）非文件：后端测试的 `types.js` 在 NodeNext 下解析不到、前端 `piQuestionnaireParser.ts` 无扩展名导入违反 NodeNext。改为 `types/index.js`，前后端 tsc 均通过。
- 遗留：`fastclaw-artifacts.test.ts` 3 个失败为**预存在 + Windows 环境相关**（`extractFastclawPathCandidates` 只认 POSIX `/` 开头绝对路径，而 Windows 测试临时目录是 `C:\...`），与本次改动无关，未纳入本次范围。

---

# 自由排版（Free Canvas）接入 Pretext 图文混排

## 背景

- 原模型：自由排版模板（`free_board`）中图片（`items`）与文本块（`freeTexts`）是完全独立图层，文本块用 CSS `whitespace-pre-wrap` 自动换行，**不绕排图片**（EditorialLayoutNode.tsx:1331, 1505；canvasExporter.ts:361-364）。
- 目标：当自由文本块与图片重叠时，块内文本自动避让图片（图文混排），预览 DOM 与 PNG 导出共用同一套 pretext 排版计算，保证 1:1 所见即所得。
- 复用：`layoutEngine` 现有 `layoutTextColumn`/`carveTextLineSlots`/`getBlockedIntervalsForBand` 障碍物避让管线；自由块文本块宽固定、高度由内容自适应，天然适合「块内绕排」。

## 任务清单

### 阶段 1 — 类型与引擎
- [x] 1.1 `types.ts`：新增 `FreeTextBlockWrapResult { lines: PositionedLine[]; contentHeight: number }`（contentHeight 为内容底部绝对 Y）
- [x] 1.2 `layoutEngine.ts`：把 `computeEditorialLayout` 内联的「图片→障碍物」逻辑提取为 `buildImageObstacles(images, W, H, hPad, vPad, captionLineH)`（DRY，固定版式复用）
- [x] 1.3 `layoutEngine.ts`：新增 `layoutFreeTextBlock(block, text, images, W, H)`：
  - 竖排 / 旋转 / 空文本 / 无图片重叠 → 返回 null（维持现状 CSS 换行，既有版面零回归）
  - 否则把全量图片转障碍物（几何函数自动过滤不重叠图片），用 `layoutTextColumn` 在块矩形内排文（区域高度 = 块 y→页面底），返回 `{ lines, contentHeight }`，行坐标按 `textAlign` 槽位内对齐
  - 同时给 `layoutTextColumn` 增加可选 `align` 参数（默认 left，固定版式零影响）

### 阶段 2 — DOM 预览
- [x] 2.1 `EditorialLayoutNode.tsx`：`freeTextWraps` useMemo 计算所有自由块的绕排结果（依赖 freeTexts/items/article/ratioPreset/isFreeLayout）
- [x] 2.2 渲染分支：绕排成功 → 块内逐行绝对定位 div（对齐 line 坐标），容器高度 = contentHeight - 块y；绕排失败/旋转/竖排/空块 → 维持现状
- [x] 2.3 拖拽/缩放时仅更新 width（现有行为），块高由绕排内容自动撑开

### 阶段 3 — Canvas 导出
- [x] 3.1 `canvasExporter.ts`：`drawFreeTextBlock` 增加绕排分支（调同一 `layoutFreeTextBlock`，逐行 fillText 对齐坐标）；旋转/竖排/空块走原 `wrapCanvasText`/`drawVerticalText`

### 阶段 4 — 验证
- [x] 4.1 `npm run build`（tsc）+ `npm run lint`（均通过，lint 仅 public/maplibre 预存在警告）
- [ ] 4.2 浏览器实测：横排无旋转重叠图 → 绕排；旋转/竖排块 → 不绕排；空块/无图 → 不变；导出与预览一致

## 设计要点 / 边界
- **只对横排、无旋转、非空、且与图片重叠的文本块绕排**；旋转/竖排块绕排过于复杂，维持原 CSS 换行（预览与导出两侧同判据，故仍 1:1）；无重叠块不启用（既有版面零回归）。
- 块文本宽固定、高度由 `layoutTextColumn` 反推（内容自适应），与自由排版「块高内容决定」一致。
- 图片障碍 padding 沿用现有排版语义（horizontalPadding/verticalPadding 随块字号缩放），保证避让留白与固定版式同感。
- 层级不变：图片先画、文本后画（文本浮于图片之上），绕排只是避让不改变 z 序。

## 评审记录
- 2026-09-01：阶段 1-3 完成，`npm run build`（tsc）+ `npm run lint` 通过（lint 仅 public/maplibre 预存在警告）。DOM 预览与 Canvas 导出共用 `layoutFreeTextBlock`，逐行坐标/对齐/行高一致（1:1）。新增重叠判定：无重叠直接返回 null，避免改变既有自由版面换行。
- 遗留：任务 4.2 浏览器实测（需在画布自由排版模板拖入图片与正文块重叠验证绕排、旋转/竖排块不绕排、导出 PNG 与预览一致）。

---

# pi 侧边抽屉文件改造：工作区完整文件树 + 只读 + 溢出 Tab

## 背景

- pi 节点侧边抽屉已有三 Tab（AI 产物 / 我的上传 / 对话历史），文件为**平铺列表**且**可删除**。
- 需求：文件区展示**当前节点工作区**（`runtime/{userid}/workspace/{chatid}`）的**完整文件树**（任意层级子目录，非跨工作区），排除 `.env` 等密钥文件；文件点击可预览、**不可删除**；Tab 栏用「…」下拉承载未来新增 Tab。
- 已确认决策：
  - 两文件 Tab 各自渲染子树：AI 产物 = 非 inputs/ 整树；我的上传 = inputs/ 子树（沿用 `WORKSPACE_FILE_CATEGORIES` 分桶）。
  - 历史对话 Tab 保留现状（载入 / 置顶 / 重命名 / 删除），「不可删除」仅覆盖文件。
  - 安全底线：`.pi-agent/`（含 `.agents/ .pi/`）整体排除。**密钥不在 .env**——对话/绘图/搜索 API Key 来自数据库（`llm_configs` / `app_settings`），装配时明文写入 `.pi-agent/models.json`、`settings.json`、`web-search.json`（`workspace.ts:281,300-310,351-362`）；`auth.json` 为 pi 运行时凭据。仅排除 `.env` 保护不了它们。

## 任务清单

### 阶段 1 — 后端排除与下载拦截（安全底线，最终口径：按文件而非整目录）
- [x] 1.1 `file-utils.ts`：`isSecretFileRel`（任意深度 .env*）+ `isSecretWorkspaceFile`（.env* ∪ .pi-agent 密钥 json）+ `isWorkspaceFileServable`（敏感文件、.agents/ .pi/、.pi-agent/{run,sessions,extensions} → 拒；skills/prompts/snapshot.json 等放行）
- [x] 1.2 `skills.ts` `skill-files` 下载端点使用 `isWorkspaceFileServable` 做下载层拦截（防列表可见名字但直连 URL 取密钥）
- [x] 1.3 后端单测：`.env*` 列表排除 / `previewable` 标记 / 下载 404 与白名单子树 200 共存

### 阶段 2 — 前端文件树组件
- [x] 2.1 新增树组件（手写递归，不引入依赖）：输入 `AgentFile[]`（path 相对路径），构建目录树；文件夹行可展开/收起（默认展开）、叶子行点击 → `FilePreviewModal`（预览能力已具备）；无 mtime（FastClaw）按路径排序天然稳定
- [x] 2.2 `ChatSidePanel.tsx` `FilesBody`：平铺列表替换为树渲染；空态 / 加载态保留

### 阶段 2.5 — 「全部文件」总览（折叠入溢出）
- [x] 2.5.1 新增 SideTabId='all'：展示工作区**完整清单**（含 .pi-agent 配置名与任意深度 .env* 的名字与目录结构），折叠在「⋮」竖向三点溢出下拉中
- [x] 2.5.2 顶部三个常驻 Tab 与旧版一致（AI 产物 / 我的上传 / 对话历史）；`resolvedTab` 回退优先级：全部文件 → 第一个非空类别 → 对话历史；溢出按钮用 `MoreVertical`
- [x] 2.5.3 敏感文件（.env* / .pi-agent 密钥 json）**名字可见但不可预览**：后端 `include_agent_runtime=1` 返回时标 `previewable=false`；前端锁图标 + 禁点提示，下载层 `isWorkspaceFileServable` 同口径拒绝
- [x] 2.5.4 符号链接显示：完整清单 walk 改 `lstat`（不跟随）——文件软链/悬空软链显示为文件（指向工作区外/悬空标 `previewable=false`），目录软链显示为「链接」占位目录节点（`isDir=true`，不穿透目标，杜绝越界列名）；默认产物 walk（`snapshotWorkspace`）同步改为不跟随目录软链，防外部目录内容混入 AI 产物与 agent_file 事件

### 阶段 3 — 文件只读化（仅「全部文件」；AI 产物 / 我的上传 保留删除）
- [x] 3.1 `PiChatNodeHost.tsx`：`onDeleteFile` / `onBatchDeleteFiles`、`handleDeleteFile` / `handleBatchDeleteFiles` 与 `piSessionApi.deleteWorkspaceFile` 恢复，供 AI 产物 / 我的上传 Tab 使用；FastClaw 模式仍不传（外部存储不可删）
- [x] 3.2 `ChatSidePanel.tsx`：文件删路径（`handleDeleteFile` / 文件分支 `BatchDeleteToolbar` / `WorkspaceFileTree` 行内删除 + 批量选择）恢复；「全部文件」Tab 不传 `onDelete` / 不展示批量入口 ⇒ 只读
- [x] 3.3 数据源拆源：`fetchWorkspaceFiles` 统一请求 `include_inputs=1&include_agent_runtime=1`；`regularFiles = 排除 .pi-agent 前缀且 previewable!==false` 供 AI 产物 / 我的上传 分桶，「全部文件」用全量

### 阶段 4 — Tab 溢出「…」下拉（面向未来扩展）
- [x] 4.1 Tab 栏收敛为注册表数组 `tabDescs: { id, label, badge, disabled?, primary }`（全部文件 / AI 产物 / 我的上传 / 对话历史 为 primary 常驻；未来新增 Tab 追加 primary=false 条目即落溢出）
- [x] 4.2 「…」溢出下拉（lucide `MoreHorizontal`）：列出非 primary Tab，点击激活并高亮；点击外部关闭用**捕获阶段** document 监听（NodeSideDrawer 冒泡阶段 stopPropagation 会让常规 click-outside 失效）；`resolvedTab` 回退逻辑保留
- [x] 4.3 保持现有回归：空桶置灰 / 计数 badge / Tab 切换退出批量选择态

### 阶段 5 — 验证
- [x] 5.1 后端 `npm run typecheck` + `npx vitest run tests/api`（246 通过，仅 fastclaw-artifacts 3 个预存在 Windows 失败）；前端 `npm run build`（tsc + vite）+ lint（无新增警告）
- [ ] 5.2 浏览器实测（pi 节点）：两文件 Tab 树展开 / 缩起 / 叶子预览 + 删除、⋮ 下拉激活「全部文件」（含 .pi-agent 配置名、锁图标敏感文件不可点不可下载）、历史 Tab 载入/置顶/重命名/删除回归、密钥文件直连 URL 404

## 设计要点 / 边界
- **「全部文件」= 当前工作区目录的完整清单**（递归子目录 + .pi-agent 配置名 + 任意深度 .env* 名字），非跨工作区、非 agent_file 事件子集。
- **密钥文件「名字可见、内容不可预览」**：列表层返回并标 `previewable=false`，下载层 `isWorkspaceFileServable` 同口径 404（双端纵深防御，`skills.ts:138-161` 是现存泄露面）。
- `.pi-agent/run|sessions`（会话 jsonl，走会话水合/历史 Tab）与 `extensions`（软链扩展包，防穿透膨胀）**不进入「全部文件」清单**；`.pi-agent/skills|prompts`（装配资源）与 `snapshot.json` 等非敏感文件可预览可下载。
- `.agents/ .pi/` 为 agent 运行时目录（含软链），保持排除。
- 树组件按 `path` 通用渲染，三模式（pi / LLM / FastClaw）共用无侵入；FastClaw 无 mtime 时树排序稳定。
- 删除接口 `DELETE /chat/file` 保留后端实现，仅「AI 产物 / 我的上传」Tab 暴露（FastClaw 外部存储不可删）。

## 评审记录
- 2026-09-07：阶段 1-4 全部完成。下载拦截细化：`.pi-agent/` 仅拦非白名单子树（`skills/` `prompts/` 仍可下载——既有 `skills.test.ts` 断言其 200，且 @ 引用检索依赖它）；`isWorkspaceFileServable` 与 `isSecretFileRel` 落 `file-utils.ts`，列表与下载共用口径。前端三模式共用树无侵入；溢出下拉点击外部关闭用捕获阶段监听（NodeSideDrawer 冒泡 stopPropagation 使常规方案失效）。后端 typecheck + `tests/api` 244 通过（仅 fastclaw-artifacts 3 个预存在 Windows 失败）；前端 tsc + vite build 通过、lint 无新增警告。
- 2026-09-07（补充①）：按反馈新增「全部文件」独立常驻 Tab（SideTabId='all'，默认回退优先，展示工作区完整树含 inputs/），AI 产物 / 我的上传 保留为分桶子树；`FilesBody` 改按 `files` 取行集。前端 tsc + vite build + lint 全过。
- 2026-09-07（补充②）：按反馈修正设计——「全部文件」改为**只读总览**并折叠进「⋮」竖向三点溢出下拉（顶部仍为 AI 产物 / 我的上传 / 对话历史 三个常驻 Tab）；AI 产物 / 我的上传 **恢复删除能力**（树内行内删除 + 批量删除工具条，`WorkspaceFileTree` 增加 onDelete/selectable/deletingPath，叶子行改 div role=button 以承载内嵌删除钮）。FastClaw 模式仍不传删参（外部存储不可删）。前端 tsc + vite build + lint（仅既有 PiChatNodeHost exhaustive-deps 警告）全过。
- 2026-09-07（补充③）：按反馈把「全部文件」从「排除密钥」改为「**密钥名字可见、内容不可预览**」——列表层 `include_agent_runtime=1` 返回完整清单（.pi-agent 配置名 + 任意深度 .env*，敏感标 `previewable=false`）；下载层 `isWorkspaceFileServable` 改为**按文件拦截**（.env* / 密钥 json / run|sessions|extensions / .agents / .pi 拒；skills|prompts|snapshot.json 放行）。前端 `regularFiles` 拆源（排除 .pi-agent 且可预览 ⇒ AI 产物 / 我的上传；全量 ⇒ 全部文件），树叶子不可预览态用锁图标 + 禁点。后端 246 通过（仅 3 个预存在 fastclaw 失败），前端 tsc + build + lint 全过。
- 2026-09-07（补充④）：软链显示——`snapshotWorkspace/walkWorkspace` 从 `statSync`（跟随）改为 `lstatSync`：目录软链不递归（防越界列名/成环/膨胀），文件软链按目标列出；新增 `walkEverything`（完整清单，lstat 识别三类软链：文件软链 realpath 落在工作区/共享允许根内才可预览，目录软链 `isDir=true` 占位节点仅展示目录名，悬空软链锁定）；清单分支「覆盖」默认条目以保留 link/previewable 标记。前端 `AgentFile.isDir/link` + `buildTree` 支持目录占位节点 + 目录行「链接」徽标。后端 247 通过（仅 3 个预存在 fastclaw 失败），前端 tsc + build + lint 全过。
- 遗留：任务 5.2 浏览器实测（画布 pi 节点抽屉：树展开/缩起/预览/删除、⋮ 激活「全部文件」看到 .pi-agent 配置名、.env*/软链锁定图标不可点、AGENTS.md 以「链接」显示可预览、历史 Tab 回归、密钥直连 URL 404）。
