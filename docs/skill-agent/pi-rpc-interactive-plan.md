# Skill Agent RPC 交互通道方案（接入 `rpiv-ask-user-question`）

> **文档版本**：v1.0（方案评审稿）
> **创建日期**：2026-08-29
> **目标读者**：接手实现的工程师（本方案是「设计决策记录」，实现时以本文件为准，不再重新决策）
> **关联文件**：
> - 现状主线：`docs/skill-agent/pi-extension-integration.md`（扩展接入最佳实践，本文是它的 RPC 扩展章节）
> - 现状主线：`docs/skill-agent/extension-widgets-implementation-plan.md`（v2.0，widget 桥方案）
> - 参考项目：`docs/skill-agent/pi-web-main`（pi-web，单用户本地，**RPC 交互通道的参考实现**）
> - 后端：`backend-ts/src/services/pi-agent-service.ts`（`runPiAgent` / `mapPiJsonEvent`）
> - 后端：`backend-ts/src/services/pi-widgets.ts`（widget 桥，现状保留）
> - 后端：`backend-ts/src/modules/bookplate/routes/ai-nodes.ts`（chat 路由，注入点）
> - 后端：`backend-ts/src/modules/bookplate/stream.ts`（`ChatStreamEvent` 定义）
> - 前端：`frontend/src/modules/bookplate/piStream.ts`、`PiChatNodeHost.tsx`、`components/ChatNode.tsx`
> - 目标扩展包：`docs/skill-agent/rpiv-package/rpiv-ask-user-question`（`@juicesharp/rpiv-ask-user-question`，已全局安装 v2.7.1）

---

## 0. 摘要

要给 Skill Agent 节点接入交互式扩展 `ask_user_question`（模型将结构化问卷弹给用户选择），现状的「json 一次性执行 + widget 桥」机制**无法覆盖**：`--mode json` 下 pi 报告 `ctx.hasUI === false`，扩展自带的 reconciler 会在每轮 `before_agent_start` 时把该工具从模型工具列表中移除，模型根本不会调用它。

参考 pi-web 证明的可行机制，本项目需要引入 **pi RPC 模式（`--mode rpc`）** 的交互通道：pi 子进程将其 `extension_ui_request`（select/confirm/input/editor）事件经 SSE 推给浏览器，用户在浏览器作答后经独立 POST 将 `extension_ui_response` 写回子进程 stdin，pi 恢复执行。**其余既有机制（白名单、`-e` 装配、widget 桥、SSE 事件面、多轮记忆）全部不变。**

本方案的关键约束与现状基线：
- 保持「每对话一次独立子进程」的生命周期模型（不引入常驻进程池），多租户隔离边界不变；
- 只桥 dialog 方法（`select/confirm/input/editor`），**不**桥 `setWidget/setStatus/notify/setTitle/custom`（widget 已有 `withWidgetBridge` 覆盖；`notify` 可映射为 status 事件，非本方案目标）；
- `PI_EXTENSIONS` 白名单、`-e` 显式装配、`symlinkOrCopy` 挂载、扩展版本锁定全部沿用现状。

---

## 1. 背景：为什么现状「三步走」对此扩展无效

### 1.1 现状执行链路（json 模式）

```
backend-ts runPiAgent:
  spawn pi --mode json [--no-context-files] [--append-system-prompt AGENTS.md]
           [-e {ws}/.pi-agent/extensions/{name}...] [--thinking ...] [-xt 工具]
           --session {ws}/.pi-agent/run/chat.jsonl
           --provider bookforge --model bookforge/<m> [@file...] "<消息>"
  stdout: JSONL 事件 → mapPiJsonEvent → ChatStreamEvent → SSE → 前端 piStream
```

`preparePiWorkspace` 负责装配（AGENTS.md 软链、skills、models.json、settings.json、白名单扩展挂载到 `{ws}/.pi-agent/extensions/{name}`）。

### 1.2 阻塞点：json 模式 `ctx.hasUI === false`

已核实（pi-coding-agent 0.84.2 源码 + 文档）：

