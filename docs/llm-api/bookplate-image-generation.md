# Bookplate Stage 3 · 图像生成逻辑

> **目标**：说明 bookplate 模块第三阶段（Stage 3）图像生成的落地逻辑，以及如何在不改动核心流程的前提下，向后扩展传入新的图像参数。
>
> 底层调用的外部接口见 [图像生成api.md](./图像生成api.md)（Agnes Image 2.1 Flash）。

---

## 一、阶段定位

| 项 | 值 |
|----|----|
| 阶段标识 | `stage3`（常量 `STAGE_IMAGE`，见 `router.py:34`） |
| 输入 | Stage 2 流式生成的图像提示词文本 |
| 输出 | 生成的藏书票图片 + 本地静态 URL |
| 无 Key 时 | 返回 Mock 占位 SVG |

**要点**：Stage 3 没有独立的系统提示词。`prompt` 直接继承自第二阶段（前端将 Stage 2 生成的文本作为 `prompt` 传入），图像的模型三要素（api_key / base_url / model_name）则通过 `admin/stage-configs` 动态配置。

---

## 二、数据流

```
前端 (BookplatePage)
  │  POST /api/modules/bookplate/generate-image
  │  body: { prompt, size?, ratio?, image? }
  ▼
Router.generate_bookplate_image  (router.py:354)
  │  _resolve_image_config(db)   → StageConfig(module=bookplate, stage=stage3)
  │  请求体参数 size/ratio/image 按次覆盖
  ▼
ImageService.generate_image      (image_service.py:67)
  │  组装请求参数（动态构建，无硬编码默认值）
  ▼
OpenAI 兼容图像 API  (externl, 见 docs/llm-api/图像生成api.md)
  │  返回 b64_json 或 url
  ▼
落盘 backend/static/generated/  →  返回 { "image_url": "...", "mock": false }
```

---

## 三、配置来源（admin/stage-configs）

Stage 3 的模型通过 `admin/stage-configs` 动态配置，后端读取自数据库 `stage_configs` 表：

```python
# router.py —— _resolve_image_config()
sc = (
    db.query(StageConfig)
    .filter(StageConfig.module == "bookplate", StageConfig.stage == STAGE_IMAGE)  # "stage3"
    .first()
)
```

仅使用其中的模型三要素（**不读取 `sc.prompt`，即无系统提示词）**：

| 字段 | 来源 | 说明 |
|------|------|------|
| `api_key` | `sc.llm_config.api_key` | 必填，无 Key 时走 Mock |
| `base_url` | `sc.llm_config.base_url` | OpenAI 兼容端点 |
| `model_name` | `sc.llm_config.model_name` | 如 `agnes-image-2.1-flash` |

> admin API 的 `stage` 字段不限制枚举，`stage3` 完全可配置。admin 端说明见 `frontend/src/admin/pages/StageConfigsPage.tsx`、`backend/app/api/admin/stage_configs.py`。

---

## 四、API 端点

`POST /api/modules/bookplate/generate-image`（需 JWT 登录）

### 请求体

```json
{
  "prompt": "藏书票设计：……（Stage 2 生成的提示词）…",
  "size": "1K",
  "ratio": "1:1",
  "image": ["https://example.com/reference.png"]
}
```

### 请求体字段（`ImageGenRequest`，router.py:187）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 图像生成提示词，直接继承自 Stage 2 |
| `size` | string \| null | 否 | 尺寸档位，如 `1K`、`2K`、`1024x1024` |
| `ratio` | string \| null | 否 | 宽高比，如 `1:1`、`16:9` |
| `image` | string[] \| null | 否 | 图生图参考图 URL 列表；传入即走图生图 |

### 响应体

```json
{
  "image_url": "/static/generated/bookplate_20260808-123456_12345.png",
  "mock": false
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `image_url` | string | 本地静态图片 URL（前端可直接 `<img>` 加载） |
| `mock` | boolean | 是否 Mock 占位图（未配置 API Key 时为 `true`） |

### 错误

- `400`：`prompt` 为空
- `502`：图像生成失败（内部 `ImageGenerationError`），`detail` 为错误原因

---

## 五、参数组装逻辑（如何透传 / 扩展）

核心在 `image_service.generate_image()`（image_service.py:67）。**所有图像参数均无硬编码默认值**，由调用方提供，未提供则不上送，便于后续扩展。

### 当前组装规则

```python
api_kwargs = {
    "model": model_name,
    "prompt": prompt[:4000],
}
if size:
    api_kwargs["size"] = size
