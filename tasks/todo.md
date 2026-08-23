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

---

# 图片处理节点（image_process）实施规划 · 第一阶段：噪点

## 方案决策
- **前端浏览器端 Canvas 执行**（同湿油彩/邮票模式）：噪点为纯像素级变换，Canvas API 毫秒级完成，
  零服务端成本；保存链路复用既有 `/save-image` + `generations`（useImageExportHandler 工厂）。
- **多效果架构参照「图书小票生成」多模板模式**（用户指定参考）：效果注册表 Map +
  getAll/get（未知 id 兜底首个，同 getReceiptTemplate 口径）+ register 扩展机制；
  每个效果一个声明式定义（参数 schema + render 函数），UI 按注册表自动渲染。
- **多效果切换语义**：
  - 参数按效果分桶存储（`data.fxParams[effectId]`），切换效果互不覆盖、切回恢复各自参数；
  - **切换效果 = 旧结果立即失效**（`switchFxEffectPatch` 清空 imageUrl/isSaved 回编辑态）——
    保证下游读到的 `data.imageUrl` 与 db 记录始终对应「当前所选效果」；
  - hasDownstream 门禁与湿油彩一致（影响输出的操作全部禁用）。
- **输入优先级**：本地上传 uploadedImage > 上级图片/封面穿透（复用 `resolveUpstreamImage`）。
- **算法**：移植 Grainy-image-main（MIT）canvas 方法——`(Math.random()-0.5)*intensity*255`
  加到 RGB；扩展颗粒大小（g×g 块共享噪声）与单色/彩色两档。

## 任务清单

### 后端
- [x] 1. `backend-ts/src/modules/bookplate/node-types.ts`：`IMAGE_PROCESS: 'image_process'`
      + NODE_TEMPLATES 条目（category='multimodal', output_type='image', input_types=['image','text']）

### 效果引擎模块
- [x] 2. 新建 `frontend/src/modules/multimodal/imageprocess/`：
      - `types.ts`：ImageFxEffectDef（id/name/params 声明/render）、GrainFxParams、ImageProcessState
      - `shared.ts`：fxLoadImage / fxDrawingCanvas / fxDefaultParams（预览与导出共用）
      - `effects/grain.ts`：噪点效果（强度 0-1 默认 0.3 / 颗粒 1-8px / 单色|彩色）
      - `effects/registry.ts`：imageFxRegistry Map + getAll/get/register + defaultFxParamsOf
      - `state.ts`：resolveFxParams（参数读取兜底）+ switchFxEffectPatch（切换补丁）
      - `index.ts`：re-export + applyImageFx 统一渲染分发

### 前端注册链路（按 docs/节点输入输出声明式接线.md §3.1）
- [x] 3. `platform/types/index.ts`：CanvasNodeType 加 `'image_process'`
- [x] 4. `modules/bookplate/nodeLayout.ts`：NodeType 联合 + NODE_SIZES（440×560）
- [x] 5. `modules/bookplate/nodeTypes.ts`：NODE_TEMPLATES / NODE_COLORS / NODE_PORT_TYPES
- [x] 6. `modules/multimodal/components/ImageProcessNode.tsx`：
      编辑态（效果下拉 + 声明式参数控件 + 实时预览防抖 150ms）/ 结果态双态；
      NodeActionBar 统一按钮组逐一对齐湿油彩（生成/上传/清空/重新调整/保存落库/收藏/公开/下载/重置 + 外链）
- [x] 7. `seedData.ts`：image_process 初始 data 分支
- [x] 8. `useImageOutputHandlers.ts`：handleExportImageProcessFor（historyNodeType='image_process'，
      promptOf=`图片处理 · ${effectName}`，记录可追溯所选效果）
- [x] 9. `useNodeHandlers.ts`：`useEditorPatchHandler(['image_process'])` 注册 + 返回两个 handler
- [x] 10. `CanvasNodeViews.tsx`：渲染分支（resolveUpstreamImage 注入 upstreamImageUrl）
- [x] 11. `BookplatePage.tsx`：isImageResultNode + handlers 注入两处
- [x] 12. `useGenerationHistory.ts`（promptText 分支 + stage2 条件）+
      `platform/utils/generation.ts` generationNodeTypeLabel：名称映射「图片处理」
- [x] 13. 文档 `docs/节点输入输出声明式接线.md` §2 清单表行 + 多效果架构说明段

