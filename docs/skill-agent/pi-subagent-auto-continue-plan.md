# 后台子代理「自动续轮」优化方案

> 参考 `pi-web-main` 的 subagent 唤醒/续轮设计，结合当前安装的
> `pi-subagents@0.59.0`（`~/.pi/agent/npm/node_modules/pi-subagents`）实际逻辑与本项目
> `backend-ts` / `frontend` 现有代码制定。目标：后台异步子代理完成后，主 agent
> **自动续轮**消费结果并流式推给前端，用户无需手动再发一条消息。

---

## 1. 现状与根因（代码级核实）

### 1.1 扩展侧（pi-subagents@0.59.0）

后台 async 子代理完成时，扩展在**父 pi 进程内**发送完成通知：

```typescript
// src/runs/background/notify.ts:369-381
pi.sendMessage(
  { customType: "subagent-notify", content, display },
  { triggerTurn: items.some((item) => item.triggerTurn) },
);
```

该调用进入 pi 的 `sendCustomMessage`（`pi-main/.../core/agent-session.ts:1461-1478`）：

```typescript
if (options?.deliverAs === "nextTurn")        → 排入 _pendingNextTurnMessages（不打断）
else if (this.isStreaming && triggerTurn)      → 默认 steer()（打断当前流）
else if (options?.triggerTurn)                 → await this._runAgentPrompt()（空闲时自动开新轮）
```

即：**主 agent 空闲时，扩展的 triggerTurn 会在 pi 进程内自动开启一轮新的生成**；
RPC 模式下所有 session 事件（`agent_start`/`message_update`/`agent_settled`…）都会
`output(toJsonEvent(event))` 到 stdout（`pi-main/.../modes/rpc/rpc-mode.ts:355-356`）。

### 1.2 本项目侧（backend-ts）

- `runner.ts:105-108` `consumeLine` 仅在 `entry.round` 非空时消费 stdout 事件；
- `streamRound` 在收到 `agent_settled` 后退出，`finally` 里 `entry.round = null`
  （`runner.ts:421`）；
- → **空闲期 pi 自动触发的新轮，其 stdout 事件被整体丢弃**，结果只落盘会话文件，
  前端不可见。这是「必须用户手动发下一条消息才触发」的根因。

### 1.3 前端侧（frontend）

- `PiChatNodeHost.tsx` 用 `fetch /chat` + `for await (parseSseStream(...))` 消费 SSE，
  流结束（`resp.body` 读完）才 `finishRun()` 水合收尾；
- 流式期间 `send()` 进入本地 `msgQueue`（`PiChatNodeHost.tsx:511-519`），当前轮结束
  自动续发——与 pi-web 的 followUp 排队语义一致；
- `PROMPT_SSE_IDLE_TIMEOUT_MS = 120_000`（`platform/utils/timeouts.ts:25`），收到任何
  事件即重置计时（`PiChatNodeHost.tsx:647`）。

---

## 2. 目标与设计原则

- **目标**：后台子代理完成 → 主 agent 自动续轮处理结果 → 前端自动展示新一轮输出，
  全程无需用户操作。
- **原则**：不改第三方扩展（`pi-subagents` 的 triggerTurn 已完成续轮触发）；改动
  收敛在本项目后端 runner 的「空闲监听」与前端 SSE 生命周期，保持现有进程复用、
  超时兜底、清空对话等既有语义不回退。

---

## 3. 方案设计

### 3.1 后端：`streamRound` 从「单轮」升级为「主轮 + 空闲监听续轮」

在 `runner.ts` 的 `streamRound` 主轮正常 `settled` 后，若本轮存在**运行中的后台
子代理**，不立即退出，而是进入「空闲监听态」：

1. 保持 `entry.round` 非空（新增 `round.listening` 标记），`consumeLine` 继续消费
   stdout；
2. 监听态捕获 pi 扩展自动触发的新轮起始事件 `agent_start` → 重置本轮状态
   （`settled=false`、`turnStarted=false`）→ 继续 yield 事件直至 `agent_settled`；
3. 一轮续轮结束后再判：若仍存在后台子代理 → 继续监听；否则（或空闲超时）退出。
4. 监听期持续 `touchPiProcess`（刷新 lastUsed，避免被空闲回收/LRU 误杀）。

**后台子代理存在判定**（`round.backgroundRunsActive`）：
- `subagent_fleet` 事件（`setWidget("subagent-async")` 快照）`runs.length > 0` → true；
  `runs.length === 0` → false；
- `tool_result` 携带 `details.asyncId`（后台启动）→ true；
- 主轮结束、续轮结束时读取该标志决定是否继续监听。

**退出条件**（任一满足即退出监听、结束 SSE）：
- `backgroundRunsActive === false` 且已收到本轮 `agent_settled`（后台任务全部结束）；
- 监听超时 `PI_SUBAGENT_LISTEN_TIMEOUT_MS`（默认 10 分钟，防后台任务永不结束）；
- 错误 / abort / 进程退出 / 写失败。

### 3.2 后端：进程复用与回收适配（registry.ts / runner.ts）

- `PiRoundState` 新增 `listening: boolean`、`turnStarted: boolean`、`backgroundRunsActive: boolean`；
- `runPiAgent` 的「忙则杀旧重拉」判定（`runner.ts:527`）**保持原样**（`entry.round` 非空即视为忙）：
  空闲监听期间 `entry.round` 非空，若用户此时发新消息会杀旧进程重拉——但前端在 SSE 打开期间
  （含监听期）`send()` 一律进 `msgQueue` 队列（`PiChatNodeHost.tsx:511-519`），SSE 关闭后才自动
  续发，因此监听期不会收到新 `/chat` 请求，忙则杀旧仅作防御性兜底；
