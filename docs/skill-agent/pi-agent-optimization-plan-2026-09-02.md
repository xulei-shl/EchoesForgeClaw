# pi-agent 集成优化方案（按优先级）

- **日期**: 2026-09-02
- **来源**: `pi-agent-audit-2026-09-02.md`（含二次审核修订）
- **适用对象**: 开发人员（后端 `backend-ts`）
- **代码基线**: pi-coding-agent 0.84.2（当前 `^0.84.2`）

每个方案包含：目标 / 风险 / 涉及文件 / 实施步骤 / 验证 / 注意。按优先级从高到低实施，每项完成后在「状态」处打勾。

---

## 优先级速览

| 优先级 | 方案 | 类型 | 预估工作量 |
|--------|------|------|-----------|
| P0 | 1. 锁 pi-coding-agent 版本 | RISK | 小（几分钟） |
| P1 | 2. 后端退出钩子回收 pi 子进程 | RISK | 小 |
| P1 | 3. PiJsonEvent zod schema 校验 | INCR | 中 |
| P1 | 4. RPC 不变量沉淀到 AGENTS.md | INCR | 小（文档） |
| P2 | 5. 上游源码/计划文档目录边界 | STRUCT | 小（文档） |
| P2 | 6. events.ts 拆分错误文案 | STRUCT | 小 |
| P2 | 7. cleanup.ts 归属改为精确匹配 | INCR | 极小 |
| P2 | 8. runner.ts 抽终局诊断 + 产物差分 | STRUCT | 中 |
| P3 | 9. widgets pending 防御性清理 | INCR | 极小 |
| P3 | 10. 每轮双次工作区 walk 优化 | INCR | 中 |
| - | 刻意不做：snapshot caps env 化 | - | - |

---

## P0-1 锁 pi-coding-agent 版本（`~0.84.2`）

**目标**: 消除 RPC 协议层的静默漂移风险。`^` 允许 minor 升级（0.84.x → 0.85.x），CHANGELOG 显示 0.84.0 已改过 `message_update` schema，多租户最高风险面。

**涉及文件**
- `backend-ts/package.json:24`
- `backend-ts/package-lock.json`

**实施步骤**
1. `package.json:24` 改 `"@earendil-works/pi-coding-agent": "^0.84.2"` → `"~0.84.2"`（仅 patch 级）。
2. 在 `backend-ts` 下执行 `npm install` 更新锁文件（确认 lock 中版本仍为 0.84.x 且 `version` 无 minor 漂移）。
3. 若仓库后续引入 CI，在 workflow 加 `npm ci` 或 `npm ci --dry-run` 校验锁文件与 `~0.84.2` 一致。

**验证**
- `npm ls @earendil-works/pi-coding-agent` → 0.84.2
- `npx tsc --noEmit`（backend-ts）→ 0 error
- `npx vitest run tests/api/{pi-event-map,pi-rpc-registry,pi-agent-reuse,pi-agent-run}.test.ts` → 全过

**注意**
- 当前仓库**无项目级 CI**（`.github/workflows` 仅有上游源码快照里的），锁文件校验以手动为主，有 CI 时再补。
- 升级 pi-coding-agent 前先按 `dg-piagent` skill 流程核对 CHANGELOG（`node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md`）。

状态: [ ]

---

## P1-2 后端退出钩子回收 pi 子进程

**目标**: 后端进程死亡（崩溃/重启/部署/SIGTERM）时回收所有常驻 RPC 子进程，防孤儿进程永久驻留（pi CLI RPC 模式会一直等 stdin）。当前 `server.ts` 无任何退出清理钩子，registry 的 60s 空闲回收器随父进程一起消亡。

**涉及文件**
- `backend-ts/src/services/pi/registry.ts`（新增 `killAllPiProcesses`）
- `backend-ts/src/services/pi-agent-service.ts`（re-export，可选）
- `backend-ts/src/server.ts`（注册退出钩子）

