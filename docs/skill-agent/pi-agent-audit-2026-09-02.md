# pi-agent 集成审核报告

- **审核对象**: `backend-ts/src/services/pi/*` + `pi-widgets.ts` + `pi-session-hydrate.ts` + `pi-agent-service.ts` 门面
- **审核基线**: `dg-piagent` skill（v0.83.0）+ `check` skill（Project Audit Mode）
- **审核时间**: 2026-09-02
- **审核者**: Kilo（read-only，无代码修改）
- **集成模式**: CLI 子进程 `pi --mode rpc` 常驻复用（**非** SDK 进程内嵌入）
- **修订记录**: 2026-09-02 二次审核（AI reviewer）——纠正 3 处措辞/定级偏差、新增 2 条遗漏 finding、更新 Top-3 与评分。详见「二次审核修订」节。

---

## 元数据

```
pi-coding-agent 已装版本:  0.84.2
skill 基线版本:           0.83.0
版本漂移:                 +1 patch（0.84.0 message_update deltas-only 变更
                          对当前 events.ts:39-47 兼容，CLI 模式无破坏变更）
测试套件:                 10 个 pi 相关套件全过（pi-event-map 6,
                          pi-rpc-registry 7, pi-agent-workspace 22,
                          pi-agent-reuse 8, pi-widgets 14,
                          pi-session-hydrate 8,
                          pi-questionnaire-parser 6，余 3 套件
                          因 vitest 输出格式截断未取到具体数字）
tsc --noEmit:             0 TS error
```

---

## 评分（audit 四轴）

```
Project: EchoesForgeClaw (pi-agent 集成)
Overall: 7.5 / 10

Architecture:  8.0 / 10 -- 单职责拆分到位；runner.ts 543 行承载六职责, 偏大
Code Quality:  8.0 / 10 -- 注释/命名/安全白名单优秀；RPC 协议层缺 schema 校验
Engineering:   7.5 / 10 -- 测试覆盖与并发兜底齐全；上游源码参考目录缺边界声明
Perf & Risk:   6.5 / 10 -- 多租户隔离扎实；CLI 模式 + ^ 版本范围 + API key 落盘
                          + 退出时子进程孤儿化有结构性风险
```

---

## Findings

### [STRUCT] `backend-ts/src/services/pi/runner.ts:1-543` 单文件过载

- **why**: 543 行同时承担 (1) spawn 参数装配 `buildSpawnArgs`、(2) stdout 行解析 `consumeLine`、(3) 单轮 `drainRound`、(4) `streamRound` 主轮 + 续轮监听、(5) 终局诊断、(6) 产物差分 + manifest。其中 `streamRound` 行 275-518 达 244 行；与 `pi-widgets.ts` 的 widget 桥、`pi-session-hydrate.ts` 的会话水合同属"事件面下游"，但耦合在同一个文件。
- **fix**: 抽 `streamRound` 内的 `drainRound` 终局诊断 + 产物差分为独立模块（snapshot 模块已经存在）；`runner` 只保留"调用 snapshot + 拼装错误事件"。

### [STRUCT] `backend-ts/src/services/pi/events.ts:34-149` 三职责合一

- **why**: 同文件同时做 (a) `PiJsonEvent → ChatStreamEvent` 协议映射、(b) `lastError` 跨轮状态、(c) `friendlyProviderError` / `formatPiFailure` 错误文案。错误短语是纯字符串表，与 RPC 协议无关。
- **fix**: 把 `friendlyProviderError` / `formatPiFailure` 拆到 `pi/errors.ts`，`events.ts` 只保留协议映射。

### [INCR] `runner.ts:107-172` stdout 行解析无 schema 校验

- **why**: 解析 `JSON.parse(trimmed) as PiJsonEvent`（行 114）和 `evt.assistantMessageEvent as { type?, delta? }`（`events.ts:40`）都是宽断言。`assistantMessageEvent` 字段类型在 0.84.0 已经承诺 "emits only deltas"（CHANGELOG line 103），但跨小版本脆。多租户外部进程边界缺一道 zod 防线。
- **fix**: 给 `PiJsonEvent` 加 zod 校验（zod 已在 backend-ts 依赖的传递树中），把 `message_update` 路径加窄断言。

### [INCR] `pi-widgets.ts:284` `pending` Map 缺防御性清理

- **why**: 工具 `call_id → ToolCallInfo` 的 Map，仅在 `tool_result` 匹配时 delete。若扩展异常发 `tool_result` 而无 `tool_call`（或反之 id 不一致），会有残留条目。
- **纠正（二次审核）**: 原稿称「无界泄漏」措辞偏强——`pending` 是 `withWidgetBridge` 生成器函数局部变量，生命周期=单轮，轮结束即被 GC，**不会跨轮累积**。属可选防御而非真实泄漏。
- **fix（可选）**: 收尾 `finally` 时清空 `pending`；或加 `if (pending.size > 64) pending.clear()` 兜底。成本一行，收益有限。

