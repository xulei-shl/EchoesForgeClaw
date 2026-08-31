/**
 * 微浮雕高光（Emboss Foil）核心渲染引擎
 * 基于 HTML5 Canvas 像素级光影与图层混合实现，输出高保真 PNG
 */

import type { EmbossFoilParams, EmbossReliefStyle, FoilShimmerType, LightPoint } from './types';

/**
 * 加载图片 URL 为 HTMLImageElement
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

/**
 * 依据浮雕风格与深度对原始像素进行表面微浮雕/等高线肌理处理
 */
function processReliefPixels(
  imageData: ImageData,
  style: EmbossReliefStyle,
  depthPercent: number,
  lightAngleDeg: number
) {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const depthFactor = (depthPercent / 100) * 1.5; // 0 ~ 1.5
  const angleRad = (lightAngleDeg * Math.PI) / 180;
  const lx = Math.cos(angleRad);
  const ly = Math.sin(angleRad);

  // 1. 提取灰度明度图
  const lumMap = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    lumMap[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
  }

  // 2. 依据肌理风格生成高度场与法线凹凸
  const output = new Uint8ClampedArray(data);

  if (style === 'topography') {
    // 等高线指纹（Topographic Iso-lines）：计算阶梯波并提取等高线轮廓
    const bandStep = 18; // 等高线密度阶数
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const pIdx = idx * 4;
        const l = lumMap[idx];

        // 计算相邻像素梯度
        const gx = lumMap[idx + 1] - lumMap[idx - 1];
        const gy = lumMap[idx + width] - lumMap[idx - width];

        // 构造等高线边缘高频信号
        const bandVal = l * bandStep;
        const frac = bandVal - Math.floor(bandVal);
        const lineDist = Math.abs(frac - 0.5) * 2; // 0 ~ 1
        const isLine = lineDist < 0.18 ? (1 - lineDist / 0.18) : 0;

        // 定向光照凹凸计算
        const relief = (gx * lx + gy * ly) * depthFactor * 120;
        const lineBoost = isLine * depthFactor * 40;

        // 调整原图 RGB，使等高线呈现微浮雕凸起与光影
        const delta = relief + lineBoost;
        output[pIdx] = Math.min(255, Math.max(0, data[pIdx] + delta));
        output[pIdx + 1] = Math.min(255, Math.max(0, data[pIdx + 1] + delta));
        output[pIdx + 2] = Math.min(255, Math.max(0, data[pIdx + 2] + delta));
      }
    }
  } else if (style === 'paper_emboss') {
    // 纸质微浮雕：经典 3x3 卷积 Sobel 算子
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const pIdx = idx * 4;

        // Sobel 水平与垂直梯度
        const gx =
          -lumMap[idx - width - 1] +
          lumMap[idx - width + 1] -
          2 * lumMap[idx - 1] +
          2 * lumMap[idx + 1] -
          lumMap[idx + width - 1] +
          lumMap[idx + width + 1];

        const gy =
          -lumMap[idx - width - 1] -
          2 * lumMap[idx - width] -
          lumMap[idx - width + 1] +
          lumMap[idx + width - 1] +
          2 * lumMap[idx + width] +
          lumMap[idx + width + 1];

        const relief = (gx * lx + gy * ly) * depthFactor * 38;
        output[pIdx] = Math.min(255, Math.max(0, data[pIdx] + relief));
        output[pIdx + 1] = Math.min(255, Math.max(0, data[pIdx + 1] + relief));
        output[pIdx + 2] = Math.min(255, Math.max(0, data[pIdx + 2] + relief));
      }
    }
  } else if (style === 'fine_grain') {
    // 细腻磨砂高光：微噪点 + 高频边缘微反光
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const pIdx = idx * 4;
        const gx = lumMap[idx + 1] - lumMap[idx - 1];
        const gy = lumMap[idx + width] - lumMap[idx - width];

        // 伪随机微噪点
        const noise = ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) - 0.5;
        const relief = (gx * lx + gy * ly) * depthFactor * 45 + noise * depthFactor * 25;

        output[pIdx] = Math.min(255, Math.max(0, data[pIdx] + relief));
        output[pIdx + 1] = Math.min(255, Math.max(0, data[pIdx + 1] + relief));
        output[pIdx + 2] = Math.min(255, Math.max(0, data[pIdx + 2] + relief));
      }
    }
  } else if (style === 'contour_mesh') {
    // 几何等高网格：双向正弦干涉波网格
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const pIdx = idx * 4;
        const l = lumMap[idx];
        const mesh =
          Math.sin(l * 32 + x * 0.08) * Math.cos(l * 32 + y * 0.08) * depthFactor * 32;

        output[pIdx] = Math.min(255, Math.max(0, data[pIdx] + mesh));
        output[pIdx + 1] = Math.min(255, Math.max(0, data[pIdx + 1] + mesh));
        output[pIdx + 2] = Math.min(255, Math.max(0, data[pIdx + 2] + mesh));
      }
    }
  }

  for (let i = 0; i < data.length; i++) {
    data[i] = output[i];
  }
}