**实施步骤**
1. `registry.ts` 新增：
   ```ts
   /** 终止并注销全部已注册 RPC 子进程（后端退出时统一回收，防孤儿进程）。 */
   export function killAllPiProcesses(): number {
     let killed = 0;
     for (const [key, entry] of [...piProcessRegistry]) {
       if (entry.ended || !entry.alive) continue;
       piProcessRegistry.delete(key);
       markKilled(entry);
       killed += 1;
     }
     return killed;
   }
   ```
   （`markKilled` 内部已调 `entry.kill()`，即 `killTree`，Windows taskkill /T /F 杀整树。）
2. `pi-agent-service.ts` re-export `killAllPiProcesses`。
3. `server.ts` 在启动块（`process.argv[1]` 分支）注册：
   ```ts
   const shutdown = () => {
     try { killAllPiProcesses(); } catch { /* 尽力而为 */ }
     process.exit(0);
   };
   process.once('SIGTERM', shutdown);
   process.once('SIGINT', shutdown);
   process.once('exit', () => { try { killAllPiProcesses(); } catch { /* 尽力而为 */ } });
   ```
   注意：`exit` 处理器里只能做同步 `spawn`（killTree 是同步 fire 的，OK）；若用 fastify `app.addHook('onClose', ...)` 则需异步包装。

**验证**
- `npx tsc --noEmit` → 0 error
- 手工 e2e：启动后端 → 触发一轮对话（或注入一条注册）→ `tasklist` 找到 pi 子进程 → 对后端发 `Ctrl+C` / `Stop-Process` → 确认 pi 进程消失
- 回归：`npx vitest run tests/api/{pi-rpc-registry,pi-agent-run}.test.ts` → 全过

**注意**
- `exit` 钩子内禁止异步；Windows 下 `taskkill` 是异步的子进程 fire-and-forget，够用。
- 不做 `waitForPiExit` 等待（退出路径不阻塞），残留句柄由 OS 回收。

状态: [x]

---

## P1-3 关键 PiJsonEvent 加 zod schema 校验

**目标**: 多租户外部进程边界（pi 子进程 stdout）上，把宽断言收窄为显式校验。当前 `runner.ts:114` `JSON.parse as PiJsonEvent` 与 `events.ts:40` `as { type?, delta? }` 都是宽断言；0.84.0 起 `message_update` 只发 deltas，跨小版本脆。

**涉及文件**
- `backend-ts/src/services/pi/schema.ts`（新建，zod schema）
- `backend-ts/src/services/pi/runner.ts`（`consumeLine` 校验入口）
- `backend-ts/src/services/pi/events.ts`（`mapPiJsonEvent` 内部收窄断言）

**实施步骤**
1. 新建 `pi/schema.ts`，只对**实际消费的事件类型**定义 schema：
   ```ts
   import { z } from 'zod';
   export const assistantMessageEventSchema = z.object({
     type: z.enum(['text_delta', 'thinking_delta']),
     delta: z.string(),
   }).partial().passthrough();  // 0.84.x 可能带更多字段，未知字段透传
   export const rpcEventSchema = z.discriminatedUnion('type', [
     z.object({ type: z.literal('response'), command: z.literal('prompt'), success: z.boolean(), error: z.unknown().optional() }),
     z.object({ type: z.literal('agent_settled') }),
     z.object({ type: z.literal('agent_start') }),
     z.object({ type: z.literal('message_update'), assistantMessageEvent: z.unknown().optional() }),
     z.object({ type: z.literal('tool_execution_start'), toolCallId: z.string().optional(), toolName: z.string().optional(), args: z.unknown().optional() }),
     z.object({ type: z.literal('tool_execution_end'), toolCallId: z.string().optional(), toolName: z.string().optional(), result: z.unknown().optional() }),
     z.object({ type: z.literal('compaction_start'), reason: z.string().optional() }),
     z.object({ type: z.literal('compaction_end'), aborted: z.boolean().optional(), errorMessage: z.string().optional() }),
     z.object({ type: z.literal('extension_ui_request'), method: z.string(), id: z.string().optional(), title: z.string().optional() }),
     z.object({ type: z.literal('message_end'), message: z.unknown().optional() }),
     z.object({ type: z.literal('auto_retry_start'), attempt: z.number().optional(), maxAttempts: z.number().optional(), delayMs: z.number().optional(), errorMessage: z.string().optional() }),
     z.object({ type: z.literal('auto_retry_end'), success: z.boolean().optional() }),
   ]);
   ```
   > 重要：schema 是**未知事件静默忽略**策略的载体——未知 `type` 直接不匹配（`mapPiJsonEvent` 的 default 分支兜底），不要用 `.catch` 吞掉已知类型的坏字段。
