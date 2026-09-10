# pi Agent 扩展接入最佳实践

> 面向：给 Skill Agent（pi）节点新增/维护扩展包（如 `@juicesharp/rpiv-todo`、`@juicesharp/rpiv-ask-user-question`）的工程师。
> 关联实现：
> - 装配：`backend-ts/src/services/pi-agent-service.ts`（`resolvePiExtensions` / `preparePiWorkspace` / `runPiAgent` / RPC 进程注册表）
> - guardrails 自动配置：`backend-ts/src/services/pi/guardrails.ts`（装配期写入 `{ws}/.pi-agent/extensions/guardrails.json`）
> - 工具事件桥 + 生产者注册表：`backend-ts/src/services/pi-widgets.ts`
> - 交互通道设计：`docs/skill-agent/pi-rpc-interactive-plan.md`（v1.0，RPC 化 + dialog 桥）
> - 数据流设计（widget 侧）：`docs/skill-agent/extension-widgets-implementation-plan.md`（v2.0）
> - 交互路由：`backend-ts/src/modules/bookplate/routes/ai-nodes.ts`（`POST /chat/ui-response`）

---

## 1. 机制概述（扩展如何端到端生效）

现阶段 pi 以 **`--mode rpc` 常驻会话子进程**运行（每对话一次 spawn），stdin 收命令、stdout 出 JSONL 事件。扩展分两大类接入路径：

```
管理员白名单 PI_EXTENSIONS（逗号分隔 npm 包名）
   │
   ▼ resolvePiExtensions()：按 3 个候选目录解析已安装包（首个命中生效）
   │   ① backend-ts/node_modules
   │   ② 仓库根 node_modules
   │   ③ {piAgentHome}/npm/node_modules   ← `pi install` 的落点
   ▼ preparePiWorkspace()：挂载到 {ws}/.pi-agent/extensions/{name}（软链/复制）
   ▼ runPiAgent()：spawn `pi --mode rpc` 并显式追加 `-e {ws}/.pi-agent/extensions/{name}`
   ▼ pi 加载扩展（package.json `pi.extensions` 入口）→ 注册工具
   │
   ├── [类型 A：工具型扩展，如 rpiv-todo]
   │   ▼ tool_execution_start/end → mapPiJsonEvent → tool_call / tool_result
   │   ▼ withWidgetBridge()：按 toolName 查生产者注册表 → 产出 WidgetDraft
   │   ▼ applyWidgetCap（行数/长度/总字符/节流/每轮上限）
   │   ▼ extension_widget / extension_widget_clear → SSE → 前端 ExtensionWidgets 渲染
   │
   └── [类型 B：交互型扩展，如 rpiv-ask-user-question]
       ▼ 扩展走 ctx.ui.select/input（RPC mode 下 hasUI=true，工具不被剥离）
       ▼ pi stdout: extension_ui_request → mapPiJsonEvent（白名单字段）→ SSE
       ▼ 前端 ExtensionDialog 渲染（select/input/confirm）
       ▼ 用户作答 → POST /chat/ui-response → RPC 进程注册表写回子进程 stdin
       ▼ extension_ui_response → pi 工具继续 → 模型拿到答案接着干活
```

**关键约束**：
- 扩展 = **服务端代码执行**（多租户最高风险），只允许管理员白名单装配；用户技能（纯提示词/工具声明）继续走 `skills` 流程，二者不混用。
- **类型 A（展示型 widget）**接入只需：装包 + 白名单 + 注册一个生产者，不改 `mapPiJsonEvent` / `runPiAgent` / SSE 管线。
- **类型 B（交互型 dialog）**接入只需：装包 + 白名单 **（前端零代码，后端管线已在 RPC 化时一次性搭好）**。交互工具结果不会产生持久 widget——它的价值是实时问答往返，不做 widget 映射。
- **类型判断**：工具结果本身是否构成「可展示的状态快照」？是 → A；工具价值全在「让用户当场做选择」→ B。两者也可同时出现（一个扩展既有状态工具又有交互工具）。

---

## 2. 新增扩展接入

### 2.1 安装包

任选其一，推荐 `pi install`（自动落到 pi 全局 npm 目录，版本被锁定）：

