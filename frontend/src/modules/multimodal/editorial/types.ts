/**
 * 杂志排版模块 (editorial_layout) - 核心类型定义
 * 支持插件化独立模板扩展 (Strategy / Template Plugin Pattern)
 */

import type React from 'react';

export type EditorialPageRatio = '3:4' | '1:1' | '16:9' | '9:16' | '4:5';

export interface PageRatioPreset {
  id: EditorialPageRatio;
  name: string;
  width: number;
  height: number;
  aspectRatio: number;
}

export const EDITORIAL_PAGE_RATIOS: PageRatioPreset[] = [
  { id: '3:4', name: '经典画报 (3:4)', width: 1200, height: 1600, aspectRatio: 3 / 4 },
  { id: '1:1', name: '唱片方版 (1:1)', width: 1400, height: 1400, aspectRatio: 1 },
  { id: '16:9', name: '横屏跨页 (16:9)', width: 1920, height: 1080, aspectRatio: 16 / 9 },
  { id: '9:16', name: '移动全屏 (9:16)', width: 1080, height: 1920, aspectRatio: 9 / 16 },
  { id: '4:5', name: '社媒图文 (4:5)', width: 1200, height: 1500, aspectRatio: 4 / 5 },
];

/** 图片素材项（百分比坐标系 0~100） */
export interface EditorialImageItem {
  id: string;
  src: string;
  x: number;          // 居中或左上角 X 百分比 (0~100)
  y: number;          // 居中或左上角 Y 百分比 (0~100)
  width: number;      // 宽度百分比 (0~100)
  height: number;     // 高度百分比 (0~100)
  aspectRatio?: number; // 真实宽高比 (naturalWidth / naturalHeight)，防止 Canvas 绘制拉伸变形
  rotation: number;   // 旋转角度 (0~360)
  wrapMode: 'box' | 'alpha' | 'none'; // 矩形避让 / Alpha 轮廓贴合避让 / 浮于上方无避让
  zIndex: number;
  borderRadius?: number; // 像素或百分比圆角
  caption?: string;   // 图片图注
}

/** 文章结构化文本 */
export interface EditorialArticleData {
  /** 刊头/眉标（如 "ECHOES FORGE · ISSUE 08"） */
  masthead?: string;
  /** 打字机眉标/小标签（如 "— POSTED TODAY" 或 "01 · EXCLUSIVE"） */
  eyebrow?: string;
  /** 大标题（如 "THE FUTURE OF CREATIVE DESIGN"） */
  headline: string;
  /** 导语/副标题（Deck） */
  deck?: string;
  /** 作者/出处（Byline） */
  author?: string;
  /** 正文全文 */
  body: string;
  /** 精彩引语（Pull Quote） */
  pullquote?: string;
  /** 编者建议/重点卡片文本（Pro Tip） */
  proTip?: string;
  /** 印章/贴纸文本（如 "SPECIAL EDITION"） */
  badgeText?: string;
  /** 页脚小版记/页码/条形码编号（Folio） */
  folio?: string;
  /** 期号 / 日期 */
  issueDate?: string;
}

/** 字体与排版样式 */
export interface EditorialTypographySettings {
  headlineFont: string;
  bodyFont: string;
  accentFont?: string;
  textColor: string;
  accentColor: string;
  secondaryColor?: string;
  /** 正文字号基准（px，基于标准画布尺寸） */
  bodyFontSize: number;
  /** 正文行高（px） */
  bodyLineHeight: number;
  /** 是否开启首字下沉 */
  dropCap: boolean;
  /** 首字下沉行数 (2~4) */
  dropCapLines?: number;
  /** 栏间距 (px) */
  colGap?: number;
}

/** 页面背景配置 */
export interface EditorialBackground {
  type: 'color' | 'gradient' | 'paper';
  color: string;
  gradient?: string;
  textureOpacity?: number;
  /** 是否启用新闻纸微噪点质感 */
  hasPaperNoise?: boolean;
}

/** 7 种标志性杂志排版类型枚举 */
export type EditorialLayoutType =
  | 'newspaper'     // 报刊社论 (Newspaper Manifesto)
  | 'cover'         // 封面先锋 (Avant-Garde Cover)
  | 'quote'         // 访谈金句 (Interview & Perspectives)
  | 'inverted'      // 粗野反色 (Brutalism & Inverted Split)
  | 'gallery'       // 双图画廊 (Gallery Exhibition)
  | 'minimal'       // 极简文学 (Minimalist Kinfolk)
  | 'bold_poster';  // 意式波普 (Bold Pop Poster)