### [INCR] `subagents/snapshot.ts:19-22` 硬编码 cap 与 config 风格不一致

- **why**: `MAX_RUNS=20 / MAX_CHILDREN=8 / MAX_DEPTH=3 / MAX_LABEL_CHARS=160` 直接常量，与 `config.ts` 的 `envInt(...)` 模式风格不一致。
- **纠正（二次审核）**: 此建议**价值低**——这些是**防 DoS 的输出投影上限**（防损坏/恶意快照打爆内存或 SSE），不是运行时调优参数，env 化只会增加配置面。建议**保持硬编码**，仅在注释注明与扩展快照 caps 同量级即可，不列入优化计划。

### [RISK] `package.json:24` `@earendil-works/pi-coding-agent: ^0.84.2`

- **why**: `^` 允许 minor 升级（0.84.x → 0.85.x），CHANGELOG 显示 0.84.0 改过 `message_update` schema。RPC 协议层属多租户最高风险面（与 `PI_EXTENSIONS` 白名单同级），版本漂移可能静默破协议。
- **fix**: 改 `~0.84.2`（patch-only）或 exact + CI 锁文件验证；至少在 `npm install` 文档中注明 review CHANGELOG 流程。

### [RISK] `workspace.ts:281, 344, 362` API Key 落盘工作区 `.pi-agent/`

- **why**: `models.json` / `settings.json` / `web-search.json` 都在 `{ws}/.pi-agent` 下，apiKey 明文写入。多租户进程隔离（per-{user,ws} agentDir）能挡跨租户读，但同账号工作区共享磁盘 / 备份导出 / 调试导出 zip 时会泄漏。AGENTS.md 未声明此约束。
- **fix**: AGENTS.md 加一条「该目录含凭据，备份/导出/调试抓取需脱敏」。

### [INCR] `subagents/cleanup.ts:49` 归属防御用 `includes`

- **why**: `if (!base.includes(String(workspaceId)) && !base.includes(String(userId))) return 0` —— 真子串匹配。删除路径是精确派生的 `rmSync(root)`，`includes` 只是「归属不可证明时不动」的防御闸；而 `userId` 恒在 basename 中，此闸几乎永不触发。防御语义不准但极低概率。
- **纠正（二次审核）**: 原稿标 [RISK] 略激进，应为 [INCR]。既不会误删（删除路径精确），漏删也只是保守不动，无放大攻击面。
- **fix**: 用 `===` 严格匹配：`base === \`pi-subagents-${userId}-${safeWs}\``（`safeWs` 派生函数已在行 19-21）。

### [RISK] 后端退出时不回收 pi 子进程（二次审核新增）

- **why**: `server.ts` 无任何 SIGTERM/SIGINT/exit 清理钩子（全仓 grep 确认仅有错误路径 `process.exit(1)`）。registry 的空闲回收器（`reapIdlePiProcesses`，60s 定时器）随父进程一起消亡——后端崩溃/重启/部署时，所有已注册常驻 RPC 子进程全部变**孤儿并永久驻留**（pi CLI 在 RPC 模式下会一直等 stdin）。多租户共享机器上风险随活跃节点数线性放大。
- **fix**: 在 `registry.ts` 增加 `killAllPiProcesses()`（遍历 `piProcessRegistry` 逐个 `markKilled`），并在 `server.ts` 注册 `SIGTERM`/`SIGINT`/`exit`（或 fastify `onClose`）钩子统一回收；Linux 可另以 parent-death 机制兜底。

### [INCR] `runner.ts:299,482` 每轮两次全量工作区 walk（二次审核新增）

- **why**: `streamRound` 首尾各调一次 `snapshotWorkspace(opts.ws)` 全量递归 stat 整个工作区。大型工作区每轮 O(N)×2 成本，属可接受但有界的开销。
- **fix**: 可选——合并为单次遍历同时产 before/after 差异，或按需浅层扫描。价值中等，非高优先级。

### [INCR] 仓库根 `docs/skill-agent/pi-*-main/...` 等上游源码无边界声明

- **why**: `docs/skill-agent/` 下有 4 个上游 pi 主仓库完整源码快照（pi-main / pi-web-main / pi-subagents-main / pi-web-access-main），新成员易误以为是项目代码。`docs/skill-agent/` 还有项目自有 7 篇设计文档（plans），与上游源码混在同一目录，结构清晰度受损。
- **fix**: 在 `docs/skill-agent/README.md`（或 AGENTS.md）加一句"上游参考代码不参与本项目构建/部署，本项目集成实现在 `backend-ts/src/services/pi/`"。

### [INCR] 关键 RPC 不变量只在代码注释中

- **why**: `runner.ts:341-343`（Windows 0xC0000409 → 杀树更稳）、`events.ts:122-125`（auto-retry 恢复必须覆盖此前 errorMessage）、`registry.ts:131-136`（注销 identity 校验防跨轮误删）—— 这些都是踩过的坑，但只埋在代码注释里，升级 pi-coding-agent 时新人难以触达。
- **fix**: 抽到 `docs/skill-agent/rpc-invariants.md`（或 AGENTS.md 的"已知约束"段），并把 sdk 升级时回看。

