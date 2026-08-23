/**
 * ASCII 字符画效果（asciify-engine 移植 + 增强）
 *
 * 算法参考 docs/多模态工具/图片处理/asciify-engine-main（MIT，仅移植静态图路径的核心思路）：
 * 1. 源图按单元格网格块均值采样（Area-averaging Downsampling）；
 * 2. 亮度动态范围归一化（Normalize）+ 4×4 Bayer 亮度抖动（Dither），消除平滑断层；
 * 3. 映射到精细字符梯度（由疏到密：经典/细腻 dense 70阶/完整盲文 braille/几何/制表符/片假名等）；
 * 4. 配色方案支持经典主题（黑白/终端绿/GameBoy 4阶绿/Dracula 暗紫）与自定义色板（首色底色 + 梯度插值字符色）。
 *
 * 规范遵循：
 * - 固定底色替代 isDarkMode() DOM 主题探测——输出不随宿主页面明暗模式漂移；
 * - 无模块级缓存、无随机数：同参数同输入输出确定性一致（预览 = 导出）；
 * - 输出画布与采样源严格分离。
 */

import type {
  AsciiFxParams,
  ImageFxEffectDef,
  ImageFxRenderOptions,
} from '../types';
import { fxDrawingCanvas, fxLoadImage } from '../shared';

/** 等宽字符宽高比（引擎默认口径）：cell 高 = cell 宽 / charAspect，防图像纵向拉伸 */
const CHAR_ASPECT = 0.55;

type CharsetId = AsciiFxParams['charset'];
type ColorModeId = AsciiFxParams['colorMode'];

const CHARSET_IDS: readonly CharsetId[] = [
  'dense',
  'standard',
  'braille',
  'blocks',
  'dots',
  'geometric',
  'claudeCode',
  'katakana',
];

const COLOR_MODES: readonly ColorModeId[] = [
  'dark',
  'light',
  'matrix',
  'gameboy',
  'dracula',
  'color',
  'custom',
];

/** 字符梯度预设（由疏到密排列；正常映射下亮像素 → 密集字符） */
const ASCII_CHARSETS: Record<CharsetId, string> = {
  // 70 级精细梯度（asciify-engine 推荐，细节还原度最高）
  dense: ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  // 经典 10 级梯度
  standard: ' .:-=+*#%@',
  // 64+ 级完整盲文梯度
  braille:
    ' ⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠐⠑⠒⠓⠔⠕⠖⠗⠘⠙⠚⠛⠜⠝⠞⠟⠠⠡⠢⠣⠤⠥⠦⠧⠨⠩⠪⠫⠬⠭⠮⠯⠰⠱⠲⠳⠴⠵⠶⠷⠸⠹⠺⠻⠼⠽⠾⠿⡀⡁⡂⡃⡄⡅⡆⡇⣀⣁⣂⣃⣄⣅⣆⣇⣈⣉⣊⣋⣌⣍⣎⣏⣐⣑⣒⣓⣔⣕⣖⣗⣘⣙⣚⣛⣜⣝⣞⣟⣠⣡⣢⣣⣤⣥⣦⣧⣨⣩⣪⣫⣬⣭⣮⣯⣰⣱⣲⣳⣴⣵⣶⣷⣸⣹⣺⣻⣼⣽⣾⣿',
  // 块面
  blocks: ' ░▒▓█',
  // 简易点阵
  dots: ' ⠁⠃⠇⡇⣇⣧⣷⣿',
  // 几何图形
  geometric: ' ·△▷◇◈◆▣■█',
  // 制表符框架
  claudeCode: ' ╔╗╚╝║═╠╣╦╩╬░▒▓█│─┌┐└┘├┤┬┴┼',
  // 半角片假名
  katakana: ' ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ',
};

/** 经典 4×4 Bayer 阈值矩阵（用于亮度平滑抖动，消除字符突变断层） */
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

interface PaletteDef {
  bg: [number, number, number];
  fg: [number, number, number][];
}

