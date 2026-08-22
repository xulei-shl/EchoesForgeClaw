/**
 * 图片处理效果共享画布工具（预览与导出共用）
 */

import type { ImageFxParamDef, ImageFxParamValue } from './types';

/** 加载图片（crossOrigin anonymous，失败抛出可读错误） */
export function fxLoadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败，请检查图片地址'));
    img.src = src;
  });
}

/** 把图片按最长边上限绘制到新画布（不超限则原尺寸），返回 { canvas, ctx } */
export function fxDrawingCanvas(
  img: HTMLImageElement,
  maxEdge: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const sourceWidth = img.naturalWidth || img.width;
  const sourceHeight = img.naturalHeight || img.height;
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建画布上下文');
  ctx.drawImage(img, 0, 0, width, height);
  return { canvas, ctx };
}

/** 从效果参数声明提取默认值表（单一事实来源：default 字段） */
export function fxDefaultParams(
  params: ImageFxParamDef[]
): Record<string, ImageFxParamValue> {
  const out: Record<string, ImageFxParamValue> = {};
  for (const p of params) out[p.key] = p.default;
  return out;
}
