import { useState, useEffect, useCallback, useRef } from 'react';

interface CanvasSnapshot<N, E, S> {
  nodes: N[];
  edges: E[];
  nodeSizes: Record<string, S>;
  generationIds: Record<string, number>;
  favoritedState: Record<string, boolean>;
  publishedState: Record<string, boolean>;
  scale: number;
  position: { x: number; y: number };
}

function getStorageKey(userId: string): string {
  return `bf-canvas-${userId}`;
}

function readSnapshot<N, E, S>(userId: string): CanvasSnapshot<N, E, S> | null {
  try {
    const raw = sessionStorage.getItem(getStorageKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSnapshot<N, E, S>(userId: string, data: CanvasSnapshot<N, E, S>) {
  try {
    sessionStorage.setItem(getStorageKey(userId), JSON.stringify(data));
  } catch {
    /* storage full or unavailable */
  }
}

function clearSnapshot(userId: string) {
  try {
    sessionStorage.removeItem(getStorageKey(userId));
  } catch {
    /* ignore */
  }
}

/** 只读：读取某用户画布快照中的 图片节点 → 历史记录 id 映射（无快照/解析失败返回空对象）。
 *  供画布外的页面（如历史列表删除时）检测某条记录是否仍被画布节点引用。 */
export function getCanvasGenerationIds(userId: string): Record<string, number> {
  const snapshot = readSnapshot<any, any, any>(userId);
  return snapshot?.generationIds ?? {};
}

/** 跨 tab 事件 key：history 等页面删除记录后写入，画布 tab 监听 storage 事件实时感知。
 *  注意必须用 localStorage：sessionStorage 按 tab 隔离，其 storage 事件不会在「其他 tab」触发；
 *  而 localStorage 的 storage 事件天然只在其他 tab 触发，与「同 tab SPA 路由切换走挂载同步」正好互补。 */
export function getCanvasEventKey(userId: string): string {
  return `bf-canvas-event-${userId}`;
}

/** 跨 tab 事件负载：写入 localStorage 的 JSON */
export interface CanvasDeleteEvent {
  genId: number;
  ts: number;
}

/** 广播「某条历史记录被删除」：其他打开的画布 tab 会收到并清理失效映射。
 *  只写入事件通知（含时间戳，保证同一 genId 连续删除也触发 storage 事件），
 *  不涉及画布数据本体（画布数据仍存 sessionStorage）。 */
export function broadcastGenerationDeleted(userId: string, genId: number): void {
  try {
    const payload: CanvasDeleteEvent = { genId, ts: Date.now() };
    localStorage.setItem(getCanvasEventKey(userId), JSON.stringify(payload));
  } catch {
    /* storage full or unavailable */
  }
}

export function useCanvasState<N = any, E = any, S = any>(userId: string) {
  const saved = readSnapshot<N, E, S>(userId);

  const [nodes, setNodes] = useState<N[]>(() => saved?.nodes ?? []);
  const [edges, setEdges] = useState<E[]>(() => saved?.edges ?? []);
  const [nodeSizes, setNodeSizes] = useState<Record<string, S>>(() => saved?.nodeSizes ?? {});
  const [favoritedState, setFavoritedState] = useState<Record<string, boolean>>(() => saved?.favoritedState ?? {});
  const [publishedState, setPublishedState] = useState<Record<string, boolean>>(() => saved?.publishedState ?? {});
  const [scale, setScale] = useState<number>(() => saved?.scale ?? 1);
  const [position, setPosition] = useState<{ x: number; y: number }>(() => saved?.position ?? { x: 0, y: 0 });

  const generationIds = useRef<Record<string, number>>(saved?.generationIds ?? {});

  const userIdRef = useRef(userId);

  useEffect(() => {
    if (userIdRef.current === userId) return;
    userIdRef.current = userId;
    const snapshot = readSnapshot<N, E, S>(userId);
    setNodes(snapshot?.nodes ?? []);
    setEdges(snapshot?.edges ?? []);
    setNodeSizes(snapshot?.nodeSizes ?? {});
    setFavoritedState(snapshot?.favoritedState ?? {});
    setPublishedState(snapshot?.publishedState ?? {});
    setScale(snapshot?.scale ?? 1);
    setPosition(snapshot?.position ?? { x: 0, y: 0 });
    generationIds.current = snapshot?.generationIds ?? {};
  }, [userId]);

  useEffect(() => {
    if (nodes.length === 0) return;
    writeSnapshot(userId, {
      nodes,
      edges,
      nodeSizes,
      generationIds: generationIds.current,
      favoritedState,
      publishedState,
      scale,
      position,
    });
  }, [nodes, edges, nodeSizes, favoritedState, publishedState, scale, position, userId]);

  const clearCanvasState = useCallback(() => {
    generationIds.current = {};
    clearSnapshot(userId);
  }, [userId]);

  return {
    nodes, setNodes,
    edges, setEdges,
    nodeSizes, setNodeSizes,
    favoritedState, setFavoritedState,
    publishedState, setPublishedState,
    scale, setScale,
    position, setPosition,
    generationIds,
    clearCanvasState,
  };
}