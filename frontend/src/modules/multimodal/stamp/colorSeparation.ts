/**
 * 邮票印刷分色与工艺滤镜处理模块（Color Separation & Press Processes）
 * 包含：平版胶印 (Offset)、雕刻凹版 (Engraved)、照相凹版 (Photogravure)、凸版活字 (Typeset)
 */

import type { PrintMethod } from './types';

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [29, 63, 110];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 将源图像按照指定的印刷工艺重新分色
 *
 * @param sourceCanvas 源图像已经绘制好的 Canvas
 * @param print 印刷工艺
 * @param inkColor 油墨颜色
 * @returns 分色后的新 Canvas
 */
export function separateArtCanvas(
  sourceCanvas: HTMLCanvasElement,
  print: PrintMethod,
  inkColor: string
): HTMLCanvasElement {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const ctx = outCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return sourceCanvas;

  ctx.drawImage(sourceCanvas, 0, 0, w, h);

  // 平版胶印 (Offset): 保持源图真实原色与色阶，不进行单色油墨重分色
  if (print === 'offset') {
    return outCanvas;
  }

  const [ir, ig, ib] = hexToRgb(inkColor);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  for (let i = 0; i < d.length; i += 4) {
    // 心理学感知亮度 (Rec. 709)
    const l = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255;

    if (print === 'engraved') {
      // 雕刻凹版：硬朗调子曲线，去除平缓灰调，增强雕刻刀刀痕立体感
      const t = clamp01(Math.pow(1 - l, 0.8));
      d[i] = Math.round(mix(255, ir, t));
      d[i + 1] = Math.round(mix(255, ig, t));
      d[i + 2] = Math.round(mix(255, ib, t));
      d[i + 3] = Math.round(d[i + 3] * clamp01(t * 1.35));
    } else if (print === 'typeset') {
      // 凸版活字：高对比度黑白二值压印
      const t = l < 0.52 ? 1 : 0;
      d[i] = ir;
      d[i + 1] = ig;
      d[i + 2] = ib;
      d[i + 3] = d[i + 3] * t;
    } else {
      // 照相凹版 (Photogravure)：连续阶调，柔和向油墨色调过渡
      const t = clamp01(1 - l);
      d[i] = Math.round(mix(255, mix(30, ir, 0.55), t));
      d[i + 1] = Math.round(mix(255, mix(30, ig, 0.55), t));
      d[i + 2] = Math.round(mix(255, mix(30, ib, 0.55), t));
      d[i + 3] = Math.round(d[i + 3] * clamp01(t * 1.15 + 0.05));
    }
  }

  ctx.putImageData(img, 0, 0);
  return outCanvas;
}
