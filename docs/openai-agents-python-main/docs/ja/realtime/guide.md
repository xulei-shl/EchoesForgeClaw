---
search:
  exclude: true
---
# リアルタイムエージェントガイド

このガイドでは、OpenAI Agents SDK のリアルタイムレイヤーが OpenAI Realtime API にどのように対応するか、および Python SDK が追加する動作について説明します。

!!! note "はじめに"

    デフォルトの Python 利用手順については、まず[クイックスタート](quickstart.md)をお読みください。アプリでサーバー側 WebSocket と SIP のどちらを使用すべきか検討している場合は、[リアルタイムトランスポート](transport.md)をお読みください。ブラウザーの WebRTC トランスポートは Python SDK に含まれていません。

## 概要

リアルタイムエージェントは Realtime API への長時間接続を維持するため、モデルはテキストと音声を逐次処理し、音声出力をストリーミングし、ツールを呼び出し、ターンごとに新しいリクエストを開始し直すことなく中断を処理できます。

SDK の主なコンポーネントは次のとおりです。

-   **RealtimeAgent**: 1 つのリアルタイム専門エージェントに対する指示、ツール、出力ガードレール、ハンドオフ
-   **RealtimeRunner**: 開始エージェントをリアルタイムトランスポートに接続するセッションファクトリー
-   **RealtimeSession**: 入力の送信、イベントの受信、履歴の追跡、ツールの実行を行うライブセッション
-   **RealtimeModel**: トランスポートの抽象化。デフォルトは OpenAI のサーバー側 WebSocket 実装です。

## セッションのライフサイクル

一般的なリアルタイムセッションの流れは次のとおりです。

1. 1 つ以上の `RealtimeAgent` を作成します。
2. 開始エージェントを指定して `RealtimeRunner` を作成します。
3. `await runner.run()` を呼び出し、`RealtimeSession` を取得します。
4. `async with session:` または `await session.enter()` を使用してセッションに入ります。
5. `send_message()` または `send_audio()` を使用してユーザー入力を送信します。
6. 会話が終了するまでセッションイベントを反復処理します。

テキストのみの実行とは異なり、`runner.run()` は最終的な実行結果をすぐには生成しません。代わりに、ローカル履歴、バックグラウンドでのツール実行、ガードレールの状態、アクティブなエージェント設定をトランスポートレイヤーと同期し続けるライブセッションオブジェクトを返します。

デフォルトでは、`RealtimeRunner` は `OpenAIRealtimeWebSocketModel` を使用するため、デフォルトの Python 利用手順では Realtime API へのサーバー側 WebSocket 接続が使用されます。別の `RealtimeModel` を渡した場合も、接続メカニズムは変更できますが、同じセッションライフサイクルとエージェント機能が適用されます。

## エージェントとセッションの設定

`RealtimeAgent` は、通常の `Agent` 型よりも意図的に対象範囲が限定されています。

-   モデルはエージェントごとではなく、セッションレベルで選択します。
-   structured outputs はサポートされていません。
-   音声は設定できますが、セッションが音声を一度生成した後は変更できません。
-   指示、関数ツール、ハンドオフ、フック、出力ガードレールはすべて引き続き使用できます。

`RealtimeSessionModelSettings` は、新しいネストされた `audio` 設定と、従来のフラットなエイリアスの両方をサポートします。新しいコードではネスト形式を推奨します。また、新しいリアルタイムエージェントには `gpt-realtime-2.1` を使用してください。

```python
runner = RealtimeRunner(
    starting_agent=agent,
    config={
        "model_settings": {
            "model_name": "gpt-realtime-2.1",
            "audio": {
                "input": {
                    "format": "pcm16",
                    "transcription": {"model": "gpt-4o-mini-transcribe"},
                    "turn_detection": {"type": "semantic_vad", "interrupt_response": True},
                },
                "output": {"format": "pcm16", "voice": "ash"},
            },
            "tool_choice": "auto",
        }
    },
)
```

便利なセッションレベルの設定には、次のものがあります。

-   `audio.input.format`、`audio.output.format`
-   `audio.input.transcription`
-   `audio.input.noise_reduction`
-   `audio.input.turn_detection`
-   `audio.output.voice`、`audio.output.speed`
-   `output_modalities`
-   `tool_choice`
-   `prompt`
-   `tracing`

`RealtimeRunner(config=...)` の便利な実行レベル設定には、次のものがあります。

