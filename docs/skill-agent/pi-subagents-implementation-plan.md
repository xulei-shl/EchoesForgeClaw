# pi-subagents 扩展接入实现方案（Skill Agent 节点）

> **文档版本**：v1.0
> **创建日期**：2026-08-31
> **目标读者**：接手把 pi-subagents（子代理）接入 Skill Agent 节点的工程师
> **关联文件**：
> - 扩展源码：`docs/skill-agent/pi-subagents-main/`（README 见 `README.md`，RPC/集成面见 `docs/extension-api.md`）
> - 参考项目：`docs/skill-agent/pi-web-main/README.zh-CN.md`（本地 web 前端，拓扑与本项目不同，仅参考交互形态）
> - 后端装配/运行：`backend-ts/src/services/pi-agent-service.ts`、`pi/runner.ts`、`pi/registry.ts`、`pi/events.ts`
> - 后端 widget 桥：`backend-ts/src/services/pi-widgets.ts`
> - 交互通道：`backend-ts/src/modules/bookplate/routes/ai-nodes.ts`（`POST /chat`、`GET /chat/session`、`POST /chat/ui-response`）
> - 前端：`frontend/src/modules/bookplate/{PiChatNodeHost.tsx, piStream.ts, components/ChatNode.tsx, components/ExtensionWidgets.tsx}`
> - 既有机制文档：`docs/skill-agent/pi-extension-integration.md`（扩展接入最佳实践）、`docs/skill-agent/extension-widgets-implementation-plan.md`（widget 通用机制 v2.0）

---

## 1. 背景与目标

pi-subagents 让主 agent 把工作委托给聚焦的子 agent（`scout / researcher / worker / reviewer / oracle / delegate`），支持前台（foreground，流式）与后台（async，分离进程）两种运行方式，并带 `subagent` 工具、fleet 观察面（widget / 事件 / 生命周期文件）。

本项目拓扑：**pi 装在服务器、多账户共享**，每个对话 spawn 一个 `pi --mode rpc` 常驻子进程；扩展按管理员白名单挂载；UI 只能以「数据」形式过 SSE 推到远端浏览器渲染。因此**不直接照搬 pi-web**（本地进程内 TUI 渲染），而是复用在 v2.0 widget 机制里已立好的原则：

> widget 从**已归一化的顶层事件/工具契约**二次加工而来（C4）；`setWidget` 等 pi 本地 UI 机制上一版（C1）判定「不订阅」——**本次仅对 pi-subagents 特例开一个窄缝**：它在 RPC 模式下主动把 `setWidget` 的载荷编码为**结构化 JSON 快照**（`PI_SUBAGENT_ASYNC_JSON:` 前缀），这是该扩展唯一能可靠送出「后台运行实时状态」的通道，值得解析。其余（factory widget、notify、setStatus、TUI 定制 UI）仍一律不碰。

### 1.1 RPC 模式下 pi-subagents 到底暴露了什么（关键事实，已核实源码）

| 通道 | 形态 | RPC 下是否可用 | 本项目如何消费 |
|------|------|----------------|----------------|
| `subagent` 工具 | `tool_execution_start/end` → `tool_call`/`tool_result`，结果 `details` 为结构化运行总结（mode/runId/results/exitCode/truncation/asyncId） | ✅ 稳定事件面 | 现有 `withWidgetBridge` + 注册 `subagent` 生产者 → 运行结果面板 |
| `setWidget("subagent-async", [...])` | `extension_ui_request {method:"setWidget", widgetKey:"subagent-async", widgetLines:["PI_SUBAGENT_ASYNC_JSON:{...}"]}`；JSON 为 `AsyncStatusSnapshotV1`（runs 树：id/kind/label/state/activity/children） | ✅ pi RPC 模式透传字符串数组（`rpc-mode.ts:195`）；⚠️ **只在活跃轮次内被后端消费**（见 §2.2） | 新增 `extension_ui_request setWidget` 白名单窄缝：解析 JSON 快照 → 后端 `subagent-fleet` widget |
| `setWidget("subagent-fleet-status", factory)` | factory 形式 | ❌ RPC 模式忽略 factory（`rpc-mode.ts:205`） | 不可用，不依赖 |
| `subagent-notify`（异步完成） | `pi.sendMessage({customType:"subagent-notify"})` → 写入会话 jsonl | ✅ 落盘 | 不实时推送；随水合出现在消息历史（v2 候选：空闲轮次收割） |
| async 运行生命周期文件 | `{os.tmpdir()}/pi-subagents-*/async-subagent-runs/{runId}/status.json` 等 | ✅ 文件在**服务器 OS temp**（非工作区内） | 不依赖（见 §2.2 限制）；v2 候选按 `PI_SUBAGENTS_TEMP_ROOT` 扫描 |
| `/subagents-fleet` 等斜杠命令 | TUI 交互 | ❌ 本项目无 TUI | 不可用，不依赖 |