2. `runner.ts` `consumeLine` 中，`JSON.parse` 后先 `const parsed = rpcEventSchema.safeParse(evt)`；失败则 `return`（静默忽略，与现状一致）；成功则 `parsed.data` 传给 `mapPiJsonEvent`。
3. `events.ts` 的 `message_update` 分支改用 `assistantMessageEventSchema.safeParse`，替代手写 `as` 断言。

**验证**
- `npx tsc --noEmit` → 0 error
- `npx vitest run tests/api/pi-event-map.test.ts` → 全过（补一条「坏字段静默忽略」用例）
- 新增单测：`runner`/`schema` 对未知 type、坏 JSON、缺字段事件不抛错且不产出

**注意**
- zod 已在传递树中（确认过 `backend-ts/node_modules/zod` 存在）；若最终直接 import 到源码，建议补进 `package.json` dependencies（显式依赖，避免传递漂移）。
- schema 与 0.84.x 的 `message_update`（deltas-only）对齐；升级 pi-coding-agent 时**必须**先过 P0-1 的 CHANGELOG 流程再回归本 schema。

状态: [x]

---

## P1-4 RPC 不变量沉淀到 AGENTS.md（或 rpc-invariants.md）

**目标**: 把踩过的坑从「代码注释」升级为「可被新人/升级流程触达的文档」，升级 pi-coding-agent 时必须回看。

**涉及文件**
- `docs/skill-agent/rpc-invariants.md`（新建）或 `AGENTS.md` 的「已知约束」段

**实施步骤**
1. 新建 `docs/skill-agent/rpc-invariants.md`，收录（附源码锚点）：
   - **Windows 0xC0000409**：`runner.ts:341-343`——不用 `stdin.end()` 优雅退出，杀树更稳；`agent_settled` 即会话文件落盘的权威信号。
   - **auto-retry errorMessage 覆盖**：`events.ts:122-125`——恢复后的成功 `message_end` 必须覆盖此前失败 `errorMessage`，否则误报执行失败。
   - **registry 注销 identity 校验**：`registry.ts:131-136`——过期轮的 finally 清理不得误删新进程注册项。
   - **`message_update` deltas-only**（0.84.0）：只消费 `assistantMessageEvent.{type,delta}`，不依赖 cumulative `message`/`partial`。
   - **`agent_settled` 优先于 `agent_end`**：保证 retry/compaction/queue 处理完才触发。
2. 在 `AGENTS.md`（或 `docs/skill-agent/README.md`）加一条：升级 `pi-coding-agent` 前先过 `rpc-invariants.md` 核对协议假设。
3. 在既有注释处加一行 `// 见 docs/skill-agent/rpc-invariants.md` 交叉引用。

**验证**
- 文档评审；确认锚点行号与实际一致（升级后行号会漂移，文档用「函数名 + 行为」描述而非纯行号）。

**注意**
- 纯文档变更，零运行风险。优先保证锚点描述「行为」而非「行号」。

状态: [x]

---

## P2-5 上游源码 / 计划文档目录边界

**目标**: `docs/skill-agent/` 下 4 个上游仓库完整源码快照（pi-main / pi-web-main / pi-subagents-main / pi-web-access-main）与项目自有计划文档混排，新成员易误当项目代码。

**涉及文件**
- `docs/skill-agent/`（目录重组）
- `docs/skill-agent/README.md`（新建或补充边界声明）
- `AGENTS.md`（可选加一句）

