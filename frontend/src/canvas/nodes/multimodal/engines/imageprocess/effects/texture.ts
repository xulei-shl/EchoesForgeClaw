/**
 * 触感质感滤镜（Tactile Texture Filters）
 *
 * 完整复刻自 texture.fayaz.workers.dev 的全部 24 种质感图像处理算法：
 * 包含孔版印刷（Risograph）、蓝晒（Cyanotype）、水彩水墨、纸浆纹理、
 * 专色误差扩散颗粒、Bayer 有序抖动、Unicode 盲文点阵、ASCII 字符流、
 * 乐高立体拼豆、2.5D 等轴测体素、霓虹发光波点等全部效果。
 *
 * 纯数学运算与 HTML5 Canvas 2D 像素/矢量渲染，无外部重量级依赖。
 */

import type {
  ImageFxEffectDef,
  ImageFxRenderOptions,
  TextureFxParams,
  TextureStyleId,
} from '../types';
import { fxDrawingCanvas, fxLoadImage } from '../shared';

/** 24 种质感风格名称及描述 */
export const TEXTURE_STYLES: { id: TextureStyleId; name: string; category: string; description: string }[] = [
  // 印刷与古典工艺
  { id: 'risograph', name: '孔版印刷 (Risograph)', category: 'print', description: '四色分色叠印与多角度旋转半色调网点' },
  { id: 'cyanotype', name: '传统蓝晒 (Cyanotype)', category: 'print', description: '三段色调普鲁士蓝古典摄影日光显影' },
  // 水彩、水墨与纸质
  { id: 'paper', name: '复古纸张 (Paper)', category: 'painterly', description: '各向异性纸浆纤维横纵交织与随机杂质斑点' },
  { id: 'watercolor', name: '水彩渗色 (Watercolor)', category: 'painterly', description: '五点局部漫射、水痕暗边与阶梯色彩量化' },
  { id: 'ink-wash', name: '水墨晕染 (Ink Wash)', category: 'painterly', description: '宣纸毛细吸墨流体扩散与焦浓重淡清五色' },
  // 抖动与单色颗粒
  { id: 'dither', name: '复古点阵 (Bitgrain)', category: 'dither', description: '8x8 Bayer 矩阵有序抖动与阶梯色阶量化' },
  { id: 'cobalt-grain', name: '钴蓝颗粒 (Cobalt Grain)', category: 'dither', description: '群青蓝专色油墨与 Floyd-Steinberg 蛇形误差扩散' },
  { id: 'denim-grain', name: '牛仔颗粒 (Denim Grain)', category: 'dither', description: '牛仔蓝专色与 6 方向平滑误差扩散' },
  { id: 'harbor-grain', name: '港湾颗粒 (Harbor Grain)', category: 'dither', description: '港湾墨绿专色与 3 方向扩散颗粒' },
  { id: 'meadow-grain', name: '草甸颗粒 (Meadow Grain)', category: 'dither', description: '草甸绿专色与 7 方向平滑扩散' },
  // 字符与排版
  { id: 'characters', name: '字符密度 (Glyphfield)', category: 'typography', description: '等宽字符灰度阶密度映射与居中排版' },
  { id: 'block', name: '方块字阶 (Typeblocks)', category: 'typography', description: '阴影遮罩块 █▓▒░ 灰度阶调排版' },
  { id: 'mixed', name: '杂讯符号 (Signal Mix)', category: 'typography', description: '符号字符密度映射叠加空间 Hash 扰动错位' },
  { id: 'braille', name: '盲文点阵 (Dot Cells)', category: 'typography', description: 'Unicode 盲文字符集 2x4 八点采样位运算' },
  { id: 'dots', name: '散点版画 (Stipple)', category: 'typography', description: '点阵字符排版叠加水平微细半透明扫描线' },
  // 几何与立体像素
  { id: 'cross', name: '十字叉线 (Crossmarks)', category: 'geometric', description: '明暗自适应粗细与臂长的十字交叉标' },
  { id: 'diamond', name: '菱形切面 (Facets)', category: 'geometric', description: '封闭四顶点自适应菱形矢量切面' },
  { id: 'lines', name: '横向雕刻 (Linepress)', category: 'geometric', description: '横向版画雕刻线条随暗部自适应加粗' },
  { id: 'diagonal', name: '斜向排线 (Slant)', category: 'geometric', description: '45度斜向排线雕刻，暗部连片亮部断开' },
  { id: 'pixel-art', name: '像素粉碎 (Pixel Crush)', category: 'geometric', description: '网格均值降采样与 RGB 各通道 5 阶量化' },
  { id: 'mosaic', name: '马赛克嵌砖 (Tessera)', category: 'geometric', description: '带缝隙间距与半透明度的马赛克瓷砖拼贴' },
  { id: 'lego', name: '积木拼豆 (Studwork)', category: 'geometric', description: '乐高积木底座、高光凸粒圆与底部投影暗圆' },
  { id: 'voxel', name: '等轴体素 (Isoform)', category: 'geometric', description: '交错网格 2.5D 等轴测悬浮立方体三面定向光照' },
  { id: 'disco', name: '霓虹波普 (Chroma Pop)', category: 'geometric', description: '径向波点与 Canvas 原生阴影辉光光晕' },
];

