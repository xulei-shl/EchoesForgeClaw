import { useCallback } from 'react';
import type { NodeData, EdgeData, NodeType, NodeSize } from './graphTypes';
import type { PortTypesLookup } from './execution';
import api from '../../platform/services/api';
import { SMALL_TOOL_TIMEOUT_MS } from '../../platform/utils/timeouts';
import { nodeOutputText, resolveDirectParents } from './nodeTypes';
import type { ChatNodeSettings, NodeRunSettings, PromptSelection, SkillSelection } from '../../platform/types';
import type { ZhihuSearchRequest } from './components/ZhihuSearchNode';
import type { WikipediaSearchRequest } from './components/WikipediaSearchNode';
import type { TranslationRequest } from './components/TextTranslationNode';
import type { WebSearchRequest } from './components/WebSearchNode';
import { resolveReferenceImage, collectNodeInputs, DEFAULT_RUN_SETTINGS } from './execution';

export interface NodeHandlersDeps {
  nodesRef: React.MutableRefObject<NodeData[]>;
  edgesRef: React.MutableRefObject<EdgeData[]>;
  portTypesRef: React.MutableRefObject<PortTypesLookup>;
  streamControllers: React.MutableRefObject<Map<string, AbortController>>;
  analysisUploads: React.MutableRefObject<Map<string, string>>;
  generationIds: React.MutableRefObject<Record<string, number>>;
  setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>;
  setEdges: React.Dispatch<React.SetStateAction<EdgeData[]>>;
  setNodeSizes: React.Dispatch<React.SetStateAction<Record<string, NodeSize>>>;
  setFavoritedState: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setPublishedState: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setSelectedImageId: React.Dispatch<React.SetStateAction<string | null>>;
  setStaleRecordIds?: React.Dispatch<React.SetStateAction<Set<string>>>;
  updateNodeData: (id: string, patch: Record<string, any>) => void;
  recordHistory: () => void;
  runNode: (node: NodeData) => string | undefined;
  runImageGeneration: (node: NodeData, prompt: string, refImage?: string) => void;
  addChildNode: (parent: NodeData, opts: any) => void;
  toggleFavoriteForImage: (id: string) => Promise<boolean>;
  togglePublicForImage: (id: string) => Promise<boolean>;
  showToast: (message: string, opts?: any) => void;
  dialog: { confirm: (opts: any) => Promise<boolean> };
  fetchBookInfo: (isbn: string, nodeId?: string, opts?: { force?: boolean }) => Promise<void>;
  removingRef: React.MutableRefObject<boolean>;
  setCtxMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; nodeId: string } | null>>;
}

