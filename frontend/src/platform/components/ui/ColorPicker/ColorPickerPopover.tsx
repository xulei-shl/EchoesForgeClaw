import React, { memo, useEffect, useRef, useState } from 'react';
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
  const normHex = normalizeHex(value || '#000000');

  // 点击外部自动关闭 + Escape 键监听
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* 触发器 */}
      {children ? (
        <div
          onClick={() => !disabled && setIsOpen((prev) => !prev)}
          className="cursor-pointer"
        >
          {children}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
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

      {/* 弹出浮层 */}
      {isOpen && (
        <div
          className={`absolute top-full mt-1.5 z-50 rounded-lg bg-paper/95 backdrop-blur-md border border-paper-grid/80 shadow-lg text-ink animate-in fade-in zoom-in-95 duration-100 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          role="dialog"
          aria-label="色彩选择器"
        >
          <ColorPicker
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
});

ColorPickerPopover.displayName = 'ColorPickerPopover';