/** 预设配色定义（首项为底色，后续项为由暗到亮的字符前景色阶） */
const PRESET_PALETTES: Record<Exclude<ColorModeId, 'color' | 'custom'>, PaletteDef> = {
  dark: {
    bg: [10, 10, 10],
    fg: [
      [140, 140, 140],
      [240, 240, 240],
    ],
  },
  light: {
    bg: [250, 249, 247],
    fg: [
      [120, 120, 120],
      [15, 15, 15],
    ],
  },
  matrix: {
    bg: [5, 5, 5],
    fg: [
      [0, 130, 30],
      [0, 255, 65],
    ],
  },
  gameboy: {
    // DMG-01 掌机四阶绿：首色底色，后三色为字符阶梯
    bg: [15, 56, 15],
    fg: [
      [48, 98, 48],
      [139, 172, 15],
      [155, 188, 15],
    ],
  },
  dracula: {
    // Dracula 主题配色
    bg: [40, 42, 54],
    fg: [
      [98, 114, 164],
      [189, 147, 249],
      [248, 248, 242],
    ],
  },
};

/** 解析自定义色板字符串（#rrggbb,#rrggbb,...） */
function parseCustomPalette(input: string): PaletteDef {
  const colors: [number, number, number][] = [];
  for (const part of input.split(',').map((s) => s.trim())) {
    const hex = part.replace('#', '');
    if (hex.length !== 6 && hex.length !== 3) continue;
    const fullHex =
      hex.length === 3
        ? hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
        : hex;
    const r = parseInt(fullHex.slice(0, 2), 16);
    const g = parseInt(fullHex.slice(2, 4), 16);
    const b = parseInt(fullHex.slice(4, 6), 16);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      colors.push([r, g, b]);
    }
  }
  if (colors.length === 0) {
    return { bg: [10, 10, 10], fg: [[240, 240, 240]] };
  }
  if (colors.length === 1) {
    return { bg: [10, 10, 10], fg: [colors[0]] };
  }
  return { bg: colors[0], fg: colors.slice(1) };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

/** 解析并兜底效果参数（历史数据缺字段时回落默认值） */
function resolveAsciiParams(
  params: Record<string, unknown>
): AsciiFxParams & { customPalette: string } {
  return {
    cols: Math.round(clampNumber(params.cols, 40, 240, 120)),
    charset: CHARSET_IDS.includes(params.charset as CharsetId)
      ? (params.charset as CharsetId)
      : 'dense',
    colorMode: COLOR_MODES.includes(params.colorMode as ColorModeId)
      ? (params.colorMode as ColorModeId)
      : 'dark',
    customPalette:
      typeof params.customPalette === 'string'
        ? params.customPalette
        : '#0a0a0a,#6272a4,#bd93f9,#f8f8f2',
    normalize: params.normalize === 'off' ? 'off' : 'on',
    invert: params.invert === 'inverted' ? 'inverted' : 'normal',
  };
}

