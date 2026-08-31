/**
 * 通用文本悬浮微交互工具栏 (UniversalTextToolbar)
 * 供全站多模态卡片节点（邮票制作、手账制作、文本成图等）共享复用
 */
import React from 'react';
import {
  Edit3,
  Trash2,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import { Tooltip } from '../../../../platform/components/ui/Tooltip';
import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_COLOR } from './fontRegistry';
import {
  FontFamilySelect,
  TextColorPalette,
  TextAlignToggle,
  type TextAlignment,
} from './FontControls';

export interface UniversalTextItem {
  id: string;
  text?: string;
  fontFamily?: string;
  color?: string;
  writingMode?: 'horizontal' | 'vertical';
  textAlign?: TextAlignment;
  [key: string]: any;
}

export interface UniversalTextToolbarProps {
  item: UniversalTextItem;
  disabled?: boolean;
  onUpdate: (patch: Partial<UniversalTextItem>) => void;
  onOpenEdit: () => void;
  onDelete?: () => void;
  onBumpLayer?: (mode: 'up' | 'down' | 'top' | 'bottom') => void;
  onRotateStep?: (mode: 'cw' | 'ccw') => void;
  /** 可选自定义右侧操作 */
  extraActions?: React.ReactNode;
  /** 可选自定义第二行插槽 */
  extraRow?: React.ReactNode;
}

export const UniversalTextToolbar: React.FC<UniversalTextToolbarProps> = ({
  item,
  disabled = false,
  onUpdate,
  onOpenEdit,
  onDelete,
  onBumpLayer,
  onRotateStep,
  extraActions,
  extraRow,
}) => {
  const currentFont = item.fontFamily || DEFAULT_FONT_FAMILY;
  const currentColor = item.color || DEFAULT_TEXT_COLOR;
  const isVertical = item.writingMode === 'vertical';
  const currentAlign: TextAlignment = item.textAlign || 'center';

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="flex flex-col gap-1 p-1.5 rounded-xl bg-paper/95 backdrop-blur-md shadow-xl border border-paper-grid/60 text-ink text-xs select-none pointer-events-auto w-max max-w-[94vw] z-40 animate-in fade-in zoom-in-95 duration-150"
    >
      {/* 第一行：主要文本属性与排版控制 */}
      <div className="flex items-center gap-1 flex-wrap">
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
            onClick={() => onUpdate({ writingMode: isVertical ? 'horizontal' : 'vertical' })}
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

        {/* 对齐方式切换（左对齐 / 居中 / 右对齐） */}
        <TextAlignToggle
          value={currentAlign}
          onChange={(align) => onUpdate({ textAlign: align })}
          disabled={disabled}
        />

        <div className="w-px h-3.5 bg-paper-grid/60 my-auto shrink-0" />

        {/* 图层控制 */}
        {onBumpLayer &&
          (
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

        {onRotateStep && (
          <>
            <div className="w-px h-3.5 bg-paper-grid/60 my-auto shrink-0" />
            {/* 旋转 90 度（摆正） */}
            <Tooltip content="逆时针旋转 90°">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRotateStep('ccw')}
                className="p-1 rounded text-ink-light hover:text-accent hover:bg-paper-grid/40 active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out disabled:opacity-40"
              >
                <RotateCcw size={12} strokeWidth={1.8} />
              </button>
            </Tooltip>
            <Tooltip content="顺时针旋转 90°">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRotateStep('cw')}
                className="p-1 rounded text-ink-light hover:text-accent hover:bg-paper-grid/40 active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out disabled:opacity-40"
              >
                <RotateCw size={12} strokeWidth={1.8} />
              </button>
            </Tooltip>
          </>
        )}

        {extraActions}

        {onDelete && (
          <>
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
          </>
        )}
      </div>

      {/* 第二行：特色墨水色盘与自定义取色器 */}
      <div className="flex items-center justify-between gap-1.5 pt-0.5 px-0.5 border-t border-paper-grid/40">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-ink-faint mr-0.5 select-none shrink-0">墨色:</span>
          <TextColorPalette
            value={currentColor}
            onChange={(color) => onUpdate({ color })}
            disabled={disabled}
            size="normal"
          />
        </div>
        {extraRow}
      </div>
    </div>
  );
};
