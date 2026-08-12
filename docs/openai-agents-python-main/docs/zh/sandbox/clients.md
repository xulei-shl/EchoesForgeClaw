---
search:
  exclude: true
---
# 沙箱客户端

使用本页选择沙箱工作应在何处运行。在大多数情况下，`SandboxAgent` 定义保持不变，仅需更改 [`SandboxRunConfig`][agents.run_config.SandboxRunConfig] 中的沙箱客户端和客户端特定选项。

!!! warning "Beta 功能"

    沙箱智能体目前处于 Beta 阶段。在正式发布之前，API 细节、默认值和支持的功能可能会发生变化，并且未来将提供更多高级功能。

## 决策指南

<div class="sandbox-nowrap-first-column-table" markdown="1">

| 目标 | 首选方案 | 原因 |
| --- | --- | --- |
| 在 macOS 或 Linux 上实现最快的本地迭代 | `UnixLocalSandboxClient` | 无需额外安装，适合简单的本地文件系统开发。 |
| 基础容器隔离 | `DockerSandboxClient` | 使用指定镜像在 Docker 中运行工作。 |
| 托管执行或生产级隔离 | 托管沙箱客户端 | 将工作区边界迁移到由提供商管理的环境。 |

</div>

## 本地客户端

对于大多数用户，建议从以下两个沙箱客户端之一开始：

<div class="sandbox-nowrap-first-column-table" markdown="1">

| 客户端 | 安装 | 适用场景 | 示例 |
| --- | --- | --- | --- |
| `UnixLocalSandboxClient` | 无 | 在 macOS 或 Linux 上实现最快的本地迭代。是本地开发的良好默认选择。 | [Unix 本地入门示例](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/unix_local_runner.py) |
| `DockerSandboxClient` | `openai-agents[docker]` | 希望使用容器隔离，或使用指定镜像在本地复现目标环境。 | [Docker 入门示例](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/docker/docker_runner.py) |

</div>

Unix 本地客户端是基于本地文件系统开始开发的最简便方式。当需要更强的环境隔离或与生产环境保持一致时，可迁移到 Docker 或托管提供商。

