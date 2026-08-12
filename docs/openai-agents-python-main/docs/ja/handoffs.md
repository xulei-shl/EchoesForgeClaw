---
search:
  exclude: true
---
# ハンドオフ

ハンドオフを使用すると、エージェントはタスクを別のエージェントに委任できます。これは、異なるエージェントがそれぞれ別の領域を専門とするシナリオで特に役立ちます。たとえば、カスタマーサポートアプリでは、注文状況、返金、FAQ などのタスクをそれぞれ専門に処理するエージェントを用意できます。

ハンドオフは、LLM に対してツールとして表現されます。そのため、`Refund Agent` という名前のエージェントへのハンドオフがある場合、ツール名は `transfer_to_refund_agent` になります。

## ハンドオフの作成

すべてのエージェントには [`handoffs`][agents.agent.Agent.handoffs] パラメーターがあり、`Agent` を直接受け取ることも、ハンドオフをカスタマイズする `Handoff` オブジェクトを受け取ることもできます。

単純な `Agent` インスタンスを渡した場合、その [`handoff_description`][agents.agent.Agent.handoff_description] が設定されていれば、デフォルトのツール説明に追加されます。完全な `handoff()` オブジェクトを記述せずに、モデルがそのハンドオフを選択すべきタイミングを示すために使用できます。

Agents SDK が提供する [`handoff()`][agents.handoffs.handoff] 関数を使用して、ハンドオフを作成できます。この関数では、ハンドオフ先のエージェントに加えて、オプションのオーバーライドと入力フィルターを指定できます。

### 基本的な使用方法

簡単なハンドオフは次のように作成できます。

```python
from agents import Agent, handoff

billing_agent = Agent(name="Billing agent")
refund_agent = Agent(name="Refund agent")

# (1)!
triage_agent = Agent(name="Triage agent", handoffs=[billing_agent, handoff(refund_agent)])
```

1. エージェントを直接使用することも（`billing_agent` のように）、`handoff()` 関数を使用することもできます。

### `handoff()` 関数によるハンドオフのカスタマイズ

[`handoff()`][agents.handoffs.handoff] 関数を使用すると、さまざまな項目をカスタマイズできます。

-   `agent`: ハンドオフ先のエージェントです。
-   `tool_name_override`: デフォルトでは、`transfer_to_<agent_name>` に解決される `Handoff.default_tool_name()` 関数が使用されます。これはオーバーライドできます。
-   `tool_description_override`: `Handoff.default_tool_description()` のデフォルトのツール説明をオーバーライドします。
-   `on_handoff`: ハンドオフが呼び出されたときに実行されるコールバック関数です。ハンドオフが呼び出されることが判明した時点で、データ取得などを開始する場合に便利です。この関数はエージェントコンテキストを受け取り、オプションで LLM が生成した入力も受け取れます。入力データは `input_type` パラメーターによって制御されます。
-   `input_type`: ハンドオフのツール呼び出し引数のスキーマです。設定すると、解析されたペイロードが `on_handoff` に渡されます。
-   `input_filter`: 次のエージェントが受け取る入力をフィルタリングできます。詳細は以下を参照してください。
-   `is_enabled`: ハンドオフを有効にするかどうかを指定します。ブール値、またはブール値を返す関数を指定できるため、実行時にハンドオフを動的に有効化または無効化できます。
-   `nest_handoff_history`: RunConfig レベルの `nest_handoff_history` 設定をハンドオフごとにオーバーライドするためのオプションです。`None` の場合、アクティブな実行設定で定義された値が代わりに使用されます。

[`handoff()`][agents.handoffs.handoff] ヘルパーは、渡された特定の `agent` に常に制御を移します。移行先の候補が複数ある場合は、移行先ごとに 1 つのハンドオフを登録し、モデルに選択させます。独自のハンドオフコードが呼び出し時に返すエージェントを決定する必要がある場合にのみ、カスタムの [`Handoff`][agents.handoffs.Handoff] を使用してください。

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

## ハンドオフ入力

