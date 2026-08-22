/**
 * 湿油彩效果 headless 渲染引擎
 *
 * 管线移植自 docs/多模态工具/油画/wet-paint-flow-main/main.js（MIT License）：
 * 结构张量方向场分析 → Poisson 圆盘三层播种 → 双向 Bézier 笔触积分
 * → 实例化 ribbon 笔触几何 → 颜料高度/湿度缓冲 → 湿油彩微表面合成。
 * 仅保留「图片输入」路径：离屏 WebGL 单帧渲染输出 PNG Data URL；
 * renderer/材质为模块级单例（避免 WebGL 上下文耗尽），three 经动态 import 按需加载。
 */
import type * as ThreeNS from 'three';
import {
  WET_PAINT_DEFAULT_PARAMS,
  type WetPaintParams,
  type OilPaintStyle,
  type WetPaintRenderOptions,
} from './types';

/* ---------- 常量（源项目口径） ---------- */

/** 生长动画总时长（秒）；headless 单帧导出直接取完成态 */
const GROWTH_DURATION = 5;
/** 图片哑光内缩比例（画面四周留出细边） */
const IMAGE_MATTE_SCALE = 0.982;
/** 每支笔触双向积分步数 */
const STROKE_TRACE_STEPS = 10;
/** 静态导出的环境光角度（与源项目 movingLight=false 路径一致） */
const LIGHT_ANGLE = -0.8;

/* ---------- 数学工具（源项目逐字移植） ---------- */

function fract(value: number): number {
  return value - Math.floor(value);
}

function hash(value: number): number {
  return fract(Math.sin(value * 91.173 + 17.371) * 43758.5453);
}

function lineBlend3(
  angleA: number,
  weightA: number,
  angleB: number,
  weightB: number,
  angleC: number,
  weightC: number,
): number {
  const x = Math.cos(angleA * 2) * weightA
    + Math.cos(angleB * 2) * weightB
    + Math.cos(angleC * 2) * weightC;
  const y = Math.sin(angleA * 2) * weightA
    + Math.sin(angleB * 2) * weightB
    + Math.sin(angleC * 2) * weightC;
  return Math.atan2(y, x) * 0.5;
}

/* ---------- 着色器（源项目逐字移植，仅图片输入路径） ---------- */

const UPLOADED_VERTEX = /* glsl */ `
  varying vec2 vUv;
  uniform vec2 uScale;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy * uScale, 0.0, 1.0);
  }
`;

// 三通道 g-buffer：pass0 颜色 / pass1 语义(IMAGE=6) / pass2 法线占位
const UPLOADED_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uImage;
  uniform int uPass;
  void main() {
    vec4 source = texture2D(uImage, vUv);
    if (source.a < 0.035) discard;
    if (uPass == 1) {
      gl_FragColor = vec4(6.0 / 255.0, 0.0, 0.0, 1.0);
      return;
    }
    if (uPass == 2) {
      gl_FragColor = vec4(0.5, 0.5, 1.0, 0.5);
      return;
    }
    gl_FragColor = vec4(source.rgb, 1.0);
  }
`;

const STROKE_VERTEX = /* glsl */ `
  attribute vec2 aP0;
  attribute vec2 aP1;
  attribute vec2 aP2;
  attribute vec2 aP3;
  attribute vec3 aColor;
  attribute float aWidth;
  attribute float aSeed;
  attribute float aBirth;
  attribute float aDuration;
  attribute float aBrushLayer;
  uniform vec2 uResolution;
  uniform float uStrokeScale;
  uniform float uBrushSize;
  uniform float uGrowthTime;
  uniform float uGrowthEnabled;
  uniform vec3 uBrushLayerVisibility;
  varying vec3 vColor;
  varying float vSide;
  varying float vT;
  varying float vSeed;
  varying float vGrowth;
  varying float vFreshness;
  varying float vBrushLayerVisible;

  vec2 bezier(float t) {
    float s = 1.0 - t;
    return s*s*s*aP0 + 3.0*s*s*t*aP1 + 3.0*s*t*t*aP2 + t*t*t*aP3;
  }

  void main() {
    float t = position.x;
    float side = position.y;
    vec2 center = bezier(t);
    vec2 before = bezier(max(0.0, t - 0.012));
    vec2 after = bezier(min(1.0, t + 0.012));
    vec2 tangentPx = normalize((after - before) * uResolution);
    vec2 normalPx = vec2(-tangentPx.y, tangentPx.x);
    float pressure = 0.44 + 0.56 * pow(max(0.0, sin(t * 3.14159265)), 0.42);
    float wobble = sin(t * 15.0 + aSeed * 43.0) * 0.032
      + sin(t * 38.0 + aSeed * 19.0) * 0.012;
    vec2 uv = center + normalPx * aWidth * uStrokeScale * uBrushSize * (side * pressure + wobble) / uResolution;
    gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
    vColor = aColor;
    vSide = side;
    vT = t;
    vSeed = aSeed;
    vGrowth = uGrowthEnabled > 0.5
      ? clamp((uGrowthTime - aBirth) / max(0.05, aDuration), 0.0, 1.0)
      : 1.0;
    vBrushLayerVisible = aBrushLayer < 0.5
      ? uBrushLayerVisibility.x
      : (aBrushLayer < 1.5 ? uBrushLayerVisibility.y : uBrushLayerVisibility.z);
    float wetAge = max(0.0, uGrowthTime - aBirth);
    vFreshness = exp(-wetAge * 0.12);
  }
`;

const STROKE_FRAGMENT = /* glsl */ `
  uniform float uCoverage;
  uniform float uWetness;
  uniform float uViscosity;
  uniform float uBristleDetail;
  varying vec3 vColor;
  varying float vSide;
  varying float vT;
  varying float vSeed;
  varying float vGrowth;
  varying float vFreshness;
  varying float vBrushLayerVisible;

  float noise(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    if (vBrushLayerVisible < 0.5) discard;
    if (fract(vSeed * 17.713) > uCoverage) discard;
    if (vT > vGrowth) discard;
    float edge = 1.0 - smoothstep(0.76, 1.0, abs(vSide));
    float tips = smoothstep(0.0, 0.025, vT) * (1.0 - smoothstep(0.95, 1.0, vT));
    float liveTip = 1.0 - smoothstep(max(0.0, vGrowth - 0.08), max(0.001, vGrowth), vT);
    float fibers = 0.5 + 0.5 * sin(
      vSide * (20.0 + uBristleDetail * 9.0) +
      sin(vT * 24.0 + vSeed * 17.0) * 1.7 +
      vSeed * 67.0
    );
    float microFibers = 0.5 + 0.5 * sin(vSide * 61.0 - vT * 9.0 + vSeed * 101.0);
    float splitFibers = smoothstep(0.18, 0.84, fibers);
    float bristle = mix(1.0, 0.86 + splitFibers * 0.12 + microFibers * 0.035, uBristleDetail);
    float pigmentBreak = mix(
      0.955,
      1.0,
      noise(vec2(floor(vT * 72.0) + vSeed * 11.0, floor(vSide * 17.0)))
    );
    float edgePool = pow(1.0 - abs(vSide), 0.52);
    float cohesion = mix(0.84 + splitFibers * 0.16, 1.0, uViscosity);
    float alpha = edge * tips * liveTip * bristle * pigmentBreak * cohesion;
    vec3 pigment = vColor * (0.91 + splitFibers * 0.095 + microFibers * 0.025);
    pigment *= mix(0.94, mix(1.045, 1.12, uViscosity), edgePool);
    pigment += vec3(1.0, 0.82, 0.53) * vFreshness * uWetness * (0.018 + splitFibers * 0.012);
    gl_FragColor = vec4(pigment, alpha);
  }