**实施步骤**
1. 建子目录：`docs/skill-agent/_upstream/`（放 4 个 `*-main` 快照 + `rpiv-package` 若属参考）与 `docs/skill-agent/_plans/`（放项目自有计划 md）。
2. `git mv` 移动后全局搜索对这些路径的引用（文档/脚本），逐一更新。
3. 新建 `docs/skill-agent/README.md`，写明：上游参考代码**不参与本项目构建/部署**，本项目集成实现在 `backend-ts/src/services/pi/`；skill 相关文档见 `_plans/`。

**验证**
- `git status` 确认移动干净、无遗漏引用（`rg "skill-agent/pi-main|skill-agent/pi-web"` 全仓）。

**注意**
- 纯文档/目录变更；移动前先确认无脚本硬编码这些路径。

状态: [ ]

---

## P2-6 events.ts 拆分错误文案模块

**目标**: `events.ts` 三职责合一（协议映射 / lastError 状态 / 错误短语表），把与 RPC 协议无关的字符串表拆出。

**涉及文件**
- `backend-ts/src/services/pi/errors.ts`（新建）
- `backend-ts/src/services/pi/events.ts`（移除错误文案）
- `backend-ts/src/services/pi/runner.ts`（import 调整）

**实施步骤**
1. `errors.ts` 迁入 `friendlyProviderError`、`formatPiFailure`（含 `COMPACTION_REASON_TEXT` 视需要一并迁走）。
2. `events.ts` 仅保留 `mapPiJsonEvent` 与 `PiEventMapperState`/`PiJsonEvent` 类型。
3. `runner.ts` 改从 `./errors.js` import `formatPiFailure`；检查其它消费方（grep `friendlyProviderError|formatPiFailure`）。
4. 若外部测试直接 import `formatPiFailure` 自 `events.js`，更新测试 import 路径（或 `events.ts` 加一行 re-export 兼容）。

**验证**
- `npx tsc --noEmit` → 0 error
- `npx vitest run tests/api/pi-event-map.test.ts` → 全过

**注意**
- 小重构，保持行为完全一致；错误文案字符串原样迁移。

状态: [x]

---

## P2-7 cleanup.ts 归属防御改为精确匹配

**目标**: `subagents/cleanup.ts:49` 的 `base.includes(...)` 真子串匹配语义不准（`userId` 恒在 basename，闸几乎永不触发）。改为精确匹配，语义清晰且更保守。

**涉及文件**
- `backend-ts/src/services/pi/subagents/cleanup.ts:49`

**实施步骤**
1. 把 `resolveSubagentsTempRoot` 的派生逻辑抽为单点（已有行 18-21），在 `cleanupSubagentAsyncRuns` 中改守卫为：
   ```ts
   const expected = `pi-subagents-${userId}-${String(workspaceId).replace(/[^A-Za-z0-9._-]+/g, '-') || 'ws'}`;
   if (base !== expected) return 0; // 归属不可证明 → 不动（保守）
   ```
   （或直接复用 `path.basename(resolveSubagentsTempRoot(...))` 与 `base` 全等比较。）

**验证**
- `npx tsc --noEmit` → 0 error
- `npx vitest run tests/api/pi-agent-workspace.test.ts` → 全过
- 补一条「非本工作区 basename 不删除」用例（若该套件已有覆盖则跳过）

**注意**
- 行为变化仅在「守卫触发」的边界上；正常路径（userId/workspaceId 均在）行为不变。

状态: [x]

---

## P2-8 runner.ts 抽终局诊断 + 产物差分

**目标**: 缓解 `runner.ts` 543 行单文件过载（六职责）。优先抽「错误终局诊断」与「产物差分」，二者与 RPC 编排正交，snapshot 模块已存在。

**涉及文件**
- `backend-ts/src/services/pi/runner.ts`
- `backend-ts/src/services/pi/errors.ts`（承接诊断文案，见 P2-6）
- `backend-ts/src/services/pi/snapshot.ts`（产物差分辅助，可选）

