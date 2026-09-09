/**
 * 图书卡片渲染引擎：模板填充 → HTML → PNG 截图（浏览器端，所见即所得）
 *
 * 移植自 docs/多模态工具/书目推广卡片/card_generator 的 Python Playwright 流程，
 * 并针对其「截图区域自动评分不稳定 / clip_padding 引入冗余空白」两个问题改为确定性方案：
 *
 * - 填充与截图使用**同一份**填充后 HTML 字符串（预览 iframe 与导出 iframe 同源同构），
 *   所见即所得由构造保证；
 * - 截图根元素按「显式标记 → 固定选择器取面积最大者」确定性解析，不做启发式评分；
 * - 画布尺寸 = 根元素 getBoundingClientRect 精确值，无任何额外 padding/阴影留白；
 * - 资源就绪等待覆盖 <img> 与 document.fonts，加载失败不阻断（透明像素兜底）。
 */

import { toPng } from 'html-to-image';
import { LOGO_SHL, LOGO_ZI, TPL_BG_MAP, TRANSPARENT_PIXEL } from './assets';
import type { CardFields } from './fields';

/** 显式截图根标记（模板可加 data-card-root 等属性精确指定） */
const EXPLICIT_ROOT_SELECTOR = '[data-card-root], [data-export-root], [data-screenshot-root]';

/** 顶级卡片根容器选择器（按特异性从外到内优先查找顶级卡片包裹器） */
const TOP_CARD_SELECTORS = [
  '.layout-wrapper',
  '.poster-container',
  '.poster-card',
  '.swiss-card',
  '.library-card',
  '.book-card',
  '.bento-grid',
  '.archive-wrapper',
  '.container',
  '.card',
];

export interface BuildCardHtmlInput {
  /** 模板原始 HTML（含 {{PLACEHOLDER}} 与 pic/* 引用） */
  templateHtml: string;
  /** 占位符取值 */
  fields: CardFields;
  /** 图书封面图 URL（来自图书元数据节点，替换 pic/cover.jpg） */
  coverUrl?: string | null;
  /** 选中的装饰图 URL（替换 pic/b.png） */
  decorUrl?: string | null;
  /** 二维码 data URL（由字段值生成的 vufind 链接，替换 pic/qrcode.png；空则透明占位） */
  qrcodeUrl?: string | null;
}

/**
 * 模板资源引用改写表：basename → 目标 URL。
 * - cover.jpg    → 图书封面（元数据节点直取）
 * - qrcode.png   → 字段值（索书号等）生成的 vufind 检索二维码，缺省透明占位
 * - b.png        → 装饰图池随机选中项
 * - logo_*       → 打包的图书馆 Logo
 * - 其余 pic/*   → 透明像素兜底（避免破图进入截图）
 * 远程 http(s) 引用不在 pic/ 规则内，原样保留。
 */
function resolveTemplateAsset(file: string, input: BuildCardHtmlInput): string {
  const name = file.toLowerCase();
  if (name === 'cover.jpg' || name === 'cover.png' || name === 'cover.jpeg') {
    return input.coverUrl?.trim() ? input.coverUrl : TRANSPARENT_PIXEL;
  }
  if (name === 'qrcode.png') return input.qrcodeUrl?.trim() ? input.qrcodeUrl : TRANSPARENT_PIXEL;
  if (name === 'b.png') return input.decorUrl?.trim() ? input.decorUrl : TRANSPARENT_PIXEL;
  if (name === 'logo_shl.png') return LOGO_SHL;
  if (name === 'logozi_shl.jpg') return LOGO_ZI;
  return TRANSPARENT_PIXEL;
}

