/**
 * 杂志排版离屏 Canvas 高保真渲染与导出器 (canvasExporter)
 * 采用策略模式，支持 7 款标志性独立模板的 1:1 所见即所得 300DPI 导出
 */

import type { EditorialPreset, EditorialState, PageRatioPreset } from '../types';
import { computeEditorialLayout } from '../engine/layoutEngine';
import { loadFontFamily } from '../../journal/text/fontRegistry';
import { getEditorialTemplate } from '../templates';

/**
 * 异步加载图像
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

/**
 * 绘制矢量现代条形码装饰
 */
function drawBarcode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string
) {
  ctx.save();
  ctx.fillStyle = color;
  const barCount = 36;
  const unitW = width / (barCount * 1.5);
  let curX = x;

  for (let i = 0; i < barCount; i++) {
    const isThick = i % 3 === 0 || i % 7 === 0;
    const w = isThick ? unitW * 2 : unitW;
    ctx.fillRect(curX, y, w, height);
    curX += w + unitW * 0.8;
    if (curX > x + width) break;
  }
  ctx.restore();
}

/**
 * 导出整页杂志图片为 PNG Data URL
 */
export async function exportEditorialToPng(
  state: EditorialState,
  pageRatio: PageRatioPreset,
  preset: EditorialPreset
): Promise<string> {
  const typography = state.typography || preset.defaultTypography;
  const template = getEditorialTemplate(preset.id || state.presetId);
  const layoutType = preset.features?.layoutType || 'newspaper';

  // 1. 确保字体已加载
  try {
    await Promise.all([
      loadFontFamily(typography.headlineFont),
      loadFontFamily(typography.bodyFont),
      typography.accentFont ? loadFontFamily(typography.accentFont) : Promise.resolve(),
    ]);
    if (document.fonts) {
      await document.fonts.ready;
    }
  } catch {
    // 降级使用备选字体
  }

  // 2. 预加载所有图片素材
  const imageElements = new Map<string, HTMLImageElement>();
  if (state.images && state.images.length > 0) {
    await Promise.all(
      state.images.map(async (item) => {
        try {
          const img = await loadImage(item.src);
          imageElements.set(item.id, img);
        } catch {
          // 单图加载失败不中断整体渲染
        }
      })
    );
  }

  // 3. 计算排版投影
  const layout = computeEditorialLayout(state, pageRatio, preset);
  const { pageWidth: W, pageHeight: H } = layout;

  // 4. 创建离屏 Canvas
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to create Canvas 2D context');

  // 5. 绘制背景
  const bg = state.background || preset.defaultBackground;
  ctx.fillStyle = bg.color || '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // 5.1 新闻纸微噪点纹理
  if (bg.hasPaperNoise || layoutType === 'newspaper') {
    ctx.save();
    ctx.fillStyle = 'rgba(31, 28, 23, 0.04)';
    const step = 16;
    for (let x = 0; x < W; x += step) {
      for (let y = 0; y < H; y += step) {
        ctx.fillRect(x + (y % 2 ? 4 : 0), y, 1.5, 1.5);
      }
    }
    ctx.restore();
  }

  const article = state.article || preset.defaultArticle;
  const textColor = typography.textColor || '#1a1a1a';
  const accentColor = typography.accentColor || '#000000';
  const secondaryColor = typography.secondaryColor || 'rgba(0,0,0,0.5)';

  // 6. 委托独立模板绘制专属装饰层 (Strategy Pattern)
  template.drawDecorations?.(ctx, {
    state,
    article,
    typography,
    pageRatio,
    layoutProjection: layout,
    W,
    H,
    textColor,
    accentColor,
    secondaryColor,
  });

  // 7. 通用刊头与分割线（当非特定模板时降级渲染）
  if (article.masthead && !preset.features.hasDatelineRule && layoutType !== 'inverted') {
    const mastheadY = Math.round(H * 0.045);
    const mX = Math.round(W * 0.065);
    ctx.save();
    ctx.fillStyle = layoutType === 'minimal' ? secondaryColor : accentColor;
    ctx.font = `bold ${Math.round(W * 0.013)}px ${typography.headlineFont}`;
    ctx.textBaseline = 'middle';

    if (layoutType === 'minimal') {
      ctx.textAlign = 'center';
      ctx.fillText(article.masthead.toUpperCase(), W / 2, mastheadY);
    } else {
      ctx.fillText(article.masthead.toUpperCase(), mX, mastheadY);
      if (article.issueDate) {
        ctx.textAlign = 'right';
        ctx.fillText(article.issueDate, W - mX, mastheadY);
      }
    }

    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mX, mastheadY + Math.round(H * 0.012));
    ctx.lineTo(W - mX, mastheadY + Math.round(H * 0.012));
    ctx.stroke();
    ctx.restore();
  }

  // 8. 绘制图片素材（支持画框与立体阴影）
  for (let i = 0; i < state.images.length; i++) {
    const item = state.images[i]!;
    const imgEl = imageElements.get(item.id);
    if (!imgEl) continue;

    const imgW = (item.width / 100) * W;
    const naturalRatio =
      item.aspectRatio ||
      (imgEl.naturalWidth && imgEl.naturalHeight
        ? imgEl.naturalWidth / imgEl.naturalHeight
        : 1);
    const imgH = imgW / naturalRatio;
    const imgX = (item.x / 100) * W;
    const imgY = (item.y / 100) * H;

    ctx.save();
    const cx = imgX + imgW / 2;
    const cy = imgY + imgH / 2;
    ctx.translate(cx, cy);
    if (item.rotation) {
      ctx.rotate((item.rotation * Math.PI) / 180);
    }

    // 双图画廊装裱内衬画框
    if (preset.features.hasFrameBorder) {
      const pad = 14;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
      ctx.shadowBlur = 32;
      ctx.shadowOffsetY = 12;
      ctx.fillRect(-imgW / 2 - pad, -imgH / 2 - pad, imgW + pad * 2, imgH + pad * 2);

      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-imgW / 2 - pad, -imgH / 2 - pad, imgW + pad * 2, imgH + pad * 2);
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 8;
    }

    ctx.drawImage(imgEl, -imgW / 2, -imgH / 2, imgW, imgH);
    ctx.restore();

    // 绘制图注 (Caption)
    if (item.caption) {
      ctx.save();
      ctx.fillStyle = secondaryColor;
      ctx.font = `500 ${Math.round(typography.bodyFontSize * 0.72)}px ${typography.accentFont || typography.bodyFont}`;
      ctx.fillText(item.caption, imgX, imgY + imgH + Math.round(typography.bodyFontSize * 1.0));
      ctx.restore();
    }
  }

  // 9. 绘制大标题 (Headline)
  ctx.save();
  ctx.fillStyle = layoutType === 'inverted' ? '#ffffff' : textColor;
  ctx.font = layout.headlineFont;
  ctx.textBaseline = 'top';

  if (layoutType === 'bold_poster') {
    ctx.translate(layout.headlineRegion.x, layout.headlineRegion.y);
    ctx.rotate((-4 * Math.PI) / 180);
    for (let i = 0; i < layout.headlineLines.length; i++) {
      const line = layout.headlineLines[i]!;
      ctx.fillText(line.text, line.x - layout.headlineRegion.x, line.y - layout.headlineRegion.y);
    }
  } else if (layoutType === 'minimal') {
    ctx.textAlign = 'center';
    for (let i = 0; i < layout.headlineLines.length; i++) {
      const line = layout.headlineLines[i]!;
      ctx.fillText(line.text, W / 2, line.y);
    }
  } else {
    for (let i = 0; i < layout.headlineLines.length; i++) {
      const line = layout.headlineLines[i]!;
      ctx.fillText(line.text, line.x, line.y);
    }
  }
  ctx.restore();

  // 10. 绘制导语 (Deck)
  if (layout.deckLines.length > 0) {
    ctx.save();
    ctx.fillStyle = layoutType === 'inverted' ? '#333333' : 'rgba(0,0,0,0.78)';
    ctx.font = `italic 500 ${Math.round(typography.bodyFontSize * 1.2)}px ${typography.headlineFont}`;
    ctx.textBaseline = 'top';
    for (let i = 0; i < layout.deckLines.length; i++) {
      const line = layout.deckLines[i]!;
      ctx.fillText(line.text, line.x, line.y);
    }

    if (preset.features.hasAccentRule && layout.deckRegion) {
      const lastDeckLine = layout.deckLines[layout.deckLines.length - 1];
      const barY = (lastDeckLine ? lastDeckLine.y : layout.deckRegion.y) + Math.round(typography.bodyFontSize * 1.8);
      ctx.fillStyle = accentColor;
      ctx.fillRect(layout.deckRegion.x, barY, Math.round(W * 0.06), 3.5);
    }
    ctx.restore();
  }

  // 11. 绘制金句引语卡片 (Pullquote Card)
  if (layout.pullquote && layout.pullquoteCardRect && layoutType !== 'quote') {
    const pqRect = layout.pullquoteCardRect;
    ctx.save();
    ctx.fillStyle = 'rgba(184, 90, 58, 0.08)';
    ctx.fillRect(pqRect.x, pqRect.y, pqRect.width, pqRect.height);

    ctx.fillStyle = accentColor;
    ctx.fillRect(pqRect.x, pqRect.y, 4, pqRect.height);

    ctx.fillStyle = textColor;
    ctx.font = layout.pullquote.font;
    ctx.textBaseline = 'top';

    for (let i = 0; i < layout.pullquote.lines.length; i++) {
      const line = layout.pullquote.lines[i]!;
      ctx.fillText(line.text, line.x, line.y);
    }
    ctx.restore();
  }

  // 12. 绘制首字下沉 (Drop Cap)
  if (layout.dropCap) {
    ctx.save();
    ctx.fillStyle = accentColor;
    ctx.font = layout.dropCap.font;
    ctx.textBaseline = 'top';

    if (layoutType === 'minimal') {
      const boxPad = 4;
      ctx.strokeStyle = 'rgba(139, 94, 60, 0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        layout.dropCap.x - boxPad,
        layout.dropCap.y - boxPad,
        layout.dropCap.width + boxPad,
        layout.dropCap.height + boxPad * 2
      );
    }

    ctx.fillText(layout.dropCap.text, layout.dropCap.x, layout.dropCap.y);
    ctx.restore();
  }

  // 13. 绘制正文行 (Body Lines)
  ctx.save();
  ctx.fillStyle = textColor;
  ctx.font = `${typography.bodyFontSize}px ${typography.bodyFont}`;
  ctx.textBaseline = 'top';

  for (let i = 0; i < layout.bodyLines.length; i++) {
    const line = layout.bodyLines[i]!;
    ctx.fillText(line.text, line.x, line.y);
  }
  ctx.restore();

  // 14. 绘制底部版记与条形码 (Folio & Barcode)
  const footerY = H - Math.round(H * 0.038);
  const mX = Math.round(W * 0.065);
  ctx.save();
  ctx.fillStyle = secondaryColor;
  ctx.font = `600 ${Math.round(W * 0.0115)}px ${typography.accentFont || typography.headlineFont}`;
  ctx.textBaseline = 'middle';

  if (article.folio) {
    ctx.fillText(article.folio.toUpperCase(), mX, footerY);
  }

  if (article.issueDate && layoutType !== 'newspaper') {
    ctx.textAlign = 'right';
    ctx.fillText(article.issueDate, W - mX, footerY);
  }

  if (preset.features.hasBarcode) {
    drawBarcode(
      ctx,
      mX,
      footerY - Math.round(H * 0.028),
      Math.round(W * 0.13),
      Math.round(H * 0.018),
      textColor
    );
  }
  ctx.restore();

  return canvas.toDataURL('image/png');
}
