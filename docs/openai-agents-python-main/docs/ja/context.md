---
search:
  exclude: true
---
# コンテキスト管理

コンテキストは多義的な用語です。考慮すべきコンテキストには、主に 2 つのカテゴリーがあります。

1. コードからローカルに利用できるコンテキスト: ツール関数の実行時、`on_handoff` などのコールバック時、ライフサイクルフック内などで必要となる可能性があるデータや依存関係です。
2. LLM が利用できるコンテキスト: LLM が応答を生成するときに参照するデータです。

## ローカルコンテキスト

これは、[`RunContextWrapper`][agents.run_context.RunContextWrapper] クラスと、そのクラス内の [`context`][agents.run_context.RunContextWrapper.context] プロパティによって表されます。仕組みは次のとおりです。

1. 任意の Python オブジェクトを作成します。一般的なパターンとして、dataclass または Pydantic オブジェクトを使用します。
2. そのオブジェクトをさまざまな実行メソッド（例: `Runner.run(..., context=whatever)` ）に渡します。
3. すべてのツール呼び出しやライフサイクルフックなどには、ラッパーオブジェクト `RunContextWrapper[T]` が渡されます。ここで `T` はコンテキストオブジェクトの型を表し、オブジェクト自体は `wrapper.context` から利用できます。

一部のランタイム固有のコールバックでは、SDK が `RunContextWrapper[T]` のより特化したサブクラスを渡す場合があります。たとえば、`FunctionTool` インスタンスのライフサイクルフックは通常、`ToolContext` を受け取ります。これにより、`tool_call_id`、`tool_name`、`tool_arguments` などのツール呼び出しメタデータも利用できます。

認識しておくべき **最も重要な** 点は、特定のエージェント実行におけるすべてのエージェント、ツール関数、ライフサイクル処理などで、同じ _型_ のコンテキストを使用する必要があることです。

コンテキストは、次のような用途に使用できます。

-   実行に関するコンテキストデータ（例: ユーザー名 / uid、またはユーザーに関するその他の情報）
-   依存関係（例: ロガーオブジェクト、データ取得オブジェクトなど）
-   ヘルパー関数

!!! danger "注記"

    コンテキストオブジェクトが LLM に送信されることは **ありません** 。これは純粋にローカルなオブジェクトであり、データの読み取りや書き込み、メソッドの呼び出しが可能です。

単一の実行内では、派生したラッパーは基盤となるアプリコンテキスト、承認状態、使用量追跡を共有します。ネストされた [`Agent.as_tool()`][agents.agent.Agent.as_tool] の実行では、別の `tool_input` を関連付けることができますが、デフォルトではアプリ状態の独立したコピーは作成されません。

### `RunContextWrapper` の公開情報

[`RunContextWrapper`][agents.run_context.RunContextWrapper] は、アプリで定義したコンテキストオブジェクトのラッパーです。実際には、主に次のものを使用します。

-   独自の変更可能なアプリ状態と依存関係には、[`wrapper.context`][agents.run_context.RunContextWrapper.context] を使用します。
-   現在の実行全体で集計されたリクエストとトークンの使用量には、[`wrapper.usage`][agents.run_context.RunContextWrapper.usage] を使用します。
-   現在の実行が [`Agent.as_tool()`][agents.agent.Agent.as_tool] 内で行われている場合の構造化入力には、[`wrapper.tool_input`][agents.run_context.RunContextWrapper.tool_input] を使用します。
-   承認状態をプログラムから更新する必要がある場合は、[`wrapper.approve_tool(...)`][agents.run_context.RunContextWrapper.approve_tool] / [`wrapper.reject_tool(...)`][agents.run_context.RunContextWrapper.reject_tool] を使用します。

アプリで定義するオブジェクトは `wrapper.context` だけです。その他のフィールドは、SDK が管理するランタイムメタデータです。