> ⚠️ **模型/provider 继承**：子 agent 由扩展用 `resolvePiCliScript()` 解析**同一个 pi 二进制** spawn 子进程，环境继承自父 RPC 进程（`PI_CODING_AGENT_DIR`/`PI_AGENT_HOME` 指到工作区 `.pi-agent/`），provider 配置与 API Key 随之继承，无需后端额外传参。实施时用一次真实子代理冒烟验证子进程能取到模型（§7 清单 5）。

---

## 2. 架构设计

### 2.1 数据流（v1）

```
浏览器 Chat 节点
   ⇅ SSE（现有管线，不改协议面）
后端（共享服务器）
   ├─ runPiAgent（--mode rpc 常驻进程，按 {userId}:{workspaceId} 注册）
   │    └─ pi 加载 pi-subagents（-e 挂载）→ 模型调用 subagent 工具 → spawn 子 pi 进程
   │        ├─ 前台运行：子进程在父进程内联执行 → 结果走 tool_execution_end
   │        └─ 后台运行：分离 runner 进程 → setWidget 快照 + 完成后 sendMessage(subagent-notify)
   ├─ mapPiJsonEvent（events.ts）
   │    ├─ tool_execution_start/end → tool_call / tool_result（现状，不改）
   │    └─ ★新增：extension_ui_request{method:"setWidget", widgetKey:"subagent-async"}
   │         → 解析 PI_SUBAGENT_ASYNC_JSON 快照 → subagent_fleet 事件（新）
   ├─ withWidgetBridge（pi-widgets.ts）
   │    ├─ 现状：tool_call/tool_result → 生产者注册表 → extension_widget（不改）
   │    └─ ★新增：注册 subagent 生产者（工具结果 → 运行总结面板）
   │    └─ ★新增：消费 subagent_fleet 事件 → 合并进 widget 快照 → extension_widget("subagent-fleet")
   │    └─ ★新增：持久化时 fleet 快照的 data 带原始 runs 树（水合可重建）
   └─ GET /chat/session 水合：widgets 快照照旧下发（fleet 面板跨轮保留）
前端
   ├─ PiChatNodeHost：extension_widget / extension_widget_clear 照旧分发（零改动）
   ├─ ChatNode → ExtensionWidgets 照旧渲染 fleet 面板（label + lines）
   ├─ ChatNode → SubagentRunBlock（新）：按 msg.agentSteps 解析 subagent 运行，
   │    在对话流内按顺序渲染独立折叠卡片（流式吃完整结构、水合吃文本回退）
   └─ 消息区：subagent 工具调用以现有 tool 步骤卡展示；异步完成以水合消息出现
```

### 2.2 两条关键边界（务必先读）

**边界 A — `setWidget` 事件只在活跃轮次内被消费（本方案的硬限制）**
`runner.ts` 的 `consumeLine` 在 `entry.round === null`（进程空闲、两次 prompt 之间）时**丢弃所有 stdout 事件**。而 pi-subagents 的 widget 刷新由 `async-job-tracker` 轮询驱动（每 1s 一次 `rerenderLastWidget`），**后台任务运行中/完成时父进程多半空闲** → 那些 `setWidget` 事件到不了后端。

- **v1 语义**：fleet 面板的**实时**更新只保证在「本轮的活跃窗口」内（子代理启动/前台运行/后台刚启动时模型仍在产出 → 轮次活跃）；轮次结束后转为**服务端持久化快照**展示。后台运行在空闲期的状态变化**不实时**推送。
- **补偿**：每个新轮次开始时由 `subagent` 工具结果携带最新结构（或水合时前端以服务端快照对齐）；v2 可加「空闲期文件扫描」（async 运行目录在服务器 temp，按 `PI_SUBAGENTS_TEMP_ROOT` 限定扫描，见 §9）。

**边界 B — 异步子进程的生命周期归谁管**
- 前台子代理是父 pi 进程的直接子进程 → `killTree`（`taskkill /T /F`）整树终止，现有清理语义不变。
- 后台（async）子代理是**分离 runner**：父 pi 被 kill（清空对话/超时/LRU/空闲回收）后**可能残留**，继续消耗服务器资源并向会话文件写结果。
- **v1 处置**：沿用现有「清会话先杀活跃 RPC 进程」语义，并在 `clearPiSession` 时**额外扫描 `PI_SUBAGENTS_TEMP_ROOT` 下的 async 运行目录**按 workspace/session 归属做清理（参考扩展 `retained-children`/`async-retention` 的命名规则，实施时按实际落盘路径核对）；同时给子代理配置收敛（§4.2），降低残留面。这是本方案**必须实现**的安全项（多租户共享服务器）。

