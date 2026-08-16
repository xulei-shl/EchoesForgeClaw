# 后端 TypeScript + AI SDK 重构 Handoff

**文档版本：v1.0**
**日期：2026-08-16**
**状态：Phase 1-5 已完成，Phase 6-7 待办**
**关联文档：**
- 设计文档：`docs/重构/后端 TypeScript + AI SDK 重构设计文档.md`（v1.0 待评审，含架构原则/ADR-001~017）
- 实现计划：`docs/重构/后端 TypeScript + AI SDK 实现计划.md`（含实施日志与 ADR-018~024）
- 部署文档：`docs/windows_deploy.md`、`docs/ubuntu_deploy_best_practices.md`、`scripts/deploy.sh`

> **本文档定位**：给接手维护/继续升级的人看的「现状快照 + 踩坑记录 + 升级指引」。
> 设计文档回答「为什么这么做」，实现计划记录「每阶段做了什么」，本文档回答「现在系统长什么样、动哪里会出事、下一步怎么走」。

---

# 一、现状总览（2026-08-16）

## 1.1 架构现状

```
前端 (React 19 + Vite 8 + @ai-sdk/react 4 + ai 7)
   │  HTTP / AI SDK UI Message Stream（text-start → text-delta → ... → finish → [DONE]）
   ▼
backend-ts/  (Fastify 5.12 + Drizzle 0.45 + better-sqlite3 + AI SDK 7)   ← 新后端，唯一维护目标
   ├─ src/infrastructure/ai/   AI SDK 唯一入口（业务层禁止直接依赖 ai/@ai-sdk/*）
   ├─ src/services/            业务服务（llm / image / fastclaw / bifrost / douban / skill-agent）
   ├─ src/modules/bookplate/   bookplate 路由 + AI SDK Data Stream 输出
   ├─ src/api/                 平台 API + admin API
   ├─ src/repositories/        类型化查询
   └─ src/db/schema.ts         drizzle-kit pull 自存量库生成（13 表）
```

**双后端并存（灰度期）**：
- `backend-ts/`：**新 TS 后端（默认）**，直接读存量 `backend/bookforge.db`（同一 SQLite 文件，零迁移）。
- `backend/`：旧 Python 后端，**仅作回滚保留**，不再维护，Phase 7 计划删除。

## 1.2 关键版本锁定（升级必须单独 PR，见 §4）

| 组件 | 版本 | 备注 |
| --- | --- | --- |
| Node.js | **>=22.9.0**（`engines`） | 用 `--env-file` 加载 .env；建议 22 LTS |
| fastify | 5.12.0 | 生态插件齐全 |
| drizzle-orm | 0.45.2 + better-sqlite3 12.11.1 | node:sqlite 在 0.45 未导出，故用 better-sqlite3 |
| ai | **7.0.66** | 锁定 |
| @ai-sdk/openai-compatible | 3.0.30 | LLMConfig 任意 OpenAI 兼容端点（DeepSeek/litellm/自建） |
| @ai-sdk/react（前端） | ^4.0.69 | 必须与 ai@7 匹配（v2 对应 ai@5，混用会出双 ai 拷贝类型冲突） |
| adm-zip | ^0.5.18 | skills zip 处理 |
| @fastify/multipart | ^9.4.0 | bifrost 预览图上传 |

## 1.3 测试资产（49 个契约测试，Vitest 4）

| 文件 | 覆盖 | 数量 |
| --- | --- | --- |
| `tests/ai/reasoning-split.test.ts` | reasoning/content 拆分（DeepSeek 风格 delta.reasoning_content） | 契约 |
| `tests/ai/multiturn-history.test.ts` | assistant 历史回传 + system 注入 | 契约 |
| `tests/ai/image-generation.test.ts` | 文生图 mock → 落盘 → URL | 契约 |
| `tests/ai/multimodal-messages.test.ts` | 图片 data URL → AI SDK parts | 契约 |
| `tests/api/bookplate.test.ts` | 登录/401、node-registry、chat LLM 多轮/Agent 流式/Mock、generate-image | 9 |
| `tests/api/platform.test.ts` | 生成记录、收藏/公开、模型连通性测试、节点配置、设置掩码、FastClaw 懒解析、AGENTS.md 物化、Bifrost | 16 |
| `tests/api/skills.test.ts` | skills 列表/检索/安装/上传/移除/文件下载 | 若干 |

