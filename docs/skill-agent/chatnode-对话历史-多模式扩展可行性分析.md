# ChatNode 对话历史 —— LLM / FastClaw 模式扩展（可行性分析 + 实现落地）

> 前置阅读：`docs/skill-agent/chatnode-对话历史列表抽屉-可行性分析.md`（pi / Skill Agent 模式的历史功能）。
> 本文回答两个问题：**chatnode 的另外两种模式（LLM API / Vercel AI SDK 模式、FastClaw Agent 模式）能否支持对话历史功能？** 以及 **能否复用 pi 模式的既有实现？若不能复用，是否必须为每种模式各写一套独立的代码文件？**
>
> 结论先行（已落地，2026-09）：
> - **三种模式都支持对话历史**，且「抽屉 UI + 面板状态机 + 数据模型 + meta.json 置顶/重命名」整层**共用**——它们与存储介质无关。
> - **会话存储按「存储族」分两套**：pi 沿用既有实现（`chat.jsonl` + pi 进程语义，零改动）；**LLM 与 FastClaw 共用一个本地 transcript 服务**（`{ws}/conversation.jsonl`），每行标注来源 `mode`（'llm' / 'agent'）用于列表隔离——**不需要为每个模式各建一套 Provider 文件**（方案阶段的「Provider 目录」已简化为单一 `chat-conversations.ts`）。
> - **会话键统一为 `workspaceId`**（三种模式都已生成并持久化 `node.data.workspaceId`）：LLM / FastClaw transcript 按它落盘；FastClaw 的 `agentSessionKey` 改为 `bookplate-{uid}-{workspaceId}`（一对话一 key）。
> - **前端只需在共用宿主 `ChatNodeHost` 补一处接线**（水合 effect + 历史 handlers + 文件面板自动刷新），`PiChatNodeHost` 零改动，抽屉组件零改动。

---

## 1. 现状与最终架构（2026-09 落地后）

chatnode（AI 对话节点）有三种模式，由两个前端宿主承载：

| 模式 | 前端宿主 | 会话真相源 | workspace_id 的作用 | 历史功能 |
| --- | --- | --- | --- | --- |
| Skill Agent（pi） | `PiChatNodeHost.tsx` | `runtime/{uid}/workspace/{wsId}/.pi-agent/run/chat.jsonl`（pi 子进程写入） | 会话标识，前端首轮生成 `${nodeId}_${ts}` | ✅ 已有（抽屉/列表/置顶/删除/重命名/载入，零改动） |
| LLM（Vercel AI SDK） | `ChatNodeHost.tsx`（`useChat` + `DefaultChatTransport`） | **本地 transcript**：`{ws}/conversation.jsonl`（后端每轮追加写，`chat-conversations.ts`） | 会话标识（transcript 落盘键） | ✅ 已落地（与 FastClaw 共用存储族，行内 `mode:'llm'`） |
| FastClaw Agent | `ChatNodeHost.tsx`（`config.mode === 'agent'`） | **双份**：FastClaw 服务端按 `sessionKey` 保持 + 本端本地镜像 transcript `{ws}/conversation.jsonl` | 会话标识（sessionKey 即 `bookplate-{uid}-{workspaceId}`） | ✅ 已落地（行内 `mode:'agent'`，含工具步骤/产物） |

### 1.1 三模式在 `/chat` 端点的差异（`backend-ts/src/modules/bookplate/routes/ai-nodes.ts`）

- **Skill Agent 分支**：装配 `{ws}` 工作区 → `runPiAgent` 以 `--session <file>` 写 `chat.jsonl`（既有逻辑，未动）。
- **FastClaw 分支**（`agentConfigFromWithOverride` 命中时）：`runAgent(cfg, payload.message, sessionKey, ...)`——只发当前消息，历史由 FastClaw 按 sessionKey 记住；每轮结束后**追加写 transcript**（`persistTranscriptUser/Assistant`，`mode:'agent'`，含工具步骤与桥接产物），产物桥接进 `{ws}/outputs`。
- **LLM 分支**（兜底）：`llmService.chatStream(payload.messages ?? [], config)`——每轮重发完整消息数组；后端从 `payload.messages` 取末条 user 消息**追加写 transcript**（`mode:'llm'`）。写路径全部 best-effort（磁盘失败静默跳过，绝不阻断对话流）。

