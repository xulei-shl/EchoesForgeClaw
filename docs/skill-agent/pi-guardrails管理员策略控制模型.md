# pi-guardrails管理员策略控制模型

> 面向：后端/运维/产品工程师（后期扩展或调整这个安全护栏策略时读）。  
> 定性：这是 **服务器/管理员侧的自动策略**，不是普通用户的自服务交互功能。

---

## 1. 目标用户与控制平面

- **真实用户**：局域网内通过 web 访问的普通账号。pi 与扩展在服务器上跑，用户不应该感知 Guardrails 设置。
- **管理员/运维**：负责决定“什么程度的保护”和“如何生效”。控制平面应在服务端，而不是通过用户在聊天里敲命令。

---

## 2. 现状：已是「管理员不交互」形态

当前接入是**装配期自动写策略**：

- 每次 workspace 装配时，后端自动写一份固定策略进 `{ws}/.pi-agent/extensions/guardrails.json`。
- 其中：
  - `onboarding.completed: true`（不再弹引导）
  - policies / permissionGate / pathAccess 三档开启
  - `pathAccess.mode: 'block'`（不反弹用户交互，越界直接拒绝）
- 所以**默认行为已经是不依赖用户命令交互**的。用户侧不需要、也不该暴露 `/guardrails:settings`。

---

## 3. 为什么不暴露 pi 命令交互

- RPC 模式下 `ctx.ui.custom()` 不可用，交互型提示能力受限。
- 若策略依赖用户对话中的确认/选择，会引入卡住、超时、权限/身份混淆等问题，不适合多租户服务端。
- 安全策略应由服务器决定边界，普通用户不应参与“是否允许”类决策。

---

## 4. 以后调整策略的两种路线

### 路线 A：服务器固定策略（先保持这条）

- 策略定义在后端一侧的固定配置/代码中。
- 每次装配时统一写入同样的默认策略。
- 不给普通用户任何调整入口。
- 优点：一致、可控、用户无法绕过。  
  缺点：要改策略时需改服务器配置/代码，并重启或更新装配逻辑。

### 路线 B：提供管理员专属 web 入口（后续可选）

- 在已有管理能力中加一处“Skill Agent 安全策略”管理项（仅管理员可见）。
- 管理员可查看与调整策略，例如：
  - 开启/关闭 policies / permissionGate / pathAccess
  - 增删文件保护规则
  - 管理越界允许路径（仅当 pathAccess 开启时才有意义）
- 保存后，**下一次 workspace 装配时**把管理员存的策略映射为 guardrails.json 写入。
- 注意：
  - Guardrails 配置是 per-workspace 自动写的，不能假设已运行中的 pi 进程会自动重读。
  - 因此策略变更通常不应设计成“实时热生效”，而是“新 workspace 装配生效”，除非额外做重拉/热加载方案。

---

## 5. 策略来源建议放置位置

- **管理员可维护的后端配置/存储项**
  - 例如在数据库或配置表里放一份“Guardrails 策略模板”。
  - 内容对应 policies / permissionGate / pathAccess 的开关与规则。
  - 由管理员在管理界面或部署配置里维护。
- **装配期映射**
  - `preparePiWorkspace` 负责把上述策略映射为 guardrails.json 写入。
  - 这样策略来源是服务器/管理员侧，用户无感。
- **如果暂时不做管理界面**
  - 就把策略放在代码里或部署配置里。
  - 由负责部署/运维的人修改，再重启或更新服务生效。

---

## 6. 生效口径与注意事项

