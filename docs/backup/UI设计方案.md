# BookForge UI 设计方案

> [!NOTE]
> 本文档基于 [design_analysis.md](file:///f:/Github/BookForge/docs/design_analysis.md)、[初始需求.md](file:///f:/Github/BookForge/docs/初始需求.md) 和三张参考图片，按照 DESIGN.md 9 区架构编写。

---

## 方向锁定

### 五维度决策

| 维度 | 决策 |
|------|------|
| **谁在用，什么场景** | 图书爱好者 + 内容创作者，在桌面浏览器上用画布工作流生成藏书票素材。日常使用频率中等（每次 3-5 轮操作），非高频工具 |
| **美学方向** | 纸面文具风（stationery-paper）: 方格纸纹理为画布底色，钢笔线描插画为装饰，虚线边框为结构分隔。不是 "clean and modern"，而是 "精致手作笔记本" |
| **设计签名** | 方格纸画布 + 活页打孔 + 钢笔线描山脉插画装饰。这三者组合构成品牌视觉锚点 |
| **硬约束** | React 18 + Vite + TypeScript + Tailwind CSS; Lucide Icons; streamdown 流式 Markdown; thinking-orbs 思考动效; border-beam 光晕边框 |
| **签名微交互** | 节点框等待时的 border-beam 光晕呼吸效果，以及节点间连线的虚线流动动画 |

### 方向三行摘要

- **视觉论点**: 暖白方格纸文具风，细线网格纹理为底，钢笔线描插画做装饰重音，整体传递手工匠作的文艺气质
- **内容计划**: 画布工作台（导向 -> 展示状态 -> 启用操作），不使用营销结构，无 hero 区域
- **交互论点**: 节点等待时 border-beam 光晕在边框上流动; 节点间连线用虚线 dash-offset 动画模拟墨水流动; thinking-orbs 在 AI 处理时提供视觉反馈

---

## 1. 视觉主题与氛围

**情绪**: 安静、手作、有温度的工坊感。像在一本精装笔记本上做手工，而不是在软件里操作。

**密度**: 中等偏疏。画布区域留白充足，节点框之间保持至少 80px 间距，给方格纸纹理留出呼吸空间。

**设计哲学**: "看得见纸面的工具"。所有界面元素都像是画在方格纸上的，边框用虚线而非实线，分隔用细线而非色块，装饰用线描插画而非照片或图标堆叠。

---

## 2. 色彩系统与角色

采用 OKLCH 色彩空间，暖白纸面为基调，墨色为主文字，少量赭石棕做功能强调。

| 语义名 | OKLCH 值 | Hex 近似 | 角色 |
|--------|----------|----------|------|
| `paper` | `oklch(97% 0.005 80)` | `#F8F6F1` | 主画布/页面背景，微暖纸色 |
| `paper-grid` | `oklch(90% 0.005 80)` | `#E4E1DA` | 方格线颜色 |
| `paper-hole` | `oklch(85% 0.008 80)` | `#D3CFC7` | 活页打孔边缘色 |
| `ink` | `oklch(18% 0.008 80)` | `#2B2926` | 主文字、标题、图标 |
| `ink-light` | `oklch(42% 0.008 80)` | `#6B665E` | 次要文字、说明、占位文本 |
| `ink-faint` | `oklch(65% 0.006 80)` | `#A19D96` | 禁用文字、边框 |
| `accent` | `oklch(52% 0.12 55)` | `#A0622B` | 主强调色（赭石棕），用于按钮、链接、活跃状态 |
| `accent-hover` | `oklch(45% 0.12 55)` | `#8A4F1D` | 强调色悬停态 |
| `accent-surface` | `oklch(94% 0.03 55)` | `#F5EDE4` | 强调色背景态（选中、高亮） |
| `node-bg` | `oklch(98.5% 0.003 80)` | `#FCFBF8` | 节点框内部背景（比 paper 略亮） |
| `success` | `oklch(55% 0.12 145)` | `#4A8C5E` | 成功状态（深橄榄绿） |
| `error` | `oklch(50% 0.15 25)` | `#B5463A` | 错误状态（砖红） |
| `warning` | `oklch(65% 0.12 80)` | `#C49B4A` | 警告状态（赭黄） |
| `beam-glow` | `oklch(72% 0.13 55)` | `#D4935A` | 光晕动效颜色（暖金棕） |

### 60-30-10 视觉权重

- **60% 纸面中性色**: `paper` + `paper-grid`，画布背景和页面结构
- **30% 墨色层次**: `ink` + `ink-light` + `ink-faint`，文字、边框、线条
- **10% 赭石强调**: `accent` 系列，按钮、光晕、活跃态

### 中性色调和

所有灰色/中性色向色相 80（暖黄棕）倾斜，chroma 0.005-0.01，保持纸面温度感。禁止使用纯灰（chroma=0）。

---

## 3. 字体排版规则

### 字体栈

```css
/* 正文/UI（可读性优先） */
font-family: "MiSans", "PingFang SC", "Noto Sans SC", sans-serif;

/* 装饰性/标题/品牌（文艺气质） */
font-family: "LXGW WenKai", "Noto Serif SC", "PingFang SC", serif;

/* 代码/等宽 */
font-family: "JetBrains Mono", "Noto Sans Mono", monospace;
```

**选型理由**: 正文和 UI 元素使用小米 MiSans，字形清晰、阅读舒适，适合长文本和界面交互。装饰性元素（页面大标题、品牌名、节点标题、首页 slogan）使用霞鹜文楷，楷书笔形与方格纸文具风高度契合，传递手作气质。两者分工明确: MiSans 负责可读性，文楷负责氛围感。

### 字号阶梯

| 用途 | 字号 | 字重 | 行高 | 字间距 | 字体 |
|------|------|------|------|--------|------|
| 页面标题 (H1) | 28px | 700 | 1.3 | -0.012em | LXGW WenKai |
| 区块标题 (H2) | 22px | 600 | 1.4 | -0.012em | LXGW WenKai |
| 节点标题 (H3) | 18px | 600 | 1.5 | normal | LXGW WenKai |
| 正文 | 15px | 400 | 1.75 | normal | MiSans |
| 辅助文字 | 13px | 400 | 1.6 | normal | MiSans |
| 按钮文字 | 14px | 500 | 1 | 0.02em | MiSans |
| 代码/ISBN | 14px (mono) | 400 | 1.6 | normal | JetBrains Mono |

### CJK 特殊规则

- CJK 正文行高 1.75（高于 Latin 的 1.5），匹配汉字密度
- 不对 CJK 文本施加负 letter-spacing
- 数据表格中的数字使用 `font-variant-numeric: tabular-nums`
- 标题使用 `text-wrap: balance`，正文使用 `text-wrap: pretty`

---

## 4. 组件样式规范

### CSS 策略

**Tailwind CSS only**。所有样式通过 Tailwind 工具类实现，不混用 CSS Modules 或 CSS-in-JS。自定义 token 在 `tailwind.config.ts` 的 `extend` 中定义。

### 按钮

| 状态 | 主按钮 (accent) | 次按钮 (outline) | 幽灵按钮 (ghost) |
|------|-----------------|-------------------|-------------------|
| 默认 | bg: `accent`, 文字: `paper`, radius: 6px | border: 1px `ink-faint`, 文字: `ink`, radius: 6px | 无背景无边框, 文字: `ink-light` |
| Hover | bg: `accent-hover` | bg: `accent-surface` | bg: `paper-grid` (10% 不透明度) |
| Active/Press | `scale(0.96)`, 100ms ease-out | `scale(0.96)` | `scale(0.96)` |
| Disabled | bg: `ink-faint`, 文字: `paper-grid` | border: `paper-grid`, 文字: `ink-faint` | 文字: `ink-faint` |
| Focus | `outline: 2px solid accent, offset 2px` | 同主按钮 | 同主按钮 |

- 图标按钮最小 40x40px 命中区域
- 带图标的按钮，图标侧 padding 比文字侧少 2px

### 节点框（画布核心组件）

```
+-- 节点标题栏 ---------------------+
|  [阶段图标] 第N阶段: 标题   [状态] |
+------------------------------------+
|                                    |
|            内容区域                 |
|     (由模块定义的渲染组件填充)      |
|                                    |
+------------------------------------+
|  [操作按钮1]  [操作按钮2]  [按钮3] |
+------------------------------------+
```

| 属性 | 值 |
|------|-----|
| 背景 | `node-bg` |
| 边框 | 1px dashed `paper-grid`（默认），border-beam 光晕（等待态） |
| 圆角 | 8px |
| 阴影 | `0 2px 8px rgba(43,41,38,0.06)` |
| 标题栏 | 底部 1px dashed `paper-grid` 分隔 |
| 操作栏 | 顶部 1px dashed `paper-grid` 分隔，按钮用幽灵样式 |
| 最小宽度 | 320px |
| 最大宽度 | 480px |
| 拖动 | 标题栏区域触发，`cursor: grab` / `cursor: grabbing` |

**状态变体**:

| 节点状态 | 视觉表现 |
|----------|----------|
| 空闲 | 默认虚线边框 |
| 等待中 | border-beam 光晕动效 + thinking-orbs 在内容区 |
| 完成 | 虚线边框变 `success`（1px dashed），左上角小圆点 `success` |
| 错误 | 虚线边框变 `error`（1px dashed），内容区显示错误信息 |

### 节点间连线

- SVG 路径，1px dashed `ink-faint`
- 连接锚点: 上一节点底部中心 -> 下一节点顶部中心
- 等待态: `stroke-dashoffset` 动画，模拟墨水流动方向（速度 40px/s）
- 完成态: 虚线变实线 1px `ink-light`

### 输入框（底部对话输入）

| 属性 | 值 |
|------|-----|
| 背景 | `node-bg` |
| 边框 | 1px dashed `paper-grid`，聚焦态 1px solid `accent` |
| 圆角 | 8px |
| 高度 | 48px |
| 文字 | `ink`，placeholder `ink-faint` |
| 发送按钮 | 右侧内嵌，主按钮样式 |
| 禁用态 | 背景 `paper-grid`（10%），输入不可用，placeholder 显示 "流程进行中..." |

### 导航栏

**顶部导航**（首页/登录页）:
- 通栏，高度 56px
- 背景 `paper` + 底部 1px dashed `paper-grid`
- Logo 左侧，导航链接居中，用户操作右侧
- 导航链接: 默认 `ink-light`，hover `ink`，active `accent` + 底部 2px solid `accent`

**悬浮导航**（画布页面）:
- 顶部居中，fixed，背景 `paper` + 1px dashed `paper-grid` 全边框 + 微阴影
- 圆角 8px，内部 padding 4px 8px
- 工具按钮组，图标式排列

### 卡片（历史/收藏/公开列表）

| 属性 | 值 |
|------|-----|
| 背景 | `node-bg` |
| 边框 | 1px dashed `paper-grid` |
| 圆角 | 6px |
| Hover | 边框变 `ink-faint`，微弱阴影增加 |
| 内部布局 | 左侧缩略图（固定 80x80px），右侧元数据文字 |
| 操作按钮 | 行尾右对齐，幽灵按钮样式 |

### 详情面板（右侧滑出）

| 属性 | 值 |
|------|-----|
| 宽度 | 420px |
| 背景 | `paper` |
| 左边框 | 1px dashed `paper-grid` |
| 进入动画 | `translateX(100%) -> 0`，200ms ease-out |
| 退出动画 | `translateX(0) -> 100%`，150ms ease-in |
| 遮罩 | 左侧区域 `rgba(43,41,38,0.08)` |

### 管理后台表单

- 输入框: 与对话输入框同风格
- 表格: 无外边框，行间 1px dashed `paper-grid` 分隔
- 标签页: 底部线型，active 态 `accent` 下划线

---

## 5. 布局原则

### 间距阶梯

基于 4px 基础单位:

| Token | 值 | 用途 |
|-------|-----|------|
| `space-1` | 4px | 图标与文字间距 |
| `space-2` | 8px | 紧凑元素间距 |
| `space-3` | 12px | 按钮内 padding |
| `space-4` | 16px | 卡片内 padding、列表项间距 |
| `space-5` | 24px | 区块内部间距 |
| `space-6` | 32px | 区块之间间距 |
| `space-8` | 48px | 页面大区块间距 |
| `space-10` | 64px | 页面级留白 |

### 页面布局

**首页/登录页**:
- 全屏布局，顶部导航 + 主内容区
- 主内容区居中，max-width 1200px
- 首页: 中央大标题 + 简介 + CTA，底部山脉线描插画装饰（占视口底部约 30%）
- 登录页: 中央登录卡片（max-width 400px），背景与首页相同

**画布页面**:
- 全屏画布，100vw x 100vh
- 悬浮导航栏: 顶部居中
- 对话输入框: 底部居中，max-width 600px
- 操作按钮组: 右侧垂直居中
- 使用说明: 右下角折叠面板
- 画布可无限平移和缩放（CSS transform）

**列表页面（历史/收藏/公开）**:
- 侧边导航（与顶部导航共存）或标签页切换
- 主内容区 max-width 960px
- 列表 + 右侧详情面板（点击展开）

**管理后台**:
- 左侧固定侧边栏 240px + 右侧内容区
- 内容区 max-width 800px，居中

### 方格纸背景实现

```css
/* 方格纸网格 */
background-image:
  linear-gradient(var(--paper-grid) 1px, transparent 1px),
  linear-gradient(90deg, var(--paper-grid) 1px, transparent 1px);
background-size: 24px 24px;
background-color: var(--paper);
```

### 活页打孔效果

画布左侧边缘，垂直排列的圆形打孔（直径 12px，间距 48px），颜色 `paper-hole`，用 CSS `radial-gradient` 或 SVG 实现。仅在画布页面出现。

---

## 6. 深度与层级

不使用传统卡片阴影堆叠。深度通过 **虚线边框 + 背景色微阶梯** 传达。

| 层级 | 背景 | 边框 | 阴影 | 用途 |
|------|------|------|------|------|
| 画布底层 | `paper` + 方格纸纹理 | 无 | 无 | 页面/画布背景 |
| 内容面板 | `node-bg` | 1px dashed `paper-grid` | `0 2px 8px rgba(43,41,38,0.06)` | 节点框、卡片、输入框 |
| 悬浮元素 | `paper` | 1px dashed `paper-grid` | `0 4px 16px rgba(43,41,38,0.10)` | 悬浮导航、下拉菜单、tooltip |
| 遮罩层 | `rgba(43,41,38,0.08)` | 无 | 无 | 详情面板遮罩、模态遮罩 |

**核心原则**: 虚线边框（dashed）是本项目的深度语言，替代实线边框和重阴影。这与方格纸笔记本风格一致。

---

## 7. Do's and Don'ts

### Do

- 所有分隔线用 dashed，不用 solid（边框、分割线、网格线统一虚线语言）
- 装饰元素用线描插画风格（黑白钢笔画），不用照片或渐变色块
- 动效克制: 只在等待态（光晕、思考球）和转场（面板滑出）使用动画
- 中文文本留足行高（1.75），配合文楷字体的笔画舒展
- 节点框保持统一宽度范围（320-480px），内容自适应高度
- 按钮在 press 时有 `scale(0.96)` 反馈
- 所有交互元素有 `focus-visible` 轮廓
- 颜色保持暖色调（色相 55-80 区间），远离冷灰

### Don't

- 不使用 glassmorphism、模糊背景、磨砂效果
- 不使用渐变色文字、渐变色背景
- 不使用圆角大于 12px 的元素（药丸形按钮例外，用于标签）
- 不使用实线粗边框（>1px solid）作为装饰
- 不使用纯黑 `#000000` 或纯白 `#FFFFFF`，始终带暖色调偏移
- 不使用紫色、蓝色、青色作为强调色
- 不在高频操作（键盘触发、快捷键）上添加动画
- 不使用 `transition: all`
- 不使用通用无衬线字体（Inter、DM Sans 等）作为主字体
- 不使用模态弹窗处理普通溢出内容（用行内展开或侧面板）

---

## 8. 响应式行为

| 断点 | 宽度 | 行为 |
|------|------|------|
| Desktop | >=1280px | 完整布局，画布全特性 |
| Tablet | 768-1279px | 画布保持，节点框 max-width 缩至 380px，侧面板覆盖全屏 |
| Mobile | <768px | 画布切换为垂直列表模式（节点纵向堆叠，不支持自由拖动），详情面板全屏 |

### 导航折叠

- >=768px: 完整文字导航
- <768px: 汉堡菜单，侧边抽屉展开

### 触控适配

- 所有交互目标最小 40x40px
- Hover 效果包裹在 `@media(hover:hover)` 内
- 画布触控: 单指拖动平移，双指捏合缩放，长按节点激活拖动
- `touch-action: manipulation` 全局应用

---

## 9. Agent Prompt Guide

### 快速颜色参考

```
paper:          oklch(97% 0.005 80)   -> #F8F6F1
paper-grid:     oklch(90% 0.005 80)   -> #E4E1DA
ink:            oklch(18% 0.008 80)   -> #2B2926
ink-light:      oklch(42% 0.008 80)   -> #6B665E
ink-faint:      oklch(65% 0.006 80)   -> #A19D96
accent:         oklch(52% 0.12 55)    -> #A0622B
accent-hover:   oklch(45% 0.12 55)    -> #8A4F1D
accent-surface: oklch(94% 0.03 55)    -> #F5EDE4
node-bg:        oklch(98.5% 0.003 80) -> #FCFBF8
success:        oklch(55% 0.12 145)   -> #4A8C5E
error:          oklch(50% 0.15 25)    -> #B5463A
beam-glow:      oklch(72% 0.13 55)    -> #D4935A
```

### 组件 Prompt 示例

**1. 画布节点框**

> 在 `paper`(#F8F6F1) 方格纸背景上创建节点框。背景 `node-bg`(#FCFBF8)，边框 1px dashed `paper-grid`(#E4E1DA)，圆角 8px，阴影 `0 2px 8px rgba(43,41,38,0.06)`。标题栏高 40px，内含 Lucide 图标 + 标题文字（LXGW WenKai, 16px, 600, `ink` #2B2926），底部 1px dashed 分隔。操作栏高 40px，顶部 1px dashed 分隔，内含幽灵按钮（14px, 500, `ink-light` #6B665E, hover 背景 rgba(228,225,218,0.3)）。等待态: 用 border-beam 光晕，颜色 `beam-glow`(#D4935A)。

**2. ISBN 输入框**

> 底部居中，max-width 600px。背景 `node-bg`(#FCFBF8)，高度 48px，圆角 8px，边框 1px dashed `paper-grid`(#E4E1DA)，聚焦态边框 1px solid `accent`(#A0622B)。文字 15px 400 `ink`(#2B2926)，placeholder `ink-faint`(#A19D96)。右侧发送按钮: 背景 `accent`(#A0622B)，文字 `paper`(#F8F6F1)，圆角 6px，press 时 scale(0.96) 100ms ease-out。

**3. 首页底部山脉装饰**

> 页面底部固定，宽度 100vw，高度约 30vh。使用黑白钢笔线描山脉插画（参考 backpic.jpg），从底部边缘升起。插画上方渐变过渡到 `paper`(#F8F6F1) 背景。插画使用 `ink-faint`(#A19D96) 到 `ink`(#2B2926) 的灰度范围，保持线描质感。

**4. 登录卡片**

> 居中，max-width 400px。背景 `node-bg`(#FCFBF8)，圆角 8px，边框 1px dashed `paper-grid`(#E4E1DA)，阴影 `0 4px 16px rgba(43,41,38,0.10)`。标题 "登录" LXGW WenKai 22px 600 `ink`(#2B2926)，输入框同 ISBN 输入框风格，登录按钮用主按钮样式（width 100%）。

**5. 列表卡片行**

> 全宽，高度 auto，padding 16px。底部 1px dashed `paper-grid`(#E4E1DA) 分隔。左侧缩略图 80x80px 圆角 4px + `outline: 1px solid rgba(43,41,38,0.08); outline-offset: -1px`。右侧: 标题 16px 600 `ink`(#2B2926)，元数据 13px 400 `ink-light`(#6B665E)。Hover 背景 `accent-surface`(#F5EDE4)。操作按钮右对齐，幽灵样式。

---

## 页面清单与视觉要点

| 页面 | 核心视觉元素 | 特殊交互 |
|------|-------------|----------|
| 登录页 | 方格纸背景 + 中央登录卡片 + 底部山脉插画 | 无 |
| 首页 | 方格纸背景 + 品牌标题 + 底部山脉插画 + 导航栏 | 山脉插画微视差滚动（可选） |
| 藏书票画布 | 方格纸背景 + 活页打孔 + 节点框 + 连线 + 悬浮导航 + 底部输入框 | border-beam 光晕、连线 dash 动画、thinking-orbs、节点拖动 |
| 历史列表 | 标准列表 + 右侧详情面板 | 面板滑出动画 |
| 收藏列表 | 同历史列表 | 同上 |
| 公开列表 | 同历史列表 | 同上 |
| 管理后台 | 左侧边栏 + 右侧表单/表格 | 标签页切换 |

---

## 圆角阶梯

| Token | 值 | 用途 |
|-------|-----|------|
| `radius-sm` | 4px | 缩略图、小标签 |
| `radius-md` | 6px | 按钮、输入框 |
| `radius-lg` | 8px | 节点框、卡片、面板 |
| `radius-pill` | 9999px | 标签徽章 |

---

## 第三方组件集成规范

| 组件 | 包名 | 集成要点 |
|------|------|---------|
| 流式 Markdown | `streamdown` + `@streamdown/cjk` | 容器背景 `node-bg`，代码块圆角 `radius-md`，文字继承 LXGW WenKai |
| 思考动效 | `thinking-orbs` | 颜色映射到 `beam-glow`(#D4935A)，置于节点框内容区中央 |
| 光晕边框 | `border-beam` | 颜色 `beam-glow`(#D4935A)，沿节点框虚线边框运行 |
| 图标 | Lucide Icons | 默认 size 18px，stroke-width 1.5，颜色继承文字色 |

---

## 已确认决策

| # | 问题 | 决策 |
|---|------|------|
| 1 | 字体 | 正文/UI 用 MiSans（可读性优先），装饰性标题用霞鹜文楷（氛围感） |
| 2 | 图标 | Lucide Icons |
| 3 | 暗色模式 | 不需要，仅浅色纸面模式 |
| 4 | 山脉插画 | 直接使用 [backpic.jpg](file:///f:/Github/BookForge/docs/backpic.jpg) |
