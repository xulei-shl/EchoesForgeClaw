# chatnode 侧边抽屉：多选删除 / 全部清空 — 可行性分析

> 结论先行：**可行，且不需要后端改动**。批量删除以「宿主级批量回调 + 抽屉内选择态」实现，
> 内部串行复用现有单删接口（`DELETE /chat/file`、`DELETE /chat/session`），删除结束后只刷新一次。
> 「多选删除」「全部清空」均为独立入口，点击先弹 `dialog.confirm` 危险确认框。
> 对话历史 Tab 的批量范围 = 该模式**全局会话列表**（与现有列表展示一致，含其它画布节点的会话），
> 确认框需注明影响范围。

---

## 1. 目标

当前 chatnode 节点右侧抽屉的三个 Tab（`AI 产物` / `我的上传` / `对话历史`）均已支持**逐行单个删除**
（行内垃圾桶按钮 + 危险确认框）。本次要补两种**批量删除**能力，均需在删除前弹出确认框：

1. **多选删除**：勾选若干行后一键删除；
2. **全部清空**：删除当前 Tab 列表中的全部条目。

## 2. 现状梳理（代码勘察结果）

### 2.1 UI 层（单一共享组件）

抽屉由 `frontend/src/modules/bookplate/components/chat/ChatSidePanel.tsx` 的
`ChatSidePanelDrawer` 提供，**skill_agent（PiChatNodeHost）与 LLM/FastClaw（ChatNodeHost）
两个宿主共用同一份组件**，因此交互改动只需改这一处 + 两个宿主的回调接线：

- Tab 栏：文件类别 Tab（空桶置灰不可点）+ 对话历史 Tab；
- `FilesBody` / `WorkspaceFileRow`：当前 Tab 类别下的文件行（按修改时间倒序），行点击预览，
  行内垃圾桶删除（仅当宿主传入 `onDeleteFile` 才渲染）；
- `HistoryBody` / `ConversationRow`：会话行，行点击载入，行内置顶 / 重命名 / 删除
  （仅当宿主传入对应回调才渲染）；
- 确认框统一走 `useFeedback().dialog.confirm({ ... , danger: true })`。

### 2.2 能力矩阵（重要：批量入口必须与单删能力对齐）

| Tab | PiChatNodeHost（skill_agent） | ChatNodeHost（LLM / FastClaw） |
| --- | --- | --- |
| AI 产物 / 我的上传 | ✅ 单删可用（`onDeleteFile`） | ❌ 单删不可用（文件在 FastClaw 外部存储 / LLM 本地只读） |
| 对话历史 | ✅ 单删可用（`onDeleteSession`） | ✅ 单删可用（`onDeleteSession`） |

即：

- **文件 Tab 的批量能力只在 PiChatNodeHost 出现**；FastClaw / LLM 节点下文件 Tab 本就没有删除，
  批量入口也应隐藏（保持现状语义）；
- **对话历史 Tab 的批量能力两个宿主都出现**。

### 2.3 范围语义（决定确认文案与实现边界）

- **文件 Tab**（`AI 产物` / `我的上传` 各自独立）：列表数据 = `fetchWorkspaceFiles(ws)` 按
  `WORKSPACE_FILE_CATEGORIES.matches`（`inputs/` 前缀 → 我的上传；其余 → AI 产物）分桶，
  只含**当前节点的当前工作区**。所以批量删除 / 清空 = 删除当前工作区内该类别所列文件；
  两个类别天然互斥、互不影响。
- **对话历史 Tab**：列表 = `fetchConversationSessions(mode)` 的**跨节点全局列表**
  （按 pi / llm / agent 三模式隔离，行内标注来源节点「来自『xx』」）。因此：
  - 多选可勾选**任意节点**的会话（单删本来就允许，与既有行为一致）；
  - 「全部清空」会删除**该模式下该用户的全部会话**（含其它画布节点名下的目录）。
  - 若删除目标里包含**当前节点正在使用的会话**，需在批量完成后把节点重置为全新工作区
    （`handleResetChatWorkspaceFor`，单删路径已有同款逻辑，批量时只触发一次）。

### 2.4 删除接口（后端现状：只有单删，均幂等、带保护）

- `DELETE /api/modules/bookplate/chat/file`，body `{ workspace_id, path }`
  → 服务层 `deleteWorkspaceFileSafe`：词法 / 装配物保护前缀（`.agents/ .pi/ .pi-agent/ AGENTS.md`）/
  realpath 防软链越界 / 只删文件不删目录；文件不存在或不可删返回 404。
