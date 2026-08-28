# pi Agent 扩展接入最佳实践

> 面向：给 Skill Agent（pi）节点新增/维护扩展包（如 `@juicesharp/rpiv-todo`）的工程师。
> 关联实现：
> - 装配：`backend-ts/src/services/pi-agent-service.ts`（`resolvePiExtensions` / `preparePiWorkspace` / `runPiAgent`）
> - 工具事件桥 + 生产者注册表：`backend-ts/src/services/pi-widgets.ts`
> - 数据流设计：`docs/skill-agent/extension-widgets-implementation-plan.md`（v2.0）

---

## 1. 机制概述（扩展如何端到端生效）

```
管理员白名单 PI_EXTENSIONS（逗号分隔 npm 包名）
   │
   ▼ resolvePiExtensions()：按 3 个候选目录解析已安装包（首个命中生效）
   │   ① backend-ts/node_modules
   │   ② 仓库根 node_modules
   │   ③ {piAgentHome}/npm/node_modules   ← `pi install` 的落点
   ▼ preparePiWorkspace()：挂载到 {ws}/.pi-agent/extensions/{name}（软链/复制）
   ▼ runPiAgent()：显式追加 `-e {ws}/.pi-agent/extensions/{name}`
   ▼ pi 加载扩展（package.json `pi.extensions` 入口）→ 注册工具
   ▼ tool_execution_start/end → mapPiJsonEvent → tool_call / tool_result
   ▼ withWidgetBridge()：按 toolName 查生产者注册表 → 产出 WidgetDraft
   ▼ applyWidgetCap（行数/长度/总字符/节流/每轮上限）
   ▼ extension_widget / extension_widget_clear → SSE → 前端 ExtensionWidgets 渲染
```

**关键约束**：
- 扩展 = **服务端代码执行**（多租户最高风险），只允许管理员白名单装配；用户技能（纯提示词/工具声明）继续走 `skills` 流程，二者不混用。
- 新增一个扩展的「展示」只需：**装包 + 白名单 + 注册一个生产者**，不改 `mapPiJsonEvent` / `runPiAgent` / SSE 管线。

---

## 2. 新增扩展三步走

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
PI_EXTENSIONS=@juicesharp/rpiv-todo      # 逗号分隔；仅管理员批准项
```

> ⚠️ **`.env` 变更不会触发 `tsx watch` 热重载**，必须手动重启后端才生效。

### 2.3 注册生产者（widget 展示）

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
根因：pi 以**退出码 0 结束但全程零事件**（连会话文件都没落盘，如扩展加载异常被吞），`runPiAgent` 原逻辑不报错 → 空流。
处置：已加**零输出兜底诊断**（`pi-agent-service.ts` `runPiAgent` 收尾），零事件时推一条 `error`（含 stderr 末行）。排查此类问题先看：该工作区 `.pi-agent/run/` 是否有 `chat.jsonl`、`.pi-agent/extensions/` 挂载是否正常、pi 退出码与 stderr。

### 坑 5：诊断/排查时的进程残留
多次 `npm run dev` / `tsx watch` 会残留孤儿进程抢 8010 端口，造成 `EADDRINUSE` 与间歇性失败。重启服务前先 `Get-NetTCPConnection -LocalPort 8010` 确认占用者，再停整棵进程树。

---

## 4. 验证清单（提交前逐项过）

1. 后端类型检查：`cd backend-ts && npm run typecheck`
2. pi 相关测试：`npx vitest run tests/api/pi-agent-* tests/api/pi-widgets.test.ts tests/api/pi-sse-wire.test.ts`
3. **扩展真实加载冒烟**：用临时 mock provider 直接跑 `pi --mode json -e <已安装包目录> --provider bookforge --model bookforge/<m> "<msg>"`，退出码 0、无扩展错误、stdout 有事件。
4. 触发一次真实工具调用，确认 `tool_execution_end` 返回体与生产者解析契约一致（字段名、`details.tasks` 形状）。
5. 全链路：登录后 POST `/api/modules/bookplate/chat`（config_id 指向 Skill Agent 节点），确认 SSE 流式返回 `content_delta` 且无 `error`。
6. 前端：节点发送消息出现内容与扩展面板（`extension_widget`）。

## 5. 安全与一致性原则

- **白名单即安全边界**：扩展能执行任意服务端代码，`PI_EXTENSIONS` 只能由管理员维护；用户不可直接装任意扩展。
- **版本锁定**：升级 = 固定包版本（`pi install` / npm 锁定） + 回归验证，不随 npm 最新版漂移。
- **widget 内容白名单**：只下发生产者精挑的安全字段，`applyCap` 顺带剥除 ANSI/控制字符；前端 `<pre>` React 转义，无注入面。
- **跨轮一致性**：widget 以服务端 per-workspace 快照（`{ws}/.pi-agent/widgets.json`）为真相源，随 `/chat/session` 水合恢复；`clearPiSession`（清空对话）会一并清除。
- **key 稳定性**：widget `key`（如 `rpiv-todos`）是跨轮持久化标识，改动会导致旧快照残留，勿随意改名。