```powershell
# 方式一：pi install（落到 ~/.pi/agent/npm/node_modules）
pi install npm:@juicesharp/rpiv-todo

# 方式二：装进依赖树（backend-ts/ 或仓库根，resolvePiExtensions 优先命中）
cd backend-ts && npm install <pkg>
```

### 2.2 加入白名单

`backend-ts/.env`（或部署环境变量）：

```ini
PI_EXTENSIONS=@juicesharp/rpiv-todo,@juicesharp/rpiv-ask-user-question   # 逗号分隔；仅管理员批准项
```

> ⚠️ **`.env` 变更不会触发 `tsx watch` 热重载**，必须手动重启后端才生效。
> ⚠️ **多租户并发**：同一 nodeId 可能被多个账号复用 `workspaceId`（`${nodeId}_${Date.now()}`），后端 RPC 进程注册表以 **`${userId}:${workspaceId}` 复合 key** 隔离——跨账号绝不串扰。回答交互问题时也会带鉴权身份匹配注册表，无需前端参与。

### 2.3 类型 A：注册生产者（widget 展示）

`backend-ts/src/services/pi-widgets.ts`，新增一个工具 → 面板的映射：

```ts
registerToolWidgetProducer('<toolName>', (call, result) => {
  if (!result) return null;                       // 无结果 = 不更新
  const tasks = parse(result.result);             // 从工具结果解析权威快照
  if (!tasks || tasks.length === 0) return null;  // 空列表 → 桥自动清空面板
  return {
    key: '<stable-widget-key>',                    // 跨轮持久化的唯一标识，勿随意改名
    lines: [`Heading (done/total)`, ...rows],      // 纯文本行（非 ANSI，服务端无渲染器）
    placement: 'aboveEditor',                      // 或 'belowEditor'
    data: { /* 可选结构化安全字段（不随 SSE 下发，仅持久化备用） */ },
  };
});
```

**工具结果契约**（以 `@juicesharp/rpiv-todo` 为例）：每个成功调用的 `tool_execution_end.result` 是持久化快照信封：

```json
{ "content": [...], "details": { "action": "...", "params": {...}, "tasks": [ { "id": 1, "subject": "...", "status": "pending" } ], "nextId": 2 } }
```

- 生产者以 `result.details.tasks` 为**权威快照**（last-value-wins，天然幂等）；
- `status` 取值：`pending | in_progress | completed | deleted`；`deleted` 是墓碑，展示时应过滤；
- 字段解析属于生产者内部实现，**包升级只影响该函数**，不影响桥/管线；
- 实际的字段名以安装版本的 `docs/tool-schema.md` 为准，不要照抄本文示例硬编码。

### 2.4 类型 B：交互型扩展（零额外配置）

交互型扩展（如 `ask_user_question`）**无需注册任何生产者**——RPC 通道已通用：

1. **扩展必须走 RPC dialog walker**：只有 `ctx.mode === "rpc"` 且 `ctx.hasUI === true`（RPC 模式天然如此）时，工具才不被扩展自身剥离、才会用 `select`/`input` 原语提问。**若扩展只支持 TUI 定制 UI（`ctx.ui.custom()`）而不支持 dialog 回退，则 RPC 下 `custom()` 返回 undefined、无法渲染——此类扩展需要作者提供 rpc-fallback（参考 `rpiv-ask-user-question/rpc-fallback.ts`），否则接入无效。**
2. **事件桥白名单**：后端只透传 `select/confirm/input/editor` 四类方法（字段：`id/method/title/options/message/placeholder/prefill/timeout`）；`setWidget/notify/setStatus/setTitle/custom` 静默忽略（widget 展示仍走类型 A 桥，不冲突）。
3. **对话语义**：用户停止生成 / 会话错误 → 前端弹层自动关闭；RPC 协议要求 **cancelled 也必须回写**（否则 pi 工具挂起直到超时），前端取消按钮走同一 POST 通道。

---

## 3. 本次集成踩过的坑（务必先读）

