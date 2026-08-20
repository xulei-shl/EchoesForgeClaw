import { getReceiptTheme } from '../../themes';
import type { ReceiptState } from '../../types';
import { ensureFontsReady, loadImageSafe } from '../common/canvasUtils';

/**
 * 绘制古籍版心书签 (Ancient Bookmark Export Engine - 1:1 所见即所得矢量与正片叠底印章导出)
 */
export async function exportAncientBookmarkImage(
  state: ReceiptState,
  scale = 2
): Promise<string> {
  await ensureFontsReady();

  const theme = getReceiptTheme(state.themeId || 'ancient');
  const baseWidth = 360;
  const baseHeight = 840;

  const minchoFont =
    "'Huiwen-mincho', 'Huiwen Mincho', '又又意宋', 'Shippori Mincho B1', 'Shippori Mincho', 'Songti SC', 'Noto Serif SC', 'Source Han Serif SC', serif";
  const kaitiFont =
    "'Kaiti SC', 'STKaiti', 'KaiTi', '楷体', 'LXGW WenKai', serif";

  const canvas = document.createElement('canvas');
  canvas.width = baseWidth * scale;
  canvas.height = baseHeight * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');

  ctx.scale(scale, scale);

  // -------------------------------------------------------------
  // 1. 绘制做旧纸张背景（径向渐变模拟纸张老化：中亮缘暗）
  // -------------------------------------------------------------
  ctx.save();
  const bgGrad = ctx.createRadialGradient(
    baseWidth * 0.5,
    baseHeight * 0.42,
    baseWidth * 0.1,
    baseWidth * 0.5,
    baseHeight * 0.5,
    baseHeight * 0.65
  );
  bgGrad.addColorStop(0, '#ebdcb8');
  bgGrad.addColorStop(0.7, theme.bg || '#e4d1a9');
  bgGrad.addColorStop(1, '#cca972');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, baseWidth, baseHeight);

  // 叠加细腻天然纸浆微颗粒噪点
  const grainCount = Math.floor(baseWidth * baseHeight * 0.035);
  for (let i = 0; i < grainCount; i++) {
    const gx = Math.random() * baseWidth;
    const gy = Math.random() * baseHeight;
    const isDark = Math.random() > 0.5;
    ctx.fillStyle = isDark ? 'rgba(90, 60, 20, 0.04)' : 'rgba(255, 255, 255, 0.06)';
    ctx.fillRect(gx, gy, 1, 1);
  }
  ctx.restore();

  // -------------------------------------------------------------
  // 2. 绘制古籍外框与内框（文武边）
  // -------------------------------------------------------------
  const outerBorderWidth = 5;
  const outerPadding = 5;

  // 外粗框 (5px)
  ctx.save();
  ctx.strokeStyle = theme.text;
  ctx.lineWidth = outerBorderWidth;
  ctx.strokeRect(
    outerBorderWidth / 2,
    outerBorderWidth / 2,
    baseWidth - outerBorderWidth,
    baseHeight - outerBorderWidth
  );

  // 内细框 (1.2px)
  const innerX = outerBorderWidth + outerPadding;
  const innerY = outerBorderWidth + outerPadding;
  const innerW = baseWidth - (outerBorderWidth + outerPadding) * 2;
  const innerH = baseHeight - (outerBorderWidth + outerPadding) * 2;

  ctx.strokeStyle = theme.text;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(innerX, innerY, innerW, innerH);
  ctx.restore();

  // -------------------------------------------------------------
  // 3. 绘制左侧版心区 (Banxin Area)
  // -------------------------------------------------------------
  const banxinW = 56;
  const banxinRightX = innerX + banxinW;

  // 版心右分割线
  ctx.save();
  ctx.strokeStyle = theme.text;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(banxinRightX, innerY);
  ctx.lineTo(banxinRightX, innerY + innerH);
  ctx.stroke();
  ctx.restore();

  // 版心中轴 X
  const banxinCenterX = innerX + banxinW / 2;
  const banxinPadY = 24;
  const banxinTopY = innerY + banxinPadY;
  const banxinBottomY = innerY + innerH - banxinPadY;

  // 版心题名文字
  const banxinTitle = state.banxinTitle || state.storeName || '資治通鑑';
  const banxinFontSize = 18;
  const banxinLetterSpacing = 7;
  const banxinChars = Array.from(banxinTitle);
  const banxinTitleHeight =
    banxinChars.length * banxinFontSize + (banxinChars.length - 1) * banxinLetterSpacing;

  const fishtailH = 38;
  const fishtailW = 24;
  const banxinCenterY = (banxinTopY + banxinBottomY) / 2;
  const banxinTitleStartY = banxinCenterY - banxinTitleHeight / 2;

  const fishtailTopY = banxinTitleStartY - fishtailH - 12;
  const fishtailBottomY = banxinTitleStartY + banxinTitleHeight + 12;

  // ① 上象鼻线
  ctx.save();
  ctx.strokeStyle = theme.text;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(banxinCenterX, banxinTopY);
  ctx.lineTo(banxinCenterX, fishtailTopY);
  ctx.stroke();

  // ② 上鱼尾 (clipPath: 0 0, 100% 0, 100% 100%, 50% 65%, 0 100%)
  ctx.fillStyle = theme.text;
  ctx.beginPath();
  ctx.moveTo(banxinCenterX - fishtailW / 2, fishtailTopY);
  ctx.lineTo(banxinCenterX + fishtailW / 2, fishtailTopY);
  ctx.lineTo(banxinCenterX + fishtailW / 2, fishtailTopY + fishtailH);
  ctx.lineTo(banxinCenterX, fishtailTopY + fishtailH * 0.65);
  ctx.lineTo(banxinCenterX - fishtailW / 2, fishtailTopY + fishtailH);
  ctx.closePath();
  ctx.fill();

  // ③ 绘制竖排版心题名
  ctx.font = `500 ${banxinFontSize}px ${minchoFont}`;
  ctx.fillStyle = theme.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let curBanxinY = banxinTitleStartY;
  for (const char of banxinChars) {
    ctx.fillText(char, banxinCenterX, curBanxinY + banxinFontSize / 2);
    curBanxinY += banxinFontSize + banxinLetterSpacing;
  }

  // ④ 下鱼尾 (clipPath: 0 0, 50% 35%, 100% 0, 100% 100%, 0 100%)
  ctx.beginPath();
  ctx.moveTo(banxinCenterX - fishtailW / 2, fishtailBottomY);
  ctx.lineTo(banxinCenterX, fishtailBottomY + fishtailH * 0.35);
  ctx.lineTo(banxinCenterX + fishtailW / 2, fishtailBottomY);
  ctx.lineTo(banxinCenterX + fishtailW / 2, fishtailBottomY + fishtailH);
  ctx.lineTo(banxinCenterX - fishtailW / 2, fishtailBottomY + fishtailH);
  ctx.closePath();
  ctx.fill();

  // ⑤ 下象鼻线
  ctx.beginPath();
  ctx.moveTo(banxinCenterX, fishtailBottomY + fishtailH);
  ctx.lineTo(banxinCenterX, banxinBottomY);
  ctx.stroke();
  ctx.restore();

  // -------------------------------------------------------------
  // 4. 绘制右侧正文区乌丝栏与竖排文字
  // -------------------------------------------------------------
  const contentAreaX = banxinRightX;
  const actualContentW = innerW - banxinW;
  const colW = actualContentW / 3;

  // 乌丝栏分割线（两道垂直墨线，将正文分为 3 列）
  ctx.save();
  ctx.strokeStyle = `color-mix(in srgb, ${theme.text} 55%, transparent)`;
  ctx.lineWidth = 1;
  const colLine1X = contentAreaX + colW;
  const colLine2X = contentAreaX + colW * 2;

  ctx.beginPath();
  ctx.moveTo(colLine1X, innerY);
  ctx.lineTo(colLine1X, innerY + innerH);
  ctx.moveTo(colLine2X, innerY);
  ctx.lineTo(colLine2X, innerY + innerH);
  ctx.stroke();
  ctx.restore();

  // 辅助函数：绘制竖排文字
  const drawVerticalColumnText = (
    text: string,
    centerX: number,
    startY: number,
    fontSize: number,
    letterSpacing: number,
    fontFamily: string,
    fontWeight = 'normal',
    color = theme.text
  ) => {
    ctx.save();
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const chars = Array.from(text);
    let y = startY;
    for (const char of chars) {
      if (char === '\n') {
        continue;
      }
      ctx.fillText(char, centerX, y + fontSize / 2);
      y += fontSize + letterSpacing;
    }
    ctx.restore();
    return y;
  };

  // ---------- 第一列（最右侧）：书名 + 卷号 ----------
  const col1CenterX = contentAreaX + colW * 2 + colW / 2;
  const bookTitle = state.storeName || '资治通鉴';
  const volumeText = state.bookmarkVolume || '卷第一';

  const col1StartY = innerY + 36;
  const afterTitleY = drawVerticalColumnText(
    bookTitle,
    col1CenterX,
    col1StartY,
    34,
    11,
    minchoFont,
    'bold'
  );

  drawVerticalColumnText(
    volumeText,
    col1CenterX,
    afterTitleY + 28,
    20,
    6,
    kaitiFont,
    '500'
  );

  // ---------- 第二列（中间）：精彩文摘 / 提要 ----------
  const col2CenterX = contentAreaX + colW + colW / 2;
  const rawExcerpt = state.bookmarkExcerpt || '起著雍摄提格\n尽玄黓困敦';
  const excerptLines = rawExcerpt.split('\n').filter(Boolean);

  if (excerptLines.length === 1) {
    drawVerticalColumnText(
      excerptLines[0],
      col2CenterX,
      innerY + 110,
      19,
      5,
      kaitiFont,
      'normal'
    );
  } else {
    // 若有多行，微移分两小列渲染
    const subOffset = 14;
    if (excerptLines[0]) {
      drawVerticalColumnText(
        excerptLines[0],
        col2CenterX + subOffset,
        innerY + 80,
        18,
        5,
        kaitiFont,
        'normal'
      );
    }
    if (excerptLines[1]) {
      drawVerticalColumnText(
        excerptLines[1],
        col2CenterX - subOffset,
        innerY + 100,
        18,
        5,
        kaitiFont,
        'normal'
      );
    }
  }

  // ---------- 第三列（最左侧）：著者署名 + 出版社/年份 ----------
  const col3CenterX = contentAreaX + colW / 2;
  const rawExtra = state.bookmarkExtra || '司马光 著\n中华书局 · 2011';
  const extraLines = rawExtra.split('\n').filter(Boolean);

  if (extraLines.length === 1) {
    drawVerticalColumnText(
      extraLines[0],
      col3CenterX,
      innerY + innerH - 180,
      16,
      4,
      kaitiFont,
      'normal'
    );
  } else {
    const subOffset = 12;
    if (extraLines[0]) {
      drawVerticalColumnText(
        extraLines[0],
        col3CenterX + subOffset,
        innerY + innerH - 240,
        16,
        4,
        kaitiFont,
        'normal'
      );
    }
    if (extraLines[1]) {
      drawVerticalColumnText(
        extraLines[1],
        col3CenterX - subOffset,
        innerY + innerH - 210,
        14,
        3.5,
        kaitiFont,
        'normal'
      );
    }
  }

  // -------------------------------------------------------------
  // 5. 异步加载并以正片叠底（multiply）绘制多印章
  // -------------------------------------------------------------
  const seals = state.seals || [];
  for (const seal of seals) {
    if (!seal.src) continue;
    try {
      const sealImg = await loadImageSafe(seal.src);
      if (!sealImg) continue;

      // 计算印章在 Canvas 上的绝对 X, Y 坐标与缩放
      const sealRatio = baseWidth / 260; // 比例因子
      const sealW = (seal.width || 32) * sealRatio;
      const sealAspect = sealImg.height / sealImg.width;
      const sealH = sealW * sealAspect;

      let posX = 0;
      let posY = 0;

      if (seal.positionPreset === 'top-right' || seal.id === 'seal-1') {
        const rOffset = (seal.right ?? 8) * sealRatio;
        const tOffset = (seal.top ?? 24) * sealRatio;
        posX = baseWidth - outerBorderWidth - outerPadding - rOffset - sealW;
        posY = innerY + tOffset;
      } else if (seal.positionPreset === 'bottom-left' || seal.id === 'seal-2') {
        const lOffset = (seal.left ?? 6) * sealRatio;
        const bOffset = (seal.bottom ?? 28) * sealRatio;
        posX = contentAreaX + lOffset;
        posY = innerY + innerH - bOffset - sealH;
      } else if (seal.positionPreset === 'middle-cross' || seal.id === 'seal-3') {
        const topPercent = (seal.topPercent ?? 46) / 100;
        const crossOffset = (seal.left ?? -16) * sealRatio;
        posX = contentAreaX + colW * 2 + crossOffset - sealW / 2;
        posY = innerY + innerH * topPercent - sealH / 2;
      } else if (seal.positionPreset === 'top-left' || seal.id === 'seal-4') {
        const lOffset = (seal.left ?? 8) * sealRatio;
        const tOffset = (seal.top ?? 72) * sealRatio;
        posX = contentAreaX + lOffset;
        posY = innerY + tOffset;
      } else {
        posX = ((seal.left ?? 20) * sealRatio);
        posY = ((seal.top ?? 20) * sealRatio);
      }

      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = seal.opacity ?? 0.85;

      // 旋转与绘制中心对齐
      const centerX = posX + sealW / 2;
      const centerY = posY + sealH / 2;
      ctx.translate(centerX, centerY);
      if (seal.rotate) {
        ctx.rotate((seal.rotate * Math.PI) / 180);
      }
      ctx.drawImage(sealImg, -sealW / 2, -sealH / 2, sealW, sealH);
      ctx.restore();
    } catch {
      // 印章图片加载失败时跳过
    }
  }

  return canvas.toDataURL('image/png', 1.0);
}
