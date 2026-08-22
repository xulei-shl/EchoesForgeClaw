# useNodeHandlers 架构重构计划

## 目标
`useNodeHandlers.ts`（1472 行）是堆叠 50+ handler 的 God Hook。按「行为族」模块化拆分、合并重复逻辑、删除死代码，保持公开接口（handler 名称/签名）完全不变，降低后续新增节点类型的成本。

## 实施步骤

### Step 1: 纯图操作模块
- [x] `nodeGraph.ts` 新建：`collectDescendantIds` / `hasChildOfType`
- [x] `nodeLayout.ts` 删除死函数 `getNextNodePosition`（从未被调用）

### Step 2: 编辑器 patch 工厂
- [x] `editorPatch.ts` 新建：`useEditorPatchHandler`（变更检测 + 可选撤销历史）
- [x] 合并 11 个重复 handler（zhihu / map_poster / map_art / image_search / art_image_search / pattern_search / color_search / wikipedia / translation / web_search / stamp_cutter）

### Step 3: 输入收集去重
- [x] `execution.ts` 新增 `firstUpstreamText`（取第一个线上级文本）
- [x] `CanvasNodeViews.tsx` 9 处重复表达式改共用 helper（-27 行）

### Step 4: 工具类 fetch 工厂
- [x] `useToolHandlers.ts` 新建：
  - `useSimpleToolHandler`（日历 / 天气 / Wikipedia 检索 / Wikipedia 全文）
  - `useTabbedToolHandler`（知乎 / 翻译 / 网络搜索：tabData 按源隔离）

### Step 5: 图片输出工厂
- [x] `useImageOutputHandlers.ts` 新建：
  - `useSelectImageHandler`（图片检索 / 艺术检索 / 纹样 / 配色）
  - `useImageExportHandler`（图书小票 / 邮票：保存 → 历史记录 → 写回）
  - `useSimpleImageExportHandler`（地图海报 / 艺术地图）

### Step 6: 组合根
- [x] `useNodeHandlers.ts` 重写为组合根（1472 → 592 行），公开接口不变

### Step 7: 删除冗余尺寸表
- [x] `nodeTypes.ts` 删除重复的 `NODE_DEFAULT_SIZES`，改用 `DEFAULT_SIZES`（graphTypes）

## 验证
- [x] `npx tsc -b` 通过（无类型错误）
- [x] `npm run lint` 通过（无新增告警；原文件的 setCtxMenu 告警保留为既有状态）
- [x] `npm run build` 构建成功

## 评审
- 行为等价：所有 handler 逻辑逐行对照原文迁移，仅将重复骨架提取为工厂配置；锁定的语义差异点：
  - wikipedia/translation/web/stamp 的 editor 从「无条件写回」变为「变更检测写回」（组件均传新对象，行为等价且更优）；
  - tabbed/select/export 的 console.error 文案改为统一模板（不影响行为）。
- 新增工具类节点：一行工厂调用即可（见 useToolHandlers.ts / useImageOutputHandlers.ts 组装区）。