/** 各风格官方推荐默认参数（detail, intensity, contrast） */
export const TEXTURE_STYLE_PRESETS: Record<TextureStyleId, { detail: number; intensity: number; contrast: number }> = {
  characters: { detail: 68, intensity: 82, contrast: 56 },
  risograph: { detail: 58, intensity: 100, contrast: 57 },
  dither: { detail: 64, intensity: 100, contrast: 58 },
  'cobalt-grain': { detail: 73, intensity: 100, contrast: 61 },
  'denim-grain': { detail: 76, intensity: 100, contrast: 58 },
  'harbor-grain': { detail: 74, intensity: 100, contrast: 62 },
  'meadow-grain': { detail: 72, intensity: 100, contrast: 60 },
  block: { detail: 65, intensity: 86, contrast: 56 },
  dots: { detail: 72, intensity: 100, contrast: 61 },
  paper: { detail: 76, intensity: 92, contrast: 53 },
  watercolor: { detail: 61, intensity: 94, contrast: 57 },
  'ink-wash': { detail: 59, intensity: 96, contrast: 60 },
  cyanotype: { detail: 70, intensity: 100, contrast: 61 },
  mixed: { detail: 65, intensity: 84, contrast: 57 },
  'pixel-art': { detail: 64, intensity: 92, contrast: 58 },
  mosaic: { detail: 67, intensity: 90, contrast: 56 },
  lego: { detail: 62, intensity: 92, contrast: 59 },
  cross: { detail: 65, intensity: 84, contrast: 56 },
  diamond: { detail: 65, intensity: 86, contrast: 57 },
  lines: { detail: 67, intensity: 84, contrast: 57 },
  diagonal: { detail: 66, intensity: 84, contrast: 57 },
  braille: { detail: 70, intensity: 88, contrast: 58 },
  voxel: { detail: 63, intensity: 92, contrast: 58 },
  disco: { detail: 64, intensity: 90, contrast: 60 },
};

/* =========================================================================
 * 核心公共数学函数与工具
 * ========================================================================= */

const BASE_CANVAS_DIM = 1400;

/** 缩放自适应标量：保证高低分辨率下网格与笔触视觉一致 */
const getScale = (w: number, h: number): number => Math.max(0.5, Math.max(w, h) / BASE_CANVAS_DIM);

/** 数值截断限制在 [min, max] */
const clamp = (val: number, min = 0, max = 255): number => Math.min(max, Math.max(min, val));

/** S 型对比度增强曲线 */
const adjustContrast = (val: number, contrast: number): number => {
  const n = ((contrast - 50) / 50) * 0.72;
  const r = (1 + n) / (1 - n);
  return clamp((val / 255 - 0.5) * r * 255 + 127.5);
};

/** 2D 伪随机白噪声（GLSL 风格 Hash） */
const whiteNoise = (x: number, y: number): number => {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
};

/** 2D Hermite 平滑插值值噪声（模拟纸浆纤维与水彩流动） */
const valueNoise = (x: number, y: number, scale: number): number => {
  const rx = x / scale;
  const ry = y / scale;
  const ix = Math.floor(rx);
  const iy = Math.floor(ry);
  const fx = rx - ix;
  const fy = ry - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const d0 = whiteNoise(ix, iy) * (1 - ux) + whiteNoise(ix + 1, iy) * ux;
  const d1 = whiteNoise(ix, iy + 1) * (1 - ux) + whiteNoise(ix + 1, iy + 1) * ux;
  return d0 * (1 - uy) + d1 * uy;
};

/** Rec.709 相对亮度公式 */
const calcLuma = (rgb: number[]): number => 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);

/** 颜色正片叠底 */
const multiplyColor = (dst: number[], src: number[]): void => {
  dst[0] = (dst[0] * src[0]) / 255;
  dst[1] = (dst[1] * src[1]) / 255;
  dst[2] = (dst[2] * src[2]) / 255;
};

/** 像素颜色按强度比例混合写回目标 ImageData 数组 */
const blendPixel = (dst: Uint8ClampedArray, offset: number, srcRgb: number[], targetRgb: number[], intensityPercent: number): void => {
  const alpha = intensityPercent / 100;
  dst[offset] = (srcRgb[0] ?? 0) * (1 - alpha) + (targetRgb[0] ?? 0) * alpha;
  dst[offset + 1] = (srcRgb[1] ?? 0) * (1 - alpha) + (targetRgb[1] ?? 0) * alpha;
  dst[offset + 2] = (srcRgb[2] ?? 0) * (1 - alpha) + (targetRgb[2] ?? 0) * alpha;
  dst[offset + 3] = 255;
};

/** 采样指定坐标像素颜色 */
const samplePixel = (data: Uint8ClampedArray, width: number, height: number, x: number, y: number): number[] => {
  const cx = Math.max(0, Math.min(width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(height - 1, Math.round(y)));
  const idx = (cy * width + cx) * 4;
  return [data[idx] ?? 0, data[idx + 1] ?? 0, data[idx + 2] ?? 0];
};

/** 计算矩形区域的平均颜色 */
const getAverageColor = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  cw: number,
  ch: number
): number[] => {
  let r = 0, g = 0, b = 0, count = 0;
  const step = Math.max(1, Math.floor(Math.min(cw, ch) / 3));
  const xEnd = Math.min(width, Math.ceil(x + cw));
  const yEnd = Math.min(height, Math.ceil(y + ch));
  const xStart = Math.max(0, Math.floor(x));
  const yStart = Math.max(0, Math.floor(y));

  for (let ny = yStart; ny < yEnd; ny += step) {
    for (let nx = xStart; nx < xEnd; nx += step) {
      const idx = (ny * width + nx) * 4;
      r += data[idx] ?? 0;
      g += data[idx + 1] ?? 0;
      b += data[idx + 2] ?? 0;
      count += 1;
    }
  }
  const div = Math.max(1, count);
  return [r / div, g / div, b / div];
};

/** 对 RGB 三通道分别应用对比度 */
const applyContrastRgb = (rgb: number[], contrast: number): number[] => rgb.map((c) => adjustContrast(c, contrast));

/** 色彩阶梯量化 */
const quantizeChannel = (val: number, steps = 6): number => Math.round((val / 255) * (steps - 1)) * (255 / (steps - 1));
const quantizeRgb = (rgb: number[], steps = 6): number[] => rgb.map((c) => quantizeChannel(c, steps));

