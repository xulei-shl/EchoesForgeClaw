# Mascot Agent（智能画布助手）架构设计与实现方案

## 1. 概述与设计定位

本方案旨在现有 Mascot（画板吉祥物浮动挂件）基础上，新增 **Canvas Assistant（智能画布助手）** 模块。
用户点击吉祥物工具栏中的「Agent」按钮后，在右侧滑出悬浮对话面板，通过 **pi-agent 多租户 RPC 体系** 与大模型进行多轮对话，实现：

1. **需求理解与单节点推荐（含参数推荐）**：理解用户创作意图，从系统内置的 **33 个默认节点** 中精准推荐最匹配的节点及具体参数，经用户确认后自动在画布上创建。
2. **简单的多节点接线辅助**：根据声明式端口规则（`text`、`image`、`document` 等），在创建节点后引导并自动完成上游到下游的正确连线。
3. **全场景反馈直达企业微信（`canvas_send_feedback`）**：
   - 4 类受管自定义 AI 节点（`image_analysis`、`text_generation`、`image_generation`、`chat`）无法由普通用户随意创建，当用户提出定制模型、特定提示词或深度 AI 需求时，Agent 主动协助梳理参数并推送到管理员微信审批/配置；
   - **全场景诉求**：任何时候只要用户提出产品建议、新节点/新功能/新数据源诉求、操作故障或 Bug 报告、以及主动要求“帮我反馈给管理员”，Agent 均可调用此工具将需求结构化整理并推送到企业微信。

---

## 2. 画板节点全景与边界划分

系统当前节点分为两大阵营：**33 个默认内置节点** vs **4 类受管自定义 AI 节点**。

### 2.1 33 个默认内置节点（Agent 负责推荐、调参、创建）

无需后台单独配置模型与 API Key，任意用户可无门槛创建并运行：

| 分类 | 数量 | 节点类型 (`type`) | 典型参数与能力 |
| :--- | :---: | :--- | :--- |
| **输入类** | **5** | • `book_info`（图书元数据）<br>• `text`（文本输入）<br>• `image_upload`（图片加载）<br>• `prompt_search`（提示词检索）<br>• `skill_search`（Skill 检索） | `isbn`（ISBN号）、`content`（Markdown内容）、`imageUrl`（预加载图片） |
| **文本工具类** | **7** | • `text_aggregate`（文本聚合）<br>• `calendar`（万年历）<br>• `weather`（天气查询）<br>• `zhihu_search`（知乎检索）<br>• `wikipedia_search`（维基检索）<br>• `text_translation`（文本翻译）<br>• `web_search`（网络搜索） | `template`（占位符 `{别名}`）、`city`（查询城市）、`date`（日期）、`engine`（翻译引擎/搜索源） |
| **多模态工具类** | **19** | • **图片检索**：`image_search`、`nasa_image_search`<br>• **地图生成**：`map_poster`、`map_art`<br>• **传统文化**：`pattern_search`（纹样）、`color_search`（配色）<br>• **排版印刷**：`receipt_printer`（小票）、`book_card`（图书卡片）、`editorial_layout`（杂志排版）、`journal_maker`（手账制作）、`text_image`（文本成图）<br>• **图像加工**：`sticker_maker`（贴纸）、`stamp_cutter`（邮票）、`image_bg_remove`（抠图）、`image_process`（滤镜处理）<br>• **艺术质感**：`oil_paint`（油画）、`emboss_foil`（微浮雕）、`glass_refract`（玻璃折射）、`watercolor_brush`（水彩）、`ink_wash`（水墨） | 拥有丰富预设（如玻璃 9 款、浮雕 8 款、水彩 12 构图、水墨 8 意境、书卡 20 模板等） |
| **GLAM 工具类** | **2** | • `art_image_search`（艺术图片检索，13家博物馆）<br>• `vufind_call_number`（VuFind 索书号检索） | `source`（指定博物馆来源）、`isbn` |

### 2.2 4 类受管自定义 AI 节点（普通用户不可直接硬建，触发反馈直达微信）

