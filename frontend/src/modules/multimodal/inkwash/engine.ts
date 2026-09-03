/**
 * 水墨写意 (InkWash) WebGL2 流体动力学模拟与渲染导出引擎
 * 移植并增强自 inkwash-main，提供交互手绘、意境生成与高清宣纸渲染导出
 */

import type {
  InkWashAspectRatio,
  InkWashPaperStyle,
  InkWashState,
  InkWashToolMode,
} from './types';
import { INKWASH_PRESET_INKS } from './types';

export interface InkWashRenderResult {
  dataUrl: string;
  width: number;
  height: number;
}

export interface InkWashSessionOptions {
  width?: number;
  height?: number;
  params: InkWashState;
  onStrokeEnd?: () => void;
}

/**
 * 根据画幅比例和基准边长计算实际像素宽高
 */
export function getInkWashDimensions(
  aspectRatio: InkWashAspectRatio = '1:1',
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

/** 将 hex 字符串转换为墨色吸光度向量 */
export function hexToInkAbsorption(hex: string): [number, number, number] {
  const match = INKWASH_PRESET_INKS.find((p) => p.hex.toLowerCase() === hex.toLowerCase());
  if (match) return match.inkAbs;

  const clean = hex.replace('#', '');
  if (clean.length !== 6) return [1.0, 0.97, 0.88];
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  if (Math.max(r, g, b) < 0.09) return [1.0, 0.97, 0.88];
  const A = [r, g, b].map((v) => -Math.log(Math.max(v, 0.02)));
  const m = Math.max(A[0], A[1], A[2], 0.25);
  return [A[0] / m, A[1] / m, A[2] / m];
}

/* ---------------- GL Shaders ---------------- */

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.,1.); }`;

const copyFS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform float uValue;
void main(){ o = texture(uTex, vUv) * uValue; }`;

const splatFS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform float uAspect; uniform vec2 uPoint;
uniform vec4 uColor; uniform float uRadius;
void main(){
  vec2 p = vUv - uPoint; p.x *= uAspect;
  o = uColor * exp(-dot(p,p) / uRadius);
}`;

const advectVelFS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity, uWet;
uniform vec2 uTexel;
uniform float uDt, uDissipation;
void main(){
  vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy * uTexel;
  vec2 vel = texture(uVelocity, coord).xy * uDissipation;
  float w = texture(uWet, vUv).x;
  float mask = smoothstep(0.005, 0.2, w);
  o = vec4(vel * mask, 0., 1.);
}`;

const advectWetFS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity, uWet;
uniform vec2 uTexel, uSrcTexel;
uniform float uDt, uDecay, uSpread;
void main(){
  vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy * uTexel * 0.6;
  float w = texture(uWet, coord).x;
  vec2 b = uSrcTexel * 1.6;
  float n = (texture(uWet, coord + vec2(b.x, 0.)).x + texture(uWet, coord - vec2(b.x, 0.)).x
           + texture(uWet, coord + vec2(0., b.y)).x + texture(uWet, coord - vec2(0., b.y)).x) * 0.25;
  w = mix(w, n, uSpread);
  o = vec4(w * uDecay, 0., 0., 1.);
}`;

const advectInkFS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity, uSource, uWet;
uniform vec2 uTexel, uSrcTexel;
uniform float uDt, uBleed, uAspect;
uniform vec3 uChroma;
uniform vec3 uBrush;
void main(){
  float w = texture(uWet, vUv).x;
  float mob = smoothstep(0.02, 0.45, w);
  vec4 cur = texture(uSource, vUv);
  if (mob < 0.002){ o = cur; return; }
  vec2 vel = texture(uVelocity, vUv).xy;
  vec2 coord = vUv - uDt * vel * uTexel * mob;
  vec4 adv = texture(uSource, coord);
  float brush = 0.;
  if (uBrush.z > 0.){
    vec2 d = vUv - uBrush.xy; d.x *= uAspect;
    brush = exp(-dot(d,d) / (uBrush.z * uBrush.z));
  }
  vec2 b = uSrcTexel * 1.6;
  vec4 n = (texture(uSource, coord + vec2(b.x, 0.)) + texture(uSource, coord - vec2(b.x, 0.))
          + texture(uSource, coord + vec2(0., b.y)) + texture(uSource, coord - vec2(0., b.y))) * 0.25;
  vec4 bleedAmt = clamp(uBleed * (0.25 + 1.3 * brush) * mob * vec4(uChroma, 1.05), 0., 0.92);
  vec4 mixed = mix(adv, n, bleedAmt);
  o = mix(cur, mixed, mob);
}`;

const divergenceFS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity; uniform vec2 uTexel;
void main(){
  float L = texture(uVelocity, vUv - vec2(uTexel.x, 0.)).x;
  float R = texture(uVelocity, vUv + vec2(uTexel.x, 0.)).x;
  float B = texture(uVelocity, vUv - vec2(0., uTexel.y)).y;
  float T = texture(uVelocity, vUv + vec2(0., uTexel.y)).y;
  o = vec4(0.5 * (R - L + T - B), 0., 0., 1.);
}`;

const pressureFS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uPressure, uDivergence; uniform vec2 uTexel;
void main(){
  float L = texture(uPressure, vUv - vec2(uTexel.x, 0.)).x;
  float R = texture(uPressure, vUv + vec2(uTexel.x, 0.)).x;
  float B = texture(uPressure, vUv - vec2(0., uTexel.y)).x;
  float T = texture(uPressure, vUv + vec2(0., uTexel.y)).x;
  float div = texture(uDivergence, vUv).x;
  o = vec4((L + R + B + T - div) * 0.25, 0., 0., 1.);
}`;