---

## 3. 后端实现

### 3.1 装配：白名单 + `-e` 挂载（改动最小）

沿用现有扩展管线，零新增机制：

```ini
# backend-ts/.env
PI_EXTENSIONS=pi-subagents        # 与既有扩展逗号并列
```

- 安装：`pi install npm:pi-subagents`（落 `~/.pi/agent/npm/node_modules`，`resolvePiExtensions` 第三候选目录已覆盖）或 `cd backend-ts && npm install pi-subagents`（候选①）。
- 挂载：`preparePiWorkspace` 现有逻辑自动把白名单扩展挂到 `<ws>/.pi-agent/extensions/{name}` 并追加 `-e`（`runner.ts buildSpawnArgs` 已支持多 `-e`）。**零代码改动**。
- 依赖解析注意：pi-subagents 体积大、依赖树深，**Windows 无软链权限时会退化为复制**（坑 3），复制后 jiti 非 alias 依赖可能解析失败——首选确保软链可用；否则把包装进 `backend-ts` 依赖树从候选①命中。
- ⚠️ 改 `.env` 不触发 `tsx watch` 热重载，需手动重启后端（坑 1）。

**扩展侧配置（可选收敛，写进工作区）**：如需限制行为，把 `config.json` 落到 `<ws>/.pi-agent/extensions/subagent/config.json`（`preparePiWorkspace` 装配时写入）：
```json
{ "asyncByDefault": false, "defaultSubagentContext": "fresh", "maxSubagentDepth": 1, "maxActiveAsyncRunsPerSession": 2 }
```
> 实施时按安装版本的 `docs/configuration.md` 核对键名；`asyncByDefault:false` 会让模型默认前台运行（结果实时可见），后台需要时模型显式传 `async:true`——v1 推荐此默认以规避边界 A。

### 3.2 `mapPiJsonEvent`：新增 `setWidget` 窄缝（`pi/events.ts`）

在既有 `case 'extension_ui_request'` 内，**只在白名单方法判断之后**追加一个分支——不是放开 dialog 白名单，而是**只放行 `setWidget` + 特定 widgetKey + 特定前缀**：

```typescript
// 常量：与扩展约定对齐（pi-subagents WIDGET_KEY / ASYNC_STATUS_SNAPSHOT_WIDGET_PREFIX）
const SUBAGENT_ASYNC_WIDGET_KEY = 'subagent-async';
const SUBAGENT_ASYNC_SNAPSHOT_PREFIX = 'PI_SUBAGENT_ASYNC_JSON:';

// case 'extension_ui_request' 内、DIALOG_METHODS 判断之后：
if (method === 'setWidget') {
  // 仅 pi-subagents 的异步快照：一行 "PI_SUBAGENT_ASYNC_JSON:{...}"
  if (String(evt.widgetKey ?? '') !== SUBAGENT_ASYNC_WIDGET_KEY) break;
  const lines = Array.isArray(evt.widgetLines) ? evt.widgetLines.filter((l) => typeof l === 'string') : [];
  const raw = lines.find((l) => l.startsWith(SUBAGENT_ASYNC_SNAPSHOT_PREFIX));
  if (!raw) break;
  const payload = raw.slice(SUBAGENT_ASYNC_SNAPSHOT_PREFIX.length);
  let snapshot: unknown;
  try { snapshot = JSON.parse(payload); } catch { break; }   // 解析失败 = 静默忽略（防卡流）
  const runs = Array.isArray((snapshot as { runs?: unknown })?.runs)
    ? (snapshot as { runs: SubagentFleetRun[] }).runs
    : [];
  yield { type: 'subagent_fleet', runs } as ChatStreamEvent & { type: 'subagent_fleet' };
  break;
}
```

- **白名单边界**：只透传 `runs` 树的**安全展示字段**（见 §3.3 的抽取器），其余（`caps`/`omitted`/原始大 JSON）不下发；不放开 notify/setStatus/setTitle/custom。
- `setWidget` 是 fire-and-forget：**不期望响应、不回写**，与 dialog 的 `extension_ui_response` 通道无关。
- 快照行是**单行长 JSON**（上限 32KB），`applyWidgetCap` 会截断 → 必须先解析、后成行（§3.3 在桥内做，events.ts 只透传结构化 runs）。

### 3.3 `pi-widgets.ts`：两个新生产者 + 一个消费点

**A. `subagent` 工具结果生产者（前台/后台运行总结面板）**

