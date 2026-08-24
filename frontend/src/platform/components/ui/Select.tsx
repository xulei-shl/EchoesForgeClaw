import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { Tooltip } from './Tooltip';

export interface SelectOption {
  label: string;
  value: string;
  title?: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  size?: 'sm' | 'md';
}

export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  disabled = false,
  className,
  placeholder = '请选择',
  size = 'md',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 打开时按触发器实测位置锚定（fixed 定位不受祖先 overflow 裁剪影响）
  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    setMenuPos(
      rect
        ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
        : { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 160 }
    );
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // 触发器与 Portal 浮层均视为内部点击
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div className={clsx("relative", className)} ref={triggerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={clsx(
          "flex items-center justify-between w-full cursor-pointer rounded-md border border-dashed border-paper-grid bg-transparent focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
          size === 'sm' ? "h-8 px-2.5 text-xs" : "h-10 px-3 text-sm",
        )}
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown size={14} className="ml-2 text-ink-faint shrink-0" />
      </button>
      {isOpen && menuPos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: menuPos.width }}
          className="bg-paper border border-dashed border-paper-grid rounded-md shadow-md z-[9999] overflow-hidden max-h-60 overflow-y-auto animate-in fade-in zoom-in-95 duration-100"
        >
          {options.length > 0 ? (
            options.map((opt) => {
              const btn = (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  className={clsx(
                    "flex w-full text-left hover:bg-paper-grid/50 transition-colors",
                    size === 'sm' ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm",
                    value === opt.value ? 'text-accent font-medium' : 'text-ink'
                  )}
                >
                  {opt.label}
                </button>
              );
              return opt.title ? (
                <Tooltip key={opt.value} content={opt.title}>
                  {btn}
                </Tooltip>
              ) : (
                btn
              );
            })
          ) : (
            <div className="px-3 py-2 text-sm text-ink-faint text-center">暂无数据</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

export default Select;
