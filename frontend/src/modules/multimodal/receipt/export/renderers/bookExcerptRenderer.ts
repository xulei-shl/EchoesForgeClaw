import { getReceiptTheme } from '../../themes';
import type { ReceiptState } from '../../types';
import { ensureFontsReady, drawDashedLine } from '../common/canvasUtils';

/**
 * 绘制清新文艺书摘小票 (Book Excerpt Export Engine - 所见即所得 100% 对齐)
 */
export async function exportBookExcerptImage(
  state: ReceiptState,
  scale = 2
): Promise<string> {
  await ensureFontsReady();

  const theme = getReceiptTheme(state.themeId);
  const baseWidth = 540;
  const baseHeight = 840;

  const canvas = document.createElement('canvas');
  canvas.width = baseWidth * scale;
  canvas.height = baseHeight * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');

  ctx.scale(scale, scale);

  // 1. 绘制背景与边框
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, baseWidth, baseHeight);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, baseWidth, baseHeight);

  // 2. 顶部行：左上角 @账号，右上角 豆瓣评分
  let curY = 44;
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.text;
  ctx.font = "14px 'JetBrains Mono', 'Cutive Mono', monospace";
  ctx.fillText(state.userHandle || '@Dieforella', 36, curY);

  // 右上角豆瓣评分
  const ratingText = state.rating || '8.9';
  ctx.font = "bold 14px 'JetBrains Mono', 'Cutive Mono', monospace";
  const ratingW = ctx.measureText(ratingText).width + 30;
  const ratingBoxX = baseWidth - 36 - ratingW;
  const ratingBoxY = curY - 16;

  ctx.save();
  ctx.strokeStyle = `color-mix(in srgb, ${theme.text} 25%, transparent)`;
  ctx.fillStyle = `color-mix(in srgb, ${theme.text} 6%, transparent)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(ratingBoxX, ratingBoxY, ratingW, 22, 3);
  } else {
    ctx.rect(ratingBoxX, ratingBoxY, ratingW, 22);
  }
  ctx.fill();
  ctx.stroke();

  // 评分小方块
  ctx.fillStyle = theme.accent || theme.text;
  ctx.fillRect(ratingBoxX + 6, ratingBoxY + 6, 8, 10);

  // 评分数字
  ctx.fillStyle = theme.text;
  ctx.textAlign = 'center';
  ctx.fillText(ratingText, ratingBoxX + 6 + 8 + (ratingW - 14) / 2, curY);
  ctx.restore();

  curY += 42;

  // 3. 大标题：「书摘分享」
  ctx.textAlign = 'center';
  ctx.fillStyle = theme.text;
  ctx.font = "bold 38px 'LXGW WenKai', 'Noto Serif SC', serif";
  ctx.fillText(state.storeName || '书摘分享', baseWidth / 2, curY);

  curY += 26;

  // 精细虚线
  drawDashedLine(ctx, curY, baseWidth, theme.dashed || `color-mix(in srgb, ${theme.text} 30%, transparent)`);

  curY += 16;

  // 英文反白胶囊横幅：BOOK EXCERPT SHARING
  const bannerText = state.englishBanner || 'BOOK EXCERPT SHARING';
  ctx.font = "900 13px 'JetBrains Mono', 'Courier New', sans-serif";
  const bannerTextW = ctx.measureText(bannerText).width;
  const bannerPadX = 18;
  const bannerBoxW = bannerTextW + bannerPadX * 2;
  const bannerBoxH = 26;
  const bannerBoxX = (baseWidth - bannerBoxW) / 2;

  ctx.save();
  ctx.fillStyle = theme.accent || theme.text;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(bannerBoxX, curY, bannerBoxW, bannerBoxH, 3);
  } else {
    ctx.rect(bannerBoxX, curY, bannerBoxW, bannerBoxH);
  }
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(bannerText, baseWidth / 2, curY + bannerBoxH / 2 + 1);
  ctx.restore();

  curY += bannerBoxH + 36;

  // 4. 中段书摘主体（单一段落，带横线底纹与文楷排版）
  const excerptText = state.excerptText || '催促不会改变什么、毕竟谁都不会硬着头皮犁冬天的地。';
  const textLeft = 40;
  const textRight = baseWidth - 40;
  const maxLineW = textRight - textLeft;
  const lineHeight = 42;

  ctx.font = "19px 'LXGW WenKai', 'Zhi Mang Xing', 'Noto Serif SC', serif";
  ctx.fillStyle = theme.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // 自动换行算法
  const chars = Array.from(excerptText);
  let currentLine = '';
  const lines: string[] = [];

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === '\n') {
      lines.push(currentLine);
      currentLine = '';
      continue;
    }
    const testLine = currentLine + char;
    if (ctx.measureText(testLine).width > maxLineW) {
      lines.push(currentLine);
      currentLine = char;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }

  // 绘制 5~6 行横线本底纹并填入文字
  const totalLinedRows = Math.max(5, lines.length + 1);
  for (let r = 0; r < totalLinedRows; r++) {
    const rowY = curY + r * lineHeight;
    // 绘制横线底纹
    ctx.save();
    ctx.strokeStyle = `color-mix(in srgb, ${theme.text} 18%, transparent)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(textLeft - 4, rowY + 6);
    ctx.lineTo(textRight + 4, rowY + 6);
    ctx.stroke();
    ctx.restore();

    // 绘制该行文字
    if (r < lines.length) {
      ctx.fillText(lines[r], textLeft, rowY);
    }
  }

  // 5. 底部右下角图书元数据（题名、作者、出版社·出版年、ISBN）
  const metaFields = state.metaFields || [];
  const titleVal = metaFields.find((f) => f.key === 'title')?.value || '《明亮的夜晚》';
  const authorVal = metaFields.find((f) => f.key === 'author')?.value || '崔恩荣';
  const pubInfoVal = metaFields.find((f) => f.key === 'pub_info')?.value || '台海出版社 · 2023';
  const isbnVal = metaFields.find((f) => f.key === 'isbn')?.value || state.barcodeText || '9787516835159';

  let metaY = baseHeight - 160;
  ctx.textAlign = 'right';

  // ① 题名（大字号《书名》）
  ctx.fillStyle = theme.text;
  ctx.font = "bold 32px 'LXGW WenKai', 'Noto Serif SC', serif";
  ctx.fillText(titleVal, textRight, metaY);

  metaY += 34;

  // ② 作者
  ctx.font = "18px 'LXGW WenKai', 'Noto Serif SC', serif";
  ctx.fillText(authorVal, textRight, metaY);

  metaY += 26;

  // ③ 出版社 · 出版年
  ctx.fillStyle = theme.faint;
  ctx.font = "14px 'LXGW WenKai', 'Noto Serif SC', sans-serif";
  ctx.fillText(pubInfoVal, textRight, metaY);

  metaY += 22;

  // ④ ISBN
  ctx.font = "13px 'JetBrains Mono', 'Cutive Mono', monospace";
  ctx.fillText(`ISBN ${isbnVal}`, textRight, metaY);

  // 6. 底部锯齿撕纸边
  const toothSize = 8;
  const teethCount = Math.floor(baseWidth / (toothSize * 2));
  const step = baseWidth / teethCount;

  ctx.save();
  ctx.fillStyle = theme.bg;
  ctx.beginPath();
  ctx.moveTo(baseWidth, baseHeight);
  for (let i = teethCount; i > 0; i--) {
    const x = (i - 1) * step;
    ctx.lineTo(x + step / 2, baseHeight - toothSize);
    ctx.lineTo(x, baseHeight);
  }
  ctx.lineTo(0, baseHeight);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  return canvas.toDataURL('image/png', 1.0);
}