### 1.2 清空对话语义（`useNodeHandlers.ts` `handleClearChatFor`，三模式共用）

递增 `epoch` + 置空 `workspaceId` + 清空 `messages`。各模式实际效果：

- pi：`workspaceId` 置空 → 下次发送再生新 id = 新会话目录。
- FastClaw：`workspaceId` 置空 → 下次发送新 workspaceId → 新 sessionKey → FastClaw 侧开新会话；旧 transcript 保留在旧工作区（抽屉仍可见，可删除）。
- LLM：同 FastClaw（新 workspaceId = 新 transcript 文件）。

---

## 2. 可复用资产盘点

对话历史功能拆成五层，只有存储层是模式相关的：

| 层 | 位置 | 与模式相关？ |
| --- | --- | --- |
| 抽屉 UI（Tab / 行 / 行内重命名·置顶·删除·载入） | `ChatSidePanelDrawer` / `ChatSidePanel.tsx`（经 `ChatNode` 的 `sidePanel` prop 由两个宿主共用） | ❌ 无关，数据驱动（**零改动**） |
| 面板状态机 | `useConversationHistoryPanel.ts` | ⚠️ 已参数化：`(openOverride?, mode?: 'pi'|'llm'|'agent')`，mode 透传给 `fetchConversationSessions` |
| 数据模型 `ConversationSessionSummary`（workspaceId / title / pinned / pinnedAt / createdAt / updatedAt / messageCount） | `piSessionApi.ts` | ❌ 无关 |
| 载入交互（`handleLoadChatSessionFor` = 切 `workspaceId`）+ 宿主「wsId 变化 → 服务端水合」effect | `useNodeHandlers.ts` + `ChatNodeHost.tsx` / `PiChatNodeHost.tsx` | ⚠️ 切换模式通用；水合服务端实现按存储族分派 |
| 会话存储 / 列表 / 水合 / 删除 | pi：`listPiConversations` / `hydratePiSession` / `deletePiConversation`；LLM+FastClaw：`chat-conversations.ts`（transcript）；`{ws}/.pi-agent/meta.json` 置顶/重命名 | ✅ 存储层两套，meta.json 存储无关共用 |

---

## 3. LLM 模式（Vercel AI SDK）评估与落地

### 3.1 是否可行：**可行**，后端增量很小（已落地）

- 原状零落盘，但每轮请求已携带完整 transcript（`payload.messages`），后端按 `workspace_id` 追加写 `{ws}/conversation.jsonl` 即可。
- **刻意不采用 pi 的 chat.jsonl 格式**（避免 LLM 模式耦合 pi 协议），`conversation.jsonl` 由 `snapshot.ts` 的差分排除列表屏蔽，不出现在「AI 产物」面板。
- 前端 `ChatNodeHost` 已补「wsId 变化 → 服务端水合」effect（原只有 store/useChat 一致性守护）；载入历史 = 切 `workspaceId`。

### 3.2 复用度（落地后）

| 层 | 复用 | 落地结果 |
| --- | --- | --- |
| 抽屉 UI / 面板状态机 / DTO | ✅ | 全部复用（loader 参数化后） |
| meta.json 置顶 / 重命名 | ✅ | 复用（存储无关） |
| 删除 | ✅ 直接删 `{ws}` 目录 | `deleteChatConversation` 无 pi 会话文件时整目录删 |
| 会话列表 / 水合 | 🆕 | `chat-conversations.ts`（与 FastClaw 共用，行内 mode 区分） |
| 宿主接线 | 🆕 | `ChatNodeHost` 内新增（水合 effect + handlers + 文件面板刷新） |

---

## 4. FastClaw Agent 模式评估与落地

