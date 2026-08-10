# FastClaw Agent 模式升级运维指南

> **升级范围**：bookplate 模块阶段 2（提示词生成）与阶段 3（图片生成）新增 **Agent 执行模式**，与既有「提示词 + 大模型」模式互斥二选一；Agent 运行过程的中间步骤（工具调用 / 返回结果 / 思考状态）实时显示在画布节点，并持久化到历史记录与导出文件。
>
> **适用读者**：部署 / 运维 / 接手开发。阅读前请先通读 `docs/windows_deploy.md`（环境启动）与 `docs/module-extension-guide.md`（模块扩展）。

---

## 1. 本次升级内容总览

| 模块 | 变更 |
|------|------|
| 数据库 | 新增 `fastclaw_agent_configs` 表；`stage_configs` 表新增 `agent_config_id` 外键列 |
| 后端 | 新增 FastClaw Agent 配置 CRUD（admin）、Agent 调用代理服务、bookplate 两阶段 Agent 分支、`/fastclaw-probe` 探测接口、`/effective-config` 生效模式接口 |
| 前端 | 管理后台新增「Agent 配置」Tab；「阶段配置」支持 Agent 模式选择（与提示词+大模型互斥）；画布 PromptNode / ImageNode 实时显示 Agent 中间步骤；历史记录 / 导出包含中间步骤 |
| 外部依赖 | FastClaw（Agent 运行时），通过其 `/api/chat/stream` SSE 接口对接（非文档化的 `/v1/chat/completions`） |

> **关键决策**：FastClaw 文档化的 `/v1/chat/completions` 流式只返回最终文本，**拿不到中间步骤**；其仪表盘 SSE 接口 `POST /api/chat/stream`（同样支持 `Bearer fcak_...` Key 鉴权）才透出 `content_delta / tool_call / tool_result / status / subagent_progress / error / done` 富事件。为满足「中间步骤实时显示」需求，统一走 `/api/chat/stream`。

---

## 2. 架构与调用链

