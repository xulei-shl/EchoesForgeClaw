import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export interface NodeSideDrawerProps {
  /** 是否展开抽屉 */
  isOpen: boolean;
  /** 关闭抽屉回调 */
  onClose: () => void;
  /** 抽屉主标题 */
  title?: string;
  /** 抽屉副标题或说明 */
  subtitle?: string;
  /** 标题旁的前缀图标 */
  icon?: React.ReactNode;
  /** 吸附在节点的哪一侧（默认右侧 'right'，亦可切换为左侧 'left'） */
  side?: 'right' | 'left';
  /** 抽屉固定宽度 (px)，默认 280 */
  width?: number;
  /** 头部右侧额外操作插槽（如一键重置按钮） */
  headerExtra?: React.ReactNode;
  /** 底部操作栏插槽 */
  footer?: React.ReactNode;
  /** 抽屉内部主体内容 */
  children: React.ReactNode;
  /** 自定义外层样式 */
  className?: string;
}

/**
 * 节点侧边吸附检查器抽屉（Node Side Inspector Drawer）
 *
 * 设计特性：
 * 1. 吸附于节点外边缘（默认右侧），绝不遮挡节点本体的画面与交互；
 * 2. 独立滚动与状态流，自带事件隔离，防止拖拽滑块或点击时触发画布画布平移/节点移动；
 * 3. 严格遵循 better-layout 负空间分组与对齐规范，易于扩展复用到全站各类多模态节点。
 */
export const NodeSideDrawer: React.FC<NodeSideDrawerProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  side = 'right',
  width = 280,
  headerExtra,
  footer,
  children,
  className = '',
}) => {
  const drawerRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  // 监听 isOpen 变化实现平滑退场过渡 (Subtle Exit Transition)
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsAnimatingOut(false);
    } else if (shouldRender) {
      setIsAnimatingOut(true);
      const timer = window.setTimeout(() => {
        setShouldRender(false);
        setIsAnimatingOut(false);
      }, 150);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen, shouldRender]);

  // 监听 Escape 键快速收起抽屉
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!shouldRender) return null;

  const isRight = side === 'right';
  const isVisible = isOpen && !isAnimatingOut;

  return (
    <aside
      ref={drawerRef}
      aria-label={title || '节点配置抽屉'}
      style={{
        width: `${width}px`,
        ...(isRight ? { left: 'calc(100% + 12px)' } : { right: 'calc(100% + 12px)' }),
      }}
      className={`absolute top-0 bottom-0 min-h-[480px] z-40 bg-paper/95 backdrop-blur-md border border-paper-grid/80 rounded-xl shadow-2xl flex flex-col overflow-hidden text-ink select-none transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none ${
        isVisible
          ? 'opacity-100 translate-x-0'
          : isRight
            ? 'opacity-0 -translate-x-2'
            : 'opacity-0 translate-x-2'
      } ${className}`}
      // 事件拦截：防止点击与滑动穿透触发外层画布拖动或节点位移
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* 抽屉头部 */}
      <header className="flex items-center justify-between px-3 py-2 border-b border-paper-grid/50 bg-paper-grid/10 shrink-0 gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {icon && <span className="text-accent shrink-0 flex items-center">{icon}</span>}
          <div className="flex flex-col min-w-0">
            {title && (
              <h3 className="font-serif font-semibold text-xs text-ink truncate leading-tight">
                {title}
              </h3>
            )}
            {subtitle && (
              <span className="text-[10px] text-ink-faint truncate leading-tight mt-0.5">
                {subtitle}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {headerExtra}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭配置抽屉"
            title="关闭 (Esc)"
            className="relative p-1 rounded text-ink-light hover:text-ink hover:bg-paper-grid/50 active:scale-[0.96] transition cursor-pointer before:absolute before:-inset-2 before:content-['']"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {/* 抽屉主体内容区（带独立原生平滑滚动） */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 min-h-0 text-xs">
        {children}
      </div>

      {/* 抽屉底部操作栏（可选） */}
      {footer && (
        <footer className="px-3 py-2 border-t border-paper-grid/50 bg-paper-grid/10 shrink-0">
          {footer}
        </footer>
      )}
    </aside>
  );
};
