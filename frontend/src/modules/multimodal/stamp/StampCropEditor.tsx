import React, { useRef, useState, useEffect } from 'react';
import { Scissors, Upload } from 'lucide-react';
import { motion } from 'framer-motion';
import type {
  StampAspectRatio,
  StampCropBox,
  StampGrid,
  StampTextItem,
  StampStudioSettings,
  VignetteShape,
} from './types';
import { StampTextItemView, type StampGestureMode } from './StampTextItem';
import { paintStampFace } from './stampStudioEngine';

interface StampCropEditorProps {
  activeImageSrc: string | null;
  cropBox: StampCropBox;
  grid: StampGrid;
  aspectRatio: StampAspectRatio;
  withMargin: boolean;
  vignetteShape?: VignetteShape;
  textItems: StampTextItem[];
  selectedTextId: string | null;
  isExporting: boolean;
  isAnimatingCrop: boolean;
  studioSettings?: StampStudioSettings;
  onCropBoxChange: (box: StampCropBox) => void;
  onUpdateTextItems: (items: StampTextItem[]) => void;
  onSelectText: (id: string | null) => void;
  onOpenEditText: (id: string) => void;
  onExecuteCrop: () => void;
  onUploadClick: () => void;
}

export const StampCropEditor: React.FC<StampCropEditorProps> = ({
  activeImageSrc,
  cropBox,
  grid,
  aspectRatio,
  withMargin,
  vignetteShape = 'none',
  textItems,
  selectedTextId,
  isExporting,
  isAnimatingCrop,
  studioSettings,
  onCropBoxChange,
  onUpdateTextItems,
  onSelectText,
  onOpenEditText,
  onExecuteCrop,
  onUploadClick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cropBoxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);

  const [cropBoxWidthPx, setCropBoxWidthPx] = useState<number>(300);
  const [activeGestureId, setActiveGestureId] = useState<string | null>(null);

  // 选框内全实时所见即所得渲染 (Live Canvas Preview)
  useEffect(() => {
    if (!studioSettings?.designOn || !activeImageSrc || !imgRef.current) return;
    const canvas = liveCanvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img.complete || !img.naturalWidth) return;

    paintStampFace(canvas, img, cropBox, {
      withMargin,
      grid,
      studioSettings,
    });
  }, [cropBox, studioSettings, activeImageSrc, withMargin, grid]);

  // 选框拖拽与缩放
  const [isDraggingBox, setIsDraggingBox] = useState(false);
  const [isResizingBox, setIsResizingBox] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; box: StampCropBox } | null>(null);

  // 文字手势
  const textGestureRef = useRef<{
    mode: StampGestureMode;
    itemId: string;
    startPx: number;
    startPy: number;
    startX: number;
    startY: number;
    startW: number;
    startAngle: number;
    startPointerAngle: number;
    centerPx: number;
    centerPy: number;
    boxW: number;
    boxH: number;
  } | null>(null);

  // 监听选框宽度
  useEffect(() => {
    if (cropBoxRef.current) {
      setCropBoxWidthPx(cropBoxRef.current.offsetWidth || 300);
    }
  }, [cropBox, aspectRatio]);

  // 文字手势操作
  const handleTextGestureStart = (
    e: React.PointerEvent<HTMLElement>,
    item: StampTextItem,
    mode: StampGestureMode
  ) => {
    if (e.button !== 0 || isExporting || isAnimatingCrop) return;
    e.stopPropagation();
    e.preventDefault();

    const boxEl = cropBoxRef.current;
    if (!boxEl) return;
    const boxRect = boxEl.getBoundingClientRect();

    const centerPx = boxRect.left + (item.x / 100) * boxRect.width;
    const centerPy = boxRect.top + (item.y / 100) * boxRect.height;
    let startPointerAngle = 0;

    if (mode === 'rotate') {
      startPointerAngle =
        (Math.atan2(e.clientY - centerPy, e.clientX - centerPx) * 180) / Math.PI;
    }

    textGestureRef.current = {
      mode,
      itemId: item.id,
      startPx: e.clientX,
      startPy: e.clientY,
      startX: item.x,
      startY: item.y,
      startW: item.w,
      startAngle: item.angle || 0,
      startPointerAngle,
      centerPx,
      centerPy,
      boxW: boxRect.width,
      boxH: boxRect.height,
    };

    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }
    onSelectText(item.id);
    setActiveGestureId(item.id);
  };

  const handleBoxPointerDown = (e: React.PointerEvent) => {
    if (isExporting || isAnimatingCrop) return;
    onSelectText(null);
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDraggingBox(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      box: { ...cropBox },
    };
  };

  const handleResizePointerDown = (e: React.PointerEvent) => {
    if (isExporting || isAnimatingCrop) return;
    onSelectText(null);
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsResizingBox(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      box: { ...cropBox },
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    // 优先响应文字手势
    if (textGestureRef.current) {
      const g = textGestureRef.current;
      if (g.boxW <= 0 || g.boxH <= 0) return;
      e.stopPropagation();

      const next = textItems.map((it) => {
        if (it.id !== g.itemId) return it;
        if (g.mode === 'move') {
          const dx = ((e.clientX - g.startPx) / g.boxW) * 100;
          const dy = ((e.clientY - g.startPy) / g.boxH) * 100;
          return {
            ...it,
            x: Math.max(0, Math.min(100, g.startX + dx)),
            y: Math.max(0, Math.min(100, g.startY + dy)),
          };
        }
        if (g.mode === 'resize') {
          const dw = ((e.clientX - g.startPx) / g.boxW) * 100;
          return {
            ...it,
            w: Math.max(2, Math.min(30, g.startW + dw)),
          };
        }
        if (g.mode === 'rotate') {
          const curAngle =
            (Math.atan2(e.clientY - g.centerPy, e.clientX - g.centerPx) * 180) / Math.PI;
          const delta = curAngle - g.startPointerAngle;
          return {
            ...it,
            angle: Math.round((g.startAngle + delta) * 10) / 10,
          };
        }
        return it;
      });
      onUpdateTextItems(next);
      return;
    }

    if (!dragStartRef.current || !imgRef.current) return;
    const imgRect = imgRef.current.getBoundingClientRect();
    if (imgRect.width <= 0 || imgRect.height <= 0) return;

    const deltaX = (e.clientX - dragStartRef.current.mouseX) / imgRect.width;
    const deltaY = (e.clientY - dragStartRef.current.mouseY) / imgRect.height;
    const origBox = dragStartRef.current.box;

    if (isDraggingBox) {
      const nextX = Math.max(0, Math.min(1 - origBox.width, origBox.x + deltaX));
      const nextY = Math.max(0, Math.min(1 - origBox.height, origBox.y + deltaY));
      onCropBoxChange({ ...origBox, x: nextX, y: nextY });
    } else if (isResizingBox) {
      let nextW = Math.max(0.15, Math.min(1 - origBox.x, origBox.width + deltaX));
      let nextH = Math.max(0.15, Math.min(1 - origBox.y, origBox.height + deltaY));

      if (aspectRatio !== 'free') {
        const img = imgRef.current;
        const imgRatio = img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
        let singleRatio = 3 / 4;
        if (aspectRatio === '4:3') singleRatio = 4 / 3;
        if (aspectRatio === '1:1') singleRatio = 1;
        const targetRatio = (singleRatio * grid.cols) / grid.rows;
        const normRatio = targetRatio / imgRatio;

        nextH = nextW / normRatio;
        if (origBox.y + nextH > 1) {
          nextH = 1 - origBox.y;
          nextW = nextH * normRatio;
        }
      }

      onCropBoxChange({
        ...origBox,
        width: Math.min(1 - origBox.x, nextW),
        height: Math.min(1 - origBox.y, nextH),
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (textGestureRef.current) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
      textGestureRef.current = null;
      setActiveGestureId(null);
      return;
    }

    if (isDraggingBox || isResizingBox) {
      setIsDraggingBox(false);
      setIsResizingBox(false);
      dragStartRef.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handleWheelOnImage = (e: React.WheelEvent) => {
    if (isExporting || isAnimatingCrop) return;
    e.stopPropagation();
    const zoomFactor = e.deltaY < 0 ? 0.05 : -0.05;
    let newW = Math.max(0.15, Math.min(1, cropBox.width * (1 + zoomFactor)));
    let newH = Math.max(0.15, Math.min(1, cropBox.height * (1 + zoomFactor)));

    if (aspectRatio !== 'free') {
      const img = imgRef.current;
      const imgRatio = img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
      let singleRatio = 3 / 4;
      if (aspectRatio === '4:3') singleRatio = 4 / 3;
      if (aspectRatio === '1:1') singleRatio = 1;
      const targetRatio = (singleRatio * grid.cols) / grid.rows;
      const normRatio = targetRatio / imgRatio;
      newH = newW / normRatio;
    }

    const newX = Math.max(0, Math.min(1 - newW, cropBox.x + (cropBox.width - newW) / 2));
    const newY = Math.max(0, Math.min(1 - newH, cropBox.y + (cropBox.height - newH) / 2));
    onCropBoxChange({ x: newX, y: newY, width: newW, height: newH });
  };

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 w-full overflow-hidden rounded bg-paper-grid/10 border border-paper-grid/40 flex items-center justify-center select-none"
      onWheel={handleWheelOnImage}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={() => onSelectText(null)}
    >
      <motion.div
        key="editor"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="relative w-full h-full flex items-center justify-center overflow-hidden p-2"
      >
        {activeImageSrc ? (
          <div className="relative inline-flex items-center justify-center max-w-full max-h-full">
            {/* 底图 */}
            <img
              ref={imgRef}
              src={activeImageSrc}
              alt="Crop Source"
              className="max-w-full max-h-[420px] object-contain rounded shadow-sm pointer-events-none"
              crossOrigin="anonymous"
            />

            {/* 暗色遮罩 */}
            <div className="absolute inset-0 bg-black/45 pointer-events-none rounded transition-opacity duration-300" />

            {/* 邮票选框 */}
            <motion.div
              ref={cropBoxRef}
              style={{
                position: 'absolute',
                left: `${cropBox.x * 100}%`,
                top: `${cropBox.y * 100}%`,
                width: `${cropBox.width * 100}%`,
                height: `${cropBox.height * 100}%`,
              }}
              animate={
                isAnimatingCrop
                  ? {
                      scale: 1.15,
                      boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
                    }
                  : { scale: 1 }
              }
              transition={{ type: 'spring', damping: 20, stiffness: 220 }}
              onPointerDown={handleBoxPointerDown}
              className={`group cursor-move z-10 box-border flex items-center justify-center ${
                isDraggingBox ? 'cursor-grabbing' : ''
              }`}
            >
              {/* 高亮清晰原图镜像 / 工坊全套艺术实时画布预览 */}
              <div className="absolute inset-0 overflow-hidden rounded-[2px] shadow-lg pointer-events-none">
                {studioSettings?.designOn ? (
                  <canvas
                    ref={liveCanvasRef}
                    className="w-full h-full object-contain pointer-events-none"
                  />
                ) : (
                  <div
                    className="absolute"
                    style={{
                      left: `-${(cropBox.x / cropBox.width) * 100}%`,
                      top: `-${(cropBox.y / cropBox.height) * 100}%`,
                      width: `${(1 / cropBox.width) * 100}%`,
                      height: `${(1 / cropBox.height) * 100}%`,
                    }}
                  >
                    <img
                      src={activeImageSrc}
                      alt=""
                      className="w-full h-full object-contain pointer-events-none"
                      crossOrigin="anonymous"
                    />
                  </div>
                )}
              </div>

              {/* 视窗轮廓引导线 (仅在非工坊或未开金色描边时作为辅助线) */}
              {!studioSettings?.designOn && vignetteShape !== 'none' && (
                <div
                  className={`absolute inset-0 pointer-events-none border border-amber-300/80 drop-shadow-sm ${
                    vignetteShape === 'oval'
                      ? 'rounded-[50%]'
                      : vignetteShape === 'circle'
                        ? 'rounded-full'
                        : vignetteShape === 'arch'
                          ? 'rounded-t-[40%]'
                          : ''
                  }`}
                />
              )}

              {/* 白色纸边框 (withMargin，当未启用工坊时展示) */}
              {!studioSettings?.designOn && withMargin && (
                <div className="absolute inset-0 border-[6px] border-white/95 pointer-events-none shadow-sm" />
              )}

              {/* 外部锯齿打孔描边装饰 */}
              <div className="absolute inset-0 border-2 border-dashed border-white/80 pointer-events-none" />

              {/* 多联打孔横纵分割线 */}
              {grid.rows > 1 &&
                Array.from({ length: grid.rows - 1 }).map((_, idx) => {
                  const topPercent = ((idx + 1) / grid.rows) * 100;
                  return (
                    <div
                      key={`row-guide-${idx}`}
                      className="absolute left-0 right-0 pointer-events-none flex items-center justify-center z-10"
                      style={{ top: `${topPercent}%`, transform: 'translateY(-50%)' }}
                    >
                      <div className="w-full h-0 border-t-2 border-dotted border-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />
                    </div>
                  );
                })}

              {grid.cols > 1 &&
                Array.from({ length: grid.cols - 1 }).map((_, idx) => {
                  const leftPercent = ((idx + 1) / grid.cols) * 100;
                  return (
                    <div
                      key={`col-guide-${idx}`}
                      className="absolute top-0 bottom-0 pointer-events-none flex items-center justify-center z-10"
                      style={{ left: `${leftPercent}%`, transform: 'translateX(-50%)' }}
                    >
                      <div className="h-full w-0 border-l-2 border-dotted border-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />
                    </div>
                  );
                })}

              {/* 选框内排版文字列表 */}
              {textItems.map((item) => (
                <StampTextItemView
                  key={item.id}
                  item={item}
                  selected={item.id === selectedTextId}
                  isGesturing={item.id === activeGestureId}
                  stageWidth={cropBoxWidthPx}
                  disabled={isExporting || isAnimatingCrop}
                  onSelect={() => onSelectText(item.id)}
                  onOpenEdit={() => onOpenEditText(item.id)}
                  onGestureStart={handleTextGestureStart}
                  onGestureMove={handlePointerMove}
                  onGestureEnd={handlePointerUp}
                />
              ))}

              {/* 中央截取快捷悬浮按钮 */}
              {!selectedTextId && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExecuteCrop();
                  }}
                  disabled={isExporting || isAnimatingCrop}
                  className="relative z-20 px-2.5 py-1 rounded-full bg-paper/90 backdrop-blur text-ink font-medium text-xs shadow-md hover:bg-white hover:scale-105 active:scale-95 transition flex items-center gap-1.5 opacity-0 group-hover:opacity-100 duration-150 cursor-pointer"
                >
                  <Scissors size={13} className="text-accent" />
                  <span>点击截取</span>
                </button>
              )}

              {/* 缩放手柄（右下角） */}
              <div
                onPointerDown={handleResizePointerDown}
                className="absolute -right-1.5 -bottom-1.5 w-4 h-4 bg-accent rounded-full border-2 border-white cursor-se-resize shadow-md flex items-center justify-center hover:scale-125 transition z-20"
                title="拖拽缩放选框"
              >
                <div className="w-1.5 h-1.5 bg-white rounded-full" />
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-ink-faint gap-2 p-6 text-center">
            <Upload size={32} strokeWidth={1.2} />
            <p className="text-xs">请连线上级图片或点击上方按钮上传本地图片</p>
            <button
              type="button"
              onClick={onUploadClick}
              className="mt-1 px-3 py-1 text-xs bg-paper-grid/40 hover:bg-paper-grid/60 text-ink rounded transition"
            >
              上传图片
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
};
