---
search:
  exclude: true
---
# 概念

!!! warning "ベータ機能"

    サンドボックスエージェントはベータ版です。一般提供までに API の詳細、デフォルト、サポートされる機能が変更される可能性があります。また、今後さらに高度な機能が追加される予定です。

最新のエージェントは、ファイルシステム上の実際のファイルを操作できる場合に最も効果を発揮します。 **サンドボックスエージェント** は、専用ツールやシェルコマンドを使用して、大規模なドキュメントセットの検索や操作、ファイルの編集、成果物の生成、コマンドの実行を行えます。サンドボックスは、エージェントがユーザーに代わって作業するために使用できる永続的なワークスペースをモデルに提供します。Agents SDKのサンドボックスエージェントを使用すると、サンドボックス環境と組み合わせたエージェントを簡単に実行できます。これにより、適切なファイルをファイルシステムに配置し、サンドボックスをオーケストレーションして、大規模なタスクを容易に開始、停止、再開できます。

エージェントが必要とするデータを中心にワークスペースを定義します。GitHub リポジトリ、ローカルのファイルやディレクトリ、合成されたタスクファイル、S3 や Azure Blob Storage などのリモートファイルシステム、およびその他の指定したサンドボックス入力から開始できます。

<div class="sandbox-harness-image" markdown="1">

![コンピュート機能を備えたサンドボックスエージェントハーネス](../assets/images/harness_with_compute.png)

</div>

`SandboxAgent` は引き続き `Agent` です。`instructions`、`prompt`、`tools`、`handoffs`、`mcp_servers`、`model_settings`、`output_type`、ガードレール、フックなど、通常のエージェントインターフェースを維持し、引き続き通常の `Runner` API を介して実行されます。変わるのは実行境界です。

- `SandboxAgent` はエージェント自体を定義します。これには、通常のエージェント設定に加えて、`default_manifest`、`base_instructions`、`run_as` などのサンドボックス固有のデフォルト、およびファイルシステムツール、シェルアクセス、スキル、メモリ、コンパクションなどの機能が含まれます。
- `Manifest` は、ファイル、リポジトリ、マウント、環境など、新しいサンドボックスワークスペースに必要な初期コンテンツとレイアウトを宣言します。
- サンドボックスセッションは、コマンドが実行され、ファイルが変更される、稼働中の分離された環境です。
- [`SandboxRunConfig`][agents.run_config.SandboxRunConfig] は、サンドボックスセッションを直接注入する、シリアライズ済みのサンドボックスセッション状態から再接続する、サンドボックスクライアントを介して新しいサンドボックスセッションを作成するなど、実行がそのサンドボックスセッションを取得する方法を決定します。
- 保存済みのサンドボックス状態とスナップショットにより、後続の実行で以前の作業に再接続したり、保存済みコンテンツから新しいサンドボックスセッションを初期化したりできます。

`Manifest` は、新規セッションのワークスペース契約であり、稼働中のすべてのサンドボックスに対する完全な信頼できる唯一の情報源ではありません。実行に有効なワークスペースは、再利用されたサンドボックスセッション、シリアライズ済みのサンドボックスセッション状態、または実行時に選択されたスナップショットから取得される場合があります。

このページ全体で「サンドボックスセッション」とは、サンドボックスクライアントによって管理される稼働中の実行環境を指します。これは、[セッション](../sessions/index.md)で説明されている SDK の会話用 [`Session`][agents.memory.session.Session] インターフェースとは異なります。

外側のランタイムは、引き続き承認、トレーシング、ハンドオフ、および実行の再開に必要な状態の追跡を担います。サンドボックスセッションは、コマンド、ファイル変更、環境の分離を担います。この役割分担は、このモデルの中核を成します。

### 各要素の関係

サンドボックス実行では、エージェント定義と実行ごとのサンドボックス設定を組み合わせます。ランナーはエージェントを準備して稼働中のサンドボックスセッションにバインドし、後続の実行用に状態を保存できます。

```mermaid
flowchart LR
    agent["SandboxAgent<br/><small>full Agent + sandbox defaults</small>"]
    config["SandboxRunConfig<br/><small>client / session / resume inputs</small>"]
    runner["Runner<br/><small>prepare instructions<br/>bind capability tools</small>"]
    sandbox["sandbox session<br/><small>workspace where commands run<br/>and files change</small>"]
    saved["saved state / snapshot<br/><small>for resume or fresh-start later</small>"]

    agent --> runner
    config --> runner
    runner --> sandbox
    sandbox --> saved
```

サンドボックス固有のデフォルトは `SandboxAgent` に保持します。実行ごとのサンドボックスセッションの選択は `SandboxRunConfig` に保持します。

ライフサイクルは、次の 3 つのフェーズに分けて考えます。

1. `SandboxAgent`、`Manifest`、および各種機能を使用して、エージェントと新規ワークスペースの契約を定義します。
2. サンドボックスセッションを注入、再開、または作成する `SandboxRunConfig` を `Runner` に渡して実行します。
3. ランナーが管理する `RunState`、明示的なサンドボックス `session_state`、または保存済みワークスペーススナップショットから、後で処理を継続します。

シェルアクセスをときどき使用する単なる 1 つのツールとして必要とする場合は、[ツールガイド](../tools.md)のホスト型シェルから始めてください。ワークスペースの分離、サンドボックスクライアントの選択、またはサンドボックスセッションの再開動作が設計の一部である場合は、サンドボックスエージェントを使用してください。

## 使用場面

サンドボックスエージェントは、次のようなワークスペース中心のワークフローに適しています。

- コーディングとデバッグ。たとえば、GitHub リポジトリ内の Issue 報告に対する自動修正をオーケストレーションし、対象を絞ったテストを実行する場合
- ドキュメントの処理と編集。たとえば、ユーザーの財務書類から情報を抽出し、記入済みの税務フォームのドラフトを作成する場合
- ファイルに基づくレビューや分析。たとえば、回答前にオンボーディング資料、生成されたレポート、成果物のバンドルを確認する場合
- 分離されたマルチエージェントパターン。たとえば、各レビュー担当エージェントやコーディングサブエージェントに専用のワークスペースを割り当てる場合
- 複数ステップのワークスペースタスク。たとえば、ある実行でバグを修正し、後続の実行で回帰テストを追加する場合や、スナップショットまたはサンドボックスセッション状態から再開する場合

ファイルへのアクセスや、状態を持つ変更可能なファイルシステムが不要な場合は、引き続き `Agent` を使用してください。シェルアクセスがときどき必要となる機能の 1 つにすぎない場合は、ホスト型シェルを追加します。ワークスペース境界自体が機能の一部である場合は、サンドボックスエージェントを使用します。

## サンドボックスクライアントの選択

macOS または Linux でのローカル開発では、`UnixLocalSandboxClient` から始めてください。Windows では、`DockerSandboxClient` またはホスト型プロバイダーを使用します。サポート対象のどのプラットフォームでも、コンテナ分離やイメージの同等性が必要な場合は `DockerSandboxClient` に、プロバイダー管理の実行が必要な場合はホスト型プロバイダーに移行してください。

