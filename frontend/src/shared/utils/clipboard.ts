/**
 * 复制文本到剪贴板（全站统一工具）。
 *
 * 1. 优先 Clipboard API（仅安全上下文 HTTPS / localhost 可用）；
 * 2. 失败或不可用时，降级为隐藏 textarea + document.execCommand('copy')；
 * 3. 全部失败时，保留一个已全选正文的隐藏 textarea 并保持聚焦，
 *    用户直接按 Ctrl+C / Cmd+C 即可手动复制；下次复制或点击页面任意处时自动清理。
 */

let fallbackTextarea: HTMLTextAreaElement | null = null;

const cleanupFallbackTextarea = () => {
  if (fallbackTextarea) {
    fallbackTextarea.remove();
    fallbackTextarea = null;
  }
};

export const copyTextToClipboard = async (text: string): Promise<void> => {
  cleanupFallbackTextarea();
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 忽略后尝试降级方案
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    if (!document.execCommand('copy')) {
      throw new Error('execCommand copy failed');
    }
  } catch (e) {
    // 保底体验：保留已全选正文，用户按 Ctrl+C / Cmd+C 手动复制；
    // 下次复制调用或点击页面任意处时自动清理
    fallbackTextarea = textarea;
    window.addEventListener('pointerdown', cleanupFallbackTextarea, { once: true, capture: true });
    throw e;
  }
  textarea.remove();
};
