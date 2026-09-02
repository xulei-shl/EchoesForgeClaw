import React from 'react';
import {
  RotateCcw,
  RotateCw,
  ChevronsUp,
  ChevronsDown,
  Trash2,
} from 'lucide-react';
import { Tooltip } from '../../../../platform/components/ui/Tooltip';
import type {
  EditorialImageItem,
  PageRatioPreset,
  EditorialTemplate,
  EditorialTypographySettings,
} from '../types';
import type { GestureLayer, GestureMode } from '../hooks/useEditorialGestures';

export interface EditorialImageLayerProps {
  items: EditorialImageItem[];
  selectedItemId: string | null;
  ratioPreset: PageRatioPreset;
  scale: number;
  activeTemplate: EditorialTemplate;
  typography: EditorialTypographySettings;
  onSelectItem: (id: string) => void;
  onRotateItem: (id: string, direction: 'cw' | 'ccw') => void;
  onBumpLayer: (id: string, mode: 'top' | 'bottom') => void;
  onDeleteItem: (id: string) => void;
  beginGesture: (
    e: React.PointerEvent,
    layer: GestureLayer,
    idItem: string,
    mode: GestureMode
  ) => void;
  moveGesture: (e: React.PointerEvent) => void;
  endGesture: (e: React.PointerEvent) => void;
}

