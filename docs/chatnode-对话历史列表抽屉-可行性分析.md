# ChatNode 对话历史列表抽屉 —— 可行性分析报告

> 需求：在 chat 节点（Skill Agent / pi 模式）前端的侧边抽屉 UI 中新增「对话历史」列表，支持
> ① 查看历史会话内容；② 重新加载进入某个历史会话继续对话；③ 重命名会话列表名。
> 本文回答两个核心问题：**是否可行？** 以及 **是否必须把本地 json 会话文件迁入 DB？**
>
> 结论先行：
> - **可行，且工程量不大**（小到中型）。抽屉 UI 是现成范式（`NodeSideDrawer` + `CanvasNode.sideDrawer` 插槽），
>   服务端水合管线已能把任意 `workspaceId` 的会话渲染为 UI 历史，前端宿主在 `workspaceId` 变化时也会自动重新水合。
>   「重新进入对话」本质就是**切换 `workspaceId`**。
> - **`chat.jsonl` 不需要、也不建议迁入 DB**。它是 pi 子进程原生 append-only 协议直接写入的文件，
>   现有全部消费方都读它。真正缺的只是**会话目录级元信息**（名称、时间、节点归属），
>   这部分可以放一张小 DB 表，或放工作区内 meta 文件——与对话内容本身无关。

---

## 1. 现状：会话存储结构（已核实）

### 1.1 路径与生成方式

| 事实 | 证据 |
| --- | --- |
| 会话文件落点：`runtime/{userId}/workspace/{workspaceId}/.pi-agent/run/chat.jsonl` | `PI_SESSION_REL`（`backend-ts/src/services/pi/config.ts`）；`nodeWorkspace()`（`backend-ts/src/services/skill-agent-service.ts`）；pi 以 `--session <file>` 拉起（`services/pi/runner.ts:92`） |
| `workspaceId` 由**前端首轮发送时生成**：`${nodeId}_${Date.now()}`，写入 `node.data.workspaceId` | `frontend/src/modules/bookplate/PiChatNodeHost.tsx` `send()`；`useNodeHandlers.ts` `handleClearChatFor` 清空对话时会再生 |
| 画布图（节点数据）**只存 sessionStorage**（`bf-canvas-{userId}`），不落任何 DB | `frontend/src/platform/stores/useCanvasState.ts` |
| DB 中**没有任何会话/节点表**（共 13 张：users、llm_configs、generations、favorites…） | `backend-ts/src/config/database.ts` `INITIAL_DDL` |
| 文件格式：pi v3 append-only JSONL；首行 `{"type":"session","version":3,"id","timestamp"}`，其后为 `message`（user/assistant/toolResult）、`model_change`、`compaction` 等条目 | 实测 `runtime/1/workspace/` 下真实会话文件 |
| 一个 workspace = 一个对话；「清空对话」会再生 `workspaceId`，**旧目录永久残留在磁盘** | 实测用户 `1` 有 21 个 workspace 目录，其中多组 `chat-*` 系列目录 |

### 1.2 一个 workspace 目录里还有什么

除 `chat.jsonl` 外，`runtime/{userId}/workspace/{workspaceId}/` 还包含：
`AGENTS.md`（软链）、`.pi-agent/skills/`、`.pi-agent/extensions/`、`.pi-agent/models.json`、
`.pi-agent/settings.json`、`.pi-agent/web-search.json`、`.pi-agent/widgets.json`（扩展 widget 快照）、
`inputs/`（用户上传）、`outputs/`（产物）。

---

## 2. 已有能力盘点（三个需求点各自的基础）

1. **查看历史会话内容**
   `GET /api/modules/bookplate/chat/session?workspace_id=…`（`backend-ts/src/modules/bookplate/routes/ai-nodes.ts` →
   `services/pi-session-hydrate.ts`）已能把任意 `chat.jsonl` 反向映射为可渲染的 UI 历史
   （工具调用卡片、推理文本、内联图片、产物引用）。只要把 `workspaceId` 指过去即可。
2. **重新加载进入对话（继续对话）**
   `PiChatNodeHost` 已有 `useEffect([wsId])`：`workspaceId` 变化时拉取服务端会话并原子交换。
   切换对话 = `setNodes(... data.workspaceId = 目标)`，其余全部复用。
3. **侧边抽屉 UI**
   `NodeSideDrawer` + `CanvasNode` 的 `sideDrawer` 根级插槽是成熟范式
   （参考 `WorkspaceFilesDrawer` 与 `docs/节点侧边吸附抽屉使用指南.md`）。
   「对话历史」抽屉照抄该范式即可，注意**必须挂在 `sideDrawer` 插槽，不能写进 children**（overflow 裁切陷阱）。

---

## 3. 需要新增的能力与方案

### 3.1 会话列表接口（新）

当前没有任何接口能列出某用户/某节点的历史会话。两种做法：

