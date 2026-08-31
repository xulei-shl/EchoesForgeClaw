/**
 * 手账制作文本模块 - Canvas 文本 1:1 精确渲染器
 */
import type { JournalMakerItem } from '../types';
import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_COLOR, loadFontFamily } from './fontRegistry';

/** 竖排单元：直立字符 / 英文数字单词（整体旋转）/ 空格间隔 */
type VerticalUnit =
  | { type: 'char'; ch: string }
  | { type: 'word'; text: string }
  | { type: 'space' };

const WORD_CHAR = /[A-Za-z0-9'''’-]/;

function tokenizeVerticalSegment(seg: string): VerticalUnit[] {
  const units: VerticalUnit[] = [];
  let wordBuf = '';
  const flushWord = () => {
    if (wordBuf) {
      units.push({ type: 'word', text: wordBuf });
      wordBuf = '';
    }
  };
  for (const ch of Array.from(seg)) {
    if (ch === ' ') {
      flushWord();
      units.push({ type: 'space' });
    } else if (WORD_CHAR.test(ch)) {
      wordBuf += ch;
    } else {
      flushWord();
      units.push({ type: 'char', ch });
    }
  }
  flushWord();
  return units;
}

/**
 * 竖排绘制：各行作为由右向左的竖列。
 * 汉字/假名/全角标点逐字直立排列；英文与数字单词作为完整单元顺时针旋转 90°
 * （与 DOM 的 writing-mode: vertical-rl + text-orientation: mixed 表现一致），单词不拆字母。
 * emit 由调用方提供，以便附加描边、阴影等效果。
 */
export function drawVerticalColumns(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
  emit: (str: string, x: number, y: number) => void
): void {
  const columns = text.split('\n');
  const colWidth = fontSize * 1.35;
  const charHeight = fontSize * 1.2;

  columns.forEach((col, colIdx) => {
    // 竖列从右向左分布
    const xOffset = ((columns.length - 1) / 2 - colIdx) * colWidth;
    const units = tokenizeVerticalSegment(col);
    // 先测量列总高再自上而下绘制，保证列内容整体居中
    const heights = units.map((u) =>
      u.type === 'char'
        ? charHeight
        : u.type === 'space'
          ? fontSize * 0.5
          : ctx.measureText(u.text).width + fontSize * 0.25
    );
    const totalHeight = heights.reduce((sum, h) => sum + h, 0);
    let y = -totalHeight / 2;
    units.forEach((u, i) => {
      const h = heights[i];
      if (u.type === 'word') {
        ctx.save();
        ctx.translate(xOffset, y + h / 2);
        ctx.rotate(Math.PI / 2);
        emit(u.text, 0, 0);
        ctx.restore();
      } else if (u.type === 'char') {
        emit(u.ch, xOffset, y + h / 2);
      }
      y += h;
    });
  });
}

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
  if (item.angle) {
    ctx.rotate((item.angle * Math.PI) / 180);
  }
  ctx.font = `${fontSize}px "${fontFamily}", cursive, sans-serif`;
  ctx.textBaseline = 'middle';

  const align = item.textAlign || 'center';
  ctx.fillStyle = color;

  ctx.shadowColor = 'rgba(15, 23, 42, 0.12)';
  ctx.shadowBlur = Math.max(1, fontSize * 0.08);
  ctx.shadowOffsetY = Math.max(1, fontSize * 0.04);

  if (isVertical) {
    // 竖排模式：汉字直立逐字排列，英文单词整体旋转不拆分（共用竖排算法）
    ctx.textAlign = 'center';
    drawVerticalColumns(ctx, text, fontSize, (str, x, y) => ctx.fillText(str, x, y));
  } else {
    // 横排模式：按换行符与对齐方式排版
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
      ctx.fillText(line, xOffset, yOffset);
    });
  }

  ctx.restore();
}