/** 杂志排版图片素材图层组件 */
export const EditorialImageLayer: React.FC<EditorialImageLayerProps> = ({
  items,
  selectedItemId,
  ratioPreset,
  scale,
  activeTemplate,
  typography,
  onSelectItem,
  onRotateItem,
  onBumpLayer,
  onDeleteItem,
  beginGesture,
  moveGesture,
  endGesture,
}) => {
  return (
    <>
      {items.map((item) => {
        const isSelectedItem = selectedItemId === item.id;
        const imgPxX = (item.x / 100) * ratioPreset.width;
        const imgPxY = (item.y / 100) * ratioPreset.height;
        const imgPxW = (item.width / 100) * ratioPreset.width;
        const naturalRatio = item.aspectRatio || 1;
        const imgPxH = imgPxW / naturalRatio;

        return (
          <div
            key={item.id}
            className={`absolute touch-none transition-shadow ${
              isSelectedItem
                ? 'ring-2 ring-accent ring-offset-2 ring-offset-white z-30 shadow-lg'
                : 'z-10'
            }`}
            style={{
              left: `${imgPxX}px`,
              top: `${imgPxY}px`,
              width: `${imgPxW}px`,
              height: `${imgPxH}px`,
              transform: `rotate(${item.rotation || 0}deg)`,
              transformOrigin: 'center center',
            }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectItem(item.id);
            }}
          >
            <div
              className={`w-full h-full ${
                activeTemplate.features.hasFrameBorder
                  ? 'p-3 bg-white shadow-2xl ring-1 ring-black/5 rounded-sm'
                  : 'shadow-md rounded-sm'
              }`}
            >
              <img
                src={item.src}
                alt=""
                draggable={false}
                onPointerDown={(e) => beginGesture(e, 'image', item.id, 'move')}
                onPointerMove={moveGesture}
                onPointerUp={endGesture}
                onPointerCancel={endGesture}
                className="w-full h-full object-cover cursor-move block"
              />
            </div>

            {/* 图注 (Caption) */}
            {item.caption && (
              <div
                className="absolute font-sans font-medium text-[13px] opacity-70 pointer-events-none whitespace-nowrap"
                style={{
                  top: `calc(100% + ${Math.round(typography.bodyFontSize * 0.7)}px)`,
                  left: 0,
                  color: typography.secondaryColor || '#777777',
                }}
              >
                {item.caption}
              </div>
            )}

            {/* 悬浮微操作栏 */}
            {isSelectedItem && (() => {
              const invScale = Math.min(2.2, Math.max(1, 1 / (scale || 0.3)));
              return (
                <div
                  style={{
                    left: '50%',
                    top: item.y < 12 ? `calc(100% + ${(10 * invScale).toFixed(1)}px)` : undefined,
                    bottom: item.y >= 12 ? `calc(100% + ${(10 * invScale).toFixed(1)}px)` : undefined,
                    transform: `translateX(-50%) scale(${invScale})`,
                    transformOrigin: item.y < 12 ? 'center top' : 'center bottom',
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-paper/95 backdrop-blur-md shadow-md border border-paper-grid/50 transition-[opacity,transform] duration-150 ease-out z-50 pointer-events-auto select-none"
                >
                  <Tooltip content="逆时针旋转 90° (摆正)">
                    <button
                      type="button"
                      onClick={() => onRotateItem(item.id, 'ccw')}
                      className="relative p-1 rounded text-ink-light hover:text-accent hover:bg-paper-grid/40 active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out before:absolute before:-inset-1 before:content-['']"
                    >
                      <RotateCcw size={12} strokeWidth={1.8} />
                    </button>
                  </Tooltip>
                  <Tooltip content="顺时针旋转 90° (摆正)">
                    <button
                      type="button"
                      onClick={() => onRotateItem(item.id, 'cw')}
                      className="relative p-1 rounded text-ink-light hover:text-accent hover:bg-paper-grid/40 active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out before:absolute before:-inset-1 before:content-['']"
                    >
                      <RotateCw size={12} strokeWidth={1.8} />
                    </button>
                  </Tooltip>
                  <div className="w-px h-3 bg-paper-grid/50 my-auto mx-0.5" />
                  <Tooltip content="置顶图层">
                    <button
                      type="button"
                      onClick={() => onBumpLayer(item.id, 'top')}
                      className="relative p-1 rounded text-ink-light hover:text-accent hover:bg-paper-grid/40 active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out before:absolute before:-inset-1 before:content-['']"
                    >
                      <ChevronsUp size={12} strokeWidth={1.8} />
                    </button>
                  </Tooltip>
                  <Tooltip content="置底图层">
                    <button
                      type="button"
                      onClick={() => onBumpLayer(item.id, 'bottom')}
                      className="relative p-1 rounded text-ink-light hover:text-accent hover:bg-paper-grid/40 active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out before:absolute before:-inset-1 before:content-['']"
                    >
                      <ChevronsDown size={12} strokeWidth={1.8} />
                    </button>
                  </Tooltip>
                  <div className="w-px h-3 bg-paper-grid/50 my-auto mx-0.5" />
                  <Tooltip content="移除图片素材">
                    <button
                      type="button"
                      onClick={() => onDeleteItem(item.id)}
                      className="relative p-1 rounded text-ink-light hover:text-error hover:bg-error/10 active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out before:absolute before:-inset-1 before:content-['']"
                    >
                      <Trash2 size={12} strokeWidth={1.8} />
                    </button>
                  </Tooltip>
                </div>
              );
            })()}

            {/* 缩放手柄与旋转手柄 */}
            {isSelectedItem && (() => {
              const handleScale = Math.min(2.5, Math.max(1, 1 / (scale || 0.3)));
              return (
                <>
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
                      onPointerDown={(e) => beginGesture(e, 'image', item.id, 'resize')}
                      onPointerMove={moveGesture}
                      onPointerUp={endGesture}
                      onPointerCancel={endGesture}
                      title="拖拽调整大小"
                      className="w-4 h-4 rounded-full bg-accent border-2 border-white shadow-md cursor-nwse-resize hover:scale-110 active:scale-[0.96] transition-transform duration-150 ease-out flex items-center justify-center"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
                    </div>
                  </div>

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
                      onPointerDown={(e) => beginGesture(e, 'image', item.id, 'rotate')}
                      onPointerMove={moveGesture}
                      onPointerUp={endGesture}
                      onPointerCancel={endGesture}
                      title="拖拽旋转"
                      className="w-4 h-4 rounded-full bg-accent border-2 border-white shadow-md cursor-grab active:cursor-grabbing hover:scale-110 active:scale-[0.96] transition-transform duration-150 ease-out pointer-events-auto flex items-center justify-center"
                    >
                      <div className="w-1 h-1 rounded-full bg-white/90" />
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        );
      })}
    </>
  );
};
