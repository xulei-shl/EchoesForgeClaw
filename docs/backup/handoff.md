# BookForge 项目交接文档 (Handoff Document)

## 📌 1. 项目简介
BookForge 是一个基于"无限画布"工作流的智能藏书票生成系统。系统采用独特的**"纸面文具风"**设计规范，结合大语言模型 (LLM) 和 AI 绘画技术 (Stable Diffusion/Midjourney) 提供自动化藏书票生成服务。

## 🚀 2. 当前开发进度概览

项目共分为 6 个开发阶段 (Phase)。目前已完全交付 **Phase 1 - Phase 6**，三阶段工作流（ISBN → 元数据 → AI 提示词 → 图片生成）已全链路打通，bookplate 模块接口已全部接入 JWT 鉴权，管理后台已支持模型 / 提示词 / 阶段绑定 / 系统设置的完整运维。

### ✅ 已完成 (Phase 1 - 6)
* **Phase 1 (基础架构与登录)**：
  * **前端**: React 18 + Vite + TS + Tailwind v4。建立全局 `index.css`（方格纸背景、虚线边框设计系统）。实现 `Button`, `Input`, `Navbar`，完成带拦截器的 `axios` 封装及 `AuthContext`。
  * **后端**: FastAPI + SQLAlchemy + SQLite，实现 JWT 鉴权与管理员账号自初始化逻辑（`admin/admin123`）。
* **Phase 2 (画布引擎与豆瓣 API)**：
  * **前端**: 实现纯原生 `div+transform` 的无限画布系统 `Canvas.tsx` 和基础节点 `CanvasNode.tsx`。
  * **后端**: 将豆瓣 API 爬虫脚本封装为异步 `httpx` 客户端，暴露 `GET /api/modules/bookplate/isbn/{isbn}` 接口。前端实现基于 ISBN 查询并在画布上生成 **Stage 1 (图书元数据)** 节点。
* **Phase 3 (AI 分析与流式提示词)**：
  * **后端**: 接入 `openai` 与 `sse-starlette`，实现大语言模型流式代理接口 (`POST /api/modules/bookplate/generate-prompt`)。支持在无 `OPENAI_API_KEY` 时自动采用 Mock 打字机流。
  * **前端**: 引入 `Streamdown` (及 `@streamdown/cjk`, `@streamdown/code` 插件) 配合 SSE 实现了流式文本与代码渲染；实现了基于 SVG 的节点连线动效 (`NodeEdge.tsx`)；复刻了 `thinking-orbs` 与 `border-beam` 等高级视觉动效。
* **Phase 4 (图像生成与画布最终展示)**：
  * **后端**: 新增 `image_service.py`（OpenAI 兼容图像 API，`images.generate` + b64 落盘）；暴露 `POST /api/modules/bookplate/generate-image`；挂载 `/static` 静态目录提供生成的图片；无 `OPENAI_IMAGE_API_KEY` 时生成**纸面文具风 Mock 藏书票 SVG** 占位图。
  * **前端**: 新增 **Stage 3 节点** `ImageNode.tsx`（图片展示 / 重试 / 收藏 / 删除）；`PromptNode` 增加"生成藏书票"按钮；新增右侧画布操作栏 `CanvasActionBar.tsx`（清空 / 收藏 / 公开 / 导出）；连线锚点改用 `ResizeObserver` 实测节点尺寸（`CanvasNode` 的 `onSizeChange`）。
  * **鉴权（本轮重点）**: bookplate 全部接口要求 `Authorization: Bearer <token>`；登录接口 JSON 化；前端 `/bookplate` 增加路由守卫。
  * **修复的既有问题**: ① SSE 流式失效（原代码用 GET `EventSource` 调 POST 接口）→ 改为 fetch+POST 解析（`sse.ts`）；② `BookInfoNode` 字段映射错位（豆瓣返回 snake_case）→ 已兼容；③ 若干 TS 构建错误 → 已修复，`npm run build` 可正常通过。
