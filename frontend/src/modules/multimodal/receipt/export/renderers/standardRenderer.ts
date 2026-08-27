import { getReceiptTheme } from '../../themes';
import { drawBarcodeToCanvas } from '../../barcode';
import { createDitheredImage } from '../../dither';
import type { ReceiptState } from '../../types';
import {
  ensureFontsReady,
  loadImageSafe,
  drawZigzagPaper,
  drawDashedLine,
  drawDashedRect,
} from '../common/canvasUtils';

/**
 * 绘制标准热敏小票（书目推荐与经典清单）
 */
export async function exportStandardReceiptImage(
  state: ReceiptState,
  scale = 2
): Promise<string> {
  await ensureFontsReady();

  const theme = getReceiptTheme(state.themeId, state.customThemeColor);
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
    curY += 280 + 10 + 30;
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

    let boxContentBottom = drawY + drawH + 8;

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
