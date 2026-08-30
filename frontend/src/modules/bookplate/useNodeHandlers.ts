import { useCallback } from 'react';
import type { NodeData, EdgeData, NodeSize } from './graphTypes';
import type { PortTypesLookup } from './execution';
import { resolveReferenceImage, collectNodeInputs } from './execution';
import { collectDescendantIds, hasChildOfType } from './nodeGraph';
import { useEditorPatchHandler, type EditorPatchFns } from './editorPatch';
import { useToolHandlers, type ToolRequestCtx } from './useToolHandlers';
import {
  useImageOutputHandlers,
  type ImageOutputCtx,
} from './useImageOutputHandlers';
import type { ChatNodeSettings, NodeRunSettings, PromptSelection, SkillSelection } from '../../platform/types';

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
  /** 图书元数据节点：手动上传封面兜底（落盘 + 回写 book_cache，由页面实现请求） */
  uploadBookCover: (nodeId: string, isbn: string, file: File) => Promise<void>;
  removingRef: React.MutableRefObject<boolean>;
  setCtxMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; nodeId: string } | null>>;
  autoSaveGeneration: (imageNodeId: string, imageUrl: string) => Promise<number | null>;
}

/**
 * 组件 handler 工厂入口（组合根）：把节点级 handler 按「行为族」组织到独立模块，避免超大单体。
 * - 通用「编辑器 patch 写入」共享实现见 editorPatch.ts（新增编辑器类节点一行工厂调用）；
 * - 工具类 fetch（日历/天气/Wikipedia/知乎/翻译/网络搜索）见 useToolHandlers.ts；
 * - 图片输出（选中保存/导出落盘）见 useImageOutputHandlers.ts；
 * - 纯图操作（子孙收集/子节点类型判断）见 nodeGraph.ts。
 * 公开返回的所有 handler 均为稳定回调（配合节点组件 memo，避免非必要重渲染）。
 */
