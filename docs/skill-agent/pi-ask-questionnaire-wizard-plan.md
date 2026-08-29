# pi 问答问卷 tabbed 视图实施计划（RPC 桥转换方案）

> 状态：**方案评审中**（讨论纪要 + 实施蓝图，尚未实现）。
> 目标：Skill Agent 节点内，交互型扩展（`@juicesharp/rpiv-ask-user-question`）的问卷提问，由「逐题弹窗」升级为「tab 分组视图」（接近扩展 TUI 封面体验），**不改扩展包源码**。
> 关联：
> - 扩展包本体：`~/.pi/agent/npm/node_modules/@juicesharp/rpiv-ask-user-question/`（`rpc-fallback.ts` / `tool/types.ts` / `events.ts` / `ask-user-question.ts`）
> - 项目桥：`backend-ts/src/services/pi-agent-service.ts`（`mapPiJsonEvent` / RPC 注册表）
> - 前端弹层：`frontend/src/modules/bookplate/components/ExtensionDialog.tsx`
> - 接入总览：`docs/skill-agent/pi-extension-integration.md`

---

## 1. 背景与问题

- 扩展 README 封面是 **TUI 终端**的 tabbed 问卷（`ctx.ui.custom()`）：题条（Feature Type / Design / Testing / Submit）+ 左右箭头/tab 任意切换 + Submit 总览。
- 节点交互走的是 **RPC dialog 子协议**：`rpc-fallback.ts` 降级为逐题原生弹窗（`ui.select`/`ui.input`），一次只出一个问题，答完才出下一题。README 亦注明 RPC 宿主"walks through the host's native dialogs"。
- 产物差距：无 tab 条、无问题间切换、无 Submit 总览、无 notes（RPC 本就无 notes）。

## 2. 已核实的硬边界（实现依据）

| 事实 | 依据 |
| --- | --- |
| RPC stdout 没有扩展事件通道，`rpiv:ask-user:prompt`（完整问卷载荷）是进程内 SDK 事件总线，**后端收不到** | `events.ts` + `rpc-types.ts`（stdout 仅 `RpcResponse` / `RpcExtensionUIRequest`；`pi.events.emit` 只到同进程扩展监听器） |
| 后端**能**拿到完整问卷：`tool_execution_start` 事件的 `args` 即工具公开参数 `{ questions: [{ question, header, multiSelect, options: [{ label, description, preview? }] }] }`（1-4 题，每题 2-4 选项） | `pi-agent-service.ts:783` + `tool/types.ts:87-89`（参数为模型生成内容，非扩展内部实现） |
| walker 严格串行阻塞：第 N 题应答写回 stdin 前，第 N+1 题的 `extension_ui_request` 永不发出；答案一经写回即固化进本地 `answers` 数组 → 模型上下文 | `rpc-fallback.ts:90-99` |
| dialog 请求无 `timeout` 字段（坑 8：悬死由进程级超时兜底） | `ask-user-question.ts:334-336` 走 `runRpcPath`，`ui.select/input` 均不带 timeout（现有行为不变） |

## 3. 可行性结论

- ✅ **可行**：后端把「逐题弹窗」转为「tab 分组视图」（题条 + 当前题可答 + 已答题只读 chip + 未到题置灰）。
- ❌ **做不到**（协议级，不动扩展则无解）：
  1. **整卷一次填完 + Submit 总览提交**——答案是一次性写入 stdin 的，无法攒齐后再写；
  2. **修改已答题**——答案一旦写回即进 walker 的 `answers` 数组与模型上下文，无撤回通道；UI 上"改回"不影响模型所见；
  3. 取消后由模型纯文本重问会重走整卷，不是单题修改。
- ❌ 已被否决的方案：
  - 改扩展包源码（用户原则：升级维护代价高、兼容性扩展性差）；
  - 后端自动应答占位符 + 改写 `tool_execution_end` 信封——**污染模型上下文**，死路；
  - 依赖 `rpiv:ask-user:prompt` 事件——不落 stdout，链路不存在。

## 4. 目标设计（纯后端推导 + 前端渲染，无扩展改动）

```
tool_execution_start
  └─ args 按问卷形状校验（容忍未知字段）
       ├─ 命中 → 开分组窗口（key = toolCallId），记录 questions 元数据
       └─ 未命中（扩展升级变更形状等） → 照旧逐题弹窗（现状不坏）

首个 extension_ui_request 落在窗口内
  → SSE 新增事件 extension_questionnaire：{ groupId, questions: [{ header, question, multiSelect, options: [{ label, description, hasPreview }] }] }
  → 该请求及后续同窗口请求标注 { groupId, questionIndex }

tool_execution_end → 关窗
```

