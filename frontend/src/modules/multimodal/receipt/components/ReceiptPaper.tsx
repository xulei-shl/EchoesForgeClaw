import React from 'react';
import type { ReceiptState, ReceiptTemplateId } from '../types';
import { BookRecommendPaper } from './papers/BookRecommendPaper';
import { LibraryCardPaper } from './papers/LibraryCardPaper';
import { ItemizedReceiptPaper } from './papers/ItemizedReceiptPaper';
import { BookExcerptPaper } from './papers/BookExcerptPaper';

export interface ReceiptPaperProps {
  state: ReceiptState;
  onChange: (patch: Partial<ReceiptState>) => void;
  /** 上游可用的图片（如藏书票图或图书封面） */
  upstreamImageUrl?: string | null;
  disabled?: boolean;
}

/**
 * 小票模板组件策略映射表（按 templateId 注册）
 */
const TEMPLATE_COMPONENTS: Record<
  ReceiptTemplateId,
  React.ForwardRefExoticComponent<ReceiptPaperProps & React.RefAttributes<HTMLDivElement>>
> = {
  book_recommend: BookRecommendPaper,
  reading_log: LibraryCardPaper,
  itemized: ItemizedReceiptPaper,
  book_excerpt: BookExcerptPaper,
};

/**
 * 图书小票纸张统一分发器组件 (Receipt Paper Dispatcher)
 * 采用策略模式，根据当前 templateId 自动分发并渲染对应的独立模板组件
 */
export const ReceiptPaper = React.forwardRef<HTMLDivElement, ReceiptPaperProps>((props, ref) => {
  const Component = TEMPLATE_COMPONENTS[props.state.templateId] || BookRecommendPaper;
  return <Component ref={ref} {...props} />;
});

ReceiptPaper.displayName = 'ReceiptPaper';

export { BookRecommendPaper, LibraryCardPaper, ItemizedReceiptPaper, BookExcerptPaper };