```text
┌─ 前端画布 ──────────────────────────────────────────────────┐
│ PromptNode / ImageNode                                      │
│   │  postSSEStream(fetch + ReadableStream 解析)             │
│   ▼                                                        │
│ 后端 /api/modules/bookplate/generate-prompt | generate-image│
│   │  ① 解析阶段配置 → 命中 agent_config_id（Agent 模式）      │
│   │  ② fastclaw_agent_service.run_agent(...)               │
│   ▼                                                        │
│ FastClaw  POST {base_url}/api/chat/stream                   │
│   （Authorization: Bearer fcak_...，X-Fastclaw-End-User）   │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 关键接口

| 接口 | 说明 |
|------|------|
| `POST {base_url}/api/chat/stream` | FastClaw 富事件 SSE 流。请求体 `{agentId, sessionId, message, imageUrls?, params?}`，鉴权 `Authorization: Bearer fcak_...`，`X-Fastclaw-End-User` 携带应用用户标识（会话/记忆/用量按用户隔离） |
| `GET {base_url}/v1/agents` | 列出该 API Key 可访问的 Agent（供 admin 配置页「拉取」按钮使用） |

### 2.2 Agent 事件归一化（`backend/app/services/fastclaw_service.py`）

FastClaw 原始事件 → 统一 dict 事件流，SSE 端点再映射为 bookplate SSE 事件透传前端：

| FastClaw 事件 | 归一化 type | bookplate SSE event | 前端展示 |
|---|---|---|---|
| `content_delta` | `content_delta` | `prompt` | 提示词流式文本（stage2）/ 图片阶段忽略 |
| `content`（完整文本） | `content` | `prompt` | 非流式 provider 的完整文本；`run_agent` 已对「增量 + 末尾完整文本」去重，能透传说明本轮未流式，直接作为完整提示词（stage2）/ 供图片阶段提取 URL |
| `tool_call` | `tool_call` | `agent_tool_call` | AgentActivity「调用工具 + 参数」 |
| `tool_result` | `tool_result` | `agent_tool_result` | AgentActivity「返回结果」 |
| `tool_progress` / `status` | `status` | `agent_status` | AgentActivity 状态行 |
| `subagent_progress` | `subagent_progress` | `agent_status` | AgentActivity 状态行 |
| `error` | `error` | `error` | 节点错误态 |
| `done` | `done` | — | 流结束 |

**文本去重逻辑**：FastClaw 会先流式发 `content_delta`，再在本轮结束补发一条完整 `content`。`run_agent` 内若本轮已收到增量则跳过末尾完整 `content`（避免提示词重复拼接）；遇 `tool_call / tool_result / status / subagent_progress` 视为新一轮助手回复开始，重置标记（兼容多轮 ReAct）。

### 2.3 图片 URL 提取（阶段 3 Agent 模式）

- 优先从 `tool_result` 的 `result` 中正则提取 markdown 图片 `![...](url)` 或裸图片 URL（`extract_image_url`）；
- 再兜底从最终回复完整文本中提取；
- 提取到后经 `image_service.save_remote_image` 下载落盘到 `backend/static/generated/`，返回本地 URL（前端无需访问 FastClaw 内网地址）。

---

## 3. 数据库变更（Alembic 迁移）

迁移文件：`backend/alembic/versions/2f4c9a17b8d3_add_fastclaw_agents.py`

| 变更 | 说明 |
|------|------|
| 新表 `fastclaw_agent_configs` | `id / name / base_url / api_key / agent_id / is_active / created_at / updated_at` |
| `stage_configs.agent_config_id` | 外键 → `fastclaw_agent_configs.id`，命名约束 `fk_stage_configs_agent_config_id`，可空 |

> **SQLite 注意**：对已有表添加带外键的列必须用 batch 模式（copy-and-move），迁移已按此实现，且**必须命名外键约束**否则 batch 模式报错。升级/降级循环已验证（`upgrade head` → `downgrade -1` → `upgrade head`）。

升级命令：

```bash
cd backend
alembic upgrade head
```

---

## 4. 后端改动明细

### 4.1 新增文件 / 修改文件

| 文件 | 说明 |
|------|------|
| `app/models/fastclaw_agent_config.py` | 新模型。**api_key 明文存库**，任何接口只回 `has_api_key` 布尔标记，永不回传 key |
| `app/models/stage_config.py` | 增加 `agent_config_id` 列与 `agent_config` relationship |
| `app/schemas/admin.py` | `FastClawAgentConfigCreate/Update/Out` + `StageConfig` 相关 schema 增加 `agent_config_id` |
| `app/api/admin/fastclaw_agents.py` | **新增**：`/api/admin/fastclaw-agents` CRUD（仅 admin）。删除时自动将引用它的阶段配置 `agent_config_id` 置空，避免悬空外键 |
| `app/api/admin/stage_configs.py` | 创建/更新阶段配置时**校验模式互斥**：`agent_config_id` 与 `llm_config_id`/`prompt_id` 只能选择一组 |
| `app/services/fastclaw_service.py` | **新增**：`FastClawAgentService.run_agent`（SSE 代理 + 归一化）、`list_agents`（`/v1/agents`）、`extract_image_url` |
| `app/modules/bookplate/router.py` | 新增 `_resolve_agent_config` / `_agent_session_key` / `_sse_from_agent_event` / `_agent_prompt_message` / `_agent_image_message`；`generate-prompt` 与 `generate-image` 增加 Agent 模式分支；新增 `/fastclaw-probe` 与 `/effective-config` 接口 |
| `app/services/image_service.py` | 新增 `save_remote_image`（下载远端图片落盘） |

### 4.2 新增接口

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET/POST | `/api/admin/fastclaw-agents` | admin | Agent 配置列表 / 新建 |
| PATCH/DELETE | `/api/admin/fastclaw-agents/{id}` | admin | 修改（api_key 留空=保留原 Key）/ 删除（解除引用） |
| GET | `/api/modules/bookplate/fastclaw-probe` | **仅 admin** | 用调用者传入的 base_url+api_key 探测 `/v1/agents`，供 admin 页「拉取」按钮使用 |
| GET | `/api/modules/bookplate/effective-config` | 登录用户 | 返回各阶段生效模式 `{stage2: {mode, agent_name}, ...}`，前端据此决定调用方式与中间步骤展示 |

> **安全说明**：`/fastclaw-probe` 会以调用者提供的参数向任意地址发起服务端请求（SSRF 面），因此强制 admin 权限；普通用户调用返回 403。已用 E2E 验证。

### 4.3 会话与用户隔离

- 会话 key：`bookplate-{userId}-{nodeId}`（同一用户同一节点重试共享 FastClaw 上下文）；
- `X-Fastclaw-End-User: bookplate-{userId}`：让 FastClaw 按应用用户隔离会话/记忆/用量。

---

## 5. 前端改动明细

| 文件 | 说明 |
|------|------|
| `src/platform/types/index.ts` | 新增 `FastClawAgentConfig(Payload)`、`StageConfig.agent_config_id`、`BookplateEffectiveConfig`、`AgentStep`；`GenerationStageResults.stage2/stage3` 增加 `agent_steps` |
| `src/platform/services/admin.ts` | FastClaw Agent CRUD API |
| `src/admin/pages/FastClawAgentsPage.tsx` | **新增**：Agent 配置页（增删改 + 启用开关 + 「拉取」自动获取 agent_id） |
| `src/admin/AdminLayout.tsx` | 新增「Agent 配置」导航项 |
| `src/app/App.tsx` | 注册 `/admin/agents` 路由 |
| `src/admin/pages/StageConfigsPage.tsx` | 阶段配置增加 **Agent 模式选择**（与提示词+大模型单选互斥） |
| `src/platform/components/agent/AgentActivity.tsx` | **新增（平台层）**：中间步骤折叠面板（工具调用/结果/状态） |
| `src/modules/bookplate/components/PromptNode.tsx` / `ImageNode.tsx` | 集成 AgentActivity，展示中间步骤 |
| `src/app/routes/BookplatePage.tsx` | 解析 `agent_tool_call/result/status` SSE 事件追加到节点 `agentSteps`；Agent 模式图片生成分支（`runImageGenerationAgent`）；`buildStageResults` 携带 `agent_steps` 入库 |
| `src/platform/utils/generation.ts` | `generationMeta` 合并 stage2+stage3 的 agent steps |
| `src/platform/components/gallery/GenerationDetailPanel.tsx` | 详情面板展示「Agent 运行过程」；Markdown 导出包含中间步骤 |
| `src/platform/components/gallery/GenerationCard.tsx` | 列表卡片显示「Agent 运行 · N 步」标记 |

### 5.1 中间步骤持久化链路

```
画布节点 data.agentSteps ──► buildStageResults ──► stage_results.stage2/stage3.agent_steps
    ──► generations 表（JSON 列，无需新迁移）
    ──► 历史/收藏/画廊：卡片标记 + 详情面板「Agent 运行过程」+ Markdown 导出章节