const gradSubFS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uPressure, uVelocity; uniform vec2 uTexel;
void main(){
  float L = texture(uPressure, vUv - vec2(uTexel.x, 0.)).x;
  float R = texture(uPressure, vUv + vec2(uTexel.x, 0.)).x;
  float B = texture(uPressure, vUv - vec2(0., uTexel.y)).x;
  float T = texture(uPressure, vUv + vec2(0., uTexel.y)).x;
  vec2 vel = texture(uVelocity, vUv).xy - 0.5 * vec2(R - L, T - B);
  o = vec4(vel, 0., 1.);
}`;

const curlFS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity; uniform vec2 uTexel;
void main(){
  float L = texture(uVelocity, vUv - vec2(uTexel.x, 0.)).y;
  float R = texture(uVelocity, vUv + vec2(uTexel.x, 0.)).y;
  float B = texture(uVelocity, vUv - vec2(0., uTexel.y)).x;
  float T = texture(uVelocity, vUv + vec2(0., uTexel.y)).x;
  o = vec4(0.5 * ((R - L) - (T - B)), 0., 0., 1.);
}`;

const vorticityFS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity, uCurl;
uniform vec2 uTexel; uniform float uCurlAmt, uDt;
void main(){
  float L = texture(uCurl, vUv - vec2(uTexel.x, 0.)).x;
  float R = texture(uCurl, vUv + vec2(uTexel.x, 0.)).x;
  float B = texture(uCurl, vUv - vec2(0., uTexel.y)).x;
  float T = texture(uCurl, vUv + vec2(0., uTexel.y)).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 1e-4;
  force *= uCurlAmt * C * vec2(1., -1.);
  vec2 vel = texture(uVelocity, vUv).xy + force * uDt;
  o = vec4(clamp(vel, -1000., 1000.), 0., 1.);
}`;

const exchangeFS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uFixed, uInk, uWet;
uniform float uSettle, uDt, uAspect, uMode;
uniform vec3 uBrush;
void main(){
  vec4 F = texture(uFixed, vUv);
  vec4 M = texture(uInk, vUv);
  float lift = 0.0;
  if (uMode < 0.5){
    vec3 fd = F.rgb * (1.0 - lift) + M.rgb * uSettle;
    float fw = F.a * (1.0 - lift) + M.a * uSettle;
    if (uSettle > 0.0){
      float c = (1.0 - exp(-2.2 * fw)) * uSettle;
      vec3 T = exp(-fd);
      fd = -log(clamp(T * (1.0 - c) + c, 1e-4, 1.0));
      fw *= 1.0 - uSettle;
    }
    o = vec4(fd, fw);
  } else {
    o = M * (1.0 - uSettle) + F * lift;
  }
}`;

const displayFS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uInk, uFixed, uWet;
uniform vec2 uTexel, uRes;
uniform float uInkStrength, uEdge, uGrain, uWhiteTint;
uniform vec3 uPaperColor;
uniform float uTransparent;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3. - 2.*f);
  float a = hash(i), b = hash(i + vec2(1., 0.)), c = hash(i + vec2(0., 1.)), d = hash(i + vec2(1., 1.));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){ float v = 0., a = 0.5; for (int i = 0; i < 4; i++){ v += a * vnoise(p); p *= 2.07; a *= 0.5; } return v; }
vec4 pig(vec2 uv){ return texture(uInk, uv) + texture(uFixed, uv); }