/** 填充占位符 + 改写 pic/* 与外部 COS 资源引用，产出最终可渲染 HTML */
export function buildCardHtml(input: BuildCardHtmlInput): string {
  let html = input.templateHtml;
  for (const [key, value] of Object.entries(input.fields)) {
    html = html.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value ?? '');
  }

  // 1. 规范化所有 CSS url(...)：未加引号的统一加上单引号
  html = html.replace(/url\(\s*(?!['"])([^)]+?)\s*\)/g, "url('$1')");

  // 2. 先替换外部腾讯云 COS 背景图（防止被后面的 pic/* 规则误伤 /mdpic/）
  html = html.replace(
    /https?:\/\/xulei-pic-1258542021\.cos\.ap-shanghai\.myqcloud\.com\/mdpic\/([^"')\s]+)/g,
    (_m, rawFilename: string) => {
      const decoded = decodeURIComponent(rawFilename).toLowerCase();
      const localAsset =
        TPL_BG_MAP[rawFilename] ||
        TPL_BG_MAP[decoded] ||
        TPL_BG_MAP[rawFilename.toLowerCase()];
      return localAsset || _m;
    }
  );

  // 3. 严格匹配模板内置相对资源引用（如 src="pic/x"、url('pic/x')、../pic/x 等，避免误伤其他 URL）
  html = html.replace(/(?:^|["'(\s])(?:\.\.\/)?pic\/([\w.-]+)/g, (fullMatch, file: string) => {
    const prefix = fullMatch.startsWith('../') ? '' : fullMatch.slice(0, fullMatch.indexOf('pic/'));
    return `${prefix}${resolveTemplateAsset(file, input)}`;
  });

  return html;
}

/**
 * 确定性解析截图根元素：
 * 1. 显式标记优先（[data-card-root] 等）
 * 2. 顶级已知卡片选择器优先（命中即作为根卡片，避免误取内部子元素）
 * 3. 兜底取 body 的第一个子元素（面积 > 40000）或 body 自身
 */
export function getCardRootElement(doc: Document): HTMLElement {
  // 1. 显式标记优先
  const explicit = doc.querySelector<HTMLElement>(EXPLICIT_ROOT_SELECTOR);
  if (explicit && explicit.offsetWidth > 10 && explicit.offsetHeight > 10) return explicit;

  // 2. 顶级卡片根容器选择器（按优先级查找最外层卡片容器）
  for (const selector of TOP_CARD_SELECTORS) {
    const el = doc.querySelector<HTMLElement>(selector);
    if (el && el.offsetWidth > 100 && el.offsetHeight > 100) {
      return el;
    }
  }

  // 3. 兜底：取 body 的第一个可见子容器
  const firstChild = doc.body.firstElementChild as HTMLElement | null;
  if (firstChild && firstChild.offsetWidth > 100 && firstChild.offsetHeight > 100) {
    return firstChild;
  }

  return doc.body;
}

/** 供预览与导出组件测量卡片根元素自然尺寸（与导出同一套根解析逻辑，保证所见即所得） */
export function measureCardRoot(doc: Document): { width: number; height: number } {
  const root = getCardRootElement(doc);
  const rect = root.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width) || root.offsetWidth);
  const height = Math.max(1, Math.round(rect.height) || root.offsetHeight);
  return { width, height };
}

/**
 * 预览与导出文档预处理：清除 body 默认边距并禁用滚动，
 * 注入 base href 确保 iframe 内部的静态资源 URL 正确解析。
 */
export function prepareCardDocument(doc: Document): void {
  if (!doc.head) return;
  if (!doc.head.querySelector('base')) {
    const base = doc.createElement('base');
    base.href = typeof window !== 'undefined' ? `${window.location.origin}/` : '/';
    doc.head.prepend(base);
  }
  if (!doc.head.querySelector('style[data-card-preview]')) {
    const style = doc.createElement('style');
    style.setAttribute('data-card-preview', '1');
    style.textContent = `
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        background: transparent !important;
        width: max-content !important;
        height: max-content !important;
        min-width: 0 !important;
        min-height: 0 !important;
      }
    `;
    doc.head.appendChild(style);
  }
}

function nextFrame(win: Window | null): Promise<void> {
  return new Promise((resolve) => {
    if (!win) {
      resolve();
      return;
    }
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve()));
  });
}

/**
 * 等待字体、全部 <img> 与 CSS 背景图就绪（单图超时 8s，不因个别资源失败而中断）；预览与导出共用
 */
export async function waitForCardAssets(doc: Document): Promise<void> {
  try {
    await doc.fonts?.ready;
  } catch {
    /* 字体接口不可用时忽略 */
  }

  // 1. 等待全部 <img>
  const imgPromises = Array.from(doc.images).map((img) => {
    if (img.complete) {
      return img.decode?.().catch(() => {}) ?? Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const done = () => {
        img.decode?.().catch(() => {});
        resolve();
      };
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      window.setTimeout(resolve, 8000);
    });
  });

  // 2. 等待 CSS background-image
  const win = doc.defaultView || window;
  const bgPromises: Promise<void>[] = [];
  const allElements = Array.from(doc.querySelectorAll<HTMLElement>('*')).slice(0, 300);
  for (const el of allElements) {
    try {
      const bg = win.getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none' && bg.startsWith('url(')) {
        const urlMatch = bg.match(/url\(['"]?([^'")]+)['"]?\)/);
        if (urlMatch && urlMatch[1] && !urlMatch[1].startsWith('data:')) {
          const imgUrl = urlMatch[1];
          bgPromises.push(
            new Promise<void>((resolve) => {
              const img = new Image();
              img.onload = () => resolve();
              img.onerror = () => resolve();
              img.src = imgUrl;
              window.setTimeout(resolve, 5000);
            })
          );
        }
      }
    } catch {
      // 忽略无法读取样式的元素
    }
  }

  await Promise.all([...imgPromises, ...bgPromises]);
  await nextFrame(win);
}

function createOffscreenIframe(): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts');
  Object.assign(iframe.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '1920px',
    height: '1920px',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: '-9999',
  } satisfies Partial<CSSStyleDeclaration>);
  return iframe;
}

