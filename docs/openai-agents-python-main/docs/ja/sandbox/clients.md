---
search:
  exclude: true
---
# サンドボックスクライアント

このページでは、サンドボックスでの作業を実行する場所を選択します。ほとんどの場合、`SandboxAgent` の定義はそのままで、[`SandboxRunConfig`][agents.run_config.SandboxRunConfig] 内のサンドボックスクライアントとクライアント固有のオプションのみを変更します。

!!! warning "ベータ機能"

    サンドボックスエージェントはベータ版です。一般提供までに API の詳細、デフォルト、サポート対象の機能が変更される可能性があり、今後さらに高度な機能が追加される予定です。

## 選択ガイド

<div class="sandbox-nowrap-first-column-table" markdown="1">

| 目的 | 最初の選択肢 | 理由 |
| --- | --- | --- |
| macOS または Linux で最速のローカル反復開発 | `UnixLocalSandboxClient` | 追加インストールが不要で、ローカルファイルシステムを使った開発が簡単です。 |
| 基本的なコンテナ分離 | `DockerSandboxClient` | 特定のイメージを使用して Docker 内で作業を実行します。 |
| ホステッド実行または本番環境相当の分離 | ホステッドサンドボックスクライアント | ワークスペースの境界をプロバイダー管理の環境に移します。 |

</div>

## ローカルクライアント

ほとんどのユーザーは、次の 2 つのサンドボックスクライアントのいずれかから始めることをおすすめします。

<div class="sandbox-nowrap-first-column-table" markdown="1">

| クライアント | インストール | 適している場合 | 例 |
| --- | --- | --- | --- |
| `UnixLocalSandboxClient` | なし | macOS または Linux で最速のローカル反復開発を行う場合。ローカル開発の優れたデフォルトです。 | [Unix ローカルのスターター](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/unix_local_runner.py) |
| `DockerSandboxClient` | `openai-agents[docker]` | コンテナ分離が必要な場合、または特定のイメージを使用して対象環境をローカルで再現する場合。 | [Docker スターター](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/docker/docker_runner.py) |

</div>

Unix-local は、ローカルファイルシステムを対象に開発を始める最も簡単な方法です。より強力な環境分離や本番環境相当の一貫性が必要になったら、Docker またはホステッドプロバイダーに移行してください。

