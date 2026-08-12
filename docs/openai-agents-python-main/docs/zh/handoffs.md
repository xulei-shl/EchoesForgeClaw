---
search:
  exclude: true
---
# 任务转移

任务转移允许一个智能体将任务委派给另一个智能体。这在不同智能体分别擅长不同领域的场景中特别有用。例如，一个客户支持应用可能包含多个智能体，分别专门处理订单状态、退款、常见问题等任务。

任务转移以工具的形式呈现给LLM。因此，如果任务转移的目标是名为 `Refund Agent` 的智能体，则该工具将命名为 `transfer_to_refund_agent`。

## 任务转移的创建

所有智能体都有一个 [`handoffs`][agents.agent.Agent.handoffs] 参数，该参数既可以直接接收 `Agent`，也可以接收用于自定义任务转移的 `Handoff` 对象。

如果传入普通的 `Agent` 实例，则其 [`handoff_description`][agents.agent.Agent.handoff_description]（如果已设置）会附加到默认工具描述中。可使用该属性提示模型应在何时选择该任务转移，而无需编写完整的 `handoff()` 对象。

你可以使用 Agents SDK 提供的 [`handoff()`][agents.handoffs.handoff] 函数创建任务转移。此函数允许你指定任务要转移到的智能体，以及可选的覆盖项和输入过滤器。

### 基本用法

以下是创建简单任务转移的方法：

```python
from agents import Agent, handoff

billing_agent = Agent(name="Billing agent")
refund_agent = Agent(name="Refund agent")

# (1)!
triage_agent = Agent(name="Triage agent", handoffs=[billing_agent, handoff(refund_agent)])
```

1. 你可以直接使用智能体（如 `billing_agent`），也可以使用 `handoff()` 函数。

### 通过 `handoff()` 函数自定义任务转移

[`handoff()`][agents.handoffs.handoff] 函数支持自定义以下内容。

-   `agent`：任务将转移到的智能体。
-   `tool_name_override`：默认使用 `Handoff.default_tool_name()` 函数，其解析结果为 `transfer_to_<agent_name>`。你可以覆盖此设置。
-   `tool_description_override`：覆盖来自 `Handoff.default_tool_description()` 的默认工具描述。
-   `on_handoff`：调用任务转移时执行的回调函数。它适用于在确认调用任务转移后立即启动数据获取等操作。此函数接收智能体上下文，还可以选择接收LLM生成的输入。输入数据由 `input_type` 参数控制。
-   `input_type`：任务转移工具调用参数的 schema。设置后，解析后的载荷将传递给 `on_handoff`。
-   `input_filter`：用于过滤下一个智能体接收的输入。详见下文。
-   `is_enabled`：是否启用任务转移。该值可以是布尔值，也可以是返回布尔值的函数，因此你可以在运行时动态启用或禁用任务转移。
-   `nest_handoff_history`：针对单次任务转移，对 RunConfig 级别 `nest_handoff_history` 设置的可选覆盖。如果为 `None`，则改用当前运行配置中定义的值。

[`handoff()`][agents.handoffs.handoff] 辅助函数始终将控制权转移给你所传入的特定 `agent`。如果有多个可能的目标，请为每个目标注册一个任务转移，并让模型从中选择。仅当你自己的任务转移代码必须在调用时决定返回哪个智能体时，才使用自定义的 [`Handoff`][agents.handoffs.Handoff]。

```python
from agents import Agent, handoff, RunContextWrapper

def on_handoff(ctx: RunContextWrapper[None]):
    print("Handoff called")

agent = Agent(name="My agent")

handoff_obj = handoff(
    agent=agent,
    on_handoff=on_handoff,
    tool_name_override="custom_handoff_tool",
    tool_description_override="Custom description",
)
```

## 任务转移输入

在某些情况下，你希望LLM在调用任务转移时提供一些数据。例如，假设要将任务转移给“升级处理智能体”。你可能希望模型提供原因，以便记录日志。

```python
from pydantic import BaseModel

from agents import Agent, handoff, RunContextWrapper

class EscalationData(BaseModel):
    reason: str

async def on_handoff(ctx: RunContextWrapper[None], input_data: EscalationData):
    print(f"Escalation agent called with reason: {input_data.reason}")

agent = Agent(name="Escalation agent")

handoff_obj = handoff(
    agent=agent,
    on_handoff=on_handoff,
    input_type=EscalationData,
)
```

`input_type` 描述任务转移工具调用本身的参数。SDK 会将该 schema 作为任务转移工具的 `parameters` 提供给模型，在本地验证返回的 JSON，并将解析后的值传递给 `on_handoff`。

它不会替换下一个智能体的主要输入，也不会选择不同的目标。[`handoff()`][agents.handoffs.handoff] 辅助函数仍会将任务转移给你封装的特定智能体，而接收智能体仍会看到对话历史记录，除非你通过 [`input_filter`][agents.handoffs.Handoff.input_filter] 或嵌套任务转移历史记录设置对其进行更改。

`input_type` 也独立于 [`RunContextWrapper.context`][agents.run_context.RunContextWrapper.context]。`input_type` 应用于模型在任务转移时决定的元数据，而不是你已在本地拥有的应用状态或依赖项。

### `input_type` 的适用场景

当任务转移需要少量由模型生成的元数据（例如 `reason`、`language`、`priority` 或 `summary`）时，请使用 `input_type`。例如，分流智能体可以通过 `{ "reason": "duplicate_charge", "priority": "high" }` 将任务转移给退款智能体，而 `on_handoff` 可以在退款智能体接管之前记录或持久化该元数据。

