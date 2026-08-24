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
} from 'lucide-react';
import { Tooltip } from '../../../../platform/components/ui/Tooltip';
import type { JournalMakerItem } from '../types';
import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_COLOR } from './fontRegistry';
import { FontFamilySelect, TextColorPalette } from './FontControls';

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

  const handleColorSelect = (color: string) => {
    onUpdate({ color });
  };

  const toggleWritingMode = () => {
    onUpdate({ writingMode: isVertical ? 'horizontal' : 'vertical' });
  };

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
        <FontFamilySelect
          value={currentFont}
          onChange={(family) => onUpdate({ fontFamily: family })}
          disabled={disabled}
        />

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
        <TextColorPalette
          value={currentColor}
          onChange={handleColorSelect}
          disabled={disabled}
          size="normal"
        />
      </div>
    </div>
  );
};
