# pi-agent RPC 不变量（rpc-invariants）

- **维护**: 每次升级 `pi-coding-agent` 前，先核对本清单，再回归 `backend-ts/src/services/pi/`。
- **适用**: 开发人员（后端 `backend-ts`）、升级执行者。
- **定位**: 这些都是踩过的坑，原文埋在代码注释里；本文把它们沉淀为可被新人/升级流程触达的约束。
- **代码基线**: pi-coding-agent 0.85.1（RPC 模式，`pi --mode rpc` 常驻子进程，非 SDK 进程内嵌入）。2026-09-10 从 0.84.2 升级并按本文清单逐条核对 + 全量回归通过（`npx tsc --noEmit` + `tests/api/` 25 个套件 266 用例）。注意：vendored 源码快照 `docs/skill-agent/pi-main/` 仍为 0.84.x，仅作历史对照，与安装版本已不再一致。

> 升级流程：`npm ls @earendil-works/pi-coding-agent` → 读包内 `CHANGELOG.md`（
> `node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md`）→ 逐条比对下方不变量是否仍成立
> → 再跑回归（`npx tsc --noEmit` + `npx vitest run tests/api/pi-*.test.ts`）。
> 完整操作手册（含扩展包矩阵核对、已知已知坑、回滚）见 **`docs/skill-agent/pi-agent-upgrade-playbook.md`**。

---

## 1. Windows 0xC0000409：不用 `stdin.end()` 优雅退出，杀树更稳

- **行为**: `streamRound`（`runner.ts`）结束时**不调用** `stdin.end()` 让 pi 优雅退出，而是直接
  `killTree(entry.child)`（Windows `taskkill /pid <pid> /T /F` 杀整棵进程树；POSIX `SIGKILL`）。
- **原因**: Windows 下 pi 的 shutdown 与扩展（pi-image-gen 等）的 async handle 存在 libuv 竞态，
  表现为 `0xC0000409`（async.c Assertion）。杀树可绕过该竞态。
- **配套**: `agent_settled` 是会话文件已落盘的**权威信号**——正常收尾路径在收到 `agent_settled`
  后不杀进程（保活复用）；异常/超时/abort 才杀树。`streamRound` 正常收尾后进程留用供下一轮复用。
- **升级注意**: 若新版本修复了该竞态、允许优雅退出，也**不要**改回 `stdin.end()`——杀树语义已与
  进程复用/LRU/空闲回收整体耦合，改动需全链路回归。

## 2. auto-retry 恢复成功必须覆盖此前 errorMessage

- **行为**: `mapPiJsonEvent`（`events.ts`）的 `message_end` 分支，把 `state.lastError` 更新为
  `msg.errorMessage ?? null`——每条 assistant `message_end` 都视为最新结果。
- **原因**: auto-retry 恢复后的成功消息必须覆盖此前失败尝试的 `errorMessage`，否则进程正常结束后
  仍会误报「执行失败」——前端会在收尾 error chunk 上回滚整轮已流出的内容。
- **升级注意**: 若新版本把「重试成功」以其它事件（如 `auto_retry_end` 直接携带 errorMessage）
  表达，需同步本覆盖语义，否则 `formatPiFailure(lastError)` 会报旧错误。

## 3. registry 注销必须做 identity 校验

- **行为**: `registerPiProcess`（`registry.ts`）返回的注销函数，仅在
  `piProcessRegistry.get(key) === entry` 时才 `delete`（identity 校验）。
- **原因**: 过期轮的 `finally` 清理不得误删新进程的注册项（顶替语义：同 key 重注册会终止旧进程、
  写新条目）。若误删，`ui-response` 会对新轮 404。
- **升级注意**: 注册表 key 口径是 `{userId}:{workspaceId}` 复合键（与 `nodeWorkspace` 一致）；
  改动注销/顶替逻辑时必须保持 identity 语义。

## 4. `message_update` 只发 deltas（0.84.0 起）

- **行为**: `events.ts` 的 `message_update` 分支只消费 `assistantMessageEvent.{type, delta}`（
  `text_delta` → `content_delta`，`thinking_delta` → `reasoning_delta`），**不依赖** cumulative
  `message` / `partial` 字段；窄断言已用 `schema.ts` 的 `assistantMessageEventSchema` 校验。
- **原因**: 0.84.0 CHANGELOG 承诺 `message_update` "emits only deltas"；跨小版本脆，进程边界
  （`runner.ts` `consumeLine`）由 `rpcEventSchema`（zod）统一校验，未知/坏事件静默忽略。
- **升级注意**: 若新版本恢复 cumulative 语义或增删 delta 类型，需同步 `assistantMessageEventSchema`
  与事件映射分支。

## 5. `agent_settled` 优先于 `agent_end`

- **行为**: 本轮结束以收到 `agent_settled` 为准（`runner.ts` `isFinal()` / `isNormalSettle()`）。
  续轮（pi-subagents 后台子代理 triggerTurn 自动触发）以 `agent_start` 置 `turnStarted` 开启新一轮，
  直到下一次 `agent_settled`。
- **原因**: `agent_settled` 保证 retry / compaction / queue 等收尾处理**全部完成**后才触发，是
  会话文件落盘与「本轮完全落定」的权威边界；`agent_end` 不保证上述收尾已完。
- **升级注意**: 新增事件类型时，判断「轮结束」一律以 `agent_settled` 为锚，不要引入新的终局事件。

---

## 6. 已知测试敏感点（非协议不变量，升级排查先看这里）

- **`pi-agent-reuse.test.ts`「手动暂停后重发消息」是时序敏感用例**：断言 `mock.userCounts` 为
  `[1, 2]`（第 2 轮能收到第 1 轮上下文）。间歇性失败（`[1, 1]`）的根因是 pi `SessionManager._persist`
  的 **no-assistant guard**——新会话的 user entry 在首条 assistant entry 落盘前**只存内存**；
  若 abort 杀进程发生在首次持久化之前，第 1 轮 user entry 即丢失。
- **2026-09-10 已验证**：0.84.2 与 0.85.1 的 `_persist` 实现逐字节一致，该 flake 在两个版本上均可复现，
  **不是版本回归**。全量回归中偶发此用例失败时，先单独重跑确认，不要直接归因于升级。
- 彻底修复方向：abort 前等待 assistant entry 落盘（测试侧），或上游调整 no-assistant guard 持久化时机。

---

## 校验入口（进程边界）

- `runner.ts` `consumeLine`：`JSON.parse` + `rpcEventSchema.safeParse`，失败静默忽略（未知事件
  策略与 `mapPiJsonEvent` 的 default 分支一致）。
- `schema.ts`：只对**实际消费的事件类型**定义 schema；除 `response.success` /
  `extension_ui_request.method` 两个契约字段外，其余字段 `z.unknown().optional()` + `passthrough`，
  保持消费方 `String()`/`Number()` 宽容强制转换不被破坏。
- `events.ts` `mapPiJsonEvent`：纯函数归一化，未知事件静默忽略。
