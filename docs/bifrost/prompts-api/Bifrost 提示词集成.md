**完整方案：Bifrost 提示词管理 + 本地预览图（融合官方 Prompt Repository API）**

适用于你的需求：
- 使用 Bifrost 作为提示词正文、版本、文件夹的唯一数据源
- 前端支持列表、检索、新建、编辑、删除
- 每个提示词支持预览图
- 图片继续使用本地文件夹存储

---

### 一、整体架构

```
前端 Web 项目
    ↓（用户登录态）
你的后端 API
    ├── 代理 Bifrost Prompt Repository API（正文、版本、文件夹、Session）
    └── 管理本地预览图（文件夹 + 数据库元数据）
         ↓
Bifrost Gateway（/api/prompt-repo/*）
```

**职责划分**：
- **Bifrost**：提示词名称、内容、版本、文件夹、Session、生产调用
- **你的系统**：预览图存储与关联、前端检索增强、权限控制

**认证说明**（官方要求）：  
Bifrost Management API（所有 `/api/prompt-repo/*`）必须使用 `Authorization: Bearer <Management API Key>`。Virtual Key、dashboard/user/session token、`x-api-key` 均不支持。Key 只放在后端环境变量，绝不可暴露给前端。

---

### 二、数据存储设计

#### 1. Bifrost（官方 Prompt Repository，不改动）

概念层级（官方）：

```
Folder（文件夹）
  └── Prompt（提示词，UUID）
        ├── Version（版本，不可变快照，自增 ID）
        └── Session（Playground 会话，自增 ID）
              └── Commit → 生成新 Version
```

Bifrost 只负责核心数据，无图片字段。

**Folder 对象字段**（官方）：
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

**Prompt 对象字段**（官方）：
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

**Version 对象字段**（官方，不可变快照）：
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

**Session 对象字段**（官方）：
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

> 删除 Folder 会级联删除其中所有 Prompt、Session、Version。  
> 删除 Prompt 会级联删除其所有 Version 和 Session。

#### 2. 你自己的数据库（仅存元数据）

```sql
CREATE TABLE prompt_metadata (
  prompt_id       VARCHAR(64) PRIMARY KEY,  -- Bifrost 的 prompt.id
  preview_image   VARCHAR(512),             -- 本地图片相对路径或可访问 URL
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 3. 本地图片存储

建议目录结构：
```
/uploads/prompt-previews/
    ├── {prompt_id}.jpg
    ├── {prompt_id}.png
    └── ...
```

访问方式示例：
- 相对路径存库：`/uploads/prompt-previews/abc-123.jpg`
- 前端访问：`https://your-domain.com/uploads/prompt-previews/abc-123.jpg`（由 Nginx 或后端静态服务提供）

---

### 三、后端接口设计（代理 + 本地扩展）

| 你的接口 | 方法 | 说明 | 对应官方 Bifrost 接口 |
|----------|------|------|-----------------------|
| `/api/prompts` | GET | 获取所有提示词（合并本地预览图） | `GET /api/prompt-repo/prompts`（可选 `?folder_id=`） |
| `/api/prompts/:id` | GET | 获取单个提示词详情（含预览图） | `GET /api/prompt-repo/prompts/{id}` |
| `/api/prompts` | POST | 新建提示词（仅名称/文件夹） | `POST /api/prompt-repo/prompts`（必填 `name`，可选 `folder_id`） |
| `/api/prompts/:id` | PUT | 更新名称/文件夹 | `PUT /api/prompt-repo/prompts/{id}`（`name` / `folder_id`） |
| `/api/prompts/:id` | DELETE | 删除提示词（同时清理本地图片和元数据） | `DELETE /api/prompt-repo/prompts/{id}` |
| `/api/prompts/:id/versions` | GET | 列出版本 | `GET /api/prompt-repo/prompts/{id}/versions` |
| `/api/prompts/:id/versions` | POST | 创建新版本（编辑全文） | `POST /api/prompt-repo/prompts/{id}/versions` |
| `/api/prompts/:id/sessions` | GET/POST | 会话列表/创建 | 对应官方 sessions 接口 |
| `/api/prompts/:id/preview` | POST | 上传/更新预览图 | 本地逻辑 |
| `/api/prompts/:id/preview` | DELETE | 删除预览图 | 本地逻辑 |
| `/api/folders` 等 | — | 文件夹 CRUD | 完整代理官方 Folder 接口 |

