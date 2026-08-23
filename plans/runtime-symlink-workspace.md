# 计划：Skill Agent 运行时工作区（runtime/ 真实文档集中 + 按需装配）— v2

> **状态更新（2026-08-23）**：本计划的工作区/软链装配部分已在 backend-ts 落地
> （`skill-agent-service.ts` / `skill-agent-files.ts` / admin 物化）。原「openai-agents 执行栈」
> 的执行器部分改为 **pi CLI 子进程**方案落地：chat 节点 Skill Agent 模式见
> `backend-ts/src/services/pi-agent-service.ts`（pi --mode json + AGENTS.md 注入 +
> .pi-agent 配置物化 + image_generate 扩展），任务 4/5 由其取代。

## 决策更新（2026-08-12，用户已确认）

1. **执行栈不变**：继续使用 `openai-agents==0.20.0` + 自研 `SandboxedShellExecutor`（沙箱、流式、多模态、agent_file 文件卡片全部保留）。**不迁移** `open-agent-sdk`；`plans/open-agent-sdk-rewrite-plan.md` 挂起存档（详见该文件顶部状态标记）。
2. **真实文档跨用户集中存放于仓库根 `runtime/`**（脱离 `backend/` 源码树，整目录 gitignore）。
3. **工作区目录约定（本版核心变更）**：
   - 节点工作区 = `runtime/{user_id}/workspace/{node_id}_{timestamp}/`
   - skill 统一装载到工作区子目录 **`.agents/skills/`**（注意点号前缀）：
     - **Bifrost 检索安装的 skill** → 工作区内为**软链接**，指向 `runtime/.agent/skills/{name}/`（真实包跨用户共享，零拷贝）；
     - **Skill 检索节点用户上传的 zip** → 工作区内为**真实解压目录**（用户私有数据，不共享）。
   - `AGENTS.md` **仅当该节点的 SkillAgentConfig 引用了提示词（prompt）时存在**：真实文件在 `runtime/.agent/agents/{agent_id}/AGENTS.md`，工作区根软链一份；未配置提示词则**完全不生成**。

> 本计划与「是否换 SDK」已解耦并锁定：软链装配、真实文档存储、下载放行逻辑全部与执行引擎无关，在 openai-agents 栈下直接落地。

## 目标

- 真实文档（系统提示词 / Bifrost skill 包）跨用户集中一份，运行时按节点按需装配进工作区，避免每个工作区复制一份。
- 用户上传的 skill 保持私有语义（真实目录、不跨用户共享），与检索加载的 skill（软链）在**同一 `.agents/skills/` 下共存**。
- 整个 `runtime/` 加入 `.gitignore`，不纳入版本控制 / 部署镜像。

## 关键事实 / 约束（来自代码核对，2026-08-12）

1. **路径基准**：仓库根 = `skill_agent_service.py` 的 `Path(__file__).resolve().parents[3]`（`app/services/` 三层）。统一 `REPO_ROOT` 拼 `runtime/...`。
2. **沙箱保留**（沿用现状，`skill_agent_service.py`）：POSIX rlimit、进程组强杀、绝对路径/`..` 拦截、新文件探测（`_snapshot`/`_diff` → `agent_file` 事件）。软链不新增逃逸面（既有残余风险记录在案，真隔离需 Docker）。
3. **`resolve_skill_abs` 会拒绝软链文件下载**（`skill_agent_service.py:164`，被 `bookplate/router.py` 的 `/skill-files` 使用）：`Path.resolve()` 穿透软链后落到 `runtime/.agent/...`，不在工作区内 → 404。**必须改造放行逻辑**（任务 6）。
4. **`Path.rglob` 默认不递归符号链接目录**：软链进来的共享 skill 不会被 `_diff` 误判为「新产生文件」，`agent_file` 探测天然正确；用户上传的真实目录在工作区内，其被 agent 修改的文件仍会正常上报（符合预期）。
5. **运行时调用缺口**：`run_skill_agent`（`skill_agent_service.py:675`）不接收 node_id / workspace；`/chat` 的 `ChatRequest.node_id` 未传给 skill 分支（`bookplate/router.py:951-975`）。需把工作区路径传进运行时（任务 4）。
6. **`install_skill_zip` 单一实现服务两个入口**（`bookplate/router.py` `/skills/install`、`/skills/upload`）：本版拆分为**共享安装**与**用户私有安装**两条路径（任务 2）。
7. **前端 SkillSearchNode 仍为单选**（`SkillSearchNode.tsx` `handleInstallBifrost` / `handleUploadZip`，单数字段 `skillName` 等；`useChatExecution.ts:119 collectSkillNames` 每个上游节点取一个名字）。多选多 skill 改造见附录（后端已支持 `skills: List[str]`）。

