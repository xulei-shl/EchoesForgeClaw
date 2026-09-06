# ChatNode 运行配置切换模型 / Agent —— 对话连续性漏洞分析与修复方案

> 前置阅读：`docs/skill-agent/chatnode-对话历史-多模式扩展可行性分析.md`（LLM / FastClaw 模式对话历史落地）。
> 本文回答：**在节点右下角「运行设置」中切换模型（LLM 模式）或 FastClaw Agent 时，对话历史是否会丢失？当前实现是否存在「只传最新一条消息 → 从头开始」的漏洞？跨模型 / 跨 Agent 续聊是否应该支持？若支持成本过高，是否应按「同模型 / 同 Agent」切割会话？**
>
> 结论先行（2026-09，代码核对后）：
> - **LLM 模式不存在「只传最新消息」问题**：每轮请求都全量重发 `payload.messages`（含首条 user 消息里展开的注入上下文），跨模型续聊在协议层已天然成立。真正挡住切换的是 UI 锁（`disabled={hasMessages}`）。
> - **FastClaw 模式存在两个真实缺口**：① 续聊完全依赖 FastClaw 服务端按 `sessionKey` 持有的会话，本地 transcript 只是镜像，无法重建 agent 内部状态（记忆 / 工具链 / 会话工作区文件）；② `sessionKey` 不含 agent 维度，跨 Agent 语义未定义，当前靠 UI 锁定规避。
> - **已落地**：**范围 A**（LLM 解锁「模型」下拉，对话中可跨模型续聊，全量历史自动重发）；**范围 C**（FastClaw 跨 Agent 文本折中 —— 核实 bundled FastClaw 源码后确认会话按 `(agent, sessionKey)` 复合键隔离，同 workspaceId 换 Agent 在服务端即新会话、无串台，故由后端在换 Agent 后首轮把旧 transcript 文本折叠进出站 message 就地续聊，前端零改动；详见 §3.6 / §3.7 / §4 范围 C）。
> - **同 Agent 续聊免折中**：`sessionKey` 相同，服务端会话存活即自动续（只发最新消息）；**G1（服务端会话丢失 → 从头）仍为已知限制**，完整兜底需 FastClaw 上游提供会话探测 / replay 端点。
> - 早期建议的「B1（换 Agent = 前端重置 workspaceId 开新会话）+ transcript 补记 `agent_config_id`」方案因会话按 agent 隔离的事实**未采用**（见 §3.3 / §4 B1）。

---

## 1. 现状核对：代码实际行为（2026-09）

### 1.1 LLM 分支（Vercel AI SDK）

| 环节 | 实际行为 |
| --- | --- |
| 前端发送 | `ChatNodeHost.tsx` `prepareSendMessagesRequest` 每次发送 `messages: wire` —— **完整消息数组**；`toWireChatMessages`（`graphTypes.ts`）把首条 user 消息上隐藏的注入上下文（context / contextImages）展开进 content 随历史重发 |
| 后端消费 | `ai-nodes.ts` LLM 分支 `llmService.chatStream(payload.messages ?? [], config)` —— 全量使用，非末条 |
| transcript | 每轮只追加「末条 user + assistant 回复」（append-only 镜像，与全量重发互不冲突） |

> 结论：**LLM 模式中途切换模型（若允许）不会丢上下文** —— 新模型拿到的是完整 transcript + 展开后的注入上下文。`模型`下拉在 `ChatNodeSettingsPopover.tsx` 中 `disabled={hasMessages}`（对话开始后锁定，tooltip「运行设置 (已锁定)」），切换必须先清空对话；清空 = 递增 epoch + 置空 workspaceId = **刻意的新会话语义**，不是漏洞。

### 1.2 FastClaw 分支（Agent 模式）

