/**
 * 小票生成器核心数据类型与契约定义
 *
 * 遵循高内聚低耦合设计，主题与模板采用声明式定义，
 * 便于未来快速注册新的配色与场景模板。
 */

/** 预设主题标识（支持扩展自定义主题 key） */
export type ReceiptThemeId = 'white' | 'cream' | 'pink' | 'mint' | 'sage' | 'ancient' | 'purple' | 'custom' | string;

/** 预设模板标识（支持扩展自定义模板 key） */
export type ReceiptTemplateId =
  | 'book_recommend'
  | 'reading_log'
  | 'itemized'
  | 'book_excerpt'
  | 'retro_menu'
  | 'ancient_bookmark'
  | string;

/** 热敏纸主题配色定义 */
export interface ReceiptTheme {
  /** 唯一标识 */
  id: ReceiptThemeId;
  /** 主题中文名称 */
  name: string;
  /** 纸张背景色（Hex / RGB / OKLCH） */
  bg: string;
  /** 主要文字颜色（油墨墨色） */
  text: string;
  /** 次要 / 弱化文字颜色 */
  faint: string;
  /** 虚线分割线颜色 */
  dashed: string;
  /** 点缀高亮色（如星级、重要标记） */
  accent: string;
  /** 色块选择器预览色 */
  previewColor: string;
}

/** 小票清单明细项 */
export interface ReceiptItem {
  /** 唯一 ID */
  id: string;
  /** 项目名称 / 书名 */
  label: string;
  /** 对应数值 / 数量 / 价格 / 备注 */
  value?: string;
  /** 数量（可选，如 01, 02） */
  count?: string;
  /** 次要说明 / 索书号 / 备注（可选） */
  subtext?: string;
}

/** 小票结构化元数据项（如作者、出版社、索书号） */
export interface ReceiptMetaField {
  /** 字段标识 */
  key: string;
  /** 显示标签（如「作者」） */
  label: string;
  /** 字段值（如「鲁迅」） */
  value: string;
  /** 是否在小票中展示 */
  visible?: boolean;
}

/** 借书卡借阅打卡记录项 */
export interface BorrowerRecordItem {
  id: string;
  /** 应还/借阅日期（如 "2024-03-15"） */
  date: string;
  /** 借阅人姓名（如 "林徽因" / "A. Doyle"） */
  name: string;
  /** 盖章日期轻微旋转样式（如 "rotate-1", "-rotate-2", ""） */
  rotation?: string;
  /** 借阅人手写字体样式（如 "font-handwriting-cn", "font-handwriting-en"） */
  fontClass?: string;
}

/** 古籍书签多印章项 */
export interface ReceiptSealItem {
  id: string;
  src: string;
  name?: string;
  positionPreset?: string;
  width?: number;
  height?: number;
  leftPercent?: number;
  topPercent?: number;
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  rotate?: number;
  opacity?: number;
}


/** 注入到小票的图书元数据契约（兼容豆瓣 API 结构） */
export interface BookMetadataInput {
  isbn?: string;
  title?: string;
  subtitle?: string;
  author?: string;
  translator?: string;
  publisher?: string;
  producer?: string;
  series?: string;
  pub_year?: string;
  publishDate?: string;
  rating?: number | string;
  coverUrl?: string;
  cover_image?: string;
  cover_image_local?: string;
  summary?: string;
  description?: string;
  [key: string]: any;
}

