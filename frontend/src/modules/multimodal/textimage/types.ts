/**
 * 文本成图模块 - 类型与默认值
 *
 * 独立于手账制作的自由文字排版节点：输入文字并调整字体 / 字号 / 颜色 /
 * 横竖排 / 描边与背景（背景默认无 = 透明），渲染为 PNG 图片输出。
 */
import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_COLOR } from '../journal/text/fontRegistry';

export type TextImageWritingMode = 'horizontal' | 'vertical';

/** 文本成图节点持久化状态 */
export interface TextImageState {
  /** 文本内容（支持多行；竖排时每行一列，列自右向左） */
  text: string;
  /** 字体 family（复用手账字体注册表） */
  fontFamily: string;
  /** 字号（导出画布像素；预览与导出共用同一渲染，仅 CSS 缩放差异） */
  fontSize: number;
  /** 文字颜色 */
  color: string;
  writingMode: TextImageWritingMode;
  /** 描边开关（默认关） */
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number;
  /** 背景开关（默认关 = PNG 透明背景） */
  backgroundEnabled: boolean;
  backgroundColor: string;
  /** 生成的图片输出 (PNG data URL / 落盘后为服务器 URL) */
  imageUrl?: string | null;
  /** 是否已保存到数据库 (generations 表) */
  isSaved?: boolean;
  error?: string | null;
}

/** 导出画布边长（正方形） */
export const TEXT_IMAGE_CANVAS = 1080;

/** 默认样式（背景默认无 = 透明，描边默认关） */
export const TEXT_IMAGE_DEFAULTS = {
  text: '手写文字',
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: 96,
  color: DEFAULT_TEXT_COLOR,
  writingMode: 'horizontal' as TextImageWritingMode,
  strokeEnabled: false,
  strokeColor: '#ffffff',
  strokeWidth: 6,
  backgroundEnabled: false,
  backgroundColor: '#ffffff',
};

/** 归一化：补全历史数据可能缺失的字段 */
export function normalizeTextImageState(data: Partial<TextImageState> | undefined): TextImageState {
  return { ...TEXT_IMAGE_DEFAULTS, ...(data ?? {}) };
}