/** 生成半透明色字符串 */
const toRgbaStr = (rgb: number[], alpha: number): string => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;

/** 根据亮度自适应文字透明度与反差着色 */
const calcAdaptiveTextFill = (rgb: number[], luma: number, intensityRatio: number): string => {
  const isBright = luma >= 138;
  const ratio = isBright ? 0.24 : 0.66;
  const adjusted = rgb.map((c) => (isBright ? c * (1 - ratio) : c + (255 - c) * ratio));
  const normDist = Math.abs(luma - 128) / 128;
  const alpha = (0.46 + Math.min(1, normDist) * 0.18) * intensityRatio;
  return `rgba(${adjusted[0]}, ${adjusted[1]}, ${adjusted[2]}, ${alpha})`;
};

/* =========================================================================
 * 像素着色器（Pixel Stream Shaders - 10 种滤镜）
 * ========================================================================= */

const RISO_PAPER = [245, 239, 221];
const RISO_INKS = [
  [0, 120, 145],  // 青蓝
  [226, 79, 45],  // 亮红
  [244, 190, 22], // 柠檬黄
  [28, 54, 47],   // 墨绿
];
const RISO_COS = [Math.cos(0.27), Math.cos(-0.27), 1, Math.cos(0.78)];
const RISO_SIN = [Math.sin(0.27), Math.sin(-0.27), 0, Math.sin(0.78)];

/** 1. Risograph 孔版印刷滤镜 */
function renderRisograph(src: ImageData, params: TextureFxParams): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(src.data.length);
  const scale = getScale(src.width, src.height);
  const gridSize = (3 + Math.round(((100 - params.detail) / 100) * 8)) * scale;

  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const idx = (y * src.width + x) * 4;
      const srcRgb = [src.data[idx] ?? 0, src.data[idx + 1] ?? 0, src.data[idx + 2] ?? 0];
      const r = adjustContrast(srcRgb[0], params.contrast) / 255;
      const g = adjustContrast(srcRgb[1], params.contrast) / 255;
      const b = adjustContrast(srcRgb[2], params.contrast) / 255;

      const k = 1 - Math.max(r, g, b);
      const denom = Math.max(0.001, 1 - k);
      const cmyk = [(1 - r - k) / denom, (1 - g - k) / denom, (1 - b - k) / denom, k];

      const normX = x / scale;
      const normY = y / scale;
      const microNoise = (whiteNoise(normX, normY) - 0.5) * 0.12;
      const pixelColor = [...RISO_PAPER];

      for (let ch = 0; ch < 4; ch++) {
        const inkDensity = clamp((cmyk[ch] ?? 0) + (ch < 3 ? microNoise : 0), 0, 1);
        if (inkDensity <= 0.012) continue;
        let isHit = inkDensity >= 0.988;
        if (!isHit) {
          const cos = RISO_COS[ch] ?? 1;
          const sin = RISO_SIN[ch] ?? 0;
          const rotX = x * cos - y * sin + ch * 1.7 * scale;
          const rotY = x * sin + y * cos + ch * 1.7 * scale * 0.63;
          const modX = ((rotX % gridSize) + gridSize) % gridSize - gridSize / 2;
          const modY = ((rotY % gridSize) + gridSize) % gridSize - gridSize / 2;
          const targetR = Math.sqrt(inkDensity / Math.PI) * gridSize;
          isHit = modX * modX + modY * modY <= targetR * targetR;
        }
        if (isHit) {
          multiplyColor(pixelColor, RISO_INKS[ch] ?? RISO_INKS[3]);
        }
      }

      const paperGrain = (whiteNoise(normX + 31, normY - 17) - 0.5) * 10;
      pixelColor[0] = clamp(pixelColor[0] + paperGrain);
      pixelColor[1] = clamp(pixelColor[1] + paperGrain);
      pixelColor[2] = clamp(pixelColor[2] + paperGrain);

      blendPixel(dst, idx, srcRgb, pixelColor, params.intensity);
    }
  }
  return dst;
}

/** 8x8 Bayer 抖动矩阵 */
const BAYER_8X8 = [
  0, 48, 12, 60, 3, 51, 15, 63,
  32, 16, 44, 28, 35, 19, 47, 31,
  8, 56, 4, 52, 11, 59, 7, 55,
  40, 24, 36, 20, 43, 27, 39, 23,
  2, 50, 14, 62, 1, 49, 13, 61,
  34, 18, 46, 30, 33, 17, 45, 29,
  10, 58, 6, 54, 9, 57, 5, 53,
  42, 26, 38, 22, 41, 25, 37, 21,
];

/** 2. Bitgrain 复古点阵抖动滤镜 */
function renderBitgrain(src: ImageData, params: TextureFxParams): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(src.data.length);
  const scale = getScale(src.width, src.height);
  const blockSize = Math.max(1, Math.round((1 + Math.round(((100 - params.detail) / 100) * 5)) * scale));
  const quantSteps = params.detail > 72 ? 5 : params.detail > 38 ? 4 : 3;

  const quantizeChannelWithThreshold = (val: number, threshold: number): number => {
    const scaled = (val / 255) * (quantSteps - 1);
    const base = Math.floor(scaled);
    return ((base + (scaled - base > threshold ? 1 : 0)) / (quantSteps - 1)) * 255;
  };

  for (let y = 0; y < src.height; y += blockSize) {
    for (let x = 0; x < src.width; x += blockSize) {
      const idx = (y * src.width + x) * 4;
      const bayerVal = ((BAYER_8X8[((y / blockSize) % 8) * 8 + ((x / blockSize) % 8)] ?? 0) + 0.5) / 64;
      const ditheredRgb = [0, 1, 2].map((ch) =>
        quantizeChannelWithThreshold(adjustContrast(src.data[idx + ch] ?? 0, params.contrast), bayerVal)
      );

      const yMax = Math.min(y + blockSize, src.height);
      const xMax = Math.min(x + blockSize, src.width);
      for (let py = y; py < yMax; py++) {
        for (let px = x; px < xMax; px++) {
          const pIdx = (py * src.width + px) * 4;
          blendPixel(dst, pIdx, [src.data[pIdx] ?? 0, src.data[pIdx + 1] ?? 0, src.data[pIdx + 2] ?? 0], ditheredRgb, params.intensity);
        }
      }
    }
  }
  return dst;
}