**测试基建**：`tests/helpers/mock-openai-server.ts`（node:http 起真实 HTTP 兼容端点，**不 mock AI SDK 内部**，验证真实协议路径；支持 SSE/JSON/二进制/自定义状态码）；内存 SQLite + seed。前端无测试框架，靠 `tsc -b` + `vite build` + `oxlint` + node 冒烟脚本。

## 1.4 验证命令速查

```bash
# 后端
cd backend-ts && npx tsc --noEmit          # 类型
cd backend-ts && npx vitest run            # 49 契约测试
cd backend-ts && npm run start             # 生产（自动 --env-file-if-exists=.env）
cd backend-ts && npm run dev               # 热重载

# 前端
cd frontend && npx tsc -b && npm run build && npx oxlint
```

---

# 二、目录与模块地图

## 2.1 backend-ts（新后端）

| 路径 | 内容 | 维护要点 |
| --- | --- | --- |
| `src/server.ts` | Fastify 入口：CORS、/static、multipart、JWT、路由挂载、启动种子 | 静态目录 `backend-ts/static/`；直接运行时 listen，被测试 import 时不 listen |
| `src/config/env.ts` | 环境变量（对齐旧 app/core/config.py） | 需显式 `--env-file` 加载（tsx 不自动加载） |
| `src/config/database.ts` | drizzle 实例 + 幂等建表 + `initTestDb` 测试辅助 | 按 `DATABASE_URL` 切换 SQLite/PG |
| `src/config/seed.ts` | admin / 系统设置 / 默认提示词种子 | 首次启动幂等 |
| `src/db/schema.ts` | **drizzle-kit pull 生成，勿手改** | 13 表逐列对齐存量库；要改表结构用 `db:pull` 重拉或手写 migration |
| `src/repositories/index.ts` | 类型化查询 + `now()` 时间戳助手 | 见 §3.1 时间戳坑 |
| `src/shared/security.ts` | @fastify/jwt HS256 + bcryptjs（**兼容 passlib $2b$ hash**）+ authenticate/requireAdmin | 存量 admin 密码可直接登录 |
| `src/shared/datetime.ts` | `now()`（上海时区）+ `toIso` | 见 §3.1 |
| `src/infrastructure/ai/` | **AI SDK 唯一入口**：provider/messages/chat-stream/text/image/errors/usage/mock | 业务层不得绕过它直接用 ai 包 |
| `src/services/llm-service.ts` | analyzeCover / generatePromptStream / chatStream | 组合 AI 能力层 |
| `src/services/image-service.ts` | generateImage / saveRemoteImage / deleteFile | 落盘 `static/generated/` |
| `src/services/fastclaw-service.ts` | FastClaw SSE 客户端 + listAgents + resolveAgentName | **不经 AI SDK**，原样移植；resolveAgentName 有 TTL 缓存 |
| `src/services/bifrost-service.ts` | Bifrost 代理：Basic/Bearer、白名单、latest_version 正文提取、TTL 缓存、Skills 检索/下载 | |
| `src/services/douban-service.ts` | 豆瓣 isbn/cover 客户端（qps 限速/代理/字段白名单） | 483 行 Python 原样移植 |
| `src/services/skill-agent-service.ts` | skills zip 解压/白名单/安装/工作区装配/移除/文件下载 | 用 adm-zip |
| `src/services/skill-agent-files.ts` | `writeAgentMd`（AGENTS.md 物化，跨用户共享一份） | |
| `src/services/node-config-service.ts` | NodeConfig → Text/Vision/Image/FastClaw 运行时配置（三态回退） | |
| `src/modules/bookplate/router.ts` | bookplate 全部路由（chat/analyze-image/generate-prompt/generate-image/isbn/cover/node-registry/fastclaw-probe/skills） | chat 端点是前端 useChat 的消费目标 |
| `src/modules/bookplate/stream.ts` | **AI SDK UI Message Stream 输出 + 自定义 part**（data-agent_* / data-agent_image / error） | 前端依赖此协议，改格式 = 前端爆炸 |
| `src/api/auth.ts` | POST /api/auth/login → {token, user} | |
| `src/api/*.ts` | users / generations / favorites / public | 平台 API |
| `src/api/admin/*.ts` | llm-configs（含 /test 连通性）/ prompts / node-configs / settings / fastclaw-agents / skill-agent-configs / bifrost | admin API |