状況によっては、LLM がハンドオフを呼び出す際に、何らかのデータを提供するようにしたい場合があります。たとえば、「エスカレーションエージェント」へのハンドオフを考えてみましょう。ログに記録できるよう、モデルに理由を提供させることができます。

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

`input_type` は、ハンドオフのツール呼び出し自体の引数を記述します。SDK はそのスキーマをハンドオフツールの `parameters` としてモデルに公開し、返された JSON をローカルで検証して、解析された値を `on_handoff` に渡します。

これは次のエージェントのメイン入力を置き換えるものでも、別の移行先を選択するものでもありません。[`handoff()`][agents.handoffs.handoff] ヘルパーは引き続きラップされた特定のエージェントに制御を移し、受け取り側のエージェントも、[`input_filter`][agents.handoffs.Handoff.input_filter] またはネストされたハンドオフ履歴の設定で変更しない限り、会話履歴を引き続き参照できます。

`input_type` は [`RunContextWrapper.context`][agents.run_context.RunContextWrapper.context] とも異なります。ローカルにすでに存在するアプリケーションの状態や依存関係ではなく、ハンドオフ時にモデルが決定するメタデータには `input_type` を使用してください。

### `input_type` の使用タイミング

ハンドオフに、`reason`、`language`、`priority`、`summary` など、モデルが生成する小さなメタデータが必要な場合は、`input_type` を使用します。たとえば、トリアージエージェントは `{ "reason": "duplicate_charge", "priority": "high" }` を伴って返金エージェントにハンドオフでき、返金エージェントが引き継ぐ前に `on_handoff` でそのメタデータをログに記録したり永続化したりできます。

目的が異なる場合は、別の仕組みを選択してください。

