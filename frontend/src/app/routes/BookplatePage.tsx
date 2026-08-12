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
  resolveDirectParents,
} from '../../modules/bookplate/nodeTypes';
import {
  AGGREGATE_DEFAULT_TEMPLATE,
  renderAggregateTemplate,
  syncAggregatePlaceholders,
} from '../../modules/bookplate/textTemplate';
import {
  resolveNodeRunInputs,
  DEFAULT_RUN_SETTINGS,
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
import { useChatExecution } from '../../modules/bookplate/useChatExecution';
import { useManualConnection } from '../../modules/bookplate/useManualConnection';
import ConnectionGhost from '../../modules/bookplate/ConnectionGhost';
import { renderCanvasNode, type NodeViewHelpers } from '../../modules/bookplate/CanvasNodeViews';
import { NodeEdge, type NodeEdgeHandle } from '../../platform/components/node/NodeEdge';
import { useFeedback } from '../../platform/components/ui/FeedbackProvider';
import api from '../../platform/services/api';
import generationsService from '../../platform/services/generations';
import { ISBN_FETCH_TIMEOUT_MS } from '../../platform/utils/timeouts';
import type {
  CanvasNodeType,
  ChatNodeSettings,
  NodePortType,
  NodeRegistry,
  NodeRunSettings,
  PromptSelection,
  RegistryNodeConfig,
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
  }, []);
  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - 0.2, 0.1));
  }, []);
  const handleFocus = useCallback(() => {
    setPosition({ x: 0, y: 0 });
    setScale(1);
  }, []);

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
  }, []);

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
  }, [invalidateGenerationLink]);

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
  const { undo, redo, recordHistory, canUndo, canRedo } = useCanvasHistory({
    nodesRef,
    edgesRef,
    generationIds,
    streamControllers,
    setNodes,
    setEdges,
    setSelectedImageId,
    setStaleRecordIds,
    syncFavoritesFromServer,
  });

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
  // AI 对话节点执行（多轮 SSE）独立成 hook，与节点执行引擎解耦
  const { runChatTurn, retryChatTurn } = useChatExecution({
    nodesRef,
    edgesRef,
    streamControllers,
    portTypesRef,
    setNodes,
  });

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
  }, []);

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

  // ---------- 通用节点创建 ----------
  /** 新节点的初始数据（按模板类型；includeBook 默认「直接上级是图书元数据」才开启） */
  const seedDataFor = (type: NodeType, parent?: NodeData): any => {
    const runSettings = (): NodeRunSettings => ({
      includeBook: parent?.type === 'book_info',
      autoRun: false,
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
          settings: { includeBook: true, includeUpstream: true, includeUpstreamImages: true },
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
      // 手动运行模型：默认不自动执行；仅当该节点开启「自动运行」时创建后立即补跑
      run: (newNode) => {
        const settings: NodeRunSettings = newNode.data?.settings ?? DEFAULT_RUN_SETTINGS;
        if (settings.autoRun) runNode(newNode);
      },
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

  // ---------- 自愈：挂载 / 用户切换时复位「残留的生成中」节点 ----------
  // 画布状态持久化在 sessionStorage，整页刷新 / 崩溃 / 页面直关等路径会残留上次会话的生成中标记。
  // 切页往返路径的流仍在后台运行（模块级 streamControllers 存活），故以 hasActiveStream 判断：
  // 仍有活动流的节点是「正在正常生成」，保持不动；无活动流的节点才是残留，安全复位——
  // 开启「自动运行」的节点交由下方 autoRun 检查重新执行；其余节点置失败提示由用户重试。
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => selfHealNode(n, streamControllers.current.has(n.id), true))
    );
  }, [setNodes, user?.id]);

  // ---------- 自动运行（默认关闭，节点运行设置中开启「自动运行」后生效） ----------
  const autoRunTried = useRef<Set<string>>(new Set());

  // 输入就绪自动执行：开启「自动运行」的节点在创建或上游数据到达
  // （图书元数据返回 / 分析完成 / 提示词生成完）时自动补跑；其余节点由用户点击「运行」触发。
  useEffect(() => {
    for (const node of nodesRef.current) {
      const settings: NodeRunSettings = node.data?.settings ?? DEFAULT_RUN_SETTINGS;
      if (settings.autoRun !== true) continue;
      if (autoRunTried.current.has(node.id)) continue;
      if (node.data?.isGenerating || node.data?.error) continue;

      let idle = false;
      let ready = false;
      if (node.type === 'image_analysis') {
        idle = !node.data?.analysis;
        const inputs = resolveNodeRunInputs(node, nodesRef.current, edgesRef.current, portTypesOf);
        const uploaded = analysisUploads.current.get(node.id);
        const imageReady = !!(uploaded || inputs.refImage);
        const coverReady = !inputs.uploadNode && (!!inputs.book?.data?.cover_image || !!inputs.book?.data?.coverUrl);
        ready = imageReady || coverReady;
      } else if (node.type === 'prompt_generation') {
        idle = !node.data?.content;
        const inputs = resolveNodeRunInputs(node, nodesRef.current, edgesRef.current, portTypesOf);
        ready = !!(inputs.book?.data?.isbn || inputs.analysis || inputs.text);
      } else if (node.type === 'image_generation') {
        idle = !node.data?.imageUrl;
        const inputs = resolveNodeRunInputs(node, nodesRef.current, edgesRef.current, portTypesOf);
        ready = !!inputs.imagePrompt.trim() && !inputs.promptNodes.some((p) => p.data?.isGenerating);
        if (inputs.uploadNode && !inputs.refImage) ready = false;
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

    const run = () => {
      const settings: NodeRunSettings = newNode.data?.settings ?? DEFAULT_RUN_SETTINGS;
      if (settings.autoRun) runNode(newNode);
    };
    run();
    
    focusOnNode(newNode);
    setStandaloneMenu(null);
  }, [recordHistory, setNodes, runNode]);

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
  // 不变量：下方被引用的处理函数只能读取 refs / 模块函数 / 稳定 setter。
  const handleRemove = useCallback((id: string) => handleRemoveNode(id), []);
  const handleRetryBookFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node) handleRetryBook(node);
  }, []);
  const handleFetchBookFor = useCallback((id: string, isbn: string) => {
    fetchBookInfo(isbn, id);
  }, []);
  const handleForceRefreshBookFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    const isbn = node?.data?.isbn;
    if (!isbn) return;
    fetchBookInfo(isbn, id, { force: true });
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
  }, []);
  /** 提示词节点重试/重新生成：从上游重新收集输入并流式生成 */
  const handleRetryPromptFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node && node.type === 'prompt_generation') runNode(node);
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
  }, []);
  const handleRetryImageFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'image_generation') return;
    if (node.data?.imageUrl && !node.data?.isMock) {
      branchImageNode(node);
      return;
    }
    runNode(node);
  }, []);
  const handleToggleFavoriteFor = useCallback((id: string) => toggleFavoriteForImage(id), []);
  const handleTogglePublicFor = useCallback((id: string) => togglePublicForImage(id), []);
  /** 文本节点保存编辑内容（无需分支，原地保存；内容未变化不记历史） */
  const handleEditTextFor = useCallback((id: string, content: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'text') return;
    const oldContent = typeof node.data?.content === 'string' ? node.data.content : '';
    if (content === oldContent) return;
    recordHistory();
    updateNodeData(id, { content });
  }, []);
  /** AI 对话节点：发送一条用户消息（多轮对话，images 为本轮附带图片） */
  const handleSendChatFor = useCallback((id: string, text: string, images?: string[]) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node && node.type === 'chat') runChatTurn(node, text, images);
  }, []);
  /** AI 对话节点：更新上下文加载设置（未变化不记历史） */
  const handleUpdateChatSettingsFor = useCallback((id: string, settings: ChatNodeSettings) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'chat') return;
    const old = node.data?.settings ?? {
      includeBook: true,
      includeUpstream: true,
      includeUpstreamImages: true,
    };
    if (JSON.stringify(old) === JSON.stringify(settings)) return;
    recordHistory();
    updateNodeData(id, { settings });
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
    });
  }, []);
  /** AI 对话节点：停止当前生成（中止 SSE 流，标记用户中断） */
  const handleStopChatFor = useCallback((id: string) => {
    const controller = streamControllers.current.get(id);
    if (!controller) return;
    (controller as any).userInterrupted = true;
    controller.abort();
  }, []);
  /** AI 对话节点：重试最后一轮 */
  const handleRetryChatFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (node && node.type === 'chat') retryChatTurn(node);
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
    []
  );
  /** 可执行节点：更新运行设置（包含图书元数据 / 自动运行；未变化不记历史） */
  const handleUpdateRunSettingsFor = useCallback((id: string, settings: NodeRunSettings) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node) return;
    const old: NodeRunSettings = node.data?.settings ?? DEFAULT_RUN_SETTINGS;
    if (JSON.stringify(old) === JSON.stringify(settings)) return;
    recordHistory();
    updateNodeData(id, { settings });
    // 开启「自动运行」：允许该节点重新参与输入就绪检查（此前可能已标记为尝试过）
    if (settings.autoRun && !old.autoRun) autoRunTried.current.delete(id);
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
        // 沿用同一上游链的「图片上传」参考图（分支节点共享父级上游，直接连线即输入）
        const uploads = nodesRef.current.filter(
          (n) =>
            n.type === 'image_upload' &&
            edgesRef.current.some((e) => e.source === n.id && e.target === newNode.id)
        );
        const refImage =
          typeof uploads[0]?.data?.imageUrl === 'string' ? uploads[0].data.imageUrl : undefined;
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
    handleSendChatFor,
    handleUpdatePromptFor,
    handleUpdateAggregateTemplateFor,
    handleRenameAggregatePlaceholderFor,
    handleUpdateChatSettingsFor,
    handleClearChatFor,
    handleStopChatFor,
    handleRetryChatFor,
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
        {standaloneMenu && (
          <div
            data-standalone-menu
            className="fixed z-[9999]"
            style={{ left: standaloneMenu.x, top: standaloneMenu.y }}
          >
            <div className="absolute left-0 top-0 w-72">
              <div className="bg-paper border border-paper-grid rounded-xl shadow-xl overflow-hidden">
                <div className="px-3 py-2.5 border-b border-dashed border-paper-grid bg-paper-grid/10">
                  <p className="text-xs font-sans font-medium text-ink-light">添加独立节点</p>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  <NodePickerList 
                    items={pickerItems} 
                    onPick={(item) => handleAddStandaloneNode(item, standaloneMenu.canvasX, standaloneMenu.canvasY)} 
                  />
                </div>
              </div>
            </div>
          </div>
        )}

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
