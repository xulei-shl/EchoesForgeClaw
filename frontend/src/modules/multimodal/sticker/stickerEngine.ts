/**
 * 贴纸静态渲染引擎：抠图结果（或任意带透明通道图片）→ die-cut 白边描边 → 投影 → PNG。
 * 距离变换描边移植自 services/sticker-forge/lib/source.ts（MIT），
 * 纯 Canvas 实现、零 WebGL 依赖，与邮票截图框同属浏览器端合成图片后输出。
 */
import type { StickerOutlineOptions, StickerRenderOptions } from './types';

const VISIBLE_ALPHA_THRESHOLD = 0.1 * 255;
const DISTANCE_INFINITY = 1_000_000_000_000;

/** 默认投影参数（与参考项目 ExportDialog 基础款口径一致） */
export const DEFAULT_STICKER_SHADOW = {
  enabled: true,
  distance: 16,
  blur: 22,
  angle: 42,
  opacity: 0.22,
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  if (!/^(data:|blob:|https?:|\/|\.\.?\/)/i.test(src)) {
    throw new Error('图片地址必须为相对路径或 data/blob/HTTP(S)');
  }

  // 1. 若为远程 HTTP/HTTPS 地址，优先尝试 fetch 转同源 Blob URL，规避浏览器缓存导致的 CORS 混淆
  if (/^https?:/i.test(src)) {
    try {
      const response = await fetch(src, { mode: 'cors' });
      if (response.ok) {
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.decoding = 'async';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            URL.revokeObjectURL(blobUrl);
            resolve();
          };
          img.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            reject();
          };
          img.src = blobUrl;
        });
        if (!img.naturalWidth || !img.naturalHeight) {
          throw new Error('图片没有可绘制尺寸');
        }
        return img;
      }
    } catch {
      // 降级常规 Image 加载
    }
  }

  // 2. 常规 Image 加载
  const image = new Image();
  image.decoding = 'async';
  if (/^https?:/i.test(src)) image.crossOrigin = 'anonymous';
  image.src = src;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error('图片没有可绘制尺寸');
  }
  return image;
}

/**
 * 一维抛物线包络距离变换（Felzenszwalb & Huttenlocher 算法）。
 * 对种子点集做精确欧氏距离平方场。
 */
function distanceTransform1D(
  source: Float32Array,
  sourceOffset: number,
  sourceStride: number,
  target: Float32Array,
  targetOffset: number,
  targetStride: number,
  length: number,
  parabolas: Int32Array,
  boundaries: Float64Array,
) {
  let envelopeIndex = 0;
  parabolas[0] = 0;
  boundaries[0] = Number.NEGATIVE_INFINITY;
  boundaries[1] = Number.POSITIVE_INFINITY;

  for (let position = 1; position < length; position += 1) {
    let previous = parabolas[envelopeIndex];
    let intersection =
      (source[sourceOffset + position * sourceStride] + position * position -
        (source[sourceOffset + previous * sourceStride] + previous * previous)) /
      (2 * position - 2 * previous);
    while (intersection <= boundaries[envelopeIndex]) {
      envelopeIndex -= 1;
      previous = parabolas[envelopeIndex];
      intersection =
        (source[sourceOffset + position * sourceStride] + position * position -
          (source[sourceOffset + previous * sourceStride] + previous * previous)) /
        (2 * position - 2 * previous);
    }
    envelopeIndex += 1;
    parabolas[envelopeIndex] = position;
    boundaries[envelopeIndex] = intersection;
    boundaries[envelopeIndex + 1] = Number.POSITIVE_INFINITY;
  }

  envelopeIndex = 0;
  for (let position = 0; position < length; position += 1) {
    while (boundaries[envelopeIndex + 1] < position) envelopeIndex += 1;
    const nearest = parabolas[envelopeIndex];
    const delta = position - nearest;
    target[targetOffset + position * targetStride] =
      delta * delta + source[sourceOffset + nearest * sourceStride];
  }
}