## 2.2 前端改动（Phase 5）

| 路径 | 内容 | 维护要点 |
| --- | --- | --- |
| `src/modules/bookplate/ChatNodeHost.tsx` | **每 chat 节点一个 useChat 实例**（v7 `DefaultChatTransport` + `prepareSendMessagesRequest` 定制请求体） | 本迁移最复杂的文件；改动前先读 §3.4 |
| `src/modules/bookplate/chatMessages.ts` | `ChatMessage[] ↔ UIMessage[]` 纯转换（自定义字段走 `metadata.bookplate`） | 零运行时依赖，可单测 |
| `src/modules/bookplate/uiStream.ts` | UI Message Stream 解析器（替代旧 postSSEStream） | analyze-image/prompt/image 节点用 |
| `src/modules/bookplate/useNodeExecution.ts` | 三个流式端点切到 postUIStream | |
| `src/modules/bookplate/CanvasNodeViews.tsx` | chat 分支渲染 ChatNodeHost；NodeViewHelpers 带 chatDeps | 与 ChatNodeHost 有循环 import（已确认构建可过，勿拆散） |
| `src/app/routes/BookplatePage.tsx` | 移除 useChatExecution 与三个 chat handler，注入 chatDeps | |
| 已删除 | `useChatExecution.ts`、`platform/services/sse.ts` | 旧 SSE 消费方全部清除，不要复活 |

---

# 三、踩坑记录（维护必读）

## 3.1 时间戳：drizzle pull 不包含应用侧默认值

旧 Python 各模型 `default=get_current_time`（上海时区）是 **SQLAlchemy 应用侧默认值**，`drizzle-kit pull` 生成的 schema 里**没有**。后果：漏写则新记录 `created_at` 为 NULL，列表排序与展示全错。

**铁律**：所有插入/更新**显式写入** `created_at`/`updated_at`（用 `shared/datetime.ts::now()`），响应统一 `toIso`（空格→T，与 pydantic 序列化一致）。新写路由时务必照抄既有写法。

## 3.2 .env 加载：tsx 不自动加载 .env

`tsx` 不会像 Python dotenv 那样自动读 `.env`。必须：
- `npm run start` → `tsx --env-file-if-exists=.env src/server.ts`（已配好，勿改回裸 `tsx src/server.ts`）
- `npm run dev` → `tsx watch --env-file-if-exists=.env src/server.ts`

**优先级**：进程环境变量 > `--env-file` > 默认值（实测）。systemd `EnvironmentFile` 注入的值是权威值——部署时用 systemd 覆盖即可，不用改代码。

## 3.3 bcrypt 兼容

存量库 admin 密码是 passlib 生成的 `$2b$` hash。**必须用 bcryptjs**（可读 `$2b$`），不要换成其他库。冒烟验证过存量 admin 可登录。

## 3.4 useChat 架构的固有行为（与旧实现的三处差异）

1. **切页/删除节点即中止流**：useChat 卸载即 abort，不再像旧实现后台续跑。属更合理行为（服务器资源即时释放），但若未来要「切页后继续」，需要把流状态提升到全局 store——**不要轻易做，工程量不小**。
2. **首条消息的「思考中」占位**改为 text-start 到达后出现（不再乐观插入空占位）。
3. **消息镜像**：useChat 消息 ↔ store（`ChatMessage[]`）双向同步，自定义字段走 `metadata.bookplate`。外部变更（清空/撤销）由宿主检测后恢复。改消息格式时两侧都要动。

