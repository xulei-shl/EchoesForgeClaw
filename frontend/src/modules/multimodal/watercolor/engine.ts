/**
 * 物理水彩手绘 (p5.brush) 独立渲染会话与导出引擎
 */

import * as brush from './lib/brush.esm.js';
import type { WatercolorBrushState } from './types';
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
    const w = options.width || 512;
    const h = options.height || 512;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.objectFit = 'contain';

    // 初始化 brush 离屏目标
    brush.load(canvas);

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
    // 释放 WebGL 资源
    const gl = this.canvas.getContext('webgl2');
    if (gl) {
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  }
}

/**
 * 一次性高保真渲染管线（用于点击「生成」时导出 1080p~2048p 高清图）
 */
export async function renderWatercolorArt(
  params: WatercolorBrushState,
  exportWidth = 1080,
  exportHeight = 1080
): Promise<WatercolorRenderResult> {
  const canvas = document.createElement('canvas');
  canvas.width = exportWidth;
  canvas.height = exportHeight;

  brush.load(canvas);
  executeWatercolorGeneration(exportWidth, exportHeight, params);

  const dataUrl = canvas.toDataURL('image/png');

  // 释放临时 WebGL context
  const gl = canvas.getContext('webgl2');
  if (gl) {
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  }

  return {
    dataUrl,
    width: exportWidth,
    height: exportHeight,
  };
}
