import { toPng } from 'html-to-image';

/**
 * 通过 html-to-image 从真实 DOM 元素导出高清图片
 * 自动忽略具有 data-export-ignore="true" 或 .export-ignore 类名的操作按钮
 */
export async function exportReceiptFromDom(
  targetElement: HTMLElement,
  scale = 2
): Promise<string | null> {
  try {
    const dataUrl = await toPng(targetElement, {
      pixelRatio: scale,
      cacheBust: true,
      filter: (node) => {
        if (node instanceof HTMLElement) {
          if (node.dataset.exportIgnore === 'true' || node.classList.contains('export-ignore')) {
            return false;
          }
        }
        return true;
      },
    });

    if (dataUrl && dataUrl.startsWith('data:image/png')) {
      return dataUrl;
    }
    return null;
  } catch (domErr) {
    console.warn('DOM 所见即所得导出失败，回退到离线 Canvas 引擎:', domErr);
    return null;
  }
}
