---
search:
  exclude: true
---
# セッション

Agents SDK には、複数回のエージェント実行にわたって会話履歴を自動的に維持する組み込みのセッションメモリが用意されており、ターン間で `.to_input_list()` を手動管理する必要がなくなります。

セッションは特定のセッションの会話履歴を保存するため、明示的な手動のメモリ管理を必要とせずに、エージェントがコンテキストを維持できます。これは、エージェントに過去のやり取りを記憶させたいチャットアプリケーションや複数ターンの会話を構築する場合に特に便利です。

SDK にクライアント側のメモリを管理させたい場合は、セッションを使用します。同じ実行内では、セッションを実行レベルの継続オプション `conversation_id`、`previous_response_id`、`auto_previous_response_id` と組み合わせることはできません。代わりに OpenAI のサーバー管理による継続を使用する場合は、セッションと重ねて使用せず、これらのメカニズムのいずれかを選択してください。

## クイックスタート

```python
from agents import Agent, Runner, SQLiteSession

# Create agent
agent = Agent(
    name="Assistant",
    instructions="Reply very concisely.",
)

# Create a session instance with a session ID
session = SQLiteSession("conversation_123")

# First turn
result = await Runner.run(
    agent,
    "What city is the Golden Gate Bridge in?",
    session=session
)
print(result.final_output)  # "San Francisco"

# Second turn - agent automatically remembers previous context
result = await Runner.run(
    agent,
    "What state is it in?",
    session=session
)
print(result.final_output)  # "California"

# Also works with synchronous runner
result = Runner.run_sync(
    agent,
    "What's the population?",
    session=session
)
print(result.final_output)  # "Approximately 39 million"
```

## 同じセッションによる中断された実行の再開

実行が承認待ちで一時停止した場合は、同じセッションインスタンス（または、同じセッション ID と同じ基盤ストレージバックエンドを使用するよう設定された別のインスタンス）で再開し、再開後のターンが同じ保存済み会話履歴を引き継ぐようにしてください。

```python
result = await Runner.run(agent, "Delete temporary files that are no longer needed.", session=session)

if result.interruptions:
    state = result.to_state()
    for interruption in result.interruptions:
        state.approve(interruption)
    result = await Runner.run(agent, state, session=session)
```

## セッションの基本動作

セッションメモリが有効な場合は、次のように動作します。

1. **各実行の前**: ランナーはセッションの会話履歴を自動的に取得し、入力項目の先頭に追加します。
2. **各実行の後**: 実行中に生成されたすべての新しい項目（ユーザー入力、アシスタントの応答、ツール呼び出しなど）がセッションに自動的に保存されます。
3. **コンテキストの保持**: 同じセッションを使用する後続の各実行には完全な会話履歴が含まれるため、エージェントはコンテキストを維持できます。

これにより、`.to_input_list()` を手動で呼び出したり、実行間で会話の状態を管理したりする必要がなくなります。

## 履歴と新しい入力のマージ方法の制御

セッションを渡すと、通常、ランナーはモデル入力を次の順序で準備します。

1. セッション履歴（`session.get_items(...)` から取得）
2. 新しいターンの入力

モデル呼び出し前にこのマージ処理をカスタマイズするには、[`RunConfig.session_input_callback`][agents.run.RunConfig.session_input_callback] を使用します。コールバックは次の 2 つのリストを受け取ります。

- `history`: 取得されたセッション履歴（入力項目形式に正規化済み）
- `new_input`: 現在のターンの新しい入力項目

モデルに送信する最終的な入力項目のリストを返します。

コールバックは両方のリストのコピーを受け取るため、安全に変更できます。返されたリストはそのターンのモデル入力を制御しますが、SDK が永続化するのは、新しいターンに属する項目のみです。したがって、古い履歴の並べ替えやフィルタリングによって、古いセッション項目が新規入力として再度保存されることはありません。

