---
search:
  exclude: true
---
# 핸드오프

핸드오프를 사용하면 에이전트가 다른 에이전트에 작업을 위임할 수 있습니다. 이는 서로 다른 에이전트가 각기 다른 영역을 전문적으로 처리하는 시나리오에서 특히 유용합니다. 예를 들어 고객 지원 앱에는 주문 상태, 환불, FAQ 등의 작업을 각각 전문적으로 처리하는 에이전트가 있을 수 있습니다.

핸드오프는 LLM에 도구로 표시됩니다. 따라서 `Refund Agent`라는 에이전트로 핸드오프하는 경우 도구 이름은 `transfer_to_refund_agent`이 됩니다.

## 핸드오프 생성

모든 에이전트에는 [`handoffs`][agents.agent.Agent.handoffs] 매개변수가 있으며, `Agent`를 직접 받거나 핸드오프를 사용자 지정하는 `Handoff` 객체를 받을 수 있습니다.

일반 `Agent` 인스턴스를 전달하면 해당 인스턴스의 [`handoff_description`][agents.agent.Agent.handoff_description]가 설정된 경우 기본 도구 설명에 추가됩니다. 완전한 `handoff()` 객체를 작성하지 않고 모델이 해당 핸드오프를 선택해야 하는 시점을 알려주는 데 사용합니다.

Agents SDK에서 제공하는 [`handoff()`][agents.handoffs.handoff] 함수를 사용하여 핸드오프를 생성할 수 있습니다. 이 함수를 사용하면 선택적 재정의 및 입력 필터와 함께 핸드오프할 에이전트를 지정할 수 있습니다.

### 기본 사용법

다음과 같이 간단한 핸드오프를 생성할 수 있습니다.

```python
from agents import Agent, handoff

billing_agent = Agent(name="Billing agent")
refund_agent = Agent(name="Refund agent")

# (1)!
triage_agent = Agent(name="Triage agent", handoffs=[billing_agent, handoff(refund_agent)])
```

1. 에이전트를 직접 사용하거나(`billing_agent`에서처럼) `handoff()` 함수를 사용할 수 있습니다.

### `handoff()` 함수를 통한 핸드오프 사용자 지정

[`handoff()`][agents.handoffs.handoff] 함수를 사용하면 여러 항목을 사용자 지정할 수 있습니다.

-   `agent`: 작업을 핸드오프할 대상 에이전트입니다.
-   `tool_name_override`: 기본적으로 `transfer_to_<agent_name>`으로 해석되는 `Handoff.default_tool_name()` 함수를 사용합니다. 이를 재정의할 수 있습니다.
-   `tool_description_override`: `Handoff.default_tool_description()`의 기본 도구 설명을 재정의합니다.
-   `on_handoff`: 핸드오프가 호출될 때 실행되는 콜백 함수입니다. 핸드오프가 호출되는 것을 확인하는 즉시 데이터 가져오기 등을 시작할 때 유용합니다. 이 함수는 에이전트 컨텍스트를 받으며, 선택적으로 LLM이 생성한 입력도 받을 수 있습니다. 입력 데이터는 `input_type` 매개변수로 제어합니다.
-   `input_type`: 핸드오프 도구 호출 인수의 스키마입니다. 설정하면 파싱된 페이로드가 `on_handoff`에 전달됩니다.
-   `input_filter`: 다음 에이전트가 받는 입력을 필터링할 수 있습니다. 자세한 내용은 아래를 참조하세요.
-   `is_enabled`: 핸드오프의 활성화 여부입니다. 불리언 또는 불리언을 반환하는 함수일 수 있으므로 런타임에 핸드오프를 동적으로 활성화하거나 비활성화할 수 있습니다.
-   `nest_handoff_history`: RunConfig 수준의 `nest_handoff_history` 설정을 핸드오프별로 재정의하는 선택적 항목입니다. 값이 `None`이면 활성 실행 구성에 정의된 값을 대신 사용합니다.

[`handoff()`][agents.handoffs.handoff] 헬퍼는 항상 전달된 특정 `agent`로 제어권을 이전합니다. 가능한 대상이 여러 개라면 대상마다 하나의 핸드오프를 등록하고 모델이 그중에서 선택하도록 합니다. 자체 핸드오프 코드가 호출 시점에 반환할 에이전트를 결정해야 하는 경우에만 사용자 지정 [`Handoff`][agents.handoffs.Handoff]을 사용합니다.

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

## 핸드오프 입력

