import { getReceiptTheme } from './themes';
import { drawBarcodeToCanvas } from './barcode';
import { createDitheredImage } from './dither';
import { isChineseName } from './borrowerGenerator';
import { urlToDataUrl } from '../../bookplate/imageUpload';
import type { ReceiptState } from './types';

/**
 * 确保外部图片安全加载并转为 HTMLImageElement
 */
async function loadImageSafe(src: string): Promise<HTMLImageElement | null> {
  let safeSrc = src;
  if (!src.startsWith('data:') && !src.startsWith('blob:') && !src.startsWith('/')) {
    try {
      safeSrc = await urlToDataUrl(src);
    } catch {
      safeSrc = src;
    }
  }

  return new Promise((resolve) => {
    const img = new Image();
    if (!safeSrc.startsWith('data:') && !safeSrc.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => {
      resolve(null);
    };
    img.src = safeSrc;
  });
}

/**
 * 等待网页所有字体就绪（避免 Canvas 导出时手写/印章等字体降级为默认字体）
 */
async function ensureFontsReady(): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // 忽略字体就绪异常
    }
  }
}

/**
 * 绘制水平虚线
 */
function drawDashedLine(ctx: CanvasRenderingContext2D, y: number, width: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(32, y);
  ctx.lineTo(width - 32, y);
  ctx.stroke();
  ctx.restore();
}

/**
 * 绘制圆角虚线矩形框
 */
function drawDashedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  r = 4
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * 绘制顶部与底部锯齿撕纸边
 */