```python
from agents import Agent, RunConfig, Runner, SQLiteSession


def keep_recent_history(history, new_input):
    # Keep only the last 10 history items, then append the new turn.
    return history[-10:] + new_input


agent = Agent(name="Assistant")
session = SQLiteSession("conversation_123")

result = await Runner.run(
    agent,
    "Continue from the latest updates only.",
    session=session,
    run_config=RunConfig(session_input_callback=keep_recent_history),
)
```

セッションによる項目の保存方法を変更せずに、履歴を独自に削減、並べ替え、または選択的に追加する必要がある場合に使用します。モデル呼び出しの直前に最終処理を行う必要がある場合は、[エージェント実行ガイド](../running_agents.md)の [`call_model_input_filter`][agents.run.RunConfig.call_model_input_filter] を使用してください。

## 取得する履歴の制限

各実行の前に取得する履歴の量を制御するには、[`SessionSettings`][agents.memory.SessionSettings] を使用します。

- `SessionSettings(limit=None)`（デフォルト）: 利用可能なすべてのセッション項目を取得します
- `SessionSettings(limit=N)`: 最新の `N` 項目のみを取得します

これは、[`RunConfig.session_settings`][agents.run.RunConfig.session_settings] を使用して実行ごとに適用できます。

```python
from agents import Agent, RunConfig, Runner, SessionSettings, SQLiteSession

agent = Agent(name="Assistant")
session = SQLiteSession("conversation_123")

result = await Runner.run(
    agent,
    "Summarize our recent discussion.",
    session=session,
    run_config=RunConfig(session_settings=SessionSettings(limit=50)),
)
```

セッション実装がデフォルトのセッション設定を公開している場合、`RunConfig.session_settings` 内の `None` 以外の各値は、その実行に対応するデフォルト値を上書きします。これは、セッションのデフォルト動作を変更せずに、長い会話で取得件数を制限したい場合に便利です。

## メモリ操作

### 基本操作

セッションでは、会話履歴を管理するための複数の操作を利用できます。

```python
from agents import SQLiteSession

session = SQLiteSession("user_123", "conversations.db")

# Get all items in a session
items = await session.get_items()

# Add new items to a session
new_items = [
    {"role": "user", "content": "Hello"},
    {"role": "assistant", "content": "Hi there!"}
]
await session.add_items(new_items)

# Remove and return the most recent item
last_item = await session.pop_item()
print(last_item)  # {"role": "assistant", "content": "Hi there!"}

# Clear all items from a session
await session.clear_session()
```

### 修正のための pop_item の使用

`pop_item` メソッドは、会話内の最後の項目を取り消したり変更したりする場合に特に便利です。

```python
from agents import Agent, Runner, SQLiteSession

agent = Agent(name="Assistant")
session = SQLiteSession("correction_example")

# Initial conversation
result = await Runner.run(
    agent,
    "What's 2 + 2?",
    session=session
)
print(f"Agent: {result.final_output}")

# User wants to correct their question
assistant_item = await session.pop_item()  # Remove agent's response
user_item = await session.pop_item()  # Remove user's question

# Ask a corrected question
result = await Runner.run(
    agent,
    "What's 2 + 3?",
    session=session
)
print(f"Agent: {result.final_output}")
```

## 組み込みのセッション実装

SDK には、さまざまなユースケース向けの複数のセッション実装が用意されています。

### 組み込みセッション実装の選択

以下の詳細なコード例を読む前に、この表を使用して出発点を選択してください。

