# 后端 TypeScript + AI SDK 实现计划

**文档版本：v1.0**
**日期：2026-08-16**
**上游设计文档：`后端 TypeScript + AI SDK 重构设计文档.md`（v1.0 待评审）**
**状态：已评审，进入实施（Phase 1-4 已完成，见文末实施日志）**

本计划在代码审计（设计文档 Phase 0）基础上，落实架构决策并给出可验证的实施路径。

---

# 〇、实施日志（2026-08-16）

## Phase 1-2（已完成）

- **Phase 1（骨架）**：`backend-ts/` 脚手架（Fastify 5.12 + strict TS + Vitest 4 + tsx），
  `src/config/env.ts` / `src/server.ts`（CORS + /static + /health + chat 路由）。
- **Phase 2（AI SDK 基础设施）**：`src/infrastructure/ai/*` 全部落地
  （provider / messages / chat-stream / text / image / errors / usage / mock），
  `src/services/llm-service.ts` / `image-service.ts`，`src/modules/bookplate/stream.ts`。
- **契约测试移植**（`tests/ai/*`，13 个全部通过，Vitest + 本地 mock OpenAI 兼容端点）：
  - `reasoning-split`：**已验证 AI SDK 7 openai-compatible provider 对
    `delta.reasoning_content`（DeepSeek 风格）原生产出 reasoning 事件**，
    拆分顺序/内容与 Python 契约一致；
  - `multiturn-history`：assistant 历史正确回传 + system 提示词注入；
  - `image-generation`：文生图（b64 → 落盘 → URL）与 Mock SVG；
  - `multimodal-messages`：图片 data URL → AI SDK 多模态 parts。

## Phase 3（已完成）

- **数据层**：`drizzle-kit pull` 从存量 `backend/bookforge.db` 生成 `src/db/schema.ts`
  （13 表逐列一致，is_active 转 boolean 模式）；驱动选 **better-sqlite3**（12.11.1，
  node:sqlite 在 drizzle-orm 0.45 未导出）；`src/config/database.ts`（initDb/applyInitialSchema
  幂等建表）、`src/repositories/*`（类型化查询）、`src/config/seed.ts`（admin/系统设置/默认提示词种子）。
- **认证**：`src/shared/security.ts`（@fastify/jwt HS256 + bcryptjs 兼容 passlib $2b$ hash，
  authenticate/requireAdmin 请求级 preHandler）+ `src/api/auth.ts`（登录）。
- **FastClaw 移植**：`src/services/fastclaw-service.ts`（fetch + SSE 客户端，事件归一化
  content_delta/tool_call/tool_result/status/subagent_progress/error/done + listAgents）。
- **节点配置解析**：`src/services/node-config-service.ts`（NodeConfig → Text/Vision/Image/FastClaw
  运行时配置，三态回退语义与 Python 一致）。
- **bookplate 路由**（`src/modules/bookplate/router.ts`，AI SDK UI Message Stream 协议）：
  - `/chat`：LLM 模式（AI SDK streamText）+ FastClaw Agent 模式（data-agent_* part）+ Mock；
    Skill Agent 绑定返回明确错误提示（第二阶段）；
  - `/analyze-image`：LLM（generateText 多模态）+ Agent；上传 base64 支持；cover_url 待豆瓣客户端；
  - `/generate-prompt`：LLM（streamText）+ Agent；
  - `/generate-image`：LLM（JSON）+ Agent（流式 + 图片落盘）；
  - `/node-registry`、`/fastclaw-probe`（admin）。
- **路由级契约测试**（`tests/api/bookplate.test.ts`，9 个，内存库 + mock OpenAI/FastClaw）：
  登录/401、node-registry、chat LLM 多轮、chat Agent 流式、chat Mock、generate-image LLM/Mock。
- **存量库端到端冒烟**：登录（兼容 passlib hash）、node-registry、鉴权 chat 全部正常。

**当前测试**：`tsc --noEmit` 通过；Vitest 38 个全部通过。

