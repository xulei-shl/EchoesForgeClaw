---
search:
  exclude: true
---
# 実行結果

`Runner.run` メソッドを呼び出すと、次の 2 種類の実行結果のいずれかを受け取ります。

-   `Runner.run(...)` または `Runner.run_sync(...)` からの [`RunResult`][agents.result.RunResult]
-   `Runner.run_streamed(...)` からの [`RunResultStreaming`][agents.result.RunResultStreaming]

どちらも [`RunResultBase`][agents.result.RunResultBase] を継承し、`final_output`、`new_items`、`last_agent`、`raw_responses`、`to_state()` など、共通の結果インターフェースを公開します。

`RunResultStreaming` には、[`stream_events()`][agents.result.RunResultStreaming.stream_events]、[`current_agent`][agents.result.RunResultStreaming.current_agent]、[`is_complete`][agents.result.RunResultStreaming.is_complete]、[`cancel(...)`][agents.result.RunResultStreaming.cancel] など、ストリーミング固有の制御機能も追加されています。

## 適切な結果インターフェースの選択

ほとんどのアプリケーションで必要なのは、少数の結果プロパティまたはヘルパーのみです。

| 必要なもの | 使用するもの |
| --- | --- |
| ユーザーに表示する最終回答 | `final_output` |
| ローカルの完全なトランスクリプトを含む、再実行可能な次ターン入力リスト | `to_input_list()` |
| エージェント、ツール、ハンドオフ、承認のメタデータを含む詳細な実行項目 | `new_items` |
| 通常、次のユーザーターンを処理するエージェント | `last_agent` |
| `previous_response_id` を使用した OpenAI Responses API のチェーン | `last_response_id` |
| 保留中の承認と再開可能なスナップショット | `interruptions` および `to_state()` |
| 現在のネストされた `Agent.as_tool()` 呼び出しに関するメタデータ | `agent_tool_invocation` |
| raw モデル呼び出しまたはガードレールの診断情報 | `raw_responses` およびガードレール結果の配列 |

## 最終出力

[`final_output`][agents.result.RunResultBase.final_output] プロパティには、最後に実行されたエージェントの最終出力が含まれます。これは次のいずれかです。

-   最後のエージェントに `output_type` が定義されていなかった場合は、`str`
-   最後のエージェントに出力型が定義されていた場合は、`last_agent.output_type` 型のオブジェクト
-   承認による中断で一時停止した場合など、最終出力が生成される前に実行が停止した場合は、`None`

!!! note

    `final_output` の型は `Any` です。ハンドオフによって実行を完了するエージェントが変わる可能性があるため、SDK は考えられるすべての出力型を静的に把握できません。

ストリーミングモードでは、ストリームの処理が完了するまで `final_output` は `None` のままです。イベントごとのフローについては、[ストリーミング](streaming.md)を参照してください。

## 入力、次ターンの履歴、新規項目

これらのインターフェースは、それぞれ異なる目的に対応します。

| プロパティまたはヘルパー | 含まれる内容 | 最適な用途 |
| --- | --- | --- |
| [`input`][agents.result.RunResultBase.input] | この実行セグメントの基本入力です。ハンドオフ入力フィルターによって履歴が書き換えられた場合は、実行の継続に使用されたフィルター済み入力が反映されます。 | この実行で実際に使用された入力の監査 |
| [`to_input_list()`][agents.result.RunResultBase.to_input_list] | 実行を入力項目として表したビューです。デフォルトの `mode="preserve_all"` は、`new_items` から変換された履歴を維持します。ただし、SDK のデフォルトのネストされたハンドオフ履歴へすでに移動された、セッション項目の同一の出現箇所を再度追加することはありません。`mode="normalized"` は、ハンドオフフィルタリングによってモデル履歴が書き換えられた場合に、正規の継続入力を優先します。 | 手動チャットループ、クライアント管理の会話状態、プレーンな項目としての履歴確認 |
| [`new_items`][agents.result.RunResultBase.new_items] | エージェント、ツール、ハンドオフ、承認のメタデータを含む詳細な [`RunItem`][agents.items.RunItem] ラッパーです。 | ログ、UI、監査、デバッグ |
| [`raw_responses`][agents.result.RunResultBase.raw_responses] | 実行内の各モデル呼び出しから取得された raw [`ModelResponse`][agents.items.ModelResponse] オブジェクトです。 | プロバイダーレベルの診断または raw レスポンスの確認 |