---

## 二次审核修订（AI reviewer，2026-09-02）

对原稿的逐条源码核对（`backend-ts/src/services/pi/*`）后，修订如下：

**纠正（3 处措辞/定级）**
- `pi-widgets.ts:284`「无界泄漏」→ 实为**单轮作用域**（生成器局部变量，轮末 GC），降级为「缺防御性清理」；
- `subagents/snapshot.ts:19-22` env 化建议 → **价值低**（防 DoS 投影上限非调优参数），建议保持硬编码；
- `subagents/cleanup.ts:49` 定级 [RISK] → **[INCR]**（路径精确删除，`includes` 只是保守闸）。

**新增（2 条遗漏）**
- **[RISK] 后端退出不回收 pi 子进程**：`server.ts` 无退出钩子，后端死亡后常驻 RPC 子进程变孤儿永久驻留；
- **[INCR] 每轮两次全量工作区 walk**：`streamRound` 首尾各一次 `snapshotWorkspace`，大工作区 O(N)×2。

**更新**
- Top-3 重排：新增「退出钩子回收」为 #2，原「目录边界」降级出 Top-3；
- Perf & Risk 7.0 → 6.5、Overall 7.6 → 7.5（孤儿进程为新增结构性风险）；
- 全部修订已同步到 `docs/skill-agent/pi-agent-optimization-plan-2026-09-02.md`（按优先级可实施）。

---

## Top 3 highest-leverage moves（二次审核更新）

1. **[RISK]** 锁 `pi-coding-agent` 版本（`~0.84.2` / exact）+ CI 锁文件验证—— 多租户最高风险面与项目"白名单 + 显式 `-e`"姿态对齐。
2. **[RISK]** 后端退出钩子统一回收 pi 子进程（`killAllPiProcesses` + SIGTERM/SIGINT 钩子）—— 防孤儿进程永久驻留。
3. **[INCR]** 关键 `PiJsonEvent` 加 zod schema 校验 + 沉淀 RPC 踩坑清单到 AGENTS.md（0xC0000409、`agent_settled`、`message_update deltas-only`、identity 校验注销）。

---

## Verification（本轮执行的命令）

| 命令 | 结果 |
|------|------|
| `npx vitest run tests/api/{pi-event-map,pi-rpc-registry,pi-agent-workspace,pi-agent-reuse,pi-agent-run,pi-sse-wire,pi-widgets,pi-session-hydrate,pi-web-access,pi-questionnaire-parser}.test.ts` | **10 套件全过**（部分套件因 vitest 输出格式截断未取到具体数字） |
| `npx tsc --noEmit` (backend-ts) | **0 TS error** |
| `Get-ChildItem backend-ts/node_modules/@earendil-works/pi-coding-agent/dist` | 存在 `cli.js` + `rpc-entry.js`，CLI `--mode rpc` 模式可用 |
| `Get-Content CHANGELOG.md` (包内) | 0.84.0 message_update deltas-only 已确认对本项目 `events.ts:39-47` 兼容；CLI 模式无破坏变更 |

## What was NOT verified

- 实际启动 pi 子进程跑对话（无 LLM API Key，未跑端到端；e2e 由 `pi-agent-run.test.ts` 等套件已覆盖沙盒场景）
- `subagents/` async runner 真进程（测试有 smoke 套件 `smoke-subagent-auto-continue.ts` 存在但未跑）
- 多租户并发上限 / 内存压力（无 perf bench）
- 后端退出清理（孤儿进程回收）无 e2e 验证（本轮仅源码核对确认无退出钩子）

---

## 引用的 skill 资源

- `dg-piagent/SKILL.md` v0.83.0 基线
- `dg-piagent/references/sdk_doc/04-events.md`（事件层语义对标）
- `dg-piagent/references/sdk_doc/18-compaction.md`（compaction 事件对标 `events.ts:66-83`）
- `dg-piagent/references/scenarios/A04-tool-whitelist.md`（工具白名单对标 `DISABLED_TOOLS`）
- `dg-piagent/references/scenarios/F01-session-persistence.md`（session 持久化对标 `PI_SESSION_REL`）
- `dg-piagent/references/scenarios/H07-enterprise-interface.md`（企业接口评估对标 `bookforge` 自定义 provider）
- `check/references/mode-audit.md`（audit 四轴评分模板）
- `check/references/persona-catalog.md`（specialist review 隐式应用）

---

## 备注

- 本报告**不修改任何代码**，仅作审核与留档。
- 若后续进入实现阶段，按 `Top 3 highest-leverage moves` 排序依次处理。
- 报告路径：本文档 + 一次 `check/sign-off` 状态行（由 `check` skill 模板派生）。