export function useNodeHandlers({
  nodesRef, edgesRef, portTypesRef, streamControllers, analysisUploads, generationIds,
  setNodes, setEdges, setNodeSizes, setFavoritedState, setPublishedState,
  setSelectedImageId, setStaleRecordIds, updateNodeData, recordHistory,
  runNode, runImageGeneration, addChildNode, toggleFavoriteForImage, togglePublicForImage,
  showToast, dialog, fetchBookInfo, uploadBookCover, removingRef, setCtxMenu, autoSaveGeneration
}: NodeHandlersDeps) {
  // ---------- 删除节点（含级联） ----------
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

  const handleRemoveNode = (id: string) => {
    const ids = collectDescendantIds(id, edgesRef.current);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const closeContextMenu = useCallback(() => setCtxMenu(null), []);

  // ---------- 图书元数据 ----------
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
  /** 图书元数据节点：手动上传封面（请求与数据回写由页面 uploadBookCover 实现） */
  const handleUploadCoverFor = useCallback((id: string, file: File) => {
    const node = nodesRef.current.find((n) => n.id === id);
    const isbn = node?.data?.isbn;
    if (!isbn) return;
    void uploadBookCover(id, isbn, file);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** VuFind 索书号节点：下载获取到的元数据 JSON（同 handleDownloadBookData 口径） */
  const handleDownloadVuFindData = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || !node.data) return;
    const apiData = { ...node.data };
    delete apiData.isGenerating;
    delete apiData.error;
    const json = JSON.stringify(apiData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vufind-${node.data.isbn || node.data.callNumber || Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 文本生成 / 图片分析 / 图像生成 ----------
  /** 保存编辑文本：若该提示词节点已有子图像节点，则分支新建节点保留旧分支；否则原地保存 */
  const handleEditContent = useCallback((id: string, content: string) => {
    const promptNode = nodesRef.current.find((n) => n.id === id);
    if (!promptNode || promptNode.type !== 'text_generation') return;
    if (!hasChildOfType(id, 'image_generation', edgesRef.current, nodesRef.current)) {
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
  /** 藏书票图像节点：手动保存到数据库历史记录表 */
  const handleSaveImageFor = useCallback(
    async (id: string) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== 'image_generation') return;
      const imageUrl = node.data?.imageUrl;
      if (!imageUrl) return;

      try {
        const genId = await autoSaveGeneration(id, imageUrl);
        if (!genId) {
          throw new Error('保存历史记录失败');
        }
        updateNodeData(id, { isSaved: true });
        setSelectedImageId(id);
        recordHistory();
        showToast('图像已保存到数据库，已解锁公开与收藏', { type: 'success' });
      } catch (error: any) {
        console.error('Failed to save image to database:', error);
        showToast(error?.message || '保存失败，请重试', { type: 'error' });
        throw error;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  /** 点击图片节点选中（作为全局操作栏的作用目标）；仅已有图片的节点可选中 */
  const handleSelectImage = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (
      (node?.type === 'image_generation' ||
        node?.type === 'receipt_printer' ||
        node?.type === 'book_card') &&
      node.data?.imageUrl
    ) {
      setSelectedImageId(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 文本 / AI 对话 / 图片上传 / Skills / 文本聚合 ----------
  /** 文本节点保存编辑内容（原地保存；内容未变化不记历史） */
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
    // 封面开关不写显式值：默认跟随 book_info 连通性（见 execution.ts isBookCoverEnabled）
    const old = node.data?.settings ?? {
      includeBook: false,
      includeUpstream: true,
      includeUpstreamImages: true,
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

      if (imageUrl === null) {
        handleRemoveNode(id);
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
  /** 手动「运行」：输入不足时 toast 明确原因（含类型不匹配提示） */
  const handleRunFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.data?.isGenerating) return;
    const reason = runNode(node);
    if (reason) showToast(reason, { type: 'warning' });
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
    const old: NodeRunSettings = node.data?.settings ?? { includeBook: false };
    if (JSON.stringify(old) === JSON.stringify(settings)) return;
    recordHistory();
    updateNodeData(id, { settings });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 编辑器 patch 写入（各节点共用同一实现，见 editorPatch.ts） ----------
  const editorPatchFns: EditorPatchFns = { nodesRef, recordHistory, updateNodeData };
  const handleUpdateZhihuEditorFor = useEditorPatchHandler(['zhihu_search'], editorPatchFns);
  const handleUpdateMapPosterEditorFor = useEditorPatchHandler(['map_poster'], editorPatchFns);
  const handleUpdateMapArtEditorFor = useEditorPatchHandler(['map_art'], editorPatchFns);
  const handleUpdateImageSearchEditorFor = useEditorPatchHandler(['image_search'], editorPatchFns);
  const handleUpdateGlamEditorFor = useEditorPatchHandler(['art_image_search'], editorPatchFns);
  const handleUpdatePatternEditorFor = useEditorPatchHandler(['pattern_search'], editorPatchFns);
  const handleUpdateColorEditorFor = useEditorPatchHandler(['color_search'], editorPatchFns);
  const handleUpdateWikipediaEditorFor = useEditorPatchHandler(['wikipedia_search'], editorPatchFns);
  const handleUpdateTranslationEditorFor = useEditorPatchHandler(['text_translation'], editorPatchFns);
  const handleUpdateWebSearchEditorFor = useEditorPatchHandler(['web_search'], editorPatchFns);
  const handleUpdateVuFindEditorFor = useEditorPatchHandler(['vufind_call_number'], editorPatchFns);
  const handleUpdateStampStateFor = useEditorPatchHandler(['stamp_cutter'], editorPatchFns);
  const handleUpdateStickerMakerStateFor = useEditorPatchHandler(['sticker_maker'], editorPatchFns);
  const handleUpdateJournalMakerStateFor = useEditorPatchHandler(['journal_maker'], editorPatchFns);
  const handleUpdateTextImageStateFor = useEditorPatchHandler(['text_image'], editorPatchFns);
  const handleUpdateOilPaintStateFor = useEditorPatchHandler(['oil_paint'], editorPatchFns);
  const handleUpdateImageProcessStateFor = useEditorPatchHandler(['image_process'], editorPatchFns);
  const handleUpdateEmbossFoilStateFor = useEditorPatchHandler(['emboss_foil'], editorPatchFns);
  const handleUpdateGlassRefractStateFor = useEditorPatchHandler(['glass_refract'], editorPatchFns);
  const handleUpdateEditorialStateFor = useEditorPatchHandler(['editorial_layout'], editorPatchFns);

  /** 「内容 = 已保存记录」型图片节点（小票 / 图书卡片等）共用：
   *  内容变更后，当前预览不再对应「生成保存到数据库」的结果：若该节点已有保存记录，
   *  解除收藏/公开关联并重置高亮（节点角标与画板右侧操作栏同步失效），
   *  避免旧结果按钮高亮残留误导；下次收藏/公开将按当前内容重新生成记录。 */
  const invalidateSavedRecordOnContentChange = useCallback(
    (id: string, patch: Record<string, any>) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node) return;
      const cur = node.data ?? {};
      const changed = Object.entries(patch).some(([k, v]) => cur[k] !== v);
      if (!changed || generationIds.current[id] === undefined) return;
      delete generationIds.current[id];
      setFavoritedState((prev) => ({ ...prev, [id]: false }));
      setPublishedState((prev) => ({ ...prev, [id]: false }));
      setStaleRecordIds?.((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** 图书小票节点：状态更新写入 node.data（持久化）。
   *  插图（图书封面 / 上游图片 / 本地上传）与「生成输出图」分离：
   *  组件侧统一以 imageUrl 表达插图，此处持久化写入 coverImageUrl，
   *  node.data.imageUrl 保留给导出生成的完整小票（下游 / 画廊读取它），避免互相覆盖。 */
  const handleUpdateReceiptStateFor = useCallback(
    (id: string, patch: Record<string, any>) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== 'receipt_printer') return;
      invalidateSavedRecordOnContentChange(id, patch);
      const stored = { ...patch };
      if ('imageUrl' in stored) {
        stored.coverImageUrl = stored.imageUrl;
        delete stored.imageUrl;
      }
      updateNodeData(id, stored);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invalidateSavedRecordOnContentChange]);

  /** 图书卡片节点：状态更新写入 node.data（持久化）。
   *  imageUrl 仅由导出链路写入（组件只 patch templateId / decorIndex 等内容字段）；
   *  模板 / 装饰图变更即视为内容变更，解除已保存记录的收藏/公开关联。 */
  const handleUpdateBookCardStateFor = useCallback(
    (id: string, patch: Record<string, any>) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== 'book_card') return;
      invalidateSavedRecordOnContentChange(id, patch);
      updateNodeData(id, patch);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invalidateSavedRecordOnContentChange]);

  // ---------- Wikipedia 检索：从全文视图返回结果列表（仅切视图） ----------
  const handleBackToWikipediaResultsFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'wikipedia_search') return;
    if (!(node.data?.articleTitle ?? '')) return;
    updateNodeData(id, { articleTitle: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 工具类 fetch（日历/天气/Wikipedia/知乎/翻译/网络搜索） ----------
  const toolRequestCtx: ToolRequestCtx = {
    nodesRef, edgesRef, portTypesRef, updateNodeData,
  };
  const {
    handleFetchCalendarFor,
    handleFetchWeatherFor,
    handleSearchWikipediaFor,
    handleOpenWikipediaArticleFor,
    handleFetchZhihuFor,
    handleFetchTranslationFor,
    handleFetchWebSearchFor,
    handleFetchVuFindCallNumberFor,
  } = useToolHandlers(toolRequestCtx);

  // ---------- 图片输出（选中保存/导出落盘） ----------
  const imageOutputCtx: ImageOutputCtx = {
    nodesRef, edgesRef, generationIds,
    setFavoritedState, setPublishedState, setSelectedImageId, setStaleRecordIds,
    recordHistory, updateNodeData,
  };
  const {
    handleSelectSearchImageFor,
    handleSelectGlamImageFor,
    handleSelectPatternFor,
    handleSelectColorFor,
    handleExportReceiptFor,
    handleExportBookCardFor,
    handleExportStampFor,
    handleExportStickerFor,
    handleExportJournalFor,
    handleExportTextImageFor,
    handleExportOilPaintFor,
    handleExportImageProcessFor,
    handleExportEmbossFoilFor,
    handleExportGlassRefractFor,
    handleExportEditorialFor,
    handleExportMapPosterFor,
    handleExportMapArtFor,
  } = useImageOutputHandlers(imageOutputCtx);

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

  // ---------- 稳定回调（配合节点组件 memo）：避免内联箭头导致未变化节点重渲染 ----------
  // 不变量：handleRemove 仅读取 refs / 稳定 setter；闭包不会过期。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleRemove = useCallback((id: string) => handleRemoveNode(id), []);

  return {
    handleRemove,
    handleRetryBookFor,
    handleFetchBookFor,
    handleForceRefreshBookFor,
    handleUploadCoverFor,
    handleDownloadBookData,
    handleDownloadVuFindData,
    handleEditContent,
    handleRetryPromptFor,
    handleRunAnalysisFor,
    handleRetryImageFor,
    handleSaveImageFor,
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
    handleFetchVuFindCallNumberFor,
    handleUpdateVuFindEditorFor,
    handleUpdateMapPosterEditorFor,
    handleExportMapPosterFor,
    handleUpdateMapArtEditorFor,
    handleExportMapArtFor,
    handleExportReceiptFor,
    handleUpdateReceiptStateFor,
    handleExportBookCardFor,
    handleUpdateBookCardStateFor,
    handleExportStampFor,
    handleUpdateStampStateFor,
    handleUpdateStickerMakerStateFor,
    handleExportStickerFor,
    handleUpdateJournalMakerStateFor,
    handleExportJournalFor,
    handleUpdateTextImageStateFor,
    handleExportTextImageFor,
    handleExportOilPaintFor,
    handleUpdateOilPaintStateFor,
    handleExportImageProcessFor,
    handleUpdateImageProcessStateFor,
    handleExportEmbossFoilFor,
    handleUpdateEmbossFoilStateFor,
    handleExportGlassRefractFor,
    handleUpdateGlassRefractStateFor,
    handleExportEditorialFor,
    handleUpdateEditorialStateFor,
    handleSelectSearchImageFor,
    handleUpdateImageSearchEditorFor,
    handleSelectGlamImageFor,
    handleUpdateGlamEditorFor,
    handleSelectPatternFor,
    handleUpdatePatternEditorFor,
    handleSelectColorFor,
    handleUpdateColorEditorFor,
    handleUpdatePromptFor,
    handleUpdateAggregateTemplateFor,
    handleRenameAggregatePlaceholderFor,
    handleUpdateRunSettingsFor,
    handleNodeContextMenu,
    closeContextMenu,
  };
}