| 环节 | 实际行为 |
| --- | --- |
| 前端发送 | 只发 `message`（最新一条 user 文本）+ `sessionKey` + `images` + `agent_config_id`，**不发历史数组** |
| 后端转发 | `ai-nodes.ts` FastClaw 分支 `runAgent(cfg, payload.message, sessionKey, …)` → FastClaw `POST /api/chat/stream`，body `{agentId, sessionId: sessionKey, message}` |
| 历史回顾 | **完全由 FastClaw 服务端按 `sessionId`（= `sessionKey` = `bookplate-{uid}-{workspaceId}`）持有**（`helpers.ts agentSessionKey`） |
| transcript | 本地镜像 `{ws}/conversation.jsonl`（`mode:'agent'`，含工具步骤 / 桥接产物）—— 供抽屉列表 / 水合展示，**不是 agent 上下文的真相源** |

> 结论：续聊成立的前提是 **FastClaw 服务端会话仍在**。会话存活 → 同 workspaceId 续聊 = 完整上下文（非从头）；会话丢失（服务重启 / 过期 / 逐出）→ FastClaw 只收到最新一条消息 → **真·从头开始**，此时本地 transcript 只能水合出可见文本层，重建不了 FastClaw 内部状态。
>
> 另外：`Agent` 下拉同样 `disabled={hasMessages}`，注释明确写道「对话开始后锁定，需先清空对话才能切换，避免 FastClaw 服务端会话串台」—— 因为 `sessionKey` **不含 agent 维度**：若放开切换而 workspaceId 不变，旧 Agent 的整个会话（记忆 / 工具链 / 文件）会被喂给新 Agent（串台），而非从头。

### 1.3 「只传最新一条 → 从头开始」判定汇总

| 模式 | 只传最新消息？ | 实际连续性依赖 | 切换后是否从头？ |
| --- | --- | --- | --- |
| LLM | ❌ 每轮全量重发 | 消息数组本身（前端 + 后端） | 不会（协议层天然连续） |
| FastClaw | ✅ 只传 `message` | FastClaw 服务端 `sessionKey` 会话存续 | 会话在 → 连续；会话丢 → 从头（UI 仍像「已恢复」） |

---

## 2. 两个真实缺口

| # | 缺口 | 表象 | 现状规避手段 |
| --- | --- | --- | --- |
| G1 | **FastClaw 续聊依赖服务端会话存续**；transcript 无法重建 agent 内部状态（记忆抽取、工具调用链、会话工作区文件） | 「恢复历史会话」后继续对话，FastClaw 侧可能已无该 session → 只见最新消息 → 上下文为空 | 无（未检测、未兜底） |
| G2 | **`sessionKey` 无 agent 维度**，跨 Agent 语义未定义（复用同一 key = 串台；加 agent 维度 = 切换即新会话 = 从头） | 若放开 Agent 下拉切换：同 workspaceId 下新 Agent 拿到旧 Agent 的全部会话上下文 | UI 锁定（必须先清空 → 新 workspaceId → 新会话） |

> 关联：`chatnode-对话历史-多模式扩展可行性分析.md` §10 开放问题 #2「若将来节点可运行时切换模式，需确认同一工作区续聊语义」—— 本分析即其延伸：当前「一个节点模式固定」的假设使 transcript 行内 mode 混存不成问题；一旦允许节点内切换模型 / Agent，就必须先定义同一工作区的续聊语义。

---

## 3. 设计决策：跨模型 / 跨 Agent 是否支持

### 3.1 LLM 跨模型：**支持**（近乎零成本）—— 已实现

- 协议层已支持：每轮全量重发，注入上下文随首条 user 消息持久化并展开重发（`toWireChatMessages`）。
- 落地 = 解锁 `ChatNodeSettingsPopover.tsx` 中「模型」字段的 `disabled={hasMessages}`（上下文开关仍保持锁定 —— 它们只在首轮注入一次，是其余字段锁定的真正原因）。
- 可选增强：transcript 行内记录 `model_name`，会话列表展示该会话使用的模型（展示维度，无结构改动，本次未做）。
- 注意：切换模型后上下文窗口 / 图像 token 消耗由模型侧决定，非本架构问题。

