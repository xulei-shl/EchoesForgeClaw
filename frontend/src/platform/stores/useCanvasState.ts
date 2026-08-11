import { useSyncExternalStore, type SetStateAction } from 'react';

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

// ============================================================
// 模块级画布执行状态（组件卸载后仍存活）
//
// 动机：画布页（BookplatePage）在 SPA 路由切换时会卸载，但进行中的 SSE / 长请求不会随组件
// 卸载停止。若执行状态（流控制器、节点数据）只存在于组件内，流完成时的状态回写会被 React
// 静默丢弃，而历史记录的保存（纯 axios 调用）仍会成功——产生「历史已有记录、画布节点却卡死」
// 的割裂。因此把执行状态提升到模块级单例：切页后流继续在后台运行，完成时直接写入 store +
// sessionStorage；返回画布时组件重新订阅即可看到结果，不浪费已运行的生成，也不产生孤儿记录。
// 整页刷新（F5）时浏览器销毁页面上下文、模块重新求值，由挂载自愈兜底复位。
// ============================================================

/** 进行中的流控制器（按节点 id）。模块级：切页不中止；挂载自愈据此识别「仍有活动流的节点」不清除 */
export const streamControllers: { current: Map<string, AbortController> } = { current: new Map() };
/** 图片分析节点内直接上传的参考图（内存快照，随流存活，切页不丢） */
export const analysisUploads: { current: Map<string, string> } = { current: new Map() };
/** 节点 / 连线最新引用（store 每次变更同步），供执行引擎 / 历史组装在任意时刻读取最新值（含组件卸载期间） */
export const nodesRef: { current: any[] } = { current: [] };
export const edgesRef: { current: any[] } = { current: [] };
/** 图片节点 → 历史记录 id 映射（唯一事实源；执行路径原位变更、撤销恢复路径整体替换，persist 时动态读取） */
export const generationIdsRef: { current: Record<string, number> } = { current: {} };

interface CanvasState {
  nodes: any[];
  edges: any[];
  nodeSizes: Record<string, any>;
  favoritedState: Record<string, boolean>;
  publishedState: Record<string, boolean>;
  scale: number;
  position: { x: number; y: number };
}

const emptyState = (): CanvasState => ({
  nodes: [],
  edges: [],
  nodeSizes: {},
  favoritedState: {},
  publishedState: {},
  scale: 1,
  position: { x: 0, y: 0 },
});

let state: CanvasState = emptyState();
let currentUserId: string | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

const getState = () => state;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const emit = () => {
  for (const l of listeners) l();
};

/** 持久化当前快照（空画布不写入：与「清空后移除快照」的语义一致） */
function persist() {
  if (currentUserId == null || state.nodes.length === 0) return;
  writeSnapshot(currentUserId, {
    nodes: state.nodes,
    edges: state.edges,
    nodeSizes: state.nodeSizes,
    generationIds: generationIdsRef.current,
    favoritedState: state.favoritedState,
    publishedState: state.publishedState,
    scale: state.scale,
    position: state.position,
  });
}

/** 应用变更：更新状态对象 + 同步模块 refs + 持久化 + 通知订阅者（与 React setState 等效） */
function apply(patch: Partial<CanvasState>) {
  state = { ...state, ...patch };
  nodesRef.current = state.nodes;
  edgesRef.current = state.edges;
  persist();
  emit();
}

/** 按用户加载快照（幂等）：同一用户已处于在线状态时保留，避免覆盖进行中的生成 */
function ensureHydrated(userId: string) {
  if (currentUserId === userId && hydrated) return;
  const saved = readSnapshot<any, any, any>(userId);
  state = {
    ...emptyState(),
    nodes: saved?.nodes ?? [],
    edges: saved?.edges ?? [],
    nodeSizes: saved?.nodeSizes ?? {},
    favoritedState: saved?.favoritedState ?? {},
    publishedState: saved?.publishedState ?? {},
    scale: saved?.scale ?? 1,
    position: saved?.position ?? { x: 0, y: 0 },
  };
  generationIdsRef.current = saved?.generationIds ?? {};
  currentUserId = userId;
  hydrated = true;
  nodesRef.current = state.nodes;
  edgesRef.current = state.edges;
}

// setter 与 React setState 同签名（直接值或函数式更新），供组件与执行引擎共用；
// 为稳定模块函数，可安全注入执行引擎（流回调在组件卸载后依然有效）。
// 注意参数用 SetStateAction 而非 any：any 参数不会为回调参数提供上下文类型，会触发隐式 any 报错
const setNodes = (updater: SetStateAction<any[]>) =>
  apply({ nodes: typeof updater === 'function' ? updater(state.nodes) : updater });
const setEdges = (updater: SetStateAction<any[]>) =>
  apply({ edges: typeof updater === 'function' ? updater(state.edges) : updater });
const setNodeSizes = (updater: SetStateAction<Record<string, any>>) =>
  apply({ nodeSizes: typeof updater === 'function' ? updater(state.nodeSizes) : updater });
const setFavoritedState = (updater: SetStateAction<Record<string, boolean>>) =>
  apply({ favoritedState: typeof updater === 'function' ? updater(state.favoritedState) : updater });
const setPublishedState = (updater: SetStateAction<Record<string, boolean>>) =>
  apply({ publishedState: typeof updater === 'function' ? updater(state.publishedState) : updater });
const setScale = (updater: SetStateAction<number>) =>
  apply({ scale: typeof updater === 'function' ? updater(state.scale) : updater });
const setPosition = (updater: SetStateAction<{ x: number; y: number }>) =>
  apply({ position: typeof updater === 'function' ? updater(state.position) : updater });

/** 清空画布：重置 store（保留视口）并移除持久化快照 */
function clearCanvasState() {
  generationIdsRef.current = {};
  clearSnapshot(currentUserId ?? '');
  apply({ nodes: [], edges: [], nodeSizes: {}, favoritedState: {}, publishedState: {} });
}

/** 立即持久化当前快照：用于 generationIds 映射等「非 apply 路径」的原位变更后强制落盘，
 *  避免后台完成 / 刷新后映射丢失导致重复保存记录 */
export function flushSnapshot() {
  persist();
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

/** 画布状态 Hook：订阅模块级 store（组件卸载时 store 保留，重挂载直接续用进行中的状态）。
 *  返回的 setter / generationIds 均为模块级稳定引用，注入执行引擎后流回调在组件卸载期间依然有效。 */
export function useCanvasState<N = any, E = any, S = any>(userId: string) {
  ensureHydrated(userId);
  useSyncExternalStore(subscribe, getState, getState);

  return {
    nodes: state.nodes as N[],
    setNodes,
    edges: state.edges as E[],
    setEdges,
    nodeSizes: state.nodeSizes as Record<string, S>,
    setNodeSizes,
    favoritedState: state.favoritedState,
    setFavoritedState,
    publishedState: state.publishedState,
    setPublishedState,
    scale: state.scale,
    setScale,
    position: state.position,
    setPosition,
    generationIds: generationIdsRef,
    clearCanvasState,
  };
}
