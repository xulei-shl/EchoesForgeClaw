/**
 * 邮票工坊物理质感离线渲染主引擎（Stamp Studio Rendering Engine）
 * 统一集成：底纸岁月质感、印刷分色、防伪底纹、古典边框角饰、视窗羽化遮罩、
 * 经典铭记面额、原有自由文字图层、复古盖销邮戳、四种物理齿孔形态与双层立体投影。
 */

import type {
  StampCropBox,
  StampEffectOptions,
  StampStudioSettings,
  VignetteShape,
} from './types';
import { separateArtCanvas, clamp01, mix } from './colorSeparation';
import { paintGround } from './ground';
import { paintOrnament } from './ornaments';
import { defaultStudioSettings } from './templates';
import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_COLOR, loadFontFamily } from '../journal/text/fontRegistry';
import { drawVerticalColumns, textFontSize } from '../journal/text/drawText';

/** 邮票常用字体栈 */
const FONT_STACKS = {
  serif: '"Libre Baskerville", "Noto Serif SC", "Songti SC", "SimSun", Georgia, serif',
  didone: '"Playfair Display", "Didot", "Noto Serif SC", Georgia, serif',
  grotesque: '"Cinzel", "Copperplate", "Noto Sans SC", "SimHei", sans-serif',
  condensed: '"Oswald", "Impact", "Arial Narrow", "Noto Sans SC", sans-serif',
  typewriter: '"Special Elite", "Courier New", monospace',
  script: '"Pinyon Script", "Kaiti SC", "STKaiti", cursive',
};

/** 确定性伪随机数生成器 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** 依据纸张泛黄程度计算基础纸张色 */
function paperBaseColor(toning: number): string {
  const t = clamp01(toning);
  const r = Math.round(mix(255, 218, t));
  const g = Math.round(mix(255, 196, t));
  const b = Math.round(mix(255, 156, t));
  return `rgb(${r}, ${g}, ${b})`;
}

