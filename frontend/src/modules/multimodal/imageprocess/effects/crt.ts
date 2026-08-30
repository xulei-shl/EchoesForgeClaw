/**
 * CRT 荧光扫描线效果（CRT Phosphor Glow & Scanline）
 *
 * 物理级复刻老式阴极射线管（CRT）显像管与高亮荧光显示屏质感：
 * 1. 黑电平高对比压暗与高光提取（Deep Black Level & Highlight Extraction）
 * 2. 荧光粉调色板映射（烈焰红 / 黑客绿 / 琥珀金 / 极光冰蓝 / 白炽高光 / 原图增强）
 * 3. 多层物理 Bloom 荧光泛光 + 电子枪横向各向异性扫射拖尾（Beam Smear）
 * 4. 余弦物理能量衰减扫描线网栅（Aperture Grille Scanlines）
 * 5. RGB 荧光粉聚焦边缘色散（Chromatic Aberration）
 *
 * 纯原生 HTML5 Canvas 2D 硬件加速与光栅算法，零外部依赖，毫秒级响应。
 */

import type {
  CrtFxParams,
  CrtProfileId,
  ImageFxEffectDef,
  ImageFxRenderOptions,
} from '../types';
import { fxDrawingCanvas, fxLoadImage } from '../shared';

/** 荧光色调预设配置 */
export const CRT_PROFILES: {
  id: CrtProfileId;
  name: string;
  description: string;
  /** 高光、中调、暗调 RGB 映射色彩 */
  highlightRgb: [number, number, number];
  midRgb: [number, number, number];
  shadowRgb: [number, number, number];
}[] = [
  {
    id: 'neon-red',
    name: '霓虹烈红 (Neon Red)',
    description: '浓郁深红荧光漫射与白炽高亮光芯（如经典警示终端与赛博海报）',
    highlightRgb: [255, 240, 240],
    midRgb: [255, 10, 45],
    shadowRgb: [40, 0, 8],
  },
  {
    id: 'matrix-green',
    name: '黑客终端 (Matrix Green)',
    description: '经典 P1 绿色荧光粉显像管（VT100 / Apple II 绿色监视器）',
    highlightRgb: [235, 255, 235],
    midRgb: [0, 255, 65],
    shadowRgb: [0, 35, 10],
  },
  {
    id: 'amber',
    name: '复古琥珀 (Amber Glow)',
    description: '经典 80 年代 IBM 5151 琥珀金荧光屏，温润深邃',
    highlightRgb: [255, 248, 230],
    midRgb: [255, 165, 0],
    shadowRgb: [45, 20, 0],
  },
  {
    id: 'cyber-cyan',
    name: '极光冰蓝 (Cyber Cyan)',
    description: '科幻全息 HUD 界面与冷光雷达显像管',
    highlightRgb: [240, 255, 255],
    midRgb: [0, 230, 255],
    shadowRgb: [0, 25, 45],
  },
  {
    id: 'monochrome',
    name: '白炽高光 (Monochrome)',
    description: '高对比黑白监视器，纯净物理白炽荧光',
    highlightRgb: [255, 255, 255],
    midRgb: [180, 180, 180],
    shadowRgb: [15, 15, 15],
  },
  {
    id: 'original',
    name: '原图全彩 (Original Color)',
    description: '保留原图丰富色彩，仅施加 CRT 荧光发光与扫描线质感',
    highlightRgb: [255, 255, 255],
    midRgb: [128, 128, 128],
    shadowRgb: [0, 0, 0],
  },
];

/** 获取色调预设 */
function getCrtProfile(id: string) {
  return CRT_PROFILES.find((p) => p.id === id) || CRT_PROFILES[0];
}

