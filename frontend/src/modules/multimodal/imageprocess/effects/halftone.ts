/**
 * 网点效果（Halftone / 经典印刷网屏）
 *
 * 算法参考 docs/多模态工具/图片处理/img-halftone-main（MIT）：
 * 图像按网屏角度旋转栅格化 → 单元格均值决定油墨覆盖率 → 点半径随覆盖率缩放，
 * 彩色模式按 CMYK 分离、四色板以经典印刷网角错开后 multiply 叠印。
 *
 * 相比参考实现的高效点（单线程即可，无需 Web Worker 池）：
 * - 每通道仅一次旋转栅格化 + 一趟线性像素扫描累计单元格均值（参考实现逐通道全图循环 + 逐格嵌套采样）；
 * - 全部网点合并进单条 Path2D 一次性填充，省去逐点绘制调用。
 */

import type {
  HalftoneFxParams,
  ImageFxEffectDef,
  ImageFxRenderOptions,
} from '../types';
import { fxDrawingCanvas, fxLoadImage } from '../shared';

type DotShape = HalftoneFxParams['shape'];

const DOT_SHAPES: readonly DotShape[] = ['circle', 'rect', 'triangle', 'hexagon'];

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

/** 解析并兜底效果参数（历史数据缺字段时回落默认值） */
function resolveHalftoneParams(params: Record<string, unknown>): HalftoneFxParams {
  return {
    dotSize: Math.round(clampNumber(params.dotSize, 4, 24, 8)),
    maxRadius: clampNumber(params.maxRadius, 0.2, 1, 0.7),
    angle: clampNumber(params.angle, 0, 90, 45),
    shape: DOT_SHAPES.includes(params.shape as DotShape)
      ? (params.shape as DotShape)
      : 'circle',
    mode: params.mode === 'cmyk' ? 'cmyk' : 'mono',
  };
}