## Phase 4（已完成）

- **isbn / cover（豆瓣客户端移植）**：`src/services/douban-service.ts`（483 行 Python 原样移植，
  含 qps 限速 / 代理 / 字段白名单）+ `src/modules/bookplate/covers.ts`（路由 + BookCache 缓存），
  已接入 bookplate 路由（`/isbn`、`/cover`、`/analyze-image` 支持 cover_url 分析）。
- **平台 API**（`src/api/*`）：
  - `users.ts`（me/列表/创建/修改/删除）、`generations.ts`（创建/列表/详情/删除，
    题名提取 + 收藏/公开状态 + 静态文件清理）、`favorites.ts`（幂等收藏/列表/取消）、
    `public.ts`（幂等分享/画廊列表/撤下）；
  - admin：`llm-configs.ts`（CRUD + **连通性测试 /test**：text/multimodal 走 AI SDK
    generateText 最小调用 + /models 复核，image/video/audio 直接 /models 探测）、
    `prompts.ts`、`node-configs.ts`（模板类型/模式互斥/引用校验 + 分组排序）、
    `settings.ts`（敏感键掩码）、`fastclaw-agents.ts`（懒解析 agent_name + 复制）、
    `skill-agent-configs.ts`（引用模型/提示词 + **AGENTS.md 物化/清理**）、
    `bifrost.ts`（文件夹/提示词列表与详情/预览图上传删除，multipart）。
- **服务层新增**：`src/services/bifrost-service.ts`（Basic/Bearer 鉴权、白名单过滤、
  latest_version 正文提取、TTL 缓存、Skills 检索/下载）、`skill-agent-files.ts`（writeAgentMd）、
  fastclaw-service 增 `resolveAgentName`（TTL 缓存）。
- **时间戳对齐**：Python 各模型 `default=get_current_time`（上海时区）为应用侧默认，
  drizzle pull 不含——新增 `shared/datetime.ts::now()`，所有插入/更新显式写入
  created_at / updated_at，响应统一 `toIso`（空格→T，与 pydantic 序列化一致）。
- **路由级契约测试**（`tests/api/platform.test.ts`，16 个，内存库 + mock HTTP）：
  生成记录（题名提取/级联清理）、收藏/公开（幂等/404）、模型配置连通性测试（image 探测
  /models、text 走 chat）、节点配置模式互斥、设置敏感掩码、FastClaw 懒解析、
  Skill Agent AGENTS.md 物化、Bifrost 文件夹/正文提取/预览图上传。
- **存量库端到端冒烟**：登录、generations/favorites/public 列表、admin 各列表、
  创建→详情→删除生成记录（created_at 正确输出 ISO）全部正常。

**Phase 4 剩余**：skills 上传/检索路由、Skill Agent 模式（第二阶段）。

## 下一阶段（Phase 5）

前端迁移（方案 A 方向）：`@ai-sdk/react useChat` 接入 chat 端点，自定义 part 消费；
ChatNode 消息持久化 ↔ useChat 消息互转；reasoning/AgentStep/文件/重试/中断回归。

---

# 一、代码审计结论（Phase 0 产出）

## 1.1 后端 AI 能力清单（全部经 `backend/app/` 确认）

| AI 能力 | Python 位置 | 现 Provider 调用方式 | TS 迁移 |
| --- | --- | --- | --- |
| 多轮对话流式（ChatNode LLM 模式） | `services/llm_service.py::chat_stream` | `AsyncOpenAI.chat.completions.create(stream=True)`，读 `delta.content` + `delta.reasoning_content` | AI SDK `streamText` |
| 封面/参考图多模态分析 | `llm_service.py::analyze_cover` | `chat.completions.create`，image_url data URL | AI SDK `generateText` |
| 提示词流式生成 | `llm_service.py::generate_prompt_stream` | `chat.completions.create(stream=True)` | AI SDK `streamText` |
| 图像生成（文生图/图生图） | `services/image_service.py::generate_image` | `images.generate` + `extra_body{return_base64\|image}`（litellm 特判） | AI SDK `generateImage` |
| FastClaw Agent 模式 | `services/fastclaw_service.py` | 外部 HTTP SSE 客户端（`POST /api/chat/stream`），与 OpenAI SDK 无关 | 原样移植（fetch + SSE），**不经过 AI SDK** |
| Skill Agent 模式 | `services/skill_agent_service.py`（1085 行） | `openai-agents-python` 0.20.0 | **P1 延后（第二阶段）**，协议空间预留 |
| Bifrost 提示词 / Skills | `services/bifrost_service.py` | 纯 HTTP（httpx） | 原样移植（fetch） |

