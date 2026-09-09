/**
 * 图书卡片 HTML 模板注册表
 *
 * 模板源文件位于本目录 html/ 下（移植自 docs/多模态工具/书目推广卡片/card_temples），
 * 经 Vite ?raw 批量打包为字符串，浏览器端填充占位符后渲染截图。
 * 新增模板只需放入 html/ 目录，注册表自动收录，无需改代码。
 */

const rawModules = import.meta.glob('./html/*.html', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface BookCardTemplate {
  /** 模板 id（文件名去扩展名，如「默认」） */
  id: string;
  /** 展示名（同 id，中文文件名） */
  name: string;
  /** 原始 HTML 模板内容（含 {{PLACEHOLDER}} 占位符与 pic/* 资源引用） */
  html: string;
}

export const BOOK_CARD_TEMPLATES: BookCardTemplate[] = Object.entries(rawModules)
  .map(([path, html]) => {
    const name = path.split('/').pop()!.replace(/\.html$/i, '');
    return { id: name, name, html };
  })
  .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

export const DEFAULT_BOOK_CARD_TEMPLATE_ID =
  BOOK_CARD_TEMPLATES.find((t) => t.id === '默认')?.id ?? BOOK_CARD_TEMPLATES[0]?.id ?? '默认';

/** 按 id 取模板；未命中回退默认模板 */
export function getBookCardTemplate(id?: string | null): BookCardTemplate {
  return (
    BOOK_CARD_TEMPLATES.find((t) => t.id === id) ??
    BOOK_CARD_TEMPLATES.find((t) => t.id === DEFAULT_BOOK_CARD_TEMPLATE_ID) ??
    BOOK_CARD_TEMPLATES[0] ?? { id: '默认', name: '默认', html: '' }
  );
}