1. `runner.js:153`：`this.uiContext = noOpUIContext`（默认）。`setUIContext(uiContext)` 只在 `bindExtensions()` 传入 `uiContext` 时才会替换（`runner.js:267-269`）。
2. **print/json 模式**（`print-mode.js`）调用 `session.bindExtensions({ mode: "json", commandContextActions, onError })` —— **不传 uiContext** → `hasUI() === false`（`runner.js:274-275`）。
3. `ask_user_question` 扩展的 reconciler（`reconcile.ts:34-38`）在每轮 `before_agent_start` 中：`!ctx.hasUI && 工具在列 → pi.setActiveTools(剔除该工具)`。幂等，且只按 `hasUI` 门控。
4. 结果：模型工具列表里没有 `ask_user_question` → 永不触发 → 无 `tool_execution_start/end` → `pi-widgets.ts` 中即使注册生产者也是死代码。

**对照 rpiv-todo 为何有效**：`todo` 工具无 UI 门槛、headless 可用，其结果 `details.tasks` 本身是结构化快照 → 生产者 → widget 面板。这是「工具型扩展」；`ask_user_question` 是「交互型扩展」，其价值在实时问答往返，工具结果本身不构成持久快照。

### 1.3 设计文档 §10.3 的触发条件被命中

`extension-widgets-implementation-plan.md` §10.3 明确：「装到**纯 UI 型**扩展（无工具、或工具结果冷漠、价值全在自定义 widget）……等到那天再实现 `--mode rpc` 的 `extension_ui_request`（`method==='setWidget'`）适配器」。

`ask_user_question` 正是此类扩展（价值全在交互问卷），但它的交互面不是 `setWidget` 而是 **`select/input` dialog 往返**——所以适配目标是「RPC dialog 通道」，不是「setWidget 通道」。

---

## 2. 参考机制：pi-web 如何做到

pi-web（`docs/skill-agent/pi-web-main`）让 `ask_user_question` 完整工作的三个机制（`rpc-manager.ts` + `useAgentSession.ts`）：

1. **注入真实 uiContext，RPC 语义绑定**：`ensureExtensionsBound()` 调用 `bindExtensions({ uiContext: createExtensionUiContext(), mode: "rpc", ... })`（`rpc-manager.ts:315-344`）。于是 `ctx.hasUI === true` 且 `ctx.mode === "rpc"` —— reconciler 不剥离（`reconcile.ts` 对 `mode:"rpc"` 判例豁免，其测试 `keeps ask_user_question active in RPC mode`），扩展走 `rpc-fallback.ts` 的 dialog walker。
2. **扩展 UI 请求 → 事件桥**：`createExtensionUiContext()` 的 `select/confirm/input/editor` 方法调用 `requestExtensionUi(...)`，发 `extension_ui_request` 事件（`rpc-manager.ts:1400-1430`），经 `this.emit()` → SSE 到浏览器。
3. **浏览器作答 → 命令回写**：前端 `respondToExtensionUi()`（`useAgentSession.ts:728-744`）POST `{type:"extension_ui_response", id, value|confirmed|cancelled}` → wrapper `resolveExtensionUiResponse()` 把 pending promise resolve（`rpc-manager.ts:1014-1018`）→ 工具拿到答案继续。

> 对照：pi-web 是 in-process AgentSession；本项目是子进程。但 **RPC 子进程协议（`rpc-mode.js`）原生支持同一套 `extension_ui_request/response`**（stdout 出请求、stdin 收响应），因此本项目可子进程化复现全部语义，无需 in-process。见 §3。

---

## 3. 方案设计：RPC 子进程 + 双向交互协议

### 3.1 运行形态

**保持「每次对话 spawn 一个子进程」拓扑**（与现状一致，多租户隔离不变）：