後でヒューマンインザループまたは永続的なジョブのワークフロー用に [`RunState`][agents.run_state.RunState] をシリアライズすると、そのランタイムメタデータも状態とともに保存されます。シリアライズした状態を永続化または送信する場合は、[`RunContextWrapper.context`][agents.run_context.RunContextWrapper.context] に機密情報を格納しないでください。

会話状態は別の考慮事項です。ターンをどのように引き継ぐかに応じて、`result.to_input_list()`、`session`、`conversation_id`、または `previous_response_id` を使用してください。この判断については、[実行結果](results.md)、[エージェントの実行](running_agents.md)、[セッション](sessions/index.md)を参照してください。

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

1. これはコンテキストオブジェクトです。ここでは dataclass を使用していますが、任意の型を使用できます。
2. これはツールです。`RunContextWrapper[UserInfo]` を受け取ることが分かります。ツールの実装はコンテキストからデータを読み取ります。
3. 型チェッカーがエラーを検出できるように、エージェントにジェネリック型 `UserInfo` を指定します（たとえば、異なるコンテキスト型を受け取るツールを渡そうとした場合）。
4. コンテキストは `run` 関数に渡されます。
5. エージェントはツールを正しく呼び出し、年齢を取得します。

---

### 高度な機能: `ToolContext`

場合によっては、実行中のツールについて、その名前、呼び出し ID、raw 引数文字列などの追加メタデータにアクセスしたいことがあります。  
その場合は、`RunContextWrapper` を拡張する [`ToolContext`][agents.tool_context.ToolContext] クラスを使用できます。

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

`ToolContext` は、`RunContextWrapper` と同じ `.context` プロパティに加えて、  
現在のツール呼び出しに固有の次のフィールドを提供します。

- `tool_name` – 呼び出されるツールの名前  
- `tool_call_id` – このツール呼び出しの一意な識別子  
- `tool_arguments` – ツールに渡された raw 引数文字列  
- `tool_namespace` – ツールが `tool_namespace()` または名前空間付きの別のインターフェースを通じて読み込まれた場合の、そのツール呼び出しの Responses 名前空間  
- `qualified_tool_name` – 名前空間を利用できる場合に、その名前空間で修飾されたツール名  

実行中にツールレベルのメタデータが必要な場合は、`ToolContext` を使用します。  
エージェントとツール間で一般的なコンテキストを共有する場合は、引き続き `RunContextWrapper` で十分です。`ToolContext` は `RunContextWrapper` を拡張しているため、ネストされた `Agent.as_tool()` の実行で構造化入力が指定された場合は、`.tool_input` も公開できます。

---

## エージェント / LLM コンテキスト

LLM が呼び出されたとき、LLM が参照できるのは会話履歴に含まれるデータ **だけ** です。つまり、新しいデータを LLM から利用可能にするには、その履歴に含まれる形で提供する必要があります。これには、次のような方法があります。

1. エージェントの `instructions` に追加できます。これは「システムプロンプト」または「開発者メッセージ」とも呼ばれます。システムプロンプトには静的な文字列を使用できるほか、コンテキストを受け取って文字列を出力する動的な関数も使用できます。常に有用な情報（たとえば、ユーザーの名前や現在の日付）に対してよく使用される方法です。
2. `Runner.run` 関数の呼び出し時に、`input` に追加します。これは `instructions` を使用する方法と似ていますが、[指揮系統](https://cdn.openai.com/spec/model-spec-2024-05-08.html#follow-the-chain-of-command)における優先度がより低いメッセージを使用できます。
3. `FunctionTool` インスタンスを通じて公開します。これは _オンデマンド_ のコンテキストに便利です。LLM がデータを必要とするタイミングを判断し、ツールを呼び出してそのデータを取得できます。
4. 情報取得または Web 検索を使用します。これらは、ファイルやデータベースから関連データを取得したり（情報取得）、Web から関連データを取得したり（Web 検索）できる特別なツールです。関連するコンテキストデータに基づいて応答を「グラウンディング」する場合に役立ちます。