import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { EdgeData, NodeData } from './graphTypes';
import type { ConnectionGhostHandle } from './ConnectionGhost';
import { matchPortType } from './nodeTypes';
import type { PortTypesLookup } from './execution';
import type { CanvasNodeType } from '../../platform/types';

/** 手动连线执行依赖（由画布注入：refs + 稳定 setter） */
export interface ManualConnectionContext {
  nodesRef: RefObject<NodeData[]>;
  edgesRef: RefObject<EdgeData[]>;
  portTypesRef: RefObject<PortTypesLookup>;
  setEdges: (edges: EdgeData[] | ((prev: EdgeData[]) => EdgeData[])) => void;
  recordHistory: () => void;
  showToast: (text: string, opts?: { type?: 'warning'; position?: 'top-right' }) => void;
}

export interface ManualConnection {
  /** 拖线进行中：连线源节点 id（null = 无拖线） */
  connecting: string | null;
  ghostRef: RefObject<ConnectionGhostHandle | null>;
  /** 输出锚点按下（由 CanvasNode 经 CanvasContext 调用） */
  onAnchorPointerDown: (nodeId: string, e: ReactPointerEvent) => void;
}

/**
 * 手动拖线连线：
 * 按住节点「右侧连接点（输出）」拖拽，松手落在目标节点「左侧连接点（输入）」上即创建连线。
 * 软校验（与「连线即输入」模型一致）：类型不匹配仍可连、渲染时标红；禁止自连 / 重复连线 / 成环。
 * 创建前记历史（可 Ctrl+Z 撤销）；Esc / 空白处松手取消。
 */