### 4.1 是否可行：**可行**（采用路线 A，已落地）

- FastClaw 已按 `sessionKey` 在服务端保留会话，但原 key 是 `(uid, nodeId, epoch)`，无法枚举/切换旧会话。
- 上游最小契约（`upstream-api.md`）没有会话列表 / 回放 / 删除端点。

**路线 A（已采用，自包含）**：把 FastClaw `sessionKey` 与 `workspaceId` 对齐（`bookplate-{uid}-{workspaceId}`，一对话一 key），后端本地镜像 transcript（每轮已能看到全部事件、已做产物桥接，顺带追加写即可）。列表 / 水合 / 置顶 / 重命名读本地镜像 + `meta.json`；**删除 = 本地遗忘**（FastClaw 侧会话状态不在本端可清除范围，删除只移除本端工作区目录）。存储与 LLM 模式统一（同一 transcript 格式 + 同一 `chat-conversations.ts`），仅行内 `mode` 标记不同。

### 4.2 复用度（落地后）

| 层 | 复用 | 落地结果 |
| --- | --- | --- |
| 抽屉 UI / 面板状态机 / DTO | ✅ | 全部复用 |
| meta.json 置顶 / 重命名 | ✅ | 复用 |
| 删除 | 🆕 | 本地遗忘（删本端工作区目录；FastClaw 侧残留） |
| 会话列表 / 水合 | 🆕 | 本地镜像（`chat-conversations.ts`，`mode:'agent'`） |
| 会话文件列表 | 🆕 | `GET /chat/fastclaw-files`（FastClaw 服务端会话目录）+ 5s TTL 缓存 |

---

## 5. 复用矩阵总览（落地后）

| 能力 | pi | LLM | FastClaw |
| --- | --- | --- | --- |
| 抽屉 / 行 UI | ✅ 已有 | ✅ 复用 | ✅ 复用 |
| 面板状态机 | ✅ 已有 | ✅ 复用（mode 参数化） | ✅ 复用（mode 参数化） |
| DTO | ✅ 已有 | ✅ 复用 | ✅ 复用 |
| meta.json 置顶 / 重命名 | ✅ 已有 | ✅ 复用 | ✅ 复用 |
| 会话列表 | ✅ 已有 | ✅ `chat-conversations.ts`（mode='llm'） | ✅ `chat-conversations.ts`（mode='agent'） |
| 水合 | ✅ 已有 | ✅ `hydrateChatTranscript` | ✅ `hydrateChatTranscript` |
| 删除 | ✅ 已有（杀进程+删目录） | ✅ 删目录 | ✅ 本地遗忘（删目录） |
| 宿主接线 | ✅ 已有（PiChatNodeHost） | ✅ ChatNodeHost 新增 | ✅ 与 LLM 同宿主一并新增 |

---

## 6. 实现落地详情（维护参考核心）

### 6.1 transcript 数据格式（`{ws}/conversation.jsonl`，append-only JSONL）

每行一条 `TranscriptMessage`（`backend-ts/src/services/chat-conversations.ts`）：

```json
{"type":"message","id":"u-<ts>-<rand>","role":"user","content":"...","mode":"llm","images":["data:image/png;base64,..."],"ts":1788000000000}
{"type":"message","id":"a-<ts>-<rand>","role":"assistant","content":"...","mode":"agent","reasoning":"...","agentSteps":[{"type":"agent_tool_call","id":"t1","name":"search","arguments":"{}"}],"files":[{"url":"/api/.../skill-files/...","name":"x.png","mime":"image/png","size":4,"path":"outputs/x.png"}],"interrupted":false,"ts":1788000001000}
```

- **`mode`**（'llm' | 'agent'）：每行标注写入来源，列表按此**三模式严格隔离**；旧数据（无 mode 字段）回退启发式——assistant 行含 `agentSteps` → 'agent'，否则 'llm'（`readTranscriptHead`）。
- 与 pi 的 `chat.jsonl` 互斥：同一工作区目录二选一（`listChatConversations` 按 `resolvePiSessionFile` 跳过 pi 工作区）。
- 字段上限：水合单字段截断 `MAX_FIELD_CHARS=20_000`，总量软上限 `MAX_TOTAL_CHARS=600_000`（超出截断并标记 `truncated`）。