```
POST /chat（Skill Agent 分支）
  spawn pi --mode rpc [--no-context-files] [--append-system-prompt AGENTS.md]
           [-e {ws}/.pi-agent/extensions/{name}...] [--thinking ××] [-xt 工具...]
           --session {ws}/.pi-agent/run/chat.jsonl
           --provider bookforge --model bookforge/<m>
    ├─ stdin（pipe）: {type:"prompt", id:"p-N", message, images?}       ← 本轮用户消息
    │                {type:"extension_ui_response", id, value|confirmed|cancelled}  ← 用户作答（独立 POST 回写）
    │                {type:"abort", id}                                   ← 平滑中断（可选；兜底仍 killTree）
    └─ stdout（pipe）: JSONL 事件流（与 json 模式同版 toJsonEvent，另含 extension_ui_request）

进程注册表（服务端每个 worker 进程内）：Map<`${userId}:${workspaceId}`, PiProcessEntry>
  PiProcessEntry = { stdin: Writable, ended: boolean, procId: number }
  生命周期 = spawn 注册 → agent_settled 收尾 / abort / 异常 → 注销（ended=true 后 API 即 404）
  多租户隔离：key 复合 userId（鉴权态），杜绝 A 用户答 B 用户问卷
```

关键差异（相对现状 `runPiAgent`）：

| 维度 | 现状 json 模式 | 本方案 RPC 模式 |
|---|---|---|
| 用户消息 | 进程启动参数 `<消息>` + `@file...` | stdin 写入 `{type:"prompt", ...}` 命令（**禁用 `@file`，图片走 `images` 字段**，`main.js:508`） |
| 结束信号 | 进程退出（spawn 即一次应答） | 事件 `agent_settled` 后收尾（rpc 进程常驻，需显式收尾） |
| 交互 | 无 | `extension_ui_request` → SSE；`extension_ui_response` → stdin |
| abort | `killTree` | `{type:"abort"}` 命令（优雅），超时后仍 killTree 兜底 |
| 事件面 | `mapPiJsonEvent` 现有映射 | **同一 `toJsonEvent`**，现有映射全部复用 + 新增 `extension_ui_request` |
| 收尾产物差分 | 进程退出后 `snapshotWorkspace` 差分 | `agent_settled` 后、kill 前差分（逻辑一致，时机移到事件信号） |

### 3.2 事件流（stdout）映射扩展

RPC 模式事件 = json 模式事件（同一 `toJsonEvent`）+ `extension_ui_request` + `response`。

- 现有 `mapPiJsonEvent` 的事件（含 `message_update` 中的 `text_delta/thinking_delta`、`tool_execution_start/end`、`compaction_*`、`auto_retry_*`、`message_end`）**原样复用**（`rpc-mode.js` 中 `session.subscribe(event => { output(toJsonEvent(event)) })` 与 print-mode json 分支一致）。
- 新增映射：`extension_ui_request` → 新 `ChatStreamEvent` 子类型（透传白名单字段：`id, method, title, options, message, placeholder, prefill, timeout`；`select/confirm/input/editor` 四类只收这些字段，**不反射透传整包**，防未知字段流入前端）。
- `response`（`{id,type:"response",command:"prompt",success}`）：**不**映射为 ChatStreamEvent；消费其语义副作用（prompt 已受理）。`success:false` → 映射为 `error`。

### 3.3 用户作答回写（独立 POST 通道）

SSE 是单向（服务端→前端）。用户作答需要独立 HTTP 通道写回：

```
POST /api/modules/bookplate/chat/ui-response
  authRequired
  body: { workspace_id: string, id: string,
          value?: string | null, confirmed?: boolean, cancelled?: boolean }
  → 服务端按 authUser.id + workspace_id 复合查活跃 RPC 子进程注册表
  → 若存在：child.stdin.write(JSON.stringify({type:"extension_ui_response", id, ...}))
  → 返回 {ok:true}
  → 否则 404 {ok:false, error:"session 已结束"}
```

进程注册表：`Map<"${userId}:${workspaceId}", { stdin: Writable, ended: boolean, procId: number }>`（worker 进程内单态）。`runPiAgent` spawn 时注册，进程退出/abort/`finally` 注销。**回调完整性**：`extension_ui_request` 发出后，若其对话（进程）在用户作答前已结束（abort/超时/CRITICAL 错误），注册表无该进程 → 404 → 前端静默收下即可，不弹已死对话的错误（与「用户已离开」语义一致，类似关闭 tab）。

