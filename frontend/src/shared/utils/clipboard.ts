/**
 * 复制文本到剪贴板（全站统一工具）。
 *
 * 1. 优先 Clipboard API（仅安全上下文 HTTPS / localhost 可用）；
 * 2. 失败或不可用时，降级为隐藏 textarea + document.execCommand('copy')；
 * 3. 全部失败时，保留一个已全选正文的隐藏 textarea 并保持聚焦，
 *    用户直接按 Ctrl+C / Cmd+C 即可手动复制；下次复制或点击页面任意处时自动清理。
 */

let fallbackTextarea: HTMLTextAreaElement | null = null;
/** 是否已挂载全局降级实现：已挂载则跳过 navigator.clipboard，直接走 execCommand（避免绕回自身） */
let shimInstalled = false;

const cleanupFallbackTextarea = () => {
  if (fallbackTextarea) {
    fallbackTextarea.remove();
    fallbackTextarea = null;
  }
};

/** 隐藏 textarea + execCommand 的降级复制（不读取 navigator.clipboard，避免被下方全局兜底递归调用） */
const execCommandCopy = (text: string): void => {
  cleanupFallbackTextarea();
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

export const copyTextToClipboard = async (text: string): Promise<void> => {
  cleanupFallbackTextarea();
  if (!shimInstalled && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 忽略后尝试降级方案
    }
  }
  execCommandCopy(text);
};

/**
 * 极简 ClipboardItem 兜底实现：非安全上下文下浏览器不暴露该类，
 * 调用方（Streamdown 表格复制）`new ClipboardItem({...})` 会直接 ReferenceError。
 * 只实现调用方用到的部分：类型映射 + getType()。
 */
class ClipboardItemFallback {
  readonly types: string[];
  private readonly items: Record<string, Blob>;

  constructor(items: Record<string, Blob | string>) {
    this.items = Object.fromEntries(
      Object.entries(items).map(([type, value]) => [
        type,
        typeof value === 'string' ? new Blob([value], { type }) : value,
      ])
    );
    this.types = Object.keys(this.items);
  }

  getType(type: string): Promise<Blob> {
    const blob = this.items[type];
    return blob ? Promise.resolve(blob) : Promise.reject(new Error(`ClipboardItem: type "${type}" not found`));
  }
}

/** 从 ClipboardItem 取出 text/plain 文本（同时兼容原生类与上面的兜底类） */
const readClipboardItemText = async (item: unknown): Promise<string> => {
  const getType = (item as { getType?: (type: string) => Promise<Blob | string> } | null)?.getType;
  if (typeof getType !== 'function') throw new Error('clipboard.write: unsupported item');
  const content = await getType.call(item, 'text/plain');
  return typeof content === 'string' ? content : await content.text();
};

/**
 * 为只认 Clipboard API 的第三方组件补上降级能力（应用启动时调用一次）。
 *
 * 非安全上下文（http + 局域网 IP 等）下浏览器不暴露 navigator.clipboard 与 ClipboardItem，
 * 而 Streamdown 自带控件只走这套 API，且其 onError 默认为空 → 点击后完全无反应：
 * - 代码块 / mermaid 复制：navigator.clipboard.writeText(code)
 * - 表格复制：new ClipboardItem({...}) + navigator.clipboard.write([item])
 * 这里只在这些 API 缺失时补上 execCommand 实现（表格复制按 text/plain 落盘，会丢失 text/html 富文本）。
 *
 * 仅在原生 API 缺失时挂载：不覆盖已可用的实现，避免屏蔽浏览器原生的 write / read / readText。
 */
export const installClipboardFallback = (): void => {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return;
  // DOM 类型把 clipboard 标注为必定存在，但非安全上下文（http + 局域网 IP）下运行时为 undefined
  if (typeof navigator.clipboard?.writeText === 'function') return;
  try {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string): Promise<void> => {
          execCommandCopy(text);
        },
        write: async (items: unknown[]): Promise<void> => {
          const item = Array.isArray(items) ? items[0] : undefined;
          if (!item) throw new Error('clipboard.write: empty items');
          execCommandCopy(await readClipboardItemText(item));
        },
      },
    });
    const globalScope = globalThis as { ClipboardItem?: unknown };
    if (typeof globalScope.ClipboardItem !== 'function') {
      globalScope.ClipboardItem = ClipboardItemFallback;
    }
    shimInstalled = true;
  } catch {
    // 个别环境不允许改写 navigator：保持原样，各调用方自带的降级路径仍然有效
  }
};
