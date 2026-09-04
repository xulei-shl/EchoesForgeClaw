/**
 * 文本成图模块 - Canvas 渲染引擎
 *
 * 预览与导出共用同一 paintTextImage 实现（预览为同尺寸 Canvas 的 CSS 缩放显示），
 * 所见即所得由构造保证；竖排逐字排版算法与手账 drawText.ts 口径一致。
 */
import type { TextImageItem, TextImageState } from './types';
import { TEXT_IMAGE_CANVAS, getTextImageCanvasPreset } from './types';
import { loadFontFamily, formatCanvasFont, DEFAULT_FONT_FAMILY, DEFAULT_TEXT_COLOR } from '../journal/text/fontRegistry';
import { drawVerticalColumns, textFontSize } from '../journal/text/drawText';

/** 确保文本组件使用的所有字体均已就绪（Google Fonts 异步加载，超时自动降级） */
export async function ensureTextImageFontsReady(items: TextImageItem[]): Promise<void> {
  const families = Array.from(new Set(items.map((it) => it.fontFamily || DEFAULT_FONT_FAMILY)));
  await Promise.all(families.map((f) => loadFontFamily(f).catch(() => {})));
}

/**
 * 绘制单个文本组件到 Canvas（支持位置、旋转、字号、横竖排、阴影与描边，适配任意画布宽高）
 */
export function drawTextImageItemToCanvas(
  ctx: CanvasRenderingContext2D,
  item: TextImageItem,
  canvasWidth: number = TEXT_IMAGE_CANVAS,
  canvasHeight: number = canvasWidth
): void {
  const text = item.text || '';
  if (!text.trim()) return;

  const fontFamily = item.fontFamily || DEFAULT_FONT_FAMILY;
  const color = item.color || DEFAULT_TEXT_COLOR;
  const fontSize = textFontSize(item.w, canvasWidth);
  const isVertical = item.writingMode === 'vertical';

  const cx = (item.x / 100) * canvasWidth;
  const cy = (item.y / 100) * canvasHeight;

  ctx.save();
  ctx.translate(cx, cy);
  if (item.angle) {
    ctx.rotate((item.angle * Math.PI) / 180);
  }

  ctx.font = formatCanvasFont(fontSize, fontFamily);
  ctx.textBaseline = 'middle';

  const align = item.textAlign || 'center';
  ctx.fillStyle = color;

  // 优雅阴影
  ctx.shadowColor = 'rgba(15, 23, 42, 0.12)';
  ctx.shadowBlur = Math.max(1, fontSize * 0.08);
  ctx.shadowOffsetY = Math.max(1, fontSize * 0.04);

  // 描边配置
  const hasStroke = Boolean(item.strokeEnabled && item.strokeColor && (item.strokeWidth ?? 0) > 0);
  if (hasStroke) {
    // 描边宽度按当前画布宽度与 1080 尺寸比例缩放
    const scaleRatio = canvasWidth / TEXT_IMAGE_CANVAS;
    ctx.lineWidth = Math.max(1, (item.strokeWidth || 4) * scaleRatio);
    ctx.strokeStyle = item.strokeColor || '#ffffff';
    ctx.lineJoin = 'round';
  }

  // 描边先于填充（产生居中向外扩展的外描边质感）
  const emit = (str: string, x: number, y: number) => {
    if (hasStroke) {
      ctx.strokeText(str, x, y);
    }
    ctx.fillText(str, x, y);
  };

  if (isVertical) {
    // 竖排模式：汉字直立逐字排列，英文单词整体旋转不拆分（支持顶端/居中/底端对齐）
    ctx.textAlign = 'center';
    drawVerticalColumns(ctx, text, fontSize, emit, align);
  } else {
    // 横排模式：按换行符与对齐方式排版（支持左/中/右对齐）
    const lines = text.split('\n');
    const lineH = fontSize * 1.35;
    const maxLineWidth = Math.max(...lines.map((l) => ctx.measureText(l).width || 0), 0);

    ctx.textAlign = align;
    lines.forEach((line, i) => {
      const yOffset = (i - (lines.length - 1) / 2) * lineH;
      let xOffset = 0;
      if (align === 'left') {
        xOffset = -maxLineWidth / 2;
      } else if (align === 'right') {
        xOffset = maxLineWidth / 2;
      }
      emit(line, xOffset, yOffset);
    });
  }

  ctx.restore();
}

/**
 * 把整个文本成图状态（背景 + 所有文本组件）绘制到画布
 */
export function paintTextImage(
  ctx: CanvasRenderingContext2D,
  state: TextImageState,
  width?: number,
  height?: number
): void {
  const preset = getTextImageCanvasPreset(state.aspectRatio);
  const canvasW = width ?? preset.width;
  const canvasH = height ?? preset.height;

  ctx.clearRect(0, 0, canvasW, canvasH);

  // 绘制背景（如果启用）
  if (state.backgroundEnabled) {
    ctx.fillStyle = state.backgroundColor || '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  // 按图层 z 从小到大排序后逐一绘制
  const sortedItems = [...(state.items || [])].sort((a, b) => a.z - b.z);
  for (const item of sortedItems) {
    drawTextImageItemToCanvas(ctx, item, canvasW, canvasH);
  }
}

/** 全分辨率渲染并导出 PNG data URL（按所选比例生成） */
export async function composeTextImage(state: TextImageState): Promise<string> {
  await ensureTextImageFontsReady(state.items || []);
  const preset = getTextImageCanvasPreset(state.aspectRatio);
  const canvas = document.createElement('canvas');
  canvas.width = preset.width;
  canvas.height = preset.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');
  paintTextImage(ctx, state, preset.width, preset.height);
  return canvas.toDataURL('image/png');
}

/** 本地直接下载 PNG（data URL 与同源服务器 URL 均可） */
export function downloadTextImage(dataUrl: string, filename?: string) {
  if (!dataUrl) return;
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename || `text-image-${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