### 坑 1：`.env` 改了但扩展没生效
`tsx watch` 只监听 `.ts` 变更，`PI_EXTENSIONS` 写在 `.env` 不会触发重载 → **改 `.env` 必须手动重启后端**（kill 掉 `npm run dev` 整棵进程树再启，注意 tsx watch 的子进程可能残留占端口）。

### 坑 2：`pi install` 的包后端找不到
早期实现只查 `backend-ts/node_modules` 与仓库根 `node_modules`，`pi install` 装的包在 `~/.pi/agent/npm/node_modules` 找不到 → 静默跳过。**已修复**：`resolvePiExtensions` 新增第三候选目录 `{PI_CODING_AGENT_DIR || ~/.pi/agent}/npm/node_modules`（与 pi-coding-agent 的 `getAgentDir`/`package-manager` 口径一致）。后续再出现「白名单配了但扩展没加载」，先确认这三处任一位置确实存在该包目录。

### 坑 3：扩展依赖解析失败（Windows 软链退化场景）
pi 加载 `-e <目录>` 时，jiti 用 alias 解析 `@earendil-works/*` 与 `typebox`；**其余依赖**（如 `@juicesharp/rpiv-config`）从扩展包的**真实路径**向上找 `node_modules`。
- 软链挂载：Node 按真实路径解析，依赖可从 pi 全局 npm 目录命中 → 正常；
- **复制退化**（Windows 无软链权限时 `symlinkOrCopy` 回退复制）：复制进 `{ws}` 的扩展无法解析非 alias 依赖 → pi 启动即失败。
- 处置：确保软链可用（管理员/开发者模式）；若必须复制，则该包依赖要么改为别名覆盖、要么 `npm install` 到 backend-ts 依赖树后从①命中。

### 坑 4：pi 静默失败 = 前端「完全无输出」
症状：前端发消息后空屏，无内容、无错误。
根因：pi 以**退出码 0 结束但全程零事件**（连会话文件都没落盘，如扩展加载异常被吞）→ 空流。
处置：`runPiAgent` 收尾有**零输出兜底诊断**：RPC 下若 prompt 未被受理（response 缺失）且无任何事件 → 推 `error`（含 stderr 末行）。排查此类问题先看：该工作区 `.pi-agent/run/` 是否有 `chat.jsonl`、`.pi-agent/extensions/` 挂载是否正常、pi 退出码与 stderr。

### 坑 5：诊断/排查时的进程残留
多次 `npm run dev` / `tsx watch` 会残留孤儿进程抢 8010 端口，造成 `EADDRINUSE` 与间歇性失败。重启服务前先 `Get-NetTCPConnection -LocalPort 8010` 确认占用者，再停整棵进程树。

### 坑 6：RPC 进程常驻 = 收尾信号不再是「进程退出」（重要）
json 模式是「spawn → 出结果 → 进程退出」一次性；**RPC 模式进程常驻**（stdin 空闭才退出），一轮对话的真正结束信号是 **`agent_settled` 事件**（本次对话完全落定：无重试/无压缩重试/无排队续接）。
- 实现已按此收尾：**`agent_settled` 到达 → killTree**（不是 `stdin.end()`）。
- **为什么用 killTree 而非优雅退出**：Windows 下 pi 的 shutdown 与扩展（如 pi-image-gen）的异步句柄存在 libuv 竞态，`stdin.end()` 触发 pi 崩溃（退出码 0xC0000409，`src\win\async.c` Assertion）。已核实 `agent_settled` = 会话文件已落盘（消息/工具结果/usage 均在起前写完），kill 不丢数据，且已 settled 后退出码非 0 不误报 error。
- 延伸：`agent_settled` 后**前端的产物差分仍会执行**（diff 在 kill 后、收尾前），不受影响。

### 坑 7：RPC 模式禁止 `@file`（图片输入变化）
`pi --mode rpc` 明确拒绝 `@file` 参数（`main.js:508`）。图片输入从「argv 附 `@file`」改为 prompt 命令的 `images` 字段直传：
```
{"type":"prompt","message":"...","images":[{"type":"image","data":"<base64>","mimeType":"image/png"}]}
```
后端 `runPiAgent` 已做 data URL → `{type:"image",data,mimeType}` 转换（非法项静默跳过，最多 4 张）；**不落盘 `inputs/`**（与 json 模式的 `saveInputImages` 语义不同，勿混用）。

