import type { EditorialTemplate, CanvasRenderContext } from '../types';

/**
 * 🍃 极简文学模板 (Minimalist Kinfolk)
 * 特征：Kinfolk 侘寂大留白、居中宋体宽字距、0.5px 发丝细线、古典方框首字下沉
 */
const drawMinimalEditorialDecorations = (
  ctx: CanvasRenderingContext2D,
  { W, H, secondaryColor }: CanvasRenderContext
) => {
  // 居中发丝分割线
  const topY = Math.round(H * 0.045);
  const lineW = Math.round(W * 0.4);
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo((W - lineW) / 2, topY + Math.round(H * 0.015));
  ctx.lineTo((W + lineW) / 2, topY + Math.round(H * 0.015));
  ctx.stroke();

  // 诗意印鉴小注
  ctx.fillStyle = secondaryColor;
  ctx.font = '10px serif';
  ctx.restore();
};

export const minimalEditorialTemplate: EditorialTemplate = {
  id: 'minimal_editorial',
  name: '极简文学',
  englishName: 'Minimalist Kinfolk',
  description: 'Kinfolk 侘寂大留白、居中宋体宽字距、0.5px 发丝细线、古典方框首字下沉',
  columns: 2,
  defaultRatio: '3:4',
  features: {
    layoutType: 'minimal',
    hasDatelineRule: false,
    headlinePlacement: 'top',
    pullquotePlacement: 'inline',
  },
  defaultArticle: {
    masthead: 'LITERATURE & MEDITATION',
    eyebrow: 'ESSAY · VOL 01',
    headline: 'THE SUBTLE BEAUTY OF QUIET OBJECTS',
    deck: 'On solitude, morning light, and finding sanctuary in everyday simplicity.',
    author: 'BY ECHOES FORGE ESSAYIST',
    body: '当一切喧嚣退去，留白便成为了最好的语言。温润的米宣纸背景上，宋体的横平竖直沉静舒展。文字无需大声疾呼，恰到好处的边距与行间距，为心灵留出了一方安憩的天地。',
    folio: 'LITERATURE · VOL 01',
    issueDate: '2026',
  },
  defaultTypography: {
    headlineFont: '又又意宋, Huiwen-mincho, "Noto Serif SC", serif',
    bodyFont: '又又意宋, Huiwen-mincho, "Noto Serif SC", serif',
    textColor: '#332d27',
    accentColor: '#8b5e3c',
    secondaryColor: '#9c9288',
    bodyFontSize: 21,
    bodyLineHeight: 35,
    dropCap: true,
    dropCapLines: 3,
    colGap: 46,
  },
  defaultBackground: {
    type: 'color',
    color: '#fcfbfa',
  },
  drawDecorations: drawMinimalEditorialDecorations,
};
