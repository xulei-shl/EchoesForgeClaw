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

  // Maintain the latest callback
  const onPositionChangeRef = useRef(onPositionChange);
  useEffect(() => {
    onPositionChangeRef.current = onPositionChange;
  }, [onPositionChange]);

  const applyTransform = useCallback(() => {
    rafId.current = null;
    const { x, y } = dragPos.current;
    if (bgRef.current) {
      const gridSize = 24 * scale;
      const tx = x % gridSize;
      const ty = y % gridSize;
      bgRef.current.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    }
    if (containerRef.current) {
      containerRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    }
  }, [scale]);

  useEffect(() => {
    dragPos.current = { x: position.x, y: position.y };
    applyTransform();
  }, [position.x, position.y, applyTransform]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget || e.target === bgRef.current) {
      isDragging.current = true;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      if (wrapperRef.current) {
        wrapperRef.current.classList.add('is-dragging');
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
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

  const handleMouseUp = useCallback(() => {
    if (isDragging.current) {
      isDragging.current = false;
      if (wrapperRef.current) {
        wrapperRef.current.classList.remove('is-dragging');
      }
      onPositionChangeRef.current({ x: dragPos.current.x, y: dragPos.current.y });
    }
  }, []);

  useEffect(() => {
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, [handleMouseUp]);

  return (
    <CanvasContext.Provider value={{ scale, onAnchorPointerDown }}>
      <div
        ref={wrapperRef}
        className="w-full h-[calc(100vh-64px)] overflow-hidden bg-paper relative flex-1 cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
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
            backgroundSize: `${24 * scale}px ${24 * scale}px`,
            pointerEvents: 'none',
            willChange: 'transform',
          }}
        />
        <div
          ref={containerRef}
          style={{
            transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})`,
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
