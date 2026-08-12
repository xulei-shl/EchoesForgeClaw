---
search:
  exclude: true
---
# モデル

Agents SDK は、すぐに利用できる OpenAI モデルを次の 2 種類の形式でサポートしています。

-   **推奨**: 新しい [Responses API](https://platform.openai.com/docs/api-reference/responses) を使用して OpenAI API を呼び出す [`OpenAIResponsesModel`][agents.models.openai_responses.OpenAIResponsesModel]。
-   [Chat Completions API](https://platform.openai.com/docs/api-reference/chat) を使用して OpenAI API を呼び出す [`OpenAIChatCompletionsModel`][agents.models.openai_chatcompletions.OpenAIChatCompletionsModel]。

## モデル設定の選択

まず、設定に合う最もシンプルな方法を選択してください。

| 目的 | 推奨される方法 | 詳細 |
| --- | --- | --- |
| OpenAI モデルのみを使用する | デフォルトの OpenAI プロバイダーで Responses モデルのパスを使用する | [OpenAI モデル](#openai-models) |
| WebSocket トランスポート経由で OpenAI Responses API を使用する | Responses モデルのパスを維持し、WebSocket トランスポートを有効にする | [Responses WebSocket トランスポート](#responses-websocket-transport) |
| OpenAI がホストするサブエージェントを使用する | 実験的なホスト型マルチエージェントモデルを使用する | [ホスト型マルチエージェント](#hosted-multi-agent-experimental) |
| OpenAI 以外の単一プロバイダーを使用する | 組み込みのプロバイダー統合ポイントから始める | [OpenAI 以外のモデル](#non-openai-models) |
| エージェント間でモデルまたはプロバイダーを組み合わせる | 実行ごとまたはエージェントごとにプロバイダーを選択し、機能の違いを確認する | [単一ワークフローでのモデルの組み合わせ](#mixing-models-in-one-workflow)および[複数プロバイダー間でのモデルの組み合わせ](#mixing-models-across-providers) |
| OpenAI Responses の高度なリクエスト設定を調整する | OpenAI Responses のパスで `ModelSettings` を使用する | [OpenAI Responses の高度な設定](#advanced-openai-responses-settings) |
| OpenAI 以外または複数プロバイダーのルーティングにサードパーティ製アダプターを使用する | サポートされているベータ版アダプターを比較し、リリース予定のプロバイダーパスを検証する | [サードパーティ製アダプター](#third-party-adapters) |

## OpenAI モデル

OpenAI のみを使用するほとんどのアプリでは、デフォルトの OpenAI プロバイダーで文字列のモデル名を使用し、Responses モデルのパスを維持することを推奨します。

[`Agent`][agents.agent.Agent] でモデルを指定しない場合、Agents SDK はコスト重視で大量処理を行うエージェントワークフロー向けに、デフォルトで `reasoning.effort="none"` および `verbosity="low"` とともに [`gpt-5.6-luna`](https://developers.openai.com/api/docs/models/gpt-5.6-luna) を使用します。最先端の能力が必要なアプリケーションでは、`model="gpt-5.6-sol"` を明示的に設定し、ワークロードに適した `model_settings` を選択できます。

`gpt-5.6-sol` などの別のモデルに切り替える場合、エージェントを設定する方法は 2 つあります。

### デフォルトモデル

まず、カスタムモデルを設定していないすべてのエージェントで特定のモデルを一貫して使用する場合は、エージェントを実行する前に `OPENAI_DEFAULT_MODEL` 環境変数を設定します。

```bash
export OPENAI_DEFAULT_MODEL=gpt-5.6-sol
python3 my_awesome_agent.py
```

次に、`RunConfig` を使用して、実行のデフォルトモデルを設定できます。エージェントにモデルを設定しなかった場合、この実行のモデルが使用されます。

```python
from agents import Agent, RunConfig, Runner

agent = Agent(
    name="Assistant",
    instructions="You're a helpful agent.",
)

result = await Runner.run(
    agent,
    "Hello",
    run_config=RunConfig(model="gpt-5.6-sol"),
)
```

#### GPT-5 モデル

この方法で `gpt-5.6-sol` などの任意の GPT-5 モデルを使用すると、SDK はデフォルトの `ModelSettings` を適用します。これには、ほとんどのユースケースに最適な設定が指定されています。デフォルトモデルの推論量を調整するには、独自の `ModelSettings` を渡します。

```python
from openai.types.shared import Reasoning
from agents import Agent, ModelSettings

my_agent = Agent(
    name="My Agent",
    instructions="You're a helpful agent.",
    # If OPENAI_DEFAULT_MODEL=gpt-5.6-sol is set, passing only model_settings works.
    # It's also fine to pass a GPT-5 model name explicitly:
    model="gpt-5.6-sol",
    model_settings=ModelSettings(reasoning=Reasoning(effort="high"), verbosity="low")
)
```

レイテンシーを低減するには、GPT-5 モデルで `reasoning.effort="none"` を使用することを推奨します。

GPT-5.6 は、既存の `reasoning` 設定を通じて、推論モード、会話ターン間で引き継がれる推論コンテキスト、および `"max"` の effort レベルもサポートします。これらの制御は Responses API のパスで使用できます。

```python
from openai.types.shared import Reasoning
from agents import Agent, ModelSettings

agent = Agent(
    name="Deep research agent",
    model="gpt-5.6-sol",
    model_settings=ModelSettings(
        reasoning=Reasoning(
            mode="pro",
            effort="max",
            context="all_turns",
        ),
    ),
)
```

`reasoning.mode` と `reasoning.context` は Responses 専用の設定です。Chat Completions は `reasoning.effort` のみを使用し、サポートされる effort レベルはモデルと API サーフェスによって異なります。GPT-5.6 の `"max"` effort には Responses API を使用してください。Chat Completions アダプターは警告を表示して mode と context を無視します。この警告をエラーに変更するには、OpenAI プロバイダーで `strict_feature_validation=True` を設定します。

`context="all_turns"` を使用する場合は、`previous_response_id`、サーバー側の Responses API 会話、または次のリクエストに以前の推論項目を含めることで、会話を維持してください。ステートレスな `store=False` 呼び出しでは、レスポンスで `reasoning.encrypted_content` をリクエストし、その推論項目を次のリクエストの入力に含めます。

#### ComputerTool のモデル選択

エージェントに [`ComputerTool`][agents.tool.ComputerTool] が含まれる場合、実際の Responses リクエストにおける有効なモデルによって、SDK が送信するコンピューターツールのペイロードが決まります。明示的な `gpt-5.5` リクエストでは、GA の組み込み `computer` ツールが使用されます。一方、明示的な `computer-use-preview` リクエストでは、従来の `computer_use_preview` ペイロードが維持されます。

主な例外は、プロンプトで管理される呼び出しです。プロンプトテンプレートでモデルを指定し、SDK がリクエストから `model` を省略する場合、プロンプトでどのモデルが固定されているかを推測しないよう、SDK はプレビュー互換のコンピューターペイロードをデフォルトで使用します。このフローで GA のパスを維持するには、リクエストで `model="gpt-5.5"` を明示するか、`ModelSettings(tool_choice="computer")` または `ModelSettings(tool_choice="computer_use")` を使用して GA セレクターを強制します。

[`ComputerTool`][agents.tool.ComputerTool] が登録されている場合、`tool_choice="computer"`、`"computer_use"`、および `"computer_use_preview"` は、有効なリクエストモデルに一致する組み込みセレクターに正規化されます。`ComputerTool` が登録されていない場合、これらの文字列は引き続き通常の関数名として動作します。

プレビュー互換のリクエストでは、`environment` と表示サイズを事前にシリアライズする必要があります。そのため、[`ComputerProvider`][agents.tool.ComputerProvider] ファクトリーを使用する、プロンプトで管理されたフローでは、具体的な `Computer` または `AsyncComputer` インスタンスを渡すか、リクエストを送信する前に GA セレクターを強制する必要があります。移行の詳細については、[ツール](../tools.md#computertool-and-the-responses-computer-tool)を参照してください。

#### GPT-5 以外のモデル

カスタムの `model_settings` を指定せずに GPT-5 以外のモデル名を渡すと、SDK は任意のモデルと互換性のある汎用の `ModelSettings` に戻ります。

### Responses 専用のツール機能

以下のツール機能は、OpenAI Responses モデルでのみサポートされます。

-   [`ToolSearchTool`][agents.tool.ToolSearchTool]
-   [`tool_namespace()`][agents.tool.tool_namespace]
-   `@function_tool(defer_loading=True)` およびその他の遅延読み込み対応の Responses ツールサーフェス
-   [`ProgrammaticToolCallingTool`][agents.tool.ProgrammaticToolCallingTool]、`allowed_callers`、および `tool_choice="programmatic_tool_calling"`

これらの機能は、Chat Completions モデルおよび Responses 以外のバックエンドでは拒否されます。遅延読み込みツールを使用する場合は、エージェントに `ToolSearchTool()` を追加し、単独の名前空間名や遅延読み込み専用の関数名を強制するのではなく、`auto` または `required` のツール選択を通じてモデルにツールを読み込ませます。設定の詳細と現在の制約については、[ホスト型ツール検索](../tools.md#hosted-tool-search)および[プログラムによるツール呼び出し](../tools.md#programmatic-tool-calling)を参照してください。

### Responses WebSocket トランスポート

デフォルトでは、OpenAI Responses API のリクエストは HTTP トランスポートを使用します。OpenAI Responses プロバイダーのパスを使用する場合は、WebSocket トランスポートを明示的に有効にできます。

#### 基本設定

```python
from agents import set_default_openai_responses_transport

set_default_openai_responses_transport("websocket")
```

これは、デフォルトの OpenAI プロバイダーがモデル名を解決した結果となる OpenAI Responses モデルに影響します。これには、`"gpt-5.6-sol"` などの文字列のモデル名も含まれます。

トランスポートの選択は、SDK がモデル名をモデルインスタンスへ解決するときに行われます。具体的な [`Model`][agents.models.interface.Model] オブジェクトを渡す場合、そのトランスポートはすでに固定されています。[`OpenAIResponsesWSModel`][agents.models.openai_responses.OpenAIResponsesWSModel] は WebSocket、[`OpenAIResponsesModel`][agents.models.openai_responses.OpenAIResponsesModel] は HTTP を使用し、[`OpenAIChatCompletionsModel`][agents.models.openai_chatcompletions.OpenAIChatCompletionsModel] は Chat Completions のままです。`RunConfig(model_provider=...)` を渡した場合は、グローバルなデフォルトではなく、そのプロバイダーがトランスポートの選択を制御します。

#### プロバイダーまたは実行レベルの設定

プロバイダーごと、または実行ごとに WebSocket トランスポートを設定することもできます。

```python
from agents import Agent, OpenAIProvider, RunConfig, Runner

provider = OpenAIProvider(
    use_responses_websocket=True,
    # Optional; if omitted, OPENAI_WEBSOCKET_BASE_URL is used when set.
    websocket_base_url="wss://your-proxy.example/v1",
    # Optional low-level websocket keepalive settings.
    responses_websocket_options={"ping_interval": 20.0, "ping_timeout": 60.0},
)

agent = Agent(name="Assistant")
result = await Runner.run(
    agent,
    "Hello",
    run_config=RunConfig(model_provider=provider),
)
```

SDK の OpenAI 統合を経由してルーティングするプロバイダーは、オプションのエージェント登録設定も受け付けます。これは、OpenAI の設定でハーネス ID などのプロバイダーレベルの登録メタデータが必要な場合の高度なオプションです。

```python
from agents import (
    Agent,
    OpenAIAgentRegistrationConfig,
    OpenAIProvider,
    RunConfig,
    Runner,
)

provider = OpenAIProvider(
    use_responses_websocket=True,
    agent_registration=OpenAIAgentRegistrationConfig(harness_id="your-harness-id"),
)

agent = Agent(name="Assistant")
result = await Runner.run(
    agent,
    "Hello",
    run_config=RunConfig(model_provider=provider),
)
```

#### `MultiProvider` を使用した高度なルーティング

プレフィックスに基づくモデルルーティングが必要な場合、たとえば 1 回の実行で `openai/...` と `any-llm/...` のモデル名を組み合わせる場合は、[`MultiProvider`][agents.MultiProvider] を使用し、そこで `openai_use_responses_websocket=True` を設定します。

`MultiProvider` には、従来からのデフォルト動作が 2 つあります。

-   `openai/...` は OpenAI プロバイダーのエイリアスとして扱われるため、`openai/gpt-4.1` はモデル `gpt-4.1` としてルーティングされます。
-   不明なプレフィックスは、そのまま渡されるのではなく `UserError` を発生させます。

OpenAI プロバイダーを、名前空間付きのモデル ID をそのまま要求する OpenAI 互換エンドポイントに接続する場合は、パススルー動作を明示的に有効にします。WebSocket を有効にした設定では、`MultiProvider` にも `openai_use_responses_websocket=True` を維持してください。

```python
from agents import Agent, MultiProvider, RunConfig, Runner

provider = MultiProvider(
    openai_base_url="https://openrouter.ai/api/v1",
    openai_api_key="...",
    openai_use_responses_websocket=True,
    openai_prefix_mode="model_id",
    unknown_prefix_mode="model_id",
)

agent = Agent(
    name="Assistant",
    instructions="Be concise.",
    model="openai/gpt-4.1",
)

result = await Runner.run(
    agent,
    "Hello",
    run_config=RunConfig(model_provider=provider),
)
```

バックエンドが文字列 `openai/...` をそのまま要求する場合は、`openai_prefix_mode="model_id"` を使用します。バックエンドが `openrouter/openai/gpt-4.1-mini` など、その他の名前空間付きモデル ID を要求する場合は、`unknown_prefix_mode="model_id"` を使用します。これらのオプションは、WebSocket トランスポート以外の `MultiProvider` でも機能します。この例で WebSocket を有効にしているのは、このセクションで説明しているトランスポート設定の一部だからです。同じオプションは [`responses_websocket_session()`][agents.responses_websocket_session] でも使用できます。

`MultiProvider` を介してルーティングする際に、同じプロバイダーレベルの登録メタデータが必要な場合は、`openai_agent_registration=OpenAIAgentRegistrationConfig(...)` を渡します。これは基盤となる OpenAI プロバイダーへ転送されます。

カスタムの OpenAI 互換エンドポイントまたはプロキシを使用する場合、WebSocket トランスポートには互換性のある WebSocket の `/responses` エンドポイントも必要です。このような設定では、`websocket_base_url` を明示的に設定する必要がある場合があります。

#### 注意事項

-   これは WebSocket トランスポート経由の Responses API であり、[Realtime API](../realtime/guide.md) ではありません。Chat Completions には適用されません。OpenAI 以外のプロバイダーには、Responses WebSocket の `/responses` エンドポイントをサポートしている場合にのみ適用されます。
-   環境にまだ存在しない場合は、`websockets` パッケージをインストールしてください。
-   WebSocket トランスポートを有効にした後、[`Runner.run_streamed()`][agents.run.Runner.run_streamed] を直接使用できます。複数のターン間で同じ WebSocket 接続を再利用したいマルチターンワークフローでは、ネストされた Agents-as-tools 呼び出しも含め、[`responses_websocket_session()`][agents.responses_websocket_session] ヘルパーを推奨します。[エージェントの実行](../running_agents.md)ガイドおよび [`examples/basic/stream_ws.py`](https://github.com/openai/openai-agents-python/tree/main/examples/basic/stream_ws.py) を参照してください。
-   長時間の推論ターンやレイテンシーが急増するネットワークでは、`responses_websocket_options` を使用して WebSocket のキープアライブ動作をカスタマイズします。遅延した pong フレームを許容するには `ping_timeout` を増やし、ping を有効にしたままハートビートのタイムアウトを無効にするには `ping_timeout=None` を設定します。WebSocket のレイテンシーより信頼性が重要な場合は、HTTP/SSE トランスポートを優先してください。
-   デフォルトでは、SDK は受信メッセージのサイズ上限を無効にします（`max_size=None`）。プロキシの背後にある長時間稼働のエージェントプロセスや、メモリに制約があるコンテナでは、メッセージごとのメモリ使用量を制限するために `responses_websocket_options={"max_size": 8 * 1024 * 1024}` を設定します。
-   [Responses API WebSocket サービス](https://developers.openai.com/api/docs/guides/websocket-mode)は、各接続で一度に 1 つのレスポンスを処理し、各接続を 60 分に制限します。この上限に達したら、新しい接続を開いてください。並列実行が必要な場合は、複数の接続を使用します。
-   サービスは、接続ローカルのメモリに最新のレスポンスのみを保持します。失敗した `4xx` または `5xx` のターンでは、`previous_response_id` が参照するレスポンスがそのメモリから削除されます。再接続後も、保存済みのレスポンスが利用可能であれば続行できますが、`store=False` および ZDR フローには永続化されたフォールバックがありません。`previous_response_id=None` で新しいチェーンを開始して完全な入力コンテキストを送信するか、ローカルで管理しているセッション状態からそのコンテキストを再構築してください。

### ホスト型マルチエージェント（実験的）

OpenAI Responses API のホスト型マルチエージェントベータでは、GPT-5.6 のルートモデルがサーバーでホストされるサブエージェントを作成して連携できます。Agents SDK は通常どおり `Runner` を使用し続けられます。ホスト型オーケストレーションはサービス上で行われ、開発者が定義した関数ツールはアプリケーション内で実行されます。

この統合は実験的であり、ローカル関数の出力を `response.inject` を使用してアクティブなホスト型エージェントへ返せるよう、Responses WebSocket トランスポートを使用します。`client.beta.responses.connect` を公開する、バージョン 2.45.0 以降の `openai[realtime]` ビルドが必要です。インターフェースとベータ版の項目スキーマは、一般提供までに変更される可能性があります。

#### モデルの設定

実験的モジュールからモデルをインポートし、SDK の `Agent` に割り当てます。

```python
from agents import Agent
from agents.extensions.experimental.hosted_multi_agent import OpenAIHostedMultiAgentModel

agent = Agent(
    name="Research coordinator",
    instructions="Delegate independent research tasks, then synthesize the findings.",
    model=OpenAIHostedMultiAgentModel(model="gpt-5.6-sol", config={"max_concurrent_subagents": 3}),
)
```

`OpenAIHostedMultiAgentModel` を構築すると `multi_agent.enabled` が有効になり、`OpenAI-Beta: responses_multi_agent=v1` WebSocket ヘッダーが送信されます。`openai_client` を指定しない限り、このモデルはデフォルトの OpenAI クライアントを使用します。`max_concurrent_subagents` を省略すると、サービスのデフォルトが使用されます。

#### ローカル関数ツール

すべてのホスト型エージェントは、リクエストに設定されたモデルとツールを共有します。どのホスト型エージェントが関数を呼び出すかは、Responses API が決定します。通常の SDK Runner が関数をローカルで実行し、同じ呼び出し ID を持つ `function_call_output` をアクティブな WebSocket レスポンスに挿入します。これにより、サービスは元のホスト型呼び出し元を再開できます。関数の実行には、引き続き Runner の通常のガードレール、フック、および失敗時の変換が適用されます。SDK のツール承認による中断はサポートされません。`needs_approval` 設定が `False` ではない関数ツールは、リクエストの送信前に拒否されます。

ツールで呼び出し元を考慮したログ記録または認可が必要な場合は、`get_hosted_agent_metadata()` を使用します。

```python
from typing import Any

from agents.decorators import tool
from agents.extensions.experimental.hosted_multi_agent import get_hosted_agent_metadata
from agents.tool_context import ToolContext

@tool
def lookup_document(ctx: ToolContext[Any], section: str) -> str:
    metadata = get_hosted_agent_metadata(ctx)
    caller = metadata.agent_name if metadata else "unknown"
    print(f"tool caller: {caller}; call ID: {ctx.tool_call_id}")
    return f"Contents for {section}"
```

ホスト型エージェントの名前は観測用のメタデータであり、ローカルのルーティング機構ではありません。SDK が提供する呼び出し ID を使用して出力をルーティングしてください。副作用を伴うツールでは、その呼び出し ID を冪等性キーとして使用し、ツールの実行前または実行中に、必要な認可をアプリケーションコードで適用してください。このモデルでは `needs_approval` を使用しないでください。ツールの引数と出力は Responses API の境界を越えます。

#### 出力とストリーミングの動作

`/root` に帰属し、フェーズが `final_answer` のメッセージだけが、通常の最終メッセージになります。実験的アダプターは、サブエージェントのメッセージとホスト型オーケストレーションのレコードを高レベルの `RunResult` から除外します。SDK がこれらのレコードをローカル関数として実行することはありません。

raw ストリーミングでは、ホスト型の出力項目や `response.inject.created` の確認応答を含む、ベータ版 Responses イベントが引き続き公開されます。アダプターは、関数呼び出しの準備ができた時点で、1 つのアクティブなプロバイダーレスポンスを SDK から見える論理モデルターンに分割します。その後、Runner が出力を生成すると、同じプロバイダーレスポンスを再開します。項目またはツール呼び出しが帰属するホスト型エージェントを識別するには、raw のホスト型項目または `ToolContext` とともに `get_hosted_agent_metadata()` を使用します。

#### SDK オーケストレーションとの関係

ホスト型マルチエージェントは、SDK のハンドオフや Agents-as-tools とは別の機能です。

-   ホスト型マルチエージェントは、OpenAI サービス上でサブエージェントを作成します。アプリケーションがそれらのサブエージェントを作成またはスケジュールすることはありません。
-   SDK のハンドオフは、アクティブなローカル SDK の `Agent` を変更します。この実験的モデルを使用する場合、すべてのホスト型エージェントが同じハンドオフツールを受け取り、所有権の競合が発生するため、ハンドオフは拒否されます。
-   Agents-as-tools は引き続き使用できますが、使用するとクライアント側とサーバー側のオーケストレーションがネストされます。追加のレイテンシー、コスト、およびツールの公開範囲を慎重に評価してください。

#### 現在の制限事項

実験的モデルは、`reasoning.summary`、`max_tool_calls`、および呼び出し元が指定する `multi_agent` または `betas` のオーバーライドを拒否します。Responses の `/compact` エンドポイントはベータ版でサポートされていませんが、サービスが各ホスト型エージェントのコンテキストを個別に自動圧縮するため、明示的な `context_management.compact_threshold` は使用できます。

1 つの `OpenAIHostedMultiAgentModel` インスタンスが同時に所有できるアクティブなホスト型レスポンスは、最大 1 つです。ローカル関数の出力を待っている間に実行を中止した場合は、`await model.close()` を呼び出して WebSocket を解放してください。実行中のホスト型レスポンスを別のプロセスまたはイベントループで復元することは、現在サポートされていません。

基盤となる Responses API ベータ版の動作については、[OpenAI マルチエージェントガイド](https://developers.openai.com/api/docs/guides/tools-multi-agent)を参照してください。非ストリーミングおよびストリーミングでの SDK の使用方法については、[`examples/agent_patterns/hosted_multi_agent_beta.py`](https://github.com/openai/openai-agents-python/tree/main/examples/agent_patterns/hosted_multi_agent_beta.py) を参照してください。

## OpenAI 以外のモデル

OpenAI 以外のプロバイダーが必要な場合は、SDK の組み込みプロバイダー統合ポイントから始めてください。多くの設定では、サードパーティ製アダプターを追加しなくても、これで十分です。各パターンのコード例は、[examples/model_providers](https://github.com/openai/openai-agents-python/tree/main/examples/model_providers/) にあります。

### OpenAI 以外のプロバイダーの統合方法

| 方法 | 使用する状況 | スコープ |
| --- | --- | --- |
| [`set_default_openai_client`][agents.set_default_openai_client] | 1 つの OpenAI 互換エンドポイントを、ほとんどまたはすべてのエージェントのデフォルトにする場合 | グローバルなデフォルト |
| [`ModelProvider`][agents.models.interface.ModelProvider] | 1 つのカスタムプロバイダーを単一の実行に適用する場合 | 実行ごと |
| [`Agent.model`][agents.agent.Agent.model] | エージェントごとに異なるプロバイダーまたは具体的なモデルオブジェクトが必要な場合 | エージェントごと |
| サードパーティ製アダプター | 組み込みのパスでは提供されないプロバイダー対応範囲またはルーティングが、アダプターによって必要な場合 | [サードパーティ製アダプター](#third-party-adapters)を参照 |

次の組み込みの方法で、他の LLM プロバイダーを統合できます。

1. [`set_default_openai_client`][agents.set_default_openai_client] は、`AsyncOpenAI` のインスタンスを LLM クライアントとしてグローバルに使用する場合に便利です。これは、LLM プロバイダーに OpenAI 互換の API エンドポイントがあり、`base_url` と `api_key` を設定できる場合に使用します。設定可能なコード例については、[examples/model_providers/custom_example_global.py](https://github.com/openai/openai-agents-python/tree/main/examples/model_providers/custom_example_global.py) を参照してください。
2. [`ModelProvider`][agents.models.interface.ModelProvider] は `Runner.run` レベルで指定します。これにより、「この実行内のすべてのエージェントでカスタムモデルプロバイダーを使用する」と指定できます。設定可能なコード例については、[examples/model_providers/custom_example_provider.py](https://github.com/openai/openai-agents-python/tree/main/examples/model_providers/custom_example_provider.py) を参照してください。
3. [`Agent.model`][agents.agent.Agent.model] を使用すると、特定の Agent インスタンスでモデルを指定できます。これにより、エージェントごとに異なるプロバイダーを組み合わせられます。設定可能なコード例については、[examples/model_providers/custom_example_agent.py](https://github.com/openai/openai-agents-python/tree/main/examples/model_providers/custom_example_agent.py) を参照してください。

`platform.openai.com` の API キーがない場合は、`set_tracing_disabled()` を使用してトレーシングを無効にするか、[別のトレーシングプロセッサー](../tracing.md)を設定することを推奨します。

``` python
from agents import Agent, AsyncOpenAI, OpenAIChatCompletionsModel, set_tracing_disabled

set_tracing_disabled(disabled=True)

client = AsyncOpenAI(api_key="Api_Key", base_url="Base URL of Provider")
model = OpenAIChatCompletionsModel(model="Model_Name", openai_client=client)

agent= Agent(name="Helping Agent", instructions="You are a Helping Agent", model=model)
```

!!! note

    これらのコード例では、多くの LLM プロバイダーがまだ Responses API をサポートしていないため、Chat Completions API/モデルを使用しています。LLM プロバイダーが Responses API をサポートしている場合は、Responses の使用を推奨します。

## 単一ワークフローでのモデルの組み合わせ

単一のワークフロー内で、エージェントごとに異なるモデルを使用したい場合があります。たとえば、トリアージには小さく高速なモデルを使用し、複雑なタスクにはより大規模で高性能なモデルを使用できます。[`Agent`][agents.Agent] を設定するときは、次のいずれかの方法で特定のモデルを選択できます。

1. モデル名を渡す。
2. 任意のモデル名と、その名前を Model インスタンスにマッピングできる [`ModelProvider`][agents.models.interface.ModelProvider] を渡す。
3. [`Model`][agents.models.interface.Model] の実装を直接指定する。

!!! note

    SDK は [`OpenAIResponsesModel`][agents.models.openai_responses.OpenAIResponsesModel] と [`OpenAIChatCompletionsModel`][agents.models.openai_chatcompletions.OpenAIChatCompletionsModel] の両方の形式をサポートしていますが、この 2 つの形式でサポートされる機能とツールが異なるため、ワークフローごとに単一のモデル形式を使用することを推奨します。ワークフローでモデル形式を組み合わせる必要がある場合は、使用するすべての機能が両方で利用可能であることを確認してください。

```python
import asyncio

from agents import Agent, Runner, AsyncOpenAI, OpenAIChatCompletionsModel

spanish_agent = Agent(
    name="Spanish agent",
    instructions="You only speak Spanish.",
    model="gpt-5-mini", # (1)!
)

english_agent = Agent(
    name="English agent",
    instructions="You only speak English",
    model=OpenAIChatCompletionsModel( # (2)!
        model="gpt-5-nano",
        openai_client=AsyncOpenAI()
    ),
)

triage_agent = Agent(
    name="Triage agent",
    instructions="Handoff to the appropriate agent based on the language of the request.",
    handoffs=[spanish_agent, english_agent],
    model="gpt-5.6-sol",
)

async def main():
    result = await Runner.run(triage_agent, input="Hola, ¿cómo estás?")
    print(result.final_output)


if __name__ == "__main__":
    asyncio.run(main())
```

1.  OpenAI モデルの名前を直接設定します。
2.  [`Model`][agents.models.interface.Model] の実装を指定します。

エージェントで使用するモデルをさらに設定する場合は、temperature などのオプションのモデル設定パラメーターを提供する [`ModelSettings`][agents.model_settings.ModelSettings] を渡せます。

```python
from agents import Agent, ModelSettings

english_agent = Agent(
    name="English agent",
    instructions="You only speak English",
    model="gpt-4.1",
    model_settings=ModelSettings(temperature=0.1),
)
```

## OpenAI Responses の高度な設定

OpenAI Responses のパスを使用していて、より詳細な制御が必要な場合は、まず `ModelSettings` を使用します。

### 一般的な高度な `ModelSettings` オプション

OpenAI Responses API を使用する場合、いくつかのリクエストフィールドには対応する `ModelSettings` フィールドがすでに直接用意されているため、それらに `extra_args` を使用する必要はありません。

- `parallel_tool_calls`: 同じターンで複数のツール呼び出しを許可または禁止します。
- `truncation`: コンテキストが上限を超える場合に失敗させるのではなく、Responses API が最も古い会話項目を削除できるよう、`"auto"` を設定します。
- `store`: 生成されたレスポンスを後で取得できるよう、サーバー側に保存するかどうかを制御します。これは、レスポンス ID に依存する後続ワークフローや、`store=False` の場合にローカル入力へフォールバックする必要があるセッション圧縮フローに影響します。
- `context_management`: `compact_threshold` を使用する Responses の圧縮など、サーバー側のコンテキスト処理を設定します。
- `prompt_cache_retention`: 以前のモデルファミリー向けの保持期間延長を設定します。たとえば、
  `"24h"` を使用します。
- `prompt_cache_options`: 暗黙的または明示的なプロンプトキャッシュを選択し、GPT-5.6 では `"30m"` のキャッシュ TTL を設定します。
- `response_include`: `web_search_call.action.sources`、`file_search_call.results`、`reasoning.encrypted_content` など、より詳細なレスポンスペイロードをリクエストします。
- `top_logprobs`: 出力テキストについて、上位トークンの logprobs をリクエストします。SDK は `message.output_text.logprobs` も自動的に追加します。
- `retry`: モデル呼び出しに対して Runner が管理する再試行設定を有効にします。[Runner が管理する再試行](#runner-managed-retries)を参照してください。

```python
from agents import Agent, ModelSettings

research_agent = Agent(
    name="Research agent",
    model="gpt-5.6-sol",
    model_settings=ModelSettings(
        parallel_tool_calls=False,
        truncation="auto",
        store=True,
        context_management=[{"type": "compaction", "compact_threshold": 200000}],
        prompt_cache_options={"mode": "explicit", "ttl": "30m"},
        response_include=["web_search_call.action.sources"],
        top_logprobs=5,
    ),
)
```

明示的なプロンプトキャッシュでは、再利用可能なプレフィックスの末尾となるコンテンツ部分にブレークポイントを追加します。同じ `ModelSettings.prompt_cache_options` フィールドが Responses と Chat Completions のリクエストにそのまま渡され、Chat Completions コンバーターは、テキスト、画像、音声、およびファイルのコンテンツ部分にあるブレークポイントを維持します。

```python
from agents import Runner

result = await Runner.run(
    research_agent,
    [
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "Reusable background material...",
                    "prompt_cache_breakpoint": {"mode": "explicit"},
                },
                {
                    "type": "input_text",
                    "text": "Analyze the latest question.",
                },
            ],
        }
    ],
)
```

`prompt_cache_retention` は、従来の保持制御を使用する以前のモデルファミリーでも引き続き利用できます。
直接指定する `ModelSettings` フィールドと、`extra_args` 内の同じキーを
組み合わせないでください。

`store=False` を設定すると、Responses API はそのレスポンスを後からサーバー側で取得できる状態に維持しません。これはステートレスまたはゼロデータ保持形式のフローに便利ですが、通常であればレスポンス ID を再利用する機能が、代わりにローカルで管理される状態に依存する必要があることも意味します。たとえば、最後のレスポンスが保存されなかった場合、[`OpenAIResponsesCompactionSession`][agents.memory.openai_responses_compaction_session.OpenAIResponsesCompactionSession] は、デフォルトの `"auto"` 圧縮パスを入力ベースの圧縮へ切り替えます。[セッションガイド](../sessions/index.md#openai-responses-compaction-sessions)を参照してください。

サーバー側の圧縮は、[`OpenAIResponsesCompactionSession`][agents.memory.openai_responses_compaction_session.OpenAIResponsesCompactionSession] とは異なります。`context_management=[{"type": "compaction", "compact_threshold": ...}]` は各 Responses API リクエストで送信され、レンダリングされたコンテキストがしきい値を超えると、API はレスポンスの一部として圧縮項目を生成できます。`OpenAIResponsesCompactionSession` はターン間でスタンドアロンの `responses.compact` エンドポイントを呼び出し、ローカルのセッション履歴を書き換えます。

### `extra_args` の受け渡し

SDK がトップレベルでまだ直接公開していない、プロバイダー固有または新しいリクエストフィールドが必要な場合は、`extra_args` を使用します。

OpenAI モデルを使用する場合、`extra_args` は Responses API と Chat Completions API の両方にオプションのパラメーターを渡せます。たとえば、`user` や `service_tier` です。対応モデルで [Fast mode](https://developers.openai.com/api/docs/guides/fast-mode) を使用するには、`extra_args={"service_tier": "fast"}` を設定します。`"priority"` も同等です。同じリクエストフィールドを、直接指定する `ModelSettings` フィールドでも設定しないでください。

```python
from agents import Agent, ModelSettings

english_agent = Agent(
    name="English agent",
    instructions="You only speak English",
    model="gpt-4.1",
    model_settings=ModelSettings(
        temperature=0.1,
        extra_args={"service_tier": "flex", "user": "user_12345"},
    ),
)
```

## Runner が管理する再試行

再試行はランタイム専用であり、明示的に有効化する必要があります。`ModelSettings(retry=...)` を設定し、再試行ポリシーで再試行を選択しない限り、SDK は一般的なモデルリクエストを再試行しません。

Responses WebSocket トランスポートでは、`retry_policies.provider_suggested()` はレスポンス前の過負荷フレームと、コードのない `server_error` フレームを再試行の提案として認識します。これだけで再試行が有効になるわけではありません。引き続き `ModelRetrySettings` が必要であり、通常のリプレイ安全性チェックも適用されます。レスポンスイベントが 1 つでもすでに到着している場合、SDK はリクエストをリプレイしません。

```python
from agents import Agent, ModelRetrySettings, ModelSettings, retry_policies

agent = Agent(
    name="Assistant",
    model="gpt-5.6-sol",
    model_settings=ModelSettings(
        retry=ModelRetrySettings(
            max_retries=4,
            backoff={
                "initial_delay": 0.5,
                "max_delay": 5.0,
                "multiplier": 2.0,
                "jitter": True,
            },
            policy=retry_policies.any(
                retry_policies.provider_suggested(),
                retry_policies.retry_after(),
                retry_policies.network_error(),
                retry_policies.http_status([408, 409, 429, 500, 502, 503, 504]),
            ),
        )
    ),
)
```

`ModelRetrySettings` には 3 つのフィールドがあります。

<div class="field-table" markdown="1">

| フィールド | 型 | 備考 |
| --- | --- | --- |
| `max_retries` | `int | None` | 最初のリクエスト後に許可される再試行回数です。 |
| `backoff` | `ModelRetryBackoffSettings | dict | None` | ポリシーが明示的な遅延を返さずに再試行する場合の、デフォルトの遅延戦略です。`backoff.max_delay` は、この計算されたバックオフ遅延のみを制限します。ポリシーまたは retry-after ヒントが返す明示的な遅延は制限しません。 |
| `policy` | `RetryPolicy | None` | 再試行するかどうかを決定するコールバックです。このフィールドはランタイム専用であり、シリアライズされません。 |

</div>

再試行ポリシーは、次の情報を含む [`RetryPolicyContext`][agents.retry.RetryPolicyContext] を受け取ります。

- 試行回数を考慮した判断を行うための `attempt` と `max_retries`。
- ストリーミングと非ストリーミングの動作を分岐するための `stream`。
- raw データを調査するための `error`。
- `status_code`、`retry_after`、`error_code`、`is_network_error`、`is_timeout`、`is_abort` などの `normalized` 情報。
- 基盤となるモデルアダプターが再試行の指針を提供できる場合の `provider_advice`。
- ポリシーの実行前に取得される、安定したリプレイ安全性情報としての `response_started`、`replay_safety`、および `stateful_request`。`replay_safety` は `"safe"`、`"unsafe"`、または `"unknown"` です。リクエストが `previous_response_id` または `conversation_id` を使用する場合、`stateful_request` は true です。

ポリシーは、次のいずれかを返せます。

- 単純な再試行判断を示す `True` / `False`。
- 遅延を上書きする場合、診断理由を付加する場合、または限定された範囲の安全でないリプレイを明示的に承認する場合の [`RetryDecision`][agents.retry.RetryDecision]。

SDK は `retry_policies` で、すぐに使用できるヘルパーをエクスポートします。

| ヘルパー | 動作 |
| --- | --- |
| `retry_policies.never()` | 常に再試行しません。 |
| `retry_policies.provider_suggested()` | 利用可能な場合、プロバイダーの再試行に関する助言に従います。 |
| `retry_policies.network_error()` | 一時的なトランスポート障害とタイムアウトに一致します。 |
| `retry_policies.http_status([...])` | 選択した HTTP ステータスコードに一致します。 |
| `retry_policies.retry_after()` | retry-after ヒントが利用可能な場合にのみ、その遅延を使用して再試行します。このヘルパーは retry-after 値を明示的なポリシー遅延として扱うため、`backoff.max_delay` はその値を制限しません。 |
| `retry_policies.any(...)` | ネストされたポリシーのいずれかが再試行を選択した場合に再試行します。 |
| `retry_policies.all(...)` | ネストされたすべてのポリシーが再試行を選択した場合にのみ再試行します。 |

ポリシーを組み合わせる場合、`provider_suggested()` は最も安全な最初の構成要素です。プロバイダーが拒否とリプレイ安全性の承認を区別できる場合に、それらを維持するためです。

##### 安全性の境界

一部の失敗は再試行されません。

- 中止エラー。
- 出力がすでに開始され、リプレイが安全でなくなるストリーミング実行。
- Programmatic Tool Calling リクエストを含め、ローカルの副作用に対する独立したリプレイ拒否があるリクエスト。ただし、プロバイダーがリプレイを安全と個別に判断した場合を除きます。

プロバイダーによって安全でないと判断された失敗も、デフォルトではブロックされます。独立したローカル副作用の拒否がない非ストリーミングリクエストでは、アプリケーションが `RetryDecision(retry=True, approve_unsafe_replay=True)` を返すことで、プロバイダー側のリプレイリスクを受け入れられます。この承認を与える前に、`context.response_started`、`context.replay_safety`、および `context.stateful_request` を確認し、プロバイダー側の処理を繰り返しても問題ない場合にのみ承認してください。通常の `RetryDecision(retry=True)` がリプレイ保護を回避することはありません。また、`approve_unsafe_replay=True` はストリーミングの再試行やローカルの副作用を承認できません。

`previous_response_id` または `conversation_id` を使用するステートフルな後続リクエストは、リプレイの安全性が不明な場合に安全側に倒して失敗します。このようなリクエストでは、`network_error()` や `http_status([500])` など、プロバイダー由来ではない述語だけでは不十分です。通常は `retry_policies.provider_suggested()` を介して、プロバイダーからリプレイ安全性の承認を取得するか、前述の方法でプロバイダーが安全でないと判断した非ストリーミングの失敗を明示的に承認してください。

##### Runner とエージェントのマージ動作

`retry` は、Runner レベルとエージェントレベルの `ModelSettings` の間でディープマージされます。

- エージェントは `retry.max_retries` のみを上書きし、Runner の `policy` を継承できます。
- エージェントは `retry.backoff` の一部のみを上書きし、Runner の他のバックオフフィールドを維持できます。
- `policy` はランタイム専用であるため、シリアライズされた `ModelSettings` は `max_retries` と `backoff` を保持しますが、コールバック自体は省略します。

より詳しいコード例については、[`examples/basic/retry.py`](https://github.com/openai/openai-agents-python/tree/main/examples/basic/retry.py) および[アダプターを利用した再試行のコード例](https://github.com/openai/openai-agents-python/tree/main/examples/basic/retry_litellm.py)を参照してください。

## OpenAI 以外のプロバイダーのトラブルシューティング

### トレーシングクライアントのエラー 401

トレーシングに関するエラーが発生するのは、トレースが OpenAI のサーバーにアップロードされる一方で、OpenAI API キーがないためです。これを解決するには、次の 3 つの方法があります。

1. トレーシングを完全に無効にする: [`set_tracing_disabled(True)`][agents.set_tracing_disabled]。
2. トレーシング用の OpenAI キーを設定する: [`set_tracing_export_api_key(...)`][agents.set_tracing_export_api_key]。この API キーはトレースのアップロードにのみ使用され、[platform.openai.com](https://platform.openai.com/) で発行されたものである必要があります。
3. OpenAI 以外のトレースプロセッサーを使用する。[トレーシングのドキュメント](../tracing.md#custom-tracing-processors)を参照してください。

### Responses API のサポート

SDK はデフォルトで Responses API を使用しますが、他の多くの LLM プロバイダーはまだサポートしていません。その結果、404 エラーまたは同様の問題が発生する場合があります。解決するには、次の 2 つの方法があります。

1. [`set_default_openai_api("chat_completions")`][agents.set_default_openai_api] を呼び出します。これは、環境変数を通じて `OPENAI_API_KEY` と `OPENAI_BASE_URL` を設定している場合に機能します。
2. [`OpenAIChatCompletionsModel`][agents.models.openai_chatcompletions.OpenAIChatCompletionsModel] を使用します。コード例は[こちら](https://github.com/openai/openai-agents-python/tree/main/examples/model_providers/)にあります。

### Chat Completions の互換性オプション

Chat Completions を介してルーティングする場合、SDK は、Chat Completions では送信できない Responses 専用フィールドを通知なく削除することで互換性を維持します。これには、`previous_response_id`、`conversation_id`、Responses API の `prompt` フィールド、またはテキストのみではないツール出力などが含まれます。開発中にこのような不一致を即座に失敗させる場合は、OpenAI プロバイダーで厳格な機能検証を有効にします。

```python
from agents import Agent, OpenAIProvider, RunConfig, Runner

provider = OpenAIProvider(
    use_responses=False,
    strict_feature_validation=True,
)

agent = Agent(name="Assistant")
result = await Runner.run(
    agent,
    "Hello",
    run_config=RunConfig(model_provider=provider),
)
```

[`MultiProvider`][agents.MultiProvider] を使用する場合は、代わりに `openai_strict_feature_validation=True` を渡します。

OpenAI Chat Completions API は音声出力を返せますが、[`OpenAIChatCompletionsModel`][agents.models.openai_chatcompletions.OpenAIChatCompletionsModel] は現在、音声出力を Agents SDK の実行項目へ変換しません。非ストリーミングメッセージまたはストリーミングの差分に音声出力が含まれる場合、アダプターは部分的または空の実行結果を返す代わりに `AgentsException("Audio is not currently supported")` を発生させます。SDK が管理する音声ワークフローには、[Realtime エージェント](../realtime/guide.md)または[音声エージェント](../voice/quickstart.md)を使用してください。

一部の OpenAI 互換 Chat Completions プロバイダーは、SDK がインクリメンタルに処理するには信頼性が不十分なチャンクで、ツール呼び出しの差分をストリーミングします。その場合は、ストリーミングされるツール呼び出しのバッファリングを有効にし、プロバイダーのストリームが終了した後にのみ SDK がツール呼び出しを生成するようにします。

```python
from agents import OpenAIProvider

provider = OpenAIProvider(
    use_responses=False,
    buffer_streamed_tool_calls=True,
)
```

[`MultiProvider`][agents.MultiProvider] では、`openai_buffer_streamed_tool_calls=True` を使用します。

### structured outputs のサポート

一部のモデルプロバイダーは、[structured outputs](https://platform.openai.com/docs/guides/structured-outputs) をサポートしていません。その場合、次のようなエラーが発生することがあります。

```

BadRequestError: Error code: 400 - {'error': {'message': "'response_format.type' : value is not one of the allowed values ['text','json_object']", 'type': 'invalid_request_error'}}

```

これは一部のモデルプロバイダーの制約です。JSON 出力はサポートしていても、出力に使用する `json_schema` を指定できません。現在、この問題の修正に取り組んでいますが、JSON スキーマ出力をサポートするプロバイダーを使用することを推奨します。そうしないと、不正な形式の JSON によってアプリが頻繁に動作しなくなる可能性があります。

## 複数プロバイダー間でのモデルの組み合わせ

モデルプロバイダー間の機能差を把握しておく必要があります。把握していないと、エラーが発生する可能性があります。たとえば、OpenAI は structured outputs、マルチモーダル入力、ホスト型のファイル検索および Web 検索をサポートしていますが、他の多くのプロバイダーはこれらの機能をサポートしていません。次の制限事項に注意してください。

-   理解できないプロバイダーに、サポートされていない `tools` を送信しないでください
-   テキストのみを扱うモデルを呼び出す前に、マルチモーダル入力を除外してください
-   構造化された JSON 出力をサポートしないプロバイダーでは、不正な JSON が生成される場合があることに注意してください。

## サードパーティ製アダプター

SDK の組み込みプロバイダー統合ポイントでは不十分な場合にのみ、サードパーティ製アダプターを使用してください。この SDK で OpenAI モデルのみを使用する場合は、Any-LLM や LiteLLM ではなく、組み込みの [`OpenAIResponsesModel`][agents.models.openai_responses.OpenAIResponsesModel] のパスを優先してください。サードパーティ製アダプターは、OpenAI モデルと OpenAI 以外のプロバイダーを組み合わせる必要がある場合や、アダプターだけが提供するプロバイダー対応範囲またはルーティングが必要な場合に使用します。アダプターにより SDK と上流のモデルプロバイダーの間に互換性レイヤーが追加されるため、機能のサポートとリクエストのセマンティクスはプロバイダーによって異なる可能性があります。SDK には現在、ベストエフォートのベータ版アダプター統合として Any-LLM と LiteLLM が含まれています。

### Any-LLM

Any-LLM のサポートは、Any-LLM が管理するプロバイダー対応範囲またはルーティングが必要な場合向けに、ベストエフォートのベータ版として提供されています。

上流のプロバイダーパスに応じて、Any-LLM は Responses API、Chat Completions 互換 API、またはプロバイダー固有の互換性レイヤーを使用する場合があります。

Any-LLM が必要な場合は、`openai-agents[any-llm]` をインストールし、[`examples/model_providers/any_llm_auto.py`](https://github.com/openai/openai-agents-python/tree/main/examples/model_providers/any_llm_auto.py) または [`examples/model_providers/any_llm_provider.py`](https://github.com/openai/openai-agents-python/tree/main/examples/model_providers/any_llm_provider.py) から始めてください。[`MultiProvider`][agents.MultiProvider] で `any-llm/...` のモデル名を使用するか、`AnyLLMModel` を直接インスタンス化するか、実行スコープで `AnyLLMProvider` を使用できます。モデルサーフェスを明示的に固定する必要がある場合は、`AnyLLMModel` の構築時に `api="responses"` または `api="chat_completions"` を渡します。

Any-LLM は引き続きサードパーティ製アダプターレイヤーであるため、プロバイダーの依存関係と機能差は SDK ではなく、上流の Any-LLM によって定義されます。上流のプロバイダーが使用量メトリクスを返す場合、それらは自動的に伝播されます。ただし、ストリーミングされる Chat Completions バックエンドでは、使用量チャンクを生成する前に `ModelSettings(include_usage=True)` が必要な場合があります。structured outputs、ツール呼び出し、使用量レポート、または Responses 固有の動作に依存する場合は、デプロイ予定のプロバイダーバックエンドを正確に検証してください。

### LiteLLM

LiteLLM のサポートは、LiteLLM 固有のプロバイダー対応範囲またはルーティングが必要な場合向けに、ベストエフォートのベータ版として提供されています。

LiteLLM が必要な場合は、`openai-agents[litellm]` をインストールし、[`examples/model_providers/litellm_auto.py`](https://github.com/openai/openai-agents-python/tree/main/examples/model_providers/litellm_auto.py) または [`examples/model_providers/litellm_provider.py`](https://github.com/openai/openai-agents-python/tree/main/examples/model_providers/litellm_provider.py) から始めてください。`litellm/...` のモデル名を使用するか、[`LitellmModel`][agents.extensions.models.litellm_model.LitellmModel] を直接インスタンス化できます。

LiteLLM アダプターを通じて利用する一部のプロバイダーでは、デフォルトで SDK の使用量メトリクスが設定されません。使用量レポートが必要な場合は `ModelSettings(include_usage=True)` を渡し、structured outputs、ツール呼び出し、使用量レポート、またはアダプター固有のルーティング動作に依存する場合は、デプロイ予定のプロバイダーバックエンドを正確に検証してください。

LiteLLM がレスポンスオブジェクトに対する Pydantic シリアライザーの警告を出力する場合は、LiteLLM アダプターをインポートする前に、SDK の互換性パッチを有効にできます。

```bash
export OPENAI_AGENTS_ENABLE_LITELLM_SERIALIZER_PATCH=true
```

このパッチはデフォルトでは無効であり、`1` または `true` の値でのみ有効になります。LiteLLM の非公開ログヘルパーをラップすることで、LiteLLM のレスポンスシリアライズに関する特定の種類の警告を抑制します。そのため、一般的なシリアライズ設定ではなく、対象を限定した回避策として扱ってください。LiteLLM の非公開 API に依存しているため、LiteLLM をアップグレードするときに再度検証し、上流で警告が発生しなくなったら環境変数を削除してください。