/** 单色颗粒配置表 */
const GRAIN_STYLES_CONFIG: Record<
  string,
  { ink: number[]; paper: number[]; kernel: [number, number, number][]; noise: number; thresholdBias: number }
> = {
  'cobalt-grain': {
    ink: [49, 61, 235],
    paper: [248, 248, 252],
    kernel: [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]],
    noise: 7,
    thresholdBias: 4,
  },
  'denim-grain': {
    ink: [70, 121, 164],
    paper: [248, 249, 247],
    kernel: [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]],
    noise: 5,
    thresholdBias: 7,
  },
  'harbor-grain': {
    ink: [2, 92, 116],
    paper: [243, 248, 244],
    kernel: [[1, 0, 1 / 2], [-1, 1, 1 / 4], [0, 1, 1 / 4]],
    noise: 6,
    thresholdBias: 2,
  },
  'meadow-grain': {
    ink: [25, 134, 32],
    paper: [248, 250, 242],
    kernel: [[1, 0, 8 / 32], [2, 0, 4 / 32], [-2, 1, 2 / 32], [-1, 1, 4 / 32], [0, 1, 8 / 32], [1, 1, 4 / 32], [2, 1, 2 / 32]],
    noise: 8,
    thresholdBias: 5,
  },
};

/** 3. Cobalt / Denim / Harbor / Meadow 专色颗粒滤镜（误差扩散 + 蛇形扫描） */
function renderGrainDiffusion(src: ImageData, params: TextureFxParams, styleId: string): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(src.data.length);
  const cfg = GRAIN_STYLES_CONFIG[styleId] ?? GRAIN_STYLES_CONFIG['cobalt-grain'];
  const scale = getScale(src.width, src.height);
  const blockSize = Math.max(1, Math.round(scale * (1.64 + ((100 - params.detail) / 100) * 1.84)));
  const gridW = Math.ceil(src.width / blockSize);
  const gridH = Math.ceil(src.height / blockSize);
  const lumaBuffer = new Float32Array(gridW * gridH);

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const px = Math.min(src.width - 1, gx * blockSize + Math.floor(blockSize / 2));
      const py = Math.min(src.height - 1, gy * blockSize + Math.floor(blockSize / 2));
      const idx = (py * src.width + px) * 4;
      const rgb = [src.data[idx] ?? 0, src.data[idx + 1] ?? 0, src.data[idx + 2] ?? 0];
      const noise = (whiteNoise(gx * 0.61 + 17, gy * 0.57 - 23) - 0.5) * cfg.noise;
      lumaBuffer[gy * gridW + gx] = clamp(adjustContrast(calcLuma(rgb), params.contrast + 7) + noise);
    }
  }

  // 蛇形扫描扩散误差（Serpentine scanning）
  for (let gy = 0; gy < gridH; gy++) {
    const dir = gy % 2 === 0 ? 1 : -1;
    const startX = dir === 1 ? 0 : gridW - 1;
    const endX = dir === 1 ? gridW : -1;

    for (let gx = startX; gx !== endX; gx += dir) {
      const curLuma = lumaBuffer[gy * gridW + gx] ?? 0;
      const isInk = curLuma < 128 + cfg.thresholdBias;
      const chosenColor = isInk ? cfg.ink : cfg.paper;
      const err = curLuma - (isInk ? 0 : 255);

      for (const [kx, ky, kw] of cfg.kernel) {
        const nx = gx + kx * dir;
        const ny = gy + ky;
        if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
          const nIdx = ny * gridW + nx;
          lumaBuffer[nIdx] = (lumaBuffer[nIdx] ?? 0) + err * kw;
        }
      }

      const xMin = gx * blockSize;
      const yMin = gy * blockSize;
      const xMax = Math.min(xMin + blockSize, src.width);
      const yMax = Math.min(yMin + blockSize, src.height);

      for (let py = yMin; py < yMax; py++) {
        for (let px = xMin; px < xMax; px++) {
          const pIdx = (py * src.width + px) * 4;
          blendPixel(dst, pIdx, [src.data[pIdx] ?? 0, src.data[pIdx + 1] ?? 0, src.data[pIdx + 2] ?? 0], chosenColor, params.intensity);
        }
      }
    }
  }
  return dst;
}

/** 4. Paper 复古纸张滤镜 */
function renderPaper(src: ImageData, params: TextureFxParams): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(src.data.length);
  const scale = getScale(src.width, src.height);

  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const idx = (y * src.width + x) * 4;
      const srcRgb = [src.data[idx] ?? 0, src.data[idx + 1] ?? 0, src.data[idx + 2] ?? 0];
      const contrastedRgb = applyContrastRgb(srcRgb, params.contrast);
      const normX = x / scale;
      const normY = y / scale;

      const horizNoise = (valueNoise(normX, normY * 0.18, 28) - 0.5) * 9;
      const vertNoise = (valueNoise(normX * 0.24, normY, 17) - 0.5) * 5;
      const sandNoise = (whiteNoise(normX * 0.63, normY * 0.47) - 0.5) * 5;
      const speck = whiteNoise(normX * 0.91 + 17, normY * 0.83 - 9) > 0.987 ? -18 : 0;

      const blended = contrastedRgb.map((c, i) =>
        clamp((RISO_PAPER[i] ?? 240) + (c - (RISO_PAPER[i] ?? 240)) * 0.72 + horizNoise + vertNoise + sandNoise + speck)
      );
      blendPixel(dst, idx, srcRgb, blended, params.intensity);
    }
  }
  return dst;
}

