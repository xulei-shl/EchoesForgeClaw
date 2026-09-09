/**
 * 文本成图模块 - 类型与默认值
 *
 * 独立于手账制作的自由文字排版节点：输入文字并调整字体 / 字号 / 颜色 /
 * 横竖排 / 描边与背景（背景默认无 = 透明），渲染为 PNG 图片输出。
 */
import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_COLOR } from '../journal/text/fontRegistry';
import type { TextAlignment } from '../journal/text/FontControls';

export type TextImageWritingMode = 'horizontal' | 'vertical';

/** 画布排版比例 */
export type TextImageAspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

export interface TextImageCanvasPreset {
  id: TextImageAspectRatio;
  label: string;
  width: number;
  height: number;
}

/** 常用排版尺寸预设（导出像素尺寸） */
export const TEXT_IMAGE_CANVAS_PRESETS: TextImageCanvasPreset[] = [
  { id: '1:1', label: '1:1 方版', width: 1080, height: 1080 },
  { id: '3:4', label: '3:4 竖版', width: 1080, height: 1440 },
  { id: '4:3', label: '4:3 横版', width: 1440, height: 1080 },
  { id: '9:16', label: '9:16 竖屏', width: 1080, height: 1920 },
  { id: '16:9', label: '16:9 宽屏', width: 1920, height: 1080 },
];

export function getTextImageCanvasPreset(aspectRatio?: string): TextImageCanvasPreset {
  return TEXT_IMAGE_CANVAS_PRESETS.find((p) => p.id === aspectRatio) ?? TEXT_IMAGE_CANVAS_PRESETS[0];
}

/** 文本组件实例 */
export interface TextImageItem {
  id: string;
  /** 文本内容 */
  text: string;
  /** 字体 family（复用手账字体注册表） */
  fontFamily: string;
  /** 相对尺寸比例（与手账对齐，约为 3~30，在 1080px 画布下换算为对应字号） */
  w: number;
  /** 文字颜色 */
  color: string;
  /** 横排或竖排 */
  writingMode: TextImageWritingMode;
  /** 对齐方式（横排：左/中/右；竖排：顶/中/底） */
  textAlign?: TextAlignment;
  /** 水平中心位置百分比 (0~100) */
  x: number;
  /** 垂直中心位置百分比 (0~100) */
  y: number;
  /** 旋转角度 (度数) */
  angle: number;
  /** 图层层级 */
  z: number;
  /** 描边开关 */
  strokeEnabled?: boolean;
  strokeColor?: string;
  strokeWidth?: number;
}

/** 文本成图节点持久化状态 */
export interface TextImageState {
  /** 文本组件列表 */
  items: TextImageItem[];
  /** 画布排版比例预设 (默认 1:1) */
  aspectRatio?: TextImageAspectRatio;
  /** 背景开关（默认关 = PNG 透明背景） */
  backgroundEnabled: boolean;
  backgroundColor: string;
  /** 生成的图片输出 (PNG data URL / 落盘后为服务器 URL) */
  imageUrl?: string | null;
  /** 是否已保存到数据库 (generations 表) */
  isSaved?: boolean;
  error?: string | null;
}

/** 导出画布默认基准边长 */
export const TEXT_IMAGE_CANVAS = 1080;

/** 默认文本组件 */
export const DEFAULT_TEXT_ITEM: TextImageItem = {
  id: 'text_default',
  text: '手写文字',
  fontFamily: DEFAULT_FONT_FAMILY,
  w: 9, // 对应 1080px 画布下约 97px 字号
  color: DEFAULT_TEXT_COLOR,
  writingMode: 'horizontal',
  textAlign: 'center',
  x: 50,
  y: 50,
  angle: 0,
  z: 1,
  strokeEnabled: false,
  strokeColor: '#ffffff',
  strokeWidth: 4,
};

/** 默认状态（背景默认无 = 透明，比例默认 1:1） */
export const TEXT_IMAGE_DEFAULTS: TextImageState = {
  items: [DEFAULT_TEXT_ITEM],
  aspectRatio: '1:1',
  backgroundEnabled: false,
  backgroundColor: '#ffffff',
  imageUrl: null,
  isSaved: false,
  error: null,
};

/** 归一化单个文本项 */
export function normalizeTextImageItem(
  item: Partial<TextImageItem> | undefined,
  index = 0
): TextImageItem {
  return {
    id: item?.id || `text_${Date.now()}_${index}`,
    text: item?.text ?? '手写文字',
    fontFamily: item?.fontFamily || DEFAULT_FONT_FAMILY,
    w: typeof item?.w === 'number' && !isNaN(item.w) ? item.w : 9,
    color: item?.color || DEFAULT_TEXT_COLOR,
    writingMode: item?.writingMode === 'vertical' ? 'vertical' : 'horizontal',
    textAlign: item?.textAlign || 'center',
    x: typeof item?.x === 'number' ? item.x : 50,
    y: typeof item?.y === 'number' ? item.y : 50,
    angle: typeof item?.angle === 'number' ? item.angle : 0,
    z: typeof item?.z === 'number' ? item.z : index + 1,
    strokeEnabled: Boolean(item?.strokeEnabled),
    strokeColor: item?.strokeColor || '#ffffff',
    strokeWidth: typeof item?.strokeWidth === 'number' ? item.strokeWidth : 4,
  };
}

/** 归一化：补全历史数据可能缺失的字段，确保 items 始终存在 */
export function normalizeTextImageState(
  data: Partial<TextImageState> | any | undefined
): TextImageState {
  if (!data) return { ...TEXT_IMAGE_DEFAULTS };

  let items: TextImageItem[] = [];
  if (Array.isArray(data.items) && data.items.length > 0) {
    items = data.items.map((it: any, idx: number) => normalizeTextImageItem(it, idx));
  } else if (typeof data.text === 'string' && data.text.trim()) {
    // 兼顾旧单文本数据平滑过渡
    items = [
      normalizeTextImageItem(
        {
          text: data.text,
          fontFamily: data.fontFamily,
          w: typeof data.fontSize === 'number' ? (data.fontSize / TEXT_IMAGE_CANVAS) * 100 : 9,
          color: data.color,
          writingMode: data.writingMode,
          textAlign: data.textAlign,
          strokeEnabled: data.strokeEnabled,
          strokeColor: data.strokeColor,
          strokeWidth: data.strokeWidth,
        },
        0
      ),
    ];
  } else {
    items = [{ ...DEFAULT_TEXT_ITEM }];
  }

  return {
    items,
    aspectRatio: data.aspectRatio || '1:1',
    backgroundEnabled: Boolean(data.backgroundEnabled),
    backgroundColor: data.backgroundColor || '#ffffff',
    imageUrl: data.imageUrl ?? null,
    isSaved: Boolean(data.isSaved),
    error: data.error ?? null,
  };
}
