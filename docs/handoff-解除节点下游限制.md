# Handoff：解除节点「有下级不可操作」限制 + 上下文注入实时化

> 生成时间：2026-08-26 · 状态：**代码清理完成**（build + lint 通过）
> 关联任务清单：`tasks/todo.md`
> 分支：`main`（未提交，工作区约 40 个文件变更）

---

## 1. 目标

- 旧模型：节点有下游时冻结一切影响输出的操作，改输出必须删连线重连。
- 新模型：源头随时可改；下游手动点「运行」时从连线现场读取上游最新输出（机制已存在：`resolveNodeRunInputs` 点击时实时收集，无缓存，无需新增逻辑）。
- 上下文注入展示：非 chat 节点已实时（渲染期派生）；chat/PiChat 由首条消息快照改为始终实时计算展示。

## 2. 已完成 ✅

### 核心文件（bookplate）
| 文件 | 变更 |
|---|---|
| `NodeActionBar.tsx` | 删除 `hasDownstream/downstreamTooltip` 禁用管道与默认禁用文案 |
| `CanvasNodeViews.tsx` | 删除 `hasDownstreamOf` 函数及全部 32 处计算与传递 |
| `useNodeHandlers.ts` | 移除 `handleImageChangeFor` 中的 descendants 守卫 |

### Chat 上下文注入实时化
| 文件 | 变更 |
|---|---|
| `ChatNodeHost.tsx` | 删除传递 + contextBlocks 始终实时计算（不再读首条消息快照） |
| `PiChatNodeHost.tsx` | 同上 |

### 组件侧清理（已全部完成 27 个文件）
- bookplate 17 个组件：BookInfoNode/CalendarNode/ChatNode/ImageAnalysisNode/ImageNode/ImageUploadNode/NodeSettingsPopover/PromptSearchNode/SkillSearchNode/TextGenerationNode/TextNode/TextTranslationNode/VuFindCallNumberNode/WeatherNode/WebSearchNode/WikipediaSearchNode/ZhihuSearchNode
- multimodal 8 个文件：ArtImageSearchNode/BookCardNode/ColorSearchNode/ImageProcessNode/JournalMakerNode/PatternSearchNode/`shared/SelectedItemBar.tsx`/`shared/useSearchNode.ts`

> 运行时行为已确认：下游运行从 store 现场读取输入（`resolveNodeRunInputs` 无缓存），Chat 注入展示已实时计算。剩余清理全部为纯机械操作，不影响运行时行为。

## 3. 待办 ⏳（已完成 ✅）

> 已通过 `grep hasDownstream` / `grep downstreamTooltip` 全库核实：**2026-08-26 已全部清理完毕**，`frontend/src/modules` 下 0 残留，`npm run build` + `npm run lint` 均通过。

| 文件 | 主要问题 |
|---|---|
| `ImageSearchNode.tsx` | prop 接口 + `disabled={saving \|\| hasDownstream}` + 条件渲染 + `if (hasDownstream \|\| savingId) return` + onClick 内守卫 |
| `MapArtNode.tsx` | prop 接口 + downstreamTooltip + JSX 传递 |
| `MapPosterNode.tsx` | 同上 |
| `OilPaintNode.tsx` | prop 接口 + 多处 `disabled={hasDownstream \|\| isGenerating}` + `{!hasDownstream && (...)}` |
| `ReceiptPrinterNode.tsx` | prop 接口 + `disabled={isExporting \|\| hasDownstream}` |
| `StampCutterNode.tsx` | prop 接口 + 多处 `disabled={hasDownstream}` + `{!hasDownstream && (...)}` |
| `StickerMakerNode.tsx` | 同上 |
| `TextImageNode.tsx` | prop 接口 + `const locked = Boolean(hasDownstream)` |

### 清理规则（统一机械操作）
1. 删 `hasDownstream?: boolean;` + `downstreamTooltip?: string;`（prop 接口 + 解构）
2. 删 JSX 中的 `hasDownstream={hasDownstream}` 行
3. `disabled={hasDownstream}` → 删整个属性；`disabled={... || hasDownstream}` → 只保留 `disabled={...}`
4. `disabled={hasDownstream || ...}` → `disabled={...}`
5. `{!hasDownstream && (...)}` → 去掉条件直接渲染
6. `{hasDownstream && (<提示>)}` → 整块删除
7. `const locked = Boolean(hasDownstream)` → 改为 `const locked = false`
8. **ImageSearchNode 特例**：`if (hasDownstream || savingId) return;` → `if (savingId) return;`；onClick 内 `if (hasDownstream) {...}` 守卫整块删除

### 注意点
- `ImageSearchNode.tsx`、`StampCutterNode.tsx`、`OilPaintNode.tsx` 里 `disabled` 与条件渲染规则需仔细对照上下文（先读文件再改）。
- 需要确认 ImageSearchNode/TextImageNode 内部是否有共享子组件接收 `hasDownstream` prop（grep 到下标即知，未见 <ANALYSIS>）。

## 4. 验证方式

```bash
cd frontend
npm run build   # tsc 类型检查兜底，漏删的 prop 传递会报错
npm run lint
```

- [x] `npm run build` 通过（2026-08-26 已验证，tsc + vite build）
- [x] `npm run lint` 通过（exit 0，仅 public/maplibre vendor 预存在警告）
- [x] grep 确认 `hasDownstream` / `downstreamTooltip` 在 `frontend/src` 下为 0

## 5. 边界（非缺陷）
- 下游旧结果不自动失效，需手动重跑（本次选择的模型）。
- chat 已开始对话的注入卡片显示最新值，但该会话实际用发送时快照；清空对话后下一轮注入最新。
- 分支新建行为（图像分析/图像生成已有结果时重试建兄弟节点）与 hasDownstream 正交，不受影响。

## 6. 相关文档待同步（中优先级）
- `docs/多模态工具/图片处理/图片处理节点效果接入指南.md:105,188` 仍描述"hasDownstream 门禁自动生效"——功能已移除，建议下次顺手更新该文档描述。
- `tasks/todo.md` 任务勾选状态：清理完成，可统一勾选（本次未改，留给收尾）。

## 7. 收尾动作
- 提交前：可选更新 `docs/多模态工具/图片处理/图片处理节点效果接入指南.md` 过时描述、勾选 `tasks/todo.md`。
- 手动场景验证（若需上线前确认）：上游可运行/重试/编辑；下游重跑吃新值；chat 注入卡片同步；分支新建回归。
- 确认无误后提交（需用户明确同意后再 commit）。