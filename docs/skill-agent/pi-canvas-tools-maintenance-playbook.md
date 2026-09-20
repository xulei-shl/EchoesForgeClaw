# pi-canvas-tools 扩展包维护手册（画板助手最佳实践）

> 面向：维护/扩展画板助手（canvas_assistant）工具能力、提示词与技能文档的工程师。
> 首次成文：2026-09-20，基于「新增 canvas_list_nodes / canvas_read_node_output 只读工具 + 配套提示词/技能文档同步」实际全过程沉淀。
> 配套文档：升级主包见 `pi-agent-upgrade-playbook.md`；扩展接入通用机制见 `pi-extension-integration.md`（本文只写画板助手特有的部分，不重复通用内容）。

---

## 0. 当前基线（随每次改动更新本表）

| 组件 | 位置 | 加载方式 | 备注 |
|---|---|---|---|
| 扩展包 `pi-canvas-tools` | `packages/pi-canvas-tools/src/index.ts` | **TS 源码直接加载**（package.json `pi.extensions: ["./src/index.ts"]`） | 无需构建产物；pi 侧加载不做类型检查 |
| 工具清单（15 个） | 同上 | `canvasOp` 桥接 | 只读：`canvas_list_nodes` / `canvas_read_node_output` / `canvas_get_node_details`（单节点字段现状）/ `canvas_get_node_params`（某类型可配字段、默认值与枚举字段的 `options`，见 §6.16）；写操作：`canvas_create_node`（可传 `run: true` 建即跑，见 §6.14）/ `canvas_connect_nodes` / `canvas_update_node` / `canvas_disconnect_nodes` / `canvas_delete_node`；运行：`canvas_run_node`（触发检索/AI/产物类节点运行并等待产出，候选类节点可传 `select_index` 选定候选并落盘；**创建与连线都不会让节点运行**，见 §6.12 / §6.13 / §6.15）；检索：`canvas_search_prompts` / `canvas_search_skills`（均经桥接，前端带用户凭据调后端 Bifrost 接口）/ `canvas_get_presets`（扩展内静态预设）/ `canvas_get_node_configs`（仍直连 admin 路由，见 §6.7）；反馈：`canvas_send_feedback`（直连公开路由 `/api/feedback`；**回执以响应体 `delivered` 为准**，HTTP 200 仅代表已受理，见 §6.8） |
| 前端执行器 | `frontend/src/canvas/components/mascot/canvasExecutor.ts` | 每个 op 一个 case，`executeCanvasOp` 为 async | 复用 `nodeOutputText` / `nodeOutputImages` / `getNodeTitle` 纯函数（与 chat 节点上下文注入同口径）；检索 case 复用 `bifrostService`（与提示词/Skill 检索节点同口径）；**写操作与运行操作经 `frontend/src/canvas/core/canvasCommands.ts` 命令层**（写操作见 §6.10，`runNodeById` 见 §6.12）；渲染类节点的产物入口与候选类节点的候选能力都由 `frontend/src/canvas/core/nodeProducers.ts` 注册（见 §6.13 / §6.15） |
| 同捆技能 | `packages/pi-canvas-tools/skills/*/SKILL.md` | 装配回退（见 §2） | `canvas-workflow-patterns` / `canvas-node-catalog` |
| 系统提示词种子 | `backend-ts/src/config/seed.ts`（`DEFAULT_CANVAS_ASSISTANT_PROMPT`） | 启动时物化 AGENTS.md | 运行时以 DB `promptTemplates` 行为准（见 §5） |
| 工具排除名单 | `backend-ts/src/services/ai/pi/config.ts`（`CANVAS_AGENT_EXCLUDED_TOOLS`） | 仅排除 bash | 新增只读工具无需变更 |

依赖事实：`typebox` 未提升到仓库根，扩展包类型检查需映射到 `backend-ts/node_modules/@earendil-works/pi-coding-agent/node_modules/typebox`（内嵌 1.3.7，见 §6）。

---

## 1. 桥接架构（一图看懂数据流）

画布节点数据只存在于前端 React state（`nodesRef` / `edgesRef`），不在 pi 工作区文件系统里——agent 永远无法用 read 工具摸到。所有画布操作必须走 UI 桥：

```
扩展工具 execute（packages/pi-canvas-tools/src/index.ts）
  │  ctx.ui.select('CANVAS_OP:' + JSON.stringify({ op, params }))
  ▼
pi stdout: extension_ui_request（RPC dialog 通道，通用透传）
  ▼
前端 AgentChatPanel：识别 CANVAS_OP: 前缀（通用拦截，无需按 op 改面板代码）
  ▼
canvasExecutor.ts：按 op 分发 case，从 nodesRef/edgesRef 读数据
  ▼
作答经既有 ui-response 通道写回子进程 stdin → 工具拿到结果继续
```

**关键推论**：
- 新增工具 = 扩展端一个 `canvasOp()` 调用 + 前端一个 case，**两端各一处**，传输层零改动；
- 需要「当前登录用户」凭据的后端路由（提示词/Skill 检索等）**必须走桥接**：子进程内 `fetch` 不带 Authorization，直连只会拿到 401（§2.5）；
- 前端 `AgentChatPanel` 对 `CANVAS_OP:` 前缀是通用拦截，不需要注册表；
- 操作回执要自带数据（如只读工具返回节点内容）——写操作只回 `{ success, message }` 时，agent 下一轮依然「看不见」自己创建的东西，这正是本次补只读工具的根因。

---

## 2. 最佳实践沉淀（本次改动的经验教训）

### 2.1 工具能力与「模型知道能用」必须三层同步

工具装上 ≠ 模型会用。三层缺一不可：

1. **系统提示词**（`DEFAULT_CANVAS_ASSISTANT_PROMPT`）：写「什么时候该用」（如：判断需求前先 `canvas_list_nodes` 摸现状；引用节点内容用 `canvas_read_node_output`），嵌入既有原则的执行时机里，不单列成工具说明书；
2. **技能文档**（`packages/pi-canvas-tools/skills/*/SKILL.md`）：写「在哪个流程环节用」（如：链路组合前先看现状避免重复创建；连线前确认 `has_output` 状态，输出为空时如实提示而非编造）；
3. **工具 promptGuidelines**（工具自身的声明）：写「与其他工具的协作关系」（如：create/connect 提示「动手前先 list 看现状」），交叉引用形成闭环。

只做第 1 层，模型大概率不会主动调用；三层一起改，行为才稳定。

### 2.2 只读工具的返回设计

- `canvas_list_nodes` 只返回清单（`id/type/title/x/y/has_output/is_generating`），**不含正文**——列表是「目录」，正文按需用 `read_node_output` 取，避免一次调用撑爆上下文；
- `canvas_read_node_output` 设两道闸：
  - 正文截断（当前 20000 字符），返回 `truncated: true, total_chars` 明确标注，让模型知道还有更多；
  - 图片 data URL 收敛为 `mime + 长度` 占位符——base64 对模型不可读，内联纯属浪费上下文；
- 输出为空时返回明确状态（`has_output: false` / `is_generating: true`），配合提示词「如实告知而非编造」。

### 2.3 pi 的 AgentToolResult 契约（扩展包最容易踩的类型坑）

`@earendil-works/pi-coding-agent` 的 `AgentToolResult<T>`：**`details` 是必填字段**（`content` + `details: T`），且 execute 返回联合类型会破坏 `TDetails` 泛型推断。规则：

- 同一工具**所有 return 分支的 `details` 保持同形状**（含 error 分支，形状一致时用 `error: undefined` 占位）；
- error 分支缺 `details`、或各分支形状各异，都会 TS2322；
- pi 加载 TS 源码**不做类型检查**，所以这类问题不会在运行期暴露——扩展包必须单独跑 strict 检查（§6）。

