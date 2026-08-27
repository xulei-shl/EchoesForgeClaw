import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { NodeEdgeHandle } from '../../platform/components/node/NodeEdge';
import type { NodeData } from './graphTypes';

/** 整体拖动的单个成员：起始坐标 + 实时 DOM 引用 */
interface DragMember {
  id: string;
  startX: number;
  startY: number;
  el: HTMLElement | null;
}

interface GroupDragDeps {
  nodesRef: { current: NodeData[] };
  edgesRef: { current: any[] };
  /** 连线命令式句柄（id → setPositions），与画布 edgeRefs 同源 */
  edgeHandlesRef: RefObject<Map<string, NodeEdgeHandle>>;
  setNodes: Dispatch<SetStateAction<NodeData[]>>;
  recordHistory: () => void;
}

/**
 * 分组标题拖动协调器：按住组标题整体移动组内全部成员。
 * 与 CanvasNode 拖拽同一套性能策略：rAF 命令式更新成员 DOM + 相关连线，松手时
 * 一次 recordHistory + 批量 setNodes（一条撤销记录，React 渲染开销仅一次）。
 */
export function useGroupDrag({ nodesRef, edgesRef, edgeHandlesRef, setNodes, recordHistory }: GroupDragDeps) {
  const dragging = useRef(false);
  const pointerStart = useRef({ x: 0, y: 0 });
  const lastDelta = useRef({ x: 0, y: 0 });
  const members = useRef<DragMember[]>([]);
  const rafId = useRef<number | null>(null);

  const applyFrame = useCallback(() => {
    rafId.current = null;
    const { x: dx, y: dy } = lastDelta.current;
    const changed: Array<{ id: string; x: number; y: number }> = [];
    for (const m of members.current) {
      if (!m.el) continue;
      m.el.style.transform = `translate3d(${m.startX + dx}px, ${m.startY + dy}px, 0)`;
      changed.push({ id: m.id, x: m.startX + dx, y: m.startY + dy });
    }
    // 批量重绘两端涉及移动成员的连线（其余保持不动）
    const moved = new Map(changed.map((m) => [m.id, m]));
    if (moved.size === 0) return;
    for (const edge of edgesRef.current) {
      const a = moved.get(edge.source);
      const b = moved.get(edge.target);
      if (!a && !b) continue;
      const handle = edgeHandlesRef.current.get(edge.id);
      if (!handle) continue;
      const source = nodesRef.current.find((n) => n.id === edge.source);
      const target = nodesRef.current.find((n) => n.id === edge.target);
      if (!source || !target) continue;
      handle.setPositions(
        a ? a.x : source.x,
        a ? a.y : source.y,
        b ? b.x : target.x,
        b ? b.y : target.y
      );
    }
  }, [edgeHandlesRef, edgesRef, nodesRef]);

  /** 标题 onPointerDown 入口：捕获指针并解析成员（组内全部节点） */
  const beginGroupDrag = useCallback(
    (e: ReactPointerEvent, groupMemberIds: string[]) => {
      if (e.button !== 0) return;
      const els: DragMember[] = [];
      for (const mid of groupMemberIds) {
        const node = nodesRef.current.find((n) => n.id === mid);
        if (!node) continue;
        els.push({ id: mid, startX: node.x, startY: node.y, el: document.getElementById(mid) });
      }
      if (els.length === 0) return;
      dragging.current = true;
      members.current = els;
      pointerStart.current = { x: e.clientX, y: e.clientY };
      lastDelta.current = { x: 0, y: 0 };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        /* 忽略指针捕获失败 */
      }
    },
    [nodesRef]
  );

  /** 提交：一次历史 + 批量位置更新（React 渲染仅一次） */
  const commit = useCallback(() => {
    const { x: dx, y: dy } = lastDelta.current;
    const starts = members.current;
    members.current = [];
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return; // 单击标题：无位移不记历史
    recordHistory();
    const moved = new Map(starts.map((m) => [m.id, { x: m.startX + dx, y: m.startY + dy }]));
    setNodes((prev) => prev.map((n) => (moved.has(n.id) ? { ...n, ...moved.get(n.id)! } : n)));
  }, [recordHistory, setNodes]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    lastDelta.current = { x: e.clientX - pointerStart.current.x, y: e.clientY - pointerStart.current.y };
    if (rafId.current === null) {
      rafId.current = requestAnimationFrame(applyFrame);
    }
  }, [applyFrame]);

  const handlePointerUp = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    try {
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* 忽略释放捕获失败 */
    }
    commit();
  }, [commit]);

  // window 级监听：标题 chip 面积小，捕获期间事件仍会派发到 window，统一处理避免中断
  useEffect(() => {
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, [handlePointerMove, handlePointerUp]);

  return { beginGroupDrag };
}
