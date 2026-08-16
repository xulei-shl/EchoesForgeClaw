import React, { useRef, useEffect, useCallback } from 'react';
import { CanvasContext } from './CanvasContext';
import type { PointerEvent as ReactPointerEvent } from 'react';

interface CanvasProps {
  children: React.ReactNode;
  scale: number;
  position: { x: number; y: number };
  onPositionChange: (position: { x: number; y: number }) => void;
  /** 节点输出锚点按下（手动拖线连线起点），经 context 透传给各节点 */
  onAnchorPointerDown?: (nodeId: string, e: ReactPointerEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export const Canvas: React.FC<CanvasProps> = ({
  children,
  scale,
  position,
  onPositionChange,
  onAnchorPointerDown,
  onContextMenu,
}) => {
  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const dragPos = useRef({ x: position.x, y: position.y });
  const rafId = useRef<number | null>(null);

  // 保持最新回调引用，避免闭包过期
  const onPositionChangeRef = useRef(onPositionChange);
  useEffect(() => {
    onPositionChangeRef.current = onPositionChange;
  }, [onPositionChange]);
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

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 仅响应鼠标左键（0）或中键（1），且仅当命中画布背景或 wrapper 自身时触发平移
    if (e.button !== 0 && e.button !== 1) return;
    if (e.target === e.currentTarget || e.target === bgRef.current) {
      isDragging.current = true;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* 忽略指针捕获失败 */
      }
      if (wrapperRef.current) {
        wrapperRef.current.classList.add('is-dragging');
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
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
    };
  }, []);

  // 渲染时若正在拖拽，style 取实时 dragPos，防止 React 重渲染将 DOM transform 覆盖回旧 position
  const curPos = isDragging.current ? dragPos.current : position;
  const gridSize = 24 * scale;
  const bgTx = ((curPos.x % gridSize) + gridSize) % gridSize;
  const bgTy = ((curPos.y % gridSize) + gridSize) % gridSize;

  return (
    <CanvasContext.Provider value={{ scale, onAnchorPointerDown }}>
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
        .is-dragging * {
          pointer-events: none !important;
        }
        @keyframes flow {
          to {
            stroke-dashoffset: -10;
          }
        }
        .animate-flow {
          animation: flow 1s linear infinite;
        }
      `}</style>
    </CanvasContext.Provider>
  );
};

export default Canvas;
