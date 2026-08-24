/**
 * 手账拼贴引擎：随机布局生成 + Canvas 合成整张手账页 PNG。
 * 纯浏览器端实现（零后端计算），与贴纸制作同属「前端合成图片后输出」链路。
 */
import type { JournalBackground, JournalMakerItem, JournalPagePreset, JournalPagePresetId } from './types';
import { journalPagePresetOf } from './types';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const rand = (min: number, max: number) => min + Math.random() * (max - min);

let idSeq = 0;

/** 素材项 id（时间戳 + 序号，避免同毫秒冲突） */
export function nextJournalItemId(): string {
  idSeq += 1;
  return `ji-${Date.now().toString(36)}-${idSeq}`;
}

/**
 * 新素材的默认落位：围绕页面中心温和随机抖动，
 * 多张连续装入时自然错开，不与随机布局按钮的全量洗牌混淆。
 */
export function defaultPlacement(): Pick<JournalMakerItem, 'x' | 'y' | 'w' | 'angle'> {
  return {
    x: clamp(50 + rand(-16, 16), 24, 76),
    y: clamp(50 + rand(-14, 14), 22, 78),
    w: rand(30, 44),
    angle: rand(-10, 10),
  };
}

/** 新文本素材的默认落位（字体大小 5~7，居中偏右） */
export function defaultTextPlacement(
  index: number
): Pick<JournalMakerItem, 'x' | 'y' | 'w' | 'angle'> {
  return {
    x: clamp(50 + rand(-8, 8) + index * 4, 20, 80),
    y: clamp(50 + rand(-8, 8) + index * 3, 18, 82),
    w: rand(5, 7),
    angle: rand(-5, 5),
  };
}

/** 随机布局：位置/大小/旋转全量重排，z 序整体洗牌 */
export function randomizeLayout(items: JournalMakerItem[]): JournalMakerItem[] {
  const zs = items.map((_, i) => i);
  for (let i = zs.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [zs[i], zs[j]] = [zs[j], zs[i]];
  }
  return items.map((item, i) => ({
    ...item,
    x: rand(18, 82),
    y: rand(16, 84),
    w: item.kind === 'text' ? rand(3, 10) : rand(20, 52),
    angle: rand(-24, 24),
    z: zs[i],
  }));
}

/** 角度标准化到 [0, 360) 区间 */
export function normalizeAngle(angle: number): number {
  const a = angle % 360;
  return a < 0 ? a + 360 : a;
}

/**
 * 顺时针旋转并对齐到下一个 90 度的倍数（自动摆正）
 * @param angle 当前角度 (deg)
 * @returns 对齐后的角度 [0, 360)
 */
export function snapRotateCw(angle: number): number {
  const norm = normalizeAngle(angle);
  const rounded = Math.round(norm);
  // 如果已非常接近整 90 度倍数（误差 < 0.5 度），则直接 +90 度
  if (rounded % 90 === 0 && Math.abs(norm - rounded) < 0.5) {
    return (rounded + 90) % 360;
  }
  return (Math.floor(norm / 90) * 90 + 90) % 360;
}

/**
 * 逆时针旋转并对齐到上一个 90 度的倍数（自动摆正）
 * @param angle 当前角度 (deg)
 * @returns 对齐后的角度 [0, 360)
 */
export function snapRotateCcw(angle: number): number {
  const norm = normalizeAngle(angle);
  const rounded = Math.round(norm);
  // 如果已非常接近整 90 度倍数（误差 < 0.5 度），则直接 -90 度
  if (rounded % 90 === 0 && Math.abs(norm - rounded) < 0.5) {
    return (rounded - 90 + 360) % 360;
  }
  return (Math.ceil(norm / 90) * 90 - 90 + 360) % 360;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  if (/^https?:/i.test(src)) image.crossOrigin = 'anonymous';
  image.src = src;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error('素材图片没有可绘制尺寸');
  }
  return image;
}