-   `async_tool_calls`
-   `output_guardrails`
-   `guardrails_settings.debounce_text_length`
-   `tool_error_formatter`
-   `tracing_disabled`

型付きインターフェースの全体については、[`RealtimeRunConfig`][agents.realtime.config.RealtimeRunConfig] および [`RealtimeSessionModelSettings`][agents.realtime.config.RealtimeSessionModelSettings] を参照してください。

### 入力文字起こし設定

入力文字起こしは `audio.input.transcription` で設定します。低レイテンシーの逐次文字起こしには `gpt-live-transcribe` を使用します。音声ターンの確定後に文字起こしを開始する必要がある場合、またはアプリケーションで検出言語の出力が必要な場合は、WebSocket 経由で `gpt-transcribe` を使用します。Agents SDK は、モデル固有の GA 文字起こし設定をネストされたセッション設定で転送します。

```python
runner = RealtimeRunner(
    starting_agent=agent,
    config={
        "model_settings": {
            "audio": {
                "input": {
                    "transcription": {
                        "model": "gpt-live-transcribe",
                        "prompt": "A support call about the OpenAI Agents SDK.",
                        "keywords": ["RunState", "MCPServerManager"],
                        "languages": ["en", "ja"],
                    },
                    "turn_detection": None,
                }
            }
        }
    },
)
```

`gpt-live-transcribe` では、`prompt` に自由形式の録音コンテキストを指定し、`keywords` に音声内に出現する可能性がある用語をリテラルで列挙し、`languages` に想定される入力言語を列挙します。このモデルでは、単数形の `language` ではなく複数形の `languages` を使用します。両方のフィールドを送信しないでください。

この SDK が固定しているバージョンの OpenAI クライアントでは、`delay` は `gpt-realtime-whisper` との組み合わせでのみサポートされます。このモデルのレイテンシーと精度のトレードオフは、次のように設定します。

```python
runner = RealtimeRunner(
    starting_agent=agent,
    config={
        "model_settings": {
            "audio": {
                "input": {
                    "transcription": {
                        "model": "gpt-realtime-whisper",
                        "delay": "low",
                    },
                    "turn_detection": None,
                }
            }
        }
    },
)
```

`delay` 設定には、`minimal`、`low`、`medium`、`high`、または `xhigh` を指定できます。値が低いほど部分テキストが早く生成される可能性があり、値が高いほど文字起こしモデルに多くの音声コンテキストが提供され、認識精度が向上する可能性があります。各レベルの処理時間が一定であると想定せず、実際のユースケースを代表する音声でベンチマークしてください。

WebSocket 経由の Realtime セッションで `gpt-transcribe` を使用するのは、確定済みの音声ターンの後に文字起こしを開始する必要がある場合、またはアプリケーションで検出言語の出力が必要な場合に限ります。モデルは、以前に文字起こしされたターンをコンテキストとして自動的に使用します。`gpt-transcribe` 完了イベントは、`languages` 出力フィールドで検出言語を報告します。この出力フィールドは、上記の想定言語入力である `gpt-live-transcribe` とは異なります。