function drawZigzagPaper(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bgColor: string,
  toothSize = 8
) {
  ctx.save();
  ctx.fillStyle = bgColor;
  ctx.beginPath();

  // 顶部锯齿（从左向右）
  ctx.moveTo(0, toothSize);
  const teethCount = Math.floor(width / (toothSize * 2));
  const step = width / teethCount;

  for (let i = 0; i < teethCount; i++) {
    const x = i * step;
    ctx.lineTo(x + step / 2, 0);
    ctx.lineTo(x + step, toothSize);
  }

  // 右边缘
  ctx.lineTo(width, height - toothSize);

  // 底部锯齿（从右向左）
  for (let i = teethCount; i > 0; i--) {
    const x = (i - 1) * step;
    ctx.lineTo(x + step / 2, height);
    ctx.lineTo(x, height - toothSize);
  }

  // 左边缘闭合
  ctx.lineTo(0, toothSize);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * 绘制标准热敏小票
 */
async function exportStandardReceiptImage(
  state: ReceiptState,
  scale = 2
): Promise<string> {
  await ensureFontsReady();

  const theme = getReceiptTheme(state.themeId);
  const baseWidth = 540;
  let curY = 40;

  // 1. 准备插图
  let processedImage: HTMLImageElement | null = null;
  if (state.imageUrl && state.imageUrl.trim() !== '') {
    try {
      const targetSrc = state.ditherEnabled
        ? await createDitheredImage(state.imageUrl, { targetWidth: 460 })
        : state.imageUrl;
      processedImage = await loadImageSafe(targetSrc);
    } catch {
      processedImage = null;
    }
  }

  // 2. 估算总高度
  curY += 60; // 标题 + 副标题
  curY += 130; // Date / Terminal / Served by / CallNumber / Status / Rating
  if (processedImage) {
    curY += 280 + (state.ditherEnabled ? 30 : 10) + 30;
  }
  if (state.metaFields && state.metaFields.length > 0) {
    curY += state.metaFields.filter((f) => f.visible !== false).length * 28 + 20;
  }
  if (state.items && state.items.length > 0) {
    curY += state.items.length * 36 + 20;
  }
  if (state.totalValue) {
    curY += 50;
  }
  if (state.barcodeText) {
    curY += 100;
  }
  curY += 90;
  curY += 40;

  const baseHeight = Math.max(780, curY);

  const canvas = document.createElement('canvas');
  canvas.width = baseWidth * scale;
  canvas.height = baseHeight * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');

  ctx.scale(scale, scale);

  // 绘制热敏小票背景（含锯齿边缘）
  drawZigzagPaper(ctx, baseWidth, baseHeight, theme.bg, 10);

  let y = 48;

  // 店名
  ctx.fillStyle = theme.text;
  ctx.font = "900 28px 'Courier New', 'Noto Sans Mono', monospace";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(state.storeName.toUpperCase() || 'RECEIPT', baseWidth / 2, y);
  y += 36;

  // 副标题
  ctx.fillStyle = theme.faint;
  ctx.font = "600 13px 'Courier New', monospace";
  ctx.fillText(state.subtitle || '* * * * * RECEIPT * * * * *', baseWidth / 2, y);
  y += 24;

  drawDashedLine(ctx, y, baseWidth, theme.dashed);
  y += 16;

  // 基本信息
  ctx.font = "13px 'Courier New', 'Noto Sans Mono', monospace";
  const drawPair = (label: string, val: string, valColor?: string) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.faint;
    ctx.fillText(label, 36, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = valColor || theme.text;
    ctx.fillText(val, baseWidth - 36, y);
    y += 22;
  };

  drawPair('Date:', state.dateTimeText || '2026-08-19 12:00');
  drawPair('Terminal:', state.terminal || '01-MAIN');
  drawPair('Served by:', state.servedBy || 'Admin');

  const callNoVal = state.callNumber && state.callNumber.trim() !== '' ? state.callNumber : '[未填写]';
  drawPair('索书号 (Call No):', callNoVal, theme.accent || theme.text);

  const statusVal = state.status && state.status.trim() !== '' ? state.status : '[在馆可借]';
  drawPair('馆藏状态 (Status):', statusVal, theme.accent || theme.text);

  if (state.rating !== undefined && state.rating !== null && String(state.rating).trim() !== '') {
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.faint;
    ctx.fillText('豆瓣评分 (Rating):', 36, y);

    const ratingStr = `${state.rating}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = theme.text;
    ctx.fillText(ratingStr, baseWidth - 36, y);

    const ratingTextWidth = ctx.measureText(ratingStr).width;
    ctx.fillStyle = '#F59E0B';
    ctx.fillText('★ ', baseWidth - 36 - ratingTextWidth, y);
    y += 22;
  }

  y += 6;
  drawDashedLine(ctx, y, baseWidth, theme.dashed);
  y += 18;

  // 插图
  if (processedImage) {
    const boxX = 36;
    const boxWidth = baseWidth - 72;
    const maxImgH = 260;
    const maxImgW = boxWidth - 16;

    const aspect = processedImage.height / processedImage.width;
    let drawW = maxImgW;
    let drawH = Math.round(drawW * aspect);
    if (drawH > maxImgH) {
      drawH = maxImgH;
      drawW = Math.round(drawH / aspect);
    }

    const drawX = boxX + (boxWidth - drawW) / 2;
    const drawY = y + 8;

    ctx.drawImage(processedImage, drawX, drawY, drawW, drawH);

    let boxContentBottom = drawY + drawH;
    if (state.ditherEnabled) {
      const textY = boxContentBottom + 12;
      ctx.font = "10px 'Courier New', monospace";
      ctx.textAlign = 'center';
      ctx.fillStyle = theme.faint;
      ctx.fillText('[ LO-FI DITHERED PRINT ]', baseWidth / 2, textY);
      boxContentBottom = textY + 14;
    } else {
      boxContentBottom += 8;
    }

    const boxHeight = boxContentBottom - y;
    drawDashedRect(ctx, boxX, y, boxWidth, boxHeight, theme.dashed, 4);

    y += boxHeight + 16;
    drawDashedLine(ctx, y, baseWidth, theme.dashed);
    y += 18;
  }

  // 元数据
  const activeFields = (state.metaFields || []).filter((f) => f.visible !== false && f.value);
  if (activeFields.length > 0) {
    ctx.font = "14px 'Courier New', 'Noto Sans SC', monospace";
    for (const field of activeFields) {
      ctx.textAlign = 'left';
      ctx.fillStyle = theme.faint;
      ctx.fillText(`${field.label}:`, 36, y);

      ctx.textAlign = 'right';
      ctx.fillStyle = theme.text;
      const maxValWidth = baseWidth - 140;
      let text = field.value;
      if (ctx.measureText(text).width > maxValWidth) {
        while (text.length > 4 && ctx.measureText(text + '...').width > maxValWidth) {
          text = text.slice(0, -1);
        }
        text += '...';
      }
      ctx.fillText(text, baseWidth - 36, y);
      y += 26;
    }
    y += 6;
    drawDashedLine(ctx, y, baseWidth, theme.dashed);
    y += 18;
  }

  // 清单条目
  if (state.items && state.items.length > 0) {
    for (const item of state.items) {
      ctx.font = "600 14px 'Courier New', 'Noto Sans SC', monospace";
      ctx.textAlign = 'left';
      ctx.fillStyle = theme.text;
      ctx.fillText(item.label, 36, y);

      ctx.textAlign = 'right';
      if (item.count) {
        ctx.fillStyle = theme.faint;
        ctx.fillText(item.count, baseWidth - 120, y);
      }
      if (item.value) {
        ctx.fillStyle = theme.text;
        ctx.fillText(item.value, baseWidth - 36, y);
      }
      y += 28;
    }
    y += 4;
    drawDashedLine(ctx, y, baseWidth, theme.dashed);
    y += 18;
  }

  // TOTAL
  if (state.totalValue) {
    ctx.font = "800 18px 'Courier New', 'Noto Sans SC', monospace";
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.text;
    ctx.fillText(state.totalLabel || 'TOTAL:', 36, y);

    ctx.textAlign = 'right';
    ctx.fillStyle = theme.accent || theme.text;
    ctx.fillText(state.totalValue, baseWidth - 36, y);
    y += 32;

    drawDashedLine(ctx, y, baseWidth, theme.dashed);
    y += 24;
  }

  // 条形码
  if (state.barcodeText) {
    const barcodeWidth = 240;
    const barcodeHeight = 52;
    const barcodeX = (baseWidth - barcodeWidth) / 2;
    drawBarcodeToCanvas(ctx, state.barcodeText, barcodeX, y, barcodeWidth, barcodeHeight, theme.text, true);
    y += barcodeHeight + 28;
  }

  // 底部留言
  if (state.footerMessage) {
    ctx.font = "700 13px 'Courier New', 'Noto Sans SC', monospace";
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.text;
    const lines = state.footerMessage.split('\n');
    for (const line of lines) {
      ctx.fillText(line.toUpperCase(), baseWidth / 2, y);
      y += 20;
    }
  }

  if (state.bottomNote) {
    ctx.font = "11px 'Courier New', 'Noto Sans SC', monospace";
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.faint;
    ctx.fillText(state.bottomNote, baseWidth / 2, y + 6);
  }

  return canvas.toDataURL('image/png', 1.0);
}

/**
 * 绘制复古图书馆借书卡 (Library Card Export Engine - 所见即所得 100% 对齐)
 */
async function exportLibraryCardImage(
  state: ReceiptState,
  scale = 2
): Promise<string> {
  // 1. 等待 Web 字体加载完成（确保 Zhi Mang Xing / Caveat / Special Elite 渲染正常）
  await ensureFontsReady();

  const theme = getReceiptTheme(state.themeId);
  const baseWidth = 540;
  const baseHeight = 780;

  const canvas = document.createElement('canvas');

  canvas.width = baseWidth * scale;
  canvas.height = baseHeight * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');

  ctx.scale(scale, scale);

  // 2. 背景底色与边框（动态绑定当前选中的主题纸色）
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, baseWidth, baseHeight);
  ctx.strokeStyle = '#d1d5db';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, baseWidth, baseHeight);

  // 3. 柔和背景水印插图（严格对齐 position: 60% 70%, size: 80%, mix-blend-mode: multiply）
  if (state.imageUrl && state.imageUrl.trim() !== '') {
    try {
      const bgImg = await loadImageSafe(state.imageUrl);
      if (bgImg) {
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.globalCompositeOperation = 'multiply';

        const imgAspect = bgImg.height / bgImg.width;
        const targetW = baseWidth * 0.8;
        const targetH = targetW * imgAspect;
        // 居中偏右下 (60% X, 70% Y)
        const imgX = (baseWidth - targetW) * 0.6;
        const imgY = (baseHeight - targetH) * 0.7;
        ctx.drawImage(bgImg, imgX, imgY, targetW, targetH);
        ctx.restore();
      }
    } catch {
      // 忽略图片加载错误
    }
  }

  // 4. 头部信息区背景遮罩（对齐 DOM：确保标题与元数据不受背景插图干扰）
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, baseWidth, 236);

  // 右上角 No. CARD_NUMBER（继承 ISBN 后 4 位）
  const cardNumber = state.cardNumber || '5399';


  ctx.save();
  ctx.font = "14px 'Cutive Mono', 'Courier New', monospace";
  const noText = `No. ${cardNumber}`;
  const noWidth = ctx.measureText(noText).width + 16;
  ctx.strokeStyle = '#d1d5db';
  ctx.lineWidth = 1;
  ctx.strokeRect(baseWidth - 36 - noWidth, 24, noWidth, 26);
  ctx.fillStyle = '#6b7280';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(noText, baseWidth - 36 - noWidth / 2, 37);
  ctx.restore();

  // 大标题与副标题
  let curY = 52;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#1f2937';
  ctx.font = "bold 36px '上图东观体', 'Noto Serif SC', 'LXGW WenKai', serif";
  ctx.fillText(state.storeName || '書海回响', baseWidth / 2, curY);

  curY += 26;
  // 副标装饰横线与英文
  ctx.strokeStyle = '#9ca3af';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(baseWidth / 2 - 120, curY);
  ctx.lineTo(baseWidth / 2 - 75, curY);
  ctx.moveTo(baseWidth / 2 + 75, curY);
  ctx.lineTo(baseWidth / 2 + 120, curY);
  ctx.stroke();

  ctx.fillStyle = '#4b5563';
  ctx.font = "10px '上图东观体', 'Noto Serif SC', 'Cutive Mono', monospace";
  ctx.fillText((state.subtitle || 'SHANGHAI LIBRARY').toUpperCase(), baseWidth / 2, curY + 4);

  curY += 32;

  // 元数据字段：Author, Title, Call No., Year
  const authorVal = state.metaFields?.find((f) => f.key === 'author')?.value || '';
  const titleVal = state.metaFields?.find((f) => f.key === 'title')?.value || '';
  const yearVal = state.metaFields?.find((f) => f.key === 'pub_year')?.value || '2024';
  const callNoVal = state.callNumber || '';

  // Author 行
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1e40af'; // 蓝字标签
  ctx.font = "11px 'Cutive Mono', 'Courier New', monospace";
  ctx.fillText('AUTHOR', 36, curY + 16);

  ctx.fillStyle = '#1f2937';
  ctx.font = "18px '又又意宋', 'Noto Serif SC', serif";
  ctx.fillText(authorVal, 110, curY + 17);

  // 蓝色浅下划线
  ctx.save();
  ctx.strokeStyle = '#bfdbfe';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(36, curY + 26);
  ctx.lineTo(baseWidth - 36, curY + 26);
  ctx.stroke();
  ctx.restore();

  curY += 38;

  // Title 行
  ctx.fillStyle = '#1e40af';
  ctx.font = "11px 'Cutive Mono', 'Courier New', monospace";
  ctx.fillText('TITLE', 36, curY + 16);

  ctx.fillStyle = '#111827';
  ctx.font = "bold 20px '又又意宋', 'Noto Serif SC', serif";
  ctx.fillText(titleVal, 110, curY + 17);

  ctx.save();
  ctx.strokeStyle = '#bfdbfe';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(36, curY + 26);
  ctx.lineTo(baseWidth - 36, curY + 26);
  ctx.stroke();
  ctx.restore();

  curY += 38;

  // Call No. & Year 行
  ctx.fillStyle = '#1e40af';
  ctx.font = "10px 'Cutive Mono', 'Courier New', monospace";
  ctx.fillText('CALL NO.', 36, curY + 12);
  ctx.fillStyle = '#4b5563';
  ctx.font = "bold 15px 'Cutive Mono', 'Courier New', monospace";
  ctx.fillText(callNoVal, 36, curY + 30);

  ctx.fillStyle = '#1e40af';
  ctx.font = "10px 'Cutive Mono', 'Courier New', monospace";
  ctx.fillText('YEAR', baseWidth - 110, curY + 12);
  ctx.fillStyle = '#4b5563';
  ctx.font = "bold 15px 'Cutive Mono', 'Courier New', monospace";
  ctx.fillText(yearVal, baseWidth - 110, curY + 30);

  curY += 46;

  // 5. 中段表头 (背景色自适应纸色，分割线固定深蓝色)
  const tableHeaderY = curY;
  const tableHeaderH = 40;

  ctx.save();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, tableHeaderY, baseWidth, tableHeaderH);
  ctx.fillStyle = theme.text;
  ctx.globalAlpha = 0.07;
  ctx.fillRect(0, tableHeaderY, baseWidth, tableHeaderH);
  ctx.restore();

  ctx.strokeStyle = '#1e40af';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, tableHeaderY);
  ctx.lineTo(baseWidth, tableHeaderY);
  ctx.moveTo(0, tableHeaderY + tableHeaderH);
  ctx.lineTo(baseWidth, tableHeaderY + tableHeaderH);
  ctx.stroke();

  const splitX = baseWidth * 0.32; // 172.8

  ctx.fillStyle = '#1e3a8a';
  ctx.font = "bold 12px 'Cutive Mono', 'Courier New', monospace";
  ctx.textAlign = 'center';
  ctx.fillText('DATE DUE', splitX / 2, tableHeaderY + 25);
  ctx.fillText("BORROWER'S NAME", splitX + (baseWidth - splitX) / 2, tableHeaderY + 25);

  curY += tableHeaderH;

  // 6. 借阅记录网格区 (7 行，固定浅蓝横线)
  const rowHeight = 50;
  const gridStartY = curY;
  const records = state.borrowerRecords || [];
  const totalRows = 7;

  // 红色垂直分割线
  ctx.save();
  ctx.strokeStyle = '#ef4444';
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(splitX, gridStartY - tableHeaderH);
  ctx.lineTo(splitX, gridStartY + totalRows * rowHeight);
  ctx.stroke();
  ctx.restore();

  for (let i = 0; i < totalRows; i++) {
    const rowY = gridStartY + i * rowHeight;
    const record = records[i];

    // 水平分割线（固定浅蓝色线条）
    ctx.save();
    ctx.strokeStyle = 'rgba(147, 197, 253, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, rowY + rowHeight);
    ctx.lineTo(baseWidth, rowY + rowHeight);
    ctx.stroke();
    ctx.restore();

    if (record) {
      // Date Due（带轻微随机倾斜旋转的盖章质感）
      ctx.save();
      const dateCenterX = splitX / 2;
      const dateCenterY = rowY + rowHeight / 2;
      ctx.translate(dateCenterX, dateCenterY);

      let angle = 0;
      if (record.rotation?.includes('rotate-1')) angle = 0.02;
      else if (record.rotation?.includes('-rotate-2')) angle = -0.04;
      else if (record.rotation?.includes('rotate-2')) angle = 0.04;
      else if (record.rotation?.includes('-rotate-1')) angle = -0.02;

      ctx.rotate(angle);
      ctx.fillStyle = '#1e3a8a';
      ctx.font = "bold 15px 'Special Elite', cursive, monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(record.date, 0, 0);
      ctx.restore();

      // Borrower's Name（中英文区分手写字体：中文 Zhi Mang Xing，英文 Caveat）
      ctx.save();
      ctx.fillStyle = '#1f2937';
      const isCn = isChineseName(record.name);
      ctx.font = isCn
        ? "26px 'Zhi Mang Xing', cursive, serif"
        : "bold 26px 'Caveat', cursive, sans-serif";
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(record.name, splitX + 24, rowY + rowHeight / 2 + 2);
      ctx.restore();
    }
  }

  curY = gridStartY + totalRows * rowHeight;

  // 7. 底部区域 (借阅须知 + 图书馆 Logo 图)
  const bottomStartY = curY;
  const bottomHeight = baseHeight - bottomStartY;

  // 底部渐变背景遮罩
  ctx.save();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, bottomStartY, baseWidth, bottomHeight);
  ctx.restore();

  // 底部深蓝双线
  ctx.strokeStyle = '#1e3a8a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, bottomStartY);
  ctx.lineTo(baseWidth, bottomStartY);
  ctx.stroke();

  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, bottomStartY + 3);
  ctx.lineTo(baseWidth, bottomStartY + 3);
  ctx.stroke();

  curY = bottomStartY + 14;

  // 借阅须知文案（中文 3 条细则）
  ctx.textAlign = 'left';
  const rulesLines = [
    '借阅须知 RULES:',
    '1. 请爱护书籍，如有损坏照价赔偿。',
    '2. 借阅期为30天，可续借一次。',
    '3. 此卡仅限本人使用，请妥善保管。',
  ];
  let ruleY = curY + 4;
  for (let idx = 0; idx < rulesLines.length; idx++) {
    if (idx === 0) {
      ctx.fillStyle = '#1e3a8a';
      ctx.font = "bold 12px '又又意宋', 'Noto Serif SC', serif";
    } else {
      ctx.fillStyle = '#4b5563';
      ctx.font = "11px '又又意宋', 'Noto Serif SC', serif";
    }
    ctx.fillText(rulesLines[idx], 36, ruleY);
    ruleY += 16;
  }

  // 英文须知（展平在下方）
  ctx.fillStyle = 'rgba(30, 58, 138, 0.7)';
  ctx.font = "9px 'Cutive Mono', 'Courier New', monospace";
  ctx.fillText(
    (state.bottomNote || 'Please return this book on or before the last date stamped.').toUpperCase(),
    36,
    ruleY + 8
  );

  // 右侧图书馆 Logo 印章图（与中文须知并排）
  try {
    const logoImg = await loadImageSafe('/assets/receipt/logozi_shl.jpg');
    if (logoImg) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.globalCompositeOperation = 'multiply';
      const logoW = 120;
      const logoH = (logoW / logoImg.width) * logoImg.height;
      const logoX = baseWidth - 36 - logoW;
      const logoY = curY + 6;
      ctx.drawImage(logoImg, logoX, logoY, logoW, logoH);
      ctx.restore();
    }
  } catch {
    // 忽略错误
  }

  // 8. 底部活页圆孔打孔效果
  const holeX = baseWidth / 2;
  const holeY = baseHeight - 16;
  ctx.save();
  ctx.beginPath();
  ctx.arc(holeX, holeY, 11, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();


  return canvas.toDataURL('image/png', 1.0);
}

/**
 * 导出小票 / 借书卡为高清 PNG 图片
 */
export async function exportReceiptImage(
  state: ReceiptState,
  options?: { scale?: number }
): Promise<string> {
  const scale = options?.scale || 2;
  if (state.templateId === 'reading_log') {
    return exportLibraryCardImage(state, scale);
  }
  return exportStandardReceiptImage(state, scale);
}