`SandboxPathGrant.host_path` 仅适用于 Docker，它会将主机路径映射到容器内不同的 POSIX 路径。Unix 本地客户端仅支持同路径授权。有关详细信息，请参阅[清单路径授权](guide.md#manifest)。

要从 Unix 本地客户端切换到 Docker，请保持智能体定义不变，仅更改运行配置：

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

当需要容器隔离，或希望沙箱镜像与其他环境中使用的镜像保持一致时，请使用此方式。请参阅 [examples/sandbox/docker/docker_runner.py](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/docker/docker_runner.py)。

## 挂载与远程存储

挂载条目描述要公开哪些存储；挂载策略描述沙箱后端如何附加这些存储。从 `agents.sandbox.entries` 导入内置挂载条目和通用策略。托管提供商策略可从 `agents.extensions.sandbox` 或提供商专用扩展包中获取。

常用挂载选项：

- `mount_path`：存储在沙箱中的显示位置。相对路径基于清单根目录解析；绝对路径按原样使用。
- `read_only`：默认为 `True`。仅当沙箱应将更改写回已挂载存储时，才设置 `False`。
- `mount_strategy`：必填。请使用同时匹配挂载条目和沙箱后端的策略。

挂载会被视为临时工作区条目。快照和持久化流程会分离或跳过已挂载路径，而不会将已挂载的远程存储复制到保存的工作区中。

通用本地/容器策略：

<div class="sandbox-nowrap-first-column-table" markdown="1">

| 策略或模式 | 适用场景 | 说明 |
| --- | --- | --- |
| `InContainerMountStrategy(pattern=RcloneMountPattern(...))` | 沙箱镜像可以运行 `rclone`。 | 支持 S3、GCS、R2、Azure Blob 和 Box。`RcloneMountPattern` 可在 `fuse` 模式或 `nfs` 模式下运行。 |
| `InContainerMountStrategy(pattern=MountpointMountPattern(...))` | 镜像包含 `mount-s3`，并且需要 Mountpoint 风格的 S3 或兼容 S3 的访问方式。 | 支持 `S3Mount` 和 `GCSMount`。 |
| `InContainerMountStrategy(pattern=FuseMountPattern(...))` | 镜像包含 `blobfuse2` 并支持 FUSE。 | 支持 `AzureBlobMount`。 |
| `InContainerMountStrategy(pattern=S3FilesMountPattern(...))` | 镜像包含 `mount.s3files`，并且可以访问现有的 S3 Files 挂载目标。 | 支持 `S3FilesMount`。 |
| `DockerVolumeMountStrategy(driver=...)` | Docker 应在容器启动前附加由卷驱动程序支持的挂载。 | 仅适用于 Docker。S3、GCS、R2、Azure Blob 和 Box 可通过 `rclone` 挂载；S3 和 GCS 也可通过 `mountpoint` 挂载。 |

</div>

## 支持的托管平台

需要托管环境时，通常可以沿用同一个 `SandboxAgent` 定义，仅更改 [`SandboxRunConfig`][agents.run_config.SandboxRunConfig] 中的沙箱客户端。

如果使用的是已发布的 SDK，而不是此代码仓库的检出版本，请通过对应的软件包 extra 安装沙箱客户端依赖项。

有关提供商特定的设置说明，以及代码仓库中扩展代码示例的链接，请参阅 [examples/sandbox/extensions/README.md](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/extensions/README.md)。

<div class="sandbox-nowrap-first-column-table" markdown="1">

| 客户端 | 安装 | 示例 |
| --- | --- | --- |
| `BlaxelSandboxClient` | `openai-agents[blaxel]` | [Blaxel 运行器](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/extensions/blaxel_runner.py) |
| `CloudflareSandboxClient` | `openai-agents[cloudflare]` | [Cloudflare 运行器](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/extensions/cloudflare_runner.py) |
| `DaytonaSandboxClient` | `openai-agents[daytona]` | [Daytona 运行器](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/extensions/daytona/daytona_runner.py) |
| `E2BSandboxClient` | `openai-agents[e2b]` | [E2B 运行器](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/extensions/e2b_runner.py) |
| `ModalSandboxClient` | `openai-agents[modal]` | [Modal 运行器](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/extensions/modal_runner.py) |
| `RunloopSandboxClient` | `openai-agents[runloop]` | [Runloop 运行器](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/extensions/runloop/runner.py) |
| `VercelSandboxClient` | `openai-agents[vercel]` | [Vercel 运行器](https://github.com/openai/openai-agents-python/blob/main/examples/sandbox/extensions/vercel_runner.py) |

</div>

托管沙箱客户端会提供特定于提供商的挂载策略。请选择最适合所用存储提供商的后端和挂载策略：

<div class="sandbox-nowrap-first-column-table" markdown="1">

| 后端 | 挂载说明 |
| --- | --- |
| Docker | 支持将 `S3Mount`、`GCSMount`、`R2Mount`、`AzureBlobMount`、`BoxMount` 和 `S3FilesMount` 与 `InContainerMountStrategy`、`DockerVolumeMountStrategy` 等本地策略配合使用。 |
| `ModalSandboxClient` | 支持通过 `ModalCloudBucketMountStrategy` 使用 `S3Mount`、`R2Mount` 和经 HMAC 身份验证的 `GCSMount` 来挂载云存储桶。可以使用内联凭证或具名 Modal Secret。 |
| `CloudflareSandboxClient` | 支持通过 `CloudflareBucketMountStrategy` 使用 `S3Mount`、`R2Mount` 和经 HMAC 身份验证的 `GCSMount` 来挂载存储桶。 |
| `BlaxelSandboxClient` | 支持将 `BlaxelCloudBucketMountStrategy` 与 `S3Mount`、`R2Mount` 或 `GCSMount` 条目配对来挂载云存储桶。还支持使用 `BlaxelDriveMount` 和 `BlaxelDriveMountStrategy` 挂载持久化 Blaxel Drives，两者均可从 `agents.extensions.sandbox.blaxel` 获取。 |
| `DaytonaSandboxClient` | 支持通过 `rclone` 使用 `DaytonaCloudBucketMountStrategy` 挂载云存储；可将其与 `S3Mount`、`GCSMount`、`R2Mount`、`AzureBlobMount` 和 `BoxMount` 配合使用。 |
| `E2BSandboxClient` | 支持通过 `rclone` 使用 `E2BCloudBucketMountStrategy` 挂载云存储；可将其与 `S3Mount`、`GCSMount`、`R2Mount`、`AzureBlobMount` 和 `BoxMount` 配合使用。 |
| `RunloopSandboxClient` | 支持通过 `rclone` 使用 `RunloopCloudBucketMountStrategy` 挂载云存储；可将其与 `S3Mount`、`GCSMount`、`R2Mount`、`AzureBlobMount` 和 `BoxMount` 配合使用。 |
| `VercelSandboxClient` | 支持将 `VercelCloudBucketMountStrategy` 与 `S3Mount` 条目配对，以挂载仅能在创建时配置的 S3 和兼容 S3 的存储桶；已挂载的会话无法恢复，并且内联凭证需要 `allow_s3_credential_exposure=True`。 |

</div>

挂载表描述了每个后端能够执行哪些存储类型。对于在由模型控制的沙箱内运行的挂载辅助程序，勾选标记并不会绕过凭证边界，也不表示每种策略都可以在没有凭证的情况下运行。仅当所选辅助程序可以在不使用受保护权限的情况下运行时，Agents SDK 才会接受未经确认的容器内挂载。如果挂载需要受保护权限，Agents SDK 会在启动沙箱或挂载辅助程序之前拒绝该挂载，除非可信的应用程序代码针对确切的挂载路径明确确认允许暴露该权限。

无需凭证的 `rclone` 挂载仅限于 S3、GCS、R2 和 Azure Blob。容器内的 Box 挂载需要非交互式身份验证来源，并且需要与该来源匹配的确认。`FuseMountPattern` 需要广泛权限确认，因为即使未配置内联凭证，`blobfuse2` 也会发现环境中的 Azure 权限。类似地，`S3FilesMountPattern` 也需要广泛权限确认，因为 `mount.s3files` 会使用环境中的 IAM 权限。当 Docker 作为后端时，这些要求同样适用；下表中的勾选标记表示在满足适用的权限边界后，Docker 可以执行该挂载。

对于名为 `"data"` 的挂载条目，请保留由与已配置权限匹配的确认操作所返回的 `Manifest` 副本：

```python
# Mount-scoped values such as inline access keys.
manifest = manifest.with_in_container_mount_credential_exposure_acknowledged("data")

# Broader authority such as managed or workload identity and external credential files.
manifest = manifest.with_in_container_mount_broad_credential_exposure_acknowledged("data")
```

请传入需要确认的每个确切挂载路径。同时使用两种权限类别的挂载需要两项确认。这些确认仅在运行时有效，不会被序列化，并且会允许辅助程序接收凭证，而不会将凭证的使用范围限制在已挂载路径内。应优先使用外部策略或提供商原生策略；否则，请使用作用域限定于沙箱、有效期短且遵循最小权限原则的凭证。

`VercelSandboxClientOptions(allow_s3_credential_exposure=True)` 仍可作为兼容性选项，用于在创建 Vercel S3 挂载时使用作用域限定于挂载的内联凭证。它不会授予广泛的凭证权限。

下表汇总了每个后端可以直接挂载的远程存储条目。

<div class="sandbox-nowrap-first-column-table" markdown="1">

| 后端 | AWS S3 | Cloudflare R2 | GCS | Azure Blob Storage | Box | S3 Files |
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

如需更多可运行的代码示例，请浏览 [examples/sandbox/](https://github.com/openai/openai-agents-python/tree/main/examples/sandbox)，其中包含本地运行、编码、内存、任务转移和智能体组合模式；有关托管沙箱客户端，请浏览 [examples/sandbox/extensions/](https://github.com/openai/openai-agents-python/tree/main/examples/sandbox/extensions)。