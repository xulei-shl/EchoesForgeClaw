import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ColorPicker } from './ColorPicker';
import { normalizeHex } from './colorUtils';

export interface ColorPickerPopoverProps {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  /** 自定义触发器渲染 */
  children?: React.ReactNode;
  /** 弹出层对齐方向，默认 'left' */
  align?: 'left' | 'right';
}

export const ColorPickerPopover: React.FC<ColorPickerPopoverProps> = memo(({
  value,
  onChange,
  disabled = false,
  children,
  align = 'left',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    placement: 'top' | 'bottom';
  }>({ left: 0, placement: 'bottom' });

  const normHex = normalizeHex(value || '#000000');

  // 计算视口绝对坐标与纵向智能翻转
  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    // ColorPicker 浮层宽度约为 230px（210px 面板 + 边框与间距），展开高度约为 265px
    const popoverWidth = 230;
    const popoverHeight = 265;
    const gap = 6;
    const margin = 8;

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    // 纵向：若下方空间不足容纳弹层，且上方空间比下方更大，则自动向上展开
    const placeTop = spaceBelow < popoverHeight && spaceAbove > spaceBelow;

    // 横向：根据 align 决定对齐方式，并添加视口防溢出保护
    let left = align === 'right' ? rect.right - popoverWidth : rect.left;
    left = Math.max(margin, Math.min(window.innerWidth - popoverWidth - margin, left));

    if (placeTop) {
      setCoords({
        bottom: window.innerHeight - rect.top + gap,
        left,
        placement: 'top',
      });
    } else {
      setCoords({
        top: rect.bottom + gap,
        left,
        placement: 'bottom',
      });
    }
  }, [align]);

  const toggleOpen = useCallback(() => {
    if (disabled) return;
    if (!isOpen) {
      updatePosition();
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }, [disabled, isOpen, updatePosition]);

  // 点击外部自动关闭 + Escape 键监听 + 滚动/视口缩放时同步位置
  useEffect(() => {
    if (!isOpen) return;

    // 打开时立即计算并更新一次坐标
    updatePosition();

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      // 触发器容器或 Portal 浮层内部点击不关闭
      if (
        containerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const handleScrollOrResize = () => {
      updatePosition();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen, updatePosition]);

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* 触发器 */}
      {children ? (
        <div
          onClick={toggleOpen}
          className="cursor-pointer"
        >
          {children}
        </div>
      ) : (
        <button
          type="button"
          onClick={toggleOpen}
          disabled={disabled}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          title={`选择颜色（当前: ${normHex}）`}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-paper border border-paper-grid/60 shadow-2xs hover:border-accent active:scale-[0.96] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span
            className="w-3.5 h-3.5 rounded-full border border-black/15 shrink-0 shadow-2xs"
            style={{ backgroundColor: normHex }}
          />
          <span className="text-[10px] font-mono text-ink">{normHex}</span>
        </button>
      )}

      {/* 弹出浮层：通过 Portal 挂载到 body，摆脱父级 overflow: hidden 与滚动容器裁切 */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            left: coords.left,
            top: coords.top !== undefined ? coords.top : undefined,
            bottom: coords.bottom !== undefined ? coords.bottom : undefined,
          }}
          className={`z-[9999] rounded-lg bg-paper/95 backdrop-blur-md border border-paper-grid/80 shadow-lg text-ink animate-in fade-in zoom-in-95 duration-100 ${
            coords.placement === 'top' ? 'origin-bottom' : 'origin-top'
          }`}
          role="dialog"
          aria-label="色彩选择器"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <ColorPicker
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        </div>,
        document.body
      )}
    </div>
  );
});

ColorPickerPopover.displayName = 'ColorPickerPopover';

