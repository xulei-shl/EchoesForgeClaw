import { urlToDataUrl } from '../../../bookplate/imageUpload';

/**
 * 确保外部图片安全加载并转为 HTMLImageElement
 */
export async function loadImageSafe(src: string): Promise<HTMLImageElement | null> {
  let safeSrc = src;
  if (!src.startsWith('data:') && !src.startsWith('blob:') && !src.startsWith('/')) {
    try {
      safeSrc = await urlToDataUrl(src);
    } catch {
      safeSrc = src;
    }
  }

  return new Promise((resolve) => {
    const img = new Image();
    if (!safeSrc.startsWith('data:') && !safeSrc.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => {
      resolve(null);
    };
    img.src = safeSrc;
  });
}

/**
 * 等待网页所有字体就绪（避免 Canvas 导出时手写/印章等字体降级为默认字体）
 */
export async function ensureFontsReady(): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // 忽略字体就绪异常
    }
  }
}

/**
 * 绘制水平虚线
 */
export function drawDashedLine(
  ctx: CanvasRenderingContext2D,
  y: number,
  width: number,
  color: string
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(32, y);
  ctx.lineTo(width - 32, y);
  ctx.stroke();
  ctx.restore();
}

/**
 * 绘制圆角虚线矩形框
 */
export function drawDashedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  r = 4
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * 绘制顶部与底部锯齿撕纸边
 */
export function drawZigzagPaper(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bgColor: string,
  toothSize = 8
): void {
  ctx.save();
  ctx.fillStyle = bgColor;
  ctx.beginPath();

  // 顶部锯齿（从左向右）
  ctx.moveTo(0, toothSize);
  const teethCount = Math.floor(width / (toothSize * 2));
  const step = width / teethCount;

  for (let i = 0; i < teethCount; i++) {
    const x = i * step;
    ctx.lineTo(x + step / 2, 0);
    ctx.lineTo(x + step, toothSize);
  }

  // 右边缘
  ctx.lineTo(width, height - toothSize);

  // 底部锯齿（从右向左）
  for (let i = teethCount; i > 0; i--) {
    const x = (i - 1) * step;
    ctx.lineTo(x + step / 2, height);
    ctx.lineTo(x, height - toothSize);
  }

  // 左边缘闭合
  ctx.lineTo(0, toothSize);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