> **安全面**：只接受事件白名单字段；标题/选项文本前端 `<pre>`/`<div>` React 转义；进程注册表按 workspace_id 索引（现有 `sanitizeWorkspaceId` + `nodeWorkspace` 防穿越口径沿用）。

### 3.4 生命周期：收尾信号从「进程退出」改为「agent_settled + prompt 受理确认」

RPC 进程常驻（`rpc-mode.js` 末尾 `return new Promise(() => {})`）。每轮对话收尾必须显式化：

1. spawn 成功后等待 stdout 首帧（session header / `agent_start` 等）确认扩展加载无错（相当于现状「扩展真实加载冒烟」前置）。
2. 写入 `{type:"prompt", id:"p-N", message, images?}`。
3. 捕获 `response {command:"prompt", success}`：`success:true`（受理）→ 继续读事件；`success:false` → 终止并出 `error`。
4. 事件消费到 `agent_settled`：即本轮「完全落定」（pi 文档语义：无重试/无压缩重试/无排队续接）→ 进入收尾。
5. 收尾：差分产物（`snapshotWorkspace` 前后）+ `appendArtifactManifest` + 输出尾部错误诊断（沿用现状末尾逻辑）→ `child.stdin.end()`（触发 rpc `onInputEnd → shutdown` 优雅退出）→ 等 `close`；若超时（如 5s）未退出 → `killTree`。
6. `finally`：注销注册表；`opts.signal` abort → 写入 `{type:"abort"}` → 等待或 killTree。

> 注意「零输出兜底诊断」（现状 `runPiAgent` 末尾）语义同步迁移：RPC 模式下 `emittedAny` 以「收到任意 ChatStreamEvent 或 response」判真；若至 `agent_settled`/进程结束仍无任何事件 → 推 `error`（含 stderr 末行）。

### 3.5 图片输入

现状 json 模式：`saveInputImages()` 落盘 `inputs/img-N.ext` 后把 `@file` 附加到 argv。RPC 模式**禁止 `@file`**（`main.js:508`），图片改走 prompt 命令 `images` 字段，格式（`rpc.md:53`）：

```json
{"type":"prompt","message":"...","images":[{"type":"image","data":"<base64>","mimeType":"image/png"}]}
```

实现：把 `saveInputImages()` 改为产出 `{data, mimeType}`（从原 data URL 解出 base64 与 mime，**不再落盘** `inputs/`，或保留落盘仅作冗余——建议不落盘，减少磁盘产物且差分会少一类噪声；具体取舍在实现期按 `imageUpload` 前端格式定，文档不硬编码）。

---

## 4. 改动清单

### 4.1 后端 `backend-ts/src/services/pi-agent-service.ts`

**改造 `runPiAgent`**（或抽出 `runPiAgentRpc`，`runPiAgent` 保留 json 兼容路径——**决策点见 §8 开放问题**）：

1. spawn 参数改为 `--mode rpc`；`stdio: ['pipe','pipe','pipe']`（stdin 必须 pipe）。
2. 删除 imageRels → `@file` 注入；改为 prompt 命令内 `images`。
3. 新增 stdout 解析分派：当行 JSON 的 `type === 'extension_ui_request'` → `mapPiJsonEvent` 新增 case 产出 `extension_ui_request` ChatStreamEvent；`type === 'response'` → 处理 prompt 受理/失败；其余行照旧 `mapPiJsonEvent`。
4. `mapPiJsonEvent` 新增：
   ```ts
   case 'extension_ui_request': {
     const method = String(evt.method ?? '');
     if (!DIALOG_METHODS.has(method)) break;   // 只桥 select/confirm/input/editor
     yield { type: 'extension_ui_request', id: String(evt.id ?? ''),
             method, title: ..., options?, message?, placeholder?, prefill?, timeout? };
   }
   ```
5. 收尾逻辑改为 `agent_settled` 事件驱动（见 §3.4）。
6. 新增活跃子进程注册表导出：
   ```ts
   export function registerPiProcess(workspaceId: string, stdin: Writable): () => void;
   export function sendExtensionUiResponse(workspaceId: string, resp: {...}): boolean;
   ```
