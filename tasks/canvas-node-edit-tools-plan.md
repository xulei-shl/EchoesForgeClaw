# 画板助手「改—调参—断线—删」工具化 实施计划

> 目标：补齐 `pi-canvas-tools` 对**已有节点**的操作能力，让画板助手能就地修正，而不是「只能新建绕过」。
> 前置阅读：`docs/skill-agent/pi-canvas-tools-maintenance-playbook.md`（扩展包维护手册：桥接架构、三层提示词、§2.3 details 契约、§5 临时 typecheck、§7 改动记录）。
> 首次成文：2026-09-20。范围决策见 §2。

---

## 1. 现状与关键事实（均已核对代码）

### 1.1 可直接复用的既有实现

| 能力 | 位置 | 语义 |
|---|---|---|
| 批量删节点 | `frontend/src/canvas/core/useNodeHandlers.ts` `removeNodesByIds(ids)` | `recordHistory()` + 中止进行中的流（`streamControllers`）+ 清理 `generationIds`/`analysisUploads`/节点尺寸/收藏/公开/选中 + 删节点 + 删相关边 |
| 单节点删（含级联） | 同上 `handleRemoveNode(id)` | `collectDescendantIds()` 收集子孙；**有子孙时**弹 `dialog.confirm`（danger）后调 `removeNodesByIds` |
| 删边 | `frontend/src/app/routes/CanvasPage.tsx` `handleRemoveEdge(edgeId)` | `recordHistory()` + 从 edges 移除 |
| 节点 data 浅合并 | `CanvasPage.tsx` `updateNodeData(id, patch)` | 仅合并 `data`，**不记历史**（调用方负责） |
| 撤销/重做 | `frontend/src/canvas/core/useCanvasHistory.ts` | **全画布快照**（nodes/edges/groups/generationIds），恢复时整体替换 → 删除/断线均可撤销 |
| 危险操作确认 | `backend-ts/src/services/ai/pi/events.ts:32` | RPC dialog 白名单 `select\|confirm\|input\|editor` → 扩展可用 `ctx.ui.confirm` |

### 1.2 必须解决的既有缺陷

`frontend/src/canvas/components/mascot/canvasExecutor.ts` 的写操作**直接调用模块级 `setNodes`/`setEdges`**，绕开 `recordHistory` ⇒ **agent 现在建的节点/连线撤销不了**，且与 UI 交互路径不一致（UI 手改可撤销）。新工具若沿用同样写法，会把这个不一致扩大到删除这类破坏性操作上。故必须先做 §3 阶段 0。

---

## 2. 范围与设计决策（已确认）

| 决策点 | 结论 |
|---|---|
| `canvas_delete_node` 默认语义 | **默认级联（与画布 UI 一致）**：`cascade=true`；另提供 `cascade=false` 只删自身（下游失去输入，文案需提示） |
| 删除的确认通道 | **扩展侧 `ctx.ui.confirm` 统一确认**（在助手面板内，能说明"删什么、删几个"）；确认后把 `confirmed: true` 传给前端，**跳过画布自家 dialog，避免双重弹窗** |
| 本轮范围 | 5 个工具：`canvas_update_node` / `canvas_get_node_params` / `canvas_get_node_details` / `canvas_delete_node` / `canvas_disconnect_nodes`。**不含** `canvas_run_node`（消耗算力、覆盖产物）与 `canvas_move_node` |
| 受管 4 类 AI 节点 | `configId`（后台模型/提示词绑定）**不可由 agent 修改**；需要时走 `canvas_send_feedback` |

---

## 3. 实施阶段（每阶段独立可验证）

### 阶段 0 · 模块级画布命令层（前置，必做）

新建 `frontend/src/canvas/core/canvasCommands.ts`，与 `useCanvasState` 同风格的模块级注册表：

```ts
export interface CanvasCommands {
  recordHistory: () => void;
  updateNodeData: (id: string, patch: Record<string, any>) => void;
  removeNode: (
    id: string,
    opts?: { cascade?: boolean; confirmed?: boolean }
  ) => Promise<{ deletedIds: string[]; deletedEdges: string[] }>;
  removeEdge: (edgeId: string) => boolean;
}
export function registerCanvasCommands(cmds: CanvasCommands | null): void;
export function getCanvasCommands(): CanvasCommands | null;
```

- `CanvasPage` 挂载时注入（复用 `recordHistory` / `updateNodeData` / `handleRemoveNode` / `handleRemoveEdge`），卸载时清空；
- `canvasExecutor` 的**全部写操作（含现有 create/connect）**改走该层；未挂载时返回明确错误「画布未挂载，无法操作」，**不降级直改 store**；
- `removeNode` 的 `confirmed: true` 表示确认已在扩展侧完成，前端不再弹自家 dialog；`cascade: false` 时只删自身。

**verify**：前端 `tsc -b` + `oxlint` 0 问题；手工：agent 建节点/连线后 **Ctrl+Z 可撤销**（修复既有缺陷）。

### 阶段 1 · 改内容 / 调参

