# BookForge 画板节点组件对齐最佳实践 (Lessons Learned)

在实现无限画布（Infinite Canvas）或节点流式编辑器（Node-based Editor）时，经常会遇到视觉坐标与数学坐标不一致的对齐问题。本指南总结了在开发 BookForge 画板模块时解决节点对齐与连线错位问题的关键经验，供其他类似项目参考。

## 1. 警惕 Tailwind CSS 中定位类的隐含冲突

**陷阱**：在封装节点组件时，我们通常会传入自定义 `className`，如果不小心混用了 `absolute` 和 `relative`，会导致致命的布局错误。
```tsx
// ❌ 错误示例：同时存在 absolute 和 relative
<div className={`absolute bg-white pointer-events-auto relative ${className}`}>
```
**分析**：在 Tailwind CSS 最终生成的样式表中，由于 `relative` 经常在 `absolute` 之后定义（或按其工具类顺序处理），`relative` 会覆盖 `absolute`。这会导致原本应该脱离文档流、完全靠 `transform: translate3d(x, y)` 绝对定位的节点，意外地**退回到了正常的块级文档流（Normal Flow）中**。
**后果**：节点会像普通的 `div` 一样垂直堆叠，前一个高度较大的节点会将后一个节点向下“挤压”。此时再叠加 `translate3d(y)` 偏移，就会导致后一个节点的视觉位置比数学坐标整整低了一个前序节点的高度，呈现出阶梯状跌落的视觉 Bug。
**最佳实践**：
- 画布内部的可自由拖拽节点，**只保留 `absolute`**，作为纯粹的绝对定位层。
- 坚决杜绝在节点外层容器混用排版类（如 `relative`, `static` 等）。

## 2. 区分顶部对齐与垂直居中对齐的算法

**陷阱**：在生成下一个流程节点时，直接复用前一个节点的 `y` 坐标。
```typescript
// ❌ 错误示例：直接复用 y 坐标（仅仅是顶部对齐）
const newY = sourceNode.y;
```
**分析**：如果源节点（如包含大量文本的卡片）非常高，而目标节点很矮，两者顶部对齐在视觉上会呈现出强烈的“不对称感”和“错位感”，导致水平相连的贝塞尔曲线被迫弯曲。
**最佳实践**：
应该根据两个节点的实际高度，计算出**垂直居中对齐（Center Alignment）**的 Y 坐标，使得它们的中心处于同一水平线。
```typescript
// ✅ 正确示例：垂直居中补偿
const sourceHeight = sourceSize.height;
const targetHeight = targetSize.height;
// 使得 targetNode.y + targetHeight/2 === sourceNode.y + sourceHeight/2
const newY = sourceNode.y + (sourceHeight - targetHeight) / 2;
```

## 3. 数学坐标系与视觉呈现解耦时的排查思路

**陷阱**：发现连线（SVG path）弯曲夸张、甚至脱离节点时，一味地去修改 SVG 计算公式（如贝塞尔曲线的控制点）。
**分析**：SVG 的连线计算通常基于数据层（State/Ref 中的 `x, y`），而 HTML 节点基于 CSS 渲染（受 Flex/Block 布局、Margin 塌陷等影响）。
如果 SVG 连线呈完美的水平直线（或曲线逻辑正常），但节点视觉上脱节，这意味着**数学坐标计算是 100% 正确的，出错的绝对是 HTML DOM 的 CSS 渲染**。
**最佳实践**：
- **增加显式视觉锚点（Anchor Dots）**：在节点组件的边界明确画出小圆点（例如 `top: 50%`）。当连线脱节时，通过比较“连线端点”与“视觉锚点”的差距，能瞬间判断是 SVG 公式算错了，还是 DOM 被 CSS 意外偏移了。
- 永远以“数学坐标系”为唯一真理（Source of Truth），强迫 CSS 去适应数学模型，而不是修改数学模型去迎合错误的 CSS 排版。

## 4. 高频拖拽更新的最佳实践

在对齐和拖拽过程中，为了防止严重的卡顿，节点的布局应该遵循以下模式：
- **数据层**：初始坐标和最终落点存在 React State 中。
- **视图层**：拖拽过程中的实时坐标通过 `requestAnimationFrame` + `el.style.transform = translate3d(...)` 直接更新 DOM，绕过 React 的 render 周期。
- **连线层**：使用 `useImperativeHandle` 暴露命令式 `setPositions` 给父级，父级在捕获拖拽事件时直接更新 SVG Path，确保高帧率下节点与连线严丝合缝地对齐。

## 5. pi 子进程常驻复用（backend-ts）

**陷阱 1：Windows 下 `taskkill /T /F` 是异步的**。`killPiProcess` 返回后进程可能还没真正退出，紧接着对工作区目录做 `rmSync`（如清空对话 / 测试清理）会撞文件锁（`EPERM: Permission denied`）。**做法**：kill 必须等待子进程 `close` 事件（带短超时兜底）再删除目录；`killPiProcess`/`clearPiSession` 因此改为 async。

**陷阱 2：Node 子进程的 `stdout` 流只能消费一次**。跨轮复用 pi RPC 进程时，不能在每轮单独 `spawn`+监听 stdout——第二轮无法再读同一进程的输出。**做法**：把「spawn + stdout 行解析 + 事件队列」提升为进程级常驻状态机（本轮状态放 `entry.round`），每轮只往 stdin 发新 prompt 并从队列消费；进程间唯一真相源是会话文件 `chat.jsonl`，多轮上下文才不会重复注入。

**设计判据**：是否复用/重拉由「配置代数」（提示词/skill/模型/扩展哈希）决定，与对话内容无关；代数相同复用热进程，变化即杀旧重拉。