```

- 画布刷新/撤销重做：`useCanvasState` 的 sessionStorage 快照天然包含节点 `data.agentSteps`；
- 历史记录：`autoSaveGeneration` / `ensureGeneration`（收藏/公开路径）经 `buildStageResults` 自动携带；
- 提示词节点重试/重新生成时**清空旧步骤**，避免残留。

---

## 6. 配置步骤（运维操作手册）

### 6.1 前置条件

1. 部署并启动 FastClaw，创建目标 Agent；
2. 为 Agent 创建 `agent` 类型 API Key（`fcak_...`）并确认该 Key 可访问目标 Agent（`GET /v1/agents` 可列出）；
3. 阶段 3 的 Agent 需具备**图像生成工具**（如 FastClaw `image_gen`），其回复以 markdown `![image](url)` 形式给出图片。

### 6.2 管理后台配置

1. 登录 `admin` → 导航「管理后台」→ **Agent 配置** Tab：
   - 「新建配置」：填名称、Base URL（如 `http://127.0.0.1:8787`）、API Key、Agent ID；
   - 可点「拉取」用当前 Base URL + Key 自动获取可用 Agent 列表；
   - api_key 只写不回显，编辑时留空保持原 Key。
2. 进入「阶段配置」：对 `bookplate / stage2`（提示词）与 `bookplate / stage3`（图片）选择 **Agent 模式**并绑定上述配置；
   - 与「提示词 + 大模型」**互斥**：选了 Agent 就不能再选模型/提示词（后端 API 双重校验）；
   - 切回 LLM 模式时清空 Agent 绑定即可。
