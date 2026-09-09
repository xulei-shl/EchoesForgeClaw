/**
 * 颜色模型数学转换工具集 (HEX / RGB / HSV)
 */

export interface HsvColor {
  /** 色相 0 - 360 */
  h: number;
  /** 饱和度 0 - 100 */
  s: number;
  /** 明度 0 - 100 */
  v: number;
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** 校验合法 Hex 颜色代码 */
export function isValidHex(hex: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim());
}

/** 规范化 Hex 字符串为 6 位小写形式，如 "#f3a" -> "#ff33aa" */
export function normalizeHex(hex: string): string {
  let clean = hex.trim().replace(/^#/, '');
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  return `#${clean.toLowerCase()}`;
}

/** Hex 转 RGB */
export function hexToRgb(hex: string): RgbColor {
  const norm = normalizeHex(isValidHex(hex) ? hex : '#000000').slice(1);
  const r = parseInt(norm.slice(0, 2), 16) || 0;
  const g = parseInt(norm.slice(2, 4), 16) || 0;
  const b = parseInt(norm.slice(4, 6), 16) || 0;
  return { r, g, b };
}

/** RGB 转 Hex */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** RGB 转 HSV */
export function rgbToHsv(r: number, g: number, b: number): HsvColor {
  const normR = r / 255;
  const normG = g / 255;
  const normB = b / 255;

  const max = Math.max(normR, normG, normB);
  const min = Math.min(normR, normG, normB);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === normR) {
      h = ((normG - normB) / delta) % 6;
    } else if (max === normG) {
      h = (normB - normR) / delta + 2;
    } else {
      h = (normR - normG) / delta + 4;
    }
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : Math.round((delta / max) * 100);
  const v = Math.round(max * 100);

  return { h, s, v };
}

/** HSV 转 RGB */
export function hsvToRgb(h: number, s: number, v: number): RgbColor {
  const clampedH = ((h % 360) + 360) % 360;
  const clampedS = Math.max(0, Math.min(100, s)) / 100;
  const clampedV = Math.max(0, Math.min(100, v)) / 100;

  const c = clampedV * clampedS;
  const x = c * (1 - Math.abs(((clampedH / 60) % 2) - 1));
  const m = clampedV - c;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (clampedH < 60) {
    rPrime = c;
    gPrime = x;
  } else if (clampedH < 120) {
    rPrime = x;
    gPrime = c;
  } else if (clampedH < 180) {
    gPrime = c;
    bPrime = x;
  } else if (clampedH < 240) {
    gPrime = x;
    bPrime = c;
  } else if (clampedH < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  };
}

/** Hex 转 HSV */
export function hexToHsv(hex: string): HsvColor {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsv(r, g, b);
}

/** HSV 转 Hex */
export function hsvToHex(h: number, s: number, v: number): string {
  const { r, g, b } = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}
