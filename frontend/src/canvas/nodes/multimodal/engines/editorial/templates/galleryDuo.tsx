import type { EditorialTemplate, CanvasRenderContext } from '../types';

/**
 * 🖼 双图画廊模板 (Gallery Exhibition)
 * 特征：艺术装裱错落双画框、展品级图注、贯穿细横线与水流般优雅绕排
 */
const drawGalleryDuoDecorations = (
  ctx: CanvasRenderingContext2D,
  { W, H, secondaryColor }: CanvasRenderContext
) => {
  // 顶部极简画廊细横线
  const topY = Math.round(H * 0.045);
  const mX = Math.round(W * 0.065);
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mX, topY + Math.round(H * 0.012));
  ctx.lineTo(W - mX, topY + Math.round(H * 0.012));
  ctx.stroke();

  // 水平底部辅助微注
  ctx.fillStyle = secondaryColor;
  ctx.font = `italic 11px serif`;
  ctx.restore();
};

export const galleryDuoTemplate: EditorialTemplate = {
  id: 'gallery_duo',
  name: '双图画廊',
  englishName: 'Gallery Exhibition',
  description: '艺术装裱错落双画框、展品级图注、贯穿细横线与水流般优雅绕排',
  columns: 2,
  defaultRatio: '4:5',
  features: {
    layoutType: 'gallery',
    hasFrameBorder: true,
    hasDatelineRule: false,
    headlinePlacement: 'top',
    pullquotePlacement: 'none',
  },
  defaultArticle: {
    masthead: 'EXHIBITION ARCHIVE · NO. 04',
    eyebrow: 'DUAL MONOGRAPHIC STUDY',
    headline: 'MOMENTS IN MONOCHROME',
    deck: 'A curated visual dialogue between light, architecture, and fleeting human gestures.',
    author: 'CURATED BY ECHOES FORGE GALLERY',
    body: '光影凝固了时间的流逝，而双画框的并置则开启了图像之间的对话。在画廊排版中，文字是低语的导览员，沿着画框边缘轻柔流淌。优雅的图注标示着焦距与年代，让观者的视线在黑白明暗与细腻笔触之间自由游走。',
    folio: 'GALLERY COLLECTION · PLATE 04',
    issueDate: 'SUMMER 2026',
  },
  defaultTypography: {
    headlineFont: '上图东观体, "Noto Serif SC", serif',
    bodyFont: '上图东观体, "Noto Serif SC", serif',
    textColor: '#222220',
    accentColor: '#3b5998',
    secondaryColor: '#7c7a75',
    bodyFontSize: 20,
    bodyLineHeight: 33,
    dropCap: true,
    dropCapLines: 2,
    colGap: 38,
  },
  defaultBackground: {
    type: 'color',
    color: '#f7f7f5',
  },
  drawDecorations: drawGalleryDuoDecorations,
};