### 3.2 FastClaw 跨 Agent：**不支持，按 Agent 切割会话**

原因（架构性，非实现麻烦）：

1. **FastClaw 会话状态是 agent 实例级的**（记忆抽取、工具调用链、会话目录文件），语义上绑定具体 Agent。会话以
   `(agent, sessionKey)` 复合键隔离（bundled 源码：`internal/setup/handlers.go handleChatStream` 内
   `agentID := ag.Name()`，`event_hub.go hubKey(userID, agentID, sessionKey)`，会话/记忆/用量均按此寻址），
   `upstream-api.md` 的「Do not reuse one session key…」针对的是**同一 Agent 内**把无关对话塞进同一 key
   （会串历史 / 记忆）；换 Agent 后 sessionKey 不再指向旧会话 —— 这是范围 C 就地折叠能成立的前提。
2. **本地 transcript 只能重建文本层**：即使把前序轮次拼成一条巨型 user 消息塞给新会话，也只是「看起来续上了」，工具 / 记忆 / 文件产物语义全部丢失，还会把旧上下文重复计入新会话用量。
3. **FastClaw 无会话 replay / clone 端点**（`upstream-api.md` 只有 chat / agents / usage / quota）：真正跨 Agent 续聊 = 路线 B，需上游支持（未核实）。

### 3.3 推荐形态（B1：切换 Agent = 自动开新会话）

与现状「锁定 + 手动清空」语义一致，但体验更好且不丢历史：

- 前端：`agentOverride` 变更且已有消息时，先走 `handleClearChatFor` 同口径重置（epoch + 1、`workspaceId` 置空、清空 messages），再应用新 `agentOverride` → 下次发送生成新 workspaceId → 新 sessionKey → 新 transcript；**旧会话保留在抽屉**（列表 / 置顶 / 重命名 / 删除照常），可回看。
- **零后端改动、零数据模型改动、无迁移**（换 Agent 必换 workspaceId 的既有语义天然成立）。
- 可选折中增强（C）：切换 Agent 时把旧 transcript 文本作为一段「背景上下文」注入新会话首条 user 消息 —— 文本层续聊，内部状态不重建（低成本，可后续再加）。

> **最终实现（2026-09）**：B1（清空 + 换 workspaceId）**未采用**。已核实 bundled FastClaw 源码：会话按
> `(agent, sessionKey)` **复合键**隔离 —— `handleChatStream` 内 `agentID := ag.Name()`，会话/事件/记忆/用量全部
> 以 `(userID, agentID, sessionKey)` 寻址（`event_hub.go hubKey`、`manager.go` 逐 agent 实例、`handlers.go
> handleChatStream`）。**因此同 workspaceId 复用 sessionKey 换 Agent 无串台风险**（新 Agent = 全新会话），
> 不必重置 workspaceId。改为后端**就地文本折中**（范围 C 落地方案，见 §4）：首轮把旧 transcript 文本折叠进
> FastClaw message，留在原条目继续（见 §3.7 与 §4 范围 C「实现」列）。

### 3.4 更深的切割（B2：同 workspaceId 内按 Agent 区分）—— 不推荐，除非确有需求

- `helpers.ts agentSessionKey` 加 agent 维度：`bookplate-{uid}-{workspaceId}-{agentId}`；
- transcript 行内加 `agentId`，`listChatConversations` 过滤加 agent 维度，列表同 workspaceId 不同 agent 显示为两条；
- 代价：数据模型改动 + **存量 FastClaw 会话 key 再次断裂**（可行性分析 §8 已接受过一次），仅在「允许同会话内切换 Agent 且保留旧展示消息」时才值得。

### 3.5 G1 兜底（FastClaw 服务端会话丢失）

