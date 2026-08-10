import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useCanvasState,
  getCanvasEventKey,
  type CanvasDeleteEvent,
} from '../../platform/stores/useCanvasState';
import { useAuth } from '../../platform/stores/authStore';
import { Navbar } from '../../platform/components/layout/Navbar';
import { Canvas } from '../../platform/components/canvas/Canvas';
import { IsbnInput } from '../../modules/bookplate/components/IsbnInput';
import { BookInfoNode } from '../../modules/bookplate/components/BookInfoNode';
import { ImageAnalysisNode } from '../../modules/bookplate/components/ImageAnalysisNode';
import { PromptNode } from '../../modules/bookplate/components/PromptNode';
import { ImageNode } from '../../modules/bookplate/components/ImageNode';
import { CanvasActionBar } from '../../modules/bookplate/components/CanvasActionBar';
import { AddNodeButton, type NodePickerItem } from '../../modules/bookplate/components/AddNodeButton';
import NodeContextMenu from '../../modules/bookplate/components/NodeContextMenu';
import EmptyCanvasHint from '../../modules/bookplate/components/EmptyCanvasHint';
import { NODE_SIZES, getBookInfoPosition, getBranchNodePosition, computeAutoLayout, computeFitViewport } from '../../modules/bookplate/nodeLayout';
import { NODE_TEMPLATES, getNodeTitle } from '../../modules/bookplate/nodeTypes';
import {
  ISBN_FETCH_TIMEOUT_MS,
  PROMPT_SSE_IDLE_TIMEOUT_MS,
  IMAGE_GENERATION_TIMEOUT_MS,
} from '../../platform/utils/timeouts';
import { NodeEdge, type NodeEdgeHandle } from '../../platform/components/node/NodeEdge';
import { useFeedback } from '../../platform/components/ui/FeedbackProvider';
import { postSSEStream } from '../../platform/services/sse';
import api from '../../platform/services/api';
import generationsService from '../../platform/services/generations';
import type { CanvasNodeType, GenerationStageResults, NodeRegistry, RegistryNodeConfig } from '../../platform/types';

type NodeType = CanvasNodeType;

interface NodeData {
  id: string;
  type: NodeType;
  /** 绑定的节点配置 id（节点变体）；未绑定则使用默认配置（环境变量） */
  configId?: number;
  /** 节点变体名称（标题展示用） */
  configName?: string;
  x: number;
  y: number;
  data: any;
}

interface EdgeData {
  id: string;
  source: string;
  target: string;
}

interface NodeSize {
  width: number;
  height: number;
}

/** 撤销/重做历史栈深度上限 */
const HISTORY_LIMIT = 50;

/** 撤销/重做快照：结构/内容/位置（节点数据含坐标）。
 *  不含视口、节点尺寸与收藏/公开等服务端状态（避免与服务端 API 状态打架）。 */
interface HistorySnapshot {
  nodes: NodeData[];
  edges: EdgeData[];
  generationIds: Record<string, number>;
}

// 连线锚点默认尺寸（ResizeObserver 上报前使用），与各组件 defaultSize 保持一致
const DEFAULT_SIZES: Record<NodeType, NodeSize> = NODE_SIZES;

// 进行中的豆瓣查询节点 id，防止快速连点/重试时并发响应互相覆盖
const bookInfoInflight = new Set<string>();