/** 5. Watercolor 水彩渗色滤镜 */
function renderWatercolor(src: ImageData, params: TextureFxParams): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(src.data.length);
  const scale = getScale(src.width, src.height);
  const offset = Math.max(1, Math.round((2.2 + ((100 - params.detail) / 100) * 4.8) * scale));

  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const idx = (y * src.width + x) * 4;
      const srcRgb = [src.data[idx] ?? 0, src.data[idx + 1] ?? 0, src.data[idx + 2] ?? 0];

      // 十字 5 点邻域模糊
      const samples = [
        samplePixel(src.data, src.width, src.height, x, y),
        samplePixel(src.data, src.width, src.height, x - offset, y),
        samplePixel(src.data, src.width, src.height, x + offset, y),
        samplePixel(src.data, src.width, src.height, x, y - offset),
        samplePixel(src.data, src.width, src.height, x, y + offset),
      ];
      const avgRgb = [0, 1, 2].map((ch) => samples.reduce((acc, s) => acc + (s[ch] ?? 0), 0) / samples.length);
      const avgLuma = calcLuma(avgRgb);
      const enhancedRgb = avgRgb.map((c) => adjustContrast(avgLuma + (c - avgLuma) * 1.18, params.contrast));

      // 差分梯度检测暗边水痕
      const leftLuma = calcLuma(samplePixel(src.data, src.width, src.height, x - offset, y));
      const rightLuma = calcLuma(samplePixel(src.data, src.width, src.height, x + offset, y));
      const topLuma = calcLuma(samplePixel(src.data, src.width, src.height, x, y - offset));
      const botLuma = calcLuma(samplePixel(src.data, src.width, src.height, x, y + offset));
      const edgeDarken = Math.min(0.25, (Math.abs(rightLuma - leftLuma) + Math.abs(botLuma - topLuma)) / 390);

      const normX = x / scale;
      const normY = y / scale;
      const fluidNoise = (valueNoise(normX, normY, 24) - 0.5) * 14;
      const microNoise = (whiteNoise(normX * 0.38 + 4, normY * 0.42 - 8) - 0.5) * 7;

      const finalRgb = enhancedRgb.map((c, i) => {
        const val = c * 0.94 + (RISO_PAPER[i] ?? 240) * 0.06 + fluidNoise + microNoise;
        return clamp(Math.round(val / 14) * 14 * (1 - edgeDarken));
      });

      blendPixel(dst, idx, srcRgb, finalRgb, params.intensity);
    }
  }
  return dst;
}

/** 6. Ink Wash 水墨晕染滤镜 */
function renderInkWash(src: ImageData, params: TextureFxParams): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(src.data.length);
  const scale = getScale(src.width, src.height);
  const offset = Math.max(1, Math.round(2.4 * scale));
  const deepInk = [28, 31, 29];

  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const idx = (y * src.width + x) * 4;
      const srcRgb = [src.data[idx] ?? 0, src.data[idx + 1] ?? 0, src.data[idx + 2] ?? 0];
      const luma = adjustContrast(calcLuma(srcRgb), params.contrast + 4) / 255;

      const leftLuma = calcLuma(samplePixel(src.data, src.width, src.height, x - offset, y));
      const rightLuma = calcLuma(samplePixel(src.data, src.width, src.height, x + offset, y));
      const topLuma = calcLuma(samplePixel(src.data, src.width, src.height, x, y - offset));
      const botLuma = calcLuma(samplePixel(src.data, src.width, src.height, x, y + offset));
      const edge = Math.min(0.34, (Math.abs(rightLuma - leftLuma) + Math.abs(botLuma - topLuma)) / 300);

      const normX = x / scale;
      const normY = y / scale;
      const fluidNoise = (valueNoise(normX, normY, 34) - 0.5) * 0.12;
      const speck = whiteNoise(normX * 0.58 + 31, normY * 0.09 - 14) > 0.94 ? 0.1 : 0;
      const stepLuma = clamp(Math.round((luma + fluidNoise + speck - edge) * 6) / 6, 0, 1);
      const grain = (whiteNoise(normX * 0.27, normY * 0.61) - 0.5) * 7;

      const finalRgb = RISO_PAPER.map((paperC, i) =>
        clamp((deepInk[i] ?? 28) * (1 - stepLuma) + paperC * stepLuma + grain)
      );

      blendPixel(dst, idx, srcRgb, finalRgb, params.intensity);
    }
  }
  return dst;
}

/** 7. Cyanotype 蓝晒摄影滤镜 */
function renderCyanotype(src: ImageData, params: TextureFxParams): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(src.data.length);
  const scale = getScale(src.width, src.height);
  const prussianDark = [5, 31, 58];
  const indigoMid = [18, 87, 130];
  const emulsionLight = [232, 235, 211];

  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const idx = (y * src.width + x) * 4;
      const srcRgb = [src.data[idx] ?? 0, src.data[idx + 1] ?? 0, src.data[idx + 2] ?? 0];
      const luma = adjustContrast(calcLuma(srcRgb), params.contrast + 6) / 255;
      const f = Math.min(1, luma * 2);
      const p = Math.max(0, luma * 2 - 1);

      const normX = x / scale;
      const normY = y / scale;
      const grain = (whiteNoise(normX * 0.53 + 12, normY * 0.49 - 21) - 0.5) * 8;

      const rampRgb = [0, 1, 2].map((i) =>
        clamp(((prussianDark[i] ?? 0) * (1 - f) + (indigoMid[i] ?? 0) * f) * (1 - p) + (emulsionLight[i] ?? 255) * p + grain)
      );

      blendPixel(dst, idx, srcRgb, rampRgb, params.intensity);
    }
  }
  return dst;
}

