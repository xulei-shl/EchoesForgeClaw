/**
 * 玻璃折射 WebGL 渲染引擎
 * 支持实时视口 GPU 渲染与离屏高分辨率导出
 */

import {
  VERTEX_SHADER,
  FRAGMENT_SHADER,
  getPatternIndex,
} from './shaders';
import type { GlassRefractParams } from './types';

/**
 * 编译着色器
 */
function compileShader(gl: WebGLRenderingContext | WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('无法创建 WebGL Shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`着色器编译失败: ${log}`);
  }
  return shader;
}

/**
 * 链接着色器程序
 */
function linkProgram(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('无法创建 WebGL Program');
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    throw new Error(`着色器程序链接失败: ${log}`);
  }
  return program;
}

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
 * WebGL 玻璃折射渲染器
 */
export class GlassRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | WebGL2RenderingContext;
  private program: WebGLProgram;
  private buffer: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const options: WebGLContextAttributes = {
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    };
    const gl =
      (canvas.getContext('webgl2', options) as WebGL2RenderingContext | null) ||
      (canvas.getContext('webgl', options) as WebGLRenderingContext | null);

    if (!gl) {
      throw new Error('当前浏览器不支持 WebGL，无法使用玻璃折射效果');
    }
    this.gl = gl;
    this.program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.setup();
  }

  private setup() {
    const gl = this.gl;
    gl.useProgram(this.program);

    // 全屏覆盖单三角形 [-1, -1], [3, -1], [-1, 3]
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    const position = gl.getAttribLocation(this.program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    // 缓存所有 Uniform 位置
    const uniformNames = [
      'uImage',
      'uResolution',
      'uPattern',
      'uScale',
      'uRelief',
      'uThickness',
      'uAngle',
      'uDispersion',
      'uSpecular',
      'uGap',
      'uSeed',
    ];
    this.uniforms = {};
    for (const name of uniformNames) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }

    // 初始化纹理
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  /**
   * 上传纹理图片到 GPU
   */
  public upload(source: TexImageSource) {
    const gl = this.gl;
    if (!this.texture) return;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source
    );
  }

  /**
   * 绘制单帧
   */
  public draw(width: number, height: number, params: GlassRefractParams) {
    const gl = this.gl;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    const u = this.uniforms;
    if (u.uImage) gl.uniform1i(u.uImage, 0);
    if (u.uResolution) gl.uniform2f(u.uResolution, width, height);
    if (u.uPattern) gl.uniform1i(u.uPattern, getPatternIndex(params.pattern));

    // 以 1200 为基准长边归一化物理单位尺度，确保不同分辨率输出时波纹比例一致
    const unit = Math.max(width, height) / 1200;
    if (u.uScale) gl.uniform1f(u.uScale, Math.max(2, params.scale * unit));
    if (u.uRelief) gl.uniform1f(u.uRelief, params.relief);
    if (u.uThickness) gl.uniform1f(u.uThickness, params.thickness * unit);
    if (u.uAngle) gl.uniform1f(u.uAngle, params.angle);
    if (u.uDispersion) gl.uniform1f(u.uDispersion, params.dispersion);
    if (u.uSpecular) gl.uniform1f(u.uSpecular, params.specular);
    if (u.uGap) gl.uniform1f(u.uGap, params.gap ?? 0.0);
    if (u.uSeed) gl.uniform1f(u.uSeed, (params.seed ?? 7) % 100);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * 销毁 WebGL 资源
   */
  public destroy() {
    const gl = this.gl;
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.program) gl.deleteProgram(this.program);
  }
}

/**
 * 依据参数将图片渲染为玻璃折射高清 PNG
 *
 * @param sourceImg 已加载完成的 HTMLImageElement
 * @param params    玻璃折射参数
 * @param options   可选配置（如 maxEdge 限制）
 * @returns PNG Data URL
 */
export async function renderGlassRefractFromImage(
  sourceImg: HTMLImageElement,
  params: GlassRefractParams,
  options: { maxEdge?: number; scale?: number } = {}
): Promise<string> {
  const natW = sourceImg.naturalWidth || sourceImg.width;
  const natH = sourceImg.naturalHeight || sourceImg.height;

  if (!natW || !natH) {
    throw new Error('源图片尺寸无效');
  }

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

  // 离屏 Canvas
  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = targetW;
  offscreenCanvas.height = targetH;

  let renderer: GlassRenderer | null = null;
  try {
    renderer = new GlassRenderer(offscreenCanvas);
    renderer.upload(sourceImg);
    renderer.draw(targetW, targetH, params);
    return offscreenCanvas.toDataURL('image/png');
  } finally {
    renderer?.destroy();
  }
}