`audio.input.turn_detection` を `None` に設定すると、自動ターン検出が無効になります。その場合、アプリケーションは音声ターンを確定し、[手動レスポンス制御](#manual-response-control)の説明に従ってレスポンスの作成を制御する必要があります。モデルの動作、検証ルール、レイテンシーに関するガイダンスについては、OpenAI API の[リアルタイム文字起こしガイド](https://developers.openai.com/api/docs/guides/realtime-transcription)を参照してください。

## 入出力

### テキストと構造化ユーザーメッセージ

プレーンテキストまたは構造化されたリアルタイムメッセージには、[`session.send_message()`][agents.realtime.session.RealtimeSession.send_message] を使用します。

```python
from agents.realtime import RealtimeUserInputMessage

await session.send_message("Summarize what we discussed so far.")

message: RealtimeUserInputMessage = {
    "type": "message",
    "role": "user",
    "content": [
        {"type": "input_text", "text": "Describe this image."},
        {"type": "input_image", "image_url": image_data_url, "detail": "high"},
    ],
}
await session.send_message(message)
```

構造化メッセージは、リアルタイム会話に画像入力を含めるための主な方法です。[`examples/realtime/app/server.py`](https://github.com/openai/openai-agents-python/tree/main/examples/realtime/app/server.py) の Web デモ例では、この方法で `input_image` メッセージを転送します。

### オーディオ入力

raw オーディオバイトをストリーミングするには、[`session.send_audio()`][agents.realtime.session.RealtimeSession.send_audio] を使用します。

```python
await session.send_audio(audio_bytes)
```

サーバー側のターン検出が無効になっている場合は、ターンの境界を指定する必要があります。高レベルの便利な方法は次のとおりです。

```python
await session.send_audio(audio_bytes, commit=True)
```

より低レベルの制御が必要な場合は、基盤となるモデルトランスポートを介して `input_audio_buffer.commit` などの Realtime API クライアントイベントを直接送信することもできます。

### 手動レスポンス制御

`session.send_message()` は、高レベルの経路を使用してユーザー入力を送信し、レスポンスを開始します。一部の設定では、raw オーディオのバッファリングによって同じ処理が自動的に行われるとは**限りません**。

Realtime API レベルでの手動ターン制御では、`turn_detection` を `null` に設定する `session.update` イベントを送信してから、`input_audio_buffer.commit` と `response.create` を自身で送信します。

ターンを手動で管理する場合は、モデルトランスポートを介して raw クライアントイベントを送信できます。

```python
from agents.realtime.model_inputs import RealtimeModelSendRawMessage

await session.model.send_event(
    RealtimeModelSendRawMessage(
        message={
            "type": "response.create",
        }
    )
)
```

このパターンは、次の場合に役立ちます。

-   `turn_detection` が無効で、モデルが応答するタイミングを決定したい場合
-   レスポンスを開始する前にユーザー入力を検査または制限したい場合
-   帯域外レスポンスにカスタムプロンプトが必要な場合

[`examples/realtime/twilio_sip/server.py`](https://github.com/openai/openai-agents-python/tree/main/examples/realtime/twilio_sip/server.py) の SIP コード例では、raw `response.create` を使用して最初の挨拶を強制しています。

## イベント、履歴、中断

`RealtimeSession` は高レベルの SDK イベントを発行しつつ、必要に応じて raw モデルイベントも転送します。

重要なセッションイベントには、次のものがあります。

-   `audio`、`audio_end`、`audio_interrupted`
-   `agent_start`、`agent_end`
-   `tool_start`、`tool_end`、`tool_approval_required`
-   `handoff`
-   `history_added`、`history_updated`
-   `guardrail_tripped`
-   `input_audio_timeout_triggered`
-   `error`
-   `raw_model_event`

UI の状態に最も役立つイベントは、通常 `history_added` と `history_updated` です。これらは、ユーザーメッセージ、アシスタントメッセージ、ツール呼び出しなど、セッションのローカル履歴を `RealtimeItem` オブジェクトとして公開します。

### 使用量の集計

完了したモデルレスポンスに使用量が含まれる場合、SDK の OpenAI `RealtimeModel` トランスポートは、`raw_model_event` 内で [`RealtimeModelUsageEvent`][agents.realtime.model_events.RealtimeModelUsageEvent] を発行します。その `usage` フィールドには、そのレスポンスのトークン数が含まれます。また、`input_tokens_details` と `output_tokens_details` には、モダリティ別の内訳が任意で含まれます。

セッションは各レスポンスの使用量を、共有される [`RunContextWrapper.usage`][agents.run_context.RunContextWrapper.usage] にも追加します。ライブセッションの累積使用量を確認するには、`agent_end` など、その後の高レベルイベントの `event.info.context.usage` から読み取ります。

```python
from agents.realtime import RealtimeModelUsageEvent

async for event in session:
    if event.type == "raw_model_event" and isinstance(
        event.data, RealtimeModelUsageEvent
    ):
        response_usage = event.data.usage
        print("Response tokens:", response_usage.total_tokens)
        print("Input modalities:", event.data.input_tokens_details)
        print("Output modalities:", event.data.output_tokens_details)
    elif event.type == "agent_end":
        session_usage = event.info.context.usage
        print("Session tokens:", session_usage.total_tokens)
```

使用量は、モデルプロバイダーが完了したレスポンスに使用量を含めた場合にのみ報告されます。累積値の対象は、その `RealtimeSession` が受信したレスポンスです。複数のセッションを横断した合計ではありません。

### 中断と再生トラッキング

ユーザーがアシスタントを中断すると、セッションは `audio_interrupted` を発行し、ユーザーが実際に聞いた内容とサーバー側の会話が一致するように履歴を更新します。

低レイテンシーのローカル再生では、通常はデフォルトの再生トラッカーで十分です。リモート再生や遅延再生、特に電話通信では、生成された音声がすべてすでに聞かれたと見なすのではなく、実際の再生位置で中断されたレスポンスを切り詰めるために、[`RealtimePlaybackTracker`][agents.realtime.model.RealtimePlaybackTracker] を使用します。

[`examples/realtime/twilio/twilio_handler.py`](https://github.com/openai/openai-agents-python/tree/main/examples/realtime/twilio/twilio_handler.py) の Twilio コード例で、このパターンを確認できます。

## ツール、承認、ハンドオフ、ガードレール

### 関数ツール

リアルタイムエージェントは、ライブ会話中の関数ツールをサポートします。

```python
from agents.decorators import tool


@tool
def get_weather(city: str) -> str:
    """Get current weather for a city."""
    return f"The weather in {city} is sunny, 72F."


agent = RealtimeAgent(
    name="Assistant",
    instructions="You can answer weather questions.",
    tools=[get_weather],
)
```

### ツール承認

関数ツールでは、実行前に人間による承認を必須にできます。この場合、セッションは `tool_approval_required` を発行し、`approve_tool_call()` または `reject_tool_call()` を呼び出すまでツールの実行を一時停止します。

ツールに入力ガードレールもある場合、承認後の実行直前にそれらのガードレールが実行されます。承認イベントが発行される前に実行するには、`RealtimeRunner(..., config={"tool_execution": {"pre_approval_tool_input_guardrails": True}})` を指定してランナーを作成します。この承認前チェックを通過した呼び出しも、承認後の実行前に再度チェックされます。

```python
async for event in session:
    if event.type == "tool_approval_required":
        await session.approve_tool_call(event.call_id)
```

具体的なサーバー側の承認ループについては、[`examples/realtime/app/server.py`](https://github.com/openai/openai-agents-python/tree/main/examples/realtime/app/server.py) を参照してください。Human-in-the-loop のドキュメントでも、[Human in the loop](../human_in_the_loop.md) でこのフローを参照しています。

### ハンドオフ

リアルタイムハンドオフを使用すると、あるエージェントから別の専門エージェントへライブ会話を引き継げます。

```python
from agents.realtime import RealtimeAgent, realtime_handoff

billing_agent = RealtimeAgent(
    name="Billing Support",
    instructions="You specialize in billing issues.",
)

main_agent = RealtimeAgent(
    name="Customer Service",
    instructions="Triage the request and hand off when needed.",
    handoffs=[
        realtime_handoff(
            billing_agent,
            tool_description_override="Transfer to billing support",
        )
    ],
)
```

ハンドオフとして直接使用される `RealtimeAgent` オブジェクトは自動的にラップされます。また、`realtime_handoff(...)` を使用すると、名前、説明、検証、コールバック、利用可否をカスタマイズできます。リアルタイムハンドオフでは、通常のハンドオフの `input_filter` はサポートされていません。

### ガードレール

リアルタイムエージェントは、エージェントのレスポンスに対する出力ガードレールと、関数ツール呼び出しに対する入力ガードレールをサポートします。出力ガードレールのチェックはデバウンスされます。各チェックは、部分的な差分ごとではなく、蓄積された出力テキストと音声文字起こしの差分に対して実行され、例外を発生させる代わりに `guardrail_tripped` を発行します。

```python
from agents.guardrail import GuardrailFunctionOutput, OutputGuardrail


def sensitive_data_check(context, agent, output):
    return GuardrailFunctionOutput(
        tripwire_triggered="password" in output,
        output_info=None,
    )


agent = RealtimeAgent(
    name="Assistant",
    instructions="...",
    output_guardrails=[OutputGuardrail(guardrail_function=sensitive_data_check)],
)
```

音声文字起こしに対してリアルタイム出力ガードレールが作動すると、セッションはアクティブなレスポンスを中断し、`response.cancel` を強制し、`guardrail_tripped` を発行します。さらに、作動したガードレールの名前を含むフォローアップのユーザーメッセージを送信し、モデルが代替レスポンスを生成できるようにします。トリップワイヤーが作動した時点で音声の一部がすでにバッファリングされている可能性があるため、音声プレイヤーでは引き続き `audio_interrupted` を監視し、ローカル再生を直ちに停止する必要があります。組み込みの OpenAI Realtime トランスポートでは、チェック対象のレスポンスが終了した後にガードレールチェックが完了した場合、セッションはそのレスポンスのバッファリング済み再生だけを中断し、後から開始されたレスポンスはキャンセルしません。テキストのみの出力では、代わりにレスポンス単位の `response.cancel` を送信します。停止すべき音声再生がないため、`audio_interrupted` は発行されません。組み込みの OpenAI Realtime モデルを使用する場合、テキストのみの経路でも同じ `guardrail_tripped` イベントとフォローアップのユーザーメッセージが発行されます。

カスタム `RealtimeModel` トランスポートでは、同じ発生元レスポンス単位の音声中断動作を実現するため、`RealtimeModelSendInterrupt.response_id` と `playback_only` に従う必要があります。また、テキストのみの出力経路で復旧メッセージをサポートするには、`RealtimeModel.send_event_if()` をオーバーライドする必要があります。実装では、トランスポートで実際にイベントを確定する境界において、指定された条件を再チェックするか、条件チェックとイベントの確定をまとめて直列化する必要があります。デフォルト実装は復旧メッセージを安全にスキップします。条件を一度チェックしてからイベントを別途送信すると、そのチェックからイベントの確定までの間に別のレスポンスが開始される可能性があるためです。レスポンスのキャンセルと `guardrail_tripped` イベントは引き続き発生します。

## SIP と電話通信

Python SDK には、[`OpenAIRealtimeSIPModel`][agents.realtime.openai_realtime.OpenAIRealtimeSIPModel] を介した正式サポートの SIP アタッチフローが含まれています。

Realtime Calls API 経由で着信した通話に対し、生成された `call_id` にエージェントセッションをアタッチする場合に使用します。

```python
from agents.realtime import RealtimeRunner
from agents.realtime.openai_realtime import OpenAIRealtimeSIPModel

runner = RealtimeRunner(starting_agent=agent, model=OpenAIRealtimeSIPModel())

async with await runner.run(
    model_config={
        "call_id": call_id_from_webhook,
    }
) as session:
    async for event in session:
        ...
```

最初に通話を受け入れる必要があり、受け入れペイロードをエージェントから生成されたセッション設定と一致させたい場合は、`OpenAIRealtimeSIPModel.build_initial_session_payload(...)` を使用します。完全なフローは [`examples/realtime/twilio_sip/server.py`](https://github.com/openai/openai-agents-python/tree/main/examples/realtime/twilio_sip/server.py) にあります。

## 低レベルアクセスとカスタムエンドポイント

基盤となるトランスポートオブジェクトには、`session.model` を介してアクセスできます。

次のものが必要な場合に使用します。

-   `session.model.add_listener(...)` を使用したカスタムリスナー
-   `response.create` や `session.update` などの raw クライアントイベント
-   `model_config` を介したカスタムの `url`、`headers`、または `api_key` の処理
-   既存のリアルタイム通話への `call_id` によるアタッチ

`RealtimeModelConfig` は次をサポートします。

-   `api_key`
-   `url`
-   `headers`
-   `initial_model_settings`
-   `playback_tracker`
-   `call_id`

このリポジトリに同梱されている `call_id` コード例は SIP です。より広範な Realtime API では、一部のサーバー側制御フローに `call_id` も使用しますが、ここでは Python コード例としてパッケージ化されていません。

Azure OpenAI に接続する場合は、GA Realtime エンドポイント URL と明示的なヘッダーを渡します。次に例を示します。

```python
session = await runner.run(
    model_config={
        "url": "wss://<your-resource>.openai.azure.com/openai/v1/realtime?model=<deployment-name>",
        "headers": {"api-key": "<your-azure-api-key>"},
    }
)
```

トークンベース認証では、`headers` に Bearer トークンを使用します。

```python
session = await runner.run(
    model_config={
        "url": "wss://<your-resource>.openai.azure.com/openai/v1/realtime?model=<deployment-name>",
        "headers": {"authorization": f"Bearer {token}"},
    }
)
```

`headers` を渡した場合、SDK は `Authorization` を自動的に追加しません。リアルタイムエージェントでは、従来のベータ版パス（`/openai/realtime?api-version=...`）を使用しないでください。

## 関連資料

-   [リアルタイムトランスポート](transport.md)
-   [クイックスタート](quickstart.md)
-   [OpenAI Realtime の会話](https://developers.openai.com/api/docs/guides/realtime-conversations/)
-   [OpenAI Realtime のサーバー側制御](https://developers.openai.com/api/docs/guides/realtime-server-controls/)
-   [`examples/realtime`](https://github.com/openai/openai-agents-python/tree/main/examples/realtime)