---
search:
  exclude: true
---
# 上下文管理

上下文是一个含义宽泛的术语。你可能需要关注两类主要的上下文：

1. 你的代码在本地可用的上下文：这是工具函数运行时、`on_handoff` 等回调中、生命周期钩子中可能需要的数据和依赖项。
2. LLM 可用的上下文：这是 LLM 在生成响应时能够看到的数据。

## 本地上下文

本地上下文由 [`RunContextWrapper`][agents.run_context.RunContextWrapper] 类及其中的 [`context`][agents.run_context.RunContextWrapper.context] 属性表示。其工作方式如下：

1. 创建任意所需的 Python 对象。常见模式是使用 dataclass 或 Pydantic 对象。
2. 将该对象传递给各种运行方法（例如 `Runner.run(..., context=whatever)`）。
3. 所有工具调用、生命周期钩子等都会收到一个包装器对象 `RunContextWrapper[T]`，其中 `T` 表示上下文对象的类型；该对象本身可通过 `wrapper.context` 获取。

对于某些特定于运行时的回调，SDK 可能会传入 `RunContextWrapper[T]` 的特定子类。例如，`FunctionTool` 实例的生命周期钩子通常会收到 `ToolContext`，它还会公开 `tool_call_id`、`tool_name` 和 `tool_arguments` 等工具调用元数据。

需要注意的**最重要**事项是：对于一次给定的智能体运行，其中的每个智能体、工具函数、生命周期等都必须使用相同的上下文_类型_。

你可以将上下文用于以下方面：

-   运行所需的上下文数据（例如用户名/uid 或其他用户相关信息）
-   依赖项（例如日志记录器对象、数据获取器等）
-   辅助函数

!!! danger "注意"

    上下文对象**不会**发送给 LLM。它完全是一个本地对象，你可以读取和写入该对象，也可以调用其方法。

在单次运行中，派生的包装器共享相同的底层应用上下文、审批状态和用量追踪。嵌套的 [`Agent.as_tool()`][agents.agent.Agent.as_tool] 运行可以附加不同的 `tool_input`，但默认情况下，它们不会获得应用状态的独立副本。

### `RunContextWrapper` 提供的内容

[`RunContextWrapper`][agents.run_context.RunContextWrapper] 是应用自定义上下文对象的包装器。实际使用中，你最常用到的是：

-   [`wrapper.context`][agents.run_context.RunContextWrapper.context]，用于应用自身的可变状态和依赖项。
-   [`wrapper.usage`][agents.run_context.RunContextWrapper.usage]，用于当前运行期间聚合的请求用量和 token 用量。
-   [`wrapper.tool_input`][agents.run_context.RunContextWrapper.tool_input]，用于当前运行在 [`Agent.as_tool()`][agents.agent.Agent.as_tool] 内部执行时的结构化输入。
-   [`wrapper.approve_tool(...)`][agents.run_context.RunContextWrapper.approve_tool] / [`wrapper.reject_tool(...)`][agents.run_context.RunContextWrapper.reject_tool]，用于以编程方式更新审批状态。

只有 `wrapper.context` 是应用自定义对象。其他字段均为 SDK 管理的运行时元数据。

如果之后要为人机协同或持久化任务工作流序列化 [`RunState`][agents.run_state.RunState]，这些运行时元数据会随状态一起保存。如果打算持久化或传输序列化后的状态，请避免在 [`RunContextWrapper.context`][agents.run_context.RunContextWrapper.context] 中存放机密信息。

对话状态是另一个独立的问题。请根据所需的对话轮次延续方式，使用 `result.to_input_list()`、`session`、`conversation_id` 或 `previous_response_id`。有关如何选择，请参阅[结果](results.md)、[运行智能体](running_agents.md)和[会话](sessions/index.md)。

```python
import asyncio
from dataclasses import dataclass

from agents import Agent, RunContextWrapper, Runner
from agents.decorators import tool

@dataclass
class UserInfo:  # (1)!
    name: str
    uid: int

@tool
async def fetch_user_age(wrapper: RunContextWrapper[UserInfo]) -> str:  # (2)!
    """Fetch the age of the user. Call this function to get user's age information."""
    return f"The user {wrapper.context.name} is 47 years old"

async def main():
    user_info = UserInfo(name="John", uid=123)

    agent = Agent[UserInfo](  # (3)!
        name="Assistant",
        tools=[fetch_user_age],
    )

    result = await Runner.run(  # (4)!
        starting_agent=agent,
        input="What is the age of the user?",
        context=user_info,
    )

    print(result.final_output)  # (5)!
    # The user John is 47 years old.

if __name__ == "__main__":
    asyncio.run(main())
```

