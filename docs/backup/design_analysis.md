# 🥷 BookForge（书海回响素材工坊）— 最终设计方案

## 一、产品定位

**Building**：「书海回响」项目的素材生成辅助平台。当前第一个模块为**藏书票生成**，后续将扩展其他图片类素材生成模块。平台提供统一的画布工作流、AI Pipeline、用户系统和管理后台。

**Not Building**：
- 不是通用图片生成工具（围绕图书推荐场景的素材生成）
- 不是电商/社交平台
- 不是「书海回响」主站本身（是辅助工具）

**项目名称**：`BookForge`
- 含义："Book" 对应图书领域，"Forge" 意为锻造/工坊，暗示手工打磨素材的工艺感
- 与藏书票的手作、文艺气质吻合
- 足够通用，适应后续添加其他素材模块
- npm 包名/路由前缀统一用 `bookforge`

---

## 二、核心架构：Platform + Module 两层设计

> [!IMPORTANT]
> 这是本方案最关键的架构决策。藏书票只是第一个模块，设计上必须让「添加新模块」的成本降到最低。

### 2.1 分层架构

```
┌────────────────────────────────────────────────────────┐
│                    Module Layer                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  藏书票模块   │  │  未来模块 A  │  │  未来模块 B  │  │
│  │ (bookplate)  │  │              │  │              │  │
│  │ 定义：       │  │              │  │              │  │
│  │ · 阶段配置   │  │              │  │              │  │
│  │ · 节点渲染   │  │              │  │              │  │
│  │ · 后端逻辑   │  │              │  │              │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
├────────────────────────────────────────────────────────┤
│                    Platform Layer                       │
│  ┌────────────────────────────────────────────────────┐ │
│  │ 公共组件                                           │ │
│  │ · 画布系统（方格纸背景、打孔效果、节点拖动、连线）   │ │
│  │ · 节点框组件（光晕边框、操作按钮栏、状态指示）       │ │
│  │ · AI Pipeline SSE 通信层                           │ │
│  │ · 流式 Markdown 渲染/编辑                          │ │
│  │ · 图片展示/导出组件                                 │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │ 公共服务                                           │ │
│  │ · 用户认证 (JWT)                                   │ │
│  │ · 历史/收藏/公开 通用 CRUD                          │ │
│  │ · LLM 模型配置 & 调用代理                           │ │
│  │ · 提示词模板管理                                    │ │
│  │ · 文件存储抽象层                                    │ │
│  └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

### 2.2 模块注册机制

每个模块只需提供：

**前端侧**（一个模块定义对象）：
```typescript
interface ModuleDefinition {
  id: string;                    // 'bookplate'
  name: string;                  // '藏书票'
  icon: LucideIcon;              // 模块图标
  stages: StageDefinition[];     // 阶段定义（节点类型、渲染组件、操作按钮）
  inputComponent: React.FC;      // 初始输入组件（如 ISBN 输入框）
}
```

**后端侧**（一个 FastAPI Router）：
```python
# modules/bookplate/router.py
router = APIRouter(prefix="/api/modules/bookplate", tags=["bookplate"])
```

> 新增模块 = 前端注册一个 `ModuleDefinition` + 后端新增一个 Router，不改动平台层代码。

### 2.3 扩展点分析

| 平台层公共能力 | 模块层自定义点 |
|--------------|--------------|
| 画布渲染引擎 | 每个节点内部的渲染组件 |
| 节点拖动/连线 | 阶段数量和拓扑关系 |
| SSE 流式通信 | 每步的 AI 调用逻辑 |
| 历史/收藏/公开 CRUD | 结果的展示格式 |
| 模型/提示词配置 | 每步绑定哪个模型+提示词 |
| 文件存储 | 产物的文件类型和大小 |

---

## 三、已确认的核心流程（藏书票模块）

### 3.1 三阶段流程

```
┌──────────────┐     ┌─────────────────────────────┐     ┌─────────────────┐
│  第一阶段     │────▶│       第二阶段               │────▶│    第三阶段       │
│ ISBN→元数据   │     │ AI 分析 + 生成图像系统提示词  │     │ 根据提示词生成    │
│ 封面+信息展示  │     │ (Markdown 流式，可编辑)       │     │ 藏书票图片       │
└──────────────┘     └─────────────────────────────┘     └─────────────────┘
```

**第一阶段（纯展示，无 AI）：**
- 用户输入 ISBN → 调用豆瓣 API → 获取图书元数据 + 封面图
- 画布组件框内**左右布局**：左侧封面图，右侧核心元数据
- 操作按钮：重试、导出、下一步

**第二阶段（多步 AI 调用）：**

```
                      ┌──────────────────┐
                      │   图书元数据      │
                      │   + 封面图 URL    │
                      └────────┬─────────┘
                    ┌──────────┴──────────┐
                    ▼                     ▼
          ┌─────────────────┐   ┌─────────────────┐
          │ 步骤A：文本模型   │   │ 步骤B：多模态模型 │
          │ 分析元数据       │   │ 分析封面图片     │
          │ (主题/情感/特征) │   │ (主题色/视觉元素) │
          └────────┬────────┘   └────────┬────────┘
                   └──────────┬──────────┘
                              ▼
                    ┌─────────────────┐
                    │ 步骤C：文本模型   │
                    │ 合并A+B结果      │
                    │ 生成图像系统提示词│
                    │ (Markdown 流式)  │
                    └─────────────────┘
