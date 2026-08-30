/**
 * 杂志排版离屏 Canvas 高保真渲染与导出器 (canvasExporter)
 * 复用 Pretext 计算出的精确几何坐标，所见即所得输出 300DPI 印刷级 PNG
 */

import type { EditorialPreset, EditorialState, PageRatioPreset } from '../types';
import { computeEditorialLayout } from '../engine/layoutEngine';
import { loadFontFamily } from '../../journal/text/fontRegistry';

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
 * 绘制极简现代条形码装饰
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

  // 1. 确保字体已加载
  try {
    await Promise.all([
      loadFontFamily(typography.headlineFont),
      loadFontFamily(typography.bodyFont),
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

  const article = state.article || preset.defaultArticle;
  const textColor = typography.textColor || '#1a1a1a';
  const accentColor = typography.accentColor || '#000000';

  // 6. 绘制侧边黑色 Ribbon 标签（若预设开启）
  if (preset.features.hasRibbonTag) {
    const ribbonW = Math.round(W * 0.08);
    const ribbonH = Math.round(H * 0.16);
    ctx.fillStyle = '#000000';
    ctx.fillRect(Math.round(W * 0.06), 0, ribbonW, ribbonH);

    ctx.save();
    ctx.translate(Math.round(W * 0.06) + ribbonW / 2, ribbonH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(W * 0.022)}px ${typography.headlineFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(article.issueDate ? `ISSUE ${article.issueDate}` : 'ISSUE 08', 0, 0);
    ctx.restore();
  }

  // 7. 绘制刊头 (Masthead) 与分割线
  if (article.masthead) {
    const mastheadY = Math.round(H * 0.05);
    ctx.save();
    ctx.fillStyle = accentColor;
    ctx.font = `bold ${Math.round(W * 0.014)}px ${typography.headlineFont}`;
    ctx.letterSpacing = '1px';
    ctx.textBaseline = 'middle';
    ctx.fillText(article.masthead.toUpperCase(), Math.round(W * 0.065), mastheadY);

    // 细分割线
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(W * 0.065), mastheadY + Math.round(H * 0.012));
    ctx.lineTo(W - Math.round(W * 0.065), mastheadY + Math.round(H * 0.012));
    ctx.stroke();
    ctx.restore();
  }

  // 8. 绘制图片素材
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

    // 图片阴影
    ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;

    // 绘制图片
    ctx.drawImage(imgEl, -imgW / 2, -imgH / 2, imgW, imgH);
    ctx.restore();

    // 绘制图注 (Caption)
    if (item.caption) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.font = `${Math.round(typography.bodyFontSize * 0.7)}px ${typography.bodyFont}`;
      ctx.fillText(item.caption, imgX, imgY + imgH + Math.round(typography.bodyFontSize * 0.9));
      ctx.restore();
    }
  }

  // 9. 绘制大标题 (Headline)
  ctx.save();
  ctx.fillStyle = textColor;
  ctx.font = layout.headlineFont;
  ctx.textBaseline = 'top';

  for (let i = 0; i < layout.headlineLines.length; i++) {
    const line = layout.headlineLines[i]!;
    ctx.fillText(line.text, line.x, line.y);
  }
  ctx.restore();

  // 10. 绘制导语 (Deck)
  if (layout.deckLines.length > 0) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.font = `500 ${Math.round(typography.bodyFontSize * 1.25)}px ${typography.headlineFont}`;
    ctx.textBaseline = 'top';
    for (let i = 0; i < layout.deckLines.length; i++) {
      const line = layout.deckLines[i]!;
      ctx.fillText(line.text, line.x, line.y);
    }
    ctx.restore();
  }

  // 11. 绘制首字下沉 (Drop Cap)
  if (layout.dropCap) {
    ctx.save();
    ctx.fillStyle = accentColor;
    ctx.font = layout.dropCap.font;
    ctx.textBaseline = 'top';
    ctx.fillText(layout.dropCap.text, layout.dropCap.x, layout.dropCap.y);
    ctx.restore();
  }

  // 12. 绘制正文行 (Body Lines)
  ctx.save();
  ctx.fillStyle = textColor;
  ctx.font = `${typography.bodyFontSize}px ${typography.bodyFont}`;
  ctx.textBaseline = 'top';

  for (let i = 0; i < layout.bodyLines.length; i++) {
    const line = layout.bodyLines[i]!;
    ctx.fillText(line.text, line.x, line.y);
  }
  ctx.restore();

  // 13. 绘制引语卡片 (Pull Quote)
  if (article.pullquote && article.pullquote.trim()) {
    const pqFont = `italic bold ${Math.round(typography.bodyFontSize * 1.2)}px ${typography.headlineFont}`;
    ctx.save();
    ctx.fillStyle = accentColor;
    ctx.font = pqFont;
    // 可以在特定位置或预设指示区绘制
    ctx.restore();
  }

  // 14. 绘制底部版记与条形码 (Folio & Barcode)
  const footerY = H - Math.round(H * 0.045);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.font = `600 ${Math.round(W * 0.012)}px ${typography.headlineFont}`;
  ctx.textBaseline = 'middle';

  if (article.folio) {
    ctx.fillText(article.folio.toUpperCase(), Math.round(W * 0.065), footerY);
  }

  if (article.issueDate) {
    ctx.textAlign = 'right';
    ctx.fillText(article.issueDate, W - Math.round(W * 0.065), footerY);
  }

  if (preset.features.hasBarcode) {
    drawBarcode(
      ctx,
      Math.round(W * 0.065),
      footerY - Math.round(H * 0.028),
      Math.round(W * 0.14),
      Math.round(H * 0.02),
      '#000000'
    );
  }
  ctx.restore();

  return canvas.toDataURL('image/png');
}