### 2.4 默认提示词的「种子升级」模式（改默认值前必读）

运行时链路：`promptTemplates`（DB）→ `node-config-service.ts` 的 `writeAgentMd` 覆盖磁盘 AGENTS.md。两个事实决定改法：

- 种子 insert 按 key 判重、已存在则跳过 → **存量部署 DB 里存着旧版提示词，只改 seed 常量对它们无效**；
- 种子逻辑每次启动都会无条件用 `DEFAULT_*` 重写磁盘 AGENTS.md 兜底，但 DB 行存在时运行时仍以 DB 为准。

正确改法（`seed.ts` 已固化的模式）：

1. 把**旧版官方全文**存为 `PREVIOUS_*` 常量（逐字）；
2. 种子时：DB 行 content 与 `PREVIOUS_*` **精确匹配才升级**为新版，同时物化磁盘 AGENTS.md；
3. 任何人工修改过的内容（哪怕一个空格）**永远保留**——宁可漏升级，不可覆盖自定义。

改默认提示词的操作顺序：`PREVIOUS_CANVAS_ASSISTANT_PROMPT ← 当前 DEFAULT 全文`，再写新的 `DEFAULT`。升级逻辑自动覆盖存量库。

> [!IMPORTANT]
> **只有一个历旧槽位**：同一发版周期内连改两版（如第九、十轮都动了提示词但未发布），把中间版放进 `PREVIOUS_*` 会让「存在于线上库里的是**上一个已发布版**」的存量部署永远升不上来。因此 `PREVIOUS_*` 应当始终存放**上一版对外发布过的原文**；发版前可用 `git show HEAD:backend-ts/src/config/seed.ts` 取出出厂版逐字校准（本轮就是这么校的：`PREVIOUS` 与 HEAD 的 `DEFAULT_CANVAS_ASSISTANT_PROMPT` 逐字相等）。若不希望手工校准，可把该常量改为「历史版本数组 + `includes` 匹配」，但会永久膨胀提示词文本，需权衡。

### 2.5 扩展侧直连后端：只能打公开路由

`PI_BACKEND_URL` 的端口取自 `config/env.ts` 的 `serverPort`（与 `server.ts` 的 listen 同源，**勿在任何位置再写死端口默认值**——历史上 runner 写死 8010、server 默认 8000，PORT 未设时会指向错误端口）。

`pi` 子进程内没有任何用户凭据（env 里只有 `PI_BACKEND_URL`），所以扩展里 `fetch(BACKEND_URL + ...)` 只在**公开路由**上成立：

- ✅ `POST /api/feedback`（无 `preHandler`）；
- ❌ `GET /api/modules/bookplate/bifrost/prompts`、`.../skills/bifrost-search`（`preHandler: app.authenticate`）→ **恒 401**；同理 `/api/admin/*`（`requireAdmin`）恒 401/403。

正确做法（本次采纳）：检索类能力也走 `canvasOp` 桥接，由前端 `bifrostService`（axios 已注入 `Bearer`）代调后端，结果经 `ui-response` 回传给工具。桥接通道无 dialog 超时（`ctx.ui.select` 未传 `timeout`），Bifrost 检索的 20~30s 不会被中断；代价是**前端未连接时检索不可用**（Agent 只在前端对话中运行，实际影响可接受）。

若要脱离前端直连，需另设凭据通道（进程级用户 JWT 注入，或仿 `chat/inherit-file` 的 HMAC 签名 URL）——都属扩大鉴权面，需单独评审，勿顺手为之。

### 2.6 同捆技能的装配回退

`workspace.ts` 装配技能时的三级回退：用户技能区 → 系统技能区（`REAL_SKILLS_ROOT`）→ **`packages/pi-canvas-tools/skills/<name>`**。在扩展包里新增 `skills/<name>/SKILL.md` 目录即自动获得装配资格，是否启用取决于 agent 配置的技能清单。技能文档随源码软链实时生效（工作区装配用 symlinkOrCopy），无需重启即可被新一轮对话读到。

---

## 3. 新增画布工具 Checklist（标准闭环）

1. **扩展端**（`packages/pi-canvas-tools/src/index.ts`）：用 `canvasOp()` 定义工具；参数用 typebox 声明；`promptGuidelines` 写清使用时机与协作工具交叉引用；所有 return 分支 `details` 同形状；
2. **前端执行器**（`canvasExecutor.ts`）：新增对应 case；复用 `nodeOutputText` / `nodeOutputImages` / `getNodeTitle` 纯函数（跨节点类型零枚举，与 chat 节点同口径）；大文本截断 + data URL 占位符（§2.2）；需用户凭据的后端调用复用既有 service（如 `bifrostService`），**不要在扩展端直连已鉴权路由**（§2.5）；**任何写操作（建/改/断线/删）必须经 `canvasCommands` 命令层**，先 `recordHistory()` 再改 store，且命令层不可用时明确报错（§6.10）；**需要触发节点运行的操作用 `runNodeById` 分派到画布 UI 同款入口**（§6.12）；
3. **提示词三层同步**（§2.1）：DEFAULT 提示词 + 相关 SKILL.md + 工具 promptGuidelines；新增**产物类节点**（渲染出图）还需在组件里 `useNodeProducer(id, 生成函数)` 注册生成入口（§6.13）；新增**候选类节点**（检索出多个候选项、需选定一个）还要 `useNodeCandidateOps(id, { list, ensure, select })`（§6.15）；
4. **验证**：§6 全绿；
5. **生效**：重启后端（重新装配工作区扩展与 AGENTS.md）+ 刷新前端；无需 npm install（`packages/` 源码直接加载）。

---

## 4. 验证清单（提交前逐项过）

| # | 检查 | 命令 | 通过标准 |
|---|---|---|---|
| 1 | 扩展包 strict 类型检查 | §6 临时 tsconfig 方案 | 0 error |
| 2 | 前端类型检查 | `cd frontend && npx tsc -b` | 0 error |
| 3 | 前端 lint | `cd frontend && npx oxlint src/canvas/components/mascot/canvasExecutor.ts` | 0 警告 |
| 4 | 后端类型检查 | `cd backend-ts && npx tsc --noEmit` | 0 error（存量问题除外，逐条报告不静修） |
| 5 | 提示词物化回归 | `cd backend-ts && npx vitest run tests/api/canvas-agent.test.ts` | 全绿（当前 5/5；只断言物化存在、不断言内容，改提示词安全） |
| 6 | 反馈通道回归 | `cd backend-ts && npx vitest run tests/api/feedback.test.ts` | 全绿（当前 7/7；覆盖 errcode 非 0 / 未配置 webhook / 网络异常 / 超长自动分片 / 分片中途失败） |