前端 `ExtensionDialog`（或新增并列组件）渲染：
- 顶部 tab 条（对应各题 + 可选"完成"尾条），图标/选中态参考 TUI；
- 当前题：可作答（select 选项按钮 / 自定义输入，复用现逻辑）；
- 已答题 tab：题目 + 答案 chip（只读确认）；
- 未到题 tab：展示题目与选项但置灰（提示"依次作答"）；
- 取消语义不变：任一题取消 = 整卷 decline（后端回 `cancelled`，与现有行为一致）。

## 5. 鲁棒性 / 兼容性 / 扩展性原则（优先于一切）

1. **加法式变更**：SSE 新增 `extension_questionnaire` 事件；旧前端忽略未知事件、新前端遇老后端仍是逐题弹窗；`extension_ui_request` 透传逻辑（白名单四方法）**不动**。
2. **宁缺勿滥校验**：问卷形状校验不通过 → 不发分组事件、不标注索引，退回现有逐题弹窗。只读公开参数字段（question/header/options.label/description/multiSelect/preview 体积标记），不硬编码扩展内部实现字段。
3. **未知字段容忍**：只做"能识别就增强"的保守解析，升级扩展新增字段时不破坏现有功能。
4. **事件边界**：窗口以 `toolCallId` 隔离——同一回合多次工具调用互不串扰；窗口内只认白名单四方法，未知 dialog 方法仍静默忽略。
5. **多租户**：分组状态存于 RPC 注册表已有的 `userId:workspaceId` 复合键上下文内，无跨账号串扰（同现有设计）。

## 6. 与未来通用性（复用边界）

- **扩展侧不可复用**：`rpc-fallback.ts` 是扩展包私有的问卷 walker（耦合 `QuestionData`/哨兵行/信封形状）；其他扩展"复用"的是 pi **dialog 协议**，不是这段代码。
- **项目桥已通用**：任何走 `ctx.ui.select/confirm/input/editor` 的扩展，白名单桥 + 前端弹层零改动可用（`pi-extension-integration.md` 2.4）。
- **本设计的通用性关键**：分组视图建模为「**任意工具的多步 dialog 事件对**」（`tool_execution_start` ↔ 窗口内连续 `extension_ui_request`），问卷字段只作可选装饰。日后出现其他"多步提问型"扩展，无需改桥即可复用同一 tab 分组视图。若实现时把逻辑耦合到 rpiv 字段，此通用性即失效——**实施时以协议建模，不以 schema 建模**。

## 7. 实施路线（后续任务拆解）

1. [ ] 后端：`mapPiJsonEvent` 状态机（问卷窗口开/关/索引标注）+ 形状校验纯函数（可单测）；
2. [ ] 后端：SSE 事件类型 `extension_questionnaire`（含 `piStream.ts` 类型对齐）；
3. [ ] 后端：单测——多题命中/形状不符降级/多工具调用隔离/取消路径；
4. [ ] 前端：`ExtensionDialog.tsx` 或并列组件 tab 视图（tab 条 + 三态题卡 + 只读答案 chip）；
5. [ ] 前端：旧事件兼容（无分组事件 → 现有单弹窗）；取消按钮走原 POST 通道（含 404 静默）；
6. [ ] 全链路冒烟：mock provider 触发 `ask_user_question` → 断言 `extension_questionnaire` + 按序 `extension_ui_request` → 逐题作答 → `agent_settled`；
7. [ ] 多轮并发回归：双账号同一 nodeId 分头作答不串扰。

## 8. 遗留（需扩展侧支持，明确不做）

- 整卷一次提交 / Submit 总览；（改 `rpc-fallback.ts` 才可能）
- 修改已答题；
- 题目间自由跳转作答、notes、preview 并排渲染（RPC 折叠进 title，现状不变）。

## 9. 备选评估（若"改答案/整卷提交"变硬需求）

- 上游扩展支持 wizard/批量协议（改 `rpc-fallback.ts`）；
- 或：仓库维护 fork 副本（`docs/skill-agent/rpiv-package/` 已有镜像），升级时 patch 重放 + 降级本引用——仅在上游长期无采纳、且产品需求明确强于维护成本时再启动。
