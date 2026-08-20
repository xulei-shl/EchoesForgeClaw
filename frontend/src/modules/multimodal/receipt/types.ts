/**
 * 小票生成器核心数据类型与契约定义
 *
 * 遵循高内聚低耦合设计，主题与模板采用声明式定义，
 * 便于未来快速注册新的配色与场景模板。
 */

/** 预设主题标识（支持扩展自定义主题 key） */
export type ReceiptThemeId = 'white' | 'cream' | 'pink' | 'mint' | 'purple' | string;

/** 预设模板标识（支持扩展自定义模板 key） */
export type ReceiptTemplateId = 'book_recommend' | 'reading_log' | 'itemized' | string;

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

/** 注入到小票的图书元数据契约（兼容豆瓣 API 结构） */
export interface BookMetadataInput {
  isbn?: string;
  title?: string;
  subtitle?: string;
  author?: string;
  translator?: string;
  publisher?: string;
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
  /** 结构化图书元数据字段列表（题名、作者、出版社、年份等） */
  metaFields: ReceiptMetaField[];
  /** 索书号（Call Number，支持留空或自定义） */
  callNumber: string;
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
