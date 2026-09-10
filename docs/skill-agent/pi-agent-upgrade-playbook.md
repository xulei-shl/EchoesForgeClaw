# pi Agent 及扩展包升级手册（Upgrade Playbook）

> 面向：执行 `@earendil-works/pi-coding-agent` 或其扩展包升级的工程师。
> 首次成文：2026-09-10，基于 **0.84.2 → 0.85.1** 实际升级全过程沉淀。
> 配套文档：协议不变量 `docs/skill-agent/rpc-invariants.md`（升级前必读）；
> 扩展接入 `docs/skill-agent/pi-extension-integration.md`；context-mode 专项 `docs/skill-agent/pi-context-mode-integration-plan.md`。

---

## 0. 当前基线（随每次升级更新本表）

| 组件 | 当前版本 | package.json | 锁定方式 | 风险面 |
|---|---|---|---|---|
| `@earendil-works/pi-coding-agent` | **0.85.1** | `^0.85.1` | lockfile（`^` 仍允许 minor 漂移） | RPC 事件协议、进程生命周期 |
| `context-mode` | **1.0.169** | `1.0.169`（exact） | exact + **patch-package 源码补丁**（`backend-ts/patches/`） | 补丁只对 exact 版本生效 |
| `@aliou/pi-guardrails` | **0.17.1** | `^0.17.1` | 白名单 + 回归 | 文件保护/越界路径/危险命令拦截 |
| `@amaster.ai/pi-image-gen` | **0.1.9** | `^0.1.9` | 白名单 + 回归 | 绘图扩展（Windows shutdown 竞态相关方） |
| `@aliou/pi-utils-settings`（guardrails 依赖） | 0.19.2 | 传递依赖 | 随 guardrails | ConfigLoader 读 `{ws}/.pi-agent/extensions/guardrails.json` |
| vendored 参照源码 `docs/skill-agent/pi-main/` | 0.84.x | 无（快照） | 无 | **仅历史对照**，与安装版本已不一致 |

> 升级后**第一步**就是更新本表，再更新 `rpc-invariants.md` 的「代码基线」行。

---

## 1. 为什么锁版本（安全模型，理解后再动手）

pi agent 在 BookForge 里不是普通依赖，而是**多租户服务端子进程**：

1. **RPC 事件协议是隐性契约**。后端消费 `pi --mode rpc` 的 stdout JSON 事件，schema 策略是
   「未知事件静默忽略」——**协议漂移不会报错，只会静默丢流**（空白回复、挂起、误报失败）。
   这类故障最难排查，是锁版本的首要原因。
2. **context-mode 带源码补丁**。`patches/context-mode+1.0.169.patch` 只对 exact 版本生效，
   升级 = 补丁失效（postinstall 报错，或补丁静默不匹配）。
3. **扩展 = 服务端任意代码执行**。`PI_EXTENSIONS` 白名单内的包以本服务同等权限运行，
   不可信的自动升级 = 未审查的代码自动上生产。
4. **锁版本是补偿性控制**：当前对 RPC 边界缺少可执行契约测试，版本锁定替代了测试覆盖。

**结论**：升级不是「能不能」的问题，而是「按流程」的问题——固定版本 + CHANGELOG 核对 + 全量回归。

---

## 2. 升级前准备

```bash
# 1. 确认工作区干净（package.json / lockfile / src / tests 不含未提交改动）
git status --porcelain -- backend-ts/package.json backend-ts/package-lock.json backend-ts/patches backend-ts/src backend-ts/tests

# 2. 记录当前版本
npm ls @earendil-works/pi-coding-agent --prefix backend-ts
```

- **基线回归先行**：升级前跑一次全量回归（见 §5），确认「绿基线」。
  已知 `pi-agent-reuse.test.ts` 有时序敏感用例（见 §7），基线里若它失败，先重跑确认，别把已有问题算到升级头上。
- **查上游最新版**：`npm view @earendil-works/pi-coding-agent version dist-tags --registry=https://registry.npmjs.org`
- 若工作区不干净：先与用户/负责人确认，不要在他人改动上执行升级。

## 3. CHANGELOG 核对（协议风险面，核心步骤）

读 `node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md`（或从 npm tarball 解包），
逐条比对以下**不变量清单**（详见 `rpc-invariants.md`，此处为速查表）：