7. abort 分支：优先 `child.stdin.write({type:"abort"})`，超时后 killTree（保留 `killTree` 兜底）。

### 4.2 后端 `stream.ts`（`ChatStreamEvent`）

```ts
| { type: 'extension_ui_request'; id: string; method: 'select'|'confirm'|'input'|'editor';
    title: string; options?: string[]; message?: string; placeholder?: string;
    prefill?: string; timeout?: number }
```

`chatStreamToSseResponse` 自透传（`switch` 无需新增 case；`data: JSON.stringify(evt)` 路径已覆盖）。**在 `chatStreamToResponse`（AI SDK 分支）同 switch 中无影响** —— Skill Agent 专用原始 SSE 路径。

### 4.3 后端 `routes/ai-nodes.ts`

1. Skill Agent 分支事件流不变；`withWidgetBridge` 保留（widget 桥与 RPC dialog 通道并存，二者事件类型不同、互不干扰）。
2. 新增路由：
   ```ts
   app.post('/api/modules/bookplate/chat/ui-response', { preHandler: app.authenticate }, ...)
   ```
   - 校验 body 必填：`workspace_id`、`id`、以及 `value | confirmed | cancelled` 三者至少其一且互斥（`value` 仅 `select/input/editor`，`confirmed` 仅 `confirm`，`cancelled` 任意）。
   - 调 `sendExtensionUiResponse(workspace_id, ...)`，布尔失败 → 404 JSON。

### 4.4 前端 `piStream.ts`

```ts
// state 新增
interface PendingUiRequest { id: string; method: ...; title: string; ...; createdAt: number }
state.pendingUi: PendingUiRequest | null

// actions 新增
| { type: 'ui_request'; request: PendingUiRequest }
| { type: 'ui_response'; id: string }        // 页内作答成功 → 关闭弹层
| { type: 'ui_cancel'; id: string }           // 本地取消（含 SSE 断线/新轮 start）→ 关闭弹层

// reducer：
// start → 清空 pendingUi（新轮 = 旧对话失效）
// end/settle → 保留 pendingUi? —— 决策：若不保留交互会中断；保留则取消弹层（见 §5 缺陷讨论）
```

### 4.5 前端 `PiChatNodeHost.tsx` + 新组件 `ExtensionDialog.tsx`

1. SSE 分发 switch 新增 `case 'extension_ui_request'` → `dispatchStream({type:'ui_request', request})`。
2. `ExtensionDialog` 组件渲染（折叠卡片，模式三选一）：
   - `select`：单选列表（含「自定义输入」行 —— RPC walker 的 `ask_user_question` 依赖后端 `input` 单题弹窗，但前端自行组合出「选项+自定义」更贴近 TUI；**最小实现**：直接按 RPC 原语渲染 select/input/confirm 三种 dialog，逐题弹出，等价于 rpc-fallback 语义）。
   - `input`：文本框 + 确定/取消。
   - `confirm`：是/否/取消。
   - 作答 → `postChatUiResponse({workspace_id, id, value|confirmed|cancelled})`。
   - 取消 → 同样 POST `{cancelled:true}`（**不要**本地静默取消：RPC 协议要求响应必须回写，否则 pi 工具挂起直到超时）。
3. workspace_id 从 node/会话上下文取（现有状态中已有，`PiChatNodeHost` 已持有）。

### 4.6 前端 `ChatNode.tsx`

在现有 `ExtensionWidgets` 渲染点旁新增 `<ExtensionDialog ... />` 单实例（同 placement 无关，交互态直接叠放 message 底部/输入区上方）。

---

## 5. 已识别缺陷与对策（评审必读）

