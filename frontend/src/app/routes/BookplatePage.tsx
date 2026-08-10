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
import { PromptNode } from '../../modules/bookplate/components/PromptNode';
import { ImageNode } from '../../modules/bookplate/components/ImageNode';
import { CanvasActionBar } from '../../modules/bookplate/components/CanvasActionBar';
import { NODE_SIZES, getBookInfoPosition, getBranchNodePosition, computeAutoLayout, computeFitViewport } from '../../modules/bookplate/nodeLayout';
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
import type { BookplateEffectiveConfig, GenerationStageResults } from '../../platform/types';

type NodeType = 'bookInfo' | 'prompt' | 'image';

interface NodeData {
  id: string;
  type: NodeType;
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

  // bookplate 各阶段生效模式（agent / llm）：决定节点调用方式与中间步骤展示
  const [effectiveConfig, setEffectiveConfig] = useState<BookplateEffectiveConfig | null>(null);
  useEffect(() => {
    api
      .get<BookplateEffectiveConfig, BookplateEffectiveConfig>('/modules/bookplate/effective-config')
      .then(setEffectiveConfig)
      .catch((e) => console.error('获取阶段生效配置失败:', e));
  }, []);

  // 全局操作栏（收藏/公开/导出）的作用目标：点击 ImageNode 选中；未选中时回退到最近生成的图片节点
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);

  // 历史记录已被删除（404 或跨 tab 广播）的图片节点 id 集合：ImageNode 据此显示「记录已删除」弱提示，
  // 用户对其收藏/公开（重新生成记录）后移除
  const [staleRecordIds, setStaleRecordIds] = useState<Set<string>>(new Set());

  // 操作栏作用目标：优先选中且已有图片的 ImageNode，否则回退到最近生成的图片节点
  const selectedImageNode =
    selectedImageId &&
    nodes.some((n) => n.id === selectedImageId && n.type === 'image' && n.data?.imageUrl)
      ? nodes.find((n) => n.id === selectedImageId)
      : undefined;
  const activeImage = selectedImageNode ?? nodes.filter((n) => n.type === 'image' && n.data?.imageUrl).pop();

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

  /** 某 prompt 节点是否已有子 ImageNode（编辑/重新生成是否触发分支的前置条件） */
  const promptHasChildImage = (promptId: string): boolean =>
    edgesRef.current.some(
      (e) => e.source === promptId && nodesRef.current.find((n) => n.id === e.target)?.type === 'image'
    );

  /**
   * 第一阶段：点击「生成」后立即在画布上放置组件框（边框光束表示运行中），
   * 豆瓣 API 返回后再回填元数据；失败则在组件框内展示错误并支持重试。
   * @param nodeId 传入则复用已有组件框（重试），否则新建组件框
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
      setNodes((prev) => [
        ...prev,
        { id, type: 'bookInfo', x, y, data: { isbn, isGenerating: true, error: null } },
      ]);
    } else {
      // 重试：复用已有组件框，重新进入等待态
      updateNodeData(id, { isGenerating: true, error: null });
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

  // ---------- 第二阶段：流式生成提示词（POST + fetch 解析 SSE） ----------
  /** 对指定提示词节点发起流式生成（新建、失败重试、编辑重新生成复用同一实现）。
   *  options.image 为编辑模式上传的参考图（base64 data URL），携带时后端优先
   *  对其执行 Stage 2 封面分析，再与图书元数据合并生成提示词。 */
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

  const runPromptGeneration = (
    sourceNode: NodeData,
    promptNodeId: string,
    options?: { image?: string }
  ) => {
    // 重试防抖：该节点已有进行中的流时直接忽略（防止快速连点开启并发流导致内容重复）
    if (streamControllers.current.has(promptNodeId)) return;
    const controller = new AbortController();
    streamControllers.current.set(promptNodeId, controller);

    // 前端兜底超时：真正的「空闲超时」——每次收到数据都会重新计时，
    // 超过 PROMPT_SSE_IDLE_TIMEOUT_MS 没有任何数据则判定超时并中止
    // （后端封面分析最坏约 75s 无数据，之后提示词流每次数据都会刷新计时；
    // 用户删除节点时的 abort 除外。与后端 60s 流式读超时的关系见 timeouts.ts）
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
        metadata: sourceNode.data,
        node_id: promptNodeId,
        ...(options?.image ? { image: options.image } : {}),
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
          handleAgentSseMessage(promptNodeId, event, data);
          return;
        }
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== promptNodeId) return n;
            if (event === 'analysis') {
              return { ...n, data: { ...n.data, coverAnalysis: data } };
            }
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
        updateNodeData(promptNodeId, { isGenerating: false });
      })
      .catch((err) => {
        if (!timedOut && err?.name === 'AbortError') return; // 节点被删除 / 画布清空
        console.error('SSE stream error:', err);
        updateNodeData(promptNodeId, {
          isGenerating: false,
          error: timedOut ? '提示词生成超时，请重试' : '提示词生成失败',
        });
      })
      .finally(() => {
        if (idleTimer !== null) window.clearTimeout(idleTimer);
        streamControllers.current.delete(promptNodeId);
      });
  };

  const handleGeneratePrompt = (sourceNode: NodeData) => {
    const promptNodeId = genNodeId('prompt');
    // 兄弟级联布局：同一 bookInfo 下已有 prompt 时向下错开，避免重叠
    const siblings = sourceNode.type === 'bookInfo' ? getChildrenOfType(sourceNode.id, 'prompt') : [];
    const { x: newX, y: newY } = getBranchNodePosition(
      sourceNode, siblings, nodeSizesRef.current, 'prompt'
    );

    recordHistory();
    setNodes((prev) => [
      ...prev,
      {
        id: promptNodeId,
        type: 'prompt',
        x: newX,
        y: newY,
        data: { content: '', isGenerating: true, branchSerial: siblings.length },
      },
    ]);
    setEdges((prev) => [
      ...prev,
      { id: `edge-${sourceNode.id}-${promptNodeId}`, source: sourceNode.id, target: promptNodeId },
    ]);

    runPromptGeneration(sourceNode, promptNodeId);
  };

  // ---------- 第三阶段：生成藏书票图片 ----------
  /** Agent 模式图片生成：SSE 流式透传中间步骤，最终 image_url 事件落图 */
  const runImageGenerationAgent = async (nodeId: string, prompt: string, controller: AbortController) => {
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
        body: { prompt, node_id: nodeId },
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
                error: payload?.mock ? 'API 配置缺失，当前为演示占位图' : null
              });
              setSelectedImageId(nodeId);
              void autoSaveGeneration(nodeId, url).catch(() => undefined);
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

  const runImageGeneration = async (nodeId: string, prompt: string) => {
    // 重试防抖：该节点已有进行中的生成时直接忽略（防止快速连点开启并发请求，
    // 导致孤儿流 + 历史记录重复保存，与 runPromptGeneration 同款守卫）
    if (streamControllers.current.has(nodeId)) return;
    updateNodeData(nodeId, { isGenerating: true, imageUrl: null, error: null, agentSteps: [] });
    // 重新生成后，旧的保存快照/收藏状态失效
    delete generationIds.current[nodeId];
    setFavoritedState((prev) => ({ ...prev, [nodeId]: false }));
    setPublishedState((prev) => ({ ...prev, [nodeId]: false }));
    const controller = new AbortController();
    streamControllers.current.set(nodeId, controller);

    try {
      // Agent 模式：SSE 流式（中间步骤 + 最终 image_url 事件）
      if (effectiveConfig?.stage3?.mode === 'agent') {
        await runImageGenerationAgent(nodeId, prompt, controller);
        return;
      }
      // 图片生成耗时较长（可达 30-120s+），超时须覆盖后端最坏耗时（见 timeouts.ts）
      const res: any = await api.post(
        '/modules/bookplate/generate-image',
        { prompt, node_id: nodeId },
        {
          timeout: IMAGE_GENERATION_TIMEOUT_MS,
          signal: controller.signal,
        }
      );
      updateNodeData(nodeId, {
        imageUrl: res.image_url,
        isGenerating: false,
        error: res.mock ? 'API 配置缺失，当前为演示占位图' : null
      });
      // 新图生成成功：自动选中，使全局操作栏作用于本节点
      setSelectedImageId(nodeId);
      // 成功即自动保存一条历史记录（失败不保存），重试会新建而非覆盖
      await autoSaveGeneration(nodeId, res.image_url).catch(() => undefined);
    } catch (error: any) {
      if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') return;
      console.error('Failed to generate image:', error);
      // 超时与普通失败分开提示（拦截器保留 isTimeout 标记）；后端 502 detail 兜底展示
      updateNodeData(nodeId, {
        isGenerating: false,
        error: error?.isTimeout
          ? '图片生成超时，请重试'
          : error?.detail || '图片生成失败，请重试',
      });
    } finally {
      streamControllers.current.delete(nodeId);
    }
  };

  const handleGenerateImage = (sourceNode: NodeData) => {
    const prompt = sourceNode.data?.content?.trim();
    if (!prompt) return;

    const imageNodeId = genNodeId('image');
    // 兄弟级联布局：同一 prompt 下已有 image 时向下错开，避免重叠
    const siblings = getChildrenOfType(sourceNode.id, 'image');
    const { x: newX, y: newY } = getBranchNodePosition(
      sourceNode, siblings, nodeSizesRef.current, 'image'
    );

    recordHistory();
    setNodes((prev) => [
      ...prev,
      {
        id: imageNodeId,
        type: 'image',
        x: newX,
        y: newY,
        data: { prompt, imageUrl: null, isGenerating: true, branchSerial: siblings.length },
      },
    ]);
    setEdges((prev) => [
      ...prev,
      { id: `edge-${sourceNode.id}-${imageNodeId}`, source: sourceNode.id, target: imageNodeId },
    ]);

    runImageGeneration(imageNodeId, prompt);
  };

  /** 图片节点重试：已有图片 → 分支新建兄弟 ImageNode（同挂父 PromptNode）；
   *  错误态（无图）→ 复用原节点重新生成修复，避免留下空错误节点。 */
  const handleRetryImageBranch = (node: NodeData) => {
    const prompt = node.data?.prompt;
    if (!prompt) return;
    if (!node.data?.imageUrl) {
      runImageGeneration(node.id, prompt);
      return;
    }
    // 有图：分支新建 ImageNode，连接到同一个父 PromptNode
    const promptEdge = edgesRef.current.find((e) => e.target === node.id);
    const parent = promptEdge ? nodesRef.current.find((n) => n.id === promptEdge.source) : undefined;
    const siblings = parent ? getChildrenOfType(parent.id, 'image') : [];
    const newId = genNodeId('image');
    const { x, y } = getBranchNodePosition(parent ?? node, siblings, nodeSizesRef.current, 'image');

    recordHistory();
    setNodes((prev) => [
      ...prev,
      { id: newId, type: 'image', x, y, data: { prompt, imageUrl: null, isGenerating: true, branchSerial: siblings.length } },
    ]);
    if (parent) {
      setEdges((prev) => [
        ...prev,
        { id: `edge-${parent.id}-${newId}`, source: parent.id, target: newId },
      ]);
    }
    runImageGeneration(newId, prompt);
  };

  /** 编辑/重新生成分支：新建一个 PromptNode，共享父 BookInfoNode（或旧节点的直接父级）。
   *  opts.image 携带时新节点清空内容进入生成态，走 Stage2 封面分析 + 流式生成。
   *  opts.regenerate 为 true 时新节点也进入生成态（无参考图，仅基于图书元数据重新生成）。 */
  const branchPromptNode = (oldNode: NodeData, opts: { content?: string; image?: string; regenerate?: boolean }) => {
    const parentEdge = edgesRef.current.find((e) => e.target === oldNode.id);
    const parent = parentEdge ? nodesRef.current.find((n) => n.id === parentEdge.source) : undefined;
    const siblings = parent ? getChildrenOfType(parent.id, 'prompt') : [];
    const newId = genNodeId('prompt');
    const { x, y } = getBranchNodePosition(parent ?? oldNode, siblings, nodeSizesRef.current, 'prompt');
    const enteringGenerating = !!(opts.image || opts.regenerate);
    const data: any = enteringGenerating
      ? { content: '', coverAnalysis: undefined, isGenerating: true, error: null, branchSerial: siblings.length }
      : { content: opts.content ?? '', coverAnalysis: oldNode.data?.coverAnalysis, branchSerial: siblings.length };

    recordHistory();
    setNodes((prev) => [...prev, { id: newId, type: 'prompt', x, y, data }]);
    if (parent) {
      setEdges((prev) => [
        ...prev,
        { id: `edge-${parent.id}-${newId}`, source: parent.id, target: newId },
      ]);
    }
    if (opts.image) {
      runPromptGeneration(parent ?? ({ data: {} } as NodeData), newId, { image: opts.image });
    } else if (opts.regenerate) {
      runPromptGeneration(parent ?? ({ data: {} } as NodeData), newId);
    }
  };

  // ---------- 收藏 / 公开（保存到历史并关联） ----------
  /** 由图片节点沿连线回溯组装三阶段结果（含 Agent 中间步骤，持久化到历史记录） */
  const buildStageResults = (imageNodeId: string): GenerationStageResults | null => {
    // 读 refs 快照：稳定回调可能持有旧闭包，但这里始终拿到最新节点/连线
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const imageNode = nodes.find((n) => n.id === imageNodeId);
    if (!imageNode) return null;

    const promptEdge = edges.find((e) => e.target === imageNodeId);
    const promptNode = promptEdge ? nodes.find((n) => n.id === promptEdge.source) : undefined;
    const bookEdge = promptNode ? edges.find((e) => e.target === promptNode.id) : undefined;
    const bookNode = bookEdge ? nodes.find((n) => n.id === bookEdge.source) : undefined;

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

  /** 生成成功后自动保存到历史记录（每次成功新建一条，失败不保存）。
   *
   *  时序说明：buildStageResults 读取 nodesRef（渲染后刷新）。Agent 模式的
   *  agent_steps 在 image_url 事件之前的各 SSE 帧逐个写入（帧间已重渲染），
   *  故此处能取到完整步骤；imageUrl 为最终帧显式传入，不依赖节点状态。
   *  若未来把保存时机前移（如每步都落库），需改为从 ref 读取步骤。 */
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
    } finally {
      busyPub.current.delete(imageNodeId);
    }
  };

  // ---------- 稳定回调（配合节点组件 memo）：避免内联箭头导致未变化节点重渲染 ----------
  // 按节点 id 从实时快照（nodesRef）取节点，保证稳定闭包也能拿到最新节点。
  // 不变量：下方被引用的处理函数（handleGeneratePrompt / fetchBookInfo / runImageGeneration /
  // toggleFavoriteForImage 等）只能读取 refs / 模块函数 / 稳定 setter，否则稳定闭包会读到过期状态。
  const handleRemove = useCallback((id: string) => handleRemoveNode(id), []);
  const handleRetryBookFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node) handleRetryBook(node);
  }, []);
  const handleNextFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node) handleGeneratePrompt(node);
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
  const handleGenerateImageFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node) handleGenerateImage(node);
  }, []);
  /** 保存编辑文本：若该 prompt 节点已有子 ImageNode，则分支新建节点保留旧分支；否则原地保存 */
  const handleEditContent = useCallback((id: string, content: string) => {
    const promptNode = nodesRef.current.find((n) => n.id === id);
    if (!promptNode || promptNode.type !== 'prompt') return;
    if (!promptHasChildImage(id)) {
      recordHistory();
      updateNodeData(id, { content });
      return;
    }
    // 内容未变化时无需分支（避免误操作产生空分支节点）
    const oldContent = typeof promptNode.data?.content === 'string' ? promptNode.data.content : '';
    if (content === oldContent) return;
    // 有子图：新建 prompt 节点（共享父 BookInfoNode），旧节点及旧分支原样保留
    branchPromptNode(promptNode, { content });
  }, []);
  const handleRetryImageFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node) handleRetryImageBranch(node);
  }, []);
  /** 提示词节点重试：已有正确结果（content 非空、无错误）且已有子 ImageNode → 分支新建 PromptNode 重新生成，
   *  保留旧分支；否则复用当前节点原地重新生成。image 为上次「重新生成」上传的参考图，重试时一并携带。 */
  const handleRetryPromptFor = useCallback((id: string, image?: string) => {
    const promptNode = nodesRef.current.find((n) => n.id === id);
    if (!promptNode || promptNode.type !== 'prompt') return;
    const bookEdge = edgesRef.current.find((e) => e.target === id);
    const bookNode = bookEdge ? nodesRef.current.find((n) => n.id === bookEdge.source) : undefined;
    if (!bookNode && !image) return; // 既无图书节点也无参考图时无可生成
    const hasChildImage = promptHasChildImage(id);
    // 已有正确结果且非生成态，且有子 ImageNode：分支新建节点，旧节点及旧分支原样保留
    if (
      promptNode.data?.content &&
      !promptNode.data?.error &&
      !promptNode.data?.isGenerating &&
      hasChildImage
    ) {
      branchPromptNode(promptNode, image ? { image } : { regenerate: true });
      return;
    }
    // 失败/空态/无子节点：重置当前节点状态（含清空旧 Agent 步骤），复用同一节点原地重新生成
    recordHistory();
    updateNodeData(id, {
      content: '',
      coverAnalysis: undefined,
      isGenerating: true,
      error: null,
      agentSteps: [],
    });
    runPromptGeneration(bookNode ?? ({ data: {} } as NodeData), id, { image: image || undefined });
  }, []);

  /** 编辑模式「重新生成」：上传参考图 → Stage 2 封面分析 → 与图书元数据合并流式生成提示词。
   *  已有子 ImageNode 时分支新建 prompt 节点并流式生成（保留旧分支）；否则原地重新生成。
   *  图书节点缺失时以空元数据兜底（仅基于参考图分析生成）。 */
  const handleRegeneratePromptFor = useCallback((id: string, image?: string) => {
    const promptNode = nodesRef.current.find((n) => n.id === id);
    if (!promptNode) return;
    if (!promptHasChildImage(id)) {
      recordHistory();
      updateNodeData(id, {
        content: '',
        coverAnalysis: undefined,
        isGenerating: true,
        error: null,
        agentSteps: [],
      });
      const bookEdge = edgesRef.current.find((e) => e.target === id);
      const bookNode = bookEdge ? nodesRef.current.find((n) => n.id === bookEdge.source) : undefined;
      runPromptGeneration(bookNode ?? ({ data: {} } as NodeData), id, { image: image || undefined });
      return;
    }
    // 有子图：分支新建 prompt 节点，共享父 BookInfoNode，携带参考图流式生成
    if (image) {
      branchPromptNode(promptNode, { image });
    } else {
      // 理论不可达（重新生成必有参考图），兜底原地重新生成
      recordHistory();
      updateNodeData(id, {
        content: '',
        coverAnalysis: undefined,
        isGenerating: true,
        error: null,
        agentSteps: [],
      });
      const bookEdge = edgesRef.current.find((e) => e.target === id);
      const bookNode = bookEdge ? nodesRef.current.find((n) => n.id === bookEdge.source) : undefined;
      runPromptGeneration(bookNode ?? ({ data: {} } as NodeData), id);
    }
  }, []);
  const handleToggleFavoriteFor = useCallback((id: string) => toggleFavoriteForImage(id), []);
  const handleTogglePublicFor = useCallback((id: string) => togglePublicForImage(id), []);

  /** 点击图片节点选中（作为全局操作栏的作用目标）；仅已有图片的节点可选中，
   *  避免删除节点时按钮点击冒泡产生「幽灵选中」。 */
  const handleSelectImage = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node?.type === 'image' && node.data?.imageUrl) setSelectedImageId(id);
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
            if (node.type === 'bookInfo') {
              return (
                <BookInfoNode
                  key={node.id}
                  id={node.id}
                  initialX={node.x}
                  initialY={node.y}
                  data={node.data}
                  isGenerating={!!node.data.isGenerating}
                  error={node.data.error ?? null}
                  onRemove={handleRemove}
                  onRetry={handleRetryBookFor}
                  onDownload={handleDownloadBookData}
                  onPositionChange={handlePositionChange}
                  onSizeChange={handleSizeChange}
                  onDrag={handleNodeDrag}
                  onNext={handleNextFor}
                />
              );
            } else if (node.type === 'prompt') {
              return (
                <PromptNode
                  key={node.id}
                  id={node.id}
                  initialX={node.x}
                  initialY={node.y}
                  content={node.data.content}
                  coverAnalysis={node.data.coverAnalysis}
                  agentSteps={node.data.agentSteps}
                  agentName={
                    effectiveConfig?.stage2?.mode === 'agent'
                      ? (effectiveConfig.stage2.agent_name ?? undefined)
                      : undefined
                  }
                  isGenerating={node.data.isGenerating}
                  error={node.data.error ?? null}
                  onRemove={handleRemove}
                  onRetry={handleRetryPromptFor}
                  onPositionChange={handlePositionChange}
                  onSizeChange={handleSizeChange}
                  onDrag={handleNodeDrag}
                  onGenerateImage={handleGenerateImageFor}
                  onEditContent={handleEditContent}
                  onRegenerate={handleRegeneratePromptFor}
                />
              );
            } else if (node.type === 'image') {
              return (
                <ImageNode
                  key={node.id}
                  id={node.id}
                  initialX={node.x}
                  initialY={node.y}
                  imageUrl={node.data.imageUrl}
                  agentSteps={node.data.agentSteps}
                  agentName={
                    effectiveConfig?.stage3?.mode === 'agent'
                      ? (effectiveConfig.stage3.agent_name ?? undefined)
                      : undefined
                  }
                  isGenerating={node.data.isGenerating}
                  error={node.data.error}
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
                />
              );
            }
            return null;
          })}
        </Canvas>

        <IsbnInput onSubmit={handleIsbnSubmit} isLoading={isLoading} disabled={nodes.length > 0} />

        <CanvasActionBar
          hasNodes={nodes.length > 0}
          hasImage={!!activeImage?.data?.imageUrl}
          isFavorited={activeImage ? !!favoritedState[activeImage.id] : false}
          isPublic={activeImage ? !!publishedState[activeImage.id] : false}
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
