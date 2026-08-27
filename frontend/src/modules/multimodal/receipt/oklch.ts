import type { ReceiptTheme } from './types';

/**
 * OKLCH 颜色表示接口
 */
export interface OklchColor {
  /** 明度 Lightness: 0 ~ 1 */
  l: number;
  /** 彩度 Chroma: 0 ~ 0.4 左右 */
  c: number;
  /** 色相 Hue: 0 ~ 360 */
  h: number;
}

/** sRGB 非线性通道转线性通道 */
function srgbToLinear(c: number): number {
  const norm = c / 255;
  return norm <= 0.04045 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

/** 线性通道转 sRGB 非线性通道 (0 ~ 1) */
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055;
}

/**
 * 校验并规范化 Hex 字符串为 6 位小写（例如 "#abc" -> "#aabbcc"）
 */
export function normalizeHexColor(hex: string): string {
  let clean = hex.trim().replace(/^#/, '');
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  if (clean.length !== 6) {
    return '#3b82f6'; // 默认回退天蓝色
  }
  return `#${clean.toLowerCase()}`;
}

/**
 * 十六进制 Hex 转 OKLCH 空间
 */
export function hexToOklch(hex: string): OklchColor {
  const norm = normalizeHexColor(hex).slice(1);
  const r8 = parseInt(norm.slice(0, 2), 16) || 0;
  const g8 = parseInt(norm.slice(2, 4), 16) || 0;
  const b8 = parseInt(norm.slice(4, 6), 16) || 0;

  const r = srgbToLinear(r8);
  const g = srgbToLinear(g8);
  const b = srgbToLinear(b8);

  // Linear RGB -> LMS 锥体响应
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  // 非线性变换
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  // LMS -> Oklab
  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

  // Oklab -> OKLCH
  const C = Math.sqrt(a * a + b_ * b_);
  let H = (Math.atan2(b_, a) * 180) / Math.PI;
  if (H < 0) H += 360;

  return { l: L, c: C, h: H };
}

/**
 * OKLCH 空间转标准 6 位 Hex 颜色
 */
export function oklchToHex(l: number, c: number, h: number): string {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b_ = c * Math.sin(rad);

  // Oklab -> LMS 非线性
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b_;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b_;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b_;

  // 还原为线性 LMS
  const l_lin = l_ * l_ * l_;
  const m_lin = m_ * m_ * m_;
  const s_lin = s_ * s_ * s_;

  // LMS -> Linear RGB
  let r = +4.0767434721 * l_lin - 3.3077115913 * m_lin + 0.2309699292 * s_lin;
  let g = -1.2684380046 * l_lin + 2.6097574011 * m_lin - 0.3413193965 * s_lin;
  let b = -0.0041960863 * l_lin - 0.7034186147 * m_lin + 1.7076147010 * s_lin;

  // 伽马矫正与截断 (Gamut clamping)
  const rByte = Math.min(255, Math.max(0, Math.round(linearToSrgb(r) * 255)));
  const gByte = Math.min(255, Math.max(0, Math.round(linearToSrgb(g) * 255)));
  const bByte = Math.min(255, Math.max(0, Math.round(linearToSrgb(b) * 255)));

  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(rByte)}${toHex(gByte)}${toHex(bByte)}`.toUpperCase();
}

/**
 * 从用户拾取的代表基调色（Seed Hex），智能派生全套高对比度热敏小票主题
 *
 * 遵循 @better-colors 准则：
 * 1. 纸张底色与正文油墨处于同一色相轴（Perceptual Hue Stability），视觉和谐高级；
 * 2. 纸张明度稳定在 L ≈ 0.955（高光纸感），正文油墨压低至 L ≈ 0.24（浓郁深墨）；
 * 3. 满足 APCA |Lc| >= 85 与 WCAG 2.1 AAA 级（>= 10:1）对比度要求，盲吸永不翻车；
 * 4. 灰阶/纯黑/纯白极端色相自动平滑回退，保持雅致微暖炭墨质感。
 */
export function deriveReceiptThemeFromSeed(seedHex: string): ReceiptTheme {
  const normSeed = normalizeHexColor(seedHex);
  const oklch = hexToOklch(normSeed);

  const isGrayscale = oklch.c < 0.018;
  const hue = isGrayscale ? 45 : oklch.h; // 灰度时回退至微暖米色相

  // 1. 纸张底色 (bg)：高明度 + 柔和极微彩度特种纸
  const bgChroma = isGrayscale
    ? 0.006
    : Math.min(0.032, Math.max(0.016, oklch.c * 0.22 + 0.01));
  const bg = oklchToHex(0.955, bgChroma, hue);

  // 2. 正文主油墨 (text)：浓郁墨色，同色相微彩度，极致对比度 (AAA 级)
  const textChroma = isGrayscale
    ? 0.008
    : Math.min(0.052, Math.max(0.024, oklch.c * 0.32 + 0.015));
  const text = oklchToHex(0.24, textChroma, hue);

  // 3. 次要信息弱化油墨 (faint)：中阶明度
  const faintChroma = isGrayscale
    ? 0.01
    : Math.min(0.04, Math.max(0.018, oklch.c * 0.25 + 0.01));
  const faint = oklchToHex(0.50, faintChroma, hue);

  // 4. 虚线分割线 (dashed)：微暗纸色
  const dashedChroma = isGrayscale
    ? 0.01
    : Math.min(0.028, Math.max(0.014, oklch.c * 0.20 + 0.008));
  const dashed = oklchToHex(0.82, dashedChroma, hue);

  // 5. 点缀/印章/星级色 (accent)：
  // 若种子色本身饱和度足，保留鲜活感；若原本为弱色，赋予经典中国朱砂红印泥色
  const accentChroma = isGrayscale
    ? 0.16
    : Math.min(0.22, Math.max(0.12, oklch.c * 0.85));
  const accentHue = isGrayscale ? 28 : hue;
  const accent = oklchToHex(0.52, accentChroma, accentHue);

  return {
    id: 'custom',
    name: '自定义纸色',
    bg,
    text,
    faint,
    dashed,
    accent,
    previewColor: bg,
  };
}