* **Phase 5 (历史记录与画廊)**：
  * **后端**: 新增 `Generation` / `Favorite` / `PublicShare` 三个数据模型（`Generation` 含 `module` 字段与 `stage_results` JSON 列）；新增三个通用路由 `/api/generations`（历史 CRUD）、`/api/favorites`（收藏）、`/api/public`（公开画廊）。列表接口统一返回分页信封 `{items, total, skip, limit}`（`limit` 上限 100；排序 `created_at DESC, id DESC` 保证同秒记录翻页稳定）；删除 Generation 时 ORM 级联清理其收藏与公开状态；公开仅限本人记录、收藏可指向他人作品。
  * **前端**: 新增「历史 `/history`」「收藏 `/favorites`」「画廊 `/gallery`」三个私有路由，共用 `GenerationListPage`（无限滚动：每页 20 条、滚动触底加载、骨架屏首屏、空态/错误态/删除后自动续载自愈）+ `GenerationCard` + 右侧滑出式 `GenerationDetailPanel`（收藏 / 公开 / 下载 / 删除）；`ImageNode` 与 `CanvasActionBar` 的**收藏 / 公开**按钮接入真实后端，首次操作时自动把画布三阶段节点沿连线组装为 `stage_results` 保存为 Generation，重新生成图片后旧快照自动失效。
* **Phase 6 (管理后台)**：
  * **后端**: 新增 `LLMConfig` / `PromptTemplate` / `StageConfig` / `AppSetting` 四个数据模型（`StageConfig` 对 `(module, stage)` 唯一，重复绑定自动覆盖）；新增 `/api/admin/*` 全套 CRUD 路由（模型配置 / 提示词模板 / 阶段绑定 / 系统设置），均要求管理员权限；api_key 明文入库但**永不回传**（响应仅 `has_api_key` 标记），修改时留空表示保留原 Key；删除模型/提示词时自动解除 StageConfig 引用。
  * **配置接入实际链路（本轮重点）**: `generate-prompt` 按 `StageConfig` 绑定调用指定文本模型 + 提示词模板（作为 system prompt）；`generate-image` 按绑定调用指定图像模型；**未绑定时自动回退环境变量 → Mock**，兼容 Phase 3/4 行为。豆瓣代理设置（`douban.proxy` / `douban.qps` / `douban.base_url`）存入 `AppSetting` 并即时生效，`douban_client.py` 增加 proxy 支持。
  * **前端**: 新增 `/admin` 管理后台（240px 侧边栏 + 内容区，纸面文具风）：用户管理（新建 / 启用停用 / 重置密码 / 删除，禁止删除当前账号）、模型配置（CRUD + 启用停用 + Key 打码提示）、提示词管理（按模块/阶段筛选）、阶段配置（模型类型按阶段自动过滤，编辑时已绑定项兜底）、系统设置（豆瓣代理等键值）；`AdminRoute` 守卫（非管理员重定向首页），Navbar 管理员可见「管理后台」入口。
  * **修复的既有问题**: ① `HomePage` 未使用变量导致 `tsc` 构建报错 → 已修复；② 阶段配置 PATCH 修改 module/stage 可能触发唯一约束冲突返回 500 → 已加查重并返回友好 400。
  * **开发模式**: 后端启动命令统一为 `uvicorn app.main:app --reload`（热重载已实测生效），`.env.example` 补充了环境变量 vs 管理后台的配置优先级说明。

---

## 🛠️ 3. 技术栈与环境配置