工具结果信封（`tool_result.result`）形态（以安装版本 `docs/tool-reference.md`/实现为准，以下为 v1 解析契约）：
```json
{ "content": [{"type":"text","text":"...summary..."}],
  "details": { "mode":"single|parallel|chain|workflow|management", "runId":"...",
    "results":[{ "agent":"reviewer", "exitCode":0, "status":"complete|running|...",
                 "usage":{...}, "output":"...", "truncation":{...} }],
    "background":true, "asyncId":"...", "asyncDir":"..." } }
```

```typescript
registerToolWidgetProducer('subagent', subagentWidgetProducer);

function subagentWidgetProducer(call: ToolCallInfo, result?: ToolResultInfo): WidgetDraft | null {
  if (!result) return null;
  const r = parseToolResult(result.result);            // JSON.parse + 字段收敛（容错）
  const d = r?.details ?? {};
  const results = Array.isArray(d.results) ? d.results : [];
  if (results.length === 0 && !d.background) return null;

  const lines: string[] = [];
  if (d.background) {
    lines.push(`后台运行已启动 · ${d.asyncId ?? ''}`);   // async：模型交还控制权，实时态由 fleet 面板负责
  }
  for (const row of results) {
    const icon = row.status === 'running' ? '◐' : row.exitCode === 0 ? '✓' : '✗';
    const agent = String(row.agent ?? 'subagent');
    lines.push(` ${icon} ${agent}${row.usage ? ` · ${fmtTokens(row.usage)}` : ''}`);
    if (row.truncation?.truncated) lines.push(`   （输出过长已截断）`);
  }
  return {
    key: 'subagent-result',
    label: '子代理运行',
    lines,
    placement: 'aboveEditor',
    data: { background: !!d.background, mode: String(d.mode ?? '') },   // 供前端渐进增强
  };
}
```

- 前台单行并行/链式：逐行罗列 `results` 子项（agent + 状态 + 用量），`applyWidgetCap` 兜底行数。
- `management` 动作（list/status/doctor 等）结果行数少、价值低：**不产 widget**（`results.length===0 && !background` → null）。
- **异步启动**：只产一行「已启动」，实时进度由 fleet 面板（B）承载；完成时模型通常还会再调一次 `subagent`（带结果）或前端水合看到 `subagent-notify` 消息。

**B. `subagent_fleet` 事件消费者（后台运行实时 fleet 面板）**

在 `withWidgetBridge` 的 `for await` 循环里新增一个 `case 'subagent_fleet'`（与 `tool_call`/`tool_result` 并列）：

```typescript
if (evt.type === 'subagent_fleet') {
  // 解析快照 → 纯文本行（先解析后成行，规避单行长 JSON 被 applyCap 截断）
  const lines = renderSubagentFleetLines(evt.runs);
  if (lines.length === 0) {
    const prev = live.get('subagent-fleet');
    if (prev) { live.delete('subagent-fleet'); lastEmitAt.delete('subagent-fleet');
      yield { type: 'extension_widget_clear', key: 'subagent-fleet' }; }
    yield evt; continue;
  }
  const draft: WidgetDraft = {
    key: 'subagent-fleet', label: '子代理队列',
    lines, placement: 'belowEditor',
    data: { runs: evt.runs },                     // 结构化快照随持久化落盘（水合可重建/前端可选消费）
  };
  applyWidgetCap(draft);
  const now = Date.now();
  const prev = live.get('subagent-fleet');
  live.set('subagent-fleet', { draft, updatedAt: now, toolName: 'subagent' });
  const last = lastEmitAt.get('subagent-fleet') ?? 0;
  if (!prev || now - last >= WIDGET_THROTTLE_MS) {
    lastEmitAt.set('subagent-fleet', now);
    yield { type: 'extension_widget', key: draft.key, label: draft.label,
            lines: draft.lines, placement: draft.placement };
  }
  yield evt; continue;
}
```