`;

const HEIGHT_FRAGMENT = /* glsl */ `
  uniform float uCoverage;
  uniform float uWetness;
  uniform float uViscosity;
  uniform float uBristleDetail;
  varying vec3 vColor;
  varying float vSide;
  varying float vT;
  varying float vSeed;
  varying float vGrowth;
  varying float vFreshness;
  varying float vBrushLayerVisible;

  void main() {
    if (vBrushLayerVisible < 0.5) discard;
    if (fract(vSeed * 17.713) > uCoverage) discard;
    if (vT > vGrowth) discard;
    float edge = 1.0 - smoothstep(0.72, 1.0, abs(vSide));
    float tips = smoothstep(0.0, 0.025, vT) * (1.0 - smoothstep(0.95, 1.0, vT));
    float liveTip = 1.0 - smoothstep(max(0.0, vGrowth - 0.08), max(0.001, vGrowth), vT);
    float ridgeWave = 0.5 + 0.5 * sin(
      vSide * (20.0 + uBristleDetail * 9.0) + sin(vT * 23.0 + vSeed * 23.0) * 1.7 + vSeed * 67.0
    );
    float microRidge = 0.5 + 0.5 * sin(vSide * 61.0 - vT * 9.0 + vSeed * 101.0);
    float ridges = mix(0.74, 0.52 + pow(ridgeWave, 2.1) * 0.42 + microRidge * 0.08, uBristleDetail);
    float centralLoad = 0.7 + 0.3 * pow(max(0.0, 1.0 - abs(vSide)), 0.48);
    float body = edge * tips * liveTip;
    float height = body * ridges * centralLoad * mix(0.062, 0.108, uViscosity);
    float wet = body * uWetness * (0.62 + vFreshness * 0.38) * (0.038 + ridgeWave * 0.022);
    float furrow = body * (0.018 + ridgeWave * 0.052 + microRidge * 0.012);
    gl_FragColor = vec4(height, wet, furrow, 1.0);
  }
