# BookForge（书海回响素材工坊）

**BookForge** 是「书海回响」项目的素材生成辅助平台。当前第一个模块为**藏书票生成**，后续可扩展其他图片类素材生成模块。平台提供统一的画布工作流、AI Pipeline、用户系统与管理后台。

> Book = 图书领域，Forge = 锻造/工坊，呼应藏书票的手作、文艺气质，并预留多模块扩展空间。

---

## 特性

- **Platform + Module 两层架构**：平台层提供画布、节点、SSE 流式通信、认证、历史/收藏等公共能力；新增模块只需注册前端 `ModuleDefinition` + 后端 Router，不改动平台层。
- **藏书票三阶段流程**：
  1. ISBN → 豆瓣 API → 图书元数据 + 封面图（纯展示）
  2. AI 分析（文本 + 多模态）→ 生成藏书票图像系统提示词（Markdown 流式、可编辑）
  3. 系统提示词 → 图像生成模型 → 藏书票图片
- **AI 模型统一代理**：文本 / 多模态 / 图像生成均通过 OpenAI 兼容 API，可在管理后台配置模型与提示词；未配置时回退到环境变量或 Mock。
- **用户与权限**：JWT 认证，普通用户 / 管理员角色隔离。
- **数据管理**：生成历史、收藏、公开分享列表与详情。
- **管理后台**：LLM 配置、提示词模板、阶段配置、系统设置。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 · Vite · TypeScript · Tailwind CSS · React Router |
| 后端 | TypeScript · Fastify · Drizzle ORM · SQLite（开发）/ PostgreSQL（生产） |
| 通信 | REST API + SSE（流式输出） |
| 认证 | JWT（@fastify/jwt + bcryptjs） |
| 流式 Markdown | ai SDK + @streamdown/cjk |
| 图标 | lucide-react |

---

## 目录结构

```
BookForge/
├── backend-ts/             # Fastify 后端 (TypeScript)
│   ├── src/
│   │   ├── api/            # 平台层 API（auth / users / generations / favorites / public / admin）
│   │   ├── core/           # 配置、数据库、安全、存储
│   │   ├── db/             # Drizzle schema + migrations
│   │   ├── modules/        # 模块层（bookplate 藏书票）
│   │   ├── services/       # LLM 调用代理、SSE 工具
│   │   └── server.ts       # 应用入口
│   ├── static/             # 生成的图片静态目录
│   └── package.json
├── frontend/               # React 前端
│   ├── src/
│   │   ├── app/            # 入口、路由、Provider
│   │   ├── platform/       # 平台层（画布、节点、流式 Markdown 等）
│   │   ├── modules/        # 模块层（bookplate 等）
│   │   └── admin/          # 管理后台
│   └── package.json
└── docs/                   # 设计方案、需求、参考素材
```

---

## 快速开始

### 后端

```bash
cd backend-ts

# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，至少设置 SECRET_KEY

# 3. 启动服务（默认 http://localhost:8000）
npm run dev
```

启动时会自动创建数据库表，并创建默认管理员账号 **admin / admin123**（登录后请尽快修改）。

### 前端

```bash
cd frontend

# 1. 安装依赖
npm install

# 2. 启动开发服务器（默认 http://localhost:5173）
npm run dev
```

前端通过 Vite 代理将 `/api` 与 `/static` 请求转发到 `http://localhost:8000`（后端地址）。

---

## 环境变量（后端）

复制 `backend-ts/.env.example` 为 `backend-ts/.env` 并填写：

| 变量 | 说明 |
|------|------|
| `SECRET_KEY` | JWT 签名密钥（必填） |
| `DATABASE_URL` | 数据库连接（默认 `sqlite:///./bookforge.db`） |
| `OPENAI_API_KEY` | 文本大模型 Key（留空启用 Mock） |
| `OPENAI_IMAGE_API_KEY` | 图像生成 Key（留空启用 Mock） |
| `OPENAI_IMAGE_BASE_URL` | 图像生成 API 地址 |
| `OPENAI_IMAGE_MODEL` | 图像生成模型（如 `dall-e-3`） |
| `PORT` | 监听端口（默认 `8010`） |
| `CORS_ORIGINS` | 前端 CORS 来源（逗号分隔） |

> 模型 / 提示词 / 阶段配置优先在管理后台配置（存入数据库）。环境变量仅作为未绑定阶段配置时的回退；两者都无 Key 时启用 Mock（文本打字机流 / SVG 占位图）。

---

## 脚本

**后端**
```bash
npm run dev        # 开发运行（http://localhost:8000）
```

**前端**
```bash
npm run dev        # 开发服务器
npm run build      # 类型检查 + 生产构建
npm run preview    # 预览构建产物
npm run lint       # oxlint 代码检查
```

---

## 其他

- 设计文档与需求参见 [`docs/`](./docs)（`design_analysis.md`、`初始需求.md` 等）。
- 豆瓣 API 无需 Key，但受反爬与速率限制（建议 QPS ≤ 0.5），相关设置在管理后台「系统设置」中可调。

---

## License

详见仓库许可证文件（如有）。