## 目录约定（全部相对仓库根 `runtime/`）

```
runtime/                            # 仓库根，整目录 gitignore
  .agent/                           # 跨用户共享的真实文档（只读给运行时的「源」）
    skills/{skill_name}/            #   Bifrost 检索安装的真实 skill 包（SKILL.md + scripts/ ...）
    agents/{agent_id}/AGENTS.md     #   真实系统提示词（仅当该 SkillAgentConfig 引用了提示词）
  {user_id}/
    skills/                         # 该用户「已安装 skill」登记目录（列表/删除的单一事实来源）
      {name}/                       #   Bifrost 安装：软链 -> ../../../.agent/skills/{name}
      {name}/                       #   用户上传安装：真实解压目录（私有）
    workspace/
      {node_id}_{timestamp}/        # 单个 chat 节点的工作区（node_id + 首次运行时间戳，见「开放问题 Q3」）
        AGENTS.md                   #   软链 -> 真实 AGENTS.md（仅当配置了提示词；否则该文件不存在）
        .agents/
          skills/
            {name}/                 #   软链 -> runtime/.agent/skills/{name}（Bifrost 检索加载）
            {name}/                 #   真实目录（用户上传，从 {user_id}/skills/{name} 复制进来）
        ...                         #   agent 运行时产生的其它文件（脚本输出、产物等）
```

- `agent_id` 取值：`SkillAgentConfig.id`，跨用户共享（同一配置的节点读同一份 AGENTS.md）。
- 软链统一**使用绝对目标路径**（跨平台可读、避免逐层 `../../` 计算错误）；Windows 无 symlink 权限时走**真实复制兜底**（任务 3），功能等价。
- 工作区目录名中的 `timestamp`：**前端在节点首次运行时生成 `workspaceId`（如 `{node_id}_{Date.now()}`）持久化到 `node.data`，随 `/chat` 请求下发**；后端以它（消毒后）作为工作区目录名。同节点同 workspaceId 多轮复用同一工作区（产物/文件跨轮保留）；清空对话（epoch 递增）时前端重新生成 workspaceId → 干净对话对应干净工作区。

## 三种来源的装载语义（本版核心）

| 来源 | 安装时（Skill 检索节点） | 运行时（chat 节点执行） |
| --- | --- | --- |
| **Bifrost 检索**（`/skills/install`） | 校验后真实解压到 `runtime/.agent/skills/{name}/`；在该用户 `runtime/{user_id}/skills/` 下登记软链 | `prepare_runtime_workspace` 在工作区 `.agents/skills/{name}` 建软链指向真实包（已存在跳过） |
| **用户上传 zip**（`/skills/upload`） | 校验后真实解压到 `runtime/{user_id}/skills/{name}/`（私有，仅本用户可见） | 复制（`copytree`）到工作区 `.agents/skills/{name}`，**保持真实目录**（用户语义：上传即私有实体） |
| **AGENTS.md** | admin 保存/更新 SkillAgentConfig 时，若引用的 prompt 内容非空则写 `runtime/.agent/agents/{id}/AGENTS.md`；为空则不写（并删除已存在的） | 若 `runtime/.agent/agents/{id}/AGENTS.md` 存在 → 工作区根软链 `AGENTS.md`；否则无此文件 |

- 指令构造（任务 5）以**物化的 AGENTS.md 为运行时唯一事实来源**：存在则读入 instructions，不存在则无系统提示词段。管理端保存 prompt 即同步刷新文件，保证文件与 DB 一致。
- 已安装列表/删除：以 `runtime/{user_id}/skills/` 为准（`list_installed_skills` / `/skills` / `/skills/{name}` DELETE 全部改为读/写该目录），**避免共享区跨用户可见性泄漏**（用户 A 安装的 skill 不出现在用户 B 的列表；运行时仍只装配当前节点选中项）。

## 任务清单

