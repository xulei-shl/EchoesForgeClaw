import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useCanvas } from '../canvas/CanvasContext';

/** 拖拽激活阈值（px），防止点击头部时轻微抖动误触发 */
const DRAG_THRESHOLD = 3;

let globalZIndex = 10;

export interface CanvasNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  children: React.ReactNode;
  className?: string;
  /** 卡片边框外侧右下角的操作按钮（icon 按钮），随卡片拖动 */
  actionBar?: React.ReactNode;
  /** 卡片边框外侧底部的插槽（如「+ 添加子节点」按钮），随卡片拖动 */
  footer?: React.ReactNode;
  /** 所属自定义分组（有分组时在标题旁展示小标签） */
  groupBadge?: string;
  /** 标题旁的类型不匹配提示（红色徽标，如「类型不匹配 ×2」）；null/undefined 不展示 */
  mismatchBadge?: string | null;
  /** 左上角类型指示圆点颜色 (推荐使用 OKLCH) */
  dotColor?: string;
  /** 允许拖拽右下角手柄调整卡片尺寸 */
  resizable?: boolean;
  /** 默认（同时也是最小）尺寸；开启 resizable 时必填 */
  defaultSize?: { width: number; height: number };
  onRemove?: () => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  /** 拖拽中（每帧）实时回调，供父级命令式更新连线，不触发 React 渲染 */
  onDrag?: (id: string, x: number, y: number) => void;
  /** 根层级覆盖层，渲染在卡片根节点（边框内），用于光束动效等 */
  glowOverlay?: React.ReactNode;
  /** 是否显示左侧/右侧连接点 */
  showLeftAnchor?: boolean;
  showRightAnchor?: boolean;
  /** 根节点点击回调（选中态等） */
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** 根节点右键菜单回调（父级需 preventDefault 以抑制浏览器菜单） */
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export const CanvasNode: React.FC<CanvasNodeProps> = ({
  id,
  initialX = 100,
  initialY = 100,
  title,
  children,
  className = '',
  actionBar,
  resizable = false,
  defaultSize,
  onRemove,
  onPositionChange,
  onSizeChange,
  onDrag,
  glowOverlay,
  showLeftAnchor,
  showRightAnchor,
  onClick,
  onContextMenu,
  footer,
  groupBadge,
  mismatchBadge,
  dotColor,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const { scale } = useCanvas();

  const [zIndex, setZIndex] = useState(() => globalZIndex++);

  const bringToFront = useCallback(() => {
    setZIndex(globalZIndex++);
  }, []);

  const [position, setPosition] = useState({ x: initialX, y: initialY });
  // 拖拽中的实时位置：命令式更新，不触发 React 渲染
  const dragPos = useRef({ x: initialX, y: initialY });
  const draggingRef = useRef(false);
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  const dragStart = useRef({ pointerX: 0, pointerY: 0, nodeX: 0, nodeY: 0 });
  const rafId = useRef<number | null>(null);

  // 调整尺寸状态
  const [size, setSize] = useState<{ w: number; h: number } | null>(
    () => (resizable && defaultSize ? { w: defaultSize.width, h: defaultSize.height } : null)
  );
  const resizeStart = useRef<{ px: number; py: number; w: number; h: number } | null>(null);
  const resizingRef = useRef(false);
  const resizeHandleRef = useRef<HTMLDivElement>(null);

  // position 变化（提交后）时同步拖拽基准位
  useEffect(() => {
    dragPos.current = { x: position.x, y: position.y };
  }, [position]);

  // 父级坐标变化（如撤销/恢复历史）时同步本地位置，避免节点内部拖拽状态与数据层脱节
  useEffect(() => {
    setPosition({ x: initialX, y: initialY });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialX, initialY]);

  // 上报节点实际尺寸（用于连线锚点计算）
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !onSizeChange) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // borderBoxSize 为元素自身坐标空间尺寸（不受画布 scale 影响），更精确
        const box = entry.borderBoxSize?.[0];
        if (box) {
          onSizeChange(id, box.inlineSize, box.blockSize);
        } else {
          // 老旧浏览器回退：contentRect 同样不受父级 transform 影响
          onSizeChange(id, entry.contentRect.width, entry.contentRect.height);
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [id, onSizeChange]);

  /** 将实时位置应用到 DOM（GPU 合成）并通知父级更新连线 */
  const applyTransform = useCallback(() => {
    rafId.current = null;
    const el = rootRef.current;
    if (!el) return;
    const { x, y } = dragPos.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    onDrag?.(id, x, y);
  }, [id, onDrag]);

  const startDrag = (pointerX: number, pointerY: number) => {
    draggingRef.current = true;
    dragStart.current = {
      pointerX,
      pointerY,
      nodeX: dragPos.current.x,
      nodeY: dragPos.current.y,
    };
    rootRef.current?.classList.add('node-dragging');
  };

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    rootRef.current?.classList.remove('node-dragging');
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    applyTransform();
    const { x, y } = dragPos.current;
    setPosition({ x, y });
    onPositionChange?.(id, x, y);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 仅响应主键（左键）：右键/中键留给画布菜单等交互，避免误触发拖拽
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // 命中右下角调整尺寸手柄 → 进入 resize 模式
    if (resizeHandleRef.current?.contains(target)) {
      if (!defaultSize || !size) return;
      e.stopPropagation(); // 防止画布拖拽
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      resizeStart.current = { px: e.clientX, py: e.clientY, w: size.w, h: size.h };
      resizingRef.current = true;
      return;
    }
    // 仅从头部拖拽；按钮/链接等可交互元素不触发
    if (!target.closest('.node-drag-handle')) return;
    if (target.closest('button, a, input, textarea, [contenteditable]')) return;
    e.stopPropagation(); // 防止画布拖拽
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointerDown.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // resize 分支
    if (resizingRef.current) {
      if (!resizeStart.current || !defaultSize) return;
      const dx = (e.clientX - resizeStart.current.px) / scale;
      const dy = (e.clientY - resizeStart.current.py) / scale;
      const newW = Math.max(defaultSize.width, Math.round(resizeStart.current.w + dx));
      const newH = Math.max(defaultSize.height, Math.round(resizeStart.current.h + dy));
      setSize({ w: newW, h: newH });
      return;
    }
    // 拖拽分支
    if (!pointerDown.current) return;
    const dx = e.clientX - pointerDown.current.x;
    const dy = e.clientY - pointerDown.current.y;
    if (!draggingRef.current) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      startDrag(pointerDown.current.x, pointerDown.current.y);
    }
    const nextX = dragStart.current.nodeX + (e.clientX - dragStart.current.pointerX) / scale;
    const nextY = dragStart.current.nodeY + (e.clientY - dragStart.current.pointerY) / scale;
    dragPos.current = { x: nextX, y: nextY };
    // rAF 合并：一帧最多应用一次
    if (rafId.current === null) {
      rafId.current = requestAnimationFrame(applyTransform);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    // 结束 resize
    if (resizingRef.current) {
      resizingRef.current = false;
      resizeStart.current = null;
      try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch { /* 忽略 */ }
      return;
    }
    if (!pointerDown.current) return;
    pointerDown.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      // 未捕获时忽略
    }
    endDrag();
  };

  // 卸载时清理未执行的 rAF
  useEffect(() => {
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, []);

  // 拖拽中若发生意外重渲染（如 SSE 流更新），用实时位置渲染避免回跳
  const shownPos = draggingRef.current ? dragPos.current : position;

  return (
    <div
      ref={rootRef}
      id={id}
      className={`absolute bg-node-bg border-dashed-grid border rounded-md shadow-sm flex flex-col pointer-events-auto ${className}`}
      style={{
        zIndex,
        width: size ? `${size.w}px` : undefined,
        height: size ? `${size.h}px` : undefined,
        minWidth: size ? `${defaultSize!.width}px` : '200px',
        minHeight: size ? `${defaultSize!.height}px` : undefined,
        transform: `translate3d(${shownPos.x}px, ${shownPos.y}px, 0)`,
      }}
      onPointerDownCapture={bringToFront}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onLostPointerCapture={() => {
        // 浏览器中途回收指针捕获（如切换标签页）时结束拖拽并提交当前位置，避免卡在拖拽态
        if (resizingRef.current) {
          resizingRef.current = false;
          resizeStart.current = null;
          return;
        }
        pointerDown.current = null;
        endDrag();
      }}
    >
      {/* 左右连接点 */}
      {showLeftAnchor && (
        <div className="absolute top-1/2 -left-[6px] w-3 h-3 bg-paper border-[1.5px] border-accent rounded-full -translate-y-1/2 z-30 shadow-sm" />
      )}
      {showRightAnchor && (
        <div className="absolute top-1/2 -right-[6px] w-3 h-3 bg-paper border-[1.5px] border-accent rounded-full -translate-y-1/2 z-30 shadow-sm" />
      )}

      {/* 根层级覆盖层，如光束动效 */}
      {glowOverlay}

      {/* 头部拖拽区 */}
      <div
        className="relative z-10 node-drag-handle h-8 bg-paper border-b border-dashed border-paper-grid flex items-center justify-between px-3 cursor-grab active:cursor-grabbing rounded-t-md select-none"
        style={{ touchAction: 'none' }}
      >
        <div className="flex gap-1.5 items-center min-w-0">
          <div 
            className={`w-2 h-2 rounded-full shrink-0 -translate-y-[0.5px] ${!dotColor ? 'bg-paper-hole' : ''}`} 
            style={dotColor ? { backgroundColor: dotColor } : undefined}
          />
          <span className="font-serif text-sm text-ink-light font-medium truncate">{title || 'Node'}</span>
          {groupBadge && (
            <span
              title={groupBadge}
              className="shrink-0 max-w-[100px] truncate text-[10px] text-ink-faint border border-dashed border-paper-grid rounded-pill px-1.5 py-px font-mono"
            >
              {groupBadge}
            </span>
          )}
          {mismatchBadge && (
            <span
              title={mismatchBadge}
              className="shrink-0 max-w-[140px] truncate text-[10px] text-error border border-error/30 bg-error/5 rounded-pill px-1.5 py-px font-mono"
            >
              {mismatchBadge}
            </span>
          )}
        </div>
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="text-ink-light hover:text-error transition-colors p-1"
          >
            ✕
          </button>
        )}
      </div>

      {/* 内容区 */}
      <div className="relative z-10 p-4 flex-1 overflow-y-auto overflow-x-hidden min-h-0 flex flex-col">
        {children}
      </div>

      {/* 边框外侧右下角操作按钮 */}
      {actionBar && (
        <div className="absolute -bottom-8 right-0 flex items-center gap-0.5 z-20">
          {actionBar}
        </div>
      )}

      {/* 边框外侧右侧插槽（「+ 添加子节点」按钮） */}
      {footer && (
        <div className="absolute top-1/2 -right-10 -translate-y-1/2 z-30">
          {footer}
        </div>
      )}

      {/* 右下角调整尺寸手柄 */}
      {resizable && defaultSize && (
        <div
          ref={resizeHandleRef}
          className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize z-30 flex items-end justify-end"
          style={{ touchAction: 'none' }}
        >
          <svg width="12" height="12" viewBox="0 0 10 10" className="text-ink-faint/70">
            <line x1="7" y1="10" x2="10" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="5" y1="10" x2="10" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
};

export default CanvasNode;
