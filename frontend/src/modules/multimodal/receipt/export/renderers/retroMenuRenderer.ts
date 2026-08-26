import { getReceiptTheme } from '../../themes';
import { createDitheredImage } from '../../dither';
import type { ReceiptState } from '../../types';
import { ensureFontsReady, loadImageSafe } from '../common/canvasUtils';

/**
 * 绘制复古菜单小票 (Retro Menu Export Engine - 芭蕾餐厅复刻，带上下双图与镂空齿孔)
 */
export async function exportRetroMenuImage(
  state: ReceiptState,
  scale = 2
): Promise<string> {
  await ensureFontsReady();

  const theme = getReceiptTheme(state.themeId);
  const baseWidth = 480;

  // 1. 准备上下两张插图
  let topImg: HTMLImageElement | null = null;
  if (state.imageUrl && state.imageUrl.trim() !== '') {
    try {
      const targetSrc = state.ditherEnabled
        ? await createDitheredImage(state.imageUrl, { targetWidth: 440 })
        : state.imageUrl;
      topImg = await loadImageSafe(targetSrc);
    } catch {
      topImg = null;
    }
  }

  let bottomImg: HTMLImageElement | null = null;
  if (state.bottomImageUrl && state.bottomImageUrl.trim() !== '') {
    try {
      const targetSrc = state.ditherEnabled
        ? await createDitheredImage(state.bottomImageUrl, { targetWidth: 440 })
        : state.bottomImageUrl;
      bottomImg = await loadImageSafe(targetSrc);
    } catch {
      bottomImg = null;
    }
  }

  // 2. 动态计算板块高度
  const padX = 28;
  const contentWidth = baseWidth - padX * 2;

  // 顶部板块高度
  let topBlockHeight = 36; // 顶部留白
  if (topImg) {
    const aspect = topImg.height / topImg.width;
    const imgH = Math.min(260, Math.round(contentWidth * aspect));
    topBlockHeight += imgH + 20;
  } else {
    topBlockHeight += 80;
  }
  topBlockHeight += 45; // 标题
  topBlockHeight += 12; // 分割线
  topBlockHeight += 38; // 副标题/作者
  const items = state.items || [];
  topBlockHeight += Math.max(1, items.length) * 28 + 24;
  if (state.callNumber && state.callNumber.trim() !== '') {
    topBlockHeight += 26; // 索书号行
  }

  const middleH = 40; // 中间齿孔区域高度

  // 底部板块高度
  let bottomBlockHeight = 24;
  if (bottomImg) {
    bottomBlockHeight += 160 + 36;
  } else {
    bottomBlockHeight += 100;
  }

  const baseHeight = topBlockHeight + middleH + bottomBlockHeight;

  // 3. 创建 Canvas 画布
  const canvas = document.createElement('canvas');
  canvas.width = baseWidth * scale;
  canvas.height = baseHeight * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');

  ctx.scale(scale, scale);

  // 辅助函数：绘制带微噪点的复古纸张底色
  const fillPaperBg = (x: number, y: number, w: number, h: number) => {
    ctx.save();
    ctx.fillStyle = theme.bg;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  };

  // -------------------------------------------------------------
  // ① 绘制顶部板块（含顶部半圆波浪齿孔凹槽）
  // -------------------------------------------------------------
  ctx.save();
  ctx.beginPath();
  const toothRadius = 14;
  const toothPitch = 28;
  const topTeethCount = Math.floor(baseWidth / toothPitch);
  const topStep = baseWidth / topTeethCount;

  // 顶部边缘：从左到右绘制半圆波浪凹槽
  ctx.moveTo(0, 0);
  for (let i = 0; i < topTeethCount; i++) {
    const cx = i * topStep + topStep / 2;
    ctx.lineTo(cx - toothRadius, 0);
    ctx.arc(cx, 0, toothRadius, Math.PI, 0, true);
    ctx.lineTo((i + 1) * topStep, 0);
  }
  ctx.lineTo(baseWidth, topBlockHeight);
  ctx.lineTo(0, topBlockHeight);
  ctx.closePath();
  ctx.clip();

  fillPaperBg(0, 0, baseWidth, topBlockHeight);
  ctx.restore();

  // 绘制顶部板块内容
  let curY = 32;

  // 顶部插图
  if (topImg) {
    const aspect = topImg.height / topImg.width;
    let drawW = contentWidth;
    let drawH = Math.round(drawW * aspect);
    if (drawH > 260) {
      drawH = 260;
      drawW = Math.round(drawH / aspect);
    }
    const drawX = (baseWidth - drawW) / 2;

    // 复古外黑内白相框
    ctx.save();
    ctx.fillStyle = theme.text;
    ctx.fillRect(drawX - 4, curY - 4, drawW + 8, drawH + 8);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(drawX - 2, curY - 2, drawW + 4, drawH + 4);
    ctx.drawImage(topImg, drawX, curY, drawW, drawH);
    ctx.restore();

    curY += drawH + 24;
  } else {
    curY += 60;
  }

  // 题名 (大字号宋体)
  ctx.save();
  ctx.fillStyle = theme.text;
  ctx.font = "bold 26px 'Songti SC', 'SimSun', 'Noto Serif SC', '又又意宋', serif";
  ctx.textAlign = 'left';
  ctx.fillText(state.storeName || '题名', padX, curY + 10);
  curY += 34;

  // 实线分割线
  ctx.strokeStyle = theme.text;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(padX, curY);
  ctx.lineTo(baseWidth - padX, curY);
  ctx.stroke();
  curY += 16;

  // 副标题 / 作者 (斜体楷体)
  ctx.fillStyle = theme.text;
  ctx.font = "italic 20px 'Kaiti SC', 'STKaiti', '楷体', 'LXGW WenKai', serif";
  ctx.fillText(state.subtitle || 'AUTHOR', padX, curY + 6);
  curY += 28;

  // 菜单明细条目
  ctx.font = "14px 'JetBrains Mono', 'Courier New', 'Noto Sans Mono', monospace";
  for (const item of items) {
    ctx.fillStyle = `color-mix(in srgb, ${theme.text} 75%, transparent)`;
    ctx.textAlign = 'left';
    ctx.fillText(`${item.label}:`, padX + 4, curY + 6);

    ctx.fillStyle = theme.text;
    ctx.textAlign = 'right';
    ctx.font = "bold 14px 'JetBrains Mono', 'Courier New', monospace";
    ctx.fillText(item.value || '', baseWidth - padX - 4, curY + 6);
    ctx.font = "14px 'JetBrains Mono', 'Courier New', 'Noto Sans Mono', monospace";
    curY += 26;
  }

  // 索书号（固定行，与条目行共享对齐边：标签左对齐淡色，值右对齐加粗）
  const callNoVal = (state.callNumber || '').trim();
  if (callNoVal) {
    ctx.fillStyle = `color-mix(in srgb, ${theme.text} 75%, transparent)`;
    ctx.textAlign = 'left';
    ctx.fillText('索书号:', padX + 4, curY + 6);

    ctx.fillStyle = theme.text;
    ctx.textAlign = 'right';
    ctx.font = "bold 14px 'JetBrains Mono', 'Courier New', monospace";
    ctx.fillText(callNoVal, baseWidth - padX - 4, curY + 6);
    curY += 26;
  }
  ctx.restore();

  // -------------------------------------------------------------
  // ② 绘制中间打孔板块（左右两端半圆大缺口 + 中间均匀排布的透气小圆孔）
  // -------------------------------------------------------------
  const middleY = topBlockHeight;
  const middleCenterY = middleY + middleH / 2;
  const notchR = 16;

  ctx.save();
  // 先填充满背景
  ctx.beginPath();
  ctx.rect(0, middleY, baseWidth, middleH);
  fillPaperBg(0, middleY, baseWidth, middleH);

  // 清除（挖空）左侧半圆缺口
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(0, middleCenterY, notchR, -Math.PI / 2, Math.PI / 2);
  ctx.fill();

  // 清除（挖空）右侧半圆缺口
  ctx.beginPath();
  ctx.arc(baseWidth, middleCenterY, notchR, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.fill();

  // 清除（挖空）中间一排均匀小圆孔
  const dotR = 3.5;
  const dotPitch = 18;
  const dotsStartX = notchR + 18;
  const dotsEndX = baseWidth - notchR - 18;
  const dotsWidth = dotsEndX - dotsStartX;
  const dotsCount = Math.floor(dotsWidth / dotPitch);

  for (let i = 0; i <= dotsCount; i++) {
    const dotX = dotsStartX + (i * dotsWidth) / dotsCount;
    ctx.beginPath();
    ctx.arc(dotX, middleCenterY, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // -------------------------------------------------------------
  // ③ 绘制底部板块（含底部半圆波浪齿孔凹槽与底部横幅细长插图）
  // -------------------------------------------------------------
  const bottomY = topBlockHeight + middleH;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, bottomY);
  ctx.lineTo(baseWidth, bottomY);
  ctx.lineTo(baseWidth, baseHeight);

  // 底部边缘：从右向左绘制半圆波浪凹槽
  const bTeethCount = Math.floor(baseWidth / toothPitch);
  const bStep = baseWidth / bTeethCount;
  for (let i = bTeethCount; i > 0; i--) {
    const cx = (i - 1) * bStep + bStep / 2;
    ctx.lineTo(cx + toothRadius, baseHeight);
    ctx.arc(cx, baseHeight, toothRadius, 0, Math.PI, true);
    ctx.lineTo((i - 1) * bStep, baseHeight);
  }
  ctx.lineTo(0, bottomY);
  ctx.closePath();
  ctx.clip();

  fillPaperBg(0, bottomY, baseWidth, bottomBlockHeight);
  ctx.restore();

  // 底部横幅插图（固定高度 140px，居中裁剪）
  if (bottomImg) {
    const bImgY = bottomY + 16;
    const bImgH = 140;
    const bImgW = contentWidth;
    const bImgX = padX;

    // 复古外黑内白相框
    ctx.save();
    ctx.fillStyle = theme.text;
    ctx.fillRect(bImgX - 4, bImgY - 4, bImgW + 8, bImgH + 8);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(bImgX - 2, bImgY - 2, bImgW + 4, bImgH + 4);

    // 居中裁剪绘制 (cover 模式，偏上 25%)
    ctx.beginPath();
    ctx.rect(bImgX, bImgY, bImgW, bImgH);
    ctx.clip();

    const imgAspect = bottomImg.height / bottomImg.width;
    const boxAspect = bImgH / bImgW;
    let sW = bottomImg.width;
    let sH = bottomImg.height;
    let sX = 0;
    let sY = 0;

    if (imgAspect > boxAspect) {
      sH = bottomImg.width * boxAspect;
      sY = (bottomImg.height - sH) * 0.25;
    } else {
      sW = bottomImg.height / boxAspect;
      sX = (bottomImg.width - sW) / 2;
    }

    ctx.drawImage(bottomImg, sX, sY, sW, sH, bImgX, bImgY, bImgW, bImgH);
    ctx.restore();
  }

  return canvas.toDataURL('image/png', 1.0);
}
