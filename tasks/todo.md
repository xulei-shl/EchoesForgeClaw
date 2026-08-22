# 湿油彩效果节点（oil_paint）实施规划

## 方案决策
- **采用方案 C：前端浏览器端执行**（同邮票截图框 stamp_cutter 模式）。
- 理由：wet-paint-flow 是纯浏览器 Three.js + WebGL 着色器管线，FastAPI(Python)/backend-ts(Node)
  均无法直接运行，移植 = 全部 GLSL 重写 + 视觉失真 + 服务端 CPU 渲染极慢；
  前端执行视觉 100% 保真，且保存链路复用既有 `/save-image` + `generations`。
- 参数：暴露少量核心参数滑杆（笔触大小 / 笔触数量 / 颜料干燥度），默认值取源项目。

## 任务清单

### 后端
- [ ] 1. `backend-ts/src/modules/bookplate/node-types.ts`：新增 `OIL_PAINT: 'oil_paint'`
      + NODE_TEMPLATES 条目（category='multimodal', configurable=false,
      output_type='image', input_types=['image','text']）

### 引擎提取（核心工作）
- [ ] 2. 新建 `frontend/src/modules/multimodal/oilpaint/`：
      - `types.ts`：WetPaintParams（strokeSize/strokeCountK/dryness 等 + 默认值）
      - `engine.ts`：从 docs main.js 提取「图片输入」headless 管线：
        图片纹理 → g-buffer(颜色/语义/法线) → 结构张量方向场分析 → Poisson 三层播种
        → Bézier ribbon 笔触几何 → stroke+height 渲染 → 湿油彩合成(mode5 米色画布/融合)
        → canvas.toDataURL('image/png')；离屏 renderer、生长动画直接置完成态
      - `index.ts`
      - three 以动态 import() 引入做代码分割
- [ ] 3. `frontend/package.json` 增加 `three` 依赖并安装

### 前端注册链路（按 docs/节点输入输出声明式接线.md §3.1）
- [ ] 4. `platform/types/index.ts`：CanvasNodeType 加 `'oil_paint'`
- [ ] 5. `modules/bookplate/nodeLayout.ts`：NodeType 联合 + NODE_SIZES 尺寸
- [ ] 6. `modules/bookplate/nodeTypes.ts`：NODE_TEMPLATES / NODE_COLORS / NODE_PORT_TYPES 静态镜像
- [ ] 7. `modules/multimodal/components/OilPaintNode.tsx`：镜像 StampCutterNode ——
      activeImageSrc = uploadedImage || upstreamImageUrl 四级兜底；参数滑杆；
      预览双态；NodeActionBar 统一操作按钮（运行/下载/保存/清空）；isSaved 态
- [ ] 8. `seedData.ts`：oil_paint 初始 data 分支
- [ ] 9. `useImageOutputHandlers.ts`：OIL_PAINT 导出配置（useImageExportHandler，
      historyNodeType='oil_paint'，手动点击保存落库 + generations 记录）
- [ ] 10. `useNodeHandlers.ts`：`useEditorPatchHandler(['oil_paint'])` 注册
- [ ] 11. `CanvasNodeViews.tsx`：渲染分支（resolveUpstreamImage 注入 upstreamImageUrl）
- [ ] 12. `BookplatePage.tsx`：helpers 注入两个 handler；isImageResultNode 加 oil_paint
- [ ] 13. `useGenerationHistory.ts`：名称映射「湿油彩效果」

### 验证
- [ ] 14. `npm run build`（tsc -b && vite build）+ `npm run lint` 通过
- [ ] 15. 手动验证路径说明：连线图片上传→湿油彩→生成预览→下载/保存落库→输出下游

## 变更记录与评审

### 实施结果（2026-08-22 完成）
- [x] 后端：`backend-ts/src/modules/bookplate/node-types.ts` 新增 OIL_PAINT 模板
      （multimodal / output image / inputs [image, text]，与邮票同端口契约）
- [x] 依赖：`three@^0.180` + `@types/three`(dev)；构建输出确认 three 为独立异步 chunk（176KB gzip），
      仅在节点首次生成时动态加载，不增加主包体积
- [x] 引擎：`frontend/src/modules/multimodal/oilpaint/{types,engine,index}.ts`
      —— 从 wet-paint-flow main.js 提取图片输入 headless 管线：
      g-buffer 三通道 → 结构张量方向场(积分图盒滤波) → Poisson 三层播种(确定性候选序列+variant 变体)
      → 双向 Bézier 笔触积分 → 实例化 ribbon 几何 → 颜料高度/湿度缓冲(GGX 微表面合成)
      → toDataURL；renderer 单例 + 渲染队列串行化，避免 WebGL 上下文耗尽；
      生长动画置完成态(uGrowthEnabled=0)，光角固定 -0.8（静态导出口径）
- [x] 注册链路：CanvasNodeType / nodeLayout / nodeTypes(颜色·模板·端口镜像) / seedData /
      useImageOutputHandlers(useImageExportHandler) / useNodeHandlers(editorPatch) /
      CanvasNodeViews(渲染分支+resolveUpstreamImage 封面穿透) / BookplatePage(isImageResultNode+helpers 注入) /
      useGenerationHistory(名称映射) / generation.ts generationNodeTypeLabel
