/**
 * 图片热敏点阵化（Dithering）算法模块
 *
 * 将彩色或灰度图像转换为具有经典热敏打印纸质感的黑白点阵颗粒图像。
 * 纯 Canvas 原生像素操作，零外部依赖，极速轻量。
 */

/** 抖动算法类型 */
export type DitherAlgorithm = 'atkinson' | 'floyd_steinberg' | 'threshold';

/**
 * 在 Canvas 像素上下文上应用点阵抖动算法
 */
export function applyDitherToImageData(
  imageData: ImageData,
  algorithm: DitherAlgorithm = 'atkinson',
  contrast = 1.1,
  brightness = 0
): ImageData {
  const { width, height, data } = imageData;
  // 建立灰度值二维缓冲（浮点数便于误差扩散）
  const grayBuffer = new Float32Array(width * height);

  // 1. 转灰度并调节亮度和对比度
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // 感知灰度加权
    let luma = 0.299 * r + 0.587 * g + 0.114 * b;
    // 亮度偏移
    luma += brightness;
    // 对比度变换
    luma = (luma - 128) * contrast + 128;
    // clamp 到 0~255
    grayBuffer[i / 4] = Math.max(0, Math.min(255, luma));
  }

  // 2. 误差扩散抖动
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldVal = grayBuffer[idx];
      // 二值化阈值 128
      const newVal = oldVal < 128 ? 0 : 255;
      const err = oldVal - newVal;
      grayBuffer[idx] = newVal;

      if (algorithm === 'atkinson') {
        // Atkinson 算法（经典 Mac / 热敏小票颗粒感最强，保留高对比度细节）
        // 误差按 1/8 分散到邻近 6 个点
        const distribute = (dx: number, dy: number) => {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            grayBuffer[ny * width + nx] += (err >> 3); // err / 8
          }
        };
        distribute(1, 0);
        distribute(2, 0);
        distribute(-1, 1);
        distribute(0, 1);
        distribute(1, 1);
        distribute(0, 2);
      } else if (algorithm === 'floyd_steinberg') {
        // Floyd-Steinberg 算法（经典平滑扩散）
        const distribute = (dx: number, dy: number, weight: number) => {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            grayBuffer[ny * width + nx] += (err * weight) / 16;
          }
        };
        distribute(1, 0, 7);
        distribute(-1, 1, 3);
        distribute(0, 1, 5);
        distribute(1, 1, 1);
      }
      // threshold: 简单硬截断，不做扩散
    }
  }

  // 3. 写回 ImageData (RGB 写入二值，Alpha 保持不透明)
  for (let i = 0; i < grayBuffer.length; i++) {
    const val = grayBuffer[i] < 128 ? 0 : 255;
    const pixelIdx = i * 4;
    data[pixelIdx] = val;
    data[pixelIdx + 1] = val;
    data[pixelIdx + 2] = val;
    data[pixelIdx + 3] = 255;
  }

  return imageData;
}

import { urlToDataUrl } from '../../../../core/imageUpload';

/**
 * 加载图片并生成热敏点阵化 PNG Data URL
 */
export async function createDitheredImage(
  imageSrc: string,
  options?: {
    algorithm?: DitherAlgorithm;
    targetWidth?: number;
    contrast?: number;
    brightness?: number;
  }
): Promise<string> {
  const { algorithm = 'atkinson', targetWidth = 360, contrast = 1.15, brightness = 5 } = options || {};

  let safeSrc = imageSrc;
  if (!imageSrc.startsWith('data:') && !imageSrc.startsWith('blob:')) {
    try {
      safeSrc = await urlToDataUrl(imageSrc);
    } catch {
      safeSrc = imageSrc;
    }
  }

  return new Promise((resolve) => {
    const img = new Image();
    if (!safeSrc.startsWith('data:') && !safeSrc.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      try {
        const aspect = img.height / img.width;
        const width = Math.min(img.width, targetWidth);
        const height = Math.round(width * aspect);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(safeSrc);
          return;
        }

        // 绘制缩放图片
        ctx.drawImage(img, 0, 0, width, height);
        const imgData = ctx.getImageData(0, 0, width, height);

        // 应用点阵滤镜
        applyDitherToImageData(imgData, algorithm, contrast, brightness);
        ctx.putImageData(imgData, 0, 0);

        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        console.warn('点阵化处理异常，回退原图:', err);
        resolve(safeSrc);
      }
    };
    img.onerror = () => {
      resolve(safeSrc);
    };
    img.src = safeSrc;
  });
}
