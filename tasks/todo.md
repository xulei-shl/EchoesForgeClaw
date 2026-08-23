# 贴纸制作节点（sticker_maker）实施跟踪

> 方案：纯前端移植 sticker-forge（Transformers.js U²-Net 浏览器抠图 + Canvas 距离变换 die-cut 描边），服务器零计算负担、零新增端点。

## 任务清单

- [x] 1. 复制模型资产到 `frontend/public/models/BritishWerewolf/U-2-Netp/`（onnx 4.5MB + LICENSE + SOURCE.md）
- [x] 2. `frontend/package.json` 添加 `@huggingface/transformers@^4.2.0` 并安装
- [x] 3. 新建 `frontend/src/modules/multimodal/sticker/` 引擎模块
  - [x] `types.ts`（StickerMakerState / RenderOptions）
  - [x] `bgRemoval.worker.ts`（U²-Net 推理 + matte 清理，移植自 services/sticker-forge/workers/background-removal.worker.ts）
  - [x] `backgroundRemoval.ts`（Worker 客户端：队列/进度/单次重试）
  - [x] `stickerEngine.ts`（距离变换白边描边 + 投影 + PNG 导出，移植自 lib/source.ts）
  - [x] `downloadSticker.ts`
- [x] 4. 新建 `components/StickerMakerNode.tsx`（对齐 StampCutterNode UX 骨架）
- [x] 5. 接线注册
  - [x] backend-ts/src/modules/bookplate/node-types.ts（常量 + 模板声明）
  - [x] frontend/src/platform/types/index.ts（CanvasNodeType）
  - [x] frontend/src/modules/bookplate/nodeTypes.ts（NODE_COLORS / NODE_TEMPLATES / NODE_PORT_TYPES）
  - [x] frontend/src/modules/bookplate/nodeLayout.ts（NodeType 联合 / NODE_SIZES）
  - [x] frontend/src/modules/bookplate/seedData.ts（seedDataFor 分支）
  - [x] frontend/src/modules/bookplate/CanvasNodeViews.tsx（渲染分支 + NodeViewHelpers 接口）
  - [x] frontend/src/modules/bookplate/useNodeHandlers.ts（editorPatch handler ×2 处注册/导出）
  - [x] frontend/src/modules/bookplate/useImageOutputHandlers.ts（导出落盘 handler + 接口 + useNodeHandlers 解构）
  - [x] useGenerationHistory.ts(×2) + platform/utils/generation.ts（标签）+ routes/BookplatePage.tsx（图片操作栏类型列表 + helpers 透传 ×2 处）
- [x] 6. 验证：构建 + lint + 测试（见下）

## 关键决策记录

| 决策 | 结论 |
|---|---|
| 实现形态 | 前端移植（参考项目无后端 ML；FastAPI/Node 推理不成比例） |
| 抠图 | Transformers.js Web Worker，模型同源托管 `/models/`，matte 0.12/0.78 smoothstep 清理 |
| 贴纸渲染 | 纯 Canvas（distanceTransform1D + expandAlpha 白边 + shadow 合成），无 WebGL |
| 样式范围 | 基础款：白边宽度/颜色 + 投影开关；不含手动精修与 3D 剥离 |
| 抠图入口 | 节点内置步骤（生成管线第一步，带模型下载进度浮层） |
| 后端改动 | 仅 node-types.ts 端口声明注册；save-image/generations 复用既有端点 |

## 验证记录

| 检查 | 结果 |
|---|---|
| `npm run build`（frontend：tsc -b && vite build） | ✅ 通过 |
| `npm run lint`（oxlint，新增 sticker 相关文件） | ✅ 0 问题（既有 vendor 警告与本变更无关） |
| `npm run typecheck`（backend-ts） | ✅ 通过 |
| `npm test`（backend-ts vitest） | ✅ 8 文件 87 用例全过 |
| Worker 分包 | ✅ transformers+ORT 隔离在独立 chunk `bgRemoval.worker-*.js`（约 503KB，仅点击「移除背景」时加载，主包零增量）；模型 4.5MB 同源托管 |

## 评审记录

- 与邮票截图框的链路一致性：输入优先级（本地上传 > 上游图片）、编辑/成品两态、右下角悬浮重编辑、
  NodeActionBar 两态按钮组（生成/上传/清空 ‖ 重调/上传/清空/保存落库/收藏/公开/下载/重置）、
  hasDownstream 全守卫、保存落库走 useImageExportHandler（/save-image + generations 记录）——逐项对齐。
- 未验证项（需运行时人工确认）：真实图片的完整生成链路（含首次模型下载）、保存落库后收藏/公开、
  下游连线消费。建议启动前后端后在画板中按上述链路走查一遍。
- 残留风险：
  1. ORT wasm 运行时二进制默认从 jsDelivr CDN 加载（约 1~6MB，浏览器缓存一次）——与参考项目
     生产口径一致；若需完全离线可后续把 onnxruntime-web dist 复制进 public 并设 `wasm.wasmPaths`；
  2. 无 COOP/COEP 隔离头的部署环境下 ORT 自动回退单线程，U²-Netp 320×320 输入约 1~3s（现代设备 <2s），
     进度浮层已兜底；
  3. 源图为不透明 JPEG 时未开抠图会沿矩形轮廓生成白边（与参考项目语义一致，属预期行为）。
