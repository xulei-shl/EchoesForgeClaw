---
search:
  exclude: true
---
# 使用量

Agents SDK は、実行ごとのトークン使用量を自動的に追跡します。実行コンテキストから使用量にアクセスし、コストの監視、上限の適用、分析データの記録に使用できます。

## 追跡対象

- **requests**: 実行された LLM API 呼び出しの数
- **input_tokens**: 送信された入力トークンの合計
- **output_tokens**: 受信した出力トークンの合計
- **total_tokens**: 入力と出力の合計
- **request_usage_entries**: リクエストごとの使用量内訳のリスト
- **details**:
  - `input_tokens_details.cached_tokens`
  - `input_tokens_details.cache_write_tokens`
  - `output_tokens_details.reasoning_tokens`

## 実行からの使用量へのアクセス

`Runner.run(...)` の実行後、`result.context_wrapper.usage` から使用量にアクセスします。

```python
result = await Runner.run(agent, "What's the weather in Tokyo?")
usage = result.context_wrapper.usage

print("Requests:", usage.requests)
print("Input tokens:", usage.input_tokens)
print("Output tokens:", usage.output_tokens)
print("Total tokens:", usage.total_tokens)
```

使用量は、ツール呼び出しやハンドオフを生成するモデル呼び出しを含め、実行中のすべてのモデル呼び出しにわたって集計されます。

### サードパーティー製アダプターでの使用量の有効化

使用量レポートは、サードパーティー製アダプターやプロバイダーのバックエンドによって異なります。サードパーティー製アダプター経由でモデルにアクセスし、正確な `result.context_wrapper.usage` 値が必要な場合は、次の点に注意してください。

- `AnyLLMModel` では、上流プロバイダーが使用量を返すと、自動的に伝播されます。Chat Completions バックエンドからレスポンスをストリーミングする場合、使用量チャンクを出力するには `ModelSettings(include_usage=True)` が必要になることがあります。
- `LitellmModel` では、一部のプロバイダーのバックエンドはデフォルトで使用量を報告しないため、多くの場合 `ModelSettings(include_usage=True)` が必要です。

Models ガイドの[サードパーティー製アダプター](models/index.md#third-party-adapters)セクションにあるアダプター固有の注意事項を確認し、デプロイ予定のプロバイダーのバックエンドで使用量レポートを検証してください。

## リクエストごとの使用量追跡

SDK は、各 API リクエストの使用量を `request_usage_entries` で自動的に追跡します。これは、詳細なコスト計算やコンテキストウィンドウの消費量の監視に役立ちます。

```python
result = await Runner.run(agent, "What's the weather in Tokyo?")

for i, request in enumerate(result.context_wrapper.usage.request_usage_entries):
    print(f"Request {i + 1}: {request.input_tokens} in, {request.output_tokens} out")
```

## プロバイダーの使用量ペイロードの保持

Agents SDK は、プロバイダーの使用量を [`Usage`][agents.usage.Usage] フィールドに正規化し、モデルプロバイダー間で一貫した合計値を提供します。アプリケーションでプロバイダー固有の使用量フィールドを保持する必要がある場合や、省略されたフィールドとプロバイダーが報告したゼロを区別する必要がある場合は、[`ModelSettings.preserve_raw_usage`][agents.model_settings.ModelSettings.preserve_raw_usage] を `True` に設定します。

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

Agents SDK は、各 [`ModelResponse.raw_usage`][agents.items.ModelResponse.raw_usage] 値を、そのモデル呼び出しに対するプロバイダーペイロードの独立した JSON 互換スナップショットとして保存します。Agents SDK は、実行全体で `raw_usage` を集計しません。保持が無効な場合、プロバイダーが使用量ペイロードを返さない場合、または上流アダプターが元のフィールド有無の情報をすでに破棄している場合、この値は `None` のままです。

`preserve_raw_usage` は、モデルアダプターに到達した使用量ペイロードのみを保持します。この設定によって、プロバイダーへ使用量が要求されることはありません。ストリーミングの Chat Completions プロバイダーで使用量の明示的な要求が必要な場合は、`ModelSettings(include_usage=True)` も設定してください。

`LitellmModel` は現在、ストリーミング実行でも非ストリーミング実行でも `ModelResponse.raw_usage` を設定しないため、`preserve_raw_usage=True` はこのアダプターでは効果がありません。`LitellmModel` を使用する場合は、引き続き正規化された [`Usage`][agents.usage.Usage] フィールドを使用してください。プロバイダー固有のフィールドの有無を確認する必要がある場合は、raw 使用量の保持をサポートするアダプターを選択してください。

## セッションでの使用量へのアクセス

`Session`（例: `SQLiteSession`）を使用する場合、`Runner.run(...)` を呼び出すたびに、その実行固有の使用量が返されます。セッションはコンテキストとして会話履歴を保持しますが、各実行の使用量は独立しています。

```python
session = SQLiteSession("my_conversation")

first = await Runner.run(agent, "Hi!", session=session)
print(first.context_wrapper.usage.total_tokens)  # Usage for first run

second = await Runner.run(agent, "Can you elaborate?", session=session)
print(second.context_wrapper.usage.total_tokens)  # Usage for second run
```

セッションは実行間で会話コンテキストを保持しますが、各 `Runner.run()` 呼び出しによって返される使用量メトリクスは、その実行のみを表すことに注意してください。セッションでは、以前のメッセージが各実行の入力として再度渡される場合があり、その後のターンの入力トークン数に影響します。

## フックでの使用量の利用

`RunHooks` を使用している場合、各フックに渡される `context` オブジェクトには `usage` が含まれます。これにより、ライフサイクルの主要な時点で使用量を記録できます。

```python
class MyHooks(RunHooks):
    async def on_agent_end(self, context: RunContextWrapper, agent: Agent, output: Any) -> None:
        u = context.usage
        print(f"{agent.name} → {u.requests} requests, {u.total_tokens} total tokens")
```

## API リファレンス

API の詳細なドキュメントについては、以下を参照してください。

-   [`Usage`][agents.usage.Usage] - 使用量追跡のデータ構造
-   [`RequestUsage`][agents.usage.RequestUsage] - リクエストごとの使用量の詳細
-   [`RunContextWrapper`][agents.run.RunContextWrapper] - 実行コンテキストからの使用量へのアクセス
-   [`RunHooks`][agents.run.RunHooks] - 使用量追跡ライフサイクルへのフックの追加