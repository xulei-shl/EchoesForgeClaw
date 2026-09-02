import React from 'react';
import type {
  EditorialArticleData,
  EditorialFreeTextItem,
  PageRatioPreset,
  FreeTextBlockWrapResult,
} from '../types';
import type { GestureLayer, GestureMode } from '../hooks/useEditorialGestures';

export interface EditorialFreeTextLayerProps {
  freeTexts: EditorialFreeTextItem[];
  selectedTextId: string | null;
  article: EditorialArticleData;
  ratioPreset: PageRatioPreset;
  scale: number;
  freeTextWraps: Map<string, FreeTextBlockWrapResult | null>;
  onSelectText: (id: string) => void;
  onOpenEdit: (item: EditorialFreeTextItem) => void;
  beginGesture: (
    e: React.PointerEvent,
    layer: GestureLayer,
    idItem: string,
    mode: GestureMode
  ) => void;
  moveGesture: (e: React.PointerEvent) => void;
  endGesture: (e: React.PointerEvent) => void;
}

/** 自由排版文本块图层组件（负责高清画布内的文本块渲染与手柄） */
export const EditorialFreeTextLayer: React.FC<EditorialFreeTextLayerProps> = ({
  freeTexts,
  selectedTextId,
  article,
  ratioPreset,
  scale,
  freeTextWraps,
  onSelectText,
  onOpenEdit,
  beginGesture,
  moveGesture,
  endGesture,
}) => {
  const freeTextContent = (ft: EditorialFreeTextItem): string =>
    ft.bind ? String(article[ft.bind] ?? '') : ft.text;

  return (
    <>
      {freeTexts.map((ft) => {
        const isSel = selectedTextId === ft.id;
        const txtContent = freeTextContent(ft);
        const ftPxX = (ft.x / 100) * ratioPreset.width;
        const ftPxY = (ft.y / 100) * ratioPreset.height;
        const ftPxW = (ft.width / 100) * ratioPreset.width;
        const isBold = ft.fontStyle === 'bold' || ft.fontStyle === 'bold-italic';
        const isItalic = ft.fontStyle === 'italic' || ft.fontStyle === 'bold-italic';
        const isEmptyBlock = !txtContent.trim();
        const wrap = freeTextWraps.get(ft.id) ?? null;
        const wrapLines = wrap && wrap.lines.length > 0 ? wrap.lines : null;

        return (
          <div
            key={ft.id}
            className={`absolute touch-none ${isSel ? 'z-30' : 'z-10'}`}
            style={{ left: `${ftPxX}px`, top: `${ftPxY}px`, width: `${ftPxW}px` }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectText(ft.id);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onOpenEdit(ft);
            }}
            onPointerMove={moveGesture}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
          >
            {/* 旋转内容包装（旋转原点左上角，与画布导出 1:1） */}
            <div
              className={`relative rounded-sm ${
                isSel && !isEmptyBlock
                  ? 'ring-2 ring-accent ring-offset-2 ring-offset-white shadow-lg'
                  : ''
              }`}
              style={{
                transform: `rotate(${ft.rotation || 0}deg)`,
                transformOrigin: 'left top',
              }}
              onPointerDown={(e) => beginGesture(e, 'text', ft.id, 'move')}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onOpenEdit(ft);
              }}
            >
              {isEmptyBlock ? (
                <div
                  className={`w-full rounded border border-dashed border-paper-grid/70 flex items-center justify-center text-ink-faint/50 text-[11px] ${
                    isSel ? 'border-accent text-accent' : ''
                  }`}
                  style={{ minHeight: `${Math.max(18, ft.fontSize * 1.4)}px` }}
                >
                  空文本块
                </div>
              ) : wrapLines && wrap ? (
                /* 绕排渲染：逐行绝对定位（与 Canvas 导出 1:1 对齐） */
                <div
                  className="relative w-full"
                  style={{ height: `${Math.max(1, wrap.contentHeight - ftPxY)}px` }}
                >
                  {wrapLines.map((line, li) => (
                    <div
                      key={li}
                      className="absolute whitespace-nowrap"
                      style={{
                        left: `${line.x - ftPxX}px`,
                        top: `${line.y - ftPxY}px`,
                        color: ft.color || '#1a1a1a',
                        fontFamily: ft.fontFamily || 'serif',
                        fontSize: `${ft.fontSize}px`,
                        fontWeight: isBold ? 'bold' : 'normal',
                        fontStyle: isItalic ? 'italic' : 'normal',
                        lineHeight: `${Math.round(ft.fontSize * 1.4)}px`,
                      }}
                    >
                      {line.text}
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className="w-full whitespace-pre-wrap break-words"
                  style={{
                    writingMode:
                      ft.writingMode === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
                    color: ft.color || '#1a1a1a',
                    fontFamily: ft.fontFamily || 'serif',
                    fontSize: `${ft.fontSize}px`,
                    fontWeight: isBold ? 'bold' : 'normal',
                    fontStyle: isItalic ? 'italic' : 'normal',
                    textAlign: ft.textAlign || 'left',
                    lineHeight: ft.writingMode === 'vertical' ? 1.2 : 1.4,
                    letterSpacing: ft.writingMode === 'vertical' ? '0.12em' : undefined,
                  }}
                >
                  {txtContent}
                </div>
              )}

              {/* 缩放手柄（右下，调整宽度） */}
              {isSel && (() => {
                const handleScale = Math.min(2.5, Math.max(1, 1 / (scale || 0.3)));
                return (
                  <div
                    style={{
                      left: '100%',
                      top: '100%',
                      transform: `translate(-50%, -50%) scale(${handleScale})`,
                      transformOrigin: 'center center',
                    }}
                    className="absolute pointer-events-auto z-40"
                  >
                    <div
                      onPointerDown={(e) => beginGesture(e, 'text', ft.id, 'resize')}
                      onPointerMove={moveGesture}
                      onPointerUp={endGesture}
                      onPointerCancel={endGesture}
                      title="拖拽调整宽度"
                      className="w-4 h-4 rounded-full bg-accent border-2 border-white shadow-md cursor-nwse-resize hover:scale-110 active:scale-[0.96] transition-transform duration-150 ease-out flex items-center justify-center"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
                    </div>
                  </div>
                );
              })()}

              {/* 旋转手柄（下中） */}
              {isSel && (() => {
                const handleScale = Math.min(2.5, Math.max(1, 1 / (scale || 0.3)));
                return (
                  <div
                    style={{
                      left: '50%',
                      top: '100%',
                      transform: `translateX(-50%) scale(${handleScale})`,
                      transformOrigin: 'center top',
                    }}
                    className="absolute flex flex-col items-center pointer-events-none z-40"
                  >
                    <div className="w-px h-2 bg-accent/70" />
                    <div
                      onPointerDown={(e) => beginGesture(e, 'text', ft.id, 'rotate')}
                      onPointerMove={moveGesture}
                      onPointerUp={endGesture}
                      onPointerCancel={endGesture}
                      title="拖拽旋转"
                      className="w-4 h-4 rounded-full bg-accent border-2 border-white shadow-md cursor-grab active:cursor-grabbing hover:scale-110 active:scale-[0.96] transition-transform duration-150 ease-out pointer-events-auto flex items-center justify-center"
                    >
                      <div className="w-1 h-1 rounded-full bg-white/90" />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })}
    </>
  );
};
