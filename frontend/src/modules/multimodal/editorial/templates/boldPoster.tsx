import type { EditorialTemplate, CanvasRenderContext } from '../types';

/**
 * 🇮🇹 意式波普模板 (Bold Pop Poster)
 * 特征：番茄红与浓黑撞色、-4° 倾斜动感主标、3px+1.5px 双层报刊表格边框、4px 红色左标卡片
 */
const drawBoldPosterDecorations = (
  ctx: CanvasRenderingContext2D,
  { W, H, textColor, accentColor }: CanvasRenderContext
) => {
  ctx.save();
  const borderMarginX = Math.round(W * 0.04);
  const borderMarginY = Math.round(H * 0.035);
  ctx.strokeStyle = textColor || '#1c1410';
  ctx.lineWidth = 4;
  ctx.strokeRect(
    borderMarginX,
    borderMarginY,
    W - borderMarginX * 2,
    H - borderMarginY * 2
  );

  // 底部 6px 红色饱和地标线
  ctx.fillStyle = accentColor || '#d8000f';
  ctx.fillRect(
    borderMarginX,
    H - borderMarginY - 6,
    W - borderMarginX * 2,
    6
  );
  ctx.restore();
};

export const boldPosterTemplate: EditorialTemplate = {
  id: 'bold_poster',
  name: '意式波普',
  englishName: 'Bold Pop Poster',
  description: '番茄红与浓黑撞色、-4° 倾斜动感主标、3px+1.5px 双层报刊表格边框、4px 红色左标卡片',
  columns: 2,
  defaultRatio: '3:4',
  features: {
    layoutType: 'bold_poster',
    hasTabularBorder: true,
    hasAccentRule: true,
    headlinePlacement: 'tilted',
    pullquotePlacement: 'card',
  },
  defaultArticle: {
    masthead: '01 · POP SPORT & ESSAY',
    eyebrow: 'ISSUE 08 · RED EDITION',
    headline: 'RADICAL PASSION IN MOTION',
    deck: 'Bold type, heavy ink rules, and high-octane editorial storytelling from European posters.',
    author: 'STUDIO POP POSTER',
    pullquote: '',
    body: '意式波普海报将复古运动刊物的力量感与当代平面设计的严谨网格熔于一炉。倾斜的动感大标题打破常规，浓烈的番茄红点缀每一个数据与小标。3px 重边框锁紧了版面结构，让整页内容如同刚从轮转印刷机上撕下的海报般鲜活夺目。',
    folio: 'FORGE POSTER · NO. 08',
    issueDate: '30 · AUG · 2026',
  },
  defaultTypography: {
    headlineFont: 'MiSans, "Helvetica Neue", sans-serif',
    bodyFont: '方正屏显雅宋, "Noto Serif SC", serif',
    accentFont: 'JetBrains Mono, monospace',
    textColor: '#1c1410',
    accentColor: '#d8000f',
    secondaryColor: '#888880',
    bodyFontSize: 19,
    bodyLineHeight: 31,
    dropCap: true,
    dropCapLines: 3,
    colGap: 36,
  },
  defaultBackground: {
    type: 'color',
    color: '#ffffff',
  },
  renderDecorations: ({ typography, ratioPreset }) => (
    <div
      className="absolute pointer-events-none"
      style={{
        top: `${Math.round(ratioPreset.height * 0.035)}px`,
        left: `${Math.round(ratioPreset.width * 0.04)}px`,
        right: `${Math.round(ratioPreset.width * 0.04)}px`,
        bottom: `${Math.round(ratioPreset.height * 0.035)}px`,
        border: `4px solid ${typography.textColor || '#1c1410'}`,
        borderBottom: `6px solid ${typography.accentColor || '#d8000f'}`,
      }}
    />
  ),
  drawDecorations: drawBoldPosterDecorations,
};