実際には、次のように使い分けます。

-   実行をプレーンな入力項目として確認する場合は、`to_input_list()` を使用します。
-   ハンドオフフィルタリングまたはネストされたハンドオフ履歴の書き換え後に、次の `Runner.run(..., input=...)` 呼び出しで使用する正規のローカル入力が必要な場合は、`to_input_list(mode="normalized")` を使用します。
-   SDK に履歴の読み込みと保存を任せる場合は、[`session=...`](sessions/index.md) を使用します。
-   `conversation_id` または `previous_response_id` を使用して OpenAI のサーバー管理状態を利用している場合、通常は `to_input_list()` を再送信せず、新しいユーザー入力のみを渡して保存済み ID を再利用します。
-   ログ、UI、または監査用に変換済みの完全な履歴が必要な場合は、デフォルトの `to_input_list()` モードまたは `new_items` を使用します。

SDK のデフォルトのネストされたハンドオフ履歴でメッセージ項目がそのまま保持される場合、Sessions、`RunState`、`to_input_list()` は、内容によって重複排除するのではなく、所有する正確な出現箇所を追跡します。別々に発生した同一メッセージは別々のまま保持され、すでに所有されている出現箇所だけが 2 回目の追加を回避されます。

JavaScript SDK とは異なり、Python には実行中に新たに生成されたモデル形式の項目のみを含む独立した `output` プロパティはありません。SDK のメタデータが必要な場合は `new_items` を使用し、raw モデルペイロードが必要な場合は `raw_responses` を確認してください。

コンピュータツールの項目を会話入力として再送信する場合は、raw Responses ペイロード形式が使用されます。プレビューモデルの `computer_call` 項目では単一の `action` が保持される一方、`gpt-5.5` コンピュータ呼び出しでは、バッチ化された `actions[]` を保持できます。[`to_input_list()`][agents.result.RunResultBase.to_input_list] と [`RunState`][agents.run_state.RunState] はモデルが生成した形式を保持するため、これらの項目を会話入力として手動で再送信する場合、一時停止と再開のフロー、保存済みトランスクリプトは、プレビュー版と GA 版の両方のコンピュータツール呼び出しで引き続き動作します。ローカルの実行結果は、引き続き `new_items` 内に `computer_call_output` 項目として表示されます。

### 新規項目

[`new_items`][agents.result.RunResultBase.new_items] では、実行中に起きたことを最も詳細に確認できます。一般的な項目型は次のとおりです。

-   再開されたモデル呼び出しの直前に `RunState.pending_input` から受け入れられた入力を表す [`InputItem`][agents.items.InputItem]
-   アシスタントメッセージを表す [`MessageOutputItem`][agents.items.MessageOutputItem]
-   推論項目を表す [`ReasoningItem`][agents.items.ReasoningItem]
-   Responses のツール検索リクエストと読み込まれたツール検索結果を表す [`ToolSearchCallItem`][agents.items.ToolSearchCallItem] および [`ToolSearchOutputItem`][agents.items.ToolSearchOutputItem]
-   ツール呼び出しとその実行結果を表す [`ToolCallItem`][agents.items.ToolCallItem] および [`ToolCallOutputItem`][agents.items.ToolCallOutputItem]
-   承認のために一時停止したツール呼び出しを表す [`ToolApprovalItem`][agents.items.ToolApprovalItem]
-   ホスト型 MCP の承認とツールカタログを表す [`MCPApprovalRequestItem`][agents.items.MCPApprovalRequestItem]、[`MCPApprovalResponseItem`][agents.items.MCPApprovalResponseItem]、[`MCPListToolsItem`][agents.items.MCPListToolsItem]
-   ハンドオフリクエストと完了した移管を表す [`HandoffCallItem`][agents.items.HandoffCallItem] および [`HandoffOutputItem`][agents.items.HandoffOutputItem]

エージェントとの関連付け、ツール出力、ハンドオフの境界、または承認の境界が必要な場合は、`to_input_list()` ではなく `new_items` を選択してください。

ホスト型ツール検索を使用する場合は、モデルが発行した検索リクエストを確認するには `ToolSearchCallItem.raw_item` を、該当ターンで読み込まれた名前空間、関数、またはホスト型 MCP サーバーを確認するには `ToolSearchOutputItem.raw_item` を調べてください。