**关键逻辑：列表合并**

```text
1. 调用 Bifrost GET /api/prompt-repo/prompts（可带 ?folder_id=）
2. 取出所有 prompt_id
3. 批量查询本地 prompt_metadata
4. 把 preview_image 合并进每条数据后返回前端
```

返回示例：
```json
{
  "prompts": [
    {
      "id": "bf-uuid-xxx",
      "name": "赛博朋克风格",
      "folder_id": "...",
      "folder": { ... },
      "latest_version": { ... },
      "versions": [ ... ],
      "sessions": [ ... ],
      "preview_image": "/uploads/prompt-previews/bf-uuid-xxx.jpg",
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

---

### 四、官方 Prompt Repository API 完整参考（已验证）

#### 1. Folder 文件夹

| 操作 | 方法 | 路径 | 必填参数 |
|------|------|------|---------|
| 列出所有 | `GET` | `/api/prompt-repo/folders` | — |
| 创建 | `POST` | `/api/prompt-repo/folders` | `name` |
| 获取 | `GET` | `/api/prompt-repo/folders/{id}` | — |
| 更新 | `PUT` | `/api/prompt-repo/folders/{id}` | `name` / `description` |
| 删除 | `DELETE` | `/api/prompt-repo/folders/{id}` | —（级联删除内部所有内容） |

#### 2. Prompt 提示词

| 操作 | 方法 | 路径 | 必填参数 |
|------|------|------|---------|
| 列出所有 | `GET` | `/api/prompt-repo/prompts` | 可选 `?folder_id=` |
| 创建 | `POST` | `/api/prompt-repo/prompts` | `name`（可选 `folder_id`） |
| 获取 | `GET` | `/api/prompt-repo/prompts/{id}` | — |
| 更新 | `PUT` | `/api/prompt-repo/prompts/{id}` | `name` / `folder_id` |
| 删除 | `DELETE` | `/api/prompt-repo/prompts/{id}` | —（级联删除 Version 和 Session） |

#### 3. Version 版本（不可变快照）

| 操作 | 方法 | 路径 | 必填参数 |
|------|------|------|---------|
| 列出所有 | `GET` | `/api/prompt-repo/prompts/{id}/versions` | — |
| 创建 | `POST` | `/api/prompt-repo/prompts/{id}/versions` | `commit_message`, `messages`, `model_params`, `provider`, `model` |
| 获取 | `GET` | `/api/prompt-repo/versions/{id}` | — |
| 删除 | `DELETE` | `/api/prompt-repo/versions/{id}` | — |

#### 4. Session 会话（Playground）

| 操作 | 方法 | 路径 | 必填参数 |
|------|------|------|---------|
| 列出所有 | `GET` | `/api/prompt-repo/prompts/{id}/sessions` | — |
| 创建 | `POST` | `/api/prompt-repo/prompts/{id}/sessions` | `name`, `model_params`, `provider`, `model`；可选 `version_id`（从某版本 fork）、`messages` |
| 获取 | `GET` | `/api/prompt-repo/sessions/{id}` | — |
| 更新 | `PUT` | `/api/prompt-repo/sessions/{id}` | `name`, `messages`, `model_params`, `provider`, `model` |
| 删除 | `DELETE` | `/api/prompt-repo/sessions/{id}` | — |
| 重命名 | `PUT` | `/api/prompt-repo/sessions/{id}/rename` | `name` |
| **提交为版本** | `POST` | `/api/prompt-repo/sessions/{id}/commit` | `commit_message` |

**典型官方工作流**：
```
1. 创建 Folder（可选）
2. 创建 Prompt（关联 folder_id）
3. 创建 Session（可 fork 某 Version）
4. 迭代更新 Session（调整 messages / model_params）
5. 满意后 Commit Session → 生成新 Version
6. 生产环境通过 GET /prompts/{id} 获取 latest_version，或使用 x-bf-prompt-id / x-bf-prompt-version 头注入
```

**错误响应结构**（通用参考）：
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
常见状态码：`400` 参数错误 / `404` 资源不存在 / `500` 服务器错误。

官方文档入口示例：  
https://docs.getbifrost.ai/api-reference/prompt-repository/list-folders

---

### 五、核心流程（结合官方 API）

#### 1. 获取列表 + 前端检索
1. 前端请求 `GET /api/prompts`（你的后端）
2. 后端调用官方 `GET /api/prompt-repo/prompts`（可带 `folder_id`）
3. 合并本地 `preview_image` 后返回
4. 前端用 React Query / SWR 缓存，对 `name` 和内容做关键词过滤

#### 2. 新建提示词
1. 前端填写名称（可选文件夹）→ `POST /api/prompts`
2. 后端转发官方 `POST /api/prompt-repo/prompts`（`name` 必填）
3. 返回新 `prompt_id`
4. 前端可继续上传预览图或进入编辑正文

#### 3. 编辑正文（创建版本）
两种推荐方式：
- **直接创建版本**：`POST /api/prompts/:id/versions` → 转发官方接口，传入 `commit_message`、`messages`、`model_params`、`provider`、`model`
- **Session 工作流**（更贴近官方 Playground）：
  1. 创建/更新 Session
  2. `POST /api/prompt-repo/sessions/{id}/commit` 生成新 Version

#### 4. 上传预览图
1. 前端选择图片 → `POST /api/prompts/:id/preview`
2. 后端：
   - 保存到 `/uploads/prompt-previews/{prompt_id}.ext`
   - 更新或插入 `prompt_metadata`
3. 返回图片访问路径

#### 5. 删除提示词
1. 前端确认删除
2. 后端：
   - 调用官方 `DELETE /api/prompt-repo/prompts/{id}`
   - 删除本地图片文件
   - 删除 `prompt_metadata` 记录

---

### 六、前端功能要点

1. **列表页**
   - 显示预览图缩略图（无则占位图）
   - 支持名称/内容搜索
   - 支持按文件夹筛选（调用官方 folder 过滤）
   - 操作：查看、编辑、上传预览图、删除

2. **编辑页**
   - 修改名称 / 文件夹
   - 可视化编辑 messages（可对接 Session 或直接创建 Version）
   - 上传/更换预览图
   - 保存时填写 `commit_message` 并创建新版本

3. **缓存策略**
   - React Query / SWR
   - `staleTime` 建议 30–60 秒
   - 任何写操作成功后立即 `invalidateQueries`

---

### 七、本地图片处理建议

**保存示例（Node.js）**：
```js
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const storage = multer.diskStorage({
  destination: 'uploads/prompt-previews/',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.params.id}${ext}`);
  }
});
const upload = multer({ storage });

app.post('/api/prompts/:id/preview', upload.single('image'), async (req, res) => {
  const imagePath = `/uploads/prompt-previews/${req.file.filename}`;
  
  await db.query(`
    INSERT INTO prompt_metadata (prompt_id, preview_image, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (prompt_id) DO UPDATE SET preview_image = $2, updated_at = NOW()
  `, [req.params.id, imagePath]);

  res.json({ preview_image: imagePath });
});
```

**静态访问**（Express）：
```js
app.use('/uploads', express.static('uploads'));
```
或由 Nginx 直接托管 `uploads` 目录。

---

### 八、注意事项

1. **安全**：Bifrost Management Key 只放在后端环境变量。
2. **一致性**：删除提示词时同步清理本地图片和数据库记录。
3. **图片命名**：使用 `prompt_id` 作为文件名，避免冲突。
4. **扩展性**：以后换对象存储，只需改上传逻辑，数据库字段和前端几乎不用动。
5. **权限**：在你的后端根据登录用户控制谁可以编辑/删除哪些提示词。
6. **前置条件**：Bifrost 需启用 config store（通常 PostgreSQL），纯文件配置不支持 Prompt Repository。
7. **生产调用**：通过 `x-bf-prompt-id`（必填）和可选 `x-bf-prompt-version` 头注入 committed version。

---

### 九、实施步骤

1. 搭建后端代理（完整转发官方 Folder / Prompt / Version / Session 接口）
2. 创建 `prompt_metadata` 表
3. 实现本地图片上传与静态访问
4. 实现列表合并接口（官方数据 + 本地预览图）
5. 前端对接列表、搜索、CRUD、预览图上传、版本/Session 编辑
6. 测试完整流程：新建 → 上传预览图 → 编辑正文（Version 或 Session+Commit）→ 搜索 → 删除

---

这套方案完整覆盖你的需求：  
- 提示词正文、版本、文件夹由 Bifrost 官方 API 管理  
- 预览图用本地文件夹存储  
- 前端可检索、编辑、删除、新建  
- 架构清晰，后续可平滑升级到对象存储  

官方文档持续更新时，以 https://docs.getbifrost.ai/api-reference/prompt-repository/ 为准即可。