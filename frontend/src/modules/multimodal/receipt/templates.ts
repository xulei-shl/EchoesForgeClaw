import { generateRandomBorrowerRecords } from './borrowerGenerator';
import { generateRandomSeals } from './sealGenerator';
import type { BookMetadataInput, ReceiptState, ReceiptTemplateDef, ReceiptTemplateId, ReceiptThemeId } from './types';
import { parseExtraCardFields } from '../bookcard/fields';

/**
 * 解析上游文本节点（如 VuFind 馆藏）输出 JSON 中的索书号：{"CALL_NUMBER": "..."}。
 * 与图书卡片节点共用 parseExtraCardFields 的解析口径；非 JSON 或无该字段返回空串。
 */
export function parseUpstreamCallNumber(raw?: string | null): string {
  return parseExtraCardFields(raw).CALL_NUMBER ?? '';
}

/**
 * 格式化当前日期时间（YYYY-MM-DD HH:mm）
 */
export function formatReceiptDate(d = new Date()): string {
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const date = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${date} ${hours}:${minutes}`;
}

/**
 * 根据豆瓣评分换算为馆藏推荐星级（如 ★★★★★、★★★★☆）
 */
export function convertRatingToStars(rating?: number | string | null): string {
  if (!rating) return '★★★★★';
  const num = typeof rating === 'number' ? rating : parseFloat(String(rating).trim());
  if (isNaN(num) || num <= 0) return '★★★★★';

  if (num >= 8.5) return '★★★★★';
  if (num >= 7.5) return '★★★★☆';
  if (num >= 6.5) return '★★★☆☆';
  if (num >= 5.0) return '★★☆☆☆';
  return '★☆☆☆☆';
}

/**
 * 预设 1：书目推荐小票（阅读推广、馆藏推荐、藏书凭证）
 */
export const TEMPLATE_BOOK_RECOMMEND: ReceiptTemplateDef = {
  id: 'book_recommend',
  name: '书目推荐小票',
  description: '经典阅读推广凭证，展示图书点阵封面、题名、作者、出版社、索书号与豆瓣评分',
  createInitialState: () => ({
    templateId: 'book_recommend',
    themeId: 'white',
    ditherEnabled: true,
    storeName: 'SHANGHAI LIBRARY',
    subtitle: '★ BOOK RECOMMENDATION ★',
    dateTimeText: formatReceiptDate(),
    terminal: '01-DESK',
    servedBy: 'Librarian',
    callNumber: '', // 索书号默认留空
    status: '[在馆可借]', // 馆藏状态默认在馆可借
    rating: '9.2',
    metaFields: [
      { key: 'title', label: '书名', value: '百年孤独', visible: true },
      { key: 'author', label: '作者', value: '[哥伦比亚] 加西亚·马尔克斯', visible: true },
      { key: 'publisher', label: '出版社', value: '南海出版公司', visible: true },
      { key: 'producer', label: '出品方', value: '新经典文化', visible: true },
      { key: 'series', label: '丛书', value: '新经典文库', visible: true },
      { key: 'pub_year', label: '出版时间', value: '2011-6', visible: true },
    ],
    items: [],
    totalLabel: '馆藏推荐指数',
    totalValue: '★★★★★',
    barcodeText: '9787544253994',
    footerMessage: 'READ MORE, LIVE MORE',
    bottomNote: 'Echoes Reading Promotion · Keep the book warm',
  }),
  mapFromBook: (book: BookMetadataInput, _current = {}) => {
    const title = book.title || '未命名书目';
    const author = book.author || '';
    const publisher = book.publisher || '';
    const producer = book.producer || '';
    const series = book.series || '';
    const pubYear = book.pub_year || book.publishDate || '';
    const rating =
      book.rating !== undefined && book.rating !== null && String(book.rating).trim() !== ''
        ? String(book.rating)
        : '';
    const isbn = book.isbn || '';
    const cover = book.cover_image_local || book.cover_image || book.coverUrl || null;

    const metaFields = [
      { key: 'title', label: '书名', value: title, visible: true },
      { key: 'author', label: '作者', value: author, visible: !!author },
    ];

    if (book.translator) {
      metaFields.push({ key: 'translator', label: '译者', value: book.translator, visible: true });
    }

    if (publisher) {
      metaFields.push({ key: 'publisher', label: '出版社', value: publisher, visible: true });
    }

    if (producer) {
      metaFields.push({ key: 'producer', label: '出品方', value: producer, visible: true });
    }

    if (series) {
      metaFields.push({ key: 'series', label: '丛书', value: series, visible: true });
    }

    if (pubYear) {
      metaFields.push({ key: 'pub_year', label: '出版年', value: pubYear, visible: true });
    }

    return {
      storeName: 'SHANGHAI LIBRARY',
      subtitle: '★ BOOK RECOMMENDATION ★',
      imageUrl: cover || null,
      rating,
      barcodeText: isbn || '9787020002207',
      metaFields,
      callNumber: _current.callNumber ?? '',
      status: _current.status ?? '[在馆可借]',
      totalLabel: '馆藏推荐指数',
      totalValue: convertRatingToStars(rating),
      footerMessage: 'READ MORE, LIVE MORE',
      bottomNote: 'Echoes Reading Promotion · Keep the book warm',
    };
  },
};

/**
 * 预设 2：复古图书馆借书卡 / 借阅打卡卡片
 */
export const TEMPLATE_READING_LOG: ReceiptTemplateDef = {
  id: 'reading_log',
  name: '借阅记录卡',
  description: '复古图书馆借书卡排版，展示作者、题名、出版年，右上角继承 ISBN 后四位，含打卡流水记录',
  createInitialState: () => ({
    templateId: 'reading_log',
    themeId: 'cream',
    ditherEnabled: false,
    storeName: '書海回响',
    subtitle: 'SHANGHAI LIBRARY',
    cardNumber: '5399', // 右上角 CARD_NUMBER 继承 ISBN 后 4 位
    dateTimeText: formatReceiptDate(),
    terminal: '借阅服务台',
    servedBy: '读者本人',
    callNumber: 'I561.45/M28',
    status: '[已借出]',
    rating: '9.2',
    metaFields: [
      { key: 'author', label: 'Author', value: '[英] 毛姆', visible: true },
      { key: 'title', label: 'Title', value: '月亮与六便士', visible: true },
      { key: 'pub_year', label: 'Year', value: '2017', visible: true },
    ],
    borrowerRecords: generateRandomBorrowerRecords(4, '2017'),
    items: [],
    totalLabel: '',
    totalValue: '',
    barcodeText: '9787544253994',
    footerMessage:
      '借阅须知 RULES:\n1. 请爱护书籍，如有损坏照价赔偿。\n2. 借阅期为30天，可续借一次。\n3. 此卡仅限本人使用，请妥善保管。',
    bottomNote: 'Please return this book on or before the last date stamped.',
  }),
  mapFromBook: (book: BookMetadataInput, current = {}) => {
    const title = book.title || '月亮与六便士';
    const author = book.author || '';
    const rawYear = book.pub_year || book.publishDate || '';
    const yearMatch = rawYear.match(/\d{4}/);
    const pubYear = yearMatch ? yearMatch[0] : (rawYear || '2024');

    const ratingVal =
      book.rating !== undefined && book.rating !== null && String(book.rating).trim() !== ''
        ? String(book.rating)
        : '';
    const isbn = book.isbn || '9787544253994';

    // 提取 ISBN 后 4 位数字作为借书卡号 No. {{CARD_NUMBER}}
    let isbnLast4 = '';
    if (book.isbn) {
      const cleanIsbn = String(book.isbn).replace(/[^0-9X]/gi, '');
      if (cleanIsbn.length >= 4) {
        isbnLast4 = cleanIsbn.slice(-4);
      } else if (cleanIsbn.length > 0) {
        isbnLast4 = cleanIsbn;
      }
    }
    const cardNumber = isbnLast4 || current.cardNumber || '5399';
    const cover = book.cover_image_local || book.cover_image || book.coverUrl || null;

    // 仅保留 作者、题名、出版年 3 个字段
    const metaFields = [
      { key: 'author', label: 'Author', value: author, visible: true },
      { key: 'title', label: 'Title', value: title, visible: true },
      { key: 'pub_year', label: 'Year', value: pubYear, visible: true },
    ];

    // 如果已有借阅记录则复用，否则根据出版年份自动生成 4 条随机借阅流水
    const borrowerRecords =
      current.borrowerRecords && current.borrowerRecords.length > 0
        ? current.borrowerRecords
        : generateRandomBorrowerRecords(4, pubYear);

    return {
      storeName: current.storeName || '書海回响',
      subtitle: current.subtitle || 'SHANGHAI LIBRARY',
      cardNumber,
      rating: ratingVal,
      imageUrl: cover || current.imageUrl,
      barcodeText: isbn,
      metaFields,
      callNumber: current.callNumber ?? '',
      borrowerRecords,
      footerMessage:
        current.footerMessage ||
        '借阅须知 RULES:\n1. 请爱护书籍，如有损坏照价赔偿。\n2. 借阅期为30天，可续借一次。\n3. 此卡仅限本人使用，请妥善保管。',
      bottomNote: current.bottomNote || 'Please return this book on or before the last date stamped.',
    };
  },
};



/**
 * 预设 3：经典清单式小票（多品目 / 文创书单）
 */
export const TEMPLATE_ITEMIZED: ReceiptTemplateDef = {
  id: 'itemized',
  name: '经典清单小票',
  description: '复古收据清单风格，支持添加多行书目、文创品名、数量与价格',
  createInitialState: () => ({
    templateId: 'itemized',
    themeId: 'white',
    ditherEnabled: true,
    storeName: 'N STORE & BOOKS',
    subtitle: '* * * * * RECEIPT * * * * *',
    dateTimeText: formatReceiptDate(),
    terminal: '01-MAIN',
    servedBy: 'Admin',
    callNumber: '',
    status: '',
    rating: '',
    metaFields: [],
    items: [
      { id: '1', label: 'CUSTOM STICKER SET', value: '¥ 38.00', count: '01' },
      { id: '2', label: 'ARTBOOK VOL.2', value: '¥ 85.00', count: '02' },
      { id: '3', label: 'COFFEE BEAN 250G', value: '¥ 68.00', count: '01' },
    ],
    totalLabel: 'TOTAL:',
    totalValue: '¥ 191.00',
    barcodeText: '1092837465912',
    footerMessage: 'THANK YOU\nHAVE A NICE DAY',
    bottomNote: 'Retain this copy for your records.',
  }),
  mapFromBook: (book: BookMetadataInput, current = {}) => {
    const title = book.title || '书目精选';
    const cover = book.cover_image_local || book.cover_image || book.coverUrl || null;
    const existingItems = current.items && current.items.length > 0 ? current.items : [];

    const newItems = existingItems.length > 0
      ? [{ id: 'book-item', label: title, count: '01', value: '¥ 58.00' }, ...existingItems.slice(1)]
      : [{ id: '1', label: title, count: '01', value: '¥ 58.00' }];

    return {
      imageUrl: cover || current.imageUrl,
      barcodeText: book.isbn || current.barcodeText || '1092837465912',
      items: newItems,
      totalLabel: 'TOTAL:',
      totalValue: '¥ 58.00',
      status: current.status ?? '',
    };
  },
};

/**
 * 预设 4：清新文艺书摘小票（便签手账风格）
 */
export const TEMPLATE_BOOK_EXCERPT: ReceiptTemplateDef = {
  id: 'book_excerpt',
  name: '书摘小票',
  description: '清新手账便签风格书摘小票，明朝体排版、单段书摘横线底纹、极简无书名号与出版信息',
  createInitialState: () => ({
    templateId: 'book_excerpt',
    themeId: 'sage',
    ditherEnabled: false,
    storeName: '书摘分享',
    englishBanner: 'BOOK EXCERPT SHARING',
    userHandle: '@SH-LIBRARY',
    serialNumber: '003',
    rating: '8.9',
    excerptText: '催促不会改变什么、毕竟谁都不会硬着头皮犁冬天的地。',
    dateTimeText: formatReceiptDate(),
    terminal: '',
    servedBy: '',
    callNumber: '',
    status: '',
    metaFields: [
      { key: 'title', label: '题名', value: '明亮的夜晚', visible: true },
      { key: 'author', label: '作者', value: '崔恩荣', visible: true },
      { key: 'pub_info', label: '出版信息', value: '光启书局 · 2026', visible: true },
      { key: 'isbn', label: 'ISBN', value: '9787516835159', visible: false },
    ],
    items: [],
    totalLabel: '',
    totalValue: '',
    barcodeText: '9787516835159',
    footerMessage: '',
    bottomNote: '',
  }),
  mapFromBook: (book: BookMetadataInput, current = {}) => {
    // 1. 题名（不带书名号《》）
    const rawTitle = book.title?.trim() || '明亮的夜晚';
    const formattedTitle = rawTitle.replace(/^《+|》+$/g, '').trim() || rawTitle;

    // 2. 作者
    const author = book.author?.trim() || '崔恩荣';

    // 3. 出版社与出版年（格式：出版社 · 出版年）
    const publisher = book.publisher?.trim() || '';
    const rawYear = book.pub_year || book.publishDate || '';
    const yearMatch = rawYear.match(/\d{4}/);
    const pubYear = yearMatch ? yearMatch[0] : rawYear.trim();
    let pubInfo = '';
    if (publisher && pubYear) {
      pubInfo = `${publisher} · ${pubYear}`;
    } else if (publisher) {
      pubInfo = publisher;
    } else if (pubYear) {
      pubInfo = pubYear;
    } else {
      pubInfo = '光启书局 · 2026';
    }

    // 4. ISBN 与 序号
    const isbn = book.isbn?.trim() || current.barcodeText || '9787516835159';

    // 5. 书摘提取（若已有用户编辑则保留；否则从 summary 提取作为初值）
    let excerpt = current.excerptText;
    if (!excerpt) {
      const summaryText = book.summary || book.description || '';
      if (summaryText.trim()) {
        const sentences = summaryText.split(/(?<=[。！？\n])/);
        excerpt = sentences.slice(0, 2).join('').trim() || summaryText.slice(0, 80);
      } else {
        excerpt = '催促不会改变什么、毕竟谁都不会硬着头皮犁冬天的地。';
      }
    }

    const metaFields = [
      { key: 'title', label: '题名', value: formattedTitle, visible: true },
      { key: 'author', label: '作者', value: author, visible: true },
      { key: 'pub_info', label: '出版信息', value: pubInfo, visible: true },
      { key: 'isbn', label: 'ISBN', value: isbn, visible: false },
    ];

    const cover = book.cover_image_local || book.cover_image || book.coverUrl || null;

    return {
      storeName: current.storeName || '书摘分享',
      englishBanner: current.englishBanner || 'BOOK EXCERPT SHARING',
      userHandle: current.userHandle || '@SH-LIBRARY',
      serialNumber: current.serialNumber || '003',
      excerptText: excerpt,
      metaFields,
      barcodeText: isbn,
      imageUrl: cover || current.imageUrl,
    };
  },
};


/**
 * 预设 5：芭蕾餐厅小票复刻 - 复古纸质版
 */
export const TEMPLATE_RETRO_MENU: ReceiptTemplateDef = {
  id: 'retro_menu',
  name: '复古菜单',
  description: '复刻经典芭蕾餐厅菜单，带上下图片与边缘镂空齿孔',
  createInitialState: () => ({
    templateId: 'retro_menu',
    themeId: 'cream',
    ditherEnabled: true,
    storeName: '芭蕾餐厅',
    subtitle: 'MENU',
    dateTimeText: formatReceiptDate(),
    terminal: '',
    servedBy: '',
    callNumber: '',
    status: '',
    rating: '',
    metaFields: [],
    items: [
      { id: '1', label: '洛克菲勒生蚝', value: '100' },
      { id: '2', label: '蟹肉与扇贝', value: '210' },
      { id: '3', label: '巧克力柑橘慕斯', value: '156' },
    ],
    totalLabel: '',
    totalValue: '',
    barcodeText: '',
    footerMessage: '',
    bottomNote: '',
  }),
  mapFromBook: (book: BookMetadataInput, current = {}) => {
    const title = book.title || '书目精选';
    const author = book.author || 'AUTHOR';
    const publisher = book.publisher || '';
    const pubYear = book.pub_year || book.publishDate || '';
    const series = book.series || '';
    const producer = book.producer || '';
    const rating =
      book.rating !== undefined && book.rating !== null && String(book.rating).trim() !== ''
        ? String(book.rating)
        : '';

    const newItems = [];
    if (publisher) newItems.push({ id: 'publisher', label: '出版社', value: publisher });
    if (pubYear) newItems.push({ id: 'year', label: '出版时间', value: pubYear });
    if (series) newItems.push({ id: 'series', label: '丛书', value: series });
    if (producer) newItems.push({ id: 'producer', label: '出品方', value: producer });
    if (rating) newItems.push({ id: 'rating', label: '豆瓣评分', value: rating });

    // Fallback if no metadata
    if (newItems.length === 0) {
      newItems.push(
        { id: '1', label: '洛克菲勒生蚝', value: '100' },
        { id: '2', label: '蟹肉与扇贝', value: '210' },
        { id: '3', label: '巧克力柑橘慕斯', value: '156' }
      );
    }

    const cover = book.cover_image_local || book.cover_image || book.coverUrl || null;

    return {
      storeName: title,
      subtitle: author,
      imageUrl: cover || current.imageUrl,
      bottomImageUrl: cover || current.bottomImageUrl,
      items: newItems,
    };
  },
};

/**
 * 预设 6：古籍版心书签（严格对照四库全书/资治通鉴雕版式样，含书眉天头、乌丝栏流式字排、朱批句读、版心鱼尾与多印章体系）
 */
export const TEMPLATE_ANCIENT_BOOKMARK: ReceiptTemplateDef = {
  id: 'ancient_bookmark',
  name: '古籍书签',
  description: '严格对照古籍雕版原貌（四库全书/资治通鉴体例），含书眉天头、乌丝栏流式字排、朱批句读、版心鱼尾与多印章体系',
  createInitialState: () => ({
    templateId: 'ancient_bookmark',
    themeId: 'ancient',
    ditherEnabled: false,
    seriesTitle: '欽定四庫全書',
    storeName: '資治通鑑',
    banxinTitle: '資治通鑑卷一',
    leafNumber: '一',
    bookmarkExcerpt: '起著雍摄提格，尽玄黓困敦。初命晋大夫魏斯、赵籍、韩虔为诸侯。臣光曰：臣闻天子之职莫大于礼，礼莫大于分，分莫大于名。',
    bookmarkExtra: '宋 · 司马光 撰\n中华书局 · 2011年校刊',
    dateTimeText: formatReceiptDate(),
    terminal: '',
    servedBy: '',
    callNumber: '',
    status: '',
    rating: '9.8',
    metaFields: [
      { key: 'title', label: '书名', value: '资治通鉴', visible: true },
      { key: 'author', label: '作者', value: '司马光', visible: true },
      { key: 'publisher', label: '出版社', value: '中华书局', visible: true },
      { key: 'pub_year', label: '出版年', value: '2011', visible: true },
    ],
    items: [],
    totalLabel: '',
    totalValue: '',
    barcodeText: '9787101077759',
    footerMessage: '',
    bottomNote: '',
    bookmarkWidth: 'standard',
    seals: generateRandomSeals(),
  }),
  mapFromBook: (book: BookMetadataInput, current = {}) => {
    const rawTitle = book.title?.trim() || '资治通鉴';
    const cleanTitle = rawTitle.replace(/^《+|》+$/g, '').trim() || rawTitle;
    const author = book.author?.trim() || '';
    const publisher = book.publisher?.trim() || '';
    const rawYear = book.pub_year || book.publishDate || '';
    const yearMatch = rawYear.match(/\d{4}/);
    const pubYear = yearMatch ? yearMatch[0] : rawYear.trim();

    const seriesTitle = book.series?.trim() || current.seriesTitle || '欽定四庫全書';
    const leafNumber = current.leafNumber || '一';
    const banxin = `${cleanTitle}${book.subtitle?.trim() ? ' ' + book.subtitle.trim() : ''}`;

    // 智能提取摘要精粹
    let excerpt = '';
    const summaryText = (book.summary || book.description || '').replace(/\r\n/g, '\n').trim();
    if (summaryText) {
      excerpt = summaryText;
    } else {
      excerpt = current.bookmarkExcerpt || '起著雍摄提格，尽玄黓困敦。初命晋大夫魏斯、赵籍、韩虔为诸侯。臣光曰：臣闻天子之职莫大于礼，礼莫大于分，分莫大于名。';
    }

    // 格式化著者署名与出版刊印信息（符合古籍校刻体例）
    let extra = '';
    const authorFormatted = author
      ? (author.includes('撰') || author.includes('著') ? author : `${author} 撰`)
      : '';
    const pubFormatted = `${publisher ? publisher : ''}${pubYear ? (publisher ? ' · ' + pubYear + '年谨印' : pubYear + '年校刊') : '校刊'}`.trim();

    if (authorFormatted && pubFormatted) {
      extra = `${authorFormatted}\n${pubFormatted}`;
    } else if (authorFormatted) {
      extra = authorFormatted;
    } else if (pubFormatted) {
      extra = pubFormatted;
    } else {
      extra = current.bookmarkExtra || '宋 · 司马光 撰\n中华书局 · 2011年校刊';
    }

    const cover = book.cover_image_local || book.cover_image || book.coverUrl || null;
    const seals =
      current.seals && current.seals.length > 0 ? current.seals : generateRandomSeals();

    const metaFields = [
      { key: 'title', label: '题名', value: cleanTitle, visible: true },
      { key: 'author', label: '作者', value: author, visible: !!author },
      { key: 'publisher', label: '出版社', value: publisher, visible: !!publisher },
      { key: 'pub_year', label: '出版年', value: pubYear, visible: !!pubYear },
      { key: 'summary', label: '摘要', value: summaryText, visible: !!summaryText },
    ];

    return {
      seriesTitle,
      storeName: cleanTitle,
      banxinTitle: banxin,
      leafNumber,
      bookmarkExcerpt: excerpt,
      bookmarkExtra: extra,
      bookmarkWidth: current.bookmarkWidth || 'standard',
      rating: book.rating ? String(book.rating) : current.rating || '9.8',
      barcodeText: book.isbn || current.barcodeText || '9787101077759',
      imageUrl: cover || current.imageUrl,
      seals,
      metaFields,
    };
  },
};

/** 模板注册表（支持动态扩展） */
const templateRegistry = new Map<string, ReceiptTemplateDef>([
  [TEMPLATE_BOOK_RECOMMEND.id, TEMPLATE_BOOK_RECOMMEND],
  [TEMPLATE_READING_LOG.id, TEMPLATE_READING_LOG],
  [TEMPLATE_ITEMIZED.id, TEMPLATE_ITEMIZED],
  [TEMPLATE_BOOK_EXCERPT.id, TEMPLATE_BOOK_EXCERPT],
  [TEMPLATE_RETRO_MENU.id, TEMPLATE_RETRO_MENU],
  [TEMPLATE_ANCIENT_BOOKMARK.id, TEMPLATE_ANCIENT_BOOKMARK],
]);

/** 获取所有可用模板 */
export function getAllReceiptTemplates(): ReceiptTemplateDef[] {
  return Array.from(templateRegistry.values());
}

/** 获取指定模板 */
export function getReceiptTemplate(id?: ReceiptTemplateId): ReceiptTemplateDef {
  if (id && templateRegistry.has(id)) {
    return templateRegistry.get(id)!;
  }
  return TEMPLATE_BOOK_RECOMMEND;
}

/** 注册自定义模板（扩展机制） */
export function registerReceiptTemplate(template: ReceiptTemplateDef): void {
  templateRegistry.set(template.id, template);
}

/**
 * 公共核心函数：基于指定模板与图书元数据构造小票完整规范状态
 * @param templateId 模板 ID
 * @param book 上游图书元数据
 * @param savedData 用户在当前模板上的局部自定义数据（如用户修改过的文字、纸张颜色、点阵开关等）
 * @param options 可选项：overrideUserEdits（为 true 时强制重置所有用户编辑，回到纯净初始映射）、upstreamImageUrl（有效上游图片 URL）、
 *                upstreamTextExtra（上游文本节点输出的字段 JSON，如 VuFind 馆藏的 {"CALL_NUMBER": "..."}）
 */
export function buildReceiptState(
  templateId: ReceiptTemplateId = 'book_recommend',
  book?: BookMetadataInput | null,
  savedData: Partial<ReceiptState> = {},
  options: {
    overrideUserEdits?: boolean;
    upstreamImageUrl?: string | null;
    upstreamTextExtra?: string | null;
  } = {}
): ReceiptState {
  const template = getReceiptTemplate(templateId);
  const base = template.createInitialState();
  const hasValidBook = Boolean(
    book?.title?.trim() || book?.isbn?.trim() || book?.author?.trim()
  );
  const mergedFromBook = hasValidBook && book ? template.mapFromBook(book, base) : {};

  // 上游候选图片（按优先级已由外部组装好：② 直连图片节点 > ③ 连通图书封面 > ④ 根节点图书封面）
  const upstreamImage =
    options.upstreamImageUrl !== undefined && options.upstreamImageUrl !== null
      ? options.upstreamImageUrl
      : (mergedFromBook.imageUrl || null);

  // 提取用户持久化或传入的插图：优先取专门的 coverImageUrl；防止落盘的大图回流污染插图
  let explicitCoverImage = savedData.coverImageUrl;
  if (explicitCoverImage === undefined) {
    if (
      typeof savedData.imageUrl === 'string' &&
      !savedData.imageUrl.includes('/generations/') &&
      !savedData.imageUrl.includes('/receipt_')
    ) {
      explicitCoverImage = savedData.imageUrl;
    }
  }

  // 4 级图片优先级解析：
  // 1. 若强制重置（切换模板 / 重置为默认 / 同步图书）：清除手动标记，回归上游图片
  // 2. 若用户点击「移除图片」（explicitCoverImage === ''）：保持为空 null
  // 3. ① 第一优先级：用户手动上传的本地图片（customImage 为 true，或 explicitCoverImage 以 data: / blob: 开头）
  // 4. ②/③/④ 次级优先级：若无手动上传图片，自动使用上游候选图片 upstreamImage
  let resolvedImageUrl: string | null = null;
  let isCustom = false;

  if (options.overrideUserEdits) {
    resolvedImageUrl = upstreamImage;
    isCustom = false;
  } else if (explicitCoverImage === '') {
    resolvedImageUrl = null;
    isCustom = false;
  } else if (
    typeof explicitCoverImage === 'string' &&
    explicitCoverImage.trim() !== '' &&
    (savedData.customImage ||
      explicitCoverImage.startsWith('data:') ||
      explicitCoverImage.startsWith('blob:'))
  ) {
    resolvedImageUrl = explicitCoverImage;
    isCustom = true;
  } else {
    resolvedImageUrl =
      upstreamImage ||
      (typeof explicitCoverImage === 'string' && explicitCoverImage.trim() !== ''
        ? explicitCoverImage
        : null);
    isCustom = false;
  }

  // 底部图片处理（与顶部图片同等逻辑，用于 Retro Menu 双图片场景）
  const explicitBottomImage = savedData.bottomImageUrl;
  let resolvedBottomImageUrl: string | null = null;
  let isBottomCustom = false;

  if (options.overrideUserEdits) {
    resolvedBottomImageUrl = upstreamImage;
    isBottomCustom = false;
  } else if (explicitBottomImage === '') {
    resolvedBottomImageUrl = null;
    isBottomCustom = false;
  } else if (
    typeof explicitBottomImage === 'string' &&
    explicitBottomImage.trim() !== '' &&
    (savedData.bottomCustomImage ||
      explicitBottomImage.startsWith('data:') ||
      explicitBottomImage.startsWith('blob:'))
  ) {
    resolvedBottomImageUrl = explicitBottomImage;
    isBottomCustom = true;
  } else {
    resolvedBottomImageUrl =
      upstreamImage ||
      (typeof explicitBottomImage === 'string' && explicitBottomImage.trim() !== ''
        ? explicitBottomImage
        : null);
    isBottomCustom = false;
  }

  const state = {
    ...base,
    ...mergedFromBook,
    ...savedData,
    imageUrl: resolvedImageUrl,
    coverImageUrl: resolvedImageUrl,
    customImage: isCustom,
    bottomImageUrl: resolvedBottomImageUrl,
    bottomCustomImage: isBottomCustom,
    templateId,
    themeId: (savedData.themeId || base.themeId || 'white') as ReceiptThemeId,
    customThemeColor: savedData.customThemeColor || base.customThemeColor,
    ditherEnabled: savedData.ditherEnabled ?? base.ditherEnabled ?? false,
  } as ReceiptState;

  // 索书号公共继承逻辑（对所有含 callNumber 字段的模板通用，无需逐模板适配）：
  // 上游文本节点提供了索书号时，若当前值为空或仍是模板演示默认值（视为未编辑），
  // 自动继承上游值；用户手动填写过的真实索书号始终优先。
  const upstreamCallNumber = parseUpstreamCallNumber(options.upstreamTextExtra);
  if (upstreamCallNumber && typeof state.callNumber === 'string') {
    const cur = state.callNumber.trim();
    const def = typeof base.callNumber === 'string' ? base.callNumber.trim() : '';
    if (!cur || cur === def) state.callNumber = upstreamCallNumber;
  }

  return state;
}

/**
 * 将图书元数据融合进小票当前状态
 */
export function mergeBookMetadataIntoReceipt(
  bookData: BookMetadataInput,
  currentState: Partial<ReceiptState>
): Partial<ReceiptState> {
  const template = getReceiptTemplate(currentState.templateId);
  const patch = template.mapFromBook(bookData, currentState);
  return {
    ...currentState,
    ...patch,
  };
}