| # | 缺陷 | 对策 |
|---|---|---|
| D1 | **SSE 断线即丢交互**：用户答到一半刷新/切节点，SSE 断开（`requestAbortSignal` → abort → 子进程被 kill），问卷作废 | 刷新后 `chat/session` 水合只给 `messages/widgets`，**无** `pendingUi` 快照 —— v1 接受「SSE 断线 = 问卷作废」语义（与交互对话「中途放弃」一致）；水合不恢复 pendingUi，前端丢弃半截弹层。README 不必承诺。预留后续：`agent_settled` 前把 `pendingUi` 写入 `widgets.json` 之外的独立键（v2 不做） |
| D2 | **用户长时间不答**：pi 工具 execute 挂起，子进程占着（每用户配额下阻塞后续对话） | 双保险：① pi 侧 dialog 带超时自动 resolve（扩展 `rpc-fallback` 是否传 timeout 需实测确认，未传由后端补：转发 `extension_ui_request` 时带默认 `timeout: 120_000`，超时未答 → 服务端主动写 `{cancelled:true}` 并弹提示）；② 单轮对话总时长上限（现状无此限制时，本轮天然由模型响应时长兜底，仍建议设置 e.g. 10min 后 kill） |
| D3 | **多轮并发答卷**（同一 workspace 2 个 UI 请求）：RPC 协议按 `id` 关联，异步无冲突；但前端只保留 `pendingUi` 单值，第二个请求覆盖第一个 | v1：`pendingUi` 改为 `Map<id, request>` 队列，逐题弹出（RPC walker 本是逐题阻塞，实际最多同时一个；保险起见用 Map） |
| D4 | **`extension_ui_request` 透传的 title/options 可能含 HTML/JS**（扩展=服务端代码已白名单，但字段可能来自未知第三方扩展未来） | 全部 React 转义渲染（默认行为）；后端 Sse 透传前不再剥字符（保持与现状 `extension_widget` 的 sanitize 一致性可在实现期加 `sanitizeWidgetLine` 复用，**决策：透传不净化的字段只有 `title/options`，若怕注入改成服务端剥控制字符/ANSI**） |
| D5 | **收尾竞态**：用户作答的 POST 与 `agent_settled` 收尾的 `stdin.end()` 竞争 | `sendExtensionUiResponse` 先查注册表 `ended` 标志：`ended` → 404 静默；保证写入发生在 `stdin.end()` 前（单线程事件循环内检查+写入，无真并行）。`stdin.end()` 后 API 写失败即 404 |
| D6 | **老节点/历史会话的兼容**：`chat/session` 水合、`pi-session-hydrate.ts` 读 `{ws}/.pi-agent/run/chat.jsonl` 不受影响（RPC 模式同样写该 session 文件）。**需要验证 RPC 模式 session 文件格式与 json 模式一致**（同一 `SessionManager`，默认一致；实现期以真实运行冒烟为准） |
| D7 | **多租户并发串扰（本项目核心差异，pi-web 无此问题）**：多个远程用户可同时发起 pi agent 任务。`workspaceId` 由前端首轮生成（`${nodeId}_${Date.now()}`），**nodeId 可能跨用户相同**，且 pi-web 是「各用户自己电脑」天然隔离，本项目是「共享服务器」。若进程注册表只以 `workspaceId` 为 key，两个账号同名 workspace 会串扰（A 作答写入 B 的 stdin） | 注册表 key = **`userId + workspaceId` 复合**（`nodeWorkspace(userId, workspaceId)` 已按 userId 隔离目录，注册表沿用同一口径）。`ui-response` 路由同样取 `request.authUser!.id`（鉴权态，非查询参数）复合查询。任何 `registerPiProcess`/`sendExtensionUiResponse` 调用均传复合 key |

---

## 6. 验证清单（提交前逐项过）

1. 后端类型检查：`cd backend-ts && npm run typecheck`
2. pi 相关测试：`npx vitest run tests/api/pi-agent-* tests/api/pi-widgets.test.ts tests/api/pi-sse-wire.test.ts`
3. 新增单测：
   - `mapPiJsonEvent`：`extension_ui_request`（select/input/confirm/editor 四类透传白名单；`setWidget`/`notify`/`setStatus` 忽略；缺 id/method 跳过）
   - `sendExtensionUiResponse`：存在/已结束/不存在 workspace 三态
   - runPiAgent RPC 收尾：`agent_settled` 驱动收尾 + `stdin.end()` 后进程退出（mock spawn/stdio，或真实子进程短冒烟）