| 节点类型 | 说明 | 为什么普通用户不能直接创建 | Agent 处理策略 |
| :--- | :--- | :--- | :--- |
| `image_analysis` | 多模态视觉分析 | 需绑定 Vision 模型、视觉 System Prompt | 梳理分析目标，调用 `canvas_send_feedback` 提交申请 |
| `text_generation` | 文本生成（提示词等） | 需绑定指定 LLM 模型、温度、生成模板 | 梳理期望的模型/提示词模板，推送到管理员微信 |
| `image_generation` | 绘图生成 | 需绑定 SD/FLUX 绘图模型及尺寸配额 | 梳理用户风格、比例、模型偏好，提交审批 |
| `chat` | 独立对话助手 | 需分配工作区、Session 与特定角色 Agent | 整理助手人设与技能需求，提交管理员配置 |

---

## 3. 总体技术架构

```
┌────────────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                               │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  MascotWidget                                                          │
│  └── [Agent] 悬浮入口 ──→ AgentChatPanel (右侧抽屉面板)                  │
│                             │                                          │
│                             ├── 复用 PiChatNodeHost 核心 SSE 流式消费  │
│                             │   ├── piStreamReducer 状态归约           │
│                             │   ├── 拦截 CANVAS_OP: 自动执行画布操作   │
│                             │   └── 渲染普通 dialog (select/confirm)   │
│                             │                                          │
│                             └── 画布状态驱动执行层 (canvasExecutor)     │
│                                 ├── create_node → setNodes             │
│                                 └── connect_nodes → setEdges           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ SSE 流式双向通信（复用现有通道）
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          Backend (Fastify)                             │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  复用模块（零核心修改）                                                │
│  ├── registry.ts — 进程管理与进程复用（userId:workspaceId 复合键）    │
│  ├── runner.ts   — RPC 子进程启动（挂载 -e 扩展与技能）                │
│  ├── events.ts   — mapPiJsonEvent（原生透传 DIALOG_METHODS 白名单）     │
│  ├── workspace.ts — preparePiWorkspace 工作区装配                      │
│  └── feedback.ts — POST /api/feedback（直通企业微信 Webhook 消息推送） │
│                                                                        │
│  新增 API 路由（薄封装）                                               │
│  └── /api/modules/bookplate/canvas-agent/*                             │
│                                                                        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ stdio RPC (pi --mode rpc)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    pi-agent RPC 专属子进程                             │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  工作区目录: runtime/{userId}/workspace/canvas-agent/                  │
│  ├── AGENTS.md                   ← 专属系统提示词                      │
│  │                                                                     │
│  ├── .pi-agent/extensions/                                             │
│  │   └── pi-canvas-tools/        ← 画布扩展包（5 个工具）              │
│  │       ├── canvas_create_node                                        │
│  │       ├── canvas_connect_nodes                                      │
│  │       ├── canvas_send_feedback  ← 🌟 全场景微信反馈通道             │
│  │       ├── canvas_get_presets                                        │
│  │       └── canvas_search_prompts                                     │
│  │                                                                     │
│  └── .pi-agent/skills/           ← 渐进式知识库（按需读取）            │
│      ├── canvas-node-catalog/    ← 33 个默认节点速查与端口说明         │
│      ├── canvas-multimodal-presets/ ← 多模态预设效果字典               │
│      ├── canvas-workflow-patterns/  ← 典型接线与连线编排模版           │
│      └── canvas-feedback-guide/  ← 反馈与自定义 AI 节点申请规范        │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 扩展包（Extension）设计：`packages/pi-canvas-tools`

遵循标准 `@earendil-works/pi-coding-agent` ExtensionAPI 规范。

### 4.1 工具注册清单

#### 1. `canvas_create_node`（创建单节点与参数配置）
- **职责**：在画布上创建 33 个默认节点之一，支持初始化配置与可选父级连接。
- **机制**：通过 `ctx.ui.select('CANVAS_OP:create_node', [payload])` 桥接前端执行。
- **参数**：
  ```typescript
  {
    type: Type.String({ description: "33个默认节点之一，如 book_info, weather, book_card" }),
    data: Type.Optional(Type.Unknown({ description: "初始配置数据对象" })),
    parent_id: Type.Optional(Type.String({ description: "可选父节点 ID，提供时自动建立连线" }))
  }
  ```

#### 2. `canvas_connect_nodes`（建立多节点连线）
- **职责**：根据端口规则将两个已有节点相连。
- **机制**：通过 `ctx.ui.select('CANVAS_OP:connect_nodes', [payload])` 桥接前端执行。
- **参数**：
  ```typescript
  {
    source_id: Type.String({ description: "源节点 ID" }),
    target_id: Type.String({ description: "目标节点 ID" })
  }
  ```

#### 3. `canvas_send_feedback`（全场景反馈直达企业微信）
- **职责**：任何需要向管理员/开发者反馈的场景均可调用。
  1. 用户需要定制 4 类自定义 AI 节点（模型/提示词/视觉）；
  2. 用户提出系统现有 33 节点未覆盖的新需求或新功能；
  3. 用户遇到报错、Bug 或异常体验；
  4. 用户主动表达优化建议与反馈。
- **机制**：由子进程直接向后端 `POST /api/feedback` 发起 HTTP 请求，后端推送到已配置的企业微信 Webhook。
- **参数**：
  ```typescript
  {
    category: Type.String({ 
      description: "反馈类别: 'custom_ai_node'(自定义AI节点申请) | 'feature_request'(新功能建议) | 'bug_report'(问题上报) | 'user_suggestion'(体验反馈)" 
    }),
    title: Type.String({ description: "简明概要" }),
    content: Type.String({ description: "结构化的详细内容（含用户需求、推荐配置、参数建议或问题细节）" }),
    user_name: Type.Optional(Type.String({ description: "用户标识或称呼，默认匿名用户" })),
    user_email: Type.Optional(Type.String({ description: "用户联系邮箱，默认留空" }))
  }
  ```

#### 4. `canvas_get_presets`（多模态预设查询）
- **职责**：返回 19 个多模态节点中复杂效果的内置预设列表（玻璃折射、微浮雕、水彩、水墨、图片处理、图书卡片等），供 Agent 向用户推荐参数。
- **参数**：`node_type: string`。

#### 5. `canvas_search_prompts` & `canvas_search_skills`
- **职责**：直接通过 HTTP 请求后端 Bifrost 接口检索提示词与技能。

---

## 5. Skills 知识库体系设计（渐进式加载）

知识库放置在 `runtime/.agent/skills/`，遵循 progressive disclosure 原则，系统提示词中只展示名称与摘要，由 Agent 根据需要通过 `read` 工具调阅。

### 5.1 `canvas-node-catalog`（33 个默认节点详则）
- **速查表**：列出 33 个节点的 `type`、中文名、分类、输入端口、输出端口。
- **端口类型与连线契约**：
  - `text` 输出节点：可连向 AI 文本、AI 图像、文本聚合、图书卡片等；
  - `image` 输出节点：可连向图片分析、多模态滤镜、卡片排版等；
  - 明确标出类型不匹配连线规则（软提示标红，不会中断但运行被忽略）。
- **常用参数说明**：
  - `weather`：`data.city` 城市名；
  - `book_card`：`data.templateId` 20种模板 ID；
  - `text_aggregate`：`data.template` 占位符 `{别名}`。

### 5.2 `canvas-feedback-guide`（微信反馈指引与自定义 AI 节点申请）
- **适用时机**：
  - **自定义 AI 节点意图**：当用户想要“帮我写个七言绝句生成器”、“我想专门分析古籍书目的视觉模型”等，告知用户此类节点属于后台受控算力节点，Agent 梳理模型需求（如建议 Claude 3.5 Sonnet）、系统提示词设计、入参出参，并调用 `canvas_send_feedback` 提交申请；
  - **新功能与新数据诉求**：如“能否支持中国知网或维基数据”、“希望能把图片转 3D”；
  - **主动反馈与体验故障**：用户抱怨某步骤不顺或主动要求“帮我给开发者提个建议”时立即调用。
- **提交格式规范**：要求 Agent 整理出结构优美、清晰易读的 Markdown 文本作为 `content`，以便企业微信群内管理员一眼获取完整上下文。

### 5.3 `canvas-multimodal-presets`（视觉与多模态效果预设）
- 细化 19 种多模态效果的风格清单与参数对照，支撑 Agent 针对用户的“朦胧感”、“复古风”、“国潮感”等词汇推荐最契合的预设 ID。

### 5.4 `canvas-workflow-patterns`（简单多节点连线推荐）
- 包含 4 大经典组合范例：
  1. **图书卡片/小票流**：`book_info` → `book_card`
  2. **水彩/水墨国风生成流**：`image_upload` → `watercolor_brush` / `ink_wash` → `stamp_cutter`
  3. **多源信息聚合流**：`book_info` + `weather` + `calendar` → `text_aggregate`
  4. **传统纹样配色流**：`pattern_search` / `color_search` → `editorial_layout`

---

## 6. AGENTS.md 专用系统提示词设计

放置在 `runtime/.agent/agents/canvas-assistant/AGENTS.md`：

```markdown
# 画布助手 Canvas Assistant