> 结论：OpenAI 原生 SDK 仅在 `llm_service` / `image_service` 中使用，且全部为 OpenAI 兼容端点
> （LLMConfig 的 `base_url` 可指向 DeepSeek / litellm / 自建网关等任意兼容服务）。

## 1.2 前端流式协议（代码确认）

- `frontend/src/platform/services/sse.ts`：自定义 `fetch + ReadableStream` SSE 解析，POST `/api/modules/bookplate/chat`。
- 事件契约：`message`（正文增量）/ `reasoning`（思考增量）/ `agent_tool_call` / `agent_tool_result` /
  `agent_status` / `agent_file` / `error`。
- 多轮历史由前端维护（OpenAI 格式 messages 随每轮完整重发）；首轮注入图书元数据/上级节点上下文
  （`context`）与上下文图片（`contextImages`，data URL）；支持重试/中断/`workspaceId`/`epoch`/`skills`。
- 前端**未使用 AI SDK UI**（无 `ai` / `@ai-sdk/react` 依赖）。

## 1.3 必须保持语义不变的契约测试（Python 侧）

| 测试 | 断言内容 |
| --- | --- |
| `tests/test_llm_reasoning_split.py` | reasoning_content 与 content 拆分、事件顺序、无推理时不产多余事件、Mock 全 content |
| `tests/test_multiturn_history.py` | assistant 历史正确回传、多轮流式正常 |
| `tests/test_skill_agent_stream.py` 等 | Skill Agent 事件白名单 / sandbox / symlink（P1 范围） |

---

# 二、架构决策（ADR 补充）

| ADR | 决策 | 理由 |
| --- | --- | --- |
| ADR-018 | Web 框架选 **Fastify 5** | 生态成熟（JWT/static/multipart/CORS 插件齐全）、TS 优先、生产稳定 |
| ADR-019 | 数据层选 **Drizzle ORM** | TS 优先、类型安全；`drizzle-kit pull` 可从存量 `backend/bookforge.db` 反推 schema；SQLite（`node:sqlite`）/ PostgreSQL（`pg`）双驱动 |
| ADR-020 | Provider 统一用 **`@ai-sdk/openai-compatible`** 的 `createOpenAICompatible` | LLMConfig 存任意 OpenAI 兼容端点（DeepSeek/litellm/自建），按配置运行时创建 provider 实例，实现「Provider 与业务解耦」；官方内置 reasoning（thinking token）支持 |
| ADR-021 | 前端采用 **AI SDK 原生 Stream（方案 A 方向）**，并保留兼容 | 后端输出 AI SDK Data Stream（`toDataStreamResponse`），前端迁 `@ai-sdk/react useChat`；FastClaw/Skill Agent 事件经**自定义 data part** 表达，保证现有节点能力（reasoning/agent 步骤/文件/图片）不丢 |
| ADR-022 | FastClaw Agent 模式**不经 AI SDK** | 外部服务，SSE 客户端原样移植，事件经自定义 part 进入 AI SDK Stream |
| ADR-023 | Skill Agent（含未来 deepseek harness）事件协议与 FastClaw 共用一套自定义 part | 预留 `agent_tool_call` / `agent_tool_result` / `agent_status` / `agent_file` 语义，第二阶段接入时前端零改动 |
| ADR-024 | AI SDK 版本锁定 | `ai@7.0.66` + `@ai-sdk/openai-compatible@3.0.30`（2026-08 锁定）；升级单独 PR 并重跑 Chat/Stream/Image 契约测试 |