/** 将 alpha 轮廓按圆形欧氏结构向外扩张指定半径（连续羽化边缘） */
function expandAlpha(source: HTMLCanvasElement, radius: number) {
  const width = source.width;
  const height = source.height;
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) throw new Error('Canvas 2D 不可用');
  const sourcePixels = sourceContext.getImageData(0, 0, width, height).data;
  const size = width * height;
  const seeds = new Float32Array(size);
  const rowDistances = new Float32Array(size);
  let hasSeed = false;

  for (let pixel = 0; pixel < size; pixel += 1) {
    const occupied = sourcePixels[pixel * 4 + 3] >= VISIBLE_ALPHA_THRESHOLD;
    seeds[pixel] = occupied ? 0 : DISTANCE_INFINITY;
    hasSeed ||= occupied;
  }

  const maxLength = Math.max(width, height);
  const parabolas = new Int32Array(maxLength);
  const boundaries = new Float64Array(maxLength + 1);
  if (hasSeed) {
    for (let y = 0; y < height; y += 1) {
      distanceTransform1D(seeds, y * width, 1, rowDistances, y * width, 1, width, parabolas, boundaries);
    }
    for (let x = 0; x < width; x += 1) {
      distanceTransform1D(rowDistances, x, width, seeds, x, width, height, parabolas, boundaries);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D 不可用');
  const mask = context.createImageData(width, height);
  for (let pixel = 0; pixel < size; pixel += 1) {
    const coverage = hasSeed
      ? clamp(radius + 0.5 - Math.sqrt(seeds[pixel]), 0, 1)
      : 0;
    const offset = pixel * 4;
    mask.data[offset] = 255;
    mask.data[offset + 1] = 255;
    mask.data[offset + 2] = 255;
    mask.data[offset + 3] = Math.round(coverage * 255);
  }
  context.putImageData(mask, 0, 0);
  return canvas;
}

/** 用指定颜色填充源画布的 alpha 形状 */
function tintAlpha(source: HTMLCanvasElement, color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D 不可用');
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(source, 0, 0);
  return canvas;
}

/** 在贴纸内容外围合成 die-cut 白边 */
function addOutline(
  source: HTMLCanvasElement,
  outline: StickerOutlineOptions,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D 不可用');

  const radius = clamp(outline.width * 2.35, 0, 112);
  if (radius > 0.25) {
    const expandedAlpha = expandAlpha(source, radius);
    context.drawImage(tintAlpha(expandedAlpha, outline.color), 0, 0);
  }
  context.drawImage(source, 0, 0);
  return canvas;
}

/**
 * 从源图渲染静态贴纸 PNG Data URL：
 * 内容缩放入框 → die-cut 白边 → 可选投影 → 导出。
 * 若源图为不透明 JPEG，白边会沿矩形轮廓生成（与参考项目语义一致）；
 * 建议先经「移除背景」再生成。
 */
export async function renderStickerFromImage(
  source: string,
  options: StickerRenderOptions,
): Promise<string> {
  const image = await loadImage(source);
  const maxEdge = clamp(options.maxEdge ?? 1600, 320, 4096);

  const outlineRadius = clamp(options.outline.width * 2.35, 0, 112);
  const shadowMargin = options.shadow.enabled
    ? Math.ceil(
        Math.abs(Math.cos((options.shadow.angle * Math.PI) / 180)) * options.shadow.distance +
          options.shadow.blur +
          Math.abs(Math.sin((options.shadow.angle * Math.PI) / 180)) * options.shadow.distance,
      )
    : 0;
  // expandAlpha 在同尺寸画布内向外扩张，超出画布边界的部分会被裁剪，
  // 因此内容四周必须预留 outlineRadius + 投影余量的 padding。
  const padding = Math.ceil(outlineRadius + shadowMargin) + 2;

  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  const aspect = clamp(naturalWidth / naturalHeight, 0.15, 8);
  const contentBox = Math.max(64, maxEdge - padding * 2);
  const contentMaxSide = Math.min(contentBox, Math.max(naturalWidth, naturalHeight));
  const contentWidth = aspect >= 1 ? contentMaxSide : Math.round(contentMaxSide * aspect);
  const contentHeight = aspect >= 1 ? Math.round(contentMaxSide / aspect) : contentMaxSide;
  const width = contentWidth + padding * 2;
  const height = contentHeight + padding * 2;

  const work = document.createElement('canvas');
  work.width = width;
  work.height = height;
  const workContext = work.getContext('2d', { willReadFrequently: true });
  if (!workContext) throw new Error('Canvas 2D 不可用');
  workContext.clearRect(0, 0, width, height);
  workContext.drawImage(image, padding, padding, contentWidth, contentHeight);

  const outlined = addOutline(work, options.outline);

  const output = document.createElement('canvas');
  output.width = outlined.width;
  output.height = outlined.height;
  const outputContext = output.getContext('2d');
  if (!outputContext) throw new Error('Canvas 2D 不可用');

  if (options.shadow.enabled) {
    const angleRad = (options.shadow.angle * Math.PI) / 180;
    outputContext.save();
    outputContext.shadowColor = `rgba(0, 0, 0, ${clamp(options.shadow.opacity, 0, 1)})`;
    outputContext.shadowBlur = options.shadow.blur;
    outputContext.shadowOffsetX = Math.cos(angleRad) * options.shadow.distance;
    outputContext.shadowOffsetY = Math.sin(angleRad) * options.shadow.distance;
    outputContext.drawImage(outlined, 0, 0);
    outputContext.restore();
  } else {
    outputContext.drawImage(outlined, 0, 0);
  }

  return output.toDataURL('image/png');
}
