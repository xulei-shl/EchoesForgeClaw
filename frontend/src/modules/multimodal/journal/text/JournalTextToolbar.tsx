/**
 * 手账制作文本模块 - 文本悬浮微交互工具栏
 */
import React from 'react';
import {
  Edit3,
  Trash2,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  Pipette,
} from 'lucide-react';
import { Tooltip } from '../../../../platform/components/ui/Tooltip';
import { ColorPickerPopover } from '../../../../platform/components/ui/ColorPicker';
import type { JournalMakerItem } from '../types';
import {
  JOURNAL_FONTS,
  JOURNAL_TEXT_COLORS,
  DEFAULT_FONT_FAMILY,
  DEFAULT_TEXT_COLOR,
  loadFontFamily,
} from './fontRegistry';

interface JournalTextToolbarProps {
  item: JournalMakerItem;
  disabled?: boolean;
  onUpdate: (patch: Partial<JournalMakerItem>) => void;
  onOpenEdit: () => void;
  onDelete: () => void;
  onBumpLayer: (mode: 'up' | 'down' | 'top' | 'bottom') => void;
}

export const JournalTextToolbar: React.FC<JournalTextToolbarProps> = ({
  item,
  disabled = false,
  onUpdate,
  onOpenEdit,
  onDelete,
  onBumpLayer,
}) => {
  const currentFont = item.fontFamily || DEFAULT_FONT_FAMILY;
  const currentColor = item.color || DEFAULT_TEXT_COLOR;
  const isVertical = item.writingMode === 'vertical';

  const handleFontChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const family = e.target.value;
    loadFontFamily(family);
    onUpdate({ fontFamily: family });
  };

  const handleColorSelect = (color: string) => {
    onUpdate({ color });
  };

  const toggleWritingMode = () => {
    onUpdate({ writingMode: isVertical ? 'horizontal' : 'vertical' });
  };

  const isCustomColor = !JOURNAL_TEXT_COLORS.some(
    (preset) => preset.color.toLowerCase() === currentColor.toLowerCase()
  );

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="flex flex-col gap-1.5 p-1.5 rounded-xl bg-paper/95 backdrop-blur-md shadow-xl border border-paper-grid/60 text-ink text-xs select-none pointer-events-auto w-max"
    >
      {/* 第一行：主要快捷操作（编辑文案、字体切换、横竖排、图层控制与删除） */}
      <div className="flex items-center gap-1">
        {/* 编辑文字 */}
        <Tooltip content="编辑文字内容 (或双击文字)">
          <button
            type="button"
            disabled={disabled}
            onClick={onOpenEdit}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-ink-light hover:text-accent hover:bg-paper-grid/40 active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out font-medium whitespace-nowrap shrink-0"
          >
            <Edit3 size={13} strokeWidth={1.8} />
            <span className="leading-none">文案</span>
          </button>
        </Tooltip>

        <div className="w-px h-3.5 bg-paper-grid/60 my-auto shrink-0" />

        {/* 字体选择下拉 */}
        <div className="relative flex items-center shrink-0">
          <select
            value={currentFont}
            onChange={handleFontChange}
            disabled={disabled}
            aria-label="选择字体"
            className="h-6 pl-2 pr-5 rounded-md border border-paper-grid/60 bg-paper/90 text-xs text-ink font-sans outline-none hover:border-accent/60 focus:border-accent cursor-pointer transition whitespace-nowrap"
          >
            {JOURNAL_FONTS.map((font) => (
              <option key={font.id} value={font.family}>
                {font.name}
              </option>
            ))}
          </select>
        </div>

        <div className="w-px h-3.5 bg-paper-grid/60 my-auto shrink-0" />

        {/* 横排 / 竖排切换 */}
        <Tooltip content={isVertical ? '切换为横向排版' : '切换为纵向排版'}>
          <button
            type="button"
            disabled={disabled}
            onClick={toggleWritingMode}
            className={`flex items-center gap-0.5 px-2 py-1 rounded-md text-xs active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out whitespace-nowrap shrink-0 ${
              isVertical
                ? 'bg-accent/15 text-accent font-medium'
                : 'text-ink-light hover:text-accent hover:bg-paper-grid/40'
            }`}
          >
            <span className="font-mono text-[11px] leading-none">
              {isVertical ? '竖排' : '横排'}
            </span>
          </button>
        </Tooltip>

        <div className="w-px h-3.5 bg-paper-grid/60 my-auto shrink-0" />

        {/* 图层与删除 */}
        {(
          [
            ['up', ArrowUp, '上移一层'],
            ['down', ArrowDown, '下移一层'],
            ['top', ChevronsUp, '置顶'],
            ['bottom', ChevronsDown, '置底'],
          ] as const
        ).map(([mode, Icon, tip]) => (
          <Tooltip key={mode} content={tip}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onBumpLayer(mode)}
              className="p-1 rounded text-ink-light hover:text-accent hover:bg-paper-grid/40 active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out disabled:opacity-40"
            >
              <Icon size={12} strokeWidth={1.8} />
            </button>
          </Tooltip>
        ))}

        <div className="w-px h-3.5 bg-paper-grid/60 my-auto shrink-0" />

        <Tooltip content="删除该文字">
          <button
            type="button"
            disabled={disabled}
            onClick={onDelete}
            className="p-1 rounded text-ink-light hover:text-error hover:bg-error/10 active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out disabled:opacity-40"
          >
            <Trash2 size={12} strokeWidth={1.8} />
          </button>
        </Tooltip>
      </div>

      {/* 第二行：特色墨水色盘与自定义取色器 */}
      <div className="flex items-center gap-1.5 pt-0.5 px-0.5 border-t border-paper-grid/40">
        <span className="text-[10px] text-ink-faint mr-0.5 select-none shrink-0">墨色:</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {JOURNAL_TEXT_COLORS.map((preset) => {
            const isSelected = currentColor.toLowerCase() === preset.color.toLowerCase();
            return (
              <Tooltip key={preset.name} content={`${preset.name} (${preset.color})`}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => handleColorSelect(preset.color)}
                  className={`relative w-4 h-4 rounded-full transition-all duration-150 ease-out active:scale-[0.92] shrink-0 ${
                    preset.border ? 'border border-paper-grid/80' : ''
                  } ${
                    isSelected
                      ? 'ring-2 ring-accent ring-offset-1 scale-110 shadow-sm'
                      : 'hover:scale-110 opacity-90 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: preset.color }}
                  aria-label={preset.name}
                />
              </Tooltip>
            );
          })}

          <div className="w-px h-3 bg-paper-grid/50 my-auto mx-0.5 shrink-0" />

          {/* 自定义墨色与吸管取色器 */}
          <ColorPickerPopover
            value={currentColor}
            onChange={handleColorSelect}
            disabled={disabled}
            align="right"
          >
            <Tooltip
              content={
                isCustomColor
                  ? `自定义墨色 (当前: ${currentColor})`
                  : '自定义颜色 / 吸管取色'
              }
            >
              <button
                type="button"
                disabled={disabled}
                style={{ backgroundColor: isCustomColor ? currentColor : undefined }}
                className={`w-4 h-4 rounded-full border flex items-center justify-center transition active:scale-[0.92] shrink-0 ${
                  isCustomColor
                    ? 'border-accent ring-2 ring-accent ring-offset-1 scale-110 shadow-sm'
                    : 'border-paper-grid/70 hover:border-accent hover:scale-110 bg-paper/80 text-ink-light hover:text-accent'
                }`}
                aria-label="自定义颜色"
              >
                {!isCustomColor && <Pipette size={9} strokeWidth={2} />}
              </button>
            </Tooltip>
          </ColorPickerPopover>
        </div>
      </div>
    </div>
  );
};
