# pi-cache-optimizer 集成方案（无感自动 KV 优化 + 气泡底部缓存命中展示）

> 面向：给 Skill Agent（pi）节点接入 `pi-cache-optimizer@2.8.7` 的工程师。
> 核心原则：**无感** —— 不改 DB 表、不加 admin 页面、不需要用户/管理员按端点配置，装上即自动生效。
> 基线：`pi-coding-agent@0.84.2`（RPC 模式常驻子进程），`pi-cache-optimizer@2.8.7`（要求 ≥0.82，满足）。
> 关联实现：
> - 扩展装配/白名单：`backend-ts/src/services/pi/resolve.ts`（`resolvePiExtensions`）/ `workspace.ts`（`preparePiWorkspace`）
> - RPC 编排：`backend-ts/src/services/pi/runner.ts`（`spawnPiProcess` / `runPiAgent`）
> - 事件映射：`backend-ts/src/services/pi/events.ts`（`mapPiJsonEvent`）
> - 事件类型：`backend-ts/src/modules/bookplate/stream.ts`（`ChatStreamEvent`）
> - 前端渲染：`frontend/src/modules/bookplate/components/chat/ChatMessageItem.tsx`
> - 流式归约：`frontend/src/modules/bookplate/piStream.ts` / `PiChatNodeHost.tsx` / `piSessionApi.ts` / `src/platform/types/index.ts`
> - RPC 协议不变量：`docs/skill-agent/rpc-invariants.md`

---

## 1. 目标与边界

1. **自动 KV/Prompt Cache 优化**：pi 发出的请求默认对缓存友好（稳定 prompt 前置、长缓存保留安全门控），全程零人工干预。
2. **气泡底部缓存命中展示**：在每条 assistant 气泡的 token 用量旁展示该条消息的缓存命中率，随会话水合持久化。
3. **无感**：
   - 不改 `llm_configs` 表 / admin API / 前端 admin 页面；
   - 无首轮失败风险（见 §3 决策 1）；
   - 任何失败路径都能自动收敛到安全状态（见 §3 决策 2）。

不在本次范围：
- 不做「按端点手动配置」的 DB/UI（保留为 §6 可选增强的轻量文件替代）；
- 不做会话级聚合缓存统计（扩展 footer 走 TUI `ctx.ui.setStatus`，RPC 下被 `events.ts:101` 白名单忽略，属 TUI-only；逐条消息展示已满足需求）。

---

## 2. 方案概览

```
┌─ 链路 A：扩展自动优化（无感）
│   pi install + PI_EXTENSIONS 白名单
│   → pi --mode rpc -e 加载
│   → prompt 重排（稳定内容前置）+ 长缓存保留从源头关闭（models.json compat）
│   → prompt_cache_key 注入默认关闭（models.json compat + spawn env 双层，§3 决策 1）
│
└─ 链路 B：气泡底部缓存命中展示（无感）
    provider usage(cacheRead/cacheWrite) → pi message_end.usage
    → events.ts 映射进 token_usage 事件（新增 cacheRead/cacheWrite）
    → SSE → 前端 tokenUsage → ChatMessageItem 渲染「缓存命中 X%」
```

**决策摘要表**：

| 决策点 | 选择 | 理由 |
|---|---|---|
| 1. prompt_cache_key / prompt_cache_retention 注入默认 | **关闭**（① 装配 `models.json` 写 `compat.supportsLongCacheRetention: false`；② spawn env 设 `PI_CACHE_OPTIMIZER_NO_OPENAI_CACHE_KEY=1`） | 关键事实：扩展加载即强制 `PI_CACHE_RETENTION=long`，此时 **pi 核心自身**就会对 openai-completions 注入 `prompt_cache_key`（`compat.supportsLongCacheRetention` 第三方默认 true），扩展对它是保留不剥离，env 只关扩展 fallback、关不掉 pi 核心 → 必须用 models.json 显式 false 从源头关闭（双层兜底）。关闭则零 400 风险、首轮即无感。KV 主要收益来自 prompt 重排，不依赖这两个参数 |
| 2. 失败自动收敛 | 部署级 env 可覆盖；可选增强带 400 看门狗自动降级（§6） | 即便将来对某端点开启注入，遇到 400 也能自动回退 |
| 3. 缓存命中数据源 | `message_end.usage.cacheRead/cacheWrite`（pi `Usage` 原生字段） | 结构化、逐条消息、与扩展解耦；不解析 TUI footer 文本 |
| 4. 展示规则 | 仅当 provider 上报缓存用量（`cacheRead>0 || cacheWrite>0`）时显示 | 未上报/无缓存则不显示，避免「命中 0%」噪音 |
| 5. 修改面 | 后端 4 个文件 + 前端 4 个文件 | 无 DB、无迁移、无 admin UI |