/** 在多阶前景色阶上线性插值计算字符颜色 */
function interpolateFgColor(
  fg: readonly (readonly [number, number, number])[],
  norm01: number
): [number, number, number] {
  if (fg.length === 1) {
    return [fg[0][0], fg[0][1], fg[0][2]];
  }
  const idx = norm01 * (fg.length - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(fg.length - 1, i0 + 1);
  const frac = idx - i0;
  const c0 = fg[i0];
  const c1 = fg[i1];
  return [
    c0[0] + (c1[0] - c0[0]) * frac,
    c0[1] + (c1[1] - c0[1]) * frac,
    c0[2] + (c1[2] - c0[2]) * frac,
  ];
}

async function renderAscii(
  src: string,
  rawParams: Record<string, unknown>,
  options?: ImageFxRenderOptions
): Promise<HTMLCanvasElement> {
  const { cols: targetCols, charset, colorMode, customPalette, normalize, invert } =
    resolveAsciiParams(rawParams);
  const maxEdge = options?.maxEdge ?? 2048;
  const img = await fxLoadImage(src);
  // 采样源画布（只读，不作为输出目标）
  const { canvas: sampleCanvas, ctx: sampleCtx } = fxDrawingCanvas(img, maxEdge);
  const sw = sampleCanvas.width;
  const sh = sampleCanvas.height;

  const cols = Math.max(2, Math.min(targetCols, sw));
  const rows = Math.max(2, Math.round((cols * sh / sw) * CHAR_ASPECT));

  // 单元格像素尺寸：cell 高按 charAspect 放大，保证输出最长边 ≤ maxEdge
  const cellW = Math.max(1, maxEdge / Math.max(cols, rows / CHAR_ASPECT));
  const cellH = cellW / CHAR_ASPECT;
  const outW = Math.max(1, Math.round(cols * cellW));
  const outH = Math.max(1, Math.round(rows * cellH));

  // ── ① 块均值采样：单趟 O(w×h) 线性扫描累计每格 RGB 均值
  const imageData = sampleCtx.getImageData(0, 0, sw, sh);
  const data = imageData.data;
  const cellR = new Float32Array(cols * rows);
  const cellG = new Float32Array(cols * rows);
  const cellB = new Float32Array(cols * rows);
  const cellA = new Float32Array(cols * rows);

  for (let gy = 0; gy < rows; gy++) {
    const pyStart = Math.floor(gy * sh / rows);
    const pyEnd = Math.max(pyStart + 1, Math.floor((gy + 1) * sh / rows));
    for (let gx = 0; gx < cols; gx++) {
      const pxStart = Math.floor(gx * sw / cols);
      const pxEnd = Math.max(pxStart + 1, Math.floor((gx + 1) * sw / cols));
      let sR = 0;
      let sG = 0;
      let sB = 0;
      let sA = 0;
      let count = 0;
      for (let y = pyStart; y < pyEnd; y++) {
        let i = (y * sw + pxStart) * 4;
        for (let x = pxStart; x < pxEnd; x++, i += 4) {
          sR += data[i];
          sG += data[i + 1];
          sB += data[i + 2];
          sA += data[i + 3];
          count++;
        }
      }
      const ci = gy * cols + gx;
      cellR[ci] = sR / count;
      cellG[ci] = sG / count;
      cellB[ci] = sB / count;
      cellA[ci] = sA / count;
    }
  }

  // ── ② 亮度动态范围归一化预扫描（增强低对比度图像细节）
  let normMin = 0;
  let normRange = 255;
  if (normalize === 'on') {
    let lo = 255;
    let hi = 0;
    for (let ci = 0; ci < cellR.length; ci++) {
      if (cellA[ci] < 10) continue;
      const l = 0.299 * cellR[ci] + 0.587 * cellG[ci] + 0.114 * cellB[ci];
      if (l < lo) lo = l;
      if (l > hi) hi = l;
    }
    normMin = lo;
    normRange = hi > lo ? hi - lo : 255;
  }

  // ── ③ 解析配色方案
  const palette: PaletteDef =
    colorMode === 'custom'
      ? parseCustomPalette(customPalette)
      : colorMode === 'color'
        ? { bg: [10, 10, 10], fg: [] }
        : PRESET_PALETTES[colorMode];

  const [bgR, bgG, bgB] = palette.bg;
  const bgHex = `rgb(${bgR},${bgG},${bgB})`;

  const chars = [...ASCII_CHARSETS[charset]];
  const lastIdx = chars.length - 1;
  const inverted = invert === 'inverted';

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('无法创建画布上下文');

  octx.fillStyle = bgHex;
  octx.fillRect(0, 0, outW, outH);
  octx.font = `${cellW}px monospace`;
  octx.textBaseline = 'middle';
  octx.textAlign = 'center';

  let lastFillStyle = '';
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const ci = gy * cols + gx;
      // 全透明格子直接露底色（对齐引擎 a<10 跳过口径）；半透明向底色混合
      const a01 = cellA[ci] / 255;
      if (a01 <= 0.04) continue;

      const r = cellR[ci];
      const g = cellG[ci];
      const b = cellB[ci];
      const rawLum = 0.299 * r + 0.587 * g + 0.114 * b;

      // 亮度归一化拉伸
      const stretchedLum =
        normalize === 'on' ? ((rawLum - normMin) / normRange) * 255 : rawLum;

      // 4×4 Bayer 亮度轻微抖动（平滑消除大面积字符阶梯断层）
      const bayerShift = (BAYER_4X4[gy & 3][gx & 3] / 16 - 0.5) * 0.12 * 128;
      const ditheredLum = Math.max(0, Math.min(255, stretchedLum + bayerShift));

      const norm = inverted ? 1 - ditheredLum / 255 : ditheredLum / 255;
      const clampedNorm = Math.max(0, Math.min(1, norm));
      const ch = chars[Math.floor(clampedNorm * lastIdx)];
      if (!ch || ch === ' ') continue;

      let cr: number;
      let cg: number;
      let cb: number;

      if (colorMode === 'color') {
        cr = r;
        cg = g;
        cb = b;
      } else {
        const [fr, fg, fb] = interpolateFgColor(palette.fg, clampedNorm);
        cr = fr;
        cg = fg;
        cb = fb;
      }

      // 透明度向底色混合
      cr = bgR + (cr - bgR) * a01;
      cg = bgG + (cg - bgG) * a01;
      cb = bgB + (cb - bgB) * a01;

      const fillStyle = `rgb(${cr | 0},${cg | 0},${cb | 0})`;
      if (fillStyle !== lastFillStyle) {
        octx.fillStyle = fillStyle;
        lastFillStyle = fillStyle;
      }
      octx.fillText(ch, gx * cellW + cellW / 2, gy * cellH + cellH / 2);
    }
  }

  return out;
}