- 策略变更一般不实时作用于已有对话进程；新 workspace 装配才会使用新策略。
- 目前默认配置里已加入两条额外策略规则：
  - `agent-runtime`（`noAccess`）：`.pi-agent` 整棵默认全封（fail-closed），用来保护后端装配的真实密钥类文件（models.json / settings.json / web-search.json / auth.json / extensions）；同时经 `allowedPatterns` 显式放行两类可读资源——① `.pi-agent/skills/**` 与 `.pi-agent/prompts/**`（pi 渐进式披露要求模型经 read tool 按需读取，封死会导致装配的技能形同虚设，详见 `pi-extension-integration.md`）；② `.pi-agent/run/**` 与 `.pi-agent/sessions/**`（Agent 自身不含密钥的运行态，封禁无安全收益，只会让它在找上下文时被反复拒绝而空转——见第 9 节）。
  - `agent-session-readonly`（`readOnly` + `onlyIfExists: false`）：把 `.pi-agent/run`、`.pi-agent/sessions` 钉成**可读不可写**。理由：`{ws}/.pi-agent/run/chat.jsonl` 是「对话历史」列表的收录凭据，而 `noAccess` 的拦截工具集含 write/edit/bash——只靠 `agent-runtime` 的读豁免会让 Agent 能把会话文件覆盖成空壳（绕过删除语义毁掉用户对话）。只拦写不封读，是为了不把上面那条「找上下文被拒而空转」的老问题打回来；`onlyIfExists: false` 则堵住「向会话目录新建文件」这类目标不存在就不拦的口子。密钥仍由 `agent-runtime` 全封（连 read 一起拒）。
- 该规则的 `patterns` 同时包含首段模式（`.pi-agent`、`.pi-agent` 子树）与「任意前缀 + .pi-agent」两条通配，理由见第 8 节。
- 豁免是「字面首段」模式，只作用于本工作区：guardrails 的 `normalizeTarget`（`extensions/guardrails/rules.ts:62`）把工作区内目标归一为相对 cwd 路径，工作区外（含其它租户工作区）保留绝对路径形态，因此豁免命中不到，其它租户的 `.pi-agent` 仍被受保护模式封禁。
- pathAccess 的 `ask` 已在装配期归一为 `block`：RPC 下 `ctx.ui.custom()` 返回 undefined，ask 与 block 同为拒绝，却会多出一次无用交互尝试和一条 `source:'user'` 的误导遥测（`extensions/path-access/index.ts:96-160`）。归一不静默——会以装配期 warning 透传（`guardrailsConfigNotices`）。若要主动放宽，唯一有意义的取值是 `allow`，需先重新评估跨租户隔离的代价。

---

## 7. 相关验证入口

- 自动配置形状断言：`tests/api/pi-agent-workspace.test.ts` guardrails describe。
- 真实子进程加载 + 危险命令 dialog 全链：`tests/api/pi-guardrails-run.test.ts`。

---

## 8. 已知限制：bash 路径提取是 best-effort，不能作为唯一防线

`@aliou/pi-guardrails` 的 policies 对 `bash` 工具靠「从命令串提取路径候选，再逐候选匹配规则」。提取器（`shared/paths/bash-paths.ts` + `core/paths/plausibility.ts`）刻意跳过含 shell 展开的 token 的合理性过滤，并把它们**按字面相对 cwd 解析**，因此：

| 命令形态 | 提取到的候选 | 旧模式集结果 |
| :--- | :--- | :--- |
| `cat .pi-agent/models.json` | `<cwd>/.pi-agent/models.json` | 拦截 ✅ |
| `cat "$base/.pi-agent/models.json"` | `<cwd>/$base/.pi-agent/models.json`（含 `$` 的垃圾前缀） | 放行 ❌ |
| `x=.pi-agent; cat "$x/models.json"` | `<cwd>/$x/models.json` | 放行 ❌（标记只存在于赋值语句里，从不进入候选） |
| `cd <cwd>/.pi-agent && cat models.json` | `<cwd>/.pi-agent` | 拦截 ✅ |

第 2 行已通过在 `patterns` 中补「任意前缀 + .pi-agent」两条通配堵上（Node `matchesGlob` 下 `.pi-agent` 子树模式匹配不到带前缀的路径）。
第 3 行**无法用路径模式修补**：策略只在 file 上下文按候选路径匹配，而 `.pi-agent` 这个标记只出现在赋值语句的值里。