### 6.2 后端关键函数与路由

**`backend-ts/src/services/chat-conversations.ts`**（新文件，LLM + FastClaw 共用）：

| 函数 | 说明 |
| --- | --- |
| `persistTranscriptUser(ws, {content, images}, mode)` | 追加 user 行；**去重守卫**：transcript 末条同内容同图片的 user 行则跳过（重试 / regenerate 不新增 user 行） |
| `persistTranscriptAssistant(ws, {content, reasoning, agentSteps, files, interrupted}, mode)` | 追加 assistant 行；全空则跳过 |
| `hydrateChatTranscript(ws)` | 解析 transcript → `HydratedSession`（与 pi 水合同形状，前端 `dtoToChatMessage` 直接消费）；文件不存在返回空会话 |
| `readTranscriptHead(file)` | 只读文件头（≤256KB）取创建时间 / 首条 user 文本（标题源）/ 轮次近似值 / 来源 mode |
| `listChatConversations(userId, nodeId?, mode='pi')` | **三模式隔离**：'pi' = 原 `listPiConversations`（行为不变）；'llm'/'agent' = 扫含 `conversation.jsonl` 且行内 mode 匹配的工作区（跳过 pi 工作区）。排序：置顶在前 / pinnedAt 倒序 / 其余 updatedAt 倒序 |
| `deleteChatConversation(userId, workspaceId)` | 按存储族分派：有 pi 会话文件 → `deletePiConversation`（杀 RPC 进程+清理+删目录）；否则直接 `rmSync` 整目录（产物/上传附件一并清除） |

**`backend-ts/src/services/pi/conversations.ts`**：`titleFromUserText` / `formatFallbackTime` 由私有改为导出（供 `chat-conversations.ts` 复用标题与兜底时间格式）。

**`backend-ts/src/services/pi/snapshot.ts`**：`DIFF_EXCLUDED_FILES` 增加 `conversation.jsonl`（transcript 是会话数据，不算「AI 产物」，不出现在文件面板）。

**`backend-ts/src/modules/bookplate/helpers.ts`**：

```ts
export function agentSessionKey(userId, nodeId?, epoch = 0, workspaceId?): string {
  if (workspaceId) return `bookplate-${userId}-${workspaceId}`;   // 一对话一 key
  return `bookplate-${userId}-${nodeId || 'anon'}-${epoch}`;      // 无 workspaceId 时回退旧格式
}
```

**`backend-ts/src/modules/bookplate/routes/ai-nodes.ts`** 相关路由：

| 路由 | 说明 |
| --- | --- |
| `POST /chat` | LLM 分支写 transcript（mode='llm'）；FastClaw 分支：`sessionKey = agentSessionKey(..., workspace_id)`、写 transcript（mode='agent'，含步骤/产物）、产物桥接 `{ws}/outputs`、运行结束（成功/失败）调 `clearSessionFilesCache(sessionKey)` |
| `GET /chat/sessions?mode=pi\|llm\|agent` | 对话历史列表（缺省 = pi，保持既有行为）；`node_id` 可选按 `{nodeId}_` 前缀过滤 |
| `GET /chat/session?workspace_id=` | 水合：`hydratePiSession` 优先，无 pi 会话文件则 `hydrateChatTranscript`；附 widget 快照 |
| `POST /chat/session/pin`、`POST /chat/session/rename` | 写 `{ws}/.pi-agent/meta.json`（存储无关，三模式共用） |
| `DELETE /chat/session` | `deleteChatConversation`（按存储族分派） |
| `GET /chat/files` | 工作区产物列表（transcript 被差分排除） |
| `GET /chat/fastclaw-files`、`GET /chat/fastclaw-files/download` | FastClaw 服务端会话文件列表 / 下载代理（带鉴权，逐段编码路径） |