---

## 3. 决策依据（读代码确认的事实）

### 3.1 关键事实：pi 核心自身也会注入，env 关不掉它

- 扩展加载时**强制** `PI_CACHE_RETENTION=long`（`requestLongCacheRetention`，无 opt-out env）。
- 而 `pi-ai` 的 openai-completions `buildParams` 在 `cacheRetention === "long" && compat.supportsLongCacheRetention` 时**由 pi 核心自己**注入 `prompt_cache_key`（session id）并发送 `prompt_cache_retention: "24h"`；其中 `supportsLongCacheRetention` 对第三方 openai-completions **默认 true**（仅 Together/Cloudflare/Nvidia/AntLing 除外），且 `model.compat.supportsLongCacheRetention ?? detected` 允许 models.json 显式覆盖。
- 扩展在 `before_provider_request` 只剥离 `prompt_cache_retention`（Gate 4），对 pi 核心已注入的 `prompt_cache_key` 是**保留**（`hasEffectivePromptCacheKey` → 不再重复添加）。因此：
  - `PI_CACHE_OPTIMIZER_NO_OPENAI_CACHE_KEY=1` 只能关掉**扩展的 fallback**；
  - 要阻止 pi 核心注入，唯一可靠手段是让条件为假：**`models.json` 写 `compat.supportsLongCacheRetention: false`**（显式 false 覆盖默认 true）。
- 该 env 是**按次读取**（`shouldInjectOpenAIPromptCacheKey` 每次读 `process.env`），所以 spawn 时设置对常驻进程全程生效，无需 reload。

### 3.2 去掉扩展（白名单摘除）时的安全性

- 无扩展则无人设置 `PI_CACHE_RETENTION` → `resolveCacheRetention` 返回默认 `short` → 对非 `api.openai.com` 端点，pi 核心的 `prompt_cache_key` / `prompt_cache_retention` 条件均为假 → **两个参数都不发送**。
- 新代码（env 兜底、缓存命中展示）完全独立于扩展，摘除扩展后照常工作、零报错。

### 3.3 本项目 KV 收益不依赖该参数

- 扩展核心收益是 `before_agent_start` 的 **prompt 重排**（稳定内容前置）——对 DeepSeek/Anthropic/Gemini 等前缀式自动缓存全部有效，与本参数无关。
- `supportsLongCacheRetention: false` 只影响「是否请求 24h/1h 长保留与 cache-key」，不影响前缀缓存命中；官方 OpenAI baseUrl 不受影响（其 `prompt_cache_key` 分支是独立条件 `api.openai.com && retention !== none`，该场景支持保留属合理）。

### 3.4 气泡展示数据已现成

- pi `Usage` 类型含 `input / cacheRead / cacheWrite / output / totalTokens`（`@earendil-works/pi-ai` types.d.ts），`message_end` 事件完整携带（`backend-ts/.../pi-coding-agent/dist/modes/json-event.d.ts` 中 `ToJsonEvent` 明确透传 `usage: Usage`）。
- 本项目 `events.ts:144-166` 目前只消费 `input/output/totalTokens`，`schema.ts` 对未知字段 passthrough，扩展字段零破坏。

---

## 4. 链路 A：扩展集成（无感自动优化）

### 4.1 安装与白名单

```powershell
pi install npm:pi-cache-optimizer    # 锁定 2.8.7，落到 ~/.pi/agent/npm/node_modules
```

`backend-ts/.env`（`PI_EXTENSIONS` 追加，逗号分隔）：

```ini
PI_EXTENSIONS=...,pi-cache-optimizer
```