**因此真正的收敛手段是移除向量本身**：画板助手（canvas-assistant）的职责全部由 `canvas_*` 工具 + `read` 承担，不需要 shell，故在 `backend-ts/src/api/canvas/routes/canvas-agent.ts` 通过 `excludeTools: ['bash']` 经 `runPiAgent` → `--exclude-tools bash` 关闭该 Agent 的 bash 能力。
需要 bash 的其它 Agent（如 Skill Agent 节点）仍暴露在剩余残差下，若有更强的隔离诉求，应优先考虑把密钥从子进程可见的文件系统移出（环境注入 / 独立凭据代理），而不是继续加路径模式。

---

## 9. 收窄保留：只留内核没有的能力，且不做无安全收益的封禁

结论：guardrails **不冗余**，但只保留三项中真正承重的能力，并把封禁面收到「密钥 + 跨租户」这一真正需要守的边界上。

### 9.1 为什么不能靠 pi 内核替代（逐项实测）

| 能力 | pi 0.84.2 内核 | 验证方式 |
| :--- | :--- | :--- |
| 文件/路径保护策略 | **无**（无 `protectFile` / `blockedPaths` 等概念） | 内核 `dist/` 全量搜索 |
| 工具审批门（RPC） | **无**（子进程模式无审批，仅 allowlist/denylist 可控） | `runner.ts` 注释 + 内核 `dist/` 搜索 |
| 越界路径拦截 | **无**（那句 `outside working directory` 出自 guardrails 而非内核） | 文案定位：`src/core/paths/access.ts:49` |

因此三项各自都是当前唯一手段：policies 是明文密钥进上下文的唯一屏障（`workspace.ts` 会把真实 `apiKey` 写入 `{ws}/.pi-agent/models.json`，而模型手里有 `read`）；permissionGate 是唯一危险命令确认；pathAccess 是文件工具层的跨租户隔离。

### 9.2 本次收窄了什么

1. **不再做无安全收益的封禁**：`.pi-agent/run`、`.pi-agent/sessions` 改为可读（密钥装配物仍全封），直接消除「Agent 找上下文被反复拒绝 → 空转」这一类摩擦。**后续补正（重要）**：可读≠可写——这两处是「对话历史」的收录凭据，写入口径另由 `agent-session-readonly`（readOnly，fail-closed）封住，见第 6 节。
2. **`ask` 归一为 `block`**：去掉一个语义含糊、且会产出误导遥测的取值，并对存量 `app_settings` 给出装配期提示。
3. **策略文案改为「继续，不要向用户索取」**：原 blockMessage 的 "ask the user" 会把被拦事件变成一次多余的提问。
4. （上一轮已做）扩展包不再自带 `pi.skills`，技能只有 `.pi-agent/skills` 这一个来源——正是原事故的死锁（策略封 `.pi-agent/**` vs 技能被装配到该路径下）的根因。

### 9.3 尚未收窄、留待决策

- **pathAccess 整项**：它是当前唯一的跨租户文件隔离，去掉即等于允许 Agent 读其它用户工作区（含其 `.pi-agent` 之外的对话与产物）。真要撤掉，应同时给出替代隔离（如 OS 级/容器级）。
- **内建危险命令模式**：`applyBuiltinDefaults` 带来 `rm -rf` / `sudo` / `chmod -R 777` 等默认确认项，无法按条覆盖；若确认对节点侧正常清理造成摩擦，再考虑改为自维护模式集。
- **密钥落盘本身**：把密钥移出子进程可见文件系统（环境注入 / 凭据代理）才能让 policies 这一层失去对象——这是唯一能真正「消灭需求」的方向。

附：提取器与模式语义属于上游包，本仓库只在 `guardrails.ts` 维护模式集，升级 `@aliou/pi-guardrails` 后需按本节的四行表格重跑一次验证。