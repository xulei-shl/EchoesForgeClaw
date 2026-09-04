/**
 * 图像处理工具函数（加载、CORS 规范化、尺寸缩放与背景合成）
 */

/**
 * 安全加载图片：优先通过 CORS Fetch 转 Blob URL，规避浏览器缓存导致的跨域污染
 */
export async function loadSafeImage(source: string): Promise<HTMLImageElement> {
  // 1. 若为远程 HTTP/HTTPS 地址，优先尝试 fetch 转同源 Blob URL
  if (/^https?:/i.test(source)) {
    try {
      const response = await fetch(source, { mode: 'cors' });
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
        return img;
      }
    } catch {
      // 忽略 fetch 失败，降级使用常规 Image 跨域加载
    }
  }

  // 2. 常规 Image 元素跨域加载
  const image = new Image();
  image.decoding = 'async';
  if (/^https?:/i.test(source)) {
    image.crossOrigin = 'anonymous';
  }
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () =>
      reject(new Error('源图片加载失败或受跨域（CORS）限制，无法读取'));
    image.src = source;
  });
  return image;
}

/**
 * 预处理并规范化输入源图片为标准 PNG Blob
 */
export async function normalizeImageSource(
  source: string,
  maxEdge = 4096,
): Promise<Blob> {
  const image = await loadSafeImage(source);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) {
    throw new Error('源图片没有可见尺寸');
  }

  const scale = Math.min(1, maxEdge / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 不可用');

  context.drawImage(image, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('无法预处理图片'))),
      'image/png',
    );
  });
}

/**
 * 将像素缓冲区绘制到 Canvas
 */
export function pixelsToCanvas(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 不可用');
  context.putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas;
}

/**
 * 根据纯色背景或透明配置合成最终图片产物
 */
export async function compositeBackground(
  cutoutCanvas: HTMLCanvasElement,
  bgColor?: string,
): Promise<{ dataUrl: string; blob: Blob }> {
  const { width, height } = cutoutCanvas;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 不可用');

  // 如果指定了纯色背景
  if (bgColor && bgColor.trim() !== '') {
    context.fillStyle = bgColor;
    context.fillRect(0, 0, width, height);
  }

  context.drawImage(cutoutCanvas, 0, 0);

  const dataUrl = canvas.toDataURL('image/png');
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('无法生成 PNG Blob'))),
      'image/png',
    );
  });

  return { dataUrl, blob };
}