- 装配自动生效：`resolvePiExtensions`（resolve.ts:103）按 白名单 → 三候选目录（① backend-ts/node_modules → ② 仓库根 node_modules → ③ `~/.pi/agent/npm/node_modules`）首个命中；`preparePiWorkspace`（workspace.ts:247）挂载到 `{ws}/.pi-agent/extensions/`，`runPiAgent` 逐个 `-e`（runner.ts:84）。
- 依赖解析零风险：本包**零运行时依赖**（仅 import `node:*` + `@earendil-works/pi-coding-agent`，后者被 jiti alias 解析），Windows 软链退化复制也不会启动失败（规避坑 3）。
- ⚠️ `.env` 变更不触发 `tsx watch` 热重载，**必须手动重启后端**（坑 1）。
- 版本锁定：固定 2.8.7，升级需回归（见 §8）。

### 4.2 默认关闭 cache-key / 长保留注入（双层，缺一不可）

**第 1 层（决定性）：`backend-ts/src/services/pi/workspace.ts` 装配的 `models.json`，`chatModelEntry.compat` 写 `supportsLongCacheRetention: false`**

当前代码（:300-313）：`chatModelEntry.compat` 仅在 `apiFormat !== 'anthropic' && thinkingFormat` 时设置。改为 openai-completions 路径始终设置：

```ts
if (opts.chatModel.apiFormat !== 'anthropic') {
  chatModelEntry.compat = {
    ...(opts.chatModel.thinkingFormat ? { thinkingFormat: opts.chatModel.thinkingFormat } : {}),
    // 无感安全默认：pi 核心在 PI_CACHE_RETENTION=long（扩展加载即强制）且 compat 默认 true 时
    // 会自行注入 prompt_cache_key / prompt_cache_retention 到第三方端点；显式 false 从源头关闭，
    // 零 400 风险、首轮即无感。官方 OpenAI baseUrl 分支独立不受影响。见 docs/skill-agent/pi-cache-optimizer-plan.md §4.2。
    supportsLongCacheRetention: false,
  };
}
```

**第 2 层（兜底）：`backend-ts/src/services/pi/runner.ts` `spawnPiProcess`（env 构造处，约 :190-200）**

```ts
// 无感默认：即便将来某处放开注入，也先关掉扩展自身的 prompt_cache_key fallback。
// 管理员部署级 env 显式配置永远优先（不覆盖已有值）。见 §4.2。
if (process.env.PI_CACHE_OPTIMIZER_NO_OPENAI_CACHE_KEY === undefined) {
  env.PI_CACHE_OPTIMIZER_NO_OPENAI_CACHE_KEY = '1';
}
```

要点：
- 第 1 层决定「pi 核心发不发」，第 2 层决定「扩展 fallback 发不发」；两层都关才叫真正关闭。
- 管理员在 `.env` 写 `PI_CACHE_OPTIMIZER_NO_OPENAI_CACHE_KEY=0`（或 `false/no/off`）可放开**扩展**的 fallback；要放开 **pi 核心**的注入需另在装配逻辑放开 `supportsLongCacheRetention`（本项目无此入口，属预期）。
- `apiFormat === 'anthropic'` 的渠道不涉及这两个参数（走 cache_control + TTL，由扩展管理），第 1 层不写入、第 2 层设置无害。
- 不要设置 `PI_CACHE_OPTIMIZER_NO_PROMPT_REWRITE=1`——prompt 重排是全链路唯一不可缺的 KV 收益来源。
- ⚠️ `models.json` 装配内容变更会进入 `computeWorkspaceGeneration` 哈希（generation.ts:70-80 已覆盖 chatModel）→ 已有进程自动重拉，无需额外处理。

### 4.3 自动生效行为清单

扩展加载后自动生效（无需任何命令，命令交互在 RPC 下不可达但也不必需）：

| 行为 | 生效范围 | 本项目结论 |
|---|---|---|
| system prompt 稳定内容前置 + skill 列表压缩 | `before_agent_start`，全渠道 | ✅ 核心 KV 收益 |
| `PI_CACHE_RETENTION=long` 设置与安全门控 | 进程级 + `before_provider_request` 剥离 | ✅ `prompt_cache_retention` 由扩展剥离；`prompt_cache_key` 由 models.json compat 关闭（§4.2 第 1 层） |
| `prompt_cache_key` 注入（pi 核心 + 扩展） | pi 核心 `buildParams` + 扩展 `before_provider_request` | ⛔ 双层默认关闭（§4.2） |
| 会话亲和头 | 需 compat `sendSessionAffinityHeaders: true` 才注入 | ✅ 默认不注入 |
| footer 统计 / `/cache-optimizer` 命令 | TUI 交互 | RPC 下 `setStatus` 被后端忽略、命令不可达，**无影响** |
| 写 `models.json` | 仅 `/cache-optimizer fix/rollback` 交互确认后 | RPC 下不可达，**永不写** ✅ |