端到端（真实对话链路需起后端+前端+模型，按需做）：画板助手能主动调 `canvas_list_nodes` 查现状、`canvas_read_node_output` 读内容，且输出为空时如实告知；能就地改节点（`canvas_update_node`）、断开连线（`canvas_disconnect_nodes`）、删节点（`canvas_delete_node`，删除前必定弹确认且取消时不产生任何变更）；且 Agent 的建/改/删/断线**都能 Ctrl+Z 撤销**（§6.10 的口径修复）。另需验证运行闭环（§6.12 / §6.13）：对 `web_search` 等检索类与 AI 类节点调 `canvas_run_node` 能真正触发运行（结束后 `canvas_read_node_output` 读到产出，`status=completed`）；缺少输入（如无关键词、无上游）时回 `status=not_started` 与具体原因且节点确实未发起；自动检索类返回说明（不谎称已运行）；`timeout_ms: 0` 只触发不等待。**候选类节点**：`canvas_run_node`（不传 `select_index`）回 `status=candidates_ready` + 候选清单且 `has_output=false`；带 `select_index` 再调一次后 `data.imageUrl` 真的落盘、下游能取到图；`select_index` 越界回 `not_started` 与范围原因；已锁定的 `pattern_search` 回「已选定/需先清空」而不是静默失败；负值/小数回参数错误。**产物类节点**（如 `book_info` → `watercolor_brush` → `receipt_printer`）调 `canvas_run_node` 后 `data.imageUrl` 真的出现且下游能取到图，缺上游图片的节点返回「生成已执行但没有产出图片」；`canvas_create_node(..., run: true)` 在输入就绪时一次到位（回执带 `run.started=true`），输入未就绪时回 `warnings`「已创建但未运行」且节点确实未跑；**画布上手动创建任何节点都不会因为本次改动而自动运行**（回归 §6.14）。另需验证反路径：离开画板页后对画布下写指令 → 明确报错「画布未挂载」而**不是**静默改坏画布。多源检索（§6.16）：`canvas_get_node_params('web_search' / 'image_search' / 'text_translation' / 'zhihu_search')` 回 `options`；`art_image_search` 的 options 为「`all` + 当前可用博物馆」（未配置 Key 的不出现）；对 GLAM `all` 检索，候选应跨多个博物馆交错出现（不是前几条全部同一家），后端全部源失败时回 502 而不是空候选；**单源失败**（如故意不配 `loc.proxy`）时节点上应出现「部分来源未取到结果」提示条，`canvas_run_node` / `canvas_create_node(run: true)` 的回执应带 `warnings`（带 `select_index` 直接调用也要能看到）。

文本节点 / VuFind 写入回归（手工，必须卡这几个动作，只看当前会话会误判）：① Agent 写入（或手输）正文后**刷新页面**，内容仍在（不被上游顶掉）；② 把 `book_info` 连到已有内容的节点，内容不被覆盖；③ 新建**空**节点并连线上游 → 正常继承；④ 继承后**手动清空 → 刷新** → 保持空（不被上游「复活」）；⑤ 断开上游再重新连回同一来源 → 可再次继承（断开已抹除继承记录）。

---

## 5. 临时 typecheck 环境配方（扩展包没有自己的 tsconfig）

扩展包直接被 pi 以 TS 源码加载，历来不做类型检查；给它做 strict 检查的 ad-hoc 方案（用完即删，不留仓库）：

1. 仓库根建 `.tmp-typecheck/tsconfig.json`：
   - `include: ["../packages/pi-canvas-tools/src/**/*.ts"]`
   - `strict: true`，`noEmit: true`，`skipLibCheck: true`
   - **不要写 `baseUrl`**（TS 6.0 已弃用；`paths` 相对 tsconfig 所在目录解析，正好正确）
   - `paths`：`typebox` → `../backend-ts/node_modules/@earendil-works/pi-coding-agent/node_modules/typebox`（内嵌副本 1.3.7）；`@earendil-works/pi-coding-agent` → `../backend-ts/node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts`
2. 运行：`cd .tmp-typecheck && ../frontend/node_modules/.bin/tsc -p tsconfig.json`（仓库根 node_modules 无 tsc 时借用 frontend 的）
3. **收尾必须 `rm -rf .tmp-typecheck`**，临时配置不进仓库。

---

## 6. 已知坑与注意事项

1. **pi 加载 TS 源码不做类型检查**——扩展包的类型错误只在运行期以「工具行为怪异」的形式出现，永远不会报类型错误。任何改动后必须跑 §5 的 strict 检查。
2. **`.env` / 后端重启**：扩展白名单与工作区装配都在后端启动期完成，改扩展源码后**必须重启后端**才重新装配；前端改 canvasExecutor 刷新即可。
3. **提示词种子「存在即跳过」**：直接改 `DEFAULT_*` 常量对存量部署无效，必须走 §2.4 的种子升级模式。
4. **对话后设置锁定**：chat 节点开始对话后运行设置会被锁定（上下文继承通道开关等），画板助手侧无此问题，但测试上下文注入口径时注意区分两类 agent。
5. **Windows 软链退化**：工作区装配用 symlinkOrCopy，无软链权限时退化为复制（见 `pi-extension-integration.md` 坑 3）——pi-canvas-tools 无非 alias 依赖，复制退化场景可正常工作，但新增第三方依赖前先确认 jiti alias 解析范围。
6. **`details` 只进日志/UI，不进模型上下文**（模型看的是 `content`）——error 信息放 `details` 模型看不到，要给模型看的错误说明必须写在 `content` 里。
7. **`canvas_get_node_configs` 仍不可用（存量缺陷，未修）**：它直连 `/api/admin/node-configs`，该路由 `preHandler: app.requireAdmin` 且子进程无凭据——普通用户调用必然 401。若要让画板助手查配置，需改成桥接 + 面向普通用户的只读配置接口（属产品/权限决策，需单独确认）。
8. **文本类节点正文键是 `data.content`（不是 `text`），且文本节点的「连线即输入」只填充空节点**——两个坑会造成「Agent 建了节点但内容为空/丢内容」：① 历史 SKILL.md 速查表与工具 promptGuidelines 误教 `text` 键（模型照文档执行必然写错），现已修正文档并在 `canvasExecutor` 加键名归一（回执带 `warnings`，不静默吞掉）；② `TextNode` 原实现是「上游文本 ≠ 本地内容就写入」，而该注入 effect 依赖 `[upstreamText]`、**每次挂载都会重跑**（`lastUpstreamRef` 为组件内 ref），所以刷新页面/切页返回就会把 Agent 或用户写入的正文换成上游文本；现已改为「本地非空则不注入」。新建的空文本节点连线上游仍需继承，故保留空节点注入。**继承判定已从组件内 ref 换成 `node.data.inheritedFrom`（已继承过的上游值）**：ref 方案下「手动清空 → 保持空」但「清空后刷新 → 上游复活」自相矛盾，落进 node.data 后刷新/切页/清空三个动作判定一致；上游断开时抹除该记录，重连可再次继承（继承写入走 `useEditorPatchHandler(['text'])` / `handleUpdateVuFindEditorFor`，不记撤销历史）。同类写法见 `VuFindCallNumberNode`（`onUpdateEditor(id, { isbn })`，同样会把上游 ISBN 落盘覆盖手输值）——**已按同口径修**：仅在本节点无 ISBN（草稿与已落盘值都为空）时注入。注意该节点的 `upstreamIsbn` 优先级里含「画布根 `book_info` 兜底」，**没有连线也可能有上游值**，所以「本地非空不覆盖」在这里尤其重要；提示语也只在输入框的值确实等于上游值时展示（原文案无条件声称「已从上级连线自动填入」）。
9. **企业微信群机器人 webhook 恒返回 HTTP 200**——真实结果在响应体 `errcode`（`0` 成功 / `93000` webhook 无效或机器人被移出群 / `40058` 内容超 4096 字节 / `45009` 超频 20 条每分钟）。只判 `resp.ok` 会把「被拒收」记成「推送成功」。`/api/feedback` 现已解析 errcode 并在响应中回传 `delivered`，工具文案与前端提示都必须以此为准，不得用 HTTP 200 当送达证据。markdown 正文上限 4096 **字节**（UTF-8，中文约 1365 字），路由发送前按字节预算**自动分片**为多条消息（不截断、不丢内容），首个分片失败即停并回传 `parts_delivered` / `parts_total`。注：手动弹窗表单 `maxLength={1000}`（≈3000 字节）永远不会触发分片，Agent 的长文才会——这是「手动正常、Agent 异常」的常见差异来源。
10. **Agent 写操作必须经模块级画布命令层（`frontend/src/canvas/core/canvasCommands.ts`）**：画板助手的执行器挂在 App 级 `MascotWidget` 上，生命周期与画布页解耦；历史上执行器直接调模块级 `setNodes` / `setEdges`，绕开画布自己的 `recordHistory` → **Agent 建的节点/连线撤销不了**（UI 手改却可以），同一操作两条路径两种可撤销性。现 `CanvasPage` 挂载时注入实现、卸载时清空，全部写操作（`create_node` / `connect_nodes` / `update_node` / `disconnect_nodes` / `delete_node`）经该层；命令层为 null（画布页未挂载，如用户停留在历史/画廊页对画布下指令）时执行器**明确报错**，不降级直改 store——这个失败是预期行为，不要为了「顺手能跑」加回降级路径。另：
    - `canvas_update_node` 的写入 denylist 除 `isGenerating` / `error` / `output` / `configId` 外还含 `imageUrl`（图像类节点的产物同样是产物，写入即可伪造图片）；文本键名仍走既有归一（`text` → `content`）；
    - `canvas_delete_node` 采两段式：`confirmed: false` 只回影响范围（节点名、子孙清单、受影响连线数）**不做任何变更** → 扩展侧 `ctx.ui.confirm` 陈述 → `confirmed: true` 才执行（前端跳过自家 dialog，避免双重弹窗）。即使没有子孙也弹确认：Agent 是自动化来源，静默删除的风险高于手动点击；
    - `canvas_disconnect_nodes` 非破坏、可撤销，不弹确认；`canvas_delete_node(node_id)` 一次只接受 1 个节点，级联范围仅由 `cascade` 决定（默认 true，与画布 UI 一致）。