---

# 三、仓库结构（新建 `backend-ts/`，与 `backend/` 并行灰度）

```text
backend-ts/
├── package.json
├── tsconfig.json               # strict: true, ESM, NodeNext
├── drizzle.config.ts           # drizzle-kit pull/generate 用
├── vitest.config.ts
├── .env.example
├── src/
│   ├── server.ts               # Fastify 入口（插件注册、静态目录、路由挂载、启动种子）
│   ├── config/
│   │   ├── env.ts              # 环境变量（对齐 app/core/config.py）
│   │   └── database.ts         # drizzle 实例（SQLite node:sqlite / PG pg，按 DATABASE_URL）
│   ├── db/
│   │   └── schema.ts           # drizzle-kit pull 生成（对齐存量表，字段逐列一致）
│   ├── shared/
│   │   ├── errors.ts           # 统一错误体系（AppError / AIError 映射）
│   │   ├── logger.ts
│   │   └── security.ts         # JWT（@fastify/jwt）+ bcrypt
│   ├── infrastructure/ai/      # AI SDK 唯一入口（业务层不得直接依赖 ai/@ai-sdk/*）
│   │   ├── provider.ts         # createAIProvider(llmConfig) → OpenAICompatibleProvider
│   │   ├── types.ts            # TextModelConfig / VisionModelConfig / ImageModelConfig
│   │   ├── messages.ts         # OpenAI 格式消息 ↔ AI SDK 消息 parts（含多模态图片 data URL）
│   │   ├── language-model/
│   │   │   ├── chat-stream.ts  # streamText → 归一化 {type:'content'|'reasoning', delta}
│   │   │   └── text.ts         # generateText（封面分析）
│   │   ├── image/
│   │   │   └── generate.ts     # generateImage → 落盘 static/generated
│   │   ├── errors.ts           # AI SDK Error → 项目错误（参数/鉴权/限流/超时/网络/Provider/流/校验）
│   │   ├── usage.ts            # onFinish：model/provider/tokens/latency 日志
│   │   └── mock/
│   │       ├── chat.ts         # 打字机 Mock（与 Python 行为一致）
│   │       └── image.ts        # SVG 占位图（与 Python 行为一致）
│   ├── services/
│   │   ├── llm-service.ts      # analyzeCover / generatePromptStream / chatStream（组合 AI 能力层）
│   │   ├── image-service.ts    # generateImage / saveRemoteImage / deleteFile
│   │   ├── fastclaw-service.ts # FastClaw SSE 客户端（原样移植）
│   │   └── bifrost-service.ts  # Bifrost 代理（原样移植）
│   └── modules/bookplate/
│       ├── node-types.ts       # NODE_TEMPLATES 等
│       ├── router.ts           # /api/modules/bookplate/*（chat/analyze-image/generate-prompt/generate-image/isbn/cover/...）
│       └── stream.ts           # AI SDK Data Stream 输出 + 自定义 part（agent_*/error）
├── tests/
│   ├── ai/reasoning-split.test.ts      # 契约：reasoning/content 拆分（mock 兼容端点）
│   ├── ai/multiturn-history.test.ts    # 契约：多轮历史回传
│   ├── ai/image-generation.test.ts     # 契约：文生图落盘
│   └── api/*.test.ts                   # 路由级（后续阶段）
└── static/                    # 图片输出（复用 /static 语义）
```

**目录映射（Python → TS）：**