특정 상황에서는 LLM이 핸드오프를 호출할 때 일부 데이터를 제공하도록 해야 할 수 있습니다. 예를 들어 "에스컬레이션 에이전트"로 핸드오프한다고 가정해 보겠습니다. 모델이 이유를 제공하도록 하여 이를 기록할 수 있습니다.

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

`input_type` 항목은 핸드오프 도구 호출 자체의 인수를 설명합니다. SDK는 해당 스키마를 핸드오프 도구의 `parameters`로 모델에 노출하고, 반환된 JSON을 로컬에서 검증한 후 파싱된 값을 `on_handoff`에 전달합니다.

이는 다음 에이전트의 기본 입력을 대체하지 않으며 다른 대상을 선택하지도 않습니다. [`handoff()`][agents.handoffs.handoff] 헬퍼는 여전히 래핑한 특정 에이전트로 제어권을 이전하며, [`input_filter`][agents.handoffs.Handoff.input_filter] 또는 중첩 핸드오프 히스토리 설정을 사용하여 변경하지 않는 한 수신 에이전트는 계속 대화 히스토리를 확인합니다.

`input_type` 항목은 [`RunContextWrapper.context`][agents.run_context.RunContextWrapper.context]와도 별개입니다. 이미 로컬에 있는 애플리케이션 상태나 종속성이 아니라, 핸드오프 시점에 모델이 결정하는 메타데이터에 `input_type`을 사용합니다.

### `input_type` 사용 시점

핸드오프에 `reason`, `language`, `priority`, `summary` 같은 소량의 모델 생성 메타데이터가 필요한 경우 `input_type`을 사용합니다. 예를 들어 분류 에이전트는 `{ "reason": "duplicate_charge", "priority": "high" }`와 함께 환불 에이전트로 핸드오프할 수 있으며, 환불 에이전트가 작업을 넘겨받기 전에 `on_handoff`에서 해당 메타데이터를 기록하거나 저장할 수 있습니다.

목적이 다른 경우에는 다른 메커니즘을 선택합니다.