扩展自身统计 shard 落在 `{ws}/.pi-agent/pi-cache-optimizer-stats.d/`（`PI_CODING_AGENT_DIR` 由 runner.ts:186 指向工作区），随会话生命周期，无需清理。

---

## 5. 链路 B：气泡底部缓存命中展示

### 5.1 数据源

`message_end.usage`（pi `Usage`）的 `cacheRead`（缓存命中输入 token）/ `cacheWrite`（本次新写入缓存 token）。`input` = 未命中输入 token。逐条消息可用，provider 未上报时为 `0`。

### 5.2 后端改动（2 处）

**① `backend-ts/src/services/pi/events.ts`** `message_end` 分支（:144-166）：在现有 `token_usage` 事件中透传缓存字段：

```ts
const cacheRead = typeof u.cacheRead === 'number' && Number.isFinite(u.cacheRead) ? u.cacheRead : 0;
const cacheWrite = typeof u.cacheWrite === 'number' && Number.isFinite(u.cacheWrite) ? u.cacheWrite : 0;
// 产出事件时附带（仅当 totalTokens > 0 的既有分支内）
cacheRead,
cacheWrite,
```

**② `backend-ts/src/modules/bookplate/stream.ts`** `ChatStreamEvent` 的 `token_usage` 分支（:103-110）补可选字段：

```ts
cacheRead?: number;
cacheWrite?: number;
```

### 5.3 前端改动（4 处）

| 文件 | 改动 |
|---|---|
| `src/platform/types/index.ts` `ChatMessage.tokenUsage`（:319） | 加 `cacheRead?: number; cacheWrite?: number;`（水合随对象展开自动带过，`piSessionApi.ts:92/:295` 无需改逻辑，仅 DTO 类型补齐 `piSessionApi.ts:21`） |
| `src/modules/bookplate/piStream.ts` | SSE 线类型 `PiStreamEvent.token_usage`（:63）+ `LiveAssistantStep.tokenUsage`（:101）+ `token_usage` action（:179）+ reducer（:253）同步补 `cacheRead/cacheWrite` |
| `src/modules/bookplate/PiChatNodeHost.tsx` `token_usage` case（:612） | dispatch 透传 `cacheRead/cacheWrite` |
| `src/modules/bookplate/components/chat/ChatMessageItem.tsx`（:321 token 区块） | 在「% 窗口」段后追加缓存命中段 |

渲染规则（决策 4）：

```tsx
{msg.tokenUsage.cacheRead !== undefined &&
  msg.tokenUsage.cacheWrite !== undefined &&
  (msg.tokenUsage.cacheRead > 0 || msg.tokenUsage.cacheWrite > 0) && (
    (() => {
      const hit = msg.tokenUsage.input != null && msg.tokenUsage.input + msg.tokenUsage.cacheRead > 0
        ? Math.round((msg.tokenUsage.cacheRead / (msg.tokenUsage.input + msg.tokenUsage.cacheRead)) * 1000) / 10
        : null;
      const detail = `缓存命中 ${formatTokenCount(msg.tokenUsage.cacheRead)} / 未缓存 ${formatTokenCount(msg.tokenUsage.input ?? 0)} / 写入缓存 ${formatTokenCount(msg.tokenUsage.cacheWrite)}`;
      return (
        <span title={detail}>· 缓存命中 {hit != null ? `${hit}%` : '—'}</span>
      );
    })()
  )}
```

- `input + cacheRead` 为该条消息的全部输入 token；命中率 = `cacheRead / (input + cacheRead)`，保留 1 位小数。
- 未上报（两者为 0）→ 不显示；上报但本轮全 miss（`cacheRead=0, cacheWrite>0`）→ 显示「缓存命中 0%」，提示首次写入。

### 5.4 与扩展的关系

展示链路不依赖扩展（数据来自 provider usage）。扩展通过链路 A 提升命中率，使展示的数值更有意义。两者独立交付，任一侧失败不影响另一侧。