`renderSubagentFleetLines(runs)` 抽取器（安全字段白名单，参考扩展 `fleet-status.ts`/`async-status-projection.ts` 的展示字段）：
```typescript
function renderSubagentFleetLines(runs: SubagentFleetRun[]): string[] {
  const lines: string[] = [];
  for (const run of runs) {
    // run: { id, kind:"subagent|workflow|step|host-step", label, state,
    //        activity?: {state,currentTool,lastActivityAt}, startedAt?, children?: [] }
    const icon = stateIcon(run.state);             // running◐ queued○ complete✓ failed✗ …
    const activity = run.activity?.currentTool ? ` · ${run.activity.currentTool}` : '';
    lines.push(` ${icon} ${run.label}${activity}`);
    pushNested(lines, run.children ?? [], 1);      // 递归，深度 ≤ 3、每节点缩进 2 空格
  }
  return lines.slice(0, MAX_WIDGET_LINES);         // applyCap 还会再兜底
}
```
- `stateIcon`/标签映射仅取枚举白名单（未知状态降级 `·`）；activity 只取 `currentTool`/`state`，**不取路径/原始参数**。
- **收尾持久化**：`withWidgetBridge` 的 finally `store.commit` 已把 fleet 面板随快照落盘（data 含 runs 树），水合 `widget_set_all` 自动恢复 → 跨轮保留、刷新不丢。
- **清空语义**：快照 runs 为空（无活跃后台运行）→ 清掉面板（`extension_widget_clear`），与现有 todo 空状态行为一致。

### 3.4 事件类型与接线

- `backend-ts/src/modules/bookplate/stream.ts`：`ChatStreamEvent` 联合类型新增 `| { type: 'subagent_fleet'; runs: SubagentFleetRun[] }`（runs 内字段为后端定义的安全 DTO，见 §3.3 B）。
- `ai-nodes.ts`：`withWidgetBridge` 接入点**无需改动**（桥内部消费新事件；`mapPiJsonEvent` 在 `runner.ts consumeLine` 处天然流入）。
- `pi-widgets.ts` 顶部注释的 C1 原则需补充一句例外说明（pi-subagents 的 RPC 结构化快照窄缝），避免后人误删。

### 3.5 清会话清理（安全项，必做）

`clearPiSession`（`pi/workspace.ts`）在「先杀活跃 RPC 子进程」之后，追加子代理残留清理：
1. 读取 `PI_SUBAGENTS_TEMP_ROOT`（默认 `{os.tmpdir()}/pi-subagents-{scope}/`，scope 按用户名/home 派生）下的 `async-subagent-runs/`，按 `status.json.sessionId`/`sessionFile` 归属过滤当前 workspace 的 run，`kill` 其记录的 runner pid 并删除目录（参照扩展 `retained-children` 的归属口径；实施时以安装版本实际落盘结构为准，**不存在/不可读则跳过**，不阻塞清会话）。
2. 归属判定失败时**降级**：记录警告并跳过（不清除不可证明归属的目录，宁漏勿误删其他租户）。

> 同时把 `PI_SUBAGENTS_TEMP_ROOT` 显式注入子进程 env（见 §4.2），使归属可预测、可枚举。

---

## 4. 多租户与资源收敛

### 4.1 隔离（现状保持 + 一处新增）
- RPC 进程注册表 `${userId}:${workspaceId}` 复合 key 不变；子代理在父进程内执行、父进程按工作区隔离 → 隔离面不新增。
- **新增**：`PI_SUBAGENTS_TEMP_ROOT` 按用户/工作区收敛（§4.2），子代理产物不散落在共享 temp 根。

### 4.2 子进程 env 收敛（runner.ts buildSpawnArgs）
在 spawn env 中注入：
```typescript
env.PI_SUBAGENTS_TEMP_ROOT = path.join(os.tmpdir(), `pi-subagents-${userId}-${sanitize(workspaceId)}`);
env.PI_SUBAGENT_WAIT_TOOL_ENABLED = 'false';   // v1 不开 wait 工具（其轮询/订阅增加后台驻留面）
// （可选）env.PI_SUBAGENT_TASK_DELIVERY = 'file';  // EDR 环境下的 argv 长度防护，按服务器情况决定
```
- 这样 `DIRS.async`（扩展源码 `shared/types.ts` 从 `PI_SUBAGENTS_TEMP_ROOT` 派生）落点确定、可枚举，§3.5 清理与 v2 扫描（§9）才有可靠依据。
- 同时设置 `maxActiveAsyncRunsPerSession`（§3.1 config）与现有 `PI_MAX_PROCESSES` LRU 形成双层并发上限。

### 4.3 资源上限（复用现有）
- widget 尺寸/行数/节流：`applyWidgetCap` / `WIDGET_THROTTLE_MS` 全复用；fleet 快照是单行大 JSON，**必须先解析成行再 applyCap**（§3.3 B 已体现）。
- 会话超时：`PI_RPC_TIMEOUT_MS`（默认 10 分钟）对「后台运行导致父进程长时间等待」同样生效——注意前台子代理若长时间运行，父轮次会撞超时被杀（含子代理），属预期（v1 限制，见 §8）。

