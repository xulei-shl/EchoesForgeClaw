import { useCallback, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { HISTORY_LIMIT, type EdgeData, type HistorySnapshot, type NodeData } from './graphTypes';

/** 撤销/重做依赖（由画布注入：refs + 稳定 setter） */
export interface CanvasHistoryContext {
  nodesRef: RefObject<NodeData[]>;
  edgesRef: RefObject<EdgeData[]>;
  generationIds: RefObject<Record<string, number>>;
  streamControllers: RefObject<Map<string, AbortController>>;
  setNodes: Dispatch<SetStateAction<NodeData[]>>;
  setEdges: Dispatch<SetStateAction<EdgeData[]>>;
  setSelectedImageId: Dispatch<SetStateAction<string | null>>;
  setStaleRecordIds: Dispatch<SetStateAction<Set<string>>>;
  /** 撤销删除/清空后节点集变大时重新同步收藏/公开状态 */
  syncFavoritesFromServer: () => Promise<void>;
}

export interface CanvasHistory {
  undo: () => void;
  redo: () => void;
  recordHistory: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/** 内存撤销/重做栈：记录结构/内容/位置变更（节点数据含坐标）。 */
export function useCanvasHistory(ctx: CanvasHistoryContext): CanvasHistory {
  const historyStack = useRef<HistorySnapshot[]>([]);
  const redoStack = useRef<HistorySnapshot[]>([]);
  const [, setHistoryVersion] = useState(0);

  const captureSnapshot = useCallback(
    (): HistorySnapshot => ({
      nodes: ctx.nodesRef.current,
      edges: ctx.edgesRef.current,
      generationIds: { ...ctx.generationIds.current },
    }),
    []
  );

  /** 记录一步历史（在任何结构性/内容/位置变更前调用），并清空重做栈 */
  const recordHistory = useCallback(() => {
    historyStack.current.push(captureSnapshot());
    if (historyStack.current.length > HISTORY_LIMIT) historyStack.current.shift();
    redoStack.current = [];
    setHistoryVersion((v) => v + 1);
  }, [captureSnapshot]);

  /** 恢复快照：中止「恢复后不应再生成/已移除」节点的请求，清理失效选中态，自愈无流可依的生成态 */
  const applySnapshot = useCallback((snapshot: HistorySnapshot) => {
    const restoredMap = new Map(snapshot.nodes.map((n) => [n.id, n]));
    // 1. 中止「恢复后不再生成」或「已不在画布」节点的进行中请求（防止流写回已回退状态）
    for (const [nid, controller] of [...ctx.streamControllers.current]) {
      const restored = restoredMap.get(nid);
      if (!restored || !restored.data?.isGenerating) {
        controller.abort();
        ctx.streamControllers.current.delete(nid);
      }
    }
    ctx.generationIds.current = { ...snapshot.generationIds };
    ctx.setNodes(snapshot.nodes);
    ctx.setEdges(snapshot.edges);
    // 2. 选中节点若已不在恢复后的画布中则清除
    ctx.setSelectedImageId((prev) => (prev && !restoredMap.has(prev) ? null : prev));
    // 3. 自愈：恢复后标记为生成中但无活动流的节点（清空/中断场景），复位为失败态，避免永久加载
    ctx.setNodes((prev) =>
      prev.map((n) =>
        n.data?.isGenerating && !ctx.streamControllers.current.has(n.id)
          ? { ...n, data: { ...n.data, isGenerating: false, error: n.data?.error ?? '生成已中断，请重试' } }
          : n
      )
    );
    // 4. 撤销删除/清空后节点集变大：被删节点已清除的收藏/公开状态需从服务端重新同步；
    //    同时清空「记录已删除」弱提示标记，让同步重新校验（快照恢复的映射可能又有效）
    if (snapshot.nodes.length > ctx.nodesRef.current.length) {
      ctx.setStaleRecordIds(new Set());
      void ctx.syncFavoritesFromServer();
    }
  }, []);

  const undo = useCallback(() => {
    const snapshot = historyStack.current.pop();
    if (!snapshot) return;
    redoStack.current.push(captureSnapshot());
    applySnapshot(snapshot);
    setHistoryVersion((v) => v + 1);
  }, [applySnapshot, captureSnapshot]);

  const redo = useCallback(() => {
    const snapshot = redoStack.current.pop();
    if (!snapshot) return;
    historyStack.current.push(captureSnapshot());
    applySnapshot(snapshot);
    setHistoryVersion((v) => v + 1);
  }, [applySnapshot, captureSnapshot]);

  return {
    undo,
    redo,
    recordHistory,
    canUndo: historyStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}
