import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useCanvasState,
  getCanvasEventKey,
  streamControllers,
  analysisUploads,
  nodesRef,
  edgesRef,
  type CanvasDeleteEvent,
} from '../../platform/stores/useCanvasState';
import { useAuth } from '../../platform/stores/authStore';
import { Navbar } from '../../platform/components/layout/Navbar';
import { Canvas } from '../../platform/components/canvas/Canvas';
import { IsbnInput } from '../../modules/bookplate/components/IsbnInput';
import { CanvasActionBar } from '../../modules/bookplate/components/CanvasActionBar';
import { AddNodeButton, type NodePickerItem } from '../../modules/bookplate/components/AddNodeButton';
import { NodePickerList } from '../../modules/bookplate/components/NodePickerList';
import NodeContextMenu from '../../modules/bookplate/components/NodeContextMenu';
import EmptyCanvasHint from '../../modules/bookplate/components/EmptyCanvasHint';
import {
  getBookInfoPosition,
  getBranchNodePosition,
  computeAutoLayout,
  computeFitViewport,
} from '../../modules/bookplate/nodeLayout';
import {
  NODE_TEMPLATES,
  NODE_PORT_TYPES,
  getNodeTitle,
  matchPortType,
  nodeOutputText,
  resolveDirectParents,
} from '../../modules/bookplate/nodeTypes';
import {
  AGGREGATE_DEFAULT_TEMPLATE,
  renderAggregateTemplate,
  syncAggregatePlaceholders,
} from '../../modules/bookplate/textTemplate';
import {
  DEFAULT_RUN_SETTINGS,
  collectNodeInputs,
  resolveReferenceImage,
  type PortTypesLookup,
} from '../../modules/bookplate/execution';
import {
  DEFAULT_SIZES,
  bookInfoInflight,
  selfHealNode,
  type EdgeData,
  type NodeData,
  type NodeSize,
  type NodeType,
} from '../../modules/bookplate/graphTypes';
import { useCanvasHistory } from '../../modules/bookplate/useCanvasHistory';
import { useGenerationHistory } from '../../modules/bookplate/useGenerationHistory';
import { useNodeExecution } from '../../modules/bookplate/useNodeExecution';
import { useManualConnection } from '../../modules/bookplate/useManualConnection';
import ConnectionGhost from '../../modules/bookplate/ConnectionGhost';
import { renderCanvasNode, type NodeViewHelpers } from '../../modules/bookplate/CanvasNodeViews';
import type { ZhihuSearchRequest } from '../../modules/bookplate/components/ZhihuSearchNode';
import type { WikipediaSearchRequest } from '../../modules/bookplate/components/WikipediaSearchNode';
import { MAP_POSTER_DEFAULTS } from '../../modules/multimodal/map/defaults';
import { NodeEdge, type NodeEdgeHandle } from '../../platform/components/node/NodeEdge';
import { useFeedback } from '../../platform/components/ui/FeedbackProvider';
import api from '../../platform/services/api';
import generationsService from '../../platform/services/generations';
import { ISBN_FETCH_TIMEOUT_MS, SMALL_TOOL_TIMEOUT_MS } from '../../platform/utils/timeouts';
import type {
  CanvasNodeType,
  ChatNodeSettings,
  NodePortType,
  NodeRegistry,
  NodeRunSettings,
  PromptSelection,
  RegistryNodeConfig,
  SkillSelection,
} from '../../platform/types';

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

  // 端口类型（输出/输入）：后端 node_types.py 模板声明（唯一权威），经 node-registry 下发；
  // 前端 NODE_PORT_TYPES 静态镜像兜底（注册表异步加载期间 + 管理页展示），驱动连线类型匹配校验
  const portTypesOf = useCallback(
    (type: CanvasNodeType): { output: NodePortType; inputs: NodePortType[] } => {
      const t = registry.templates.find((bt) => bt.type === type);
      return {
        output: t?.output_type ?? NODE_PORT_TYPES[type].output,
        inputs: t?.input_types ?? NODE_PORT_TYPES[type].inputs,
      };
    },
    [registry.templates]
  );
  const portTypesRef = useRef<PortTypesLookup>(portTypesOf);
  portTypesRef.current = portTypesOf;

  // 一致性检查：可配置模板应收到后端 output_type / input_types 声明（缺失时回退静态镜像，仅警告一次）
  const warnedPortDrift = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (registry.templates.length === 0) return;
    for (const t of NODE_TEMPLATES) {
      if (!t.configurable) continue;
      const bt = registry.templates.find((x) => x.type === t.type);
      if (bt && (!bt.output_type || !bt.input_types) && !warnedPortDrift.current.has(t.type)) {
        warnedPortDrift.current.add(t.type);
        console.warn(
          `[节点端口] 模板「${t.type}」未收到后端 output_type/input_types 声明，将使用前端静态镜像`
        );
      }
    }
  }, [registry.templates]);

  // 全局操作栏（收藏/公开/导出）的作用目标：点击 ImageNode 选中；未选中时回退到最近生成的图片节点
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);

  // 历史记录已被删除（404 或跨 tab 广播）的图片节点 id 集合：ImageNode 据此显示「记录已删除」弱提示
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
  const activeImage =
    selectedImageNode ??
    nodes.filter((n) => n.type === 'image_generation' && n.data?.imageUrl).pop();

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
  }, [setScale]);
  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - 0.2, 0.1));
  }, [setScale]);
  const handleFocus = useCallback(() => {
    setPosition({ x: 0, y: 0 });
    setScale(1);
  }, [setPosition, setScale]);

  // ---------- 收藏/公开状态同步（服务端 + 跨 tab） ----------
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
  }, [generationIds, setFavoritedState, setPublishedState, setStaleRecordIds]);

  /** 从服务端同步各图片节点的收藏/公开状态（挂载与撤销恢复后调用） */
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
  }, [invalidateGenerationLink, generationIds, setFavoritedState, setPublishedState]);

  useEffect(() => {
    void syncFavoritesFromServer();
  }, [syncFavoritesFromServer]);

  // 跨 tab 联动：history/收藏/画廊页在其他 tab 删除记录后写入事件 key，本 tab 实时失效对应节点关联
  useEffect(() => {
    const eventKey = getCanvasEventKey(String(user?.id ?? 'anon'));
    const onStorage = (e: StorageEvent) => {
      if (e.key !== eventKey || !e.newValue) return;
      try {
        const payload: CanvasDeleteEvent = JSON.parse(e.newValue);
        if (typeof payload?.genId !== 'number') return;
        for (const [nodeId, genId] of Object.entries(generationIds.current)) {
          if (genId === payload.genId) invalidateGenerationLink(nodeId);
        }
      } catch {
        /* 负载损坏，忽略 */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user?.id, invalidateGenerationLink, generationIds]);

  // ---------- 共享 refs（拖拽 / 执行 / 历史共用） ----------
  // 注意：streamControllers / analysisUploads / nodesRef / edgesRef 为模块级单例（见 useCanvasState），
  // 不随组件卸载销毁——切页后进行中的生成流继续在后台运行，完成结果直接写入模块级 store 与
  // sessionStorage；返回画布时由下方挂载自愈识别「仍有活动流的节点」而保持不动。
  // 登出 / 切换账号时的流中止由 authStore.applySessionUser 统一兜底：本组件会随路由守卫在
  // 同一 commit 卸载，组件内 effect 无法可靠触发。
  const edgeRefs = useRef<Map<string, NodeEdgeHandle>>(new Map());

  /** 更新节点 data（浅合并 patch） */
  const updateNodeData = (id: string, patch: Record<string, any>) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  };

  // ---------- 撤销 / 重做 ----------
  // ctx 经 useMemo 保持稳定（内部均为模块级 ref / React setter / 稳定回调），
  // 使 useCanvasHistory 内部的 recordHistory / undo / redo 不随渲染重建
  const historyCtx = useMemo(
    () => ({
      nodesRef,
      edgesRef,
      generationIds,
      streamControllers,
      setNodes,
      setEdges,
      setSelectedImageId,
      setStaleRecordIds,
      syncFavoritesFromServer,
    }),
    // nodesRef / edgesRef / streamControllers 为模块级单例（useCanvasState），身份恒定，无需列入
    [
      generationIds,
      setNodes,
      setEdges,
      setSelectedImageId,
      setStaleRecordIds,
      syncFavoritesFromServer,
    ]
  );
  const { undo, redo, recordHistory, canUndo, canRedo } = useCanvasHistory(historyCtx);

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

  // ---------- 历史记录组装 / 执行引擎 ----------
  const { autoSaveGeneration, ensureGeneration } = useGenerationHistory({
    nodesRef,
    edgesRef,
    generationIds,
  });

  const { runNode, runImageGeneration } = useNodeExecution({
    nodesRef,
    edgesRef,
    portTypesRef,
    streamControllers,
    analysisUploads,
    registryConfigsRef,
    updateNodeData,
    setNodes,
    setSelectedImageId,
    setFavoritedState,
    setPublishedState,
    generationIds,
    autoSaveGeneration,
  });
  // AI 对话节点执行（多轮 useChat）由每节点的 ChatNodeHost 承载（见 CanvasNodeViews），
  // 此处仅注入其依赖（state setter + 端口类型查找）
  const chatDeps = { setNodes, portTypesRef };

  // 手动拖线连线：按住节点右侧连接点拖到目标节点左侧连接点创建连线（可撤销、防重、防环）
  const { connecting, ghostRef, onAnchorPointerDown } = useManualConnection({
    nodesRef,
    edgesRef,
    portTypesRef,
    setEdges,
    recordHistory,
    showToast,
  });

  const handleSizeChange = useCallback((id: string, width: number, height: number) => {
    setNodeSizes((prev) => {
      const cur = prev[id];
      if (cur && Math.abs(cur.width - width) < 1 && Math.abs(cur.height - height) < 1) {
        return prev;
      }
      return { ...prev, [id]: { width, height } };
    });
  }, [setNodeSizes]);

  /** 生成唯一节点 id（时间戳 + 随机后缀，避免快速连点同毫秒碰撞） */
  const genNodeId = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

  /**
   * 第一阶段：点击「生成」后立即在画布上放置组件框（边框光束表示运行中），
   * 豆瓣 API 返回后再回填元数据；失败则在组件框内展示错误并支持重试。
   *
   * @param opts.force 强制从豆瓣 API 重新获取并覆盖缓存
   */
  const fetchBookInfo = async (isbn: string, nodeId?: string, opts?: { force?: boolean }) => {
    const id = nodeId ?? `node-${Date.now()}-${isbn}`;
    if (bookInfoInflight.has(id)) return;
    bookInfoInflight.add(id);
    setIsLoading(true);

    if (!nodeId) {
      const { x, y } = getBookInfoPosition();
      recordHistory();
      const newNode: NodeData = { id, type: 'book_info', x, y, data: { isbn, isGenerating: true, error: null } };
      setNodes((prev) => [...prev, newNode]);
      focusOnNode(newNode);
    } else {
      updateNodeData(id, { isbn, isGenerating: true, error: null });
    }

    const controller = new AbortController();
    streamControllers.current.set(id, controller);

    try {
      const params: Record<string, any> = {};
      if (opts?.force) params.force = true;
      const response: any = await api.get(`/modules/bookplate/isbn/${isbn}`, {
        params,
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
    setSelectedImageId((prev) => (prev && idSet.has(prev) ? null : prev));
  };

  const handleRemoveEdge = useCallback(
    (edgeId: string) => {
      recordHistory();
      setEdges((prev) => prev.filter((e) => e.id !== edgeId));
    },
    [recordHistory, setEdges]
  );

  const handleRemoveNode = (id: string) => {
    const ids = collectDescendantIds(id);
    if (ids.length > 1) {
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

  /** 拖拽落点提交：无实际移动（单纯点击）不记历史；记录一步以便「拖错回退」 */
  const handlePositionChange = useCallback((id: string, x: number, y: number) => {
    const cur = nodesRef.current.find((n) => n.id === id);
    if (cur && Math.abs(cur.x - x) < 0.5 && Math.abs(cur.y - y) < 0.5) return;
    recordHistory();
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
  }, [recordHistory, setNodes]);

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

  // ---------- 通用节点创建 ----------
  /** 新节点的初始数据（按模板类型；孤立节点（无连线创建）时 includeBook 默认关闭，有任何上级连线时默认开启） */
  const seedDataFor = (type: NodeType, parent?: NodeData): any => {
    const runSettings = (): NodeRunSettings => ({
      includeBook: !!parent,
    });
    switch (type) {
      case 'book_info':
        return { isbn: '', isGenerating: false, error: null };
      case 'image_analysis':
        return {
          analysis: undefined,
          isGenerating: false,
          error: null,
          agentSteps: [],
          settings: runSettings(),
        };
      case 'prompt_generation':
        return {
          content: '',
          isGenerating: false,
          error: null,
          agentSteps: [],
          settings: runSettings(),
        };
      case 'image_generation':
        return {
          prompt: '',
          imageUrl: null,
          isGenerating: false,
          error: null,
          agentSteps: [],
          settings: runSettings(),
        };
      case 'text':
        return { content: '', error: null };
      case 'image_upload':
        return { imageUrl: null, imageName: '', error: null };
      case 'chat':
        return {
          messages: [],
          output: '',
          isGenerating: false,
          error: null,
          agentSteps: [],
          settings: { includeBook: !!parent, includeUpstream: true, includeUpstreamImages: true, includeBookCover: true },
          epoch: 0,
        };
      case 'text_aggregate':
        return {
          template: AGGREGATE_DEFAULT_TEMPLATE,
          placeholders: {},
          output: '',
          error: null,
        };
      case 'prompt_search':
        return { promptId: null, promptName: '', content: '', promptImage: null, error: null };
      case 'skill_search':
        return {
          skillSelections: [],
          error: null,
        };
      case 'calendar':
        return { output: '', date: '', isGenerating: false, error: null };
      case 'weather':
        return { output: '', city: '', isGenerating: false, error: null };
      case 'zhihu_search':
        return {
          mode: 'zhihu',
          query: '',
          tabData: {
            zhihu: { output: '', error: null, isGenerating: false, count: 5 },
            global: { output: '', error: null, isGenerating: false, count: 5, filter: '', search_db: 'all' },
            zhida: { output: '', error: null, isGenerating: false, model: 'zhida-fast-1p5' },
          },
          output: '',
          isGenerating: false,
          error: null,
        };
      case 'wikipedia_search':
        return {
          language: 'zh',
          query: '',
          limit: 10,
          results: [],
          articleTitle: '',
          summaryMode: false,
          output: '',
          isGenerating: false,
          error: null,
        };
      case 'map_poster':
        return { imageUrl: null, error: null, ...MAP_POSTER_DEFAULTS };
      case 'image_search':
        return {
          provider: 'unsplash',
          imageUrl: null,
          selectedImage: null,
          error: null,
        };
      case 'art_image_search':
        return {
          provider: 'met',
          imageUrl: null,
          selectedImage: null,
          error: null,
        };
      }
  };

  /**
   * 节点添加核心入口：在父节点下新建一个节点并连线（picker 新建与分支复制共用）。
   * 统一处理：兄弟位置排布（branchSerial 自动附加）、记历史、同步 refs/state、
   * 可选沿用上传参考图、可选创建后立即执行、自动聚焦。
   */
  const addChildNode = (
    parent: NodeData,
    opts: {
      type: NodeType;
      data: Record<string, any>;
      configId?: number;
      configName?: string;
      /** 创建后立即执行（仅当节点开启「自动运行」时传入；分支按需传入） */
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
    nodesRef.current = [...nodesRef.current, newNode];
    edgesRef.current = [...edgesRef.current, newEdge];
    setNodes((prev) => [...prev, newNode]);
    setEdges((prev) => [...prev, newEdge]);

    opts.run?.(newNode);
    focusOnNode(newNode);
  };

  /** 稳定回调：按节点 id 创建子节点（供 AddNodeButton / 右键菜单使用） */
  const handlePickChildFor = useCallback((nodeId: string, item: NodePickerItem) => {
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    addChildNode(node, {
      type: item.nodeType,
      data: seedDataFor(item.nodeType, node),
      configId: item.configId,
      configName: item.configId ? item.label : undefined,
    });
    // 稳定回调设计：addChildNode 仅读取 refs / 稳定 setter，闭包不会过期
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 「+」菜单可选项：基础模板 + 各已配置变体（完全由后台配置驱动，未配置不展示） */
  const pickerItems = useMemo<NodePickerItem[]>(() => {
    const items: NodePickerItem[] = [];
    for (const t of NODE_TEMPLATES) {
      if (!t.configurable) {
        items.push({ key: t.type, nodeType: t.type, label: t.name, description: t.description });
        continue;
      }
      const configs = registryConfigs.filter((c) => c.node_type === t.type);
      for (const c of configs) {
        items.push({
          key: `${t.type}-${c.id}`,
          nodeType: t.type,
          label: c.name,
          description: c.agent_name
            ? `Agent · ${c.agent_name}`
            : c.skill_agent_config_name
              ? `Skill Agent · ${c.skill_agent_config_name}`
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
    return items;
  }, [registryConfigs]);

  /** 节点的绑定配置（用于展示 agent 名 / 决定执行模式） */
  const configOf = (node: NodeData): RegistryNodeConfig | undefined =>
    node.configId != null
      ? registryConfigs.find((c) => c.id === node.configId)
      : undefined;

  // ---------- 自愈：挂载 / 用户切换时复位「残留的生成中」节点 ----------
  // 画布状态持久化在 sessionStorage，整页刷新 / 崩溃 / 页面直关等路径会残留上次会话的生成中标记。
  // 切页往返路径的流仍在后台运行（模块级 streamControllers 存活），故以 hasActiveStream 判断：
  // 仍有活动流的节点是「正在正常生成」，保持不动；无活动流的节点才是残留，安全复位——
  // 置失败提示由用户重试。
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => selfHealNode(n, streamControllers.current.has(n.id)))
    );
  }, [setNodes, user?.id]);


  // ---------- 文本聚合节点：自动重算输出（纯文本变换，不调 API） ----------
  // 上级内容 / 连线变化时即时重算聚合结果并同步占位符映射（新上级补默认别名、断开的移除）。
  // 只写入实际变化的字段，避免无意义渲染；写入后 nodes 变化触发本 effect 重跑，二次无变化即收敛。
  useEffect(() => {
    const patches: Record<string, Record<string, any>> = {};
    for (const node of nodesRef.current) {
      if (node.type !== 'text_aggregate') continue;
      const parents = resolveDirectParents(node.id, nodesRef.current, edgesRef.current);
      const placeholders = syncAggregatePlaceholders(node, parents, portTypesOf);
      const output = renderAggregateTemplate(
        typeof node.data?.template === 'string' ? node.data.template : '',
        parents,
        placeholders
      );
      const patch: Record<string, any> = {};
      if (JSON.stringify(placeholders) !== JSON.stringify(node.data?.placeholders ?? {})) {
        patch.placeholders = placeholders;
      }
      if (output !== (node.data?.output ?? '')) patch.output = output;
      if (Object.keys(patch).length > 0) patches[node.id] = patch;
    }
    if (Object.keys(patches).length > 0) {
      setNodes((prev) =>
        prev.map((n) => (patches[n.id] ? { ...n, data: { ...n.data, ...patches[n.id] } } : n))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, portTypesOf]);

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

  // ---------- 画布独立节点菜单 ----------
  const [standaloneMenu, setStandaloneMenu] = useState<{ x: number; y: number; canvasX: number; canvasY: number } | null>(null);

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setStandaloneMenu({ 
      x: e.clientX, 
      y: e.clientY, 
      canvasX: (e.clientX - positionRef.current.x) / scaleRef.current, 
      canvasY: (e.clientY - positionRef.current.y) / scaleRef.current 
    });
    setCtxMenu(null);
  }, []);

  useEffect(() => {
    if (!standaloneMenu) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('[data-standalone-menu]')) return;
      setStandaloneMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStandaloneMenu(null);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [standaloneMenu]);

  const handleAddStandaloneNode = useCallback((item: NodePickerItem, canvasX: number, canvasY: number) => {
    const newId = genNodeId(item.nodeType);
    const newNode: NodeData = {
      id: newId,
      type: item.nodeType,
      configId: item.configId,
      configName: item.configId ? item.label : undefined,
      x: canvasX,
      y: canvasY,
      data: seedDataFor(item.nodeType),
    };
    
    recordHistory();
    nodesRef.current = [...nodesRef.current, newNode];
    setNodes((prev) => [...prev, newNode]);


    
    focusOnNode(newNode);
    setStandaloneMenu(null);
    // 稳定回调设计：focusOnNode 仅读取 refs / 稳定 setter，闭包不会过期
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordHistory, setNodes]);

  // ---------- 节点右键菜单 ----------
  const handleNodeContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!nodesRef.current.some((n) => n.id === nodeId)) return;
    setCtxMenu({ x: e.clientX, y: e.clientY, nodeId });
  }, []);
  const closeContextMenu = useCallback(() => setCtxMenu(null), []);

  // ---------- 收藏 / 公开 ----------
  const clearStaleFlag = useCallback((imageNodeId: string) => {
    setStaleRecordIds((prev) => {
      if (!prev.has(imageNodeId)) return prev;
      const next = new Set(prev);
      next.delete(imageNodeId);
      return next;
    });
  }, []);

  const toggleFavoriteForImage = async (imageNodeId: string): Promise<boolean> => {
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
  // 不变量：下方被引用的处理函数只能读取 refs / 模块函数 / 稳定 setter；依赖数组刻意保持
  // []（eslint-disable exhaustive-deps）：被引用函数虽为普通函数，但仅读取 refs / 稳定 setter，
  // 闭包不会过期；若把普通函数加入依赖会导致回调每渲染重建，破坏节点 memo。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleRemove = useCallback((id: string) => handleRemoveNode(id), []);
  const handleRetryBookFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node) handleRetryBook(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleFetchBookFor = useCallback((id: string, isbn: string) => {
    fetchBookInfo(isbn, id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleForceRefreshBookFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    const isbn = node?.data?.isbn;
    if (!isbn) return;
    fetchBookInfo(isbn, id, { force: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleDownloadBookData = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || !node.data) return;
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
    const oldContent = typeof promptNode.data?.content === 'string' ? promptNode.data.content : '';
    if (content === oldContent) return;
    branchPromptNode(promptNode, { content });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** 提示词节点重试/重新生成：从上游重新收集输入并流式生成 */
  const handleRetryPromptFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node && node.type === 'prompt_generation') runNode(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** 图片分析节点执行/重试：已有正确结果时「再次分析」新建兄弟节点保留旧分支；失败/空态原地执行 */
  const handleRunAnalysisFor = useCallback((id: string, image?: string) => {
    if (image) analysisUploads.current.set(id, image);
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'image_analysis') return;
    if (node.data?.analysis && !node.data?.error) {
      branchAnalysisNode(node);
      return;
    }
    runNode(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleRetryImageFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'image_generation') return;
    if (node.data?.imageUrl && !node.data?.isMock) {
      branchImageNode(node);
      return;
    }
    runNode(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleToggleFavoriteFor = useCallback((id: string) => toggleFavoriteForImage(id), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleTogglePublicFor = useCallback((id: string) => togglePublicForImage(id), []);
  /** 文本节点保存编辑内容（无需分支，原地保存；内容未变化不记历史） */
  const handleEditTextFor = useCallback((id: string, content: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'text') return;
    const oldContent = typeof node.data?.content === 'string' ? node.data.content : '';
    if (content === oldContent) return;
    recordHistory();
    updateNodeData(id, { content });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** AI 对话节点：更新上下文加载设置（未变化不记历史） */
  const handleUpdateChatSettingsFor = useCallback((id: string, settings: ChatNodeSettings) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'chat') return;
    const old = node.data?.settings ?? {
      includeBook: false,
      includeUpstream: true,
      includeUpstreamImages: true,
      includeBookCover: true,
    };
    if (JSON.stringify(old) === JSON.stringify(settings)) return;
    recordHistory();
    updateNodeData(id, { settings });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** AI 对话节点：清空对话（递增会话纪元，Agent 模式下重置 FastClaw 服务端会话） */
  const handleClearChatFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'chat') return;
    const hasMessages = Array.isArray(node.data?.messages) && node.data.messages.length > 0;
    if (!hasMessages) return;
    recordHistory();
    updateNodeData(id, {
      messages: [],
      output: '',
      agentSteps: [],
      error: null,
      epoch: (node.data?.epoch ?? 0) + 1,
      // 干净对话 -> 干净工作区：重新生成 workspaceId，后端以新目录装配（Skill Agent 产物不残留）
      workspaceId: `${id}_${Date.now()}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** 图片上传节点上传 / 替换 / 移除图片（imageUrl 为 null 表示移除；未变化不记历史） */
  const handleImageChangeFor = useCallback(
    (id: string, imageUrl: string | null, imageName: string) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== 'image_upload') return;

      const descIds = collectDescendantIds(id);
      const hasDownstream = descIds.length > 1;

      if (imageUrl === null) {
        handleRemoveNode(id);
        return;
      } else if (node.data?.imageUrl && hasDownstream) {
        return;
      }

      const curUrl = node.data?.imageUrl ?? null;
      const curName = node.data?.imageName ?? '';
      if (curUrl === imageUrl && curName === imageName) return;
      recordHistory();
      updateNodeData(id, { imageUrl, imageName });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  /** 点击图片节点选中（作为全局操作栏的作用目标）；仅已有图片的节点可选中 */
  const handleSelectImage = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node?.type === 'image_generation' && node.data?.imageUrl) setSelectedImageId(id);
  }, []);

  /** 手动「运行」：输入不足时 toast 明确原因（含类型不匹配提示） */
  const handleRunFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.data?.isGenerating) return;
    const reason = runNode(node);
    if (reason) showToast(reason, { type: 'warning', position: 'top-right' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Skill 检索节点：整块替换已选 skill 集合（写入 data.skillSelections；未变化不记历史）。
   *  旧单数字段节点（skillName 等）重新编辑即迁移为数组；读取侧默认空数组向后兼容。 */
  const handleUpdateSkillsFor = useCallback(
    (id: string, selections: SkillSelection[]) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== 'skill_search') return;
      const old = Array.isArray(node.data?.skillSelections) ? node.data.skillSelections : [];
      if (JSON.stringify(old) === JSON.stringify(selections)) return;
      recordHistory();
      updateNodeData(id, { skillSelections: selections });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** 万年历节点：按日期查询节假日 / 农历万年历（结果写入 data.output，供下游消费） */
  const handleFetchCalendarFor = useCallback((id: string, date: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'calendar' || node.data?.isGenerating) return;
    updateNodeData(id, { isGenerating: true, error: null, date });
    api
      .post('/modules/bookplate/calendar', { date }, { timeout: SMALL_TOOL_TIMEOUT_MS })
      .then((res: any) => {
        updateNodeData(id, {
          output: typeof res?.output === 'string' ? res.output : '',
          isGenerating: false,
          error: null,
        });
      })
      .catch((error: any) => {
        console.error('Failed to fetch calendar:', error);
        updateNodeData(id, {
          isGenerating: false,
          error: error?.isTimeout ? '万年历查询超时，请重试' : error?.detail || '万年历查询失败，请重试',
        });
      });
    // 稳定回调设计：仅读取 refs / 稳定 setter，闭包不会过期
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 天气查询节点：按城市查询当前天气（城市 = 连线上级文本 > 手动输入；留空自动定位） */
  const handleFetchWeatherFor = useCallback((id: string, city: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'weather' || node.data?.isGenerating) return;
    const parents = resolveDirectParents(id, nodesRef.current, edgesRef.current);
    const upstreamCity = parents.map((p) => nodeOutputText(p)).find((v) => v.trim()) ?? '';
    const finalCity = upstreamCity || city;
    updateNodeData(id, { isGenerating: true, error: null, city });
    api
      .post('/modules/bookplate/weather', { city: finalCity }, { timeout: SMALL_TOOL_TIMEOUT_MS })
      .then((res: any) => {
        updateNodeData(id, {
          output: typeof res?.output === 'string' ? res.output : '',
          isGenerating: false,
          error: null,
        });
      })
      .catch((error: any) => {
        console.error('Failed to fetch weather:', error);
        updateNodeData(id, {
          isGenerating: false,
          error: error?.isTimeout ? '天气查询超时，请重试' : error?.detail || '天气查询失败，请重试',
        });
      });
    // 稳定回调设计：仅读取 refs / 稳定 setter，闭包不会过期
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 知乎检索节点：按模式检索 / 直答（关键词 = 连线上级文本 > 手动输入；按模式隔离 tabData，对外输出当前 active mode 结果） */
  const handleFetchZhihuFor = useCallback((id: string, payload: ZhihuSearchRequest) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'zhihu_search') return;
    const curData = node.data ?? {};
    const curTabData = curData.tabData ?? {};
    const targetMode = payload.mode;
    if (curTabData[targetMode]?.isGenerating) return;

    const parents = resolveDirectParents(id, nodesRef.current, edgesRef.current);
    const upstreamQuery = parents.map((p) => nodeOutputText(p)).find((v) => v.trim()) ?? '';
    const finalQuery = upstreamQuery || payload.query.trim();
    if (!finalQuery) return;

    const newTargetTabData = {
      ...(curTabData[targetMode] || {}),
      count: payload.count,
      filter: payload.filter,
      search_db: payload.search_db,
      model: payload.model,
      isGenerating: true,
      error: null,
    };

    const nextTabData = {
      ...curTabData,
      [targetMode]: newTargetTabData,
    };

    const isCurrentActive = (curData.mode ?? 'zhihu') === targetMode;

    updateNodeData(id, {
      query: payload.query,
      tabData: nextTabData,
      ...(isCurrentActive
        ? {
            isGenerating: true,
            error: null,
          }
        : {}),
    });

    api
      .post(
        '/modules/bookplate/zhihu-search',
        { ...payload, query: finalQuery },
        { timeout: SMALL_TOOL_TIMEOUT_MS }
      )
      .then((res: any) => {
        const latestNode = nodesRef.current.find((n) => n.id === id);
        const latestData = latestNode?.data ?? {};
        const latestTabData = latestData.tabData ?? nextTabData;
        const outputText = typeof res?.output === 'string' ? res.output : '';

        const finishedTargetTabData = {
          ...(latestTabData[targetMode] || {}),
          output: outputText,
          isGenerating: false,
          error: null,
        };

        const updatedTabData = {
          ...latestTabData,
          [targetMode]: finishedTargetTabData,
        };

        const isStillActive = (latestData.mode ?? 'zhihu') === targetMode;

        updateNodeData(id, {
          tabData: updatedTabData,
          ...(isStillActive
            ? {
                output: outputText,
                isGenerating: false,
                error: null,
              }
            : {}),
        });
      })
      .catch((error: any) => {
        console.error('Failed to fetch zhihu:', error);
        const latestNode = nodesRef.current.find((n) => n.id === id);
        const latestData = latestNode?.data ?? {};
        const latestTabData = latestData.tabData ?? nextTabData;
        const errDetail = error?.isTimeout ? '知乎检索超时，请重试' : error?.detail || '知乎检索失败，请重试';

        const erroredTargetTabData = {
          ...(latestTabData[targetMode] || {}),
          isGenerating: false,
          error: errDetail,
        };

        const updatedTabData = {
          ...latestTabData,
          [targetMode]: erroredTargetTabData,
        };

        const isStillActive = (latestData.mode ?? 'zhihu') === targetMode;

        updateNodeData(id, {
          tabData: updatedTabData,
          ...(isStillActive
            ? {
                isGenerating: false,
                error: errDetail,
              }
            : {}),
        });
      });
    // 稳定回调设计：仅读取 refs / 稳定 setter，闭包不会过期
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 知乎检索节点：编辑器状态（tabData / mode / query 等）写入 node.data（仅持久化，不记撤销历史） */
  const handleUpdateZhihuEditorFor = useCallback(
    (id: string, patch: Record<string, any>, undoable: boolean = false) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== 'zhihu_search') return;
      const cur = node.data ?? {};
      let changed = false;
      for (const [k, v] of Object.entries(patch)) {
        if (cur[k] !== v) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      if (undoable) recordHistory();
      updateNodeData(id, patch);
      // 稳定回调设计：仅读取 refs / 稳定 setter，闭包不会过期
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Wikipedia 检索节点：关键词检索（关键词 = 连线上级文本 > 手动输入；结果列表写入 data.results） */
  const handleSearchWikipediaFor = useCallback((id: string, payload: WikipediaSearchRequest) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'wikipedia_search' || node.data?.isGenerating) return;
    const parents = resolveDirectParents(id, nodesRef.current, edgesRef.current);
    const upstreamKeyword = parents.map((p) => nodeOutputText(p)).find((v) => v.trim()) ?? '';
    const finalQuery = upstreamKeyword || payload.query.trim();
    if (!finalQuery) return;
    updateNodeData(id, {
      language: payload.language,
      query: payload.query,
      limit: payload.limit,
      // 新检索使旧文章全文失效
      articleTitle: '',
      output: '',
      results: [],
      isGenerating: true,
      error: null,
    });
    api
      .post(
        '/modules/bookplate/wikipedia-search',
        { ...payload, query: finalQuery },
        { timeout: SMALL_TOOL_TIMEOUT_MS }
      )
      .then((res: any) => {
        updateNodeData(id, {
          results: Array.isArray(res?.results) ? res.results : [],
          isGenerating: false,
          error: null,
        });
      })
      .catch((error: any) => {
        console.error('Failed to search wikipedia:', error);
        updateNodeData(id, {
          isGenerating: false,
          error: error?.isTimeout ? 'Wikipedia 检索超时，请重试' : error?.detail || 'Wikipedia 检索失败，请重试',
        });
      });
    // 稳定回调设计：仅读取 refs / 稳定 setter，闭包不会过期
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Wikipedia 检索节点：打开一篇检索结果的文章（summary=true 走简介，false 走全文；正文写入 data.output） */
  const handleOpenWikipediaArticleFor = useCallback((id: string, title: string, summary?: boolean) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'wikipedia_search' || node.data?.isGenerating) return;
    const language = node.data?.language ?? 'zh';
    updateNodeData(id, { articleTitle: title, isGenerating: true, error: null });
    api
      .post(
        '/modules/bookplate/wikipedia-article',
        { title, language, summary: !!summary },
        { timeout: SMALL_TOOL_TIMEOUT_MS }
      )
      .then((res: any) => {
        updateNodeData(id, {
          output: typeof res?.content === 'string' ? res.content : '',
          isGenerating: false,
          error: null,
        });
      })
      .catch((error: any) => {
        console.error('Failed to fetch wikipedia article:', error);
        updateNodeData(id, {
          isGenerating: false,
          error: error?.isTimeout ? 'Wikipedia 全文获取超时，请重试' : error?.detail || 'Wikipedia 全文获取失败，请重试',
        });
      });
    // 稳定回调设计：仅读取 refs / 稳定 setter，闭包不会过期
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Wikipedia 检索节点：从全文视图返回检索结果列表（仅切视图，保留 data.output 供下游继续消费） */
  const handleBackToWikipediaResultsFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'wikipedia_search') return;
    if (!(node.data?.articleTitle ?? '')) return;
    updateNodeData(id, { articleTitle: '' });
    // 稳定回调设计：仅读取 refs / 稳定 setter，闭包不会过期
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Wikipedia 检索节点：编辑器状态写入 node.data（summaryMode 等切换，仅持久化，不记撤销历史） */
  const handleUpdateWikipediaEditorFor = useCallback((id: string, patch: Record<string, any>) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'wikipedia_search') return;
    updateNodeData(id, patch);
    // 稳定回调设计：仅读取 refs / 稳定 setter，闭包不会过期
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 地图海报节点：编辑器状态（主题/尺寸/文字/视口）写入 node.data（画布快照持久化，切页保持）。
   *  undoable=true 的离散编辑（主题/尺寸/文字/地点）记撤销历史；平移/缩放仅持久化不记历史，
   *  避免频繁 pan 污染撤销栈（与万年历 date 字段同口径）。 */
  const handleUpdateMapPosterEditorFor = useCallback(
    (id: string, patch: Record<string, any>, undoable: boolean) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== 'map_poster') return;
      const cur = node.data ?? {};
      // 未变化不记历史/不写回（与文本/设置等节点口径一致）
      let changed = false;
      for (const [k, v] of Object.entries(patch)) {
        if (cur[k] !== v) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      if (undoable) recordHistory();
      updateNodeData(id, patch);
      // 稳定回调设计：仅读取 refs / 稳定 setter，闭包不会过期
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 地图海报节点：导出 PNG → 落盘到后端独立子目录（map-posters）→ 写回 node.data.imageUrl。
   *  地图海报为中间结果：不写入历史记录（db），仅在节点内展示 / 下载；recordHistory 仅记录画布撤销。 */
  const handleExportMapPosterFor = useCallback(
    async (id: string, dataUrl: string) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== 'map_poster') return;
      updateNodeData(id, { isExporting: true, error: null });
      try {
        const res: any = await api.post(
          '/modules/bookplate/save-image',
          { image: dataUrl },
          { timeout: SMALL_TOOL_TIMEOUT_MS }
        );
        const imageUrl = typeof res?.image_url === 'string' ? res.image_url : '';
        if (!imageUrl) throw new Error('保存图片失败');
        recordHistory();
        updateNodeData(id, { imageUrl, isExporting: false, error: null });
      } catch (error: any) {
        console.error('Failed to save map poster:', error);
        updateNodeData(id, {
          isExporting: false,
          error: error?.isTimeout ? '图片保存超时，请重试' : error?.detail || '图片保存失败，请重试',
        });
        throw error;
      }
      // 稳定回调设计：仅读取 refs / 稳定 setter，闭包不会过期
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 图片检索节点：编辑器状态（来源 tab 等）写入 node.data（仅持久化，不记撤销历史）。
   *  与地图海报编辑器同口径：结果集/关键词为节点内临时态，不落 node.data。 */
  const handleUpdateImageSearchEditorFor = useCallback(
    (id: string, patch: Record<string, any>, undoable: boolean) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== 'image_search') return;
      const cur = node.data ?? {};
      let changed = false;
      for (const [k, v] of Object.entries(patch)) {
        if (cur[k] !== v) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      if (undoable) recordHistory();
      updateNodeData(id, patch);
      // 稳定回调设计：仅读取 refs / 稳定 setter，闭包不会过期
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 图片检索节点：选中一张图 → 下载到本地独立子目录（search-images）→ 写回 node.data.imageUrl。
   *  选中图为中间结果：不写入历史记录（db），仅作为节点输出供下游消费 / 下载；recordHistory 记录画布撤销。 */
  const handleSelectSearchImageFor = useCallback(
    async (id: string, url: string, meta: any) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== 'image_search') return;
      updateNodeData(id, { error: null });
      try {
        const res: any = await api.post(
          '/modules/bookplate/image-search/save',
          {
            url,
            source: meta?.source ?? null,
            download_url: meta?.downloadUrl ?? null,
          },
          { timeout: SMALL_TOOL_TIMEOUT_MS }
        );
        const imageUrl = typeof res?.image_url === 'string' ? res.image_url : '';
        if (!imageUrl) throw new Error('保存图片失败');
        recordHistory();
        updateNodeData(id, { imageUrl, selectedImage: meta, error: null });
      } catch (error: any) {
        console.error('Failed to save search image:', error);
        updateNodeData(id, {
          error: error?.isTimeout ? '图片保存超时，请重试' : error?.detail || '图片保存失败，请重试',
        });
        throw error;
      }
      // 稳定回调设计：仅读取 refs / 稳定 setter，闭包不会过期
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 艺术图片检索节点：编辑器状态（来源等）写入 node.data（仅持久化，不记撤销历史）。与图片检索同口径。 */
  const handleUpdateGlamEditorFor = useCallback(
    (id: string, patch: Record<string, any>, undoable: boolean) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== 'art_image_search') return;
      const cur = node.data ?? {};
      let changed = false;
      for (const [k, v] of Object.entries(patch)) {
        if (cur[k] !== v) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      if (undoable) recordHistory();
      updateNodeData(id, patch);
      // 稳定回调设计：仅读取 refs / 稳定 setter，闭包不会过期
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 艺术图片检索节点：选中一张作品 → 下载到本地独立子目录（search-images，与图片检索共用）→ 写回 node.data.imageUrl。
   *  选中图为中间结果：不写入历史记录（db），仅作为节点输出供下游消费 / 下载；recordHistory 记录画布撤销。 */
  const handleSelectGlamImageFor = useCallback(
    async (id: string, url: string, meta: any) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== 'art_image_search') return;
      updateNodeData(id, { error: null });
      try {
        const res: any = await api.post(
          '/modules/bookplate/glam-search/save',
          { url },
          { timeout: SMALL_TOOL_TIMEOUT_MS }
        );
        const imageUrl = typeof res?.image_url === 'string' ? res.image_url : '';
        if (!imageUrl) throw new Error('保存图片失败');
        recordHistory();
        updateNodeData(id, { imageUrl, selectedImage: meta, error: null });
      } catch (error: any) {
        console.error('Failed to save glam image:', error);
        updateNodeData(id, {
          error: error?.isTimeout ? '图片保存超时，请重试' : error?.detail || '图片保存失败，请重试',
        });
        throw error;
      }
      // 稳定回调设计：仅读取 refs / 稳定 setter，闭包不会过期
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 提示词检索节点：选用一条 Bifrost 提示词（正文写入 data.content；未变化不记历史） */
  const handleUpdatePromptFor = useCallback(
    (id: string, selection: PromptSelection) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== 'prompt_search') return;
      const old = {
        promptId: node.data?.promptId ?? null,
        promptName: node.data?.promptName ?? '',
        content: node.data?.content ?? '',
        promptImage: node.data?.promptImage ?? null,
      };
      const next = {
        promptId: selection.promptId,
        promptName: selection.name ?? old.promptName,
        content: selection.content ?? old.content,
        promptImage: selection.imageUrl ?? null,
      };
      if (JSON.stringify(old) === JSON.stringify(next)) return;
      recordHistory();
      updateNodeData(id, next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** 文本聚合节点：保存占位符模板（未变化不记历史） */
  const handleUpdateAggregateTemplateFor = useCallback((id: string, template: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'text_aggregate') return;
    const old = typeof node.data?.template === 'string' ? node.data.template : '';
    if (template === old) return;
    recordHistory();
    updateNodeData(id, { template });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** 文本聚合节点：重命名某上级节点的占位符别名（空别名忽略；与其他上级重名拒绝；未变化不记历史） */
  const handleRenameAggregatePlaceholderFor = useCallback(
    (id: string, parentId: string, alias: string) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== 'text_aggregate') return;
      const trimmed = alias.trim();
      if (!trimmed) return;
      const placeholders = { ...(node.data?.placeholders ?? {}) };
      if (placeholders[parentId] === trimmed) return;
      const conflict = Object.entries(placeholders).some(
        ([pid, a]) => pid !== parentId && a === trimmed
      );
      if (conflict) {
        showToast('该占位符别名已被其他上级节点使用，请换一个', {
          type: 'warning',
          position: 'top-right',
        });
        return;
      }
      placeholders[parentId] = trimmed;
      recordHistory();
      updateNodeData(id, { placeholders });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  /** 可执行节点：更新运行设置（包含图书元数据；未变化不记历史） */
  const handleUpdateRunSettingsFor = useCallback((id: string, settings: NodeRunSettings) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node) return;
    const old: NodeRunSettings = node.data?.settings ?? DEFAULT_RUN_SETTINGS;
    if (JSON.stringify(old) === JSON.stringify(settings)) return;
    recordHistory();
    updateNodeData(id, { settings });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 侧边操作栏 ----------
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

  // ---------- 分支节点（新建共享父级的兄弟节点，保留旧分支） ----------
  const branchNode = (
    oldNode: NodeData,
    opts: {
      data: Record<string, any>;
      run?: (newNode: NodeData) => void;
      copyUpload?: boolean;
    }
  ) => {
    const parentEdge = edgesRef.current.find((e) => e.target === oldNode.id);
    const parent = parentEdge ? nodesRef.current.find((n) => n.id === parentEdge.source) : undefined;
    if (!parent) return; // 无父节点：分支节点将无法找到上游输入，直接放弃
    addChildNode(parent, {
      type: oldNode.type,
      data: { ...opts.data, settings: oldNode.data?.settings }, // 沿用原节点运行设置
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
      run: (newNode) => {
        // 沿用同一上游链的参考图（分支节点共享父级上游，直接连线即输入）：
        // 输出端口类型为 image 的上级（图片上传 / 图像生成…），与 resolveNodeRunInputs 同口径
        const refImage = resolveReferenceImage(
          collectNodeInputs(newNode, nodesRef.current, edgesRef.current, portTypesRef.current).images
        );
        runImageGeneration(newNode, prompt, refImage);
      },
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
    // 中止全部进行中流并清空模块级执行状态；clearCanvasState 重置 store（节点/连线/尺寸/收藏/公开）
    streamControllers.current.forEach((controller) => controller.abort());
    streamControllers.current.clear();
    clearCanvasState();
    setSelectedImageId(null);
  };

  /** 自动布局：按层级分列重排所有节点（父节点居中于子树区块），可撤销 */
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
    const fit = computeFitViewport(
      { minX, minY, maxX, maxY },
      window.innerWidth,
      window.innerHeight - 64
    );
    setScale(fit.scale);
    setPosition(fit.position);
  };

  const handleExport = async () => {
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

  /** 节点渲染所需依赖（稳定回调 + 派生状态），传给 CanvasNodeViews */
  const nodeViewHelpers: NodeViewHelpers = {
    nodes,
    edges,
    nodeSizes,
    favoritedState,
    publishedState,
    staleRecordIds,
    activeImage,
    hasBookInfo: nodes.some((n) => n.type === 'book_info'),
    portTypesOf,
    configOf,
    renderFooter,
    handleRemove,
    handleRetryBookFor,
    handleFetchBookFor,
    handleForceRefreshBookFor,
    handleDownloadBookData,
    handleRunAnalysisFor,
    handleRetryPromptFor,
    handleEditContent,
    handleRunFor,
    handleUpdateRunSettingsFor,
    handleRetryImageFor,
    handleSelectImage,
    handleToggleFavoriteFor,
    handleTogglePublicFor,
    handleEditTextFor,
    handleImageChangeFor,
    chatDeps,
    handleUpdatePromptFor,
    handleUpdateSkillsFor,
    handleFetchCalendarFor,
    handleFetchWeatherFor,
    handleFetchZhihuFor,
    handleUpdateZhihuEditorFor,
    handleSearchWikipediaFor,
    handleOpenWikipediaArticleFor,
    handleBackToWikipediaResultsFor,
    handleUpdateWikipediaEditorFor,
    handleExportMapPosterFor,
    handleUpdateMapPosterEditorFor,
    handleSelectSearchImageFor,
    handleUpdateImageSearchEditorFor,
    handleSelectGlamImageFor,
    handleUpdateGlamEditorFor,
    handleUpdateAggregateTemplateFor,
    handleRenameAggregatePlaceholderFor,
    handleUpdateChatSettingsFor,
    handleClearChatFor,
    handleNodeContextMenu,
    handlePositionChange,
    handleSizeChange,
    handleNodeDrag,
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Navbar />

      <main className="flex-1 relative flex">
        <Canvas
          scale={scale}
          position={position}
          onPositionChange={setPosition}
          onAnchorPointerDown={onAnchorPointerDown}
          onContextMenu={handleCanvasContextMenu}
        >
          {edges.map((edge) => {
            const source = nodes.find((n) => n.id === edge.source);
            const target = nodes.find((n) => n.id === edge.target);
            if (!source || !target) return null;

            const sourceSize = nodeSizes[source.id] ?? DEFAULT_SIZES[source.type];
            const targetSize = nodeSizes[target.id] ?? DEFAULT_SIZES[target.type];
            // 端口类型匹配校验：不匹配的连线以红色渲染（软提示，不禁止连接）
            const compatible =
              matchPortType(portTypesOf(source.type).output, portTypesOf(target.type).inputs) !==
              'mismatch';

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
                compatible={compatible}
                onDelete={() => handleRemoveEdge(edge.id)}
              />
            );
          })}

          {nodes.map((node) => renderCanvasNode(node, nodeViewHelpers))}
        </Canvas>

        {/* 手动拖线：待确认的幽灵连线（fixed 覆盖层，命令式跟随指针） */}
        {connecting && <ConnectionGhost ref={ghostRef} sourceId={connecting} />}

        {/* 空画布引导提示 */}
        {nodes.length === 0 && !isLoading && <EmptyCanvasHint />}

        {/* 画布空白处右键菜单（添加独立节点） */}
        {standaloneMenu &&
          (() => {
            const MENU_WIDTH = 460;
            const MENU_MAX_HEIGHT = 440; // 预估最大高度
            const left = standaloneMenu.x + MENU_WIDTH > window.innerWidth - 8 ? Math.max(8, standaloneMenu.x - MENU_WIDTH) : standaloneMenu.x;
            const top = Math.max(8, Math.min(standaloneMenu.y, window.innerHeight - MENU_MAX_HEIGHT));

            return (
              <div
                data-standalone-menu
                className="fixed z-[9999] w-[460px]"
                style={{ left, top }}
              >
                <div className="bg-paper border border-paper-grid rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-3.5 py-2.5 border-b border-dashed border-paper-grid bg-paper-grid/10 flex items-center justify-between">
                    <p className="text-xs font-sans font-medium text-ink-light">添加独立节点</p>
                    <span className="text-[10px] text-ink-faint font-sans">点击或搜索快速添加</span>
                  </div>
                  <div>
                    <NodePickerList
                      items={pickerItems}
                      onPick={(item) =>
                        handleAddStandaloneNode(item, standaloneMenu.canvasX, standaloneMenu.canvasY)
                      }
                    />
                  </div>
                </div>
              </div>
            );
          })()}


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
