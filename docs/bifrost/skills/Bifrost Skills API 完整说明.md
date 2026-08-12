# Bifrost Skills API 完整说明

Bifrost Skills Repository 把 Agent Skills（`SKILL.md` + 附件）做成可版本管理的仓库，对外提供两套接口：

1. **Management API**（`/api/skills*`）—— 需认证，用于列表、查看元数据、版本管理
2. **Serving / Marketplace API**（`/api/skills/serve/*`）—— 公开，用于下载 ZIP / 单文件

Base URL 默认：`http://localhost:8080`（替换成你的 Bifrost 实例地址）

---

## 认证

| 接口类型                               | 认证方式                                     |
| -------------------------------------- | -------------------------------------------- |
| Management（list / get / versions 等） | `Authorization: Bearer <Management API Key>` |
| Serving（download.zip / files）        | **无需认证**（公开）                         |

注意：Virtual Key、dashboard session、`x-api-key` **不能**用于 Management API。

---

## 1. 列出所有 Skill

```http
GET /api/skills
```

**Query 参数**

| 参数      | 类型   | 默认         | 说明                                 |
| --------- | ------ | ------------ | ------------------------------------ |
| `search`  | string | -            | 按 name 或 description 搜索          |
| `sort_by` | string | `created_at` | `name` / `updated_at` / `created_at` |
| `order`   | string | `desc`       | `asc` / `desc`                       |
| `limit`   | int    | 50           | 最大 100                             |
| `offset`  | int    | 0            | 分页偏移                             |

**示例**