### 任务 0：常量与目录工具（`skill_agent_service.py` 顶部）
- 新增：`REPO_ROOT = Path(__file__).resolve().parents[3]`、`RUNTIME_ROOT = REPO_ROOT / "runtime"`、`REAL_SKILLS_ROOT = RUNTIME_ROOT / ".agent" / "skills"`、`REAL_AGENTS_ROOT = RUNTIME_ROOT / ".agent" / "agents"`、`USER_SKILLS_ROOT = RUNTIME_ROOT / str(user_id) / "skills"`。
- 新增 `node_workspace(user_id, workspace_id) -> Path`：创建并返回 `RUNTIME_ROOT / str(user_id) / "workspace" / workspace_id`（workspace_id 预先消毒为 `[A-Za-z0-9_-]`）。
- 废弃 `_WORKSPACES_ROOT`（旧 `backend/workspaces/skills/`），迁移见任务 7。

### 任务 1：AGENTS.md 物化
- 新增 `write_agent_md(agent_id, content) -> Optional[Path]`：`content` 非空 → 写 `REAL_AGENTS_ROOT / str(agent_id) / "AGENTS.md"` 并返回路径；为空 → 删除已存在文件并返回 `None`（「未配置提示词则没有」语义）。
- 触发点：`backend/app/api/admin/skill_agent_configs.py` 创建/更新 SkillAgentConfig 时，以最终生效的提示词内容（引用的 prompt 模板 content）调用 `write_agent_md`。
- 存量：迁移任务 7 遍历已有配置补写/删除。

### 任务 2：skill 安装双路径
- 改写 `install_skill_zip`（Bifrost 检索路径）：
  - 解压目标 → `REAL_SKILLS_ROOT / name`（复用现有 zip-slip 防护与大小/数量上限校验，`skill_agent_service.py:228` 逻辑平移）；
  - 在该用户登记目录 `USER_SKILLS_ROOT / name` 建软链指向真实包（Windows 失败退化为复制兜底）。
- 新增 `install_user_skill_zip(user_id, zip_bytes)`（上传路径）：解压到 `USER_SKILLS_ROOT / name`（真实目录，同样走 zip-slip/上限校验）。
- 调用方分流（`bookplate/router.py`）：`/skills/install`（:1178）→ `install_skill_zip`；`/skills/upload`（:1209）→ `install_user_skill_zip`。返回 meta 不变。
- `list_installed_skills` / `/skills` / DELETE `/skills/{name}`：基目录改为 `USER_SKILLS_ROOT`（软链目录用 `read_skill_meta` 需能穿过软链读 SKILL.md——`Path.is_dir()`/`read_text` 天然穿透，无需改）。

### 任务 3：运行时工作区装配
- 新增 `prepare_runtime_workspace(user_id, workspace_id, agent_id, skill_names) -> Path`：
  1. `ws = node_workspace(user_id, workspace_id)`；
  2. 若 `REAL_AGENTS_ROOT / str(agent_id) / "AGENTS.md"` 存在 → 软链 `ws/AGENTS.md`（否则不建）；
  3. 建 `ws/.agents/skills/`；
  4. 对每个 `skill_name`：查 `USER_SKILLS_ROOT / name`——若它是软链（Bifrost）→ 在工作区 `.agents/skills/{name}` 建软链指向 `REAL_SKILLS_ROOT / name`；若它是真实目录（上传）→ `shutil.copytree` 复制进工作区。
- 所有软链创建捕获 `OSError` 兜底为真实复制（Windows 无权限仍可用）。

### 任务 4：运行时打通（沙箱保留）
- `SandboxedShellExecutor.__init__(user_id, workspace: Optional[Path] = None)`：`self.root = workspace or workspace_root(user_id)`；其余（rlimit/进程组/逃逸拦截/`_snapshot`/`_diff`）不变。
- `build_agent(config, skills, workspace=None)` 透传 workspace。
- `run_skill_agent(config, messages, skills=None, workspace_id=None)`：由 workspace_id 装配工作区（或调用方传入已装配的 `workspace`）。
- `bookplate/router.py` `/chat` skill 分支（:951-975）：用 `payload.workspace_id`（新字段，前端下发）调 `prepare_runtime_workspace(user_id, workspace_id, nc.skill_agent_config.id, payload.skills)` 后传入 `run_skill_agent`；`ChatRequest` 增加 `workspace_id: Optional[str] = None`（缺省回退 node_id 派生，兼容旧前端）。

### 任务 5：指令构造以 AGENTS.md 为源
- `_build_instructions`（`skill_agent_service.py:285`）：若工作区存在 `AGENTS.md`，读全文作为系统提示词段（置于 skills 段之前）；不存在则无该段。不再从 DB `system_prompt` 字段注入（文件即唯一事实来源，管理端保存时已同步）。
- skill 段逻辑不变（`list_installed_skills` 过滤 + SKILL.md 正文），位置字段 `skills/{name}` 相对工作区仍命中（软链可读）。

