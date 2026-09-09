/**
 * 图书卡片节点状态类型（持久化于 node.data）
 */

import type { CardBookMetadata, CardFieldOptions } from './fields';
export type { CardBookMetadata, CardFieldOptions };

/** 图书卡片可编辑元数据项（同小票 ReceiptMetaField 模式） */
export interface BookCardMetaField {
  key: string;
  label: string;
  value: string;
  visible?: boolean;
}

/** 默认元数据字段标签映射 */
export const DEFAULT_META_FIELD_LABELS: Record<string, string> = {
  title: '题名',
  author: '作者',
  publisher: '出版社',
  pub_year: '出版年份',
  rating: '评分',
  recommendation: '推荐语',
  call_number: '索书号',
};

/** 图书卡片节点持久化状态 */
export interface BookCardState {
  /** 选中的 HTML 模板 id（templates.ts 注册表键，文件名） */
  templateId: string;
  /** 装饰图池选中下标（null = 未选择，组件侧懒初始化随机值） */
  decorIndex?: number | null;
  /** 生成的完整卡片图（供下游 / 画廊读取） */
  imageUrl?: string | null;
  error?: string | null;
  /** 字段处理选项 */
  fieldOptions?: CardFieldOptions;
  /** 连入图片中选作封面的下标（null = 使用元数据封面） */
  coverImageIndex?: number | null;
  /** 连入图片中选作装饰的下标（null = 使用装饰图池） */
  decorImageIndex?: number | null;
  /** 用户编辑的元数据字段（覆盖继承的图书元数据，同小票 metaFields 模式） */
  metaFields?: BookCardMetaField[];
  /** 额外补充字段（如索书号 CALL_NUMBER，元数据节点不提供，用户手动输入） */
  extraFields?: Record<string, string>;
}