| # | 不变量 | 0.85.1 状态（2026-09-10 核对） |
|---|---|---|
| 1 | 杀树收尾（Windows 0xC0000409 竞态），不用 `stdin.end()` 优雅退出 | 无 shutdown 语义变化，成立 |
| 2 | 每条 `message_end` 覆盖 `lastError`（auto-retry 成功必须洗掉旧错误） | 无 retry/message_end 载荷变化，成立 |
| 3 | 进程注册表注销 identity 校验 | 后端侧逻辑，与版本无关，成立 |
| 4 | `message_update` 只发 deltas（0.84.0 起） | 0.84.3–0.85.1 无变化，成立；新增事件（`ui_prompt_start/end`、RPC `clear_queue`）为增量，被「未知事件静默忽略」策略覆盖 |
| 5 | `agent_settled` 是轮终局唯一锚点 | 无改名/竞争终局事件，成立 |

**分类决策**：
- 涉及上表任一不变量的变更 → 停下，先评估后端适配（`schema.ts` / `events.ts` / `runner.ts`）再升级；
- 仅 additive 事件（新增 type）→ 直接升级，schema 的 discriminatedUnion + passthrough 天然兼容；
- Breaking Changes 段中的 SDK 类型重命名（如 0.84.3 `GoogleThinkingLevel` → `GoogleApiThinkingLevel`）
  → 检查 `backend-ts/src` 是否 import 该类型（通常没有，我们只走 RPC 子进程，不用 SDK 进程内嵌入）；
- 顺带关注**利好**：0.85.0 起 built-in 工具遵守 `ctx.cwd`（利于工作区隔离）；0.84.2/0.85.1 各含安全依赖修复。

## 4. 扩展包兼容性核对（升级 pi 主包时必做）

| 扩展包 | 核对什么 | 0.85.1 实测（2026-09-10） |
|---|---|---|
| 全部 | `npm ls` 后是否 **dedupe 到与主包同一份实例**（扩展与 runner 必须同实例，否则 extension API 类型/单例状态分裂） | ✅ `pi-guardrails` / `pi-image-gen` 均 dedupe 到 0.85.1 |
| 全部 | peerDependencies 是否收敛（`*` = 无压力；具体版本范围则需满足） | ✅ 两者 peer 均为 `*` |
| `context-mode` 1.0.169 | 适配器注册的事件在 pi 中是否存在（§ 见 pi-context-mode-integration-plan.md §4） | ✅ `before_provider_response` 在 0.85.1 仍不存在 → 死注册依旧无害（`grep -rl before_provider_response node_modules/.../dist/` 为空） |
| `pi-guardrails` 0.17.1 | ConfigLoader 读 `{ws}/.pi-agent/extensions/guardrails.json` 的路径口径是否随 `getAgentDir()` 变化 | ✅ 自动装配机制未受影响（guardrails-run 测试通过） |
| `pi-image-gen` | Windows shutdown 竞态（rpc-invariants §1）是否恶化 | ✅ 无相关变更 |

**context-mode 专项**：只做 patch 级升级且**必须重做补丁**：
```bash
# 升级后补丁必然失配时：
rm backend-ts/patches/context-mode+<old>.patch
# 修改源码重打：
npx patch-package context-mode   # 在 backend-ts 下执行，生成新版本补丁
```
补丁内容涉及 EOF 转发（修复 init 阶段 CPU core 被钉死问题），不能丢。

## 5. 升级执行与回归

```bash
cd backend-ts
npm install @earendil-works/pi-coding-agent@^<new-version>
node -e "console.log(require('./node_modules/@earendil-works/pi-coding-agent/package.json').version)"

# 回归（顺序执行；全绿才算过）
npx tsc --noEmit
npx vitest run tests/api/          # 25 套件 / 266 用例（2026-09-10 口径）
```

**判定标准**：
- `tsc` 0 error + 全部用例通过 → 通过；
- 仅 `pi-agent-reuse.test.ts` 的「手动暂停」用例间歇失败 → 见 §7 判定流程，单独重跑确认后再下结论；
- 出现其它失败 → 逐条对 §3 不变量表定位；定位不了 → 回滚（§6）。

