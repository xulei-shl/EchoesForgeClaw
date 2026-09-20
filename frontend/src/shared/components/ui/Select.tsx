import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';
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
  searchable?: boolean;
  searchPlaceholder?: string;
}

export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  disabled = false,
  className,
  placeholder = '请选择',
  size = 'md',
  searchable,
  searchPlaceholder = '搜索…',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 打开时按触发器实测位置锚定（fixed 定位不受祖先 overflow 裁剪影响）
  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    setMenuPos(
      rect
        ? { top: rect.bottom + 4, left: rect.left, width: rect.width }
        : { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 144 }
    );
    setSearchQuery('');
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

  // 默认彻底常驻开启搜索过滤（除非显式传入 searchable={false}）
  const isSearchEnabled = searchable !== false;

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const q = searchQuery.toLowerCase().trim();
    return options.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [options, searchQuery]);

  // 键盘快捷处理：唯一候选词按 Enter 直接选中，Escape 关闭
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      if (filteredOptions.length === 1) {
        e.preventDefault();
        onChange(filteredOptions[0].value);
        setIsOpen(false);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

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
      {/* 菜单是 document.body 下的 portal，若不拦截，点击选项时 pointerdown 会冒泡到 document，
          触发宿主弹层（如运行设置）的「点击外部关闭」，在 click 到达选项前就把弹层连同菜单卸载，
          导致选项无法选中；此处 stopPropagation 使菜单内交互不再外泄。 */}
      {isOpen && menuPos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: menuPos.width }}
          className="bg-paper border border-dashed border-paper-grid rounded-md shadow-md z-[10005] overflow-hidden max-h-60 origin-top animate-in fade-in zoom-in-95 duration-100 ease-out flex flex-col"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {isSearchEnabled && (
            <div className="p-1 border-b border-dashed border-paper-grid sticky top-0 bg-paper z-10 shrink-0">
              <div className="relative flex items-center">
                <Search size={11} className="absolute left-2 text-ink-faint pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  autoFocus
                  className="w-full h-6.5 pl-5.5 pr-2 text-[11px] bg-paper-grid/20 border border-paper-grid rounded focus:outline-none focus:border-accent text-ink placeholder:text-ink-faint font-sans"
                  onKeyDown={handleSearchKeyDown}
                />
              </div>
            </div>
          )}

          <div className="overflow-y-auto flex-1 max-h-52">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => {
                const isSoleCandidate = filteredOptions.length === 1;
                const btn = (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setIsOpen(false);
                    }}
                    className={clsx(
                      "flex items-center justify-between w-full text-left transition-colors truncate",
                      size === 'sm' ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm",
                      value === opt.value
                        ? 'text-accent font-medium bg-accent/5'
                        : isSoleCandidate
                        ? 'bg-paper-grid/40 text-ink font-medium'
                        : 'text-ink hover:bg-paper-grid/50'
                    )}
                  >
                    <span className="truncate">{opt.label}</span>
                    {isSoleCandidate && (
                      <span className="ml-1 text-[10px] text-ink-faint border border-paper-grid/60 rounded px-1 py-0.5 leading-none shrink-0">
                        ↵
                      </span>
                    )}
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
              <div className="px-3 py-2.5 text-xs text-ink-faint text-center font-sans">未找到匹配项</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default Select;