### 坑 8：交互问卷「卡住」不会自动超时
`ask_user_question` 的 RPC 走查器**不发 timeout**（实测事件无 `timeout` 字段）——用户无限期不答，pi 工具执行挂起，子进程占住该工作区。
- 第一道兜底：`PI_RPC_TIMEOUT_MS`（默认 10 分钟）进程级强制收尾；
- 第二道：用户点了「停止生成」/对话出错，前端弹层关闭 + 后端 abort 杀进程；
- **当前限制**：10 分钟内「用户不答又不取消」，子进程仍占配额。这是已知的 v1 限制（按每用户并发配额内可承受处理）。已定稿：暂不自动取消弹层（后端补 cancelled 是 v2 候选）。

---

## 4. 验证清单（提交前逐项过）

1. 后端类型检查：`cd backend-ts && npm run typecheck`
2. pi 相关测试：`npx vitest run tests/api/pi-agent-* tests/api/pi-widgets.test.ts tests/api/pi-sse-wire.test.ts`（`pi-agent-run.test.ts` 是真实 RPC 子进程端到端，含文本/绘图/限流重试/持续限流 4 个 case）
3. **扩展真实加载冒烟（RPC）**：临时 mock provider（参考 `pi-agent-run.test.ts`）下，spawn `pi --mode rpc -e <已装包目录> --session <tmp>/chat.jsonl --provider bookforge --model bookforge/<m>`，stdin 写 `{"type":"prompt","id":"p1","message":"ping"}`，退出码 0、无扩展错误、stdout 有 `message_update`/`agent_settled`。
4. **交互型扩展全链冒烟**：mock provider 让模型返回 `ask_user_question` tool_calls → 断言 stdout 出现 `extension_ui_request`（`method` 为 `select`/`input` 等）→ 写回 `extension_ui_response` → 断言模型继续输出 → `agent_settled`。**参考实现**：在 `docs/skill-agent/pi-rpc-interactive-plan.md` 的实现期定稿说明中记录了同样思路的冒烟脚本构造（mock provider 工具调用 → RPC 子进程 → 应答闭环）。
5. 工具型扩展：触发一次真实工具调用，确认 `tool_execution_end` 返回体与生产者解析契约一致（字段名、`details.tasks` 形状）。
6. 全链路：登录后 POST `/api/modules/bookplate/chat`（config_id 指向 Skill Agent 节点），确认 SSE 流式返回 `content_delta` 且无 `error`。
7. 前端：节点发送消息出现内容与扩展面板（`extension_widget`）；交互型扩展出现弹层，作答后对话继续。
8. （交互型）多轮并发回归：两个账号对同一 nodeId 发起对话，A 答 A 的问卷、B 答 B 的问卷，互不串扰（注册表复合 key 隔离）。

## 5. 安全与一致性原则

- **白名单即安全边界**：扩展能执行任意服务端代码，`PI_EXTENSIONS` 只能由管理员维护；用户不可直接装任意扩展。
- **版本锁定**：升级 = 固定包版本（`pi install` / npm 锁定） + 回归验证，不随 npm 最新版漂移。
  当前已装版本与升级操作手册见 **`docs/skill-agent/pi-agent-upgrade-playbook.md`**（含扩展包 peer-dep 矩阵与 0.85.1 实测记录）。
- **widget 内容白名单**：只下发生产者精挑的安全字段，`applyCap` 顺带剥除 ANSI/控制字符；前端 `<pre>` React 转义，无注入面。
- **交互字段白名单**：`extension_ui_request` 只透传 `select/confirm/input/editor` 且限字段（`id/method/title/options/...`）；前端 React 转义渲染，无注入面。
- **多租户并发隔离**：RPC 进程注册表 key = `${userId}:${workspaceId}`；ui-response 路由从鉴权态取 userId（非查询参数），与 `nodeWorkspace` 防穿越同一口径。
- **跨轮一致性**：widget 以服务端 per-workspace 快照（`{ws}/.pi-agent/widgets.json`）为真相源，随 `/chat/session` 水合恢复；`clearPiSession`（清空对话）会一并清除**且先杀活跃 RPC 子进程**（问卷等待中/流式中）。
- **key 稳定性**：widget `key`（如 `rpiv-todos`）是跨轮持久化标识，改动会导致旧快照残留，勿随意改名。
- **进程担保**：`runPiAgent` 在 `finally` 中注销注册表 + killTree（防御遗留）；总超时 `PI_RPC_TIMEOUT_MS`（默认 10 分钟）兜底「永不落定」的死等。