ほとんどの場合、`SandboxAgent` の定義は変えずに、[`SandboxRunConfig`][agents.run_config.SandboxRunConfig] 内のサンドボックスクライアントとそのオプションのみを変更します。ローカル、Docker、ホスト型、およびリモートマウントの各オプションについては、[サンドボックスクライアント](clients.md)を参照してください。

## 中核要素

<div class="sandbox-nowrap-first-column-table" markdown="1">

| レイヤー | SDK の主要要素 | 回答する問い |
| --- | --- | --- |
| エージェント定義 | `SandboxAgent`、`Manifest`、各種機能 | どのエージェントを実行し、どの新規セッション用ワークスペース契約から開始するか？ |
| サンドボックス実行 | `SandboxRunConfig`、サンドボックスクライアント、稼働中のサンドボックスセッション | この実行はどのように稼働中のサンドボックスセッションを取得し、どこで処理を実行するか？ |
| 保存済みサンドボックス状態 | `RunState` のサンドボックスペイロード、`session_state`、スナップショット | このワークフローは、以前のサンドボックス作業にどのように再接続し、保存済みコンテンツから新しいサンドボックスセッションをどのように初期化するか？ |

</div>

SDK の主要要素は、次のように各レイヤーに対応します。

<div class="sandbox-nowrap-first-column-table" markdown="1">

| 要素 | 担当範囲 | 確認すべき問い |
| --- | --- | --- |
| [`SandboxAgent`][agents.sandbox.sandbox_agent.SandboxAgent] | エージェント定義 | このエージェントは何を実行し、どのデフォルト設定を保持すべきか？ |
| [`Manifest`][agents.sandbox.manifest.Manifest] | 新規セッションのワークスペースファイルとフォルダー | 実行開始時に、ファイルシステム上にどのファイルとフォルダーが存在すべきか？ |
| [`Capability`][agents.sandbox.capabilities.capability.Capability] | サンドボックスネイティブの動作 | どのツール、instructions の断片、またはランタイム動作をこのエージェントに関連付けるべきか？ |
| [`SandboxRunConfig`][agents.run_config.SandboxRunConfig] | 実行ごとのサンドボックスクライアントとサンドボックスセッションのソース | この実行ではサンドボックスセッションを注入、再開、または作成すべきか？ |
| [`RunState`][agents.run_state.RunState] | ランナー管理の保存済みサンドボックス状態 | 以前のランナー管理ワークフローを再開し、そのサンドボックス状態を自動的に引き継いでいるか？ |
| [`SandboxRunConfig.session_state`][agents.run_config.SandboxRunConfig.session_state] | 明示的にシリアライズされたサンドボックスセッション状態 | `RunState` の外部ですでにシリアライズしたサンドボックス状態から再開するか？ |
| [`SandboxRunConfig.snapshot`][agents.run_config.SandboxRunConfig.snapshot] | 新しいサンドボックスセッション用に保存されたワークスペースコンテンツ | 新しいサンドボックスセッションを保存済みのファイルや成果物から開始するか？ |

</div>

実用的な設計順序は次のとおりです。

1. `Manifest` を使用して、新規セッションのワークスペース契約を定義します。
2. `SandboxAgent` を使用して、エージェントを定義します。
3. 組み込みまたはカスタムの機能を追加します。
4. `RunConfig(sandbox=SandboxRunConfig(...))` で、各実行がサンドボックスセッションを取得する方法を決定します。

## サンドボックス実行の準備

実行時に、ランナーは定義を具体的なサンドボックスベースの実行に変換します。

1. `SandboxRunConfig` からサンドボックスセッションを解決します。`session=...` を渡すと、その稼働中のサンドボックスセッションを再利用します。それ以外の場合は、`client=...` を使用してセッションを作成または再開します。
2. 実行に有効なワークスペース入力を決定します。実行でサンドボックスセッションを注入または再開する場合は、その既存のサンドボックス状態が優先されます。それ以外の場合、ランナーは 1 回限りのマニフェストオーバーライドまたは `agent.default_manifest` から開始します。そのため、`Manifest` だけでは、すべての実行における最終的な稼働中ワークスペースは定義されません。
3. 各機能に、生成されたマニフェストを処理させます。これにより、最終的なエージェントの準備前に、機能がファイル、マウント、またはその他のワークスペーススコープの動作を追加できます。
4. 最終的な instructions を固定順序で構築します。まず SDK のデフォルトのサンドボックスプロンプト、または明示的にオーバーライドする場合は `base_instructions`、次に `instructions`、機能の instructions 断片、リモートマウントのポリシーテキスト、レンダリングされたファイルシステムツリーの順です。
5. 機能のツールを稼働中のサンドボックスセッションにバインドし、通常の `Runner` API を介して準備済みエージェントを実行します。

サンドボックス化によって、ターンの意味は変わりません。ターンは引き続きモデルの 1 ステップであり、単一のシェルコマンドやサンドボックスアクションではありません。サンドボックス側の操作とターンの間に固定された 1:1 の対応関係はありません。一部の処理はサンドボックス実行レイヤー内で完結する場合がありますが、別のアクションでは、ツールの実行結果、承認、その他の状態など、追加のモデルステップを必要とする情報が返されます。実用上は、サンドボックスで処理が行われた後、エージェントランタイムが別のモデル応答を必要とする場合にのみ、追加のターンが消費されます。

これらの準備ステップがあるため、`default_manifest`、`instructions`、`base_instructions`、`capabilities`、`run_as` は、`SandboxAgent` を設計する際に考慮すべき主要なサンドボックス固有オプションです。

## `SandboxAgent` のオプション

通常の `Agent` フィールドに加えて、次のサンドボックス固有オプションがあります。

<div class="sandbox-nowrap-first-column-table" markdown="1">

| オプション | 最適な用途 |
| --- | --- |
| `default_manifest` | ランナーが作成する新しいサンドボックスセッションのデフォルトワークスペース。 |
| `instructions` | SDK のサンドボックスプロンプトの後に追加される、役割、ワークフロー、成功条件。 |
| `base_instructions` | SDK のサンドボックスプロンプトを置き換える高度なエスケープハッチ。 |
| `capabilities` | このエージェントに付随させるサンドボックスネイティブのツールと動作。 |
| `run_as` | シェルコマンド、ファイル読み取り、パッチなど、モデル向けサンドボックスツール用のユーザー ID。 |

</div>

サンドボックスクライアントの選択、サンドボックスセッションの再利用、マニフェストのオーバーライド、スナップショットの選択は、エージェントではなく [`SandboxRunConfig`][agents.run_config.SandboxRunConfig] に設定します。

### `default_manifest`

`default_manifest` は、ランナーがこのエージェント用に新しいサンドボックスセッションを作成するときに使用するデフォルトの [`Manifest`][agents.sandbox.manifest.Manifest] です。通常、エージェントが開始時に必要とするファイル、リポジトリ、補助資料、出力ディレクトリ、マウントに使用します。

これはデフォルトにすぎません。実行時に `SandboxRunConfig(manifest=...)` でオーバーライドでき、再利用または再開されたサンドボックスセッションは既存のワークスペース状態を維持します。