### 4.4 安全
- 子代理 = 子 pi 进程 = **在共享服务器上执行任意代码的更高一档**（比普通扩展还多一层 spawn）。白名单 + 版本锁定沿用；`subagent` 工具随扩展自动注册，**无法只对子代理工具做 per-tool 禁用的不需要做**——禁用整个扩展即可（白名单粒度）。
- `subagent_fleet` 只透传白名单字段（label/state/currentTool/startedAt/children），不传 runId/asyncId 等内部 id、不传路径与原始参数（与扩展 RPC fleet DTO「永不暴露 run/async/tool id」口径一致）。
- 前端渲染：既有 `<pre>` React 转义，无注入面；行内文本经 `sanitizeWidgetLine` 剥控制字符。

---

## 5. 前端实现

**目标：独立可折叠组件，按对话顺序显示在对话流中**（对齐 ask-user-question 的 `QuestionAnswerBlock` 模式）。

### 5.1 设计原则

- **数据源 = 消息自身**：`subagent` 工具调用/结果已作为 `agent_tool_call` / `agent_tool_result` 归并进 `msg.agentSteps`（流式由 `piStreamReducer` 写入，水合由 `pi-session-hydrate.ts` 从会话 jsonl 恢复）→ **零新增 SSE 事件**，历史消息刷新后卡片天然还在（服务端真相源）。
- **流式吃结构、水合吃文本**：流式期间 `agent_tool_result.result` 是完整 JSON（含 `details.results`/`background`/`asyncId`）；水合后 `result` 退化为纯文本摘要（`session-hydrate.ts` `MAX_RESULT_CHARS` 截断）。解析器两条路都支持，与 `parseQuestionnaireInteractions` 同一容错策略。
- **与 widget 面板分工**：流内卡片 = 每次 subagent 运行的**结果摘要**（按对话顺序，历史可见）；`subagent-fleet` widget（§3.3 B）= 后台任务的**实时状态**（编辑器下方，仅活跃轮次内实时）。两者不重复：卡片展示「发生过的运行」，fleet 展示「正在跑的队列」。

### 5.2 新建 `SubagentRunBlock.tsx`（流内卡片，参考 `QuestionAnswerBlock.tsx`）

```tsx
"use client";
// 参考 QuestionAnswerBlock 的挂载/渲染惯例：
// - 解析器 parseSubagentRuns(msg.agentSteps) 从步骤里提取全部 subagent 运行
// - 渲染为独立折叠卡片，紧跟 AI 引导语（正文气泡）下方，按对话顺序排列

export interface ParsedSubagentRun {
  toolCallId: string;
  /** 子代理名（scout / reviewer / worker …） */
  agent: string;
  /** 管理动作（list / status / doctor …）；纯管理动作不产卡片 */
  action?: string;
  /** 是否后台运行 */
  background: boolean;
  /** 是否已有结果（水合后 = 必有；流式中 = tool_result 是否到达） */
  hasResult: boolean;
  /** 流式完整结构（仅流式期；水合后为 undefined） */
  details?: {
    results?: Array<{ agent?: string; exitCode?: number; status?: string; usage?: { total?: number } }>;
    background?: boolean;
    asyncId?: string;
  };
  /** 结果文本摘要（水合后唯一来源；流式期兜底） */
  resultText?: string;
}

export function parseSubagentRuns(steps?: AgentStep[]): ParsedSubagentRun[] {
  // 遍历 agent_tool_call，name === 'subagent'：
  //   - arguments JSON 取 agent / action / async
  //   - 配对同 id 的 agent_tool_result：
  //       result 以 '{' 开头 → 尝试 JSON.parse 取 details（含 results/background/asyncId）
  //       else → 视为纯文本摘要（水合路径）
  //   - 纯管理动作（action 在 list/status/doctor/… 集合）且无结果 → 跳过不产卡
  //   - 无 result 的调用 → hasResult:false（运行中）
}
```

渲染形态（可折叠，按对话顺序）：

```tsx
{/* 头部：状态图标 + 子代理名 + 状态徽章（可点击折叠） */}
<button onClick={toggle} className="…折叠触发器…">
  {icon} 子代理 · {run.agent}   {badge}   {chevron}
</button>
{/* 展开区：task 摘要 + 结果行（流式完整结构）或结果文本（水合回退） */}
{expanded && (
  <pre className="…">
    {/* 流式：逐行 details.results → "✓ reviewer · 1.2k tokens" / "✗ scout · 已失败" */}
    {/* 水合：resultText 截断展示 */}
  </pre>
)}
```

- 状态徽章：`运行中`（有 call 无 result，流式期）/ `完成` / `失败`（`exitCode!==0` 或 `isError`）/ `后台运行中`（`details.background && !hasResult`）。
- 折叠默认态：多条运行同现时默认只展开最后一条（与 `ExtensionWidgets.defaultExpanded` 同思路），其余折叠；单条默认展开。