/** 解析并安全兜底 CRT 参数 */
function resolveCrtParams(params: Record<string, unknown>): CrtFxParams {
  const profile = (typeof params.profile === 'string' ? params.profile : 'neon-red') as CrtProfileId;
  const lineSpacing = clampNumber(params.lineSpacing, 2, 16, 6);
  const glow = clampNumber(params.glow, 0, 100, 65);
  const scanlineDepth = clampNumber(params.scanlineDepth, 0, 100, 80);
  const chromatic = clampNumber(params.chromatic, 0, 100, 40);

  return {
    profile,
    lineSpacing,
    glow,
    scanlineDepth,
    chromatic,
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

/** 颜色插值 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/**
 * 渲染 CRT 荧光扫描线效果
 */
async function renderCrt(
  src: string,
  rawParams: Record<string, unknown>,
  options?: ImageFxRenderOptions
): Promise<HTMLCanvasElement> {
  const params = resolveCrtParams(rawParams);
  const img = await fxLoadImage(src);
  const { canvas: inputCanvas, ctx: inputCtx } = fxDrawingCanvas(img, options?.maxEdge ?? 2048);
  const { width, height } = inputCanvas;

  // 自适应标度（基于 1000px 基准），确保高低分辨率下扫描线与光晕视觉密度一致
  const scale = Math.max(0.6, Math.max(width, height) / 1000);
  const actualLineSpacing = Math.max(2, Math.round(params.lineSpacing * scale));
  const glowFactor = params.glow / 100;
  const scanlineDepthFactor = params.scanlineDepth / 100;
  const chromaticFactor = params.chromatic / 100;

  // 1. 基础图像处理：黑电平压暗、对比度强化与调色板映射
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = width;
  baseCanvas.height = height;
  const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
  if (!baseCtx) throw new Error('无法创建基础画布上下文');

  const srcImageData = inputCtx.getImageData(0, 0, width, height);
  const srcData = srcImageData.data;
  const baseImageData = baseCtx.createImageData(width, height);
  const baseData = baseImageData.data;

  const profileConfig = getCrtProfile(params.profile);
  const isOriginal = params.profile === 'original';

  for (let i = 0; i < srcData.length; i += 4) {
    const r = srcData[i];
    const g = srcData[i + 1];
    const b = srcData[i + 2];
    const a = srcData[i + 3];

    if (a === 0) {
      baseData[i] = 0;
      baseData[i + 1] = 0;
      baseData[i + 2] = 0;
      baseData[i + 3] = 0;
      continue;
    }

    // 计算感知亮度 (0 ~ 1)
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // 黑电平压暗阈值（暗部沉入纯黑，凸显发光图文）
    const threshold = 0.08;
    const normLum = lum <= threshold ? 0 : (lum - threshold) / (1 - threshold);

    // S 曲线增强高光张力
    const contrastLum = normLum * normLum * (3 - 2 * normLum);

    if (isOriginal) {
      // 原图全彩增强
      const boost = 1.0 + contrastLum * 0.35;
      baseData[i] = Math.min(255, Math.round(r * contrastLum * boost));
      baseData[i + 1] = Math.min(255, Math.round(g * contrastLum * boost));
      baseData[i + 2] = Math.min(255, Math.round(b * contrastLum * boost));
      baseData[i + 3] = 255;
    } else {
      // 荧光粉色调映射（双段渐变：暗到中调，中调到高光）
      let outR: number;
      let outG: number;
      let outB: number;

      if (contrastLum < 0.5) {
        const t = contrastLum * 2;
        outR = lerp(profileConfig.shadowRgb[0], profileConfig.midRgb[0], t);
        outG = lerp(profileConfig.shadowRgb[1], profileConfig.midRgb[1], t);
        outB = lerp(profileConfig.shadowRgb[2], profileConfig.midRgb[2], t);
      } else {
        const t = (contrastLum - 0.5) * 2;
        outR = lerp(profileConfig.midRgb[0], profileConfig.highlightRgb[0], t);
        outG = lerp(profileConfig.midRgb[1], profileConfig.highlightRgb[1], t);
        outB = lerp(profileConfig.midRgb[2], profileConfig.highlightRgb[2], t);
      }

      baseData[i] = Math.round(outR);
      baseData[i + 1] = Math.round(outG);
      baseData[i + 2] = Math.round(outB);
      baseData[i + 3] = contrastLum > 0 ? 255 : 0;
    }
  }
  baseCtx.putImageData(baseImageData, 0, 0);

  // 2. 主输出画布（深黑底）
  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  if (!outCtx) throw new Error('无法创建输出画布上下文');

  outCtx.fillStyle = '#000000';
  outCtx.fillRect(0, 0, width, height);

  // 3. RGB 色散与扫描线栅格化主体绘制
  const scanlineCanvas = document.createElement('canvas');
  scanlineCanvas.width = width;
  scanlineCanvas.height = height;
  const scanCtx = scanlineCanvas.getContext('2d', { willReadFrequently: true });
  if (!scanCtx) throw new Error('无法创建扫描线画布上下文');

  const shiftPx = Math.max(0, Math.round(1.8 * scale * chromaticFactor));

  // 获取 base 图的像素数据用于进行色散与余弦扫描线合成
  const baseImg = baseCtx.getImageData(0, 0, width, height);
  const bData = baseImg.data;
  const scanImg = scanCtx.createImageData(width, height);
  const sData = scanImg.data;

  // 预计算余弦扫描线权重表 (0 ~ 1)
  const lineWeights = new Float32Array(actualLineSpacing);
  for (let y = 0; y < actualLineSpacing; y++) {
    // 余弦物理衰减曲线：行中心权重 1.0，行边缘衰减到 (1 - scanlineDepthFactor)
    const norm = (y / actualLineSpacing) * Math.PI * 2;
    const cosVal = 0.5 * (1 + Math.cos(norm)); // 1 在中心/端点，0 在谷底
    lineWeights[y] = 1.0 - scanlineDepthFactor * (1.0 - cosVal);
  }

  for (let y = 0; y < height; y++) {
    const lineWeight = lineWeights[y % actualLineSpacing];
    const rowOffset = y * width;

    for (let x = 0; x < width; x++) {
      const idx = (rowOffset + x) * 4;

      // RGB 色散采样：R 向左偏移，B 向右偏移，G 居中
      const rX = Math.max(0, Math.min(width - 1, x - shiftPx));
      const bX = Math.max(0, Math.min(width - 1, x + shiftPx));

      const rIdx = (rowOffset + rX) * 4;
      const bIdx = (rowOffset + bX) * 4;

      const rVal = bData[rIdx];
      const gVal = bData[idx + 1];
      const bVal = bData[bIdx + 2];
      const aVal = bData[idx + 3];

      if (aVal > 0) {
        sData[idx] = Math.round(rVal * lineWeight);
        sData[idx + 1] = Math.round(gVal * lineWeight);
        sData[idx + 2] = Math.round(bVal * lineWeight);
        sData[idx + 3] = 255;
      } else {
        sData[idx] = 0;
        sData[idx + 1] = 0;
        sData[idx + 2] = 0;
        sData[idx + 3] = 255;
      }
    }
  }
  scanCtx.putImageData(scanImg, 0, 0);

  // 将主体扫描线图像绘制在输出底图上
  outCtx.drawImage(scanlineCanvas, 0, 0);

  // 4. 多层物理 Bloom 荧光泛光与电子枪横向拖尾（叠加在扫描线之上）
  if (glowFactor > 0.05) {
    const bloomCanvas = document.createElement('canvas');
    bloomCanvas.width = width;
    bloomCanvas.height = height;
    const bloomCtx = bloomCanvas.getContext('2d');
    if (bloomCtx) {
      bloomCtx.fillStyle = '#000000';
      bloomCtx.fillRect(0, 0, width, height);

      // (A) 核心高亮发光 (Core Glow): 保留轮廓与字形锐度
      bloomCtx.save();
      bloomCtx.globalCompositeOperation = 'lighter';
      bloomCtx.globalAlpha = 0.55 * glowFactor;
      bloomCtx.filter = `blur(${Math.max(2, Math.round(3.5 * scale))}px)`;
      bloomCtx.drawImage(baseCanvas, 0, 0);
      bloomCtx.restore();

      // (B) 中层浓郁荧光扩散 (Medium Diffusion): 饱满鲜亮的色彩溢出
      bloomCtx.save();
      bloomCtx.globalCompositeOperation = 'lighter';
      bloomCtx.globalAlpha = 0.75 * glowFactor;
      bloomCtx.filter = `blur(${Math.max(6, Math.round(14 * scale))}px)`;
      bloomCtx.drawImage(baseCanvas, 0, 0);
      bloomCtx.restore();

      // (C) 大范围环境光晕 (Wide Halo): 屏幕大气氛围感
      bloomCtx.save();
      bloomCtx.globalCompositeOperation = 'lighter';
      bloomCtx.globalAlpha = 0.4 * glowFactor;
      bloomCtx.filter = `blur(${Math.max(16, Math.round(36 * scale))}px)`;
      bloomCtx.drawImage(baseCanvas, 0, 0);
      bloomCtx.restore();

      // (D) CRT 灵魂：电子束横向扫射拖尾 (Horizontal Beam Streaks)
      // 通过水平拉伸与单向横向模糊模拟电子枪水平扫射发光延迟
      const streakCanvas = document.createElement('canvas');
      streakCanvas.width = width;
      streakCanvas.height = height;
      const streakCtx = streakCanvas.getContext('2d');
      if (streakCtx) {
        streakCtx.save();
        streakCtx.filter = `blur(${Math.max(4, Math.round(18 * scale))}px)`;
        // 横向拉伸 1.8 倍，纵向收缩
        streakCtx.drawImage(baseCanvas, -width * 0.1, 0, width * 1.2, height);
        streakCtx.restore();

        bloomCtx.save();
        bloomCtx.globalCompositeOperation = 'lighter';
        bloomCtx.globalAlpha = 0.5 * glowFactor;
        bloomCtx.drawImage(streakCanvas, 0, 0);
        bloomCtx.restore();
      }

      // 将发光层以 lighter（加色叠加）复合到最终画布上
      outCtx.save();
      outCtx.globalCompositeOperation = 'lighter';
      outCtx.drawImage(bloomCanvas, 0, 0);
      outCtx.restore();
    }
  }

  return outCanvas;
}

/** CRT 荧光扫描线效果定义 */
export const CRT_FX_EFFECT: ImageFxEffectDef = {
  id: 'crt',
  name: '荧光扫描 (CRT)',
  description: 'CRT 显像管扫描线与多层荧光发光（含横向扫射拖尾、RGB 色散与 6 款经典调色板）',
  params: [
    {
      kind: 'select',
      key: 'profile',
      label: '色调',
      default: 'neon-red',
      options: CRT_PROFILES.map((p) => ({
        value: p.id,
        label: p.name,
        title: p.description,
      })),
    },
    {
      kind: 'slider',
      key: 'glow',
      label: '荧光',
      min: 0,
      max: 100,
      step: 5,
      default: 65,
      display: (v) => `${v}%`,
    },
    {
      kind: 'slider',
      key: 'lineSpacing',
      label: '线距',
      min: 2,
      max: 16,
      step: 1,
      default: 6,
      display: (v) => `${v}px`,
    },
    {
      kind: 'slider',
      key: 'scanlineDepth',
      label: '线深',
      min: 0,
      max: 100,
      step: 5,
      default: 80,
      display: (v) => `${v}%`,
    },
    {
      kind: 'slider',
      key: 'chromatic',
      label: '色散',
      min: 0,
      max: 100,
      step: 5,
      default: 40,
      display: (v) => `${v}%`,
    },
  ],
  render: renderCrt,
};