### `instructions` と `base_instructions`

異なるプロンプト間でも維持すべき短いルールには、`instructions` を使用します。`SandboxAgent` では、これらの instructions が SDK のサンドボックス基本プロンプトの後に追加されるため、組み込みのサンドボックスガイダンスを維持しつつ、独自の役割、ワークフロー、成功条件を追加できます。

SDK のサンドボックス基本プロンプトを置き換える場合にのみ、`base_instructions` を使用してください。ほとんどのエージェントでは設定しないでください。

<div class="sandbox-nowrap-first-column-table" markdown="1">

| 設定先 | 用途 | 例 |
| --- | --- | --- |
| `instructions` | エージェントの安定した役割、ワークフロールール、成功条件。 | 「オンボーディング書類を調査してから、ハンドオフする。」「最終ファイルを `output/` に書き込む。」 |
| `base_instructions` | SDK のサンドボックス基本プロンプトの完全な置き換え。 | カスタムの低レベルサンドボックスラッパープロンプト。 |
| ユーザープロンプト | この実行固有のリクエスト。 | 「このワークスペースを要約してください。」 |
| マニフェスト内のワークスペースファイル | 長いタスク仕様、リポジトリローカルの instructions、または範囲を限定した参考資料。 | `repo/task.md`、ドキュメントバンドル、サンプル資料。 |

</div>

`instructions` の適切な使用例は次のとおりです。

- [examples/sandbox/unix_local_pty.py](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/unix_local_pty.py) では、PTY の状態が重要な場合に、エージェントを単一の対話型プロセス内に維持します。
- [examples/sandbox/handoffs.py](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/handoffs.py) では、サンドボックスレビュー担当エージェントが調査後にユーザーへ直接回答することを禁止します。
- [examples/sandbox/tax_prep.py](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/tax_prep.py) では、最終的な記入済みファイルが実際に `output/` に配置されることを必須とします。
- [examples/sandbox/docs/coding_task.py](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/docs/coding_task.py) では、正確な検証コマンドを固定し、ワークスペースルート相対のパッチパスを明確にします。

ユーザーの 1 回限りのタスクを `instructions` にコピーすること、マニフェストに含めるべき長い参考資料を埋め込むこと、組み込み機能がすでに注入するツールドキュメントを繰り返すこと、モデルが実行時に必要としないローカルインストールの注意事項を混在させることは避けてください。

`instructions` を省略しても、SDK にはデフォルトのサンドボックスプロンプトが含まれます。低レベルのラッパーにはそれで十分ですが、ユーザー向けエージェントの大半では、引き続き明示的な `instructions` を指定する必要があります。

### `capabilities`

機能は、サンドボックスネイティブの動作を `SandboxAgent` に関連付けます。実行開始前にワークスペースを構成し、サンドボックス固有の instructions を追加し、稼働中のサンドボックスセッションにバインドされるツールを公開し、そのエージェントのモデル動作や入力処理を調整できます。

組み込み機能には次のものがあります。

<div class="sandbox-nowrap-first-column-table" markdown="1">

| 機能 | 追加する場合 | 注記 |
| --- | --- | --- |
| `Shell` | エージェントがシェルアクセスを必要とする場合。 | `exec_command` を追加し、サンドボックスクライアントが PTY 対話をサポートする場合は `write_stdin` も追加します。 |
| `Filesystem` | エージェントがファイルの編集やローカル画像の調査を必要とする場合。 | `apply_patch` と `view_image` を追加します。パッチパスはワークスペースルート相対です。 |
| `Skills` | サンドボックス内でスキルを検出し、実体化する場合。 | `.agents` や `.agents/skills` を手動でマウントするよりも、こちらを推奨します。`Skills` がスキルのインデックスを作成し、サンドボックス内に実体化します。 |
| `Memory` | 後続の実行でメモリ成果物を読み取る、または生成する場合。 | `Shell` が必要です。実行中にメモリ成果物を更新する場合は、`Filesystem` も必要です。 |
| `Compaction` | 長時間実行されるフローで、コンパクション項目の後にコンテキストを削減する必要がある場合。 | モデルのサンプリングと入力処理を調整します。 |

</div>

デフォルトでは、`SandboxAgent.capabilities` は `Capabilities.default()` を使用し、これには `Filesystem()`、`Shell()`、`Compaction()` が含まれます。`capabilities=[...]` を渡すと、そのリストがデフォルトを置き換えるため、引き続き必要なデフォルト機能を含めてください。

スキルについては、実体化する方法に応じてソースを選択します。

- `Skills(lazy_from=LocalDirLazySkillSource(...))` は、モデルが最初にインデックスを検出し、必要なものだけを読み込めるため、大規模なローカルスキルディレクトリに適したデフォルトです。
- `LocalDirLazySkillSource(source=LocalDir(src=...))` は、SDK プロセスが実行されているファイルシステムから読み取ります。サンドボックスイメージまたはワークスペース内にしか存在しないパスではなく、元のホスト側スキルディレクトリを渡してください。
- `Skills(from_=LocalDir(src=...))` は、事前にステージングする小規模なローカルバンドルに適しています。
- `Skills(from_=GitRepo(repo=..., ref=...))` は、スキル自体をリポジトリから取得する場合に適しています。

`LocalDir.src` は SDK ホスト上のソースパスです。`skills_path` は、`load_skill` が呼び出されたときにスキルがステージングされる、サンドボックスワークスペース内の相対的な宛先パスです。

スキルがすでに `.agents/skills/<name>/SKILL.md` のような場所に保存されている場合は、`LocalDir(...)` にそのソースルートを指定し、引き続き `Skills(...)` を使用して公開します。別のサンドボックス内レイアウトに依存する既存のワークスペース契約がない限り、デフォルトの `skills_path=".agents"` を維持してください。

適合する場合は、組み込み機能を優先してください。組み込み機能では対応できないサンドボックス固有のツールまたは instructions インターフェースが必要な場合にのみ、カスタム機能を作成します。

## 概念

### マニフェスト

[`Manifest`][agents.sandbox.manifest.Manifest] は、新しいサンドボックスセッションのワークスペースを記述します。ワークスペースの `root` の設定、ファイルとディレクトリの宣言、ローカルファイルのコピー、Git リポジトリのクローン、リモートストレージマウントの接続、環境変数の設定、ユーザーまたはグループの定義、ワークスペース外の特定の絶対パスへのアクセス許可を行えます。

マニフェストエントリのパスは、ワークスペース相対です。絶対パスにすることも、`..` を使用してワークスペース外へ移動することもできません。これにより、ローカル、Docker、ホスト型クライアント間でワークスペース契約の移植性が維持されます。

作業開始前にエージェントが必要とする資料には、マニフェストエントリを使用します。

<div class="sandbox-nowrap-first-column-table" markdown="1">

