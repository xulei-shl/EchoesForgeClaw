/**
 * 抖动效果（Dither / 色板量化）
 *
 * 算法思路参考 docs/多模态工具/图片处理/ditherjs-master（CC-BY-SA-4.0，仅参考概念、未复用其代码），
 * 原创实现要点：
 * - 统一量化核心：blockSize 像素块均值 → Float32 工作缓冲 → 最近色板匹配（平方距离线性扫，≤16 色）；
 * - Floyd–Steinberg / Atkinson 采用蛇形扫描（逐行交替方向），消除误差扩散的方向性蠕虫纹理；
 * - 有序抖动使用经典 4×4 Bayer 矩阵做通道偏移；全程无随机数，同参数输出确定性一致；
 * - 黑白走单通道亮度域，彩色色板 RGB 三通道独立扩散；alpha 通道原样保留。
 */

import type {
  DitherFxParams,
  ImageFxEffectDef,
  ImageFxRenderOptions,
} from '../types';
import { fxDrawingCanvas, fxLoadImage } from '../shared';

type DitherAlgorithm = DitherFxParams['algorithm'];
type DitherPaletteId = DitherFxParams['palette'];

const ALGORITHMS: readonly DitherAlgorithm[] = ['ordered', 'floyd_steinberg', 'atkinson'];
const PALETTE_IDS: readonly DitherPaletteId[] = ['mono', 'gameboy', 'cga', 'custom'];

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

/** 解析并兜底效果参数（历史数据缺字段时回落默认值） */
function resolveDitherParams(
  params: Record<string, unknown>
): DitherFxParams & { customPalette: string } {
  return {
    algorithm: ALGORITHMS.includes(params.algorithm as DitherAlgorithm)
      ? (params.algorithm as DitherAlgorithm)
      : 'floyd_steinberg',
    palette: PALETTE_IDS.includes(params.palette as DitherPaletteId)
      ? (params.palette as DitherPaletteId)
      : 'gameboy',
    blockSize: Math.round(clampNumber(params.blockSize, 1, 4, 1)),
    customPalette: typeof params.customPalette === 'string' ? params.customPalette : '#000000,#ffffff',
  };
}

/**
 * 色板定义。colors 每项通道数与工作缓冲一致（mono 为亮度域一维条目）；
 * amplitude 为有序抖动的通道偏移幅度（≈ 相邻色阶间距，黑白取满量程）。
 */
const DITHER_PALETTES: Record<
  Exclude<DitherPaletteId, 'custom'>,
  { colors: readonly (readonly number[])[]; amplitude: number }
> = {
  mono: {
    colors: [[0], [255]],
    amplitude: 255,
  },
  gameboy: {
    // DMG-01 经典四阶绿：#0f380f #306230 #8bac0f #9bbc0f
    colors: [
      [15, 56, 15],
      [48, 98, 48],
      [139, 172, 15],
      [155, 188, 15],
    ],
    amplitude: 128,
  },
  cga: {
    // CGA 文本模式十六色
    colors: [
      [0, 0, 0],
      [0, 0, 170],
      [0, 170, 0],
      [0, 170, 170],
      [170, 0, 0],
      [170, 0, 170],
      [170, 85, 0],
      [170, 170, 170],
      [85, 85, 85],
      [85, 85, 255],
      [85, 255, 85],
      [85, 255, 255],
      [255, 85, 85],
      [255, 85, 255],
      [255, 255, 85],
      [255, 255, 255],
    ],
    amplitude: 96,
  },
};

/** 自定义色板解析：逗号分隔的 #rrggbb 格式，返回 RGB 色板（至少 2 色，否则兜底黑白） */
function parseCustomPalette(input: string): readonly (readonly number[])[] {
  const colors: number[][] = [];
  for (const part of input.split(',').map(s => s.trim())) {
    const hex = part.replace('#', '');
    if (hex.length !== 6) continue;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) continue;
    colors.push([r, g, b]);
  }
  return colors.length >= 2 ? colors : [[0, 0, 0], [255, 255, 255]];
}

