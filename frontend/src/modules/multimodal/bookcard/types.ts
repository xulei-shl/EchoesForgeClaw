/**
 * 图书卡片节点状态类型（持久化于 node.data）
 */

/** 与 receipt 共用的图书元数据结构（兼容豆瓣 API） */
export type { CardBookMetadata } from './fields';

/** 图书卡片节点持久化状态 */
export interface BookCardState {
  /** 选中的 HTML 模板 id（templates.ts 注册表键，文件名） */
  templateId: string;
  /** 装饰图池选中下标（null = 未选择，组件侧懒初始化随机值） */
  decorIndex?: number | null;
  /** 生成的完整卡片图（供下游 / 画廊读取） */
  imageUrl?: string | null;
  error?: string | null;
}