/** 绘制底纸质感：基底泛黄、潮湿霉斑 (Foxing)、岁月折痕磨损 (Wear) */
function paintPaperTexture(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: StampStudioSettings
) {
  ctx.fillStyle = paperBaseColor(s.toning);
  ctx.fillRect(0, 0, w, h);

  const rand = rng(0x51a3);

  // 潮湿霉斑 (Foxing)
  if (s.foxing > 0.01) {
    const spots = Math.round(s.foxing * 50);
    for (let i = 0; i < spots; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const rad = (0.006 + rand() * 0.026) * Math.min(w, h);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const alpha = 0.08 + rand() * 0.28 * s.foxing;
      grad.addColorStop(0, `rgba(146, 96, 44, ${alpha})`);
      grad.addColorStop(1, 'rgba(146, 96, 44, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }

  // 岁月手感折痕 (Wear)
  if (s.wear > 0.01) {
    ctx.save();
    ctx.lineCap = 'round';
    const creases = Math.round(1 + s.wear * 3);
    for (let i = 0; i < creases; i++) {
      const x0 = rand() * w;
      const y0 = rand() * h;
      const ang = rand() * Math.PI;
      const len = (0.4 + rand() * 0.6) * Math.max(w, h);
      ctx.strokeStyle = `rgba(120, 104, 78, ${0.04 + 0.08 * s.wear})`;
      ctx.lineWidth = Math.min(w, h) * 0.005;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(
        x0 + Math.cos(ang) * len * 0.5 + (rand() - 0.5) * 20,
        y0 + Math.sin(ang) * len * 0.5 + (rand() - 0.5) * 20,
        x0 + Math.cos(ang) * len,
        y0 + Math.sin(ang) * len
      );
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** 绘制弧形文本 (如拱顶国名) */
function arcText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  r: number,
  centerAngle: number,
  flip: boolean
) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0);
  const dir = flip ? -1 : 1;
  let a = centerAngle - (dir * total) / (2 * r);
  ctx.textAlign = 'center';
  for (let i = 0; i < chars.length; i++) {
    a += (dir * widths[i]) / (2 * r);
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.rotate(a + (flip ? -Math.PI / 2 : Math.PI / 2));
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
    a += (dir * widths[i]) / (2 * r);
  }
}

/** 构造视窗遮罩路径 (Path2D) */
function createVignettePath(
  shape: VignetteShape,
  x: number,
  y: number,
  w: number,
  h: number
): Path2D {
  const p = new Path2D();
  if (shape === 'circle') {
    const r = Math.min(w, h) / 2;
    p.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
  } else if (shape === 'oval') {
    p.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (shape === 'arch') {
    const r = Math.min(w / 2, h * 0.72);
    p.moveTo(x, y + h);
    p.lineTo(x, y + r);
    p.arcTo(x, y, x + r, y, r);
    p.lineTo(x + w - r, y);
    p.arcTo(x + w, y, x + w, y + r, r);
    p.lineTo(x + w, y + h);
    p.closePath();
  } else {
    p.rect(x, y, w, h);
  }
  return p;
}

/** 绘制古典边框 */
function paintStampFrame(
  ctx: CanvasRenderingContext2D,
  s: StampStudioSettings,
  x: number,
  y: number,
  w: number,
  h: number,
  unit: number
) {
  if (s.frame === 'none') return;
  ctx.save();
  ctx.strokeStyle = s.frameColor;
  ctx.fillStyle = s.frameColor;
  ctx.lineJoin = 'miter';

  if (s.frame === 'rule') {
    ctx.lineWidth = unit * 0.9;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
    return;
  }

  if (s.frame === 'arched') {
    ctx.lineWidth = unit * 1.4;
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = unit * 0.55;
    ctx.strokeRect(x + unit * 1.6, y + unit * 1.6, w - unit * 3.2, h - unit * 3.2);
    ctx.restore();
    return;
  }

  // 经典双线框 (Classic) 与 华丽珠边框 (Ornate)
  ctx.lineWidth = unit * 1.5;
  ctx.strokeRect(x, y, w, h);
  const gap = unit * 2.2;
  ctx.lineWidth = unit * 0.55;
  ctx.strokeRect(x + gap, y + gap, w - 2 * gap, h - 2 * gap);

  if (s.frame === 'classic') {
    // 四角实心色块
    const c = unit * 3.4;
    ctx.fillRect(x, y, c, c);
    ctx.fillRect(x + w - c, y, c, c);
    ctx.fillRect(x, y + h - c, c, c);
    ctx.fillRect(x + w - c, y + h - c, c, c);
    ctx.restore();
    return;
  }

  if (s.frame === 'ornate') {
    // 华丽滚珠珍珠链 (Pearl Band)
    const r = unit * 0.75;
    const step = unit * 2.6;
    const inset = gap / 2;
    const drawPearlLine = (x1: number, y1: number, x2: number, y2: number) => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const n = Math.max(2, Math.round(len / step));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        ctx.beginPath();
        ctx.arc(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    drawPearlLine(x + inset, y + inset, x + w - inset, y + inset);
    drawPearlLine(x + inset, y + h - inset, x + w - inset, y + h - inset);
    drawPearlLine(x + inset, y + inset, x + inset, y + h - inset);
    drawPearlLine(x + w - inset, y + inset, x + w - inset, y + h - inset);
  }
  ctx.restore();
}

/** 绘制复古盖销邮戳 (Postmark) */
function paintPostmark(
  ctx: CanvasRenderingContext2D,
  s: StampStudioSettings,
  w: number,
  h: number
) {
  if (!s.postmarkOn) return;
  const unit = Math.min(w, h) / 110;
  const cx = s.postmarkPos.x * w;
  const cy = (1 - s.postmarkPos.y) * h;
  const ang = (s.postmarkAngle - 0.5) * Math.PI;

  ctx.save();
  ctx.globalAlpha = s.postmarkStrength;
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = '#1c1b1f';
  ctx.strokeStyle = '#1c1b1f';
  ctx.translate(cx, cy);
  ctx.rotate(ang);

  const dial = unit * 17;
  const reach = Math.hypot(w, h);
  const barStart = s.postmarkStyle === 'both' ? dial * 1.15 : -reach / 2;

  // 波浪副戳 (Killer Bars)
  if (s.postmarkStyle === 'bars' || s.postmarkStyle === 'both') {
    ctx.lineWidth = unit * 1.6;
    ctx.lineCap = 'round';
    for (let i = -4; i <= 4; i++) {
      const y = i * unit * 4.2;
      ctx.beginPath();
      for (let t = barStart; t <= reach / 2; t += unit) {
        const yy = y + Math.sin(t / (unit * 9)) * unit * 1.2;
        if (t === barStart) ctx.moveTo(t, yy);
        else ctx.lineTo(t, yy);
      }
      ctx.stroke();
    }
  }

  // 网格戳 (Grid)
  if (s.postmarkStyle === 'grid') {
    ctx.lineWidth = unit * 1.1;
    for (let i = -6; i <= 6; i++) {
      ctx.beginPath();
      ctx.moveTo(i * unit * 4, -reach / 2);
      ctx.lineTo(i * unit * 4, reach / 2);
      ctx.moveTo(-reach / 2, i * unit * 4);
      ctx.lineTo(reach / 2, i * unit * 4);
      ctx.stroke();
    }
  }

  // 圆形日戳 (Datestamp)
  if (s.postmarkStyle === 'datestamp' || s.postmarkStyle === 'both') {
    ctx.lineWidth = unit * 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, dial, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = unit * 0.6;
    ctx.beginPath();
    ctx.arc(0, 0, dial - unit * 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.font = `600 ${unit * 3.4}px "Libre Baskerville", Georgia, serif`;
    arcText(ctx, s.postmarkCity.toUpperCase(), 0, 0, dial - unit * 4.6, -Math.PI / 2, false);

    ctx.textAlign = 'center';
    ctx.font = `600 ${unit * 3.6}px "Libre Baskerville", Georgia, serif`;
    ctx.fillText(s.postmarkDate.toUpperCase(), 0, 0);

    ctx.lineWidth = unit * 0.7;
    ctx.beginPath();
    ctx.moveTo(-dial * 0.7, -unit * 5.6);
    ctx.lineTo(dial * 0.7, -unit * 5.6);
    ctx.moveTo(-dial * 0.7, unit * 5.6);
    ctx.lineTo(dial * 0.7, unit * 5.6);
    ctx.stroke();
  }

  ctx.restore();
}


/**
 * 绘制邮票正面票面全部艺术图层（底纸、分色、底纹、视窗羽化、边框、角饰、铭记、自由文字、邮戳）
 * 可直接用于选框内毫秒级实时预览，亦用于最终渲染导出
 */
export function paintStampFace(
  targetCanvas: HTMLCanvasElement,
  sourceImg: HTMLImageElement,
  cropBox: StampCropBox,
  options: StampEffectOptions = {}
) {
  const natW = sourceImg.naturalWidth || sourceImg.width;
  const natH = sourceImg.naturalHeight || sourceImg.height;
  if (!natW || !natH) return;

  const sx = Math.max(0, Math.min(natW, Math.round(cropBox.x * natW)));
  const sy = Math.max(0, Math.min(natH, Math.round(cropBox.y * natH)));
  const sWidth = Math.max(10, Math.min(natW - sx, Math.round(cropBox.width * natW)));
  const sHeight = Math.max(10, Math.min(natH - sy, Math.round(cropBox.height * natH)));

  const s: StampStudioSettings = {
    ...defaultStudioSettings,
    ...(options.studioSettings || {}),
  };

  const withMargin = options.withMargin !== false;
  const marginPx = withMargin
    ? options.margin !== undefined
      ? options.margin
      : Math.round(Math.min(sWidth, sHeight) * s.margin)
    : 0;

  const sw = sWidth + marginPx * 2;
  const sh = sHeight + marginPx * 2;
  const unit = Math.min(sw, sh) / 110;

  targetCanvas.width = sw;
  targetCanvas.height = sh;
  const ctx = targetCanvas.getContext('2d');
  if (!ctx) return;

  // 1. 底纸质感
  if (s.designOn) {
    paintPaperTexture(ctx, sw, sh, s);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sw, sh);
  }

  // 2. 准备源图裁剪离屏 Canvas
  const artCropCanvas = document.createElement('canvas');
  artCropCanvas.width = sWidth;
  artCropCanvas.height = sHeight;
  const artCropCtx = artCropCanvas.getContext('2d');
  if (artCropCtx) {
    artCropCtx.drawImage(sourceImg, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
  }

  // 3. 印刷分色
  const separatedCanvas = s.designOn
    ? separateArtCanvas(artCropCanvas, s.print, s.inkColor)
    : artCropCanvas;

  // 4. 防伪底纹
  if (s.designOn && s.ground !== 'none') {
    const outerBox = { x: marginPx, y: marginPx, w: sWidth, h: sHeight };
    paintGround(
      ctx,
      {
        style: s.ground,
        color: s.groundColor,
        weight: s.groundWeight,
        scale: s.groundScale,
        angle: s.groundAngle,
        strength: s.groundStrength,
      },
      outerBox,
      unit
    );
  }

  // 5. 图像画面（视窗遮罩与羽化）
  ctx.save();
  const vShape = s.designOn ? s.vignette : 'none';
  const featherPx = s.designOn ? s.feather * Math.min(sWidth, sHeight) * 0.15 : 0;

  if (vShape === 'none' && featherPx < 0.5) {
    ctx.drawImage(separatedCanvas, marginPx, marginPx, sWidth, sHeight);
  } else {
    const tmp = document.createElement('canvas');
    tmp.width = sWidth;
    tmp.height = sHeight;
    const tctx = tmp.getContext('2d');
    if (tctx) {
      tctx.drawImage(separatedCanvas, 0, 0, sWidth, sHeight);
      tctx.globalCompositeOperation = 'destination-in';
      if (featherPx >= 0.5) {
        tctx.filter = `blur(${featherPx.toFixed(1)}px)`;
      }
      tctx.fillStyle = '#000000';
      tctx.fill(createVignettePath(vShape, 0, 0, sWidth, sHeight));
      ctx.drawImage(tmp, marginPx, marginPx);
    }
  }
  ctx.restore();

  // 6. 边框与视窗金色细线
  if (s.designOn) {
    paintStampFrame(ctx, s, marginPx, marginPx, sWidth, sHeight, unit);
    if (vShape !== 'none' && s.vignetteRule) {
      ctx.save();
      ctx.strokeStyle = s.vignetteColor;
      ctx.lineWidth = unit * 1.1;
      ctx.stroke(createVignettePath(vShape, marginPx, marginPx, sWidth, sHeight));
      ctx.restore();
    }
  }

  // 7. 蚀刻角饰
  if (s.designOn && s.ornament !== 'none') {
    ctx.fillStyle = s.frameColor;
    const os = s.ornamentSize * Math.min(sw, sh);
    const inset = unit * 3;
    const l = marginPx + inset;
    const t = marginPx + inset;
    const r = marginPx + sWidth - inset;
    const b = marginPx + sHeight - inset;
    paintOrnament(ctx, s.ornament, l, t, os, false, false);
    paintOrnament(ctx, s.ornament, r, t, os, true, false);
    if (!s.tablets) {
      paintOrnament(ctx, s.ornament, l, b, os, false, true);
      paintOrnament(ctx, s.ornament, r, b, os, true, true);
    }
  }

  // 8. 铭记、面额、副题
  if (s.designOn) {
    ctx.save();
    ctx.fillStyle = s.frameColor;
    ctx.strokeStyle = s.frameColor;
    const face = FONT_STACKS[s.typeface] || FONT_STACKS.serif;

    if (s.country) {
      ctx.font = `600 ${unit * 4.2}px ${face}`;
      if (s.countryArc && (vShape === 'arch' || vShape === 'oval' || vShape === 'circle')) {
        const r = Math.min(sWidth / 2, sHeight * 0.72);
        arcText(
          ctx,
          s.country.toUpperCase(),
          marginPx + sWidth / 2,
          marginPx + r,
          r + unit * 3.2,
          -Math.PI / 2,
          false
        );
      } else {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(s.country.toUpperCase(), marginPx + sWidth / 2, marginPx + unit * 5.2);
      }
    }

    if (s.denomination) {
      if (s.tablets) {
        const tw = unit * 13;
        const th = unit * 9.5;
        const ty = marginPx + sHeight - th - unit * 2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `700 ${unit * 6.5}px ${face}`;
        for (const tx of [marginPx + unit * 2, marginPx + sWidth - unit * 2 - tw]) {
          ctx.fillRect(tx, ty, tw, th);
          ctx.save();
          ctx.fillStyle = paperBaseColor(s.toning);
          ctx.fillText(s.denomination, tx + tw / 2, ty + th / 2);
          ctx.restore();
        }
      } else {
        ctx.font = `700 ${unit * 6.5}px ${face}`;
        ctx.textAlign = s.denomAnchor.includes('right') ? 'right' : 'left';
        ctx.textBaseline = 'alphabetic';
        const ax = s.denomAnchor.includes('right')
          ? marginPx + sWidth - unit * 3
          : marginPx + unit * 3;
        const ay = marginPx + sHeight - unit * 2.5;
        ctx.fillText(s.denomination, ax, ay);
      }
    }

    if (s.caption) {
      if (s.ribbon) {
        const rw = Math.min(sWidth * 0.55, unit * 44);
        const rh = unit * 5;
        const rx = marginPx + (sWidth - rw) / 2;
        const ry = marginPx + sHeight - rh - (s.tablets ? unit * 4.5 : unit * 2.5);
        ctx.lineWidth = unit * 0.6;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx + rw, ry);
        ctx.lineTo(rx + rw - unit * 2, ry + rh / 2);
        ctx.lineTo(rx + rw, ry + rh);
        ctx.lineTo(rx, ry + rh);
        ctx.lineTo(rx + unit * 2, ry + rh / 2);
        ctx.closePath();
        ctx.stroke();
        ctx.font = `600 ${unit * 3.2}px ${face}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.caption.toUpperCase(), rx + rw / 2, ry + rh / 2);
      } else {
        ctx.font = `500 ${unit * 3.2}px ${face}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(s.caption, marginPx + sWidth / 2, marginPx + sHeight - unit * 2.5);
      }
    }
    ctx.restore();
  }

  // 9. 自由文字素材图层
  if (options.textItems && options.textItems.length > 0) {
    const sortedTexts = [...options.textItems].sort((a, b) => a.z - b.z);
    for (const item of sortedTexts) {
      const text = item.text || '';
      if (!text.trim()) continue;

      const fontFamily = item.fontFamily || DEFAULT_FONT_FAMILY;
      const color = item.color || DEFAULT_TEXT_COLOR;
      const fontSize = Math.max(10, textFontSize(item.w, sw));
      const isVertical = item.writingMode === 'vertical';

      const cx = (item.x / 100) * sw;
      const cy = (item.y / 100) * sh;

      ctx.save();
      ctx.translate(cx, cy);
      if (item.angle) {
        ctx.rotate((item.angle * Math.PI) / 180);
      }

      const align = item.textAlign || 'center';
      ctx.font = `${fontSize}px "${fontFamily}", "Noto Serif SC", serif, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
      ctx.shadowBlur = Math.max(1, fontSize * 0.08);
      ctx.shadowOffsetY = Math.max(1, fontSize * 0.04);

      if (isVertical) {
        ctx.textAlign = 'center';
        drawVerticalColumns(ctx, text, fontSize, (str, x, y) => ctx.fillText(str, x, y), align);
      } else {
        const lines = text.split('\n');
        const lineH = fontSize * 1.25;
        const maxLineWidth = Math.max(...lines.map((l) => ctx.measureText(l).width || 0), 0);
        ctx.textAlign = align;
        lines.forEach((line, i) => {
          const yOffset = (i - (lines.length - 1) / 2) * lineH;
          let xOffset = 0;
          if (align === 'left') xOffset = -maxLineWidth / 2;
          else if (align === 'right') xOffset = maxLineWidth / 2;
          ctx.fillText(line, xOffset, yOffset);
        });
      }
      ctx.restore();
    }
  }

  // 10. 盖销邮戳
  if (s.designOn && s.postmarkOn) {
    paintPostmark(ctx, s, sw, sh);
  }

  return { sw, sh, sWidth, sHeight, marginPx, s };
}

/**
 * 核心统一渲染导出函数（票面绘制 + 物理齿孔打孔 + 双层立体投影）
 */
export async function renderStampCore(
  sourceImg: HTMLImageElement,
  cropBox: StampCropBox,
  options: StampEffectOptions = {}
): Promise<string> {
  const natW = sourceImg.naturalWidth || sourceImg.width;
  const natH = sourceImg.naturalHeight || sourceImg.height;
  if (!natW || !natH) throw new Error('源图片尺寸无效');

  // 预加载自由文字所需字体
  if (options.textItems && options.textItems.length > 0) {
    const families = Array.from(
      new Set(options.textItems.map((it) => it.fontFamily || DEFAULT_FONT_FAMILY))
    );
    await Promise.all(families.map((f) => loadFontFamily(f)));
  }

  // 1. 绘制票面
  const stampCanvas = document.createElement('canvas');
  const result = paintStampFace(stampCanvas, sourceImg, cropBox, options);
  if (!result) throw new Error('绘制邮票票面失败');

  const { sw, sh, sWidth, sHeight, marginPx, s } = result;
  const scaleFactor = Math.max(0.6, Math.min(3.5, sWidth / 600));

  const holeRadius = options.holeRadius || Math.round(13 * scaleFactor);
  const pitch = options.pitch || Math.round(holeRadius * 2 + 16 * scaleFactor);
  const outerPad = options.outerPad || Math.round(64 * scaleFactor);
  const ctx = stampCanvas.getContext('2d');
  if (!ctx) throw new Error('创建 Canvas 上下文失败');


  // 2. 齿孔与边缘工艺裁切 (Perforations & Edges)
  const edge = s.edge || 'perforated';

  if (edge !== 'imperforate') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000000';

    if (edge === 'perforated') {
      // 标准打孔齿孔
      const numH = Math.max(1, Math.round((sw - pitch) / pitch));
      const startH = (sw - numH * pitch) / 2 + pitch / 2;
      for (let i = 0; i <= numH; i++) {
        const cx = startH + i * pitch - pitch / 2;
        ctx.beginPath();
        ctx.arc(cx, 0, holeRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, sh, holeRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      const numV = Math.max(1, Math.round((sh - pitch) / pitch));
      const startV = (sh - numV * pitch) / 2 + pitch / 2;
      for (let i = 0; i <= numV; i++) {
        const cy = startV + i * pitch - pitch / 2;
        ctx.beginPath();
        ctx.arc(0, cy, holeRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sw, cy, holeRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      // 多联内部分割线打孔
      const rows = Math.max(1, Math.min(10, options.grid?.rows || 1));
      const cols = Math.max(1, Math.min(10, options.grid?.cols || 1));
      if (rows > 1) {
        for (let r = 1; r < rows; r++) {
          const cy = marginPx + (r / rows) * sHeight;
          for (let i = 0; i <= numH; i++) {
            const cx = startH + i * pitch - pitch / 2;
            ctx.beginPath();
            ctx.arc(cx, cy, holeRadius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      if (cols > 1) {
        for (let c = 1; c < cols; c++) {
          const cx = marginPx + (c / cols) * sWidth;
          for (let i = 0; i <= numV; i++) {
            const cy = startV + i * pitch - pitch / 2;
            ctx.beginPath();
            ctx.arc(cx, cy, holeRadius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    } else if (edge === 'wavy') {
      // 波浪剪切边缘 (Wavy die-cut)
      const waveAmp = holeRadius * 0.75;
      const wavePitch = pitch * 1.5;
      // 顶部与底部
      for (let x = 0; x <= sw; x += 2) {
        const yTop = Math.sin((x / wavePitch) * Math.PI * 2) * waveAmp;
        if (yTop > 0) ctx.fillRect(x, 0, 2, yTop);
        const yBottom = Math.sin((x / wavePitch) * Math.PI * 2) * waveAmp;
        if (yBottom < 0) ctx.fillRect(x, sh + yBottom, 2, -yBottom);
      }
      // 左侧与右侧
      for (let y = 0; y <= sh; y += 2) {
        const xLeft = Math.sin((y / wavePitch) * Math.PI * 2) * waveAmp;
        if (xLeft > 0) ctx.fillRect(0, y, xLeft, 2);
        const xRight = Math.sin((y / wavePitch) * Math.PI * 2) * waveAmp;
        if (xRight < 0) ctx.fillRect(sw + xRight, y, -xRight, 2);
      }
    } else if (edge === 'rouletted') {
      // 滚刀点孔 (Rouletted slits)
      const slitLen = holeRadius * 1.8;
      const slitStep = pitch * 0.8;
      ctx.lineWidth = Math.max(1.5, holeRadius * 0.35);
      // 顶底
      for (let x = 0; x <= sw; x += slitStep) {
        ctx.fillRect(x, 0, slitLen, ctx.lineWidth);
        ctx.fillRect(x, sh - ctx.lineWidth, slitLen, ctx.lineWidth);
      }
      // 左右
      for (let y = 0; y <= sh; y += slitStep) {
        ctx.fillRect(0, y, ctx.lineWidth, slitLen);
        ctx.fillRect(sw - ctx.lineWidth, y, ctx.lineWidth, slitLen);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // 3. 合成四周柔和自然立体阴影
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = sw + outerPad * 2;
  finalCanvas.height = sh + outerPad * 2;
  const finalCtx = finalCanvas.getContext('2d');
  if (!finalCtx) throw new Error('创建最终 Canvas 上下文失败');

  if (options.bgColor) {
    finalCtx.fillStyle = options.bgColor;
    finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
  }

  finalCtx.save();
  // 底层弥散浅柔影
  finalCtx.shadowColor = 'rgba(0, 0, 0, 0.18)';
  finalCtx.shadowBlur = Math.round(20 * scaleFactor);
  finalCtx.shadowOffsetX = Math.round(2 * scaleFactor);
  finalCtx.shadowOffsetY = Math.round(8 * scaleFactor);
  finalCtx.drawImage(stampCanvas, outerPad, outerPad);

  // 顶层硬质轮廓影
  finalCtx.shadowColor = 'rgba(0, 0, 0, 0.12)';
  finalCtx.shadowBlur = Math.round(8 * scaleFactor);
  finalCtx.shadowOffsetX = Math.round(1 * scaleFactor);
  finalCtx.shadowOffsetY = Math.round(3 * scaleFactor);
  finalCtx.drawImage(stampCanvas, outerPad, outerPad);
  finalCtx.restore();

  // 覆盖邮票本体
  finalCtx.drawImage(stampCanvas, outerPad, outerPad);

  return finalCanvas.toDataURL('image/png');
}