/** 经典 4×4 Bayer 阈值矩阵（0-15） */
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** 误差扩散核（前向行方向；蛇形扫描反向行时水平分量取反） */
type DiffusionKernel = readonly (readonly [dx: number, dy: number, weight: number])[];

const FLOYD_STEINBERG_KERNEL: DiffusionKernel = [
  [1, 0, 7 / 16],
  [-1, 1, 3 / 16],
  [0, 1, 5 / 16],
  [1, 1, 1 / 16],
];

// Atkinson：误差按 1/8 分散到 6 个邻点（经典 Mac / 热敏颗粒感）
const ATKINSON_KERNEL: DiffusionKernel = [
  [1, 0, 1 / 8],
  [2, 0, 1 / 8],
  [-1, 1, 1 / 8],
  [0, 1, 1 / 8],
  [1, 1, 1 / 8],
  [0, 2, 1 / 8],
];

/** 最近色板匹配（平方距离线性扫描；色板 ≤16 色，无需空间索引） */
function matchPalette(
  buf: Float32Array,
  base: number,
  ch: number,
  colors: readonly (readonly number[])[]
): readonly number[] {
  let best = colors[0];
  let bestDist = Infinity;
  for (let i = 0; i < colors.length; i++) {
    const color = colors[i];
    let dist = 0;
    for (let c = 0; c < ch; c++) {
      const diff = buf[base + c] - color[c];
      dist += diff * diff;
    }
    if (dist < bestDist) {
      bestDist = dist;
      best = color;
    }
  }
  return best;
}

/**
 * 统一量化核心：在块网格浮点缓冲上应用抖动，完成后每格即最终色板条目值。
 * ordered：按 Bayer 矩阵偏移各通道后匹配最近色；
 * 其余：蛇形扫描逐格匹配并扩散量化误差（奇数行反向遍历、扩散核水平分量镜像）。
 */
function ditherCells(
  buf: Float32Array,
  gridW: number,
  gridH: number,
  ch: number,
  algorithm: DitherAlgorithm,
  colors: readonly (readonly number[])[],
  amplitude: number
): void {
  if (algorithm === 'ordered') {
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        // (m + 0.5) / 16 ∈ (0,1)，居中后乘幅度 → 阈值级均匀铺满量化间隙
        const offset = ((BAYER_4X4[gy & 3][gx & 3] + 0.5) / 16 - 0.5) * amplitude;
        const base = (gy * gridW + gx) * ch;
        for (let c = 0; c < ch; c++) buf[base + c] += offset;
        const color = matchPalette(buf, base, ch, colors);
        for (let c = 0; c < ch; c++) buf[base + c] = color[c];
      }
    }
    return;
  }

  const kernel = algorithm === 'atkinson' ? ATKINSON_KERNEL : FLOYD_STEINBERG_KERNEL;
  for (let gy = 0; gy < gridH; gy++) {
    const reverse = (gy & 1) === 1;
    for (let step = 0; step < gridW; step++) {
      const gx = reverse ? gridW - 1 - step : step;
      const base = (gy * gridW + gx) * ch;

      const color = matchPalette(buf, base, ch, colors);
      for (let c = 0; c < ch; c++) {
        const err = buf[base + c] - color[c];
        buf[base + c] = color[c];
        distributeError(kernel, buf, gridW, gridH, gx, gy, c, ch, err, reverse);
      }
    }
  }
}

function distributeError(
  kernel: DiffusionKernel,
  buf: Float32Array,
  gridW: number,
  gridH: number,
  gx: number,
  gy: number,
  c: number,
  ch: number,
  error: number,
  reverse: boolean
): void {
  if (error === 0) return;
  for (let k = 0; k < kernel.length; k++) {
    const dx = reverse ? -kernel[k][0] : kernel[k][0];
    const dy = kernel[k][1];
    const nx = gx + dx;
    const ny = gy + dy;
    if (nx < 0 || nx >= gridW || ny >= gridH) continue;
    buf[(ny * gridW + nx) * ch + c] += error * kernel[k][2];
  }
}

