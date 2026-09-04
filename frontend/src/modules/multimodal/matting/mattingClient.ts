/**
 * 抠图 Worker 客户端调度：请求队列、单例生命周期、进度通知与异常重试
 */

import { compositeBackground, normalizeImageSource, pixelsToCanvas } from './imageUtils';
import type {
  MattingOptions,
  MattingProgress,
  MattingResult,
  MattingWorkerResponse,
} from './types';

type PendingRequest = {
  resolve: (result: MattingResult) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: MattingProgress) => void;
  image: ArrayBuffer;
  mimeType: string;
  options?: MattingOptions;
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

function getWorker(): Worker {
  if (worker) return worker;
  const createdWorker = new Worker(
    new URL('./matting.worker.ts', import.meta.url),
    { type: 'module', name: 'app-matting-worker' },
  );
  worker = createdWorker;

  createdWorker.addEventListener('message', async (event: MessageEvent<MattingWorkerResponse>) => {
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
      const cutoutCanvas = pixelsToCanvas(pixels, response.width, response.height);
      const { dataUrl, blob } = await compositeBackground(cutoutCanvas, request.options?.bgColor);

      request.resolve({
        dataUrl,
        blob,
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

/**
 * 移除图片背景：
 * @param source 图片地址（HTTP/HTTPS/Data URL/Blob URL）
 * @param optionsOrProgress 可选配置对象或进度回调函数
 * @param onProgressCallback 可选进度回调函数（当第二参数为配置对象时使用）
 */
export async function removeImageBackground(
  source: string,
  optionsOrProgress?: MattingOptions | ((progress: MattingProgress) => void),
  onProgressCallback?: (progress: MattingProgress) => void,
): Promise<MattingResult> {
  const options =
    typeof optionsOrProgress === 'object' && optionsOrProgress !== null
      ? optionsOrProgress
      : undefined;
  const onProgress =
    typeof optionsOrProgress === 'function'
      ? optionsOrProgress
      : onProgressCallback;

  const blob = await normalizeImageSource(source, options?.maxEdge);
  const image = await blob.arrayBuffer();
  const id = ++requestId;

  return new Promise<MattingResult>((resolve, reject) => {
    const request: PendingRequest = {
      resolve,
      reject,
      onProgress,
      image,
      mimeType: blob.type || 'image/png',
      options,
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