### 验证
- [x] 14. frontend `npm run build`（tsc -b && vite build）✅ + backend-ts `npm run typecheck` ✅；
      lint 无新增错误（既存 maplibre/useGenerationHistory 警告经 stash 对照确认为历史遗留）
- [ ] 15. 手动验证路径（需浏览器人工验收）：连线图片上传→图片处理→调参数实时预览→生成→
      下载/保存落库→输出下游（图片分析/图像生成/邮票）；切换效果后确认旧结果失效、
      下游与 db 记录只对应新效果

## 变更记录与评审（2026-08-22 完成）

### 实施结果
- 后端：IMAGE_PROCESS 常量 + NODE_TEMPLATES 条目（与湿油彩同端口契约：output image /
  inputs [image, text]，端口类型自动接入 collectNodeInputs 图片分组，零收集代码改动）
- 效果引擎：registry Map 驱动（对齐 receipt templates.ts）；噪点算法逐字移植 canvas 方法，
  grainSize=1 时与源项目行为一致；Uint8ClampedArray 自动钳制溢出；参数 default 字段为
  单一事实来源（fxDefaultParams 提取默认值表，UI 与兜底共用）
- 组件：双态交互镜像 OilPaintNode；效果下拉 + 参数滑杆按 effect.params 声明自动渲染
  （滑杆每行两个、分段独占一行），后续新增效果 = 一个 effect 文件 + registry 一行，UI 零改动
- 输出/保存链路：imageUrl 约定字段 → nodeOutputImages 自动被下游读取；保存走
  useImageExportHandler（/save-image 落盘 + generations 记录 + 收藏/公开解锁），与湿油彩一致
- 自查修复：① 预览重试改 previewNonce 触发（避免把垃圾 key 写进持久化参数桶）；
  ② handleSaveToDatabase 显式构造 state 并把 data 加入依赖（消除旧闭包字段回写风险）

### 未验证项（需人工浏览器验收）
- 实际噪点视觉效果与实时预览流畅度（Canvas 渲染需真实环境）
- 跨域图书封面作为输入时 Canvas taint 的报错提示路径（预期显示错误文案 + 重试按钮）
- 保存落库后收藏/公开链路（复用既有 stamp/oil_paint 流程，理论一致）

### 追加（2026-08-22）
- [x] 新增效果接入指南：`docs/多模态工具/图片处理/图片处理节点效果接入指南.md`
      （架构总结 + 新增效果三步接入 + 参数/render 规范 + 禁止事项 + ASCII/网点/抖动算法备忘 +
      验证清单）；接线文档 §2 image_process 段落已加指南入口

---

# 图片处理节点 · 第二阶段：网点（halftone）效果接入

## 方案决策
- **按接入指南三步走**（types.ts 加 id → effects/halftone.ts 新文件 → registry.ts 登记一行 +
  index.ts re-export 一行），节点组件与接线代码零改动。
- **算法参考 img-halftone-main（MIT）**：旋转栅格化 → 单元格均值 = 油墨覆盖率 → 点半径随覆盖率缩放；
  彩色模式 CMYK 分离、四色板按经典印刷网角错开（基准角 ±30°/-45°，默认 45° 时对齐 C15/M75/Y0/K45）
  后 multiply 叠印；输出保持原图尺寸（超出画布自动裁剪），空白补纸色。
- **效率优化（用户授权直接实施更高效逻辑）**：相比参考实现去掉 Web Worker 池与逐像素 JS 循环——
  每通道仅一次旋转栅格化（GPU 光栅化）+ 一趟线性像素扫描累计单元格均值（预生成列映射表消除内层除法），
  全部网点合并单条 Path2D 一次性填充；导出 2048² 单色 ≈ 数十 ms，CMYK 四通道约数百 ms。
- **参数**（default 为单一事实来源）：点距 dotSize(4-24px 默认 8) / 点半径 maxRadius(0.2-1 默认 0.7，
  参考实现口径) / 角度 angle(0-90° 默认 45) / 形状 shape(circle|rect|triangle|hexagon 分段) /
  色彩 mode(mono|cmyk 分段)；近黑区 d<12 回落纯 K 板承载，避免比值噪声放大。

## 任务清单
- [x] 1. `types.ts`：ImageFxId 加 `'halftone'` + HalftoneFxParams 接口
- [x] 2. 新建 `effects/halftone.ts`：参数 schema + renderHalftone（旋转栅格化/单趟扫描/
       Path2D 批量网点/multiply 叠印；taint 抛中文可读错误）
- [x] 3. `effects/registry.ts` 登记一行 + `index.ts` re-export 一行