11. **画板助手「清空会话」= 开启新会话，绝不等价于删除会话**：面板顶栏按钮（`AgentChatPanel.handleClear`）曾额外调用 `/api/modules/bookplate/canvas-agent/clear` → `clearPiSession`，把当前工作区 `.pi-agent/run`（会话文件）删掉——「对话历史」的收录条件正是「工作区内存在 pi 会话文件」（`resolvePiSessionFile`），于是刚聊过的对话立刻从列表消失且不可恢复。正确口径与全站 AI 对话节点的「清空对话」一致（`useNodeHandlers.handleClearChatFor`）：**只置空当前活跃工作区（下一轮发送延迟分配 `canvas-agent_<ts>`），完全不触碰服务端会话**；旧对话留在原工作区，列表仍可识别 / 载入，需要真正删除时走抽屉里的「删除对话」（DELETE `/chat/session`，整目录删除）。随后（第七轮）已把两个「只删会话文件」的接口与 `clearPiSession` 一并删除，**全站再无可删会话文件的代码路径**；canvas-agent 路由上另加回归测试守住「不能再长回一个只删会话文件的接口」（两条路径均 404）。

12. **节点不会自己运行：除 `book_info` 与 4 个自动检索类节点外，Agent 必须显式调 `canvas_run_node`**（第八轮新增，正是「web_search 建了一直空输出」上报的根因）。运行入口原本只在画布页内、按类型分散成三套：AI 三类（`image_analysis` / `text_generation` / `image_generation`）走 `useNodeExecution.runNode`；检索/工具类（`web_search` / `zhihu_search` / `wikipedia_search` / `weather` / `calendar` / `text_translation` / `vufind_call_number`）走 `useToolHandlers` 的各 fetch handler，**只由按钮点击触发**；图片/艺术图/纹样/配色类（`image_search` / `art_image_search` / `pattern_search` / `color_search`）由组件在挂载与上游关键词变化时自动检索（无需运行）。修法是把分派收敛为 `useNodeHandlers.runNodeById(id)`（返回空串＝已发起，非空＝未发起的原因），经 `canvasCommands.runNodeById` 注入给执行器；执行器 `run_node` case 触发后轮询状态（先等 `isGenerating=true`，再等其结束；默认 60s，超时回 `status=timeout` 并提示「稍后再读」而不是「失败」）。两个容易踩的点：① **不要为了「顺手能跑」让 create_node 无条件自动运行**——用户没确认的节点不应产生真实检索请求与成本（第九轮改为：**Agent 显式传 `run: true` 才建即跑**，画布手动创建路径不经过执行器、行为不变）；② 自动检索类的检索逻辑在组件内部（`load` / `loadColors`），外部无法触发，对它们**不要伪造「已运行」**；第十轮把它们的「选定候选」做成了 `select_index`（见 §6.15）。

