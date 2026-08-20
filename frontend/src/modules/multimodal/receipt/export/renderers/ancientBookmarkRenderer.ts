import { getReceiptTheme } from '../../themes';
import {
  getAncientBookmarkWidthConfig,
  type ReceiptState,
} from '../../types';
import { ensureFontsReady, loadImageSafe } from '../common/canvasUtils';
import { parseJuDou } from '../../../../../platform/utils/judou';

/**
 * 绘制古籍版心书签 (Ancient Bookmark Export Engine - 1:1 所见即所得矢量与正片叠底印章导出)
 */
export async function exportAncientBookmarkImage(
  state: ReceiptState,
  scale = 2
): Promise<string> {
  await ensureFontsReady();

  const theme = getReceiptTheme(state.themeId || 'ancient');
  const widthConfig = getAncientBookmarkWidthConfig(state.bookmarkWidth);
  const baseWidth = widthConfig.canvasWidth;
  const baseHeight = 880;

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
  // 1. 绘制固定宣纸肌理背景图 (/assets/receipt/paper.jpg)
  // -------------------------------------------------------------
  ctx.save();
  const bgImg = await loadImageSafe('/assets/receipt/paper.jpg');
  if (bgImg) {
    ctx.drawImage(bgImg, 0, 0, baseWidth, baseHeight);
  } else {
    // 降级兜底：做旧宣纸渐变
    const bgGrad = ctx.createRadialGradient(
      baseWidth * 0.5,
      baseHeight * 0.42,
      baseWidth * 0.1,
      baseWidth * 0.5,
      baseHeight * 0.5,
      baseHeight * 0.65
    );
    bgGrad.addColorStop(0, '#f9f5ed');
    bgGrad.addColorStop(0.7, theme.bg || '#e4d1a9');
    bgGrad.addColorStop(1, '#cca972');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, baseWidth, baseHeight);
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
  // 3. 绘制雕版正文与左侧版心区 (Body Area)
  // -------------------------------------------------------------
  const bodyY = innerY;
  const bodyH = innerH;

  // ---------- 左侧版心区 (Banxin Area) ----------
  const banxinW = 50;
  const banxinRightX = innerX + banxinW;

  // 版心右分割线
  ctx.save();
  ctx.strokeStyle = theme.text;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(banxinRightX, bodyY);
  ctx.lineTo(banxinRightX, bodyY + bodyH);
  ctx.stroke();
  ctx.restore();

  // 版心中轴 X
  const banxinCenterX = innerX + banxinW / 2;
  const banxinPadY = 16;
  const banxinTopY = bodyY + banxinPadY;
  const banxinBottomY = bodyY + bodyH - banxinPadY;

  // 版心题名文字
  const bookTitle = state.storeName || '資治通鑑';
  const banxinTitle = state.banxinTitle || bookTitle;
  const banxinFontSize = 14;
  const banxinLetterSpacing = 5;
  const banxinChars = Array.from(banxinTitle);
  const banxinTitleHeight =
    banxinChars.length * banxinFontSize + (banxinChars.length - 1) * banxinLetterSpacing;

  const fishtailH = 28;
  const fishtailW = 20;
  const banxinCenterY = (banxinTopY + banxinBottomY) / 2;
  const banxinTitleStartY = banxinCenterY - banxinTitleHeight / 2;

  const fishtailTopY = banxinTitleStartY - fishtailH - 10;
  const fishtailBottomY = banxinTitleStartY + banxinTitleHeight + 10;

  // ① 上象鼻线
  ctx.save();
  ctx.strokeStyle = theme.text;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(banxinCenterX, banxinTopY);
  ctx.lineTo(banxinCenterX, fishtailTopY);
  ctx.stroke();

  // ② 上鱼尾 (黑鱼尾)
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

  // ④ 下鱼尾 (黑鱼尾)
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

  // ---------- 乌丝栏与通用古籍竖排正文流 (Ruled Columns & Vertical Flow) ----------
  const contentAreaX = banxinRightX;
  const actualContentW = innerW - banxinW;
  const colW = 42; // 每列乌丝栏宽度
  const totalCols = Math.max(5, Math.floor(actualContentW / colW));

  // 绘制乌丝栏纵向细墨线（贯穿所有列，包含留白列）
  ctx.save();
  ctx.strokeStyle = `color-mix(in srgb, ${theme.text} 40%, transparent)`;
  ctx.lineWidth = 1;
  for (let c = 1; c < totalCols; c++) {
    const colX = contentAreaX + actualContentW - colW * c;
    ctx.beginPath();
    ctx.moveTo(colX, bodyY);
    ctx.lineTo(colX, bodyY + bodyH);
    ctx.stroke();
  }
  ctx.restore();

  // 版心与正文之间的固定空白留白：保留最左侧 1 栏不排布正文，消除“左密右疏”
  const blankBufferCols = 1;
  const colCount = Math.max(3, totalCols - blankBufferCols);

  const startY = bodyY + 16;
  const bottomMaxY = bodyY + bodyH - 18;
  const charFontSize = 17;
  const charSpacing = 6;
  const stepY = charFontSize + charSpacing;

  const colCenterX = (colIdx: number) =>
    contentAreaX + actualContentW - colW * colIdx - colW / 2;

  // ① 第 0 列（最右栏）：书名大字顶格书写
  const fullTitle = state.storeName || '資治通鑑';
  const titleChars = Array.from(fullTitle);
  let titleY = startY;
  ctx.save();
  ctx.font = `bold 20px ${minchoFont}`;
  ctx.fillStyle = theme.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const char of titleChars) {
    if (char === ' ') {
      titleY += 10;
      continue;
    }
    if (titleY + 20 > bottomMaxY) break;
    ctx.fillText(char, colCenterX(0), titleY + 20 / 2);
    titleY += 20 + 7;
  }
  ctx.restore();

  // ② 第 1 列（右起第二栏）：作者责任者，古籍规范低两格书写
  const authorNameVal = state.metaFields?.find((f) => f.key === 'author')?.value || '司马光';
  const authorFullText = `${authorNameVal} 撰`;
  const authorChars = Array.from(authorFullText);
  let authorY = startY + stepY * 2; // 低两格
  ctx.save();
  ctx.font = `normal ${charFontSize}px ${kaitiFont}`;
  ctx.fillStyle = theme.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const char of authorChars) {
    if (char === ' ') {
      authorY += 8;
      continue;
    }
    if (authorY + charFontSize > bottomMaxY) break;
    ctx.fillText(char, colCenterX(1), authorY + charFontSize / 2);
    authorY += stepY;
  }
  ctx.restore();

  // ③ 第 2 列及之后（右起第三栏起）：文摘正文与朱笔句读流式排布
  const rawExcerpt =
    state.bookmarkExcerpt ||
    '起著雍摄提格，尽玄黓困敦。初命晋大夫魏斯、赵籍、韩虔为诸侯。臣光曰：臣闻天子之职莫大于礼，礼莫大于分，分莫大于名。';
  const allTokens = parseJuDou(rawExcerpt, { convertNumbers: true, preserveLineBreaks: true });

  let currentColIdx = 2; // 从第 3 栏开始
  let currentY = startY;

  for (const token of allTokens) {
    if (token.isBreak) {
      // 显式换行：换到下一列
      currentColIdx++;
      currentY = startY;
      if (currentColIdx >= colCount) break;
      continue;
    }

    // 检查当前列是否已满
    if (currentY + charFontSize > bottomMaxY) {
      currentColIdx++;
      currentY = startY;
      if (currentColIdx >= colCount) break;
    }

    const cX = colCenterX(currentColIdx);
    const cY = currentY + charFontSize / 2;

    // 绘制汉字
    ctx.save();
    ctx.font = `normal ${charFontSize}px ${minchoFont}`;
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(token.char, cX, cY);
    ctx.restore();

    // 绘制朱笔句读（朱圈/朱点）
    if (token.judou) {
      const judouX = cX + charFontSize * 0.48;
      const judouY = cY - charFontSize * 0.32;
      ctx.save();
      if (token.judou === 'circle') {
        ctx.strokeStyle = '#b82828';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(judouX, judouY, 3.2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#b82828';
        ctx.beginPath();
        ctx.arc(judouX, judouY, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    currentY += stepY;
  }

  // ④ 末尾列：底部校刊题跋
  const extraText = state.bookmarkExtra || '中华书局 谨印';
  const extraChars = Array.from(extraText.replace(/\n/g, '  '));
  const footerColIdx = Math.min(colCount - 1, Math.max(currentColIdx + 1, colCount - 1));
  const footerCenterX = colCenterX(footerColIdx);

  ctx.save();
  ctx.font = `normal 14px ${kaitiFont}`;
  ctx.fillStyle = theme.text;
  ctx.globalAlpha = 0.8;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let extraY = bodyY + bodyH - (extraChars.length * 18 + 14);
  for (const char of extraChars) {
    ctx.fillText(char, footerCenterX, extraY + 14 / 2);
    extraY += 14 + 5;
  }
  ctx.restore();

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
      const sealRatio = baseWidth / widthConfig.domWidth;
      const sealW = (seal.width || 32) * sealRatio;
      const sealAspect = sealImg.height / sealImg.width;
      const sealH = sealW * sealAspect;

      let centerX = 0;
      let centerY = 0;

      if (seal.leftPercent !== undefined && seal.topPercent !== undefined) {
        centerX = contentAreaX + (seal.leftPercent / 100) * actualContentW;
        centerY = innerY + (seal.topPercent / 100) * innerH;
      } else if (seal.positionPreset === 'top-right' || seal.id === 'seal-1') {
        const rOffset = (seal.right ?? 8) * sealRatio;
        const tOffset = (seal.top ?? 24) * sealRatio;
        const posX = baseWidth - outerBorderWidth - outerPadding - rOffset - sealW;
        const posY = innerY + tOffset;
        centerX = posX + sealW / 2;
        centerY = posY + sealH / 2;
      } else if (seal.positionPreset === 'bottom-left' || seal.id === 'seal-2') {
        const lOffset = (seal.left ?? 6) * sealRatio;
        const bOffset = (seal.bottom ?? 28) * sealRatio;
        const posX = contentAreaX + lOffset;
        const posY = innerY + innerH - bOffset - sealH;
        centerX = posX + sealW / 2;
        centerY = posY + sealH / 2;
      } else if (seal.positionPreset === 'middle-cross' || seal.id === 'seal-3') {
        const topPercent = (seal.topPercent ?? 46) / 100;
        const crossOffset = (seal.left ?? -16) * sealRatio;
        const posX = contentAreaX + colW * 2 + crossOffset - sealW / 2;
        const posY = innerY + innerH * topPercent - sealH / 2;
        centerX = posX + sealW / 2;
        centerY = posY + sealH / 2;
      } else if (seal.positionPreset === 'top-left' || seal.id === 'seal-4') {
        const lOffset = (seal.left ?? 8) * sealRatio;
        const tOffset = (seal.top ?? 72) * sealRatio;
        const posX = contentAreaX + lOffset;
        const posY = innerY + tOffset;
        centerX = posX + sealW / 2;
        centerY = posY + sealH / 2;
      } else {
        const posX = (seal.left ?? 20) * sealRatio;
        const posY = (seal.top ?? 20) * sealRatio;
        centerX = posX + sealW / 2;
        centerY = posY + sealH / 2;
      }

      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = seal.opacity ?? 0.85;

      // 旋转与绘制中心对齐
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
