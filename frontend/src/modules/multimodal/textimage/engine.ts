/**
 * 文本成图模块 - Canvas 渲染引擎
 *
 * 预览与导出共用同一 paintTextImage 实现（预览为同尺寸 Canvas 的 CSS 缩放显示），
 * 所见即所得由构造保证；竖排逐字排版算法与手账 drawText.ts 口径一致。
 */
import type { TextImageState } from './types';
import { TEXT_IMAGE_CANVAS } from './types';
import { loadFontFamily } from '../journal/text/fontRegistry';
import { drawVerticalColumns } from '../journal/text/drawText';

/** 确保当前字体就绪（Google Fonts 异步加载，超时自动降级不阻断） */
export async function ensureTextImageFontReady(fontFamily: string): Promise<void> {
  await loadFontFamily(fontFamily);
}

/**
 * 把文本成图状态绘制到画布（透明底 / 纯色底 + 居中横排或竖排文字）
 */
export function paintTextImage(
  ctx: CanvasRenderingContext2D,
  state: TextImageState
): void {
  const size = TEXT_IMAGE_CANVAS;
  ctx.clearRect(0, 0, size, size);

  if (state.backgroundEnabled) {
    ctx.fillStyle = state.backgroundColor;
    ctx.fillRect(0, 0, size, size);
  }

  const text = state.text || '';
  if (!text.trim()) return;

  const fontSize = Math.max(8, state.fontSize || 96);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.font = `${fontSize}px "${state.fontFamily}", cursive, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = state.color;
  if (state.strokeEnabled) {
    ctx.lineWidth = Math.max(1, state.strokeWidth);
    ctx.strokeStyle = state.strokeColor;
    ctx.lineJoin = 'round';
  }

  // 描边先于填充（描边居中于字形边缘，视觉为外扩描边）
  const emit = (str: string, x: number, y: number) => {
    if (state.strokeEnabled) ctx.strokeText(str, x, y);
    ctx.fillText(str, x, y);
  };

  if (state.writingMode === 'vertical') {
    // 竖排：汉字直立逐字排列，英文单词整体旋转不拆分（与手账共用竖排算法）
    drawVerticalColumns(ctx, text, fontSize, emit);
  } else {
    // 横排：按换行符居中排版
    const lines = text.split('\n');
    const lineH = fontSize * 1.35;
    lines.forEach((line, i) => {
      emit(line, 0, (i - (lines.length - 1) / 2) * lineH);
    });
  }

  ctx.restore();
}

/** 全分辨率渲染并导出 PNG data URL（生成入口，预览与导出同一实现） */
export async function composeTextImage(state: TextImageState): Promise<string> {
  await ensureTextImageFontReady(state.fontFamily);
  const canvas = document.createElement('canvas');
  canvas.width = TEXT_IMAGE_CANVAS;
  canvas.height = TEXT_IMAGE_CANVAS;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');
  paintTextImage(ctx, state);
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