- 监听期由 runner 周期性 `touchPiProcess`，防空闲回收 / LRU 驱逐误杀监听中的进程。

### 3.3 后端：事件映射与 SSE（runner.ts / events.ts / stream.ts）

- **`agent_start → turn_start` 映射实现在 `runner.ts consumeLine`**（而非 events.ts）：因需
  `round.listening` 守卫——主轮起始的 `agent_start` 不产 `turn_start`，仅监听态捕获到
  pi 自动触发的新轮才产；`events.ts mapPiJsonEvent` 保持对 `agent_start` 静默（既有测试断言不变）。
- **后台结束信号**（`subagents/snapshot.ts`）：RPC 模式下后台任务全部结束、扩展清空 widget 时
  `setWidget("subagent-async", undefined)` → stdout 事件 `widgetLines: undefined`。改造
  `subagentFleetRunsFromUiRequest` 返回 `{ valid, runs }`：subagent-async key 且无快照行
  → `{ valid: true, runs: [] }`（有效空快照=后台结束信号）；非本扩展 / 坏 JSON → `{ valid: false }`
  （静默）。`events.ts` 据此对有效空快照也产出 `subagent_fleet`，runner 据此把
  `backgroundRunsActive` 置 false → 监听退出。
- `stream.ts` 新增 `ChatStreamEvent` 分支：`turn_start` / `heartbeat`；SSE 序列化无需改动
  （generator 不结束即保持连接）。

### 3.4 后端：监听期心跳（runner.ts / ai-nodes.ts）

后台子代理可能长时间运行且无 fleet 快照事件，前端 `PROMPT_SSE_IDLE_TIMEOUT_MS`
（120s）会误杀连接。监听期由后端周期性产出 `{ type: "heartbeat" }`（间隔
`PI_SUBAGENT_LISTEN_HEARTBEAT_MS`，默认 15s），前端仅用它重置 idle 计时，
不计入步骤/正文。

### 3.5 前端：保持连接 + 续轮渲染（piStream.ts / PiChatNodeHost.tsx）

- `piStream.ts`：
  - `turn_start` → 强制开启一条新的 `LiveAssistantStep`（与 `openStepIfSealed`
    语义对齐，但不受「上一条已 sealed」限制，确保续轮第一句正文进入新气泡）；
  - `heartbeat` → 空操作（仅类型上允许，reducer 忽略）。
- `PiChatNodeHost.tsx`：
  - SSE 流结束（而非单轮结束）才 `finishRun()` 水合——现逻辑已满足，不改；
  - `for await` 循环内收到 `heartbeat` → `idle.reset()` 防超时；
  - 流式期间 `send()` 进队列的语义保持（续轮期间用户消息自动排队）。

---

## 4. 配置项（config.ts，环境变量可覆盖）

| 常量 | 默认 | 说明 |
|------|------|------|
| `PI_SUBAGENT_LISTEN_TIMEOUT_MS` | `10 * 60 * 1000` | 空闲监听总超时（防后台任务永不结束） |
| `PI_SUBAGENT_LISTEN_HEARTBEAT_MS` | `15 * 1000` | 监听期心跳间隔（保持前端连接活跃） |

---

## 5. 改动点清单

| 文件 | 改动 |
|------|------|
| `backend-ts/src/services/pi/config.ts` | 新增监听超时 / 心跳间隔常量 |
| `backend-ts/src/services/pi/registry.ts` | `PiRoundState` 增加 `listening` / `turnStarted` / `backgroundRunsActive` |
| `backend-ts/src/services/pi/runner.ts` | `consumeLine` 捕获 `agent_start` 续轮 + 后台运行判定；`streamRound` 主轮收尾后进入空闲监听续轮 |
| `backend-ts/src/modules/bookplate/stream.ts` | `ChatStreamEvent` 增加 `turn_start` / `heartbeat` |
| `frontend/src/modules/bookplate/piStream.ts` | `turn_start` 开新步骤、`heartbeat` 忽略 |
| `frontend/src/modules/bookplate/PiChatNodeHost.tsx` | `turn_start` / `heartbeat` 事件处理 |

---

## 6. 风险与边界

| 风险 | 对策 |
|------|------|
| 扩展 notify 无 `deliverAs`，主 agent **仍流式**时后台完成会 `steer` 打断当前轮 | 本项目主 agent 启动后台子代理后通常很快 `settled`；该场景记为已知限制（不改第三方包），后续按需评估 |
| 监听期长连接占用连接/内存 | 监听超时兜底 + 监听期心跳受 idle 回收机制约束 + 前端连接关闭即终止监听 |
| 续轮期间用户发消息 | 前端队列自动续发（既有语义），后端监听态不杀进程 |
| 空闲回收 / LRU 误杀监听进程 | 监听期持续 `touchPiProcess` |

---

## 7. 验证计划

1. **单测**：`events.ts` 的 `agent_start → turn_start` 映射（更新
   `pi-event-map.test.ts`）；`stream.ts` 事件类型编译通过。
2. **冒烟**：spawn `pi --mode rpc -e pi-subagents`，后台子代理完成后断言 stdout
   依次出现 `agent_start`→`message_update`→`agent_settled`，改造后应被后端捕获并
   转发。
3. **集成**：发「派后台 reviewer」→ 主 agent settled → 不操作前端，后台完成 →
   断言前端自动出现新一轮输出且结果进入上下文。
4. **回归**：正常单轮对话、用户排队消息、清空对话、超时兜底不回归。
