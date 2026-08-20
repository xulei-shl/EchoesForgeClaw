import type { ReceiptState } from './types';
import {
  ensureFontsReady,
  exportReceiptFromDom,
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
 * 优先采用 100% 真实 DOM 所见即所得截图，失败时根据 templateId 自动回退到对应的离线 Canvas 渲染器
 */
export async function exportReceiptImage(
  state: ReceiptState,
  options?: ExportReceiptOptions
): Promise<string> {
  await ensureFontsReady();

  const scale = options?.scale || 2;

  // 1. 若传入了当前界面渲染的真实 DOM 元素，优先通过 html-to-image 导出像素级一模一样的 PNG
  if (options?.targetElement) {
    const domPng = await exportReceiptFromDom(options.targetElement, scale);
    if (domPng) {
      return domPng;
    }
  }

  // 2. 离线 / 无 DOM 场景下的 Canvas 策略查表兜底
  const renderer = CANVAS_RENDERERS[state.templateId] || exportStandardReceiptImage;
  return renderer(state, scale);
}

// 导出各个独立渲染器与底层工具函数
export {
  exportStandardReceiptImage,
  exportLibraryCardImage,
  exportBookExcerptImage,
  exportReceiptFromDom,
};