### 5.3 修改 `ChatNode.tsx`（挂载点，与 QuestionAnswerBlock 并列）

在 `ChatMessageItem` 内、正文气泡之后追加（与 ask_user_question 卡片的挂载点同层级，保证按对话顺序）：

```tsx
// 5. 子代理运行卡片（subagent）：按对话顺序独立折叠展示，紧跟 AI 引导语下方
const subagentRuns = useMemo(() => parseSubagentRuns(msg.agentSteps), [msg.agentSteps]);
…
{subagentRuns.length > 0 && (
  <div className="w-full mt-1.5">
    {subagentRuns.map((run) => (
      <SubagentRunBlock key={run.toolCallId} run={run} />
    ))}
  </div>
)}
```

> 不做：不改 `piStream.ts` 事件面 / reducer（卡片数据全部来自已有 `agentSteps`）；不改水合 DTO。

### 5.4 与既有 UI 的关系

| 展示面 | 位置 | 内容 | 实时性 |
|--------|------|------|--------|
| `SubagentRunBlock`（新） | 对话流内、按消息顺序 | 每次 subagent 运行的摘要卡片（折叠） | 流式期间实时（运行中→完成）；历史水合恢复 |
| 工具步骤卡（`AgentActivity`，现状） | 消息内的步骤区 | `subagent · reviewer` 调用步骤 | 现状 |
| `subagent-fleet` widget（§3.3 B） | 编辑器下方 | 后台任务实时队列 | 仅活跃轮次内（边界 A） |
| `subagent-notify` 完成消息 | 对话流（水合消息） | 后台完成的最终通知 | 下一轮水合可见 |

---

## 6. 验证清单（提交前逐项过）

1. 后端类型检查：`cd backend-ts && npm run typecheck`
2. 既有 pi 测试回归：`npx vitest run tests/api/pi-agent-* tests/api/pi-widgets.test.ts tests/api/pi-sse-wire.test.ts tests/api/pi-event-map.test.ts`
3. 新增单元测试：
   - `mapPiJsonEvent`：`setWidget("subagent-async", ["PI_SUBAGENT_ASYNC_JSON:{...}"])` → `subagent_fleet`（runs 透传）；非 `subagent-async` key / 坏 JSON / 其他 setWidget → 静默忽略；dialog 方法回归不变。
   - `subagentWidgetProducer`：前台单行/并行/链式结果 → 面板行；management/无结果 → null；后台启动 → 单行。
   - `renderSubagentFleetLines`：深树/空 runs/未知 state 降级/超长 label 截断。
   - `withWidgetBridge`：`subagent_fleet` → `extension_widget("subagent-fleet")` 且最终快照含 data.runs；空 runs → clear；快照落盘/水合恢复。
4. 扩展真实加载冒烟（RPC）：mock provider 下 spawn `pi --mode rpc -e <已装 pi-subagents 目录> --session <tmp>/chat.jsonl --provider bookforge --model bookforge/<m>`，stdin `{"type":"prompt","id":"p1","message":"Use reviewer to review this diff."}` → 断言 stdout 依次出现 `tool_execution_start`(subagent)、`extension_ui_request`(setWidget subagent-async)、`tool_execution_end`、`agent_settled`；退出码 0、无扩展错误。
5. **子代理模型可用性**：同上冒烟中让子代理真实执行（可改用 `scout` + 简单任务），确认子进程能解析到 `bookforge` provider 并产生输出（验证 env/模型继承）。
6. 全链路：登录后 POST `/api/modules/bookplate/chat`（Skill Agent 节点，`PI_EXTENSIONS` 含 pi-subagents）→ SSE 出现 `tool_call(subagent)` → `extension_widget(subagent-result)`；若跑后台任务，出现 `extension_widget(subagent-fleet)`；无 `error`。
7. 水合回归：跑出 fleet 面板后刷新页面 → `GET /chat/session` 的 `widgets` 含 `subagent-fleet`（lines + data.runs），前端面板恢复。
8. 前端流内卡片：
   - 流式期：SSE 流中 `tool_call(subagent)` 后卡片显示「运行中」；`tool_result` 到达后变「完成/失败」，展开区逐行显示子代理结果（agent + 状态 + token）；
   - 水合回归：刷新页面 → 历史消息的 subagent 卡片仍按对话顺序显示（result 为文本摘要回退渲染）；
   - 折叠交互：单条默认展开、多条默认只展开最后一条、点击头部折叠/展开。
