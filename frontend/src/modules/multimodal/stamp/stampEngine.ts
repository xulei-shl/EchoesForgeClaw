/**
 * 邮票齿孔打孔与柔和立体投影离线渲染引擎
 * 基于 HTML5 Canvas 实现，毫秒级输出真透明 RGBA PNG
 */

import type { StampCropBox, StampEffectOptions } from './types';

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
 * 依据裁剪选框与渲染参数，将源图渲染为带齿孔打孔、白色纸边与柔和投影的邮票 PNG
 *
 * @param sourceImg 已加载完成的 HTMLImageElement
 * @param cropBox   归一化裁剪坐标 (0 ~ 1)
 * @param options   打孔与阴影配置选项
 * @returns 高清透明 PNG 的 Data URL 字符串
 */
export async function renderStampFromImage(
  sourceImg: HTMLImageElement,
  cropBox: StampCropBox,
  options: StampEffectOptions = {}
): Promise<string> {
  const natW = sourceImg.naturalWidth || sourceImg.width;
  const natH = sourceImg.naturalHeight || sourceImg.height;

  if (!natW || !natH) {
    throw new Error('源图片尺寸无效');
  }

  // 1. 计算源图实际裁剪像素坐标
  const sx = Math.max(0, Math.min(natW, Math.round(cropBox.x * natW)));
  const sy = Math.max(0, Math.min(natH, Math.round(cropBox.y * natH)));
  const sWidth = Math.max(10, Math.min(natW - sx, Math.round(cropBox.width * natW)));
  const sHeight = Math.max(10, Math.min(natH - sy, Math.round(cropBox.height * natH)));

  const withMargin = options.withMargin !== false;

  // 2. 根据裁剪图尺寸自适应打孔比例（以 600px 宽度为基准 1x）
  const scaleFactor = Math.max(0.6, Math.min(3.5, sWidth / 600));

  const margin = withMargin
    ? (options.margin ? options.margin : Math.round(42 * scaleFactor))
    : 0;
  const holeRadius = options.holeRadius
    ? options.holeRadius
    : Math.round(13 * scaleFactor);
  const pitch = options.pitch
    ? options.pitch
    : Math.round(holeRadius * 2 + 16 * scaleFactor);
  const outerPad = options.outerPad
    ? options.outerPad
    : Math.round(64 * scaleFactor);

  const sw = sWidth + margin * 2;
  const sh = sHeight + margin * 2;

  // 3. 创建离屏 Canvas 绘制邮票本体（白色纸面 + 内容图 + destination-out 打孔）
  const stampCanvas = document.createElement('canvas');
  stampCanvas.width = sw;
  stampCanvas.height = sh;
  const stampCtx = stampCanvas.getContext('2d');
  if (!stampCtx) throw new Error('创建 Canvas 2D 渲染上下文失败');

  // 3.1 绘制白色底纸（即使无 margin 也能保证边缘干净）
  stampCtx.fillStyle = '#ffffff';
  stampCtx.fillRect(0, 0, sw, sh);

  // 3.2 绘制裁剪的内容图
  stampCtx.drawImage(
    sourceImg,
    sx,
    sy,
    sWidth,
    sHeight,
    margin,
    margin,
    sWidth,
    sHeight
  );

  // 3.3 进行四周半圆孔洞打孔（剔除 alpha）
  stampCtx.globalCompositeOperation = 'destination-out';
  stampCtx.fillStyle = '#000000';

  // 水平打孔（顶部 y=0 与 底部 y=sh）
  const numH = Math.max(1, Math.round((sw - pitch) / pitch));
  const startH = (sw - numH * pitch) / 2 + pitch / 2;
  for (let i = 0; i <= numH; i++) {
    const cx = startH + i * pitch - pitch / 2;
    // 顶部半圆
    stampCtx.beginPath();
    stampCtx.arc(cx, 0, holeRadius, 0, Math.PI * 2);
    stampCtx.fill();
    // 底部半圆
    stampCtx.beginPath();
    stampCtx.arc(cx, sh, holeRadius, 0, Math.PI * 2);
    stampCtx.fill();
  }

  // 垂直打孔（左侧 x=0 与 右侧 x=sw）
  const numV = Math.max(1, Math.round((sh - pitch) / pitch));
  const startV = (sh - numV * pitch) / 2 + pitch / 2;
  for (let i = 0; i <= numV; i++) {
    const cy = startV + i * pitch - pitch / 2;
    // 左侧半圆
    stampCtx.beginPath();
    stampCtx.arc(0, cy, holeRadius, 0, Math.PI * 2);
    stampCtx.fill();
    // 右侧半圆
    stampCtx.beginPath();
    stampCtx.arc(sw, cy, holeRadius, 0, Math.PI * 2);
    stampCtx.fill();
  }

  // 4. 创建最终画布（合成四周柔和立体投影 + 贴上邮票本体）
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = sw + outerPad * 2;
  finalCanvas.height = sh + outerPad * 2;
  const finalCtx = finalCanvas.getContext('2d');
  if (!finalCtx) throw new Error('创建最终 Canvas 上下文失败');

  // 4.1 可选底色（默认 null 保持全透明 RGBA）
  if (options.bgColor) {
    finalCtx.fillStyle = options.bgColor;
    finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
  }

  // 4.2 绘制柔和立体阴影（模拟环境光与直射光双层弥散）
  finalCtx.save();
  // 底层宽泛浅柔影
  finalCtx.shadowColor = 'rgba(0, 0, 0, 0.18)';
  finalCtx.shadowBlur = Math.round(20 * scaleFactor);
  finalCtx.shadowOffsetX = Math.round(2 * scaleFactor);
  finalCtx.shadowOffsetY = Math.round(8 * scaleFactor);
  finalCtx.drawImage(stampCanvas, outerPad, outerPad);

  // 顶层贴近硬影增强立体轮廓
  finalCtx.shadowColor = 'rgba(0, 0, 0, 0.12)';
  finalCtx.shadowBlur = Math.round(8 * scaleFactor);
  finalCtx.shadowOffsetX = Math.round(1 * scaleFactor);
  finalCtx.shadowOffsetY = Math.round(3 * scaleFactor);
  finalCtx.drawImage(stampCanvas, outerPad, outerPad);
  finalCtx.restore();

  // 4.3 清晰贴上邮票本体（覆盖在阴影上方）
  finalCtx.drawImage(stampCanvas, outerPad, outerPad);

  return finalCanvas.toDataURL('image/png');
}