**`backend-ts/src/services/fastclaw-service.ts`**：`listSessionFiles` 增加 **5s TTL 内存缓存**（key = sessionId，会话 id 全局唯一），导出 `clearSessionFilesCache(sessionId)`；每次 FastClaw 一轮运行结束由 `/chat` 分支即时失效，保证新产物立即可见（防缓存尺寸膨胀：写入时顺带清理过期项）。

### 6.3 前端接线

**`frontend/src/modules/bookplate/ChatNodeHost.tsx`**（LLM + FastClaw 共用宿主）：

- **水合 effect**：`wsId` 变化（载入历史 / 挂载恢复）→ `fetchPiSession(wsId)`（服务端按存储族分派）→ 首条 user 消息剥离注入上下文（`stripInjectedContext`，与发送侧同口径）→ `setMessages` + 写 store 镜像基线（`lastMirroredRef` 先更新防回灌）。首轮发送自生成 workspaceId（self-assigned）不触发水合/中断。
- **历史 handlers**：`handleSelectConversation`（切 workspaceId）、`handleToggleConversationPin` / `handleRenameConversation`（meta.json + 列表刷新）、`handleDeleteConversation`（删除当前会话时重置工作区 + `evictSessionCache`）。
- **文件面板自动刷新**：非 self-assigned 的 `wsId` 变化时 `panel.reset()` + `panel.refreshIfOpen()`（与 `PiChatNodeHost` 同口径），载入历史会话后「AI 产物」立即按新工作区拉取（FastClaw 走 `fetchFastClawWorkspaceFiles`，LLM 走 `fetchWorkspaceFiles`）。
- **历史面板模式**：`useConversationHistoryPanel(sideOpen, h.configOf(node)?.mode === 'agent' ? 'agent' : 'llm')`——FastClaw 节点只看 agent 会话，LLM 节点只看 llm 会话。

**`frontend/src/modules/bookplate/useConversationHistoryPanel.ts`**：签名 `(openOverride?, mode?: 'pi'|'llm'|'agent')`，mode 透传给 loader；缺省 'pi'（`PiChatNodeHost` 零改动）。

**`frontend/src/modules/bookplate/piSessionApi.ts`**：`fetchConversationSessions(mode?)` 追加 `?mode=` 查询参数。

**`frontend/src/modules/bookplate/PiChatNodeHost.tsx`**：零改动（缺省 mode='pi'，行为与落地前一致）。

---

## 7. 实现时已定的设计决策

1. **三模式严格隔离，互不混显**：`GET /chat/sessions?mode=pi|llm|agent`（缺省 pi）。pi 会话（chat.jsonl）与 LLM/FastClaw transcript 会话（conversation.jsonl）存储互斥；LLM 与 FastClaw 共用 transcript 存储族（同一工作区同一文件），靠行内 `mode` 标记 + 列表过滤区分——任一模式的抽屉都看不到其它模式的对话。
2. **统一会话键 = workspaceId**：pi 已是；LLM/FastClaw transcript 按它落盘；FastClaw sessionKey 改为含它。
3. **transcript 与 pi 协议解耦**：`conversation.jsonl` 是独立格式，不解析 pi JSONL；两套存储族在同一路由形态下共存（水合优先 pi，删除按 pi 会话文件存在与否分派）。
4. **旧数据启发式**：无 `mode` 字段的历史 transcript 按「assistant 行是否含 agentSteps」判定 llm/agent（历史数据无需迁移）。
5. **FastClaw 删除 = 本地遗忘**：本端删工作区目录；FastClaw 服务端会话状态不在本端可清除范围（Route A 语义）。
6. **文件面板会话切换自动刷新** + **FastClaw 文件列表短缓存**（5s TTL，运行结束即时失效）：载入历史会话后产物列表即时、重复打开免重复打 FastClaw 网关。

---

## 8. 风险、已知问题与维护注意