9. 清会话清理：启动一个后台子代理 → 清空对话 → 断言父 RPC 进程被杀、`PI_SUBAGENTS_TEMP_ROOT` 下该 workspace 的 async run 目录被清、无残留 runner 进程。
10. 多租户并发回归：两个账号对同一 nodeId 并发对话，各自触发子代理，断言互不串扰（注册表复合 key 隔离 + temp root 按 userId 隔离）。

---

## 7. 已知限制与开放问题（v1）

| 项目 | 等级 | 说明 / 对策 |
|------|------|-------------|
| 后台运行空闲期状态不实时推送 | 中 | 边界 A：`setWidget` 事件只在活跃轮次被消费。v1 = 持久化快照 + 下轮/水合对齐；v2 = 空闲期 temp 根扫描（§9） |
| 前台子代理长跑会撞 `PI_RPC_TIMEOUT_MS`（10 分钟）被整树杀 | 中 | 预期行为；提示语复用现有超时文案。可调大超时或引导模型用后台模式 |
| 后台子代理残留（父被杀后） | 高（安全） | §3.5 必做清理 + §4.2 temp 根收敛；实施时按安装版本实际落盘结构核对归属判定 |
| 子代理 spawn 的 pi 子进程并发数不可控（受扩展自身 `maxActiveAsyncRunsPerSession` 约束） | 中 | §3.1 config 收敛 + 现有 `PI_MAX_PROCESSES` LRU 兜底父进程；子代理进程计数列入 v2 配额 |
| `asyncByDefault` 语义与扩展版本演进 | 中 | 以安装版本 `docs/configuration.md` 为准；实施时用冒烟确认默认模式 |
| `PI_SUBAGENTS_TEMP_ROOT` 注入改变扩展 temp 落点 | 低 | 按 userId 收敛利大于弊（可枚举可清理）；实施时验证扩展能正确 mkdir 该根 |

**开放问题（实施时核对）**
- pi-subagents 安装版本的 `Details`/`AsyncStatusSnapshotV1` 字段名以实际包为准（本方案给的是源码形态契约）。
- `clearPiSession` 的残留清理归属判定（`status.json.sessionId` vs `sessionFile`）需按实际落盘核对；扩展自身 `retained-children` 的保留策略可能延迟删除，清理器需容忍。

---

## 8. 与既有机制的对照（避免重复造轮子）

| 关注点 | 既有机制 | 本方案 |
|--------|----------|--------|
| 扩展装配/白名单/挂载 | `resolvePiExtensions` + `preparePiWorkspace` + 多 `-e`（pi-extension-integration.md §2） | 直接复用，零改动 |
| widget 展示 | `withWidgetBridge` + 生产者注册表（extension-widgets v2.0） | 复用 + 新增 `subagent` 生产者 + `subagent_fleet` 消费点 |
| 事件归一化 | `mapPiJsonEvent` 白名单（dialog 四方法） | 新增 setWidget 窄缝（仅 `subagent-async` 快照） |
| 持久化/水合 | `widgets.json` 快照 + `chat/session` + `widget_set_all` | 复用；fleet 面板 data 带 runs 树 |
| 交互（dialog） | `extension_ui_request` select/input → `/chat/ui-response` | 不涉及（子代理是工具执行，非用户交互） |
| 参考 pi-web | 本地 TUI 渲染 FleetView/fleet inspector | 拓扑不同，不采用；只借鉴「子代理活动可见」的产品语义 → 由 fleet 面板 + 运行步骤卡承载 |

---

## 9. v2 候选（本次不做，仅记录触发条件）

1. **空闲期 async 状态扫描**：后端按 `PI_SUBAGENTS_TEMP_ROOT` 定时/懒扫描 `async-subagent-runs/{runId}/status.json`（含 `subagent-child-status` 事件），把后台完成实时推给前端（`subagent_fleet` 事件由文件驱动而非 stdout 驱动）。触发条件：业务要求「后台子代理完成即时可见」。
2. **流内卡片实时状态**：把 fleet 快照（§3.3 B）按 `asyncId` 关联到 `SubagentRunBlock`（后台卡片从「后台运行中」实时推进到「完成」），需要空闲期状态通道（与候选 1 同依赖）。
3. **完成消息实时推送**：收割 `subagent-notify` 落盘消息 → 空闲期推 `status`/通知事件。
4. **子代理步骤卡增强**：工具结果 `details.results[].output` 折叠展示、`subagent_wait` 等待进度条。
5. **子代理进程配额**：把扩展 spawn 的子 pi 进程计入服务器全局并发账本（与 `PI_MAX_PROCESSES` 同层）。
6. **steer/stop 控制**：通过扩展 in-process RPC（`subagents:rpc:v1`）对后台运行做「停止/继续」——需解决「空闲进程无 round 时如何注入请求」的问题后再评估。
