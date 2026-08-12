# 计划：skill_agent_service 全面改用 open-agent-sdk（SDK 范式）

## ⚠️ 状态（2026-08-12）：挂起，不执行

用户已决策**继续使用 `openai-agents==0.20.0`**（保留自研沙箱 / 流式 / 多模态 / agent_file 文件卡片），**不迁移** `open-agent-sdk`。

原因（见会话分析）：open-agent-sdk@0.1.0 在仓库内源码中核实到三处硬伤——① `PARTIAL`/`include_partial_messages` 仅声明无任何 yield，无逐 token 流式；② OpenAI provider `_convert_user_message` 丢弃 image block，多模态输入静默消失；③ `sandbox` 选项无实现，`BashTool` 为裸 `create_subprocess_shell`，且删除自研沙箱后 `agent_file`（产物下载卡片）随之消失。换栈以失去 4 项现有能力为代价，仅在需要 MCP/hooks/子代理/内置 skills 时才值得重新评估。

若未来重启本计划，须先补齐：会话策略（内存 Agent 缓存 vs persist/resume）、多模态（改 SDK provider 源码）、流式（自实现 provider stream）。

---

## 决策（已与用户确认，存档）

1. **范围**：完全重构 `backend/app/services/skill_agent_service.py`，用 `open-agent-sdk` 替换 `openai-agents==0.20.0`，采用 SDK 自身的范式（create_agent + 会话态 + SDKMessageType 事件）。
2. **Shell**：改用 SDK 内置工具（`BashTool`/`FileReadTool`/`FileWriteTool`/`FileEditTool`/`GlobTool`/`GrepTool`），**放弃自研 `SandboxedShellExecutor`**（POSIX 资源限制、进程组强杀、绝对路径/`..` 拦截、新文件探测全部移除）。隔离改由 `AgentOptions.permission_mode` + hooks 兜底。
3. **会话态**：多轮对话改用 `create_agent` 内部会话持久化，不再由 `router.py` 每次传完整 OpenAI `messages` 数组（删除 `_to_input_items` 转换链路）。
4. **前端**：本计划**只做后端**，并在文档中明确标注前端不兼容（见"前端不兼容"一节）。前端适配为独立后续任务。
5. **与既有 plan 的关系**：`plans/runtime-symlink-workspace.md` 的"真实文档集中存 + 运行期软链"设计**与 SDK 选择无关**，仍适用，但本计划不再依赖自研沙箱对软链文件下载的放行改造（任务 5 的 `resolve_skill_abs` 改造保留，因 `/skill-files` 下载仍需工作区边界）。

## 关键事实（来自代码与 SDK 源码核对）

- `open-agent-sdk==0.1.0`（PyPI `open-agent-sdk`），__init__ 暴露：`create_agent`/`Agent`/`query`、`AgentOptions`、`SDKMessageType`、`BashTool` 等 35 工具、`define_tool`/`tool`、`register_skill`/`SkillDefinition`、`save_session`/`load_session`/`list_sessions`/`fork_session`、`HookEvent`/`create_hook_registry`。
- SDK 内部用 **Anthropic 消息格式** 作 canonical，provider 层自动转换 OpenAI 兼容端点（DeepSeek/Qwen/vLLM/Ollama）。`AgentOptions.model` 前缀自动判定 `api_type`（`gpt-`/`deepseek-`/`qwen-`/`o1-`/`o3-`/`o4-` → `openai-completions`），也可 `api_type="openai-completions"` 显式指定。
- `AgentOptions` 关键字段：`model`/`api_key`/`base_url`/`api_type`/`system_prompt`/`append_system_prompt`/`allowed_tools`/`disallowed_tools`/`permission_mode`（`default`/`acceptEdits`/`dontAsk`/`bypassPermissions`/`plan`）/`max_turns`/`thinking`/`mcp_servers`/`hooks`/`session_id`/`persist_session`/`resume`/`continue_session`/`cwd`。
- `SDKMessageType` 枚举：当前 README 列出 `ASSISTANT`/`RESULT`/`TOOL_USE`/system 子类型；具体字段需读 `src/open_agent_sdk/types.py` 确认（`AssistantMessage`/`ToolUseBlock`/`SDKResultStatus`）。
- **依赖冲突**：`requirements.txt` 当前 pin `openai==2.54.0`（给 openai-agents 用）。换 SDK 后：`openai-agents` 与 `openai==2.54.0` 约束一并移除；改为 `open-agent-sdk`，并接受其拉入的 `openai`/`httpx` 版本（需实测，可能放宽 `openai` 上限）。先 `pip install open-agent-sdk` 看依赖树。
- 当前 `run_skill_agent` 事件消费者：`router.py:957` → `_sse_from_agent_event(evt, content_event="message")`（`router.py:964`）+ `agent_file` 专属分支（`router.py:969`）。前端消费见 `useChatExecution.ts` / `useNodeExecution.ts` / `agentSteps.ts` / `AgentActivity.tsx`，依赖事件名 `content_delta`/`tool_call`/`tool_result`/`agent_file`/`status`/`done`/`error`。

