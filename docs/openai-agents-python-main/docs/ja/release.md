---
search:
  exclude: true
---
# リリースプロセス／変更履歴

このプロジェクトでは、`0.Y.Z` 形式を使用した、セマンティックバージョニングを一部変更した方式に従います。先頭の `0` は、SDK がまだ急速に進化していることを示します。各構成要素は次のように更新します。

## マイナー（`Y`）バージョン

ベータと明記されていない公開インターフェースに **破壊的変更** を加える場合、マイナーバージョン `Y` を増やします。たとえば、`0.0.x` から `0.1.x` への更新には、破壊的変更が含まれる可能性があります。

破壊的変更を避けるには、プロジェクトで `0.0.x` バージョンに固定することをお勧めします。

## パッチ（`Z`）バージョン

破壊的変更ではない変更の場合、`Z` を増やします。

-   バグ修正
-   新機能
-   非公開インターフェースの変更
-   ベータ機能の更新

## 破壊的変更の変更履歴

### 0.20.0

バージョン 0.20.0 には、ローカル MCP HTTP トランスポートをカスタマイズするアプリケーションに影響する可能性がある、破壊的な MCP 依存関係の移行が含まれます。また、エージェントまたは実行でモデルが明示的に選択されていない場合に使用される SDK のデフォルトモデルも更新されます。

主な変更点：

