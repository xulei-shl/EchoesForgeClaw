import type { ReceiptState } from './types';
import {
  ensureFontsReady,
  exportStandardReceiptImage,
  exportLibraryCardImage,
  exportBookExcerptImage,
} from './export';

export interface ExportReceiptOptions {
  scale?: number;
  targetElement?: HTMLElement | null;
}

/**
 * 离线 Canvas 渲染器策略映射表（按 templateId 注册）
 */
const CANVAS_RENDERERS: Record<
  string,
  (state: ReceiptState, scale: number) => Promise<string>
> = {
  book_recommend: exportStandardReceiptImage,
  itemized: exportStandardReceiptImage,
  reading_log: exportLibraryCardImage,
  book_excerpt: exportBookExcerptImage,
};

/**
 * 导出小票 / 借书卡 / 书摘小票为高清 PNG 图片
 * 采用高保真纯 Canvas 离屏矢量渲染引擎，实现毫秒级瞬时响应与精准的所见即所得
 */
export async function exportReceiptImage(
  state: ReceiptState,
  options?: ExportReceiptOptions
): Promise<string> {
  await ensureFontsReady();

  const scale = options?.scale || 2;
  const renderer = CANVAS_RENDERERS[state.templateId] || exportStandardReceiptImage;
  return renderer(state, scale);
}

// 导出各个独立渲染器与底层工具函数
export {
  exportStandardReceiptImage,
  exportLibraryCardImage,
  exportBookExcerptImage,
};