-   기존 애플리케이션 상태와 종속성은 [`RunContextWrapper.context`][agents.run_context.RunContextWrapper.context]에 넣습니다. [컨텍스트 가이드](context.md)를 참조하세요.
-   수신 에이전트에 표시되는 히스토리를 변경하려면 [`input_filter`][agents.handoffs.Handoff.input_filter], [`RunConfig.nest_handoff_history`][agents.run.RunConfig.nest_handoff_history] 또는 [`RunConfig.handoff_history_mapper`][agents.run.RunConfig.handoff_history_mapper]를 사용합니다.
-   가능한 전문 에이전트가 여러 개라면 대상마다 하나의 핸드오프를 등록합니다. `input_type`을 사용하면 선택된 핸드오프에 메타데이터를 추가할 수 있지만 대상 간 디스패치를 수행하지는 않습니다.
-   대화를 이전하지 않고 중첩된 전문 에이전트에 구조화된 입력을 제공하려면 [`Agent.as_tool(parameters=...)`][agents.agent.Agent.as_tool]을 사용하는 것이 좋습니다. [도구](tools.md#structured-input-for-tool-agents)를 참조하세요.

## 입력 필터

핸드오프가 발생하면 새 에이전트가 대화를 넘겨받아 이전의 전체 대화 히스토리를 확인하는 것과 같습니다. 이를 변경하려면 [`input_filter`][agents.handoffs.Handoff.input_filter]을 설정할 수 있습니다. 입력 필터는 [`HandoffInputData`][agents.handoffs.HandoffInputData]를 통해 기존 입력을 받고 새로운 `HandoffInputData`를 반환해야 하는 함수입니다.

[`HandoffInputData`][agents.handoffs.HandoffInputData]에는 다음 항목이 포함됩니다.

-   `input_history`: `Runner.run(...)` 시작 전의 입력 히스토리
-   `pre_handoff_items`: 핸드오프가 호출된 에이전트 턴 이전에 생성된 항목
-   `new_items`: 핸드오프 호출 및 핸드오프 출력 항목을 포함해 현재 턴 중에 생성된 항목
-   `input_items`: `new_items` 대신 다음 에이전트에 전달할 선택적 항목으로, 세션 히스토리의 `new_items`은 그대로 유지하면서 모델 입력을 필터링할 수 있습니다.
-   `run_context`: 핸드오프가 호출된 시점의 활성 [`RunContextWrapper`][agents.run_context.RunContextWrapper]

중첩 핸드오프 히스토리는 옵트인 베타로 제공되며 안정화가 진행되는 동안 기본적으로 비활성화됩니다. [`RunConfig.nest_handoff_history`][agents.run.RunConfig.nest_handoff_history]을 활성화하면 러너는 요약 가능한 히스토리를 순서가 지정된 어시스턴트 요약 세그먼트로 압축하면서, 무손실 메시지 항목은 원래 위치에 보존합니다. 생성된 각 요약 세그먼트는 `<CONVERSATION HISTORY>` 래퍼를 사용하며, 이후 핸드오프에서는 순서가 지정된 트랜스크립트를 다시 구성하기 전에 이전에 생성된 세그먼트를 평면화합니다. 세션, `RunState`, `RunResult.to_input_list()`는 이 SDK 기본 히스토리로 이동된 정확한 메시지 출현 항목을 추적하여 해당 항목이 두 번 추가되지 않도록 합니다. 별도로 존재하는 동일한 메시지는 계속 보존됩니다. 내장 세그먼트화 대신 다음 에이전트에 전달할 정확한 입력 항목 목록을 반환하도록 [`RunConfig.handoff_history_mapper`][agents.run.RunConfig.handoff_history_mapper]을 통해 자체 매핑 함수를 제공할 수 있습니다. 이 옵트인은 핸드오프의 `input_filter`과 활성 실행의 `RunConfig.handoff_input_filter`가 모두 설정되지 않은 경우에만 적용되므로, 이미 페이로드를 사용자 지정하는 기존 코드(이 리포지토리의 코드 예제 포함)는 변경 없이 현재 동작을 유지합니다. [`handoff(...)`][agents.handoffs.handoff]에 `nest_handoff_history=True` 또는 `False`를 전달하여 단일 핸드오프의 중첩 동작을 재정의할 수 있으며, 이렇게 하면 [`Handoff.nest_handoff_history`][agents.handoffs.Handoff.nest_handoff_history]이 설정됩니다. 생성된 요약 세그먼트의 래퍼 텍스트만 변경하려면 에이전트를 실행하기 전에 [`set_conversation_history_wrappers`][agents.handoffs.set_conversation_history_wrappers]을 호출합니다. 이후 실행에서 기본 래퍼를 복원해야 하는 경우 실행 전에 [`reset_conversation_history_wrappers`][agents.handoffs.reset_conversation_history_wrappers]을 호출합니다.

핸드오프와 활성 [`RunConfig.handoff_input_filter`][agents.run.RunConfig.handoff_input_filter]이 모두 필터를 정의한 경우 핸드오프별 [`input_filter`][agents.handoffs.Handoff.input_filter]이 해당 핸드오프에서 우선합니다.

!!! note

    핸드오프는 단일 실행 내에서 유지됩니다. 입력 가드레일은 여전히 체인의 첫 번째 에이전트에만 적용되고, 출력 가드레일은 최종 출력을 생성하는 에이전트에만 적용됩니다. 워크플로 내의 각 사용자 지정 함수 도구 호출을 검사해야 하는 경우 도구 가드레일을 사용합니다.

히스토리에서 모든 도구 호출을 제거하는 것과 같은 몇 가지 일반적인 패턴은 [`agents.extensions.handoff_filters`][]에 구현되어 있습니다.

```python
from agents import Agent, handoff
from agents.extensions import handoff_filters

agent = Agent(name="FAQ agent")

handoff_obj = handoff(
    agent=agent,
    input_filter=handoff_filters.remove_all_tools, # (1)!
)
```

1. `FAQ agent` 호출 시 히스토리에서 모든 도구 관련 항목을 자동으로 제거합니다.

## 권장 프롬프트

LLM이 핸드오프를 올바르게 이해하도록 하려면 에이전트에 핸드오프 관련 정보를 포함하는 것이 좋습니다. [`agents.extensions.handoff_prompt.RECOMMENDED_PROMPT_PREFIX`][]에 권장 접두사가 있으며, [`agents.extensions.handoff_prompt.prompt_with_handoff_instructions`][]을 호출하여 프롬프트에 권장 데이터를 자동으로 추가할 수도 있습니다.

```python
from agents import Agent
from agents.extensions.handoff_prompt import RECOMMENDED_PROMPT_PREFIX

billing_agent = Agent(
    name="Billing agent",
    instructions=f"""{RECOMMENDED_PROMPT_PREFIX}
    <Fill in the rest of your prompt here>.""",
)
```