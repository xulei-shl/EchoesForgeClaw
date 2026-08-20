import type { ReceiptState } from '../../types';
import { exportStandardReceiptImage } from './standardRenderer';
import { exportLibraryCardImage } from './libraryCardRenderer';
import { exportBookExcerptImage } from './bookExcerptRenderer';
import { exportRetroMenuImage } from './retroMenuRenderer';

export type ReceiptCanvasRenderer = (
  state: ReceiptState,
  scale?: number
) => Promise<string>;

/**
 * 全局小票 Canvas 离屏渲染器策略注册表
 * 所有当前模板及未来扩展的新模板在此注册，保证全模板极速性能与 100% 精确的所见即所得
 */
export const RECEIPT_RENDERER_REGISTRY: Record<string, ReceiptCanvasRenderer> = {
  book_recommend: exportStandardReceiptImage,
  itemized: exportStandardReceiptImage,
  reading_log: exportLibraryCardImage,
  book_excerpt: exportBookExcerptImage,
  retro_menu: exportRetroMenuImage,
};

/**
 * 注册自定义小票渲染器（支持运行时动态扩展新模板）
 */
export function registerReceiptRenderer(
  templateId: string,
  renderer: ReceiptCanvasRenderer
): void {
  RECEIPT_RENDERER_REGISTRY[templateId] = renderer;
}

/**
 * 根据 templateId 动态获取对应渲染器，具备通用自适应兜底机制
 */
export function getReceiptRenderer(templateId: string): ReceiptCanvasRenderer {
  return RECEIPT_RENDERER_REGISTRY[templateId] || exportStandardReceiptImage;
}