你是一个专业的画板助手，帮助用户理解需求并在画布上推荐创建节点和辅助接线。

## 核心原则
1. **单节点推荐优先**：深入理解用户当前最核心的需求，从 33 个默认节点中推荐 1 个最适合的节点，并给出合理的初始参数建议。
2. **确认后执行**：在调用 `canvas_create_node` 之前，向用户用自然语言简述方案，获得用户同意后再执行。
3. **渐进接线**：创建节点后，主动询问或建议连接上级/下级节点（调用 `canvas_connect_nodes`）。
4. **全场景反馈通道**：
   - 4 类受管 AI 节点（图像分析、图像生成、文本生成、AI对话）不能由普通用户直接在前端创建空白实例。遇到此类定制需求时，协助梳理参数并调用 `canvas_send_feedback` 推送到管理员企业微信；
   - 只要用户提出产品建议、遇到 Bug、或需要新增系统暂未支持的节点/数据源，主动整理成专业结构并调用 `canvas_send_feedback` 直送企业微信。
5. **按需阅读技能**：
   - 了解 33 个节点及其端口契约阅读 `canvas-node-catalog`
   - 了解多模态滤镜效果参数阅读 `canvas-multimodal-presets`
   - 了解典型接线模式阅读 `canvas-workflow-patterns`
   - 了解反馈与自定义节点提交规范阅读 `canvas-feedback-guide`