async function renderDither(
  src: string,
  rawParams: Record<string, unknown>,
  options?: ImageFxRenderOptions
): Promise<HTMLCanvasElement> {
  const { algorithm, palette, blockSize, customPalette } = resolveDitherParams(rawParams);
  const { colors, amplitude } = palette === 'custom'
    ? { colors: parseCustomPalette(customPalette), amplitude: 96 }
    : DITHER_PALETTES[palette];
  // 通道数由色板条目推导：mono 为亮度域一维，彩色为 RGB 三维
  const ch = colors[0].length;
  const img = await fxLoadImage(src);
  const { canvas, ctx } = fxDrawingCanvas(img, options?.maxEdge ?? 2048);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const width = canvas.width;
  const height = canvas.height;
  const gridW = Math.ceil(width / blockSize);
  const gridH = Math.ceil(height / blockSize);

  // ① 块均值 → 工作缓冲（mono 取 Rec.709 亮度；彩色取 RGB 均值）
  const buf = new Float32Array(gridW * gridH * ch);
  for (let gy = 0; gy < gridH; gy++) {
    const pyStart = gy * blockSize;
    const pyEnd = Math.min(pyStart + blockSize, height);
    for (let gx = 0; gx < gridW; gx++) {
      const pxStart = gx * blockSize;
      const pxEnd = Math.min(pxStart + blockSize, width);
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let count = 0;
      for (let y = pyStart; y < pyEnd; y++) {
        let i = (y * width + pxStart) * 4;
        for (let x = pxStart; x < pxEnd; x++, i += 4) {
          if (ch === 1) {
            s0 += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          } else {
            s0 += data[i];
            s1 += data[i + 1];
            s2 += data[i + 2];
          }
          count++;
        }
      }
      const base = (gy * gridW + gx) * ch;
      buf[base] = s0 / count;
      if (ch === 3) {
        buf[base + 1] = s1 / count;
        buf[base + 2] = s2 / count;
      }
    }
  }

  ditherCells(buf, gridW, gridH, ch, algorithm, colors, amplitude);

  // ② 写回：整块填充量化色，只改 RGB 字节，alpha 原样保留
  for (let gy = 0; gy < gridH; gy++) {
    const pyStart = gy * blockSize;
    const pyEnd = Math.min(pyStart + blockSize, height);
    for (let gx = 0; gx < gridW; gx++) {
      const base = (gy * gridW + gx) * ch;
      const v0 = clampByte(buf[base]);
      const v1 = ch === 3 ? clampByte(buf[base + 1]) : v0;
      const v2 = ch === 3 ? clampByte(buf[base + 2]) : v0;
      const pxStart = gx * blockSize;
      const pxEnd = Math.min(pxStart + blockSize, width);
      for (let y = pyStart; y < pyEnd; y++) {
        let i = (y * width + pxStart) * 4;
        for (let x = pxStart; x < pxEnd; x++, i += 4) {
          data[i] = v0;
          data[i + 1] = v1;
          data[i + 2] = v2;
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** 抖动效果定义 */
export const DITHER_FX_EFFECT: ImageFxEffectDef = {
  id: 'dither',
  name: '抖动',
  description:
    '色板量化抖动：Bayer 有序 / Floyd–Steinberg / Atkinson 三算法 × 黑白、GameBoy 绿、CGA 十六色复古色板，像素化复古质感',
  params: [
    {
      kind: 'segment',
      key: 'algorithm',
      label: '算法',
      default: 'floyd_steinberg',
      options: [
        { value: 'floyd_steinberg', label: '扩散' },
        { value: 'ordered', label: '有序' },
        { value: 'atkinson', label: 'Atkinson' },
      ],
    },
    {
      kind: 'segment',
      key: 'palette',
      label: '色板',
      default: 'gameboy',
      options: [
        { value: 'mono', label: '黑白' },
        { value: 'gameboy', label: 'GameBoy' },
        { value: 'cga', label: 'CGA' },
        { value: 'custom', label: '自定义' },
      ],
    },
    {
      kind: 'slider',
      key: 'blockSize',
      label: '像素块',
      min: 1,
      max: 4,
      step: 1,
      default: 1,
      display: (v) => `${v}px`,
    },
  ],
  render: renderDither,
};