export interface JournalComposeOptions {
  /** 页面背景（纯色 / 线性渐变） */
  background: JournalBackground;
  /** 画布预设 id */
  pageSize: JournalPagePresetId;
}

/**
 * 绘制点阵网格 Pattern（自适应高分辨率导出）
 */
function createDotGridPattern(
  ctx: CanvasRenderingContext2D,
  scale = 1
): CanvasPattern | null {
  const patternCanvas = document.createElement('canvas');
  const gridSize = Math.max(8, Math.round(10 * scale));
  patternCanvas.width = gridSize;
  patternCanvas.height = gridSize;
  const pCtx = patternCanvas.getContext('2d');
  if (!pCtx) return null;

  pCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  pCtx.beginPath();
  pCtx.arc(gridSize / 2, gridSize / 2, Math.max(1, 1 * scale), 0, Math.PI * 2);
  pCtx.fill();

  return ctx.createPattern(patternCanvas, 'repeat');
}

/**
 * 页面背景绘制：
 * 纯白底色基底 → 线性/Mesh 渐变色层 → 点阵网格层 → 四周 15% 边缘软淡出遮罩
 */
function paintBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bg: JournalBackground
) {
  // 1. 先铺纯白底色（Ground）
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  if (!bg) return;
  if (bg.kind === 'solid') {
    ctx.fillStyle = bg.colors?.[0] || '#ffffff';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  // 2. 离线 Canvas 绘制渐变与点阵（用于做 15% 边缘淡出遮罩）
  const layerCanvas = document.createElement('canvas');
  layerCanvas.width = width;
  layerCanvas.height = height;
  const layerCtx = layerCanvas.getContext('2d');
  if (!layerCtx) return;

  // 2.1 底层线性渐变
  const colors = (bg.colors ?? []).filter(Boolean);
  if (colors.length >= 2) {
    const theta = ((bg.angle ?? 135) * Math.PI) / 180;
    const dx = Math.sin(theta);
    const dy = -Math.cos(theta);
    const lineLen = Math.abs(width * dx) + Math.abs(height * dy);
    const cx = width / 2;
    const cy = height / 2;
    const grad = layerCtx.createLinearGradient(
      cx - (dx * lineLen) / 2,
      cy - (dy * lineLen) / 2,
      cx + (dx * lineLen) / 2,
      cy + (dy * lineLen) / 2
    );
    colors.forEach((c, i) => grad.addColorStop(i / (colors.length - 1), c));
    layerCtx.fillStyle = grad;
    layerCtx.fillRect(0, 0, width, height);
  } else if (colors.length === 1) {
    layerCtx.fillStyle = colors[0];
    layerCtx.fillRect(0, 0, width, height);
  }

  // 2.2 绘制多点 Mesh 径向光斑
  if (bg.kind === 'mesh' && bg.meshSpots?.length) {
    for (const spot of bg.meshSpots) {
      const cx = (spot.x / 100) * width;
      const cy = (spot.y / 100) * height;
      const rx = (spot.rx / 100) * width;
      const ry = (spot.ry / 100) * height;
      const rMax = Math.max(rx, ry);

      layerCtx.save();
      layerCtx.translate(cx, cy);
      layerCtx.scale(rx / rMax, ry / rMax);

      const radGrad = layerCtx.createRadialGradient(0, 0, 0, 0, 0, rMax);
      radGrad.addColorStop(0, spot.color);
      const transparentColor = spot.color.includes('rgba')
        ? spot.color.replace(/[\d.]+\)$/, '0)')
        : 'rgba(255, 255, 255, 0)';
      radGrad.addColorStop(1, transparentColor);

      layerCtx.fillStyle = radGrad;
      layerCtx.beginPath();
      layerCtx.arc(0, 0, rMax, 0, Math.PI * 2);
      layerCtx.fill();
      layerCtx.restore();
    }
  }

  // 2.3 绘制点阵微网格
  if (bg.dotGrid !== false) {
    const scale = width / 600;
    const dotPattern = createDotGridPattern(layerCtx, scale);
    if (dotPattern) {
      layerCtx.fillStyle = dotPattern;
      layerCtx.fillRect(0, 0, width, height);
    }
  }

  // 2.4 四周 15% 边缘淡出遮罩（使用 destination-in 模式）
  if (bg.edgeFade !== false) {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const mCtx = maskCanvas.getContext('2d');
    if (mCtx) {
      // 水平方向 15% 淡出
      const hGrad = mCtx.createLinearGradient(0, 0, width, 0);
      hGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      hGrad.addColorStop(0.15, 'rgba(0, 0, 0, 1)');
      hGrad.addColorStop(0.85, 'rgba(0, 0, 0, 1)');
      hGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      mCtx.fillStyle = hGrad;
      mCtx.fillRect(0, 0, width, height);

      // 垂直方向 15% 淡出（取相交）
      mCtx.globalCompositeOperation = 'destination-in';
      const vGrad = mCtx.createLinearGradient(0, 0, 0, height);
      vGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vGrad.addColorStop(0.15, 'rgba(0, 0, 0, 1)');
      vGrad.addColorStop(0.85, 'rgba(0, 0, 0, 1)');
      vGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      mCtx.fillStyle = vGrad;
      mCtx.fillRect(0, 0, width, height);

      // 将 mask 应用到 layerCanvas
      layerCtx.globalCompositeOperation = 'destination-in';
      layerCtx.drawImage(maskCanvas, 0, 0);
    }
  }

  // 3. 将离线渲染层合并到主 canvas（白底之上）
  ctx.drawImage(layerCanvas, 0, 0);
}