| セッションの種類 | 最適な用途 | 備考 |
| --- | --- | --- |
| `SQLiteSession` | ローカル開発とシンプルなアプリ | 組み込みで軽量、ファイルベースまたはインメモリ |
| `AsyncSQLiteSession` | `aiosqlite` を使用する非同期 SQLite | 非同期ドライバーをサポートする拡張バックエンド |
| `RedisSession` | ワーカーやサービス間での共有メモリ | 低レイテンシーの分散デプロイに最適 |
| `SQLAlchemySession` | 既存のデータベースを使用する本番アプリ | SQLAlchemy がサポートするデータベースで動作 |
| `MongoDBSession` | MongoDB をすでに使用している、またはマルチプロセスストレージを必要とするアプリ | 非同期 pymongo。順序付け用のアトミックなシーケンスカウンター |
| `DaprSession` | Dapr サイドカーを使用するクラウドネイティブなデプロイ | 複数のステートストアに加え、TTL と整合性の制御をサポート |
| `OpenAIConversationsSession` | OpenAI 内のサーバー管理ストレージ | OpenAI Conversations API を基盤とする履歴 |
| `OpenAIResponsesCompactionSession` | 自動コンパクションを必要とする長い会話 | 別のセッションバックエンドをラップ |
| `AdvancedSQLiteSession` | SQLite に加えて分岐や分析が必要な場合 | より多機能。専用ページを参照 |
| `EncryptedSession` | 別のセッションに暗号化と TTL を追加する場合 | ラッパー。最初に基盤となるバックエンドを選択 |

一部の実装には、追加の詳細を記載した専用ページがあります。各サブセクション内にリンクを掲載しています。