3. 回到画布：重新生成提示词 / 图片即走 Agent 模式，节点内实时显示中间步骤。

### 6.3 验证清单

- [ ] 管理后台「Agent 配置」可增删改、可「拉取」、api_key 不回显
- [ ] 阶段配置保存 Agent 模式后，`/effective-config` 返回对应阶段 `mode: "agent"`
- [ ] 阶段配置同时勾选 Agent + 模型/提示词被后端拒绝（400 互斥提示）
- [ ] Agent 模式下生成提示词：节点显示工具调用/状态步骤，最终提示词完整无重复
- [ ] Agent 模式下生成图片：中间步骤可见，图片正常落盘 `static/generated/`
- [ ] 历史记录详情显示「Agent 运行过程」，Markdown 导出含该章节
- [ ] 刷新画布 / 撤销重做后中间步骤仍可见
- [ ] 普通用户调用 `/fastclaw-probe` 返回 403

---

## 7. 故障排查（FAQ）

| 现象 | 排查方向 |
|------|---------|
| 阶段已绑 Agent 但画布仍走 LLM | `/effective-config` 返回的 `mode`；检查 Agent 配置 `is_active` / api_key 是否为空 / base_url 可达 |
| 前端报「FastClaw /api/chat/stream 返回 HTTP xxx」 | 检查 base_url 路径、`fcak_...` Key 权限、Agent 是否存在 |
| 提示词文本重复 | 正常不会发生；若复现，检查 `run_agent` 的 saw_delta 去重逻辑是否被改动 |
| 阶段 3 无图片 | Agent 回复中无 markdown 图片 / 无裸图片 URL；`extract_image_url` 只认 `![..](url)` 与 `http(s)://...png|jpg|webp|gif`；确认 FastClaw 侧 image_gen 工具可用 |
| 删除 Agent 配置后阶段变空 | 预期行为：引用它的阶段配置 `agent_config_id` 自动置空，回退 LLM/环境变量/Mock |
| 图片 URL 下载失败 | FastClaw 返回的 URL 是否公网可达（后端需能直连）；确认不是内网地址 |

---

## 8. 已知限制与后续建议

- **api_key 明文存库**（与 LLMConfig 一致）：本地/内网可接受；共享环境建议加密存储（如 `api_key_enc`）。
- **`/v1/chat/completions` 未使用**：若未来 FastClaw 在 `/v1` 透出富事件，可评估切换回文档化接口。
- **Agent 阶段未接入用量/配额**：当前只透传事件，未调 FastClaw `/v1/usage` / `/v1/quota`；如需计费可在服务层补充。
- **仅生成提示词不建历史记录**（既有行为，记录以图片产物为中心）：提示词阶段的 agent_steps 只在画布上可见。
- 若未来把记录保存时机前移（每步都落库），`autoSaveGeneration` 需改为从 ref 读取步骤（现依赖「步骤在 image_url 帧之前各帧已写入」的时序，代码内有注释说明）。
