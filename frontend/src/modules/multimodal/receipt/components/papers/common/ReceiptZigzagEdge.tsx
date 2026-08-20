import React from 'react';

interface ReceiptZigzagEdgeProps {
  /** 锯齿位置：顶部或底部 */
  position: 'top' | 'bottom';
  /** 背景填充色，通常对应当前热敏纸的 theme.bg */
  bgColor: string;
}

/**
 * 热敏小票撕纸锯齿边缘装饰组件
 */
export const ReceiptZigzagEdge: React.FC<ReceiptZigzagEdgeProps> = ({ position, bgColor }) => {
  const yOffset = position === 'top' ? '-8px' : '0px';

  return (
    <div
      className="w-full h-3 select-none pointer-events-none"
      style={{
        background: `radial-gradient(circle, transparent, transparent 50%, ${bgColor} 50%, ${bgColor} 100%) -7px ${yOffset} / 16px 16px repeat-x`,
      }}
    />
  );
};