## 3.5 AI SDK v7 关键差异（升级 AI SDK 时对照）

- `useChat` 用 **`transport`**（`DefaultChatTransport`/`HttpChatTransport`）取代旧版 `api`/`body`；定制请求体用 `prepareSendMessagesRequest`。
- streamText 的 max tokens 选项名是 **`maxOutputTokens`**（旧版 `maxTokens` 已废弃）。
- `@ai-sdk/react` 必须与 `ai` 同大版本：`@ai-sdk/react@4.x` ↔ `ai@7.x`；`@ai-sdk/react@2.x` ↔ `ai@5.x`。**混装会出现双 `ai` 拷贝，类型全部冲突**（踩过）。
- transient data chunk（`data-agent_*`）只进 `onData` 回调，不进消息正文——AgentStep 展示就靠它。

## 3.6 流协议：前端强耦合点

后端 `stream.ts` 输出的 UI Message Stream 是所有流式端点的唯一协议，前端 `ChatNodeHost`（chat）与 `uiStream.ts`（其余端点）都按它解析。**改 part 名/形状 = 前端联动改**。自定义 part 命名沿用 `agent_*`（`data-agent_tool_call` / `data-agent_tool_result` / `data-agent_status` / `data-agent_file` / `data-agent_image`），这是 Phase 6 Skill Agent 接入的协议预留（前端零改动）。

## 3.7 其他

- **better-sqlite3 `backup()` 在 Windows/Node 组合下不可靠**：部署脚本 `scripts/deploy.sh` 用 `cp` + WAL/SHM 快照，别换回 backup()。
- **settings PUT 空 SET 会生成非法 SQL**：`admin/settings.ts` 已加守卫（set 为空时短路），新写批量更新时注意。
- **drizzle-kit pull 只读存量库**：schema 变更流程 = 改 SQLite 存量表 → 重新 pull，或手写 migration；当前没有 migration 历史，直接改表会有漂移风险。
- 端口：后端 8010（`PORT`，前端 Vite 代理 target 默认指向 8010，改端口需同步前端 `vite.config`）；`server.ts` 直接运行时默认 8000 是**测试/裸跑兜底**，生产走 .env 的 8010。

---

# 四、升级与维护指引

## 4.1 AI SDK 升级（高风险，单独 PR）

版本锁定原则（ADR-017/024）：`ai@7.0.66` + `@ai-sdk/openai-compatible@3.0.30` + `@ai-sdk/react@4.0.69`。

升级步骤：
1. 单独 PR，不与业务改动混提。
2. 前端 `@ai-sdk/react` 与后端 `ai` **必须同步升**（同大版本，见 §3.5）。
3. 升级后**必须重跑**：backend-ts 全部 49 契约测试 + 前端 `tsc -b`/`vite build`。
4. 重点回归：reasoning 拆分（`reasoning-split` 测试）、chat 流式端到端（`text-start → text-delta → text-end → finish → [DONE]`）、Agent 模式 `data-agent_*` part、`prepareSendMessagesRequest` 定制请求体。
5. 若 reasoning 行为漂移：用 `extractReasoningMiddleware` 兜底（计划文档 §4.3 有预案）。

## 4.2 模型配置变更

模型全部走 LLMConfig（数据库 `llm_configs` 表），运行时经 `infrastructure/ai/provider.ts::createAIProvider` 创建 openai-compatible provider（进程内按 `(baseURL, apiKey)` 缓存）。加新模型能力时：
- 业务层调 `llm-service.ts` / `image-service.ts`，**不要直接 import `ai` 包**（架构红线）。
- 新增能力（embedding/TTS 等）需先建 `infrastructure/ai/*` 封装 + 契约测试，再暴露给服务层。

## 4.3 数据库变更