```bash
curl -X GET "http://localhost:8080/api/skills?limit=50&sort_by=updated_at&order=desc" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**响应（简化）**

```json
{
  "skills": [
    {
      "id": "uuid...",
      "name": "review-migrations",
      "description": "...",
      "license": "MIT",
      "compatibility": "Claude Code, Codex",
      "metadata": {},
      "extra_frontmatter": {},
      "allowed_tools": "...",
      "skill_md_body": "...",
      "latest_version": "1.0.0",
      "highest_version": "1.2.0",
      "file_count": 3,
      "files": [ /* 当前 served 版本文件 */ ],
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "total": 12,
  "limit": 50,
  "offset": 0
}
```

- `latest_version`：当前对外服务的版本  
- `highest_version`：历史上创建过的最高 SemVer（用于后续版本校验）

---

## 2. 查看单个 Skill（含文件元数据）

```http
GET /api/skills/{id}
```

**Path**
- `{id}`：skill 的 ID（从 list 获取）

**Query**
- `version`（可选）：指定历史版本，如 `1.0.0`。不传则返回当前 served 版本。

**示例**

```bash
# 当前 served 版本
curl -X GET "http://localhost:8080/api/skills/SKILL_ID" \
  -H "Authorization: Bearer YOUR_API_KEY"

# 指定历史版本
curl -X GET "http://localhost:8080/api/skills/SKILL_ID?version=1.0.0" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**响应结构**

```json
{
  "skill": {
    "id": "...",
    "name": "review-migrations",
    "description": "...",
    "skill_md_body": "...",          // SKILL.md 正文
    "latest_version": "1.0.0",
    "highest_version": "1.2.0",
    "file_count": 3,
    "files": [
      {
        "path": "references/style-guide.md",   // 含子目录
        "mime_type": "text/markdown",
        "source_type": "text|url|dataurl|upload",
        "content": "...",                      // 仅 text 源内联
        "source_url": "https://...",           // url 源
        "dataurl": "data:...",                 // dataurl 源
        "storage_key": "...",                  // 上传文件引用
        "blob_id": "...",
        "file_size_bytes": 123,
        "id": "...",
        "skill_version_id": "..."
      }
    ],
    ...
  }
}
```

**文件内容获取限制**
- `source_type=text`：正文在 `content` 字段
- `url` / `dataurl`：给引用，需自行拉取
- `upload`：通常只有 `storage_key` / `blob_id`，JSON **不保证**内联完整二进制

因此 Get skill **适合看元数据和文本**，不适合保证一次拿全所有二进制附件。

---

## 3. 查看 Skill 版本历史

```http
GET /api/skills/{id}/versions
```

**Query 参数**

| 参数      | 默认         | 说明                     |
| --------- | ------------ | ------------------------ |
| `search`  | -            | 按 version 字符串过滤    |
| `sort_by` | `created_at` | `version` / `created_at` |
| `order`   | `desc`       | `asc` / `desc`           |
| `limit`   | 20           | 最大 100                 |
| `offset`  | 0            | 分页                     |

每个 version 条目包含该快照的 `skill_md_body`、`frontmatter_snapshot`、`files` 列表。

---

## 4. 完整下载某个 Skill（推荐）

### 4.1 下载整个 Skill 为 ZIP（完整包）

```http
GET /api/skills/serve/{skill-name}/download.zip
```

- **公开，无需认证**
- `{skill-name}` 用 skill 的 **name**（不是 id）
- 返回当前 served 版本的完整 ZIP
- 包含 `SKILL.md` + 所有子目录和文件，目录结构原样保留

```bash
curl -o review-migrations.zip \
  "http://localhost:8080/api/skills/serve/review-migrations/download.zip"
```

### 4.2 下载所有 Skill 为 ZIP

```http
GET /api/skills/serve/all/download.zip
```

公开接口，一次打包当前所有 served skill。

### 4.3 按路径下载单个文件

```http
GET /api/skills/serve/{skill-name}/files/{filepath}
```

- 公开，无需认证
- `{filepath}` 为相对路径，支持子目录，例如 `references/style-guide.md`
- 返回原始文件流（`application/octet-stream`）

```bash
curl -o style-guide.md \
  "http://localhost:8080/api/skills/serve/review-migrations/files/references/style-guide.md"
```

流程：先 Get skill 拿到 `files[].path`，再逐个拉取。

---

## 5. 方式对比

| 目标                            | 推荐接口                                    | 认证 | 是否完整 | 备注           |
| ------------------------------- | ------------------------------------------- | ---- | -------- | -------------- |
| 列出所有 skill                  | `GET /api/skills`                           | 需要 | 元数据   | 分页 + 搜索    |
| 查看单个 skill 元数据/文本      | `GET /api/skills/{id}`                      | 需要 | 部分     | 可指定 version |
| 查看版本历史                    | `GET /api/skills/{id}/versions`             | 需要 | 快照列表 | -              |
| **完整获取某个 skill 所有文件** | `GET /api/skills/serve/{name}/download.zip` | 无   | **完整** | 最推荐         |
| 获取单个文件内容                | `GET /api/skills/serve/{name}/files/{path}` | 无   | 单文件   | -              |
| 打包全部 skill                  | `GET /api/skills/serve/all/download.zip`    | 无   | 完整     | -              |

---

## 6. 典型工作流

```text
1. GET /api/skills                    → 拿到 id 和 name 列表
2. GET /api/skills/{id}               → 看元数据、SKILL.md 正文、文件 path 列表
3. GET /api/skills/{id}/versions      → 需要时查看历史版本
4. GET /api/skills/serve/{name}/download.zip
                                     → 一次下载完整 skill 包（含子目录）
```

或只下载某个文件：

```text
GET /api/skills/serve/{name}/files/{filepath}
```

---

## 7. 关键概念速查

| 概念              | 含义                                                    |
| ----------------- | ------------------------------------------------------- |
| `name`            | 稳定标识符，不可改，用于 marketplace 和 serve 路径      |
| `id`              | 内部 UUID，用于 Management API                          |
| `latest_version`  | 当前对外 served 的版本                                  |
| `highest_version` | 历史上最高 SemVer，用于版本递增校验                     |
| `skill_md_body`   | SKILL.md 的 Markdown 正文（不含 frontmatter）           |
| `files[].path`    | 包内相对路径，天然支持多级子目录                        |
| Serving 路由      | `/api/skills/serve/*`，公开，给 CLI/Agent 拉取用        |
| Management 路由   | `/api/skills`、`/api/skills/{id}` 等，需 Bearer API Key |

---

## 8. 官方文档入口

- List skills：https://docs.getbifrost.ai/api-reference/skills/list-skills  
- Get skill：https://docs.getbifrost.ai/api-reference/skills/get-skill  
- List versions：https://docs.getbifrost.ai/api-reference/skills/list-skill-versions  
- Download skill ZIP：https://docs.getbifrost.ai/api-reference/skills/download-skill-as-zip  
- Download all ZIP：https://docs.getbifrost.ai/api-reference/skills/download-all-skills-as-zip  
- Download single file：https://docs.getbifrost.ai/api-reference/skills/download-skill-file  
- 产品说明：https://docs.getbifrost.ai/features/skills-repository  
- 全量索引：https://docs.getbifrost.ai/llms.txt  

以上即为 Bifrost 通过 API **读取 / 查看 / 下载 skill** 的完整可用路径与限制。需要完整文件树时，优先走 ZIP 下载接口。