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
import type { TranslationRequest } from '../../modules/bookplate/components/TextTranslationNode';
import type { WikipediaSearchRequest } from '../../modules/bookplate/components/WikipediaSearchNode';
import { MAP_POSTER_DEFAULTS } from '../../modules/multimodal/map/defaults';
import { seedDataFor } from '../../modules/bookplate/seedData';
import { useFavoritesSync } from '../../modules/bookplate/useFavoritesSync';
import { useNodeHandlers } from '../../modules/bookplate/useNodeHandlers';
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
      const fallback = NODE_PORT_TYPES[type];
      return {
        output: t?.output_type ?? fallback?.output ?? 'text',
        inputs: t?.input_types ?? fallback?.inputs ?? [],
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

  // ---------- 历史记录组装 / 收藏状态同步 ----------
  const { autoSaveGeneration, ensureGeneration } = useGenerationHistory({
    nodesRef,
    edgesRef,
    generationIds,
  });

  const {
    invalidateGenerationLink,
    syncFavoritesFromServer,
    toggleFavoriteForImage,
    togglePublicForImage,
    clearStaleFlag,
  } = useFavoritesSync({
    userId: String(user?.id ?? 'anon'),
    generationIds,
    setFavoritedState,
    setPublishedState,
    setStaleRecordIds,
    ensureGeneration,
    favoritedRef,
    publishedRef,
    busyFav,
    busyPub,
  });

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

  const handleRemoveEdge = useCallback(
    (edgeId: string) => {
      recordHistory();
      setEdges((prev) => prev.filter((e) => e.id !== edgeId));
    },
    [recordHistory, setEdges]
  );


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




  const {
    handleRemove,
    handleRetryBookFor,
    handleFetchBookFor,
    handleForceRefreshBookFor,
    handleDownloadBookData,
    handleEditContent,
    handleRetryPromptFor,
    handleRunAnalysisFor,
    handleRetryImageFor,
    handleToggleFavoriteFor,
    handleTogglePublicFor,
    handleEditTextFor,
    handleUpdateChatSettingsFor,
    handleClearChatFor,
    handleImageChangeFor,
    handleSelectImage,
    handleRunFor,
    handleUpdateSkillsFor,
    handleFetchCalendarFor,
    handleFetchWeatherFor,
    handleFetchZhihuFor,
    handleUpdateZhihuEditorFor,
    handleSearchWikipediaFor,
    handleOpenWikipediaArticleFor,
    handleBackToWikipediaResultsFor,
    handleUpdateWikipediaEditorFor,
    handleFetchTranslationFor,
    handleUpdateTranslationEditorFor,
    handleUpdateMapPosterEditorFor,
    handleExportMapPosterFor,
    handleSelectSearchImageFor,
    handleUpdateImageSearchEditorFor,
    handleSelectGlamImageFor,
    handleUpdateGlamEditorFor,
    handleUpdatePromptFor,
    handleUpdateAggregateTemplateFor,
    handleRenameAggregatePlaceholderFor,
    handleUpdateRunSettingsFor,
    handleNodeContextMenu,
    closeContextMenu,
  } = useNodeHandlers({
    nodesRef, edgesRef, portTypesRef, streamControllers, analysisUploads, generationIds,
    setNodes, setEdges, setNodeSizes, setFavoritedState, setPublishedState,
    setSelectedImageId, setStaleRecordIds, updateNodeData, recordHistory,
    runNode, runImageGeneration, addChildNode, toggleFavoriteForImage, togglePublicForImage,
    showToast, dialog, fetchBookInfo, removingRef, setCtxMenu
  });

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
    handleFetchTranslationFor,
    handleUpdateTranslationEditorFor,
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
