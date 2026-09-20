import React, { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

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

  /** 切篇导航：是否存在上一条 */
  hasPrev?: boolean;
  /** 切篇导航：是否存在下一条 */
  hasNext?: boolean;
  /** 切篇导航：上一切篇回调 */
  onPrev?: () => void;
  /** 切篇导航：下一切篇回调 */
  onNext?: () => void;
  /** 上一切篇按钮提示，默认「上一条 (←)」 */
  prevTitle?: string;
  /** 下一切篇按钮提示，默认「下一条 (→)」 */
  nextTitle?: string;
}

/**
 * 全局右侧抽屉容器：
 * - 采用与 Dialog 相同的纯 CSS 硬件加速关键帧动效（运行于合成器线程 Compositor Thread），
 *   彻底摆脱 JS 主线程与 requestAnimationFrame 循环调度压力，主线程执行大任务时亦绝对满帧不掉帧；
 * - 共享 useBodyScrollLock 滚动条差额补偿，防止 Windows 下页面 17px 剧烈重排颠簸；
 * - 内置切篇导航与键盘 ArrowLeft/ArrowRight 全局监听（自动避开表单输入），业务页面零冗余代码；
 * - 严禁引入 backdrop-blur 滤镜，以保障最高 GPU 渲染效率。
 */
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
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  prevTitle = '上一条 (←)',
  nextTitle = '下一条 (→)',
}) => {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  // 平滑退场生命周期管理（0.18s 纯 CSS 硬件退场）
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = window.setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, 180);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen, shouldRender]);

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

  // 内置切篇导航：监听键盘左右键切篇（自动排除输入框聚焦状态）
  useEffect(() => {
    if (!isOpen || (!onPrev && !onNext)) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      if (e.key === 'ArrowLeft' && onPrev && hasPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'ArrowRight' && onNext && hasNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onPrev, onNext, hasPrev, hasNext]);

  // 背景滚动锁定（带滚动条宽度补偿，防 Windows 页面 17px 重排颠簸）
  useBodyScrollLock(isOpen);

  if (!shouldRender) return null;

  const showNav = onPrev != null || onNext != null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : ariaLabel}
      className="fixed inset-0 z-50 pointer-events-none"
    >
      {/* 遮罩层：纯 CSS 硬件动画，脱离 JS 主线程 */}
      <div
        className={`absolute inset-0 pointer-events-auto bg-ink/30 ${
          isClosing ? 'drawer-backdrop-out' : 'drawer-backdrop-in'
        }`}
        onClick={onClose}
      />

      {/* 抽屉容器：纯 CSS 硬件合成器 translate3d 平移，与 Dialog 相同技术底座 */}
      <aside
        className={`absolute right-0 top-0 h-full ${width} bg-paper border-l border-paper-grid shadow-[-8px_0_28px_rgba(43,41,38,0.08)] flex flex-col pointer-events-auto ${className} ${
          isClosing ? 'drawer-panel-out' : 'drawer-panel-in'
        }`}
      >
        {/* 头部标题栏 */}
        <div className="flex items-center justify-between px-5 h-[56px] shrink-0 border-b border-paper-grid/60 bg-paper">
          <div className="flex items-center gap-2 min-w-0">
            {typeof title === 'string' ? (
              <h2 className="font-serif text-lg font-bold text-ink truncate">{title}</h2>
            ) : (
              title
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* 内置切篇导航控件 */}
            {showNav && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onPrev}
                  disabled={!hasPrev}
                  aria-label={prevTitle}
                  title={prevTitle}
                  className="p-1.5 rounded-md text-ink-light hover:text-ink hover:bg-paper-grid/30 active:scale-[0.96] transition-[transform,color,background-color] duration-150 ease-out disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                  <ChevronLeft size={18} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={onNext}
                  disabled={!hasNext}
                  aria-label={nextTitle}
                  title={nextTitle}
                  className="p-1.5 rounded-md text-ink-light hover:text-ink hover:bg-paper-grid/30 active:scale-[0.96] transition-[transform,color,background-color] duration-150 ease-out disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                  <ChevronRight size={18} strokeWidth={1.75} />
                </button>
                <div className="h-4 w-px bg-paper-grid/50 mx-1" />
              </div>
            )}

            {headerRight}

            <button
              type="button"
              onClick={onClose}
              aria-label="关闭面板 (Esc)"
              title="关闭 (Esc)"
              className="p-2 rounded-md text-ink-light hover:text-ink hover:bg-paper-grid/30 active:scale-[0.96] transition-[transform,color,background-color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent flex items-center justify-center min-w-[36px] min-h-[36px]"
            >
              <X size={18} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* 内容区：列向 flex 滚动容器，子元素一律 shrink-0，
            避免折叠块展开后内容超高时默认的 flex-shrink 压缩已有元素（如图片预览被压小、文字重叠），
            保证「展开只追加内容并滚动」，不改变已有元素布局 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5 relative focus-visible:outline-none custom-scrollbar [&>*]:shrink-0">
          {children}
        </div>

        {/* 底部操作栏（可选） */}
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] shrink-0 border-t border-paper-grid/60 bg-paper">
            {footer}
          </div>
        )}
      </aside>
    </div>
  );
};

export default Drawer;
