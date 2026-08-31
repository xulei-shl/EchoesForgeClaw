/**
 * 邮票截图框文字模块 - 邮票内独立文字排版组件
 */
import React from 'react';
import type { StampTextItem as IStampTextItem } from './types';
import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_COLOR } from '../journal/text/fontRegistry';
import { textFontSize } from '../journal/text/drawText';

export type StampGestureMode = 'move' | 'resize' | 'rotate';

interface StampTextItemProps {
  item: IStampTextItem;
  selected: boolean;
  isGesturing: boolean;
  stageWidth: number;
  disabled?: boolean;
  onSelect: () => void;
  onOpenEdit: () => void;
  onGestureStart: (
    e: React.PointerEvent<HTMLElement>,
    item: IStampTextItem,
    mode: StampGestureMode
  ) => void;
  onGestureMove: (e: React.PointerEvent<HTMLElement>) => void;
  onGestureEnd: (e: React.PointerEvent<HTMLElement>) => void;
}

export const StampTextItemView: React.FC<StampTextItemProps> = ({
  item,
  selected,
  isGesturing,
  stageWidth,
  disabled = false,
  onSelect,
  onOpenEdit,
  onGestureStart,
  onGestureMove,
  onGestureEnd,
}) => {

  const currentFont = item.fontFamily || DEFAULT_FONT_FAMILY;
  const currentColor = item.color || DEFAULT_TEXT_COLOR;
  const isVertical = item.writingMode === 'vertical';
  const fontSizePx = Math.max(8, textFontSize(item.w, stageWidth || 300));

  return (
    <div
      data-stamp-text-item
      className={`absolute group/stitem touch-none ${
        isGesturing ? 'will-change-transform select-none' : ''
      }`}
      style={{
        left: `${item.x}%`,
        top: `${item.y}%`,
        width: 'max-content',
        maxWidth: '95%',
        zIndex: selected ? 40 + item.z : 15 + item.z,
        transform: `translate(-50%, -50%) rotate(${item.angle}deg)`,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {/* 文本内容显示区域（支持横排/竖排、双击快速编辑文案、拖拽移动） */}
      <div
        onPointerDown={(e) => onGestureStart(e, item, 'move')}
        onPointerMove={onGestureMove}
        onPointerUp={onGestureEnd}
        onPointerCancel={onGestureEnd}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (!disabled) onOpenEdit();
        }}
        className={`cursor-move select-none transition-[outline,box-shadow] duration-150 ease-out rounded px-1.5 py-0.5 ${
          selected ? 'outline outline-2 outline-accent ring-1 ring-white/90 shadow-sm' : ''
        }`}
        style={{
          fontFamily: `"${currentFont}", "Noto Serif SC", serif, sans-serif`,
          fontSize: `${fontSizePx}px`,
          color: currentColor,
          lineHeight: 1.25,
          textShadow: '0 1px 2px rgba(0,0,0,0.15)',
          ...(isVertical
            ? {
                writingMode: 'vertical-rl',
                textOrientation: 'mixed',
                letterSpacing: '0.12em',
                whiteSpace: 'pre-wrap',
              }
            : {
                writingMode: 'horizontal-tb',
                whiteSpace: 'pre-wrap',
                textAlign: 'center',
              }),
        }}
      >
        {item.text || ''}
      </div>

      {/* 选中态交互手柄：右下角缩放手柄与底部旋转手柄 */}
      {selected && !disabled && (
        <>
          {/* 右下角缩放手柄 */}
          <div
            onPointerDown={(e) => onGestureStart(e, item, 'resize')}
            onPointerMove={onGestureMove}
            onPointerUp={onGestureEnd}
            onPointerCancel={onGestureEnd}
            title="拖拽调整字号"
            className="absolute -right-2 -bottom-2 w-3.5 h-3.5 rounded-full bg-accent border-2 border-white shadow-md cursor-nwse-resize hover:scale-125 active:scale-95 transition-transform duration-150 ease-out flex items-center justify-center z-30"
          >
            <span className="w-1 h-1 rounded-full bg-white/90" />
          </div>

          {/* 底部居中旋转手柄与引线 */}
          <div className="absolute left-1/2 -bottom-5 -translate-x-1/2 flex flex-col items-center pointer-events-none z-30">
            <div className="w-px h-1.5 bg-accent/80" />
            <div
              onPointerDown={(e) => onGestureStart(e, item, 'rotate')}
              onPointerMove={onGestureMove}
              onPointerUp={onGestureEnd}
              onPointerCancel={onGestureEnd}
              title="拖拽旋转角度"
              className="w-3.5 h-3.5 rounded-full bg-accent border-2 border-white shadow-md cursor-grab active:cursor-grabbing hover:scale-125 active:scale-95 transition-transform duration-150 ease-out pointer-events-auto flex items-center justify-center"
            >
              <div className="w-1 h-1 rounded-full bg-white/90" />
            </div>
          </div>
        </>
      )}
    </div>
  );
};
