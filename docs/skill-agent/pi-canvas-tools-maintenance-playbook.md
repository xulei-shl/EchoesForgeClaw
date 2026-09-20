# pi-canvas-tools 扩展包维护手册（画板助手最佳实践）

> 面向：维护/扩展画板助手（canvas_assistant）工具能力、提示词与技能文档的工程师。
> 首次成文：2026-09-20，基于「新增 canvas_list_nodes / canvas_read_node_output 只读工具 + 配套提示词/技能文档同步」实际全过程沉淀。
> 配套文档：升级主包见 `pi-agent-upgrade-playbook.md`；扩展接入通用机制见 `pi-extension-integration.md`（本文只写画板助手特有的部分，不重复通用内容）。

---

## 0. 当前基线（随每次改动更新本表）

| 组件 | 位置 | 加载方式 | 备注 |
|---|---|---|---|
| 扩展包 `pi-canvas-tools` | `packages/pi-canvas-tools/src/index.ts` | **TS 源码直接加载**（package.json `pi.extensions: ["./src/index.ts"]`） | 无需构建产物；pi 侧加载不做类型检查 |
| 工具清单（9 个） | 同上 | `canvasOp` 桥接 | 只读：`canvas_list_nodes` / `canvas_read_node_output`；写操作：`canvas_create_node` / `canvas_connect_nodes`；检索：`canvas_search_prompts` / `canvas_search_skills`（均经桥接，前端带用户凭据调后端 Bifrost 接口）/ `canvas_get_presets`（扩展内静态预设）/ `canvas_get_node_configs`（仍直连 admin 路由，见 §6.7）；反馈：`canvas_send_feedback`（直连公开路由 `/api/feedback`；**回执以响应体 `delivered` 为准**，HTTP 200 仅代表已受理，见 §6.8） |
| 前端执行器 | `frontend/src/canvas/components/mascot/canvasExecutor.ts` | 每个 op 一个 case，`executeCanvasOp` 为 async | 复用 `nodeOutputText` / `nodeOutputImages` / `getNodeTitle` 纯函数（与 chat 节点上下文注入同口径）；检索 case 复用 `bifrostService`（与提示词/Skill 检索节点同口径） |
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
2. **前端执行器**（`canvasExecutor.ts`）：新增对应 case；复用 `nodeOutputText` / `nodeOutputImages` / `getNodeTitle` 纯函数（跨节点类型零枚举，与 chat 节点同口径）；大文本截断 + data URL 占位符（§2.2）；需用户凭据的后端调用复用既有 service（如 `bifrostService`），**不要在扩展端直连已鉴权路由**（§2.5）；
3. **提示词三层同步**（§2.1）：DEFAULT 提示词 + 相关 SKILL.md + 工具 promptGuidelines；
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

端到端（真实对话链路需起后端+前端+模型，按需做）：画板助手能主动调 `canvas_list_nodes` 查现状、`canvas_read_node_output` 读内容，且输出为空时如实告知。

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

---

## 7. 改动记录

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
