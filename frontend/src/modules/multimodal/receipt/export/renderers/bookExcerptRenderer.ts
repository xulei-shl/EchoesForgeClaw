import { getReceiptTheme } from '../../themes';
import type { ReceiptState } from '../../types';
import { ensureFontsReady, drawDashedLine } from '../common/canvasUtils';

/**
 * 绘制清新文艺书摘小票 (Book Excerpt Export Engine - 1:1 所见即所得像素级导出)
 */
export async function exportBookExcerptImage(
  state: ReceiptState,
  scale = 2
): Promise<string> {
  await ensureFontsReady();

  const theme = getReceiptTheme(state.themeId || 'sage');
  const baseWidth = 520;
  const baseHeight = 700;

  const minchoFont =
    "'Huiwen-mincho', 'Huiwen Mincho', 'Shippori Mincho B1', 'Shippori Mincho', 'Songti SC', 'Noto Serif SC', 'Source Han Serif SC', serif";

  const canvas = document.createElement('canvas');
  canvas.width = baseWidth * scale;
  canvas.height = baseHeight * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');

  ctx.scale(scale, scale);

  // 1. 绘制背景与外边框
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, baseWidth, baseHeight);

  // 1.1 叠加复古纸张微光晕 (Subtle Vignette)
  ctx.save();
  const vignetteGrad = ctx.createRadialGradient(
    baseWidth / 2,
    baseHeight * 0.25,
    baseWidth * 0.15,
    baseWidth / 2,
    baseHeight * 0.5,
    baseHeight * 0.75
  );
  vignetteGrad.addColorStop(0, 'rgba(255, 255, 255, 0.26)');
  vignetteGrad.addColorStop(1, 'rgba(0, 0, 0, 0.035)');
  ctx.fillStyle = vignetteGrad;
  ctx.fillRect(0, 0, baseWidth, baseHeight);

  // 1.2 注入细腻天然纸浆微颗粒噪点
  const grainCount = Math.floor(baseWidth * baseHeight * 0.04);
  for (let i = 0; i < grainCount; i++) {
    const gx = Math.random() * baseWidth;
    const gy = Math.random() * baseHeight;
    const isDark = Math.random() > 0.5;
    ctx.fillStyle = isDark ? 'rgba(50, 70, 50, 0.03)' : 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(gx, gy, 1, 1);
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, baseWidth, baseHeight);

  // 2. 绘制古籍四周双边框（外粗内细文武边）
  const outerMargin = 16;
  ctx.save();
  // ① 外粗线 (2.5px)
  ctx.strokeStyle = `color-mix(in srgb, ${theme.text} 85%, transparent)`;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(
    outerMargin,
    outerMargin,
    baseWidth - outerMargin * 2,
    baseHeight - outerMargin * 2 - 10
  );

  // ② 内细线 (0.8px，间隔 4px)
  const innerMargin = outerMargin + 4;
  ctx.strokeStyle = `color-mix(in srgb, ${theme.text} 45%, transparent)`;
  ctx.lineWidth = 0.8;
  ctx.strokeRect(
    innerMargin,
    innerMargin,
    baseWidth - innerMargin * 2,
    baseHeight - innerMargin * 2 - 10
  );
  ctx.restore();

  const contentLeft = innerMargin + 20;
  const contentRight = baseWidth - innerMargin - 20;
  const maxLineW = contentRight - contentLeft;

  // 3. 顶部 Header：左上角 @账号，中央 古籍鱼尾，右上角 ■ 003 编号
  let curY = innerMargin + 28;
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.text;
  ctx.font = "14px 'JetBrains Mono', 'Cutive Mono', monospace";
  ctx.fillText(state.userHandle || '@SH-LIBRARY', contentLeft, curY);

  // 中央古籍版心鱼尾
  ctx.save();
  const fishX = baseWidth / 2;
  const fishY = curY - 10;
  ctx.fillStyle = `color-mix(in srgb, ${theme.text} 80%, transparent)`;
  ctx.beginPath();
  ctx.moveTo(fishX - 11, fishY);
  ctx.lineTo(fishX + 11, fishY);
  ctx.lineTo(fishX + 11, fishY + 4);
  ctx.lineTo(fishX, fishY + 9);
  ctx.lineTo(fishX - 11, fishY + 4);
  ctx.closePath();
  ctx.fill();

  // 鱼尾内嵌细线
  ctx.fillStyle = theme.bg;
  ctx.beginPath();
  ctx.moveTo(fishX - 7, fishY + 2);
  ctx.lineTo(fishX + 7, fishY + 2);
  ctx.lineTo(fishX + 7, fishY + 3.5);
  ctx.lineTo(fishX, fishY + 7);
  ctx.lineTo(fishX - 7, fishY + 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 右上角 ■ 003
  const serialNo = state.serialNumber || '003';
  ctx.font = "bold 14px 'JetBrains Mono', 'Cutive Mono', monospace";
  const serialText = serialNo;
  const serialTextW = ctx.measureText(serialText).width;
  const squareSize = 9;
  const squareX = contentRight - serialTextW - squareSize - 6;

  ctx.fillStyle = theme.accent || theme.text;
  ctx.fillRect(squareX, curY - 11, squareSize, squareSize);

  ctx.fillStyle = theme.text;
  ctx.textAlign = 'right';
  ctx.fillText(serialText, contentRight, curY);

  curY += 66;

  // 4. 大标题：「书摘分享」（汇文明朝体大字号）
  ctx.textAlign = 'center';
  ctx.fillStyle = theme.text;
  ctx.font = `500 44px ${minchoFont}`;
  // 模拟字间距
  const titleText = state.storeName || '书摘分享';
  const spacedTitle = titleText.split('').join('  ');
  ctx.fillText(spacedTitle, baseWidth / 2, curY);

  curY += 22;

  // 细虚线
  drawDashedLine(
    ctx,
    curY,
    baseWidth - innerMargin * 2 - 20,
    theme.dashed || `color-mix(in srgb, ${theme.text} 26%, transparent)`
  );

  curY += 16;

  // 英文反白胶囊横幅：BOOK EXCERPT SHARING
  const bannerText = state.englishBanner || 'BOOK EXCERPT SHARING';
  ctx.font = "900 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  const bannerTextW = ctx.measureText(bannerText).width;
  const bannerPadX = 16;
  const bannerBoxW = bannerTextW + bannerPadX * 2;
  const bannerBoxH = 24;
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

  const bannerBottomY = curY + bannerBoxH;

  // 5. 中段中文书摘（单段中文 + 浅绿横线笔记本底纹，在上下两部分之间动态垂直居中）
  const excerptText = state.excerptText || '催促不会改变什么、毕竟谁都不会硬着头皮犁冬天的地。';
  const cnLineHeight = 40;

  ctx.font = "21px 'Zhi Mang Xing', 'LXGW WenKai', cursive";
  ctx.fillStyle = theme.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // 中文自动换行
  const cnChars = Array.from(excerptText);
  let curCnLine = '';
  const cnLines: string[] = [];
  for (let i = 0; i < cnChars.length; i++) {
    const char = cnChars[i];
    if (char === '\n') {
      cnLines.push(curCnLine);
      curCnLine = '';
      continue;
    }
    const testLine = curCnLine + char;
    if (ctx.measureText(testLine).width > maxLineW) {
      cnLines.push(curCnLine);
      curCnLine = char;
    } else {
      curCnLine = testLine;
    }
  }
  if (curCnLine) cnLines.push(curCnLine);

  const totalLinedRows = Math.max(4, cnLines.length + 1);
  const totalContentHeight = totalLinedRows * cnLineHeight;
  const metaTopY = baseHeight - innerMargin - 94;

  // 动态垂直居中起始 Y
  const startExcerptY =
    bannerBottomY + Math.max(16, (metaTopY - bannerBottomY - totalContentHeight) / 2);

  for (let r = 0; r < totalLinedRows; r++) {
    const rowY = startExcerptY + r * cnLineHeight;

    // 绘制横线笔记本底纹下划线
    ctx.save();
    ctx.strokeStyle = `color-mix(in srgb, ${theme.text} 22%, transparent)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(contentLeft, rowY + 6);
    ctx.lineTo(contentRight, rowY + 6);
    ctx.stroke();
    ctx.restore();

    // 绘制该行中文文字
    if (r < cnLines.length) {
      ctx.fillStyle = theme.text;
      ctx.fillText(cnLines[r], contentLeft, rowY);
    }
  }

  // 6. 底部右下角图书元数据（题名 + 作者 + 出版社·出版年，汇文明朝体风格）
  const metaFields = state.metaFields || [];
  const rawTitle = metaFields.find((f) => f.key === 'title')?.value || '明亮的夜晚';
  const titleVal = rawTitle.replace(/^《+|》+$/g, '').trim() || rawTitle;
  const authorVal = metaFields.find((f) => f.key === 'author')?.value || '崔恩荣';
  const pubInfoVal = metaFields.find((f) => f.key === 'pub_info')?.value || '光启书局 · 2026';

  let metaY = baseHeight - innerMargin - 92;
  ctx.textAlign = 'right';

  // ① 题名（明朝体，无书名号）
  ctx.save();
  ctx.font = `500 28px ${minchoFont}`;
  ctx.fillStyle = theme.text;
  ctx.fillText(titleVal, contentRight, metaY);
  ctx.restore();

  metaY += 28;

  // ② 作者署名（明朝体）
  ctx.save();
  ctx.fillStyle = theme.text;
  ctx.font = `400 16px ${minchoFont}`;
  ctx.fillText(authorVal, contentRight, metaY);
  ctx.restore();

  metaY += 22;

  // ③ 出版社 · 出版年（明朝体）
  ctx.save();
  ctx.fillStyle = theme.faint;
  ctx.font = `400 13px ${minchoFont}`;
  ctx.fillText(pubInfoVal, contentRight, metaY);
  ctx.restore();

  // ④ 索书号（等宽字体，最弱层级收尾；留空不绘制）
  const callNoVal = (state.callNumber || '').trim();
  if (callNoVal) {
    metaY += 19;
    ctx.save();
    ctx.fillStyle = theme.faint;
    ctx.font = "400 11px 'JetBrains Mono', 'Cutive Mono', monospace";
    ctx.fillText(callNoVal, contentRight, metaY);
    ctx.restore();
  }

  // 7. 底部锯齿撕纸边
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