/** 小票完整状态（持久化于 node.data） */
export interface ReceiptState {
  /** 模板 ID */
  templateId: ReceiptTemplateId;
  /** 配色主题 ID */
  themeId: ReceiptThemeId;
  /** 自定义纸色种子色 Hex（themeId 为 'custom' 时生效） */
  customThemeColor?: string;
  /** 是否开启热敏黑白点阵（Dither）滤镜 */
  ditherEnabled: boolean;
  /** 顶部店名 / 馆名 / 标题 */
  storeName: string;
  /** 副标题（如 ***** RECEIPT ***** 或 ★ 图书借阅推荐 ★） */
  subtitle: string;
  /** 票据日期时间（留空则显示当前时间） */
  dateTimeText: string;
  /** 终端号 / 阅览室号（如 01-MAIN / 文学借阅室） */
  terminal: string;
  /** 经手人 / 操作员 / 推荐人（如 Admin / 馆员小李） */
  servedBy: string;
  /** 当前选用的图片 URL（可以是上游生成图、图书封面或本地上传图） */
  imageUrl?: string | null;
  /** 持久化插图字段（与导出的整张小票产物图分离） */
  coverImageUrl?: string | null;
  /** 是否为用户就地手动上传 / 指定的自定义图片（优先级高于所有上游图片） */
  customImage?: boolean;
  /** 底部图片 URL */
  bottomImageUrl?: string | null;
  /** 底部图片是否为用户自定义 */
  bottomCustomImage?: boolean;
  /** 结构化图书元数据字段列表（题名、作者、出版社、年份等） */
  metaFields: ReceiptMetaField[];
  /** 索书号（Call Number，支持留空或自定义） */
  callNumber: string;
  /** 馆藏状态 / 流通状态（如 [在馆可借] / 借出 / 馆内阅览） */
  status?: string;
  /** 评分 / 推荐星级（如 9.2 或 ★★★★★） */
  rating: string;
  /** 经典明细条目列表（适用于清单模式） */
  items: ReceiptItem[];
  /** 统计 / 总计信息（如 TOTAL / 藏书推荐指数 / 共 3 册） */
  totalLabel: string;
  totalValue: string;
  /** 底部 ISBN / 借阅条形码内容（数字或编码字符串） */
  barcodeText: string;
  /** 条形码下方主提示语（如 THANK YOU / 慢读时光） */
  footerMessage: string;
  /** 最底部小字备注文案（如 Retain this copy for your records / 凭票入馆） */
  bottomNote: string;
  /** 借书卡右上角卡号 / 豆瓣评分（如 "9.2"） */
  cardNumber?: string;
  /** 借书卡借阅打卡记录列表 */
  borrowerRecords?: BorrowerRecordItem[];
  /** 书摘小票书摘主体文本（中文/首段） */
  excerptText?: string;
  /** 书摘小票第二段/英文书摘（手账横线本排版） */
  excerptSecondaryText?: string;
  /** 书摘小票左上角用户账号 / 署名（如 "@SH-LIBRARY"） */
  userHandle?: string;
  /** 书摘小票右上角编号（如 "003" / "NO.01"） */
  serialNumber?: string;
  /** 书摘小票英文胶囊横幅文案（如 "BOOK EXCERPT SHARING"） */
  englishBanner?: string;
  /** 古籍书签书眉丛书名（如 "欽定四庫全書" / "典藏精選"） */
  seriesTitle?: string;
  /** 古籍书签版心叶码（如 "一" / "葉一"） */
  leafNumber?: string;
  /** 古籍书签版心文字（如 "資治通鑑卷一" / "百年孤独"） */
  banxinTitle?: string;
  /** 古籍书签第二列文摘提要（如 "起著雍摄提格\n尽玄黓困敦"） */
  bookmarkExcerpt?: string;
  /** 古籍书签第三列出版与责任者（如 "[著者] 加西亚·马尔克斯\n南海出版公司 · 2011"） */
  bookmarkExtra?: string;
  /** 古籍书签排版宽度规格（'narrow' | 'standard' | 'wide' | 'extra_wide'） */
  bookmarkWidth?: AncientBookmarkWidth;
  /** 古籍书签随机印章列表 */
  seals?: ReceiptSealItem[];
}

/** 古籍书签规格选项标识 */
export type AncientBookmarkWidth = 'narrow' | 'standard' | 'wide' | 'extra_wide';

export interface AncientBookmarkWidthOption {
  id: AncientBookmarkWidth;
  label: string;
  domWidth: number;
  canvasWidth: number;
  description: string;
}

/** 古籍书签多规格预设列表 */
export const ANCIENT_BOOKMARK_WIDTH_OPTIONS: AncientBookmarkWidthOption[] = [
  { id: 'narrow', label: '窄版书签 (300px)', domWidth: 300, canvasWidth: 420, description: '短句题词 (50~90字)' },
  { id: 'standard', label: '标准书帖 (380px)', domWidth: 380, canvasWidth: 532, description: '中篇书摘 (100~180字)' },
  { id: 'wide', label: '宽版经页 (460px)', domWidth: 460, canvasWidth: 644, description: '详实简介 (180~280字)' },
  { id: 'extra_wide', label: '长卷雕版 (540px)', domWidth: 540, canvasWidth: 756, description: '长篇文选 (280~400字)' },
];

/** 获取古籍书签宽度配置 */
export function getAncientBookmarkWidthConfig(widthId?: AncientBookmarkWidth): AncientBookmarkWidthOption {
  return (
    ANCIENT_BOOKMARK_WIDTH_OPTIONS.find((opt) => opt.id === widthId) ||
    ANCIENT_BOOKMARK_WIDTH_OPTIONS[1] // 默认标准版 380px
  );
}

/** 模板规范定义接口（方便新增扩展模板） */
export interface ReceiptTemplateDef {
  /** 模板唯一标识 */
  id: ReceiptTemplateId;
  /** 模板中文名称 */
  name: string;
  /** 模板描述 */
  description: string;
  /** 默认初始状态生成器 */
  createInitialState: () => Partial<ReceiptState>;
  /** 基于图书元数据生成小票状态的转换器 */
  mapFromBook: (book: BookMetadataInput, currentState?: Partial<ReceiptState>) => Partial<ReceiptState>;
}