-   SDK のデフォルトモデルは、`gpt-5.4-mini` ではなく `gpt-5.6-luna` になりました。デフォルトの `reasoning.effort="none"` および `verbosity="low"` の設定に変更はありません。
-   エージェントに明示的に指定されたモデル、実行レベルのモデルオーバーライド、および `OPENAI_DEFAULT_MODEL` 環境変数は、引き続き SDK のデフォルトより優先されます。
-   Realtime 入力文字起こし設定で、`gpt-transcribe`、`gpt-live-transcribe`、`gpt-realtime-whisper` が認識されるようになりました。低レイテンシーの `gpt-live-transcribe` セッションでは、ネストされた `audio.input.transcription` 設定から `prompt`、`keywords`、および期待される複数の `languages` を指定できます。この SDK が固定している OpenAI クライアントのバージョンでは、`delay` のレイテンシー／精度レベルは `gpt-realtime-whisper` でのみサポートされます。確定済みの音声ターン後に文字起こしを行う場合、または検出された言語を出力する場合は、WebSocket 経由で `gpt-transcribe` を使用してください。`audio.input.turn_detection=None` を明示的に設定すると、ターンの自動検出が無効になります。[入力文字起こし設定](realtime/guide.md#input-transcription-settings)を参照してください。
-   Agents SDK によって作成されるローカル MCP 接続は、`mcp>=1.19.0,<3` を通じて v1 との互換性を維持しながら、MCP Python SDK v2 をサポートするようになりました。Agents SDK は、通常の stdio、SSE、Streamable HTTP 接続を自動的に適応させます。MCP v2 がインストールされている場合、これらの接続では `mcp.Client(mode="auto")` を使用してサポートされている最新のプロトコルを確認し、古いサーバーでは従来の `initialize` ハンドシェイクにフォールバックします。依存関係の解決で MCP v2 が選択された場合、カスタムの `httpx.Auth` オブジェクトまたは `httpx.AsyncClient` ファクトリーを指定するアプリケーションでは、それらの値を `httpx2` に移行するか、v1 HTTP スタックを維持するために `mcp<2` を固定する必要があります。`MCPServerStreamableHttp` の `params["ignore_initialized_notification_failure"] = True` オプションも、引き続き v1 専用です。移行の詳細については、[MCP Python SDK v1 と v2](mcp.md#mcp-python-sdk-v1-and-v2)を参照してください。
-   サンドボックスのマウント検証では、サンドボックスまたはマウントヘルパーによる副作用が発生する前に、安全でない認証情報の配置を拒否するようになりました。信頼できるアプリケーションは、ストレージ機能テーブルを変更することなく、コンテナー内の正確なマウントパスに対するマウントスコープまたは広範な認証情報の露出を承認できます。これらの承認は実行時にのみ有効であり、シリアライズされたサンドボックス状態だけで認証情報への権限が付与されることはありません。保護されたマウント境界では、SDK は新たに生成された秘匿化済みの例外を返します。発生元の例外が、正確に認識された SDK のサンドボックスエラーであり、承認済みの構造化フィールドが検証に合格した場合、置換後の例外ではそのサブタイプと検証済みの安全なフィールドが保持されます。認識された `MountConfigError` では、SDK が生成した安全な検証メッセージも保持できます。それ以外の場合、SDK は新たに生成された汎用の秘匿化済みエラーを返します。プロバイダーが制御する、またはその他の理由で承認されていないメッセージ、コマンドデータ、注記、コンテキスト、原因、および発生元のトレースバック状態は保持されません。[マウントとリモートストレージ](sandbox/clients.md#mounts-and-remote-storage)および[セッション状態からの再開](sandbox/guide.md#resume-from-session-state)を参照してください。
-   再試行ポリシーでは、安定したリプレイ安全性情報を確認し、プロバイダーが安全でないと判断した非ストリーミングリクエストに対して `RetryDecision(approve_unsafe_replay=True)` を明示的に設定できます。この承認によって、中止、すでに出力されたストリーミング結果、または Programmatic Tool Calling などのローカル側の副作用に対する個別の拒否が回避されることはありません。[Runner が管理する再試行](models/index.md#runner-managed-retries)を参照してください。
-   再開可能な `RunState` オブジェクトでは、次回のモデル呼び出し前に、`add_input()` を使用して永続的なユーザー入力をステージングできるようになりました。ステージングされた入力はシリアライズ後も維持され、入力ガードレールを通過し、ローカルセッションとサーバー管理の会話にわたって、永続的な SDK 入力を 1 回だけ生成します。安全でないリプレイが明示的に承認されている場合でも、入力がプロバイダーに再送信され、プロバイダー側の処理が繰り返される可能性があります。[再開前の入力追加](results.md#add-input-before-resuming)を参照してください。
-   実行時の信頼性修正により、ストリーミング実行と非ストリーミング実行で[出力ガードレールのセッション永続化](guardrails.md#output-guardrails)の動作が統一され、コピーおよび名前空間の適用中も `FunctionTool` のサブクラスが保持されるようになりました。また、[サポートされていない Chat Completions の音声出力](models/index.md#chat-completions-compatibility-options)では、空のストリームを暗黙的に完了する代わりに、明示的なエラーが発生するようになりました。`OpenAIResponsesCompactionSession` ラッパーは、キャンセルが呼び出し元に伝わる前に、[コンパクション前の履歴復旧](sessions/index.md#auto-compaction-can-block-streaming)を試行して完了を待ちます。[`VoicePipeline`](voice/pipeline.md#results) のコンシューマーは、正常な実行後に文字起こしセッションのクローズに失敗した場合、その失敗を受け取るようになりました。一方、先行するターンの失敗は、後から発生したクローズの失敗より優先されます。`RunState` の往復変換では、ローカルシェルの出力、承認済みのコンピューター安全性チェック、デフォルト値が設定されたツール出力フィールド、および辞書、リスト、タプルの走査中に検出された Pydantic モデルまたは dataclass の出力が保持されるようになりました。MCP 変換では、自由形式のオブジェクトスキーマと画像出力が保持され、音声ブロックやリソースブロックなど、その他の raw コンテンツブロックは有効な JSON テキストとしてシリアライズされます。`MCPServerManager` は重複するライフサイクル操作を順番に実行し、接続とクリーンアップに有限のデフォルトタイムアウトを適用します。モデルのリプレイでは、出力項目を入力として使用する前に、サーバー所有の `created_by` メタデータが削除されます。

### 0.19.0

このマイナーリリースでは、破壊的変更は **導入されません**。マイナーバージョンの更新は、OpenAI Responses の重要な新機能領域である Programmatic Tool Calling を反映したものです。

主な変更点：

-   [`ProgrammaticToolCallingTool`][agents.tool.ProgrammaticToolCallingTool] を追加しました。これにより、対応する OpenAI Responses モデルは、Programmatic Tool Calling の対象となるツールを連携させる JavaScript を生成できます。ツール単位の `allowed_callers`、`FunctionTool` インスタンスからの structured outputs、および Runner のストリーミング、ガードレール、承認、セッション、`RunState` との統合をサポートします。設定方法と制約については、[Programmatic Tool Calling](tools.md#programmatic-tool-calling)を参照してください。
-   公開 `agents.decorators` モジュールと、既存のガードレールデコレーターに加えて、既存の `@function_tool` デコレーターの短いエイリアスである `@tool` を追加しました。`FunctionTool` インスタンスは、非同期の呼び出し可能オブジェクトもサポートするようになりました。
-   SDK の設定では、エージェント、実行、モデル、セッション、サンドボックス、音声パイプラインの全体で、型付き設定オブジェクトまたは辞書のいずれかを一貫して受け入れるようになり、不明な設定も検証されます。
-   モデル、ツール、MCP、Realtime、セッション、サンドボックス、トレーシング全体でエラーおよび診断ログを強化し、有用なデバッグコンテキストを維持しながら、raw の機密ペイロードが露出しないようにしました。
-   AnyLLM、LiteLLM、Chat Completions との互換性を改善し、モデルの再試行をまたいでセッション履歴が保持されるようにしました。また、レスポンス開始前に発生した WebSocket の過負荷に対するプロバイダー再試行ガイダンスを追加し、オプトインの Runner 再試行ポリシーで、許可されている場合に失敗した試行をリプレイできるようにしました。
-   `VercelCloudBucketMountStrategy` を通じて、[Vercel サンドボックスの作成時にのみ設定できる S3 マウント](sandbox/clients.md#mounts-and-remote-storage)を追加しました。マウントされたセッションでは、バケットの内容がワークスペースの永続化から除外され、動的なマウント変更やセッションの再開は意図的にサポートされません。

### 0.18.0

このマイナーリリースでは、破壊的変更は **導入されません**。マイナーバージョンの更新は、Realtime エージェントのデフォルトモデル更新のみを反映したものです。

主な変更点：

-   Realtime エージェントはデフォルトモデルとして `gpt-realtime-2.1` を使用するようになったため、新しい Realtime 設定では追加の構成なしで最新の推奨モデルが使用されます。

### 0.17.0

このバージョンでは、サンドボックスのローカルソースの実体化において、ソースパスが `Manifest.extra_path_grants` の対象でない限り、`LocalFile.src` と `LocalDir.src` は実体化の `base_dir` 内に保持されます。`base_dir` は、マニフェストの適用時における SDK プロセスの現在の作業ディレクトリです。相対的なローカルソースはそのディレクトリを基準に解決されます。一方、絶対パスのローカルソースは、すでにそのディレクトリ内に存在するか、明示的な許可の対象である必要があります。これにより、ローカルアーティファクトの境界に関する問題が解消されますが、そのベースディレクトリ外にある信頼済みのホストファイルやディレクトリを、意図的にサンドボックスワークスペースへコピーしているアプリケーションに影響する可能性があります。

移行するには、マニフェストレベルで `SandboxPathGrant` を使用して信頼済みのホストルートを許可してください。サンドボックスでそれらのファイルを読み取るだけの場合は、読み取り専用にすることをお勧めします。

```python
from pathlib import Path

from agents.sandbox import Manifest, SandboxPathGrant
from agents.sandbox.entries import Dir, LocalDir

# This is an absolute host path outside the SDK process base_dir.
TRUSTED_DOCS_ROOT = Path("/opt/my-app/docs")

manifest = Manifest(
    extra_path_grants=(
        # This host root is outside the SDK process base_dir, so the manifest must grant it.
        SandboxPathGrant(path=str(TRUSTED_DOCS_ROOT), read_only=True),
    ),
    entries={
        # No grant is needed for local sources that stay under the SDK process base_dir.
        "fixtures": LocalDir(src=Path("fixtures"), description="Local test fixtures."),
        # This entry reads from the granted host root and copies it into the sandbox workspace.
        "docs": LocalDir(src=TRUSTED_DOCS_ROOT, description="Trusted local documents."),
        # Dir creates a sandbox workspace directory; it does not read from the host filesystem.
        "output": Dir(description="Generated artifacts."),
    },
)
```

`extra_path_grants` は、信頼済みのアプリケーション設定として扱ってください。アプリケーションが対象のホストパスをすでに承認している場合を除き、モデルの出力やその他の信頼できないマニフェスト入力から許可を設定しないでください。

### 0.16.0

このバージョンでは、SDK のデフォルトモデルが `gpt-4.1` から `gpt-5.4-mini` に変更されました。これは、モデルを明示的に設定していないエージェントと実行に影響します。新しいデフォルトは GPT-5 モデルであるため、暗黙的なデフォルトモデル設定には、`reasoning.effort="none"` や `verbosity="low"` などの GPT-5 のデフォルトが含まれるようになりました。

以前のデフォルトモデルの動作を維持する必要がある場合は、エージェントまたは実行設定でモデルを明示的に指定するか、`OPENAI_DEFAULT_MODEL` 環境変数を設定してください。

```python
agent = Agent(name="Assistant", model="gpt-4.1")
```

主な変更点：

-   `Runner.run`、`Runner.run_sync`、`Runner.run_streamed` で `max_turns=None` を指定し、ターン数の上限を無効にできるようになりました。
-   サンドボックスワークスペースのハイドレーションでは、ローカル、Docker、プロバイダー提供のすべてのサンドボックス実装において、絶対パスのシンボリックリンク先を含め、アーカイブルート外を指すシンボリックリンクを含む tar アーカイブを拒否するようになりました。

### 0.15.0

このバージョンでは、モデルによる拒否は、空のテキスト出力として扱われたり、structured outputs の場合に `MaxTurnsExceeded` まで実行ループが再試行されたりするのではなく、`ModelRefusalError` として明示的に通知されるようになりました。

これは以前、拒否のみのモデルレスポンスが `final_output == ""` で完了することを想定していたコードに影響します。例外を発生させずに拒否を処理するには、`model_refusal` 実行エラーハンドラーを指定してください。

```python
result = Runner.run_sync(
    agent,
    input,
    error_handlers={"model_refusal": lambda data: data.error.refusal},
)
```

structured outputs を使用するエージェントの場合、ハンドラーはエージェントの出力スキーマに一致する値を返すことができ、SDK は他の実行エラーハンドラーの最終出力と同様に検証します。

### 0.14.0

このマイナーリリースでは、破壊的変更は **導入されません**が、主要な新しいベータ機能領域であるサンドボックスエージェントと、ローカル環境、コンテナー環境、ホスト環境でそれらを使用するために必要なランタイム、バックエンド、ドキュメントのサポートが追加されます。

主な変更点：

-   `SandboxAgent`、`Manifest`、`SandboxRunConfig` を中心とする新しいベータ版サンドボックスランタイムインターフェースを追加しました。これにより、エージェントはファイル、ディレクトリ、Git リポジトリ、マウント、スナップショット、再開機能を備えた永続的で分離されたワークスペース内で作業できます。
-   `UnixLocalSandboxClient` と `DockerSandboxClient` によるローカルおよびコンテナー化された開発向けのサンドボックス実行バックエンドに加えて、Python パッケージのオプション依存関係 extras を通じて、Blaxel、Cloudflare、Daytona、E2B、Modal、Runloop、Vercel のホスト型プロバイダー統合を追加しました。
-   サンドボックスメモリのサポートを追加し、段階的開示、複数ターンのグループ化、構成可能な分離境界、S3 ベースのワークフローを含む永続化メモリのコード例により、今後の実行で以前の実行から得た知見を再利用できるようになりました。
-   ローカルおよび合成ワークスペースエントリー、S3／R2／GCS／Azure Blob Storage／S3 Files のリモートストレージマウント、移植可能なスナップショット、`RunState`、`SandboxSessionState`、または保存済みスナップショットによる再開フローを含む、より包括的なワークスペースおよび再開モデルを追加しました。
-   `examples/sandbox/` 配下に、スキル、ハンドオフ、メモリを利用したコーディングタスク、プロバイダー固有の設定、コードレビュー、データルーム QA、Web サイトのクローン作成などのエンドツーエンドのワークフローを扱う、多数のサンドボックスのコード例とチュートリアルを追加しました。
-   サンドボックス対応のセッション準備、機能のバインド、状態のシリアライズ、統合トレーシング、プロンプトキャッシュキーのデフォルト、機密性の高い MCP 出力のより安全な秘匿化により、コアランタイムとトレーシングスタックを拡張しました。

### 0.13.0

このマイナーリリースでは、破壊的変更は **導入されません**が、注目すべき Realtime のデフォルト更新に加え、新しい MCP 機能と実行時の安定性修正が含まれます。

主な変更点：

-   デフォルトの WebSocket Realtime モデルは `gpt-realtime-1.5` になったため、新しい Realtime エージェント設定では追加の構成なしで新しいモデルが使用されます。
-   `MCPServer` で `list_resources()`、`list_resource_templates()`、`read_resource()` が公開され、`MCPServerStreamableHttp` で `session_id` が公開されるようになりました。これにより、MCP Streamable HTTP トランスポートを使用するセッションを、再接続やステートレスワーカーをまたいで再開できます。
-   Chat Completions 統合では、`should_replay_reasoning_content` を通じて既存の推論内容の再送信をオプトインできるようになり、LiteLLM／DeepSeek などのアダプターで、プロバイダー固有の推論やツール呼び出しの継続性が向上しました。
-   `SQLAlchemySession` での同時初回書き込み、推論の除去後に孤立したアシスタントメッセージ ID を含むコンパクションリクエスト、MCP／推論項目を残していた `remove_all_tools()`、`FunctionTool` インスタンスのバッチ実行機構における競合状態など、複数のランタイムおよびセッションのエッジケースを修正しました。

### 0.12.0

このマイナーリリースでは、破壊的変更は **導入されません**。主な新機能については、[リリースノート](https://github.com/openai/openai-agents-python/releases/tag/v0.12.0)を参照してください。

### 0.11.0

このマイナーリリースでは、破壊的変更は **導入されません**。主な新機能については、[リリースノート](https://github.com/openai/openai-agents-python/releases/tag/v0.11.0)を参照してください。

### 0.10.0

このマイナーリリースでは、破壊的変更は **導入されません**が、OpenAI Responses ユーザー向けの重要な新機能領域である Responses API の WebSocket トランスポートサポートが含まれます。

主な変更点：

-   OpenAI Responses モデルに WebSocket トランスポートのサポートを追加しました（オプトイン方式であり、HTTP が引き続きデフォルトのトランスポートです）。
-   複数ターンの実行で、WebSocket 対応の共有プロバイダーと `RunConfig` を再利用するための `responses_websocket_session()` ヘルパー／`ResponsesWebSocketSession` を追加しました。
-   ストリーミング、ツール、承認、フォローアップターンを扱う、新しい WebSocket ストリーミングのコード例（`examples/basic/stream_ws.py`）を追加しました。

### 0.9.0

このバージョンでは、このメジャーバージョンが 3 か月前に EOL を迎えたため、Python 3.9 はサポートされなくなりました。より新しいランタイムバージョンにアップグレードしてください。

さらに、`Agent#as_tool()` メソッドから返される値の型ヒントが、`Tool` から `FunctionTool` に限定されました。この変更によって通常は破壊的な問題が発生することはありませんが、コードがより広範な共用体型に依存している場合は、アプリケーション側で調整が必要になる可能性があります。

### 0.8.0

このバージョンでは、2 つのランタイム動作の変更により、移行作業が必要になる可能性があります。

- `FunctionTool` インスタンスでラップされた **同期** Python 呼び出し可能オブジェクトは、イベントループのスレッドで実行されるのではなく、`asyncio.to_thread(...)` を通じてワーカースレッドで実行されるようになりました。ツールのロジックがスレッドローカルな状態やスレッドに依存するリソースに依存している場合は、非同期ツール実装へ移行するか、ツールコード内でスレッドアフィニティを明示してください。
- ローカル MCP ツールの失敗処理が構成可能になり、デフォルトの動作では実行全体を失敗させる代わりに、モデルから参照できるエラー出力を返せるようになりました。即時失敗の動作に依存している場合は、`mcp_config={"failure_error_function": None}` を設定してください。サーバーレベルの `failure_error_function` 値はエージェントレベルの設定をオーバーライドするため、明示的なハンドラーを持つ各ローカル MCP サーバーで `failure_error_function=None` を設定してください。

### 0.7.0

このバージョンでは、既存のアプリケーションに影響する可能性がある動作変更がいくつかあります。

- ネストされたハンドオフ履歴は **オプトイン** になりました（デフォルトでは無効です）。v0.6.x のデフォルトであったネスト動作に依存していた場合は、`RunConfig(nest_handoff_history=True)` を明示的に設定してください。
- `gpt-5.1`／`gpt-5.2` のデフォルトの `reasoning.effort` が、SDK のデフォルトによって設定されていた従来の `"low"` から `"none"` に変更されました。プロンプトまたは品質／コスト特性が `"low"` に依存している場合は、`model_settings` で明示的に設定してください。

### 0.6.0

このバージョンでは、デフォルトのハンドオフ履歴は、ユーザーとアシスタントの各ターンを別々のメッセージとして渡すのではなく、単一のアシスタントメッセージにまとめられるようになり、後続のエージェントに簡潔で予測可能な要約が提供されます。
- 既存の単一メッセージ形式のハンドオフ記録は、デフォルトで `<CONVERSATION HISTORY>` ブロックの前に、正確なリテラルテキスト `For context, here is the conversation so far between the user and the previous agent:` を置いて開始するようになり、後続のエージェントは明確なラベル付きの要約を受け取ります。

### 0.5.0

このバージョンでは、目に見える破壊的変更は導入されませんが、新機能と内部の重要な更新がいくつか含まれます。

- `RealtimeRunner` に、[SIP プロトコル接続](https://platform.openai.com/docs/guides/realtime-sip)を処理するためのサポートを追加しました。
- Python 3.14 との互換性のため、`Runner#run_sync` の内部ロジックを大幅に改訂しました。

### 0.4.0

このバージョンでは、[openai](https://pypi.org/project/openai/) パッケージの v1.x バージョンはサポートされなくなりました。この SDK とともに openai v2.x を使用してください。

### 0.3.0

このバージョンでは、Realtime API のサポートが gpt-realtime モデルとその API インターフェース（GA バージョン）に移行されます。

### 0.2.0

このバージョンでは、以前は引数として `Agent` を受け取っていた箇所の一部が、代わりに `AgentBase` を受け取るようになりました。たとえば、MCP サーバーの `list_tools()` メソッドシグネチャがこれに該当します。これは型指定のみの変更であり、引き続き `Agent` オブジェクトを受け取ります。更新するには、`Agent` を `AgentBase` に置き換えて型エラーを修正してください。

### 0.1.0

このバージョンでは、[`MCPServer.list_tools()`][agents.mcp.server.MCPServer] に `run_context` と `agent` という 2 つの新しいパラメーターが追加されました。`MCPServer` のサブクラスでオーバーライドされたすべての `MCPServer.list_tools()` メソッドに、これらのパラメーターを追加する必要があります。