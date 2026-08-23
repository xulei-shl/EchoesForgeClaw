# ChatNode Skill Agent 模式（pi CLI 子进程 + pi-image-gen）实施跟踪

> 方案：在 `/api/modules/bookplate/chat` 实现 skill_agent 第三模式。每次运行把 admin 提示词（AGENTS.md 软链）、
> 选中 skills（软链/复制）、大模型配置（.pi-agent/models.json）、绘图模型（settings.json pi-image-gen 段）
> 装配进 `runtime/{uid}/workspace/{chatid}/`，以该目录为 cwd 子进程运行 pi CLI（--mode json），JSONL 事件
> 归一化为现有 ChatStreamEvent SSE 流，产物文件经快照差分推 agent_file 卡片下载。

## 任务清单

- [x] 0. 冒烟：安装依赖、确认 settings 解析层、--session 续聊、-e 扩展加载、@file 附图、image_generate 全链路
- [x] 1. DB 迁移：skill_agent_configs.image_llm_config_id 可空列（schema + INITIAL_DDL + 存量库 ALTER 补列）
- [x] 2. admin：API payload/out/校验（kind='image'）+ SkillAgentConfigsPage 绘图模型下拉
- [x] 3. resolvePiBin()：包内 bin 解析 + PI_BIN 覆盖 + 缺失中文报错；resolveImageGenExtension()
- [x] 4. preparePiWorkspace()：AGENTS.md 条件软链 / .agents/skills/ 条件装配 / models.json / settings.json（幂等）
- [x] 5. runPiAgent()：JSONL→ChatStreamEvent / @file 附图 / 快照差分 agent_file / abort 杀树 / stderr→error
- [x] 6. skillAgentConfigFrom()：对话 LLM（llmConfigId 优先，回退旧三件套）+ 绘图 LLM（绑定→全局回退）
- [x] 7. 路由接线：ai-nodes.ts 替换占位分支
- [x] 8. 测试 + 回归 + 文档注记（接线文档 chat 模式注记 / v2 计划状态）

## 关键决策记录

| 决策 | 结论 |
|---|---|
| 集成方式 | CLI 子进程（--mode json），进程隔离、abort=杀树、升级解耦 |
| 提示词注入 | chatid 落 AGENTS.md + --no-context-files 阻断祖先污染 + --append-system-prompt <文件路径> 注入 |
| 多轮记忆 | --session 会话文件；忽略请求 messages；清空对话=workspaceId 重生=新会话 |
| 图片输入 | data URL 落盘 inputs/ 后以 CLI @file 原生附加；**对话模型须声明 input:["text","image"]**（multimodal kind） |
| 图片生成 | @amaster.ai/pi-image-gen 经 -e 显式加载（不走 pi install）；outputDir=outputs/ → 差分 → agent_file 卡片 |
| 绘图模型 | SkillAgentConfig.image_llm_config_id（可空，kind='image'）→ 空回退全局 active image 配置 |
| 设置读取 | pi-shared resolveConfigDir = PI_CODING_AGENT_DIR ?? PI_AGENT_HOME ?? ~/.pi/agent（源码核实），双 env 注入 {ws}/.pi-agent |

## 验证记录

| 检查 | 结果 |
|---|---|
| 冒烟 E2E（本地 mock LLM+images）：json 事件流 / --session 续聊（msgs 2→4→6）/ -e 扩展 / settings 层命中 / image_generate 落盘 outputs/smoke.png / @file imgparts=1 | ✅ 全部通过 |
| --append-system-prompt <AGENTS.md 文件> 注入 system message | ✅ sys-has-marker=true |
| backend-ts `npm run typecheck` | ✅ 通过 |
| backend-ts `npm test` 全量 | ✅ 10 文件 95 用例全过（新增 pi-agent-workspace 6 例 + pi-agent-run 端到端 2 例，真实 pi 子进程） |
| 迁移验证：全新库含列 / 存量库自动补列 | ✅ 通过 |
| frontend `npm run build` | ✅ 通过（顺手修复存量错误：journal/text/fontRegistry.ts 兜底对象补全 JournalFontPreset 字段；chunk >1MB 警告为既有现象） |
| 文档注记 | ✅ 接线文档 §2 chat 三模式说明 + plans/runtime-symlink-workspace.md 状态头 |

## 实现补充决策（实施中追加）

| 决策 | 结论 |
|---|---|
| 上传 skill 工作区语义 | 强制 cpSync 复制进工作区（私有实体）；Bifrost 登记为软链时才软链共享区——修正初版误用 symlinkOrCopy 导致上传件被软链的问题 |
| 二进制定位 | BACKEND_ROOT = REPO_ROOT/backend-ts（勿用 dirname(REPO_ROOT)）；PI_BIN env 兜底覆盖 |
| spawn stdin | 子进程 stdio ['ignore','pipe','pipe']，避免管道 stdin 使 pi 等待输入 |
| 完成判定 | 进程 close 且 stdout end 后出队完毕 → 错误分支（auto_retry_end success=false 即时报错；兜底 code!==0 或 lastError 收尾报错）→ 产物差分 |
| 差分排除 | .agents/ .pi/ .pi-agent/ inputs/ 前缀与 AGENTS.md 不算产物 |
