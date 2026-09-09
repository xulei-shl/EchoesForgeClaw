/**
 * 玻璃折射 WebGL 着色器
 * 采用高度场（Height Field）与中心差分法向量计算物理真实折射，
 * 结合 Snell 定律、RGB 色散分光以及 Schlick 菲涅尔高光。
 */

import type { GlassPattern } from './types';

export const VERTEX_SHADER = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D uImage;
uniform vec2 uResolution;
uniform int uPattern;
uniform float uScale;
uniform float uRelief;
uniform float uThickness;
uniform float uAngle;
uniform float uDispersion;
uniform float uSpecular;
uniform float uGap;
uniform float uSeed;

const float PI = 3.14159265359;

/* ---------------- 噪声与波形辅助函数 ---------------- */

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21) + uSeed);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/** 三角波 (0 到 1 往复，构造平面切面) */
float tri(float t) {
  return abs(fract(t) * 2.0 - 1.0);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/* ---------------- 9 种玻璃高度场函数 (0.0 ~ 1.0) ---------------- */

float height(vec2 p) {
  vec2 cell = p / uScale;

  // 0: Fluted 竖条纹/长虹：半圆柱体连续并排
  if (uPattern == 0) {
    float u = fract(cell.x) * 2.0 - 1.0;
    return sqrt(max(0.0, 1.0 - u * u));
  }

  // 1: Cross 十字格/枕形：水平与垂直圆柱交叉相乘
  if (uPattern == 1) {
    float u = fract(cell.x) * 2.0 - 1.0;
    float v = fract(cell.y) * 2.0 - 1.0;
    return sqrt(max(0.0, 1.0 - u * u)) * sqrt(max(0.0, 1.0 - v * v));
  }

  // 2: Block 玻璃砖：平顶微凸与平滑四角倒角
  if (uPattern == 2) {
    vec2 u = abs(fract(cell) * 2.0 - 1.0);
    float d = max(u.x, u.y);
    float chamfer = 0.34;
    return smoothstep(1.0, 1.0 - chamfer, d);
  }

  // 3: Ripple 同心水波：以视口中心向外辐射的同心圆柱波形
  if (uPattern == 3) {
    vec2 centred = (p - uResolution * 0.5) / uScale;
    float r = length(centred);
    float u = fract(r) * 2.0 - 1.0;
    return sqrt(max(0.0, 1.0 - u * u));
  }

  // 4: Rain 雨滴透镜：双频值噪声生成聚拢水珠
  if (uPattern == 4) {
    float n = valueNoise(cell) * 0.65 + valueNoise(cell * 2.17) * 0.35;
    return smoothstep(0.30, 0.72, n);
  }

  // 5: Wave 波浪纹：长虹条纹叠加横向三角波扰动
  if (uPattern == 5) {
    float z = (tri(cell.x * 0.5) * 2.0 - 1.0) * 0.55;
    float u = fract(cell.y + z) * 2.0 - 1.0;
    return sqrt(max(0.0, 1.0 - u * u));
  }

  // 6: Hammered 锤击纹/荔枝面：三向 60° 三角波交汇形成蜂窝六边形微切面
  if (uPattern == 6) {
    float a = tri(cell.x);
    float b = tri(dot(cell, vec2(-0.5, 0.8660254)));
    float c = tri(dot(cell, vec2(-0.5, -0.8660254)));
    return (a + b + c) / 3.0;
  }

  // 7: Flemish 佛兰芒流动曲面：噪声场二次扰动扭曲
  if (uPattern == 7) {
    vec2 warp = vec2(valueNoise(cell * 0.7), valueNoise(cell * 0.7 + 5.2)) - 0.5;
    float n = valueNoise(cell + warp * 2.4);
    return smoothstep(0.22, 0.78, n);
  }

  // 8: Frosted 冰霜磨砂：三频高密级微噪点透镜
  float n = valueNoise(cell * 3.0) * 0.5
          + valueNoise(cell * 7.3 + 11.0) * 0.32
          + valueNoise(cell * 16.1 + 23.0) * 0.18;
  return n;
}

/** 玻璃砖砖缝阴影遮罩 */
bool masked(vec2 p) {
  if (uPattern != 2 || uGap <= 0.001) return false;
  vec2 u = abs(fract(p / uScale) * 2.0 - 1.0);
  return max(u.x, u.y) > 1.0 - uGap;
}

/* ---------------- 光线折射与采样 ---------------- */

/** 镜像 UV，避免边界 Clamp 拖影拉伸 */
vec2 mirrorUV(vec2 uv) {
  return 1.0 - abs(mod(uv, 2.0) - 1.0);
}

/** 单通道物理折射采样 */
vec3 sampleAt(vec3 normal, vec2 frag, float ior) {
  vec3 incident = vec3(0.0, 0.0, -1.0);
  vec3 bent = refract(incident, normal, 1.0 / ior);
  // 全反射保底：若全反射则穿透直取，防止黑边
  if (dot(bent, bent) < 0.0001) bent = incident;
  vec2 offset = bent.xy / max(0.05, abs(bent.z)) * uThickness;
  return texture2D(uImage, mirrorUV((frag + offset) / uResolution)).rgb;
}

void main() {
  vec2 frag = gl_FragCoord.xy;

  if (masked(frag)) {
    // 砖缝阴影：取背后原图并压暗，营造自然沉浸感
    vec3 behind = texture2D(uImage, frag / uResolution).rgb;
    gl_FragColor = vec4(behind * 0.18, 1.0);
    return;
  }

  // 旋转矩阵处理角度
  float a = radians(uAngle);
  vec2 centre = uResolution * 0.5;
  vec2 d = frag - centre;
  mat2 turn = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 p = centre + turn * d;

  // 中心差分求法线（归一化为每单元格斜率）
  float e = max(1.0, uScale * 0.03);
  float hx = (height(p + vec2(e, 0.0)) - height(p - vec2(e, 0.0))) / (2.0 * e) * uScale;
  float hy = (height(p + vec2(0.0, e)) - height(p - vec2(0.0, e))) / (2.0 * e) * uScale;
  vec3 normal = normalize(vec3(-hx * uRelief, -hy * uRelief, 1.0));

  // 逆旋转变换法线向量
  mat2 back = mat2(cos(a), sin(a), -sin(a), cos(a));
  vec2 bentXY = back * normal.xy;
  normal = normalize(vec3(bentXY, normal.z));

  // 物理色散 (Dispersion RGB 分光)
  vec3 colour;
  if (uDispersion > 0.0001) {
    colour.r = sampleAt(normal, frag, 1.51 - uDispersion).r;
    colour.g = sampleAt(normal, frag, 1.51).g;
    colour.b = sampleAt(normal, frag, 1.51 + uDispersion).b;
  } else {
    colour = sampleAt(normal, frag, 1.51);
  }

  // Schlick 菲涅尔边缘光泽 (Sheen)
  if (uSpecular > 0.0) {
    float fresnel = pow(1.0 - max(0.0, normal.z), 5.0);
    colour += fresnel * uSpecular;
  }

  gl_FragColor = vec4(colour, 1.0);
}
`;

/** 9 种玻璃图案对应的顺序索引 */
export const PATTERNS_ORDER: GlassPattern[] = [
  'fluted',
  'cross',
  'block',
  'ripple',
  'rain',
  'wave',
  'hammer',
  'flemish',
  'frosted',
];

/** 获取图案在着色器中的整数索引 */
export function getPatternIndex(pattern: GlassPattern | string): number {
  const normalized = pattern === 'hammered' ? 'hammer' : pattern;
  const idx = PATTERNS_ORDER.indexOf(normalized as GlassPattern);
  return idx >= 0 ? idx : 0;
}
