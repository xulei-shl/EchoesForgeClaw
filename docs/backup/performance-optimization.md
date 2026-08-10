# BookForge 前端性能优化备忘（藏书票画布）

> 目的：记录已落地与待评估的优化方案，供后期参考与决策。
> 最后更新：2026-08。本文只记录方案，不代替代码。

---

## 背景：目前已落地的优化（勿重复做）

| 优化 | 说明 | 关键文件 |
| --- | --- | --- |
| 拖拽零渲染 | 节点用 `transform: translate3d` 定位；指针捕获 + rAF 合并，拖拽期间直接命令式改 DOM，**不触发任何 React 渲染**；连线通过 `NodeEdge` 的命令式 `setPositions` handle 实时跟随；松手才提交一次位置 | `platform/components/node/CanvasNode.tsx`、`NodeEdge.tsx`、`app/routes/BookplatePage.tsx` |
| 节点 memo | 三个节点组件 `memo` 包裹；父级回调全部改为接收节点 id 的稳定 `useCallback`；`buildStageResults` / 收藏公开逻辑改读 refs 快照，避免稳定闭包读到过期状态 | `BookInfoNode.tsx`、`PromptNode.tsx`、`ImageNode.tsx`、`BookplatePage.tsx` |

**注意**：`BookplatePage` 中稳定回调依赖一个不变量 —— 被引用的处理函数（`handleGeneratePrompt` / `fetchBookInfo` / `runImageGeneration` / `toggleFavoriteForImage` 等）只能读取 refs / 模块函数 / 稳定 setter。后续改动这些函数时若新增了对 state 的直接读取，会破坏稳定闭包（读到过期状态），务必同步改造为 refs 或调整回调依赖。

---

## 一、实测重渲染减少（验证性优化，暂未做）

### 目的

memo 是标准 React 行为，代码审查也确认了 prop 稳定性，但**没有运行时数据**证明收益。实测可：
1. 验证 memo 没有被某个不稳定的 prop 悄悄击穿；
2. 留存"优化前后重渲染次数"的量化数据，作为后续优化的基线。

### 方法 A：临时渲染计数器（推荐，最直接）

在三个节点组件内临时加计数（完成后删除）：

```tsx
// 例：PromptNode.tsx
const renderCount = useRef(0);
renderCount.current += 1;
console.count(`[PromptNode] render #${renderCount.current}`);
```

步骤：
1. 给三个节点组件都加上计数器（`BookInfoNode` / `PromptNode` / `ImageNode`）；
2. 运行一次完整的第二阶段流式生成（触发 SSE 流）；
3. 观察控制台输出：
   - **预期（memo 生效）**：只有正在流式的 PromptNode 计数在增长；图书元数据、图片节点计数不变。
   - **异常**：若其他节点计数也在增长 → 有 prop 身份不稳定，memo 被击穿，需排查（见下方"击穿排查"）。
4. 对比优化前：需要 `git stash`（或临时移除 memo/稳定回调）跑一遍同场景，记录对照数据。

### 方法 B：React DevTools Profiler

1. 打开 React DevTools → Profiler → Start recording；
2. 触发一次流式生成；
3. 停止录制，查看火焰图：正常情况只有 PromptNode 及其子树被标记为"渲染"；
4. 可用"组件名高亮"（Highlight updates）快速目测。

### memo 击穿的常见排查信号

- 父级渲染时向节点传了内联对象/数组（如 `data={{ ...node.data }}`）；
- 回调仍是内联箭头（未走稳定 `useCallback`）；
- props 数量/类型不匹配导致每次都是新引用。

### 评估

- **必要性：低～中。成本极低（5 分钟），建议做一次**，作为验证与基线存档。

---

## 二、流式状态下沉（架构性优化，暂未做）

### 现状：流式状态在父级

当前链路（`BookplatePage.tsx` 的 `handleGeneratePrompt`）：

```
SSE chunk
  → BookplatePage 的 onChunk 回调
  → setNodes(...)  （父级 state 更新）
  → 父级整体重渲染（nodes/edges map、Canvas children diff）
  → PromptNode 收到新 content prop
  → PromptNode（含 ReactMarkdown）重新渲染
```

已 memo 化后，**兄弟节点**（图书元数据/图片）在 chunk 到达时不会重渲染；但父级自身仍会每次 chunk 重渲染一次。

### 目标：流式状态下沉到 PromptNode

PromptNode 自己持有流式 `content` 状态，并在 `useEffect` 内开启 SSE：

```
SSE chunk
  → PromptNode 内部 setState（父级完全不参与）
  → 只有 PromptNode 自身重渲染
```

### 关键难点（实施前必须解决）

1. **最终内容回传**：父级 `buildStageResults`（收藏/公开时回溯三阶段结果）当前直接读 `promptNode.data.content`。内容下沉后父级拿不到，需要：
   - PromptNode 流结束后通过 `onComplete(content)` 把最终内容回传给父级存储（推荐）；或
   - 父级用 ref 读取。
2. **生命周期迁移**：AbortController、节点删除/清空画布时中断流，当前由父级 `streamControllers` 管理；下沉后应迁到 PromptNode 的 effect cleanup（反而更内聚）。
3. **错误处理**：流失败需通过 `onError` 回调上报父级（目前父级会写 `error` 到节点数据）。
4. **props 面变化**：`content` 不再是 prop，改为 `initialContent` + 完成/错误回调；注意与 memo 的浅比较兼容。

### 何时值得做（触发条件）

- [ ] Profiler 显示父级每次 chunk 的重渲染占比可观（见第一节实测方法）；
- [ ] 多个节点**同时**流式（父级每 chunk 的 map 成本放大）；
- [ ] 画布节点数量大、chunk 频率高（模型 token 输出密集）。

### 评估

- **必要性：当前低，建议暂缓**。流式节点的内容本来就在变，它每次 chunk 渲染不可避免；下沉只省掉父级一次轻量渲染。典型 3 节点流程收益无感，却要付出状态同步 + 生命周期搬迁的中等重构成本和出错风险。先做第一节的实测，若父级渲染确实占时间再实施。

---

## 决策清单（现阶段结论）

| 项 | 状态 | 建议 |
| --- | --- | --- |
| 拖拽零渲染 | ✅ 已落地 | — |
| 节点 memo + 稳定回调 | ✅ 已落地 | — |
| 一、实测重渲染减少 | ⬜ 未做 | 低成本，建议尽快做一次并留存数据 |
| 二、流式状态下沉 | ⬜ 未做 | 暂缓，依据实测数据 + 触发条件再决定 |

---

## 附：涉及文件索引

- `frontend/src/app/routes/BookplatePage.tsx` —— 画布编排、SSE 流（`handleGeneratePrompt`）、稳定回调（`handleXxxFor`）、`nodesRef/edgesRef`、收藏公开逻辑
- `frontend/src/platform/components/node/CanvasNode.tsx` —— 节点外壳、命令式拖拽
- `frontend/src/platform/components/node/NodeEdge.tsx` —— 连线、命令式 `setPositions`
- `frontend/src/modules/bookplate/components/{BookInfoNode,PromptNode,ImageNode}.tsx` —— 节点内容组件（均已 memo）