## 任务清单

### 任务 0：依赖与 API 落地核对
- `pip install open-agent-sdk`，运行 `python -c "import open_agent_sdk; print(open_agent_sdk.__version__)"` 确认可用。
- 读 `src/open_agent_sdk/types.py`、`agent.py`、`tools/bash.py`，确认：
  - `create_agent(options)` 返回 `Agent` 的会话 API（`query`/`prompt`/`get_messages`/`close`）。
  - `BashTool` 等是否需要额外配置（cwd、permission）。
  - `SDKMessage`/`AssistantMessage`/`ToolUseBlock` 的真实字段结构（用于事件映射文档）。
- 修改 `requirements.txt`：删除 `openai-agents==0.20.0`、`openai==2.54.0`（或保留 openai 若 SDK 需要），加 `open-agent-sdk`。更新文件头注释里关于 openai 2.x/3.x 的说明。
- **验证**：`python -c "from app.services import skill_agent_service"` 在改动前仍 import 旧 SDK，改动后 import 新 SDK 无错。

### 任务 1：重写 skill_agent_service 的 agent 构建
- 删除：`build_agent`（openai-agents `Agent`/`FunctionTool`/`OpenAIProvider`/`RunConfig`）、`SandboxedShellExecutor` 全部（含 `_apply_child_limits`/`_kill_process_group`/`_escape_reason`/`_diff`/`_snapshot`）、`_to_input_items`。
- 新增 `build_agent(config: SkillRuntimeConfig, skill_names) -> Agent`：
  - `AgentOptions(model=config.model_name, api_key=config.api_key, base_url=config.base_url, api_type="openai-completions", system_prompt=_build_instructions(...), allowed_tools=[BashTool, FileReadTool, FileWriteTool, FileEditTool, GlobTool, GrepTool], permission_mode="bypassPermissions", max_turns=MAX_TURNS, cwd=str(workspace_root(user_id)), session_id=<per node>, persist_session=...)`。
  - `api_type` 默认 `openai-completions`（保持与现端点兼容）；如端点为 Anthropic 兼容则另判。
- `_build_instructions` 保留但去掉"工作区规则：仅相对路径"段（沙箱已弃），其余（system_prompt + SKILL.md 段落）不变；AGENT.md 软链读取仍按既有 plan 任务 4 接入。
- skill 加载仍用 `list_installed_skills(user_id)` + `skill_names` 过滤（既有函数保留，`resolve_skill_abs`/`install_skill_zip`/`read_skill_meta` 保留）。

### 任务 2：重写 run_skill_agent（会话态 + SDKMessage 流）
- 签名改为：`run_skill_agent(config, user_prompt: str, skills=None, session_key: str) -> AsyncGenerator[SDKMessage]`（或返回 SDK 原生消息）。
  - **移除** `messages: list` 参数；改为单条 `user_prompt` 文本，由 SDK 内部会话维护多轮。
  - `session_key` 来自 `router._agent_session_key`（保持"同用户同节点重试共享上下文"语义）。
  - 首次调用 `agent = create_agent(...)`（任务 1），后续同 session 用 `agent.query(prompt)` 或 `agent.prompt()`。
- 事件产出：直接 `yield` SDK 原生 `SDKMessage`（`type`/`text`/`tool_use` 等），**不再**映射成 `content_delta`/`tool_call`/`tool_result`/`agent_file`。即 `run_skill_agent` 成为 SDK 消息流的透传/轻封装。
- 异常：捕获 SDK 异常 → 抛 `SkillAgentError`（保持 `router.py:976` 的 error 事件可达）。

### 任务 3：router.py 适配
- `router.py:957` 调用处：改为传入 `user_prompt=_multimodal_messages(...)` 的首条 user 文本（或 SDK 支持的多模态消息，需按任务 0 核对 SDK 多模态输入形态；若 SDK 暂不支持图片输入，记录"多模态 skill 输入暂不支持"并 `text` 降级）。
- 删除 `_sse_from_agent_event(evt, content_event="message")` 调用与 `agent_file` 专属分支（`router.py:964-975`）；改为直接把 `SDKMessage` 序列化为 SSE 事件（事件名取 `SDKMessage.type`）。
- `SkillRuntimeConfig` 保留（`router._skill_agent_config_from` 不变）。
- 保留 `/skill-files` 下载与 `resolve_skill_abs` 边界逻辑（既有 plan 任务 5），因与 SDK 无关。

