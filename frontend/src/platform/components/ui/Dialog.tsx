import React, { useEffect } from 'react';
import { CornerDecorations } from './CornerDecorations';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** 标题（缺省不显示标题栏） */
  title?: React.ReactNode;
  /** 正文内容 */
  children?: React.ReactNode;
  /** 底部操作区 */
  footer?: React.ReactNode;
  /** 是否允许通过 Esc / 点击遮罩关闭（默认 true） */
  dismissible?: boolean;
  /** 打开后自动聚焦的元素 */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** 弹窗面板的自定义类名，可用于覆盖默认宽度（如 max-w-lg） */
  panelClassName?: string;
}

/**
 * 全局统一的弹出对话框容器：纸张质感 + 虚线边框 + 四角装饰，
 * 与全站「藏书票」设计语言保持一致。所有页面弹窗都经由它渲染。
 */
export const Dialog: React.FC<DialogProps> = ({
  open,
  onClose,
  title,
  children,
  footer,
  dismissible = true,
  initialFocusRef,
  panelClassName = 'max-w-md',
}) => {
  // Esc 关闭
  useEffect(() => {
    if (!open || !dismissible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, dismissible, onClose]);

  // 打开时锁定背景滚动
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // 自动聚焦（等待面板挂载完成）
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      initialFocusRef?.current?.focus({ preventScroll: true });
    }, 30);
    return () => window.clearTimeout(timer);
  }, [open, initialFocusRef]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
    >
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
        onClick={() => dismissible && onClose()}
      />

      {/* 面板 */}
      <div className={`relative w-full bg-node-bg rounded-lg border border-dashed border-paper-grid shadow-[0_16px_48px_rgba(43,41,38,0.22)] flex flex-col max-h-[90vh] dialog-panel ${panelClassName}`}>
        {/* 四角装饰 */}
        <CornerDecorations borderColorClass="border-accent/60" />

        {title != null && (
          <div className="shrink-0 px-5 pt-4 pb-3 border-b border-dashed border-paper-grid">
            <h2 className="font-serif text-lg font-semibold text-ink leading-snug">{title}</h2>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4">{children}</div>

        {footer != null && (
          <div className="shrink-0 px-5 py-3 border-t border-dashed border-paper-grid flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
