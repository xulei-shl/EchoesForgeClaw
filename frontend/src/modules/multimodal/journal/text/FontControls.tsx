/**
 * 手账文本模块共用控件：字体预载 / 字体下拉 / 墨色色盘
 * 供手账制作（JournalTextToolbar）与文本成图（TextImageNode）共享同一套实现。
 */
import React, { useEffect } from 'react';
import { Pipette } from 'lucide-react';
import { Tooltip } from '../../../../platform/components/ui/Tooltip';
import { Select, type SelectOption } from '../../../../platform/components/ui/Select';
import { ColorPickerPopover } from '../../../../platform/components/ui/ColorPicker';
import {
  JOURNAL_FONTS,
  JOURNAL_TEXT_COLORS,
  loadFontFamily,
  preloadAllJournalFonts,
} from './fontRegistry';

/** 挂载即批量预载全部字体预设（与手账共享字体基建） */
export function usePreloadJournalFonts(): void {
  useEffect(() => {
    preloadAllJournalFonts();
  }, []);
}

const FONT_OPTIONS: SelectOption[] = JOURNAL_FONTS.map((font) => ({
  label: font.name,
  value: font.family,
}));

interface FontFamilySelectProps {
  value: string;
  onChange: (family: string) => void;
  disabled?: boolean;
}

/** 字体选择下拉：复用平台公共 Select，切换时自动触发字体加载再回调选中的 family */
export const FontFamilySelect: React.FC<FontFamilySelectProps> = ({
  value,
  onChange,
  disabled = false,
}) => (
  <Select
    size="sm"
    value={value}
    options={FONT_OPTIONS}
    disabled={disabled}
    className="w-[130px] shrink-0"
    onChange={(family) => {
      loadFontFamily(family);
      onChange(family);
    }}
  />
);

interface TextColorPaletteProps {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
  /** 自定义颜色按钮的提示文案前缀 */
  customLabel?: string;
  size?: 'normal' | 'compact';
}

const PALETTE_SIZES = {
  normal: { dot: 'w-3.5 h-3.5', hit: 'w-5.5 h-5.5' },
  compact: { dot: 'w-3 h-3', hit: 'w-5 h-5' },
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
    <div className="flex items-center gap-0.5 flex-wrap">
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
