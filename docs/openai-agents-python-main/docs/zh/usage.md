---
search:
  exclude: true
---
# 用量

Agents SDK 会自动追踪每次运行的 token 用量。你可以从运行上下文中访问这些信息，并用其监控成本、实施限制或记录分析数据。

## 追踪内容

- **requests**：发起的 LLM API 调用次数
- **input_tokens**：发送的输入 token 总数
- **output_tokens**：接收的输出 token 总数
- **total_tokens**：输入 + 输出
- **request_usage_entries**：每个请求的用量明细列表
- **details**：
  - `input_tokens_details.cached_tokens`
  - `input_tokens_details.cache_write_tokens`
  - `output_tokens_details.reasoning_tokens`

## 从运行中访问用量

执行 `Runner.run(...)` 后，通过 `result.context_wrapper.usage` 访问用量。

```python
result = await Runner.run(agent, "What's the weather in Tokyo?")
usage = result.context_wrapper.usage

print("Requests:", usage.requests)
print("Input tokens:", usage.input_tokens)
print("Output tokens:", usage.output_tokens)
print("Total tokens:", usage.total_tokens)
```

用量会汇总运行期间的所有模型调用，包括生成工具调用或任务转移的模型调用。

### 为第三方适配器启用用量统计

不同第三方适配器和提供商后端的用量报告方式有所不同。如果你通过第三方适配器访问模型，并且需要准确的 `result.context_wrapper.usage` 值：

- 使用 `AnyLLMModel` 时，如果上游提供商返回用量信息，该信息会自动传递。通过 Chat Completions 后端进行流式响应时，可能需要设置 `ModelSettings(include_usage=True)`，以发送用量数据块。
- 使用 `LitellmModel` 时，某些提供商后端默认不报告用量，因此通常需要设置 `ModelSettings(include_usage=True)`。

请查看模型指南中[第三方适配器](models/index.md#third-party-adapters)部分的适配器特定说明，并在计划部署的具体提供商后端上验证用量报告。

## 按请求追踪用量

SDK 会自动在 `request_usage_entries` 中追踪每个 API 请求的用量，这有助于详细计算成本和监控上下文窗口消耗。

```python
result = await Runner.run(agent, "What's the weather in Tokyo?")

for i, request in enumerate(result.context_wrapper.usage.request_usage_entries):
    print(f"Request {i + 1}: {request.input_tokens} in, {request.output_tokens} out")
```

## 提供商用量有效载荷的保留

Agents SDK 会将提供商用量标准化为 [`Usage`][agents.usage.Usage] 字段，从而在不同模型提供商之间提供一致的总量。当应用必须保留提供商特定的用量字段，或需要区分字段被省略与提供商报告值为零时，请将 [`ModelSettings.preserve_raw_usage`][agents.model_settings.ModelSettings.preserve_raw_usage] 设置为 `True`：

```python
from agents import Agent, ModelSettings, Runner

agent = Agent(
    name="Assistant",
    model_settings=ModelSettings(preserve_raw_usage=True),
)
result = await Runner.run(agent, "What's the weather in Tokyo?")

for response in result.raw_responses:
    print(response.raw_usage)
```

Agents SDK 会将每个 [`ModelResponse.raw_usage`][agents.items.ModelResponse.raw_usage] 值存储为该模型调用的提供商有效载荷的独立、兼容 JSON 的快照。Agents SDK 不会在整个运行期间汇总 `raw_usage`。当禁用保留功能、提供商未返回用量有效载荷，或上游适配器已经丢弃原始字段存在性信息时，该值会保持为 `None`。

`preserve_raw_usage` 仅保留已传递至模型适配器的用量有效载荷；该设置不会向提供商请求用量信息。当流式 Chat Completions 提供商要求显式请求用量信息时，还需设置 `ModelSettings(include_usage=True)`。

目前，无论是流式还是非流式运行，`LitellmModel` 都不会填充 `ModelResponse.raw_usage`，因此 `preserve_raw_usage=True` 对该适配器不起作用。使用 `LitellmModel` 时，请继续使用标准化的 [`Usage`][agents.usage.Usage] 字段；如果需要保留提供商特定字段的存在性信息，请选择支持保留原始用量的适配器。

## 通过会话访问用量

使用 `Session`（例如 `SQLiteSession`）时，每次调用 `Runner.run(...)` 都会返回该次特定运行的用量。会话会保留对话历史以提供上下文，但每次运行的用量彼此独立。

```python
session = SQLiteSession("my_conversation")

first = await Runner.run(agent, "Hi!", session=session)
print(first.context_wrapper.usage.total_tokens)  # Usage for first run

second = await Runner.run(agent, "Can you elaborate?", session=session)
print(second.context_wrapper.usage.total_tokens)  # Usage for second run
```

请注意，虽然会话会在不同运行之间保留对话上下文，但每次调用 `Runner.run()` 返回的用量指标仅代表该次执行。在会话中，先前的消息可能会在每次运行时再次作为输入提供，这会影响后续轮次的输入 token 数量。

## 在钩子中使用用量

如果你使用 `RunHooks`，传递给每个钩子的 `context` 对象都包含 `usage`。借助该对象，你可以在关键生命周期节点记录用量。

```python
class MyHooks(RunHooks):
    async def on_agent_end(self, context: RunContextWrapper, agent: Agent, output: Any) -> None:
        u = context.usage
        print(f"{agent.name} → {u.requests} requests, {u.total_tokens} total tokens")
```

## API 参考

有关详细的 API 文档，请参阅：

-   [`Usage`][agents.usage.Usage] - 用量追踪数据结构
-   [`RequestUsage`][agents.usage.RequestUsage] - 按请求统计的用量详情
-   [`RunContextWrapper`][agents.run.RunContextWrapper] - 从运行上下文中访问用量
-   [`RunHooks`][agents.run.RunHooks] - 接入用量追踪生命周期