| マニフェストエントリ | 用途 |
| --- | --- |
| `File`、`Dir` | 小規模な合成入力、補助ファイル、または出力ディレクトリ。 |
| `LocalFile`、`LocalDir` | サンドボックス内に実体化するホストのファイルまたはディレクトリ。 |
| `GitRepo` | ワークスペースに取得するリポジトリ。 |
| `S3Mount`、`GCSMount`、`R2Mount`、`AzureBlobMount`、`BoxMount`、`S3FilesMount` などのマウント | サンドボックス内に表示する外部ストレージ。 |

</div>

`Dir` は、合成された子要素から、または出力先として、サンドボックスワークスペース内にディレクトリを作成します。ホストファイルシステムからは読み取りません。既存のホストディレクトリをサンドボックスワークスペースにコピーする場合は、`LocalDir` を使用してください。

デフォルトでは、`LocalFile.src` と `LocalDir.src` は SDK プロセスの作業ディレクトリを基準に解決されます。`extra_path_grants` で許可されていない限り、ソースはそのベースディレクトリ内にある必要があります。これにより、ローカルソースの実体化が、サンドボックスマニフェストの他の部分と同じホストパスの信頼境界内に維持されます。

マウントエントリは公開するストレージを記述し、マウント戦略はサンドボックスバックエンドがそのストレージを接続する方法を記述します。マウントオプションとプロバイダーのサポートについては、[サンドボックスクライアント](clients.md#mounts-and-remote-storage)を参照してください。

適切なマニフェスト設計では通常、ワークスペース契約を限定的に保ち、長いタスク手順を `repo/task.md` などのワークスペースファイルに配置し、instructions 内で `repo/task.md` や `output/report.md` などのワークスペース相対パスを使用します。エージェントが `Filesystem` 機能の `apply_patch` ツールを使用してファイルを編集する場合、パッチパスはシェルの `workdir` ではなく、サンドボックスワークスペースルートからの相対パスであることに注意してください。

エージェントがワークスペース外の具体的な絶対パスを必要とする場合、または SDK プロセスの作業ディレクトリ外にある信頼済みローカルソースをマニフェストでコピーする必要がある場合にのみ、`extra_path_grants` を使用します。たとえば、一時的なツール出力用の `/tmp`、読み取り専用ランタイム用の `/opt/toolchain`、サンドボックス内に実体化する生成済みスキルディレクトリなどです。許可は、ローカルソースの実体化と SDK ファイル API に適用されます。また、バックエンドがファイルシステムポリシーを適用できる場合は、シェル実行にも適用されます。

```python
from agents.sandbox import Manifest, SandboxPathGrant

manifest = Manifest(
    extra_path_grants=(
        SandboxPathGrant(path="/tmp"),
        SandboxPathGrant(path="/opt/toolchain", read_only=True),
    ),
)
```

Docker が別の絶対ホストパスを、コンテナ内の絶対 POSIX `path` にバインドマウントする必要がある場合は、`host_path` を設定します。`UnixLocalSandboxClient` は両方のパスが同じであるパスのみの許可をサポートし、`host_path` は拒否します。サンドボックスで変更してはならないホストデータには `read_only=True` を使用し、コピーで十分な場合は `LocalFile` または `LocalDir` を使用します。

`extra_path_grants` を含むマニフェストは、信頼済みの設定として扱ってください。アプリケーションがそれらのホストパスをすでに承認していない限り、モデル出力やその他の信頼できないペイロードから許可を読み込まないでください。

スナップショットと `persist_workspace()` に含まれるのは、引き続きワークスペースルートのみです。追加で許可されたパスはランタイムアクセスであり、永続的なワークスペース状態ではありません。

### 権限

`Permissions` は、マニフェストエントリのファイルシステム権限を制御します。これは、サンドボックスが実体化するファイルに関するものであり、モデルの権限、承認ポリシー、API 認証情報に関するものではありません。

デフォルトでは、マニフェストエントリは所有者が読み取り、書き込み、実行でき、グループとその他のユーザーが読み取り、実行できます。ステージングされたファイルを非公開、読み取り専用、または実行可能にする必要がある場合は、これをオーバーライドします。

```python
from agents.sandbox import FileMode, Permissions
from agents.sandbox.entries import File

private_notes = File(
    content=b"internal notes",
    permissions=Permissions(
        owner=FileMode.READ | FileMode.WRITE,
        group=FileMode.NONE,
        other=FileMode.NONE,
    ),
)
```

`Permissions` は、所有者、グループ、その他のユーザーの各ビットと、そのエントリがディレクトリであるかどうかを個別に保存します。直接構築するか、`Permissions.from_str(...)` でモード文字列から解析するか、`Permissions.from_mode(...)` で OS モードから取得できます。

ユーザーは、作業を実行できるサンドボックス ID です。その ID をサンドボックス内に存在させる場合は、マニフェストに `User` を追加します。シェルコマンド、ファイル読み取り、パッチなどのモデル向けサンドボックスツールをそのユーザーとして実行する場合は、`SandboxAgent.run_as` を設定します。`run_as` がマニフェストにまだ存在しないユーザーを指す場合、ランナーがそのユーザーを有効なマニフェストに追加します。

```python
from agents import Runner
from agents.run import RunConfig
from agents.sandbox import FileMode, Manifest, Permissions, SandboxAgent, SandboxRunConfig, User
from agents.sandbox.entries import Dir, LocalDir
from agents.sandbox.sandboxes.unix_local import UnixLocalSandboxClient

analyst = User(name="analyst")

agent = SandboxAgent(
    name="Dataroom analyst",
    instructions="Review the files in `dataroom/` and write findings to `output/`.",
    default_manifest=Manifest(
        # Declare the sandbox user so manifest entries can grant access to it.
        users=[analyst],
        entries={
            "dataroom": LocalDir(
                src="./dataroom",
                # Let the analyst traverse and read the mounted dataroom, but not edit it.
                group=analyst,
                permissions=Permissions(
                    owner=FileMode.READ | FileMode.EXEC,
                    group=FileMode.READ | FileMode.EXEC,
                    other=FileMode.NONE,
                ),
            ),
            "output": Dir(
                # Give the analyst a writable scratch/output directory for artifacts.
                group=analyst,
                permissions=Permissions(
                    owner=FileMode.ALL,
                    group=FileMode.ALL,
                    other=FileMode.NONE,
                ),
            ),
        },
    ),
    # Run model-facing sandbox actions as this user, so those permissions apply.
    run_as=analyst,
)

result = await Runner.run(
    agent,
    "Summarize the contracts and call out renewal dates.",
    run_config=RunConfig(
        sandbox=SandboxRunConfig(client=UnixLocalSandboxClient()),
    ),
)
```

ファイル単位の共有ルールも必要な場合は、ユーザーをマニフェストのグループおよびエントリの `group` メタデータと組み合わせます。`run_as` のユーザーはサンドボックスネイティブのアクションを実行するユーザーを制御し、`Permissions` は、サンドボックスがワークスペースを実体化した後、そのユーザーが読み取り、書き込み、実行できるファイルを制御します。

### SnapshotSpec

`SnapshotSpec` は、新しいサンドボックスセッションに対して、保存済みワークスペースコンテンツの復元元と保存先を指定します。これはサンドボックスワークスペースのスナップショットポリシーであり、`session_state` は特定のサンドボックスバックエンドを再開するためのシリアライズ済み接続状態です。

ローカルの永続的なスナップショットには `LocalSnapshotSpec` を使用し、アプリケーションがリモートスナップショットクライアントを提供する場合は `RemoteSnapshotSpec` を使用します。ローカルスナップショットを設定できない場合は、フォールバックとして何もしないスナップショットが使用されます。高度な呼び出し元は、ワークスペーススナップショットの永続化が不要な場合に、これを明示的に使用できます。

```python
from pathlib import Path

from agents.run import RunConfig
from agents.sandbox import LocalSnapshotSpec, SandboxRunConfig
from agents.sandbox.sandboxes.unix_local import UnixLocalSandboxClient

run_config = RunConfig(
    sandbox=SandboxRunConfig(
        client=UnixLocalSandboxClient(),
        snapshot=LocalSnapshotSpec(base_path=Path("/tmp/my-sandbox-snapshots")),
    )
)
```

ランナーが新しいサンドボックスセッションを作成すると、サンドボックスクライアントはそのセッション用のスナップショットインスタンスを構築します。開始時にスナップショットを復元できる場合、サンドボックスは実行を続行する前に保存済みワークスペースコンテンツを復元します。クリーンアップ時には、ランナー所有のサンドボックスセッションがワークスペースをアーカイブし、スナップショットを介して再度永続化します。

`snapshot` を省略すると、ランタイムは可能な場合にデフォルトのローカルスナップショット場所を使用しようとします。設定できない場合は、何もしないスナップショットにフォールバックします。マウントされたパスと一時的なパスは、永続的なワークスペースコンテンツとしてスナップショットにコピーされません。

### サンドボックスのライフサイクル

ライフサイクルには、 **SDK 所有** と **開発者所有** の 2 つのモードがあります。

<div class="sandbox-lifecycle-diagram" markdown="1">

```mermaid
sequenceDiagram
    participant App
    participant Runner
    participant Client
    participant Sandbox

    App->>Runner: Runner.run(..., SandboxRunConfig(client=...))
    Runner->>Client: create or resume sandbox
    Client-->>Runner: sandbox session
    Runner->>Sandbox: start, run tools
    Runner->>Sandbox: stop and persist snapshot
    Runner->>Client: delete runner-owned resources

    App->>Client: create(...)
    Client-->>App: sandbox session
    App->>Sandbox: async with sandbox
    App->>Runner: Runner.run(..., SandboxRunConfig(session=sandbox))
    Runner->>Sandbox: run tools
    App->>Sandbox: cleanup on context exit / aclose()
```

</div>

サンドボックスが 1 回の実行中のみ存在すればよい場合は、SDK 所有のライフサイクルを使用します。`client`、必要に応じて `manifest` と `snapshot`、および必要なクライアントの `options` を渡します。ランナーはサンドボックスを作成または再開して開始し、エージェントを実行し、スナップショットベースのワークスペース状態を永続化し、サンドボックスセッションを終了して、ランナー所有のリソースをクライアントにクリーンアップさせます。

```python
result = await Runner.run(
    agent,
    "Inspect the workspace and summarize what changed.",
    run_config=RunConfig(
        sandbox=SandboxRunConfig(client=UnixLocalSandboxClient()),
    ),
)
```

サンドボックスを事前に作成する、1 つの稼働中サンドボックスを複数の実行で再利用する、実行後にファイルを調査する、自分で作成したサンドボックス上でストリーミングする、クリーンアップの正確なタイミングを決定する場合は、開発者所有のライフサイクルを使用します。`session=...` を渡すと、ランナーはその稼働中サンドボックスを使用しますが、代わりに閉じることはありません。

```python
sandbox = await client.create(manifest=agent.default_manifest)

async with sandbox:
    run_config = RunConfig(sandbox=SandboxRunConfig(session=sandbox))
    await Runner.run(agent, "Analyze the files.", run_config=run_config)
    await Runner.run(agent, "Write the final report.", run_config=run_config)
```

通常はコンテキストマネージャーを使用します。開始時にサンドボックスを起動し、終了時にセッションのクリーンアップライフサイクルを実行します。アプリケーションでコンテキストマネージャーを使用できない場合は、ライフサイクルメソッドを直接呼び出します。

```python
sandbox = await client.create(
    manifest=agent.default_manifest,
    snapshot=LocalSnapshotSpec(base_path=Path("/tmp/my-sandbox-snapshots")),
)
try:
    await sandbox.start()
    await Runner.run(
        agent,
        "Analyze the files.",
        run_config=RunConfig(sandbox=SandboxRunConfig(session=sandbox)),
    )
    # Persist a checkpoint of the live workspace before doing more work.
    # `aclose()` also calls `stop()`, so this is only needed for an explicit mid-lifecycle save.
    await sandbox.stop()
finally:
    await sandbox.aclose()
```

`stop()` は、スナップショットベースのワークスペースコンテンツを永続化するだけで、サンドボックスを終了しません。`aclose()` は完全なセッションクリーンアップ処理です。停止前フックを実行し、`stop()` を呼び出し、サンドボックスリソースをシャットダウンし、セッションスコープの依存関係を閉じます。

## `SandboxRunConfig` のオプション

[`SandboxRunConfig`][agents.run_config.SandboxRunConfig] は、サンドボックスセッションの取得元と、新しいセッションの初期化方法を決定する実行ごとのオプションを保持します。

### サンドボックスのソース

次のオプションは、ランナーがサンドボックスセッションを再利用、再開、または作成するかどうかを決定します。

<div class="sandbox-nowrap-first-column-table" markdown="1">

| オプション | 使用する場合 | 注記 |
| --- | --- | --- |
| `client` | ランナーにサンドボックスセッションの作成、再開、クリーンアップを任せる場合。 | 稼働中のサンドボックス `session` を指定しない限り必須です。 |
| `session` | 稼働中のサンドボックスセッションをすでに自分で作成している場合。 | 呼び出し元がライフサイクルを所有し、ランナーはその稼働中サンドボックスセッションを再利用します。 |
| `session_state` | シリアライズ済みのサンドボックスセッション状態はあるものの、稼働中のサンドボックスセッションオブジェクトがない場合。 | `client` が必要です。ランナーはその明示的な状態から再開し、再開されたセッションのライフサイクルを所有します。 |

</div>

実際には、ランナーは次の順序でサンドボックスセッションを解決します。

1. `run_config.sandbox.session` を注入すると、その稼働中のサンドボックスセッションを直接再利用します。
2. それ以外で、実行が `RunState` から再開される場合は、保存されているサンドボックスセッション状態を再開します。
3. それ以外で、`run_config.sandbox.session_state` を渡した場合は、その明示的なシリアライズ済みサンドボックスセッション状態から再開します。
4. それ以外の場合、ランナーは新しいサンドボックスセッションを作成します。その新規セッションでは、`run_config.sandbox.manifest` が指定されていればそれを使用し、指定されていなければ `agent.default_manifest` を使用します。

### 新規セッションの入力

次のオプションは、ランナーが新しいサンドボックスセッションを作成する場合にのみ適用されます。

<div class="sandbox-nowrap-first-column-table" markdown="1">

| オプション | 使用する場合 | 注記 |
| --- | --- | --- |
| `manifest` | 新規セッションのワークスペースを 1 回限りでオーバーライドする場合。 | 省略すると `agent.default_manifest` にフォールバックします。 |
| `snapshot` | 新しいサンドボックスセッションをスナップショットから初期化する場合。 | 再開に似たフローやリモートスナップショットクライアントに便利です。 |
| `options` | サンドボックスクライアントが作成時のオプションを必要とする場合。 | Docker イメージ、Modal アプリ名、E2B テンプレート、タイムアウト、および同様のクライアント固有設定で一般的です。 |

</div>

### 実体化の制御

`concurrency_limits` は、並列で実行できるサンドボックス実体化処理の量を制御します。大規模なマニフェストやローカルディレクトリのコピーで、より厳密なリソース制御が必要な場合は、`SandboxConcurrencyLimits(manifest_entries=..., local_dir_files=...)` を使用します。いずれかの値を `None` に設定すると、その制限のみが無効になります。

`archive_limits` は、アーカイブ抽出に対する SDK 側のリソースチェックを制御します。SDK のデフォルトしきい値を有効にするには `archive_limits=SandboxArchiveLimits()` を設定し、アーカイブにより厳密なリソース制御が必要な場合は `SandboxArchiveLimits(max_input_bytes=..., max_extracted_bytes=..., max_members=...)` などの明示的な値を渡します。SDK のアーカイブリソース制限がないデフォルト動作を維持するには `archive_limits=None` のままにし、個別の制限のみを無効にするには、そのフィールドを `None` に設定します。

次の点に注意してください。

- 新規セッション: `manifest=` と `snapshot=` は、ランナーが新しいサンドボックスセッションを作成する場合にのみ適用されます。
- 再開とスナップショット: `session_state=` は以前にシリアライズされたサンドボックス状態に再接続しますが、`snapshot=` は保存済みワークスペースコンテンツから新しいサンドボックスセッションを初期化します。
- クライアント固有オプション: `options=` はサンドボックスクライアントに依存します。Docker と多くのホスト型クライアントでは必須です。
- 注入された稼働中セッション: 稼働中のサンドボックス `session` を渡した場合、機能によるマニフェスト更新で、互換性のあるマウント以外のエントリを追加できます。ただし、`manifest.root`、`manifest.environment`、`manifest.users`、`manifest.groups` の変更、既存エントリの削除、エントリタイプの置き換え、マウントエントリの追加または変更はできません。
- ランナー API: `SandboxAgent` の実行でも、通常の `Runner.run()`、`Runner.run_sync()`、`Runner.run_streamed()` API を使用します。

## 完全なコード例：コーディングタスク

次のコーディング形式のコード例は、デフォルトの出発点として適しています。

```python
import asyncio
from pathlib import Path

from agents import ModelSettings, Runner
from agents.run import RunConfig
from agents.sandbox import Manifest, SandboxAgent, SandboxRunConfig
from agents.sandbox.capabilities import (
    Capabilities,
    LocalDirLazySkillSource,
    Skills,
)
from agents.sandbox.entries import LocalDir
from agents.sandbox.sandboxes.unix_local import UnixLocalSandboxClient

EXAMPLE_DIR = Path(__file__).resolve().parent
HOST_REPO_DIR = EXAMPLE_DIR / "repo"
HOST_SKILLS_DIR = EXAMPLE_DIR / "skills"
TARGET_TEST_CMD = "sh tests/test_credit_note.sh"


def build_agent(model: str) -> SandboxAgent[None]:
    return SandboxAgent(
        name="Sandbox engineer",
        model=model,
        instructions=(
            "Inspect the repo, make the smallest correct change, run the most relevant checks, "
            "and summarize the file changes and risks. "
            "Read `repo/task.md` before editing files. Stay grounded in the repository, preserve "
            "existing behavior, and mention the exact verification command you ran. "
            "Use the `$credit-note-fixer` skill before editing files. If the repo lives under "
            "`repo/`, remember that `apply_patch` paths stay relative to the sandbox workspace "
            "root, so edits still target `repo/...`."
        ),
        # Put repos and task files in the manifest.
        default_manifest=Manifest(
            entries={
                "repo": LocalDir(src=HOST_REPO_DIR),
            }
        ),
        capabilities=Capabilities.default() + [
            Skills(
                lazy_from=LocalDirLazySkillSource(
                    # This is a host path read by the SDK process.
                    # Requested skills are copied into `skills_path` in the sandbox.
                    source=LocalDir(src=HOST_SKILLS_DIR),
                )
            ),
        ],
        model_settings=ModelSettings(tool_choice="required"),
    )


async def main(model: str, prompt: str) -> None:
    result = await Runner.run(
        build_agent(model),
        prompt,
        run_config=RunConfig(
            sandbox=SandboxRunConfig(client=UnixLocalSandboxClient()),
            workflow_name="Sandbox coding example",
        ),
    )
    print(result.final_output)


if __name__ == "__main__":
    asyncio.run(
        main(
            model="gpt-5.6-sol",
            prompt=(
                "Open `repo/task.md`, use the `$credit-note-fixer` skill, fix the bug, "
                f"run `{TARGET_TEST_CMD}`, and summarize the change."
            ),
        )
    )
```

[examples/sandbox/docs/coding_task.py](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/docs/coding_task.py) を参照してください。このコード例では、Unix ローカル実行間で決定論的に検証できるように、小規模なシェルベースのリポジトリを使用しています。実際のタスクリポジトリには、もちろん Python、JavaScript、その他任意のものを使用できます。

## 一般的なパターン

上記の完全なコード例から始めてください。多くの場合、同じ `SandboxAgent` を維持したまま、サンドボックスクライアント、サンドボックスセッションのソース、またはワークスペースのソースだけを変更できます。

### サンドボックスクライアントの切り替え

エージェント定義を変えずに、実行設定のみを変更します。コンテナ分離やイメージの同等性が必要な場合は Docker を、プロバイダー管理の実行が必要な場合はホスト型プロバイダーを使用します。コード例とプロバイダーのオプションについては、[サンドボックスクライアント](clients.md)を参照してください。

### ワークスペースのオーバーライド

エージェント定義を変えずに、新規セッションのマニフェストのみを入れ替えます。

```python
from agents.run import RunConfig
from agents.sandbox import Manifest, SandboxRunConfig
from agents.sandbox.entries import GitRepo
from agents.sandbox.sandboxes.unix_local import UnixLocalSandboxClient

run_config = RunConfig(
    sandbox=SandboxRunConfig(
        client=UnixLocalSandboxClient(),
        manifest=Manifest(
            entries={
                "repo": GitRepo(repo="openai/openai-agents-python", ref="main"),
            }
        ),
    ),
)
```

エージェントを再構築せずに、同じエージェントの役割を異なるリポジトリ、資料、またはタスクバンドルに対して実行する場合に使用します。上記の検証済みコーディングコード例では、1 回限りのオーバーライドではなく `default_manifest` を使用して、同じパターンを示しています。

### サンドボックスセッションの注入

ライフサイクルの明示的な制御、実行後の調査、または出力のコピーが必要な場合は、稼働中のサンドボックスセッションを注入します。

```python
from agents import Runner
from agents.run import RunConfig
from agents.sandbox import SandboxRunConfig
from agents.sandbox.sandboxes.unix_local import UnixLocalSandboxClient

client = UnixLocalSandboxClient()
sandbox = await client.create(manifest=agent.default_manifest)

async with sandbox:
    result = await Runner.run(
        agent,
        prompt,
        run_config=RunConfig(
            sandbox=SandboxRunConfig(session=sandbox),
        ),
    )
```

実行後にワークスペースを調査する場合や、すでに開始済みのサンドボックスセッション上でストリーミングする場合に使用します。[examples/sandbox/docs/coding_task.py](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/docs/coding_task.py) と [examples/sandbox/docker/docker_runner.py](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/docker/docker_runner.py) を参照してください。

### セッション状態からの再開

`RunState` の外部ですでにサンドボックス状態をシリアライズしている場合は、その状態からランナーを再接続します。

```python
from agents.run import RunConfig
from agents.sandbox import SandboxRunConfig

serialized = load_saved_payload()
restored_state = client.deserialize_session_state(serialized)

run_config = RunConfig(
    sandbox=SandboxRunConfig(
        client=client,
        session_state=restored_state,
    ),
)
```

サンドボックス状態を独自のストレージやジョブシステムに保存し、`Runner` でそこから直接再開する場合に使用します。シリアライズとデシリアライズのフローについては、[examples/sandbox/extensions/blaxel_runner.py](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/extensions/blaxel_runner.py) を参照してください。

セッション状態のシリアライズでは、ネイティブの `host_path` 値が省略されます。ホストベースの許可を再開するには、現在の信頼済みマニフェストを `SandboxRunConfig.manifest` または `agent.default_manifest` から指定してください。指定しない場合、サンドボックスの開始前に再開が失敗します。シリアライズ済み入力やその他の信頼できない入力からホストパスを生成しないでください。

セッション状態と `RunState` のシリアライズでは、クラウドマウントの認証情報、認証情報を含む補助設定、コンテナ内での認証情報公開に対する確認も削除されます。マウント済みセッションの再開をサポートするバックエンドでは、状態に秘匿化されたマウント権限が含まれる場合、現在の信頼済みマニフェストを `SandboxRunConfig.manifest` または `agent.default_manifest` から指定してください。`"data"` という名前のマウントエントリにマウントスコープの確認が必要な場合は、再開前に `trusted_manifest = trusted_manifest.with_in_container_mount_credential_exposure_acknowledged("data")` を使用して、コピーされたマニフェストを保持します。広範な権限には `trusted_manifest = trusted_manifest.with_in_container_mount_broad_credential_exposure_acknowledged("data")` を使用し、マウントで両方の権限クラスを使用する場合は両方のメソッドを呼び出します。確認が必要な正確なマウントパスをすべて渡してください。Agents SDKは、現在の信頼済みマニフェストの認証情報を除いたマウントトポロジーが、永続化された状態と完全に一致する場合にのみ認証情報を復元します。信頼済み設定が不足している、または一致しない場合、サンドボックスの開始前に再開が失敗します。シリアライズ済み状態だけで権限が付与されることはありません。`VercelSandboxClient` はマウント済みセッションを再開できないため、代わりに信頼済みマニフェストを使用して新しいサンドボックスを開始してください。

### スナップショットからの開始

保存済みのファイルと成果物から新しいサンドボックスを初期化します。

```python
from pathlib import Path

from agents.run import RunConfig
from agents.sandbox import LocalSnapshotSpec, SandboxRunConfig
from agents.sandbox.sandboxes.unix_local import UnixLocalSandboxClient

run_config = RunConfig(
    sandbox=SandboxRunConfig(
        client=UnixLocalSandboxClient(),
        snapshot=LocalSnapshotSpec(base_path=Path("/tmp/my-sandbox-snapshot")),
    ),
)
```

新しいサンドボックスセッションを作成する実行で、`agent.default_manifest` だけでなく、保存済みワークスペースコンテンツから開始する場合に使用します。ローカルスナップショットのフローについては [examples/sandbox/memory.py](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/memory.py) を、リモートスナップショットクライアントについては [examples/sandbox/sandbox_agent_with_remote_snapshot.py](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/sandbox_agent_with_remote_snapshot.py) を参照してください。

### Git からのスキル読み込み

ローカルのスキルソースを、リポジトリベースのソースに置き換えます。

```python
from agents.sandbox.capabilities import Capabilities, Skills
from agents.sandbox.entries import GitRepo

capabilities = Capabilities.default() + [
    Skills(from_=GitRepo(repo="sdcoffey/tax-prep-skills", ref="main")),
]
```

スキルバンドルに独自のリリースサイクルがある場合や、複数のサンドボックスで共有する場合に使用します。[examples/sandbox/tax_prep.py](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/tax_prep.py) を参照してください。

### ツールとしての公開

ツールエージェントには、独自のサンドボックス境界を割り当てることも、親実行の稼働中サンドボックスを再利用させることもできます。再利用は、高速な読み取り専用エクスプローラーエージェントに便利です。別のサンドボックスの作成、ハイドレーション、スナップショット作成のコストをかけずに、親実行が使用しているワークスペースそのものを調査できます。

```python
from agents import Runner
from agents.run import RunConfig
from agents.sandbox import FileMode, Manifest, Permissions, SandboxAgent, SandboxRunConfig, User
from agents.sandbox.entries import Dir, File
from agents.sandbox.sandboxes.unix_local import UnixLocalSandboxClient

coordinator = User(name="coordinator")
explorer = User(name="explorer")

manifest = Manifest(
    users=[coordinator, explorer],
    entries={
        "pricing_packet": Dir(
            group=coordinator,
            permissions=Permissions(
                owner=FileMode.ALL,
                group=FileMode.ALL,
                other=FileMode.READ | FileMode.EXEC,
                directory=True,
            ),
            children={
                "pricing.md": File(
                    content=b"Pricing packet contents...",
                    group=coordinator,
                    permissions=Permissions(
                        owner=FileMode.ALL,
                        group=FileMode.ALL,
                        other=FileMode.READ,
                    ),
                ),
            },
        ),
        "work": Dir(
            group=coordinator,
            permissions=Permissions(
                owner=FileMode.ALL,
                group=FileMode.ALL,
                other=FileMode.NONE,
                directory=True,
            ),
        ),
    },
)

pricing_explorer = SandboxAgent(
    name="Pricing Explorer",
    instructions="Read `pricing_packet/` and summarize commercial risk. Do not edit files.",
    run_as=explorer,
)

client = UnixLocalSandboxClient()
sandbox = await client.create(manifest=manifest)

async with sandbox:
    shared_run_config = RunConfig(
        sandbox=SandboxRunConfig(session=sandbox),
    )

    orchestrator = SandboxAgent(
        name="Revenue Operations Coordinator",
        instructions="Coordinate the review and write final notes to `work/`.",
        run_as=coordinator,
        tools=[
            pricing_explorer.as_tool(
                tool_name="review_pricing_packet",
                tool_description="Inspect the pricing packet and summarize commercial risk.",
                run_config=shared_run_config,
                max_turns=2,
            ),
        ],
    )

    result = await Runner.run(
        orchestrator,
        "Review the pricing packet, then write final notes to `work/summary.md`.",
        run_config=shared_run_config,
    )
```

ここでは、親エージェントが同じ稼働中サンドボックスセッション内で `coordinator` として実行され、エクスプローラーツールエージェントが `explorer` として実行されます。`pricing_packet/` エントリは `other` ユーザーが読み取り可能なため、エクスプローラーはすばやく調査できますが、書き込みビットはありません。`work/` ディレクトリはコーディネーターのユーザーまたはグループのみが使用できるため、エクスプローラーを読み取り専用に維持したまま、親が最終成果物を書き込めます。

ツールエージェントに実際の分離が必要な場合は、独自のサンドボックス `RunConfig` を割り当てます。

```python
from docker import from_env as docker_from_env

from agents.run import RunConfig
from agents.sandbox import SandboxAgent, SandboxRunConfig
from agents.sandbox.sandboxes.docker import DockerSandboxClient, DockerSandboxClientOptions

rollout_agent = SandboxAgent(
    name="Rollout Reviewer",
    instructions="Inspect the rollout packet and summarize implementation risk.",
)

rollout_agent.as_tool(
    tool_name="review_rollout_risk",
    tool_description="Inspect the rollout packet and summarize implementation risk.",
    run_config=RunConfig(
        sandbox=SandboxRunConfig(
            client=DockerSandboxClient(docker_from_env()),
            options=DockerSandboxClientOptions(image="python:3.14-slim"),
        ),
    ),
)
```

ツールエージェントが自由に変更を加える、信頼できないコマンドを実行する、または別のバックエンドやイメージを使用する場合は、別のサンドボックスを使用します。[examples/sandbox/sandbox_agents_as_tools.py](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/sandbox_agents_as_tools.py) を参照してください。

### ローカルツールおよび MCP との組み合わせ

サンドボックスワークスペースを維持したまま、同じエージェントで通常のツールも使用します。

```python
from agents.sandbox import SandboxAgent
from agents.sandbox.capabilities import Shell

agent = SandboxAgent(
    name="Workspace reviewer",
    instructions="Inspect the workspace and call host tools when needed.",
    tools=[get_discount_approval_path],
    mcp_servers=[server],
    capabilities=[Shell()],
)
```

ワークスペースの調査がエージェントの作業の一部にすぎない場合に使用します。[examples/sandbox/sandbox_agent_with_tools.py](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/sandbox_agent_with_tools.py) を参照してください。

## メモリ

将来のサンドボックスエージェント実行で、以前の実行から学習させる場合は、`Memory` 機能を使用します。メモリは、SDK の会話用 `Session` メモリとは別のものです。学習内容をサンドボックスワークスペース内のファイルに抽出し、後続の実行でそれらのファイルを読み取れるようにします。

セットアップ、読み取りと生成の動作、複数ターンの会話、レイアウトの分離については、[エージェントメモリ](memory.md)を参照してください。

## 構成パターン

単一エージェントのパターンを理解したら、次に検討すべき設計上の問いは、より大きなシステムのどこにサンドボックス境界を配置するかです。

サンドボックスエージェントは、引き続き SDK の他の機能と組み合わせられます。

- [ハンドオフ](../handoffs.md): ドキュメント量の多い作業を、サンドボックスを使用しない受付エージェントからサンドボックスレビュー担当エージェントへハンドオフします。
- [Agents as tools](../tools.md#agents-as-tools): 複数のサンドボックスエージェントをツールとして公開します。通常は各 `Agent.as_tool(...)` 呼び出しで `run_config=RunConfig(sandbox=SandboxRunConfig(...))` を渡し、各ツールに独自のサンドボックス境界を割り当てます。
- [MCP](../mcp.md) と通常の関数ツール: サンドボックス機能は、`mcp_servers` および通常の Python ツールと共存できます。
- [エージェントの実行](../running_agents.md): サンドボックス実行でも、通常の `Runner` API を使用します。

特に一般的なのは、次の 2 つのパターンです。

- ワークスペースの分離が必要なワークフロー部分に限り、サンドボックスを使用しないエージェントからサンドボックスエージェントへハンドオフする
- オーケストレーターが複数のサンドボックスエージェントをツールとして公開し、通常は `Agent.as_tool(...)` 呼び出しごとに個別のサンドボックス `RunConfig` を割り当て、各ツールに独自の分離されたワークスペースを提供する

### ターンとサンドボックス実行

ハンドオフと Agents-as-tools の呼び出しは、分けて説明すると理解しやすくなります。

ハンドオフでは、トップレベルの実行とトップレベルのターンループは 1 つのままです。アクティブなエージェントは変わりますが、実行がネストされることはありません。サンドボックスを使用しない受付エージェントがサンドボックスレビュー担当エージェントにハンドオフすると、同じ実行内の次のモデル呼び出しがサンドボックスエージェント向けに準備され、そのサンドボックスエージェントが次のターンを担当します。つまり、ハンドオフは、同じ実行の次のターンを担当するエージェントを変更します。[examples/sandbox/handoffs.py](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/handoffs.py) を参照してください。

`Agent.as_tool(...)` では、関係が異なります。外側のオーケストレーターは、ツールを呼び出すことを決定するために外側のターンを 1 つ使用し、そのツール呼び出しによってサンドボックスエージェントのネストされた実行が開始されます。ネストされた実行には、独自のターンループ、`max_turns`、承認、通常は独自のサンドボックス `RunConfig` があります。ネストされた 1 ターンで完了する場合もあれば、複数ターンを要する場合もあります。外側のオーケストレーターから見ると、そのすべての処理は 1 回のツール呼び出しの背後で行われるため、ネストされたターンによって外側の実行のターンカウンターが増えることはありません。[examples/sandbox/sandbox_agents_as_tools.py](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/sandbox_agents_as_tools.py) を参照してください。

承認の動作も同じ区分に従います。

- ハンドオフでは、サンドボックスエージェントがその実行のアクティブなエージェントになるため、承認は同じトップレベルの実行に維持されます
- `Agent.as_tool(...)` では、サンドボックスツールエージェント内で発生した承認も外側の実行に提示されますが、保存されたネスト済み実行状態から取得され、外側の実行が再開されるとネストされたサンドボックス実行も再開されます

## 関連資料

- [クイックスタート](../sandbox_agents.md): サンドボックスエージェントを 1 つ実行します。
- [サンドボックスクライアント](clients.md): ローカル、Docker、ホスト型、マウントの各オプションを選択します。
- [エージェントメモリ](memory.md): 以前のサンドボックス実行で得られた学習内容を保持し、再利用します。
- [examples/sandbox/](https://github.com/openai/openai-agents-python/tree/main/examples/sandbox): 実行可能なローカル、コーディング、メモリ、ハンドオフ、エージェント構成の各パターンです。