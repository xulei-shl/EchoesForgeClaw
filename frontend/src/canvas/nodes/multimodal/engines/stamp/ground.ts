/**
 * 邮票防伪底纹绘制模块（Ground Patterns）
 * 模拟凹版钞券与高保真邮票的机雕曲线底纹
 */

import type { GroundStyle } from './types';

export interface GroundBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GroundOptions {
  style: GroundStyle;
  /** 线条或斑点颜色 (#rrggbb) */
  color: string;
  /** 线条或网点粗细 (0 ~ 1) */
  weight: number;
  /** 图样密度间距 (0 ~ 1，越小越密) */
  scale: number;
  /** 旋转角度 (0 ~ 1 圈) */
  angle: number;
  /** 油墨强度 (0 ~ 1) */
  strength: number;
}

/** 确定性伪随机数生成器（保证重绘图案完全一致） */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** 为十六进制颜色附加 alpha 通道 */
function withAlpha(hex: string, a: number): string {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const v = Math.round(Math.max(0, Math.min(1, a)) * 255);
  const alphaHex = v.toString(16).padStart(2, '0');
  if (clean.length === 6) {
    return `#${clean}${alphaHex}`;
  }
  return hex;
}

/** 现代微细渐变板底纹 */
function paintPanel(ctx: CanvasRenderingContext2D, b: GroundBox, o: GroundOptions) {
  const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
  const head = 0.3 + o.weight * 0.7;
  g.addColorStop(0, withAlpha(o.color, head));
  g.addColorStop(1, withAlpha(o.color, head * (1 - o.scale * 0.95)));
  ctx.fillStyle = g;
  ctx.fillRect(b.x, b.y, b.w, b.h);
}

/** 网状细密波纹（Burelage）或交叉细线（Crosshatch） */
function paintLines(
  ctx: CanvasRenderingContext2D,
  b: GroundBox,
  o: GroundOptions,
  unit: number,
  crossed: boolean
) {
  const pitch = unit * (0.8 + o.scale * 5);
  ctx.lineWidth = unit * (0.1 + o.weight * 0.7);
  ctx.lineCap = 'butt';
  const wave = o.weight * unit * 1.6;

  const draw = (across: boolean) => {
    ctx.beginPath();
    for (let p = b.y; p <= b.y + b.h; p += pitch) {
      if (across) {
        ctx.moveTo(b.x, p);
        for (let x = b.x; x <= b.x + b.w; x += pitch / 2) {
          ctx.lineTo(x, p + Math.sin(x / (pitch * 1.7)) * wave);
        }
      } else {
        ctx.moveTo(p, b.y);
        for (let y = b.y; y <= b.y + b.h; y += pitch / 2) {
          ctx.lineTo(p + Math.sin(y / (pitch * 1.7)) * wave, y);
        }
      }
    }
    ctx.stroke();
  };

  draw(true);
  if (crossed) draw(false);
}

/** 几何度盘机雕曲线（Guilloche） */
function paintGuilloche(
  ctx: CanvasRenderingContext2D,
  b: GroundBox,
  o: GroundOptions,
  unit: number
) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const R = Math.hypot(b.w, b.h) / 2;
  ctx.lineWidth = unit * (0.12 + o.weight * 0.55);
  const rings = 6 + Math.round((1 - o.scale) * 10);
  const teeth = 6 + Math.round(o.scale * 16);
  const teeth2 = teeth + 3;

  for (let r = 0; r < rings; r++) {
    const radius = (R * (r + 1)) / rings;
    const amp = radius * (0.04 + o.weight * 0.08);
    ctx.beginPath();
    const steps = 180;
    for (let i = 0; i <= steps; i++) {
      const th = (i / steps) * Math.PI * 2;
      const mod = Math.sin(th * teeth) * amp + Math.cos(th * teeth2) * (amp * 0.55);
      const rad = radius + mod;
      const x = cx + Math.cos(th) * rad;
      const y = cy + Math.sin(th) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

/** 点画散斑（Stipple）或半色调（Halftone） */
function paintDots(
  ctx: CanvasRenderingContext2D,
  b: GroundBox,
  o: GroundOptions,
  unit: number,
  halftone: boolean
) {
  const pitch = unit * (1.2 + o.scale * 3.6);
  const baseR = unit * (0.16 + o.weight * 0.65);
  ctx.fillStyle = o.color;
  const rand = rng(0x9e3779b9);

  for (let y = b.y; y <= b.y + b.h; y += pitch) {
    const shift = halftone && Math.round((y - b.y) / pitch) % 2 === 1 ? pitch / 2 : 0;
    for (let x = b.x + shift; x <= b.x + b.w; x += pitch) {
      let r = baseR;
      if (!halftone) {
        // 随机轻微扰动
        r *= 0.5 + rand() * 0.8;
      }
      ctx.beginPath();
      ctx.arc(
        x + (halftone ? 0 : (rand() - 0.5) * pitch * 0.5),
        y + (halftone ? 0 : (rand() - 0.5) * pitch * 0.5),
        r,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }
}

/**
 * 在目标矩形区域绘制所选防伪底纹
 */
export function paintGround(
  ctx: CanvasRenderingContext2D,
  o: GroundOptions,
  b: GroundBox,
  unit: number
) {
  if (o.style === 'none') return;
  const rot = o.angle * Math.PI * 2;
  ctx.save();
  ctx.globalAlpha *= 0.25 + o.strength * 0.75;
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;

  if (o.style === 'panel') {
    paintPanel(ctx, b, o);
  } else if (o.style === 'stipple' || o.style === 'halftone') {
    paintDots(ctx, b, o, unit, o.style === 'halftone');
  } else {
    // 旋转围绕中心展开
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const r = Math.hypot(b.w, b.h) / 2;
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    const box = { x: -r, y: -r, w: r * 2, h: r * 2 };
    if (o.style === 'guilloche') {
      paintGuilloche(ctx, box, o, unit);
    } else {
      paintLines(ctx, box, o, unit, o.style === 'crosshatch');
    }
  }
  ctx.restore();
}