| Python | TS |
| --- | --- |
| `app/core/config.py` | `src/config/env.ts` |
| `app/core/database.py` | `src/config/database.ts` |
| `app/core/security.py` | `src/shared/security.ts` |
| `app/models/*` | `src/db/schema.ts`（drizzle-kit pull） |
| `app/services/llm_service.py` | `src/services/llm-service.ts` + `src/infrastructure/ai/*` |
| `app/services/image_service.py` | `src/services/image-service.ts` + `src/infrastructure/ai/image/*` |
| `app/services/fastclaw_service.py` | `src/services/fastclaw-service.ts` |
| `app/services/bifrost_service.py` | `src/services/bifrost-service.ts` |
| `app/services/skill_agent_service.py` | 第二阶段（P1） |
| `app/api/*` + `app/api/admin/*` | `src/api/*`（后续阶段） |
| `app/modules/bookplate/router.py` | `src/modules/bookplate/router.ts` |
| `sse_starlette.EventSourceResponse` | `src/modules/bookplate/stream.ts`（AI SDK Data Stream） |

---

# 四、AI SDK 集成设计（核心）

## 4.1 Provider 工厂（`infrastructure/ai/provider.ts`）

```ts
createAIProvider(cfg: { apiKey: string; baseURL: string; timeoutMs: number }) {
  return createOpenAICompatible({
    name: 'bookforge',
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL,
    includeUsage: true,              // 流式响应携带 usage
    maxRetries: 0,                   // 与现有 max_retries=0 行为一致（超时即失败，不自动重试）
    fetch: (input, init) => fetch(input, {
      ...init,
      signal: mergeSignals(init?.signal, AbortSignal.timeout(cfg.timeoutMs)),
    }),                              // 显式超时（LLM 60s / Image 120s），与前端 abort 合并
  });
}
```

- 按 `LLMConfig`（api_key / base_url / model_name）运行时构造，进程内按 `(baseURL, apiKey)` 缓存。
- 无 Key 时不构造 provider，走 Mock（与 Python `if not api_key` 分支一致）。

## 4.2 消息转换（`infrastructure/ai/messages.ts`）

OpenAI 格式消息（前端 wire 格式）→ AI SDK `CoreMessage`：

```ts
// user 消息带 images 时 → content parts
{ role: 'user', content: [
  { type: 'text', text: '...' },
  { type: 'image', image: 'data:image/png;base64,...' },  // data URL 原生支持
] }
// assistant / system 消息保持字符串 content
```

- 对应 Python `_multimodal_messages`；不携带图片的消息原样透传。
- system 提示词注入逻辑保留：节点绑定的提示词模板作为 system，未绑定则不注入。

## 4.3 多轮对话流式（`language-model/chat-stream.ts`）

```ts
const result = streamText({
  model: provider(modelName),
  system: systemPrompt || undefined,
  messages,                       // CoreMessage[]
  maxRetries: 0,
  abortSignal,
});
for await (const part of result.fullStream) {
  if (part.type === 'text-delta')      yield { type: 'content',  delta: part.textDelta };
  if (part.type === 'reasoning-delta') yield { type: 'reasoning', delta: part.reasoningDelta };
}
result.onFinish?.(({ usage, latencyMs }) => logUsage({ model, provider, usage, latencyMs }));
```

- **reasoning 拆分**：AI SDK openai-compatible provider 内置 DeepSeek thinking token 支持，
  产出 `reasoning-delta` part —— 契约测试 `reasoning-split` 必须验证（用 mock 端点发
  `delta.reasoning_content`，断言与 Python 完全一致的事件序列）。
- 缺 user 消息抛 `LLMGenerationError('AI 对话缺少用户消息')`，与现有行为一致。

## 4.4 图像生成（`image/generate.ts`）

```ts
const { images } = await generateImage({
  model: provider.imageModel(modelName),
  prompt: refImages?.length
    ? { text: prompt, images: refImages }      // 图生图（/images/edits）
    : prompt,                                   // 文生图
  size,               // 如 '1024x1024' / '1K' / '2K'（透传）
  aspectRatio,        // ratio 如 '1:1'
  maxRetries: 0,
  abortSignal,
  providerOptions: { bookforge: { /* 透传 litellm 等 provider 特判参数 */ } },
});
// images[0].uint8Array → 落盘 static/generated → { image_url, mock: false }
```

