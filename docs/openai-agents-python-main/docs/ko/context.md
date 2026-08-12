---
search:
  exclude: true
---
# 컨텍스트 관리

컨텍스트는 여러 의미로 사용되는 용어입니다. 여기서 고려할 수 있는 컨텍스트는 크게 두 가지로 나뉩니다.

1. 코드에서 로컬로 사용할 수 있는 컨텍스트: 도구 함수가 실행될 때, `on_handoff` 같은 콜백이나 수명 주기 훅 등에서 필요할 수 있는 데이터와 종속성입니다.
2. LLM에서 사용할 수 있는 컨텍스트: 응답을 생성할 때 LLM이 확인하는 데이터입니다.

## 로컬 컨텍스트

이는 [`RunContextWrapper`][agents.run_context.RunContextWrapper] 클래스와 그 안의 [`context`][agents.run_context.RunContextWrapper.context] 속성으로 표현됩니다. 작동 방식은 다음과 같습니다.

1. 원하는 Python 객체를 생성합니다. 일반적으로 데이터 클래스나 Pydantic 객체를 사용합니다.
2. 해당 객체를 다양한 실행 메서드(예: `Runner.run(..., context=whatever)`)에 전달합니다.
3. 모든 도구 호출, 수명 주기 훅 등에는 래퍼 객체인 `RunContextWrapper[T]`가 전달됩니다. 여기서 `T`는 컨텍스트 객체의 유형을 나타내며, 객체 자체는 `wrapper.context`을 통해 사용할 수 있습니다.

일부 런타임 전용 콜백에서는 SDK가 `RunContextWrapper[T]`의 더 특화된 하위 클래스를 전달할 수 있습니다. 예를 들어 `FunctionTool` 인스턴스의 수명 주기 훅은 일반적으로 `ToolContext`를 받으며, 이 객체는 `tool_call_id`, `tool_name`, `tool_arguments`와 같은 도구 호출 메타데이터도 제공합니다.

알아두어야 할 **가장 중요한** 사항은 특정 에이전트 실행에 사용되는 모든 에이전트, 도구 함수, 수명 주기 요소 등이 동일한 컨텍스트 _유형_을 사용해야 한다는 것입니다.

컨텍스트는 다음과 같은 용도로 사용할 수 있습니다.

-   실행에 필요한 컨텍스트 데이터(예: 사용자 이름/uid 또는 사용자에 관한 기타 정보)
-   종속성(예: 로거 객체, 데이터 페처 등)
-   헬퍼 함수

!!! danger "참고"

    컨텍스트 객체는 LLM으로 **전송되지 않습니다**. 이는 데이터를 읽고 쓰거나 메서드를 호출할 수 있는 순수한 로컬 객체입니다.

단일 실행 내에서 파생된 래퍼는 동일한 기본 애플리케이션 컨텍스트, 승인 상태, 사용량 추적을 공유합니다. 중첩된 [`Agent.as_tool()`][agents.agent.Agent.as_tool] 실행에는 다른 `tool_input`가 연결될 수 있지만, 기본적으로 애플리케이션 상태의 격리된 사본이 제공되지는 않습니다.

### `RunContextWrapper`에서 제공되는 항목

[`RunContextWrapper`][agents.run_context.RunContextWrapper]는 애플리케이션에서 정의한 컨텍스트 객체의 래퍼입니다. 실제로는 다음 항목을 가장 자주 사용합니다.

-   변경 가능한 자체 애플리케이션 상태와 종속성을 위한 [`wrapper.context`][agents.run_context.RunContextWrapper.context]
-   현재 실행 전체에서 집계된 요청 및 토큰 사용량을 위한 [`wrapper.usage`][agents.run_context.RunContextWrapper.usage]
-   현재 실행이 [`Agent.as_tool()`][agents.agent.Agent.as_tool] 내부에서 수행될 때 구조화된 입력을 위한 [`wrapper.tool_input`][agents.run_context.RunContextWrapper.tool_input]
-   프로그래밍 방식으로 승인 상태를 업데이트해야 할 때 사용하는 [`wrapper.approve_tool(...)`][agents.run_context.RunContextWrapper.approve_tool] / [`wrapper.reject_tool(...)`][agents.run_context.RunContextWrapper.reject_tool]

`wrapper.context`만 애플리케이션에서 정의한 객체입니다. 다른 필드는 SDK가 관리하는 런타임 메타데이터입니다.

나중에 휴먼인더루프 (HITL) 또는 내구성 있는 작업 워크플로를 위해 [`RunState`][agents.run_state.RunState]를 직렬화하면 해당 런타임 메타데이터도 상태와 함께 저장됩니다. 직렬화된 상태를 영구 저장하거나 전송하려는 경우 [`RunContextWrapper.context`][agents.run_context.RunContextWrapper.context]에 비밀 정보를 넣지 마세요.