import {
  drawTextItemToCanvas,
  ensureJournalFontsLoaded,
  textFontSize,
} from './text/drawText';

export { textFontSize };

/**
 * 把拼贴项按 z 序合成整张手账页 PNG Data URL：
 * 背景填充（纯色/渐变/网状光斑）→ 各素材（含旋转、柔和投影、横/竖排文本）→ 导出。
 * 任一图片素材加载失败即抛错（fail-fast，不静默跳过）。
 */
export async function composeJournalPage(
  items: JournalMakerItem[],
  options: JournalComposeOptions
): Promise<string> {
  const preset: JournalPagePreset = journalPagePresetOf(options.pageSize);
  const canvas = document.createElement('canvas');
  canvas.width = preset.width;
  canvas.height = preset.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D 不可用');

  paintBackground(ctx, preset.width, preset.height, options.background);

  // 分离图文素材并确保字体已按需加载就绪
  const imageItems = items.filter((it) => it.kind !== 'text');
  const textItems = items.filter((it) => it.kind === 'text');
  const sorted = [...imageItems, ...textItems].sort((a, b) => a.z - b.z);
  const imageLoads = imageItems.length
    ? await Promise.all(
        imageItems.map((it) => loadImage(it.src || ''))
      )
    : [];
  await ensureJournalFontsLoaded(items);

  let imgIdx = 0;
  for (const item of sorted) {
    if (item.kind === 'text') {
      drawTextItemToCanvas(ctx, item, preset.width, preset.height);
      continue;
    }
    const img = imageLoads[imgIdx];
    imgIdx += 1;
    if (!img) continue;
    const w = (item.w / 100) * preset.width;
    const h = w * (img.naturalHeight / img.naturalWidth);
    const cx = (item.x / 100) * preset.width;
    const cy = (item.y / 100) * preset.height;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((item.angle * Math.PI) / 180);
    ctx.shadowColor = 'rgba(15, 23, 42, 0.18)';
    ctx.shadowBlur = Math.max(4, preset.width * 0.008);
    ctx.shadowOffsetY = Math.max(2, preset.height * 0.004);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  return canvas.toDataURL('image/png');
}
