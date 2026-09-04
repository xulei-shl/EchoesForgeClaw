/**
 * 水墨写意 (InkWash) - 书画题款与真迹钤印辅助模块
 * 提供：上游文本智能提炼、离屏 Canvas 矢量书法与朱砂印章正片叠底合成
 */
import type { InkWashInscriptionItem } from './types';
import { drawVerticalColumns } from '../journal/text/drawText';
import { loadFontFamily, formatCanvasFont } from '../journal/text/fontRegistry';
import { getRandomSealSrc } from '../receipt/sealGenerator';

export { getRandomSealSrc };

/**
 * 智能提炼上游文本为古雅题款
 * 支持自动识别上游传递的书籍 JSON / 结构化格式（title, author 等）
 */
export function extractInscriptionFromUpstream(upstreamText?: string | null): string {
  if (!upstreamText || !upstreamText.trim()) {
    return '松风水月';
  }

  const raw = upstreamText.trim();

  // 1. 尝试匹配常见的 title / author 格式
  const titleMatch = raw.match(/title:\s*([^,\n;]+)/i);
  const authorMatch = raw.match(/author:\s*([^,\n;]+)/i);

  if (titleMatch && titleMatch[1]) {
    const title = titleMatch[1].trim().replace(/[《》〈〉]/g, '');
    const author = authorMatch && authorMatch[1] ? authorMatch[1].trim() : '';
    if (author) {
      return `${title}\n${author} 题`;
    }
    return title;
  }

  // 2. 如果包含换行，保留前 3 行以内且每行不宜过长
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    return lines.slice(0, 3).join('\n');
  }

  // 3. 单行纯文本截取适度长度
  if (raw.length > 40) {
    return raw.slice(0, 38) + '…';
  }

  return raw;
}

/** 异步加载图片辅助函数 */
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

/**
 * 离屏 Canvas 高清复合渲染器
 * 将 WebGL2 水墨宣纸底图、多段书法题款与朱砂真迹印章批量合成导出为最终画作 PNG
 */
export async function composeInkWashArtwork(
  baseDataUrl: string,
  inscriptions?: InkWashInscriptionItem[] | InkWashInscriptionItem | null,
  width?: number,
  height?: number
): Promise<string> {
  if (!baseDataUrl) return '';

  const list: InkWashInscriptionItem[] = Array.isArray(inscriptions)
    ? inscriptions
    : inscriptions
      ? [inscriptions]
      : [];

  const validItems = list.filter((it) => it.enabled && it.text?.trim());
  if (validItems.length === 0) {
    return baseDataUrl;
  }

  try {
    const baseImg = await loadImg(baseDataUrl);
    const canvas = document.createElement('canvas');
    const w = width || baseImg.naturalWidth || 1024;
    const h = height || baseImg.naturalHeight || 1024;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return baseDataUrl;

    // 1. 绘制底层 WebGL2 水墨宣纸图
    ctx.drawImage(baseImg, 0, 0, w, h);

    const minDim = Math.min(w, h);

    // 2. 批量循环绘制所有题款
    for (const item of validItems) {
      const fontFamily = item.fontFamily || '钟齐志莽行书';
      await loadFontFamily(fontFamily);

      const fontSize = Math.max(14, Math.round(minDim * (item.fontSizeRatio || 0.038)));
      const cx = (w * (item.x ?? 82)) / 100;
      const cy = (h * (item.y ?? 28)) / 100;

      const isVertical = item.writingMode !== 'horizontal';
      const lines = item.text.split('\n');

      ctx.save();
      ctx.font = formatCanvasFont(fontSize, fontFamily);
      ctx.fillStyle = item.color || '#16161e';

      if (isVertical) {
        // 竖排绘制（传统由右至左、汉字直立）
        ctx.translate(cx, cy);
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        drawVerticalColumns(
          ctx,
          item.text,
          fontSize,
          (str, x, y) => ctx.fillText(str, x, y),
          item.textAlign || 'center'
        );
        ctx.restore();
      } else {
        // 横排绘制
        ctx.textBaseline = 'middle';
        ctx.textAlign = (item.textAlign as CanvasTextAlign) || 'center';
        const lineHeight = fontSize * 1.35;
        const startY = cy - ((lines.length - 1) * lineHeight) / 2;
        lines.forEach((line, i) => {
          ctx.fillText(line, cx, startY + i * lineHeight);
        });
        ctx.restore();
      }

      // 绘制该条目附属的朱砂真迹印章
      if (item.sealEnabled && item.sealSrc) {
        try {
          const sealImg = await loadImg(item.sealSrc);
          const sealSize = Math.max(20, Math.round(fontSize * 1.35));

          let sealX = cx;
          let sealY = cy;

          if (isVertical) {
            const colWidth = fontSize * 1.35;
            const charHeight = fontSize * 1.2;
            const leftColOffset = ((lines.length - 1) / 2 - (lines.length - 1)) * colWidth;
            const maxLinesCount = Math.max(...lines.map((l) => l.length), 1);
            const totalColHeight = maxLinesCount * charHeight;

            sealX = cx + leftColOffset;
            sealY = cy + totalColHeight / 2 + sealSize * 0.75;
          } else {
            const lastLine = lines[lines.length - 1] || '';
            const lastLineWidth = ctx.measureText(lastLine).width;
            sealX = cx + lastLineWidth / 2 + sealSize * 0.75;
            sealY = cy + ((lines.length - 1) * fontSize * 1.35) / 2;
          }

          ctx.save();
          ctx.globalCompositeOperation = 'multiply';
          ctx.globalAlpha = 0.92;
          ctx.drawImage(sealImg, sealX - sealSize / 2, sealY - sealSize / 2, sealSize, sealSize);
          ctx.restore();
        } catch (err) {
          console.warn('印章合成绘制失败，略过印章图层:', err);
        }
      }
    }

    return canvas.toDataURL('image/png');
  } catch (err) {
    console.error('合成水墨画作题款失败:', err);
    return baseDataUrl;
  }
}