대화 상태는 별개의 사안입니다. 대화 턴을 이어가는 방식에 따라 `result.to_input_list()`, `session`, `conversation_id` 또는 `previous_response_id`를 사용하세요. 이러한 선택에 관한 자세한 내용은 [결과](results.md), [에이전트 실행](running_agents.md), [세션](sessions/index.md)을 참고하세요.

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

1. 컨텍스트 객체입니다. 여기서는 데이터 클래스를 사용했지만 어떤 유형이든 사용할 수 있습니다.
2. 도구입니다. `RunContextWrapper[UserInfo]`을 받는 것을 확인할 수 있습니다. 도구 구현은 컨텍스트에서 데이터를 읽습니다.
3. 에이전트에 제네릭 `UserInfo`을 지정하여 타입 검사기가 오류를 감지할 수 있도록 합니다. 예를 들어 다른 컨텍스트 유형을 받는 도구를 전달하려 하면 오류를 감지할 수 있습니다.
4. 컨텍스트가 `run` 함수에 전달됩니다.
5. 에이전트가 도구를 올바르게 호출하고 나이를 가져옵니다.

---

### 고급: `ToolContext`

경우에 따라 실행 중인 도구의 이름, 호출 ID 또는 가공되지 않은 인수 문자열 같은 추가 메타데이터에 액세스해야 할 수 있습니다.  
이를 위해 `RunContextWrapper`를 확장한 [`ToolContext`][agents.tool_context.ToolContext] 클래스를 사용할 수 있습니다.

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

`ToolContext`은 `RunContextWrapper`과 동일한 `.context` 속성을 제공하며,  
현재 도구 호출에 특화된 다음과 같은 추가 필드도 제공합니다.

- `tool_name` – 호출되는 도구의 이름  
- `tool_call_id` – 이 도구 호출의 고유 식별자  
- `tool_arguments` – 도구에 전달된 가공되지 않은 인수 문자열  
- `tool_namespace` – 도구가 `tool_namespace()` 또는 네임스페이스를 사용하는 다른 인터페이스를 통해 로드된 경우 도구 호출의 Responses 네임스페이스  
- `qualified_tool_name` – 네임스페이스가 있는 경우 해당 네임스페이스로 한정된 도구 이름  

실행 중에 도구 수준 메타데이터가 필요하면 `ToolContext`를 사용하세요.  
에이전트와 도구 간에 일반적인 컨텍스트를 공유하는 용도로는 `RunContextWrapper`만으로도 충분합니다. `ToolContext`은 `RunContextWrapper`을 확장하므로, 중첩된 `Agent.as_tool()` 실행에서 구조화된 입력을 제공한 경우 `.tool_input`도 제공할 수 있습니다.

---

## 에이전트/LLM 컨텍스트

LLM이 호출될 때 확인할 수 있는 데이터는 대화 기록에 있는 데이터**뿐**입니다. 따라서 LLM이 새로운 데이터를 사용할 수 있게 하려면 해당 데이터가 대화 기록에 포함되도록 해야 합니다. 이를 수행하는 방법은 몇 가지가 있습니다.

1. 에이전트의 `instructions`에 추가할 수 있습니다. 이는 "시스템 프롬프트" 또는 "개발자 메시지"라고도 합니다. 시스템 프롬프트는 정적 문자열일 수도 있고, 컨텍스트를 받아 문자열을 출력하는 동적 함수일 수도 있습니다. 항상 유용한 정보(예: 사용자의 이름이나 현재 날짜)를 제공할 때 흔히 사용하는 방법입니다.
2. `Runner.run` 함수를 호출할 때 `input`에 추가합니다. 이는 `instructions` 방식과 유사하지만, [지시 계층](https://cdn.openai.com/spec/model-spec-2024-05-08.html#follow-the-chain-of-command)에서 더 낮은 위치의 메시지를 사용할 수 있습니다.
3. `FunctionTool` 인스턴스를 통해 제공합니다. 이는 _필요할 때 사용하는_ 컨텍스트에 유용합니다. LLM이 데이터가 필요한 시점을 판단하고 도구를 호출하여 해당 데이터를 가져올 수 있습니다.
4. 검색 또는 웹 검색을 사용합니다. 파일이나 데이터베이스에서 관련 데이터를 가져오는 검색이나 웹에서 데이터를 가져오는 웹 검색은 이를 위한 특수 도구입니다. 이는 응답이 관련 컨텍스트 데이터에 근거하도록 하는 데 유용합니다.