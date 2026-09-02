/**
 * 通用文本微交互工具栏 (UniversalTextToolbar)
 * 支持悬浮模式 (variant="floating", 默认) 与 置顶嵌入模式 (variant="docked")
 * 严格基于 28px (h-7) 统一度量衡与 flex-nowrap 水平垂直像素级对齐
 */
import React from 'react';
import { motion } from 'framer-motion';
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
  variant?: 'floating' | 'docked';
  disabled?: boolean;
  onUpdate: (patch: Partial<UniversalTextItem>) => void;
  onOpenEdit: () => void;
  onDelete?: () => void;
  onBumpLayer?: (mode: 'up' | 'down' | 'top' | 'bottom') => void;
  onRotateStep?: (mode: 'cw' | 'ccw') => void;
  onClose?: () => void;
  /** 可选自定义第一行右侧额外操作 */
  extraActions?: React.ReactNode;
  /** 可选自定义第二行右侧插槽 */
  extraRow?: React.ReactNode;
}

export const UniversalTextToolbar: React.FC<UniversalTextToolbarProps> = ({
  item,
  variant = 'floating',
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

  const isDocked = variant === 'docked';

  const content = (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={`flex flex-col gap-2 text-xs select-none ${
        isDocked
          ? 'w-full px-2.5 py-2 rounded-xl bg-paper-grid/25 border border-paper-grid/70 shadow-2xs shrink-0'
          : 'p-2.5 rounded-xl bg-paper/95 backdrop-blur-md shadow-[0_12px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.06)] border border-paper-grid/80 text-ink pointer-events-auto w-max z-40'
      }`}
    >
      {/* 第一行：文本与排版属性（文案、字体、横竖排、对齐方式、自定义操作） */}
      <div className="flex items-center justify-between gap-2 w-full flex-nowrap">
        {/* 功能群：文案 + 字体 + 排版 + 对齐 */}
        <div className="flex items-center gap-1.5 flex-nowrap shrink-0">
          {/* 编辑文案按钮 */}
          <Tooltip content="编辑文字内容 (或双击文字)">
            <button
              type="button"
              disabled={disabled}
              onClick={onOpenEdit}
              className="h-7 px-2.5 rounded-md bg-paper border border-paper-grid/80 hover:border-accent hover:text-accent text-ink text-xs font-medium flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer shrink-0"
              aria-label="编辑文案"
            >
              <Edit3 size={12} strokeWidth={2} />
              <span className="leading-none text-xs">文案</span>
            </button>
          </Tooltip>

          {/* 紧凑字体选择下拉 */}
          <FontFamilySelect
            value={currentFont}
            onChange={(family) => onUpdate({ fontFamily: family })}
            disabled={disabled}
            className="w-[104px] shrink-0"
          />

          {/* 横排 / 竖排胶囊切换 */}
          <div className="inline-flex items-center h-7 p-0.5 rounded-md bg-paper-grid/30 border border-paper-grid/50 select-none shrink-0">
            <Tooltip content="横向自然排版">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onUpdate({ writingMode: 'horizontal' })}
                className={`h-6 px-1.5 rounded text-[11px] font-sans transition-[transform,background-color,color,box-shadow] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed leading-none cursor-pointer ${
                  !isVertical
                    ? 'bg-paper text-accent font-medium shadow-2xs border border-paper-grid/40'
                    : 'text-ink-light hover:text-ink'
                }`}
                aria-label="横排"
              >
                横排
              </button>
            </Tooltip>
            <Tooltip content="纵向传统排版">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onUpdate({ writingMode: 'vertical' })}
                className={`h-6 px-1.5 rounded text-[11px] font-sans transition-[transform,background-color,color,box-shadow] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed leading-none cursor-pointer ${
                  isVertical
                    ? 'bg-paper text-accent font-medium shadow-2xs border border-paper-grid/40'
                    : 'text-ink-light hover:text-ink'
                }`}
                aria-label="竖排"
              >
                竖排
              </button>
            </Tooltip>
          </div>

          {/* 对齐方式切换（横排：左/中/右；竖排：顶/中/底） */}
          <TextAlignToggle
            value={currentAlign}
            writingMode={item.writingMode}
            onChange={(align) => onUpdate({ textAlign: align })}
            disabled={disabled}
          />
        </div>

        {/* 右侧：自定义扩展与删除按钮 */}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {extraActions}

          {/* 删除按钮（放置在右上角，带明显的警示悬停反馈） */}
          {onDelete && (
            <Tooltip content="删除该文字 (Delete)">
              <button
                type="button"
                disabled={disabled}
                onClick={onDelete}
                className="w-7 h-7 rounded-md text-ink-faint hover:text-error hover:bg-error/15 active:scale-[0.94] transition-[background-color,color,transform] duration-150 ease-out disabled:opacity-40 flex items-center justify-center shrink-0 cursor-pointer border border-transparent hover:border-error/20"
                aria-label="删除该文字"
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* 第二行：色彩与图层几何（墨色色盘、图层层级、旋转 90°） */}
      <div className="flex items-center gap-2 pt-1.5 border-t border-paper-grid/50 flex-nowrap w-full">
        {/* 左侧：墨水色盘 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] text-ink-faint select-none shrink-0 font-medium leading-none">墨色:</span>
          <TextColorPalette
            value={currentColor}
            onChange={(color) => onUpdate({ color })}
            disabled={disabled}
            size="compact"
          />
        </div>

        {/* 分组微细分割线 */}
        {(onBumpLayer || onRotateStep || extraRow) && (
          <div className="w-px h-3.5 bg-paper-grid/70 my-auto shrink-0" />
        )}

        {/* 紧邻右侧：图层控制与旋转 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* 图层控制图标组 */}
          {onBumpLayer && (
            <div className="flex items-center h-7 p-0.5 rounded-md bg-paper-grid/25 border border-paper-grid/40 shrink-0">
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
                    className="w-5.5 h-6 rounded flex items-center justify-center text-ink-light hover:text-accent hover:bg-paper active:scale-[0.94] transition-[background-color,color,transform] duration-150 ease-out disabled:opacity-40 cursor-pointer"
                    aria-label={tip}
                  >
                    <Icon size={12} strokeWidth={2} />
                  </button>
                </Tooltip>
              ))}
            </div>
          )}

          {/* 旋转 90 度组 */}
          {onRotateStep && (
            <div className="flex items-center h-7 p-0.5 rounded-md bg-paper-grid/25 border border-paper-grid/40 shrink-0">
              <Tooltip content="逆时针旋转 90°">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRotateStep('ccw')}
                  className="w-5.5 h-6 rounded flex items-center justify-center text-ink-light hover:text-accent hover:bg-paper active:scale-[0.94] transition-[background-color,color,transform] duration-150 ease-out disabled:opacity-40 cursor-pointer"
                  aria-label="逆时针旋转 90°"
                >
                  <RotateCcw size={12} strokeWidth={2} />
                </button>
              </Tooltip>
              <Tooltip content="顺时针旋转 90°">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRotateStep('cw')}
                  className="w-5.5 h-6 rounded flex items-center justify-center text-ink-light hover:text-accent hover:bg-paper active:scale-[0.94] transition-[background-color,color,transform] duration-150 ease-out disabled:opacity-40 cursor-pointer"
                  aria-label="顺时针旋转 90°"
                >
                  <RotateCw size={12} strokeWidth={2} />
                </button>
              </Tooltip>
            </div>
          )}

          {extraRow}
        </div>
      </div>
    </div>
  );

  if (isDocked) {
    return content;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      className="w-fit flex justify-center pointer-events-none"
    >
      {content}
    </motion.div>
  );
};
