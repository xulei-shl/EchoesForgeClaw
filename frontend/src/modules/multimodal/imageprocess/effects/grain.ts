/**
 * 噪点效果（Grain / 胶片颗粒）
 *
 * 算法移植自 docs/多模态工具/图片处理/Grainy-image-main（MIT）canvas 方法：
 * `(Math.random() - 0.5) * intensity * 255` 逐像素叠加到 RGB；
 * 扩展颗粒大小（g×g 块共享同一噪声值，模拟胶片药膜颗粒团）与单色/彩色两档。
 */

import type {
  GrainFxParams,
  ImageFxEffectDef,
  ImageFxRenderOptions,
} from '../types';
import { fxDrawingCanvas, fxLoadImage } from '../shared';

/** 解析并兜底效果参数（历史数据缺字段时回落默认值） */
function resolveGrainParams(params: Record<string, unknown>): GrainFxParams {
  return {
    intensity: clampNumber(params.intensity, 0, 1, 0.3),
    grainSize: Math.round(clampNumber(params.grainSize, 1, 8, 1)),
    mode: params.mode === 'color' ? 'color' : 'mono',
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

async function renderGrain(
  src: string,
  rawParams: Record<string, unknown>,
  options?: ImageFxRenderOptions
): Promise<HTMLCanvasElement> {
  const { intensity, grainSize, mode } = resolveGrainParams(rawParams);
  const img = await fxLoadImage(src);
  const { canvas, ctx } = fxDrawingCanvas(img, options?.maxEdge ?? 2048);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const amplitude = intensity * 255;

  // 按 g×g 块生成噪声（grainSize=1 时与源项目逐像素行为一致）
  for (let by = 0; by < canvas.height; by += grainSize) {
    const yEnd = Math.min(by + grainSize, canvas.height);
    for (let bx = 0; bx < canvas.width; bx += grainSize) {
      const xEnd = Math.min(bx + grainSize, canvas.width);
      // 单色：整块共用同一亮度噪声（源项目口径）；彩色：RGB 各自独立
      const noiseR = (Math.random() - 0.5) * amplitude;
      const noiseG = mode === 'color' ? (Math.random() - 0.5) * amplitude : noiseR;
      const noiseB = mode === 'color' ? (Math.random() - 0.5) * amplitude : noiseR;
      for (let y = by; y < yEnd; y++) {
        let i = (y * canvas.width + bx) * 4;
        for (let x = bx; x < xEnd; x++, i += 4) {
          data[i] += noiseR;
          data[i + 1] += noiseG;
          data[i + 2] += noiseB;
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/** 噪点效果定义 */
export const GRAIN_FX_EFFECT: ImageFxEffectDef = {
  id: 'grain',
  name: '噪点',
  description: '胶片颗粒噪点：亮度/彩色随机噪声按颗粒块叠加到原图（移植自 Grainy-image）',
  params: [
    {
      kind: 'slider',
      key: 'intensity',
      label: '强度',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.3,
      display: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'grainSize',
      label: '颗粒',
      min: 1,
      max: 8,
      step: 1,
      default: 1,
      display: (v) => `${v}px`,
    },
    {
      kind: 'segment',
      key: 'mode',
      label: '色彩',
      default: 'mono',
      options: [
        { value: 'mono', label: '单色' },
        { value: 'color', label: '彩色' },
      ],
    },
  ],
  render: renderGrain,
};