### 任务 6：`resolve_skill_abs` 软链放行（关键，否则 `/skill-files` 下载 404）
- 现状（`skill_agent_service.py:164`）：`candidate = (root / rel).resolve()` 再 `root in candidate.parents` 判定。
- 改造：`real = candidate.resolve()`；若 `real` 不在工作区内，则额外放行前缀 `REAL_SKILLS_ROOT` / `REAL_AGENTS_ROOT` / `USER_SKILLS_ROOT`；否则拒绝。`..` 越界仍按原逻辑拒绝。
- 影响：`bookplate/router.py` `/skill-files`（:1240）下载软链 skill 内文件不再 404；`agent_file` 产物落在工作区真实目录内本就放行。

### 任务 7：gitignore + 存量迁移 + 测试
- 仓库根 `.gitignore` 追加 `/runtime/`（旧 `backend/workspaces/` 如不再使用一并忽略并删除）。
- 迁移脚本（仅把旧位置当来源）：
  - 遍历已有 `SkillAgentConfig` → 按任务 1 规则写/删 AGENTS.md；
  - 遍历旧 `backend/workspaces/skills/{uid}/skills/*` → 统一移入 `runtime/{uid}/skills/`（按「用户私有」处理，保守不污染共享区），原目录删除。
- 测试：
  - `tests/test_skill_agent_stream.py`、`tests/test_multiturn_history.py`：更新工作区基目录相关断言（仍跑 mock 端点，断言不动）；
  - 新增 `tests/test_runtime_symlink.py`：软链装配（Bifrost 软链 + 上传真实目录共存）、AGENTS.md 条件存在、`resolve_skill_abs` 放行、Windows 复制兜底、跨用户列表隔离；
  - `tests/test_sandbox_hardening.py` 保留（沙箱未动，验证软链改造未破坏拒绝逻辑）。

## 前端配合（最小改动，独立可并行）

- `ChatRequest` 增加 `workspace_id`：`useChatExecution.ts` 发送体带上 `node.data.workspaceId`；节点首次运行生成并持久化 `workspaceId`（同 node 复用、清空对话后重新生成）。
- SkillSearchNode 多选改造：见附录（`skillSelections: SkillSelection[]`），与本计划解耦。

## 风险 / 开放问题

- **Q1 symlink 权限**：Linux/macOS 默认可建；Windows 需开发者模式/管理员，否则复制兜底（功能等价，仅失去零拷贝）。已含兜底。
- **Q2 上传 skill 的私有语义**：上传技能真实复制进工作区意味着每节点多一份磁盘占用；若未来上传量大有优化诉求，可改为「真实一份在 `{user_id}/skills/` + 工作区硬链接/软链」。当前按用户确认的「真实目录」实现。
- **Q3 workspace_id 生命周期**：前端持久化 `node.data.workspaceId`（`{node_id}_{ts}`）。清空对话（epoch++）→ 重新生成 → 干净工作区。多轮不换 id → 产物跨轮保留。需在 `useChatExecution` 的 clear 逻辑里同步重置。
- **Q4 历史上传 skill 归属**：迁移时无法区分「Bifrost 装」还是「上传装」，统一按私有处理（保守）。
- **Q5 共享区 GC**：`runtime/.agent/skills/{name}` 被用户删除登记后不自动清理（保留无副作用）；如需回收由运维定期清理或后续加引用计数。
- **安全**：软链不新增逃逸面；沙箱残余风险（解释器内联越界、网络未限制）依旧记录，真隔离需 Docker。

## 验证

1. **单元/集成**：`tests/test_skill_agent_stream.py`、`tests/test_multiturn_history.py`、`tests/test_runtime_symlink.py`、`tests/test_sandbox_hardening.py`。
2. **手动**：
   - admin 保存含提示词的 SkillAgentConfig → `runtime/.agent/agents/{id}/AGENTS.md` 生成；改空 → 删除；不配置 → 始终无。
   - 前端 chatnode 运行 → `runtime/{uid}/workspace/{workspaceId}/` 下：配置了提示词则根有 `AGENTS.md` 软链；上游检索选中的 skill 在 `.agents/skills/` 为软链；用户上传的为真实目录；agent 能 cat 各自 SKILL.md。
   - `/skill-files?path=.agents/skills/{name}/SKILL.md`（Bifrost 软链）与上传 skill 内文件均可下载（不再 404）。
   - 多用户：用户 A 的 `/skills` 列表不含用户 B 安装的 skill；B 的节点运行时只装配自己选中的项。
   - Windows 无权限环境：退化为复制后下载与执行均正常。
