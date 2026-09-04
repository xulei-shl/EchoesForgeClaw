/**
 * 手账制作文本模块 - 画布独立文本素材组件
 */
import React from 'react';
import type { JournalMakerItem } from '../types';
import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_COLOR, formatFontFamily } from './fontRegistry';
import { textFontSize } from './drawText';

export type GestureMode = 'move' | 'resize' | 'rotate';

interface JournalTextItemProps {
  item: JournalMakerItem;
  selected: boolean;
  isGesturing: boolean;
  stageWidth: number;
  disabled?: boolean;
  onSelect: () => void;
  onOpenEdit: () => void;
  onGestureStart: (e: React.PointerEvent<HTMLElement>, item: JournalMakerItem, mode: GestureMode) => void;
  onGestureMove: (e: React.PointerEvent<HTMLElement>) => void;
  onGestureEnd: (e: React.PointerEvent<HTMLElement>) => void;
}

export const JournalTextItem: React.FC<JournalTextItemProps> = ({
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
  const fontSizePx = textFontSize(item.w, stageWidth || 400);

  return (
    <div
      data-journal-item
      className={`absolute group/jitem touch-none ${
        isGesturing ? 'will-change-transform select-none' : ''
      }`}
      style={{
        left: `${item.x}%`,
        top: `${item.y}%`,
        width: 'max-content',
        maxWidth: '90%',
        zIndex: selected ? 800 + item.z : item.z,
        transform: `translate(-50%, -50%) rotate(${item.angle}deg)`,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {/* 文本内容区域（支持横排/竖排、双击快速编辑、拖动） */}
      <div
        onPointerDown={(e) => onGestureStart(e, item, 'move')}
        onPointerMove={onGestureMove}
        onPointerUp={onGestureEnd}
        onPointerCancel={onGestureEnd}
        onDoubleClick={() => {
          if (!disabled) onOpenEdit();
        }}
        className={`cursor-move select-none transition-[outline,box-shadow] duration-150 ease-out rounded px-2 py-1 ${
          selected ? 'outline outline-2 outline-accent ring-2 ring-white/80' : ''
        }`}
        style={{
          fontFamily: formatFontFamily(currentFont),
          fontSize: `${fontSizePx}px`,
          color: currentColor,
          lineHeight: 1.35,
          textShadow: '0 1px 2px rgba(15,23,42,0.08)',
          ...(isVertical
            ? {
                writingMode: 'vertical-rl',
                // mixed：汉字直立、英文单词整体旋转 90° 不拆分（与 Canvas 导出算法一致）
                textOrientation: 'mixed',
                letterSpacing: '0.12em',
                whiteSpace: 'pre-wrap',
                textAlign: item.textAlign === 'left' ? 'start' : item.textAlign === 'right' ? 'end' : 'center',
              }
            : {
                writingMode: 'horizontal-tb',
                whiteSpace: 'pre-wrap',
                textAlign: item.textAlign || 'center',
              }),


        }}
      >
        {item.text || ''}
      </div>

      {/* 选中态：右下角缩放手柄与底部旋转手柄 */}
      {selected && !disabled && (
        <>
          {/* 右下角缩放手柄 */}
          <div
            onPointerDown={(e) => onGestureStart(e, item, 'resize')}
            onPointerMove={onGestureMove}
            onPointerUp={onGestureEnd}
            onPointerCancel={onGestureEnd}
            title="拖拽调整字号大小"
            className="absolute -right-2 -bottom-2 w-4 h-4 rounded-full bg-accent border-2 border-white shadow-md cursor-nwse-resize hover:scale-110 active:scale-[0.96] transition-transform duration-150 ease-out flex items-center justify-center z-20"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
          </div>

          {/* 底部居中旋转手柄与引线 */}
          <div className="absolute left-1/2 -bottom-6 -translate-x-1/2 flex flex-col items-center pointer-events-none z-20">
            {/* 连接引线 */}
            <div className="w-px h-2 bg-accent/70" />
            <div
              onPointerDown={(e) => onGestureStart(e, item, 'rotate')}
              onPointerMove={onGestureMove}
              onPointerUp={onGestureEnd}
              onPointerCancel={onGestureEnd}
              title="拖拽旋转角度"
              className="w-4 h-4 rounded-full bg-accent border-2 border-white shadow-md cursor-grab active:cursor-grabbing hover:scale-110 active:scale-[0.96] transition-transform duration-150 ease-out pointer-events-auto flex items-center justify-center"
            >
              <div className="w-1 h-1 rounded-full bg-white/90" />
            </div>
          </div>
        </>
      )}
    </div>
  );
};