export function useManualConnection(ctx: ManualConnectionContext): ManualConnection {
  const { nodesRef, edgesRef, portTypesRef, setEdges, recordHistory, showToast } = ctx;
  const [connecting, setConnecting] = useState<string | null>(null);
  const ghostRef = useRef<ConnectionGhostHandle | null>(null);
  const sourceIdRef = useRef<string | null>(null);
  // 指针移动 rAF 合并：pointermove 可能以远超显示刷新率触发（高回报率鼠标），
  // 只取每帧最新坐标重绘一次幽灵线（与 CanvasNode/NodeEdge 的 rAF 模式一致）
  const moveRafRef = useRef<number | null>(null);
  const lastMoveRef = useRef<{ clientX: number; clientY: number }>({ clientX: 0, clientY: 0 });
  const pointerDownInfoRef = useRef<{ x: number; y: number; time: number } | null>(null);

  /** 新增 source→target 是否会在现有图中成环（target 沿出边可达 source） */
  const wouldCreateCycle = useCallback(
    (sourceId: string, targetId: string): boolean => {
      const visited = new Set<string>([targetId]);
      const queue = [targetId];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const e of edgesRef.current) {
          if (e.source !== cur || visited.has(e.target)) continue;
          if (e.target === sourceId) return true;
          visited.add(e.target);
          queue.push(e.target);
        }
      }
      return false;
    },
    [edgesRef]
  );

  /** 指针位置处的落点节点 id：优先左锚点，其次整张节点卡片（扩大命中区域）。
   *  卡片兜底仅当卡片内确实渲染了输入锚点才有效——无输入口的节点（如 book_info）不可作为落点。 */
  const hitTargetId = useCallback((clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const anchor = el?.closest('[data-anchor-input]') as HTMLElement | null;
    if (anchor?.dataset.anchorInput) return anchor.dataset.anchorInput;
    const card = el?.closest('[data-node-id]') as HTMLElement | null;
    if (card?.dataset.nodeId && card.querySelector('[data-anchor-input]')) {
      return card.dataset.nodeId;
    }
    return null;
  }, []);

  /** 源节点输出类型 × 目标节点输入类型是否匹配（unknown 视为匹配，避免误报） */
  const isCompatible = useCallback(
    (sourceId: string, targetId: string): boolean => {
      const source = nodesRef.current.find((n) => n.id === sourceId);
      const target = nodesRef.current.find((n) => n.id === targetId);
      if (!source || !target) return true;
      return (
        matchPortType(
          portTypesRef.current(source.type as CanvasNodeType).output,
          portTypesRef.current(target.type as CanvasNodeType).inputs
        ) !== 'mismatch'
      );
    },
    [nodesRef, portTypesRef]
  );

  /** 结束拖线：检测落点并创建连线；无效落点静默取消 */
  const finishConnection = useCallback(
    (clientX: number, clientY: number) => {
      const sourceId = sourceIdRef.current;
      sourceIdRef.current = null;
      setConnecting(null);
      if (!sourceId) return;

      const targetId = hitTargetId(clientX, clientY);
      if (!targetId || targetId === sourceId) return;

      // 防重复：同一 source→target 已连线
      if (edgesRef.current.some((e) => e.source === sourceId && e.target === targetId)) {
        showToast('这两个节点已存在连线', { type: 'warning', position: 'top-right' });
        return;
      }
      // 防环：新增连线会让 target 能回到 source
      if (wouldCreateCycle(sourceId, targetId)) {
        showToast('该连线会形成循环，已忽略', { type: 'warning', position: 'top-right' });
        return;
      }

      recordHistory();
      const newEdge: EdgeData = {
        id: `edge-${sourceId}-${targetId}-${Date.now()}`,
        source: sourceId,
        target: targetId,
      };
      // 先同步 refs 再 setState（与 addChildNode 一致）：快速连续连线时防重/防环检查读到最新图
      edgesRef.current = [...edgesRef.current, newEdge];
      setEdges(edgesRef.current);
    },
    [hitTargetId, edgesRef, setEdges, recordHistory, showToast, wouldCreateCycle]
  );

  /** 每帧最多执行一次：读取最新坐标做落点检测 + 类型匹配 + 幽灵线重绘 */
  const paintOncePerFrame = useCallback(() => {
    moveRafRef.current = null;
    const { clientX, clientY } = lastMoveRef.current;
    const sourceId = sourceIdRef.current;
    // 实时类型匹配着色：悬停到有效落点才判定，未悬停 / 悬停到源节点自身保持未判定色
    let compatible: boolean | undefined;
    if (sourceId) {
      const targetId = hitTargetId(clientX, clientY);
      if (targetId && targetId !== sourceId) compatible = isCompatible(sourceId, targetId);
    }
    ghostRef.current?.setEnd(clientX, clientY, compatible);
  }, [hitTargetId, isCompatible]);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      lastMoveRef.current = { clientX: e.clientX, clientY: e.clientY };
      if (moveRafRef.current === null) {
        moveRafRef.current = requestAnimationFrame(paintOncePerFrame);
      }
    },
    [paintOncePerFrame]
  );

  // 统一的拖线清理（由各事件处理器在结束时调用）。
  // 各 handler 相互引用构成循环依赖，故经 ref 持有：仅在事件回调中调用，不参与 React 依赖分析。
  const teardownRef = useRef<() => void>(() => {});
  teardownRef.current = () => {
    if (moveRafRef.current !== null) {
      cancelAnimationFrame(moveRafRef.current);
      moveRafRef.current = null;
    }
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerCancel);
    window.removeEventListener('keydown', handleKeyDown);
    document.body.classList.remove('is-connecting');
    sourceIdRef.current = null;
    setConnecting(null);
  };

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      const sourceId = sourceIdRef.current;
      if (sourceId) {
        const downInfo = pointerDownInfoRef.current;
        if (downInfo) {
          const dx = e.clientX - downInfo.x;
          const dy = e.clientY - downInfo.y;
          const distSq = dx * dx + dy * dy;
          const timeDelta = Date.now() - downInfo.time;
          
          // If it's a quick click on the source (no target or same as source), enter sticky mode
          const targetId = hitTargetId(e.clientX, e.clientY);
          if ((!targetId || targetId === sourceId) && timeDelta < 300 && distSq < 25) {
            pointerDownInfoRef.current = null; // Clear to prevent sticky mode on subsequent clicks
            return;
          }
        }
        finishConnection(e.clientX, e.clientY);
      }
      teardownRef.current();
    },
    [finishConnection, hitTargetId]
  );

  const handlePointerCancel = useCallback(() => {
    teardownRef.current();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') teardownRef.current();
    },
    []
  );

  const onAnchorPointerDown = useCallback(
    (nodeId: string, e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      if (sourceIdRef.current) {
        // Sticky mode: clicked another anchor while connecting
        finishConnection(e.clientX, e.clientY);
        teardownRef.current();
        return;
      }
      e.preventDefault(); // 阻止原生拖拽 / 文本选择
      sourceIdRef.current = nodeId;
      pointerDownInfoRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
      ghostRef.current?.setEnd(e.clientX, e.clientY);
      document.body.classList.add('is-connecting');
      setConnecting(nodeId);
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerCancel);
      window.addEventListener('keydown', handleKeyDown);
    },
    [finishConnection, handlePointerMove, handlePointerUp, handlePointerCancel, handleKeyDown]
  );

  // 卸载清理：移除监听、取消未执行的 rAF 并复位
  useEffect(() => {
    return () => {
      if (moveRafRef.current !== null) cancelAnimationFrame(moveRafRef.current);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('is-connecting');
    };
  }, [handlePointerMove, handlePointerUp, handlePointerCancel, handleKeyDown]);

  return { connecting, ghostRef, onAnchorPointerDown };
}