---

## 6. 可选增强（M2，暂不实现）：按端点允许清单 + 看门狗自动降级

仅当出现「某个端点确实支持 prompt_cache_key、希望开启注入」的真实需求时再做，增量追加、不破坏 M1。

1. **允许清单**：`backend-ts/runtime/pi-cache-key-allow.json`（`runtime/` 已 gitignore，`.gitignore:49`），按 `baseUrl|modelName` 白名单。spawn 时：清单命中 → 不设 `PI_CACHE_OPTIMIZER_NO_OPENAI_CACHE_KEY`（注入开）；未命中 → `1`（关）。
2. **看门狗**：`events.ts` `message_end` 分支按 `prompt_cache_key` + unsupported 语义（复用扩展 `hasPromptCacheRetentionUnsupportedText` 的短语集：`unsupported parameter / unknown parameter / not supported / extra inputs / not permitted / unrecognized`）判定端点拒绝 → 产出内部事件（如 `__cache_key_rejected`）→ runner 在 `consumeLine` 拦截（不推 SSE）→ 写负标记 `runtime/pi-cache-key-marks.json`（原子 temp+rename）→ 该轮结束后按既有异常路径杀进程，下一轮 spawn 读标记自动关闭。
3. **优先级**：部署级显式 env > 允许清单/负标记 > M1 默认关闭。
4. **重置**：删 `runtime/pi-cache-key-marks.json` 对应项即可重新允许（下次 spawn 生效）。

不做 DB 字段 + admin UI：收益（按端点可视化配置）远低于成本（迁移、双端表单、与无感原则冲突）。

---

## 7. 变更清单与任务列表

### M1（本次实现）

- [x] ① `pi install npm:pi-cache-optimizer`（锁定 2.8.7）→ verify: `~/.pi/agent/npm/node_modules/pi-cache-optimizer/package.json` 存在且版本 2.8.7
- [x] ② `backend-ts/.env` 白名单追加 `pi-cache-optimizer` → verify: `PI_EXTENSIONS` 含该项（重启后生效）
- [x] ③ `workspace.ts` `chatModelEntry.compat` 写 `supportsLongCacheRetention: false`（§4.2 第 1 层）→ verify: `npx tsc --noEmit` + 装配断言（`pi-agent-workspace.test.ts`）
- [x] ④ `runner.ts` `spawnPiProcess` env 追加默认关闭注入（§4.2 第 2 层）→ verify: `npx tsc --noEmit`
- [x] ⑤ `events.ts` `message_end` 透传 `cacheRead/cacheWrite` → verify: 单测（见 §8）
- [x] ⑥ `stream.ts` `ChatStreamEvent` `token_usage` 补可选字段 → verify: `npx tsc --noEmit`
- [x] ⑦ 前端 5 文件（SSE 类型/归约/透传/渲染/DTO，§5.3）→ verify: 前端 typecheck
- [x] ⑧ 后端回归（tsc + pi 测试 + 装配断言 + RPC 冒烟 `pi-cache-optimizer-run.test.ts`）
- [ ] ⑨ 全链路实测：**需后端重启（.env 变更）+ 真实端点多轮对话**，气泡底部出现「缓存命中 X%」

### M2（暂不实现，进入 backlog）

- [ ] 允许清单文件 + spawn 读取
- [ ] 看门狗检测 + 负标记 + 进程重拉

---

## 8. 验证

### 后端

```bash
cd backend-ts
npx tsc --noEmit
npx vitest run tests/api/pi-*.test.ts
```

新增/更新单测建议：
- `workspace.ts`：装配出的 `models.json` 的 openai-completions `chatModelEntry.compat.supportsLongCacheRetention === false`（anthropic 路径不写入）；`thinkingFormat` 与既有 compat 合并不丢失。
- `events.ts`：`message_end.usage` 含 `cacheRead/cacheWrite` → `token_usage` 事件携带同值；缺失/非数值 → 归零且不产出额外事件。
- 既有 `pi-agent-run.test.ts`（真实 RPC 子进程端到端）回归，确认扩展加载不产生错误事件、`agent_settled` 正常。
- `pi-cache-optimizer-run.test.ts`（已实现）：白名单装配 + models.json compat 断言 + 真实 RPC 子进程加载扩展，正常文本轮无错误、无 400。
- 冒烟：spawn `pi --mode rpc -e <pi-cache-optimizer 目录>`，stdin 发 `{"type":"prompt","id":"p1","message":"ping"}`，断言退出码 0、stdout 有 `message_update`/`agent_settled`、stderr 无扩展错误、全程无 HTTP 400 类错误事件。