13. **16 个产物类节点必须由组件自己出图：注册表 `nodeProducers.ts` + `runNodeById` 调用**（第九轮补齐）。`book_card` / `receipt_printer` / `stamp_cutter` / `image_bg_remove` / `sticker_maker` / `journal_maker` / `text_image` / `oil_paint` / `image_process` / `emboss_foil` / `glass_refract` / `watercolor_brush` / `ink_wash` / `editorial_layout` / `map_poster` / `map_art` 的产物靠组件内渲染（html2canvas / WebGL / 离屏模板 → dataUrl → `onExport(id, dataUrl, state)`）或组件内调后端生成接口写回 `data.imageUrl`；画布层拿不到组件内的 DOM 引用与本地编辑态，所以**Agent 建好节点、配好预设、连好上游也永远没有图**，下游排版节点跟着空。修法：组件挂载时用 `useNodeProducer(id, 自家生成函数)` 注册——注册的是**生成产物**的那个入口（`handleGenerate` / `handleExecuteCrop` / `handleRemoveBg` / `handleGenerateAndSave`），**不是** `handleSaveToDatabase`（后者只写历史记录/收藏，对下游取图无意义）；`runNodeById` 先查注册表，命中就 `await` 它并**核对 `data.imageUrl` 是否真的产出来判定成败**（未产出即回原因，不伪造产物）。两点注意：① `setNodes` → store `apply()` 会**同步**更新 `nodesRef.current`，所以 `await` 之后读 `imageUrl` 是可靠的；② **新增产物类节点时必须注册**，否则 Agent 侧只能得到「没有可由助手触发的运行入口」。
14. **「节点是 Agent 建的还是人建的」靠参数区分，不靠来源标记**：第九轮没有引入「创建者」字段（会与快照/撤销/复制粘贴的语义纠缠），而是把「建即跑」做成 `canvas_create_node` 的 `run: true` 参数（带 `timeout_ms`）。画布自己的调色板/拖拽创建不经过执行器，因此手动创建永远是「只建不跑」；Agent 只在输入已就绪（如与 `parent_id` 同时创建）时传 `run`，未就绪时回 warnings「已创建但未运行」而不是假装跑过。
15. **候选类节点的「选定一个」必须由组件暴露：候选清单只存在组件本地 state**（第十轮补齐）。`image_search` / `art_image_search` / `pattern_search` / `color_search` 的检索结果（候选图 / 纹样 / 传统色）存在组件内（`providerCache` / `items`），`node.data` 里只有「已选中的那一个」——所以画布层既列不出候选、也调不到选中，Agent 建完节点后**永远没有图**（下游排版拿不到素材）。修法：在 `nodeProducers.ts` 里加第二份能力注册 `useNodeCandidateOps(id, { list, ensure, select })`，四个组件各注册一次；`useNodeHandlers.runNodeById(id, selectIndex?)` 的返回改为**可识别联合** `CanvasRunOutcome`（`ran` / `candidates` / `not_started`），执行器据此回 `status=candidates_ready` + 候选清单（`index`/`title`/`subtitle`），Agent 挑好后带 `select_index` 再调一次（同一次调用里 `select` → 核对 `data.imageUrl` 真的落盘）。四个要点：① `ensure()` 只在**无候选时**触发一次检索（已有候选立即返回），避免重复打接口；② `list()` 的顺序必须与界面候选网格一致，`index` 就是网格序号；③ `select()` 返回**空串＝成功、非空＝原因**，并要与 UI 同口径——`PatternSearchNode` 的界面本身就锁（`isLocked = Boolean(imageUrl)`，有输出后不可换），Agent 也必须拿到同样原因；其余三个界面允许改选（无锁），Agent 同样允许（只有 `savingId` 时拒绝），**不要自行加严或放宽**；④ 不要在 `canvas_run_node` 里直接写 `imageUrl` 绕过组件（产物写入在 denylist，防伪造）。
16. **多源检索节点（网络搜索 / 知乎 / 图片 / GLAM）不是一套统一机制**（第十一轮梳理，详见 §7 第十一轮）：
    - **状态存放不同**：`web_search` / `text_translation` / `zhihu_search` 是「每源（每 tab）一份缓存」存在 `data.tabData[源]`，`data.output` 只镜像当前激活源（切源 = 换下游拿到的料，不会自动重检）；`image_search` / `art_image_search` 的多源缓存只在组件本地（`providerCache`），只有 `data.provider` 落盘；`pattern_search` / `color_search` **没有多源**（只有分类 / 配色算法）。
    - **后端失败语义不同**：显式指定源但缺凭据 → 503 + 可读文案；`web_search: random` → 只在**已配置凭据**的源里洗牌逐个试、第一个成功即返回、全失败才 502 并带上每源原因；`art_image_search: 'all'` → `Promise.allSettled` 并发聚合（现已改为**轮转交错**合并，且 0 条结果 + 有源失败时抛错而不是返回空列表）。非法取值一律**静默回退默认源**（`web_search`→`random`、`image_search`→`unsplash`、`art_image_search`→`all`）——排查「设了源却没生效」时先看这里。
    - **Agent 侧的坑**（本轮已补）：① 枚举字段以前只能靠 SKILL.md 猜，现在 `canvas_get_node_params` 回 `options`（静态枚举取自节点组件的同一份常量；GLAM 博物馆清单现查 `/glam-providers` 并与**前端来源下拉**取交集——后端可用清单含前端未列出的馆，写进去会被节点的可用性回退逻辑改成别的源）；② `zhihu_search` 的运行口径以前与节点内 `handleQuery` 不一致（顶层 `model` / 未按 `MAX_COUNT` 裁切 / 直答未传 `count: 0`），现已对齐。
    - **部分源失败的回传链路**（第十二轮补齐）：后端 `GlamSearchResult.failedSources`（`{ provider, label, reason }`）→ 路由 `failed_sources` → 节点写入**本地** `providerCache[provider].sourceWarnings`（在节点上渲染一条虚线提示条，不落 node.data）→ `NodeCandidateOps.warnings()` → `CanvasRunOutcome.warnings` → 执行器 `run_node` / `create_node` 回执的 `warnings`。注意：`ran` 与 `candidates` **两种结果都带 warnings**（Agent 可能直接带 `select_index` 调用、不会先列候选）；全部源失败仍走 502 抛错，不进入这条链路。
    - **未修（有意留白）**：`image_search` 非法 `provider` 的静默回退未收紧；候选可能过期（`ensure()` 只在候选为空时重检，改关键词后应重新检索）；`web_search: random` 的「实际用了哪个源」只在输出正文首行与 `tabData.usedSource` 里，未写进运行回执。
17. **改了 `seed.ts` 里 DEFAULT 提示词后要重新跑一次「与出厂版逐字比对」**（第十一轮踩到）：同一发版周期内可反复改 `DEFAULT`，`PREVIOUS` 必须始终等于**上一版对外发布过的原文**（本轮＝HEAD 的 `DEFAULT_CANVAS_ASSISTANT_PROMPT`）；编辑 `DEFAULT` 时注意模板字符串里的反引号必须写成 `\``，否则整个常量会被截断（`tsc` 会报 `TS1005`）。校验命令见 §2.4 的提示。

---

## 7. 改动记录

### 2026-09-20（第十二轮）：GLAM 聚合的「部分来源失败」回传前端与 Agent

- **背景**：第十一轮只修了「全部源失败」的静默，但 `all` 聚合里单个来源失败（典型：`loc` 未配 `loc.proxy`、某馆限流/瞬时 500）仍然完全不可见——用户与 Agent 都以为拿到的是全量结果。
- **后端**：`GlamSearchResult` 新增 `failedSources: { provider, label, reason }[]`（`all` 模式部分失败时返回）；路由 `/glam-search` 透传为 `failed_sources`；抛错文案与回传清单共用同一份结构化失败信息。
- **前端**（`ArtImageSearchNode`）：失败清单存入该来源的本地缓存 `sourceWarnings`，在节点上渲染一条虚线提示条（「部分来源未取到结果（N）：…」），**不写 `node.data`**（属于当前这批结果的元信息，不是节点配置，也不必进撤销栈）。
- **Agent**：`NodeCandidateOps` 新增可选 `warnings()`；`CanvasRunOutcome` 的 `ran` 与 `candidates` 都带 `warnings`；执行器 `run_node`（候选就绪 / 运行完成）与 `create_node(run: true)` 的回执均带 `warnings`，并在文案里提醒「候选不是全部来源的结果」。
- **新增断言**：`glam-search-aggregate.test.ts` 第一例补上「部分失败时 `failedSources` 带来源名与原因」。
- **验证**：后端 `tsc --noEmit` 0 error；`glam-search-aggregate` 2/2；前端 `tsc -b` 0 error；`oxlint` 无新增问题。端到端（真实多源检索 + 节点提示条渲染）未验证。

### 2026-09-20（第十一轮）：多源检索的取值域暴露 + GLAM 聚合失败/顺序修正

- **背景**：审计「网络搜索 / 知乎 / 图片 / GLAM 艺术图」的多源处理（结论沉淀在 §6.16）。发现 4 个问题，本轮修其中 3 个（用户选定）。
- **GLAM 「全部来源」不再静默**（`backend-ts/src/services/multimodal/glam-search-service.ts`）：以前 `allSettled` 吞掉全部源错误、仍返回 200 + `items: []`，看起来像「没有结果」；现在 0 条结果且有源失败 → 抛 `GlamSearchError`（路由映射 502）并带上每源原因。判定必须结合「确实取到 0 条」（Rijks / MET 等源内部自己也 `allSettled`，网络全挂时会「成功返回空数组」）。
- **GLAM 「全部来源」改为轮转交错**：以前各源整块拼接，候选前 4 条恒为 MET；现在按源轮流输出（各源第 1 条 → 各源第 2 条…），`per_source` 分页信息不变。
- **枚举字段对 Agent 可见**：`canvas_get_node_params` 的 `fields[]` 新增 `options`——静态枚举（`web_search` / `text_translation` 的 `source`、`image_search` 的 `provider`、`zhihu_search` 的 `mode`）直接引用节点组件里同一份常量（`SOURCE_OPTIONS` / `PROVIDERS`，不另建清单）；GLAM 的博物馆清单通过桥接现查 `/glam-providers` 并与**前端来源下拉**取交集（后端可用清单含前端未列出的 `ai-chicago` / `harvard`，写进去会被节点的可用性回退改成别的源）。工具 description / guidelines 与 SKILL.md、DEFAULT 提示词同步。
- **`zhihu_search` 运行口径对齐**：`runNodeById` 以前读顶层 `data.model`、不按 `MAX_COUNT` 裁切、直答模式未传 `count: 0`，与节点内 `handleQuery` 不一致；现改为同口径（count 按模式 tab 取并裁切到 10，直答传 0，model 优先 tab 再兜顶层旧字段）。
- **新增回归测试**：`backend-ts/tests/services/glam-search-aggregate.test.ts`（2 例：多源成功时轮转交错顺序；全部失败时抛 `GlamSearchError` 并带失败原因）。两例均能复现修改前行为（整块拼接 / 返回空列表）。
- **验证**：后端 `tsc --noEmit` 0 error；`glam-search-aggregate` 2/2；`canvas-agent` 4/4 + `pi-agent-workspace` 42/42 + `tests/api/pi-*.test.ts` 159/159；前端 `tsc -b` 0 error；`oxlint` 新增 2 条 `only-export-components`（为导出 `PROVIDERS` 供执行器引用；同目录已有 4 条同类警告，改为在扩展器里复制一份清单会造成静默漂移，故选择导出）。端到端（真实检索）未验证。
- **未做**：`all` 聚合的「部分源失败」仍不可见；`image_search` 非法 `provider` 的静默回退未收紧；候选可能过期（§6.16 末条）。

