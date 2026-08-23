# pi Agent Framework 集成最佳实践

> 基于源码分析与 DeepWiki 资料整理。适用版本：earendil-works/pi 最新主分支（2026-06-03 索引快照）。
> 代码示例已对照 `pi-docs-playbook-main` 中 `f429ddb` 快照校正（2026-06-01）。

---

## 目录

1. [LLM 集成](#一llm-集成最佳实践)
2. [对话历史管理](#二对话历史管理最佳实践)
3. [工具调用](#三工具调用最佳实践)
4. [子智能体](#四子智能体sub-agent最佳实践)
5. [Skill 与扩展](#五skill-和扩展extension最佳实践)
6. [架构选型总览](#六架构总览你的客户端应该怎么选)

---

## 一、LLM 集成最佳实践

### 1. 使用 `pi-ai` 的 provider 抽象层，不要直接调用 LLM API

`@earendil-works/pi-ai` 采用 **Provider Registry** 模式：

- 内置 providers（`openai-responses`、`anthropic-messages` 等）已在库内注册。
- 扩展可在运行时通过 `pi.registerProvider("my-custom-api", { baseUrl, api, apiKey, models, ... })` 注册自定义 provider，或使用 `pi.unregisterProvider("my-custom-api")` 移除已注册 provider（restores any built-in models that were overridden）。
- `getModel("anthropic", "claude-sonnet-4-20250514")` 按 provider + model id 获取已注册模型。
- 支持：OpenAI、Anthropic、Google（Gemini/Vertex）、Amazon Bedrock、Azure OpenAI、Mistral、OpenAI Codex、DeepSeek 等（详见 `source/packages/ai/README.md`）。

**实践：**

```typescript
import { streamSimple, getModel } from '@earendil-works/pi-ai';

// 用 Model 类型描述 LLM，不直接传 endpoint URL
const model = getModel("anthropic", "claude-sonnet-4-20250514");

// streamSimple 是统一入口，自动处理 provider 差异
const stream = streamSimple(model, context, options);
for await (const event of stream) {
  // 处理事件：text_start/text_delta/text_end, thinking_start/thinking_delta/thinking_end, toolcall_start/toolcall_delta/toolcall_end, done, error
}
```

### 2. 生产环境用 `streamSimple`，不用底层 `stream`

`streamSimple` 抹平了各 provider 在流式响应上的差异（thinking blocks、tool calls、prompt caching 标记）。只有需要 provider 特有控制时才用底层 `stream`。

### 3. API Key 管理

- 环境变量：各 provider 标准变量（`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` 等），详见 `source/packages/ai/README.md`。
- 扩展注册 custom provider 时，`apiKey` 字段支持字面量、环境变量插值或 shell 命令。
- SDK 使用者通过 `AuthStorage.create()` / `AuthStorage.create(path)` 管理持久化凭证，API key 存储在 `auth.json`（详见 `source/packages/coding-agent/docs/sdk.md`）。
- 生产系统使用 `AuthStorage` 抽象层，不要硬编码 API key。

### 4. Thinking Level 自动跨 Provider 映射

`pi-ai` 通过模型定义中的 `thinkingLevelMap` 将抽象 reasoning 级别映射到 provider 原生参数：

- `thinkingLevelMap` 键为 pi 级别：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`
- 值：省略（使用 provider 默认映射）、字符串（发送给 provider）、`null`（隐藏/跳过该级别）
- 切换模型时无需修改调用代码

各模型支持的级别不同，详见 `source/packages/coding-agent/docs/models.md`。

### 5. 自定义 Provider（高级场景）

通过扩展 API 注册：

```typescript
// .pi/extensions/my-extension/index.ts
export default function (pi: ExtensionAPI) {
  pi.registerProvider("my-provider", {
    name: "My Provider",
    baseUrl: "http://localhost:1234/v1",
    api: "openai-completions",
    apiKey: "$LOCAL_OPENAI_API_KEY",
    headers: { "X-Custom": "value" },
    authHeader: true,
    models: [
      {
        id: "local-model",
        name: "Local Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
  });
}
```

如果注册时提供 `models`，会**完全替换**该 provider 的现有模型；仅提供 `baseUrl` 或 `headers` 则仅 override 对应字段。

参考 `packages/coding-agent/examples/extensions/custom-provider-gitlab-duo/`。自定义 provider 也可提供自己的 `streamSimple` 实现以处理非标准流式 API。

---

## 二、对话历史管理最佳实践

### 1. 使用 `SessionManager`，不要自己维护 message 数组

```typescript
import { SessionManager } from '@earendil-works/pi-coding-agent';

// 文件-backed（生产推荐）
const sessionManager = SessionManager.create(cwd);
const existing = SessionManager.open("/path/to/session.jsonl");
const recent = SessionManager.continueRecent(cwd);
const path = sessionManager.getSessionFile();

// 内存 ephemeral（测试 / 无状态场景）
const sessionManager = SessionManager.inMemory();
```

`SessionManager` 底层使用 **JSONL append-only log**，条目通过 `id` / `parentId` 形成树，天然支持 branch / fork。

### 2. 消息转换是核心安全边界

`AgentMessage` 可以包含自定义类型。发送给 LLM 前**必须**通过 `convertToLlm()` 过滤：

```typescript
// createAgentSession 或 Agent 构造时必须提供
convertToLlm: (messages) => {
  // 过滤掉自定义消息，只返回 user / assistant / toolResult
  // 这是防止自定义数据泄露给 LLM 的唯一安全边界
}
```

### 3. 上下文压缩（Compaction）

当对话接近 context window 上限时：

- 触发：`session.compact(customInstructions?)` 手动压缩；`ctx.compact()` 在扩展中触发。
- 扩展监听 `session_before_compact` 事件，可提前保存/更新 UI 状态，或提供自定义 summary。
- 配置可在 `settings.json` 中通过 `compaction.enabled` / `compaction.reserveTokens` / `compaction.keepRecentTokens` 调整。

详见 `source/packages/coding-agent/docs/compaction.md`。

### 4. 使用 Session 树实现"尝试不同方案"

```typescript
// fork：从某条消息 entryId 创建新分支
await runtime.fork(entryId);

// 导航会话树到指定 entryId
await session.navigateTree(targetId, {
  summarize: true,
  customInstructions: "Focus on recent changes",
});
```

适合需要探索多条解决路径的场景，每个分支有独立历史。

`SessionManager` 实例上的树操作方法：`getBranch(id)`、`getTree()`、`getLeafId()`、`createBranchedSession()`。

### 5. 正确修改 AgentState.messages

`AgentState.messages` setter 会 copy 顶层数组，但返回的数组实例本身可变。

推荐操作方式：

```typescript
session.prompt("新消息");        // 添加用户消息
session.steer("纠正方向");       // 插入到下一轮 LLM 调用前
session.followUp("继续处理");    // 当前轮结束后触发新轮次
```

---

## 三、工具调用最佳实践

### 1. 用 TypeBox Schema 定义参数

```typescript
import { Type, TSchema } from 'typebox';

const SearchParams = Type.Object({
  query: Type.String({ description: "搜索关键词" }),
  limit: Type.Optional(Type.Number({ description: "最大结果数", default: 10 })),
});
```

`validateToolArguments` 在工具执行前自动校验。校验失败会作为 `isError: true` 的 tool result 返回给 LLM，允许模型自我修正。

> 与 Google API 兼容时，使用 `StringEnum`（见 `source/packages/ai/README.md`）。

### 2. 执行模式：`parallel`（默认） vs `sequential`

| 模式 | 适用场景 | 行为 |
|------|---------|------|
| `parallel`（默认） | 独立工具调用 | 并发执行，tool result 按 LLM 请求顺序 append |
| `sequential` | 有依赖的工具链 | 顺序执行，前一个完成再执行下一个 |

单个 tool 可设置 `executionMode: "sequential"`，整个批次会强制降级为顺序执行，无论全局配置如何。

### 3. Tool Result 的 `details` 字段是 opaque 的

`AgentToolResult<TDetails>` 的 `details` 仅用于 UI 展示和日志记录，**不会**发送给 LLM。不要把需要 LLM 理解的信息放在这里。

### 4. 工具拦截：beforeToolCall / afterToolCall

**方式一：AgentOptions 级别（全局、静态）**

```typescript
const agent = new Agent({
  beforeToolCall: async ({ toolCall, validatedArgs, context }) => {
    if (toolCall.name === "bash" && /rm -rf/.test(validatedArgs)) {
      return { block: true, reason: "Dangerous command blocked" };
    }
    return { proceed: true };
  },
  afterToolCall: async ({ result, isError, context }) => {
    // 可修改 content、details、isError、terminate
    return result;
  }
});
```

> `beforeToolCall` 接收 `BeforeToolCallContext`（含 `assistantMessage`、`toolCall`、`validatedArgs`、`context`），在参数校验后、执行前运行。
> `afterToolCall` 接收 `AfterToolCallContext`（含 `assistantMessage`、`toolCall`、`args`、`originalResult`、`isError`、`context`），在工具执行完毕后运行。

**方式二：扩展事件（运行时、可动态开关）**

```typescript
pi.on("tool_call", async (ctx, toolCall) => {
  if (shouldBlock(toolCall)) {
    return { block: true, reason: "Blocked by extension" };
  }
});
```

### 5. 工具返回 `terminate: true` 可以跳过后续 LLM 调用

如果**整个批次**的所有 tool 都返回 `terminate: true`，agent loop 会跳过 follow-up LLM call。适合"工具执行完毕即结束"的场景。

---

## 四、子智能体（Sub-agent）最佳实践

### 重要：pi 没有内置多智能体框架

官方唯一 sub-agent 实现是 **example extension**（`packages/coding-agent/examples/extensions/subagent/`），基于独立子进程，不是内存级调度。`packages/coding-agent` 的 README 明确说明"No sub-agents in core"。

### 架构：进程隔离 + prompt chaining

```
parent pi process
  └─ spawn child pi process (--mode json [--no-session])
       ├── 独立 context window
       ├── 独立 session（默认不持久化；--no-session 关闭 session）
       └── 独立 tool 集
```

三种模式：

1. **Single**：`{ agent: "name", task: "..." }` — 单任务委托
2. **Parallel**：`{ tasks: [{agent, task}, ...] }` — 多任务并发
3. **Chain**：`{ chain: [{agent, task}, ...] }` — 顺序执行，`{previous}` 占位符传递上一步结果

### Agent 定义文件格式

```yaml
# ~/.pi/agent/agents/scout.md
---
name: scout
description: Fast reconnaissance agent for code search
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
---
# System prompt body...
# 放在这里的内容会在子进程启动时注入为 system prompt
```

### 实现要点

- Sub-agent 使用 `pi --mode json` 启动子进程，输出为 JSONL；父进程通过解析 `message_end` / `tool_result_end` 事件收集结果。
- `scripts/session-transcripts.ts` 中的 `runSubagent()` 展示了 spawn 模式。
- 用 `AbortSignal` 传播 Ctrl+C：子进程 SIGTERM → 5s 后 SIGKILL。
- Chain 模式适合需要传递中间结果的流水线任务。

### 实践建议

- Sub-agent 适合**需要独立上下文窗口**的复杂子任务（大规模代码搜索、独立测试运行）
- 不适合高频小任务（进程 spawn 开销大）
- Chain 模式用 `{previous}` 传递中间结果，避免父进程上下文膨胀

### 如果你需要 in-memory 多智能体

pi 的设计哲学是"保持核心精简，通过扩展实现复杂功能"。如果需要真正的多智能体协作（共享状态、消息传递、内存级调度），你需要：

1. 基于 `Agent` 类自己构建调度层
2. 或使用 process-per-agent 模式（参考 subagent extension）

---

## 五、Skill 和扩展（Extension）最佳实践

### 1. Skill 结构（Markdown + YAML frontmatter）

```
my-skill/
  SKILL.md          ← 必须有
  helper.py         ← 可选辅助脚本
  reference.md      ← 可选参考文档
  scripts/          ← 可选脚本目录
```

**命名规则：** 小写字母 + 数字 + 连字符，≤64 字符，无首尾/连续连字符。

**必需 frontmatter：**

```yaml
---
name: my-skill
description: 一句话描述这个技能的作用和适用场景
---
```

- `description` 为 1024 字符内描述，缺失则该 skill 不加载；越精确，LLM 选工具的准确率越高。
- **pi 不要求 skill 的 `name` 与父目录名称一致**（不同于 Agent Skills 标准）。
- 可选字段：`license`、`compatibility`、`metadata`、`allowed-tools`、`disable-model-invocation`（设为 `true` 则该 skill 从 system prompt 隐藏，只能通过 `/skill:name` 显式调用）。

### 2. Skill 发现优先级（高 → 低）

| Rank | 来源 | 路径 | 说明 |
|------|------|------|------|
| 0 | 项目本地显式声明 | `--skill <path>` / `settings.json` `prompts` 或 `skills` | 最高优先级 |
| 1 | 项目本地自动发现 | `.pi/skills/`、`.agents/skills/`（向上遍历目录树） | 直接 `.md` 文件也可作为独立 skill |
| 2 | 用户全局显式声明 | `--skill <path>` / `settings.json` | |
| 3 | 用户全局自动发现 | `~/.pi/agent/skills/` | |
| 4 | npm package 内置 | `package.json` 的 `pi.skills` 字段 | fallback |

Skill discovery 递归检查目录下是否存在 `SKILL.md` 来定义 skill root；在 skill 目录内，`SKILL.md` 中引用脚本或资源时使用相对路径。

### 3. Skill 的两种使用方式

- **系统 prompt 注册**：Skill 列表（name + description）自动注入 system prompt，LLM 知道"有什么技能可用"；`disable-model-invocation: true` 除外。
- **按需加载**：`/skill:name` 触发时才加载完整 `SKILL.md` 内容，节省 context window；调用时 `/skill:name arg1 arg2` 会在 skill 内容后追加 `User: arg1 arg2`。

**实践：** 把技能的完整工作流、代码片段、参考文档放在 `SKILL.md` 中，让 LLM 按需查阅。

### 4. Extension 开发模式

Extension 是 TypeScript 模块，使用 `jiti` 动态加载（无需编译）：

```typescript
// .pi/extensions/my-extension/index.ts
export default function (pi: ExtensionAPI) => {
  // 生命周期事件
  pi.on("session_start", (ctx) => {
    console.log("Session started in", ctx.cwd);
  });

  // 注册工具
  pi.registerTool({
    name: "my_tool",
    description: "Does something useful",
    parameters: MyToolParams,
    execute: async (id, params, signal) => {
      // 实现
      return { content: "result" };
    }
  });

  // 注册 slash command
  pi.registerCommand("my-cmd", {
    description: "My custom command",
    execute: async (args, ctx) => {
      ctx.sendMessage("Command executed");
    }
  });

  // 注册自定义 provider
  pi.registerProvider("my-provider", { /* ... */ });
};
```

自定义工具推荐先使用 `defineTool()`（`source/packages/coding-agent/src/core/sdk.ts`）。

### 5. 扩展生命周期事件（常用）

| 事件 | 用途 |
|------|------|
| `session_start` | 初始化扩展状态 |
| `session_shutdown` | 扩展清理 |
| `session_before_switch` | 切换 session 前 |
| `before_agent_start` | 修改 system prompt、注入消息 |
| `before_provider_request` | 拦截 LLM 请求（日志、修改） |
| `turn_start` / `turn_end` | 跟踪 agent 执行周期 |
| `tool_call` | 拦截/审计/阻止工具执行（返回 `{ block: true }`） |
| `tool_result` | 修改 tool result |
| `message_start` / `message_end` | 跟踪消息流 |
| `resources_discover` | 扩展贡献额外 skill/prompt/theme 路径 |
| `session_before_compact` | 压缩前准备 |
| `session_compact` | 压缩后恢复 |

### 6. 扩展 UI 交互

`ExtensionUIContext` 可通过 `ctx.ui` 访问；`ctx.mode` 和 `ctx.hasUI` 用于判断当前是否支持 UI 交互。

```typescript
pi.on("tool_call", async (ctx, toolCall) => {
  if (toolCall.name === "my_tool") {
    // 文本输入
    const text = await ctx.ui.input("输入内容");
    // 多行编辑器
    const code = await ctx.ui.editor("编辑代码", prefill);
    // 弹出确认框
    const confirmed = await ctx.ui.confirm("确认执行？", "确定要执行此操作吗？");
    if (!confirmed) return { block: true };

    // 显示选择列表
    const choice = await ctx.ui.select("选择一个选项", ["a", "b", "c"]);

    // 非阻塞通知
    ctx.ui.notify("处理中...", "info");

    // 设置状态栏
    ctx.ui.setStatus("处理中...");
    ctx.ui.setWorkingMessage("思考中...");
    ctx.ui.setTitle("pi - 自定义标题");

    // 设置 widget
    ctx.ui.setWidget("my-widget", ["line1", "line2"]);

    // 自定义 footer / header
    ctx.ui.setFooter((tui, theme) => /* ... */);
    ctx.ui.setHeader((tui, theme) => /* ... */);

    // 隐藏 thinking 标签
    ctx.ui.setHiddenThinkingLabel("推理中");
  }
});
```

`ExtensionUIContext` 支持 `AbortSignal` 取消，大部分 dialog 方法支持 `timeout` 选项；RPC 模式下 dialog 方法通过 `extension_ui_request` 协议与客户端通信。

### 7. 扩展状态持久化

**non-LLM 状态**（不进入上下文）使用 `pi.appendEntry`，签名：`pi.appendEntry(customType: string, data?: object)`。

```typescript
// 写入 session JSONL
pi.appendEntry("my-extension-state", { lastAction: "xxx", timestamp: Date.now() });

// 读取（通过 customType 过滤，非 key）
const entries = ctx.sessionManager.getEntries();
const myState = entries.find(e => e.type === "custom" && e.customType === "my-extension-state");
```

**LLM 可见消息**使用 `pi.sendMessage`：

```typescript
pi.sendMessage(
  { customType: "my-extension", content: "Message text", display: true, details: {} },
  { triggerTurn: true, deliverAs: "steer" }
);
```

状态恢复通常在 `session_start` 事件中完成。

### 8. ExtensionContext 完整属性

`ExtensionContext`（即事件处理器接收的 `ctx`）提供：

- `ui`: `ExtensionUIContext`（UI 操作）
- `mode`: `"tui" | "rpc" | "json" | "print"`
- `hasUI`: 是否有 dialog 能力的 UI（TUI/RPC = `true`，print/json = `false`）
- `cwd`: 当前工作目录
- `sessionManager`: 只读访问 SessionManager（`getEntries()`、`getBranch()`、`getLeafId()` 等）
- `modelRegistry`: 用于 API key 解析和模型信息访问
- `model`: 当前活跃模型
- `isIdle()`: 返回 agent 是否处于空闲状态
- `signal`: 当前 agent turn 的 `AbortSignal`，用于嵌套的异步操作
- `abort()`: 结束当前 agent turn
- `hasPendingMessages()`: 是否有排队等待 agent 处理的消息
- `shutdown()`: 请求优雅关闭 pi
- `getContextUsage()`: 返回当前模型上下文使用量
- `compact()`: 触发 compaction
- `getSystemPrompt()`: 返回当前有效 system prompt

**ExtensionCommandContext**（用户触发的命令中使用）额外提供：`waitForIdle()`、`newSession()`、`fork()`、`navigateTree()`、`switchSession()`、`reload()`。

### 9. Extension API 完整列表（pi）

除上已列事件订阅与注册方法外，ExtensionAPI 还提供：

- `pi.exec(command, opts?)`: 执行 shell 命令，opts 支持 `{ signal, timeout, cwd }`
- `pi.sendMessage()`: 注入消息到会话
- `pi.appendEntry()`: 持久化自定义条目
- `pi.events`: 跨扩展事件总线
- `pi.setModel(model)`: 切换模型
- `pi.getThinkingLevel() / pi.setThinkingLevel()`: 读写 reasoning 级别
- `pi.getActiveTools() / pi.setActiveTools() / pi.getAllTools()`: 管理活跃工具集
- `pi.registerShortcut()`: 注册键盘快捷键
- `pi.registerFlag()`: 注册 CLI flag
- `pi.registerMessageRenderer()`: 自定义消息渲染

### 10. 热重载

开发时用 `/reload`；`ctx.reload()` 会触发 `session_shutdown` → 资源重新加载 → `session_start` + `resources_discover`，`ExtensionRuntime` 自动处理 stale state。

---

## 六、架构总览：你的客户端应该怎么选

```
你的客户端软件
        │
        ├── Node.js 环境，深度集成 ──→ 直接用 @earendil-works/pi-coding-agent SDK
        │       └── createAgentSession() + 自定义 ResourceLoader
        │
        ├── 需要进程隔离 ──→ RPC mode（pi --mode rpc + RpcClient）
        │       └── JSONL over stdin/stdout，跨语言友好
        │
        ├── 基于 pi CLI 扩展 ──→ Extension + Skill
        │       └── 放在 .pi/extensions/、.pi/skills/
        │
        └── Web 前端 ──→ @earendil-works/pi-web-ui（Lit 组件）
```

### SDK 最小集成示例

```typescript
import { createAgentSession, defineTool, SessionManager } from '@earendil-works/pi-coding-agent';
import { getModel } from '@earendil-works/pi-ai';

const myCustomTool = defineTool({
  name: "my_tool",
  description: "Does something useful",
  parameters: Type.Object({
    input: Type.String({ description: "Input value" }),
  }),
  execute: async (_toolCallId, params) => ({
    content: [{ type: "text", text: `Result: ${params.input}` }],
    details: {},
  }),
});

const { session } = await createAgentSession({
  cwd: process.cwd(),
  model: getModel("anthropic", "claude-sonnet-4-20250514"),
  sessionManager: SessionManager.inMemory(),
  tools: ["read", "write", "edit", "bash"],
  customTools: [myCustomTool],
});

// 发送 prompt；订阅事件用于 UI 实时更新
session.subscribe((event) => {
  switch (event.type) {
    case "text_delta":       console.log(event.delta); break;
    case "thinking_delta":   console.log("[thinking]", event.delta); break;
    case "tool_call":        console.log("调用工具:", event.toolName); break;
    case "tool_execution_end": console.log("工具结果:", event.result); break;
    case "agent_end":        console.log("完成"); break;
  }
});

const result = await session.prompt("帮我分析这个项目");
```

### RPC 最小集成示例（跨语言 / 隔离）

```typescript
import { RpcClient } from '@earendil-works/pi-coding-agent';

const client = new RpcClient();
await client.start();
client.onEvent((event) => {
  // 处理 AgentEvent
});
await client.send("prompt", { text: "帮我分析这个项目" });
```

---

## 关键注意事项

1. **不要修改 `packages/ai/src/models.generated.ts` 直接**，更新 `scripts/generate-models.ts` 后重新生成
2. **工具参数 schema 用 TypeBox**，不要手写 JSON Schema；Google API 兼容时使用 `StringEnum`
3. **自定义消息类型**：通过 `AgentOptions.convertToLlm` 过滤，这是唯一安全边界
4. **Session 持久化**：生产环境用 `SessionManager.create(cwd)`，测试/无状态用 `inMemory()`；可用 `continueRecent(cwd)` 恢复最近会话
5. **扩展热重载**：开发时用 `/reload`，`ExtensionRuntime` 自动处理 stale state
6. **工具执行默认 parallel**，有依赖的工具链用 `sequential`，单个 tool 可强制降级
7. **Sub-agent 基于子进程**，不是内存级调度，高频场景慎用
8. **Skill 不要求 `name` 与目录同名**；直接 `.md` 文件也可作为独立 skill；`disable-model-invocation: true` 从 system prompt 隐藏 skill，仅 `/skill:name` 调用
9. **Prompt Template 参数语法**：`$1`、`$2`、`$@`、`${@:N}`、`${@:N:L}`
10. **Context Files**：向上遍历目录树发现 `AGENTS.md` / `CLAUDE.md`，项目级 `SYSTEM.md` / `APPEND_SYSTEM.md`，可用 `--no-context-files` 禁用
11. **RPC 协议**：`0.16.0` 实现完全重写；使用 JSONL over stdin/stdout，命令通过 `RpcCommand` 发送，事件流式返回

---

## 参考资源

- DeepWiki: http://deepwiki.com/earendil-works/pi
- 官方文档: https://pi.dev/docs/latest
- SDK 文档: `source/packages/coding-agent/docs/sdk.md`
- 扩展文档: `source/packages/coding-agent/docs/extensions.md`
- Skills 文档: `source/packages/coding-agent/docs/skills.md`
- RPC 文档: `source/packages/coding-agent/docs/rpc.md`
- Compaction 文档: `source/packages/coding-agent/docs/compaction.md`
- Models 文档: `source/packages/coding-agent/docs/models.md`
- SDK 示例: `packages/coding-agent/examples/sdk/`
- 扩展示例: `packages/coding-agent/examples/extensions/`
- 子智能体示例: `packages/coding-agent/examples/extensions/subagent/`
