import type { BookMetadataInput, ReceiptState, ReceiptTemplateDef, ReceiptTemplateId } from './types';

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
    storeName: 'ECHOES LIBRARY',
    subtitle: '★ BOOK RECOMMENDATION ★',
    dateTimeText: formatReceiptDate(),
    terminal: '01-DESK',
    servedBy: 'Librarian',
    callNumber: '', // 索书号默认留空
    rating: '9.2',
    metaFields: [
      { key: 'title', label: '书名', value: '百年孤独', visible: true },
      { key: 'author', label: '作者', value: '[哥伦比亚] 加西亚·马尔克斯', visible: true },
      { key: 'publisher', label: '出版社', value: '南海出版公司', visible: true },
      { key: 'pub_year', label: '出版时间', value: '2011-6', visible: true },
    ],
    items: [],
    totalLabel: '馆藏推荐指数',
    totalValue: '★★★★★',
    barcodeText: '9787544253994',
    footerMessage: 'READ MORE, LIVE MORE',
    bottomNote: 'Echoes Reading Promotion · Keep the book warm',
  }),
  mapFromBook: (book: BookMetadataInput, current = {}) => {
    const title = book.title || current.storeName || '未命名书目';
    const author = book.author || '';
    const publisher = book.publisher || '';
    const pubYear = book.pub_year || book.publishDate || '';
    const rating = book.rating != null ? String(book.rating) : '9.0';
    const isbn = book.isbn || '9787020002207';
    const cover = book.cover_image_local || book.cover_image || book.coverUrl || null;

    const metaFields = [
      { key: 'title', label: '书名', value: title, visible: true },
      { key: 'author', label: '作者', value: author, visible: !!author },
      { key: 'publisher', label: '出版社', value: publisher, visible: !!publisher },
      { key: 'pub_year', label: '出版年', value: pubYear, visible: !!pubYear },
    ];

    if (book.translator) {
      metaFields.push({ key: 'translator', label: '译者', value: book.translator, visible: true });
    }

    return {
      storeName: 'ECHOES LIBRARY',
      subtitle: '★ BOOK RECOMMENDATION ★',
      imageUrl: cover || current.imageUrl,
      rating,
      barcodeText: isbn,
      metaFields,
      // 索书号保留现有或空
      callNumber: current.callNumber ?? '',
      totalLabel: '馆藏推荐指数',
      totalValue: rating ? `★ ${rating} 分` : '★★★★★',
      footerMessage: 'READ MORE, LIVE MORE',
    };
  },
};

/**
 * 预设 2：借阅通行证 / 读书打卡小票
 */
export const TEMPLATE_READING_LOG: ReceiptTemplateDef = {
  id: 'reading_log',
  name: '借阅打卡小票',
  description: '读者借阅凭证 / 读书打卡记录，包含借阅日期、应还日期、打卡人与阅读书摘',
  createInitialState: () => ({
    templateId: 'reading_log',
    themeId: 'cream',
    ditherEnabled: true,
    storeName: 'READING PASSPORT',
    subtitle: '❖ 借阅记录 & 读书打卡 ❖',
    dateTimeText: formatReceiptDate(),
    terminal: '借阅服务台',
    servedBy: '读者本人',
    callNumber: '',
    rating: '★ 5.0',
    metaFields: [
      { key: 'title', label: '书名', value: '月亮与六便士', visible: true },
      { key: 'author', label: '作者', value: '[英] 毛姆', visible: true },
      { key: 'location', label: '借阅馆藏', value: '总馆二楼社科区', visible: true },
    ],
    items: [],
    totalLabel: '借阅期限',
    totalValue: '30 DAYS',
    barcodeText: '20260819001',
    footerMessage: '满地都是六便士，他却抬头看见了月亮',
    bottomNote: '请于应还日期前归还 · 保持书籍整洁',
  }),
  mapFromBook: (book: BookMetadataInput, current = {}) => {
    const title = book.title || '借阅书目';
    const author = book.author || '';
    const isbn = book.isbn || '20260819001';
    const cover = book.cover_image_local || book.cover_image || book.coverUrl || null;

    return {
      storeName: 'READING PASSPORT',
      subtitle: '❖ 借阅记录 & 读书打卡 ❖',
      imageUrl: cover || current.imageUrl,
      barcodeText: isbn,
      metaFields: [
        { key: 'title', label: '书名', value: title, visible: true },
        { key: 'author', label: '作者', value: author, visible: !!author },
        { key: 'location', label: '借阅馆藏', value: '文学社科借阅区', visible: true },
      ],
      callNumber: current.callNumber ?? '',
      totalLabel: '借阅期限',
      totalValue: '30 DAYS',
      footerMessage: book.summary ? book.summary.slice(0, 36) + '...' : '每一本书都是一次心灵的远行',
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
    };
  },
};

/** 模板注册表（支持动态扩展） */
const templateRegistry = new Map<string, ReceiptTemplateDef>([
  [TEMPLATE_BOOK_RECOMMEND.id, TEMPLATE_BOOK_RECOMMEND],
  [TEMPLATE_READING_LOG.id, TEMPLATE_READING_LOG],
  [TEMPLATE_ITEMIZED.id, TEMPLATE_ITEMIZED],
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
