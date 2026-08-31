/**
 * 杂志排版模块 - 图书元数据 → 文章字段映射
 *
 * 参照图书小票（receipt/templates.ts 的 mapFromBook）的做法：把上游图书元数据
 * （book_info 节点，兼容豆瓣 API 结构）映射为 EditorialArticleData 的正文/标题/
 * 导语/作者/引语等字段，替换硬编码模板占位。映射原则：
 *   - headline（大标题）← 书名（剥掉书名号《》）；
 *   - deck（导语/副标题）← 副题名，无则从摘要智能截断；
 *   - author（作者）← 作者（可拼译者）；
 *   - body（正文全文）← 内容摘要 summary/description（保留多段）；
 *   - pullquote（金句）← 摘要首句抽取；
 *   - issueDate（期号/日期）← 出版年（4 位年份）；
 *   - masthead / folio / proTip 等刊头品牌文案不取自图书数据（映射函数不含这些键）。
 */

import type { EditorialArticleData } from './types';
import type { BookMetadataInput } from '../receipt/types';

/** 剥掉书名号《》与首尾空白 */
function cleanTitle(raw?: string): string {
  return (raw || '').replace(/^《+|》+$/g, '').trim();
}

/** 取出版年份中的 4 位数字（与图书小票/图书卡片同口径），无则返回空串 */
function extractYear(raw?: string): string {
  if (!raw) return '';
  const m = raw.match(/\d{4}/);
  return m ? m[0] : '';
}

/** 摘要正文：summary 优先，其次 description，保留段落结构 */
function bodyFrom(book: BookMetadataInput): string {
  return (book.summary || book.description || '').trim();
}

/** 导语：副题名优先，无则截取摘要首句 */
function deckFrom(book: BookMetadataInput): string {
  const subtitle = (book.subtitle || '').trim();
  if (subtitle) return subtitle;
  const summary = bodyFrom(book);
  if (!summary) return '';
  const first = summary
    .split(/(?<=[。！？\n])/)
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  return (first || summary).slice(0, 80);
}

/** 金句：截取摘要前两句（供访谈金句/引文卡片模板使用） */
function pullquoteFrom(book: BookMetadataInput): string {
  const summary = bodyFrom(book);
  if (!summary) return '';
  const joined = summary
    .split(/(?<=[。！？\n])/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join('');
  return joined.slice(0, 60) || '';
}

/** 作者署名：作者 + 译者 */
function authorFrom(book: BookMetadataInput): string {
  const author = (book.author || '').trim();
  const translator = (book.translator || '').trim();
  if (!author) return translator;
  if (!translator || translator === author) return author;
  return `${author} · ${translator}`;
}

/**
 * 将图书元数据映射为文章字段 Patch（仅返回 book 提供真实内容的键）。
 * 不含刊头系列字段（masthead/folio/proTip）——这些是模板品牌文案，保留默认。
 */
export function mapBookToEditorialArticle(
  book: BookMetadataInput | null | undefined
): Partial<EditorialArticleData> {
  if (!book) return {};
  const patch: Partial<EditorialArticleData> = {};

  const headline = cleanTitle(book.title);
  if (headline) patch.headline = headline;

  const deck = deckFrom(book);
  if (deck) patch.deck = deck;

  const author = authorFrom(book);
  if (author) patch.author = author;

  const body = bodyFrom(book);
  if (body) patch.body = body;

  const pullquote = pullquoteFrom(book);
  if (pullquote) patch.pullquote = pullquote;

  const year = extractYear(book.pub_year || book.publishDate);
  if (year) patch.issueDate = year;

  return patch;
}

/**
 * 「只填空/默认字段」策略下判断 article 某字段是否待填充：
 * 值为空，或仍等于该模板的默认占位文案（即用户未手改过）时返回 true。
 * @param defaultValue 当前模板 defaultArticle 中该字段的默认值
 */
export function isEditorialFieldFillable(
  value: string | undefined,
  defaultValue: string | undefined
): boolean {
  if (!value) return true;
  return Boolean(defaultValue) && value === defaultValue;
}

/** 图书元数据特征指纹（isbn+书名+作者+出版年），用于检测上游书变更 */
export function bookMetadataFingerprint(book?: BookMetadataInput | null): string {
  if (!book) return '';
  return [book.isbn, book.title, book.author, book.pub_year || book.publishDate]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .join('|');
}