- 现状：无检测、无兜底，恢复历史后继续对话若服务端会话已丢则上下文为空（UI 无感知）。
- 可选兜底：发送前检测服务端会话是否存在（`listSessionFiles` 404 等信号不可靠）；检测明确缺失时，把 transcript 前序轮次折叠为上下文摘要随本轮发出（新 session + 带上下文单轮），保证文本层连续。
- 检测手段有限，误判会与真实存在的服务端会话造成上下文重复 —— 建议先作为已知限制记录，待上游提供会话探测 / replay 端点（路线 B）再落地。

### 3.6 场景补全：新建 / 清空 → 切换 → 载入历史 → 续聊

节点为空（新建 / 清空对话，`hasMessages=false`）时，模型 / Agent 下拉本就**未锁定**，因此该流程今天即可触达：

1. 新建节点或清空对话（`workspaceId=''`，无消息）；
2. 在「运行设置」中切换模型（LLM）或 Agent（FastClaw）；
3. 从抽屉载入一条历史会话（`handleLoadChatSessionFor` → **恢复该会话的旧 `workspaceId`**，宿主水合出可见消息）；
4. 继续发送。

| 分支 | 载入后 `sessionKey` | 续聊行为 | 是否需要折中 |
| --- | --- | --- | --- |
| LLM（任意模型） | 不适用（每轮全量重发 `payload.messages`） | 新模型收到完整历史 + 展开的注入上下文 | ❌ 无需，今天已成立 |
| FastClaw **同** Agent | 与历史会话**相同** | 服务端会话存活 → 自动续聊（记忆 / 工具链 / 文件完整） | ❌ 无需（用户观察正确） |
| FastClaw **异** Agent | 与历史会话**相同**（但会话按 `(agent, sessionKey)` 隔离 → 新 Agent 下是**新会话**，非复用，无串台） | 服务端按当前 Agent 建新会话 → 旧历史不可见 → 只见最新消息 = 从文本上「从头」 | ✅ **折中（范围 C，就地折叠，已实现）** |

**异 Agent 分支的正确做法 —— 就地文本折中（范围 C，最终落地形态，后端一条路径即可覆盖）：**

- **不改 workspaceId、不复用旧服务端会话**：FastClaw 会话按 `(agent, sessionKey)` 复合键隔离（源码：
  `handleChatStream` 内 `agentID := ag.Name()`，事件/记忆/用量均按 `(userID, agentID, sessionKey)` 寻址）。
  换 Agent 后仍发同一 sessionKey → 服务端是**新会话**，无串台；该 workspaceId 的 transcript / 产物桥接不动，
  续聊留在原条目。
- **文本层折中在路由层自动完成**：transcript 行写入该轮实际 Agent 运行时身份
  `agentKey = {agent_id}@{base_url}`；每轮发送前对比末行 agentKey 与当前 Agent —— **不同则把旧 transcript
  折叠为纯文本拼进出站 message**（FastClaw 新会话不带旧 transcript），相同（同 Agent 续聊）则照旧只发最新消息。
  折叠只在换 Agent 后的**第一轮**发生：本轮 user 行落盘后末行 agentKey 即当前 Agent，后续轮次不再触发。
- **同 Agent 分支的 G1 例外依旧成立**：服务端会话丢失时「只发最新消息」= 从头，UI 无感知（已知限制，检测手段不可靠，待上游支持）。
- 历史 transcript 的写入发生在换 Agent 功能上线**之前**（旧行无 agentKey）时无法可靠判定（不回折中，记为已知限制）；
  功能上线后新落盘的会话自动获得 agentKey，判定完整生效。

### 3.7 就地折叠的实现细节（范围 C 落地）

FastClaw `/chat` 分支（`backend-ts/src/modules/bookplate/routes/ai-nodes.ts`）在生成出站 message 前判定：