- 输出统一为 `GeneratedFile.uint8Array`，替代 Python 的 b64/url 双分支。
- **需对真实 Provider 验证**：Python 图生图走了 `extra_body.image`（litellm 特判，不传
  `response_format`）。AI SDK 的图生图走 `/images/edits` 语义，与 litellm 的兼容性需在
  有真实 Key 的环境验证；必要时用 `providerOptions` + `transformRequestBody` 兜底。

## 4.5 流式协议（前端联调核心，`modules/bookplate/stream.ts`）

**后端输出 AI SDK Data Stream（`toDataStreamResponse`），所有现有事件经标准/自定义 part 表达：**

| 现有 SSE 事件 | AI SDK Stream part | 消费方 |
| --- | --- | --- |
| `message` 增量 | `text-delta`（标准） | `useChat` 消息 text |
| `reasoning` 增量 | `reasoning-delta`（标准） | `useChat` 消息 reasoning |
| `agent_tool_call` / `agent_tool_result` / `agent_status` | 自定义 data part：`{type:'custom', customType:'agent_tool_call', ...}` | `useChat` data 消息，前端按 `customType` 还原 AgentStep |
| `agent_file` | 自定义 data part：`customType:'agent_file'` | 前端还原文件卡片 |
| `error` | `error` part（标准） | `useChat` 错误态 |
| （FastClaw 文本增量） | 自定义 data part `customType:'content_delta'` | 前端拼正文 |

> **兼容性保证**：自定义 part 名称沿用现有 `agent_*` 事件名，前端 `useChat` 消费逻辑
> 与现在 `postSSEStream` 的 `onMessage(event, data)` 一一对应，仅换传输层。
> **deepseek harness（未来 skill agent）**：沿用同一套 `agent_*` 自定义 part，前端无需再改。

**前端（方案 A 方向，独立工作流）：**
- `useChat` 接入 `/api/modules/bookplate/chat`，`setMessages` 从节点持久化的 `ChatMessage[]` 恢复
- 多轮历史/上下文注入/图片附件/workspaceId/epoch/skills 语义保持不变（改由 useChat 消息管理承载）
- reasoning 折叠块 / AgentStep / 文件卡片 / 重试 / 中断：基于 useChat 消息 parts 重建
- 完成后再评估是否值得连 `useChat` 的 attachment 能力一并替换现有附件实现

---

# 五、分阶段实施与验证

## Phase 1：TS 后端骨架
- [ ] `backend-ts/` 脚手架：package.json（锁定依赖）、tsconfig（strict/ESM）、Fastify 5、Drizzle、Vitest
- [ ] `drizzle-kit pull` 从 `backend/bookforge.db` 生成 `src/db/schema.ts`（字段逐列一致）
- [ ] env / database / logger / security（JWT+bcrypt）
- 验证：`tsc --noEmit`；读取存量 db 的 `llm_configs` / `node_configs` 成功

## Phase 2：AI SDK 基础设施（本轮实现）
- [ ] `infrastructure/ai/*`：provider / messages / chat-stream / text / image / errors / usage / mock
- [ ] `services/llm-service.ts` / `image-service.ts`
- 验证：`tests/ai/*` 契约测试（reasoning 拆分、多轮历史、图像落盘）通过

## Phase 3：bookplate 模块路由
- [ ] `chat` / `analyze-image` / `generate-prompt` / `generate-image` / `isbn` / `cover` / `node-registry`
- [ ] 节点配置解析（NodeConfig → Text/Vision/Image/FastClaw 运行时配置）
- [ ] `stream.ts`（AI SDK Data Stream + 自定义 part）
- [ ] FastClaw Agent 模式原样移植（自定义 part 输出）
- 验证：mock provider 端到端 + 前端 ChatNode 联调（LLM 模式）

## Phase 4：平台 API 移植
- [ ] auth / users / generations / favorites / public
- [ ] admin：llm_configs / prompts / node_configs / settings / fastclaw_agents / skill_agent_configs / bifrost
- 验证：与 Python 版对拍接口响应结构