- **FastClaw sessionKey 变更代价（一次性）**：key 从 `(uid, nodeId, epoch)` 改为 `bookplate-{uid}-{workspaceId}` 后，**存量 FastClaw 对话上下文断裂**（旧 key 失效、续聊从零开始）。已接受；`upstream-api.md` 明确 sessionKey 驱动记忆抽取与用量分组——一对话一 key 符合「不要复用同一 key 于无关对话」指引。
- **LLM 模式孤儿工作区**：清空对话后旧工作区目录残留（与 pi 同），用抽屉「删除会话」入口清理。
- **`fastclaw-artifacts.test.ts` 在 Windows 失败（pre-existing，与本次改动无关）**：3 个用例（`resolveFastclawArtifact` 根内真实文件放行、`harvestFastclawArtifacts` 两个）在 Windows 上失败——测试用 `os.tmpdir()`（`E:\Temp\...`）构造根目录，而 `resolveFastclawArtifact` 契约只认 `/` 开头的 POSIX 绝对路径（FastClaw 部署环境为 Linux）。已用 `git stash` 验证改动前后失败一致。修复需让测试在 Windows 构造 POSIX 风格路径或跳过，未处理。
- **多租户安全**：列表/水合/删除/文件接口一律按 `authUser.id` 收敛 + `sanitizeWorkspaceId` + 目录穿越双保险（沿用既有模式）。
- **写路径 best-effort**：transcript 落盘失败静默跳过，绝不阻断对话流——因此列表可能短暂缺失某轮，刷新（抽屉刷新按钮 / 版本递增）自愈。

---

## 9. 测试与回归防线

- `backend-ts/tests/api/chat-conversations.test.ts`：LLM / FastClaw transcript 落盘（含行内 mode 断言）、重试不重复 user 行、水合（含工具步骤）、列表标题/轮次、**三模式隔离**（pi / llm / agent 互不混显）、置顶/重命名、产物差分排除、删除闭环、FastClaw 会话 key（`bookplate-{uid}-{workspaceId}`）。
- `backend-ts/tests/api/fastclaw-files.test.ts`：会话文件列表过滤 / 路径越界守卫 / 下载代理 URL；**TTL 缓存命中与 `clearSessionFilesCache` 失效**（用例间在 `afterEach` 清缓存防污染）。
- 回归命令（项目约束）：
  ```bash
  npx tsc --noEmit                                  # backend-ts 与 frontend 各跑一次
  npx vitest run tests/api/pi-*.test.ts             # pi 协议回归
  npx vitest run tests/api/chat-conversations.test.ts tests/api/fastclaw-files.test.ts
  ```

---

## 10. 遗留开放问题

1. **FastClaw 删除语义**：当前为本地遗忘（FastClaw 侧会话状态仍在）。若需彻底删除，需 FastClaw 内部 `/api/*` 提供会话删除端点（路线 B，未核实）。
2. **LLM 模式严格分列**：LLM 与 FastClaw 目前共用 transcript 存储族、靠行内 mode 区分，实际不会混同（一个节点模式固定）。若将来节点可运行时切换模式，需确认同一工作区续聊语义。
3. **存量 FastClaw 会话**：sessionKey 变更导致旧会话无法续聊（一次性代价，已接受）。

---

## 11. 一句话结论

> LLM 与 FastClaw 模式都已支持对话历史：**抽屉 / 面板 / DTO / meta.json 置顶重命名全部复用**；**后端会话存储分两套**——pi 保持既有实现，LLM 与 FastClaw 共用 `chat-conversations.ts` 本地 transcript（行内 `mode` 标记实现三模式严格隔离），路由形态统一（列表/水合/删除按存储族分派）；前端只在共用宿主 `ChatNodeHost` 补一处接线（水合 effect + 历史 handlers + 文件面板自动刷新），**无需为每模式重写整套功能**。维护入口：`chat-conversations.ts`（存储层）、`ai-nodes.ts`（路由）、`ChatNodeHost.tsx`（前端接线）。