## 验证记录
- [x] frontend `npm run build` ✅（tsc -b && vite build 通过）
- [x] frontend `npm run lint` ✅ 0 错误（仅既存 maplibre 公共文件警告，未触及新代码）

### 修复（2026-08-22 用户反馈：切换网点后预览空白）
- 根因：renderHalftone 在 fxDrawingCanvas 画好源图后对**同一画布**铺白色纸底，
  再从该画布旋转栅格化采样 —— 源图被白底覆盖，采样全白 → 覆盖率 0 → 纯白输出
- 修复：输出画布与采样源分离（新建独立输出画布铺纸底 + multiply 叠印；
  各通道统一从干净 source 采样），build/lint 复验通过
- 经验已录入 tasks/lessons.md（Canvas 管线采样源与输出目标必须严格分离）

### 端到端验证（2026-08-22 用户疑问「网点是否支持彩色」）
- 方法：vite dev + 无头 Chrome 截图真实模块渲染结果（合成色块/渐变图，
  mono 圆形 45° / CMYK 圆形 / CMYK 方形 15° / 噪点回归 五组对照）
- 结论：单色灰阶网点 ✅、CMYK 彩色分离叠印出红绿黄彩点 ✅、形状/角度正常 ✅、
  单次渲染 40-60ms(maxEdge 512) ✅、噪点无回归 ✅ —— 色彩控件保留，无需修改节点页面
- 说明：CMYK 为印刷油墨叠印口径，蓝色等深色会明显偏暗（青+品红叠印 ≈ (0,0,131)），
  属经典印刷特性而非缺陷；用户此前看到空白应为上一修复前的旧代码

## 未验证项（需人工浏览器验收）
- 实际网点视觉效果：单色 45° 经典网屏观感、CMYK 叠印色彩、四种形状切换、角度旋转方向
- 实时预览流畅度（150ms 防抖下拖动点距/角度滑杆）
- 跨域封面输入时「图片受跨域保护」错误文案 + 重试路径
- 生成/下载/保存落库 prompt 文案 `图片处理 · 网点`、下游读取、hasDownstream 门禁、切换失效语义

---

# 图片处理节点 · 第三阶段：ASCII（ascii）效果接入

## 方案决策
- **前端移植 `effects/ascii.ts`**（用户确认）：参考项目 asciify-engine-main 为 MIT 协议的
  TypeScript 浏览器端 Canvas 引擎——FastAPI(Python) 无法运行 TS/Canvas 代码，重写必失真；
  后端渲染破坏「预览即结果」不变量且引入上传延迟。与 grain/halftone/dither 同模式移植。
- **不直接 npm 引入原库**（用户确认规避）：其 renderer 存在模块级全局缓存（WeakMap/Memo Map）
  与 `isDarkMode()` DOM 探测（宿主页面主题影响输出底色/字色），违反接入指南 §4/§5 render
  纯函数要求，会造成预览与导出不一致；移植时以固定底色替代主题探测。
- **算法要点**：源图按单元格网格块均值采样（超采样保细节）→ 亮度 →「由疏到密」字符梯度
  映射（`floor(norm×(len-1))`，与原库逐字一致）；charAspect=0.55 校正等宽字符宽高比防变形；
  输出画布独立于采样源（吸取网点教训：采样源/输出目标严格分离）；无随机数、无全局状态。
- **参数**（default 为单一事实来源）：列数 cols(40-240 默认 120) /
  字符集 charset(standard|blocks|dots|katakana 分段) / 配色 colorMode(dark|light|matrix|color 分段) /
  反转 invert(normal|inverted 分段)；配色固定底色：黑 #0a0a0a / 白 #faf9f7 / 绿底 #050505。

## 任务清单
- [ ] 1. `tasks/todo.md` 写入规划（本节）
- [ ] 2. `types.ts`：ImageFxId 加 `'ascii'` + AsciiFxParams 接口
- [ ] 3. 新建 `effects/ascii.ts`：参数 schema + renderAscii（块均值采样 / 字符梯度映射 /
       固定底色 fillText 绘制；taint 抛中文可读错误）
- [ ] 4. `effects/registry.ts` 登记一行 + `index.ts` re-export 一行
- [ ] 5. 文档：接入指南头部「已实现效果」状态同步一行

### 验证
- [ ] 6. frontend `npm run build`（tsc -b && vite build）✅ + `npm run lint` ✅
- [ ] 7. 手动验证路径（需浏览器人工验收）：按接入指南 §7 清单逐项