**通过后的收尾**（与升级本身同等重要）：
1. 更新本手册 §0 基线表与升级日期；
2. 更新 `rpc-invariants.md` 「代码基线」行（并把本次 CHANGELOG 核对结论补进 §3 速查表）;
3. 更新 `pi-context-mode-integration-plan.md` 的状态更新行（如涉及）；
4. `docs/skill-agent/pi-main/`（vendored 快照）**不同步更新**——它是历史参照，
   但要在 `rpc-invariants.md` 基线行注明「快照版本 ≠ 安装版本」。

## 6. 回滚

```bash
cd backend-ts
npm install @earendil-works/pi-coding-agent@^0.85.1   # 换回原版本号
npx vitest run tests/api/                              # 确认回到绿基线
```

- 只回滚包版本，**不要**动 `schema.ts` / `events.ts` / `runner.ts`（除非本次升级改过它们——回滚连带还原）。
- context-mode 升级失败时，回滚包版本后确认 `patches/` 中旧补丁文件还在。

## 7. 已知坑与测试敏感点（升级排查先看这里）

1. **`pi-agent-reuse.test.ts`「手动暂停」用例时序敏感（非协议回归）**。
   - 症状：断言 `mock.userCounts` 期望 `[1, 2]` 实得 `[1, 1]`——第 2 轮上下文缺少第 1 轮。
   - 根因：pi `SessionManager._persist` 的 **no-assistant guard**：新会话的 user entry 在首条
     assistant entry 落盘前只存内存；abort 杀进程若发生在首次持久化前，第 1 轮 user entry 丢失。
   - **已验证**：0.84.2 与 0.85.1 的 `_persist` 逐字节一致，两版均可复现 → 判定「非升级回归」的依据。
   - 处置：单独重跑该用例；若隔离跑通过而全量跑偶发失败，记录 flake 即可，不要为此回滚升级。
   - 彻底修复方向（测试侧）：abort 前等待 assistant entry 落盘。
2. **「未知事件静默忽略」是双刃剑**：兼容性最好，但协议漂移也静默。升级后建议对一轮真实
   对话做一次 SSE 冒烟（`content_delta` 非空、无 error chunk）。
3. **注册表复合 key = `${userId}:${workspaceId}`**（与 nodeWorkspace 同口径）。升级不得改变
   注销/顶替的 identity 语义，否则 ui-response 对新轮 404。
4. **不要改回 `stdin.end()` 优雅退出**（rpc-invariants §1 明文规定），即使上游声称修复了竞态——
   杀树语义已与进程复用/LRU/空闲回收整体耦合。

## 8. 「如果放开升级会怎样」（设计上下文）

- 放开 `^`/`latest` 漂移的后果：RPC 事件契约漂移→静默丢流；`agent_settled` 若改名→10 分钟挂死
  （`PI_RPC_TIMEOUT_MS` 兜底）；retry 语义变化→前端整轮回滚；context-mode 补丁失效→postinstall 失败；
  扩展自动升级=未审查代码上生产。
- 补偿性控制的演进方向（按性价比排序）：
  1. 把 `rpc-invariants.md` 五条不变量做成**可执行的金样本（golden events）测试**，漂移在 CI 响亮失败；
  2. RPC 握手期校验子进程版本号，异常时拒绝启动并打日志；
  3. context-mode 补丁生命周期纳入升级步骤（§4）；
  4. 扩展包逐包分阶段升级（先白名单灰度一个工作区）。
- 当前实践：**保持锁定 + 按本手册流程升级**，是最小成本可验证的方案。

---

## 附：本次 0.84.2 → 0.85.1 实测记录

- 日期：2026-09-10。上游 0.84.2 → 0.85.1（0.84.3 / 0.84.4 / 0.85.0 / 0.85.1 四个版本）。
- CHANGELOG 核对：§3 速查表五项全部成立；范围内唯一 breaking（`GoogleThinkingLevel` 重命名）未被我们 import。
- 扩展核对：dedupe 单实例 ✅；peer `*` ✅；context-mode 死注册依旧无害 ✅；guardrails 自动装配不受影响 ✅。
- 回归：`tsc --noEmit` 0 error；`tests/api/` 25 套件 266 用例全绿
  （过程中 `pi-agent-reuse` 一次间歇失败，§7-1 判定为非回归：0.84.2 上同样复现）。
- 未验证：真实 provider 端到端（前端全链路）、Windows 平台行为（本机 Linux）。
