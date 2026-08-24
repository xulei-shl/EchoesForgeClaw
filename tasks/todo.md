# 文本成图节点（text_image）— 从手账制作独立文本样式功能

> 需求：把 JournalMakerNode 的自由文字排版能力独立为新节点「文本成图」。输入文字内容后可调整
> 字体 / 字号 / 颜色 / 横竖排 / 描边及其颜色 / 背景及其颜色（背景默认无=透明），
> 点击生成后浏览器端渲染为 PNG 写入 `data.imageUrl`，供下级图片消费节点作为输入。
>
> 方案要点：
> - 类型名 `text_image`（`text` 已被既有文本节点占用），中文名「文本成图」，multimodal 类别；
> - `output_type: 'image'`、`input_types: []`（手动输入，同 image_upload 口径）；
> - **预览与导出共用同一 render**（image_process 已验证的模式）：1080×1080 Canvas 实时绘制，
>   生成即全分辨率导出 dataURL —— 天然所见即所得，规避双轨渲染不一致（lessons #4）；
> - 复用手账字体基建（JOURNAL_FONTS / loadFontFamily / JOURNAL_TEXT_COLORS），不复制代码；
> - 生成 → 保存落库 → 收藏/公开链路走 useImageExportHandler 工厂一行配置（与手账完全一致）。

## 任务清单

- [x] 1. 引擎模块 `frontend/src/modules/multimodal/textimage/`（types.ts + engine.ts + index.ts）
- [x] 2. 组件 `frontend/src/modules/multimodal/components/TextImageNode.tsx`
- [x] 3. 后端模板 `backend-ts/src/modules/bookplate/node-types.ts`（TEXT_IMAGE 常量 + 模板条目）
- [x] 4. 前端注册四处：platform/types CanvasNodeType、nodeTypes（颜色/模板/端口）、nodeLayout 尺寸
- [x] 5. seedData.ts 默认数据分支
- [x] 6. handler 接线：useImageOutputHandlers 导出工厂 + useNodeHandlers editor patch + BookplatePage 两处透传 + isImageResultNode 列表
- [x] 7. CanvasNodeViews.tsx 渲染分支
- [x] 8. 历史记录：useGenerationHistory 两处 + generation.ts 中文标签
- [x] 9. 文档更新 docs/节点输入输出声明式接线.md（§2 表格行 + 注记）
- [x] 10. 验证：backend-ts typecheck、frontend build + lint

## 关键决策记录

| 决策 | 结论 |
|---|---|
| 画布 | 固定 1080×1080 正方形，文字居中；不做比例预设（未要求，避免过度设计） |
| 预览 | 直接渲染真 Canvas（CSS 缩放显示），透明底以棋盘格衬托 |
| 描边 | 开关 + 颜色 + 宽度滑杆（默认关）；strokeText 先于 fillText |
| 背景 | 开关 + 颜色（默认关 = PNG 透明通道） |
| 竖排 | 复刻 drawText.ts 算法：按行分列、列右→左、列内字上→下 |
| 输出约定 | `data.imageUrl`（nodeOutputImages 自动识别，下游零改动接入） |

## 验证记录

| 检查 | 结果 |
|---|---|
| backend-ts `npm run typecheck` | ✅ 通过 |
| frontend `npm run build`（tsc -b + vite build） | ✅ 通过（chunk >1MB 警告为既有现象） |
| frontend `npm run lint`（oxlint） | ✅ 无错误；2 条 exhaustive-deps warning 为既有问题（useNodeHandlers:120 / useGenerationHistory:136，非本次改动行） |

## 遗留与风险

- **浏览器视觉验证未做**（本环境无法启动浏览器）：竖排逐字排版 / 描边层级 / 透明底棋盘格显示需在画板实际操作确认（lessons #4：像素级视觉效果必须浏览器验证后再交付）。
- 字号滑杆不做自动适配：超长文字可能超出 1080 画布，需用户自行调小字号（与手账自由排版哲学一致）。