### 2026-09-20（第十轮）：候选类检索节点的「选定候选」能力（图片 / 艺术图 / 纹样 / 配色）

- **根因**：4 个检索节点的候选清单只存在组件本地 state（`providerCache` / `items`），`node.data` 里只有已选中的那个——Agent 既列不出候选也调不到选中，于是「建节点 + 连线 + `canvas_run_node`」后节点仍 `imageUrl=null`，下游排版节点拿不到图（见 §6.15）。
- **新增第二份注册表**（`frontend/src/canvas/core/nodeProducers.ts`）：`NodeCandidateOps { list, ensure, select }` + `useNodeCandidateOps(id, ops)`；四个节点组件各注册一次（顺序与界面候选网格一致，`select` 与 `handleSelect` 同口径、锁定时回同样的原因）。
- **命令层契约改为可识别联合**：`CanvasCommands.runNodeById(id, selectIndex?)` → `CanvasRunOutcome`（`ran` / `candidates` / `not_started`），`select` 后仍核对 `data.imageUrl` 真的落盘才算成功（不伪造产物）。
- **扩展工具**：`canvas_run_node` 新增 `select_index`（不传＝只列候选，传＝选定并落盘）；`description` 与 `promptGuidelines` 同步；`canvas_create_node` 的 `run: true` 对候选类只完成「检索出候选」，仍要再调一次带 `select_index`（已在 SKILL.md 与提示词里写明）。
- **提示词三层同步**：DEFAULT 提示词原则 6 补入「候选只是列表、不是产物」口径（`PREVIOUS_*` 校准为**上一版出厂原文**，见 §2.4 的重要提醒）；`canvas-node-catalog` 对照表把 4 类节点改为「**是（选定候选）**」并新增调用要点；`canvas-workflow-patterns` 链路 5 与开篇口径同步。
- **验证**：前端 `tsc -b` 0 error + `oxlint`（改动文件）0 新增问题；扩展包 strict 0 error；后端 `tsc --noEmit` 0 error；`canvas-agent` / `pi-agent-*` 回归全绿；端到端（浏览器 + 真实检索/渲染）未验证，按 §4 手工回归。
- **仍留白**：`image_upload` 的选图/上传（与产物写入 denylist 的防伪造设计冲突，需产品决策）。

### 2026-09-20（第九轮）：补齐 16 个产物类节点的出图能力 + 创建即可运行

- **根因（审计 33 个内置节点得出）**：除检索/AI 类外，有 16 个节点的产物必须在组件内渲染（html2canvas / WebGL / 离屏模板 / 组件内调后端接口）后才能写回 `data.imageUrl`——`useImageExportHandler(id, dataUrl, state)` 需要组件内部的 dataUrl 与本地编辑态，外部无法代劳。于是 Agent 建好节点、配好预设、连好上游后节点仍 `imageUrl=null`，下游排版拿不到图（见 §6.13）。
- **新增注册表** `frontend/src/canvas/core/nodeProducers.ts`：`useNodeProducer(id, produce)` + `getNodeProducer(id)`；16 个产物节点各加一处注册（注册**生成**入口，不是 `handleSaveToDatabase`）。
- **`runNodeById` 改为 async**（`canvasCommands` 契约同步）：先查注册表，命中则 `await` 生成入口，然后**核对 `data.imageUrl` 真的产出来**判定成败（未产出回原因）；否则按类型分派（检索 / AI / book_info / 自动检索类说明）。执行器 `run_node` 相应 `await`，并在等待循环里加「无在跑运行但产物已就绪 → 立即结束」的短路（省掉产物类的 3s 宽限）。
- **创建即可运行（区分 Agent 与人）**：`canvas_create_node` 新增 `run?: boolean` 与 `timeout_ms?: number`；执行器在建（含可选连线）之后，`run === true` 时调 `runNodeById` 并等产物，回执带 `run: { started, status, has_output }`；输入未就绪时回 `warnings`「已创建但未运行」，**不伪装已跑**。画布手动创建不经过执行器，行为零变化（见 §6.14）。
- **提示词三层同步**：DEFAULT 提示词「运行节点再读产出」补入 16 个产物类节点与 `run: true` 建即跑口径（并按 §2.4 把旧版全文存入 `PREVIOUS_*`）；`canvas-node-catalog` §六新增产物类一行 + 「创建时一次到位」要点；`canvas-workflow-patterns` 同步；`canvas_create_node` / `canvas_run_node` 的 promptGuidelines 补参数与适用面。
- **未做（有意留白）**：① 4 个检索类节点（`image_search` / `art_image_search` / `pattern_search` / `color_search`）的「选中候选」——候选只存在组件本地 state（如 `providerCache`），`node.data` 里没有可定位的候选数组，需先落盘候选或让组件暴露 `select(index)`，属单独设计；② `image_upload` 的选图/上传（与「产物字段不可由 Agent 写入」的防伪造设计冲突，需产品决策）；③ 收藏/公开/入库等运营动作。

### 2026-09-20（第八轮）：新增 `canvas_run_node`，补齐「Agent 只能建、不能跑」的能力缺口

- **根因（上报：web_search 建完一直空输出）**：工具清单里从来没有运行工具（第五轮计划里明确「未做 `canvas_run_node`」），而节点运行入口只在画布页内、并按类型分散成三套（见 §6.12）；唯一「创建即运行」的节点是 `book_info`（`canvasExecutor.create_node` 里硬编码的 ISBN 抓取）。于是 Agent 建 + 连 `web_search` 后没人点「检索」，节点永远 `has_output=false`，用户会误以为检索失败。
- **新增工具**（14 → 15 个）：`canvas_run_node`（`node_id` 必填 + 可选 `timeout_ms`）。执行器新增 `run_node` case：经命令层触发 → 轮询运行状态（宽限 3s 内未进入运行态视为已结束；默认等 60s、上限 180s、`0` ＝只触发不等待）→ 回执 `status` / `has_output` / `is_generating` / `error` 与下一步指引（去读输出 / 缺少输入 / 如实告知空输出）。
- **命令层扩展**：`CanvasCommands` 新增 `runNodeById`（`CanvasPage` 注入 `useNodeHandlers.runNodeById`）；分派按类型复用既有 UI 入口（AI 三类走 `runNode`、检索/工具类走各自 fetch handler、`book_info` 走重拉元数据），**自动检索类返回明确说明而不是伪造运行**，命令层缺失时仍报「画布未挂载」。
- **提示词三层同步**：DEFAULT 提示词新增「运行节点再读产出」原则（并按 §2.4 把旧版全文存入 `PREVIOUS_*` 精确匹配升级，覆盖存量库）；`canvas-node-catalog` 新增「六、运行节点（创建与连线都不会自动运行）」章节（类型对照表 + 先连后跑 / 超时口径 / 不重复触发）；`canvas-workflow-patterns` 补「链路跑之前先把节点跑起来」；`canvas_create_node` / `canvas_connect_nodes` / `canvas_read_node_output` 的 promptGuidelines 交叉引用新工具。
- **验证**：扩展包 strict 0 error（§5 临时环境，用完即删）；前端 `tsc -b` 0 error + `oxlint`（4 个改动文件）0 新增问题（仅存量 `useNodeHandlers.ts` 的 hook-deps 警告 1 条）；后端 `tsc --noEmit` 0 error；`canvas-agent.test.ts` + `feedback.test.ts` 全绿；`tests/api/pi-*.test.ts` 158/159（唯一失败为**存量** `pi-agent-reuse.test.ts`「手动暂停后上下文延续」，与本次改动无关，第五轮已记录在案）。端到端（浏览器 + 真实对话 + 真实检索）未验证，按 §4 手工回归。

