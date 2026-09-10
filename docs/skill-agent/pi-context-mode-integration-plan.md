# pi Agent 接入 context-mode 扩展：可行性评估与接入方案

> 面向：给 Skill Agent（pi）节点评估/新增 context-mode 扩展的工程师与决策者。
> 核心诉求：**自动执行——无需用户手动触发**，随每个对话会话自动生效。
> 关联实现 / 文档：
> - 扩展装配与 RPC 运行：`backend-ts/src/services/pi/`（`resolve.ts` / `workspace.ts` / `runner.ts` / `registry.ts`）
>
> **状态更新（2026-09-10）**：已随 `pi-coding-agent@0.85.1` 升级完成全量回归；§4/§5 所列漂移点在 0.85.1
> 上未变化（`before_provider_response` 仍不存在，死注册依旧无害）。核对过程见
> `docs/skill-agent/pi-agent-upgrade-playbook.md`。
> - 既有扩展接入规范：`docs/skill-agent/pi-extension-integration.md`
> - RPC 升级不变量：`docs/skill-agent/rpc-invariants.md`
> - context-mode 源码基线（本仓库 vendored）：`docs/skill-agent/context-mode-main/`（npm v1.0.169）
> - pi-coding-agent 源码基线（本仓库 vendored，与安装版本一致）：`docs/skill-agent/pi-main/`

**验证基线**：`@earendil-works/pi-coding-agent` **0.84.2**（`backend-ts/node_modules` 安装版本 = `docs/skill-agent/pi-main` 源码版本）；context-mode **1.0.169**。下文所有「已核对」结论均基于这两份源码。

---

## 实施状态（2026-09-05，L0+L1 决策已执行）

- ✅ **已完成（配置段）**：
  - `context-mode@1.0.169` 以 `--save-exact` 装入 backend-ts 依赖树（候选①），npm 自动去重 `better-sqlite3`（根 12.11.1，Node 24 下原生绑定加载验证通过）；
  - `backend-ts/.env` 与 `.env.example` 的 `PI_EXTENSIONS` 追加 `context-mode`（保留既有 4 个扩展）；
  - 扩展入口 `build/adapters/pi/extension.js` 在 backend-ts 解析链下 import 通过（等同软链挂载后的 jiti 解析路径）；
  - `resolvePiExtensions()` 实测命中候选①（`backend-ts/node_modules/context-mode`），挂载目录名 `context-mode`；
  - 后端 `npm run typecheck` 通过。
- ✅ **已完成（运行与冒烟）**：按 `docs/windows_deploy.md` 重启后端（tsx watch 不因子进程退出而重启，已杀整树后以 detached `npm run dev` 拉起，健康检查通过）；新增 RPC e2e `backend-ts/tests/api/pi-context-mode.test.ts` 全绿——验证扩展自动装配、bash/read 工具轮正常落定、会话事件与规则正文入库。
- ✅ **已完成（§5.1 补丁）**：见 §5.1「已处置」。
- ⏳ **待运行环境完成**：产品级冒烟（真实节点对话验证 §5.2 context 注入不 400 / 不漏 ghost 消息、§5.3 首轮 ctx 工具可见性）——离线 RPC 层已覆盖扩展机制本身。
- 🚫 本次范围到 L0+L1，L2 硬路由未实施（§10 决策 1 的裁决）。

---

## 1. 结论摘要

- **可行性：高。自动加载、自动事件捕获/注入在现有白名单装配管线（`PI_EXTENSIONS` → `-e`）下零后端代码即可生效**，无需任何用户输入或斜杠命令，也无需改 `mapPiJsonEvent` / SSE 管线 / 前端（既不是类型 A widget、也不是类型 B dialog）。
- context-mode 的 pi 适配器正是按「钩子自动触发」设计的：`package.json` 的 `pi.extensions` 入口 + `pi.on(...)` 生命周期订阅 + `pi.registerTool(...)` 桥接 MCP 工具。
- **「自动执行」有两层语义，需先对齐目标**：
  1. 会话捕获 / active-memory / 结果注入 —— **完全自动**；
  2. 「强制数据操作走 ctx 沙箱」——开箱即用**只是半自动**（提示词锚点 + 仅拦截 bash 内联 HTTP/危险 curl），若需硬路由需另行加码（见 §3、§10）。
