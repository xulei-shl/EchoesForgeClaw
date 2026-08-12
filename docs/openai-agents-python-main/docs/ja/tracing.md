---
search:
  exclude: true
---
# トレーシング

Agents SDKには組み込みのトレーシングが含まれており、エージェントの実行中に発生するイベント（LLM生成、ツール呼び出し、ハンドオフ、ガードレール、さらにはカスタムイベントまで）の包括的な記録を収集します。[トレースダッシュボード](https://platform.openai.com/traces)を使用すると、開発環境と本番環境でワークフローをデバッグ、可視化、監視できます。

!!!note

    トレーシングはデフォルトで有効です。一般的な無効化方法は次の 3 つです：

    1. 環境変数 `OPENAI_AGENTS_DISABLE_TRACING=1` を設定して、トレーシングをグローバルに無効化できます
    2. [`set_tracing_disabled(True)`][agents.set_tracing_disabled] を使用して、コード内でトレーシングをグローバルに無効化できます
    3. [`agents.run.RunConfig.tracing_disabled`][] を `True` に設定して、単一の実行に対するトレーシングを無効化できます

***Zero Data Retention (ZDR) ポリシーの下でOpenAIの API を使用する組織では、トレーシングを利用できません。***

## トレースとスパン

-   **トレース**: 「ワークフロー」における単一のエンドツーエンド操作を表します。トレースは複数のスパンで構成されます。トレースには次のプロパティがあります：
    -   `workflow_name`: 論理的なワークフローまたはアプリの名前です。たとえば、「コード生成」や「カスタマーサービス」です。
    -   `trace_id`: トレースの一意な ID です。指定しなかった場合は自動的に生成されます。形式は `trace_<32_alphanumeric>` である必要があります。
    -   `group_id`: 同じ会話の複数のトレースを関連付けるための任意のグループ ID です。たとえば、チャットスレッド ID を使用できます。
    -   `disabled`: True の場合、トレースは記録されません。
    -   `metadata`: トレースの任意のメタデータです。
-   **スパン**: 開始時刻と終了時刻を持つ操作を表します。スパンには次のものがあります：
    -   `started_at` と `ended_at` のタイムスタンプ。
    -   `trace_id`: 所属するトレースを表します
    -   `parent_id`: このスパンの親スパン（存在する場合）を指します
    -   `span_data`: スパンに関する情報です。たとえば、`AgentSpanData` にはエージェントに関する情報が含まれ、`GenerationSpanData` にはLLM生成に関する情報が含まれます。

## デフォルトのトレーシング

デフォルトでは、SDK は次の項目をトレースします：

-   `Runner.{run, run_sync, run_streamed}()` 全体が `trace()` でラップされます。
-   Runner の各呼び出しが `task_span()` でラップされます。
-   モデルの各ターンが `turn_span()` でラップされます。
-   エージェントが実行されるたびに、`agent_span()` でラップされます
-   LLM生成は `generation_span()` でラップされます
-   各関数ツール呼び出しは `function_span()` でラップされます
-   ガードレールは `guardrail_span()` でラップされます
-   ハンドオフは `handoff_span()` でラップされます
-   音声入力（音声テキスト変換）は `transcription_span()` でラップされます
-   音声出力（テキスト音声変換）は `speech_span()` でラップされます
-   SDK は、関連する音声スパンを `speech_group_span()` の子として配置する場合があります

デフォルトでは、トレース名はリテラル文字列 `Agent workflow` です。`trace` を使用する場合はこの名前を設定できます。また、[`RunConfig`][agents.run.RunConfig] を使用して名前やその他のプロパティを設定できます。

よりコンパクトな階層にする場合は、実行に対するタスクスパンとターンスパンの自動作成を無効にします。エージェント、生成、関数、ガードレール、ハンドオフ、およびカスタムの各スパンは引き続き記録されます。

```python
from agents import RunConfig, Runner

result = await Runner.run(
    agent,
    "Hello",
    run_config=RunConfig(tracing={"include_task_and_turn_spans": False}),
)
```

さらに、[カスタムトレーシングプロセッサー](#custom-tracing-processors)を設定し、別の送信先（代替またはセカンダリの送信先）へトレースを送信できます。

## 長時間稼働ワーカーと即時エクスポート

デフォルトの [`BatchTraceProcessor`][agents.tracing.processors.BatchTraceProcessor] は、数秒ごと、またはメモリ内キューがサイズのしきい値に達した場合はそれより早く、バックグラウンドでトレースをエクスポートします。また、プロセスの終了時に最終フラッシュも実行します。Celery、RQ、Dramatiq、FastAPI のバックグラウンドタスクなど、長時間稼働するワーカーでは、通常、追加のコードなしでトレースが自動的にエクスポートされますが、各ジョブの完了直後にはトレースダッシュボードに表示されない場合があります。

作業単位の終了時に即時配信を保証する必要がある場合は、トレースコンテキストの終了後に [`flush_traces()`][agents.tracing.flush_traces] を呼び出します。

```python
from agents import Runner, flush_traces, trace


@celery_app.task
def run_agent_task(prompt: str):
    try:
        with trace("celery_task"):
            result = Runner.run_sync(agent, prompt)
        return result.final_output
    finally:
        flush_traces()
```

```python
from fastapi import BackgroundTasks, FastAPI
from agents import Runner, flush_traces, trace

app = FastAPI()


def process_in_background(prompt: str) -> None:
    try:
        with trace("background_job"):
            Runner.run_sync(agent, prompt)
    finally:
        flush_traces()


@app.post("/run")
async def run(prompt: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(process_in_background, prompt)
    return {"status": "queued"}
```

[`flush_traces()`][agents.tracing.flush_traces] は、現在バッファリングされているトレースとスパンのエクスポートが完了するまでブロックします。そのため、構築途中のトレースをフラッシュしないよう、`trace()` が閉じた後に呼び出してください。デフォルトのエクスポート遅延で問題ない場合は、この呼び出しを省略できます。

## 上位レベルのトレース

複数の `run()` 呼び出しを 1 つのトレースに含めたい場合があります。その場合は、コード全体を `trace()` でラップします。

```python
from agents import Agent, Runner, trace

async def main():
    agent = Agent(name="Joke generator", instructions="Tell funny jokes.")

    with trace("Joke workflow"): # (1)!
        first_result = await Runner.run(agent, "Tell me a joke")
        second_result = await Runner.run(agent, f"Rate this joke: {first_result.final_output}")
        print(f"Joke: {first_result.final_output}")
        print(f"Rating: {second_result.final_output}")
```

1. `Runner.run` の 2 回の呼び出しが `with trace()` でラップされているため、それぞれが別個のトレースを作成するのではなく、両方の実行が 1 つの全体的なトレースに含まれます。

## トレースの作成

[`trace()`][agents.tracing.trace] 関数を使用してトレースを作成できます。トレースは開始して終了する必要があります。その方法は次の 2 つです：

1. **推奨**: トレースをコンテキストマネージャーとして使用します（例：`with trace(...) as my_trace`）。これにより、適切なタイミングでトレースが自動的に開始および終了されます。
2. [`trace.start()`][agents.tracing.Trace.start] と [`trace.finish()`][agents.tracing.Trace.finish] を手動で呼び出すこともできます。

現在のトレースは、Python の [`contextvar`](https://docs.python.org/3/library/contextvars.html) を介して追跡されます。つまり、並行処理でも自動的に機能します。トレースを手動で開始および終了する場合は、現在のトレースを更新するため、`start()` に `mark_as_current` を渡し、`finish()` に `reset_current` を渡します。

## スパンの作成

さまざまな [`*_span()`][agents.tracing.create] メソッドを使用してスパンを作成できます。通常、スパンを手動で作成する必要はありません。カスタムスパン情報を追跡するために、[`custom_span()`][agents.tracing.custom_span] 関数を使用できます。

スパンは自動的に現在のトレースに含まれ、Python の [`contextvar`](https://docs.python.org/3/library/contextvars.html) を介して追跡される、最も近い現在のスパンの下にネストされます。

## 機密データ

一部のスパンでは、機密である可能性のあるデータを取得する場合があります。

`generation_span()` はLLM生成の入力と出力を保存し、`function_span()` は関数呼び出しの入力と出力を保存します。これらには機密データが含まれる可能性があるため、[`RunConfig.trace_include_sensitive_data`][agents.run.RunConfig.trace_include_sensitive_data] を使用して、そのデータの取得を無効にできます。

同様に、音声スパンには、デフォルトで入力音声と出力音声の base64 エンコードされた PCM データが含まれます。[`VoicePipelineConfig.trace_include_sensitive_audio_data`][agents.voice.pipeline_config.VoicePipelineConfig.trace_include_sensitive_audio_data] を設定することで、この音声データの取得を無効にできます。

デフォルトでは、`trace_include_sensitive_data` は `True` です。アプリを実行する前に、環境変数 `OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA` を `true/1` または `false/0` に設定してエクスポートすると、コードを使用せずにデフォルト値を設定できます。

## カスタムトレーシングプロセッサー

トレーシングの上位レベルのアーキテクチャは次のとおりです：

-   初期化時に、トレースの作成を担うグローバルな [`TraceProvider`][agents.tracing.provider.TraceProvider] を作成します。
-   `TraceProvider` に [`BatchTraceProcessor`][agents.tracing.processors.BatchTraceProcessor] を設定します。これは、トレースとスパンをバッチで [`BackendSpanExporter`][agents.tracing.processors.BackendSpanExporter] に送信し、そこからスパンとトレースをバッチでOpenAIバックエンドへエクスポートします。

このデフォルト設定をカスタマイズし、代替または追加のバックエンドへトレースを送信したり、エクスポーターの動作を変更したりするには、次の 2 つの方法があります：

1. [`add_trace_processor()`][agents.tracing.add_trace_processor] を使用すると、準備ができたトレースとスパンを受け取る**追加の**トレースプロセッサーを追加できます。これにより、OpenAIバックエンドへのトレース送信に加えて、独自の処理を実行できます。
2. [`set_trace_processors()`][agents.tracing.set_trace_processors] を使用すると、デフォルトのプロセッサーを独自のトレースプロセッサーで**置き換える**ことができます。その場合、トレースを送信する `TracingProcessor` を含めない限り、トレースはOpenAIバックエンドへ送信されません。


## OpenAI以外のモデルでのトレーシング

OpenAI以外のモデルを使用する場合、トレーシングを無効にすることなく、OpenAI Traces ダッシュボードで無料のトレーシングを有効にするため、トレーシングエクスポーターにOpenAI API キーを指定できます。アダプターの選択と設定に関する注意事項については、モデルガイドの[サードパーティアダプター](models/index.md#third-party-adapters)セクションを参照してください。

```python
import os
from agents import set_tracing_export_api_key, Agent
from agents.extensions.models.any_llm_model import AnyLLMModel

tracing_api_key = os.environ["OPENAI_API_KEY"]
set_tracing_export_api_key(tracing_api_key)

model = AnyLLMModel(
    model="your-provider/your-model-name",
    api_key="your-api-key",
)

agent = Agent(
    name="Assistant",
    model=model,
)
```

単一の実行に対してのみ別のトレーシングキーが必要な場合は、グローバルエクスポーターを変更する代わりに、`RunConfig` を介して渡します。

```python
from agents import Runner, RunConfig

await Runner.run(
    agent,
    input="Hello",
    run_config=RunConfig(tracing={"api_key": "sk-tracing-123"}),
)
```

## 補足事項
- OpenAI Traces ダッシュボードで無料のトレースを表示できます。


## エコシステム連携

以下のコミュニティおよびベンダーによる連携は、OpenAI Agents SDKのトレーシング API サーフェスをサポートしています。

### 外部トレーシングプロセッサー一覧

-   [Weights & Biases](https://weave-docs.wandb.ai/guides/integrations/openai_agents)
-   [Arize-Phoenix](https://docs.arize.com/phoenix/tracing/integrations-tracing/openai-agents-sdk)
-   [Future AGI](https://docs.futureagi.com/docs/tracing/auto/openai_agents/)
-   [MLflow (セルフホスト／OSS)](https://mlflow.org/docs/latest/tracing/integrations/openai-agent)
-   [MLflow (Databricks ホスト)](https://docs.databricks.com/aws/en/mlflow/mlflow-tracing#-automatic-tracing)
-   [Braintrust](https://braintrust.dev/docs/guides/traces/integrations#openai-agents-sdk)
-   [Pydantic Logfire](https://logfire.pydantic.dev/docs/integrations/llms/openai/#openai-agents)
-   [AgentOps](https://docs.agentops.ai/v1/integrations/agentssdk)
-   [Scorecard](https://docs.scorecard.io/docs/documentation/features/tracing#openai-agents-sdk-integration)
-   [Respan](https://respan.ai/docs/integrations/tracing/openai-agents-sdk)
-   [LangSmith](https://docs.smith.langchain.com/observability/how_to_guides/trace_with_openai_agents_sdk)
-   [Maxim AI](https://www.getmaxim.ai/docs/observe/integrations/openai-agents-sdk)
-   [Comet Opik](https://www.comet.com/docs/opik/tracing/integrations/openai_agents)
-   [Langfuse](https://langfuse.com/docs/integrations/openaiagentssdk/openai-agents)
-   [Langtrace](https://docs.langtrace.ai/supported-integrations/llm-frameworks/openai-agents-sdk)
-   [Okahu-Monocle](https://github.com/monocle2ai/monocle)
-   [Galileo](https://v2docs.galileo.ai/integrations/openai-agent-integration#openai-agent-integration)
-   [Portkey AI](https://portkey.ai/docs/integrations/agents/openai-agents)
-   [LangDB AI](https://docs.langdb.ai/getting-started/working-with-agent-frameworks/working-with-openai-agents-sdk)
-   [Agenta](https://docs.agenta.ai/observability/integrations/openai-agents)
-   [PostHog](https://posthog.com/docs/llm-analytics/installation/openai-agents)
-   [Traccia](https://traccia.ai/docs/integrations/openai-agents)
-   [PromptLayer](https://docs.promptlayer.com/features/integrations#openai-agents-sdk)
-   [HoneyHive](https://docs.honeyhive.ai/v2/integrations/openai-agents)
-   [Asqav](https://www.asqav.com/docs/integrations#openai-agents)
-   [Datadog](https://docs.datadoghq.com/llm_observability/instrumentation/auto_instrumentation/?tab=python#openai-agents)
-   [Latitude](https://docs.latitude.so/telemetry/frameworks/openai-agents)
-   [DProvenanceKit](https://dprovenance.dev/openai-agents/)