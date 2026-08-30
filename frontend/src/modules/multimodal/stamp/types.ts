/**
 * 邮票截图框（Stamp Cutter）类型定义
 */

/** 邮票常用长宽比 */
export type StampAspectRatio = '3:4' | '4:3' | '1:1' | 'free';

/** 归一化选框坐标 (0 ~ 1 范围) */
export interface StampCropBox {
  /** 选框左上角 X 轴归一化坐标 (0 ~ 1) */
  x: number;
  /** 选框左上角 Y 轴归一化坐标 (0 ~ 1) */
  y: number;
  /** 选框归一化宽度 (0 ~ 1) */
  width: number;
  /** 选框归一化高度 (0 ~ 1) */
  height: number;
}

/** 邮票网格/多联版式配置（行数与列数） */
export interface StampGrid {
  /** 行数（竖向分割，默认 1） */
  rows: number;
  /** 列数（横向分割，默认 1） */
  cols: number;
}

/** 邮票常用多联预设 */
export type StampLayoutPreset =
  | '1x1' // 单张
  | '1x2' // 竖双联
  | '1x3' // 竖三联
  | '1x4' // 竖四联
  | '2x1' // 横双联
  | '3x1' // 横三联
  | '4x1' // 横四联
  | '2x2' // 四方联
  | '3x3' // 九联
  | 'custom'; // 自定义行列

/** 邮票齿孔打孔与柔和投影渲染参数 */
export interface StampEffectOptions {
  /** 多联网格版式（默认 { rows: 1, cols: 1 } 单张） */
  grid?: StampGrid;
  /** 是否包含白色纸边（默认 true，内容四周留白） */
  withMargin?: boolean;
  /** 内容到锯齿边的白边宽度 (px)，默认 46 */
  margin?: number;
  /** 半圆打孔半径 (px)，默认 14 */
  holeRadius?: number;
  /** 打孔间距 (px)，默认 holeRadius * 2 + 18 */
  pitch?: number;
  /** 邮票外留白 (px，给立体投影空间)，默认 90 */
  outerPad?: number;
  /** 投影不透明度 (0 ~ 255)，默认 70 */
  shadowAlpha?: number;
  /** 背景色（默认 null 为真透明 RGBA，传颜色字符串则为填充底色） */
  bgColor?: string | null;
}

/** 邮票截图框节点内部持久化状态 */
export interface StampCutterState {
  /** 多联网格版式（行与列） */
  grid?: StampGrid;
  /** 是否带白边 */
  withMargin: boolean;
  /** 长宽比设置 */
  aspectRatio: StampAspectRatio;
  /** 选框归一化坐标 */
  cropBox: StampCropBox | null;
  /** 导出的最终高清邮票图片 URL (PNG) */
  imageUrl?: string | null;
  /** 用户本地直接上传/替换的图片 (Base64 Data URL) */
  uploadedImage?: string | null;
  /** 是否已保存到数据库 (generations 表) */
  isSaved?: boolean;
  /** 错误信息 */
  error?: string | null;
}
