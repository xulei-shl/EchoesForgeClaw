import React from 'react';

interface CornerDecorationsProps {
  /** 额外的 CSS 类名 */
  className?: string;
  /** 边框颜色类名，默认为 'border-accent' */
  borderColorClass?: string;
}

/**
 * 纸张/卡片四角的直角边框装饰（藏书票视觉语言）
 * 需配合父容器的 `relative` 使用
 */
export const CornerDecorations: React.FC<CornerDecorationsProps> = ({
  className = '',
  borderColorClass = 'border-accent'
}) => {
  return (
    <>
      <span className={`pointer-events-none absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 ${borderColorClass} ${className}`} aria-hidden="true" />
      <span className={`pointer-events-none absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 ${borderColorClass} ${className}`} aria-hidden="true" />
      <span className={`pointer-events-none absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 ${borderColorClass} ${className}`} aria-hidden="true" />
      <span className={`pointer-events-none absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 ${borderColorClass} ${className}`} aria-hidden="true" />
    </>
  );
};
