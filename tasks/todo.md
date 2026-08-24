# 结果图点击全屏（react-photo-view）— 四节点补齐

> 需求：手账制作 / 图书小票 / 图书卡片 / 图片处理 的最终结果图片，支持与「艺术地图生成」一致的点击全屏查看。
>
> 结论：全屏能力来自第三方库 `react-photo-view` v1.2.7（非项目自研组件），已在 15+ 处以统一模式复用
> （`PhotoProvider maskOpacity={0.8} bannerVisible={false}` + `PhotoView` 包 `<img>`），直接照搬即可。
>
> 用户决策：小票/卡片采用方案 A（卡片点击预览区放大；小票加「查看大图」浮钮）；文字编辑后旧 PNG 不失效（接受陈旧）。

## 任务清单

- [x] 1. 图片处理 `ImageProcessNode.tsx`：结果态 img 包 PhotoView（仅包 img，「调整参数」浮钮保持可点），去掉 pointer-events-none 加 cursor-zoom-in
- [x] 2. 手账制作 `JournalMakerNode.tsx`：结果态 img 同上处理
- [x] 3. 图书卡片 `BookCardNode.tsx`：有 imageUrl 时把整个预览区（iframe 非交互，安全）包进 PhotoView，容器加 cursor-zoom-in
- [x] 4. 图书小票 `ReceiptPrinterNode.tsx`：预览区右上角加「查看大图」浮钮（Maximize2 图标，作为 PhotoView 子元素天然触发全屏），滚动容器外包 relative 定位壳防浮钮随内容滚走
- [x] 5. 验证：frontend lint + build

## 关键决策记录

| 决策 | 结论 |
|---|---|
| 复用方式 | 直接使用 react-photo-view 原模式，不新造公共组件、不重构既有 15+ 用法 |
| 图片处理结果态 | 只包 img 本身，避免劫持悬浮「调整参数」按钮的点击 |
| 图书卡片 | 预览 iframe 为 pointerEvents:none，整块包安全；条件渲染避免 PhotoView src 为空 |
| 图书小票 | 纸面就地编辑含大量 input/textarea 不能整块包 → 浮钮即触发器 |
| 陈旧风险 | 文字编辑不清空 imageUrl（现状语义，收藏/公开按钮依赖），点击展示最近一次生成的 PNG |

## 验证记录

| 检查 | 结果 |
|---|---|
| frontend `npm run lint`（oxlint） | ✅ EXIT=0，无错误；warning 均为既有问题（public/maplibre 打包产物噪音 + BookCardNode 既有 exhaustive-deps，非本次改动行） |
| frontend `npm run build`（tsc -b + vite build） | ✅ 通过（chunk >1MB 警告为既有现象） |
| 浏览器交互验证 | ⚠️ 本环境无法启动浏览器，点击放大 / 浮钮位置需画板实际操作确认 |

## 遗留与风险

- 湿油彩 / 文本成图 / 贴纸 / 邮票裁切等同类结果态 img 也无全屏（用户未要求，未改动）。
