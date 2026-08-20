import { getReceiptTheme } from '../../themes';
import { isChineseName } from '../../borrowerGenerator';
import type { ReceiptState } from '../../types';
import { ensureFontsReady, loadImageSafe } from '../common/canvasUtils';

/**
 * 绘制复古图书馆借书卡 (Library Card Export Engine - 所见即所得 100% 对齐)
 */
export async function exportLibraryCardImage(
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
  ctx.strokeStyle = theme.dashed;
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
  ctx.strokeStyle = theme.dashed;
  ctx.lineWidth = 1;
  ctx.strokeRect(baseWidth - 36 - noWidth, 24, noWidth, 26);
  ctx.fillStyle = theme.faint;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(noText, baseWidth - 36 - noWidth / 2, 37);
  ctx.restore();

  // 大标题与副标题
  let curY = 52;
  ctx.textAlign = 'center';
  ctx.fillStyle = theme.text;
  ctx.font = "bold 36px '上图东观体', 'Noto Serif SC', 'LXGW WenKai', serif";
  ctx.fillText(state.storeName || '書海回响', baseWidth / 2, curY);

  curY += 26;
  // 副标装饰横线与英文
  ctx.strokeStyle = theme.faint;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(baseWidth / 2 - 120, curY);
  ctx.lineTo(baseWidth / 2 - 75, curY);
  ctx.moveTo(baseWidth / 2 + 75, curY);
  ctx.lineTo(baseWidth / 2 + 120, curY);
  ctx.stroke();

  ctx.fillStyle = theme.faint;
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
  ctx.fillStyle = theme.accent;
  ctx.font = "11px 'Cutive Mono', 'Courier New', monospace";
  ctx.fillText('AUTHOR', 36, curY + 16);

  ctx.fillStyle = theme.text;
  ctx.font = "18px '又又意宋', 'Noto Serif SC', serif";
  ctx.fillText(authorVal, 110, curY + 17);

  // 下划线
  ctx.save();
  ctx.strokeStyle = theme.dashed;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(36, curY + 26);
  ctx.lineTo(baseWidth - 36, curY + 26);
  ctx.stroke();
  ctx.restore();

  curY += 38;

  // Title 行
  ctx.fillStyle = theme.accent;
  ctx.font = "11px 'Cutive Mono', 'Courier New', monospace";
  ctx.fillText('TITLE', 36, curY + 16);

  ctx.fillStyle = theme.text;
  ctx.font = "bold 20px '又又意宋', 'Noto Serif SC', serif";
  ctx.fillText(titleVal, 110, curY + 17);

  ctx.save();
  ctx.strokeStyle = theme.dashed;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(36, curY + 26);
  ctx.lineTo(baseWidth - 36, curY + 26);
  ctx.stroke();
  ctx.restore();

  curY += 38;

  // Call No. & Year 行
  ctx.fillStyle = theme.accent;
  ctx.font = "10px 'Cutive Mono', 'Courier New', monospace";
  ctx.fillText('CALL NO.', 36, curY + 12);
  ctx.fillStyle = theme.text;
  ctx.font = "bold 15px 'Cutive Mono', 'Courier New', monospace";
  ctx.fillText(callNoVal, 36, curY + 30);

  ctx.fillStyle = theme.accent;
  ctx.font = "10px 'Cutive Mono', 'Courier New', monospace";
  ctx.fillText('YEAR', baseWidth - 110, curY + 12);
  ctx.fillStyle = theme.text;
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

  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, tableHeaderY);
  ctx.lineTo(baseWidth, tableHeaderY);
  ctx.moveTo(0, tableHeaderY + tableHeaderH);
  ctx.lineTo(baseWidth, tableHeaderY + tableHeaderH);
  ctx.stroke();

  const splitX = baseWidth * 0.32; // 172.8

  ctx.fillStyle = theme.accent;
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

    // 水平分割线
    ctx.save();
    ctx.strokeStyle = `color-mix(in srgb, ${theme.dashed} 80%, transparent)`;
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
      ctx.fillStyle = theme.accent;
      ctx.font = "bold 15px 'Special Elite', cursive, monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(record.date, 0, 0);
      ctx.restore();

      // Borrower's Name（中英文区分手写字体：中文 Zhi Mang Xing，英文 Caveat）
      ctx.save();
      ctx.fillStyle = theme.text;
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
  ctx.strokeStyle = theme.accent;
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
      ctx.fillStyle = theme.accent;
      ctx.font = "bold 12px '又又意宋', 'Noto Serif SC', serif";
    } else {
      ctx.fillStyle = theme.text;
      ctx.font = "11px '又又意宋', 'Noto Serif SC', serif";
    }
    ctx.fillText(rulesLines[idx], 36, ruleY);
    ruleY += 16;
  }

  // 英文须知（展平在下方）
  ctx.fillStyle = `color-mix(in srgb, ${theme.accent} 70%, transparent)`;
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