const BookplatePage: React.FC = () => {
  const { user } = useAuth();
  const {
    nodes, setNodes,
    edges, setEdges,
    nodeSizes, setNodeSizes,
    favoritedState, setFavoritedState,
    publishedState, setPublishedState,
    scale, setScale,
    position, setPosition,
    generationIds,
    clearCanvasState,
  } = useCanvasState<NodeData, EdgeData, NodeSize>(String(user?.id ?? 'anon'));

  const [isLoading, setIsLoading] = useState(false);
  const nodeSizesRef = useRef(nodeSizes);
  nodeSizesRef.current = nodeSizes;

  // 节点注册表：模板 + 已配置节点变体（驱动「+」菜单与 per-node 执行模式）
  const [registry, setRegistry] = useState<NodeRegistry>({ templates: [], configs: [] });
  const refreshRegistry = useCallback(() => {
    api
      .get<NodeRegistry, NodeRegistry>('/modules/bookplate/node-registry')
      .then(setRegistry)
      .catch((e) => console.error('获取节点注册表失败:', e));
  }, []);
  useEffect(() => {
    refreshRegistry();
  }, [refreshRegistry]);
  // 节点配置可能在管理页（其他 tab）被修改（分组/名称/启用/排序）：切回本 tab 时刷新注册表，
  // 让「+」菜单与节点分组标签保持最新，无需手动刷新页面
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshRegistry();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refreshRegistry]);
  const registryConfigs = registry.configs;
  const registryConfigsRef = useRef<RegistryNodeConfig[]>(registryConfigs);
  registryConfigsRef.current = registryConfigs;

  // 全局操作栏（收藏/公开/导出）的作用目标：点击 ImageNode 选中；未选中时回退到最近生成的图片节点
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);

  // 历史记录已被删除（404 或跨 tab 广播）的图片节点 id 集合：ImageNode 据此显示「记录已删除」弱提示，
  // 用户对其收藏/公开（重新生成记录）后移除
  const [staleRecordIds, setStaleRecordIds] = useState<Set<string>>(new Set());

  // 视口 refs：自动聚焦与可见性判断读取当前最新值（稳定回调闭包不会过期）
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const positionRef = useRef(position);
  positionRef.current = position;

  // 节点右键菜单状态（视口坐标 + 目标节点）
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);

  // 操作栏作用目标：优先选中且已有图片的 ImageNode，否则回退到最近生成的图片节点
  const selectedImageNode =
    selectedImageId &&
    nodes.some((n) => n.id === selectedImageId && n.type === 'image_generation' && n.data?.imageUrl)
      ? nodes.find((n) => n.id === selectedImageId)
      : undefined;
  const activeImage = selectedImageNode ?? nodes.filter((n) => n.type === 'image_generation' && n.data?.imageUrl).pop();

  // 收藏/公开状态的实时快照：稳定回调（memo 优化）在闭包中读取时始终拿到最新值
  const favoritedRef = useRef(favoritedState);
  favoritedRef.current = favoritedState;
  const publishedRef = useRef(publishedState);
  publishedRef.current = publishedState;
  // 收藏/公开的进行中标记，防止快速连点导致状态回读竞态
  const busyFav = useRef<Set<string>>(new Set());
  const busyPub = useRef<Set<string>>(new Set());
  // 级联删除确认框防抖：防止快速连点堆叠多个对话框
  const removingRef = useRef(false);
  const { dialog, showToast } = useFeedback();
  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + 0.2, 3));
  }, []);
  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - 0.2, 0.1));
  }, []);
  const handleFocus = useCallback(() => {
    setPosition({ x: 0, y: 0 });
    setScale(1);
  }, []);

  /** 失效一条图片节点与其历史记录的关联：清除 generationIds 映射、复位收藏/公开按钮、标记「记录已删除」。
   *  节点本身与图片文件保留（只移除「记录」这条链接），之后收藏/公开会自动新建记录。 */
  const invalidateGenerationLink = useCallback((nodeId: string) => {
    delete generationIds.current[nodeId];
    setFavoritedState((prev) => ({ ...prev, [nodeId]: false }));
    setPublishedState((prev) => ({ ...prev, [nodeId]: false }));
    setStaleRecordIds((prev) => {
      if (prev.has(nodeId)) return prev;
      const next = new Set(prev);
      next.add(nodeId);
      return next;
    });
  }, []);

  /** 从服务端同步各图片节点的收藏/公开状态（挂载与撤销恢复后调用）：
   *  历史/收藏/画廊页可能已对该节点对应的 generation 变更过收藏/公开，画板需以服务端为准刷新按钮。
   *  顺带校验 generationIds 映射的有效性：记录已被删除（404）的节点，失效其关联（见 invalidateGenerationLink）。 */
  const syncFavoritesFromServer = useCallback(async () => {
    const entries = Object.entries(generationIds.current);
    if (entries.length === 0) return;
    try {
      const results = await Promise.allSettled(
        entries.map(([, genId]) => generationsService.get(genId))
      );
      const favPatch: Record<string, boolean> = {};
      const pubPatch: Record<string, boolean> = {};
      entries.forEach(([nodeId], i) => {
        const r = results[i];
        if (r.status === 'rejected') {
          // 记录已被删除（404）：清除映射，节点保留（图片文件不受影响）
          if ((r.reason as any)?.status === 404) invalidateGenerationLink(nodeId);
          return;
        }
        const g = r.value;
        if (!g) return;
        favPatch[nodeId] = !!g.is_favorited;
        pubPatch[nodeId] = !!g.is_public;
      });
      setFavoritedState((prev) => ({ ...prev, ...favPatch }));
      setPublishedState((prev) => ({ ...prev, ...pubPatch }));
    } catch (e) {
      console.error('同步画板收藏/公开状态失败:', e);
    }
  }, [invalidateGenerationLink]);

  useEffect(() => {
    void syncFavoritesFromServer();
  }, [syncFavoritesFromServer]);

  // 跨 tab 联动：history/收藏/画廊页在**其他 tab**删除记录后写入事件 key，本 tab 的 storage 事件实时感知，
  // 立即失效对应节点关联（无需刷新）。同 tab 内 SPA 路由切换走上面的挂载同步，二者互补。
  useEffect(() => {
    const eventKey = getCanvasEventKey(String(user?.id ?? 'anon'));
    const onStorage = (e: StorageEvent) => {
      if (e.key !== eventKey || !e.newValue) return;
      try {
        const payload: CanvasDeleteEvent = JSON.parse(e.newValue);
        if (typeof payload?.genId !== 'number') return;
        // 找到引用该记录的图片节点并逐一失效
        for (const [nodeId, genId] of Object.entries(generationIds.current)) {
          if (genId === payload.genId) invalidateGenerationLink(nodeId);
        }
      } catch {
        /* 负载损坏，忽略 */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user?.id, invalidateGenerationLink]);

  // 记录进行中的 SSE 请求，节点被删除时中止
  const streamControllers = useRef<Map<string, AbortController>>(new Map());
  // 图片分析节点本次会话上传的参考图（base64 data URL，仅存内存，重试复用）
  const analysisUploads = useRef<Map<string, string>>(new Map());

  const handleSizeChange = useCallback((id: string, width: number, height: number) => {
    setNodeSizes((prev) => {
      const cur = prev[id];
      if (cur && Math.abs(cur.width - width) < 1 && Math.abs(cur.height - height) < 1) {
        return prev;
      }
      return { ...prev, [id]: { width, height } };
    });
  }, []);

  const updateNodeData = (id: string, patch: Record<string, any>) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  };

  /** 生成唯一节点 id（时间戳 + 随机后缀，避免快速连点同毫秒碰撞） */
  const genNodeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /** 取某节点的直接子节点（沿出边过滤） */
  const getChildrenOfType = (parentId: string, type: NodeType): NodeData[] =>
    nodesRef.current.filter(
      (n) => n.type === type && edgesRef.current.some((e) => e.source === parentId && e.target === n.id)
    );

  /** 某节点是否已有指定类型的直接子节点 */
  const hasChildOfType = (nodeId: string, type: NodeType): boolean =>
    edgesRef.current.some(
      (e) => e.source === nodeId && nodesRef.current.find((n) => n.id === e.target)?.type === type
    );

  /** 沿入边向上 BFS，找到最近的指定类型祖先节点（输入数据来源） */
  const findUpstream = (nodeId: string, type: NodeType): NodeData | undefined => {
    const visited = new Set<string>();
    let frontier = [nodeId];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const nid of frontier) {
        if (visited.has(nid)) continue;
        visited.add(nid);
        for (const edge of edgesRef.current) {
          if (edge.target !== nid) continue;
          const parent = nodesRef.current.find((n) => n.id === edge.source);
          if (!parent) continue;
          if (parent.type === type) return parent;
          next.push(parent.id);
        }
      }
      frontier = next;
    }
    return undefined;
  };

  /**
   * 第一阶段：点击「生成」后立即在画布上放置组件框（边框光束表示运行中），
   * 豆瓣 API 返回后再回填元数据；失败则在组件框内展示错误并支持重试。
   * @param nodeId 传入则复用已有组件框（空态节点内联查询/重试），否则新建组件框
   */
  const fetchBookInfo = async (isbn: string, nodeId?: string) => {
    const id = nodeId ?? `node-${Date.now()}-${isbn}`;
    if (bookInfoInflight.has(id)) return;
    bookInfoInflight.add(id);
    setIsLoading(true);

    if (!nodeId) {
      // 立即创建组件框，进入等待态（边框光束）
      const { x, y } = getBookInfoPosition();
      recordHistory();
      const newNode: NodeData = { id, type: 'book_info', x, y, data: { isbn, isGenerating: true, error: null } };
      setNodes((prev) => [...prev, newNode]);
      focusOnNode(newNode);
    } else {
      // 空态/重试：复用已有组件框，重新进入等待态
      updateNodeData(id, { isbn, isGenerating: true, error: null });
    }

    const controller = new AbortController();
    streamControllers.current.set(id, controller);

    try {
      // 豆瓣 API 含限速延迟（每次请求前 1.5~3.5s），超时覆盖后端完整重试链（见 timeouts.ts）
      const response: any = await api.get(`/modules/bookplate/isbn/${isbn}`, {
        timeout: ISBN_FETCH_TIMEOUT_MS,
        signal: controller.signal,
      });
      updateNodeData(id, { isGenerating: false, error: null, ...response, isbn });
    } catch (error: any) {
      if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') return;
      console.error('Failed to fetch book info:', error);
      updateNodeData(id, {
        isGenerating: false,
        error: error?.isTimeout
          ? `ISBN ${isbn} 查询超时，请重试`
          : `无法获取 ISBN ${isbn} 的图书信息`,
      });
    } finally {
      streamControllers.current.delete(id);
      bookInfoInflight.delete(id);
      setIsLoading(false);
    }
  };

  const handleIsbnSubmit = (isbn: string) => {
    fetchBookInfo(isbn);
  };

  const handleRetryBook = (node: NodeData) => {
    const isbn = node.data?.isbn;
    if (!isbn) return;
    fetchBookInfo(isbn, node.id);
  };

  /** 收集节点的全部子孙节点 id（沿出边 BFS，含自身）；分支/级联删除用 */
  const collectDescendantIds = (id: string): string[] => {
    const ids = new Set<string>([id]);
    let frontier = [id];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const nid of frontier) {
        for (const edge of edgesRef.current) {
          if (edge.source === nid && !ids.has(edge.target)) {
            ids.add(edge.target);
            next.push(edge.target);
          }
        }
      }
      frontier = next;
    }
    return [...ids];
  };

  /** 批量删除节点（含子孙）：中止进行中请求，清理连线/尺寸/收藏/公开/generation 关联 */
  const removeNodesByIds = (ids: string[]) => {
    recordHistory();
    const idSet = new Set(ids);
    idSet.forEach((nid) => {
      streamControllers.current.get(nid)?.abort();
      streamControllers.current.delete(nid);
      delete generationIds.current[nid];
      analysisUploads.current.delete(nid);
    });
    setFavoritedState((prev) => {
      const next = { ...prev };
      ids.forEach((nid) => delete next[nid]);
      return next;
    });
    setPublishedState((prev) => {
      const next = { ...prev };
      ids.forEach((nid) => delete next[nid]);
      return next;
    });
    setNodes((prev) => prev.filter((n) => !idSet.has(n.id)));
    setEdges((prev) => prev.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)));
    setNodeSizes((prev) => {
      const next = { ...prev };
      ids.forEach((nid) => delete next[nid]);
      return next;
    });
    // 删除的是选中节点时清除选中态
    setSelectedImageId((prev) => (prev && idSet.has(prev) ? null : prev));
  };

  const handleRemoveNode = (id: string) => {
    const ids = collectDescendantIds(id);
    if (ids.length > 1) {
      // 有子节点（含分支）：确认后级联删除整棵子树，避免误删；防抖防止堆叠对话框
      if (removingRef.current) return;
      removingRef.current = true;
      void (async () => {
        try {
          const ok = await dialog.confirm({
            title: '级联删除',
            message: `该节点下还有 ${ids.length - 1} 个子节点（含后续分支）。删除将同时移除它们，是否继续？`,
            confirmText: '删除',
            danger: true,
          });
          if (ok) removeNodesByIds(ids);
        } finally {
          removingRef.current = false;
        }
      })();
      return;
    }
    removeNodesByIds(ids);
  };

  // ---------- 拖拽优化：命令式更新连线，拖拽期间零 React 渲染 ----------
  // 连线句柄映射 + 节点/连线的实时快照（拖拽回调读取，避免闭包过期）
  const edgeRefs = useRef<Map<string, NodeEdgeHandle>>(new Map());
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  // ---------- 撤销 / 重做（内存栈，记录结构/内容/位置变更） ----------
  const historyStack = useRef<HistorySnapshot[]>([]);
  const redoStack = useRef<HistorySnapshot[]>([]);
  const [, setHistoryVersion] = useState(0);

  const captureSnapshot = useCallback(
    (): HistorySnapshot => ({
      nodes: nodesRef.current,
      edges: edgesRef.current,
      generationIds: { ...generationIds.current },
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
    for (const [nid, controller] of [...streamControllers.current]) {
      const restored = restoredMap.get(nid);
      if (!restored || !restored.data?.isGenerating) {
        controller.abort();
        streamControllers.current.delete(nid);
      }
    }
    generationIds.current = { ...snapshot.generationIds };
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    // 2. 选中节点若已不在恢复后的画布中则清除
    setSelectedImageId((prev) => (prev && !restoredMap.has(prev) ? null : prev));
    // 3. 自愈：恢复后标记为生成中但无活动流的节点（清空/中断场景），复位为失败态，避免永久加载
    setNodes((prev) =>
      prev.map((n) =>
        n.data?.isGenerating && !streamControllers.current.has(n.id)
          ? { ...n, data: { ...n.data, isGenerating: false, error: n.data?.error ?? '生成已中断，请重试' } }
          : n
      )
    );
    // 4. 撤销删除/清空后节点集变大：被删节点已清除的收藏/公开状态需从服务端重新同步；
    //    同时清空「记录已删除」弱提示标记，让同步重新校验（快照恢复的映射可能又有效）
    if (snapshot.nodes.length > nodesRef.current.length) {
      setStaleRecordIds(new Set());
      void syncFavoritesFromServer();
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

  // 全局快捷键：Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y 重做（聚焦文本输入区时忽略）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  const canUndo = historyStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  /** 拖拽落点提交：无实际移动（单纯点击）不记历史；记录一步以便「拖错回退」 */
  const handlePositionChange = useCallback((id: string, x: number, y: number) => {
    const cur = nodesRef.current.find((n) => n.id === id);
    if (cur && Math.abs(cur.x - x) < 0.5 && Math.abs(cur.y - y) < 0.5) return;
    recordHistory();
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
  }, []);

  /** 拖拽中实时重绘相连连线（命令式 DOM 更新，不触发渲染） */
  const handleNodeDrag = useCallback((id: string, x: number, y: number) => {
    for (const edge of edgesRef.current) {
      const handle = edgeRefs.current.get(edge.id);
      if (!handle) continue;
      if (edge.source === id) {
        const target = nodesRef.current.find((n) => n.id === edge.target);
        if (target) handle.setPositions(x, y, target.x, target.y);
      } else if (edge.target === id) {
        const source = nodesRef.current.find((n) => n.id === edge.source);
        if (source) handle.setPositions(source.x, source.y, x, y);
      }
    }
  }, []);

  // ---------- SSE 执行（按节点类型分发） ----------
  /** 把 agent 中间步骤事件（tool_call / tool_result / status）追加到节点数据 */
  const appendAgentStep = (nodeId: string, step: any) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== nodeId) return n;
        const steps = Array.isArray(n.data?.agentSteps) ? n.data.agentSteps : [];
        return { ...n, data: { ...n.data, agentSteps: [...steps, step] } };
      })
    );
  };

  /** 解析 SSE 事件并追加 agent 中间步骤（tool_call / tool_result / status 事件为 JSON） */
  const handleAgentSseMessage = (nodeId: string, event: string, data: string) => {
    if (event === 'agent_tool_call' || event === 'agent_tool_result' || event === 'agent_status') {
      let payload: any = {};
      try {
        payload = JSON.parse(data);
      } catch {
        payload = { message: data };
      }
      appendAgentStep(nodeId, { type: event, ...payload });
    }
  };

  /** 图片分析节点：SSE 流式执行（LLM 一次性返回 analysis 事件；Agent 透传中间步骤 + 最终 analysis） */
  const runImageAnalysis = (node: NodeData, opts: { image?: string; coverUrl?: string }) => {
    if (streamControllers.current.has(node.id)) return;
    const controller = new AbortController();
    streamControllers.current.set(node.id, controller);
    updateNodeData(node.id, { isGenerating: true, error: null, agentSteps: [], analysis: undefined });

    let timedOut = false;
    let idleTimer: number | null = null;
    const armIdleTimeout = () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        timedOut = true;
        idleTimer = null;
        controller.abort();
      }, PROMPT_SSE_IDLE_TIMEOUT_MS);
    };
    armIdleTimeout();

    postSSEStream({
      url: '/api/modules/bookplate/analyze-image',
      body: {
        image: opts.image,
        cover_url: opts.coverUrl,
        config_id: node.configId ?? null,
        node_id: node.id,
      },
      signal: controller.signal,
      onMessage: (event, data) => {
        armIdleTimeout(); // 收到数据，重置空闲计时
        if (
          event === 'agent_tool_call' ||
          event === 'agent_tool_result' ||
          event === 'agent_status'
        ) {
          handleAgentSseMessage(node.id, event, data);
          return;
        }
        if (event === 'analysis') {
          updateNodeData(node.id, { analysis: data, isGenerating: false, error: null });
          return;
        }
        if (event === 'error') {
          updateNodeData(node.id, { isGenerating: false, error: data });
          return;
        }
      },
    })
      .then(() => {
        updateNodeData(node.id, { isGenerating: false });
      })
      .catch((err) => {
        if (!timedOut && err?.name === 'AbortError') return; // 节点被删除 / 画布清空
        console.error('SSE stream error:', err);
        updateNodeData(node.id, {
          isGenerating: false,
          error: timedOut ? '图片分析超时，请重试' : '图片分析失败，请重试',
        });
      })
      .finally(() => {
        if (idleTimer !== null) window.clearTimeout(idleTimer);
        streamControllers.current.delete(node.id);
      });
  };

  /** 提示词生成节点：基于上游数据流式生成（LLM 流式 / Agent 透传中间步骤） */
  const runPromptGeneration = (node: NodeData, inputs: { metadata: any; analysis: string }) => {
    // 重试防抖：该节点已有进行中的流时直接忽略（防止快速连点开启并发流导致内容重复）
    if (streamControllers.current.has(node.id)) return;
    const controller = new AbortController();
    streamControllers.current.set(node.id, controller);
    updateNodeData(node.id, { content: '', isGenerating: true, error: null, agentSteps: [] });

    // 前端兜底超时：真正的「空闲超时」——每次收到数据都会重新计时，
    // 超过 PROMPT_SSE_IDLE_TIMEOUT_MS 没有任何数据则判定超时并中止
    let timedOut = false;
    let idleTimer: number | null = null;
    const armIdleTimeout = () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        timedOut = true;
        idleTimer = null;
        controller.abort();
      }, PROMPT_SSE_IDLE_TIMEOUT_MS);
    };
    armIdleTimeout();

    postSSEStream({
      url: '/api/modules/bookplate/generate-prompt',
      body: {
        metadata: inputs.metadata,
        analysis: inputs.analysis,
        config_id: node.configId ?? null,
        node_id: node.id,
      },
      signal: controller.signal,
      onMessage: (event, data) => {
        armIdleTimeout(); // 收到数据，重置空闲计时
        // Agent 模式中间步骤（工具调用 / 思考状态）单独处理，不注入提示词内容
        if (
          event === 'agent_tool_call' ||
          event === 'agent_tool_result' ||
          event === 'agent_status'
        ) {
          handleAgentSseMessage(node.id, event, data);
          return;
        }
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== node.id) return n;
            if (event === 'error') {
              // 后端流式生成失败：切换为错误态（复用错误横幅 + 重试），不注入文本到内容
              return { ...n, data: { ...n.data, isGenerating: false, error: data } };
            }
            return { ...n, data: { ...n.data, content: (n.data.content || '') + data } };
          })
        );
      },
    })
      .then(() => {
        updateNodeData(node.id, { isGenerating: false });
      })
      .catch((err) => {
        if (!timedOut && err?.name === 'AbortError') return; // 节点被删除 / 画布清空
        console.error('SSE stream error:', err);
        updateNodeData(node.id, {
          isGenerating: false,
          error: timedOut ? '提示词生成超时，请重试' : '提示词生成失败',
        });
      })
      .finally(() => {
        if (idleTimer !== null) window.clearTimeout(idleTimer);
        streamControllers.current.delete(node.id);
      });
  };

  // ---------- 图像生成 ----------
  /** Agent 模式图片生成：SSE 流式透传中间步骤，最终 image_url 事件落图 */
  const runImageGenerationAgent = async (nodeId: string, prompt: string, controller: AbortController, configId?: number) => {
    let timedOut = false;
    let idleTimer: number | null = null;
    const armIdleTimeout = () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        timedOut = true;
        idleTimer = null;
        controller.abort();
      }, IMAGE_GENERATION_TIMEOUT_MS);
    };
    armIdleTimeout();

    try {
      await postSSEStream({
        url: '/api/modules/bookplate/generate-image',
        body: { prompt, config_id: configId ?? null, node_id: nodeId },
        signal: controller.signal,
        onMessage: (event, data) => {
          armIdleTimeout(); // 收到数据，重置空闲计时
          if (
            event === 'agent_tool_call' ||
            event === 'agent_tool_result' ||
            event === 'agent_status'
          ) {
            handleAgentSseMessage(nodeId, event, data);
            return;
          }
          if (event === 'image_url') {
            let payload: any = {};
            try {
              payload = JSON.parse(data);
            } catch {
              /* 忽略 */
            }
            const url = payload?.image_url;
            if (url) {
              updateNodeData(nodeId, {
                imageUrl: url,
                isGenerating: false,
                error: payload?.mock ? 'API 配置缺失，当前为演示占位图' : null,
                isMock: payload?.mock,
              });
              setSelectedImageId(nodeId);
              if (!payload?.mock) {
                void autoSaveGeneration(nodeId, url).catch(() => undefined);
              }
            }
            return;
          }
          if (event === 'error') {
            updateNodeData(nodeId, { isGenerating: false, error: data });
            return;
          }
        },
      });
    } catch (err: any) {
      if (!timedOut && err?.name === 'AbortError') return; // 节点被删除 / 画布清空
      console.error('Agent image SSE error:', err);
      updateNodeData(nodeId, {
        isGenerating: false,
        error: timedOut ? '图片生成超时，请重试' : '图片生成失败，请重试',
      });
    } finally {
      if (idleTimer !== null) window.clearTimeout(idleTimer);
    }
  };

  const runImageGeneration = async (node: NodeData, prompt: string) => {
    // 重试防抖：该节点已有进行中的生成时直接忽略（防止快速连点开启并发请求，
    // 导致孤儿流 + 历史记录重复保存）
    if (streamControllers.current.has(node.id)) return;
    updateNodeData(node.id, { isGenerating: true, imageUrl: null, error: null, agentSteps: [] });
    // 重新生成后，旧的保存快照/收藏状态失效
    delete generationIds.current[node.id];
    setFavoritedState((prev) => ({ ...prev, [node.id]: false }));
    setPublishedState((prev) => ({ ...prev, [node.id]: false }));
    const controller = new AbortController();
    streamControllers.current.set(node.id, controller);

    try {
      // 执行模式由该节点绑定的配置决定（agent 走 SSE 流式，否则走 LLM 图像 API）
      const cfg =
        node.configId != null
          ? registryConfigsRef.current.find((c) => c.id === node.configId)
          : undefined;
      if (cfg?.mode === 'agent') {
        await runImageGenerationAgent(node.id, prompt, controller, node.configId);
        return;
      }
      // 图片生成耗时较长（可达 30-120s+），超时须覆盖后端最坏耗时（见 timeouts.ts）
      const res: any = await api.post(
        '/modules/bookplate/generate-image',
        { prompt, config_id: node.configId ?? null, node_id: node.id },
        {
          timeout: IMAGE_GENERATION_TIMEOUT_MS,
          signal: controller.signal,
        }
      );
      updateNodeData(node.id, {
        imageUrl: res.image_url,
        isGenerating: false,
        error: res.mock ? 'API 配置缺失，当前为演示占位图' : null,
        isMock: res.mock,
      });
      // 新图生成成功：自动选中，使全局操作栏作用于本节点
      setSelectedImageId(node.id);
      // 成功即自动保存一条历史记录（失败不保存），重试会新建而非覆盖
      if (!res.mock) {
        await autoSaveGeneration(node.id, res.image_url).catch(() => undefined);
      }
    } catch (error: any) {
      if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') return;
      console.error('Failed to generate image:', error);
      // 超时与普通失败分开提示（拦截器保留 isTimeout 标记）；后端 502 detail 兜底展示
      updateNodeData(node.id, {
        isGenerating: false,
        error: error?.isTimeout
          ? '图片生成超时，请重试'
          : error?.detail || '图片生成失败，请重试',
      });
    } finally {
      streamControllers.current.delete(node.id);
    }
  };

  // ---------- 通用节点创建与执行分发 ----------
  /** 新节点的初始数据（按模板类型） */
  const seedDataFor = (type: NodeType): any => {
    switch (type) {
      case 'book_info':
        return { isbn: '', isGenerating: false, error: null };
      case 'image_analysis':
        return { analysis: undefined, isGenerating: false, error: null, agentSteps: [] };
      case 'prompt_generation':
        return { content: '', isGenerating: false, error: null, agentSteps: [] };
      case 'image_generation':
        return { prompt: '', imageUrl: null, isGenerating: false, error: null, agentSteps: [] };
    }
  };

  /** 节点执行分发：按类型收集上游输入并自动执行（输入不足时进入待运行态） */
  const runNode = (node: NodeData) => {
    switch (node.type) {
      case 'book_info':
        return; // 需用户输入 ISBN
      case 'image_analysis': {
        const book = findUpstream(node.id, 'book_info');
        // 注意：必须传豆瓣原始 URL（cover_image），而非本地代理 URL（cover_image_local）——
        // 后端仅接受 doubanio.com 域名做封面抓取/分析
        const coverUrl =
          book?.data?.cover_image || book?.data?.coverUrl || book?.data?.cover_image_local;
        const uploaded = analysisUploads.current.get(node.id);
        if (!coverUrl && !uploaded) return; // 无图可分析 → 待运行态
        runImageAnalysis(node, { image: uploaded, coverUrl: coverUrl || undefined });
        return;
      }
      case 'prompt_generation': {
        const book = findUpstream(node.id, 'book_info');
        const analysisNode = findUpstream(node.id, 'image_analysis');
        const analysis =
          typeof analysisNode?.data?.analysis === 'string' ? analysisNode.data.analysis : '';
        if (!book?.data?.isbn && !analysis) return; // 无上游输入 → 待运行态
        runPromptGeneration(node, { metadata: book?.data ?? {}, analysis });
        return;
      }
      case 'image_generation': {
        const promptNode = findUpstream(node.id, 'prompt_generation');
        const prompt =
          typeof promptNode?.data?.content === 'string' ? promptNode.data.content.trim() : '';
        if (!prompt) return; // 上游提示词未就绪 → 待运行态
        runImageGeneration(node, prompt);
        return;
      }
    }
  };

  /**
   * 节点添加核心入口：在父节点下新建一个节点并连线（picker 新建与分支复制共用）。
   * 统一处理：兄弟位置排布（branchSerial 自动附加，供连线色调/布局使用）、记历史、
   * 同步 refs/state、可选沿用上传参考图、可选创建后立即执行、自动聚焦。
   */
  const addChildNode = (
    parent: NodeData,
    opts: {
      type: NodeType;
      /** 新节点初始数据（branchSerial 会自动附加） */
      data: Record<string, any>;
      configId?: number;
      configName?: string;
      /** 创建后立即执行（picker 新建传 runNode 自动分发；分支按需传入） */
      run?: (newNode: NodeData) => void;
      /** 沿用指定旧节点的上传参考图（内存快照），图片分析分支用 */
      copyUploadFrom?: string;
    }
  ) => {
    const siblings = getChildrenOfType(parent.id, opts.type);
    const newId = genNodeId(opts.type);
    const { x, y } = getBranchNodePosition(parent, siblings, nodeSizesRef.current, opts.type);
    const newNode: NodeData = {
      id: newId,
      type: opts.type,
      configId: opts.configId,
      configName: opts.configName,
      x,
      y,
      data: { ...opts.data, branchSerial: siblings.length },
    };
    if (opts.copyUploadFrom) {
      const uploaded = analysisUploads.current.get(opts.copyUploadFrom);
      if (uploaded) analysisUploads.current.set(newId, uploaded);
    }
    const newEdge: EdgeData = { id: `edge-${parent.id}-${newId}`, source: parent.id, target: newId };

    recordHistory();
    // 先同步写入 refs，让「自动执行」立即能读到新连线/节点
    nodesRef.current = [...nodesRef.current, newNode];
    edgesRef.current = [...edgesRef.current, newEdge];
    setNodes((prev) => [...prev, newNode]);
    setEdges((prev) => [...prev, newEdge]);

    opts.run?.(newNode); // 输入就绪即自动执行（dify 风格）
    focusOnNode(newNode); // 自动聚焦：新节点不可见时平移到视口内
  };

  /** 稳定回调：按节点 id 创建子节点（供 AddNodeButton / 右键菜单使用） */
  const handlePickChildFor = useCallback((nodeId: string, item: NodePickerItem) => {
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    addChildNode(node, {
      type: item.nodeType,
      data: seedDataFor(item.nodeType),
      configId: item.configId,
      configName: item.configId ? item.label : undefined,
      run: runNode, // 输入就绪即自动执行（dify 风格）
    });
  }, []);

  /** 「+」菜单可选项：基础模板 + 各配置变体（无配置的模板提供「默认配置」项） */
  const pickerItems = useMemo<NodePickerItem[]>(() => {
    const items: NodePickerItem[] = [];
    for (const t of NODE_TEMPLATES) {
      if (!t.configurable) {
        items.push({ key: t.type, nodeType: t.type, label: t.name, description: t.description });
        continue;
      }
      const configs = registryConfigs.filter((c) => c.node_type === t.type);
      if (configs.length === 0) {
        items.push({
          key: `${t.type}-default`,
          nodeType: t.type,
          label: t.name,
          description: t.description,
          fallback: true,
          mode: 'llm',
        });
      } else {
        for (const c of configs) {
          items.push({
            key: `${t.type}-${c.id}`,
            nodeType: t.type,
            label: c.name,
            description: c.agent_name
              ? `Agent · ${c.agent_name}`
              : c.llm_config_name
                ? `模型 · ${c.llm_config_name}`
                : t.description,
            configId: c.id,
            group: c.group ?? undefined,
            groupOrder: c.group_order ?? 0,
            mode: c.mode,
            agentName: c.agent_name ?? null,
          });
        }
      }
    }
    return items;
  }, [registryConfigs]);

  /** 节点的绑定配置（用于展示 agent 名 / 决定执行模式） */
  const configOf = (node: NodeData): RegistryNodeConfig | undefined =>
    node.configId != null
      ? registryConfigs.find((c) => c.id === node.configId)
      : undefined;

  /** 已尝试过自动执行的节点 id：防止输入就绪检查在每次状态变化时重复触发 */
  const autoRunTried = useRef<Set<string>>(new Set());

  // 输入就绪自动执行（dify 行为）：节点创建时输入未就绪会进入待运行态，
  // 上游数据到达后（如图书元数据返回、分析完成、提示词生成完）自动补跑。
  useEffect(() => {
    for (const node of nodesRef.current) {
      if (autoRunTried.current.has(node.id)) continue;
      if (node.data?.isGenerating || node.data?.error) continue;

      let idle = false;
      let ready = false;
      if (node.type === 'image_analysis') {
        idle = !node.data?.analysis;
        const book = findUpstream(node.id, 'book_info');
        const uploaded = analysisUploads.current.get(node.id);
        ready = !!(uploaded || book?.data?.cover_image || book?.data?.coverUrl);
      } else if (node.type === 'prompt_generation') {
        idle = !node.data?.content;
        const book = findUpstream(node.id, 'book_info');
        const analysisNode = findUpstream(node.id, 'image_analysis');
        ready = !!(book?.data?.isbn ||
          (typeof analysisNode?.data?.analysis === 'string' && analysisNode.data.analysis));
      } else if (node.type === 'image_generation') {
        idle = !node.data?.imageUrl;
        const promptNode = findUpstream(node.id, 'prompt_generation');
        ready = !!(
          typeof promptNode?.data?.content === 'string' &&
          promptNode.data.content.trim() &&
          !promptNode.data.isGenerating
        );
      }

      if (!idle) {
        autoRunTried.current.add(node.id); // 已有结果，无需补跑
        continue;
      }
      if (ready) {
        autoRunTried.current.add(node.id);
        runNode(node);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // ---------- 自动聚焦新节点 ----------
  /** 判断节点是否（部分）落在当前视口内（画布坐标换算，含少量边距） */
  const isNodeVisible = (node: NodeData): boolean => {
    const size = nodeSizesRef.current[node.id] ?? DEFAULT_SIZES[node.type];
    const s = scaleRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight - 64;
    const viewLeft = -positionRef.current.x / s;
    const viewTop = -positionRef.current.y / s;
    const margin = 48 / s;
    return (
      node.x + size.width > viewLeft + margin &&
      node.x < viewLeft + vw / s - margin &&
      node.y + size.height > viewTop + margin &&
      node.y < viewTop + vh / s - margin
    );
  };

  /** 新节点创建后平移/缩放视口使其可见（已在视口内则不打扰） */
  const focusOnNode = (node: NodeData) => {
    if (isNodeVisible(node)) return;
    const size = nodeSizesRef.current[node.id] ?? DEFAULT_SIZES[node.type];
    const fit = computeFitViewport(
      { minX: node.x, minY: node.y, maxX: node.x + size.width, maxY: node.y + size.height },
      window.innerWidth,
      window.innerHeight - 64
    );
    setScale(fit.scale);
    setPosition(fit.position);
  };

  // ---------- 节点右键菜单 ----------
  /** 右键节点打开上下文菜单（抑制浏览器默认菜单） */
  const handleNodeContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!nodesRef.current.some((n) => n.id === nodeId)) return;
    setCtxMenu({ x: e.clientX, y: e.clientY, nodeId });
  }, []);
  const closeContextMenu = useCallback(() => setCtxMenu(null), []);

  // ---------- 收藏 / 公开（保存到历史并关联） ----------
  /** 由图片节点沿连线回溯组装三阶段结果（含 Agent 中间步骤，持久化到历史记录） */
  const buildStageResults = (imageNodeId: string): GenerationStageResults | null => {
    // 读 refs 快照：稳定回调可能持有旧闭包，但这里始终拿到最新节点/连线
    const imageNode = nodesRef.current.find((n) => n.id === imageNodeId);
    if (!imageNode) return null;

    const promptNode = findUpstream(imageNodeId, 'prompt_generation');
    const analysisNode = findUpstream(imageNodeId, 'image_analysis');
    const bookNode = findUpstream(imageNodeId, 'book_info');

    // Agent 中间步骤随记录持久化：历史/收藏/画廊页与刷新后仍可见
    const promptSteps = Array.isArray(promptNode?.data?.agentSteps) ? promptNode.data.agentSteps : [];
    const imageSteps = Array.isArray(imageNode.data?.agentSteps) ? imageNode.data.agentSteps : [];

    return {
      stage1: bookNode
        ? {
            isbn: bookNode.data?.isbn || '',
            metadata: bookNode.data || {},
          }
        : undefined,
      stage2: promptNode
        ? {
            prompt: typeof promptNode.data?.content === 'string' ? promptNode.data.content : '',
            analysis:
              typeof analysisNode?.data?.analysis === 'string'
                ? analysisNode.data.analysis
                : undefined,
            agent_steps: promptSteps.length > 0 ? promptSteps : undefined,
          }
        : undefined,
      stage3: {
        image_url: typeof imageNode.data?.imageUrl === 'string' ? imageNode.data.imageUrl : '',
        prompt: typeof imageNode.data?.prompt === 'string' ? imageNode.data.prompt : '',
        agent_steps: imageSteps.length > 0 ? imageSteps : undefined,
      },
    };
  };

  /** 生成成功后自动保存到历史记录（每次成功新建一条，失败不保存）。 */
  const autoSaveGeneration = async (imageNodeId: string, imageUrl: string): Promise<number | null> => {
    const stageResults = buildStageResults(imageNodeId);
    if (!stageResults) return null;
    // 覆盖 stage3 时保留 buildStageResults 已收集的 Agent 中间步骤
    const agentSteps = Array.isArray(stageResults.stage3?.agent_steps)
      ? stageResults.stage3.agent_steps
      : undefined;
    stageResults.stage3 = {
      image_url: imageUrl,
      prompt: typeof stageResults.stage3?.prompt === 'string' ? stageResults.stage3.prompt : '',
      agent_steps: agentSteps,
    };
    try {
      const gen = await generationsService.create({
        module: 'bookplate',
        stage_results: stageResults,
        final_image_url: imageUrl,
        status: 'completed',
      });
      generationIds.current[imageNodeId] = gen.id;
      return gen.id;
    } catch (e) {
      console.error('自动保存历史记录失败:', e);
      return null;
    }
  };

  /** 确保该图片节点已有 Generation 记录，返回其 id */
  const ensureGeneration = async (imageNodeId: string): Promise<number> => {
    const existing = generationIds.current[imageNodeId];
    if (existing) return existing;

    const imageNode = nodesRef.current.find((n) => n.id === imageNodeId);
    if (imageNode?.data?.isMock) {
      throw new Error('占位图片不能保存到历史记录');
    }

    const stageResults = buildStageResults(imageNodeId) ?? {};
    const imageUrl = stageResults.stage3?.image_url || '';
    const gen = await generationsService.create({
      module: 'bookplate',
      stage_results: stageResults,
      final_image_url: imageUrl,
      status: 'completed',
    });
    generationIds.current[imageNodeId] = gen.id;
    return gen.id;
  };

  /** 收藏/公开成功（已重新建立记录）后，清除该节点的「记录已删除」标记 */
  const clearStaleFlag = useCallback((imageNodeId: string) => {
    setStaleRecordIds((prev) => {
      if (!prev.has(imageNodeId)) return prev;
      const next = new Set(prev);
      next.delete(imageNodeId);
      return next;
    });
  }, []);

  const toggleFavoriteForImage = async (imageNodeId: string): Promise<boolean> => {
    // 防止快速连点时读到的状态互相覆盖
    if (busyFav.current.has(imageNodeId)) return !!favoritedRef.current[imageNodeId];
    busyFav.current.add(imageNodeId);
    try {
      const genId = await ensureGeneration(imageNodeId);
      const currently = !!favoritedRef.current[imageNodeId];
      const updated = currently
        ? await generationsService.unfavorite(genId)
        : await generationsService.favorite(genId);
      const next = updated.is_favorited ?? !currently;
      setFavoritedState((prev) => ({ ...prev, [imageNodeId]: next }));
      // 收藏成功即已重新建立记录，弱提示消失
      clearStaleFlag(imageNodeId);
      return next;
    } catch (err: any) {
      console.warn('收藏失败:', err.message);
      return !!favoritedRef.current[imageNodeId];
    } finally {
      busyFav.current.delete(imageNodeId);
    }
  };

  const togglePublicForImage = async (imageNodeId: string): Promise<boolean> => {
    if (busyPub.current.has(imageNodeId)) return !!publishedRef.current[imageNodeId];
    busyPub.current.add(imageNodeId);
    try {
      const genId = await ensureGeneration(imageNodeId);
      const currently = !!publishedRef.current[imageNodeId];
      const updated = currently
        ? await generationsService.unshare(genId)
        : await generationsService.share(genId);
      const next = updated.is_public ?? !currently;
      setPublishedState((prev) => ({ ...prev, [imageNodeId]: next }));
      // 公开成功即已重新建立记录，弱提示消失
      clearStaleFlag(imageNodeId);
      return next;
    } catch (err: any) {
      console.warn('公开失败:', err.message);
      return !!publishedRef.current[imageNodeId];
    } finally {
      busyPub.current.delete(imageNodeId);
    }
  };

  // ---------- 稳定回调（配合节点组件 memo）：避免内联箭头导致未变化节点重渲染 ----------
  // 按节点 id 从实时快照（nodesRef）取节点，保证稳定闭包也能拿到最新节点。
  // 不变量：下方被引用的处理函数只能读取 refs / 模块函数 / 稳定 setter。
  const handleRemove = useCallback((id: string) => handleRemoveNode(id), []);
  const handleRetryBookFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node) handleRetryBook(node);
  }, []);
  const handleFetchBookFor = useCallback((id: string, isbn: string) => {
    fetchBookInfo(isbn, id);
  }, []);
  const handleDownloadBookData = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || !node.data) return;
    // 仅导出 API 返回的原始数据（cover_image 为豆瓣原始 URL），剔除前端附加的展示状态
    const apiData = { ...node.data };
    delete apiData.isGenerating;
    delete apiData.error;
    delete apiData.cover_image_local;
    const json = JSON.stringify(apiData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `book-${node.data.isbn || Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);
  /** 保存编辑文本：若该提示词节点已有子图像节点，则分支新建节点保留旧分支；否则原地保存 */
  const handleEditContent = useCallback((id: string, content: string) => {
    const promptNode = nodesRef.current.find((n) => n.id === id);
    if (!promptNode || promptNode.type !== 'prompt_generation') return;
    if (!hasChildOfType(id, 'image_generation')) {
      recordHistory();
      updateNodeData(id, { content });
      return;
    }
    // 内容未变化时无需分支（避免误操作产生空分支节点）
    const oldContent = typeof promptNode.data?.content === 'string' ? promptNode.data.content : '';
    if (content === oldContent) return;
    // 有子图：新建 prompt 节点（共享父节点），旧节点及旧分支原样保留
    branchPromptNode(promptNode, { content });
  }, []);
  /** 提示词节点重试/重新生成：从上游重新收集输入并流式生成 */
  const handleRetryPromptFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node && node.type === 'prompt_generation') runNode(node);
  }, []);
  /** 图片分析节点执行/重试：image 为本次上传的参考图（持久化到内存供重试复用）。
   *  已有正确结果时「再次分析」新建兄弟节点保留旧分支（与图像节点行为一致）；失败/空态原地执行。 */
  const handleRunAnalysisFor = useCallback((id: string, image?: string) => {
    if (image) analysisUploads.current.set(id, image);
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'image_analysis') return;
    // 已有正确分析结果：分支新建兄弟节点保留旧结果；错误/空态：原地执行修复
    if (node.data?.analysis && !node.data?.error) {
      branchAnalysisNode(node);
      return;
    }
    runNode(node);
  }, []);
  const handleRetryImageFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'image_generation') return;
    // 已有正常图片：分支新建兄弟节点保留旧结果；错误/空态：原地重新生成修复
    if (node.data?.imageUrl && !node.data?.isMock) {
      branchImageNode(node);
      return;
    }
    runNode(node);
  }, []);
  const handleToggleFavoriteFor = useCallback((id: string) => toggleFavoriteForImage(id), []);
  const handleTogglePublicFor = useCallback((id: string) => togglePublicForImage(id), []);

  /** 点击图片节点选中（作为全局操作栏的作用目标）；仅已有图片的节点可选中，
   *  避免删除节点时按钮点击冒泡产生「幽灵选中」。 */
  const handleSelectImage = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node?.type === 'image_generation' && node.data?.imageUrl) setSelectedImageId(id);
  }, []);

  /** 侧边操作栏：作用于选中的图片节点（未选中时回退最近生成） */
  const handleBarFavorite = async () => {
    const target = activeImage;
    if (!target) return;
    try {
      const next = await toggleFavoriteForImage(target.id);
      showToast(next ? '已收藏到「我的收藏」' : '已取消收藏', { type: 'success', position: 'top-right' });
    } catch (e: any) {
      showToast(e?.message || '收藏失败，请重试', { type: 'error', position: 'top-right' });
    }
  };

  const handleBarPublic = async () => {
    const target = activeImage;
    if (!target) return;
    try {
      const next = await togglePublicForImage(target.id);
      showToast(next ? '已公开到画廊' : '已从画廊撤下', { type: 'success', position: 'top-right' });
    } catch (e: any) {
      showToast(e?.message || '公开失败，请重试', { type: 'error', position: 'top-right' });
    }
  };

  /**
   * 分支助手：在共享父级下新建一个兄弟节点（继承类型与配置变体），旧节点与旧分支原样保留。
   * 仅负责定位父节点，实际创建统一委托给 addChildNode；无父节点则放弃（各类型节点必有父）。
   * 差异通过 options 表达：
   *  - 提示词：传入新内容，创建后不执行（内容已就绪）
   *  - 图像：沿用原 prompt 立即重新生成（run 回调）
   *  - 图片分析：沿用上传参考图 + runNode 自动执行（copyUpload）
   */
  const branchNode = (
    oldNode: NodeData,
    opts: {
      /** 新节点的初始数据（branchSerial 会自动附加） */
      data: Record<string, any>;
      /** 创建后立即执行（缺省不执行，如提示词分支内容已就绪） */
      run?: (newNode: NodeData) => void;
      /** 沿用原节点的上传参考图（内存快照），图片分析分支用 */
      copyUpload?: boolean;
    }
  ) => {
    const parentEdge = edgesRef.current.find((e) => e.target === oldNode.id);
    const parent = parentEdge ? nodesRef.current.find((n) => n.id === parentEdge.source) : undefined;
    if (!parent) return; // 无父节点：分支节点将无法找到上游输入，直接放弃
    addChildNode(parent, {
      type: oldNode.type,
      data: opts.data,
      configId: oldNode.configId,
      configName: oldNode.configName,
      copyUploadFrom: opts.copyUpload ? oldNode.id : undefined,
      run: opts.run,
    });
  };

  /** 提示词节点分支：新建共享父级的兄弟提示词节点（内容由调用方传入，创建后不执行） */
  const branchPromptNode = (oldNode: NodeData, opts: { content?: string }) => {
    branchNode(oldNode, { data: { content: opts.content ?? '', agentSteps: [] } });
  };

  /** 图片节点分支：已有正常图片时「重试」新建兄弟图像节点（沿用原 prompt 立即重新生成） */
  const branchImageNode = (node: NodeData) => {
    const prompt = typeof node.data?.prompt === 'string' ? node.data.prompt : '';
    if (!prompt) return;
    branchNode(node, {
      data: { prompt, imageUrl: null, isGenerating: true, agentSteps: [] },
      run: (newNode) => runImageGeneration(newNode, prompt),
    });
  };

  /** 图片分析节点分支：已有正确结果时「再次分析」新建兄弟分析节点，沿用上传参考图并自动执行 */
  const branchAnalysisNode = (oldNode: NodeData) => {
    branchNode(oldNode, {
      copyUpload: true,
      data: { analysis: undefined, isGenerating: false, error: null, agentSteps: [] },
      run: (newNode) => runNode(newNode),
    });
  };

  // ---------- 画布侧操作栏 ----------
  const handleClear = async () => {
    if (!nodes.length) return;
    const ok = await dialog.confirm({
      title: '清空画布',
      message: '确定清空画布上的所有内容吗？',
      confirmText: '清空',
      danger: true,
    });
    if (!ok) return;
    recordHistory();
    streamControllers.current.forEach((controller) => controller.abort());
    streamControllers.current.clear();
    clearCanvasState();
    setFavoritedState({});
    setPublishedState({});
    setNodes([]);
    setEdges([]);
    setNodeSizes({});
    setSelectedImageId(null);
  };

  /** 自动布局：按层级分列重排所有节点（父节点居中于子树区块），可撤销；无实际位移不记历史 */
  const handleAutoLayout = () => {
    if (nodes.length === 0) return;
    const layout = computeAutoLayout(nodes, edges, nodeSizes);
    if (Object.keys(layout).length === 0) return;
    let changed = false;
    for (const n of nodes) {
      const p = layout[n.id];
      if (p && (Math.abs(n.x - p.x) > 0.5 || Math.abs(n.y - p.y) > 0.5)) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    recordHistory();
    setNodes((prev) =>
      prev.map((n) => {
        const p = layout[n.id];
        return p ? { ...n, x: p.x, y: p.y } : n;
      })
    );
    // 自动聚焦：计算新布局边界（含节点尺寸），平移/缩放视口到恰好容纳（内容小则不放大并居中）
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const p = layout[n.id];
      if (!p) continue;
      const size = nodeSizes[n.id] ?? DEFAULT_SIZES[n.type];
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + size.width);
      maxY = Math.max(maxY, p.y + size.height);
    }
    if (minX === Infinity) return;
    // Canvas 容器尺寸与布局一致：全宽 × (视口高 − Navbar 64px)
    const fit = computeFitViewport({ minX, minY, maxX, maxY }, window.innerWidth, window.innerHeight - 64);
    setScale(fit.scale);
    setPosition(fit.position);
  };

  const handleExport = async () => {
    // 有多个藏书票时导出选中的（未选中回退最近生成）
    const url = activeImage?.data?.imageUrl;
    if (!url) return;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const ext = url.split('.').pop() || 'png';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `bookplate-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.error('导出失败:', err);
      await dialog.alert({ title: '导出失败', message: '导出失败，请重试。' });
    }
  };

  // 同源分支连线：按目标节点创建顺序给每条边编号（分色/错开用），单边时为 count=1
  const edgeBranchInfo = useMemo(() => {
    const info = new Map<string, { index: number; count: number }>();
    const grouped = new Map<string, EdgeData[]>();
    for (const edge of edges) {
      const list = grouped.get(edge.source) ?? [];
      list.push(edge);
      grouped.set(edge.source, list);
    }
    for (const [, list] of grouped) {
      list.sort(
        (a, b) =>
          nodes.findIndex((n) => n.id === a.target) - nodes.findIndex((n) => n.id === b.target)
      );
      list.forEach((e, i) => info.set(e.id, { index: i, count: list.length }));
    }
    return info;
  }, [edges, nodes]);

  /** 节点底部「+」按钮（每类节点统一入口） */
  const renderFooter = (node: NodeData) => (
    <AddNodeButton
      items={pickerItems}
      onPick={(item) => handlePickChildFor(node.id, item)}
      pendingChildId={null}
    />
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Navbar />

      <main className="flex-1 relative flex">
        <Canvas scale={scale} position={position} onPositionChange={setPosition}>
          {edges.map((edge) => {
            const source = nodes.find((n) => n.id === edge.source);
            const target = nodes.find((n) => n.id === edge.target);
            if (!source || !target) return null;

            const sourceSize = nodeSizes[source.id] ?? DEFAULT_SIZES[source.type];
            const targetSize = nodeSizes[target.id] ?? DEFAULT_SIZES[target.type];

            return (
              <NodeEdge
                key={edge.id}
                ref={(handle) => {
                  if (handle) {
                    edgeRefs.current.set(edge.id, handle);
                  } else {
                    edgeRefs.current.delete(edge.id);
                  }
                }}
                id={edge.id}
                sourceX={source.x}
                sourceY={source.y}
                targetX={target.x}
                targetY={target.y}
                sourceWidth={sourceSize.width}
                sourceHeight={sourceSize.height}
                targetWidth={targetSize.width}
                targetHeight={targetSize.height}
                branchIndex={edgeBranchInfo.get(edge.id)?.index ?? 0}
                branchCount={edgeBranchInfo.get(edge.id)?.count ?? 1}
                tintIndex={
                  typeof target.data?.branchSerial === 'number'
                    ? target.data.branchSerial
                    : (edgeBranchInfo.get(edge.id)?.index ?? 0)
                }
              />
            );
          })}

          {nodes.map((node) => {
            if (node.type === 'book_info') {
              return (
                <BookInfoNode
                  key={node.id}
                  id={node.id}
                  initialX={node.x}
                  initialY={node.y}
                  title={getNodeTitle(node)}
                  data={node.data}
                  isGenerating={!!node.data.isGenerating}
                  error={node.data.error ?? null}
                  onRemove={handleRemove}
                  onRetry={handleRetryBookFor}
                  onFetch={handleFetchBookFor}
                  onDownload={handleDownloadBookData}
                  onPositionChange={handlePositionChange}
                  onSizeChange={handleSizeChange}
                  onDrag={handleNodeDrag}
                  onContextMenu={(e) => handleNodeContextMenu(e, node.id)}
                  footer={renderFooter(node)}
                />
              );
            } else if (node.type === 'image_analysis') {
              const config = configOf(node);
              return (
                <ImageAnalysisNode
                  key={node.id}
                  id={node.id}
                  initialX={node.x}
                  initialY={node.y}
                  title={getNodeTitle(node)}
                  analysis={node.data.analysis}
                  agentSteps={node.data.agentSteps}
                  agentName={config?.mode === 'agent' ? (config.agent_name ?? undefined) : undefined}
                  group={config?.group?.trim() || undefined}
                  isGenerating={!!node.data.isGenerating}
                  error={node.data.error ?? null}
                  onRemove={handleRemove}
                  onRun={handleRunAnalysisFor}
                  onPositionChange={handlePositionChange}
                  onSizeChange={handleSizeChange}
                  onDrag={handleNodeDrag}
                  onContextMenu={(e) => handleNodeContextMenu(e, node.id)}
                  footer={renderFooter(node)}
                />
              );
            } else if (node.type === 'prompt_generation') {
              const config = configOf(node);
              return (
                <PromptNode
                  key={node.id}
                  id={node.id}
                  initialX={node.x}
                  initialY={node.y}
                  title={getNodeTitle(node)}
                  content={node.data.content}
                  agentSteps={node.data.agentSteps}
                  agentName={config?.mode === 'agent' ? (config.agent_name ?? undefined) : undefined}
                  group={config?.group?.trim() || undefined}
                  isGenerating={!!node.data.isGenerating}
                  error={node.data.error ?? null}
                  onRemove={handleRemove}
                  onRetry={handleRetryPromptFor}
                  onEditContent={handleEditContent}
                  onPositionChange={handlePositionChange}
                  onSizeChange={handleSizeChange}
                  onDrag={handleNodeDrag}
                  onContextMenu={(e) => handleNodeContextMenu(e, node.id)}
                  footer={renderFooter(node)}
                />
              );
            } else if (node.type === 'image_generation') {
              const config = configOf(node);
              return (
                <ImageNode
                  key={node.id}
                  id={node.id}
                  initialX={node.x}
                  initialY={node.y}
                  title={getNodeTitle(node)}
                  imageUrl={node.data.imageUrl}
                  agentSteps={node.data.agentSteps}
                  agentName={config?.mode === 'agent' ? (config.agent_name ?? undefined) : undefined}
                  group={config?.group?.trim() || undefined}
                  isGenerating={!!node.data.isGenerating}
                  error={node.data.error}
                  isMock={node.data.isMock}
                  isFavorited={!!favoritedState[node.id]}
                  isPublic={!!publishedState[node.id]}
                  isSelected={node.id === activeImage?.id}
                  recordDeleted={staleRecordIds.has(node.id)}
                  onSelect={handleSelectImage}
                  onRemove={handleRemove}
                  onRetry={handleRetryImageFor}
                  onToggleFavorite={handleToggleFavoriteFor}
                  onTogglePublic={handleTogglePublicFor}
                  onPositionChange={handlePositionChange}
                  onSizeChange={handleSizeChange}
                  onDrag={handleNodeDrag}
                  onContextMenu={(e) => handleNodeContextMenu(e, node.id)}
                  footer={renderFooter(node)}
                />
              );
            }
            return null;
          })}
        </Canvas>

        {/* 空画布引导提示 */}
        {nodes.length === 0 && !isLoading && <EmptyCanvasHint />}

        {/* 节点右键菜单 */}
        {ctxMenu &&
          (() => {
            const node = nodes.find((n) => n.id === ctxMenu.nodeId);
            if (!node) return null;
            return (
              <NodeContextMenu
                x={ctxMenu.x}
                y={ctxMenu.y}
                title={getNodeTitle(node)}
                items={pickerItems}
                onPick={(item) => {
                  setCtxMenu(null);
                  handlePickChildFor(node.id, item);
                }}
                onDelete={() => {
                  setCtxMenu(null);
                  handleRemoveNode(node.id);
                }}
                onClose={closeContextMenu}
              />
            );
          })()}

        <IsbnInput onSubmit={handleIsbnSubmit} isLoading={isLoading} disabled={nodes.length > 0} />

        <CanvasActionBar
          hasNodes={nodes.length > 0}
          hasImage={!!activeImage?.data?.imageUrl}
          isFavorited={activeImage ? !!favoritedState[activeImage.id] : false}
          isPublic={activeImage ? !!publishedState[activeImage.id] : false}
          isMockImage={activeImage ? !!activeImage.data?.isMock : false}
          onClear={handleClear}
          onExport={handleExport}
          onFavorite={handleBarFavorite}
          onPublic={handleBarPublic}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          onAutoLayout={handleAutoLayout}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onFocus={handleFocus}
        />
      </main>
    </div>
  );
};

export default BookplatePage;