/**
 * 绘制高光光斑图层（支持单点/多点高光叠加，支持磨砂银白、彩虹全息、暖金微光、极光幻彩）
 */
function drawFoilShimmerLayer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  shimmerType: FoilShimmerType,
  brightnessPercent: number,
  radiusPercent: number,
  lightPoints?: LightPoint[],
  lightAngleDeg = 225
) {
  // 计算所有落点的物理坐标
  const points: { cx: number; cy: number }[] = [];

  if (lightPoints && lightPoints.length > 0) {
    for (const pt of lightPoints) {
      points.push({
        cx: (width * pt.x) / 100,
        cy: (height * pt.y) / 100,
      });
    }
  } else {
    const rad = (lightAngleDeg * Math.PI) / 180;
    points.push({
      cx: width * 0.5 + Math.cos(rad) * (width * 0.28),
      cy: height * 0.5 + Math.sin(rad) * (height * 0.28),
    });
  }

  const maxDim = Math.max(width, height);
  const radius = Math.max(20, (maxDim * radiusPercent) / 100);
  const alpha = Math.min(1, Math.max(0.1, (brightnessPercent / 100) * 0.95));

  ctx.save();
  ctx.globalCompositeOperation = 'color-dodge';

  for (const { cx, cy } of points) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);

    switch (shimmerType) {
      case 'prismatic_opal':
        // 欧泊幻彩：翡翠天青与蜜桃粉宝石折射色散
        grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
        grad.addColorStop(0.16, `rgba(255, 185, 210, ${alpha * 0.9})`);
        grad.addColorStop(0.36, `rgba(130, 245, 215, ${alpha * 0.78})`);
        grad.addColorStop(0.56, `rgba(120, 210, 255, ${alpha * 0.65})`);
        grad.addColorStop(0.76, `rgba(205, 160, 255, ${alpha * 0.35})`);
        grad.addColorStop(1, 'transparent');
        break;

      case 'neon_cyber':
        // 赛博霓虹：电光洋红 ↔ 极光电青冷暖激光冲突
        grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
        grad.addColorStop(0.2, `rgba(255, 45, 150, ${alpha * 0.92})`);
        grad.addColorStop(0.46, `rgba(150, 60, 255, ${alpha * 0.75})`);
        grad.addColorStop(0.72, `rgba(0, 240, 255, ${alpha * 0.48})`);
        grad.addColorStop(1, 'transparent');
        break;

      case 'rose_champagne':
        // 玫瑰香槟：蜜桃金与暮色玫瑰粉紫
        grad.addColorStop(0, `rgba(255, 255, 245, ${alpha})`);
        grad.addColorStop(0.2, `rgba(255, 195, 150, ${alpha * 0.88})`);
        grad.addColorStop(0.46, `rgba(245, 130, 175, ${alpha * 0.68})`);
        grad.addColorStop(0.76, `rgba(195, 120, 195, ${alpha * 0.25})`);
        grad.addColorStop(1, 'transparent');
        break;

      case 'nebula_violet':
        // 星云幽紫：荧光魅紫 ↔ 深邃群青星尘
        grad.addColorStop(0, `rgba(255, 240, 255, ${alpha})`);
        grad.addColorStop(0.2, `rgba(215, 75, 255, ${alpha * 0.88})`);
        grad.addColorStop(0.5, `rgba(75, 110, 255, ${alpha * 0.62})`);
        grad.addColorStop(0.78, `rgba(0, 210, 255, ${alpha * 0.25})`);
        grad.addColorStop(1, 'transparent');
        break;

      case 'rainbow_foil':
        // 彩虹镭射全息：全光谱高密度色散
        grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
        grad.addColorStop(0.18, `rgba(255, 220, 100, ${alpha * 0.85})`);
        grad.addColorStop(0.35, `rgba(255, 120, 180, ${alpha * 0.75})`);
        grad.addColorStop(0.52, `rgba(160, 100, 255, ${alpha * 0.65})`);
        grad.addColorStop(0.7, `rgba(80, 220, 255, ${alpha * 0.45})`);
        grad.addColorStop(0.88, `rgba(120, 255, 180, ${alpha * 0.2})`);
        grad.addColorStop(1, 'transparent');
        break;

      case 'warm_gold':
        // 奢雅暖金：香槟金与古典暖黄反光
        grad.addColorStop(0, `rgba(255, 255, 235, ${alpha})`);
        grad.addColorStop(0.22, `rgba(255, 220, 130, ${alpha * 0.85})`);
        grad.addColorStop(0.5, `rgba(230, 175, 60, ${alpha * 0.45})`);
        grad.addColorStop(0.8, `rgba(180, 120, 30, ${alpha * 0.12})`);
        grad.addColorStop(1, 'transparent');
        break;

      case 'pearl_platinum':
        // 珠光铂金：冰蓝淡紫纯净冷冽冷光
        grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
        grad.addColorStop(0.2, `rgba(225, 240, 255, ${alpha * 0.82})`);
        grad.addColorStop(0.48, `rgba(235, 220, 250, ${alpha * 0.48})`);
        grad.addColorStop(0.76, `rgba(190, 205, 230, ${alpha * 0.16})`);
        grad.addColorStop(1, 'transparent');
        break;

      case 'obsidian_gold':
        // 黑曜暗金：柔金浅白核心 + 琥珀暗金流光 + 烟熏黑钛冷灰漫反射
        grad.addColorStop(0, `rgba(255, 250, 235, ${alpha})`);
        grad.addColorStop(0.18, `rgba(235, 195, 110, ${alpha * 0.9})`);
        grad.addColorStop(0.44, `rgba(160, 115, 45, ${alpha * 0.65})`);
        grad.addColorStop(0.72, `rgba(35, 38, 48, ${alpha * 0.35})`);
        grad.addColorStop(1, 'transparent');
        break;
    }

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  // 叠加柔和漫反射环境光，增强整体金属/纸面反光通透感
  const envGrad = ctx.createLinearGradient(0, 0, width, height);
  envGrad.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.2})`);
  envGrad.addColorStop(0.5, 'transparent');
  envGrad.addColorStop(1, `rgba(255, 255, 255, ${alpha * 0.12})`);
  ctx.fillStyle = envGrad;
  ctx.fillRect(0, 0, width, height);

  ctx.restore();
}

/**
 * 依据参数，将已加载的源图渲染为带微浮雕、全息高光、邮票打孔与立体阴影的高清 PNG
 *
 * @param sourceImg 已加载完成的 HTMLImageElement
 * @param params    微浮雕高光渲染参数
 * @param options   可选配置（如 maxEdge 限制）
 * @returns 高清透明 PNG 的 Data URL
 */
export async function renderEmbossFoilFromImage(
  sourceImg: HTMLImageElement,
  params: EmbossFoilParams,
  options: { maxEdge?: number; bgColor?: string | null } = {}
): Promise<string> {
  const natW = sourceImg.naturalWidth || sourceImg.width;
  const natH = sourceImg.naturalHeight || sourceImg.height;

  if (!natW || !natH) {
    throw new Error('源图片尺寸无效');
  }

  // 1. 等比缩放计算
  const maxEdge = options.maxEdge || 1800;
  let targetW = natW;
  let targetH = natH;
  if (Math.max(targetW, targetH) > maxEdge) {
    if (targetW >= targetH) {
      targetH = Math.round((targetH * maxEdge) / targetW);
      targetW = maxEdge;
    } else {
      targetW = Math.round((targetW * maxEdge) / targetH);
      targetH = maxEdge;
    }
  }

  const withMargin = params.withMargin !== false;
  const withPerforation = params.withPerforation !== false;

  // 自适应尺寸比例（以 600px 为基准）
  const scaleFactor = Math.max(0.6, Math.min(3.5, targetW / 600));
  const margin = withMargin ? Math.round(36 * scaleFactor) : 0;
  const holeRadius = Math.round(12 * scaleFactor);
  const pitch = Math.round(holeRadius * 2 + 16 * scaleFactor);
  const outerPad = withPerforation ? Math.round(54 * scaleFactor) : Math.round(24 * scaleFactor);

  const cardW = targetW + margin * 2;
  const cardH = targetH + margin * 2;

  // 2. 离屏 Canvas 1：绘制底层内容图并进行浮雕/等高线像素处理
  const contentCanvas = document.createElement('canvas');
  contentCanvas.width = targetW;
  contentCanvas.height = targetH;
  const contentCtx = contentCanvas.getContext('2d', { willReadFrequently: true });
  if (!contentCtx) throw new Error('创建 Canvas 2D 上下文失败');

  contentCtx.drawImage(sourceImg, 0, 0, targetW, targetH);
  const rawImageData = contentCtx.getImageData(0, 0, targetW, targetH);

  // 像素级微浮雕 / 等高线算法
  processReliefPixels(rawImageData, params.reliefStyle, params.depth, params.lightAngle);
  contentCtx.putImageData(rawImageData, 0, 0);

  // 3. 离屏 Canvas 2：组装卡片本体（纸底 + 浮雕内容图 + 高光混合图层 + 齿孔打孔）
  const cardCanvas = document.createElement('canvas');
  cardCanvas.width = cardW;
  cardCanvas.height = cardH;
  const cardCtx = cardCanvas.getContext('2d');
  if (!cardCtx) throw new Error('创建卡片 Canvas 上下文失败');

  // 3.1 绘制白色底纸
  cardCtx.fillStyle = '#ffffff';
  cardCtx.fillRect(0, 0, cardW, cardH);

  // 3.2 绘制浮雕处理后的内容图
  cardCtx.drawImage(contentCanvas, margin, margin, targetW, targetH);

  // 3.3 绘制动态高光反光层（color-dodge 混合，高光扫过浮雕线条产生强烈质感）
  drawFoilShimmerLayer(
    cardCtx,
    cardW,
    cardH,
    params.shimmerType,
    params.brightness,
    params.radius,
    params.lightPoints,
    params.lightAngle
  );

  // 3.4 若开启邮票齿孔打孔，进行四周半圆打孔 (destination-out 剔除 alpha)
  if (withPerforation) {
    cardCtx.save();
    cardCtx.globalCompositeOperation = 'destination-out';
    cardCtx.fillStyle = '#000000';

    // 水平打孔（顶部 y=0 与 底部 y=cardH）
    const numH = Math.max(1, Math.round((cardW - pitch) / pitch));
    const startH = (cardW - numH * pitch) / 2 + pitch / 2;
    for (let i = 0; i <= numH; i++) {
      const cx = startH + i * pitch - pitch / 2;
      // 顶部半圆
      cardCtx.beginPath();
      cardCtx.arc(cx, 0, holeRadius, 0, Math.PI * 2);
      cardCtx.fill();
      // 底部半圆
      cardCtx.beginPath();
      cardCtx.arc(cx, cardH, holeRadius, 0, Math.PI * 2);
      cardCtx.fill();
    }

    // 垂直打孔（左侧 x=0 与 右侧 x=cardW）
    const numV = Math.max(1, Math.round((cardH - pitch) / pitch));
    const startV = (cardH - numV * pitch) / 2 + pitch / 2;
    for (let i = 0; i <= numV; i++) {
      const cy = startV + i * pitch - pitch / 2;
      // 左侧半圆
      cardCtx.beginPath();
      cardCtx.arc(0, cy, holeRadius, 0, Math.PI * 2);
      cardCtx.fill();
      // 右侧半圆
      cardCtx.beginPath();
      cardCtx.arc(cardW, cy, holeRadius, 0, Math.PI * 2);
      cardCtx.fill();
    }
    cardCtx.restore();
  }

  // 4. 最终画布合成：添加真实物理立体环境阴影并输出
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = cardW + outerPad * 2;
  finalCanvas.height = cardH + outerPad * 2;
  const finalCtx = finalCanvas.getContext('2d');
  if (!finalCtx) throw new Error('创建最终画布失败');

  if (options.bgColor) {
    finalCtx.fillStyle = options.bgColor;
    finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
  }

  // 绘制双层立体阴影
  finalCtx.save();
  finalCtx.shadowColor = 'rgba(0, 0, 0, 0.16)';
  finalCtx.shadowBlur = Math.round(18 * scaleFactor);
  finalCtx.shadowOffsetX = Math.round(2 * scaleFactor);
  finalCtx.shadowOffsetY = Math.round(6 * scaleFactor);
  finalCtx.drawImage(cardCanvas, outerPad, outerPad);

  finalCtx.shadowColor = 'rgba(0, 0, 0, 0.10)';
  finalCtx.shadowBlur = Math.round(6 * scaleFactor);
  finalCtx.shadowOffsetX = Math.round(1 * scaleFactor);
  finalCtx.shadowOffsetY = Math.round(2 * scaleFactor);
  finalCtx.drawImage(cardCanvas, outerPad, outerPad);
  finalCtx.restore();

  // 清晰贴上卡片本体
  finalCtx.drawImage(cardCanvas, outerPad, outerPad);

  return finalCanvas.toDataURL('image/png');
}