### 前端 (Frontend)
* **路径**: `frontend/`
* **启动**: `npm install && npm run dev` (运行于 http://localhost:5173)
* **代理**: 配置在 `vite.config.ts` 中，`/api` 与 `/static` 请求均转发至后端的 `8000` 端口。
* **核心状态**:
  * Auth 状态: `src/platform/stores/authStore.tsx`（登录态持久化在 localStorage 的 `token` / `user`）
  * Canvas 状态: 维护在 `src/app/routes/BookplatePage.tsx` 内部的 `nodes` / `edges` / `nodeSizes` 中。
  * 路由守卫: `/bookplate` 为私有路由（`App.tsx` 的 `PrivateRoute`），未登录自动跳转 `/login` 并在登录后跳回原页面。

### 后端 (Backend)
* **路径**: `backend/`
* **环境**: Python 3.10+
* **启动**: `pip install -r requirements.txt && uvicorn app.main:app --reload` (运行于 http://127.0.0.1:8000)
* **配置**: 请在 `backend/` 下新建 `.env` 文件（参考 `.env.example`）。
  ```ini
  SECRET_KEY=your_super_secret_jwt_key
  # 文本大模型（留空则启用 Mock 打字机流）
  OPENAI_API_KEY=your_openai_key
  # 图像生成（OpenAI 兼容 API；留空则启用 Mock 占位图）
  OPENAI_IMAGE_API_KEY=your_image_api_key
  OPENAI_IMAGE_BASE_URL=          # 可选，兼容第三方服务
  OPENAI_IMAGE_MODEL=dall-e-3     # 可选
  ```
* **配置优先级（Phase 6 起）**：模型/提示词/阶段配置**优先走管理后台**（存数据库 `LLMConfig` / `PromptTemplate` / `StageConfig` 表）；环境变量仅作为「未绑定阶段配置时的回退项」；两者皆无 Key 时启用 Mock。首次启动自动创建默认管理员账号 `admin/admin123`，并写入默认系统设置（`douban.base_url` / `douban.qps` / `douban.proxy`）。
* **生成的图片**保存在 `backend/static/generated/`，通过 `/static/generated/{filename}` 访问（公开，无需鉴权）。建议将该目录加入 `.gitignore`。

---

## 📡 4. API 接口文档

> **鉴权约定**：除 `POST /api/auth/login` 外，所有接口均需请求头 `Authorization: Bearer <token>`。未登录/过期返回 `401`。登录返回的 `user` 含 `id / username / role / is_active / created_at`。

### 4.1 认证与用户
| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/auth/login` | 公开 | JSON `{username, password}` → `{token, user}` |
| GET | `/api/users/me` | 登录用户 | 当前用户信息 |
| GET | `/api/users` | 管理员 | 用户列表 |
| POST | `/api/users` | 管理员 | 创建用户 `{username, password, role, is_active}` |
| PATCH | `/api/users/{id}` | 管理员 | 修改用户（含重置密码） |
| DELETE | `/api/users/{id}` | 管理员 | 删除用户 |

### 4.2 藏书票模块（均需鉴权）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/modules/bookplate/isbn/{isbn}` | 豆瓣图书元数据（snake_case 字段：`title` / `author` / `publisher` / `pub_year` / `cover_image` / `summary` / `rating` 等）；未收录返回 404 |
| POST | `/api/modules/bookplate/generate-prompt` | 流式生成提示词。请求 `{metadata: {...}}`，响应 `text/event-stream`，每条事件 `data: <文本块>`；流结束即连接关闭 |
| POST | `/api/modules/bookplate/generate-image` | 生成藏书票。请求 `{prompt: "..."}` → `{image_url: "/static/generated/xxx.png", mock: bool}`；无 API Key 时 `mock: true`（SVG 占位图）；空 prompt 返回 400 |

### 4.3 静态资源
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/static/generated/{filename}` | 生成的藏书票图片（公开访问） |

### 4.4 SSE 流式约定（重要）
* 前端通过 `fetch + ReadableStream` 手动解析（浏览器 `EventSource` 仅支持 GET），封装在 `frontend/src/platform/services/sse.ts` 的 `postSSEStream(url, {body, onChunk, signal})`。
* **Windows 注意**：SSE 流为 `\r\n` 行尾，解析器已归一化为 `\n` 后再按空行切分事件（勿回退为 `split('\n\n')` 直接解析）。
* 该 fetch 请求已携带 `Authorization` 头并处理 401（与 axios 拦截器行为一致）。

### 4.5 历史 / 收藏 / 画廊（Phase 5，均需鉴权）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/generations` | 保存一次画布生成结果 `{module, stage_results, final_image_url, status}` → 完整 Generation |
| GET | `/api/generations` | 我的历史记录，`?skip=&limit=&module=` → 分页信封 |
| GET | `/api/generations/{id}` | 单条历史详情（含 `is_favorited` / `is_public` 标记） |
| DELETE | `/api/generations/{id}` | 删除我的记录（级联清理收藏与公开状态） |
| POST | `/api/favorites` | 收藏 `{generation_id}`（幂等，可收藏画廊中他人作品） |
| GET | `/api/favorites` | 我的收藏（含生成记录内容）→ 分页信封 |
| DELETE | `/api/favorites/{generation_id}` | 取消收藏 |
| POST | `/api/public` | 公开自己的记录 `{generation_id}`（幂等） |
| GET | `/api/public` | 公开画廊（含分享者 `username`）→ 分页信封 |
| DELETE | `/api/public/{generation_id}` | 从画廊撤下（仅本人） |

**分页约定**：三个列表接口均返回 `{items, total, skip, limit}` 信封；`limit` 上限 100；排序 `created_at DESC, id DESC`。前端每页请求 20 条，滚动触底追加。

### 4.6 管理后台（Phase 6，仅管理员，未授权返回 403）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/llm-configs` | 模型配置列表（响应不含 api_key，仅 `has_api_key` 标记） |
| POST | `/api/admin/llm-configs` | 新建模型配置 `{name, kind: text\|image, api_key, base_url, model_name, is_active}` |
| PATCH | `/api/admin/llm-configs/{id}` | 修改模型配置；`api_key` 留空/缺省表示保留原 Key |
| DELETE | `/api/admin/llm-configs/{id}` | 删除模型配置（引用它的阶段绑定自动置空） |
| GET | `/api/admin/prompts` | 提示词模板列表（可按 `?module=&stage=` 过滤） |
| POST | `/api/admin/prompts` | 新建提示词模板 `{name, module, stage, content, is_active}` |
| PATCH | `/api/admin/prompts/{id}` | 修改提示词模板 |
| DELETE | `/api/admin/prompts/{id}` | 删除提示词模板（引用它的阶段绑定自动置空） |
| GET | `/api/admin/stage-configs` | 阶段绑定列表（可按 `?module=` 过滤；含 `llm_config_name` / `prompt_name`） |
| POST | `/api/admin/stage-configs` | 创建阶段绑定 `{module, stage, llm_config_id, prompt_id}`；同一 `(module, stage)` 重复提交自动覆盖 |
| PATCH | `/api/admin/stage-configs/{id}` | 修改阶段绑定；若修改 `module/stage` 与他人冲突返回 400 |
| DELETE | `/api/admin/stage-configs/{id}` | 删除阶段绑定（回退环境变量/Mock） |
| GET | `/api/admin/settings` | 系统设置列表（豆瓣代理等键值） |
| POST | `/api/admin/settings` | 新建设置 `{key, value, description}`（key 重复自动覆盖） |
| PUT | `/api/admin/settings/{key}` | 修改设置值/说明 |
| DELETE | `/api/admin/settings/{key}` | 删除设置项 |

> **阶段标识约定**：`stage2` = 文本提示词生成（绑定 kind=`text` 模型），`stage3` = 图片生成（绑定 kind=`image` 模型）。`llm_config_id` / `prompt_id` 传 `null` 表示不绑定（回退环境变量/内置默认）。

---

## 🏗️ 5. 代码结构导航

### 核心架构图
```text
BookForge/
├── backend/
│   ├── app/
│   │   ├── api/            # auth, users, generations, favorites, public
│   │   │   └── admin/      # llm_configs, prompts, stage_configs, settings（Phase 6）
│   │   ├── core/           # JWT, 数据库配置, Config, deps
│   │   ├── models/         # user, generation, favorite, public_share, llm_config, prompt_template, stage_config, app_setting
│   │   ├── modules/
│   │   │   └── bookplate/  # router, douban_client（支持 proxy 设置）
│   │   ├── services/       # llm_service.py, image_service.py（支持运行时配置注入）
│   │   └── schemas/        # auth, user, generation, admin
│   ├── static/generated/   # 生成的藏书票图片（运行时产物）
│   └── .env.example
├── frontend/
│   └── src/
│       ├── admin/          # 管理后台（Phase 6）：AdminLayout + pages/（Users, LlmConfigs, Prompts, StageConfigs, Settings）+ components/AdminBits
│       ├── platform/       # 基础组件层
│       │   ├── components/ # canvas/, node/, layout/, ui/, gallery/（GenerationCard + GenerationDetailPanel）
│       │   ├── services/   # api.ts (axios), auth.ts, sse.ts, generations.ts, admin.ts
│       │   ├── stores/     # authStore.tsx
│       │   ├── types/      # 公共类型（含 Generation / GenerationPage / LLMConfig / PromptTemplate / StageConfig / AppSetting）
│       │   └── utils/      # format.ts, generation.ts
│       ├── modules/        # 业务组件层
│       │   └── bookplate/  # BookInfoNode, PromptNode, ImageNode, CanvasActionBar, IsbnInput
│       └── app/            # 路由层 (HomePage, LoginPage, BookplatePage, GenerationListPage, /admin) + 路由守卫
```

### 关键设计决策 (ADR)
1. **画布系统**：未采用 ReactFlow，而是手动实现了 `transform` 平移缩放和绝对定位节点。接手者需注意 `CanvasContext` 中的 `scale` 参数，所有的拖拽计算都需除以 `scale`。
2. **连线锚点**：节点实际尺寸通过 `CanvasNode` 的 `ResizeObserver`（`borderBoxSize`）上报给 `BookplatePage.nodeSizes`，边连接源节点底部中心 → 目标节点顶部中心。
3. **样式隔离**：UI 强制要求"文具纸张风"。开发新组件时，请复用 `index.css` 中已定义的 css 变量和 `@theme` 颜色 (如 `var(--color-paper)`, `var(--color-ink)`)，禁止过度使用阴影 (box-shadow) 或玻璃态。
4. **TS 类型依赖**：导入 TS 类型时，请强制使用 `import type { ... }` 语法，防止 Vite 的 ESBuild 报 module 缺失错。
5. **鉴权**：登录接口为 **JSON** 格式（非 OAuth2 表单），前端 axios 拦截器与 `postSSEStream` 均携带 `Authorization` 头；401 时清空本地登录态并跳转 `/login`（记录来源页，登录后跳回）。
6. **配置优先级**：模型/提示词配置统一走「管理后台（数据库）> 环境变量 > Mock」三级回退。`llm_service.generate_prompt_stream` / `image_service.generate_image` 接受运行时配置对象（`TextModelConfig` / `ImageModelConfig`），由 `bookplate/router.py` 的 `_resolve_text_config` / `_resolve_image_config` 从 StageConfig 解析；新增模块时复用该模式。
7. **api_key 安全**：LLMConfig 的 api_key 明文存库（本地开发可接受），但**任何接口不得回传**——新增查询接口请复用 `llm_configs.py` 的 `_to_out`（仅返回 `has_api_key`）。
8. **管理后台守卫**：前端 `/admin/*` 由 `AdminRoute` 拦截（`user.role !== 'admin'` 重定向首页），后端 `/api/admin/*` 由 `get_current_admin_user` 兜底（403），两端缺一不可。

## 📞 6. 给接手者的建议

* 工作流数据结构（`NodeData` / `EdgeData`）集中在 `frontend/src/app/routes/BookplatePage.tsx`，一目了然。
* **Phase 5 已实现**，接手时参考：列表分页信封与统一响应组装在 `backend/app/api/generations.py`（`_to_out` 计算 `is_favorited` / `is_public`）；前端无限滚动 + 骨架屏 + 详情面板在 `frontend/src/app/routes/GenerationListPage.tsx` 与 `platform/components/gallery/`。画布「收藏/公开」的保存快照逻辑在 `BookplatePage.tsx` 的 `buildStageResults` / `ensureGeneration`（沿连线回溯组装三阶段数据，`generationIds` 缓存节点→Generation id，重试/清空后失效）。
* **Phase 6 已实现**，接手时参考：后端 admin 路由在 `backend/app/api/admin/`（`llm_configs.py` 的 `_to_out` 是 api_key 脱敏的参考实现）；前端管理后台在 `src/admin/`，通用交互（表格/表单/开关/徽章）复用 `components/AdminBits.tsx`。
* **配置生效链路**：生成接口每次请求时实时解析 StageConfig（未加缓存），因此管理后台的修改**即时生效、无需重启**；若未来做缓存需注意失效时机。
* **管理后台使用**：登录 `admin/admin123` → 顶部导航「管理后台」。先建「模型配置」（文本/图像各一），再建「提示词管理」模板，最后在「阶段配置」把 bookplate 的 stage2/stage3 绑定到对应模型与提示词；「系统设置」可配豆瓣代理。未绑定任何配置时，画布仍按环境变量/Mock 正常工作。
* **api_key 安全提示**：LLMConfig.api_key 明文存库，本地开发可接受；若部署到共享环境，建议先加密存储（如用 SECRET_KEY 做对称加密，模型字段改为 `api_key_enc`）再交付。
* 图片生成接口调用较慢（真实 API 可达 30-60s），前端已对该请求单独设置 180s 超时（全局 axios 为 10s），新增相关接口时注意超时配置。
* 画布上**收藏/公开/导出**操作的对象是"最近生成"的第三阶段图片（`BookplatePage` 内按节点顺序取最后一个 `image` 节点）。
* 豆瓣接口有反爬限制（QPS ≤ 0.5），多人并发时是首要瓶颈；`douban_client.py` 内置了限流与重试，不要绕过。

祝开发顺利！
