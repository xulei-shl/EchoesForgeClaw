---
search:
  exclude: true
---
# 사용량

Agents SDK는 모든 실행의 토큰 사용량을 자동으로 추적합니다. 실행 컨텍스트에서 사용량에 접근하여 비용을 모니터링하고, 한도를 적용하거나, 분석 데이터를 기록할 수 있습니다.

## 추적 항목

- **requests**: 수행된 LLM API 호출 수
- **input_tokens**: 전송된 총 입력 토큰 수
- **output_tokens**: 수신된 총 출력 토큰 수
- **total_tokens**: 입력 + 출력
- **request_usage_entries**: 요청별 사용량 상세 내역 목록
- **details**:
  - `input_tokens_details.cached_tokens`
  - `input_tokens_details.cache_write_tokens`
  - `output_tokens_details.reasoning_tokens`

## 실행에서 사용량 접근

`Runner.run(...)` 이후에는 `result.context_wrapper.usage`를 통해 사용량에 접근합니다.

```python
result = await Runner.run(agent, "What's the weather in Tokyo?")
usage = result.context_wrapper.usage

print("Requests:", usage.requests)
print("Input tokens:", usage.input_tokens)
print("Output tokens:", usage.output_tokens)
print("Total tokens:", usage.total_tokens)
```

사용량은 도구 호출이나 핸드오프를 생성하는 모델 호출을 포함하여 실행 중 발생한 모든 모델 호출에 걸쳐 집계됩니다.

### 서드파티 어댑터의 사용량 활성화

사용량 보고 방식은 서드파티 어댑터와 제공자 백엔드에 따라 다릅니다. 서드파티 어댑터를 통해 모델에 접근하면서 정확한 `result.context_wrapper.usage` 값이 필요한 경우:

- `AnyLLMModel`에서는 업스트림 제공자가 사용량을 반환할 경우 자동으로 전파됩니다. Chat Completions 백엔드에서 응답을 스트리밍할 때 사용량 청크가 출력되도록 하려면 `ModelSettings(include_usage=True)`이 필요할 수 있습니다.
- `LitellmModel`에서는 일부 제공자 백엔드가 기본적으로 사용량을 보고하지 않으므로 `ModelSettings(include_usage=True)`가 필요한 경우가 많습니다.

Models 가이드의 [서드파티 어댑터](models/index.md#third-party-adapters) 섹션에서 어댑터별 참고 사항을 검토하고, 배포하려는 정확한 제공자 백엔드에서 사용량 보고를 검증하세요.

## 요청별 사용량 추적

SDK는 각 API 요청의 사용량을 `request_usage_entries`에서 자동으로 추적합니다. 이는 상세한 비용 계산과 컨텍스트 창 사용량 모니터링에 유용합니다.

```python
result = await Runner.run(agent, "What's the weather in Tokyo?")

for i, request in enumerate(result.context_wrapper.usage.request_usage_entries):
    print(f"Request {i + 1}: {request.input_tokens} in, {request.output_tokens} out")
```

## 제공자 사용량 페이로드 보존

Agents SDK는 제공자 사용량을 여러 모델 제공자에 걸쳐 일관된 합계를 제공하는 [`Usage`][agents.usage.Usage] 필드로 정규화합니다. 애플리케이션에서 제공자별 사용량 필드를 유지하거나, 생략된 필드와 제공자가 보고한 0을 구분해야 하는 경우 [`ModelSettings.preserve_raw_usage`][agents.model_settings.ModelSettings.preserve_raw_usage]를 `True`으로 설정합니다.

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

Agents SDK는 각 모델 호출의 [`ModelResponse.raw_usage`][agents.items.ModelResponse.raw_usage] 값을 제공자 페이로드에서 분리된 JSON 호환 스냅샷으로 저장합니다. Agents SDK는 실행 전체에 걸쳐 `raw_usage`를 집계하지 않습니다. 보존이 비활성화되어 있거나, 제공자가 사용량 페이로드를 반환하지 않거나, 업스트림 어댑터가 원래 필드의 존재 여부 정보를 이미 폐기한 경우 값은 `None`으로 유지됩니다.

`preserve_raw_usage`은 모델 어댑터에 도달한 사용량 페이로드만 보존하며, 이 설정은 제공자에게 사용량을 요청하지 않습니다. 스트리밍 Chat Completions 제공자가 명시적인 사용량 요청을 요구하는 경우 `ModelSettings(include_usage=True)`도 설정합니다.

현재 `LitellmModel`는 스트리밍 또는 비스트리밍 실행 모두에서 `ModelResponse.raw_usage`을 채우지 않으므로 해당 어댑터에서는 `preserve_raw_usage=True`이 효과가 없습니다. `LitellmModel`을 사용할 때는 정규화된 [`Usage`][agents.usage.Usage] 필드를 계속 사용하거나, 제공자별 필드의 존재 여부가 필요한 경우 raw 사용량 보존을 지원하는 어댑터를 선택하세요.

## 세션에서 사용량 접근

`Session`(예: `SQLiteSession`)을 사용하면 `Runner.run(...)`에 대한 각 호출이 해당 실행의 사용량을 반환합니다. 세션은 컨텍스트를 위해 대화 기록을 유지하지만, 각 실행의 사용량은 독립적입니다.

```python
session = SQLiteSession("my_conversation")

first = await Runner.run(agent, "Hi!", session=session)
print(first.context_wrapper.usage.total_tokens)  # Usage for first run

second = await Runner.run(agent, "Can you elaborate?", session=session)
print(second.context_wrapper.usage.total_tokens)  # Usage for second run
```

세션은 실행 사이에 대화 컨텍스트를 보존하지만, 각 `Runner.run()` 호출이 반환하는 사용량 지표는 해당 실행만 나타냅니다. 세션에서는 이전 메시지가 각 실행의 입력으로 다시 제공될 수 있으며, 이는 이후 턴의 입력 토큰 수에 영향을 줍니다.

## 훅에서 사용량 활용

`RunHooks`을 사용하는 경우 각 훅에 전달되는 `context` 객체에는 `usage`이 포함됩니다. 이를 통해 주요 수명 주기 시점에 사용량을 기록할 수 있습니다.

```python
class MyHooks(RunHooks):
    async def on_agent_end(self, context: RunContextWrapper, agent: Agent, output: Any) -> None:
        u = context.usage
        print(f"{agent.name} → {u.requests} requests, {u.total_tokens} total tokens")
```

## API 레퍼런스

자세한 API 문서는 다음을 참조하세요.

-   [`Usage`][agents.usage.Usage] - 사용량 추적 데이터 구조
-   [`RequestUsage`][agents.usage.RequestUsage] - 요청별 사용량 상세 정보
-   [`RunContextWrapper`][agents.run.RunContextWrapper] - 실행 컨텍스트에서 사용량 접근
-   [`RunHooks`][agents.run.RunHooks] - 사용량 추적 수명 주기에 훅 연결