- `DELETE /api/modules/bookplate/chat/session`，body `{ workspace_id }`
  → `deleteChatConversation`：有 `chat.jsonl` 走 pi 删除链路（杀 RPC 进程 + 整目录删除），
  LLM / FastClaw transcript 会话直接整目录删除（本地遗忘；FastClaw 远端会话不在清除范围，属既有语义）。
- 单删前端封装：`piSessionApi.deleteWorkspaceFile` / `deleteConversationSession`（均 401 → 登出处理）。

## 3. 方案设计

### 3.1 ChatSidePanel 接口扩展（全部可选，向后兼容）

在 `ChatSidePanel` 上新增两个可选批量回调（有才渲染对应批量 UI）：

```ts
/** 批量删除会话（对话历史 Tab）。返回成功 / 失败数，失败 = 接口非 200（含目标已不存在）。
 *  缺省 = 不展示该 Tab 的批量能力。 */
onBatchDeleteSessions?: (workspaceIds: string[]) => Promise<{ ok: number; failed: number }>;
/** 批量删除文件（AI 产物 / 我的上传 Tab；缺省 = 不展示文件批量能力，如 FastClaw 宿主）。 */
onBatchDeleteFiles?: (files: AgentFile[]) => Promise<{ ok: number; failed: number }>;
```

单删回调（`onDeleteFile` / `onDeleteSession`）保持不变，仍由行内按钮使用。

### 3.2 宿主实现批量回调（复用现有单删接口）

两个宿主的批量实现模式相同：**串行调用现有单删接口 → 删除结束后只 bump / refresh 一次**。

- **PiChatNodeHost**
  - `onBatchDeleteSessions(ids)`：`for…of` `deleteConversationSession(id)` +
    `evictSessionCache(id)`；若任一被删 id === `wsIdRef.current`，最后调用一次
    `h.handleResetChatWorkspaceFor(node.id)`；结束后 `convPanel.bump()` 一次。
    返回 `{ ok, failed }`（沿用现有 handleDeleteConversation 的失败即抛语义，逐个 try/catch 计数）。
  - `onBatchDeleteFiles(files)`：取 `wsIdRef.current`，逐个 `deleteWorkspaceFile(ws, f.path)`
    计数；结束后 `panel.refresh()` 一次（现有单删每次 refresh，批量只刷一次）。
- **ChatNodeHost**：只加 `onBatchDeleteSessions`（同上，含 `handleResetChatWorkspaceFor` 单次重置 +
  `convPanel.bump()` 一次）；不加 `onBatchDeleteFiles`。

> 之所以放宿主而不是抽屉内循环单删回调：现有单删回调每次成功后都会 `bump/refresh`，
> 批量 N 项会造成 N 次列表刷新。宿主级批量函数可保证「N 次删除 + 1 次刷新」，且逐项失败计数
> 语义（如 pi 会话正在运行被杀、文件已被并发删除返回 404）与单删路径完全一致，不需要后端改动。

### 3.3 抽屉 UI：批量管理态

原则：**两个批量入口都按 Tab 呈现**（不是画布/抽屉全局），且**只在该 Tab 具备对应单删能力且列表非空时出现**。

布局（NodeSideDrawer 内容区顶部、列表上方新增一行工具条，`width=300` 内可容纳）：

- 常规态（非批量态）：
  - 左：**「多选删除」**入口（小按钮，图标 `ListChecks` / `SquareCheckBig`）——点击进入选择态；
  - 右：**「全部清空 (N)」**（危险样式的文字按钮，图标 `Trash2`）——点击立即弹确认框。
- 选择态（仅多选删除进入）：
  - 列表每行左侧出现勾选框（原生 `input[type=checkbox]` 自绘，行点击 = 勾选切换）；
  - 此态下隐藏行内其它操作（预览 / 载入 / 置顶 / 重命名 / 单个删除），避免与勾选冲突；
  - 顶部工具条变为：**「全选 / 取消全选」 + 「已选 N / 共 M」 + 「删除选中 (N)」(danger) + 「取消」**；
  - 点「删除选中」→ `dialog.confirm` → 成功后退出选择态、刷新列表、toast 汇总。

两个入口点击后都走 `dialog.confirm`（`danger: true`），文案示例：