/* =========================================================================
 * 矢量与字符渲染器（Vector & Typography Shaders - 14 种滤镜）
 * ========================================================================= */

const GLYPH_CHARS = '@%#*+=-:. ';
const BLOCK_CHARS = '█▓▒░ ';
const MIXED_CHARS = '@▓#*+·:- ';

/** 8. 字符密度与几何图元（Characters, Blocks, Mixed, Cross, Diamond, Lines, Slant） */
function renderGlyphsAndShapes(
  ctx: CanvasRenderingContext2D,
  src: ImageData,
  params: TextureFxParams,
  style: string
): void {
  const { width, height, data } = src;
  const scale = getScale(width, height);
  const cellW = (5 + Math.round(((100 - params.detail) / 100) * 13)) * scale;
  const cellH = Math.max(7, Math.round(cellW * 1.55));
  const intensityRatio = params.intensity / 100;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = `650 ${Math.ceil(cellH * 0.9)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let y = 0; y < height; y += cellH) {
    for (let x = 0; x < width; x += cellW) {
      const avgRgb = applyContrastRgb(getAverageColor(data, width, height, x, y, cellW, cellH), params.contrast);
      const luma = calcLuma(avgRgb);
      const darkRatio = 1 - luma / 255;
      const centerX = x + cellW / 2;
      const centerY = y + cellH / 2;

      ctx.fillStyle = calcAdaptiveTextFill(avgRgb, luma, intensityRatio);
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(scale, cellW * 0.12);

      if (style === 'cross') {
        const arm = cellW * (0.12 + darkRatio * 0.34);
        ctx.beginPath();
        ctx.moveTo(centerX - arm, centerY); ctx.lineTo(centerX + arm, centerY);
        ctx.moveTo(centerX, centerY - arm); ctx.lineTo(centerX, centerY + arm);
        ctx.stroke();
        continue;
      }

      if (style === 'diamond') {
        const r = cellW * (0.12 + darkRatio * 0.4);
        ctx.beginPath();
        ctx.moveTo(centerX, centerY - r);
        ctx.lineTo(centerX + r, centerY);
        ctx.lineTo(centerX, centerY + r);
        ctx.lineTo(centerX - r, centerY);
        ctx.closePath();
        ctx.fill();
        continue;
      }

      if (style === 'lines' || style === 'diagonal') {
        const arm = cellW * (0.14 + darkRatio * 0.42);
        ctx.beginPath();
        if (style === 'lines') {
          ctx.moveTo(centerX - arm, centerY);
          ctx.lineTo(centerX + arm, centerY);
        } else {
          ctx.moveTo(centerX - arm, centerY + arm);
          ctx.lineTo(centerX + arm, centerY - arm);
        }
        ctx.stroke();
        continue;
      }

      // 字符流排版
      const charSet = style === 'block' ? BLOCK_CHARS : style === 'mixed' ? MIXED_CHARS : GLYPH_CHARS;
      let charIdx = Math.min(charSet.length - 1, Math.floor((luma / 256) * charSet.length));
      if (style === 'mixed') {
        const jitter = Math.floor(whiteNoise(x / scale, y / scale) * 3) - 1;
        charIdx = Math.max(0, Math.min(charSet.length - 1, charIdx + jitter));
      }
      ctx.fillText(charSet[charIdx] ?? ' ', centerX, centerY);
    }
  }
  ctx.restore();
}

/** 9. 散点版画滤镜（Stipple Dots + 扫描线） */
function renderStippleDots(ctx: CanvasRenderingContext2D, src: ImageData, params: TextureFxParams): void {
  const { width, height, data } = src;
  const scale = getScale(width, height);
  const cellW = (5.4 + ((100 - params.detail) / 100) * 2.5) * scale;
  const cellH = cellW * 1.55;
  const intensityRatio = params.intensity / 100;

  // 底层压暗底图
  const bgData = new Uint8ClampedArray(data.length);
  const contrastOffset = Math.min(100, params.contrast + 6);
  for (let i = 0; i < data.length; i += 4) {
    bgData[i] = adjustContrast(data[i] ?? 0, contrastOffset) * 0.74;
    bgData[i + 1] = adjustContrast(data[i + 1] ?? 0, contrastOffset) * 0.74;
    bgData[i + 2] = adjustContrast(data[i + 2] ?? 0, contrastOffset) * 0.74;
    bgData[i + 3] = 255;
  }
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.putImageData(new ImageData(bgData, width, height), 0, 0);

  ctx.font = `500 ${cellH * 0.84}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const dotChars = ['∙', '∙', '•', '•'];
  for (let y = 0; y < height; y += cellH) {
    for (let x = 0; x < width; x += cellW) {
      const avgRgb = applyContrastRgb(getAverageColor(data, width, height, x, y, cellW, cellH), params.contrast);
      const darkRatio = 1 - calcLuma(avgRgb) / 255;
      const fillRgb = avgRgb.map((c) => c + (255 - c) * 0.82);
      const alpha = (0.5 + darkRatio * 0.22) * intensityRatio;
      const charIdx = Math.min(dotChars.length - 1, Math.floor(darkRatio * dotChars.length));

      ctx.fillStyle = toRgbaStr(fillRgb, alpha);
      ctx.fillText(dotChars[charIdx] ?? '·', x + cellW / 2, y + cellH / 2);
    }
  }

  // 叠加水平微细扫描线
  ctx.fillStyle = `rgba(10, 7, 12, ${0.018 * intensityRatio})`;
  const scanStep = Math.max(2, cellH);
  const scanThickness = Math.max(0.55, scale * 0.75);
  for (let y = 0; y < height; y += scanStep) {
    ctx.fillRect(0, y, width, scanThickness);
  }
  ctx.restore();
}