/** 风格专属特征标记 */
export interface EditorialPresetFeatures {
  layoutType: EditorialLayoutType;
  hasRibbonTag?: boolean;      // 是否包含顶部/侧边黑色标签色块 (如 ISSUE 08)
  hasBarcode?: boolean;        // 是否包含底部条形码装饰
  hasStickerBadge?: boolean;    // 是否有复古圆形贴纸印章 (如 SPECIAL EDITION)
  hasDatelineRule?: boolean;    // 是否有报刊 Dateline 顶部分割规线
  hasProTipCard?: boolean;      // 是否有底部 PRO TIP 编者卡片
  hasSplitPanel?: boolean;      // 是否有左右 38:62 黑白反差分栏色块
  hasFrameBorder?: boolean;     // 图片是否自带艺术装裱内衬画框
  hasTabularBorder?: boolean;   // 是否启用 3px + 1.5px 双层网格边框
  hasAccentRule?: boolean;      // 导语下方是否有短粗强调色横线
  headlinePlacement: 'top' | 'middle' | 'overlap' | 'left-col' | 'tilted';
  pullquotePlacement?: 'inline' | 'card' | 'breakout' | 'none';
}

/** 单个预设版式描述符 */
export interface EditorialPreset {
  id: string;
  name: string;
  englishName: string;
  description: string;
  /** 默认栏数 (1~3) */
  columns: number;
  /** 预设默认比例 */
  defaultRatio: EditorialPageRatio;
  /** 默认文章结构模板 */
  defaultArticle: EditorialArticleData;
  /** 默认字体与排版设置 */
  defaultTypography: EditorialTypographySettings;
  /** 默认背景 */
  defaultBackground: EditorialBackground;
  /** 风格专属特征标记 */
  features: EditorialPresetFeatures;
}

/** 节点持久化状态 */
export interface EditorialState {
  presetId: string;
  pageSize: EditorialPageRatio;
  article: EditorialArticleData;
  images: EditorialImageItem[];
  typography: EditorialTypographySettings;
  background: EditorialBackground;
  /** 记录被用户手动删除的上游图片 ID/URL，防重复装载 */
  dismissedSources?: string[];
  imageUrl?: string | null;
  isExporting?: boolean;
  error?: string | null;
  isSaved?: boolean;
}

/* ================= 几何与排版引擎中间结构 ================= */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Interval = { left: number; right: number };

export type BandObstacle =
  | {
      kind: 'polygon';
      points: Point[];
      horizontalPadding: number;
      verticalPadding: number;
    }
  | {
      kind: 'rects';
      rects: Rect[];
      horizontalPadding: number;
      verticalPadding: number;
    };

export interface PositionedLine {
  x: number;
  y: number;
  width: number;
  text: string;
}

export interface DropCapPlacement {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font: string;
  lineHeight: number;
}

export interface PullQuotePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  lines: PositionedLine[];
  font: string;
  lineHeight: number;
}

/** Pretext 完整排版计算结果（DOM 预览与 Canvas 导出共用） */
export interface LayoutProjection {
  pageWidth: number;
  pageHeight: number;
  headlineFont: string;
  headlineLineHeight: number;
  headlineLines: PositionedLine[];
  headlineRegion: Rect;
  deckLines: PositionedLine[];
  deckRegion?: Rect;
  dropCap: DropCapPlacement | null;
  bodyLines: PositionedLine[];
  pullquote: PullQuotePlacement | null;
  pullquoteCardRect?: Rect;
  proTipRect?: Rect;
  proTipLines?: PositionedLine[];
  splitPanelRect?: Rect;
  columns: Rect[];
  obstacles: BandObstacle[];
}

/* ================= 独立模板插件化接口 (Template Plugin Pattern) ================= */

/** DOM 专属装饰层渲染 Props */
export interface TemplateRenderProps {
  article: EditorialArticleData;
  typography: EditorialTypographySettings;
  ratioPreset: PageRatioPreset;
  layoutProjection: LayoutProjection;
  scale: number;
}

/** Canvas 专属装饰层绘制上下文 */
export interface CanvasRenderContext {
  state: EditorialState;
  article: EditorialArticleData;
  typography: EditorialTypographySettings;
  pageRatio: PageRatioPreset;
  layoutProjection: LayoutProjection;
  W: number;
  H: number;
  textColor: string;
  accentColor: string;
  secondaryColor: string;
}

/** 单个独立模板插件定义 */
export interface EditorialTemplate extends EditorialPreset {
  /** DOM 专属装饰层组件（如双轨刊头、反色色块、贴纸印章、金句卡片、Pro Tip 等） */
  renderDecorations?: React.ComponentType<TemplateRenderProps>;
  /** Canvas 专属装饰层绘制函数 */
  drawDecorations?: (
    ctx: CanvasRenderingContext2D,
    renderCtx: CanvasRenderContext
  ) => void;
}