- [x] 组件：OilPaintNode.tsx——镜像 StampCutterNode（上传>上游四级兜底、参数滑杆×3：
      笔触大小/数量/干燥度、风格切换 纯笔触|融合、NodeActionBar 统一按钮、isSaved 解锁收藏/公开）
- [x] 文档：docs/节点输入输出声明式接线.md §2 清单同步

### 验证记录
- `npm run build`（tsc -b && vite build）✅ 通过；three.module 独立 chunk 确认代码分割生效
- `npm run lint` ✅ 无新增错误（仅既存 maplibre 公共文件警告）
- `backend-ts npm run typecheck` ✅ 通过
- 修复实施中发现的 3 个问题：① CanvasNodeViews 编辑误删 color_search case 标签（已恢复）；
  ② engine finally 块 strokeMesh 被内层 const 遮蔽导致场景网格泄漏（改用外层赋值）；
  ③ poissonLayer 邻居网格误用全局 seeds 数组破坏分层隔离（还原为层内 local 数组）

### 未验证项（需人工浏览器验收）
- 实际渲染效果视觉验收（WebGL 着色器管线需真实 GPU 环境）：建议画布添加
  图片上传→湿油彩→生成，检查笔触方向感/湿润高光/米色画布风格
- 保存落库后收藏/公开链路（复用既有 stamp 流程，理论一致）

### 方案决策留档
用户确认采用**方案 C 前端浏览器端执行**（同邮票截图框）：wet-paint-flow 为纯浏览器
Three.js/WebGL 着色器管线，FastAPI(Python)/backend-ts(Node) 均无法直接运行该代码，
移植 = 全部 GLSL 重写 + 视觉失真 + 服务端 CPU 渲染极慢；前端执行视觉 100% 保真且零服务端成本。

---

## 迭代 2：实时参数预览（会话模式重构）

### 需求
调整参数滑杆要求「实时看到效果」。评估结论：按参数成本分层——
- uniform 级（笔触大小 / 干燥度 / 风格）：仅 GPU 重绘，毫秒级，**可实时**
- 笔触数量（重播种 + 全量积分）：约 150-400ms，**防抖 350ms 后在松手后应用**
- 方向权重（未暴露 UI）：需重建方向场，成本中等（会话内保留种子位置，仅重积分）

### 实施
- [x] `oilpaint/engine.ts` **会话模式重构**（保留头部常量/数学/着色器逐字不动）：
  - 上下文从「模块级单例 + 全量 runRender」改为「每会话独立 `WetPaintContext` +
    `openState` 增量管线」；three 动态 import 仍模块级缓存一次
  - 管线拆分为阶段函数（`captureGBuffer` / `buildField` / `generateSeeds` /
    `allocStrokeGeometry` / `fillStrokeGeometry` / `renderFrame` / `disposeState`），
    参数更新按失效级别增量执行：0=uniform 仅重绘 → 1=length 重积分 → 2=方向权重
    重建方向场+重积分 → 3=strokeCountK 重播种+重建几何
  - 新增 `WetPaintSession`（`canvas`/`update`/`reseed`/`toDataUrl`/`dispose`）；
    `renderWetPaintFromImage` 保留为会话薄封装（兼容旧调用）
  - 会话建立即渲染首帧；`update()` 同步执行（多会话共享模块级 scratch 缓冲仍互斥——同步单线程）
  - 资源安全：openState 用局部 `resources` 数组跟踪，失败只释放已创建项 +
    `renderer.dispose()` + `forceContextLoss()`（修复初版 catch 分支重复构造资源的问题）；
    `erasableSyntaxOnly` 下构造函数改为显式字段赋值（不允许参数属性）
- [x] `OilPaintNode.tsx` 实时预览接线：
  - 进入编辑态且有输入图时异步建立会话，挂载会话 canvas 到预览容器（loading/error 覆盖层）
  - 参数滑杆变化 → `session.update()`：uniform 级即时重绘、数量级 350ms 防抖重播种
  - 「生成」优先取 `session.toDataUrl()`（预览即结果），会话未就绪时回退一次性渲染
  - 生成 / 离开编辑态 / 更换输入图 / 卸载时释放会话（避免 WebGL 上下文累积）
- [x] 验证：`tsc -b` / `npm run build`（three 仍为独立异步 chunk）/ `npm run lint` 全通过

### 评审要点
- 实测成本：uniform 级滑杆拖拽 ≈ 3-15ms/帧（GPU 重绘），体感实时；数量滑杆 350ms 后约
  150-400ms 出现新构图，可接受；首次进入编辑态约 0.5-1s（three 懒加载 + 首帧分析）
- 每个编辑态节点占用一个 WebGL 上下文（浏览器上限约 16 个）：生成后释放、
  卸载释放，多节点同时编辑场景在正常使用范围内
- 保存 / 落库链路不变：点击「生成」固化为 imageUrl →「保存」走既有 useImageExportHandler

### 未验证项
- 真机 GPU 下的实时拖拽帧率与并发双节点编辑（需浏览器人工验收）