4. **扩展真实加载冒烟（RPC）**：`pi --mode rpc -e {已装包目录} --session <tmp>/chat.jsonl --provider bookforge --model bookforge/<m>`，stdin 写 prompt，人工脚本应答 `extension_ui_response`，断言退出码 0、无扩展错误、问答往返闭环
5. `ask_user_question` 冒烟：mock provider 或真实 provider，让模型（受提示词引导）调用工具，确认 `extension_ui_request` 事件形状与 `rpc.md` 契约一致（`select` 字段：`title/options/timeout`；`input`：`title/placeholder`）
6. 全链路：登录后 POST `/api/modules/bookplate/chat` → SSE 流中出现 `extension_ui_request` → POST `chat/ui-response` → SSE 继续 `content_delta` → 无 `error`
7. 前端：节点发送消息触发问卷 → 弹层渲染 → 作答/取消 → 弹层关闭，对话继续
8. 回归：rpiv-todo 面板仍正常（widget 桥未变）、产物差分、`agent_file` 正常

---

## 7. 安全与一致性（继承现状原则）

- 白名单即边界（§1 不变）；扩展=服务端代码执行，`PI_EXTENSIONS` 管理员专管。
- 版本锁定：`pi install` 锁定 + 回归。
- 交互内容净化：`extension_ui_request` 仅透传白名单字段；前端 React 转义；服务端可复用 `sanitizeWidgetLine` 剥 ANSI/控制字符（决策 D4 二选一，**倾向服务端净化，与 widget 口径一致**）。
- 进程注册表 key 用 `sanitizeWorkspaceId` 之后的 workspace_id（沿用现有防穿越）。
- 子进程 env 仍只注入 `{ws}/.pi-agent`（现状 `PI_CODING_AGENT_DIR`/`PI_AGENT_HOME` 口径），**不**放开服务器全局 `~/.pi`。

---

## 8. 实现期定稿与偏差记录（2026-08-29）

> 本节记录实现时与原方案设计不一致的**已定稿决策**，供维护者审读。