/** 10. Unicode 盲文点阵滤镜（Dot Cells / Braille） */
const BRAILLE_DOTS: [number, number, number][] = [
  [0, 0, 1],   [0, 1, 2],   [0, 2, 4],   // 左列 1, 2, 3
  [1, 0, 8],   [1, 1, 16],  [1, 2, 32],  // 右列 4, 5, 6
  [0, 3, 64],  [1, 3, 128],              // 底行 7, 8
];

function renderBrailleCells(ctx: CanvasRenderingContext2D, src: ImageData, params: TextureFxParams): void {
  const { width, height, data } = src;
  const scale = getScale(width, height);
  const cellW = (7 + Math.round(((100 - params.detail) / 100) * 8)) * scale;
  const cellH = cellW * 2;
  const intensityRatio = params.intensity / 100;

  ctx.save();
  ctx.font = `600 ${Math.ceil(cellH * 0.9)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let y = 0; y < height; y += cellH) {
    for (let x = 0; x < width; x += cellW) {
      const avgRgb = applyContrastRgb(getAverageColor(data, width, height, x, y, cellW, cellH), params.contrast);
      let mask = 0;
      for (const [col, row, bit] of BRAILLE_DOTS) {
        const sampleX = x + ((col + 0.5) / 2) * cellW;
        const sampleY = y + ((row + 0.5) / 4) * cellH;
        const luma = calcLuma(samplePixel(data, width, height, sampleX, sampleY));
        if (luma < 172) mask |= bit;
      }
      ctx.fillStyle = calcAdaptiveTextFill(avgRgb, calcLuma(avgRgb), intensityRatio);
      ctx.fillText(String.fromCharCode(10240 + mask), x + cellW / 2, y + cellH / 2);
    }
  }
  ctx.restore();
}

/** 11. 2.5D 等轴测悬浮体素立方体滤镜（Isoform / Voxel） */
function renderIsometricVoxel(ctx: CanvasRenderingContext2D, src: ImageData, params: TextureFxParams): void {
  const { width, height, data } = src;
  const scale = getScale(width, height);
  const cellW = (8 + Math.round(((100 - params.detail) / 100) * 9)) * scale;
  const halfW = cellW / 2;
  const rise = cellW * 0.3;
  const intensityRatio = params.intensity / 100;
  const rowStep = cellW * 0.72;

  ctx.save();
  for (let y = 0; y < height + cellW; y += rowStep) {
    const rowOffset = (Math.round(y / rowStep) % 2) * halfW;
    for (let x = -halfW; x < width + cellW; x += cellW) {
      const sampleX = x + rowOffset + halfW;
      const sampledRgb = applyContrastRgb(samplePixel(data, width, height, sampleX, y), params.contrast);
      const topColor = sampledRgb.map((c) => clamp(c * 1.3));
      const rightColor = sampledRgb.map((c) => clamp(c * 0.92));
      const leftColor = sampledRgb.map((c) => clamp(c * 0.55));
      const cx = sampleX;
      const cy = y;

      // 顶面菱形（高光面）
      ctx.fillStyle = toRgbaStr(topColor, intensityRatio * 0.9);
      ctx.beginPath();
      ctx.moveTo(cx, cy - rise);
      ctx.lineTo(cx + halfW, cy);
      ctx.lineTo(cx, cy + rise);
      ctx.lineTo(cx - halfW, cy);
      ctx.closePath();
      ctx.fill();

      // 左侧四边形（暗部面）
      ctx.fillStyle = toRgbaStr(leftColor, intensityRatio * 0.9);
      ctx.beginPath();
      ctx.moveTo(cx - halfW, cy);
      ctx.lineTo(cx, cy + rise);
      ctx.lineTo(cx, cy + rise * 2.5);
      ctx.lineTo(cx - halfW, cy + rise * 1.5);
      ctx.closePath();
      ctx.fill();

      // 右侧四边形（侧光面）
      ctx.fillStyle = toRgbaStr(rightColor, intensityRatio * 0.9);
      ctx.beginPath();
      ctx.moveTo(cx + halfW, cy);
      ctx.lineTo(cx, cy + rise);
      ctx.lineTo(cx, cy + rise * 2.5);
      ctx.lineTo(cx + halfW, cy + rise * 1.5);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 12. 几何方块、嵌砖、积木与波普辉光（Pixel Crush, Tessera, Studwork, Chroma Pop） */
function renderBlocksAndGlow(
  ctx: CanvasRenderingContext2D,
  src: ImageData,
  params: TextureFxParams,
  style: string
): void {
  const { width, height, data } = src;
  const scale = getScale(width, height);
  const cell = (5 + Math.round(((100 - params.detail) / 100) * 11)) * scale;
  const intensityRatio = params.intensity / 100;

  ctx.save();
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      const avgRgb = applyContrastRgb(getAverageColor(data, width, height, x, y, cell, cell), params.contrast);
      const drawRgb = style === 'pixel-art' ? quantizeRgb(avgRgb, 5) : avgRgb;
      const gap = style === 'mosaic' ? Math.max(1, cell * 0.1) : 0;
      const alpha = intensityRatio * (style === 'mosaic' ? 0.84 : 0.92);

      ctx.fillStyle = toRgbaStr(drawRgb, alpha);

      if (style === 'disco') {
        const radius = cell * (0.23 + (1 - calcLuma(drawRgb) / 255) * 0.18);
        ctx.shadowColor = toRgbaStr(drawRgb, 0.55);
        ctx.shadowBlur = Math.max(1, cell * 0.22);
        ctx.beginPath();
        ctx.arc(x + cell / 2, y + cell / 2, radius, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      ctx.shadowBlur = 0;
      ctx.fillRect(x + gap, y + gap, cell - gap * 2, cell - gap * 2);

      if (style === 'lego') {
        const cx = x + cell / 2;
        const cy = y + cell / 2;
        // 凸粒顶部高光
        ctx.fillStyle = toRgbaStr(drawRgb.map((c) => clamp(c * 1.28)), intensityRatio * 0.72);
        ctx.beginPath();
        ctx.arc(cx - cell * 0.08, cy - cell * 0.08, cell * 0.22, 0, Math.PI * 2);
        ctx.fill();

        // 凸粒底部投影暗部
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.beginPath();
        ctx.arc(cx + cell * 0.06, cy + cell * 0.06, cell * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/* =========================================================================
 * 统一调度与渲染分发函数
 * ========================================================================= */

const PIXEL_SHADER_STYLES = new Set([
  'risograph',
  'dither',
  'cobalt-grain',
  'denim-grain',
  'harbor-grain',
  'meadow-grain',
  'paper',
  'watercolor',
  'ink-wash',
  'cyanotype',
]);

/** 调度单帧 Canvas 渲染 */
export function renderTextureFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: TextureFxParams
): void {
  const srcData = ctx.getImageData(0, 0, width, height);

  // 1. 像素级 Shader 模式
  if (PIXEL_SHADER_STYLES.has(params.style)) {
    let resultPixels: Uint8ClampedArray;
    switch (params.style) {
      case 'risograph':
        resultPixels = renderRisograph(srcData, params);
        break;
      case 'dither':
        resultPixels = renderBitgrain(srcData, params);
        break;
      case 'cobalt-grain':
      case 'denim-grain':
      case 'harbor-grain':
      case 'meadow-grain':
        resultPixels = renderGrainDiffusion(srcData, params, params.style);
        break;
      case 'paper':
        resultPixels = renderPaper(srcData, params);
        break;
      case 'watercolor':
        resultPixels = renderWatercolor(srcData, params);
        break;
      case 'ink-wash':
        resultPixels = renderInkWash(srcData, params);
        break;
      case 'cyanotype':
        resultPixels = renderCyanotype(srcData, params);
        break;
      default:
        resultPixels = renderPaper(srcData, params);
    }
    srcData.data.set(resultPixels);
    ctx.putImageData(srcData, 0, 0);
    return;
  }

  // 2. 几何与矢量渲染模式
  if (['pixel-art', 'mosaic', 'lego', 'disco'].includes(params.style)) {
    renderBlocksAndGlow(ctx, srcData, params, params.style);
    return;
  }
  if (params.style === 'braille') {
    renderBrailleCells(ctx, srcData, params);
    return;
  }
  if (params.style === 'voxel') {
    renderIsometricVoxel(ctx, srcData, params);
    return;
  }
  if (params.style === 'dots') {
    renderStippleDots(ctx, srcData, params);
    return;
  }
  // 默认：Glyphfield, Typeblocks, Mixed, Cross, Diamond, Lines, Slant
  renderGlyphsAndShapes(ctx, srcData, params, params.style);
}

/** 解析并兜底参数 */
export function resolveTextureParams(rawParams: Record<string, unknown>): TextureFxParams {
  const style = (typeof rawParams.style === 'string' && rawParams.style in TEXTURE_STYLE_PRESETS
    ? rawParams.style
    : 'risograph') as TextureStyleId;
  const preset = TEXTURE_STYLE_PRESETS[style] ?? { detail: 58, intensity: 100, contrast: 57 };

  return {
    style,
    detail: clampNumber(rawParams.detail, 0, 100, preset.detail),
    intensity: clampNumber(rawParams.intensity, 0, 100, preset.intensity),
    contrast: clampNumber(rawParams.contrast, 0, 100, preset.contrast),
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

/** 异步加载图片并应用质感滤镜 */
async function renderTexture(
  src: string,
  rawParams: Record<string, unknown>,
  options?: ImageFxRenderOptions
): Promise<HTMLCanvasElement> {
  const params = resolveTextureParams(rawParams);
  const img = await fxLoadImage(src);
  const { canvas, ctx } = fxDrawingCanvas(img, options?.maxEdge ?? 2048);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  renderTextureFrame(ctx, canvas.width, canvas.height, params);

  return canvas;
}

/** 触感质感效果声明对象 */
export const TEXTURE_FX_EFFECT: ImageFxEffectDef = {
  id: 'texture',
  name: '触感质感',
  description: '24 种艺术质感滤镜：孔版印刷、蓝晒、水彩水墨、盲文点阵、等轴测体素与复古颗粒（移植自 texture.fayaz）',
  params: [
    {
      kind: 'select',
      key: 'style',
      label: '风格',
      default: 'risograph',
      options: TEXTURE_STYLES.map((s) => ({
        value: s.id,
        label: s.name,
        title: s.description,
      })),
    },
    {
      kind: 'slider',
      key: 'detail',
      label: '细节',
      min: 0,
      max: 100,
      step: 1,
      default: 58,
      display: (v) => `${Math.round(v)}%`,
    },
    {
      kind: 'slider',
      key: 'intensity',
      label: '强度',
      min: 0,
      max: 100,
      step: 1,
      default: 100,
      display: (v) => `${Math.round(v)}%`,
    },
    {
      kind: 'slider',
      key: 'contrast',
      label: '对比',
      min: 0,
      max: 100,
      step: 1,
      default: 57,
      display: (v) => `${Math.round(v)}%`,
    },
  ],
  render: renderTexture,
};
