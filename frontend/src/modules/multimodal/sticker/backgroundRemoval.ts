/**
 * 抠图 Worker 客户端：请求队列 / 进度回调 / 崩溃单次重试。
 * 移植自 services/sticker-forge/lib/background-removal.ts（MIT）。
 */
import type { StickerBackgroundRemovalProgress } from './types';

export interface StickerBackgroundRemovalResult {
  dataUrl: string;
  width: number;
  height: number;
}

type WorkerResponse =
  | {
      type: 'progress';
      id: number;
      phase: StickerBackgroundRemovalProgress['phase'];
      progress?: number;
    }
  | {
      type: 'result';
      id: number;
      pixels: ArrayBuffer;
      width: number;
      height: number;
    }
  | { type: 'error'; id: number; message: string };

type PendingRequest = {
  resolve: (result: StickerBackgroundRemovalResult) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: StickerBackgroundRemovalProgress) => void;
  image: ArrayBuffer;
  mimeType: string;
  retries: number;
};

let worker: Worker | null = null;
let requestId = 0;
const pending = new Map<number, PendingRequest>();

function requestError(error: unknown, fallback: string) {
  return error instanceof Error ? error : new Error(fallback);
}

function terminateIdleWorker(target: Worker | null) {
  if (!target || target !== worker || pending.size > 0) return;
  worker = null;
  target.terminate();
}

function postWorkerRequest(target: Worker, id: number, request: PendingRequest) {
  const image = request.image.slice(0);
  target.postMessage(
    { type: 'remove', id, image, mimeType: request.mimeType },
    [image],
  );
}

function tryPostWorkerRequest(target: Worker, id: number, request: PendingRequest) {
  try {
    postWorkerRequest(target, id, request);
    return true;
  } catch (error) {
    pending.delete(id);
    terminateIdleWorker(target);
    request.reject(requestError(error, '无法启动抠图任务'));
    return false;
  }
}

function workerFailureMessage(event: ErrorEvent) {
  const detail = event.error instanceof Error ? event.error.message : event.message;
  const location = event.filename
    ? `${event.filename}${event.lineno ? `:${event.lineno}` : ''}`
    : '';
  if (detail && location) return `抠图线程在 ${location} 失败：${detail}`;
  if (detail) return `抠图线程失败：${detail}`;
  if (location) return `抠图线程在 ${location} 失败`;
  return '抠图线程失败';
}

function pixelsToDataUrl(pixels: Uint8ClampedArray<ArrayBuffer>, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 不可用');
  context.putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas.toDataURL('image/png');
}

function getWorker() {
  if (worker) return worker;
  const createdWorker = new Worker(
    new URL('./bgRemoval.worker.ts', import.meta.url),
    { type: 'module', name: 'sticker-background-removal' },
  );
  worker = createdWorker;
  createdWorker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    if (worker !== createdWorker) return;
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    if (response.type === 'progress') {
      request.onProgress?.({ phase: response.phase, progress: response.progress });
      return;
    }
    pending.delete(response.id);
    if (response.type === 'error') {
      request.reject(new Error(response.message));
      return;
    }
    try {
      const pixels = new Uint8ClampedArray(response.pixels);
      request.resolve({
        dataUrl: pixelsToDataUrl(pixels, response.width, response.height),
        width: response.width,
        height: response.height,
      });
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error('无法生成抠图结果'));
    }
  });
  createdWorker.addEventListener('error', (event) => {
    if (worker !== createdWorker) {
      createdWorker.terminate();
      return;
    }
    worker = null;
    createdWorker.terminate();
    const retryable: Array<[number, PendingRequest]> = [];
    const error = new Error(workerFailureMessage(event));
    for (const entry of pending.entries()) {
      const [id, request] = entry;
      if (request.retries < 1) {
        request.retries += 1;
        retryable.push([id, request]);
      } else {
        pending.delete(id);
        request.reject(error);
      }
    }
    if (!retryable.length) return;
    window.setTimeout(() => {
      const currentRequests = retryable.filter(([id, request]) => pending.get(id) === request);
      if (!currentRequests.length) return;
      let restartedWorker: Worker;
      try {
        restartedWorker = getWorker();
      } catch (restartError) {
        const failure = restartError instanceof Error ? restartError : error;
        for (const [id, request] of currentRequests) {
          if (pending.get(id) !== request) continue;
          pending.delete(id);
          request.reject(failure);
        }
        terminateIdleWorker(worker);
        return;
      }
      for (const [id, request] of currentRequests) {
        if (pending.get(id) !== request) continue;
        request.onProgress?.({ phase: 'loading', progress: 0 });
        tryPostWorkerRequest(restartedWorker, id, request);
      }
    }, 120);
  });
  return worker;
}

async function loadSafeImage(source: string): Promise<HTMLImageElement> {
  // 1. 若为远程 HTTP/HTTPS 地址，优先尝试 fetch 转同源 Blob URL，规避浏览器缓存导致的 CORS 混淆
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
      reject(new Error('源图片加载失败或受跨域（CORS）限制，无法导出'));
    image.src = source;
  });
  return image;
}

async function normalizeImageSource(source: string) {
  const image = await loadSafeImage(source);

  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) {
    throw new Error('源图片没有可见尺寸');
  }
  const maximumSide = 4096;
  const scale = Math.min(1, maximumSide / Math.max(naturalWidth, naturalHeight));
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

/** 移除图片背景：返回带透明通道的 PNG Data URL */
export async function removeImageBackground(
  source: string,
  onProgress?: (progress: StickerBackgroundRemovalProgress) => void,
): Promise<StickerBackgroundRemovalResult> {
  const blob = await normalizeImageSource(source);
  const image = await blob.arrayBuffer();
  const id = ++requestId;
  return new Promise<StickerBackgroundRemovalResult>((resolve, reject) => {
    const request: PendingRequest = {
      resolve,
      reject,
      onProgress,
      image,
      mimeType: blob.type || 'image/png',
      retries: 0,
    };
    pending.set(id, request);
    let target: Worker;
    try {
      target = getWorker();
    } catch (error) {
      pending.delete(id);
      terminateIdleWorker(worker);
      reject(requestError(error, '抠图线程不可用'));
      return;
    }
    tryPostWorkerRequest(target, id, request);
  });
}
