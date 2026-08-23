/**
 * 手账制作文本模块 - Canvas 文本 1:1 精确渲染器
 */
import type { JournalMakerItem } from '../types';
import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_COLOR, loadFontFamily } from './fontRegistry';

/**
 * 计算文本字号（按页面宽度百分比缩放，保证高分导出与预览 1:1 对齐）
 * @param w 尺寸比例（约 3 ~ 15）
 * @param pageWidth 画布或预览容器宽度
 */
export function textFontSize(w: number, pageWidth: number): number {
  return Math.max(10, (w / 100) * pageWidth);
}

/**
 * 确保所有文本素材使用的字体均已就绪（超时 3s 自动放行）
 */
export async function ensureJournalFontsLoaded(items: JournalMakerItem[]): Promise<void> {
  const textItems = items.filter((it) => it.kind === 'text');
  if (textItems.length === 0) return;
  const families = Array.from(
    new Set(textItems.map((it) => it.fontFamily || DEFAULT_FONT_FAMILY))
  );
  await Promise.all(families.map((f) => loadFontFamily(f)));
}

/**
 * 在 Canvas 上绘制单个文本素材（精确复刻 DOM 的横排 / 竖排样式与阴影）
 */
export function drawTextItemToCanvas(
  ctx: CanvasRenderingContext2D,
  item: JournalMakerItem,
  pageWidth: number,
  pageHeight: number
): void {
  const text = item.text || '';
  if (!text.trim()) return;

  const fontFamily = item.fontFamily || DEFAULT_FONT_FAMILY;
  const color = item.color || DEFAULT_TEXT_COLOR;
  const fontSize = textFontSize(item.w, pageWidth);
  const isVertical = item.writingMode === 'vertical';

  const cx = (item.x / 100) * pageWidth;
  const cy = (item.y / 100) * pageHeight;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((item.angle * Math.PI) / 180);

  ctx.font = `${fontSize}px "${fontFamily}", cursive, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(15, 23, 42, 0.12)';
  ctx.shadowBlur = Math.max(1, fontSize * 0.08);
  ctx.shadowOffsetY = Math.max(1, fontSize * 0.04);

  if (isVertical) {
    // 竖排模式：各行作为由右向左的竖列，列内字符由上至下排列
    const columns = text.split('\n');
    const colWidth = fontSize * 1.35;
    const charHeight = fontSize * 1.2;

    columns.forEach((col, colIdx) => {
      // 竖列从右向左分布
      const xOffset = ((columns.length - 1) / 2 - colIdx) * colWidth;
      const chars = Array.from(col);
      chars.forEach((char, charIdx) => {
        const yOffset = (charIdx - (chars.length - 1) / 2) * charHeight;
        ctx.fillText(char, xOffset, yOffset);
      });
    });
  } else {
    // 横排模式：按换行符居中排版
    const lines = text.split('\n');
    const lineH = fontSize * 1.35;
    lines.forEach((line, i) => {
      const yOffset = (i - (lines.length - 1) / 2) * lineH;
      ctx.fillText(line, 0, yOffset);
    });
  }

  ctx.restore();
}