- **上线前必须冒烟验证的兼容漂移点**（§5）：`tool_result` 事件字段不匹配、`before_provider_response` 事件在 0.84.2 不存在（无害死注册）、首轮 ctx 工具注册时序、Windows 软链挂载 + `better-sqlite3` 原生依赖。
- ⚠️ **非工程风险（需先裁决）**：context-mode 是 **Elastic-2.0（ELv2）** 许可。本产品是多租户托管形态，ELv2 明确禁止「以托管/受管服务形式向第三方提供该软件」，属法务必查项（§8）。

---

## 2. 机制概述：扩展如何端到端自动生效

```
管理员白名单 PI_EXTENSIONS=context-mode（逗号分隔）
   │
   ▼ resolvePiExtensions()（backend-ts/src/services/pi/resolve.ts）：
   │   按 3 个候选目录解析已安装包（首个命中生效）
   │   ① backend-ts/node_modules/context-mode      ← 推荐落点（见 §6）
   │   ② 仓库根 node_modules/context-mode
   │   ③ {PI_CODING_AGENT_DIR||~/.pi/agent}/npm/node_modules   ← `pi install` 的落点
   ▼ preparePiWorkspace()（workspace.ts）：
   │   symlinkOrCopy → {ws}/.pi-agent/extensions/context-mode（整包挂载）
   ▼ runPiAgent()（runner.ts buildSpawnArgs）：
   │   spawn `pi --mode rpc` + 显式追加 -e {ws}/.pi-agent/extensions/context-mode
   │   （cwd={ws}，env: PI_CODING_AGENT_DIR/PI_AGENT_HOME={ws}/.pi-agent）
   ▼ pi 加载扩展：package.json `pi.extensions: ["./build/adapters/pi/extension.js"]`
   │
   ├── 自动① 事件捕获（每轮 RPC prompt 走 AgentSession 同一代码路径）：
   │   pi.on("session_start" / "tool_call" / "tool_result" / "turn_end" / …)
   │   → SQLite（~/.pi/context-mode/sessions/<project-hash>.db）记录文件编辑/git/任务/用量
   │
   ├── 自动② before_agent_start（每轮 prompt 前）：
   │   懒启动 MCP bridge（server.bundle.mjs 子进程）→ pi.registerTool 注册 ctx_* 工具
   │   → 组装 routing 锚点 + active_memory(≤500 token) + resume 快照
   │
   ├── 自动③ context 钩子（每次模型调用前）：
   │   把②的上下文以 user 消息追加到 payload 末尾（不改 systemPrompt，
   │   保 DeepSeek/Anthropic/OpenAI prefix prompt cache）→ 模型每轮自动看到引导
   │
   └── 自动④ tool_call 拦截：仅对 bash 工具：
        fetch/requests/http/urllib/Invoke-WebRequest → {block:true, reason}
        curl/wget 非静默或非落盘形态 → {block:true, reason}（-s -o 落盘放行）
```

**关键事实（已核对）**：RPC 模式与 TUI 共用 `AgentSession`（`pi-main/packages/coding-agent/src/core/agent-session.ts`；`modes/rpc/rpc-mode.ts` 走 `session.prompt(..., source:"rpc")` 并在 `bindExtensions` 里以 `mode:"rpc"` + RPC UI 上下文绑定）。因此：

| 验证点 | 结论 | 依据（0.84.2 源码） |
|---|---|---|
| `tool_call` / `tool_result` 自动触发 | ✅ 所有工具执行前/后触发（无 handler 时零开销） | `agent-session.ts` `_installAgentToolHooks()`（约 L487/L509） |
| `before_agent_start` 每轮 prompt 触发 | ✅ | `agent-session.ts` L1243 起 |
| `context` 每轮模型调用触发 | ✅ | `sdk.ts` L363 `agent.transformContext → runner.emitContext` |
| RPC 下 `ctx.hasUI === true`、`ctx.mode === "rpc"` | ✅ | `core/extensions/types.ts` ExtensionContext（hasUI: TUI 与 RPC 均为 true） |
| 未知事件名 `pi.on(...)` | 静默注册、永不触发，**不抛错不炸加载** | `core/extensions/loader.ts` `createExtensionAPI.on`（无事件名校验） |
| `pi.registerTool` / `pi.registerCommand` | ✅ 存在 | `types.ts` ExtensionAPI；`loader.ts` L269/L278 |

---

## 3. 「自动执行」的三个层级（对齐目标用）

