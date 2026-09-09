/**
 * 邮票齿孔打孔与柔和立体投影离线渲染引擎
 * 基于 HTML5 Canvas 实现，毫秒级输出真透明 RGBA PNG
 */

import type { StampCropBox, StampEffectOptions } from './types';
import { renderStampCore } from './stampStudioEngine';

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
 * 统一委托给物理质感综合渲染引擎处理
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
  return renderStampCore(sourceImg, cropBox, options);
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
