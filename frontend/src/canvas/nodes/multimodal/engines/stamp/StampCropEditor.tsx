import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Scissors, Upload, Move } from 'lucide-react';
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
import { paintStampFace, paintPostmark } from './stampStudioEngine';

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
  onCropBoxCommit?: (box: StampCropBox) => void;
  onUpdateTextItems: (items: StampTextItem[]) => void;
  onSelectText: (id: string | null) => void;
  onOpenEditText: (id: string) => void;
  onExecuteCrop: () => void;
  onUploadClick: () => void;
  /** 更新工坊高级配置（如邮戳位置拖拽等） */
  onUpdateStudioSettings?: (patch: Partial<StampStudioSettings>) => void;
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
  onCropBoxCommit,
  onUpdateTextItems,
  onSelectText,
  onOpenEditText,
  onExecuteCrop,
  onUploadClick,
  onUpdateStudioSettings,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cropBoxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const baseStampCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const postmarkHandleRef = useRef<HTMLDivElement | null>(null);
  const rafPostmarkIdRef = useRef<number | null>(null);

  const [cropBoxWidthPx, setCropBoxWidthPx] = useState<number>(300);
  const [activeGestureId, setActiveGestureId] = useState<string | null>(null);

  // 盖销邮戳拖拽手势
  const [isDraggingPostmark, setIsDraggingPostmark] = useState(false);
  const currentPostmarkPosRef = useRef<{ x: number; y: number }>({
    x: studioSettings?.postmarkPos?.x ?? 0.35,
    y: studioSettings?.postmarkPos?.y ?? 0.62,
  });
  const postmarkDragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    origX: number;
    origY: number;
    boxW: number;
    boxH: number;
  } | null>(null);

  // 当外部非拖动变更（如侧栏滑块或模板切换）时同步当前坐标与手柄位置
  useEffect(() => {
    if (!isDraggingPostmark && studioSettings?.postmarkPos) {
      currentPostmarkPosRef.current = { ...studioSettings.postmarkPos };
      if (postmarkHandleRef.current) {
        postmarkHandleRef.current.style.left = `${studioSettings.postmarkPos.x * 100}%`;
        postmarkHandleRef.current.style.top = `${(1 - studioSettings.postmarkPos.y) * 100}%`;
      }
    }
  }, [studioSettings?.postmarkPos, isDraggingPostmark]);

  // 提取除邮戳外的底图特征指纹，避免拖拽邮戳时重复进行数百万像素的分色与底纸计算
  const baseSignature = useMemo(() => {
    if (!studioSettings?.designOn) {
      return `${activeImageSrc}|${cropBox.x},${cropBox.y},${cropBox.width},${cropBox.height}|${withMargin}|${grid.rows}x${grid.cols}`;
    }
    const s = studioSettings;
    return [
      activeImageSrc,
      cropBox.x, cropBox.y, cropBox.width, cropBox.height,
      withMargin, grid.rows, grid.cols,
      s.designOn, s.print, s.inkColor, s.ink, s.relief,
      s.frame, s.frameColor, s.margin, s.ornament, s.ornamentSize,
      s.vignette, s.vignetteRule, s.vignetteColor, s.feather, s.artFit,
      s.country, s.countryArc, s.denomination, s.denomAnchor, s.tablets, s.caption, s.ribbon, s.typeface,
      s.ground, s.groundColor, s.groundWeight, s.groundScale, s.groundAngle, s.groundStrength, s.groundUnderArt, s.groundClear,
      s.toning, s.fiber, s.foxing, s.wear,
    ].join('::');
  }, [cropBox, studioSettings, activeImageSrc, withMargin, grid]);

  // 高速合成底图 + 邮戳至目标画布（耗时 <0.1ms）
  const compositeLiveCanvas = useCallback((overridePos?: { x: number; y: number }) => {
    const liveCanvas = liveCanvasRef.current;
    const baseCanvas = baseStampCanvasRef.current;
    if (!liveCanvas || !baseCanvas || !baseCanvas.width || !baseCanvas.height) return;

    if (liveCanvas.width !== baseCanvas.width || liveCanvas.height !== baseCanvas.height) {
      liveCanvas.width = baseCanvas.width;
      liveCanvas.height = baseCanvas.height;
    }

    const ctx = liveCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
    ctx.drawImage(baseCanvas, 0, 0);

    if (studioSettings?.designOn && studioSettings?.postmarkOn) {
      const pos = overridePos || currentPostmarkPosRef.current;
      paintPostmark(
        ctx,
        {
          ...studioSettings,
          postmarkPos: pos,
        },
        liveCanvas.width,
        liveCanvas.height
      );
    }
  }, [studioSettings]);

  // 1. 底图重绘调度（仅在 baseSignature 改变时执行全量离屏渲染并缓存）
  useEffect(() => {
    if (!studioSettings?.designOn || !activeImageSrc || !imgRef.current) return;
    const img = imgRef.current;
    if (!img.complete || !img.naturalWidth) return;

    if (!baseStampCanvasRef.current) {
      baseStampCanvasRef.current = document.createElement('canvas');
    }
    const baseCanvas = baseStampCanvasRef.current;

    let rafId: number;
    rafId = requestAnimationFrame(() => {
      paintStampFace(baseCanvas, img, cropBox, {
        withMargin,
        grid,
        studioSettings,
        skipPostmark: true,
      });
      compositeLiveCanvas();
    });

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [baseSignature, compositeLiveCanvas, studioSettings?.designOn, activeImageSrc, cropBox, withMargin, grid]);

  // 2. 当邮戳属性（开关、样式、文字、颜色、角度、浓度）变化时，复用底图进行微秒级快速重绘
  useEffect(() => {
    if (!isDraggingPostmark && studioSettings?.designOn && baseStampCanvasRef.current) {
      compositeLiveCanvas();
    }
  }, [
    studioSettings?.postmarkOn,
    studioSettings?.postmarkStyle,
    studioSettings?.postmarkCity,
    studioSettings?.postmarkSubtext,
    studioSettings?.postmarkDate,
    studioSettings?.postmarkColor,
    studioSettings?.postmarkAngle,
    studioSettings?.postmarkStrength,
    compositeLiveCanvas,
    isDraggingPostmark,
  ]);

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

  const handlePostmarkPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || isExporting || isAnimatingCrop || !studioSettings?.postmarkOn) return;
    onSelectText(null);
    e.stopPropagation();
    e.preventDefault();

    const boxEl = cropBoxRef.current;
    if (!boxEl) return;
    const boxRect = boxEl.getBoundingClientRect();
    if (boxRect.width <= 0 || boxRect.height <= 0) return;

    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }

    setIsDraggingPostmark(true);
    postmarkDragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      origX: currentPostmarkPosRef.current.x,
      origY: currentPostmarkPosRef.current.y,
      boxW: boxRect.width,
      boxH: boxRect.height,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    // 优先响应盖销邮戳拖拽（原生 DOM 零延迟直接驱动 + rAF 极速合成）
    if (isDraggingPostmark && postmarkDragStartRef.current) {
      const g = postmarkDragStartRef.current;
      if (g.boxW <= 0 || g.boxH <= 0) return;
      e.stopPropagation();

      const deltaX = (e.clientX - g.mouseX) / g.boxW;
      const deltaY = (e.clientY - g.mouseY) / g.boxH;
      const nextX = Math.max(0, Math.min(1, g.origX + deltaX));
      const nextY = Math.max(0, Math.min(1, g.origY - deltaY));
      const roundedX = Math.round(nextX * 1000) / 1000;
      const roundedY = Math.round(nextY * 1000) / 1000;

      currentPostmarkPosRef.current = { x: roundedX, y: roundedY };

      // 1. 原生 DOM 绝对即时同步手柄位置（无 transition 缓动阻力，无 React State 重渲染）
      if (postmarkHandleRef.current) {
        postmarkHandleRef.current.style.left = `${roundedX * 100}%`;
        postmarkHandleRef.current.style.top = `${(1 - roundedY) * 100}%`;
      }

      // 2. rAF 节流防抖微秒级局部重绘 Canvas（基于离屏缓存 <0.1ms）
      if (rafPostmarkIdRef.current) {
        cancelAnimationFrame(rafPostmarkIdRef.current);
      }
      rafPostmarkIdRef.current = requestAnimationFrame(() => {
        compositeLiveCanvas({ x: roundedX, y: roundedY });
      });
      return;
    }

    // 响应文字手势
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
    if (isDraggingPostmark) {
      try {
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
      setIsDraggingPostmark(false);
      postmarkDragStartRef.current = null;
      if (rafPostmarkIdRef.current) {
        cancelAnimationFrame(rafPostmarkIdRef.current);
        rafPostmarkIdRef.current = null;
      }

      // 仅在拖拽释放时单次持久化状态，消除主线程频繁重算与广播
      const finalPos = currentPostmarkPosRef.current;
      onUpdateStudioSettings?.({
        postmarkPos: { x: finalPos.x, y: finalPos.y },
      });
      return;
    }

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
      onCropBoxCommit?.(cropBox);
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
    const nextBox = { x: newX, y: newY, width: newW, height: newH };
    onCropBoxChange(nextBox);
    onCropBoxCommit?.(nextBox);
  };

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 w-full overflow-hidden rounded-lg bg-paper-grid/10 border border-paper-grid/40 flex items-center justify-center select-none"
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
                      scale: 1.08,
                      boxShadow: '0 16px 32px rgba(0,0,0,0.35)',
                    }
                  : { scale: 1 }
              }
              transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
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

              {/* 盖销邮戳交互手柄（当启用邮戳时支持在画面上直接拖拽定位） */}
              {studioSettings?.postmarkOn && (
                <div
                  ref={postmarkHandleRef}
                  role="button"
                  tabIndex={0}
                  aria-label="拖拽调整盖销邮戳位置"
                  title="按住拖拽调整邮戳位置"
                  onPointerDown={handlePostmarkPointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className={`absolute z-30 rounded-full touch-none select-none flex items-center justify-center cursor-grab group/pmhandle ${
                    isDraggingPostmark
                      ? 'cursor-grabbing border-2 border-dashed border-accent bg-accent/20 ring-4 ring-accent/25 scale-105 shadow-md transition-none will-change-transform'
                      : 'border-2 border-dashed border-transparent hover:border-accent/70 hover:bg-accent/10 transition-[border-color,background-color,box-shadow] duration-150'
                  }`}
                  style={{
                    left: `${currentPostmarkPosRef.current.x * 100}%`,
                    top: `${(1 - currentPostmarkPosRef.current.y) * 100}%`,
                    width: `${Math.max(56, Math.round(cropBoxWidthPx * 0.31))}px`,
                    height: `${Math.max(56, Math.round(cropBoxWidthPx * 0.31))}px`,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  {/* 悬浮/拖拽时浮现的徽标与中心指引十字 */}
                  <div
                    className={`absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-ink/85 text-paper text-[9px] whitespace-nowrap pointer-events-none transition-opacity duration-150 flex items-center gap-1 shadow-sm ${
                      isDraggingPostmark ? 'opacity-100' : 'opacity-0 group-hover/pmhandle:opacity-100'
                    }`}
                  >
                    <Move size={9} />
                    <span>拖动邮戳</span>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-full bg-paper/85 backdrop-blur-xs border border-accent/50 text-accent flex items-center justify-center transition-opacity duration-150 shadow-2xs pointer-events-none ${
                      isDraggingPostmark ? 'opacity-100' : 'opacity-0 group-hover/pmhandle:opacity-100'
                    }`}
                  >
                    <Move size={12} strokeWidth={2.2} />
                  </div>
                </div>
              )}

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
                  className="relative z-20 px-2.5 py-1 rounded-full bg-paper/90 backdrop-blur text-ink font-medium text-xs shadow-md hover:bg-white hover:text-accent hover:scale-105 active:scale-[0.96] transition-[transform,color,background-color,opacity] flex items-center gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-90 duration-150 cursor-pointer"
                >
                  <Scissors size={13} className="text-accent" />
                  <span>点击截取</span>
                </button>
              )}

              {/* 缩放手柄（右下角）- 40px 热区与辅助特性 */}
              <div
                role="slider"
                aria-label="拖拽缩放选框大小"
                aria-valuenow={Math.round(cropBox.width * 100)}
                tabIndex={0}
                onPointerDown={handleResizePointerDown}
                className="absolute -right-1.5 -bottom-1.5 w-4 h-4 bg-accent rounded-full border-2 border-white cursor-se-resize shadow-md flex items-center justify-center hover:scale-110 active:scale-95 transition-transform duration-150 z-20 before:absolute before:-inset-3 before:content-[''] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:outline-none"
                title="拖拽缩放选框"
              >
                <div className="w-1.5 h-1.5 bg-white rounded-full pointer-events-none" />
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