| 层级 | 内容 | 是否自动 | 备注 |
|---|---|---|---|
| L0 自动加载 | 白名单 → 每会话 spawn 带 `-e` 加载 | ✅ 自动 | 无需用户操作；`.env` 变更需手动重启后端（坑 1） |
| L1 自动捕获/注入 | 会话事件入库、routing 锚点 + active_memory + resume 注入、turn 用量统计 | ✅ 自动 | 捕获质量受 §5.1 字段漂移影响，需适配 |
| L2 自动路由强制 | 把 Read/Bash/WebFetch 等大输出操作**强制**改道 ctx 沙箱 | ⚠️ 半自动 | 开箱只做：bash 内联 HTTP/危险 curl 硬拦截 + 提示词引导模型选 ctx_* 工具；Read/Bash 仍可用 |

> 若 L2 要的是「无条件硬路由」，pi 的 `tool_call` 钩子支持 block / mutate `event.input`，**技术上可行**，但 context-mode pi 适配器未实现（有意保留 MCP-down 逃生通道），需要自研补丁或 fork。在确认需求前，不要假设开箱即有硬强制。

---

## 4. context-mode 注册事件 × pi 0.84.2 支持核对表

| context-mode `extension.ts` 注册 | pi 0.84.2 是否存在 | 说明 |
|---|---|---|
| `session_start` | ✅ | reason: startup/resume/new/fork/reload；RPC 进程启动与 reuse 场景均触发 |
| `tool_call` | ✅ | 返回 `{block, reason}` 语义一致 |
| `tool_result` | ✅ | **payload 形状不一致，见 §5.1** |
| `before_agent_start` | ✅ | 事件字段 `prompt` / `systemPrompt` 均匹配 |
| `context` | ✅ | 事件字段 `messages`、返回 `{messages}` 均匹配 |
| `before_provider_response` | ❌ 不存在 | 0.84.2 只有 `before_provider_request` / `after_provider_response`；**死注册无害**，但响应元数据捕获失效 |
| `turn_end` | ✅ | `TurnEndEvent.message`（AssistantMessage，带 usage/cost） |
| `session_before_compact` / `session_compact` | ✅ | 本形态会话短、触发率低（见 §5.6） |
| `session_shutdown` | ✅ | 本部署以 killTree 收尾，常不触发（无害，见 §5.5） |
| `registerCommand("ctx-stats"/"ctx-doctor")` | ✅ | RPC 下无斜杠命令入口，基本无用但无害 |

---

## 5. 兼容漂移与风险清单（上线前必须冒烟/处置）

### 5.1 tool_result 字段漂移 → 会话捕获质量下降（高优先）
已核对：0.84.2 的 `ToolResultEvent = { toolName, input, content[], details, isError, usage }`；适配器 `extension.ts` 却读 `event.result ?? event.output` 与 `event.params ?? event.input`。
- 后果：`tool_response` 恒为 undefined → 文件读/写/编辑的内容与结果无法入库（`extractEvents` 拿不到输出），捕获降级；不致命、不炸工具执行（handler 全 best-effort）。
- **已处置（2026-09-05，本地补丁）**：`tool_result` 规范化改为防御性读取——优先 `event.result/output`（旧 fork 形态），缺失时回退 join `event.content[]` 的 text 片段（pi ≥0.84 形态），兼容新旧两形态；`input` 本就对齐无需改。
  - 持久化：patch-package（devDependency + `postinstall`），补丁文件 `backend-ts/patches/context-mode+1.0.169.patch`，`npm install`/`npm ci` 自动重放；已验证「还原 node_modules → `npm install` → 补丁自动复现」。
  - 验证：`backend-ts/tests/api/pi-context-mode.test.ts` 新增读规则文件（`.claude/notes.md`）回合，断言 `rule_content` 含正文（有补丁通过 / 无补丁断言失败，负向对照成立）。
  - 边界：内容入库发生在 `extractors` 消费 `tool_response` 之处（规则文件 → `rule_content`；错误检测；其它按 `tool_response` 解析的路径）；普通文件读/写按上游设计仅记路径类事件，不落全文。如需任意文件全文检索属 ctx_index/ContentStore 范畴，另行评估。
  - 注：会话存储根的适配器覆盖环境变量是 **`CONTEXT_MODE_DATA_DIR`**（非 `CONTEXT_MODE_DIR`，后者只作用于 db.ts 的 server/content 存储），冒烟隔离与运维清理以此为据。