### 前端

- 前端 typecheck / build；
- 手测：真实端点（如 DeepSeek，其 usage 上报 `prompt_cache_hit_tokens`）连续多轮，首轮显示「缓存命中 0%」或隐藏，后续轮命中率上升；
- 水合：刷新后历史消息底部缓存命中与 tokens 一并保留（`/chat/session` 水合回填）。

### 无感验收

- 不改任何 DB 表 / admin 页面；
- 无任何首轮失败（pi 核心 + 扩展两条注入路径都已关闭）；
- 未运行任何 `/cache-optimizer` 命令；装配的 `models.json` 仅比改动前多一个 `compat.supportsLongCacheRetention: false`（+ 既有 thinkingFormat），无其他内容变化。
- **去掉扩展（白名单摘除）后**：新代码照常工作、零报错（§3.2）。

---

## 9. 回滚与重置

- **扩展卸载**：白名单摘除 `pi-cache-optimizer` + 重启后端；残留 `pi-cache-optimizer-stats.d` 在 `{ws}/.pi-agent/`，随会话清理（参照 README 卸载节，勿删 `models.json`）。`supportsLongCacheRetention: false` 保留亦无害（独立于扩展的保守默认）。
- **展示回滚**：还原 `events.ts` / `stream.ts` 与前端 4 文件的改动即可，扩展无需卸载。
- **env 重置**：删部署 env 的 `PI_CACHE_OPTIMIZER_NO_OPENAI_CACHE_KEY`（恢复默认关闭），或置 `0`（放开**扩展** fallback 注入）；`.env` 变更需重启后端。
- **M2 标记重置**：删 `runtime/pi-cache-key-marks.json` 对应项（如已实现）。

---

## 附：关键代码锚点

| 锚点 | 位置 |
|---|---|
| `resolvePiExtensions` / 三候选目录 | `backend-ts/src/services/pi/resolve.ts:103`（候选③ :84-86, :115-118） |
| 扩展挂载 | `backend-ts/src/services/pi/workspace.ts:247` |
| `models.json` 装配（compat 写入点） | `backend-ts/src/services/pi/workspace.ts:299-324`（`chatModelEntry` :300-313） |
| `-e` 注入 | `backend-ts/src/services/pi/runner.ts:84` |
| spawn env | `backend-ts/src/services/pi/runner.ts:190-200` |
| `message_end` → `token_usage` | `backend-ts/src/services/pi/events.ts:130-167` |
| `ChatStreamEvent.token_usage` | `backend-ts/src/modules/bookplate/stream.ts:103-110` |
| 气泡底部 token 区块 | `frontend/src/modules/bookplate/components/chat/ChatMessageItem.tsx:321-351` |
| 流式归约 | `frontend/src/modules/bookplate/piStream.ts:101/:176/:249` |
| token_usage 透传 | `frontend/src/modules/bookplate/PiChatNodeHost.tsx:612` |
| `ChatMessage.tokenUsage` | `frontend/src/platform/types/index.ts:319` |
| 扩展 cache-key 注入逻辑 | `pi-cache-optimizer/index.ts:10359-10364`、`:2103-2105` |
| 扩展 unsupported 信号模板 | `pi-cache-optimizer/index.ts:3259-3273` |
| pi 核心 `prompt_cache_key` / `prompt_cache_retention` 注入 | `@earendil-works/pi-ai/dist/api/openai-completions.js` `buildParams`（`cacheRetention==="long" && compat.supportsLongCacheRetention`） |
| pi 核心 retention 解析 | `@earendil-works/pi-ai/dist/api/*.js` `resolveCacheRetention`（env `PI_CACHE_RETENTION` → long/short；默认 `short`） |
| `supportsLongCacheRetention` 默认值 | `@earendil-works/pi-ai/dist/api/openai-completions.js`（第三方默认 true，仅 Together/Cloudflare/Nvidia/AntLing 除外） |