/** ASCII 字符画效果定义 */
export const ASCII_FX_EFFECT: ImageFxEffectDef = {
  id: 'ascii',
  name: 'ASCII',
  description:
    'ASCII 字符画：亮度映射到精细字符梯度（经典/细腻 dense 70阶/高精盲文/几何/制表符/片假名）× 黑白、终端绿、GameBoy、Dracula、彩色或自定义色板',
  params: [
    {
      kind: 'slider',
      key: 'cols',
      label: '列数',
      min: 40,
      max: 240,
      step: 4,
      default: 120,
      display: (v) => `${v} 列`,
    },
    {
      kind: 'segment',
      key: 'charset',
      label: '字符集',
      default: 'dense',
      options: [
        { value: 'dense', label: '细腻' },
        { value: 'standard', label: '经典' },
        { value: 'braille', label: '盲文' },
        { value: 'blocks', label: '块面' },
        { value: 'dots', label: '点阵' },
        { value: 'geometric', label: '几何' },
        { value: 'claudeCode', label: '制表符' },
        { value: 'katakana', label: '片假名' },
      ],
    },
    {
      kind: 'segment',
      key: 'colorMode',
      label: '配色',
      default: 'dark',
      options: [
        { value: 'dark', label: '黑底白字' },
        { value: 'light', label: '白底黑字' },
        { value: 'matrix', label: '终端绿' },
        { value: 'gameboy', label: 'GameBoy' },
        { value: 'dracula', label: 'Dracula' },
        { value: 'color', label: '彩色' },
        { value: 'custom', label: '自定义' },
      ],
    },
    {
      kind: 'segment',
      key: 'normalize',
      label: '对比增强',
      default: 'on',
      options: [
        { value: 'on', label: '开启' },
        { value: 'off', label: '关闭' },
      ],
    },
    {
      kind: 'segment',
      key: 'invert',
      label: '反转',
      default: 'normal',
      options: [
        { value: 'normal', label: '正常' },
        { value: 'inverted', label: '反转' },
      ],
    },
  ],
  render: renderAscii,
};
