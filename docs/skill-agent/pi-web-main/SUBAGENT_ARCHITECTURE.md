# Pi Web Subagent 架构文档

> 本文档整理自 `pi-web-main` 项目源码，覆盖子代理系统的完整前后端逻辑、数据流和 UI 组件交互。

---

## 目录

1. [系统总览](#1-系统总览)
2. [核心数据模型](#2-核心数据模型)
3. [后端架构](#3-后端架构)
   - 3.1 [子代理 Profile 管理](#31-子代理-profile-管理)
   - 3.2 [子代理 Extension 工具注册](#32-子代理-extension-工具注册)
   - 3.3 [子代理运行时 Controller](#33-子代理运行时-controller)
   - 3.4 [Session 启动与资源隔离](#34-session-启动与资源隔离)
   - 3.5 [后台运行与结果通知](#35-后台运行与结果通知)
   - 3.6 [内置开关与冲突压制](#36-内置开关与冲突压制)
4. [API 路由](#4-api-路由)
5. [前端架构](#5-前端架构)
   - 5.1 [Session 家族分组](#51-session-家族分组)
   - 5.2 [侧边栏与 Agent 切换面板](#52-侧边栏与-agent-切换面板)
   - 5.3 [消息流中的子代理工具调用渲染](#53-消息流中的子代理工具调用渲染)
   - 5.4 [配置面板 AgentsConfig](#54-配置面板-agentsconfig)
6. [完整数据流](#6-完整数据流)
7. [文件索引](#7-文件索引)

---

## 1. 系统总览

Pi Web 的子代理系统允许主 session 将任务委派给隔离的子 session。每个子代理拥有独立的上下文、工具集和系统提示词，可以前台（阻塞等待结果）或后台（异步运行）执行。

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React)                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │ SessionSidebar│  │AgentSession  │  │  MessageView      │ │
│  │ (家族分组)    │  │  Panel       │  │  (Agent工具卡片)  │ │
│  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘ │
│         │                 │                    │             │
│  ┌──────┴─────────────────┴────────────────────┴──────────┐ │
│  │            useAgentSession (SSE + 状态管理)             │ │
│  └────────────────────────┬───────────────────────────────┘ │
└───────────────────────────┼─────────────────────────────────┘
                            │ HTTP / SSE
┌───────────────────────────┼─────────────────────────────────┐
│  Next.js Server           │                                 │
│  ┌────────────────────────┴───────────────────────────────┐ │
│  │              API Routes                                 │ │
│  │  /api/subagents/settings    (GET/PUT)  内置开关         │ │
│  │  /api/subagents/profiles    (GET/PUT/PATCH/DELETE)     │ │
│  │  /api/subagents/[id]        (GET/POST) steer/abort     │ │
│  │  /api/sessions/[id]         (GET) 含 subagent relation │ │
│  └────────────────────────┬───────────────────────────────┘ │
│                           │                                 │
│  ┌────────────────────────┴───────────────────────────────┐ │
│  │         rpc-manager.ts                                  │ │
│  │  ┌────────────────────┐  ┌─────────────────────────┐   │ │
│  │  │ AgentSessionWrapper│  │ SUBAGENT_CONTROLLER      │   │ │
│  │  │ (主 session)       │  │ createSubagentController │   │ │
│  │  └────────┬───────────┘  └──────────┬──────────────┘   │ │
│  └───────────┼──────────────────────────┼─────────────────┘ │
│              │                          │                   │
│  ┌───────────┴──────────────────────────┴─────────────────┐ │
│  │         subagent-runtime.ts                             │ │
│  │  • resolveSubagentProfile()                             │ │
│  │  • createAgentSessionServices() → 子 session            │ │
│  │  • resourceSnapshot → 持久化工具/资源策略                │ │
│  │  • notifyParent() → 完成后通知主 session                 │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  lib/subagents.ts                                        ││
│  │  • SubagentProfile (YAML frontmatter 解析)              ││
│  │  • BUILTIN_PROFILES: general-purpose / explore / plan   ││
│  │  • Profile 来源: builtin → global → workspace → project ││
│  │  • readSubagentSessionResources() — 恢复持久化快照      ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

---

## 2. 核心数据模型

### 2.1 SubagentProfile（定义一个子代理类型）

```typescript
// lib/subagents.ts
interface SubagentProfile {
  name: string;           // 唯一标识，如 "explore", "reviewer"
  displayName: string;    // UI 显示名
  description: string;    // 描述
  systemPrompt: string;   // 子代理的系统提示词
  tools: string[];        // 允许的工具列表，如 ["read", "bash", "grep"]
  loadSkills: boolean;    // 是否加载 skills
  loadExtensions: boolean;// 是否加载 extensions
  model?: string;         // 可选的模型覆盖
  thinking?: ThinkingLevel;// 思考级别
  maxTurns?: number;      // 最大轮次限制
  inheritContext: boolean;// 是否继承父 session 上下文
  runInBackground: boolean;// 默认后台运行
  enabled: boolean;       // 是否启用
  scope: SubagentScope;   // "builtin" | "global" | "workspace" | "project"
  filePath?: string;      // 配置文件路径
}
```

**内置 Profile（不可修改）：**

| Profile | 描述 | 工具 |
|---------|------|------|
| `general-purpose` | 通用任务执行 | read, bash, edit, write, grep, find, ls |
| `explore` | 代码探索（只读） | read, grep, find, ls |
| `plan` | 方案设计（只读） | read, grep, find, ls |

**Profile 来源优先级（高→低）：**
1. `builtin` — 内置三个固定 profile
2. `global` — `~/.pi/agent/agents/*.md`
3. `workspace` — `<cwd>/.agents/agents/*.md`
4. `project` — `<cwd>/.pi/agents/*.md`

同名 profile 高优先级覆盖低优先级。

### 2.2 SubagentMetadata（写入子 session 的 JSONL 元数据）

```typescript
// lib/subagents.ts
interface SubagentMetadata {
  version: 1;
  parentSessionId: string;      // 父 session ID
  parentSessionPath: string;    // 父 session JSONL 路径
  parentToolCallId: string;     // 触发子代理的工具调用 ID
  profile: string;              // 使用的 profile 名称
  description: string;          // UI 显示描述
  task: string;                 // 委派的任务文本
  runInBackground: boolean;     // 是否后台运行
  createdAt: string;            // ISO 时间戳
  resourceSnapshot: SubagentResourceSnapshot; // 资源快照
}
```

### 2.3 SubagentResourceSnapshot（资源策略持久化）

```typescript
// lib/subagents.ts
interface SubagentResourceSnapshot {
  version: 1;
  appendSystemPrompt: string[]; // 追加的系统提示词
  tools: string[];              // 活跃工具列表
  loadSkills: boolean;          // 是否加载 skills
  loadExtensions: boolean;      // 是否加载 extensions
}
```

> 这个快照确保子代理 session 重新打开时，资源策略与创建时一致，不依赖当前的 profile 配置。

### 2.4 SubagentRunInfo（运行时状态）

```typescript
// lib/subagents.ts
interface SubagentRunInfo {
  sessionId: string;
  sessionPath: string;
  parentSessionId: string;
  parentToolCallId: string;
  profile: string;
  description: string;
  task: string;
  runInBackground: boolean;
  status: SubagentSessionStatus; // "starting" | "running" | "completed" | "failed" | "aborted" | "interrupted"
  createdAt: string;
  completedAt?: string;
  result?: string;     // 最终文本输出
  error?: string;      // 失败时的错误信息
}
```

### 2.5 SessionInfo.relation（前端展示用的关联关系）

```typescript
// lib/types.ts
interface SessionInfo {
  // ...其他字段
  relation?:
    | { kind: "fork"; originSessionId?: string }
    | {
        kind: "subagent";
        parentSessionId: string;
        profile: string;
        description: string;
        status: SubagentSessionStatus;
      };
}
```

---

## 3. 后端架构

### 3.1 子代理 Profile 管理

**文件：`lib/subagents.ts`**

Profile 以 `.md` 文件形式存储，使用 YAML frontmatter 定义配置：

```markdown
---
description: Code review agent
display_name: Reviewer
tools: read, bash, grep
load_skills: false
load_extensions: false
enabled: true
inherit_context: false
run_in_background: false
---

You are a code reviewer. Analyze the diff and provide feedback.
```

**关键函数：**

| 函数 | 作用 |
|------|------|
| `listSubagentProfiles(cwd)` | 合并所有来源的 profile，去重（高优先级覆盖） |
| `listSubagentProfileSources(cwd)` | 列出所有来源（含被覆盖的），用于 UI 展示来源 |
| `resolveSubagentProfile(cwd, name)` | 按名称查找已启用的 profile |
| `saveSubagentProfile(cwd, scope, profile)` | 保存 profile 到指定 scope |
| `deleteSubagentProfile(cwd, scope, name)` | 删除 profile |
| `readSubagentSessionResources(entries)` | 从 JSONL entries 恢复 resourceSnapshot |
| `readSubagentRun(entries, sessionId, path)` | 从 JSONL entries 恢复 SubagentRunInfo |

### 3.2 子代理 Extension 工具注册

**文件：`lib/subagent-extension.ts`**

以 **inline hidden extension** 形式注册三个工具：

```typescript
createSubagentExtension(runtime, getProfiles, isEnabled): InlineExtension
```

| 工具名 | 作用 | 参数 |
|--------|------|------|
| `Agent` | 委派任务给子代理 | `subagent_type`, `prompt`, `input_files`, `description`, `run_in_background`, `model`, `thinking`, `max_turns`, `inherit_context` |
| `get_subagent_result` | 查询子代理结果 | `agent_id`, `wait` |
| `steer_subagent` | 向运行中的子代理注入消息 | `agent_id`, `message` |

**`Agent` 工具执行流程：**

1. 调用 `runtime.start(request)` 启动子代理
2. 如果 `runInBackground`，立即返回并异步等待完成
3. 否则 `await execution.completion` 阻塞等待
4. 返回结果文本和 `SubagentToolDetails` 详情

**工具详情类型（传递给前端渲染）：**

```typescript
interface SubagentToolDetails {
  kind: "pi-web-subagent";
  sessionId: string;
  profile: string;
  description: string;
  status: SubagentRunInfo["status"];
  runInBackground: boolean;
  createdAt: string;
  completedAt?: string;
  error?: string;
}
```

### 3.3 子代理运行时 Controller

**文件：`lib/subagent-runtime.ts`**

`createSubagentController(dependencies)` 是核心控制器，管理子代理的完整生命周期。

**依赖注入：**

```typescript
interface SubagentRuntimeDependencies {
  getSession(sessionId): HostSession | undefined;
  registerSession(inner, options): void;       // 注册子 session 到全局 registry
  reopenSession(sessionId, sessionFile): Promise<HostSession>;
  resolveSessionPath(sessionId): Promise<string | null>;
  invalidateSessionList(): void;               // 刷新侧边栏列表
  isBuiltInSubagentsEnabled?(): boolean;
}
```

**`start()` 方法的完整流程：**

```
start(request)
  │
  ├─ 1. 检查内置开关是否启用
  │
  ├─ 2. 获取父 session，验证其存活且已持久化
  │
  ├─ 3. reserveSubagentSlot() — 并发控制（最多 4 个）
  │
  ├─ 4. resolveSubagentProfile() — 解析 profile
  │
  ├─ 5. 构建 promptPlan（chatOnly / appendSystemPrompt / delegatedTask）
  │
  ├─ 6. loadSubagentInputFiles() — 加载 input_files（最多 8 个，总 512KB）
  │
  ├─ 7. createAgentSessionServices() — 创建子 session 的服务层
  │     ├─ resourceLoaderOptions.noExtensions = !profile.loadExtensions
  │     ├─ resourceLoaderOptions.noSkills = !profile.loadSkills
  │     ├─ resourceLoaderOptions.appendSystemPrompt = promptPlan.appendSystemPrompt
  │     └─ resourceLoaderReloadOptions = projectTrustReloadOptions()（如果加载扩展）
  │
  ├─ 8. withSubagentExtensionTools() — 合并扩展工具，排除保留工具名
  │
  ├─ 9. SessionManager.create(cwd, undefined, { parentSession: parent.sessionFile })
  │
  ├─ 10. 写入 SUBAGENT_META_TYPE 自定义条目到 JSONL
  │
  ├─ 11. createAgentSessionFromServices() — 创建子 AgentSession
  │     └─ excludeTools: [...SUBAGENT_CONTROL_TOOL_NAMES]  // 防止嵌套
  │
  ├─ 12. registerSession(inner) — 注册到全局 registry
  │
  ├─ 13. 订阅 turn_end 事件，实现 maxTurns 软/硬限制
  │
  └─ 14. 启动异步 prompt()，完成后：
        ├─ 写入 SUBAGENT_RESULT_TYPE 到 JSONL
        ├─ 更新 stored.run 状态
        ├─ invalidateSessionList()
        └─ 返回 SubagentRunInfo
```

**并发控制：**

```typescript
const MAX_CONCURRENT_SUBAGENTS = 4;

function reserveSubagentSlot(parentSessionId: string): () => void {
  // 检查当前父 session 下活跃 + 正在启动的子代理数量
  // 超过限制抛出错误
  // 返回 releaseSlot 回调
}
```

### 3.4 Session 启动与资源隔离

**文件：`lib/rpc-manager.ts` — `startRpcSession()`**

当 `startRpcSession()` 检测到 session 是子代理（通过 `readSubagentSessionResources()`），会应用资源快照：

```typescript
const subagentResources = sessionFile
  ? readSubagentSessionResources(sessionManager.getEntries())
  : null;

// 资源加载策略
const resourceLoaderOptions = subagentResources
  ? {
      noExtensions: !subagentResources.loadExtensions,
      noSkills: !subagentResources.loadSkills,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      appendSystemPrompt: subagentResources.appendSystemPrompt,
    }
  : chatOnly
    ? CHAT_ONLY_RESOURCE_LOADER_OPTIONS
    : { /* 正常 session，加载 extension factories */ };

// 工具集
const selectedToolNames = subagentResources?.tools ?? persistedToolNames ?? requestedToolNames;

// 排除保留工具（防止嵌套子代理）
...(subagentResources ? { excludeTools: [...SUBAGENT_CONTROL_TOOL_NAMES] } : {});
```

**关键安全约束：**
- 子代理 session 始终排除 `Agent`, `get_subagent_result`, `steer_subagent` 工具
- 子代理 session 不加载 prompt templates、themes、context files
- 资源快照一旦写入，无法通过 UI 修改工具选择

### 3.5 后台运行与结果通知

**后台运行流程：**

```
Agent tool (runInBackground: true)
  │
  ├─ 立即返回 "Subagent started in background. Session ID: xxx"
  │
  ├─ 异步 execution.completion.then(runtime.notifyParent)
  │
  └─ notifyParent(run):
       ├─ 获取/重新打开父 session
       ├─ await parent.waitUntilReady()
       └─ parent.inner.sendCustomMessage({
            customType: "pi-web:subagent-notification",
            content: subagentFinalText(run),
            display: true,
            details: subagentToolDetails(run),
          }, { deliverAs: "followUp", triggerTurn: true })
```

**abort 机制：**

```typescript
// subagent-runtime.ts
async function abort(sessionId: string): Promise<void> {
  const wrapper = dependencies.getSession(sessionId);
  if (!wrapper?.isAlive() || !wrapper.isRunning()) throw new Error("Subagent is not running");
  const stored = getSubagentRuns().get(sessionId);
  if (stored) stored.abortRequested = true;
  await wrapper.inner.abort();
}

// 父 session 中断时也会触发子代理 abort
const handleParentAbort = () => {
  stored.abortRequested = true;
  void inner.abort();
};
request.signal?.addEventListener("abort", handleParentAbort, { once: true });
```

### 3.6 内置开关与冲突压制

**文件：`lib/subagent-settings.ts`**

```typescript
interface SubagentSettings {
  builtInEnabled: boolean;  // 默认 false
}

// 持久化位置
// ~/.pi/agent/agents/settings.json
// { "version": 1, "builtInEnabled": true }
```

**冲突压制（`preferPiWebSubagentExtension` in `subagent-extension.ts`）：**

当内置子代理启用时：
1. 扫描所有已加载扩展
2. 识别包名为 `pi-subagents` 且注册了 `Agent`/`get_subagent_result`/`steer_subagent` 的扩展
3. 从扩展列表中移除这些冲突扩展
4. 清除相关的冲突诊断错误

当内置子代理禁用时：
- 不压制任何扩展，用户可通过 Plugins 设置管理第三方子代理扩展

---

## 4. API 路由

### 4.1 `GET/PUT /api/subagents/settings`

读取/写入内置子代理开关。

```
GET  → { enabled: boolean }
PUT  → { enabled: boolean }  (body: { enabled: boolean })
```

### 4.2 `GET/PUT/PATCH/DELETE /api/subagents/profiles`

管理子代理 profile。

```
GET  ?cwd=<path>          → { profiles: SubagentProfile[] }  // 所有来源
PUT                        → { profile: SubagentProfile }     // 创建/更新
  body: { cwd, scope, profile: { name, displayName, ... } }
PATCH                      → { profile: SubagentProfile }     // 切换 enabled
  body: { cwd, scope, name, enabled }
DELETE                     → { ok: true }                     // 删除
  body: { cwd, scope, name }
```

### 4.3 `GET/POST /api/subagents/[id]`

查询/控制子代理运行。

```
GET  → { run: SubagentRunInfo }              // 查询状态
POST → { action: "steer", message: "..." }   // 注入消息
POST → { action: "abort" }                   // 终止
```

### 4.4 `GET /api/sessions/[id]`

返回 session 详情，子代理 session 会包含 `relation` 字段：

```json
{
  "relation": {
    "kind": "subagent",
    "parentSessionId": "xxx",
    "profile": "explore",
    "description": "Explore auth flow",
    "status": "completed"
  }
}
```

---

## 5. 前端架构

### 5.1 Session 家族分组

**文件：`lib/session-family.ts`**

将所有 session 按家族分组：主 session + 其所有子代理后代。

```typescript
interface SessionFamily {
  root: SessionInfo;        // 主 session
  subagents: SessionInfo[]; // 所有子代理（含嵌套）
  latestModified: string;   // 家族中最近修改时间
}

function listSessionFamilies(sessions: SessionInfo[]): SessionFamily[]
function getSessionFamily(sessions, sessionId): SessionFamily | null
```

**分组算法：**
1. 遍历所有 session，非 subagent 的作为 root
2. 遍历 subagent session，通过 `relation.parentSessionId` 向上追溯到 root
3. 使用路径压缩缓存根查找结果，处理嵌套子代理

### 5.2 侧边栏与 Agent 切换面板

**文件：`components/AppShell.tsx`**

```typescript
const activeSessionFamily = useMemo(
  () => getSessionFamily(sessions, selectedSessionId),
  [sessions, selectedSessionId]
);

const hasSubagentSessions = Boolean(activeSessionFamily?.subagents.length);
```

**文件：`components/AgentSessionPanel.tsx`**

弹出式面板，展示当前 session 家族中的所有 agent：

```
┌─────────────────────────────┐
│  Main                       │
│  explore · 2 min ago        │
│  ↳ running ●               │
├─────────────────────────────┤
│  Reviewer                   │
│  reviewer · 5 min ago       │
│  ✓ completed                │
├─────────────────────────────┤
│  General purpose            │
│  general-purpose · 1 min ago│
│  ↳ running ●               │
└─────────────────────────────┘
```

每个 `AgentRow` 展示：
- 图标：主 session（人形）/ 子代理（机器人）
- 主标题：主 session 名称 / 子代理 description
- 副标题：profile 名称 + 相对时间
- 状态图标：spin（运行中）/ ✓（完成）/ ✗（失败）/ ■（中断）

### 5.3 消息流中的子代理工具调用渲染

**文件：`components/MessageView.tsx`**

当 assistant 消息包含 `Agent` 工具调用时，`ToolCallBlock` 组件会检测 `result.details` 中的子代理信息：

```typescript
function isSubagentToolDetails(value: unknown): value is SubagentToolDetails {
  if (!value || typeof value !== "object") return false;
  const details = value as Partial<SubagentToolDetails>;
  return details.kind === "pi-web-subagent" && typeof details.sessionId === "string";
}
```

**渲染效果：**

```
┌──────────────────────────────────────────┐
│ Agent  Explore the auth flow (running) 12s│ ◀── 工具名 + 描述 + 状态
│                               [↗ Open]    │ ◀── 打开子代理 session 按钮
├──────────────────────────────────────────┤
│ ▼ 展开的输入参数 (可折叠)                  │
│ { "prompt": "...", "description": "..." } │
└──────────────────────────────────────────┘
```

点击 `[↗ Open]` 按钮会调用 `onOpenSession(subagent.sessionId)` 切换到子代理 session。

### 5.4 配置面板 AgentsConfig

**文件：`components/AgentsConfig.tsx`**

完整的 profile 管理 UI，包含：

1. **内置开关**：`GET/PUT /api/subagents/settings` 控制 `builtInEnabled`
2. **Profile 列表**：按 scope 分组显示，支持创建/编辑/删除
3. **Profile 编辑器**：
   - 基本信息：name, displayName, description, systemPrompt
   - 工具选择：checkbox 选择 read/bash/edit/write/grep/find/ls
   - 资源加载：loadSkills, loadExtensions 开关
   - 行为配置：inheritContext, runInBackground, enabled
   - 高级选项：model, thinking, maxTurns

**Scope 可写性：**
- `builtin` — 不可编辑/删除
- `global` — 可编辑/删除（`~/.pi/agent/agents/`）
- `workspace` — 只读（`.agents/agents/`）
- `project` — 可编辑/删除（`.pi/agents/`）

---

## 6. 完整数据流

### 6.1 用户发起子代理委派

```
1. 用户在 ChatInput 输入消息
   ↓
2. POST /api/agent/[id] → startRpcSession() → session.prompt()
   ↓
3. 模型决定调用 Agent 工具
   ↓
4. subagent-extension.ts → runtime.start(request)
   ↓
5. subagent-runtime.ts:
   a. 验证内置开关
   b. 获取父 session
   c. reserveSubagentSlot() 并发检查
   d. resolveSubagentProfile()
   e. buildSubagentPromptPlan()
   f. createAgentSessionServices() — 资源隔离
   g. SessionManager.create() + appendCustomEntry(SUBAGENT_META)
   h. createAgentSessionFromServices() — 创建子 session
   i. registerSession(inner) — 注册到全局 registry
   j. inner.prompt(delegatedTask) — 启动子代理运行
   ↓
6. 子代理运行期间：
   a. turn_end 事件 → maxTurns 软/硬限制检查
   b. SSE 事件流 → 前端实时更新
   ↓
7. 子代理完成：
   a. 写入 SUBAGENT_RESULT_TYPE 到 JSONL
   b. invalidateSessionList() → 侧边栏刷新
   c. 返回 SubagentRunInfo 给 Agent 工具
   ↓
8. Agent 工具返回结果 → assistant 消息中包含 toolResult
   ↓
9. MessageView 检测 SubagentToolDetails → 渲染带 [↗ Open] 按钮的卡片
```

### 6.2 后台子代理完成通知

```
1. 子代理 prompt() 完成
   ↓
2. notifyParent(run):
   a. 获取/重新打开父 session
   b. sendCustomMessage({
        customType: "pi-web:subagent-notification",
        content: subagentFinalText(run),
        deliverAs: "followUp",
        triggerTurn: true
      })
   ↓
3. 父 session 收到 followUp 消息
   ↓
4. SSE 推送 agent_start 事件 → 前端进入流式状态
   ↓
5. 模型处理通知消息 → 可能继续对话
```

### 6.3 侧边栏展示

```
1. GET /api/sessions → 所有 session 列表
   ↓
2. 每个 session 的 relation 字段标识 subagent 关系
   ↓
3. listSessionFamilies() 分组：
   - 非 subagent → SessionFamily.root
   - subagent → 追溯到 root → SessionFamily.subagents[]
   ↓
4. SessionSidebar 渲染：
   - Root session 行
   - 展开显示子代理行（过滤 relation.kind !== "subagent" 的行不显示在主列表）
   ↓
5. AgentSessionPanel（点击 Agents 按钮弹出）：
   - 展示当前家族的所有 session
   - 主 session + 所有子代理
   - 每个子代理显示 profile、描述、状态、时间
```

### 6.4 重新打开子代理 Session

```
1. 用户点击 [↗ Open] 或从侧边栏选择子代理 session
   ↓
2. GET /api/sessions/[id] → 读取 JSONL
   ↓
3. readSubagentSessionResources() → 从 SUBAGENT_META 恢复 resourceSnapshot
   ↓
4. startRpcSession():
   a. 检测到 subagentResources
   b. 应用快照的 tools / loadSkills / loadExtensions
   c. excludeTools: [...SUBAGENT_CONTROL_TOOL_NAMES]
   d. 不加载正常 session 的 extension factories
   ↓
5. 子代理 session 以相同的资源策略重新激活
```

---

## 7. 文件索引

### 后端核心

| 文件 | 职责 |
|------|------|
| `lib/subagents.ts` | Profile 管理、元数据读写、JSONL 解析 |
| `lib/subagent-extension.ts` | Extension 工具注册（Agent / get_subagent_result / steer_subagent） |
| `lib/subagent-runtime.ts` | 运行时 Controller：start / get / steer / abort / notifyParent |
| `lib/subagent-settings.ts` | 内置开关读写（`~/.pi/agent/agents/settings.json`） |
| `lib/subagent-prompt.ts` | 构建 promptPlan（chatOnly / appendSystemPrompt / delegatedTask） |
| `lib/subagent-input.ts` | 加载 input_files（路径安全、大小限制） |
| `lib/rpc-manager.ts` | AgentSessionWrapper 管理、SUBAGENT_CONTROLLER 实例化、startRpcSession 资源隔离 |
| `lib/session-family.ts` | Session 家族分组算法 |
| `lib/session-reader.ts` | Session 列表读取（含 subagent relation 解析） |
| `lib/types.ts` | SubagentSessionStatus、SessionInfo.relation、ExtensionUiRequest 等类型定义 |

### 后端 API

| 路由 | 方法 | 作用 |
|------|------|------|
| `app/api/subagents/settings/route.ts` | GET/PUT | 内置开关 |
| `app/api/subagents/profiles/route.ts` | GET/PUT/PATCH/DELETE | Profile CRUD |
| `app/api/subagents/[id]/route.ts` | GET/POST | 子代理状态查询 / steer / abort |
| `app/api/sessions/[id]/route.ts` | GET | Session 详情（含 subagent relation） |

### 前端组件

| 文件 | 职责 |
|------|------|
| `components/AgentsConfig.tsx` | Profile 管理面板（创建/编辑/删除 + 内置开关） |
| `components/AgentSessionPanel.tsx` | Agent 切换面板（主 session + 子代理列表） |
| `components/MessageView.tsx` | ToolCallBlock 渲染子代理工具调用 + [↗ Open] 按钮 |
| `components/AppShell.tsx` | 集成 AgentSessionPanel、管理 activeSessionFamily |
| `components/SessionSidebar.tsx` | 侧边栏 session 树（含子代理层级展示） |

### 测试文件

| 文件 | 覆盖范围 |
|------|----------|
| `lib/subagent-runtime.test.mjs` | Controller 创建、session 注册、resourceSnapshot 持久化 |
| `lib/rpc-manager.test.mjs` | 资源加载策略、工具选择、子代理工具排除 |
| `lib/session-family.test.mjs` | 家族分组、嵌套子代理、孤儿/循环元数据处理 |
| `lib/session-reader.test.mjs` | subagent relation 读取、终端状态 |
| `components/AgentSessionPanel.test.mjs` | 排序、搜索、running 优先 |
| `components/AgentsConfig.test.mjs` | 内置开关、profile 编辑 |
| `components/MessageView.test.mjs` | 子代理工具调用渲染、[↗ Open] 按钮 |
| `components/AppShell.mobile-toolbar.test.mjs` | 移动端 Agents 切换器显示条件 |
| `app/api/subagents/settings/route.test.mjs` | 设置 API |
| `app/api/subagents/profiles/route.test.mjs` | Profile API |
| `app/api/subagents/runtime-route.test.mjs` | 子代理控制 API（steer/abort） |

### ADR 文档

| 文件 | 内容 |
|------|------|
| `docs/adr/0002-chat-only-tool-selection.md` | Chat-only 模式的资源策略、持久化机制、子代理资源快照 |
| `docs/adr/0003-built-in-subagent-toggle.md` | 内置开关的设计、与第三方扩展的冲突处理优先级 |
