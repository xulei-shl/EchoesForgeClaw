import React, { useEffect, useState, useRef } from 'react';
import { Pipette, AlignLeft, AlignCenter, AlignRight, ChevronDown } from 'lucide-react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Tooltip } from '../../../../../../shared/components/ui/Tooltip';
import { ColorPickerPopover } from '../../../../../../shared/components/ui/ColorPicker';
import {
  JOURNAL_FONTS,
  JOURNAL_TEXT_COLORS,
  loadFontFamily,
  preloadAllJournalFonts,
} from './fontRegistry';

export type TextAlignment = 'left' | 'center' | 'right';

/** 挂载即批量预载全部字体预设（与手账共享字体基建） */
export function usePreloadJournalFonts(): void {
  useEffect(() => {
    preloadAllJournalFonts();
  }, []);
}

interface FontFamilySelectProps {
  value: string;
  onChange: (family: string) => void;
  disabled?: boolean;
  className?: string;
}

/** 紧凑精致字体选择下拉：统一 h-7 (28px) 高度与实线微边框，切换时自动触发字体加载 */
export const FontFamilySelect: React.FC<FontFamilySelectProps> = ({
  value,
  onChange,
  disabled = false,
  className = 'w-[118px] shrink-0',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    setMenuPos(
      rect
        ? { top: rect.bottom + 4, left: rect.left, width: Math.max(136, rect.width) }
        : { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 136 }
    );
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const selectedFont = React.useMemo(() => {
    if (!value) return JOURNAL_FONTS[0];
    const valLower = value.trim().toLowerCase();
    // 1. 精确匹配 family、name 或 id
    const exact = JOURNAL_FONTS.find(
      (f) => f.family.toLowerCase() === valLower || f.name.toLowerCase() === valLower || f.id.toLowerCase() === valLower
    );
    if (exact) return exact;
    // 2. 识别系统默认无衬线字体（含 MiSans、sans-serif、system-ui、PingFang、Helvetica 等）
    if (/misans|sans-serif|system-ui|helvetica|arial|pingfang/i.test(value)) {
      const sys = JOURNAL_FONTS.find((f) => f.id === 'system_default');
      if (sys) return sys;
    }
    // 3. 复合字体声明模糊包含匹配
    const partial = JOURNAL_FONTS.find(
      (f) => valLower.includes(f.name.toLowerCase()) || valLower.includes(f.family.toLowerCase())
    );
    if (partial) return partial;
    return null;
  }, [value]);

  const label = selectedFont ? selectedFont.name : (value || '系统默认');

  const isSelected = (font: (typeof JOURNAL_FONTS)[number]) => {
    if (selectedFont) {
      return selectedFont.id === font.id;
    }
    return value === font.family;
  };

  return (
    <div className={clsx('relative', className)} ref={triggerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="flex items-center justify-between w-full h-7 px-2 cursor-pointer rounded-md border border-paper-grid/80 bg-paper hover:border-accent text-xs font-medium text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
        aria-label="选择字体"
      >
        <span className="truncate text-left text-xs leading-none">{label}</span>
        <ChevronDown size={12} className="ml-1 text-ink-faint shrink-0" />
      </button>

      {isOpen && menuPos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: menuPos.width }}
          className="bg-paper/95 backdrop-blur-md border border-paper-grid/80 rounded-lg shadow-xl z-[99999] overflow-hidden max-h-56 overflow-y-auto p-1 animate-in fade-in zoom-in-95 duration-100 text-xs"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {JOURNAL_FONTS.map((font) => (
            <button
              key={font.id}
              type="button"
              onClick={() => {
                loadFontFamily(font.family);
                onChange(font.family);
                setIsOpen(false);
              }}
              className={clsx(
                'flex items-center w-full px-2 py-1.5 rounded text-left text-xs transition-colors cursor-pointer',
                isSelected(font) ? 'bg-accent/15 text-accent font-medium' : 'text-ink hover:bg-paper-grid/40'
              )}
            >
              <span className="truncate">{font.name}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};

interface TextColorPaletteProps {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
  /** 自定义颜色按钮的提示文案前缀 */
  customLabel?: string;
  size?: 'normal' | 'compact';
}

const PALETTE_SIZES = {
  normal: { dot: 'w-3.5 h-3.5', hit: 'w-5 h-5' },
  compact: { dot: 'w-3 h-3', hit: 'w-4.5 h-4.5' },
} as const;

/** 墨色色盘：预设圆点 + 分隔线 + 自定义取色（吸管），文本着色统一入口 */
export const TextColorPalette: React.FC<TextColorPaletteProps> = ({
  value,
  onChange,
  disabled = false,
  customLabel = '自定义墨色',
  size = 'compact',
}) => {
  const isCustom = !JOURNAL_TEXT_COLORS.some(
    (p) => p.color.toLowerCase() === value.toLowerCase()
  );
  const { dot, hit } = PALETTE_SIZES[size];

  return (
    <div className="flex items-center gap-0.5 flex-nowrap">
      {JOURNAL_TEXT_COLORS.map((preset) => {
        const selected = value.toLowerCase() === preset.color.toLowerCase();
        return (
          <Tooltip key={preset.name} content={`${preset.name} (${preset.color})`}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(preset.color)}
              className={`${hit} flex items-center justify-center rounded-full cursor-pointer disabled:cursor-not-allowed group focus-visible:outline-none shrink-0`}
              aria-label={preset.name}
            >
              <span
                className={`${dot} rounded-full transition-[transform,box-shadow,opacity] duration-150 ease-out group-hover:scale-115 active:scale-[0.92] shrink-0 ${
                  preset.border ? 'border border-paper-grid/90 shadow-2xs' : ''
                } ${
                  selected
                    ? 'ring-2 ring-accent ring-offset-1 scale-110 shadow-xs'
                    : 'opacity-90 hover:opacity-100'
                }`}
                style={{ backgroundColor: preset.color }}
              />
            </button>
          </Tooltip>
        );
      })}

      <div className="w-px h-3 bg-paper-grid/70 my-auto mx-0.5 shrink-0" />

      {/* 自定义颜色与吸管 */}
      <ColorPickerPopover value={value} onChange={onChange} disabled={disabled} align="right">
        <Tooltip content={isCustom ? `${customLabel} (当前: ${value})` : '自定义颜色 / 吸管取色'}>
          <button
            type="button"
            disabled={disabled}
            className={`${hit} flex items-center justify-center rounded-full cursor-pointer disabled:cursor-not-allowed group focus-visible:outline-none shrink-0`}
            aria-label="自定义颜色"
          >
            <span
              style={{ backgroundColor: isCustom ? value : undefined }}
              className={`${dot} rounded-full border flex items-center justify-center transition-[transform,border-color,box-shadow] duration-150 ease-out group-hover:scale-115 active:scale-[0.92] shrink-0 ${
                isCustom
                  ? 'border-accent ring-2 ring-accent ring-offset-1 scale-110 shadow-xs'
                  : 'border-paper-grid/90 bg-paper hover:border-accent text-ink-faint hover:text-accent shadow-2xs'
              }`}
            >
              {!isCustom && <Pipette size={7} strokeWidth={2.5} />}
            </span>
          </button>
        </Tooltip>
      </ColorPickerPopover>
    </div>
  );
};

interface TextAlignToggleProps {
  value?: TextAlignment;
  writingMode?: 'horizontal' | 'vertical';
  onChange: (align: TextAlignment) => void;
  disabled?: boolean;
}

/** 对齐方式切换组件：横排（左/中/右）与 竖排（顶/中/底）胶囊单选，高度严格统一 h-7 (28px) */
export const TextAlignToggle: React.FC<TextAlignToggleProps> = ({
  value = 'center',
  writingMode = 'horizontal',
  onChange,
  disabled = false,
}) => {
  const isVertical = writingMode === 'vertical';

  const options: { id: TextAlignment; label: string; icon: React.FC<{ size?: number; className?: string; strokeWidth?: number }> }[] = [
    { id: 'left', label: isVertical ? '顶端对齐' : '左对齐', icon: AlignLeft },
    { id: 'center', label: '居中对齐', icon: AlignCenter },
    { id: 'right', label: isVertical ? '底端对齐' : '右对齐', icon: AlignRight },
  ];

  return (
    <div className="flex items-center h-7 p-0.5 rounded-md bg-paper-grid/30 border border-paper-grid/50 select-none shrink-0">
      {options.map(({ id, label, icon: Icon }) => (
        <Tooltip key={id} content={label}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(id)}
            className={`w-6 h-6 flex items-center justify-center rounded text-xs transition duration-150 active:scale-95 disabled:opacity-40 cursor-pointer ${
              value === id
                ? 'bg-paper shadow-2xs text-accent font-medium'
                : 'text-ink-light hover:text-ink hover:bg-paper-grid/40'
            }`}
            aria-label={label}
          >
            <Icon
              size={12}
              strokeWidth={1.8}
              className={isVertical ? 'rotate-90' : ''}
            />
          </button>
        </Tooltip>
      ))}
    </div>
  );
};

export type WritingMode = 'horizontal' | 'vertical';

export interface WritingModeToggleProps {
  value?: WritingMode;
  onChange: (mode: WritingMode) => void;
  disabled?: boolean;
  className?: string;
}

/** 横竖排胶囊切换组件：横排（自然排版）与 竖排（传统直排），高度统一 h-7 (28px) */
export const WritingModeToggle: React.FC<WritingModeToggleProps> = ({
  value = 'horizontal',
  onChange,
  disabled = false,
  className,
}) => {
  const isVertical = value === 'vertical';

  const options: { id: WritingMode; label: string; tooltip: string }[] = [
    { id: 'horizontal', label: '横排', tooltip: '横向自然排版' },
    { id: 'vertical', label: '竖排', tooltip: '纵向传统排版（列自右向左）' },
  ];

  return (
    <div
      className={clsx(
        'inline-flex items-center h-7 p-0.5 rounded-md bg-paper-grid/30 border border-paper-grid/50 select-none shrink-0',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      {options.map((opt) => {
        const active = (opt.id === 'vertical' && isVertical) || (opt.id === 'horizontal' && !isVertical);
        return (
          <Tooltip key={opt.id} content={opt.tooltip}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.id)}
              className={clsx(
                'h-6 px-1.5 rounded text-[11px] font-sans transition-[transform,background-color,color,box-shadow] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed leading-none cursor-pointer',
                active
                  ? 'bg-paper text-accent font-medium shadow-2xs border border-paper-grid/40'
                  : 'text-ink-light hover:text-ink'
              )}
              aria-label={opt.label}
            >
              {opt.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
};