void main(){
  vec4 pw = pig(vUv);
  vec3 p = pw.rgb;
  float c = dot(p, vec3(1.));
  float l = dot(pig(vUv - vec2(uTexel.x, 0.)).rgb, vec3(1.));
  float r = dot(pig(vUv + vec2(uTexel.x, 0.)).rgb, vec3(1.));
  float b = dot(pig(vUv - vec2(0., uTexel.y)).rgb, vec3(1.));
  float t = dot(pig(vUv + vec2(0., uTexel.y)).rgb, vec3(1.));
  float edge = length(vec2(r - l, t - b));
  vec2 px = vUv * uRes;
  float fiber = fbm(px * 0.055);
  float tooth = vnoise(px * 0.42);
  float grain = fbm(px * 0.12 + 31.7);
  vec3 paper = uPaperColor;
  paper -= (fiber - 0.5) * 0.05;
  paper -= (tooth - 0.5) * 0.022;
  vec3 absb = p * uInkStrength;
  absb *= 1.0 + (grain - 0.5) * uGrain * clamp(c * 2.0, 0., 1.);
  absb *= 1.0 + edge * uEdge;
  vec3 col = paper * exp(-absb);
  
  float cov = 1.0 - exp(-pw.a * 2.2);
  cov = clamp(cov * (1.0 - (grain - 0.5) * 0.35), 0., 1.);
  vec3 wcol = mix(vec3(0.985, 0.982, 0.972), vec3(0.945, 0.955, 1.0), uWhiteTint);
  col = mix(col, wcol, cov);

  float wraw = texture(uWet, vUv).x;
  float ws = smoothstep(0.02, 0.6, wraw);
  col *= vec3(1.0) - ws * vec3(0.16, 0.15, 0.11);

  if (uTransparent > 0.5) {
    float inkAlpha = clamp(dot(p, vec3(0.85)) * 1.8 + cov, 0.0, 1.0);
    o = vec4(col, inkAlpha);
  } else {
    vec2 q = vUv - 0.5;
    col *= 1.0 - dot(q, q) * 0.14;
    o = vec4(col, 1.0);
  }
}`;

/* ---------------- GL Helper Classes ---------------- */

interface FBO {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
  texel: [number, number];
  attach(unit: number): number;
}

interface DoubleFBO {
  w: number;
  h: number;
  texel: [number, number];
  read: FBO;
  write: FBO;
  swap(): void;
}

interface ProgramInfo {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation>;
  bind(): void;
}

/**
 * 物理水彩与流体水墨核心会话管理器
 */
export class InkWashSession {
  public canvas: HTMLCanvasElement;
  public width: number;
  public height: number;
  public params: InkWashState;

  private gl: WebGL2RenderingContext;
  private isDisposed = false;
  private animFrameId: number | null = null;
  private onStrokeEnd?: () => void;

  // WebGL Buffers & Programs
  private vao!: WebGLVertexArrayObject;
  private vbo!: WebGLBuffer;
  private quadVS!: WebGLShader;

  private progCopy!: ProgramInfo;
  private progSplat!: ProgramInfo;
  private progAdvVel!: ProgramInfo;
  private progAdvWet!: ProgramInfo;
  private progAdvInk!: ProgramInfo;
  private progExchange!: ProgramInfo;
  private progDiv!: ProgramInfo;
  private progPressure!: ProgramInfo;
  private progGradSub!: ProgramInfo;
  private progCurl!: ProgramInfo;
  private progVort!: ProgramInfo;
  private progDisplay!: ProgramInfo;

  // FBO targets
  public velocity!: DoubleFBO;
  public divergence!: FBO;
  public curl!: FBO;
  public pressure!: DoubleFBO;
  public ink!: DoubleFBO;
  public fixed!: DoubleFBO;
  public wet!: DoubleFBO;

  // 物理与绘制状态
  private fixTimer = 0;
  private brushNow = { x: 0, y: 0, r: 0 };
  public inkAbs: [number, number, number] = [1.0, 0.97, 0.88];
  private lastT = performance.now();
  private strokesCount = 0;

  // 交互指针指针状态
  public ptr = {
    down: false,
    tx: 0.5,
    ty: 0.5,
    bx: 0.5,
    by: 0.5,
    speed: 0,
    simP: 0.35,
    force: 0,
    hasForce: false,
    forceT: 0,
    cx: 0,
    cy: 0,
    inWindow: false,
    barrel: false,
    type: 'mouse',
  };
  private activePointerId: number | null = null;

  private constructor(
    canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    params: InkWashState,
    onStrokeEnd?: () => void
  ) {
    this.canvas = canvas;
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.params = { ...params };
    this.onStrokeEnd = onStrokeEnd;
    this.inkAbs = hexToInkAbsorption(params.inkColor);

    this.initGL();
    this.initTargets();
    this.bindEvents();
    this.startLoop();
  }

  public static async create(options: InkWashSessionOptions): Promise<InkWashSession> {
    const dims = getInkWashDimensions(options.params.aspectRatio, 512);
    const w = options.width || dims.width;
    const h = options.height || dims.height;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.objectFit = 'contain';
    canvas.style.touchAction = 'none';

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      depth: false,
      stencil: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2，无法开启水墨模拟引擎');

    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) throw new Error('缺少 EXT_color_buffer_float 浮点纹理扩展');

    gl.disable(gl.BLEND);

    return new InkWashSession(canvas, gl, w, h, options.params, options.onStrokeEnd);
  }

  private initGL(): void {
    const gl = this.gl;
    this.quadVS = this.compileShader(gl.VERTEX_SHADER, VERT);

    this.progCopy = this.createProgram(copyFS);
    this.progSplat = this.createProgram(splatFS);
    this.progAdvVel = this.createProgram(advectVelFS);
    this.progAdvWet = this.createProgram(advectWetFS);
    this.progAdvInk = this.createProgram(advectInkFS);
    this.progExchange = this.createProgram(exchangeFS);
    this.progDiv = this.createProgram(divergenceFS);
    this.progPressure = this.createProgram(pressureFS);
    this.progGradSub = this.createProgram(gradSubFS);
    this.progCurl = this.createProgram(curlFS);
    this.progVort = this.createProgram(vorticityFS);
    this.progDisplay = this.createProgram(displayFS);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  private compileShader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('Shader compilation error: ' + err);
    }
    return s;
  }

  private createProgram(fsSrc: string): ProgramInfo {
    const gl = this.gl;
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSrc);
    const p = gl.createProgram()!;
    gl.attachShader(p, this.quadVS);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const err = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error('Program link error: ' + err);
    }
    const u: Record<string, WebGLUniformLocation> = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const inf = gl.getActiveUniform(p, i)!;
      u[inf.name] = gl.getUniformLocation(p, inf.name)!;
    }
    return {
      p,
      u,
      bind: () => gl.useProgram(p),
    };
  }

  private createFBO(w: number, h: number, internal: number, format: number, type: number, filter: number): FBO {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return {
      tex,
      fbo,
      w,
      h,
      texel: [1 / w, 1 / h],
      attach: (unit: number) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        return unit;
      },
    };
  }

  private createDoubleFBO(w: number, h: number, internal: number, format: number, type: number, filter: number): DoubleFBO {
    let a = this.createFBO(w, h, internal, format, type, filter);
    let b = this.createFBO(w, h, internal, format, type, filter);
    return {
      w,
      h,
      texel: [1 / w, 1 / h],
      get read() { return a; },
      get write() { return b; },
      swap: () => {
        const t = a;
        a = b;
        b = t;
      },
    };
  }

  private getRes(base: number) {
    const ar = this.canvas.width / this.canvas.height;
    return ar > 1
      ? { w: Math.round(base * ar), h: base }
      : { w: base, h: Math.round(base / ar) };
  }

  private initTargets(): void {
    const gl = this.gl;
    const HF = gl.HALF_FLOAT;
    const sim = this.getRes(256);
    const dye = this.getRes(Math.min(1024, Math.max(this.canvas.width, this.canvas.height)));

    this.velocity = this.createDoubleFBO(sim.w, sim.h, gl.RG16F, gl.RG, HF, gl.LINEAR);
    this.divergence = this.createFBO(sim.w, sim.h, gl.R16F, gl.RED, HF, gl.NEAREST);
    this.curl = this.createFBO(sim.w, sim.h, gl.R16F, gl.RED, HF, gl.NEAREST);
    this.pressure = this.createDoubleFBO(sim.w, sim.h, gl.R16F, gl.RED, HF, gl.NEAREST);
    this.ink = this.createDoubleFBO(dye.w, dye.h, gl.RGBA16F, gl.RGBA, HF, gl.LINEAR);
    this.fixed = this.createDoubleFBO(dye.w, dye.h, gl.RGBA16F, gl.RGBA, HF, gl.LINEAR);
    this.wet = this.createDoubleFBO(dye.w, dye.h, gl.R16F, gl.RED, HF, gl.LINEAR);
  }

  private blit(target: FBO | null): void {
    const gl = this.gl;
    if (target == null) {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.w, target.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  public splat(target: DoubleFBO, x: number, y: number, r: number, c: number[], useMax = false): void {
    const gl = this.gl;
    const f = target.read;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo);
    gl.viewport(0, 0, f.w, f.h);

    const ex = Math.ceil(r * 4.5 * f.h) + 2;
    const cx = Math.round(x * f.w);
    const cy = Math.round(y * f.h);

    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.max(cx - ex, 0), Math.max(cy - ex, 0), ex * 2, ex * 2);
    gl.enable(gl.BLEND);

    if (useMax) gl.blendEquation(gl.MAX);
    else {
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE);
    }

    this.progSplat.bind();
    gl.uniform1f(this.progSplat.u.uAspect, this.canvas.width / this.canvas.height);
    gl.uniform2f(this.progSplat.u.uPoint, x, y);
    gl.uniform4f(this.progSplat.u.uColor, c[0], c[1], c[2], c[3]);
    gl.uniform1f(this.progSplat.u.uRadius, r * r);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
  }

  /* ---------------- 交互事件绑定 ---------------- */

  private toUv(clientX: number, clientY: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = 1 - (clientY - rect.top) / rect.height;
    return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
  }

  private handlePointerDown = (e: PointerEvent) => {
    if (this.isDisposed) return;
    if (this.ptr.down && e.pointerId !== this.activePointerId) return;
    this.activePointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);

    const [x, y] = this.toUv(e.clientX, e.clientY);
    this.ptr.down = true;
    this.ptr.tx = x;
    this.ptr.ty = y;
    this.ptr.bx = x;
    this.ptr.by = y;
    this.ptr.speed = 0;
    this.ptr.simP = 0.35;
    this.ptr.type = e.pointerType;
    this.ptr.barrel = (e.buttons & 34) !== 0;
    this.readPressure(e);
    this.strokesCount++;
  };

  private handlePointerMove = (e: PointerEvent) => {
    if (this.isDisposed) return;
    if (this.ptr.down && e.pointerId !== this.activePointerId) return;
    const [x, y] = this.toUv(e.clientX, e.clientY);
    this.ptr.tx = x;
    this.ptr.ty = y;
    this.ptr.cx = e.clientX;
    this.ptr.cy = e.clientY;
    this.ptr.inWindow = true;
    if (!this.ptr.down) this.ptr.type = e.pointerType;
    if (this.ptr.down) this.ptr.barrel = (e.buttons & 34) !== 0;
    this.readPressure(e);
  };

  private handlePointerUp = (e?: PointerEvent) => {
    if (e && e.pointerId !== undefined && e.pointerId !== this.activePointerId) return;
    if (this.ptr.down) {
      this.onStrokeEnd?.();
    }
    this.ptr.down = false;
    this.ptr.barrel = false;
    this.activePointerId = null;
  };

  private readPressure(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    if (e.pointerType === 'pen' || (e.pressure > 0 && Math.abs(e.pressure - 0.5) > 0.001)) {
      this.ptr.force = e.pressure;
      this.ptr.hasForce = true;
      this.ptr.forceT = performance.now();
    }
  }

  private bindEvents(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.handlePointerDown);
    c.addEventListener('pointermove', this.handlePointerMove);
    c.addEventListener('pointerup', this.handlePointerUp);
    c.addEventListener('pointercancel', this.handlePointerUp);
    c.addEventListener('pointerleave', () => { this.ptr.inWindow = false; });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private pressureNow(): number {
    if (this.ptr.type === 'touch') return this.ptr.simP;
    if (this.ptr.hasForce && performance.now() - this.ptr.forceT < 3000) return this.ptr.force;
    return this.ptr.simP;
  }

  private sizeMult(): number {
    return Math.pow(3, (this.params.size - 0.5) * 2);
  }

  private penRadius(pr: number, speed: number): number {
    return (0.0016 + 0.0042 * pr) * Math.min(Math.max(1.12 - speed * 0.3, 0.55), 1.12) * this.sizeMult();
  }

  private brushRadius(pr: number, speed: number): number {
    return (0.014 + 0.06 * pr) * (1 + Math.min(speed, 2.5) * 0.28) * this.sizeMult();
  }

  private inkColor(dens: number): number[] {
    if (this.params.toolMode === 'white') {
      return [0, 0, 0, dens];
    }
    return [this.inkAbs[0] * dens, this.inkAbs[1] * dens, this.inkAbs[2] * dens, 0];
  }

  /**
   * 运笔动力学计算
   */
  public updateBrush(dt: number): void {
    this.brushNow.r = 0;
    const k = 1 - Math.exp(-dt * 14);
    const px = this.ptr.bx;
    const py = this.ptr.by;
    this.ptr.bx += (this.ptr.tx - this.ptr.bx) * k;
    this.ptr.by += (this.ptr.ty - this.ptr.by) * k;
    const dx = this.ptr.bx - px;
    const dy = this.ptr.by - py;
    const dist = Math.hypot(dx, dy);
    const inst = dist / Math.max(dt, 1e-4);
    this.ptr.speed += (inst - this.ptr.speed) * (1 - Math.exp(-dt * 10));

    const targetP = Math.min(Math.max(1.18 - this.ptr.speed * 0.95, 0.12), 1.0);
    this.ptr.simP += (targetP - this.ptr.simP) * (1 - Math.exp(-dt * 6));

    if (!this.ptr.down) return;

    const pr = this.pressureNow();
    const speed = this.ptr.speed;
    const effectiveMode = this.ptr.barrel
      ? (this.params.toolMode === 'pen' ? 'brush' : 'pen')
      : this.params.toolMode;

    if (effectiveMode === 'pen' || effectiveMode === 'white') {
      const radius = this.penRadius(pr, speed);
      const dens = (0.55 + 1.05 * pr) * Math.min(Math.max(1.25 - speed * 0.45, 0.6), 1.25);
      if (dist < radius * 0.4) {
        this.splat(this.ink, this.ptr.bx, this.ptr.by, radius * 1.15, this.inkColor(dens * dt * 4), false);
        this.splat(this.wet, this.ptr.bx, this.ptr.by, radius * 2.8, [0.16, 0, 0, 0], true);
        return;
      }
      const spacing = radius * 0.6;
      const steps = Math.min(Math.ceil(dist / spacing), 60);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = px + dx * t;
        const y = py + dy * t;
        this.splat(this.ink, x, y, radius, this.inkColor(dens), false);
        if (i % 2 === 0 || steps === 1) {
          this.splat(this.wet, x, y, radius * 2.8, [0.16, 0, 0, 0], true);
        }
      }
    } else {
      // 运水毛笔
      const radius = this.brushRadius(pr, speed);
      this.brushNow.x = this.ptr.bx;
      this.brushNow.y = this.ptr.by;
      this.brushNow.r = radius;
      const wAmp = 0.5 + 0.5 * pr;
      const force = 15 + this.params.flow * 95;
      const vmax = 240;
      let vx = (dx / Math.max(dt, 1e-4)) * force;
      let vy = (dy / Math.max(dt, 1e-4)) * force;
      const vm = Math.hypot(vx, vy);
      if (vm > vmax) {
        vx *= vmax / vm;
        vy *= vmax / vm;
      }
      const bdens = this.params.bink * 0.1 * (0.4 + 0.6 * pr);

      if (dist < radius * 0.25) {
        this.splat(this.wet, this.ptr.bx, this.ptr.by, radius, [wAmp, 0, 0, 0], true);
        const a = Math.random() * Math.PI * 2;
        const jm = (6 + 26 * this.params.flow) * pr;
        this.splat(this.velocity, this.ptr.bx, this.ptr.by, radius * 0.9, [Math.cos(a) * jm, Math.sin(a) * jm, 0, 0], false);
        if (bdens > 0) {
          this.splat(this.ink, this.ptr.bx, this.ptr.by, radius * 0.8, this.inkColor(bdens * dt * 5), false);
        }
        return;
      }
      const spacing = radius * 0.7;
      const steps = Math.min(Math.ceil(dist / spacing), 12);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = px + dx * t;
        const y = py + dy * t;
        this.splat(this.wet, x, y, radius, [wAmp, 0, 0, 0], true);
        this.splat(this.velocity, x, y, radius * 1.15, [vx, vy, 0, 0], false);
        if (bdens > 0) {
          this.splat(this.ink, x, y, radius * 0.8, this.inkColor(bdens), false);
        }
      }
    }
  }

  /**
   * 编程式运笔绘制一条连续轨迹（供意境配方算法与图片转译使用）
   */
  public drawStroke(
    points: Array<[number, number] | { x: number; y: number; pr?: number }>,
    mode: InkWashToolMode = 'pen',
    sizeScale = 1.0,
    options: { wetness?: number; speed?: number; stirWater?: boolean } = {}
  ): void {
    if (points.length === 0) return;
    const normalizePt = (p: [number, number] | { x: number; y: number; pr?: number }) => {
      if (Array.isArray(p)) return { x: p[0], y: p[1], pr: 0.5 };
      return { x: p.x, y: p.y, pr: p.pr ?? 0.5 };
    };

    const first = normalizePt(points[0]);
    let prevX = first.x;
    let prevY = first.y;

    for (let i = 1; i < points.length; i++) {
      const pt = normalizePt(points[i]);
      const dx = pt.x - prevX;
      const dy = pt.y - prevY;
      const dist = Math.hypot(dx, dy);
      const pr = pt.pr;
      const speed = options.speed ?? 0.3;

      if (mode === 'pen' || mode === 'white') {
        const radius = this.penRadius(pr, speed) * sizeScale;
        const dens = (0.55 + 1.05 * pr) * (mode === 'white' ? 1.0 : 1.0);
        const spacing = Math.max(radius * 0.5, 0.002);
        const steps = Math.min(Math.ceil(dist / spacing), 80);
        for (let s = 0; s <= steps; s++) {
          const t = steps === 0 ? 0 : s / steps;
          const x = prevX + dx * t;
          const y = prevY + dy * t;
          const col = mode === 'white' ? [0, 0, 0, dens] : [this.inkAbs[0] * dens, this.inkAbs[1] * dens, this.inkAbs[2] * dens, 0];
          this.splat(this.ink, x, y, radius, col, false);
          if (s % 2 === 0 || steps === 0) {
            const wetAmp = options.wetness ?? 0.16;
            this.splat(this.wet, x, y, radius * 2.6, [wetAmp, 0, 0, 0], true);
          }
        }
      } else {
        const radius = this.brushRadius(pr, speed) * sizeScale;
        const spacing = Math.max(radius * 0.6, 0.005);
        const steps = Math.min(Math.ceil(dist / spacing), 25);
        const wAmp = (options.wetness ?? 0.5) * (0.6 + 0.4 * pr);
        const bdens = (this.params.bink + 0.08) * 0.15 * pr;
        // 温和自然的流场扰动，避免过高单向流速冲垮画作
        const force = 6 + this.params.flow * 22;
        const maxV = 28;
        let vx = (dx / Math.max(dist, 1e-4)) * force;
        let vy = (dy / Math.max(dist, 1e-4)) * force;
        const vm = Math.hypot(vx, vy);
        if (vm > maxV) {
          vx = (vx / vm) * maxV;
          vy = (vy / vm) * maxV;
        }

        for (let s = 0; s <= steps; s++) {
          const t = steps === 0 ? 0 : s / steps;
          const x = prevX + dx * t;
          const y = prevY + dy * t;
          this.splat(this.wet, x, y, radius, [wAmp, 0, 0, 0], true);
          if (options.stirWater !== false) {
            this.splat(this.velocity, x, y, radius * 1.1, [vx, vy, 0, 0], false);
          }
          if (bdens > 0) {
            this.splat(this.ink, x, y, radius * 0.85, [this.inkAbs[0] * bdens, this.inkAbs[1] * bdens, this.inkAbs[2] * bdens, 0], false);
          }
        }
      }
      prevX = pt.x;
      prevY = pt.y;
    }
  }

  /**
   * 物理流体动力学推进单步
   */
  public step(dt: number): void {
    const gl = this.gl;
    const fixing = this.fixTimer > 0;
    if (fixing) this.fixTimer -= dt;

    // 1. 速度平流
    this.progAdvVel.bind();
    gl.uniform1i(this.progAdvVel.u.uVelocity, this.velocity.read.attach(0));
    gl.uniform1i(this.progAdvVel.u.uWet, this.wet.read.attach(1));
    gl.uniform2f(this.progAdvVel.u.uTexel, this.velocity.texel[0], this.velocity.texel[1]);
    gl.uniform1f(this.progAdvVel.u.uDt, dt);
    gl.uniform1f(
      this.progAdvVel.u.uDissipation,
      Math.exp(-dt * (4.2 - this.params.flow * 2.5)) * (fixing ? Math.exp(-dt * 8) : 1)
    );
    this.blit(this.velocity.write);
    this.velocity.swap();

    // 2. 旋度与涡度限制
    this.progCurl.bind();
    gl.uniform1i(this.progCurl.u.uVelocity, this.velocity.read.attach(0));
    gl.uniform2f(this.progCurl.u.uTexel, this.velocity.texel[0], this.velocity.texel[1]);
    this.blit(this.curl);

    this.progVort.bind();
    gl.uniform1i(this.progVort.u.uVelocity, this.velocity.read.attach(0));
    gl.uniform1i(this.progVort.u.uCurl, this.curl.attach(1));
    gl.uniform2f(this.progVort.u.uTexel, this.velocity.texel[0], this.velocity.texel[1]);
    gl.uniform1f(this.progVort.u.uCurlAmt, 4 + this.params.flow * 22);
    gl.uniform1f(this.progVort.u.uDt, dt);
    this.blit(this.velocity.write);
    this.velocity.swap();

    // 3. 散度与压力求解
    this.progDiv.bind();
    gl.uniform1i(this.progDiv.u.uVelocity, this.velocity.read.attach(0));
    gl.uniform2f(this.progDiv.u.uTexel, this.velocity.texel[0], this.velocity.texel[1]);
    this.blit(this.divergence);

    this.progCopy.bind();
    gl.uniform1i(this.progCopy.u.uTex, this.pressure.read.attach(0));
    gl.uniform1f(this.progCopy.u.uValue, 0.8);
    this.blit(this.pressure.write);
    this.pressure.swap();

    this.progPressure.bind();
    gl.uniform1i(this.progPressure.u.uDivergence, this.divergence.attach(1));
    gl.uniform2f(this.progPressure.u.uTexel, this.velocity.texel[0], this.velocity.texel[1]);
    for (let i = 0; i < 22; i++) {
      gl.uniform1i(this.progPressure.u.uPressure, this.pressure.read.attach(0));
      this.blit(this.pressure.write);
      this.pressure.swap();
    }

    this.progGradSub.bind();
    gl.uniform1i(this.progGradSub.u.uPressure, this.pressure.read.attach(0));
    gl.uniform1i(this.progGradSub.u.uVelocity, this.velocity.read.attach(1));
    gl.uniform2f(this.progGradSub.u.uTexel, this.velocity.texel[0], this.velocity.texel[1]);
    this.blit(this.velocity.write);
    this.velocity.swap();

    // 4. 水分扩散与蒸发干燥
    const dryTau = fixing ? 0.25 : 2 + (1 - this.params.dry) * 16;
    this.progAdvWet.bind();
    gl.uniform1i(this.progAdvWet.u.uVelocity, this.velocity.read.attach(0));
    gl.uniform1i(this.progAdvWet.u.uWet, this.wet.read.attach(1));
    gl.uniform2f(this.progAdvWet.u.uTexel, this.velocity.texel[0], this.velocity.texel[1]);
    gl.uniform2f(this.progAdvWet.u.uSrcTexel, this.wet.texel[0], this.wet.texel[1]);
    gl.uniform1f(this.progAdvWet.u.uDt, dt);
    gl.uniform1f(this.progAdvWet.u.uDecay, Math.exp(-dt / dryTau));
    gl.uniform1f(this.progAdvWet.u.uSpread, 0.12);
    this.blit(this.wet.write);
    this.wet.swap();

    // 5. 墨色渗化与色散平流
    const C = this.params.color;
    this.progAdvInk.bind();
    gl.uniform1i(this.progAdvInk.u.uVelocity, this.velocity.read.attach(0));
    gl.uniform1i(this.progAdvInk.u.uSource, this.ink.read.attach(1));
    gl.uniform1i(this.progAdvInk.u.uWet, this.wet.read.attach(2));
    gl.uniform2f(this.progAdvInk.u.uTexel, this.velocity.texel[0], this.velocity.texel[1]);
    gl.uniform2f(this.progAdvInk.u.uSrcTexel, this.ink.texel[0], this.ink.texel[1]);
    gl.uniform1f(this.progAdvInk.u.uDt, dt);
    gl.uniform1f(this.progAdvInk.u.uBleed, this.params.bleed);
    gl.uniform1f(this.progAdvInk.u.uAspect, this.canvas.width / this.canvas.height);
    gl.uniform3f(this.progAdvInk.u.uChroma, 1.0 + 0.85 * C, 1.0 + 0.15 * C, Math.max(0.25, 1.0 - 0.65 * C));
    gl.uniform3f(this.progAdvInk.u.uBrush, this.brushNow.x, this.brushNow.y, this.brushNow.r);
    this.blit(this.ink.write);
    this.ink.swap();

    // 6. 定墨沉积
    const settle = fixing ? 1 - Math.exp(-dt * 5) : 0;
    this.progExchange.bind();
    gl.uniform1i(this.progExchange.u.uFixed, this.fixed.read.attach(0));
    gl.uniform1i(this.progExchange.u.uInk, this.ink.read.attach(1));
    gl.uniform1i(this.progExchange.u.uWet, this.wet.read.attach(2));
    gl.uniform1f(this.progExchange.u.uSettle, settle);
    gl.uniform1f(this.progExchange.u.uDt, dt);
    gl.uniform1f(this.progExchange.u.uAspect, this.canvas.width / this.canvas.height);
    gl.uniform3f(this.progExchange.u.uBrush, this.brushNow.x, this.brushNow.y, this.brushNow.r);
    gl.uniform1f(this.progExchange.u.uMode, 0);
    this.blit(this.fixed.write);
    gl.uniform1f(this.progExchange.u.uMode, 1);
    this.blit(this.ink.write);
    this.fixed.swap();
    this.ink.swap();
  }

  /** 获取宣纸底色对应的 RGB */
  private getPaperColorRgb(style: InkWashPaperStyle): [number, number, number] {
    switch (style) {
      case 'raw_xuan':
        return [0.962, 0.954, 0.93]; // 生宣暖白
      case 'sized_xuan':
        return [0.975, 0.97, 0.955]; // 熟宣柔白
      case 'antique_silk':
        return [0.885, 0.825, 0.72]; // 仿古绢金
      case 'pure_white':
        return [0.995, 0.995, 0.995]; // 澄心雪白
      case 'transparent':
      default:
        return [0.962, 0.954, 0.93];
    }
  }

  /**
   * 最终合成渲染输出至屏幕或默认帧缓冲
   */
  public render(target: FBO | null = null): void {
    const gl = this.gl;
    const paperRgb = this.getPaperColorRgb(this.params.paperStyle);
    const isTransparent = this.params.paperStyle === 'transparent' ? 1.0 : 0.0;

    this.progDisplay.bind();
    gl.uniform1i(this.progDisplay.u.uInk, this.ink.read.attach(0));
    gl.uniform1i(this.progDisplay.u.uWet, this.wet.read.attach(1));
    gl.uniform1i(this.progDisplay.u.uFixed, this.fixed.read.attach(2));
    gl.uniform2f(this.progDisplay.u.uTexel, this.ink.texel[0], this.ink.texel[1]);
    gl.uniform2f(this.progDisplay.u.uRes, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height);
    gl.uniform1f(this.progDisplay.u.uInkStrength, 1.9);
    gl.uniform1f(this.progDisplay.u.uEdge, 1.35);
    gl.uniform1f(this.progDisplay.u.uGrain, 0.55);
    gl.uniform1f(this.progDisplay.u.uWhiteTint, this.params.color * 0.35);
    gl.uniform3f(this.progDisplay.u.uPaperColor, paperRgb[0], paperRgb[1], paperRgb[2]);
    gl.uniform1f(this.progDisplay.u.uTransparent, isTransparent);
    this.blit(target);
  }

  /** 帧循环 */
  private startLoop(): void {
    const loop = (now: number) => {
      if (this.isDisposed) return;
      const dt = Math.min((now - this.lastT) / 1000, 1 / 30) || 1 / 60;
      this.lastT = now;

      this.updateBrush(dt);
      this.step(dt);
      this.render();

      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  /** 定墨固化（将移动墨水烘干沉淀进宣纸） */
  public fix(): void {
    this.fixTimer = 1.2;
  }

  /** 澄心洗纸（清空画布） */
  public clear(): void {
    const gl = this.gl;
    for (const d of [this.velocity, this.pressure, this.ink, this.fixed, this.wet]) {
      for (const f of [d.read, d.write]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    }
  }

  /** 动态更新参数 */
  public updateParams(newParams: Partial<InkWashState>): void {
    this.params = { ...this.params, ...newParams };
    if (newParams.inkColor) {
      this.inkAbs = hexToInkAbsorption(this.params.inkColor);
    }
  }

  /** 导出当前图像数据为 PNG DataURL */
  public toDataUrl(): string {
    this.render();
    return this.canvas.toDataURL('image/png');
  }

  /** 销毁会话释放资源 */
  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.handlePointerDown);
    c.removeEventListener('pointermove', this.handlePointerMove);
    c.removeEventListener('pointerup', this.handlePointerUp);
    c.removeEventListener('pointercancel', this.handlePointerUp);

    // 缩小 canvas 释放显存
    this.canvas.width = 1;
    this.canvas.height = 1;
  }
}

/**
 * 一次性高保真水墨渲染导出管线（用于点击「生成水墨」时导出高清图）
 */
export async function renderInkWashArt(
  params: InkWashState,
  generatorFn?: (session: InkWashSession) => Promise<void> | void,
  exportWidth?: number,
  exportHeight?: number
): Promise<InkWashRenderResult> {
  const baseSize = params.resolution || 1024;
  const dims = getInkWashDimensions(params.aspectRatio || '1:1', baseSize);
  const w = exportWidth || dims.width;
  const h = exportHeight || dims.height;

  const session = await InkWashSession.create({
    params,
    width: w,
    height: h,
  });

  if (generatorFn) {
    await generatorFn(session);
  }

  // 充分推进流体物理模拟若干步以达到浸润晕化平衡
  const dt = 1 / 60;
  for (let i = 0; i < 45; i++) {
    session.step(dt);
  }
  session.fix();
  for (let i = 0; i < 30; i++) {
    session.step(dt);
  }

  session.render();
  const dataUrl = session.toDataUrl();
  session.dispose();

  return {
    dataUrl,
    width: w,
    height: h,
  };
}