-   既存のアプリケーションの状態と依存関係は、[`RunContextWrapper.context`][agents.run_context.RunContextWrapper.context] に格納します。[コンテキストガイド](context.md)を参照してください。
-   受け取り側のエージェントが参照する履歴を変更する場合は、[`input_filter`][agents.handoffs.Handoff.input_filter]、[`RunConfig.nest_handoff_history`][agents.run.RunConfig.nest_handoff_history]、または [`RunConfig.handoff_history_mapper`][agents.run.RunConfig.handoff_history_mapper] を使用します。
-   専門エージェントの候補が複数ある場合は、移行先ごとに 1 つのハンドオフを登録します。`input_type` は選択されたハンドオフにメタデータを追加できますが、移行先を振り分けるものではありません。
-   会話を移行せずに、ネストされた専門エージェントへ構造化入力を渡す場合は、[`Agent.as_tool(parameters=...)`][agents.agent.Agent.as_tool] の使用を推奨します。[ツール](tools.md#structured-input-for-tool-agents)を参照してください。

## 入力フィルター

ハンドオフが発生すると、新しいエージェントが会話を引き継ぎ、それまでの会話履歴全体を参照できる状態になります。これを変更するには、[`input_filter`][agents.handoffs.Handoff.input_filter] を設定できます。入力フィルターは、[`HandoffInputData`][agents.handoffs.HandoffInputData] を介して既存の入力を受け取り、新しい `HandoffInputData` を返す必要がある関数です。

[`HandoffInputData`][agents.handoffs.HandoffInputData] には、以下が含まれます。

-   `input_history`: `Runner.run(...)` が開始される前の入力履歴です。
-   `pre_handoff_items`: ハンドオフが呼び出されたエージェントターンより前に生成された項目です。
-   `new_items`: ハンドオフ呼び出しとハンドオフ出力項目を含む、現在のターン中に生成された項目です。
-   `input_items`: `new_items` の代わりに次のエージェントへ転送するオプションの項目です。セッション履歴では `new_items` をそのまま維持しながら、モデル入力をフィルタリングできます。
-   `run_context`: ハンドオフが呼び出された時点でアクティブだった [`RunContextWrapper`][agents.run_context.RunContextWrapper] です。

ネストされたハンドオフ履歴はオプトインのベータ機能として利用でき、安定化を進めている間はデフォルトで無効になっています。[`RunConfig.nest_handoff_history`][agents.run.RunConfig.nest_handoff_history] を有効にすると、ランナーは要約可能な履歴を順序付けられたアシスタント要約セグメントに圧縮しつつ、情報を失わないメッセージ項目を元の位置に保持します。生成された各要約セグメントでは `<CONVERSATION HISTORY>` ラッパーが使用され、後続のハンドオフでは、順序付けられたトランスクリプトを再構築する前に、以前に生成されたセグメントがフラット化されます。セッション、`RunState`、`RunResult.to_input_list()` は、この SDK デフォルトの履歴に移動されたメッセージの出現箇所を正確に追跡するため、それらが二重に追加されることはありません。一方、内容が同一でも別個のメッセージは保持されます。組み込みのセグメント化を使用せず、次のエージェントに渡す入力項目の正確なリストを返す独自のマッピング関数を、[`RunConfig.handoff_history_mapper`][agents.run.RunConfig.handoff_history_mapper] で指定できます。このオプトインは、ハンドオフの `input_filter` とアクティブな実行の `RunConfig.handoff_input_filter` のどちらも設定されていない場合にのみ適用されます。そのため、ペイロードをすでにカスタマイズしている既存のコード（このリポジトリのコード例を含む）は、変更なしで現在の動作を維持します。[`handoff(...)`][agents.handoffs.handoff] に `nest_handoff_history=True` または `False` を渡すことで、単一のハンドオフについてネストの挙動をオーバーライドできます。これにより、[`Handoff.nest_handoff_history`][agents.handoffs.Handoff.nest_handoff_history] が設定されます。生成される要約セグメントのラッパーテキストのみを変更する場合は、エージェントを実行する前に [`set_conversation_history_wrappers`][agents.handoffs.set_conversation_history_wrappers] を呼び出します。後続の実行でデフォルトのラッパーに戻す必要がある場合は、その実行前に [`reset_conversation_history_wrappers`][agents.handoffs.reset_conversation_history_wrappers] を呼び出します。

ハンドオフとアクティブな [`RunConfig.handoff_input_filter`][agents.run.RunConfig.handoff_input_filter] の両方でフィルターが定義されている場合、その特定のハンドオフでは、ハンドオフごとの [`input_filter`][agents.handoffs.Handoff.input_filter] が優先されます。

!!! note

    ハンドオフは単一の実行内にとどまります。入力ガードレールは引き続きチェーンの最初のエージェントにのみ適用され、出力ガードレールは最終出力を生成するエージェントにのみ適用されます。ワークフロー内の各カスタム関数ツール呼び出しに対してチェックが必要な場合は、ツールガードレールを使用してください。

一般的なパターンの一部（たとえば、履歴からすべてのツール呼び出しを削除する処理）は、[`agents.extensions.handoff_filters`][] に実装されています。

```python
from agents import Agent, handoff
from agents.extensions import handoff_filters

agent = Agent(name="FAQ agent")

handoff_obj = handoff(
    agent=agent,
    input_filter=handoff_filters.remove_all_tools, # (1)!
)
```

1. `FAQ agent` が呼び出されると、履歴からツール関連の項目がすべて自動的に削除されます。

## 推奨プロンプト

LLM がハンドオフを正しく理解できるようにするため、エージェントにハンドオフに関する情報を含めることを推奨します。[`agents.extensions.handoff_prompt.RECOMMENDED_PROMPT_PREFIX`][] に推奨プレフィックスが用意されています。また、[`agents.extensions.handoff_prompt.prompt_with_handoff_instructions`][] を呼び出して、推奨データをプロンプトに自動的に追加することもできます。

```python
from agents import Agent
from agents.extensions.handoff_prompt import RECOMMENDED_PROMPT_PREFIX

billing_agent = Agent(
    name="Billing agent",
    instructions=f"""{RECOMMENDED_PROMPT_PREFIX}
    <Fill in the rest of your prompt here>.""",
)
```