```

- 产物：**藏书票图像生成系统提示词**（Markdown，可编辑保存）
- 操作按钮：重试、下一步

**第三阶段（图像生成）：**
- 将第二阶段的系统提示词 → 调用图像生成模型 → 生成藏书票图片
- 操作按钮：重试、收藏、删除

> 所有步骤的模型/提示词均通过管理员界面配置，统一 OpenAI API 兼容格式。

---

## 四、技术栈（全部确认）

```
前端: React 18+ / Vite / TypeScript / Tailwind CSS
后端: Python / FastAPI / SQLAlchemy / Alembic / SQLite (dev) → PostgreSQL (prod)
通信: REST API + SSE (流式输出)
认证: JWT
图标: Lucide Icons (ISC 许可，1700+ 图标，React 原生支持)
UI 特效:
  - 流式 Markdown: streamdown + @streamdown/cjk
  - AI 思考动效: thinking-orbs
  - 等待光晕边框: border-beam
```

---

## 五、前端目录结构设计

```
src/
├── app/                          # 应用入口、路由、全局 Provider
│   ├── routes/
│   └── App.tsx
├── platform/                     # 平台层公共能力
│   ├── components/               # 公共 UI 组件
│   │   ├── canvas/               #   画布系统（背景、拖动、连线）
│   │   ├── node/                 #   节点框（光晕、操作栏、状态）
│   │   ├── stream-markdown/      #   流式 Markdown 渲染/编辑
│   │   ├── image-viewer/         #   图片展示/导出
│   │   └── layout/               #   页面布局（导航、侧边栏）
│   ├── hooks/                    # 公共 Hooks（useSSE, useDrag 等）
│   ├── services/                 # API 客户端（auth, history, favorites）
│   ├── stores/                   # 全局状态（用户、模块注册表）
│   └── types/                    # 公共类型定义
├── modules/                      # 模块层
│   └── bookplate/                # 藏书票模块
│       ├── components/           #   模块专属组件
│       │   ├── IsbnInput.tsx     #     ISBN 输入组件
│       │   ├── BookInfoNode.tsx  #     第一阶段节点渲染
│       │   ├── PromptNode.tsx    #     第二阶段节点渲染
│       │   └── ImageNode.tsx     #     第三阶段节点渲染
│       ├── services/             #   模块 API 调用
│       ├── definition.ts         #   模块注册定义
│       └── index.ts
└── admin/                        # 管理后台
    ├── users/
    ├── llm-config/
    ├── prompts/
    └── stage-config/
```

## 六、后端目录结构设计

```
app/
├── main.py                       # FastAPI 入口
├── core/                         # 平台层核心
│   ├── config.py                 #   配置
│   ├── database.py               #   数据库连接
│   ├── security.py               #   JWT、密码哈希
│   ├── deps.py                   #   依赖注入
│   └── storage.py                #   文件存储抽象层
├── models/                       # SQLAlchemy 模型
│   ├── user.py
│   ├── llm_config.py
│   ├── prompt_template.py
│   ├── stage_config.py
│   ├── generation.py             #   生成记录（含 module 字段）
│   ├── favorite.py
│   └── public_share.py
├── schemas/                      # Pydantic 请求/响应模型
├── api/                          # 平台层 API
│   ├── auth.py
│   ├── users.py
│   ├── history.py                #   通用历史 CRUD（按 module 过滤）
│   ├── favorites.py
│   ├── public.py
│   └── admin/
│       ├── llm_config.py
│       ├── prompts.py
│       └── stage_config.py
├── services/                     # 平台层服务
│   ├── llm_service.py            #   统一的 LLM 调用代理
│   └── sse.py                    #   SSE 流式响应工具
├── modules/                      # 模块层
│   └── bookplate/
│       ├── router.py             #   藏书票 API 路由
│       ├── service.py            #   三阶段业务逻辑
│       └── douban_client.py      #   豆瓣 API 客户端
└── migrations/                   # Alembic 迁移
```

---

## 七、数据模型

```
User             (id, username, password_hash, role, is_active, created_at)

