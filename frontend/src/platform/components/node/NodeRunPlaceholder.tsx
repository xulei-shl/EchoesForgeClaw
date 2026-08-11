import React from 'react';

export interface NodeRunPlaceholderProps {
  /** 顶部图标或自定义内容 */
  icon?: React.ReactNode;
  /** 主要提示文案 */
  text: React.ReactNode;
  /** 次要说明文案（药丸形状的徽章形式展示） */
  subtext?: React.ReactNode;
  /** 底部额外插槽，如上传按钮 */
  children?: React.ReactNode;
  /** 是否展示跳动的加载中小圆点，默认 true */
  activePulse?: boolean;
  /** 背景层，如参考图的模糊毛玻璃背景 */
  bgOverlay?: React.ReactNode;
  className?: string;
}

/**
 * 节点待运行/空状态下的统一样式占位符
 */
export const NodeRunPlaceholder: React.FC<NodeRunPlaceholderProps> = ({
  icon,
  text,
  subtext,
  children,
  activePulse = true,
  bgOverlay,
  className = ''
}) => {
  return (
    <div className={`relative flex flex-col items-center justify-center gap-3 flex-1 min-h-[160px] text-center rounded-lg border border-dashed border-paper-grid bg-paper-grid/30 overflow-hidden transition-colors ${className}`}>
      {bgOverlay}
      <div className="relative z-10 flex flex-col items-center gap-3 p-4 w-full">
        {icon && (
          <div className="relative flex items-center justify-center shrink-0">
            {icon}
          </div>
        )}
        
        <div className="flex flex-col gap-2 items-center w-full">
          <div className="flex items-center justify-center gap-2 w-full">
            <span className="text-[13px] text-ink-light font-medium">{text}</span>
            {activePulse && (
              <div className="flex gap-1 shrink-0">
                <div className="w-1 h-1 rounded-full bg-ink-faint/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1 h-1 rounded-full bg-ink-faint/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1 h-1 rounded-full bg-ink-faint/50 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            )}
          </div>
          {subtext && (
            <span className="text-[11px] text-ink-faint bg-paper-grid/50 px-2.5 py-0.5 rounded-full border border-paper-grid/50 shadow-sm text-center">
              {subtext}
            </span>
          )}
        </div>
        
        {children}
      </div>
    </div>
  );
};

export default NodeRunPlaceholder;