3. **多轮**：同节点连续两轮，第二轮能看到首轮在工作区产生的文件（workspace_id 未变）；清空对话后工作区重置。

---

# 附：SkillSearchNode 单节点多选多个 skill（纯前端，与主计划解耦）

## 现状核查（关键）

- **后端已支持多 skill**：`ChatRequest.skills: List[str]`、`run_skill_agent(skills=...)` 按列表加载多个；`useChatExecution.ts:119 collectSkillNames` 遍历**所有**上游 `skill_search` 节点收集名称。
- **唯一缺口在 SkillSearchNode 单选**：`SkillSelection`（`platform/types/index.ts:427`）与节点 data 都是**单数**（`skillName`/`skillDescription`/`skillBody`/`skillFiles`/`skillPath`/`skillSource`），picker 点击即安装并立即关闭（`SkillSearchNode.tsx:118 handleInstallBifrost`、`:140 handleUploadZip`）。
- 结论：**本次仅前端改动，后端零改动**。

## 数据模型变更

- `platform/types/index.ts`：`SkillSelection` 保留不变（表示"一个 skill 的选择结果"）；节点 data 由单数字段改为数组 `skillSelections: SkillSelection[]`（默认 `[]`）。
- `BookplatePage.tsx:1124 handleUpdateSkillFor`：改为 `onUpdateSkills(id, selections: SkillSelection[])`，整块替换 `data.skillSelections`（对比旧/新 JSON 决定是否记历史）。
- `CanvasNodeViews.tsx:300 case 'skill_search'`：传 `selections={node.data?.skillSelections ?? []}` 与 `onUpdateSkills={h.handleUpdateSkillsFor}`，去掉旧的单数 props 透传；`title` 取首个选中 skill 名或默认。

## SkillSearchNode 组件改造

- Props：`skillName/skillDescription/skillBody/skillFiles` → 改为 `selections: SkillSelection[]`；`onUpdateSkill` → `onUpdateSkills: (id, selections[]) => void`。通过 `name` 判等去重。
- 内部状态：`selected: SkillSelection[]`（由 props 受控同步），`selectedNames = new Set(selected.map(s=>s.name))`。
- **点击切换选中，不自动关闭**（用户已确认）：
  - `handleInstallBifrost` / `handleUploadZip`：安装成功后，若 `name` 已在 `selected` 则移除（toggle 取消），否则追加；**不调用 closePicker**，保持打开。
  - 列表条目渲染勾选态：已选显示 Check/X 标记；再次点击取消选择（仅从选择集移除，不卸载工作区 skill）。
  - 已选项区：在 picker 内/节点卡片展示已选 chip 列表，可单独移除。
  - 底部「完成」按钮关闭 picker。
- 节点卡片：改为「已选 N 个 skill」+ 名称列表；空选择时提示"尚未选择 skill"。

## collectSkillNames 适配（`useChatExecution.ts:119`）

- 改为读取 `p.data?.skillSelections` 数组：`for (const s of p.data.skillSelections ?? []) if (s.name && !names.includes(s.name)) names.push(s.name)`。
- 其余逻辑（按 edge 上游、幂等去重）保持不变。

## 边界 / 风险

- 存量节点 data 仍是单数旧字段：读取时 `node.data?.skillSelections ?? []` 默认空数组；旧单数字段可忽略（向后兼容，旧节点重新编辑即迁移）。
- 一个 skill 被多个 SkillSearchNode 选中：`collectSkillNames` 已去重。
- 上传/安装失败：保持现有 `uploadError` 展示，不影响已选集合。

## 验证（前端）

1. 单节点：picker 内安装 2 个 skill（Bifrost + 上传），均进入已选、picker 不关闭；取消其一 → 选择集正确更新；「完成」关闭。
2. 连线 chatnode 发送：`/chat` 请求 `skills` 数组含这两个 name；后端指令里出现两个 Skill 段落。
3. 多节点连线：两个 skill_search 各选一个均连到同一 chatnode → `skills` 全部合并、去重生效。
4. 刷新/重载：`skillSelections` 持久化并正确回显。