- 存量库 `backend/bookforge.db` 是唯一数据源，TS 后端直接读它（`DATABASE_URL=sqlite:///../backend/bookforge.db` 即可复用旧数据，无需迁移）。
- 改表：优先改存量库后 `npm run db:pull` 重生成 schema；或手写 drizzle migration（当前无历史）。
- 生产 PostgreSQL 是计划方向（drizzle 双驱动已就绪），但**未实测**——切 PG 前需要验证 drizzle schema 与 SQLite 的差异（如 boolean 模式、时间戳类型）。

## 4.4 日常开发流程

1. 改后端 → `cd backend-ts && npx tsc --noEmit && npx vitest run`。
2. 改前端 → `cd frontend && npx tsc -b && npm run build && npx oxlint`。
3. 端到端 → 起后端（`npm run start`），冒烟：登录 → node-registry → chat（LLM/Agent/Mock 三模式）。
4. 前端无测试框架：纯逻辑（chatMessages/uiStream）可临时用 `../backend-ts/node_modules/.bin/tsx scripts/xxx.ts` 冒烟（曾有 `frontend/scripts/chat-verify.ts` 先例，已删）。

---

# 五、路线图（Phase 6-7 待办）

## Phase 6：Skill Agent / deepseek harness（P1，未开始）

- 目标：Skill Agent 执行模式（旧 `skill_agent_service.py` 1085 行，openai-agents-python）。
- 后端已就绪部分：`skill-agent-service.ts`（zip/工作区/文件）、`skill-agent-files.ts`（AGENTS.md 物化）、admin `skill-agent-configs.ts`、bookplate `/chat` 绑定 Skill Agent 时返回明确错误提示（占位）。
- **前端零改动**：`agent_*` 自定义 part 协议已预留（ADR-023）。
- 参考：实现计划 §4.5 的 part 映射表；旧 Python 测试 `test_skill_agent_stream.py` / `test_sandbox_hardening.py` / `test_runtime_symlink.py` / `test_multiturn_history.py` 是契约来源。

## Phase 7：灰度与清理

- 双跑对比（错误率/延迟/token/工具成功率/断流），参考设计文档 §三十二/三十三（灰度/回滚策略）。
- 删除 `backend/` 旧实现，移除 openai / openai-agents 依赖。
- 更新 `README.md`（目前仍是 Python 启动说明）与 `docs/windows_deploy_best_practices.md`（仍是 Python 版）——**已知文档欠账**。

## 其他候选

- **图生图真实 Provider 验证**：Python 走了 litellm 特判（`extra_body.image`，/images/edits 语义），AI SDK 图生图兼容性只在 mock 验证过，**需有真实 Key 环境验证**（计划文档 §4.4 有 providerOptions/transformRequestBody 兜底方案）。
- **生产 PostgreSQL 实测**（§4.3）。
- **前端消息持久化 ↔ useChat 的更深集成**（attachment 能力替换现有附件实现，可选）。
- **性能基准**：设计文档 §三十 列出 Chat 首 token 延迟 ±5% 等指标，尚未建立基准。

---

# 六、快速排障

| 症状 | 排查 |
| --- | --- |
| 登录失败 | 检查 bcryptjs 是否被换掉（§3.3）；存量库密码是 $2b$ |
| 新记录 created_at 为空 | 漏写 now()（§3.1） |
| 环境变量没生效 | .env 加载方式（§3.2）；优先级：进程 env > --env-file |
| 前端类型全炸 | 双 ai 拷贝：检查 @ai-sdk/react 与 ai 版本匹配（§3.5） |
| chat 流式解析异常 | 先看后端原始输出是否为标准 UI Message Stream；自定义 part 名是否被改（§3.6） |
| 切页后流还在跑/不跑 | useChat 卸载即 abort 是预期行为（§3.4.1） |
| 端口冲突 | 生产 8010；裸跑兜底 8000；前端代理 target 必须与 PORT 一致 |
| admin 接口 401 | 需 admin 权限：authenticate + requireAdmin 双 preHandler |
| 连通性测试 /test 失败 | mock 需返回标准非流式 chat.completions JSON（不是 SSE）；image/video/audio 走 /models 探测 |
