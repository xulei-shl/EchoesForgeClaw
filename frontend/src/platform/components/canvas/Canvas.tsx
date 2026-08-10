import React, { useRef, useEffect } from 'react';
import { CanvasContext } from './CanvasContext';

interface CanvasProps {
  children: React.ReactNode;
  scale: number;
  position: { x: number; y: number };
  onPositionChange: (position: { x: number; y: number }) => void;
}

export const Canvas: React.FC<CanvasProps> = ({ children, scale, position, onPositionChange }) => {
  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      isDragging.current = true;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const deltaX = e.clientX - lastMousePos.current.x;
    const deltaY = e.clientY - lastMousePos.current.y;
    onPositionChange({ x: position.x + deltaX, y: position.y + deltaY });
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  useEffect(() => {
    const onMouseUpGlobal = () => {
      isDragging.current = false;
    };
    window.addEventListener('mouseup', onMouseUpGlobal);
    return () => window.removeEventListener('mouseup', onMouseUpGlobal);
  }, []);

  return (
    <CanvasContext.Provider value={{ scale }}>
      <div
        className="w-full h-[calc(100vh-64px)] overflow-hidden bg-paper relative flex-1 cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          backgroundImage: `linear-gradient(var(--color-paper-grid) 1px, transparent 1px), linear-gradient(90deg, var(--color-paper-grid) 1px, transparent 1px)`,
          backgroundSize: `${24 * scale}px ${24 * scale}px`,
          backgroundPosition: `${position.x}px ${position.y}px`,
        }}
      >
        <div
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transformOrigin: '0 0',
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        >
          {children}
        </div>
      </div>
    </CanvasContext.Provider>
  );
};

export default Canvas;
