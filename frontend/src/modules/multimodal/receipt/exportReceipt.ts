import { getReceiptTheme } from './themes';
import { drawBarcodeToCanvas } from './barcode';
import { createDitheredImage } from './dither';
import type { ReceiptState } from './types';

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * 绘制水平虚线
 */
function drawDashedLine(ctx: CanvasRenderingContext2D, y: number, width: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(32, y);
  ctx.lineTo(width - 32, y);
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
 * 导出小票为高清 PNG 图片
 */
export async function exportReceiptImage(
  state: ReceiptState,
  options?: { scale?: number }
): Promise<string> {
  const theme = getReceiptTheme(state.themeId);
  const scale = options?.scale || 2; // 2x 高清导出

  const baseWidth = 540;
  // 先粗估内容高度以创建画布
  let curY = 40; // 顶部间距

  // 1. 预先准备图片（原图或点阵图）
  let processedImage: HTMLImageElement | null = null;
  if (state.imageUrl) {
    try {
      const targetSrc = state.ditherEnabled
        ? await createDitheredImage(state.imageUrl, { targetWidth: 460 })
        : state.imageUrl;
      processedImage = await loadImage(targetSrc);
    } catch {
      processedImage = null;
    }
  }

  // 2. 估算总高度
  curY += 60; // 标题 + 副标题
  curY += 80; // Date / Terminal / Served by / CallNumber
  if (processedImage) {
    const imgW = baseWidth - 64;
    const aspect = processedImage.height / processedImage.width;
    curY += Math.min(480, Math.round(imgW * aspect)) + 30;
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
    curY += 100; // 条形码高度
  }
  curY += 90; // 底部 Message + Note
  curY += 40; // 底部留白

  const baseHeight = Math.max(780, curY);

  // 3. 创建高分屏画布
  const canvas = document.createElement('canvas');
  canvas.width = baseWidth * scale;
  canvas.height = baseHeight * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');

  ctx.scale(scale, scale);

  // 4. 绘制热敏小票背景（含锯齿边缘）
  drawZigzagPaper(ctx, baseWidth, baseHeight, theme.bg, 10);

  // 5. 逐行排版绘制小票内容
  let y = 48;

  // --- 店名 / 馆名 ---
  ctx.fillStyle = theme.text;
  ctx.font = "900 28px 'Courier New', 'Noto Sans Mono', monospace";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(state.storeName.toUpperCase() || 'RECEIPT', baseWidth / 2, y);
  y += 36;

  // --- 副标题 ---
  ctx.fillStyle = theme.faint;
  ctx.font = "600 13px 'Courier New', monospace";
  ctx.fillText(state.subtitle || '* * * * * RECEIPT * * * * *', baseWidth / 2, y);
  y += 24;

  // --- 分割线 ---
  drawDashedLine(ctx, y, baseWidth, theme.dashed);
  y += 16;

  // --- 头信息区 (Date, Terminal, Served by, 索书号, 评分) ---
  ctx.font = "13px 'Courier New', 'Noto Sans Mono', monospace";
  const drawPair = (label: string, val: string) => {
    if (!val) return;
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.faint;
    ctx.fillText(label, 36, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = theme.text;
    ctx.fillText(val, baseWidth - 36, y);
    y += 22;
  };

  drawPair('Date:', state.dateTimeText || '2026-08-19 12:00');
  drawPair('Terminal:', state.terminal || '01-MAIN');
  drawPair('Served by:', state.servedBy || 'Admin');
  if (state.callNumber) {
    drawPair('索书号 (Call No):', state.callNumber);
  }
  if (state.rating) {
    drawPair('评分 (Rating):', `★ ${state.rating}`);
  }

  y += 6;
  drawDashedLine(ctx, y, baseWidth, theme.dashed);
  y += 18;

  // --- 插图区域 ---
  if (processedImage) {
    const maxW = baseWidth - 72;
    const aspect = processedImage.height / processedImage.width;
    const imgH = Math.min(380, Math.round(maxW * aspect));
    const imgX = (baseWidth - maxW) / 2;

    ctx.drawImage(processedImage, imgX, y, maxW, imgH);
    y += imgH + 12;

    if (state.ditherEnabled) {
      ctx.font = "11px 'Courier New', monospace";
      ctx.textAlign = 'center';
      ctx.fillStyle = theme.faint;
      ctx.fillText('[ LO-FI DITHERED PRINT ]', baseWidth / 2, y);
      y += 18;
    }

    drawDashedLine(ctx, y, baseWidth, theme.dashed);
    y += 18;
  }

  // --- 结构化图书元数据 ---
  const activeFields = (state.metaFields || []).filter((f) => f.visible !== false && f.value);
  if (activeFields.length > 0) {
    ctx.font = "14px 'Courier New', 'Noto Sans SC', monospace";
    for (const field of activeFields) {
      ctx.textAlign = 'left';
      ctx.fillStyle = theme.faint;
      ctx.fillText(`${field.label}:`, 36, y);

      ctx.textAlign = 'right';
      ctx.fillStyle = theme.text;
      // 超长文本截断
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

  // --- 列表条目项 (Items) ---
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

  // --- TOTAL 统计行 ---
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

  // --- 条形码区域 ---
  if (state.barcodeText) {
    const barcodeWidth = 240;
    const barcodeHeight = 52;
    const barcodeX = (baseWidth - barcodeWidth) / 2;
    drawBarcodeToCanvas(ctx, state.barcodeText, barcodeX, y, barcodeWidth, barcodeHeight, theme.text, true);
    y += barcodeHeight + 28;
  }

  // --- 底部感谢与标语 ---
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

  // --- 最底部备注 ---
  if (state.bottomNote) {
    ctx.font = "11px 'Courier New', 'Noto Sans SC', monospace";
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.faint;
    ctx.fillText(state.bottomNote, baseWidth / 2, y + 6);
  }

  return canvas.toDataURL('image/png', 1.0);
}