```

---

## 7. 前端与交互实现细节

### 7.1 前端操作执行器（`canvasExecutor.ts`）
通过全局引用的 `nodesRef` / `edgesRef` 与 `setNodes` / `setEdges` 实现画布节点创建与连线：
- 创建节点：分配唯一 `nodeId`，计算右侧或居中坐标，写入画布节点列表；若带 `parent_id` 自动添加连线；
- 连接节点：校验双方节点存在性与端口规范，写入画布边列表。

### 7.2 智能对话面板（`AgentChatPanel.tsx`）
- 挂载在 `MascotWidget` 中，点击 Agent 图标右侧弹出；
- 复用 `piStreamReducer` 解析 SSE 事件；
- 收到 `extension_ui_request` 且 `title.startsWith('CANVAS_OP:')` 时，拦截该事件，不弹用户确认框，静默调用 `canvasExecutor` 执行画布变更，并将执行结果立即回写至 `/chat/ui-response`，形成闭环。

---

## 8. 实施路径与验证计划

1. **扩展包增强**：在 `packages/pi-canvas-tools/src/index.ts` 中实现 `canvas_send_feedback`，对接 `/api/feedback`。
2. **Skills 完善**：补充 33 个默认节点的完整端口与参数表，新建 `canvas-feedback-guide`。
3. **提示词更新**：部署 `canvas-assistant/AGENTS.md`。
4. **前端挂载**：打通 `AgentChatPanel` 与画布状态绑定。
5. **全流程验证**：
   - 测试 1：单节点推荐创建（如“查一下今天北京天气” → 推荐创建 `weather` 节点并填入北京）；
   - 测试 2：多节点连线（如“把图书元数据连到图书卡片上”）；
   - 测试 3：自定义 AI 节点申请反馈（如“我想建一个写七言绝句的大模型节点” → 梳理后调用反馈工具，验证企业微信收到推送）；
   - 测试 4：通用意见反馈（如“希望能增加一个查豆瓣短评的功能” → 验证企业微信收到推送）。