| 工具 | 参数 | 回执 | 边界 |
|---|---|---|---|
| `canvas_update_node` | `node_id`、`data`（浅合并 patch） | `updated_keys` + 关键字段新值 + `has_output`（模型可自检，手册 §1） | **拒绝** `isGenerating` / `error` / `output` / `configId`（防伪造产物、防越权改后台配置），拒绝时说明原因并指明替代路径 |
| `canvas_get_node_params` | `node_type` | `fields: [{ key, default, options? }]` | 数据源＝`seedDataFor()` 默认值 + 各节点既有预设常量（如玻璃/浮雕/水彩预设），**不新建第二份真相源** |
| `canvas_get_node_details` | `node_id` | 当前 `data` 键值（长文本截断、图片走 `collapseImageUrl` 占位符）+ 端口 + `has_output` | 让模型「先读再改」，避免猜字段名 |

**verify**：agent 用 `canvas_update_node(content)` 写入导读 → 刷新仍在；改 `glass_refract.presetId` → 画面变化；试图写 `output` → 明确被拒。

### 阶段 2 · 断开连线

`canvas_disconnect_nodes(edge_id | source_id + target_id)` → 复用 `removeEdge`（记历史、可撤销）。
- **不弹确认**（非破坏、语义清晰、可撤销）；边不存在 → 明确报错 + 提示先 `canvas_list_nodes`；
- 回执返回被移除的 `edge_id` 与两端节点标题。

**verify**：断线后下游输入立即消失；Ctrl+Z 恢复。

### 阶段 3 · 删除节点

`canvas_delete_node(node_id, cascade=true)`：
1. 先取节点与子孙清单（用于确认文案），**无论有无子孙都 `ctx.ui.confirm`**（danger）——agent 是自动化来源，静默删除风险高于手动点击；
2. 用户确认 → 调 `removeNode(id, { cascade, confirmed: true })`，复用既有流中止与关联清理；
3. 用户取消 → 回执 `cancelled`，**不产生任何变更**；
4. `cascade=false` 时文案提示「下游节点将失去输入」。

**verify**：单节点删除；带子孙删除（确认文案数量正确）；取消不产生变更；删除后 Ctrl+Z 可恢复；`isGenerating` 节点的流被中止。

### 阶段 4 · 三层提示词与技能同步（必做，否则模型不会用）

- `backend-ts/src/config/seed.ts`：`DEFAULT_CANVAS_ASSISTANT_PROMPT` 增「就地修正优先：先改/断线/删，不要新建绕过」，并按手册 §2.4 走 `PREVIOUS_*` 精确匹配升级（存量部署才生效）；
- `packages/pi-canvas-tools/skills/canvas-node-catalog/SKILL.md`：新增「编辑 / 断线 / 删除」章节 + 参数速查表扩容（字段名 + 取值域 + 默认值）；
- 新工具的 `promptGuidelines`：改前先读现状、删前先 `list_nodes` 确认 id、`configId` 不可改需走 feedback。

**verify**：`cd backend-ts && npx vitest run tests/api/canvas-agent.test.ts` 5/5；真实对话走通「建 → 改 → 断 → 删」。

### 阶段 5 · 文档与全量回归

- 手册 §0 工具表（9 → 13）、§3 Checklist 补新工具步骤、§7 改动记录；
- 回归：扩展包 strict（手册 §5）0 error + 前端 `tsc -b`/`oxlint` 0 问题 + 后端 `tsc --noEmit` 0 error + `vitest tests/api/pi-*.test.ts` 158/158 + `tests/api/feedback.test.ts` 7/7。

---

## 4. 风险与边界

| 风险 | 处置 |
|---|---|
| 误删用户产物 | 强制 `ctx.ui.confirm` + 依赖撤销栈（阶段 0 保证 agent 操作可撤销）；工具一次只接受 1 个 `node_id`（级联仅由 `cascade` 决定） |
| 伪造生成结果 | `output` / `isGenerating` 进写入 denylist |
| 越权改受管节点配置 | `configId` 不可改，需要时走 `canvas_send_feedback` |
| 并发流冲突 | 删/断线复用既有 `streamControllers.abort()`；对 `isGenerating` 节点仍允许改内容（内容字段与产物字段分离） |
| 命令层注册时机 | agent 只在前端对话中运行 ⇒ 画布必然挂载；拿不到命令层一律明确报错 |
| 提示词改动对存量无效 | 必须走手册 §2.4 的种子升级模式，不能只改 `DEFAULT_*` 常量 |

---

## 5. 验收清单

- [ ] agent 能把长文写入 text 节点，刷新后仍在，且不被上游继承覆盖
- [ ] agent 能改多模态节点的预设/参数并立即生效
- [ ] agent 能断开任一连线，用户可按 Ctrl+Z 恢复
- [ ] agent 删除节点前必定弹出可读确认；取消不产生任何变更；确认后可撤销
- [ ] agent 的建/改/删/断线全部进入撤销栈（阶段 0 后与 UI 交互同口径）
- [ ] 受管节点的 `configId` 无法被 agent 修改
- [ ] 上述工具在 SKILL.md、DEFAULT 提示词、工具 promptGuidelines 三层均有使用指引

---

## 6. 未纳入本轮

- `canvas_run_node`（触发运行/重跑）：消耗算力并覆盖已有产物，需单独的产品/配额决策；
- `canvas_move_node`（agent 自行排版）：`canvas_create_node` 已自动错位，优先级低；
- `canvas_get_node_configs` 恒 401 的存量缺陷（手册 §6.7）：需桥接 + 面向普通用户的只读配置接口，属权限决策。