如果目标不同，请选择其他机制：

-   将现有应用状态和依赖项放入 [`RunContextWrapper.context`][agents.run_context.RunContextWrapper.context]。请参阅[上下文指南](context.md)。
-   如果要更改接收智能体看到的历史记录，请使用 [`input_filter`][agents.handoffs.Handoff.input_filter]、[`RunConfig.nest_handoff_history`][agents.run.RunConfig.nest_handoff_history] 或 [`RunConfig.handoff_history_mapper`][agents.run.RunConfig.handoff_history_mapper]。
-   如果存在多个可能的专业智能体，请为每个目标注册一个任务转移。`input_type` 可以向所选任务转移添加元数据，但不会在不同目标之间进行分派。
-   如果希望在不转移对话的情况下为嵌套的专业智能体提供结构化输入，建议使用 [`Agent.as_tool(parameters=...)`][agents.agent.Agent.as_tool]。请参阅[工具](tools.md#structured-input-for-tool-agents)。

## 输入过滤器

发生任务转移时，就像新智能体接管了对话，并且可以查看此前的完整对话历史记录。如果要更改这一行为，可以设置 [`input_filter`][agents.handoffs.Handoff.input_filter]。输入过滤器是一个函数，它通过 [`HandoffInputData`][agents.handoffs.HandoffInputData] 接收现有输入，并且必须返回新的 `HandoffInputData`。

[`HandoffInputData`][agents.handoffs.HandoffInputData] 包括：

-   `input_history`：`Runner.run(...)` 启动之前的输入历史记录。
-   `pre_handoff_items`：调用任务转移的智能体轮次之前生成的项目。
-   `new_items`：当前轮次期间生成的项目，包括任务转移调用和任务转移输出项目。
-   `input_items`：可选项目，用于转发给下一个智能体以代替 `new_items`，从而可以过滤模型输入，同时保持会话历史记录中的 `new_items` 不变。
-   `run_context`：调用任务转移时处于活动状态的 [`RunContextWrapper`][agents.run_context.RunContextWrapper]。

嵌套任务转移历史记录以选择加入的测试版功能提供，在我们使其达到稳定状态期间，默认处于禁用状态。启用 [`RunConfig.nest_handoff_history`][agents.run.RunConfig.nest_handoff_history] 后，运行器会将可总结的历史记录压缩为有序的助手摘要片段，同时将无损消息项目保留在原始位置。每个生成的摘要片段都使用 `<CONVERSATION HISTORY>` 包装器，后续任务转移会先展开此前生成的片段，再重新构建有序的对话记录。会话、`RunState` 和 `RunResult.to_input_list()` 会追踪已移入此 SDK 默认历史记录的确切消息实例，以免重复追加这些实例；不同但内容相同的消息仍会保留。你可以通过 [`RunConfig.handoff_history_mapper`][agents.run.RunConfig.handoff_history_mapper] 提供自己的映射函数，返回下一个智能体所需的确切输入项目列表，而不使用内置分段机制。只有在任务转移的 `input_filter` 和当前运行的 `RunConfig.handoff_input_filter` 均未设置时，选择加入才会生效，因此已经自定义载荷的现有代码（包括此代码仓库中的代码示例）无需更改即可保持当前行为。你可以向 [`handoff(...)`][agents.handoffs.handoff] 传递 `nest_handoff_history=True` 或 `False`，为单次任务转移覆盖嵌套行为，这会设置 [`Handoff.nest_handoff_history`][agents.handoffs.Handoff.nest_handoff_history]。如果只需更改生成的摘要片段所用的包装文本，请在运行智能体之前调用 [`set_conversation_history_wrappers`][agents.handoffs.set_conversation_history_wrappers]。如果需要在之后的运行中恢复默认包装器，请在运行前调用 [`reset_conversation_history_wrappers`][agents.handoffs.reset_conversation_history_wrappers]。

如果任务转移和当前 [`RunConfig.handoff_input_filter`][agents.run.RunConfig.handoff_input_filter] 都定义了过滤器，则对于该特定任务转移，单次任务转移的 [`input_filter`][agents.handoffs.Handoff.input_filter] 优先。

!!! note

    任务转移始终位于单次运行内。输入安全防护措施仍然仅适用于链中的第一个智能体，输出安全防护措施仅适用于生成最终输出的智能体。如果需要检查工作流中每次自定义函数工具调用，请使用工具安全防护措施。

有一些常见模式（例如从历史记录中移除所有工具调用）已在 [`agents.extensions.handoff_filters`][] 中实现。

```python
from agents import Agent, handoff
from agents.extensions import handoff_filters

agent = Agent(name="FAQ agent")

handoff_obj = handoff(
    agent=agent,
    input_filter=handoff_filters.remove_all_tools, # (1)!
)
```

1. 调用 `FAQ agent` 时，这会自动从历史记录中移除所有与工具相关的项目。

## 推荐提示词

为确保LLM正确理解任务转移，我们建议在智能体中加入有关任务转移的信息。我们在 [`agents.extensions.handoff_prompt.RECOMMENDED_PROMPT_PREFIX`][] 中提供了建议的前缀，你也可以调用 [`agents.extensions.handoff_prompt.prompt_with_handoff_instructions`][]，自动将建议的数据添加到提示词中。

```python
from agents import Agent
from agents.extensions.handoff_prompt import RECOMMENDED_PROMPT_PREFIX

billing_agent = Agent(
    name="Billing agent",
    instructions=f"""{RECOMMENDED_PROMPT_PREFIX}
    <Fill in the rest of your prompt here>.""",
)
```