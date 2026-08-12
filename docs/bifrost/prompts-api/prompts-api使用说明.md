以下是 Prompt Repository API 完整参考，适合项目集成使用。

---

## Prompt Repository API 全面总结

### 概念层级

```
Folder（文件夹）
  └── Prompt（提示词，UUID）
        ├── Version（版本，不可变快照，自增 ID）
        └── Session（Playground 会话，自增 ID）
              └── Commit → 生成新 Version
```

---

### 一、Folder 文件夹

| 操作 | 方法 | 路径 | 必填参数 |
|------|------|------|---------|
| 列出所有 | `GET` | `/api/prompt-repo/folders` | — |
| 创建 | `POST` | `/api/prompt-repo/folders` | `name` |
| 获取 | `GET` | `/api/prompt-repo/folders/{id}` | — |
| 更新 | `PUT` | `/api/prompt-repo/folders/{id}` | `name` / `description` |
| 删除 | `DELETE` | `/api/prompt-repo/folders/{id}` | — |

> 删除文件夹会**级联删除**其中所有 Prompt。

**Folder 对象字段：**
```json
{
  "id": "uuid",
  "name": "string",
  "description": "string | null",
  "prompts_count": 0,
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

---

### 二、Prompt 提示词

| 操作 | 方法 | 路径 | 必填参数 |
|------|------|------|---------|
| 列出所有 | `GET` | `/api/prompt-repo/prompts` | 可选 `?folder_id=` 过滤 |
| 创建 | `POST` | `/api/prompt-repo/prompts` | `name` |
| 获取 | `GET` | `/api/prompt-repo/prompts/{id}` | — |
| 更新 | `PUT` | `/api/prompt-repo/prompts/{id}` | `name` / `folder_id` |
| 删除 | `DELETE` | `/api/prompt-repo/prompts/{id}` | — |

> 删除 Prompt 会**级联删除**其所有 Version 和 Session。

**Prompt 对象字段：**
```json
{
  "id": "uuid",
  "name": "string",
  "folder_id": "uuid | null",
  "folder": { ... },
  "versions": [ ... ],
  "sessions": [ ... ],
  "latest_version": { ... },
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

---

### 三、Version 版本（不可变快照）

| 操作 | 方法 | 路径 | 必填参数 |
|------|------|------|---------|
| 列出所有 | `GET` | `/api/prompt-repo/prompts/{id}/versions` | — |
| 创建 | `POST` | `/api/prompt-repo/prompts/{id}/versions` | `commit_message`, `messages`, `model_params`, `provider`, `model` |
| 获取 | `GET` | `/api/prompt-repo/versions/{id}` | — |
| 删除 | `DELETE` | `/api/prompt-repo/versions/{id}` | — |

**Version 对象字段：**
```json
{
  "id": 1,
  "prompt_id": "uuid",
  "version_number": 1,
  "commit_message": "string",
  "provider": "string",
  "model": "string",
  "model_params": { },
  "is_latest": true,
  "messages": [
    { "id": 1, "order_index": 0, "message": { } }
  ],
  "created_at": "datetime"
}
```

---

### 四、Session 会话（Playground）

| 操作 | 方法 | 路径 | 必填参数 |
|------|------|------|---------|
| 列出所有 | `GET` | `/api/prompt-repo/prompts/{id}/sessions` | — |
| 创建 | `POST` | `/api/prompt-repo/prompts/{id}/sessions` | `name`, `model_params`, `provider`, `model`；可选 `version_id`（从某版本 fork） |
| 获取 | `GET` | `/api/prompt-repo/sessions/{id}` | — |
| 更新 | `PUT` | `/api/prompt-repo/sessions/{id}` | `name`, `messages`, `model_params`, `provider`, `model` |
| 删除 | `DELETE` | `/api/prompt-repo/sessions/{id}` | — |
| 重命名 | `PUT` | `/api/prompt-repo/sessions/{id}/rename` | `name` |
| **提交为版本** | `POST` | `/api/prompt-repo/sessions/{id}/commit` | `commit_message` |

**Session 对象字段：**
```json
{
  "id": 1,
  "prompt_id": "uuid",
  "version_id": "integer | null",
  "name": "string",
  "provider": "string",
  "model": "string",
  "model_params": { },
  "messages": [
    { "id": 1, "order_index": 0, "message": { } }
  ],
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

---

### 典型集成工作流

```
1. 创建 Folder（可选）
2. 创建 Prompt（关联 folder_id）
3. 创建 Session（可 fork 某 Version）
4. 迭代更新 Session（调整 messages / model_params）
5. 满意后 Commit Session → 生成新 Version
6. 生产环境通过 GET /prompts/{id} 获取 latest_version 使用
```

---

### 错误响应结构（通用）

```json
{
  "event_id": "string",
  "type": "string",
  "is_bifrost_error": true,
  "status_code": 400,
  "error": {
    "type": "string",
    "code": "string",
    "message": "string"
  }
}
```

常见状态码：`400` 参数错误 / `404` 资源不存在 / `500` 服务器错误