/**
 * 实时生成打孔选框的 SVG 路径，供 UI 选框无缝呈现锯齿边缘
 */
export function buildStampPerforatedPath(
  w: number,
  h: number,
  holeR = 6,
  pitch = 18
): string {
  if (w <= 0 || h <= 0) return '';

  const numH = Math.max(1, Math.round((w - pitch) / pitch));
  const startH = (w - numH * pitch) / 2 + pitch / 2;

  const numV = Math.max(1, Math.round((h - pitch) / pitch));
  const startV = (h - numV * pitch) / 2 + pitch / 2;

  let d = `M 0 0`;

  // 顶边向右
  let lastX = 0;
  for (let i = 0; i <= numH; i++) {
    const cx = startH + i * pitch - pitch / 2;
    if (cx - holeR > lastX) {
      d += ` L ${cx - holeR} 0`;
    }
    // 向内凹的半圆 (arc 从 cx-holeR, 0 到 cx+holeR, 0)
    d += ` A ${holeR} ${holeR} 0 0 0 ${cx + holeR} 0`;
    lastX = cx + holeR;
  }
  d += ` L ${w} 0`;

  // 右边向下
  let lastY = 0;
  for (let i = 0; i <= numV; i++) {
    const cy = startV + i * pitch - pitch / 2;
    if (cy - holeR > lastY) {
      d += ` L ${w} ${cy - holeR}`;
    }
    // 向内凹的半圆 (arc 从 w, cy-holeR 到 w, cy+holeR)
    d += ` A ${holeR} ${holeR} 0 0 0 ${w} ${cy + holeR}`;
    lastY = cy + holeR;
  }
  d += ` L ${w} ${h}`;

  // 底边向左
  lastX = w;
  for (let i = numH; i >= 0; i--) {
    const cx = startH + i * pitch - pitch / 2;
    if (cx + holeR < lastX) {
      d += ` L ${cx + holeR} ${h}`;
    }
    // 向内凹的半圆 (arc 从 cx+holeR, h 到 cx-holeR, h)
    d += ` A ${holeR} ${holeR} 0 0 0 ${cx - holeR} ${h}`;
    lastX = cx - holeR;
  }
  d += ` L 0 ${h}`;

  // 左边向上
  lastY = h;
  for (let i = numV; i >= 0; i--) {
    const cy = startV + i * pitch - pitch / 2;
    if (cy + holeR < lastY) {
      d += ` L 0 ${cy + holeR}`;
    }
    // 向内凹的半圆 (arc 从 0, cy+holeR 到 0, cy-holeR)
    d += ` A ${holeR} ${holeR} 0 0 0 0 ${cy - holeR}`;
    lastY = cy - holeR;
  }
  d += ` Z`;

  return d;
}