/** 把半径 r 的网点加入路径（多边形顶点朝上对齐网格） */
function appendDot(path: Path2D, shape: DotShape, x: number, y: number, r: number): void {
  if (r <= 0) return;
  if (shape === 'circle') {
    path.moveTo(x + r, y);
    path.arc(x, y, r, 0, Math.PI * 2);
    return;
  }
  if (shape === 'rect') {
    path.rect(x - r, y - r, r * 2, r * 2);
    return;
  }
  const sides = shape === 'hexagon' ? 6 : 3;
  const start = -Math.PI / 2;
  path.moveTo(x + r * Math.cos(start), y + r * Math.sin(start));
  for (let i = 1; i < sides; i++) {
    const a = start + (i * Math.PI * 2) / sides;
    path.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  path.closePath();
}

/** 单元格平均 RGB → 该色板油墨覆盖率 0-1 */
type InkPick = (r: number, g: number, b: number) => number;

/** 单色板：亮度反转（Rec.709 加权，暗 → 大点） */
function pickKeyInk(r: number, g: number, b: number): number {
  return 1 - (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * CMYK 分离（参考实现口径）：d = max(r,g,b)，C = 1 − r/d、M = 1 − g/d、Y = 1 − b/d、K = 1 − d。
 * 近黑区（d 过小）比值噪声放大，回落为纯 K 板承载。
 */
function makeProcessInk(channel: 'c' | 'm' | 'y'): InkPick {
  return (r: number, g: number, b: number) => {
    const max = Math.max(r, g, b);
    if (max < 12) return 0;
    const v = channel === 'c' ? r : channel === 'm' ? g : b;
    return 1 - v / max;
  };
}

interface RotatedGrid {
  /** 旋转外接画布尺寸 */
  vw: number;
  vh: number;
  /** 网格规格 */
  column: number;
  rowCount: number;
  /** 各单元格平均 RGB（0-255） */
  rAvg: Float32Array;
  gAvg: Float32Array;
  bAvg: Float32Array;
}

/** 把原图按 rad 旋转栅格化到外接画布（空白补纸色），一趟扫描累计每单元格 RGB 均值 */
function rasterizeRotatedGrid(
  source: HTMLCanvasElement,
  rad: number,
  cellPx: number
): RotatedGrid {
  const w = source.width;
  const h = source.height;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const vw = Math.max(cellPx, Math.ceil(w * cos + h * sin));
  const vh = Math.max(cellPx, Math.ceil(w * sin + h * cos));

  const rot = document.createElement('canvas');
  rot.width = vw;
  rot.height = vh;
  const rotCtx = rot.getContext('2d', { willReadFrequently: true });
  if (!rotCtx) throw new Error('无法创建画布上下文');
  rotCtx.fillStyle = '#ffffff';
  rotCtx.fillRect(0, 0, vw, vh);
  rotCtx.translate(vw / 2, vh / 2);
  rotCtx.rotate(rad);
  rotCtx.drawImage(source, -w / 2, -h / 2);

  let pixels: Uint8ClampedArray;
  try {
    pixels = rotCtx.getImageData(0, 0, vw, vh).data;
  } catch {
    throw new Error('图片受跨域保护，无法读取像素数据');
  }

  const column = Math.ceil(vw / cellPx);
  const rowCount = Math.ceil(vh / cellPx);
  const cellCount = column * rowCount;
  const rSum = new Float32Array(cellCount);
  const gSum = new Float32Array(cellCount);
  const bSum = new Float32Array(cellCount);

  // 预生成 x→列号 映射，内层循环免除法
  const colIdx = new Int32Array(vw);
  for (let x = 0; x < vw; x++) {
    colIdx[x] = Math.min(column - 1, (x / cellPx) | 0);
  }

  for (let y = 0; y < vh; y++) {
    const rowBase = Math.min(rowCount - 1, (y / cellPx) | 0) * column;
    let i = y * vw * 4;
    for (let x = 0; x < vw; x++, i += 4) {
      const c = rowBase + colIdx[x];
      rSum[c] += pixels[i];
      gSum[c] += pixels[i + 1];
      bSum[c] += pixels[i + 2];
    }
  }

  const invArea = 1 / (cellPx * cellPx);
  const rAvg = new Float32Array(cellCount);
  const gAvg = new Float32Array(cellCount);
  const bAvg = new Float32Array(cellCount);
  for (let c = 0; c < cellCount; c++) {
    rAvg[c] = rSum[c] * invArea;
    gAvg[c] = gSum[c] * invArea;
    bAvg[c] = bSum[c] * invArea;
  }
  return { vw, vh, column, rowCount, rAvg, gAvg, bAvg };
}

async function renderHalftone(
  src: string,
  rawParams: Record<string, unknown>,
  options?: ImageFxRenderOptions
): Promise<HTMLCanvasElement> {
  const { dotSize, maxRadius, angle, shape, mode } = resolveHalftoneParams(rawParams);
  const img = await fxLoadImage(src);
  const { canvas: source } = fxDrawingCanvas(img, options?.maxEdge ?? 2048);
  const w = source.width;
  const h = source.height;

  // 输出画布与采样源分离：纸底（白）+ 印刷叠印混合，避免网点被下一通道再次采样
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'multiply';

  const baseRad = (angle * Math.PI) / 180;
  const deg = (d: number) => baseRad + (d * Math.PI) / 180;
  // 彩色模式经典四色网角（默认 45° 时对齐 C15/M75/Y0/K45）
  const plates =
    mode === 'mono'
      ? [{ color: '#000000', rad: baseRad, pick: pickKeyInk }]
      : [
          { color: '#00AEEF', rad: deg(-30), pick: makeProcessInk('c') },
          { color: '#EC008C', rad: deg(30), pick: makeProcessInk('m') },
          { color: '#FFF200', rad: deg(-45), pick: makeProcessInk('y') },
          { color: '#000000', rad: baseRad, pick: pickKeyInk },
        ];

  try {
    for (const plate of plates) {
      const grid = rasterizeRotatedGrid(source, plate.rad, dotSize);
      const path = new Path2D();
      const { column, rowCount } = grid;
      for (let j = 0; j < rowCount; j++) {
        const y = j * dotSize + dotSize / 2;
        const rowBase = j * column;
        for (let i = 0; i < column; i++) {
          const coverage = plate.pick(grid.rAvg[rowBase + i], grid.gAvg[rowBase + i], grid.bAvg[rowBase + i]);
          if (coverage <= 0) continue;
          appendDot(path, shape, i * dotSize + dotSize / 2, y, coverage * dotSize * maxRadius);
        }
      }
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(-plate.rad);
      ctx.translate(-grid.vw / 2, -grid.vh / 2);
      ctx.fillStyle = plate.color;
      ctx.fill(path);
      ctx.restore();
    }
  } finally {
    ctx.globalCompositeOperation = 'source-over';
  }

  return canvas;
}

/** 网点效果定义 */
export const HALFTONE_FX_EFFECT: ImageFxEffectDef = {
  id: 'halftone',
  name: '网点',
  description: '经典印刷网点：亮度/油墨覆盖率决定点半径；支持四种网点形状与 CMYK 四色分离叠印',
  params: [
    {
      kind: 'slider',
      key: 'dotSize',
      label: '点距',
      min: 4,
      max: 24,
      step: 1,
      default: 8,
      display: (v) => `${v}px`,
    },
    {
      kind: 'slider',
      key: 'maxRadius',
      label: '点半径',
      min: 0.2,
      max: 1,
      step: 0.05,
      default: 0.7,
      display: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'angle',
      label: '角度',
      min: 0,
      max: 90,
      step: 5,
      default: 45,
      display: (v) => `${v}°`,
    },
    {
      kind: 'segment',
      key: 'shape',
      label: '形状',
      default: 'circle',
      options: [
        { value: 'circle', label: '圆形' },
        { value: 'rect', label: '方形' },
        { value: 'triangle', label: '三角' },
        { value: 'hexagon', label: '六边' },
      ],
    },
    {
      kind: 'segment',
      key: 'mode',
      label: '色彩',
      default: 'mono',
      options: [
        { value: 'mono', label: '单色' },
        { value: 'cmyk', label: '彩色' },
      ],
    },
  ],
  render: renderHalftone,
};