**实施步骤**
1. 抽出「终局诊断」为纯函数：输入 `{ settled, aborted, timedOut, emittedError, promptAccepted, sawAnyEvent, exitCode, lastError, stderrTail }` → 输出 `ChatStreamEvent | null`（错误/状态事件）。`streamRound` 只负责调用并 yield。
2. 抽出「产物差分」：`diffWorkspace(before, after, ws, workspaceId)` → `{ artifacts, events }`，复用现有 `isDiffExcluded`/`snapshotWorkspace`/`appendArtifactManifest`。
3. `streamRound` 保留：出队循环、续轮监听、超时/abort、进程生命周期。

**验证**
- `npx tsc --noEmit` → 0 error
- `npx vitest run tests/api/{pi-agent-run,pi-agent-reuse,pi-sse-wire}.test.ts` → 全过

**注意**
- 属结构性重构，风险中；建议分两小步（先抽诊断、再抽差分），每步回归一次。不要顺手改其它逻辑。

状态: [x]

---

## P3-9 widgets `pending` 防御性清理（可选）

**目标**: `pi-widgets.ts:284` 的 `pending` Map 仅在 `tool_result` 匹配时 delete；虽为单轮作用域（轮末 GC，非真实泄漏），加一行防御更稳。

**涉及文件**
- `backend-ts/src/services/pi-widgets.ts`（`withWidgetBridge` 的 `finally`）

**实施步骤**
1. 在既有 `finally`（store.commit 处）加 `pending.clear();`（可选再加 `if (pending.size > 64) pending.clear()` 兜底）。

**验证**
- `npx vitest run tests/api/pi-widgets.test.ts` → 全过

**注意**
- 纯防御，收益有限；若时间紧可跳过。

状态: [x]

---

## P3-10 每轮双次工作区 walk 优化（可选）

**目标**: `streamRound` 首尾各调一次 `snapshotWorkspace` 全量递归 stat（`runner.ts:299,482`），大工作区 O(N)×2。合并为单次遍历同时产 before/after 差异。

**涉及文件**
- `backend-ts/src/services/pi/snapshot.ts`
- `backend-ts/src/services/pi/runner.ts`

**实施步骤**
1. 评估是否真有性能问题（当前每轮有界，多数场景可接受）。若做：`snapshotWorkspace` 改为一次遍历返回 `{ before, after }` 或在首轮先浅层/按需采集。
2. 回归产物差分行为（`pi-agent-run.test.ts` / 手工验证 agent_file 卡片）。

**验证**
- 行为回归：差分产物列表与改造前一致。

**注意**
- 价值中等，改动面中；建议在有真实大工作区性能数据后再实施，否则跳过。

状态: [ ]

---

## 刻意不做

- **`subagents/snapshot.ts:19-22` 硬编码 cap env 化**：这些是**防 DoS 的输出投影上限**（防损坏/恶意快照打爆内存或 SSE），不是运行时调优参数。env 化只会增加配置面。保持硬编码，注释注明「与扩展快照 caps 同量级」即可。
- **`workspace.ts` API Key 落盘移除**：pi 子进程需要从 `models.json`/`settings.json`/`web-search.json` 读 key，改 env 注入属上游能力变更、成本高。当前多租户 agentDir 隔离已挡跨租户读；**仅需在 AGENTS.md 声明「该目录含凭据，备份/导出/调试抓取需脱敏」**。

---

## 实施顺序建议

1. 先做 P0-1（锁版本）——影响所有后续回归基线。
2. P1-2（退出钩子）风险最低、收益直接。
3. P1-3（zod）+ P1-4（不变量文档）一起做，升级时互为护栏。
4. P2 按人力排期；P3 视时间。
5. 每完成一项更新本文件的「状态: [ ]」为 `[x]`，并在 git commit message 标注对应编号（如 `P1-2: ...`）。

## 回归命令（每项必跑）

```bash
cd backend-ts
npx tsc --noEmit
npx vitest run tests/api/{pi-event-map,pi-rpc-registry,pi-agent-workspace,pi-agent-reuse,pi-agent-run,pi-sse-wire,pi-widgets,pi-session-hydrate,pi-web-access,pi-questionnaire-parser}.test.ts
```