### 2026-09-20（第七轮）：封堵「删会话文件」的旁路（接口 / 权限 / 文案）

- **删除两个已无调用者的破坏性接口**：`POST /api/modules/bookplate/canvas-agent/clear`（canvas-agent 路由）与 `POST /api/modules/bookplate/chat/clear`（ai-nodes 路由，且无测试覆盖）都只做 `clearPiSession`（删 `.pi-agent/run|sessions` 会话文件 + widgets 快照），前端零调用者但任何登录用户仍可 curl 触发——正是第六轮那个 bug 的可复发面。随后失去调用者的 `clearPiSession`（`pi/workspace.ts`）与 barrel 导出一并删除，**「删除会话」只剩一条显式链路：DELETE `/chat/session`（杀进程 + 清子代理残留 + 整目录删除）**；canvas-agent 路由新增回归测试断言这两条 clear 路径恒 404。
- **guardrails 新增 `agent-session-readonly` 规则（可读不可写）**：原先只为「保护密钥」而设计的 `agent-runtime` 规则把 `.pi-agent/run|sessions` 列为可读豁免，而 `noAccess` 的拦截工具集含 write/edit/bash → Agent 可用 `write` 把 `{ws}/.pi-agent/run/chat.jsonl` 覆盖成空壳，绕过删除语义毁掉用户对话。修法不是封读（那会把「找上下文被拒而空转」的老问题打回来），而是**加一条 `protection: 'readOnly'` 的独立规则**（只拦 write/edit/bash，read 仍走原豁免），并取 `onlyIfExists: false`（fail-closed：向会话目录新建文件同样拦下，否则留出一个可写口子）。密钥仍由 `agent-runtime` 全封（连 read 一起拒）。
- **批量删除文案按宿主实际范围**：`ChatSidePanel` 新增 `sessionsScopeNote` 可选 prop（缺省＝画布节点跨节点全局口径），画板助手传「仅画板助手自身的对话」——此前共用文案写「含其它画布节点与当前节点的对话」，与它按 `canvas-agent_` 前缀隔离的实际范围不符，用户会误判影响面。
- **验证**：后端 `tsc --noEmit` 0 error；`npx vitest run tests/api --no-file-parallelism` → 290 passed / 3 failed（3 条全在 `tests/api/fastclaw-artifacts.test.ts`，**存量环境性失败**：`resolveFastclawArtifact` 要求候选以 `/` 开头，而本机 `os.tmpdir()` 为 `E:\Temp`，与本次改动无关）；`tests/api/pi-*.test.ts` 159/159；新增真实 RPC 回归「agent-session-readonly 规则：write 写 `.pi-agent/run/**` 被拦」——覆写已存在文件被拦且原内容不变、新建文件被拦且未落盘、会话文件本身仍在；前端 `tsc -b` 0 error、`oxlint` 两个改动文件 0 新增问题；浏览器端到端复核「开启新会话保留历史」与批量删除新文案。

### 2026-09-20（第六轮）：修复画板助手「清空对话」误删会话历史

- **根因**：面板「清空会话」在置空活跃工作区后又调 `/canvas-agent/clear` → `clearPiSession` 删除该工作区会话文件，而「对话历史」按「存在 pi 会话文件」收录 → 该对话从列表消失且数据不可恢复（§6.11）。节点的「清空对话」只做「清空展示态 + `workspaceId=''` 延迟分配」，从不删服务端会话。
- **修复**：`frontend/src/canvas/components/mascot/AgentChatPanel.tsx` 的 `handleClear` 对齐节点口径——仅作废当前活跃工作区并清 localStorage（下次发送自动开新工作区），不再调用 `/canvas-agent/clear`；按钮 tooltip 与确认弹窗文案改为「开启新会话」语义（旧对话保留在历史中，故去掉 `danger` 样式）。后端与扩展包零改动。
- **验证**：浏览器端到端（起后端 + vite dev，注入登录态）：把活跃工作区设为已存在会话 → 点按钮确认 → 面板未发出任何 `/canvas-agent/clear` 请求、localStorage 活跃工作区被清空、「对话历史」Tab 仍列出该对话（title / 轮次数正常，可载入）；`cd frontend && npx tsc -b` 0 error；`npx oxlint src/canvas/components/mascot/AgentChatPanel.tsx` 12 条存量 hook-deps 警告（与改动前一致，0 新增）。

### 2026-09-20（第五轮）：节点编辑工具化（改 / 调参 / 断线 / 删）

- **新增 5 个工具**（工具清单 9 → 14）：`canvas_update_node`（浅合并改字段，denylist 拒 `isGenerating` / `error` / `output` / `imageUrl` / `configId`）、`canvas_get_node_params`（某类型字段名 + 默认值，数据源＝`seedDataFor`，不新建第二份真相）、`canvas_get_node_details`（单节点字段现状 + 端口 + `has_output`，长文本截断 / data URL 收敛占位符）、`canvas_disconnect_nodes`（`edge_id` 或 `source_id`+`target_id`，非破坏、可撤销、不弹确认）、`canvas_delete_node`（两段式：取影响范围 → `ctx.ui.confirm` → 执行；默认 `cascade=true`）。
- **修复存量缺陷（根因）**：`canvasExecutor` 的写操作直接调模块级 `setNodes` / `setEdges`，绕开画布 `recordHistory` → Agent 建的节点/连线撤销不了。新增模块级命令层 `frontend/src/canvas/core/canvasCommands.ts`（`CanvasPage` 挂载注入 / 卸载清空），全部写操作经该层，命令层缺失时明确报错、不降级（§6.10）；`useNodeHandlers` 的删除重构为 `removeNode(id, { cascade, confirmed })`，UI 入口行为不变。
- **提示词三层同步**：DEFAULT 提示词新增「就地修正优先」原则（并按 §2.4 把旧版全文存入 `PREVIOUS_*` 精确匹配升级，覆盖存量库）；`canvas-node-catalog` 新增「五、就地修正已有节点」章节 + 常用可写字段速查；`canvas-workflow-patterns` 补「先改后建」；create/connect 工具的 `promptGuidelines` 交叉引用新工具。
- **验证**：扩展包 strict 0 error；前端 `tsc -b` 0 error + `oxlint`（改动文件）0 新增问题；后端 `tsc --noEmit` 0 error；`canvas-agent.test.ts` 5/5 + `feedback.test.ts` 7/7。存量无关失败：`tests/api/pi-agent-reuse.test.ts` 的「手动暂停后上下文延续」用例（`mock.userCounts` 期望 `[1,2]` 得 `[1,1]`）——已用 `git stash` 单独回退本轮后端改动复现，**与本次改动无关**，未修。端到端（浏览器 + 真实对话 + 撤销）未验证，按 §4 手工回归。
- **偏差说明**（与 `tasks/canvas-node-edit-tools-plan.md` 的差异）：① 写入 denylist 除计划中的 4 个键外增加 `imageUrl`（图像类节点产物同样是产物）；② 计划写「工具表 9 → 13」，实际 9 + 5 = **14**；③ `canvas_update_node` / `disconnect_nodes` / `delete_node` 均实现了计划要求，未做 `canvas_run_node` / `canvas_move_node`（与计划一致）。