プログラムによるツール呼び出しでは、生成された `program` は `ToolCallItem` です。そのプログラムが所有する通常の子ツール呼び出しも `ToolCallItem` エントリであり、対応する `program_output` は `ToolCallOutputItem` です。プログラムが所有するホスト型 MCP の `mcp_approval_request` 項目と `mcp_list_tools` 項目は例外であり、それぞれ `MCPApprovalRequestItem` エントリと `MCPListToolsItem` エントリになります。

raw 項目は、型付きの Responses オブジェクトまたはマッピングである場合があります。特に、プログラムが所有する shell 呼び出しと apply-patch 呼び出しではマッピングが使用されます。マッピングでも安全な次の検査パターンを使用してください。

```python
from collections.abc import Mapping


def raw_field(item, name):
    raw_item = item.raw_item
    if isinstance(raw_item, Mapping):
        return raw_item.get(name)
    return getattr(raw_item, name, None)


raw_type = raw_field(item, "type")
caller = raw_field(item, "caller")
caller_id = (
    caller.get("caller_id")
    if isinstance(caller, Mapping)
    else getattr(caller, "caller_id", None)
)
```

プログラムが所有する子呼び出しでは、`caller` の `type` フィールドは `program` であり、`caller_id` は親プログラム呼び出しを識別します。

## 会話の継続または再開

### 次ターンのエージェント

[`last_agent`][agents.result.RunResultBase.last_agent] には、最後に実行されたエージェントが含まれます。多くの場合、ハンドオフ後の次のユーザーターンで再利用するのに最適なエージェントです。

ストリーミングモードでは、実行の進行に伴って [`RunResultStreaming.current_agent`][agents.result.RunResultStreaming.current_agent] が更新されるため、ストリームが完了する前にハンドオフを確認できます。

### 中断と実行状態

ツールに承認が必要な場合、保留中の承認は [`RunResult.interruptions`][agents.result.RunResult.interruptions] または [`RunResultStreaming.interruptions`][agents.result.RunResultStreaming.interruptions] で公開されます。これには、直接呼び出されたツール、ハンドオフ後に到達したツール、またはネストされた [`Agent.as_tool()`][agents.agent.Agent.as_tool] の実行によって要求された承認が含まれる場合があります。

[`to_state()`][agents.result.RunResult.to_state] を呼び出して、再開可能な [`RunState`][agents.run_state.RunState] を取得します。保留中の項目を承認または却下し、`Runner.run(...)` または `Runner.run_streamed(...)` で再開します。

[`ToolCallOutputItem`][agents.items.ToolCallOutputItem] の出力が Pydantic モデルまたはデータクラスの場合、`RunState` はその出力を構造化データとしてシリアライズします。`RunState` は辞書、リスト、タプルも再帰的に処理し、それらのコンテナ内で検出した Pydantic モデルまたはデータクラスを変換します。タプルは JSON のラウンドトリップ後にリストとして復元されます。JSON と互換性のないその他の値は文字列表現にフォールバックする場合があるため、正確なカスタム型をシリアライズ後も保持する必要がある場合は、明示的に JSON 互換のデータを返してください。

```python
from agents import Agent, Runner

agent = Agent(name="Assistant", instructions="Use tools when needed.")
result = await Runner.run(agent, "Delete temp files that are no longer needed.")

if result.interruptions:
    state = result.to_state()
    for interruption in result.interruptions:
        state.approve(interruption)
    result = await Runner.run(agent, state)
```

#### 再開前の入力追加

実行が一時停止した後、または完了したターンの後で停止したものの、未完了の実行が次のモデル呼び出しに到達する前に新しいユーザー入力を受け取った場合は、[`RunState.add_input()`][agents.run_state.RunState.add_input] を使用します。文字列はユーザーメッセージになり、複数回の呼び出しでは挿入順序が維持されます。ステージ済み入力はシリアライズされた `RunState` の一部であるため、`to_json()` / `from_json()` および `to_string()` / `from_string()` のラウンドトリップ後も保持されます。

```python
state = result.to_state()
state.add_input("Also keep the generated report in the project folder.")

for interruption in state.get_interruptions():
    state.approve(interruption)

result = await Runner.run(agent, state)
```