```
prevAgentKey = lastTranscriptAgentKey(ws)   // transcript 末行写入的 {agent_id}@{base_url}，旧行无字段 → null
foldText = prevAgentKey && agentKey && prevAgentKey ≠ agentKey
           ? buildTranscriptFoldText(ws)     // user/assistant 正文按轮次拼接，超限保留最近并标注省略
           : ''
出站 message = foldText ? foldText + "\n\n" + 本轮 message : 本轮 message
```

- transcript 每行（user / assistant）记录该轮实际 Agent 身份 `agentKey`（`{agent_id}@{base_url}`）；
- 折叠判定读的是**落盘前**的 transcript，且换 Agent 后只在本轮触发一次（本轮 user 行落盘后末行即当前 Agent）；
- 原文（不含折叠文本）照常落盘 user 行 —— 水合 / 列表 / 展示不受影响；
- 与「空会话期改 Agent + 载入历史续聊」流程完全兼容：会话留在原条目（同 workspaceId），FastClaw 服务端是新会话，
  产物桥接仍落在该工作区；后端一条路径同时覆盖「同 Agent 免折中」「异 Agent 首轮折叠」，前端零改动。

### 3.8 跨 Agent 产物文件继承（签名 URL 附件，已实现）

换 Agent 后 FastClaw 新会话的工具只能读自己会话 `/workspace`（`internal/agent/tools/file.go`：绝对路径在
self-hosted 非 admin 下被 bound 到 agent workspace，越界 `errOutsideSandbox` 拒绝）——历史产物（本端 `outputs/`
或旧 Agent 会话目录）B 都读不到。因此**实体继承只能走 FastClaw 官方附件通道**（物化进 B 会话 /workspace，
三写一致 + 面板可见 + 一行 `[Attached: /workspace/<name>]` breadcrumb，不占上下文窗口）：

- 跨 Agent 首轮：读产物清单（`.pi-agent/artifacts.jsonl`，按 rel 去重取最新）→ 过滤仍存在、单文件 ≤8MB、
  每轮 ≤12 个的 `outputs/` 文件 → 生成 **HMAC 签名 URL 附件**（`inheritFileUrl`：`uid|ws|rel|exp` 签名、90s TTL），
  随 `runAgent` 的 `attachments` 发给 FastClaw；同机部署 FastClaw 自 fetch（http(s) URL 通道），请求体只剩 URL；
- 超限 / 已删文件不进附件，降级为「文件名清单」拼进折叠文本（至少告知 B 存在）；
- 本端新增无鉴权下载端点 `GET /api/modules/bookplate/chat/inherit-file`（签名即鉴权，仅放行签名绑定用户工作区
  `outputs/` 下的普通文件，防任意文件读取）；base 地址可配 `INHERIT_ATTACH_BASE_URL`（默认 `http://127.0.0.1:{PORT}`）。

---

## 4. 落地改动清单（按范围）

### 范围 A：LLM 解锁（跨模型续聊）—— 已实现

| 文件 | 改动 | 状态 |
| --- | --- | --- |
| `frontend/src/modules/bookplate/components/chat/ChatNodeSettingsPopover.tsx` | 「模型」字段去掉 `disabled={hasMessages}`（Agent 字段、上下文开关保持锁定）；锁定提示文案改为「模型可随时切换，历史自动续传；上下文 / Agent 需先清空」 | ✅ |
| `frontend/src/modules/bookplate/components/ChatNode.tsx` | 「运行设置 (已锁定)」tooltip 调整为「运行设置 (模型可切换；上下文与 Agent 已锁定)」 | ✅ |
| （可选）`backend-ts/src/services/chat-conversations.ts` + `ai-nodes.ts` | transcript 行内记录 `model_name`，会话列表 / 水合展示（展示维度，本次未做） | ⏸ |

### 范围 B1：FastClaw 切换 Agent = 自动新会话 —— 未采用