`;

const COMPOSITE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uScene;
  uniform sampler2D uStroke;
  uniform sampler2D uHeight;
  uniform sampler2D uSemantic;
  uniform vec2 uTexel;
  uniform int uMode;
  uniform float uImpasto;
  uniform float uWetness;
  uniform float uLightAngle;
  uniform float uTime;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  const float PI = 3.14159265359;

  float saturatePaint(float value) {
    return clamp(value, 0.0, 1.0);
  }

  float distributionGGX(float nDotH, float roughness) {
    float alpha = roughness * roughness;
    float alpha2 = alpha * alpha;
    float denominator = nDotH * nDotH * (alpha2 - 1.0) + 1.0;
    return alpha2 / max(PI * denominator * denominator, 0.0001);
  }

  float geometrySmith(float nDotV, float nDotL, float roughness) {
    float r = roughness + 1.0;
    float k = (r * r) * 0.125;
    float ggxV = nDotV / max(nDotV * (1.0 - k) + k, 0.0001);
    float ggxL = nDotL / max(nDotL * (1.0 - k) + k, 0.0001);
    return ggxV * ggxL;
  }

  float wetSpecular(vec3 normal, vec3 lightDirection, float roughness) {
    vec3 viewDirection = vec3(0.0, 0.0, 1.0);
    vec3 halfVector = normalize(lightDirection + viewDirection);
    float nDotV = saturatePaint(dot(normal, viewDirection));
    float nDotL = saturatePaint(dot(normal, lightDirection));
    float nDotH = saturatePaint(dot(normal, halfVector));
    float vDotH = saturatePaint(dot(viewDirection, halfVector));
    float fresnel = 0.045 + (1.0 - 0.045) * pow(1.0 - vDotH, 5.0);
    float specular = distributionGGX(nDotH, roughness) *
      geometrySmith(nDotV, nDotL, roughness) * fresnel;
    return min(3.0, specular / max(4.0 * nDotV * nDotL, 0.001));
  }

  float paintHeight(vec2 uv) {
    return texture2D(uHeight, uv).r;
  }

  void main() {
    vec3 base = texture2D(uScene, vUv).rgb;
    vec4 stroke = texture2D(uStroke, vUv);
    vec4 paintState = texture2D(uHeight, vUv);
    float height = paintState.r;
    float wet = saturatePaint(paintState.g * 5.0) * saturatePaint(uWetness);
    float furrow = saturatePaint(paintState.b * 11.0);

    if (uMode == 3) {
      gl_FragColor = vec4(base, 1.0);
      #include <colorspace_fragment>
      return;
    }

    vec2 pixel = vUv / uTexel;
    float canvasGrain = hash(floor(pixel * 0.46));
    float fineGrain = hash(floor(pixel * 1.17) + 17.0);
    float warpFiber = sin(pixel.y * 1.33 + sin(pixel.x * 0.021) * 1.8);
    float weftFiber = sin(pixel.x * 1.21 + sin(pixel.y * 0.018) * 1.6);
    float canvasWeave = warpFiber * weftFiber;
    vec3 canvasBeige = vec3(0.835, 0.775, 0.665);
    canvasBeige *= 0.968 + canvasGrain * 0.028 + fineGrain * 0.014 + canvasWeave * 0.009;
    if (uMode == 5) base = canvasBeige;

    float hTL = paintHeight(vUv + vec2(-uTexel.x, uTexel.y));
    float hT = paintHeight(vUv + vec2(0.0, uTexel.y));
    float hTR = paintHeight(vUv + vec2(uTexel.x, uTexel.y));
    float hL = paintHeight(vUv - vec2(uTexel.x, 0.0));
    float hR = paintHeight(vUv + vec2(uTexel.x, 0.0));
    float hBL = paintHeight(vUv + vec2(-uTexel.x, -uTexel.y));
    float hB = paintHeight(vUv - vec2(0.0, uTexel.y));
    float hBR = paintHeight(vUv + vec2(uTexel.x, -uTexel.y));
    vec2 gradient = vec2(
      hTL + 2.0 * hL + hBL - hTR - 2.0 * hR - hBR,
      hBL + 2.0 * hB + hBR - hTL - 2.0 * hT - hTR
    );
    vec3 paintNormal = normalize(vec3(
      gradient * (4.0 + uImpasto * 6.0),
      mix(1.08, 0.72, saturatePaint(uImpasto))
    ));
    vec3 lightDir = normalize(vec3(cos(uLightAngle), sin(uLightAngle), 0.72));
    float nDotL = saturatePaint(dot(paintNormal, lightDir));
    float diffuse = mix(0.78, 1.16, nDotL);
    float roughness = mix(0.44, 0.11, wet);
    float specular = wetSpecular(paintNormal, lightDir, roughness);
    vec3 halfDir = normalize(lightDir + vec3(0.0, 0.0, 1.0));
    float clearcoat = pow(saturatePaint(dot(paintNormal, halfDir)), mix(5.0, 13.0, wet));

    vec3 pigment = stroke.rgb / max(stroke.a, 0.065);
    pigment = clamp(pigment, vec3(0.0), vec3(1.45));
    float localPeak = max(max(max(hL, hR), max(hT, hB)), height);
    float pooledEdge = saturatePaint((localPeak - height) * 3.8);
    float ridgeCatch = saturatePaint(length(gradient) * 13.0 + pooledEdge * 0.7 + furrow * 0.3);
    pigment *= mix(0.91, 1.13, furrow);
    pigment *= 1.0 - pooledEdge * wet * 0.11;

    float layerOpacity = uMode == 0 ? 0.62 : 1.0;
    vec3 color = mix(base, pigment * diffuse, smoothstep(0.015, 0.78, stroke.a * 1.18) * layerOpacity);
    float paintMask = smoothstep(0.003, 0.055, height + stroke.a * 0.12);
    float grazingSheen = pow(1.0 - saturatePaint(paintNormal.z), 2.0) * wet;
    color += vec3(1.0, 0.9, 0.7) * (
      specular * 0.78 + clearcoat * wet * (0.18 + ridgeCatch * 0.82) + grazingSheen * 0.075
    ) * paintMask * (0.34 + uImpasto * 0.32) * layerOpacity;
    color += vec3(0.58, 0.34, 0.12) * pooledEdge * wet * stroke.a * 0.075 * layerOpacity;
    color -= vec3(0.065, 0.05, 0.032) * saturatePaint(-dot(paintNormal.xy, lightDir.xy)) * height * uImpasto * layerOpacity;
    color *= 0.987 + canvasGrain * 0.017 + fineGrain * 0.008;
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;


/* ---------- 引擎上下文（每会话独立：独立 canvas/renderer/材质/场景，互不串状态） ---------- */

interface WetPaintContext {
  THREE: typeof ThreeNS;
  renderer: ThreeNS.WebGLRenderer;
  uploadedMaterial: ThreeNS.ShaderMaterial;
  strokeMaterial: ThreeNS.ShaderMaterial;
  heightMaterial: ThreeNS.ShaderMaterial;
  compositeMaterial: ThreeNS.ShaderMaterial;
  uploadedScene: ThreeNS.Scene;
  uploadedCamera: ThreeNS.OrthographicCamera;
  overlayScene: ThreeNS.Scene;
  overlayCamera: ThreeNS.OrthographicCamera;
  screenScene: ThreeNS.Scene;
  screenCamera: ThreeNS.OrthographicCamera;
}

/** three 经动态 import 仅加载一次（模块级缓存）；各会话共享模块、独享 GL 上下文避免互相干扰 */
let threePromise: Promise<typeof ThreeNS> | null = null;

/** 会话上下文：独立 canvas/WebGLRenderer/材质/场景，一个会话对应一个画板节点 */
async function createContext(): Promise<WetPaintContext> {
  threePromise ??= import('three');
  const THREE = await threePromise;
  let renderer: ThreeNS.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
  } catch {
    throw new Error('当前浏览器不支持 WebGL，无法生成湿油彩效果');
  }
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const uploadedMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uImage: { value: null },
      uPass: { value: 0 },
      uScale: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: UPLOADED_VERTEX,
    fragmentShader: UPLOADED_FRAGMENT,
  });

  const strokeUniforms = () => ({
    uResolution: { value: new THREE.Vector2(1, 1) },
    uStrokeScale: { value: 1 },
    uBrushSize: { value: 1 },
    uCoverage: { value: 0.99 },
    uWetness: { value: 0.31 },
    uViscosity: { value: 0.58 },
    uBristleDetail: { value: 0.82 },
    uGrowthTime: { value: GROWTH_DURATION },
    uGrowthEnabled: { value: 0 },
    uBrushLayerVisibility: { value: new THREE.Vector3(1, 1, 1) },
  });

  const strokeMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: STROKE_VERTEX,
    fragmentShader: STROKE_FRAGMENT,
    uniforms: strokeUniforms(),
  });

  const heightMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: STROKE_VERTEX,
    fragmentShader: HEIGHT_FRAGMENT,
    uniforms: strokeUniforms(),
  });

  const compositeMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uScene: { value: null },
      uStroke: { value: null },
      uHeight: { value: null },
      uSemantic: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uMode: { value: 5 },
      uImpasto: { value: 0.04 },
      uWetness: { value: 0.31 },
      uLightAngle: { value: LIGHT_ANGLE },
      uTime: { value: 0 },
    },
    vertexShader: COMPOSITE_VERTEX,
    fragmentShader: COMPOSITE_FRAGMENT,
  });

  const uploadedScene = new THREE.Scene();
  const uploadedCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  uploadedScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), uploadedMaterial));

  const overlayScene = new THREE.Scene();
  const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const screenScene = new THREE.Scene();
  const screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  screenScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMaterial));

  return {
    THREE,
    renderer,
    uploadedMaterial,
    strokeMaterial,
    heightMaterial,
    compositeMaterial,
    uploadedScene,
    uploadedCamera,
    overlayScene,
    overlayCamera,
    screenScene,
    screenCamera,
  };
}

/* ---------- 默认输出最长边（源项目导出上限 4096；节点预览取 2048 平衡清晰度与体积） ---------- */

const DEFAULT_MAX_EDGE = 2048;

/* ---------- 图片与渲染目标工具 ---------- */

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败，请检查图片地址'));
    img.src = src;
  });
}

function limitImageSize(
  img: HTMLImageElement,
  cap: number,
): HTMLImageElement | HTMLCanvasElement {
  const sourceWidth = img.naturalWidth || img.width;
  const sourceHeight = img.naturalHeight || img.height;
  const scale = Math.min(1, cap / Math.max(sourceWidth, sourceHeight));
  if (scale >= 0.999) return img;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('无法建立图片缩放画布');
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function makeSourceTexture(
  ctx: WetPaintContext,
  source: HTMLImageElement | HTMLCanvasElement,
): ThreeNS.Texture {
  const { THREE } = ctx;
  const texture = new THREE.Texture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

interface TargetOptions {
  nearest?: boolean;
  samples?: number;
  depth?: boolean;
}

function makeTarget(
  ctx: WetPaintContext,
  width: number,
  height: number,
  options: TargetOptions = {},
): ThreeNS.WebGLRenderTarget {
  const { THREE } = ctx;
  const filter = options.nearest ? THREE.NearestFilter : THREE.LinearFilter;
  const target = new THREE.WebGLRenderTarget(width, height, {
    minFilter: filter,
    magFilter: filter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: options.depth !== false,
    stencilBuffer: false,
  });
  target.samples = options.samples || 0;
  target.texture.colorSpace = THREE.NoColorSpace;
  return target;
}

function fitUploadedQuad(ctx: WetPaintContext, targetAspect: number, imageAspect: number): void {
  const scale = ctx.uploadedMaterial.uniforms.uScale.value as ThreeNS.Vector2;
  if (imageAspect >= targetAspect) {
    scale.set(1, targetAspect / imageAspect);
  } else {
    scale.set(imageAspect / targetAspect, 1);
  }
  scale.multiplyScalar(IMAGE_MATTE_SCALE);
}

function renderUploadedTo(
  ctx: WetPaintContext,
  target: ThreeNS.WebGLRenderTarget,
  pass: number,
  texture: ThreeNS.Texture,
  imageAspect: number,
): void {
  fitUploadedQuad(ctx, target.width / Math.max(1, target.height), imageAspect);
  ctx.uploadedMaterial.uniforms.uImage.value = texture;
  ctx.uploadedMaterial.uniforms.uPass.value = pass;
  const renderer = ctx.renderer;
  renderer.setRenderTarget(target);
  renderer.setViewport(0, 0, target.width, target.height);
  if (pass === 1) renderer.setClearColor(0x000000, 1);
  else if (pass === 2) renderer.setClearColor(0x8080ff, 1);
  else renderer.setClearColor(0xe5dac5, 1);
  renderer.clear(true, true, true);
  renderer.render(ctx.uploadedScene, ctx.uploadedCamera);
}

/* ---------- 会话状态 ---------- */

interface SeedPoint {
  x: number;
  y: number;
  semantic: number;
  layer: number;
  random: number;
  color: ThreeNS.Color;
}

/**
 * 会话可变状态。g-buffer / 方向场 / 几何在参数更新时按失效级别增量重建：
 * - 仅 uniform 参数（大小/干燥度/黏度/覆盖率/厚度）→ 直接重绘笔触层 + 合成
 * - length → 重积分笔触（几何）
 * - structure/geometry/semantic → 重建方向场 + 重积分（保留播种位置）
 * - strokeCountK → 重新播种 + 重建几何
 */
interface WetPaintState {
  ctx: WetPaintContext;
  params: WetPaintParams;
  style: OilPaintStyle;
  variant: number;
  outW: number;
  outH: number;
  aw: number;
  ah: number;
  imageAspect: number;
  texture: ThreeNS.Texture;
  sceneTarget: ThreeNS.WebGLRenderTarget;
  colorTarget: ThreeNS.WebGLRenderTarget;
  normalTarget: ThreeNS.WebGLRenderTarget;
  semanticTarget: ThreeNS.WebGLRenderTarget;
  strokeTarget: ThreeNS.WebGLRenderTarget;
  heightTarget: ThreeNS.WebGLRenderTarget;
  colorBuf: Uint8Array;
  normalDepthBuf: Uint8Array;
  semanticBuf: Uint8Array;
  angle: Float32Array;
  confidence: Float32Array;
  seeds: SeedPoint[];
  geometry: ThreeNS.InstancedBufferGeometry | null;
  strokeMesh: ThreeNS.Mesh | null;
  disposed: boolean;
}

/* ---------- 缓冲/方向场采样助手 ---------- */

function semanticAt(s: WetPaintState, x: number, y: number): number {
  const ix = Math.max(0, Math.min(s.aw - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(s.ah - 1, Math.round(y)));
  return Math.round(s.semanticBuf[(iy * s.aw + ix) * 4] || 0);
}

function depthAt(s: WetPaintState, x: number, y: number): number {
  const ix = Math.max(0, Math.min(s.aw - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(s.ah - 1, Math.round(y)));
  return s.normalDepthBuf[(iy * s.aw + ix) * 4 + 3] / 255;
}

function colorPixelOffset(s: WetPaintState, x: number, y: number): number {
  const px = Math.max(0, Math.min(s.aw - 1, Math.round(x)));
  const py = Math.max(0, Math.min(s.ah - 1, Math.round(y)));
  return (py * s.aw + px) * 4;
}

function referenceColorDistance(
  s: WetPaintState,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const first = colorPixelOffset(s, x0, y0);
  const second = colorPixelOffset(s, x1, y1);
  const dr = (s.colorBuf[first] - s.colorBuf[second]) / 255;
  const dg = (s.colorBuf[first + 1] - s.colorBuf[second + 1]) / 255;
  const db = (s.colorBuf[first + 2] - s.colorBuf[second + 2]) / 255;
  return Math.sqrt(dr * dr * 0.24 + dg * dg * 0.56 + db * db * 0.2);
}

function sampleAngle(s: WetPaintState, x: number, y: number): number {
  const ix = Math.max(0, Math.min(s.aw - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(s.ah - 1, Math.round(y)));
  return s.angle[iy * s.aw + ix];
}

/* ---------- 管线阶段：仅在会话建立 / 高成本参数变化时执行 ---------- */

function captureGBuffer(s: WetPaintState): void {
  const { ctx } = s;
  renderUploadedTo(ctx, s.sceneTarget, 0, s.texture, s.imageAspect);
  renderUploadedTo(ctx, s.colorTarget, 0, s.texture, s.imageAspect);
  renderUploadedTo(ctx, s.normalTarget, 2, s.texture, s.imageAspect);
  renderUploadedTo(ctx, s.semanticTarget, 1, s.texture, s.imageAspect);
  ctx.renderer.readRenderTargetPixels(s.colorTarget, 0, 0, s.aw, s.ah, s.colorBuf);
  ctx.renderer.readRenderTargetPixels(s.normalTarget, 0, 0, s.aw, s.ah, s.normalDepthBuf);
  ctx.renderer.readRenderTargetPixels(s.semanticTarget, 0, 0, s.aw, s.ah, s.semanticBuf);
}

function buildField(s: WetPaintState): void {
  const { ctx } = s;
  const { params, aw, ah } = s;
  const images = new Float32Array(aw * ah);
  const count = aw * ah;
  for (let i = 0; i < count; i += 1) {
    const o = i * 4;
    images[i] = (
      s.colorBuf[o] * 0.2126
      + s.colorBuf[o + 1] * 0.7152
      + s.colorBuf[o + 2] * 0.0722
    ) / 255;
  }
  const sampleArray = (array: Float32Array, x: number, y: number): number =>
    array[Math.max(0, Math.min(ah - 1, y)) * aw + Math.max(0, Math.min(aw - 1, x))];
  const gx = new Float32Array(count);
  const gy = new Float32Array(count);
  for (let y = 0; y < ah; y += 1) {
    for (let x = 0; x < aw; x += 1) {
      const i = y * aw + x;
      gx[i] = sampleArray(images, x + 1, y) - sampleArray(images, x - 1, y);
      gy[i] = sampleArray(images, x, y + 1) - sampleArray(images, x, y - 1);
    }
  }
  const tensorXX = new Float32Array(count);
  const tensorYY = new Float32Array(count);
  const tensorXY = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    tensorXX[i] = gx[i] * gx[i];
    tensorYY[i] = gy[i] * gy[i];
    tensorXY[i] = gx[i] * gy[i];
  }
  const stride = aw + 1;
  const buildIntegral = (source: Float32Array): Float32Array => {
    const integral = new Float32Array((aw + 1) * (ah + 1));
    for (let y = 0; y < ah; y += 1) {
      let rowSum = 0;
      for (let x = 0; x < aw; x += 1) {
        rowSum += source[y * aw + x];
        integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
      }
    }
    return integral;
  };
  const integralXX = buildIntegral(tensorXX);
  const integralYY = buildIntegral(tensorYY);
  const integralXY = buildIntegral(tensorXY);
  const boxSum = (integral: Float32Array, x0: number, y0: number, x1: number, y1: number): number =>
    integral[y1 * stride + x1]
    - integral[y0 * stride + x1]
    - integral[y1 * stride + x0]
    + integral[y0 * stride + x0];

  const angle = new Float32Array(count);
  const confidence = new Float32Array(count);
  const tensorRadius = 2;
  for (let y = 0; y < ah; y += 1) {
    for (let x = 0; x < aw; x += 1) {
      const i = y * aw + x;
      const x0 = Math.max(0, x - tensorRadius);
      const y0 = Math.max(0, y - tensorRadius);
      const x1 = Math.min(aw, x + tensorRadius + 1);
      const y1 = Math.min(ah, y + tensorRadius + 1);
      const jxx = boxSum(integralXX, x0, y0, x1, y1);
      const jyy = boxSum(integralYY, x0, y0, x1, y1);
      const jxy = boxSum(integralXY, x0, y0, x1, y1);
      const trace = jxx + jyy;
      const discriminant = Math.sqrt(Math.max(0, (jxx - jyy) ** 2 + 4 * jxy * jxy));
      const imageConfidence = Math.min(1, discriminant / (trace + 0.0008));
      const imageAngle = 0.5 * Math.atan2(2 * jxy, jxx - jyy) + Math.PI * 0.5;

      if (!semanticAt(s, x, y)) {
        angle[i] = 0;
        confidence[i] = 0;
        continue;
      }
      const nx = x / Math.max(1, aw - 1);
      const ny = y / Math.max(1, ah - 1);
      const contourAngle = imageAngle + Math.sin(nx * 17 + ny * 23) * 0.075;
      const artisticAngle = Math.atan2((ny - 0.5) * 1.18, nx - 0.5)
        + Math.PI * 0.5
        + Math.sin(nx * 13 - ny * 9) * 0.12;
      angle[i] = lineBlend3(
        imageAngle,
        params.structure * (0.35 + imageConfidence * 1.15),
        contourAngle,
        params.geometry * (0.12 + imageConfidence * 0.72),
        artisticAngle,
        params.semantic * (0.08 + (1 - imageConfidence) * 0.34),
      );
      confidence[i] = Math.min(1, 0.18 + imageConfidence * 0.72);
    }
  }
  s.angle = angle;
  s.confidence = confidence;
  void ctx;
}

function paletteColor(s: WetPaintState, seed: SeedPoint, x: number, y: number): ThreeNS.Color {
  const { THREE } = s.ctx;
  const offset = colorPixelOffset(s, x, y);
  const radius = [3.2, 1.45, 0.45][seed.layer];
  const leftOffset = colorPixelOffset(s, x - radius, y);
  const rightOffset = colorPixelOffset(s, x + radius, y);
  const bottomOffset = colorPixelOffset(s, x, y - radius);
  const topOffset = colorPixelOffset(s, x, y + radius);
  const red = (
    s.colorBuf[offset] + s.colorBuf[leftOffset] + s.colorBuf[rightOffset]
    + s.colorBuf[bottomOffset] + s.colorBuf[topOffset]
  ) / 1275;
  const green = (
    s.colorBuf[offset + 1] + s.colorBuf[leftOffset + 1] + s.colorBuf[rightOffset + 1]
    + s.colorBuf[bottomOffset + 1] + s.colorBuf[topOffset + 1]
  ) / 1275;
  const blue = (
    s.colorBuf[offset + 2] + s.colorBuf[leftOffset + 2] + s.colorBuf[rightOffset + 2]
    + s.colorBuf[bottomOffset + 2] + s.colorBuf[topOffset + 2]
  ) / 1275;
  const color = new THREE.Color(red, green, blue);
  color.offsetHSL((seed.random - 0.5) * 0.018, 0.035 + seed.layer * 0.018, (seed.random - 0.5) * 0.055);
  return color;
}

function poissonLayer(
  s: WetPaintState,
  layer: number,
  targetCount: number,
  minDistance: number,
): void {
  const { aw, ah } = s;
  const cellSize = minDistance / Math.SQRT2;
  const cols = Math.ceil(aw / cellSize);
  const rows = Math.ceil(ah / cellSize);
  const grid = new Int32Array(cols * rows).fill(-1);
  const local: SeedPoint[] = [];
  const maxAttempts = targetCount * 34;
  const generationOffset = s.variant * 104729 + layer * 9176;
  for (let attempt = 0; attempt < maxAttempts && local.length < targetCount; attempt += 1) {
    const index = attempt + generationOffset + 1;
    const x = fract(0.5 + index * 0.754877666) * aw;
    const y = fract(0.5 + index * 0.569840296) * ah;
    const semantic = semanticAt(s, x, y);
    if (!semantic || depthAt(s, x, y) >= 0.999) continue;
    const fieldIndex = Math.min(s.angle.length - 1, Math.floor(y) * aw + Math.floor(x));
    const seedConfidence = s.confidence[fieldIndex];
    const density = semantic === 4 ? 1 : semantic === 5 ? 0.72 : 0.88;
    if (hash(index * 2.13) > density * (0.64 + seedConfidence * 0.36)) continue;
    const gridX = Math.floor(x / cellSize);
    const gridY = Math.floor(y / cellSize);
    let valid = true;
    for (let oy = -2; oy <= 2 && valid; oy += 1) {
      for (let ox = -2; ox <= 2; ox += 1) {
        const cx = gridX + ox;
        const cy = gridY + oy;
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
        const neighborIndex = grid[cy * cols + cx];
        if (neighborIndex < 0) continue;
        const neighbor = local[neighborIndex];
        if (Math.hypot(neighbor.x - x, neighbor.y - y) < minDistance) {
          valid = false;
          break;
        }
      }
    }
    if (!valid) continue;
    const seed: SeedPoint = {
      x,
      y,
      semantic,
      layer,
      random: hash(index * 7.31 + layer * 13.7),
      color: new (s.ctx.THREE as typeof ThreeNS).Color(),
    };
    grid[gridY * cols + gridX] = local.length;
    local.push(seed);
    s.seeds.push(seed);
  }
}

/** 重新播种（strokeCountK 变化 或 主动换构图）：清空并按当前参数重建三层种子 */
function generateSeeds(s: WetPaintState): void {
  s.seeds = [];
  const desiredCount = Math.max(3000, Math.min(24000, Math.round(s.params.strokeCountK * 1000)));
  const coarseCount = Math.round(desiredCount * 0.06);
  const mediumCount = Math.round(desiredCount * 0.225);
  const fineCount = desiredCount - coarseCount - mediumCount;
  const { aw, ah } = s;
  const analysisScale = Math.sqrt((aw * ah) / (312 * 460));
  const densityScale = Math.sqrt(14000 / desiredCount);
  const distanceScale = analysisScale * densityScale;
  poissonLayer(s, 0, coarseCount, 5.8 * distanceScale);
  poissonLayer(s, 1, mediumCount, 2.75 * distanceScale);
  poissonLayer(s, 2, fineCount, 1.2 * distanceScale);
  s.seeds.forEach((seed) => { seed.color = paletteColor(s, seed, seed.x, seed.y); });
}

/** 双向笔触积分（源项目逐字移植；缺省可复用同一栈内缓冲，模块级单线程安全） */
const backwardTraceScratch = new Float32Array(STROKE_TRACE_STEPS * 2);
const forwardTraceScratch = new Float32Array(STROKE_TRACE_STEPS * 2);

function traceInto(
  s: WetPaintState,
  seed: SeedPoint,
  x: number,
  y: number,
  sign: number,
  distance: number,
  target: Float32Array,
): number {
  const startDepth = depthAt(s, x, y);
  let px = x;
  let py = y;
  let previousX = 0;
  let previousY = 0;
  let traced = 0;
  const stepLength = distance / STROKE_TRACE_STEPS;
  for (let step = 0; step < STROKE_TRACE_STEPS; step += 1) {
    let direction = sampleAngle(s, px, py);
    let dx = Math.cos(direction) * sign;
    let dy = Math.sin(direction) * sign;
    if (step > 0 && dx * previousX + dy * previousY < 0) {
      dx *= -1;
      dy *= -1;
    }
    const mx = px + dx * stepLength * 0.5;
    const my = py + dy * stepLength * 0.5;
    direction = sampleAngle(s, mx, my);
    let ndx = Math.cos(direction) * sign;
    let ndy = Math.sin(direction) * sign;
    if (ndx * dx + ndy * dy < 0) {
      ndx *= -1;
      ndy *= -1;
    }
    const nx = px + ndx * stepLength;
    const ny = py + ndy * stepLength;
    if (nx < 1 || ny < 1 || nx >= s.aw - 1 || ny >= s.ah - 1) break;
    if (semanticAt(s, nx, ny) !== seed.semantic || Math.abs(depthAt(s, nx, ny) - startDepth) > 0.075) break;
    if (referenceColorDistance(s, x, y, nx, ny) > 0.31) break;
    px = nx;
    py = ny;
    previousX = ndx;
    previousY = ndy;
    target[traced * 2] = px;
    target[traced * 2 + 1] = py;
    traced += 1;
  }
  return traced;
}

/** 分配笔触实例化几何（数量随播种变化；重建时先释放旧几何与网格） */
function allocStrokeGeometry(s: WetPaintState): void {
  const { THREE } = s.ctx;
  if (s.strokeMesh) s.ctx.overlayScene.remove(s.strokeMesh);
  s.geometry?.dispose();
  const segments = 8;
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    vertices.push(t, -1, 0, t, 1, 0);
  }
  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  const instanceAttr = (size: number) =>
    new THREE.InstancedBufferAttribute(new Float32Array(s.seeds.length * size), size);
  geometry.setAttribute('aP0', instanceAttr(2));
  geometry.setAttribute('aP1', instanceAttr(2));
  geometry.setAttribute('aP2', instanceAttr(2));
  geometry.setAttribute('aP3', instanceAttr(2));
  geometry.setAttribute('aColor', instanceAttr(3));
  geometry.setAttribute('aWidth', instanceAttr(1));
  geometry.setAttribute('aSeed', instanceAttr(1));
  geometry.setAttribute('aBirth', instanceAttr(1));
  geometry.setAttribute('aDuration', instanceAttr(1));
  geometry.setAttribute('aBrushLayer', instanceAttr(1));
  geometry.instanceCount = s.seeds.length;
  const mesh = new THREE.Mesh(geometry, s.ctx.strokeMaterial);
  mesh.frustumCulled = false;
  s.ctx.overlayScene.add(mesh);
  s.geometry = geometry;
  s.strokeMesh = mesh;
}

/** 按方向场积分填充笔触属性（length 变化 / 播种 / 方向场重建时调用） */
function fillStrokeGeometry(s: WetPaintState): void {
  const geometry = s.geometry;
  if (!geometry || s.seeds.length === 0) return;
  const p0 = geometry.getAttribute('aP0').array as Float32Array;
  const p1 = geometry.getAttribute('aP1').array as Float32Array;
  const p2 = geometry.getAttribute('aP2').array as Float32Array;
  const p3 = geometry.getAttribute('aP3').array as Float32Array;
  const colors = geometry.getAttribute('aColor').array as Float32Array;
  const widths = geometry.getAttribute('aWidth').array as Float32Array;
  const randoms = geometry.getAttribute('aSeed').array as Float32Array;
  const births = geometry.getAttribute('aBirth').array as Float32Array;
  const durations = geometry.getAttribute('aDuration').array as Float32Array;
  const brushLayers = geometry.getAttribute('aBrushLayer').array as Float32Array;
  const { aw, ah } = s;

  for (let index = 0; index < s.seeds.length; index += 1) {
    const seed = s.seeds[index];
    const visible = seed.x >= 1 && seed.y >= 1
      && seed.x < aw - 1 && seed.y < ah - 1
      && semanticAt(s, seed.x, seed.y) === seed.semantic;
    const baseLength = [25, 14, 7.4][seed.layer]
      * s.params.length
      * (0.82 + seed.random * 0.36);
    const backwardCount = visible
      ? traceInto(s, seed, seed.x, seed.y, -1, baseLength * 0.5, backwardTraceScratch)
      : 0;
    const forwardCount = visible
      ? traceInto(s, seed, seed.x, seed.y, 1, baseLength * 0.5, forwardTraceScratch)
      : 0;
    const backwardEnd = Math.max(0, backwardCount - 1) * 2;
    const backwardMid = Math.floor(backwardCount * 0.48) * 2;
    const forwardMid = Math.floor(forwardCount * 0.48) * 2;
    const forwardEnd = Math.max(0, forwardCount - 1) * 2;
    const pointOffset = index * 2;
    p0[pointOffset] = (backwardCount ? backwardTraceScratch[backwardEnd] : seed.x) / aw;
    p0[pointOffset + 1] = (backwardCount ? backwardTraceScratch[backwardEnd + 1] : seed.y) / ah;
    p1[pointOffset] = (backwardCount ? backwardTraceScratch[backwardMid] : seed.x) / aw;
    p1[pointOffset + 1] = (backwardCount ? backwardTraceScratch[backwardMid + 1] : seed.y) / ah;
    p2[pointOffset] = (forwardCount ? forwardTraceScratch[forwardMid] : seed.x) / aw;
    p2[pointOffset + 1] = (forwardCount ? forwardTraceScratch[forwardMid + 1] : seed.y) / ah;
    p3[pointOffset] = (forwardCount ? forwardTraceScratch[forwardEnd] : seed.x) / aw;
    p3[pointOffset + 1] = (forwardCount ? forwardTraceScratch[forwardEnd + 1] : seed.y) / ah;
    colors[index * 3] = seed.color.r;
    colors[index * 3 + 1] = seed.color.g;
    colors[index * 3 + 2] = seed.color.b;
    widths[index] = visible
      ? [11.5, 6.0, 3.15][seed.layer] * (0.82 + seed.random * 0.36)
      : 0;
    randoms[index] = seed.random + index * 0.00013;
    brushLayers[index] = seed.layer;
    if (seed.layer === 2) {
      const fineBirthRandom = hash(seed.x * 0.137 + seed.y * 0.193 + seed.random * 17.1);
      births[index] = 0.72 + fineBirthRandom * 1.85;
      durations[index] = 0.22 + seed.random * 0.18;
    } else {
      births[index] = [0, 0.72][seed.layer] + seed.random * [0.7, 1.2][seed.layer];
      durations[index] = [1.2, 0.9][seed.layer] * (0.82 + seed.random * 0.36);
    }
  }
}

/** 高频路径：仅更新 uniform 并重绘笔触层 + 合成（GPU 侧，毫秒级） */
function renderFrame(s: WetPaintState): void {
  const { ctx } = s;
  const { renderer } = ctx;
  const wetness = Math.max(0, Math.min(1, 1 - s.params.dryness));
  for (const material of [ctx.strokeMaterial, ctx.heightMaterial]) {
    material.uniforms.uCoverage.value = s.params.coverage;
    material.uniforms.uBrushSize.value = s.params.strokeSize;
    material.uniforms.uWetness.value = wetness;
    material.uniforms.uViscosity.value = s.params.viscosity;
    material.uniforms.uBristleDetail.value = s.params.bristleDetail;
    material.uniforms.uResolution.value.set(s.outW, s.outH);
    material.uniforms.uStrokeScale.value = 1.12;
    material.uniforms.uGrowthTime.value = GROWTH_DURATION;
    material.uniforms.uGrowthEnabled.value = 0;
  }
  renderer.setRenderTarget(s.strokeTarget);
  renderer.setViewport(0, 0, s.outW, s.outH);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.render(ctx.overlayScene, ctx.overlayCamera);

  if (s.strokeMesh) s.strokeMesh.material = ctx.heightMaterial;
  renderer.setRenderTarget(s.heightTarget);
  renderer.setViewport(0, 0, s.outW, s.outH);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.render(ctx.overlayScene, ctx.overlayCamera);
  if (s.strokeMesh) s.strokeMesh.material = ctx.strokeMaterial;

  const composite = ctx.compositeMaterial;
  composite.uniforms.uScene.value = s.sceneTarget.texture;
  composite.uniforms.uStroke.value = s.strokeTarget.texture;
  composite.uniforms.uHeight.value = s.heightTarget.texture;
  composite.uniforms.uSemantic.value = s.semanticTarget.texture;
  (composite.uniforms.uTexel.value as ThreeNS.Vector2).set(1 / s.outW, 1 / s.outH);
  composite.uniforms.uMode.value = s.style === 'blend' ? 0 : 5;
  composite.uniforms.uImpasto.value = s.params.impasto;
  composite.uniforms.uWetness.value = wetness;
  composite.uniforms.uLightAngle.value = LIGHT_ANGLE;
  composite.uniforms.uTime.value = 0;
  renderer.setRenderTarget(null);
  renderer.setViewport(0, 0, s.outW, s.outH);
  renderer.setClearColor(0x0b1322, 1);
  renderer.clear(true, true, true);
  renderer.render(ctx.screenScene, ctx.screenCamera);
}

function disposeState(s: WetPaintState): void {
  if (s.disposed) return;
  s.disposed = true;
  if (s.strokeMesh) s.ctx.overlayScene.remove(s.strokeMesh);
  s.geometry?.dispose();
  s.texture.dispose();
  s.sceneTarget.dispose();
  s.colorTarget.dispose();
  s.normalTarget.dispose();
  s.semanticTarget.dispose();
  s.strokeTarget.dispose();
  s.heightTarget.dispose();
  s.ctx.renderer.dispose();
  s.ctx.renderer.forceContextLoss();
}

async function openState(imageSrc: string, options: WetPaintRenderOptions): Promise<WetPaintState> {
  const ctx = await createContext();
  const resources: Array<{ dispose: () => void }> = [];
  try {
    const params: WetPaintParams = { ...WET_PAINT_DEFAULT_PARAMS, ...options.params };
    const style: OilPaintStyle = options.style ?? 'brush';
    const image = await loadImage(imageSrc);
    const cap = Math.min(options.maxEdge ?? DEFAULT_MAX_EDGE, ctx.renderer.capabilities.maxTextureSize || 4096);
    const prepared = limitImageSize(image, cap);
    const outW = prepared.width;
    const outH = prepared.height;
    if (!outW || !outH) throw new Error('图片没有可读取的尺寸');
    const aspect = outW / Math.max(1, outH);
    let aw: number;
    let ah: number;
    if (aspect >= 1) {
      aw = Math.min(460, Math.max(300, Math.round(outW * 0.46)));
      ah = Math.max(144, Math.round(aw / aspect));
    } else {
      ah = Math.min(460, Math.max(300, Math.round(outH * 0.4)));
      aw = Math.max(144, Math.round(ah * aspect));
    }
    ctx.renderer.setSize(outW, outH, false);
    const samples = 4; // MSAA（WebGL2，与源项目 high 档一致）
    const texture = makeSourceTexture(ctx, prepared);
    const sceneTarget = makeTarget(ctx, outW, outH, { samples });
    const colorTarget = makeTarget(ctx, aw, ah, {});
    const normalTarget = makeTarget(ctx, aw, ah, { nearest: true });
    const semanticTarget = makeTarget(ctx, aw, ah, { nearest: true });
    const strokeTarget = makeTarget(ctx, outW, outH, { depth: false, samples });
    const heightTarget = makeTarget(ctx, outW, outH, { depth: false, samples });
    resources.push(
      texture, sceneTarget, colorTarget, normalTarget, semanticTarget, strokeTarget, heightTarget,
    );
    const s: WetPaintState = {
      ctx,
      params,
      style,
      variant: Math.max(0, Math.round(options.variant ?? 0)),
      outW,
      outH,
      aw,
      ah,
      imageAspect: outW / Math.max(1, outH),
      texture,
      sceneTarget,
      colorTarget,
      normalTarget,
      semanticTarget,
      strokeTarget,
      heightTarget,
      colorBuf: new Uint8Array(aw * ah * 4),
      normalDepthBuf: new Uint8Array(aw * ah * 4),
      semanticBuf: new Uint8Array(aw * ah * 4),
      angle: new Float32Array(0),
      confidence: new Float32Array(0),
      seeds: [],
      geometry: null,
      strokeMesh: null,
      disposed: false,
    };
    captureGBuffer(s);
    buildField(s);
    generateSeeds(s);
    allocStrokeGeometry(s);
    fillStrokeGeometry(s);
    renderFrame(s);
    return s;
  } catch (error) {
    resources.forEach((r) => r.dispose());
    ctx.renderer.dispose();
    ctx.renderer.forceContextLoss();
    throw error;
  }
}

/* ---------- 会话类 ---------- */

export interface WetPaintUpdateResult {
  strokes: number;
}

/**
 * 湿油彩会话：绑定一张输入图，持有追加的 WebGL 上下文并缓存中间结果。
 * 会话建立后：
 * - update() 增量应用参数——uniform 级仅重绘（毫秒级，可拖拽实时预览）；
 *   strokeCountK / 方向权重 / length 级按需重播种或重积分。
 * - toDataUrl() 把当前画布导出为 PNG Data URL（保存 / 落库用）。
 * - dispose() 释放 GL 上下文（节点销毁 / 更换输入图时调用，避免上下文耗尽）。
 */
export class WetPaintSession {
  private readonly state: WetPaintState;

  private constructor(state: WetPaintState) {
    this.state = state;
  }

  static async create(
    imageSrc: string,
    options: WetPaintRenderOptions = {},
  ): Promise<WetPaintSession> {
    return new WetPaintSession(await openState(imageSrc, options));
  }

  /** 会话画布元素（挂到节点预览区即可实时显示） */
  get canvas(): HTMLCanvasElement {
    return this.state.ctx.renderer.domElement;
  }

  get width(): number {
    return this.state.outW;
  }

  get height(): number {
    return this.state.outH;
  }

  get strokes(): number {
    return this.state.seeds.length;
  }

  /** 增量更新参数并立即渲染一帧（同步）。返回本次更新触发的最重失效级别（0=仅 uniform） */
  update(next: Partial<WetPaintParams> = {}, style?: OilPaintStyle): WetPaintUpdateResult {
    const s = this.state;
    if (s.disposed) throw new Error('湿油彩会话已释放');
    let level = 0;
    const merged: WetPaintParams = { ...s.params };
    for (const key of Object.keys(next) as (keyof WetPaintParams)[]) {
      const value = next[key];
      if (value === undefined || merged[key] === value) continue;
      merged[key] = value;
      if (key === 'length') level = Math.max(level, 1);
      else if (key === 'structure' || key === 'geometry' || key === 'semantic') level = Math.max(level, 2);
      else if (key === 'strokeCountK') level = 3;
    }
    s.params = merged;
    if (style) s.style = style;
    if (level >= 3) {
      generateSeeds(s);
      allocStrokeGeometry(s);
      fillStrokeGeometry(s);
    } else if (level === 2) {
      buildField(s);
      fillStrokeGeometry(s);
    } else if (level === 1) {
      fillStrokeGeometry(s);
    }
    renderFrame(s);
    return { strokes: s.seeds.length };
  }

  /** 换一批播种（随机重掷构图），不改参数 */
  reseed(): WetPaintUpdateResult {
    const s = this.state;
    if (s.disposed) throw new Error('湿油彩会话已释放');
    s.variant += 1;
    generateSeeds(s);
    allocStrokeGeometry(s);
    fillStrokeGeometry(s);
    renderFrame(s);
    return { strokes: s.seeds.length };
  }

  /** 导出当前画布为 PNG Data URL（WebGL 上下文持有期间可随时读取） */
  toDataUrl(): string {
    return this.state.ctx.renderer.domElement.toDataURL('image/png');
  }

  dispose(): void {
    disposeState(this.state);
  }
}

/* ---------- 兼容入口（一次性渲染，重定位于会话模式） ---------- */

export interface WetPaintResult {
  dataUrl: string;
  width: number;
  height: number;
  strokes: number;
}

export async function renderWetPaintFromImage(
  imageSrc: string,
  options: WetPaintRenderOptions = {},
): Promise<WetPaintResult> {
  const session = await WetPaintSession.create(imageSrc, options);
  try {
    return {
      dataUrl: session.toDataUrl(),
      width: session.width,
      height: session.height,
      strokes: session.strokes,
    };
  } finally {
    session.dispose();
  }
}