`SandboxPathGrant.host_path` は Docker 専用で、ホストのパスをコンテナ内の別の POSIX パスにマッピングします。Unix-local では、同一パスへの許可のみがサポートされます。詳細については、[マニフェストのパス許可](guide.md#manifest)を参照してください。

Unix-local から Docker に切り替えるには、エージェント定義はそのままにして、実行設定のみを変更します。

```python
from docker import from_env as docker_from_env

from agents.run import RunConfig
from agents.sandbox import SandboxRunConfig
from agents.sandbox.sandboxes.docker import DockerSandboxClient, DockerSandboxClientOptions

run_config = RunConfig(
    sandbox=SandboxRunConfig(
        client=DockerSandboxClient(docker_from_env()),
        options=DockerSandboxClientOptions(image="python:3.14-slim"),
    ),
)
```

コンテナ分離が必要な場合や、サンドボックスイメージを別の環境で使用されているイメージと一致させる場合に使用します。[examples/sandbox/docker/docker_runner.py](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/docker/docker_runner.py) を参照してください。

## マウントとリモートストレージ

マウントエントリは公開するストレージを記述し、マウント戦略はサンドボックスバックエンドがそのストレージを接続する方法を記述します。組み込みのマウントエントリと汎用戦略は `agents.sandbox.entries` からインポートします。ホステッドプロバイダー向けの戦略は、`agents.extensions.sandbox` またはプロバイダー固有の拡張パッケージから利用できます。

一般的なマウントオプションは次のとおりです。

- `mount_path`: サンドボックス内でストレージが表示される場所です。相対パスはマニフェストルートを基準に解決され、絶対パスはそのまま使用されます。
- `read_only`: デフォルトは `True` です。サンドボックスからマウントされたストレージへ書き戻す必要がある場合にのみ、`False` を設定します。
- `mount_strategy`: 必須です。マウントエントリとサンドボックスバックエンドの両方に適合する戦略を使用してください。

マウントは、一時的なワークスペースエントリとして扱われます。スナップショットおよび永続化のフローでは、マウントされたリモートストレージを保存済みワークスペースへコピーする代わりに、マウントされたパスを切り離すかスキップします。

汎用のローカル／コンテナ戦略は次のとおりです。

<div class="sandbox-nowrap-first-column-table" markdown="1">

| 戦略またはパターン | 適している場合 | 注記 |
| --- | --- | --- |
| `InContainerMountStrategy(pattern=RcloneMountPattern(...))` | サンドボックスイメージで `rclone` を実行できる場合。 | S3、GCS、R2、Azure Blob、Box をサポートします。`RcloneMountPattern` は `fuse` モードまたは `nfs` モードで実行できます。 |
| `InContainerMountStrategy(pattern=MountpointMountPattern(...))` | イメージに `mount-s3` があり、Mountpoint 形式で S3 または S3 互換ストレージにアクセスする場合。 | `S3Mount` と `GCSMount` をサポートします。 |
| `InContainerMountStrategy(pattern=FuseMountPattern(...))` | イメージに `blobfuse2` と FUSE サポートがある場合。 | `AzureBlobMount` をサポートします。 |
| `InContainerMountStrategy(pattern=S3FilesMountPattern(...))` | イメージに `mount.s3files` があり、既存の S3 Files マウントターゲットへ接続できる場合。 | `S3FilesMount` をサポートします。 |
| `DockerVolumeMountStrategy(driver=...)` | コンテナの起動前に、Docker でボリュームドライバーを利用したマウントを接続する場合。 | Docker 専用です。S3、GCS、R2、Azure Blob、Box は `rclone` を介してマウントできます。また、S3 と GCS は `mountpoint` を介してマウントすることもできます。 |

</div>

## サポート対象のホステッドプラットフォーム

ホステッド環境が必要な場合、通常は同じ `SandboxAgent` 定義をそのまま使用し、[`SandboxRunConfig`][agents.run_config.SandboxRunConfig] 内のサンドボックスクライアントのみを変更します。

このリポジトリのチェックアウトではなく公開版 SDK を使用している場合は、対応するパッケージの extras を使用してサンドボックスクライアントの依存関係をインストールしてください。

プロバイダー固有の設定に関する注記と、リポジトリに含まれる拡張機能のコード例へのリンクについては、[examples/sandbox/extensions/README.md](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/extensions/README.md) を参照してください。

<div class="sandbox-nowrap-first-column-table" markdown="1">

| クライアント | インストール | 例 |
| --- | --- | --- |
| `BlaxelSandboxClient` | `openai-agents[blaxel]` | [Blaxel ランナー](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/extensions/blaxel_runner.py) |
| `CloudflareSandboxClient` | `openai-agents[cloudflare]` | [Cloudflare ランナー](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/extensions/cloudflare_runner.py) |
| `DaytonaSandboxClient` | `openai-agents[daytona]` | [Daytona ランナー](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/extensions/daytona/daytona_runner.py) |
| `E2BSandboxClient` | `openai-agents[e2b]` | [E2B ランナー](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/extensions/e2b_runner.py) |
| `ModalSandboxClient` | `openai-agents[modal]` | [Modal ランナー](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/extensions/modal_runner.py) |
| `RunloopSandboxClient` | `openai-agents[runloop]` | [Runloop ランナー](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/extensions/runloop/runner.py) |
| `VercelSandboxClient` | `openai-agents[vercel]` | [Vercel ランナー](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/extensions/vercel_runner.py) |

</div>

ホステッドサンドボックスクライアントは、プロバイダー固有のマウント戦略を公開します。使用するストレージプロバイダーに最適なバックエンドとマウント戦略を選択してください。

<div class="sandbox-nowrap-first-column-table" markdown="1">

| バックエンド | マウントに関する注記 |
| --- | --- |
| Docker | `InContainerMountStrategy` や `DockerVolumeMountStrategy` などのローカル戦略により、`S3Mount`、`GCSMount`、`R2Mount`、`AzureBlobMount`、`BoxMount`、`S3FilesMount` をサポートします。 |
| `ModalSandboxClient` | `S3Mount`、`R2Mount`、HMAC 認証を使用する `GCSMount` とともに `ModalCloudBucketMountStrategy` を使用することで、クラウドバケットのマウントをサポートします。インライン認証情報または名前付きの Modal Secret を使用できます。 |
| `CloudflareSandboxClient` | `S3Mount`、`R2Mount`、HMAC 認証を使用する `GCSMount` とともに `CloudflareBucketMountStrategy` を使用することで、バケットのマウントをサポートします。 |
| `BlaxelSandboxClient` | `BlaxelCloudBucketMountStrategy` と `S3Mount`、`R2Mount`、または `GCSMount` のエントリを組み合わせることで、クラウドバケットのマウントをサポートします。また、`agents.extensions.sandbox.blaxel` から利用できる `BlaxelDriveMount` と `BlaxelDriveMountStrategy` により、永続的な Blaxel Drives もサポートします。 |
| `DaytonaSandboxClient` | `DaytonaCloudBucketMountStrategy` を使用し、`rclone` を介したクラウドストレージのマウントをサポートします。`S3Mount`、`GCSMount`、`R2Mount`、`AzureBlobMount`、`BoxMount` と組み合わせて使用します。 |
| `E2BSandboxClient` | `E2BCloudBucketMountStrategy` を使用し、`rclone` を介したクラウドストレージのマウントをサポートします。`S3Mount`、`GCSMount`、`R2Mount`、`AzureBlobMount`、`BoxMount` と組み合わせて使用します。 |
| `RunloopSandboxClient` | `RunloopCloudBucketMountStrategy` を使用し、`rclone` を介したクラウドストレージのマウントをサポートします。`S3Mount`、`GCSMount`、`R2Mount`、`AzureBlobMount`、`BoxMount` と組み合わせて使用します。 |
| `VercelSandboxClient` | `VercelCloudBucketMountStrategy` と `S3Mount` のエントリを組み合わせることで、作成時に限り S3 および S3 互換バケットのマウントをサポートします。マウントされたセッションは再開できず、インライン認証情報には `allow_s3_credential_exposure=True` が必要です。 |

</div>

マウント表は、各バックエンドが実行できるストレージタイプを示しています。チェックマークが付いていても、モデルが制御するサンドボックス内で実行されるマウントヘルパーの認証情報境界を回避できるわけではなく、すべての戦略が認証情報なしで動作できることを意味するものでもありません。Agents SDK が承認なしでコンテナ内マウントを受け入れるのは、選択したヘルパーが保護対象の権限なしで動作できる場合のみです。保護対象の権限を必要とするマウントについては、信頼できるアプリケーションコードが対象のマウントパスに対する権限の公開を明示的に承認しない限り、サンドボックスまたはマウントヘルパーを起動する前に拒否されます。

認証情報を必要としない `rclone` のマウントは、S3、GCS、R2、Azure Blob に限定されます。コンテナ内の Box マウントには、非対話型の認証ソースと、そのソースに対応する承認が必要です。`FuseMountPattern` では、インライン認証情報が設定されていない場合でも `blobfuse2` が環境に存在する Azure 権限を検出するため、広範な承認が必要です。同様に、`S3FilesMountPattern` でも `mount.s3files` が環境に存在する IAM 権限を使用するため、広範な承認が必要です。これらの要件は、Docker がバックエンドの場合にも適用されます。以下のチェックマークは、該当する権限境界の要件を満たした後に、Docker がマウントを実行できることを示しています。

`"data"` という名前のマウントエントリでは、設定された権限に対応する承認によって返される、コピー済みの `Manifest` を保持してください。

```python
# Mount-scoped values such as inline access keys.
manifest = manifest.with_in_container_mount_credential_exposure_acknowledged("data")

# Broader authority such as managed or workload identity and external credential files.
manifest = manifest.with_in_container_mount_broad_credential_exposure_acknowledged("data")
```

承認が必要なすべてのマウントについて、正確なマウントパスをそれぞれ渡してください。両方の権限クラスを使用するマウントには、両方の承認が必要です。承認は実行時にのみ使用され、シリアライズされません。また、認証情報の使用範囲をマウント先のパスに限定することなく、ヘルパーが認証情報を受け取ることを許可します。利用可能な場合は外部戦略またはプロバイダーネイティブの戦略を優先し、それ以外の場合はサンドボックス単位で、短期間のみ有効な最小権限の認証情報を使用してください。

`VercelSandboxClientOptions(allow_s3_credential_exposure=True)` は、マウント単位のインライン認証情報を使用して作成時に Vercel S3 をマウントするための互換性オプションとして引き続き利用できます。広範な認証情報へのアクセス権限を付与するものではありません。

次の表は、各バックエンドが直接マウントできるリモートストレージエントリをまとめたものです。

<div class="sandbox-nowrap-first-column-table" markdown="1">

| バックエンド | AWS S3 | Cloudflare R2 | GCS | Azure Blob Storage | Box | S3 Files |
| --- | --- | --- | --- | --- | --- | --- |
| Docker | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `ModalSandboxClient` | ✓ | ✓ | ✓ | - | - | - |
| `CloudflareSandboxClient` | ✓ | ✓ | ✓ | - | - | - |
| `BlaxelSandboxClient` | ✓ | ✓ | ✓ | - | - | - |
| `DaytonaSandboxClient` | ✓ | ✓ | ✓ | ✓ | ✓ | - |
| `E2BSandboxClient` | ✓ | ✓ | ✓ | ✓ | ✓ | - |
| `RunloopSandboxClient` | ✓ | ✓ | ✓ | ✓ | ✓ | - |
| `VercelSandboxClient` | ✓ | - | - | - | - | - |

</div>

実行可能なコード例については、ローカル、コーディング、メモリ、ハンドオフ、エージェント構成のパターンを扱う [examples/sandbox/](https://github.com/openai/openai-agents-python/tree/main/examples/sandbox) と、ホステッドサンドボックスクライアントを扱う [examples/sandbox/extensions/](https://github.com/openai/openai-agents-python/tree/main/examples/sandbox/extensions) を参照してください。