ChatKit 用の Python サーバーを実装する場合は、ChatKit のスレッドと項目の永続化に `chatkit.store.Store` 実装を使用してください。`SQLAlchemySession` などの Agents SDK セッションは SDK 側の会話履歴を管理しますが、ChatKit のストアをそのまま置き換えるものではありません。[`chatkit-python` による ChatKit データストアの実装ガイド](https://github.com/openai/chatkit-python/blob/main/docs/guides/respond-to-user-message.md#implement-your-chatkit-data-store)を参照してください。

### OpenAI Conversations API セッション

`OpenAIConversationsSession` を通じて [OpenAI の Conversations API](https://platform.openai.com/docs/api-reference/conversations) を使用します。

```python
from agents import Agent, Runner, OpenAIConversationsSession

# Create agent
agent = Agent(
    name="Assistant",
    instructions="Reply very concisely.",
)

# Create a new conversation
session = OpenAIConversationsSession()

# Optionally resume a previous conversation by passing a conversation ID
# session = OpenAIConversationsSession(conversation_id="conv_123")

# Start conversation
result = await Runner.run(
    agent,
    "What city is the Golden Gate Bridge in?",
    session=session
)
print(result.final_output)  # "San Francisco"

# Continue the conversation
result = await Runner.run(
    agent,
    "What state is it in?",
    session=session
)
print(result.final_output)  # "California"
```

### OpenAI Responses コンパクションセッション

Responses API（`responses.compact`）を使用して、保存された会話履歴をコンパクションするには、`OpenAIResponsesCompactionSession` を使用します。これは基盤となるセッションをラップし、`should_trigger_compaction` に基づいて各ターン後に自動的にコンパクションできます。`OpenAIConversationsSession` をこれでラップしないでください。この 2 つの機能は異なる方法で履歴を管理します。

#### 一般的な使用方法（自動コンパクション）

```python
from agents import Agent, Runner, SQLiteSession
from agents.memory import OpenAIResponsesCompactionSession

underlying = SQLiteSession("conversation_123")
session = OpenAIResponsesCompactionSession(
    session_id="conversation_123",
    underlying_session=underlying,
)

agent = Agent(name="Assistant")
result = await Runner.run(agent, "Hello", session=session)
print(result.final_output)
```

デフォルトでは、SDK は各ターン後にコンパクション候補がしきい値を満たしているか確認し、満たしている場合にのみコンパクションします。

`compaction_mode="previous_response_id"` は、コンパクションセッションによって保持されている Responses API のレスポンス ID を使用し、そのレスポンスチェーンが利用可能な間に最適に動作します。代わりに `compaction_mode="input"` は、現在のセッション項目からコンパクションリクエストを再構築します。これは、レスポンスチェーンが利用できない場合や、セッションの内容を信頼できる唯一の情報源にしたい場合に便利です。デフォルトの `"auto"` は、利用可能な最も安全なオプションを選択します。

エージェントを `ModelSettings(store=False)` で実行すると、Responses API は後から参照できるように最後のレスポンスを保持しません。このステートレスな構成では、デフォルトの `"auto"` モードは `previous_response_id` に依存せず、入力ベースのコンパクションにフォールバックします。完全なコード例については、[`examples/memory/compaction_session_stateless_example.py`](https://github.com/openai/openai-agents-python/tree/main/examples/memory/compaction_session_stateless_example.py) を参照してください。

#### 自動コンパクションによるストリーミングのブロック

コンパクションではセッション履歴を消去して書き直すため、SDK はコンパクションが完了するまで実行を完了したものと見なしません。ストリーミングモードでは、コンパクションの負荷が高い場合、最後の出力トークンの後も `run.stream_events()` が数秒間開いたままになることがあります。

`OpenAIResponsesCompactionSession.run_compaction()` は、消去と再書き込みの操作を、ラッパー境界で復旧可能な置換として扱います。基盤となる履歴が変更された後に置換が失敗またはキャンセルされた場合、ラッパーは以前の履歴の復元を試み、元の例外またはキャンセルが呼び出し元に伝わる前に、その復旧処理が完了するまで待機します。復旧中に基盤バックエンドでも障害が発生した場合、以前の履歴が復元されないままになる可能性があり、SDK は復旧の失敗をログに記録します。ラッパーは `add_items()`、`pop_item()`、`clear_session()` の呼び出しを、ロックされた置換および復旧フェーズと直列化します。ただし、リモートのコンパクションリクエストがまだ進行中の間に変更が完了し、その後、正常な置換によって上書きされる可能性があります。手動コンパクションは、ラッパーへの変更が並行して行われていないターン間に実行し、コンパクションの実行中に基盤セッションを直接変更しないでください。

低レイテンシーのストリーミングや迅速なターン切り替えが必要な場合は、自動コンパクションを無効にし、ターン間（またはアイドル時）に `run_compaction()` を自分で呼び出してください。独自の基準に基づいて、コンパクションを強制するタイミングを決定できます。

```python
from agents import Agent, Runner, SQLiteSession
from agents.memory import OpenAIResponsesCompactionSession

underlying = SQLiteSession("conversation_123")
session = OpenAIResponsesCompactionSession(
    session_id="conversation_123",
    underlying_session=underlying,
    # Disable triggering the auto compaction
    should_trigger_compaction=lambda _: False,
)

agent = Agent(name="Assistant")
result = await Runner.run(agent, "Hello", session=session)

# Decide when to compact (e.g., on idle, every N turns, or size thresholds).
await session.run_compaction({"force": True})
```

### SQLite セッション

SQLite を使用するデフォルトの軽量なセッション実装です。

```python
from agents import SQLiteSession

# In-memory database (lost when process ends)
session = SQLiteSession("user_123")

# Persistent file-based database
session = SQLiteSession("user_123", "conversations.db")

# Use the session
result = await Runner.run(
    agent,
    "Hello",
    session=session
)
```

### 非同期 SQLite セッション

`aiosqlite` を基盤とする SQLite の永続化が必要な場合は、`AsyncSQLiteSession` を使用します。

```bash
pip install aiosqlite
```

```python
from agents import Agent, Runner
from agents.extensions.memory import AsyncSQLiteSession

agent = Agent(name="Assistant")
session = AsyncSQLiteSession("user_123", db_path="conversations.db")
result = await Runner.run(agent, "Hello", session=session)
```

### Redis セッション

複数のワーカーやサービス間でセッションメモリを共有するには、`RedisSession` を使用します。

```bash
pip install openai-agents[redis]
```

```python
from agents import Agent, Runner
from agents.extensions.memory import RedisSession

agent = Agent(name="Assistant")
session = RedisSession.from_url(
    "user_123",
    url="redis://localhost:6379/0",
)
result = await Runner.run(agent, "Hello", session=session)
await session.close()
```

`from_url(...)` は Redis クライアントを作成し、その所有権を持ちます。`close()` の後、セッションは終了状態となり、それ以降のセッション操作では `RuntimeError` が発生します。`close()` は、繰り返しまたは並行して呼び出しても安全です。アプリケーションがすでに Redis クライアントを管理している場合は、`redis_client=...` を使用して `RedisSession(...)` を直接構築します。その場合、`close()` は何も行わず、クライアントの所有権とセッションの使用可能性はどちらも呼び出し元に保持されます。

### SQLAlchemy セッション

SQLAlchemy がサポートする任意のデータベースを使用した、本番環境対応の Agents SDK セッション永続化です。

```python
from agents.extensions.memory import SQLAlchemySession

# Using database URL
session = SQLAlchemySession.from_url(
    "user_123",
    url="postgresql+asyncpg://user:pass@localhost/db",
    create_tables=True
)

# Using existing engine
from sqlalchemy.ext.asyncio import create_async_engine
engine = create_async_engine("postgresql+asyncpg://user:pass@localhost/db")
session = SQLAlchemySession("user_123", engine=engine, create_tables=True)
```

詳細なドキュメントについては、[SQLAlchemy セッション](sqlalchemy_session.md)を参照してください。

### Dapr セッション

Dapr サイドカーをすでに実行している場合や、エージェントのコードを変更せずに構成済みのステートストアバックエンドを切り替えたい場合は、`DaprSession` を使用します。

```bash
pip install openai-agents[dapr]
```

```python
from agents import Agent, Runner
from agents.extensions.memory import DaprSession

agent = Agent(name="Assistant")

async with DaprSession.from_address(
    "user_123",
    state_store_name="statestore",
    dapr_address="localhost:50001",
) as session:
    result = await Runner.run(agent, "Hello", session=session)
    print(result.final_output)
```

注意事項：

- `from_address(...)` は Dapr クライアントを作成し、その所有権を持ちます。アプリがすでにクライアントを管理している場合は、`dapr_client=...` を使用して `DaprSession(...)` を直接構築します。
- コンテキストを終了するか `close()` を呼び出すと、所有クライアントを使用するセッションは終了状態となり、それ以降のセッション操作では `RuntimeError` が発生します。一方、`close()` は、繰り返しまたは並行して呼び出しても安全です。注入されたクライアントを使用する場合、`close()` は何も行わず、セッションは引き続き使用できます。
- 基盤のステートストアが TTL をサポートしている場合は、セッションデータに TTL の有効期限が自動適用されるよう、`ttl=...` を渡します。
- 書き込み後の読み取りについて、より強い保証が必要な場合は、`consistency=DAPR_CONSISTENCY_STRONG` を渡します。
- Dapr Python SDK は HTTP サイドカーエンドポイントも確認します。ローカル開発では、`dapr_address` で使用する gRPC ポートに加えて、`--dapr-http-port 3500` でも Dapr を起動してください。
- ローカルコンポーネントやトラブルシューティングを含む完全なセットアップ手順については、[`examples/memory/dapr_session_example.py`](https://github.com/openai/openai-agents-python/tree/main/examples/memory/dapr_session_example.py) を参照してください。


### MongoDB セッション

MongoDB をすでに使用している、または水平方向にスケール可能なマルチプロセスのセッションストレージを必要とするアプリケーションでは、`MongoDBSession` を使用します。

```bash
pip install openai-agents[mongodb]
```

```python
from agents import Agent, Runner
from agents.extensions.memory import MongoDBSession

agent = Agent(name="Assistant")

# Create from URI — owns the client and closes it when session.close() is called
session = MongoDBSession.from_uri(
    "user-123",
    uri="mongodb://localhost:27017",
    database="agents",
)
result = await Runner.run(agent, "Hello", session=session)
print(result.final_output)
await session.close()
```

注意事項：

- `from_uri(...)` は `AsyncMongoClient` を作成して所有し、`session.close()` で閉じます。所有クライアントを使用するセッションは、`close()` の後に終了状態となり、それ以降のセッション操作では `RuntimeError` が発生します。アプリケーションがすでにクライアントを管理している場合は、`client=...` を使用して `MongoDBSession(...)` を直接構築します。その場合、`session.close()` は何も行わず、クライアントのライフサイクルに対する責任は呼び出し元に保持され、セッションは引き続き使用できます。
- `mongodb+srv://user:password@cluster.example.mongodb.net` URI を `from_uri(...)` に渡すだけで、ほかに変更を加えることなく [MongoDB Atlas](https://www.mongodb.com/products/platform) に接続できます。
- 2 つのコレクションが使用され、どちらの名前も `sessions_collection=`（デフォルトは `agent_sessions`）と `messages_collection=`（デフォルトは `agent_messages`）で設定できます。インデックスは初回使用時に自動的に作成されます。空でない `add_items()` の各呼び出しでは、単調増加する `seq` によって最終項目を基準にバッチが順序付けられた、1 つの論理バッチドキュメントが書き込まれます。従来の項目ごとのメッセージドキュメントも引き続き読み取り可能です。論理バッチは MongoDB の単一ドキュメントのサイズ上限内に収まる必要があります。サイズ超過のバッチは、部分的なバッチを保存することなくアトミックに失敗します。
- 最初の実行前に接続を確認するには、`await session.ping()` を使用します。

### 高度な SQLite セッション

会話の分岐、使用状況分析、構造化クエリを備えた拡張 SQLite セッションです。

```python
from agents.extensions.memory import AdvancedSQLiteSession

# Create with advanced features
session = AdvancedSQLiteSession(
    session_id="user_123",
    db_path="conversations.db",
    create_tables=True
)

# Automatic usage tracking
result = await Runner.run(agent, "Hello", session=session)
await session.store_run_usage(result)  # Track token usage

# Conversation branching
await session.create_branch_from_turn(2)  # Branch from turn 2
```

詳細なドキュメントについては、[高度な SQLite セッション](advanced_sqlite_session.md)を参照してください。

### 暗号化セッション

任意のセッション実装に対応する透過的な暗号化ラッパーです。

```python
from agents.extensions.memory import EncryptedSession, SQLAlchemySession

# Create underlying session
underlying_session = SQLAlchemySession.from_url(
    "user_123",
    url="sqlite+aiosqlite:///conversations.db",
    create_tables=True
)

# Wrap with encryption and TTL
session = EncryptedSession(
    session_id="user_123",
    underlying_session=underlying_session,
    encryption_key="your-secret-key",
    ttl=600  # 10 minutes
)

result = await Runner.run(agent, "Hello", session=session)
```

詳細なドキュメントについては、[暗号化セッション](encrypted_session.md)を参照してください。

### その他のセッション形式

ほかにもいくつかの組み込みオプションがあります。`examples/memory/` と `extensions/memory/` 配下のソースコードを参照してください。

## 運用パターン

### セッション ID の命名

会話を整理しやすい、意味のあるセッション ID を使用してください。

- ユーザーベース: `"user_12345"`
- スレッドベース: `"thread_abc123"`
- コンテキストベース: `"support_ticket_456"`

### メモリの永続化

- 一時的な会話にはインメモリ SQLite（`SQLiteSession("session_id")`）を使用します
- 永続的な会話にはファイルベースの SQLite（`SQLiteSession("session_id", "path/to/db.sqlite")`）を使用します
- `aiosqlite` ベースの実装が必要な場合は、非同期 SQLite（`AsyncSQLiteSession("session_id", db_path="...")`）を使用します
- 共有された低レイテンシーのセッションメモリには、Redis ベースのセッション（`RedisSession.from_url("session_id", url="redis://...")`）を使用します
- SQLAlchemy がサポートする既存のデータベースを使用する本番システムには、SQLAlchemy ベースのセッション（`SQLAlchemySession("session_id", engine=engine, create_tables=True)`）を使用します
- MongoDB をすでに使用している、または水平方向にスケール可能なマルチプロセスのセッションストレージを必要とするアプリケーションには、MongoDB セッション（`MongoDBSession.from_uri("session_id", uri="mongodb://localhost:27017")`）を使用します
- 組み込みのテレメトリ、トレーシング、データ分離、および 30 以上のデータベースバックエンドのサポートを必要とする本番環境のクラウドネイティブなデプロイには、Dapr ステートストアセッション（`DaprSession.from_address("session_id", state_store_name="statestore", dapr_address="localhost:50001")`）を使用します
- OpenAI Conversations API に履歴を保存したい場合は、OpenAI がホストするストレージ（`OpenAIConversationsSession()`）を使用します
- 任意のセッションを透過的な暗号化と TTL ベースの有効期限でラップするには、暗号化セッション（`EncryptedSession(session_id, underlying_session, encryption_key)`）を使用します
- より高度なユースケースでは、ほかの本番システム（Django など）向けのカスタムセッションバックエンドの実装を検討してください

### 複数のセッション

```python
from agents import Agent, Runner, SQLiteSession

agent = Agent(name="Assistant")

# Different sessions maintain separate conversation histories
session_1 = SQLiteSession("user_123", "conversations.db")
session_2 = SQLiteSession("user_456", "conversations.db")

result1 = await Runner.run(
    agent,
    "Help me with my account",
    session=session_1
)
result2 = await Runner.run(
    agent,
    "What are my charges?",
    session=session_2
)
```

### セッションの共有

```python
# Different agents can share the same session
support_agent = Agent(name="Support")
billing_agent = Agent(name="Billing")
session = SQLiteSession("user_123")

# Both agents will see the same conversation history
result1 = await Runner.run(
    support_agent,
    "Help me with my account",
    session=session
)
result2 = await Runner.run(
    billing_agent,
    "What are my charges?",
    session=session
)
```

## 完全なコード例

セッションメモリの動作を示す完全なコード例を以下に示します。

```python
import asyncio
from agents import Agent, Runner, SQLiteSession


async def main():
    # Create an agent
    agent = Agent(
        name="Assistant",
        instructions="Reply very concisely.",
    )

    # Create a session instance that will persist across runs
    session = SQLiteSession("conversation_123", "conversation_history.db")

    print("=== Sessions Example ===")
    print("The agent will remember previous messages automatically.\n")

    # First turn
    print("First turn:")
    print("User: What city is the Golden Gate Bridge in?")
    result = await Runner.run(
        agent,
        "What city is the Golden Gate Bridge in?",
        session=session
    )
    print(f"Assistant: {result.final_output}")
    print()

    # Second turn - the agent will remember the previous conversation
    print("Second turn:")
    print("User: What state is it in?")
    result = await Runner.run(
        agent,
        "What state is it in?",
        session=session
    )
    print(f"Assistant: {result.final_output}")
    print()

    # Third turn - continuing the conversation
    print("Third turn:")
    print("User: What's the population of that state?")
    result = await Runner.run(
        agent,
        "What's the population of that state?",
        session=session
    )
    print(f"Assistant: {result.final_output}")
    print()

    print("=== Conversation Complete ===")
    print("Notice how the agent remembered the context from previous turns!")
    print("Sessions automatically handles conversation history.")


if __name__ == "__main__":
    asyncio.run(main())
```

## カスタムセッション実装

[`Session`][agents.memory.session.Session] プロトコルに構造的に準拠するクラスを作成することで、独自のセッションメモリを実装できます。`SessionABC` を継承する必要はありません。`session_id` と `session_settings` を定義し、4 つの履歴メソッドを直接実装してください。

```python
from agents import Agent, Runner, SessionSettings
from agents.items import TResponseInputItem


class MyCustomSession:
    """Custom session implementation following the Session protocol."""

    session_settings: SessionSettings | None = None

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.items: list[TResponseInputItem] = []

    async def get_items(self, limit: int | None = None) -> list[TResponseInputItem]:
        if limit is None:
            return list(self.items)
        if limit <= 0:
            return []
        return list(self.items[-limit:])

    async def add_items(self, items: list[TResponseInputItem]) -> None:
        self.items.extend(items)

    async def pop_item(self) -> TResponseInputItem | None:
        return self.items.pop() if self.items else None

    async def clear_session(self) -> None:
        self.items.clear()


# Use your custom session
agent = Agent(name="Assistant")
result = await Runner.run(
    agent,
    "Hello",
    session=MyCustomSession("my_session")
)
```

### カスタムセッションからの実行コンテキストへのアクセス

Agents SDK は、テナントルーティング、認可、またはアプリ固有のその他のストレージ判断のために、アクティブな [`RunContextWrapper`][agents.run_context.RunContextWrapper] をカスタムセッションに渡すことができます。Agents SDK がラッパーを渡せるようにするには、4 つの履歴メソッドすべてに、明示的に命名され、キーワード引数として使用可能な `wrapper` パラメーターを追加します。

```python
from typing import Any

from agents import RunContextWrapper
from agents.items import TResponseInputItem


class ContextAwareSession:
    async def get_items(
        self,
        limit: int | None = None,
        *,
        wrapper: RunContextWrapper[Any] | None = None,
    ) -> list[TResponseInputItem]: ...

    async def add_items(
        self,
        items: list[TResponseInputItem],
        *,
        wrapper: RunContextWrapper[Any] | None = None,
    ) -> None: ...

    async def pop_item(
        self,
        *,
        wrapper: RunContextWrapper[Any] | None = None,
    ) -> TResponseInputItem | None: ...

    async def clear_session(
        self,
        *,
        wrapper: RunContextWrapper[Any] | None = None,
    ) -> None: ...
```

Agents SDK がこの統合を有効にするのは、`get_items`、`add_items`、`pop_item`、`clear_session` のすべてで `wrapper` が宣言されている場合のみです。汎用の `**kwargs` パラメーターでは、このシグネチャチェックを満たしません。`wrapper` を省略している既存のセッション実装では、公開済みの呼び出し形式が維持され、変更せずに引き続き動作します。

## コミュニティによるセッション実装

コミュニティは、追加のセッション実装を開発しています。

| パッケージ | 説明 |
|---------|-------------|
| [openai-django-sessions](https://pypi.org/project/openai-django-sessions/) | Django がサポートする任意のデータベース（PostgreSQL、MySQL、SQLite など）向けの、Django ORM ベースのセッション |

セッション実装を構築した場合は、ここに追加するためのドキュメント PR をぜひ送信してください。

## API リファレンス

詳細な API ドキュメントについては、以下を参照してください。

- [`Session`][agents.memory.session.Session] - プロトコルインターフェース
- [`OpenAIConversationsSession`][agents.memory.OpenAIConversationsSession] - OpenAI Conversations API の実装
- [`OpenAIResponsesCompactionSession`][agents.memory.openai_responses_compaction_session.OpenAIResponsesCompactionSession] - Responses API コンパクションラッパー
- [`SQLiteSession`][agents.memory.sqlite_session.SQLiteSession] - 基本的な SQLite 実装
- [`AsyncSQLiteSession`][agents.extensions.memory.async_sqlite_session.AsyncSQLiteSession] - `aiosqlite` ベースの非同期 SQLite 実装
- [`RedisSession`][agents.extensions.memory.redis_session.RedisSession] - Redis ベースのセッション実装
- [`SQLAlchemySession`][agents.extensions.memory.sqlalchemy_session.SQLAlchemySession] - SQLAlchemy ベースの実装
- [`MongoDBSession`][agents.extensions.memory.mongodb_session.MongoDBSession] - MongoDB ベースのセッション実装
- [`DaprSession`][agents.extensions.memory.dapr_session.DaprSession] - Dapr ステートストア実装
- [`AdvancedSQLiteSession`][agents.extensions.memory.advanced_sqlite_session.AdvancedSQLiteSession] - 分岐と分析を備えた拡張 SQLite
- [`EncryptedSession`][agents.extensions.memory.encrypt_session.EncryptedSession] - 任意のセッション向けの暗号化ラッパー