再開時、Runner は現在のエージェントの入力ガードレールと [`RunConfig`][agents.run.RunConfig] の入力ガードレールの両方を、ステージ済み入力のみに適用します。クライアント管理の [`Session`][agents.memory.session.Session] が構成されている場合、Runner は受け入れられたステージ済み入力を永続的な [`InputItem`][agents.items.InputItem] に変換し、モデルリクエストを発行する前にセッションへの書き込み完了を待ちます。クライアント管理セッションもサーバー管理の会話もない場合、Runner はモデルリクエストを発行する前に、受け入れられたステージ済み入力を `InputItem` に変換します。サーバー管理の会話では、サーバーリクエストが受け入れるまで入力は保留状態のままです。シリアライズ、再開、再実行しても安全な再試行を通じて、SDK は永続的な `InputItem` の出現を 1 つだけ保持します。この SDK による出現回数の保証は、プロバイダーへの配信保証ではありません。リクエストがプロバイダーに到達した可能性がある後で再試行ポリシーが `RetryDecision(approve_unsafe_replay=True)` を返した場合、Runner はステージ済み入力を再送信する可能性があり、プロバイダー側の処理が繰り返されることがあります。正常に受け入れられた入力は、`new_items` に `InputItem` として表示されます。分離されたコピーを取得するには [`RunState.pending_input`][agents.run_state.RunState.pending_input] を読み取り、再開前にすべてのステージ済み入力を破棄するには [`RunState.clear_pending_input()`][agents.run_state.RunState.clear_pending_input] を呼び出します。

`RunState.add_input()` は、終端状態、モデルの残りターンがない状態、受け入れられたモデルレスポンスがローカル処理を待っている状態、および保留中のツール実行結果によって次のモデル呼び出し前に実行が終了する可能性がある中断状態を拒否します。このような場合は、現在の実行を完了してから、新しいユーザーターンを開始してください。

ストリーミング実行では、まず [`stream_events()`][agents.result.RunResultStreaming.stream_events] の消費を完了し、その後 `result.interruptions` を確認して `result.to_state()` から再開します。承認フロー全体については、[Human-in-the-loop](human_in_the_loop.md)を参照してください。

### サーバー管理の継続

[`last_response_id`][agents.result.RunResultBase.last_response_id] は、実行から得られた最新のモデルレスポンス ID です。OpenAI Responses API のチェーンを継続する場合は、次のターンで `previous_response_id` として再度渡します。

すでに `to_input_list()`、`session`、または `conversation_id` を使用して会話を継続している場合、通常は `last_response_id` は必要ありません。複数ステップの実行からすべてのモデルレスポンスが必要な場合は、代わりに `raw_responses` を確認してください。

## ツールとしてのエージェントのメタデータ

ネストされた [`Agent.as_tool()`][agents.agent.Agent.as_tool] の実行から結果が返された場合、[`agent_tool_invocation`][agents.result.RunResultBase.agent_tool_invocation] は、それを囲む `Agent.as_tool()` 呼び出しに関する変更不可能なメタデータを公開します。

-   `tool_name`
-   `tool_call_id`
-   `tool_arguments`

通常のトップレベル実行では、`agent_tool_invocation` は `None` です。

これは特に `custom_output_extractor` 内で、ネストされた実行結果を後処理する際に、それを囲む `Agent.as_tool()` 呼び出しのツール名、呼び出し ID、または raw 引数が必要な場合に役立ちます。関連する `Agent.as_tool()` のパターンについては、[ツール](tools.md)を参照してください。

そのネストされた実行に対するパース済みの構造化入力も必要な場合は、`context_wrapper.tool_input` を読み取ります。これは、[`RunState`][agents.run_state.RunState] がネストされたツール入力として汎用的にシリアライズするフィールドです。一方、`agent_tool_invocation` は、現在のネストされた呼び出しのメタデータを結果上で直接公開します。

## ストリーミングのライフサイクルと診断

[`RunResultStreaming`][agents.result.RunResultStreaming] は前述と同じ結果インターフェースを継承しますが、ストリーミング固有の制御機能も追加されています。

-   セマンティックなストリームイベントを消費するための [`stream_events()`][agents.result.RunResultStreaming.stream_events]
-   実行中のアクティブなエージェントを追跡するための [`current_agent`][agents.result.RunResultStreaming.current_agent]
-   ストリーミング実行が完全に終了したかどうかを確認するための [`is_complete`][agents.result.RunResultStreaming.is_complete]
-   実行を即座に、または現在のターンの後で停止するための [`cancel(...)`][agents.result.RunResultStreaming.cancel]