if ratio:
    api_kwargs["ratio"] = ratio

# 文生图 vs 图生图：extra_body 参数不同
extra_body = {}
if ref_images:
    extra_body["response_format"] = "b64_json"
    extra_body["image"] = ref_images
else:
    extra_body["return_base64"] = True
api_kwargs["extra_body"] = extra_body

response = await client.images.generate(**api_kwargs)
```

### 参数 → 请求体映射

| `ImageModelConfig` 字段 | 请求体位置 | 说明 |
|--------------------------|------------|------|
| `model` | 顶层 `model` | 来自 StageConfig |
| `prompt` | 顶层 `prompt` | 来自请求体 |
| `size` | 顶层 `size` | 来自请求体 |
| `ratio` | 顶层 `ratio` | 来自请求体 |
| `image` | `extra_body.image` | 有值时走图生图模式 |

> 依据 `图像生成api.md`：
> - **文生图**：使用顶层 `return_base64: true`，不使用 `response_format`
> - **图生图**：`response_format` 与 `image` 必须放在 `extra_body` 内，不能放在请求体顶层
> - 不要传 `tags: ["img2img"]`

### 响应兼容两种格式

最终都统一落盘为本地 PNG 并返回本地 `image_url`：

- `data[0].b64_json` → base64 解码后写盘
- `data[0].url` → 下载该 URL 字节后写盘（预留，当前请求均要求 b64_json 返回）

---

## 六、如何扩展新的图像参数

由于 `generate_image` 采用「动态构建 `**api_kwargs`」的方式，新增参数只需两步，无需改动核心请求逻辑：

### 步骤 1：在 `ImageModelConfig` 增加字段

`image_service.py:18`：

```python
@dataclass
class ImageModelConfig:
    ...
    size: Optional[str] = None
    ratio: Optional[str] = None
    image: Optional[List[str]] = None
    # 新增参数示例
    n: Optional[int] = None          # 生成数量
    seed: Optional[int] = None       # 随机种子
    extra_body: Optional[Dict[str, Any]] = None  # 透传任意额外 extra_body 字段
```

### 步骤 2：在 `generate_image` 中按需组装

```python
if size:
    api_kwargs["size"] = size
if n:
    api_kwargs["n"] = n
if seed:
    api_kwargs["seed"] = seed

# 若需要透传任意额外字段，可合并进 extra_body
if config.extra_body:
    extra_body.update(config.extra_body)
```

### 步骤 3（可选）：在请求体中暴露

`router.py:187` 的 `ImageGenRequest` 增加对应字段，并在 `generate_bookplate_image` 中按次覆盖：

```python
class ImageGenRequest(BaseModel):
    prompt: str
    size: Optional[str] = None
    ratio: Optional[str] = None
    image: Optional[List[str]] = None
    n: Optional[int] = None          # 新增
    seed: Optional[int] = None       # 新增
```

```python
image_config.n = payload.n or image_config.n
image_config.seed = payload.seed or image_config.seed
```

> 约定：所有参数保持「未提供即 None、不硬编码默认值」的透传风格，由前端或底层 API 决定缺失时的行为。

---

## 七、Mock 回退

未配置任何 API Key（`ImageService.api_key` 为空）时，返回一张「纸面文具风」藏书票占位 SVG（`_mock_image`，image_service.py:169）：

```json
{ "image_url": "/static/generated/bookplate_xxx.svg", "mock": true }
```

含标题「藏书票 / BOOKPLATE · EX LIBRIS」、书本线描、提示词节选文本。

---

## 八、相关文件索引

| 文件 | 职责 |
|------|------|
| `backend/app/modules/bookplate/router.py` | 路由、StageConfig 解析、请求合并 |
| `backend/app/services/image_service.py` | 图像 API 调用、参数组装、落盘、Mock |
| `backend/app/models/stage_config.py` | StageConfig 表（模块+阶段绑定模型） |
| `backend/app/models/llm_config.py` | LLMConfig 表（模型三要素） |
| `backend/app/api/admin/stage_configs.py` | admin 端 StageConfig CRUD |
| `frontend/src/admin/pages/StageConfigsPage.tsx` | admin 端 Stage 3 配置界面 |
| `frontend/src/app/routes/BookplatePage.tsx` | 前端调用 `generate-image` 的入口 |
| `docs/llm-api/图像生成api.md` | 外部 Agnes Image 2.1 Flash API 文档 |