1. **Q1 已定稿：纯 RPC 化，无 json 兼容开关**。`runPiAgent` 直接改为 `--mode rpc`；json 一次性模式由 git 历史兜底（RPC 事件面是 json 超集）。理由：双模式维护两份收尾逻辑（json 靠进程退出、rpc 靠 agent_settled），成本大于风险；回滚即 revert。
2. **收尾信号=agent_settled + killTree**（**实现偏差**）：原设计「stdin.end() 优雅退出」在 Windows + pi-image-gen 扩展场景触发 pi/libuv 竞态崩溃（退出码 0xC0000409，`src\win\async.c` Assertion failed）。实测确认后改为 **agent_settled 到达即 killTree 收尾**——agent_settled 语义 = 会话文件已落盘（消息/工具结果/usage 均写前完成），kill 不丢数据；退出码非 0 且已 settled 时不误报 error。
3. **注册表扩展 kill 回调**：`PiProcessEntry` 增 `kill: () => void`；新增 `killPiProcess(userId, workspaceId)`；`clearPiSession`（清空对话）先杀活跃 RPC 子进程，防问卷等待中进程遗留在该 workspace 占位。
4. **`saveInputImages` 返回值语义变化**：RPC 模式下图片不再经 `@file` argv（RPC 禁 `@file`），改为 prompt 命令 `images:[{type:"image",data,mimeType}]`。现有 `saveInputImages(ws, images)` 返回 data URL 列表（未变），`runPiAgent` 侧直接转 images 字段，**不落盘 inputs/**。
5. **前端 pendingUi 单值**（非 Map）：RPC walker 逐题阻塞、同轮最多一个；reducer 以最新覆盖（`ui_request`），避免弹层重叠。SSE 断线/新轮 start → 清空（D1 语义接受）。
6. **`extension_ui_request` 映射白名单**：`select/confirm/input/editor` 四类透传 `id/method/title/options/message/placeholder/prefill/timeout`；`setWidget/notify/setStatus/setTitle/set_editor_text/custom` 静默。`notify` 暂不映射 status（v1 不做，成本低但需求未确认）。

### 剩余开放问题（不影响当前上线）

1. **`timeout` 兜底（D2）**：`ask_user_question` 的 rpc-fallback 是否传 `opts.timeout`，实现期已确认——冒烟脚本捕获的 `extension_ui_request` 事件**无 timeout 字段**（`{"method":"select","title":"[方案] 选择哪种实现方案？","options":[...]}`）。意味着 pi 侧 dialog 无超时自动 resolve——**需前端实现「长时间未答」超时提示**（v2 候选：前端展示时挂 2 分钟倒计时，超时自动 POST cancelled 并提示。当前 v1 不自动取消，用户可手动取消）。
2. **后端兜底超时**：`PI_RPC_TIMEOUT_MS`（默认 10 分钟）已实现为进程级兜底（agent_settled 永不到达时强制 end/kill），但**不会 resolve 未完成的 UI 请求**——极端场景（用户永不答）最多占 10 分钟进程。可接受（每用户并发配额内）。
3. **通知/状态栏事件**：`notify` 不映射（见上）。

---

## 9. 明确不做（v1 范围外）

- 不做 in-process AgentSession（子进程隔离是多租户安全边界，恰是 pi-web 之外本项目必须保留的差异）。
- 不桥 `setWidget` factory/custom（RPC 下 factory 被忽略；widget 展示继续走 `withWidgetBridge` 工具结果桥）。
- 不做 dialog 的富 TUI 化（tab 条/Submit 预览/多选 UI）：RPC walker 语义 = 逐题原生 dialog，前端跟随即可。
- 不把 `pendingUi` 持久化到水合（D1 接受断线作废）。
- 不引入常驻进程池 / 会话复用（生命周期保持每对话一进程）。

---

## 10. 回滚策略

- 方案整体回滚：切回 `--mode json`（`runPiAgent` 逻辑 git revert）→ 既有功能全部恢复（json 路径从未删除，只要实现时按决策 8.1 保留分支或 env 开关）。
- UI 数据面隔离：`extension_ui_request` 类型是新增，旧前端不认识 → render 忽略（piStream reducer 默认分支），无兼容破坏。
- 中间态回滚（widget 桥已上线）：本方案**不改** widget 桥，无需联动回滚。

---

## 附录 A：已核实事实速查（pi-coding-agent@0.84.2）

| 事实 | 依据 |
|---|---|
| json 模式无 uiContext → `hasUI()===false` | `dist/core/extensions/runner.js:153,267-275`；`dist/modes/print-mode.js`（bindExtensions 不传 uiContext） |
| RPC 模式绑定 `createExtensionUIContext()` + mode="rpc" → `hasUI===true` | `dist/modes/rpc/rpc-mode.js:230-262`；文档 `docs/rpc.md:1176` |
| RPC `extension_ui_request` stdout / `extension_ui_response` stdin | `rpc-mode.js:77,83-96,601-623`；`docs/rpc.md:1155-1345` |
| RPC 事件面与 json 同一 `toJsonEvent` | `rpc-mode.js:265-270`（`output(toJsonEvent(event))`）；print-mode 同 |
| RPC 禁 `@file`（图片走 prompt `images`） | `main.js:508`；`docs/rpc.md:47-78` |
| `--session`/`-e`/`--provider`/`--model`/`--thinking`/`--exclude-tools`/`--no-context-files`/`--append-system-prompt` 与 `--mode rpc` 兼容 | `dist/cli/args.js:27,40,49,64,91,97,120,158`；模式分派在 sessionManager 创建之后（`main.js:537,746`） |
| `agent_settled`：本轮完全落定信号 | `docs/rpc.md:841-888`；`dist/core/agent-session.js:330-331` |
| RPC 进程常驻（`return new Promise(()=>{})`），stdin `end` 触发 shutdown | `rpc-mode.js:638-652` |
| `ask_user_question` reconciler 按 `hasUI` 剥离 / RPC 豁免 | `docs/skill-agent/rpiv-package/reconcile.ts:25-38`；`reconcile.test.ts:92-105` |
| pi-web 全链路（注入 uiContext→事件桥→响应回写） | `docs/skill-agent/pi-web-main/lib/rpc-manager.ts`、`hooks/useAgentSession.ts:728-744` |