> 曾计划：`agentOverride` 变更且已有消息 → 清空语义重置（epoch+1 / workspaceId 置空 / messages 清空）。
> 落地时核实 FastClaw 会话按 `(agent, sessionKey)` 隔离（源码 `handleChatStream` / `hubKey`），**同 workspaceId
> 换 Agent 本就是服务端新会话**，无需前端重置即可安全就地续聊 → 被范围 C 的就地折叠取代（见 §3.7）。

| 文件 | 改动 | 状态 |
| --- | --- | --- |
| `frontend/src/modules/bookplate/ChatNodeHost.tsx` | `agentOverride` 变更且已有消息 → 先走清空语义再应用新 Agent；旧会话保留抽屉 | ⏸ 未做（被 C 取代） |
| `frontend/src/modules/bookplate/components/chat/ChatNodeSettingsPopover.tsx` | Agent 字段放开锁定 | ⏸ 未做（Agent 下拉维持对话中锁定） |

### 范围 B2：FastClaw 按 Agent 深度切割（仅在有需求时）

| 文件 | 改动 |
| --- | --- |
| `backend-ts/src/modules/bookplate/helpers.ts` | `agentSessionKey` 加 agent 维度 |
| `backend-ts/src/services/chat-conversations.ts` | transcript 行内 `agentId` + 列表过滤 |
| `backend-ts/src/modules/bookplate/routes/ai-nodes.ts` | `/chat`、`/chat/sessions`、`/chat/fastclaw-files` 等按 agent 维度复算 / 过滤 |

### 范围 C：跨 Agent 文本层折中（已实现）

**落地思路**：路由层（后端）自动完成，无需前端配合、不重置 workspaceId —— FastClaw 会话按 `(agent, sessionKey)`
复合键隔离，同 workspaceId 换 Agent = 服务端新会话（无串台），首轮把旧 transcript 文本折叠进出站 message 即可。

| 文件 | 改动 | 状态 |
| --- | --- | --- |
| `backend-ts/src/services/chat-conversations.ts` | `TranscriptMessage` 增可选字段 `agentKey`（该行实际 Agent 运行时身份 `{agent_id}@{base_url}`）；`persistTranscriptUser / persistTranscriptAssistant` 增第 4 参；新增 `lastTranscriptAgentKey`（读末行 agentKey，旧行无字段 → null）+ `buildTranscriptFoldText`（把前序 transcript 折叠为纯文本；每段截 20k 字符、总量超 200k 保留最近轮次并标注省略） | ✅ |
| `backend-ts/src/services/fastclaw-artifacts.ts` | 新增 `inheritFileUrl` / `verifyInheritFileRequest`（HMAC(uid\|ws\|rel\|exp) 签名 URL，90s TTL，仅放行 `outputs/` 词法内文件）+ `buildInheritAttachments`（读产物清单 → 按 rel 去重 → 存在性 / 单文件 ≤8MB / 每轮 ≤12 筛选 → 签名 URL 附件 + 超限文件名清单） | ✅ |
| `backend-ts/src/modules/bookplate/routes/ai-nodes.ts` | FastClaw `/chat` 分支：解析 `agentKey` → 跨 Agent 首轮折叠旧 transcript + 组装继承附件（`attachments`）传 `runAgent`，超限清单拼进消息；新增 `GET /api/modules/bookplate/chat/inherit-file` 签名下载端点（无鉴权，流式返回） | ✅ |
| `backend-ts/src/services/fastclaw-service.ts` | `runAgent` 增可选 `attachments?: { url; name? }[]`（并入 FastClaw chat 请求体） | ✅ |
| `backend-ts/src/config/env.ts` | 新增 `inheritAttachBaseUrl`（`INHERIT_ATTACH_BASE_URL`，默认 `http://127.0.0.1:{PORT}`；容器部署需指向 FastClaw 可达的宿主地址） | ✅ |
| `backend-ts/tests/api/chat-conversations.test.ts` | 跨 Agent 用例扩展：首条出站含折叠历史 + 签名 URL 附件（名字 / 端点可下载原字节 / 篡改签名 403 / 越权 rel 403）+ 超限与已删文件进降级清单；同 Agent 不折叠不带附件；第 3 轮不再触发 | ✅ |

