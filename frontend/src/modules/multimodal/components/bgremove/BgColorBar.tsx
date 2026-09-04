import React from 'react';
import { Pipette } from 'lucide-react';
import { Tooltip } from '../../../../platform/components/ui/Tooltip';
import { ColorPickerPopover } from '../../../../platform/components/ui/ColorPicker';

export interface BgColorBarProps {
  currentColor: string;
  onChangeColor: (color: string) => void;
  disabled?: boolean;
  hasResult?: boolean;
}

const PRESET_COLORS = [
  { value: '', label: '透明背景（PNG）', isTransparent: true },
  { value: '#ffffff', label: '纯白背景' },
  { value: '#000000', label: '纯黑背景' },
  { value: '#f5f5f0', label: '米灰纸感' },
  { value: '#e0f2fe', label: '淡雅天蓝' },
  { value: '#ffe4e6', label: '柔粉蜜桃' },
];

export const BgColorBar: React.FC<BgColorBarProps> = ({
  currentColor,
  onChangeColor,
  disabled = false,
  hasResult = true,
}) => {
  const isPreset = PRESET_COLORS.some((p) => p.value.toLowerCase() === currentColor.toLowerCase());

  return (
    <div className="flex items-center justify-between gap-2 p-2 bg-paper/60 rounded-xl border border-paper-grid/60 text-xs">
      <div className="flex items-center gap-1 shrink-0 select-none">
        <span className="text-ink-light font-serif">背景底色:</span>
        {!hasResult && (
          <span className="text-[10px] text-accent font-sans">
            (选色自动抠图)
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {PRESET_COLORS.map((preset) => {
          const isSelected = currentColor.toLowerCase() === preset.value.toLowerCase();
          return (
            <Tooltip key={preset.value} content={preset.label}>
              <button
                type="button"
                disabled={disabled}
                aria-label={preset.label}
                onClick={() => onChangeColor(preset.value)}
                className={`relative before:absolute before:-inset-2 before:content-[''] w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-[transform,border-color,box-shadow] duration-100 ease-out active:scale-[0.96] ${
                  isSelected
                    ? 'border-accent ring-2 ring-accent/40 scale-110 shadow-2xs z-10'
                    : 'border-paper-grid hover:border-accent/80 hover:scale-105'
                } ${preset.isTransparent ? 'sticker-checker-bg' : ''} ${
                  disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                }`}
                style={!preset.isTransparent ? { backgroundColor: preset.value } : undefined}
              />
            </Tooltip>
          );
        })}

        {/* 自定义颜色取色器 */}
        <ColorPickerPopover
          value={currentColor || '#ffffff'}
          onChange={(hex) => onChangeColor(hex)}
          align="right"
        >
          <Tooltip content={!isPreset && currentColor ? `自定义颜色 (${currentColor})` : '自定义背景取色'}>
            <button
              type="button"
              disabled={disabled}
              aria-label={!isPreset && currentColor ? `自定义颜色 (${currentColor})` : '自定义背景取色'}
              className={`relative before:absolute before:-inset-2 before:content-[''] w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-[transform,border-color,box-shadow,color] duration-100 ease-out active:scale-[0.96] ${
                !isPreset && currentColor
                  ? 'border-accent ring-2 ring-accent/40 scale-110 shadow-2xs'
                  : 'border-paper-grid/70 hover:border-accent hover:scale-105 bg-paper/80 text-ink-light hover:text-accent'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              style={!isPreset && currentColor ? { backgroundColor: currentColor } : undefined}
            >
              {(isPreset || !currentColor) && <Pipette size={11} strokeWidth={2} />}
            </button>
          </Tooltip>
        </ColorPickerPopover>
      </div>
    </div>
  );
};
