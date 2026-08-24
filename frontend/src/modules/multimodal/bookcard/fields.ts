/**
 * 图书卡片字段解析
 *
 * 把图书元数据（豆瓣 API 结构，同 receipt 的 BookMetadataInput）映射为模板占位符取值。
 * 占位符集合与 card_generator（docs/多模态工具/书目推广卡片/card_generator/html_generator.py）对齐：
 * {{TITLE}} {{AUTHOR}} {{PUBLISHER}} {{PUB_YEAR}} {{CALL_NUMBER}} {{DOUBAN_RATING}} {{RECOMMENDATION}}
 *
 * 缺失字段一律留空串（如索书号：图书元数据节点暂不提供，
 * 待后续专门节点落地后经 parseExtraCardFields 注入覆盖）。
 */

/** 与 receipt 共用的图书元数据结构（兼容豆瓣 API） */
export interface CardBookMetadata {
  title?: string;
  subtitle?: string;
  author?: string;
  publisher?: string;
  pub_year?: string;
  publishDate?: string;
  rating?: number | string;
  summary?: string;
  description?: string;
  [key: string]: unknown;
}

/** 字段处理选项 */
export interface CardFieldOptions {
  /** 题名是否包含副题名（默认 true） */
  showSubtitle?: boolean;
  /** 作者是否仅取第一位（默认 false） */
  firstAuthorOnly?: boolean;
}

/** 模板占位符 → 取值 */
export type CardFields = Record<string, string>;

export const CARD_PLACEHOLDERS = [
  'TITLE',
  'AUTHOR',
  'PUBLISHER',
  'PUB_YEAR',
  'CALL_NUMBER',
  'DOUBAN_RATING',
  'RECOMMENDATION',
] as const;

/**
 * 空值归一（移植 card_generator handle_empty_field）：
 * null/空白 → ''；数值型 "9.0" → "9"；其余保持原字符串。
 */
function normalizeTextValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return String(value);
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^-?\d+\.0+$/.test(trimmed)) {
    return String(Number(trimmed));
  }
  return trimmed;
}

/** 完整书名：书名 + 副标题（" : " 拼接，移植 models.py full_title） */
function fullTitle(book: CardBookMetadata, showSubtitle?: boolean): string {
  const title = normalizeTextValue(book.title);
  const subtitle = normalizeTextValue(book.subtitle);
  if (!title) return subtitle;
  if (!showSubtitle || !subtitle) return title;
  return `${title} : ${subtitle}`;
}

/**
 * 推荐语智能截断（移植 models.py truncated_reason）：
 * 超长时优先在标点处收束，其次空格，最后硬截加省略号。
 */
function smartTruncate(text: string, maxLength = 50): string {
  if (!text || text.length <= maxLength) return text ?? '';
  const punctuation = '。！？；,.!?;，、';
  const searchEnd = Math.min(maxLength + 10, text.length);
  let bestCut = -1;
  for (let i = searchEnd - 1; i >= 0; i--) {
    if (punctuation.includes(text[i])) {
      bestCut = i + 1;
      break;
    }
  }
  if (bestCut > 0 && bestCut <= maxLength + 10) {
    return text.slice(0, bestCut).trim();
  }
  const spaceCut = text.lastIndexOf(' ', Math.min(maxLength, text.length) - 1);
  if (spaceCut > 0) {
    return text.slice(0, spaceCut).trim() + '...';
  }
  return text.slice(0, maxLength).trim() + '...';
}

/**
 * 解析上游文本节点输出的补充字段（未来「索书号」等专门节点的接入点）：
 * 上级文本可输出 JSON 对象（如 {"CALL_NUMBER": "I247.5/123"}），键与占位符一致；
 * 非 JSON 文本返回空表（不影响主流程）。
 */
export function parseExtraCardFields(raw?: string | null): CardFields {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const fields: CardFields = {};
    for (const key of CARD_PLACEHOLDERS) {
      const v = (parsed as Record<string, unknown>)[key];
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        fields[key] = normalizeTextValue(v);
      }
    }
    return fields;
  } catch {
    return {};
  }
}

/** 取第一位作者（移植 field_transformers.py FirstAuthorTransformer） */
function firstAuthor(author: string): string {
  const parts = author.split('/').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return author;
  return `${parts[0]} 等`;
}

/** 图书元数据 → 模板占位符取值；extra 同名键优先（补充字段覆盖） */
export function resolveCardFields(
  book: CardBookMetadata | null | undefined,
  extra?: CardFields | null,
  options?: CardFieldOptions | null
): CardFields {
  const recommendationSource = normalizeTextValue(book?.summary) || normalizeTextValue(book?.description);
  const rawAuthor = normalizeTextValue(book?.author);
  const fields: CardFields = {
    TITLE: fullTitle(book ?? {}, options?.showSubtitle ?? true),
    AUTHOR: options?.firstAuthorOnly && rawAuthor ? firstAuthor(rawAuthor) : rawAuthor,
    PUBLISHER: normalizeTextValue(book?.publisher),
    PUB_YEAR: normalizeTextValue(book?.pub_year) || normalizeTextValue(book?.publishDate),
    CALL_NUMBER:
      normalizeTextValue(book?.call_number) ||
      normalizeTextValue(book?.callNumber) ||
      normalizeTextValue(book?.callNo) ||
      '',
    DOUBAN_RATING: normalizeTextValue(book?.rating),
    RECOMMENDATION: smartTruncate(recommendationSource),
    ...(extra ?? {}),
  };
  return fields;
}