## Phase 5：前端迁移（方案 A 方向）✅ 已完成
- [x] `@ai-sdk/react useChat` 接入 chat 端点（`ai@7.0.66` + `@ai-sdk/react@4.0.69` 锁定，v7 `DefaultChatTransport` + `prepareSendMessagesRequest` 定制线体）
- [x] 每个 chat 节点一个 `ChatNodeHost`（useChat 实例）：store ↔ useChat 消息互转（`chatMessages.ts`，自定义字段走 `metadata.bookplate`）
- [x] reasoning / AgentStep（transient `data-agent_*` → `onData`）/ 文件 / 重试（`regenerate`）/ 中断（`stop` + interrupted 标记）回归；上下文注入/图片附件/workspaceId/epoch/skills 语义不变
- [x] 其余流式端点（analyze-image / generate-prompt / generate-image-agent）换 `postUIStream`（UI Message Stream 解析，替代旧 `postSSEStream`）；后端补 `data-agent_image` 结构化事件（原 image_url 语义）
- [x] 删除 `useChatExecution.ts` / `sse.ts`（旧 SSE 消费方全部移除）
- 验证：frontend `tsc -b` + `vite build` + `oxlint` 通过；转换/解析逻辑 node 冒烟（字段往返、data part、error、abort）；后端 49 契约测试通过；chat 端点端到端输出标准 UI Message Stream（`text-start → text-delta → text-end → finish → [DONE]`）
- 已知差异：切页/节点删除后流中止（useChat 卸载即 abort，不再后台续跑）；首条消息的「思考中」占位由 text-start 后出现（不再乐观插入）

## Phase 6：Skill Agent / deepseek harness（第二阶段，P1）
- [ ] openai-agents 等价实现（AI SDK Agent / ToolLoopAgent）或 deepseek harness 接入
- [ ] 复用 `agent_*` 自定义 part 协议，前端零改动

## Phase 7：灰度与清理
- [ ] 双跑对比（错误率/延迟/token/工具成功率/断流）
- [ ] 删除 `backend/` 旧实现，移除 openai / openai-agents 依赖

---

# 六、契约测试移植清单（Python → Vitest）

| Python 测试 | Vitest 对应 | 断言 |
| --- | --- | --- |
| `test_llm_reasoning_split.py` | `tests/ai/reasoning-split.test.ts` | reasoning/content 事件序列与内容 |
| `test_multiturn_history.py` | `tests/ai/multiturn-history.test.ts` | assistant 历史在请求体中、多轮流式完整 |
| （新增） | `tests/ai/image-generation.test.ts` | mock /images/generations → 文件落盘 + URL |
| （新增） | `tests/ai/multimodal-messages.test.ts` | images → AI SDK parts 形状 |

Mock 方式：`node:http` 起本地兼容端点（返回 OpenAI 兼容 SSE），provider 的 `fetch`/`baseURL`
指向该端点，**不 mock AI SDK 内部**，验证真实协议路径（与 Python 测试同构）。

---

# 七、关键风险与对策

| 风险 | 对策 |
| --- | --- |
| openai-compatible provider 的 reasoning 拆分与 Python 行为不一致 | 契约测试 `reasoning-split` 先行；必要时用 `extractReasoningMiddleware` 兜底 |
| 图生图 litellm 特判（`extra_body.image`）与 AI SDK `/images/edits` 语义差异 | 有真实 Key 环境验证；`providerOptions` / `transformRequestBody` 透传 |
| 前端 useChat 迁移破坏 ChatNode 定制能力 | 自定义 part 沿用 `agent_*` 事件名；迁移分步、每步回归 |
| 存量 SQLite 数据迁移破坏 | `drizzle-kit pull` 生成 schema，不改表结构；双库并行灰度 |
| AI SDK 升级 API 变动 | 版本锁定（ADR-024）；升级单独 PR + 重跑契约测试 |