- 文件（某类别）多选 / 清空：`将删除「{类别}」的 {N} 个文件（当前会话工作区）。删除后文件将从工作区中永久移除，无法恢复。`
- 会话多选：`将删除选中的 {N} 个对话（含其它画布节点的对话）。每个对话的完整数据（会话历史、产物文件与上传附件）将永久删除，无法恢复。`
- 会话全部清空：`将清空该模式下全部 {N} 个对话（含其它画布节点及当前节点）。删除后不可恢复；若其中有当前正在进行的对话，其进程将被终止。`

### 3.4 抽屉内部状态（`ChatSidePanelDrawer` 局部 state）

- `selectMode: boolean`（进入选择态的开关，切换 Tab / 关闭抽屉自动复位）；
- 选择集合：按行唯一键存储——
  - 文件行：`file.path`（当前工作区内唯一）；
  - 会话行：`session.workspaceId`；
- 批量进行中标志：删除期间禁用工具条按钮 + 行内交互，按钮上显示 spinner；
- 选择态约束：`ConversationRow` 的行点击「载入会话」、`WorkspaceFileRow` 的行点击「预览」在选择态下不触发；
- 复用现有 `deletingId` / `deletingPath` 粒度做删除动画不划算，批量统一用一个 busy 态即可。

### 3.5 与现有逻辑的冲突点排查

- **删除当前会话 → 节点重置**：批量实现里只在「当前 ws 出现在删除集合」时重置一次，与单删一致；
  重置后节点 `workspaceId=''`、`epoch+1`，抽屉刷新后该会话自然从列表消失；
- **正在运行 / 其它节点正在使用的会话**：与单删相同——全局列表本就允许删其它节点的会话，
  删除运行中的 pi 会话会杀 RPC。批量只是在文案上更醒目地提示，行为不新增风险；
- **会话缓存**：`evictSessionCache` 每个被删 id 都调（防残留缓存被再次水合）；
- **文件删除后历史消息内的预览**：单删已存在「消息卡片引用已删文件 → fetch 404」的边界，
  批量不做额外处理（保持一致）；可顺手在选择删除成功后若 `previewFile` 在被删集合内则关闭预览弹层。

## 4. 不改的东西（Scope 外）

- **后端接口 / 表结构 / 存储布局零改动**（沿用 `deleteWorkspaceFileSafe` 与
  `deleteChatConversation` 的全部保护与语义）；
- **FastClaw / LLM 节点的文件 Tab**：没有单删能力，批量入口不出现（不为此引入新删除通道）；
- **不引入「跨类别清空」**（如一次性清空 AI 产物 + 我的上传）：每 Tab 独立，保持现有分桶心智；
- 置顶 / 重命名 / 会话「清空对话」（`/chat/clear`，清历史不删文件）不在批量范围。

## 5. 验证方案

- 前端类型检查（`frontend` 包内 `tsc --noEmit` 或项目根约定命令）；
- 后端无改动，但跑一遍相关契约测试做回归基线：`tests/api/pi-conversations.test.ts`、
  `tests/api/pi-file-attach.test.ts`、`tests/api/chat-conversations.test.ts`
  （对应根 AGENTS.md 的 `npx vitest run tests/api/pi-*.test.ts`）；
- 手动走查（skill_agent 节点）：两文件 Tab 各多选删 + 清空；对话历史 Tab 多选删（含勾选当前会话）、
  清空（含当前会话 → 确认节点被重置为全新工作区）；FastClaw 节点确认文件 Tab 无批量入口、历史 Tab 有；
- 边界：空列表时入口隐藏 / 置灰；批量中途个别 404（并发删除）计入 failed 并 toast 汇总而非整体报错。

## 6. 改动清单（估）

| 文件 | 改动 |
| --- | --- |
| `frontend/src/modules/bookplate/components/chat/ChatSidePanel.tsx` | `ChatSidePanel` 新增 2 个可选回调；`ChatSidePanelDrawer` 增加批量工具条、选择态状态与渲染、`FilesBody`/`HistoryBody`/两 Row 增加可选 `selectable` / `selected` / `onToggle` 渲染 |
| `frontend/src/modules/bookplate/PiChatNodeHost.tsx` | 新增 `handleBatchDeleteSessions` / `handleBatchDeleteFiles` 并接入 `sidePanelProp` |
| `frontend/src/modules/bookplate/ChatNodeHost.tsx` | 新增 `handleBatchDeleteSessions` 并接入 `sidePanelProp` |
| （无）后端 | 无 |

风险点集中在前端状态机（选择态复位时机、删除当前会话的重置、批量期间防抖/禁用），
均可在上述两个宿主 + 单一抽屉组件内闭环，预计改动可控。
