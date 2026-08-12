---
search:
  exclude: true
---
# 发布流程/变更日志

本项目采用略作修改的语义化版本控制，格式为 `0.Y.Z`。开头的 `0` 表示 SDK 仍在快速演进。各组成部分按以下方式递增：

## 次版本（`Y`）

对于任何未标记为 beta 的公共接口发生的**破坏性变更**，我们将递增次版本号 `Y`。例如，从 `0.0.x` 升级到 `0.1.x` 时可能包含破坏性变更。

如果不希望引入破坏性变更，建议在项目中固定使用 `0.0.x` 版本。

## 补丁版本（`Z`）

对于非破坏性变更，我们将递增 `Z`：

-   Bug 修复
-   新功能
-   私有接口变更
-   beta 功能更新

## 破坏性变更日志

### 0.20.0

0.20.0 版本包含一项可能具有破坏性的 MCP 依赖迁移，会影响自定义本地 MCP HTTP 传输的应用程序。它还更新了智能体或运行未显式选择模型时使用的 SDK 默认模型。

重点：

-   SDK 默认模型现已从 `gpt-5.4-mini` 改为 `gpt-5.6-luna`。默认的 `reasoning.effort="none"` 和 `verbosity="low"` 设置保持不变。
-   显式指定的智能体模型、运行级模型覆盖项以及 `OPENAI_DEFAULT_MODEL` 环境变量仍优先于 SDK 默认值。
-   Realtime 输入转录设置现在可识别 `gpt-transcribe`、`gpt-live-transcribe` 和 `gpt-realtime-whisper`。对于低延迟 `gpt-live-transcribe` 会话，嵌套的 `audio.input.transcription` 设置可以提供 `prompt`、`keywords` 和多个预期的 `languages`。此 SDK 固定使用的 OpenAI 客户端版本仅在搭配 `gpt-realtime-whisper` 时支持 `delay` 延迟/准确度级别。通过 WebSocket 使用 `gpt-transcribe`，可在已提交音频轮次后进行转录或输出检测到的语言。显式设置 `audio.input.turn_detection=None` 会禁用自动轮次检测。请参阅[输入转录设置](realtime/guide.md#input-transcription-settings)。
-   Agents SDK 创建的本地 MCP 连接现在支持 MCP Python SDK v2，同时通过 `mcp>=1.19.0,<3` 保持对 v1 的兼容性。Agents SDK 会自动适配普通的 stdio、SSE 和 Streamable HTTP 连接。安装 MCP v2 后，这些连接会使用 `mcp.Client(mode="auto")` 探测最新的受支持协议，并针对旧版服务器回退到传统的 `initialize` 握手。如果依赖解析选择了 MCP v2，提供自定义 `httpx.Auth` 对象或 `httpx.AsyncClient` 工厂的应用程序必须将这些值迁移至 `httpx2`，或者固定使用 `mcp<2` 以保留 v1 HTTP 栈。`MCPServerStreamableHttp` 的 `params["ignore_initialized_notification_failure"] = True` 选项也仍然仅支持 v1。有关迁移详情，请参阅[MCP Python SDK v1 和 v2](mcp.md#mcp-python-sdk-v1-and-v2)。
-   沙盒挂载验证现在会在产生沙盒或挂载辅助程序的副作用之前，拒绝不安全的凭据放置。可信应用程序可以针对准确的容器内挂载路径，确认挂载范围内或更广泛的凭据暴露，而无需更改存储能力表。这些确认仅在运行时有效，序列化后的沙盒状态本身绝不会授予凭据权限。在受保护的挂载边界处，SDK 会返回一个全新的、经过脱敏的异常。如果源异常是完全匹配的、可识别的 SDK 沙盒错误，且其获准的结构化字段通过验证，则替代异常会保留该子类型和已验证的安全字段。可识别的 `MountConfigError` 还可以保留由 SDK 生成的安全验证消息。否则，SDK 会返回一个全新的通用脱敏错误。由提供商控制或未经批准的消息、命令数据、注释、上下文、原因及源回溯状态均不会保留。请参阅[挂载与远程存储](sandbox/clients.md#mounts-and-remote-storage)和[从会话状态恢复](sandbox/guide.md#resume-from-session-state)。
-   重试策略可以检查稳定的重放安全事实，并针对提供商标记为不安全的非流式请求显式设置 `RetryDecision(approve_unsafe_replay=True)`。此批准不会绕过中止、已发出的流式输出或单独的本地副作用否决机制，例如程序化工具调用。请参阅[由 Runner 管理的重试](models/index.md#runner-managed-retries)。
-   可恢复的 `RunState` 对象现在可以在下一次模型调用前使用 `add_input()` 暂存持久用户输入。暂存的输入会在序列化后保留、经过输入安全防护措施，并在本地会话和服务器管理的对话中生成一次持久的 SDK 输入记录。经过显式批准的不安全重放仍可能向提供商重新发送输入，并重复提供商侧的工作。请参阅[恢复前添加输入](results.md#add-input-before-resuming)。
-   运行时可靠性修复统一了流式与非流式的[输出安全防护措施会话持久化](guardrails.md#output-guardrails)，在复制和命名空间处理期间保留 `FunctionTool` 子类，并针对[不受支持的 Chat Completions 音频输出](models/index.md#chat-completions-compatibility-options)抛出明确错误，而不是静默完成空流。`OpenAIResponsesCompactionSession` 包装器会在取消传递至调用方前，尝试并等待[压缩前的历史记录恢复](sessions/index.md#auto-compaction-can-block-streaming)。[`VoicePipeline`](voice/pipeline.md#results) 使用方现在会在正常运行结束后收到转录会话关闭失败，而较早发生的轮次失败仍优先于之后发生的关闭失败。`RunState` 往返转换现在会保留本地 shell 输出、已确认的计算机安全检查、采用默认值的工具输出字段，以及遍历字典、列表或元组时遇到的 Pydantic 模型或 dataclass 输出。MCP 转换会保留自由格式对象 schema 和图像输出，并将音频块、资源块等其他原始内容块序列化为有效的 JSON 文本。`MCPServerManager` 会对重叠的生命周期操作进行串行化，并为连接和清理应用有限的默认超时时间。模型重放会先从输出项中移除服务器所有的 `created_by` 元数据，再将其用作输入。

### 0.19.0

此次次版本发布**未**引入破坏性变更。次版本号递增反映了一项重要的 OpenAI Responses 新功能领域：程序化工具调用。

重点：

-   新增 [`ProgrammaticToolCallingTool`][agents.tool.ProgrammaticToolCallingTool]，使受支持的 OpenAI Responses 模型能够生成 JavaScript，以协调符合程序化工具调用条件的工具。它支持每个工具的 `allowed_callers`、来自 `FunctionTool` 实例的 structured outputs，以及与 Runner 流式传输、安全防护措施、批准、会话和 `RunState` 的集成。有关设置和限制，请参阅[程序化工具调用](tools.md#programmatic-tool-calling)。
-   新增公共 `agents.decorators` 模块和 `@tool`，后者是现有 `@function_tool` 装饰器的较短别名，与现有安全防护措施装饰器并列提供。`FunctionTool` 实例现在也支持异步可调用对象。
-   SDK 配置现在可在智能体、运行、模型、会话、沙盒和语音管线中统一接受类型化设置对象或字典，并会验证未知设置。
-   加强了模型、工具、MCP、Realtime、会话、沙盒和追踪中的错误与诊断日志记录，在保留有用调试上下文的同时，避免暴露原始敏感载荷。
-   改进了 AnyLLM、LiteLLM 和 Chat Completions 兼容性，在模型重试期间保留会话历史记录，并针对响应开始前发生的 WebSocket 过载添加了提供商重试指引，使选择启用的 Runner 重试策略能够在获准时重放失败的尝试。
-   通过 `VercelCloudBucketMountStrategy` 新增[只能在创建 Vercel 沙盒时配置的 S3 挂载](sandbox/clients.md#mounts-and-remote-storage)。具有挂载的会话不会将存储桶内容纳入工作区持久化，并且有意不支持动态挂载变更或会话恢复。

### 0.18.0

此次次版本发布**未**引入破坏性变更。次版本号递增仅用于 Realtime 智能体默认模型更新。

重点：

-   Realtime 智能体现在使用 `gpt-realtime-2.1` 作为默认模型，因此新的 Realtime 设置无需额外配置即可使用最新的推荐模型。

### 0.17.0

在此版本中，沙盒本地源具体化会将 `LocalFile.src` 和 `LocalDir.src` 限制在具体化 `base_dir` 内，除非源路径由 `Manifest.extra_path_grants` 覆盖。应用清单时，`base_dir` 是 SDK 进程的当前工作目录；相对本地源会从该目录解析，而绝对本地源必须已经位于该目录内或处于显式授权范围内。此项变更修复了本地工件边界问题，但可能影响有意将该基础目录之外的可信主机文件或目录复制到沙盒工作区的应用程序。

若要迁移，请使用 `SandboxPathGrant` 在清单级别授权可信主机根目录；如果沙盒只需读取这些文件，最好将其设为只读：

```python
from pathlib import Path

from agents.sandbox import Manifest, SandboxPathGrant
from agents.sandbox.entries import Dir, LocalDir

# This is an absolute host path outside the SDK process base_dir.
TRUSTED_DOCS_ROOT = Path("/opt/my-app/docs")

manifest = Manifest(
    extra_path_grants=(
        # This host root is outside the SDK process base_dir, so the manifest must grant it.
        SandboxPathGrant(path=str(TRUSTED_DOCS_ROOT), read_only=True),
    ),
    entries={
        # No grant is needed for local sources that stay under the SDK process base_dir.
        "fixtures": LocalDir(src=Path("fixtures"), description="Local test fixtures."),
        # This entry reads from the granted host root and copies it into the sandbox workspace.
        "docs": LocalDir(src=TRUSTED_DOCS_ROOT, description="Trusted local documents."),
        # Dir creates a sandbox workspace directory; it does not read from the host filesystem.
        "output": Dir(description="Generated artifacts."),
    },
)
```

应将 `extra_path_grants` 视为可信应用程序配置。除非应用程序已经批准相关主机路径，否则不要根据模型输出或其他不可信的清单输入填充授权项。

### 0.16.0

在此版本中，SDK 默认模型现已从 `gpt-4.1` 改为 `gpt-5.4-mini`。这会影响未显式设置模型的智能体和运行。由于新的默认模型是 GPT-5 模型，隐式默认模型设置现在包含 `reasoning.effort="none"` 和 `verbosity="low"` 等 GPT-5 默认值。

如果需要保留此前的默认模型行为，请在智能体或运行配置中显式设置模型，或设置 `OPENAI_DEFAULT_MODEL` 环境变量：

```python
agent = Agent(name="Assistant", model="gpt-4.1")
```

重点：

-   `Runner.run`、`Runner.run_sync` 和 `Runner.run_streamed` 现在接受 `max_turns=None`，以禁用轮次限制。
-   在本地、Docker 和提供商支持的各种沙盒实现中，沙盒工作区水合现在会拒绝包含指向归档根目录之外的符号链接的 tar 归档，包括目标为绝对路径的符号链接。

### 0.15.0

在此版本中，模型拒绝现在会显式呈现为 `ModelRefusalError`，而不再被视为空文本输出；对于 structured outputs，也不再导致运行循环持续重试直至 `MaxTurnsExceeded`。

这会影响此前预期仅包含拒绝的模型响应以 `final_output == ""` 完成的代码。若要处理拒绝而不抛出异常，请提供 `model_refusal` 运行错误处理程序：

```python
result = Runner.run_sync(
    agent,
    input,
    error_handlers={"model_refusal": lambda data: data.error.refusal},
)
```

对于使用 structured outputs 的智能体，该处理程序可以返回与智能体输出 schema 匹配的值，SDK 会像验证其他运行错误处理程序的最终输出一样对其进行验证。

### 0.14.0

此次次版本发布**未**引入破坏性变更，但新增了一个重要的 beta 功能领域：沙盒智能体，以及在本地、容器化和托管环境中使用它们所需的运行时、后端和文档支持。

重点：

-   新增以 `SandboxAgent`、`Manifest` 和 `SandboxRunConfig` 为核心的 beta 沙盒运行时接口，使智能体能够在支持文件、目录、Git 仓库、挂载、快照和恢复的持久隔离工作区中工作。
-   通过 `UnixLocalSandboxClient` 和 `DockerSandboxClient` 新增用于本地和容器化开发的沙盒执行后端，并通过 Python 包中的可选依赖 extras，为 Blaxel、Cloudflare、Daytona、E2B、Modal、Runloop 和 Vercel 提供托管提供商集成。
-   新增沙盒记忆支持，使未来运行能够复用此前运行中的经验，并支持渐进式披露、多轮分组、可配置的隔离边界，以及包括 S3 支持工作流在内的持久化记忆代码示例。
-   新增更广泛的工作区和恢复模型，包括本地与合成工作区条目、S3/R2/GCS/Azure Blob Storage/S3 Files 的远程存储挂载、可移植快照，以及通过 `RunState`、`SandboxSessionState` 或已保存快照实现的恢复流程。
-   在 `examples/sandbox/` 下新增大量沙盒代码示例和教程，涵盖使用技能、任务转移和记忆的编码任务，特定于提供商的设置，以及代码审查、数据室问答和网站克隆等端到端工作流。
-   扩展核心运行时和追踪栈，增加可感知沙盒的会话准备、能力绑定、状态序列化、统一追踪、提示词缓存键默认值，以及更安全的敏感 MCP 输出脱敏。

### 0.13.0

此次次版本发布**未**引入破坏性变更，但包含一项重要的 Realtime 默认值更新，以及新的 MCP 功能和运行时稳定性修复。

重点：

-   默认 WebSocket Realtime 模型现为 `gpt-realtime-1.5`，因此新的 Realtime 智能体设置无需额外配置即可使用较新的模型。
-   `MCPServer` 现在会公开 `list_resources()`、`list_resource_templates()` 和 `read_resource()`，而 `MCPServerStreamableHttp` 现在会公开 `session_id`，从而使使用 MCP Streamable HTTP 传输的会话能够在重新连接后或无状态工作进程之间恢复。
-   Chat Completions 集成现在可以通过 `should_replay_reasoning_content` 选择重新发送现有推理内容，从而改进 LiteLLM/DeepSeek 等适配器中特定于提供商的推理/工具调用连续性。
-   修复了若干运行时和会话边界情况，包括 `SQLAlchemySession` 中并发的首次写入、移除推理内容后存在孤立 assistant 消息 ID 的压缩请求、`remove_all_tools()` 遗留 MCP/推理项，以及 `FunctionTool` 实例批量执行器中的竞争条件。

### 0.12.0

此次次版本发布**未**引入破坏性变更。有关重要功能新增内容，请查看[发布说明](https://github.com/openai/openai-agents-python/releases/tag/v0.12.0)。

### 0.11.0

此次次版本发布**未**引入破坏性变更。有关重要功能新增内容，请查看[发布说明](https://github.com/openai/openai-agents-python/releases/tag/v0.11.0)。

### 0.10.0

此次次版本发布**未**引入破坏性变更，但为 OpenAI Responses 用户新增了一个重要功能领域：Responses API 的 WebSocket 传输支持。

重点：

-   为 OpenAI Responses 模型新增 WebSocket 传输支持（需选择启用；HTTP 仍为默认传输方式）。
-   新增 `responses_websocket_session()` 辅助程序 / `ResponsesWebSocketSession`，用于在多轮运行中复用支持 WebSocket 的共享提供商和 `RunConfig`。
-   新增 WebSocket 流式传输代码示例（`examples/basic/stream_ws.py`），涵盖流式传输、工具、批准和后续轮次。

### 0.9.0

在此版本中，不再支持 Python 3.9，因为此主要版本已于三个月前终止生命周期。请升级到较新的运行时版本。

此外，`Agent#as_tool()` 方法返回值的类型提示已从 `Tool` 收窄为 `FunctionTool`。此变更通常不会引发破坏性问题，但如果代码依赖范围更广的联合类型，可能需要进行一些相应调整。

### 0.8.0

在此版本中，两项运行时行为变更可能需要迁移：

- `FunctionTool` 实例包装的**同步** Python 可调用对象现在会通过 `asyncio.to_thread(...)` 在工作线程上执行，而不再在事件循环线程上运行。如果工具逻辑依赖线程局部状态或具有线程亲和性的资源，请迁移到异步工具实现，或在工具代码中明确处理线程亲和性。
- 本地 MCP 工具失败处理现在可配置，默认行为可以返回模型可见的错误输出，而不是使整个运行失败。如果依赖快速失败语义，请设置 `mcp_config={"failure_error_function": None}`。服务器级 `failure_error_function` 值会覆盖智能体级设置，因此请在每个具有显式处理程序的本地 MCP 服务器上设置 `failure_error_function=None`。

### 0.7.0

在此版本中，有几项行为变更可能影响现有应用程序：

- 嵌套任务转移历史记录现在需要**选择启用**（默认禁用）。如果依赖 v0.6.x 中默认启用的嵌套行为，请显式设置 `RunConfig(nest_handoff_history=True)`。
- `gpt-5.1` / `gpt-5.2` 的默认 `reasoning.effort` 已更改为 `"none"`（此前默认值为 SDK 默认配置的 `"low"`）。如果提示词或质量/成本配置依赖 `"low"`，请在 `model_settings` 中显式设置它。

### 0.6.0

在此版本中，默认任务转移历史记录现在会打包为一条 assistant 消息，而不再将用户和 assistant 轮次作为单独消息传递，从而为下游智能体提供简洁且可预测的回顾
- 现有的单消息任务转移记录现在默认在 `<CONVERSATION HISTORY>` 块之前以确切的字面文本 `For context, here is the conversation so far between the user and the previous agent:` 开头，从而为下游智能体提供带有明确标签的回顾

### 0.5.0

此版本未引入任何可见的破坏性变更，但包含新功能和一些重要的底层更新：

- 在 `RealtimeRunner` 中新增对处理 [SIP 协议连接](https://platform.openai.com/docs/guides/realtime-sip)的支持。
- 大幅修订 `Runner#run_sync` 的内部逻辑，以兼容 Python 3.14

### 0.4.0

在此版本中，不再支持 [openai](https://pypi.org/project/openai/) 包的 v1.x 版本。请将 openai v2.x 与此 SDK 配合使用。

### 0.3.0

在此版本中，Realtime API 支持迁移至 gpt-realtime 模型及其 API 接口（GA 版本）。

### 0.2.0

在此版本中，少数原本接受 `Agent` 作为参数的位置，现改为接受 `AgentBase`。例如，这适用于 MCP 服务器中的 `list_tools()` 方法签名。这只是类型层面的变更，仍会收到 `Agent` 对象。更新时，只需将 `Agent` 替换为 `AgentBase`，以修复类型错误。

### 0.1.0

在此版本中，[`MCPServer.list_tools()`][agents.mcp.server.MCPServer] 新增两个参数：`run_context` 和 `agent`。需要将这些参数添加到 `MCPServer` 子类中所有被覆盖的 `MCPServer.list_tools()` 方法。