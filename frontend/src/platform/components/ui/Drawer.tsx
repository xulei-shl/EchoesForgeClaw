import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
  className?: string;
  ariaLabel?: string;
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  headerRight,
  children,
  footer,
  width = 'w-[520px] max-w-[92vw]',
  className = '',
  ariaLabel = '详情面板',
}) => {
  // 监听 Esc 键关闭抽屉
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

  // 背景滚动锁定（Body Scroll Lock）
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === 'string' ? title : ariaLabel}
          className="fixed inset-0 z-50 pointer-events-none"
        >
          {/* 遮罩层 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute inset-0 pointer-events-auto bg-black/20 backdrop-blur-[2px]"
            onClick={onClose}
          />

          {/* 抽屉容器 */}
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute right-0 top-0 h-full ${width} bg-paper border-l border-paper-grid shadow-[-4px_0_24px_rgba(43,41,38,0.12)] flex flex-col pointer-events-auto ${className}`}
          >
            {/* 头部标题栏 */}
            <div className="flex items-center justify-between px-5 h-[56px] shrink-0 border-b border-paper-grid/60 bg-paper/95 backdrop-blur">
              <div className="flex items-center gap-2 min-w-0">
                {typeof title === 'string' ? (
                  <h2 className="font-serif text-lg font-bold text-ink truncate">{title}</h2>
                ) : (
                  title
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {headerRight}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="关闭面板 (Esc)"
                  title="关闭 (Esc)"
                  className="p-2 rounded-md text-ink-light hover:text-ink hover:bg-paper-grid/30 active:scale-[0.96] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent flex items-center justify-center min-w-[36px] min-h-[36px]"
                >
                  <X size={18} strokeWidth={1.5} />
                </button>
              </div>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5 relative focus-visible:outline-none">
              {children}
            </div>

            {/* 底部操作栏（可选） */}
            {footer && (
              <div className="flex items-center justify-end gap-2 px-5 py-3 shrink-0 border-t border-paper-grid/60 bg-paper/90 backdrop-blur">
                {footer}
              </div>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
};

export default Drawer;