### 任务 4：删除/降级已废弃测试，按新契约补测试
- `backend/tests/test_sandbox_hardening.py`：大量断言自研沙箱（`_escape_reason`/资源限制/进程组）**整体失效**。删除或标注 `@pytest.mark.skip(reason="sandbox 已改用 SDK 内置工具")`。
- `backend/tests/test_skill_agent_stream.py`：原断言 `content_delta`/`tool_call`/`tool_result`/`agent_file` 契约失效。改为断言"SDKMessageType 流包含 ASSISTANT 文本 + TOOL_USE + RESULT"，并用 mock OpenAI 兼容端点（沿用现有 mock 基建）验证多轮会话态。
- `backend/tests/test_multiturn_history.py`：改为验证 SDK 会话态多轮（不传 messages 数组，靠 session_key 复用），断言第二轮能看到首轮上下文。
- 新增 `tests/test_runtime_symlink.py`（既有关联 plan 任务 6）保留，验证软链装配 + `resolve_skill_abs` 放行（与 SDK 无关）。

### 任务 5：SDK 安装目录/资产（可选，低成本）
- SDK 自带 5 个 bundled skills（`commit`/`review`/`debug`/`simplify`/`test`）与项目 SKILL.md 概念不同，**不启用** `init_bundled_skills()`，避免污染用户 skill 语义。
- 不引入 MCP / subagent / cron 等高级特性（超出当前 scope）。

## 前端不兼容（本计划不做，仅记录）

当前前端强依赖被移除的事件契约：
- `useChatExecution.ts:134`、`:216-237`、`useNodeExecution.ts:71-195`、`agentSteps.ts:34-41` 解析 `content_delta`/`tool_call`/`tool_result`/`status`/`done`。
- `AgentActivity.tsx:26,41` 的 `agent_file` case（skill 产物下载卡片）。
- `GenerationDetailPanel.tsx:126,130` 的 `agent_file` 引用。
- `platform/types/index.ts:23,237,441` 定义的 `SkillAgentEvent` 类型（`content_delta`/`tool_call`/`tool_result`/`agent_file`）。

替换后后端只发 `SDKMessage.type` 事件，上述解析全部失效：工具调用/结果不再单独渲染、`agent_file` 下载卡片消失、多模态输入降级。前端需独立重写：消费 `SDKMessageType`、渲染 `ASSISTANT` 文本增量 + `TOOL_USE`/`RESULT` 工具活动、移除 `agent_file` 卡片。

## 风险 / 开放问题

- **R1 隔离削弱**：内置 `BashTool` 无 POSIX 资源限制与 `..` 拦截，恶意 skill 可读服务器可访问文件/外联网络。需向用户明确：真隔离靠 Docker，本版不提供。
- **R2 多模态**：SDK 是否支持图片输入未在项目 README 证实；若不支持，`_multimodal_messages` 需降级为文本（信息丢失）。任务 0 必须核实。
- **R3 成熟度**：`open-agent-sdk` 仅 8 commits / 43 stars，API 可能变动；`__version__=0.1.0`。建议锁定版本并保留契约测试防回归。
- **R4 依赖树**：移除 `openai-agents` 后 `openai` 上限可能放开，需确认不影响 `backend` 其他模块（如 fastclaw_service 是否用 openai 直接调用）。
- **R5 reasoning 透传**：DeepSeek/Qwen 思维链在 SDK 中映射未证实，可能不再透传（用户已选不保留，记录即可）。

## 验证

1. **单元/集成**：`tests/test_skill_agent_stream.py`（新 SDKMessage 契约）、`tests/test_multiturn_history.py`（会话态）、`tests/test_runtime_symlink.py`（软链 + 下载放行）、`test_sandbox_hardening.py`（skip 标注）。
2. **手动**：
   - admin 保存含提示词 SkillAgentConfig → 确认可构建 `AgentOptions` 无异常。
   - 前端 chatnode 发送文本 → 后端 `run_skill_agent` 经 SDK 返回 `SDKMessage` 流；SSE 原样透传 `type`。
   - 多轮：同一 node 连续发两条，确认第二轮携带首轮上下文（会话态）。
   - skill 加载：上游 skill_search 选中的 skill 名进入 `_build_instructions` 的 SKILL.md 段落。
   - 端点兼容：DeepSeek/Qwen/vLLM 等 OpenAI 兼容端点经 `api_type="openai-completions"` 正常跑通。
3. **隔离确认（负向）**：确认 `BashTool` 不强制 `..` 拦截、`agent_file` 卡片已失效、前端控制台对未知事件名无致命错误（仅不渲染）。

## 不做（Out of scope）

- 前端 SSE 渲染重写（独立任务）。
- 自研沙箱等价重建（POSIX 限制/进程组/逃逸拦截/新文件探测）。
- SDK MCP / subagent / cron / 内置 skills 启用。
- 既有 `runtime/` 软链 plan 的任务 1-4（AGENT.md 软链、skill 真实解压、运行期装配）—— 这些与 SDK 解耦，可并行推进，本计划假设其已完成或另行执行；本计划仅保留其任务 5（`resolve_skill_abs` 放行）因下载边界需要。