export function useNodeHandlers({
  nodesRef, edgesRef, portTypesRef, streamControllers, analysisUploads, generationIds,
  setNodes, setEdges, setNodeSizes, setFavoritedState, setPublishedState,
  setSelectedImageId, updateNodeData, recordHistory,
  runNode, runImageGeneration, addChildNode, toggleFavoriteForImage, togglePublicForImage,
  showToast, dialog, fetchBookInfo, removingRef, setCtxMenu
}: NodeHandlersDeps) {
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

  /** 某节点是否已有指定类型的直接子节点 */
  const hasChildOfType = (nodeId: string, type: NodeType): boolean =>
    edgesRef.current.some(
      (e) => e.source === nodeId && nodesRef.current.find((n) => n.id === e.target)?.type === type
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

  // ---------- 节点右键菜单 ----------
  const handleNodeContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!nodesRef.current.some((n) => n.id === nodeId)) return;
    setCtxMenu({ x: e.clientX, y: e.clientY, nodeId });
  }, []);
  const closeContextMenu = useCallback(() => setCtxMenu(null), []);

  // ---------- 稳定回调（配合节点组件 memo）：避免内联箭头导致未变化节点重渲染 ----------
  // 不变量：下方被引用的处理函数只能读取 refs / 模块函数 / 稳定 setter；依赖数组刻意保持
  // []（eslint-disable exhaustive-deps）：被引用函数虽为普通函数，但仅读取 refs / 稳定 setter，
  // 闭包不会过期；若把普通函数加入依赖会导致回调每渲染重建，破坏节点 memo。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleRemove = useCallback((id: string) => handleRemoveNode(id), []);
  const handleRetryBookFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    const isbn = node?.data?.isbn;
    if (isbn) fetchBookInfo(isbn, id);
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
    if (!promptNode || promptNode.type !== 'text_generation') return;
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
    if (node && node.type === 'text_generation') runNode(node);
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

  /** 文本翻译节点：按配置翻译上级文本（语言/翻译源由节点组件传入，合并上游文本后转发后端） */
  const handleFetchTranslationFor = useCallback((id: string, payload: TranslationRequest) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'text_translation') return;
    const curData = node.data ?? {};
    const curTabData = curData.tabData ?? {};
    const targetSource = payload.source;
    if (curTabData[targetSource]?.isGenerating) return;

    const parents = resolveDirectParents(id, nodesRef.current, edgesRef.current);
    const upstreamText = parents.map((p) => nodeOutputText(p)).find((v) => v.trim()) ?? '';
    const finalText = upstreamText || payload.text;
    if (!finalText.trim()) return;

    const newTargetTabData = {
      ...(curTabData[targetSource] || {}),
      isGenerating: true,
      error: null,
    };
    const nextTabData = { ...curTabData, [targetSource]: newTargetTabData };
    const isCurrentActive = (curData.source ?? 'random') === targetSource;

    updateNodeData(id, {
      from: payload.from,
      to: payload.to,
      tabData: nextTabData,
      ...(isCurrentActive ? { isGenerating: true, error: null } : {}),
    });

    api
      .post('/modules/bookplate/translate', { text: finalText, from: payload.from, to: payload.to, source: payload.source }, { timeout: SMALL_TOOL_TIMEOUT_MS })
      .then((res: any) => {
        const latestNode = nodesRef.current.find((n) => n.id === id);
        const latestData = latestNode?.data ?? {};
        const latestTabData = latestData.tabData ?? nextTabData;
        const outputText = typeof res?.output === 'string' ? res.output : '';
        const usedSrc = typeof res?.source === 'string' ? res.source : '';

        const finishedTargetTabData = {
          ...(latestTabData[targetSource] || {}),
          output: outputText,
          usedSource: usedSrc,
          isGenerating: false,
          error: null,
        };
        const updatedTabData = { ...latestTabData, [targetSource]: finishedTargetTabData };
        const isStillActive = (latestData.source ?? 'random') === targetSource;

        updateNodeData(id, {
          tabData: updatedTabData,
          ...(isStillActive ? { output: outputText, isGenerating: false, error: null } : {}),
        });
      })
      .catch((error: any) => {
        console.error('Failed to translate:', error);
        const latestNode = nodesRef.current.find((n) => n.id === id);
        const latestData = latestNode?.data ?? {};
        const latestTabData = latestData.tabData ?? nextTabData;
        const errDetail = error?.isTimeout ? '翻译超时，请重试' : error?.detail || '翻译失败，请重试';

        const erroredTargetTabData = {
          ...(latestTabData[targetSource] || {}),
          isGenerating: false,
          error: errDetail,
        };
        const updatedTabData = { ...latestTabData, [targetSource]: erroredTargetTabData };
        const isStillActive = (latestData.source ?? 'random') === targetSource;

        updateNodeData(id, {
          tabData: updatedTabData,
          ...(isStillActive ? { isGenerating: false, error: errDetail } : {}),
        });
      });
    // 稳定回调设计：仅读取 refs / 稳定 setter，闭包不会过期
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 文本翻译节点：编辑器状态写入 node.data（仅持久化，不记撤销历史） */
  const handleUpdateTranslationEditorFor = useCallback((id: string, patch: Record<string, any>) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'text_translation') return;
    updateNodeData(id, patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 网络搜索节点：多源检索（关键词 = 连线上级文本 > 手动输入；按源隔离 tabData，对外输出当前 active source 结果） */
  const handleFetchWebSearchFor = useCallback((id: string, payload: WebSearchRequest) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'web_search') return;
    const curData = node.data ?? {};
    const curTabData = curData.tabData ?? {};
    const targetSource = payload.source;
    if (curTabData[targetSource]?.isGenerating) return;

    const parents = resolveDirectParents(id, nodesRef.current, edgesRef.current);
    const upstreamQuery = parents.map((p) => nodeOutputText(p)).find((v) => v.trim()) ?? '';
    const finalQuery = upstreamQuery || payload.query.trim();
    if (!finalQuery) return;

    const newTargetTabData = {
      ...(curTabData[targetSource] || {}),
      isGenerating: true,
      error: null,
    };
    const nextTabData = { ...curTabData, [targetSource]: newTargetTabData };
    const isCurrentActive = (curData.source ?? 'random') === targetSource;

    updateNodeData(id, {
      tabData: nextTabData,
      ...(isCurrentActive ? { isGenerating: true, error: null } : {}),
    });

    api
      .post('/modules/bookplate/web-search', { query: finalQuery, count: payload.count, source: payload.source }, { timeout: SMALL_TOOL_TIMEOUT_MS })
      .then((res: any) => {
        const latestNode = nodesRef.current.find((n) => n.id === id);
        const latestData = latestNode?.data ?? {};
        const latestTabData = latestData.tabData ?? nextTabData;
        const outputText = typeof res?.output === 'string' ? res.output : '';
        const usedSrc = typeof res?.source === 'string' ? res.source : '';

        const finishedTargetTabData = {
          ...(latestTabData[targetSource] || {}),
          output: outputText,
          usedSource: usedSrc,
          isGenerating: false,
          error: null,
        };
        const updatedTabData = { ...latestTabData, [targetSource]: finishedTargetTabData };
        const isStillActive = (latestData.source ?? 'random') === targetSource;

        updateNodeData(id, {
          tabData: updatedTabData,
          ...(isStillActive ? { output: outputText, isGenerating: false, error: null } : {}),
        });
      })
      .catch((error: any) => {
        console.error('Failed to fetch web search:', error);
        const latestNode = nodesRef.current.find((n) => n.id === id);
        const latestData = latestNode?.data ?? {};
        const latestTabData = latestData.tabData ?? nextTabData;
        const errDetail = error?.isTimeout ? '网络搜索超时，请重试' : error?.detail || '网络搜索失败，请重试';

        const erroredTargetTabData = {
          ...(latestTabData[targetSource] || {}),
          isGenerating: false,
          error: errDetail,
        };
        const updatedTabData = { ...latestTabData, [targetSource]: erroredTargetTabData };
        const isStillActive = (latestData.source ?? 'random') === targetSource;

        updateNodeData(id, {
          tabData: updatedTabData,
          ...(isStillActive ? { isGenerating: false, error: errDetail } : {}),
        });
      });
    // 稳定回调设计：仅读取 refs / 稳定 setter，闭包不会过期
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 网络搜索节点：编辑器状态写入 node.data（仅持久化，不记撤销历史） */
  const handleUpdateWebSearchEditorFor = useCallback((id: string, patch: Record<string, any>) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'web_search') return;
    updateNodeData(id, patch);
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

  /** 地图海报节点：后端已落盘并返回 image_url，直接写入 node.data.imageUrl。
   *  地图海报为中间结果：不写入历史记录（db），仅在节点内展示 / 下载；recordHistory 仅记录画布撤销。 */
  const handleExportMapPosterFor = useCallback(
    async (id: string, imageUrl: string) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== 'map_poster') return;
      recordHistory();
      updateNodeData(id, { imageUrl, error: null });
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


  return {
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
    handleFetchWebSearchFor,
    handleUpdateWebSearchEditorFor,
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
  };
}