> 范围 C 与 B1 的关系：早期方案假设「同 workspaceId 换 Agent = 复用旧 FastClaw 会话（串台）」因此必须重置
> workspaceId（B1 口径）；核实 bundled FastClaw 源码后推翻该前提（会话按 agent 隔离），故无需 B1 的前端重置，
> 采用**就地折叠**。切换入口仍是「空会话期改 Agent + 载入历史续聊」—— Agent 下拉在对话中保持锁定不变。

---

## 5. 风险与已知限制

- **FastClaw 会话存续不可控**（G1）：服务端会话丢失后「恢复历史」仅文本层成立；内部状态（记忆 / 工具链 / 文件）无法重建。兜底依赖上游能力（路线 B，未核实）。跨 Agent 折叠同样不重建内部状态 —— 它补偿的是「换 Agent 后 FastClaw 侧本来就拿不到旧会话」，与 G1 的「会话意外丢失」是同一类限制的两种表象。
- **旧会话换 Agent 续聊的文本截断**：折叠文本按消息 20k 字符、总量 200k 字符截断（保留最近轮次），超长会话跨 Agent 续聊只能带回最近部分。
- **继承附件的体积与数量上限**：单文件 ≤8MB、每轮 ≤12 个（远低于 FastClaw 端 25MB / 附件硬上限）；超限 / 已删文件仅保留文件名清单，B 读不到内容。
- **继承附件依赖同机可达**：签名 URL 的 base 地址默认 `127.0.0.1:{PORT}`，FastClaw 与后端不在同一网络命名空间（容器 / 远程部署）时需配 `INHERIT_ATTACH_BASE_URL` 指向 FastClaw 可达地址，否则 FastClaw fetch 失败 → 附件丢失（文本层折中仍生效）。
- **功能上线前的存量 transcript 无 agentKey**：末行旧行无 `agentKey` 时无法判定是否换 Agent，不回折中（冷启动期边界情况；新落盘会话自动带 agentKey）。
- **sessionKey 无 agent 维度**（G2）：本方案利用 FastClaw 会话按 `(agent, sessionKey)` 隔离的前提，无需给 key 加维度；若该前提在自建 / 上游新版本中不成立（会话退化为纯 sessionKey 寻址），需回到 B1 / B2 方案。
- **LLM 解锁后的体验风险**：不同模型上下文窗口不同，超长历史由模型侧截断（非本架构问题）；图像历史随每轮重发会增加 token 消耗（既有行为，非本次引入）。
- **多租户 / 安全**：任何涉及 FastClaw 的会话 key、文件列表改动都需保持 `authUser.id` 收敛 + `sanitizeWorkspaceId` 双保险（沿用既有模式）。

---

## 6. 一句话结论

> 「运行设置切换模型 / Agent 导致从头开始」在 **LLM 模式不成立**（每轮全量重发，跨模型续聊协议层已支持，只差解锁 UI 锁）；在 **FastClaw 模式部分成立** —— 只传最新消息 + 靠服务端 sessionKey 回顾历史，会话存续则连续、丢失则从头，且 sessionKey 无 agent 维度。已落地：**范围 A**（LLM 解锁模型下拉，对话中可跨模型续聊）＋ **范围 C**（FastClaw 跨 Agent 文本折中：transcript 行记 `agentKey`，换 Agent 后首轮把旧历史折叠进出站 message 就地续聊 —— 前提是核实了 FastClaw 会话按 `(agent, sessionKey)` 隔离，同 workspaceId 换 Agent 无串台，故无需 B1 的前端重置）；**同 Agent 续聊免折中**（sessionKey 相同，服务端会话存活即自动续）；**G1 的完整兜底需 FastClaw 上游提供会话探测 / replay 能力（路线 B）**。