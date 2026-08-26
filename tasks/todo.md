# 解除节点「有下级不可操作」限制 + 上下文注入实时化

## 背景

- 原模型：节点有下游时冻结一切影响输出的操作，改输出必须删连线重连。
- 新模型：源头随时可改；下游手动点「运行」时从连线现场读取上游最新输出（机制已存在：`resolveNodeRunInputs` 点击时实时收集，无需新增逻辑）。
- 上下文注入展示：非 chat 节点已实时（渲染期派生）；chat/PiChat 需从首条消息快照改为始终实时计算展示。

## 任务清单

### 阶段 1 — 解除限制
- [x] 1.1 `CanvasNodeViews.tsx`：删除 `hasDownstreamOf`（:219-223）及 ~30 处计算与传递
- [x] 1.2 `ChatNodeHost.tsx:584` / `PiChatNodeHost.tsx:669`：删除 import 与传递
- [x] 1.3 `useNodeHandlers.ts` `handleImageChangeFor`（:327-341）：移除自算 descendants 的「有下游禁替换图片」守卫

### 阶段 2 — 组件侧彻底清理
- [x] 2.1 `NodeActionBar.tsx`：删除 `hasDownstream/downstreamTooltip` 禁用管道与默认禁用文案
- [x] 2.2 bookplate 节点组件（~19 文件）：删 prop 接收与内部守卫（知乎提交守卫等）
- [x] 2.3 multimodal 节点组件（~7 文件）+ `useSearchNode.ts`：isLocked 移除 `hasDownstream &&`

### 阶段 3 — Chat 注入展示实时化
- [x] 3.1 `ChatNodeHost.tsx:536-561` / `PiChatNodeHost.tsx:627-660`：contextBlocks 始终实时计算，不再读首条消息快照
- [x] 3.2 保持不变：发送时首轮快照注入（attachContextToFirstUser）

### 阶段 4 — 验证
- [x] 4.1 `npm run build`（tsc 类型检查兜底）+ `npm run lint`（2026-08-26 均通过，exit 0）
- [ ] 4.2 手动场景：上游可运行/重试/编辑；下游重跑吃新值；chat 注入卡片同步；分支新建回归

## 边界（非缺陷）
- 下游旧结果不自动失效，需手动重跑（本次选择的模型）。
- chat 已开始对话的注入卡片显示最新值，但该会话实际用发送时快照；清空对话后下一轮注入最新。
- 分支新建行为（图像分析/图像生成已有结果时重试建兄弟节点）与 hasDownstream 正交，不受影响。

## 评审记录
- 2026-08-26：阶段 1-3 全部完成，8 个 multimodal 残留文件已清理，`frontend/src` 下 grep `hasDownstream`/`downstreamTooltip` 为 0。`npm run build` + `npm run lint` 通过（lint 仅 public/maplibre vendor 预存在警告）。
- 遗留：任务 4.2 手动场景验证（需在浏览器实测）。文档 `docs/多模态工具/图片处理/图片处理节点效果接入指南.md:105,188` 仍描述旧门禁行为，可顺手同步。