非同期イテレーターが終了するまで `stream_events()` を消費し続けてください。このイテレーターが終了するまでストリーミング実行は完了していません。また、最後の可視トークンが到着した後も、`final_output`、`interruptions`、`raw_responses` などの概要プロパティや、セッション永続化の副作用が処理中である可能性があります。

`cancel()` を呼び出した場合は、キャンセルとクリーンアップを正しく完了できるように、`stream_events()` の消費を続けてください。

Python には、ストリーミングされた独立の `completed` Promise や `error` プロパティはありません。実行を終了させるストリーミングエラーは `stream_events()` によって送出され、`is_complete` は実行が終端状態に到達したかどうかを示します。

### Raw レスポンス

[`raw_responses`][agents.result.RunResultBase.raw_responses] には、実行中に収集された raw モデルレスポンスが含まれます。複数ステップの実行では、ハンドオフやモデル、ツール、モデルというサイクルの繰り返しなどにより、複数のレスポンスが生成される場合があります。

[`last_response_id`][agents.result.RunResultBase.last_response_id] は、`raw_responses` の最後のエントリから取得した ID にすぎません。

各 [`ModelResponse`][agents.items.ModelResponse] では、個々のモデル呼び出しに適用される次の 2 つの診断情報も公開されます。

-   [`request_id`][agents.items.ModelResponse.request_id] は、モデルアダプターとトランスポートが ID を伝播する場合のトランスポートリクエスト ID です。組み込みの `OpenAIResponsesModel` と `OpenAIChatCompletionsModel` は、HTTP および SSE のトランスポート経路で、利用可能なサーバー生成の `x-request-id` を伝播します。構成されたエンドポイントが OpenAI API の場合は、本番環境で `None` ではない値をログに記録すると、障害を OpenAI サポートに問い合わせる際に関連付けられます。OpenAI 互換プロバイダーまたはプロキシの場合は、代わりにそのサービスのサポート窓口を使用してください。現在、`OpenAIResponsesWSModel` では `request_id` は `None` のままです。サードパーティー製アダプターでは、リクエスト ID の伝播は保証されません。AnyLLM Chat Completions アダプターと `LitellmModel` では、現在 `request_id` は `None` のままです。Agents SDK の AnyLLM Responses アダプターでも、トランスポートリクエスト ID を保持せずにプロバイダーレスポンスを正規化した場合、`request_id` が `None` のままになることがあります。
-   [`raw_usage`][agents.items.ModelResponse.raw_usage] は、Agents SDK がペイロードを正規化する前の、プロバイダーの使用量ペイロードに関するオプトインの JSON 互換スナップショットです。`ModelSettings(preserve_raw_usage=True)` を指定して `raw_usage` を有効にします。[プロバイダーの使用量ペイロードの保持](usage.md#preserving-provider-usage-payloads)を参照してください。

`ModelResponse.request_id` と `ModelResponse.raw_usage` はそれぞれ `None` になる可能性があるため、これらの値は会話状態ではなく、オプションの診断情報として扱ってください。

### ガードレール結果

エージェントレベルのガードレールは、[`input_guardrail_results`][agents.result.RunResultBase.input_guardrail_results] および [`output_guardrail_results`][agents.result.RunResultBase.output_guardrail_results] として公開されます。

ツールのガードレールは、[`tool_input_guardrail_results`][agents.result.RunResultBase.tool_input_guardrail_results] および [`tool_output_guardrail_results`][agents.result.RunResultBase.tool_output_guardrail_results] として個別に公開されます。

これらの配列は実行全体を通じて蓄積されるため、判断のログ記録、追加のガードレールメタデータの保存、または実行がブロックされた理由のデバッグに役立ちます。

### コンテキストと使用量

[`context_wrapper`][agents.result.RunResultBase.context_wrapper] は、承認、使用量、ネストされた `tool_input` など、SDK が管理するランタイムメタデータとともにアプリケーションコンテキストを公開します。

使用量は `context_wrapper.usage` で追跡されます。ストリーミング実行では、ストリームの最後のチャンクが処理されるまで、使用量の合計への反映が遅れる場合があります。ラッパーの完全な形式と永続化に関する注意事項については、[コンテキスト管理](context.md)を参照してください。