LLMConfig        (id, name, api_key_enc, base_url, model_name, is_active, created_at)
PromptTemplate   (id, key, name, module, stage, content, is_active, created_at)
> **`key` 字段**为系统种子身份标识（如 `bookplate.stage2.default`），可空、唯一，仅启动写入使用；用户创建/编辑不涉及，避免因 name 可编辑导致默认提示词重复写入
StageConfig      (id, module, stage, llm_config_id, prompt_id)

BookMetadata     (id, isbn, title, author, publisher, pub_year, rating,
                  cover_url, summary, raw_json, created_at)

Generation       (id, user_id, module, book_metadata_id,
                  stage_results JSON,    -- 各阶段结果（灵活存储）
                  final_image_url,       -- 最终产物图片
                  status, created_at)

Favorite         (id, user_id, generation_id, created_at)
PublicShare       (id, user_id, generation_id, created_at)
```

> **`module` 字段**贯穿 `PromptTemplate`、`StageConfig`、`Generation` 三个表，是多模块扩展的核心维度。

> **`stage_results`** 用 JSON 字段存储各阶段的中间结果，不同模块的阶段数量和数据结构不同，JSON 比固定列更灵活。对藏书票模块，内容为：
> ```json
> {
>   "stage1": { "isbn": "...", "book_metadata_id": 123 },
>   "stage2": { "analysis_a": "...", "analysis_b": "...", "prompt": "..." },
>   "stage3": { "image_url": "..." }
> }
> ```

---

## 八、关键设计决策总结

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| 1 | 架构分层 | Platform + Module 两层 | 藏书票是第一个模块，必须预留扩展性 |
| 2 | 画布实现 | 自实现 (div + CSS transform + SVG) | 场景简单（3 节点固定拓扑），避免重度依赖 |
| 3 | 流式 Markdown | streamdown + @streamdown/cjk | 需求指定，Vercel 出品，质量可靠 |
| 4 | 图标库 | Lucide Icons | ISC 开源许可，无使用数量限制，React 原生支持 |
| 5 | 阶段结果存储 | JSON 字段 | 不同模块阶段数/结构不同，JSON 最灵活 |

**最脆弱假设**：假设所有素材生成模块都适用「线性多阶段 Pipeline + 画布可视化」的范式。如果未来某个模块的工作流是非线性（如分支/循环），需要升级画布系统。但当前设计通过 `StageDefinition` 数组已预留拓扑扩展空间。

---

## 九、风险分析

### 外部依赖失败

| 依赖 | 故障场景 | 降级策略 |
|------|---------|---------|
| **豆瓣 API** | 被反爬封禁、接口变更 | 本地缓存已查询的 ISBN 数据；手动输入元数据备选入口 |
| **大模型 API** | 超时、余额不足 | 管理员可配置多个模型 + 提示词，前端显示明确错误 |
| **图片生成 API** | 内容安全过滤拒绝 | 重试 + 用户可编辑提示词后重新生成 |

### 10x Scale 断裂点

- 豆瓣 API QPS 限制 (0.5/s)：多用户同时查询时需排队，首先瓶颈
- 大模型并发：每次生成涉及 3 次 AI 调用 + 1 次图片生成，延迟和成本可观

---

## 十、分阶段交付

| 阶段 | 交付内容 | 独立可用 |
|------|---------|---------|
| **Phase 1** | 项目脚手架 + 登录 + 用户管理 + 数据库 + Platform 层骨架 | 基础平台运行 |
| **Phase 2** | 画布系统 + 藏书票第一阶段（ISBN→豆瓣→展示） | 可查询图书 |
| **Phase 3** | 第二阶段（AI 分析 → 系统提示词生成） | 可生成提示词 |
| **Phase 4** | 第三阶段（提示词 → 图片生成） | 完整流程 |
| **Phase 5** | 历史/收藏/公开列表 + 详情面板 | 数据管理 |
| **Phase 6** | 管理后台（模型/提示词/阶段配置） | 运维可用 |

---

## 十一、所需凭证清单

| 依赖 | 说明 | 阶段 |
|------|------|------|
| 豆瓣 API | 无需 Key，需 Referer 和反爬策略 | Phase 2 |
| OpenAI 兼容 API Key(s) | 管理员后台配置，文本/多模态/图像生成 | Phase 3-4 |

---

## 十二、验证计划

### 自动化测试
- ISBN 标准化、豆瓣 API 映射
- 数据模型 CRUD + module 维度过滤
- JWT 认证 + 权限隔离

### 集成测试
- 三阶段流水线端到端（mock AI 响应）
- SSE 流式推送正确性

### 手动验证
- 画布拖动/连线跟随
- 流式 Markdown 渲染 + 编辑切换
- 光晕边框动画效果
- 管理员 vs 普通用户权限
- 响应式布局
