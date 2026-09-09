/**
 * 贴纸制作背景去除适配层：底层全面复用 modules/multimodal/matting 通用抠图引擎
 */
import {
  removeImageBackground as coreRemoveImageBackground,
  type MattingResult,
} from '../matting';

import type { StickerBackgroundRemovalProgress } from './types';

export interface StickerBackgroundRemovalResult {
  dataUrl: string;
  width: number;
  height: number;
}

/** 移除图片背景：返回带透明通道的 PNG Data URL */
export async function removeImageBackground(
  source: string,
  onProgress?: (progress: StickerBackgroundRemovalProgress) => void,
): Promise<StickerBackgroundRemovalResult> {
  const result: MattingResult = await coreRemoveImageBackground(source, undefined, onProgress);
  return {
    dataUrl: result.dataUrl,
    width: result.width,
    height: result.height,
  };
}
