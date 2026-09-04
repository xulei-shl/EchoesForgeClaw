/// <reference lib="webworker" />

import { AutoModel, env, RawImage, Tensor } from '@huggingface/transformers';
import type { MattingWorkerRequest } from './types';

const MODEL_ID = 'BritishWerewolf/U-2-Netp';
const LOCAL_MODEL_PATH = '/models/';

// 模型文件同源静态托管（frontend/public/models/），避免依赖 Hugging Face Hub 可达性
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = LOCAL_MODEL_PATH;

// U²-Net 输出软 matte，其低置信度尾部常含原始背景色，压缩尾部同时保留羽化过渡
const MATTE_BLACK_POINT = 0.12;
const MATTE_WHITE_POINT = 0.78;

let removerPromise: Promise<Awaited<ReturnType<typeof createRemover>>> | null = null;

function cleanMatteAlpha(value: number) {
  const normalized = Math.max(0, Math.min(1, value / 255));
  const clipped = Math.max(
    0,
    Math.min(
      1,
      (normalized - MATTE_BLACK_POINT) /
        (MATTE_WHITE_POINT - MATTE_BLACK_POINT),
    ),
  );
  return clipped * clipped * (3 - 2 * clipped);
}

function postProgress(id: number, phase: 'loading' | 'processing', progress?: number) {
  self.postMessage({ type: 'progress', id, phase, progress });
}

interface ProgressEventLike {
  status?: string;
  progress?: number;
}

async function createRemover(id: number) {
  const progressCallback = (event: ProgressEventLike) => {
    if (event.status === 'ready') {
      postProgress(id, 'loading', 100);
      return;
    }
    const progress = Number(event.progress);
    if (Number.isFinite(progress)) {
      postProgress(id, 'loading', Math.max(0, Math.min(100, progress)));
    }
  };

  const hasWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;
  let model: any = null;

  if (hasWebGPU) {
    try {
      model = await AutoModel.from_pretrained(MODEL_ID, {
        device: 'webgpu',
        dtype: 'fp32',
        progress_callback: progressCallback,
      });
    } catch (e) {
      console.warn('WebGPU 模式不可用，降级为 wasm 模式:', e);
    }
  }

  if (!model) {
    model = await AutoModel.from_pretrained(MODEL_ID, {
      device: 'wasm',
      dtype: 'fp32',
      progress_callback: progressCallback,
    });
  }

  postProgress(id, 'loading', 100);

  return async (input: Blob) => {
    const image = await RawImage.fromBlob(input);
    const inputSize = 320;
    const scale = Math.min(inputSize / image.width, inputSize / image.height);
    const resizedWidth = Math.max(1, Math.round(image.width * scale));
    const resizedHeight = Math.max(1, Math.round(image.height * scale));
    const left = Math.floor((inputSize - resizedWidth) / 2);
    const right = inputSize - resizedWidth - left;
    const top = Math.floor((inputSize - resizedHeight) / 2);
    const bottom = inputSize - resizedHeight - top;
    const resized = await image.clone().rgb().resize(resizedWidth, resizedHeight);
    const prepared = await resized.pad([left, right, top, bottom]);

    const mean = [0.485, 0.456, 0.406];
    const standardDeviation = [0.229, 0.224, 0.225];
    const planeSize = inputSize * inputSize;
    const normalized = new Float32Array(planeSize * 3);
    for (let pixel = 0; pixel < planeSize; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        normalized[channel * planeSize + pixel] =
          (prepared.data[pixel * 3 + channel] / 255 - mean[channel]) /
          standardDeviation[channel];
      }
    }
    const pixelValues = new Tensor('float32', normalized, [
      1,
      3,
      inputSize,
      inputSize,
    ]);
    const prediction = (await model({
      'input.1': pixelValues,
    })) as unknown as Record<
      string,
      { data: Float32Array | Uint8Array; dims: number[] }
    >;
    const composite = prediction['1959'] ?? Object.values(prediction)[0];
    if (!composite) throw new Error('模型未返回前景遮罩');
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (const value of composite.data) {
      minimum = Math.min(minimum, Number(value));
      maximum = Math.max(maximum, Number(value));
    }
    const range = Math.max(maximum - minimum, 0.00001);
    const maskPixels = new Uint8Array(inputSize * inputSize);
    for (let index = 0; index < maskPixels.length; index += 1) {
      maskPixels[index] = Math.round(
        ((Number(composite.data[index]) - minimum) / range) * 255,
      );
    }
    const paddedMask = new RawImage(maskPixels, inputSize, inputSize, 1);
    const croppedMask = await paddedMask.crop([
      left,
      top,
      left + resizedWidth - 1,
      top + resizedHeight - 1,
    ]);
    const mask = await croppedMask.resize(image.width, image.height);
    image.rgba();
    for (let index = 0; index < mask.data.length; index += 1) {
      const cleanedAlpha = cleanMatteAlpha(mask.data[index]);
      const sourceAlpha = image.data[index * 4 + 3] / 255;
      mask.data[index] = Math.round(cleanedAlpha * sourceAlpha * 255);
    }
    return image.putAlpha(mask);
  };
}

self.addEventListener('message', async (event: MessageEvent<MattingWorkerRequest>) => {
  const request = event.data;
  if (request.type !== 'remove') return;

  try {
    postProgress(request.id, 'loading', 0);
    removerPromise ??= createRemover(request.id);
    const remover = await removerPromise;
    postProgress(request.id, 'processing');

    const input = new Blob([request.image], { type: request.mimeType });
    const output = await remover(input);
    const pixels = new Uint8ClampedArray(output.data);
    self.postMessage(
      {
        type: 'result',
        id: request.id,
        pixels: pixels.buffer,
        width: output.width,
        height: output.height,
      },
      { transfer: [pixels.buffer] },
    );
  } catch (error) {
    removerPromise = null;
    self.postMessage({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : '抠图失败，请重试',
    });
  }
});

export {};