- **扫描 `runtime/{userId}/workspace/*`**：筛选含 `.pi-agent/run/chat.jsonl` 的目录，
  并按 `workspaceId.startsWith(nodeId + '_')` 归属到节点；返回
  `{ workspaceId, createdAt（session 首条 ts 或目录 mtime）, updatedAt（文件 mtime）, messageCount, preview（首条 user 消息截断）, name }`。
  约 100–150 行 + 测试。
- **写入时建索引**：在 `preparePiWorkspace` / 每轮结束时登记元信息。多一套写路径；
  在当前规模下（workspace 目录不多，水合本就整文件解析）扫描即可，不必建索引。

### 3.2 重新进入对话

设置 `node.data.workspaceId` 为目标值 → 既有水合逻辑自动工作。两个注意点：

- 若旧会话有活跃 RPC 子进程：`wsId` effect 会 abort 本地 SSE，但后端进程要等空闲回收
  （`PI_PROCESS_IDLE_MS`）才被杀；建议切换时显式调用 `killPiProcess`（复用 `clearPiSession`
  里的逻辑，`services/pi/workspace.ts:380`）。
- `contextSentRef` 在水合到「含 ≥1 条 assistant 消息」的会话后正确置位，重新进入**不会重复注入**
  上游上下文，行为正确。新建对话 = 生成新 `workspaceId`（与清空对话同一代码路径，去掉删除动作即可）。

### 3.3 重命名（会话名）

当前任何地方都没有会话 name 字段。两个可行落点：

- **方案 A：DB 表** `chat_sessions(user_id, node_id, workspace_id, name, created_at, updated_at)`
  —— 查询可索引、前端丢失快照后名称仍存、将来扩展「删除会话/跨端同步」都方便。**推荐**。
- **方案 B：工作区 meta 文件**（如 `.pi-agent/run/session-meta.json`）
  —— 与「工作区即真相源」架构一致、零迁移、随工作区删除而消失。可作最小 v1。

方案 A 更稳（列表与节点归属不依赖前端是否还持有快照），方案 B 可作为最小实现。
**两者都不需要动 `chat.jsonl`。**

### 3.4 `chat.jsonl` 是否必须迁入 DB？

**不必要，也不建议。** 理由：

1. 它是 pi **自己的** append-only 协议文件（pi 子进程 `SessionManager` 直接写入）；
   迁 DB 意味着要么改上游 pi、要么做双向同步层——风险高、收益为零。
2. 全部既有消费方都读它：水合端点、`readSessionImageBlock`（内联图片鉴权端点）、
   `clearPiSession`、子代理清理。
3. pi 在文件内做自动压缩（`compaction` 条目），`clearPiSession` 原子删除整个会话目录；
   迁 DB 会破坏这些既有语义。
4. 内容本就是**惰性水合**（`pi-session-hydrate.ts` 有 `MAX_TOTAL_CHARS` 截断保护），
   SQL 侧没有任何需要消息正文的查询。

唯一可以考虑进 DB 的是**会话目录级元信息**（名称/排序/节点归属），见 3.3。

---

## 4. 风险与注意事项

- **节点归属是约定而非契约**：`workspaceId = genNodeId(node.type) + "_" + ts`
  （`frontend/src/app/routes/BookplatePage.tsx:472`，nodeId 形如 `chat-{ts}-{rand6}`）。
  分支/复制 chat 节点会得到新 nodeId，旧会话将不再归到新节点名下。
  **缓解**：首轮发送时把所属 `nodeId` 写进工作区 meta；或列表接口按用户维度返回、前端再过滤。
- **画布只存 sessionStorage**：用户清浏览器会话后 `node.data.workspaceId` 丢失，但磁盘 workspace
  目录与 `chat.jsonl` 仍在——此时一个**按用户维度**（`authUser.id` 鉴权）的列表接口恰是恢复入口。
  列表接口务必按 `authUser.id` 收敛 + sanitize 输入（多租户安全）。
- **孤儿 workspace 目录**：清空对话后旧目录永不清理（已在磁盘证实）。
  建议抽屉里顺带提供「删除会话」（复用/加强 `clearPiSession`），必要时加清理任务。
- **回归防线**（遵循项目约束）：`npx tsc --noEmit` + `npx vitest run tests/api/pi-*.test.ts`
  （现有测试已覆盖工作区装配、水合、清空会话）。

---

## 5. 工作量估算

| 部分 | 工作量 |
| --- | --- |
| 后端：`GET /chat/sessions`（扫描 + 元信息）+ `PATCH /chat/session`（重命名）+ 可选 `DELETE` | 约 150–250 行 + 测试 |
| DB 迁移（可选，方案 A） | 1 张表，微不足道 |
| 前端：抽屉组件 + 宿主接线 + 切换/重命名/新建对话动作 | 中型，纯 UI |
| **合计** | 小到中型功能，**无需强制 schema 迁移** |

---

## 6. 一句话结论

> 需求可行：抽屉 UI、会话水合、workspaceId 切换三块地基都已存在，缺口是「会话列表接口 + 会话名存储」；
> `chat.jsonl` 继续留在磁盘做唯一真相源即可，不需要（也不应该）迁入 DB。