- 上游选项保留：可向 mksglu/context-mode 提 issue（Pi ≥0.84 的 tool_result 形状适配）；本地补丁不改桥/管线，包升级仅影响此函数（升级后需重生成补丁，见 §9）。

### 5.2 context 注入形态 → 需实测不炸 payload / 不漏前端（高优先）
`context` 钩子把 routing + memory 以 `role:"user"` 消息 append 到每次模型调用 payload 末尾。本部署 provider 为 `bookforge`（openai-completions / anthropic-messages 两种 api 格式）。
- 冒烟点：① 工具结果回合后追加 user 消息是否触发「连续同角色消息」400；② 注入内容会不会以 ghost user 消息出现在 RPC 事件流 / 前端会话（本实现不进 session 持久化，但需实测确认）；③ prefix cache 是否如预期保持。

### 5.3 首轮 ctx_* 工具注册时序（中优先）
bridge 在 `before_agent_start` 内 `await` 完成后才返回，注释断言「先于 pi 快照工具注册表」。冒烟需确认：**第一轮模型即能看到 ctx_* 工具**，而不是第二轮起才出现。

### 5.4 Windows 挂载：原生依赖 + 软链前提（高优先，踩坑 3/坑 4 同类）
context-mode 依赖 `better-sqlite3`（原生模块，node ≥22.5）。`preparePiWorkspace` 用 `symlinkOrCopy` 挂载整包：
- 软链/junction 成功 → Node 按真实路径解析，`better-sqlite3` 从 backend-ts 依赖树上溯命中 → 正常；
- **复制退化**（Windows 无软链权限）→ 依赖从 `{ws}` 向上一路缺失 → pi 加载扩展失败，典型表现是「零输出兜底诊断」或空流。
- 处置：接入前先确认目标机软链可用；**推荐装进 backend-ts 依赖树（候选①）**，由 npm 完成 better-sqlite3 的 ABI 安装/回退，冒烟时先跑 `context-mode doctor` 类检查或直接看扩展加载是否报错。

### 5.5 进程/子进程生命周期（中优先）
bridge 会给每个 RPC pi 进程多带一个 `server.bundle.mjs` 子进程。
- 正常：后端 `killTree`（Windows taskkill /T）可整树回收，复用/LRU/清理语义不变；
- `session_shutdown` 因杀树不触发 → 该钩子内 DB 清理不执行（无碍）；
- 首轮 `before_agent_start` 需 spawn bridge + 开 DB → 首轮延迟增加（约数百 ms 级），复轮无感。

### 5.6 值对齐：本形态下哪些功能真正有用（决策参考）
- 本部署 workspace 每对话唯一（`{nodeId}_{Date.now()}`）、会话文件由 pi 自行持久化 → **「跨压缩会话续接」价值低**（单轮内压缩触发率低）。
- 真正收益：① 大输出工具调用不进 provider context（省 token/成本/延迟）；② bash curl/fetch 洪泛拦截；③ 复用 RPC 进程内的跨轮 active-memory。
- 若只图①②，需评估成本 vs 一个「轻量自研 bash 拦截 + 引导」的等价替代。

### 5.7 DB 累积（低优先但需规划）
会话 DB 落在 OS home `~/.pi/context-mode/sessions/<project-hash>.db`（PiAdapter `getSessionDir`）。每对话 = 新 ws = 新 hash 文件；`cleanupOldSessions(7)` 只清**当前 DB 内的旧 session 行**，不清理历史 DB 文件 → 长期运行文件持续累积。建议在运维侧加周期清理（保留 N 天）。

---

## 6. 接入步骤

```powershell
# 1) 装进 backend-ts 依赖树并锁版本（推荐；候选①直接命中，原生依赖交给 npm）
cd backend-ts && npm install context-mode@1.0.169 --save-exact
#    备选：pi install npm:context-mode（落 ~/.pi/agent/npm/node_modules，候选③；
#         注意原生依赖安装/软链前提，需按 §5.4 核实）

# 2) 白名单（仅管理员批准项）
#    backend-ts/.env:
PI_EXTENSIONS=context-mode

# 3) 重启后端（.env 变更不触发 tsx watch 热重载——坑 1：需 kill 整棵进程树再启）
```

**无需**：改 `mapPiJsonEvent` / `runPiAgent` / SSE 管线 / 前端 / 注册 widget 生产者（非类型 A）、无需 dialog 桥（非类型 B）。

---