1. 这是上下文对象。此处使用了 dataclass，但你可以使用任意类型。
2. 这是一个工具。可以看到，它接收 `RunContextWrapper[UserInfo]`。工具实现会从上下文中读取数据。
3. 我们使用泛型 `UserInfo` 标记智能体，以便类型检查器捕获错误（例如，如果尝试传入一个接收不同上下文类型的工具）。
4. 上下文会传递给 `run` 函数。
5. 智能体正确调用工具并获取年龄。

---

### 高级用法：`ToolContext`

在某些情况下，你可能需要访问有关正在执行的工具的额外元数据，例如工具名称、调用 ID 或原始参数字符串。  
为此，可以使用 [`ToolContext`][agents.tool_context.ToolContext] 类，它扩展了 `RunContextWrapper`。

```python
from typing import Annotated
from pydantic import BaseModel, Field
from agents import Agent
from agents.decorators import tool
from agents.tool_context import ToolContext

class WeatherContext(BaseModel):
    user_id: str

class Weather(BaseModel):
    city: str = Field(description="The city name")
    temperature_range: str = Field(description="The temperature range in Celsius")
    conditions: str = Field(description="The weather conditions")

@tool
def get_weather(ctx: ToolContext[WeatherContext], city: Annotated[str, "The city to get the weather for"]) -> Weather:
    print(f"[debug] Tool context: (name: {ctx.tool_name}, call_id: {ctx.tool_call_id}, args: {ctx.tool_arguments})")
    return Weather(city=city, temperature_range="14-20C", conditions="Sunny with wind.")

agent = Agent(
    name="Weather Agent",
    instructions="You are a helpful agent that can tell the weather of a given city.",
    tools=[get_weather],
)
```

`ToolContext` 提供与 `RunContextWrapper` 相同的 `.context` 属性，  
此外还提供当前工具调用特有的字段：

- `tool_name` – 被调用工具的名称  
- `tool_call_id` – 此工具调用的唯一标识符  
- `tool_arguments` – 传递给工具的原始参数字符串  
- `tool_namespace` – 工具调用的 Responses 命名空间，适用于通过 `tool_namespace()` 或其他带命名空间的接口加载工具的情况  
- `qualified_tool_name` – 存在命名空间时，以命名空间限定的工具名称  

如果在执行期间需要工具级元数据，请使用 `ToolContext`。  
对于智能体与工具之间的常规上下文共享，`RunContextWrapper` 仍然足够。由于 `ToolContext` 扩展了 `RunContextWrapper`，当嵌套的 `Agent.as_tool()` 运行提供结构化输入时，它也可以公开 `.tool_input`。

---

## 智能体/LLM 上下文

调用 LLM 时，它**唯一**能看到的数据来自对话历史记录。这意味着，如果希望 LLM 能够使用某些新数据，就必须以某种方式让这些数据出现在该历史记录中。具体有以下几种方式：

1. 可以将其添加到智能体的 `instructions` 中。这也称为“系统提示词”或“开发者消息”。系统提示词可以是静态字符串，也可以是接收上下文并输出字符串的动态函数。这是处理始终有用的信息时常用的策略（例如用户姓名或当前日期）。
2. 调用 `Runner.run` 函数时，将其添加到 `input` 中。这与 `instructions` 策略类似，但可以使用在[指令层级](https://cdn.openai.com/spec/model-spec-2024-05-08.html#follow-the-chain-of-command)中优先级较低的消息。
3. 通过 `FunctionTool` 实例公开这些数据。这对于_按需_上下文非常有用——LLM 会自行判断何时需要某些数据，并可调用工具来获取这些数据。
4. 使用检索或网络检索。这些是能够从文件或数据库中获取相关数据（检索），或者从网络获取相关数据（网络检索）的特殊工具。这有助于让响应以相关上下文数据为依据。