/**
 * 物理水彩手绘 (p5.brush) 独立渲染会话与导出引擎
 */

import * as brush from './lib/brush.esm.js';
import type { WatercolorAspectRatio, WatercolorBrushState } from './types';
import { executeWatercolorGeneration } from './generators';

export interface WatercolorSessionOptions {
  width?: number;
  height?: number;
  params: WatercolorBrushState;
}

export interface WatercolorRenderResult {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * 根据画幅比例和基准边长计算实际像素宽高
 */
export function getWatercolorDimensions(
  aspectRatio: WatercolorAspectRatio = '1:1',
  baseSize = 512
): { width: number; height: number } {
  switch (aspectRatio) {
    case '3:4':
      return { width: Math.round(baseSize * 0.75), height: baseSize };
    case '4:3':
      return { width: baseSize, height: Math.round(baseSize * 0.75) };
    case '9:16':
      return { width: Math.round(baseSize * 0.5625), height: baseSize };
    case '16:9':
      return { width: baseSize, height: Math.round(baseSize * 0.5625) };
    case '1:1':
    default:
      return { width: baseSize, height: baseSize };
  }
}

/**
 * 物理水彩会话管理器（用于节点内低延迟实时预览）
 */
export class WatercolorSession {
  public canvas: HTMLCanvasElement;
  private width: number;
  private height: number;
  private isDisposed = false;

  private constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;
  }

  public static async create(options: WatercolorSessionOptions): Promise<WatercolorSession> {
    const defaultDims = getWatercolorDimensions(options.params.aspectRatio, 512);
    const w = options.width || defaultDims.width;
    const h = options.height || defaultDims.height;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.objectFit = 'contain';

    // 初始化 brush 渲染目标
    brush.load(canvas);
    brush.scaleBrushes(2.5);

    const session = new WatercolorSession(canvas, w, h);
    session.update(options.params);
    return session;
  }

  public update(params: WatercolorBrushState): void {
    if (this.isDisposed) return;
    brush.load(this.canvas);
    executeWatercolorGeneration(this.width, this.height, params);
  }

  public toDataUrl(): string {
    return this.canvas.toDataURL('image/png');
  }

  public dispose(): void {
    this.isDisposed = true;
    // 解除 DOM 引用，由垃圾回收器统一管理，避免强制 loseContext 导致 p5.brush 着色器单例损坏
    this.canvas.width = 1;
    this.canvas.height = 1;
  }
}

/**
 * 一次性高保真渲染管线（用于点击「生成」时导出 1024p~2048p 高清图）
 */
export async function renderWatercolorArt(
  params: WatercolorBrushState,
  exportWidth?: number,
  exportHeight?: number
): Promise<WatercolorRenderResult> {
  const baseSize = params.resolution || 1024;
  const dims = getWatercolorDimensions(params.aspectRatio || '1:1', baseSize);
  const w = exportWidth || dims.width;
  const h = exportHeight || dims.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  brush.load(canvas);
  brush.scaleBrushes(3.5);
  executeWatercolorGeneration(w, h, params);

  const dataUrl = canvas.toDataURL('image/png');

  // 缩小释放画布缓存
  canvas.width = 1;
  canvas.height = 1;

  return {
    dataUrl,
    width: w,
    height: h,
  };
}