function loadSrcdoc(iframe: HTMLIFrameElement, html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('卡片页面加载超时'));
    }, 20000);
    // 初始 about:blank 也可能触发一次 load：仅当 srcdoc 文档已实际挂载内容时才算就绪
    const onLoad = () => {
      const doc = iframe.contentDocument;
      if (!doc || !doc.body || doc.body.children.length === 0) return;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      iframe.removeEventListener('load', onLoad);
    };
    iframe.addEventListener('load', onLoad);
    iframe.srcdoc = html;
  });
}

export interface RenderCardOptions {
  /** 导出像素比（2 = 2x 高清，与小票口径一致） */
  pixelRatio?: number;
}

/**
 * 将填充后的卡片 HTML 渲染为 PNG data URL。
 * 与预览共用同一份 HTML 与同一套根元素解析逻辑，所见即所得。
 */
export async function renderCardToDataUrl(html: string, options?: RenderCardOptions): Promise<string> {
  const pixelRatio = options?.pixelRatio ?? 2;
  if (!html.trim()) throw new Error('卡片内容为空');

  const iframe = createOffscreenIframe();
  document.body.appendChild(iframe);
  try {
    await loadSrcdoc(iframe, html);
    const doc = iframe.contentDocument;
    if (!doc?.body) throw new Error('卡片页面未能渲染');
    prepareCardDocument(doc);
    await waitForCardAssets(doc);

    const root = getCardRootElement(doc);
    const rect = root.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (!width || !height) throw new Error('未找到有效的卡片区域');

    // 动态将 iframe 尺寸调整为目标卡片的实际宽高，消除滚动条与负坐标偏移
    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;
    await nextFrame(doc.defaultView);

    const dataUrl = await toPng(root, {
      pixelRatio,
      width,
      height,
      cacheBust: true,
    });
    if (!dataUrl || !dataUrl.startsWith('data:image/png')) {
      throw new Error('卡片截图输出为空');
    }
    return dataUrl;
  } finally {
    iframe.remove();
  }
}

/** 触发浏览器下载生成的卡片 PNG */
export async function downloadBookCardImage(html: string): Promise<void> {
  const dataUrl = await renderCardToDataUrl(html, { pixelRatio: 2 });
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `图书卡片-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.png`;
  link.click();
}