## 7. 冒烟验证清单（提交前逐项过）

对齐 `pi-extension-integration.md` §4 的既有冒烟手法（mock provider + 真实 RPC 子进程）：

1. **真实加载冒烟**：mock provider 下 spawn `pi --mode rpc -e <已装包目录> --session <tmp>/chat.jsonl --provider bookforge --model bookforge/<m>`，stdin 写 `{"type":"prompt","id":"p1","message":"ping"}`；断言退出码 0、无扩展错误、stdout 有 `message_update` / `agent_settled`。
2. **工具可用性**：让 mock 模型调用一次 `ctx_execute` → 断言 `tool_call`/`tool_result` 事件正常、结果文本回流，确认首轮可见 ctx_*（§5.3）。
3. **拦截生效**：mock 模型发起 bash `curl <url>`（stdout 形态）→ 断言工具被 block（tool 结果带拦截 reason），`-s -o` 形态放行。
4. **注入不炸**：连续多轮（含工具回合）prompt 不断流，确认无 payload 400（§5.2）；并核对前端会话**不出现** ghost user 消息。
5. **捕获质量**：一次真实 Write/Edit 后查 DB（或 `ctx_stats`/`ctx-search`）确认文件事件入库；若为空 → 落实 §5.1 补丁后重测。
6. **Windows/原生依赖**：确认扩展真实目录（挂载或依赖树上溯）含可加载的 `better-sqlite3`；stderr 无模块加载报错。
7. **进程回收**：一轮结束后 `taskkill /T` 语义下无残留 `server.bundle.mjs` 子进程；LRU/空闲回收后同样无残留。
8. **全链路**：登录后走 `/api/modules/bookplate/chat`，SSE 正常流式、无 error；多账号同 nodeId 并发互不串扰（注册表复合 key 口径不变）。

---

## 8. 安全、许可与运维注意

- **许可（先裁决）**：context-mode 为 **Elastic-2.0（ELv2）**。ELv2 的 field-of-use 条款禁止**以托管/受管服务形式向第三方提供该软件**（多租户对外提供即命中禁区）。本产品若属此类形态，需要法务确认是否有单独授权/自研等价替代，再进入实施。
- **白名单即安全边界**：扩展在服务端执行任意代码，只能管理员维护；与 `rpiv-*` 同规（版本锁定 + 回归，不随 npm 漂移）。
- **ctx_* 沙箱**：`ctx_execute` 在 bridge 子进程沙箱内执行用户/模型代码；多租户下需复核沙箱逃逸面与资源上限，作为上线评审项。
- **密钥**：context-mode 自身不读我方 `.env` / API Key；事件入库内容含工具参数（可能含路径/命令），按既有 widget/交互白名单思路复核落库内容即可。
- **升级流程**：任何 `pi-coding-agent` 升级先过 `docs/skill-agent/rpc-invariants.md` 再回归；context-mode 升级重跑 §7 的 1–6 项（其 npm 包仍须为锁定版本）。

---

## 9. 版本锁定与升级注意

- context-mode 锁定精确版本（`--save-exact` / package.json），升级 = 改版本 + 全量冒烟。
- pi-coding-agent 升级时，本文 §4 事件表与 §5 漂移点即为升级核对面（事件名/payload 形状随 0.84.x 演进会变）。
  完整升级操作手册见 **`docs/skill-agent/pi-agent-upgrade-playbook.md`**。
- §5.1 补丁已落地为「防御性读取 content[]」并经 patch-package 持久化（`patches/context-mode+1.0.169.patch`）。**升级 context-mode 后需重跑 `npx patch-package context-mode` 重新生成补丁**（先确认上游是否已原生修复该形状），并回归 `pi-context-mode.test.ts`。

---

## 10. 待决策事项

1. **目标层级**：只要 L0+L1（自动捕获/注入）即可，还是要求 L2 硬路由（需要自研 tool_call deny/mutate 补丁）？
2. **许可裁决**：ELv2 托管服务限制是否可接受（§8）。
3. **收益确认**：§5.6 三条收益是否值得引入（含原生依赖 + 挂载 + DB 累积的运维成本）。
4. **落点确认**：装 backend-ts 依赖树（候选①，推荐）还是 pi install（候选③）。

> 结论不变：**技术上可行，自动执行开箱即达（L0+L1）**；开工前提是裁决 §10 的 1–3，随后按 §6 接入 + §7 冒烟。