### 2026-09-20（第四轮）：修复文本节点写入契约与上游覆盖

- **根因 1（写入契约不一致）**：`text` / `text_generation` 节点正文实际读 `data.content`，但 `skills/canvas-node-catalog/SKILL.md` 速查表与 `canvas_create_node.promptGuidelines` 的示例教的是 `text` 键 → 模型严格按文档传参，正文落在无人读取的旁键，节点显示空、`has_output=false`。
- **根因 2（上游注入越界）**：`TextNode` 的注入 effect 只以「上游文本是否变化」作门槛（`lastUpstreamRef` 为组件内 ref、每次挂载重置），本地内容非空时也会被上游文本覆盖 → 刷新页面/切页返回即丢内容（用户手输与 Agent 写入同样受影响）。
- **同类修复（VuFind 馆藏节点）**：`VuFindCallNumberNode` 的上游 ISBN 注入改为同口径（草稿 `isbnInput` 与已落盘 `isbn` 都为空才注入），并把「已从上级连线自动填入」提示改为仅在值确实来自上游时展示。
- **修复**：SKILL.md 速查表与文本节点端口行改为 `content` 键（并加「正文键就是 content」的 IMPORTANT 提示）；扩展工具 `promptGuidelines` 去掉错误的 `{ text: "..." }` 示例并新增「文本键名」条；`canvasExecutor.create_node` 新增 `normalizeDataKeys()`（`text` → `content`，已显式给 `content` 时不覆盖）并在回执里返回 `warnings` 提醒模型直接用目标键；`TextNode` 注入改为**仅在本节点内容为空时**填充一次。
- **验证**：前端 `tsc -b` 0 error；`oxlint`（TextNode / canvasExecutor / CanvasNodeViews）0 warning；扩展包 strict 0 error。端到端（浏览器 + 真实对话）未验证，按 §4 的三个动作手工回归。
- **注入前提的细节**：文本节点空态会自动进入编辑态，故「本地为空」判断同时看草稿（`editContent` / `isbnInput`）与已落盘值，避免上游数据到达时冲掉用户正在输入的文字。
- **继承语义定稿（用户选择 A）**：本地为空才继承、非空则本地优先（人/Agent 的显式写入胜）；「已继承过的上游值」记入 `node.data.inheritedFrom`：同一上游值不再重复注入（清空后刷新不复活），上游**换源**（值变化）仍可重新继承，上游断开则抹除记录以便重连再继承。新增节点类型时的规范：上游是「默认值」而非「真相源」，自动注入只能填空，不得覆盖显式写入。
- **未做**：`canvas_update_node` / `canvas_delete_node` / `canvas_disconnect_nodes` 仍缺（§6.7 的配置工具亦然）。

### 2026-09-20（第三轮）：修复反馈通道「假成功」

- **根因**：四处独立地把失败伪装成成功——① 路由只判 `resp.ok`，而企业微信 webhook 恒返回 HTTP 200（真实结果在 `errcode`）；② `!resp.ok` 与网络异常分支仍回 `success: true`；③ 未配置 `wechat.webhook_url`（seed 默认空串）时直接返回成功，且反馈不落库、直接丢失；④ 工具只要 `resp.ok` 就硬编码「已成功推送至管理员企业微信」。
- **修复**：`/api/feedback` 解析 `errcode`，响应新增 `delivered` / `errcode` / `parts_total` / `parts_delivered` 字段（HTTP 200 = 已受理，不代表已送达），失败时 message 明确「未送达 + 可执行原因」，日志改用掩码 webhook（`key=***`）；正文超 4096 字节时**自动分片**成多条消息顺序发送（不截断；邮箱 ≤254、模块 ≤100 限长以约束头部与分片数），首个分片失败即停止并如实回传已送达条数；`canvas_send_feedback` 读 `delivered` 决定文案，未送达时明确要求「如实告知用户、不得声称已推送」，并补两条 promptGuidelines（回执两档、正文上限 4000 字符）；前端反馈弹窗 `delivered=false` 改用 warning 提示（不再一律 success）。
- **顺带修复（端口同源）**：`PI_BACKEND_URL` 原先写死 8010（`runner.ts`），而 `server.ts` 默认 8000——PORT 未设置时扩展直连会指向错误端口。现统一到 `config/env.ts` 的 `serverPort`（server / runner / `inheritAttachBaseUrl` 三处同源）。
- **验证**：`tests/api/feedback.test.ts` 7/7（errcode 非 0 / 未配置 / 网络异常 / 超长自动分片 / 分片中途失败）；backend-ts `tsc --noEmit` 0 error；`tests/api/pi-*.test.ts` 158/158（端口同源改动未破坏 pi RPC 回归）（顺带修掉本文件 `mock.calls[0]` 的存量 TS2488，即旧记录里的 `feedback.test.ts:113`）；扩展包 strict 检查 0 error；前端 `tsc -b` 0 error。
- **未做**：反馈落库（需新增 `feedback_tickets` 表，属 schema 变更待确认）——**投递失败时反馈正文仍会丢失**；`canvas_get_node_configs` 恒 401（§6.7）仍未修。

### 2026-09-20（第二轮）：修复 Bifrost 检索 401

- **根因**：`canvas_search_prompts` / `canvas_search_skills` 在子进程内直连已鉴权路由（`preHandler: app.authenticate`），请求无 `Authorization` → 两次调用均 HTTP 401，检索不可用（`canvas_send_feedback` 之所以正常，是因为 `/api/feedback` 是公开路由）。
- **修复**：两个检索工具改走 `canvasOp` 桥接（新增 `search_prompts` / `search_skills` 两个前端 case，复用 `bifrostService` 携带已登录用户凭据）；`executeCanvasOp` 改为 async，`AgentChatPanel` 相应 `await`。零新增凭据、零鉴权面变化（§2.5）。
- **顺带收敛**：技能检索结果剥掉 `body`（SKILL.md 正文，单条数千字符）只回元数据，避免一次检索撑爆模型上下文；两个工具的 `promptGuidelines` 补「结果口径与失败如实转述」。
- **未修存量**：`canvas_get_node_configs` 直连 admin 路由恒 401（§6.7），已在文档记录，未纳入本次范围。

### 2026-09-20（第一轮）

- **新增只读工具** `canvas_list_nodes`（节点清单，不含正文）/ `canvas_read_node_output`（单节点输出，截断 + 占位符防护）——补齐「agent 只能创建节点却看不见节点内容」的能力缺口；
- **提示词三层同步**：DEFAULT 提示词新增「画布现状感知」原则；两个同捆 SKILL.md 补只读工具指引；create/connect 工具 promptGuidelines 交叉引用；
- **存量类型修复**：4 个旧工具 execute 返回补齐/统一 `details` 形状（`AgentToolResult` 契约，§2.3），扩展包 strict 检查归零；
- **种子升级逻辑**：`PREVIOUS_CANVAS_ASSISTANT_PROMPT` 精确匹配自动升级（§2.4）；
- **验证**：扩展 strict 0 error、前端 tsc/oxlint 0 问题、后端 tsc（存量 `tests/api/feedback.test.ts:113` 除外）+ canvas-agent 测试 5/5；端到端真实对话未验证（需完整环境）。
