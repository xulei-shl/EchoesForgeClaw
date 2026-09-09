import React, { useRef, useEffect, useCallback } from 'react';
import { CanvasContext } from './CanvasContext';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** 框选候选节点矩形（画布坐标） */
export interface MarqueeCandidate {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasProps {
  children: React.ReactNode;
  scale: number;
  position: { x: number; y: number };
  onPositionChange: (position: { x: number; y: number }) => void;
  /** 当前激活/选中的节点 ID */
  activeNodeId?: string | null;
  /** 激活节点变化回调 */
  onActiveNodeChange?: (id: string | null) => void;
  /** 多选节点集合（普通点击单选也在集合内） */
  selectedIds?: Set<string>;
  /** 普通点击选中（替换选择集；null 清空） */
  selectNode?: (id: string | null) => void;
  /** Ctrl/Cmd+点击切换多选成员 */
  toggleNodeSelection?: (id: string) => void;
  /** 框选候选节点矩形（画布坐标，含实时尺寸）；不提供则 Shift+拖拽退化为平移 */
  getMarqueeCandidates?: () => MarqueeCandidate[];
  /** 框选完成：命中节点 id 列表；空数组 = 未命中（清空选择） */
  onMarqueeSelect?: (ids: string[]) => void;
  /** 节点输出锚点按下（手动拖线连线起点），经 context 透传给各节点 */
  onAnchorPointerDown?: (nodeId: string, e: ReactPointerEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export const Canvas: React.FC<CanvasProps> = ({
  children,
  scale,
  position,
  onPositionChange,
  activeNodeId,
  onActiveNodeChange,
  selectedIds,
  selectNode,
  toggleNodeSelection,
  getMarqueeCandidates,
  onMarqueeSelect,
  onAnchorPointerDown,
  onContextMenu,
}) => {
  const isDragging = useRef(false);
  const pointerDownPos = useRef({ x: 0, y: 0 });
  const lastMousePos = useRef({ x: 0, y: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const dragOverlayRef = useRef<HTMLDivElement>(null);
  const dragPos = useRef({ x: position.x, y: position.y });
  const rafId = useRef<number | null>(null);

  // ---------- Shift+框选状态 ----------
  const marqueeRef = useRef<HTMLDivElement>(null);
  const marqueeActive = useRef(false);
  const marqueeStart = useRef({ x: 0, y: 0 }); // wrapper 内屏幕坐标
  const marqueeLast = useRef({ x: 0, y: 0 });
  const marqueeWrapperRect = useRef<DOMRect | null>(null);
  const marqueeRafId = useRef<number | null>(null);

  // 保持最新回调引用，避免闭包过期
  const onPositionChangeRef = useRef(onPositionChange);
  useEffect(() => {
    onPositionChangeRef.current = onPositionChange;
  }, [onPositionChange]);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const candidatesRef = useRef(getMarqueeCandidates);
  candidatesRef.current = getMarqueeCandidates;
  const onMarqueeSelectRef = useRef(onMarqueeSelect);
  onMarqueeSelectRef.current = onMarqueeSelect;
  const endDragRef = useRef<(pointerId?: number, currentTarget?: HTMLElement) => void>(() => {});

  const applyTransform = useCallback(() => {
    rafId.current = null;
    const { x, y } = dragPos.current;
    if (bgRef.current) {
      const gridSize = 24 * scale;
      const tx = ((x % gridSize) + gridSize) % gridSize;
      const ty = ((y % gridSize) + gridSize) % gridSize;
      bgRef.current.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    }
    if (containerRef.current) {
      containerRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    }
  }, [scale]);

  // 外部传入的 position（如聚焦居中、自适应布局）更新时同步拖拽基准坐标
  useEffect(() => {
    if (!isDragging.current) {
      dragPos.current = { x: position.x, y: position.y };
      applyTransform();
    }
  }, [position.x, position.y, applyTransform]);

  // 监听 Escape 按键：清除当前选中的节点
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onActiveNodeChange?.(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onActiveNodeChange]);

  /** 框选中：rAF 合并更新选区矩形 DOM（wrapper 内屏幕坐标） */
  const applyMarquee = useCallback(() => {
    marqueeRafId.current = null;
    const el = marqueeRef.current;
    if (!el || !marqueeActive.current) return;
    const { x: sx, y: sy } = marqueeStart.current;
    const { x: lx, y: ly } = marqueeLast.current;
    const left = Math.min(sx, lx);
    const top = Math.min(sy, ly);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${Math.abs(lx - sx)}px`;
    el.style.height = `${Math.abs(ly - sy)}px`;
  }, []);

  /** 框选结束：按画布坐标命中测试候选节点，回调选中的 id 列表 */
  const finishMarquee = useCallback(() => {
    if (!marqueeActive.current) return;
    marqueeActive.current = false;
    if (marqueeRafId.current !== null) {
      cancelAnimationFrame(marqueeRafId.current);
      marqueeRafId.current = null;
    }
    if (marqueeRef.current) marqueeRef.current.style.display = 'none';
    const rect = marqueeWrapperRect.current;
    marqueeWrapperRect.current = null;
    if (!rect) return;
    const { x: sx, y: sy } = marqueeStart.current;
    const { x: lx, y: ly } = marqueeLast.current;
    const pos = dragPos.current;
    const s = scaleRef.current;
    // 屏幕矩形 → 画布坐标矩形（容器 transform：translate(pos) scale(s)）
    const cx1 = (Math.min(sx, lx) - rect.left - pos.x) / s;
    const cy1 = (Math.min(sy, ly) - rect.top - pos.y) / s;
    const cx2 = (Math.max(sx, lx) - rect.left - pos.x) / s;
    const cy2 = (Math.max(sy, ly) - rect.top - pos.y) / s;
    const candidates = candidatesRef.current?.() ?? [];
    const hit = candidates.filter(
      (c) => c.x < cx2 && c.x + c.width > cx1 && c.y < cy2 && c.y + c.height > cy1
    );
    onMarqueeSelectRef.current?.(hit.map((c) => c.id));
  }, []);

  const startMarquee = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return false;
    marqueeActive.current = true;
    marqueeWrapperRect.current = rect;
    marqueeStart.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    marqueeLast.current = { ...marqueeStart.current };
    if (marqueeRef.current) {
      marqueeRef.current.style.display = 'block';
      marqueeRef.current.style.left = '0px';
      marqueeRef.current.style.top = '0px';
      marqueeRef.current.style.width = '0px';
      marqueeRef.current.style.height = '0px';
    }
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* 忽略指针捕获失败 */
    }
    return true;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 仅响应鼠标左键（0）或中键（1）
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as HTMLElement;
    const isDirectCanvas = target === e.currentTarget || target === bgRef.current;
    const isGroupFrameBg = Boolean(target.closest('[data-group-frame]') && !target.closest('.node-drag-handle, button, input, textarea, a'));

    // Shift+左键拖拽 = 框选（支持在空白画布或分组框背景空白处起笔）
    if (e.button === 0 && e.shiftKey && candidatesRef.current && (isDirectCanvas || isGroupFrameBg)) {
      startMarquee(e);
      return;
    }

    // 中键在画布/分组框背景上平移，或左键在纯空白画布上平移
    if ((e.button === 1 && (isDirectCanvas || isGroupFrameBg)) || (e.button === 0 && isDirectCanvas)) {
      // 记录起始位置，不在此处同步清空选中态，避免起步帧发生全画布 React 重渲染
      isDragging.current = true;
      pointerDownPos.current = { x: e.clientX, y: e.clientY };
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* 忽略指针捕获失败 */
      }
      if (dragOverlayRef.current) {
        dragOverlayRef.current.style.display = 'block';
      }
      if (wrapperRef.current) {
        wrapperRef.current.classList.add('is-dragging');
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // 框选分支：rAF 合并更新选区矩形
    if (marqueeActive.current) {
      const rect = marqueeWrapperRect.current;
      if (rect) {
        marqueeLast.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        if (marqueeRafId.current === null) {
          marqueeRafId.current = requestAnimationFrame(applyMarquee);
        }
      }
      return;
    }
    if (!isDragging.current) return;
    const deltaX = e.clientX - lastMousePos.current.x;
    const deltaY = e.clientY - lastMousePos.current.y;

    dragPos.current.x += deltaX;
    dragPos.current.y += deltaY;
    lastMousePos.current = { x: e.clientX, y: e.clientY };

    if (rafId.current === null) {
      rafId.current = requestAnimationFrame(applyTransform);
    }
  };

  const endDrag = (pointerId?: number, currentTarget?: HTMLElement) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (dragOverlayRef.current) {
      dragOverlayRef.current.style.display = 'none';
    }
    if (wrapperRef.current) {
      wrapperRef.current.classList.remove('is-dragging');
    }
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    if (pointerId !== undefined && currentTarget) {
      try {
        currentTarget.releasePointerCapture?.(pointerId);
      } catch {
        /* 忽略释放捕获失败 */
      }
    }
    applyTransform();
    onPositionChangeRef.current({ x: dragPos.current.x, y: dragPos.current.y });
  };
  // 每渲染同步最新 endDrag（供仅挂载一次的窗口兜底 effect 调用）
  endDragRef.current = endDrag;

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    // 结束框选：小幅点击空白 = 清空选择；拖拽 = 按命中结果多选
    if (marqueeActive.current) {
      const moved = Math.hypot(
        marqueeLast.current.x - marqueeStart.current.x,
        marqueeLast.current.y - marqueeStart.current.y
      );
      finishMarquee();
      if (moved < 3) {
        onActiveNodeChange?.(null);
      }
      return;
    }
    if (isDragging.current) {
      const dx = e.clientX - pointerDownPos.current.x;
      const dy = e.clientY - pointerDownPos.current.y;
      // 若位移小于 3px，说明是单纯点击画布空白处，清除当前激活节点
      if (Math.hypot(dx, dy) < 3) {
        onActiveNodeChange?.(null);
      }
    }
    endDrag(e.pointerId, e.currentTarget as HTMLElement);
  };

  // 全局兜底：防止意外丢失 pointerup（如窗口切换）
  // 经 ref 调用最新 endDrag（普通函数每渲染重建，effect 仅挂载一次；ref 同时避免闭包持旧 scale）
  useEffect(() => {
    const onWindowPointerUp = () => {
      if (isDragging.current) {
        endDragRef.current();
      }
    };
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);
    return () => {
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerUp);
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      if (marqueeRafId.current !== null) cancelAnimationFrame(marqueeRafId.current);
    };
  }, []);

  // 渲染时若正在拖拽，style 取实时 dragPos，防止 React 重渲染将 DOM transform 覆盖回旧 position
  const curPos = isDragging.current ? dragPos.current : position;
  const gridSize = 24 * scale;
  const bgTx = ((curPos.x % gridSize) + gridSize) % gridSize;
  const bgTy = ((curPos.y % gridSize) + gridSize) % gridSize;

  return (
    <CanvasContext.Provider
      value={{
        scale,
        activeNodeId,
        setActiveNodeId: onActiveNodeChange,
        selectedIds,
        selectNode,
        toggleNodeSelection,
        onAnchorPointerDown,
      }}
    >
      <div
        ref={wrapperRef}
        className="w-full h-[calc(100vh-64px)] overflow-hidden bg-paper relative flex-1 cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={() => endDrag()}
        onContextMenu={onContextMenu}
      >
        {/* 高性能拖拽透明拦截遮罩：拖动画板时阻断下层节点事件，0 样式重算开销 */}
        <div
          ref={dragOverlayRef}
          style={{
            display: 'none',
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            zIndex: 9999,
            pointerEvents: 'auto',
            cursor: 'grabbing',
          }}
        />
        {/* Shift+框选矩形（屏幕坐标覆盖层，不参与命中） */}
        <div
          ref={marqueeRef}
          style={{
            display: 'none',
            position: 'absolute',
            zIndex: 9000,
            border: '1px solid color-mix(in srgb, var(--color-accent) 70%, transparent)',
            background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
            borderRadius: 2,
            pointerEvents: 'none',
          }}
        />
        <div
          ref={bgRef}
          style={{
            position: 'absolute',
            top: -100,
            left: -100,
            right: -100,
            bottom: -100,
            backgroundImage: `linear-gradient(var(--color-paper-grid) 1px, transparent 1px), linear-gradient(90deg, var(--color-paper-grid) 1px, transparent 1px)`,
            backgroundSize: `${gridSize}px ${gridSize}px`,
            transform: `translate3d(${bgTx}px, ${bgTy}px, 0)`,
            pointerEvents: 'none',
            willChange: 'transform',
          }}
        />
        <div
          ref={containerRef}
          style={{
            transform: `translate3d(${curPos.x}px, ${curPos.y}px, 0) scale(${scale})`,
            transformOrigin: '0 0',
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            willChange: 'transform',
          }}
        >
          {children}
        </div>
      </div>
      <style>{`
        @keyframes flow {
          to {
            stroke-dashoffset: -10;
          }
        }
        .animate-flow {
          animation: flow 1s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-flow {
            animation: none !important;
          }
        }
      `}</style>
    </CanvasContext.Provider>
  );
};

export default Canvas;