---

## 6. Guardrails（安全护栏）自动装配

已接入 `@aliou/pi-guardrails`（文件保护 / 越界路径 / 危险命令三合一安全扩展），配置**完全自动**，无需用户跑 `/guardrails:onboarding` 或手工编辑任何文件。

### 机制（为什么写 `{ws}/.pi-agent/extensions/guardrails.json` 即生效）

guardrails 的 ConfigLoader（`@aliou/pi-utils-settings`）把**全局**配置读自 `{agentDir}/extensions/guardrails.json`，其中 `agentDir = getAgentDir()` 优先取 `PI_CODING_AGENT_DIR` 环境变量；runner 把该变量指向 `{ws}/.pi-agent`（见 `runner.ts`）。因此 `preparePiWorkspace` 在装配期写入该文件 = pi 子进程启动即加载，与其他配置文件（models.json / settings.json / web-search.json）同款装配。装配代码集中在 `backend-ts/src/services/pi/guardrails.ts`。

### 自动配置内容（buildGuardrailsConfig）

- `onboarding.completed: true`：扩展不再注册引导命令，无需人工 onboarding；
- `features` 三档全开：`policies`（.env/私钥等内置规则）+ `permissionGate`（危险命令）+ `pathAccess`（越界路径）；
- 额外策略规则 `agent-runtime`：禁止工具访问 `.pi-agent/**`（models.json / web-search.json 等装配了真实 API Key，Agent 不应经 read/bash 等工具读到）；经 `allowedPatterns` 显式放行 `.pi-agent/skills/**` 与 `.pi-agent/prompts/**`——这是 pi 渐进式披露机制要求「模型经 read tool 按需读取」的可读资源，黑名单 fail-closed + 显式豁免，新增敏感文件默认仍受保护；
- `pathAccess.mode: 'block'`（不是 ask）：**RPC 下 `ctx.ui.custom()` 返回 undefined**（见 pi-coding-agent `rpc-mode.js`），ask 模式会静默退化为「一律拒绝」且语义含糊；block 模式确定性拒绝越界访问，完全自动、零交互。工作区内访问恒放行，pi 文档路径与 skill 文件路径由扩展自动豁免；
- `permissionGate.requireConfirmation: true`（内置默认）：`custom()` 不可用后 permission-gate 自带 `ctx.ui.select(...)` 回退 → 走既有 `extension_ui_request` → dialog 桥，前端零改动（Allow once / session / Deny / Stop）。

### 接入与升级

- 白名单：`backend-ts/.env` 的 `PI_EXTENSIONS` 追加 `@aliou/pi-guardrails`（⚠️ `.env` 变更不触发 tsx watch 热重载，**必须手动重启后端**，见坑 1）；
- 安装：已 `npm install @aliou/pi-guardrails` 到 backend-ts 依赖树（resolvePiExtensions ① 命中；非 alias 依赖 `@aliou/pi-utils-settings` / `@aliou/sh` 从真实路径解析，规避坑 3 复制退化）；
- 升级：固定 npm 版本（当前 0.17.1）+ 回归。config.version 在装配期从已安装包 package.json 实读，高于扩展所有内置迁移版本（≤0.16.2），加载不会触发迁移改写；
- 移除：从白名单摘除后，装配会自动清理残留的 guardrails.json。

### 验证

`npx vitest run tests/api/pi-guardrails-run.test.ts`：真实 RPC 子进程加载扩展 + permission-gate 危险命令 dialog 全链闭环（作答后命令放行、轮次正常落定）。配置形状断言在 `pi-agent-workspace.test.ts` 的 guardrails describe 块。
