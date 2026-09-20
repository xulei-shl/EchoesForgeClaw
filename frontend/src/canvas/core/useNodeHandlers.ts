import { useCallback } from 'react';
import type { NodeData, EdgeData, NodeSize } from './graphTypes';
import type { PortTypesLookup } from './execution';
import { resolveReferenceImage, collectNodeInputs, firstUpstreamText } from './execution';
import { collectDescendantIds, hasChildOfType } from './nodeGraph';
import { useEditorPatchHandler, type EditorPatchFns } from './editorPatch';
import { useToolHandlers, type ToolRequestCtx } from '../nodes/ai/infra/useToolHandlers';
import {
  useImageOutputHandlers,
  type ImageOutputCtx,
} from './useImageOutputHandlers';
import type { ChatNodeSettings, NodeRunSettings, PromptSelection, SkillSelection } from '../../shared/types';
import type { WikipediaSearchRequest } from '../nodes/general/WikipediaSearchNode';
import type { ZhihuSearchMode, ZhihuSearchRequest } from '../nodes/general/ZhihuSearchNode';
import type { WebSearchRequest, WebSearchSource } from '../nodes/general/WebSearchNode';
import type { TranslationRequest, TranslationSource } from '../nodes/text/TextTranslationNode';
import { findConnectedBookInfoUpstream, findRootBookInfo } from '../nodes/_shared/nodeTypes';
import { getNodeProducer, getNodeCandidateOps } from './nodeProducers';
import type { CanvasRunOutcome } from './canvasCommands';

/** 纯 ISBN 文本（与 VuFind 节点的上级文本兜底同口径） */
const PURE_ISBN_TEXT = /^[\dXx-]{10,17}$/;

/** 知乎检索各模式数量上限（与 ZhihuSearchNode 的 MAX_COUNT 同口径） */
const ZHIHU_MAX_COUNT: Record<ZhihuSearchMode, number> = { zhihu: 10, zhida: 10 };

/** 网络搜索的合法检索源（与 WebSearchNode 的 SOURCE_OPTIONS 同口径） */
const WEB_SEARCH_SOURCES: readonly WebSearchSource[] = [
  'random',
  'zhihu_global',
  'tavily',
  'exa',
  'anysearch',
  'doubao',
];

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
  /** 批量删除节点（含子孙）：中止进行中请求，清理连线/尺寸/收藏/公开/generation 关联。
   *  返回随删除一并移除的连线 id（供调用方回执）。 */
  const removeNodesByIds = (ids: string[]): string[] => {
    recordHistory();
    const idSet = new Set(ids);
    const removedEdgeIds = edgesRef.current
      .filter((e) => idSet.has(e.source) || idSet.has(e.target))
      .map((e) => e.id);
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
    return removedEdgeIds;
  };

  /**
   * 删除节点（画布 UI 与模块级画布命令层共用）：
   * - `cascade`（默认 true）与画布 UI 一致：连同全部下游子孙节点一起删除；
   * - `confirmed` 为 true 表示确认已在调用方完成（如画板助手扩展侧），前端不再弹自家确认框；
   * - 有子孙且未确认时弹确认框，用户取消则返回空结果、不产生任何变更。
   */
  const removeNode = async (
    id: string,
    opts?: { cascade?: boolean; confirmed?: boolean }
  ): Promise<{ deletedIds: string[]; deletedEdges: string[] }> => {
    if (!nodesRef.current.some((n) => n.id === id)) {
      return { deletedIds: [], deletedEdges: [] };
    }
    const cascade = opts?.cascade !== false;
    const ids = cascade ? collectDescendantIds(id, edgesRef.current) : [id];
    if (ids.length > 1 && !opts?.confirmed) {
      if (removingRef.current) return { deletedIds: [], deletedEdges: [] };
      removingRef.current = true;
      try {
        const ok = await dialog.confirm({
          title: '级联删除',
          message: `该节点下还有 ${ids.length - 1} 个子节点（含后续分支）。删除将同时移除它们，是否继续？`,
          confirmText: '删除',
          danger: true,
        });
        if (!ok) return { deletedIds: [], deletedEdges: [] };
      } finally {
        removingRef.current = false;
      }
    }
    const deletedEdges = removeNodesByIds(ids);
    return { deletedIds: ids, deletedEdges };
  };

  /** 画布 UI 单节点删除入口：默认级联、有子孙时弹确认（行为与改造前一致） */
  const handleRemoveNode = (id: string) => {
    void removeNode(id);
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
  /** 图书元数据节点：重置为空态输入框（彻底清空旧图书元数据并记历史） */
  const handleResetBookFor = useCallback((id: string) => {
    recordHistory();
    setNodes((prev) =>
      prev.map((n) =>
        n.id === id
          ? {
              ...n,
              data: {
                isbn: '',
                isGenerating: false,
                error: null,
              },
            }
          : n
      )
    );
  }, [recordHistory, setNodes]);
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
    // 图书元数据与封面开关不写显式值：默认跟随 book_info 连通性（见 execution.ts isBookMetadataEnabled / isBookCoverEnabled）
    const old = node.data?.settings ?? {
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
      // 干净对话 -> 延迟分配工作区：置空 workspaceId，与「新建节点」同口径——首个发送 / 上传
      // 附件时才生成 `${id}_${Date.now()}` 并创建目录；避免「清空后未开新对话（如直接载入
      // 历史会话）」就留下空 chatid 文件夹（水合 GET 会以该 id 建目录）。
      workspaceId: '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** AI 对话节点（Skill Agent）：从历史列表载入指定会话（切换 workspaceId，宿主 effect 自动水合） */
  const handleLoadChatSessionFor = useCallback((id: string, workspaceId: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'chat') return;
    if ((node.data?.workspaceId ?? '') === workspaceId) return;
    recordHistory();
    // 清空展示态：宿主「workspaceId 变化」effect 会作废旧轮、复位流状态并从服务端水合新会话
    updateNodeData(id, {
      messages: [],
      output: '',
      agentSteps: [],
      error: null,
      workspaceId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** AI 对话节点（Skill Agent）：删除当前会话后重置为全新工作区（与 handleClearChatFor 同口径：
   *  置空 workspaceId，首个发送 / 上传时才生成并创建目录，无消息守卫） */
  const handleResetChatWorkspaceFor = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'chat') return;
    recordHistory();
    updateNodeData(id, {
      messages: [],
      output: '',
      agentSteps: [],
      error: null,
      epoch: (node.data?.epoch ?? 0) + 1,
      workspaceId: '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** 图片加载节点上传 / 替换 / 加载 / 清除图片（imageUrl 为 null 表示清除已加载图，回落继承源；未变化不记历史） */
  const handleImageChangeFor = useCallback(
    (id: string, imageUrl: string | null, imageName: string) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== 'image_upload') return;

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
  const handleUpdateTextEditorFor = useEditorPatchHandler(['text'], editorPatchFns);
  const handleUpdateStampStateFor = useEditorPatchHandler(['stamp_cutter'], editorPatchFns);
  const handleUpdateImageBgRemoveStateFor = useEditorPatchHandler(['image_bg_remove'], editorPatchFns);
  const handleUpdateStickerMakerStateFor = useEditorPatchHandler(['sticker_maker'], editorPatchFns);
  const handleUpdateJournalMakerStateFor = useEditorPatchHandler(['journal_maker'], editorPatchFns);
  const handleUpdateTextImageStateFor = useEditorPatchHandler(['text_image'], editorPatchFns);
  const handleUpdateOilPaintStateFor = useEditorPatchHandler(['oil_paint'], editorPatchFns);
  const handleUpdateImageProcessStateFor = useEditorPatchHandler(['image_process'], editorPatchFns);
  const handleUpdateEmbossFoilStateFor = useEditorPatchHandler(['emboss_foil'], editorPatchFns);
  const handleUpdateGlassRefractStateFor = useEditorPatchHandler(['glass_refract'], editorPatchFns);
  const handleUpdateEditorialStateFor = useEditorPatchHandler(['editorial_layout'], editorPatchFns);
  const handleUpdateWatercolorBrushStateFor = useEditorPatchHandler(['watercolor_brush'], editorPatchFns);
  const handleUpdateInkWashStateFor = useEditorPatchHandler(['ink_wash'], editorPatchFns);

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

  // ---------- 运行节点（画板助手命令层 runNodeById 的实现） ----------
  /**
   * 按节点类型分派到既有运行入口，与画布 UI 手点「运行 / 检索 / 生成 / 选中」完全同口径
   * （检索类 handler 内部自会把连线上游文本并入输入）。
   * 返回 `CanvasRunOutcome`：`ran` ＝已发起/完成；`candidates` ＝候选就绪等调用方选定；
   * `not_started` ＝未发起（原因须原样回传，不得静默）。
   *
   * 三类节点的内部能力由组件自己注册（nodeProducers.ts）：
   * - 渲染产物类（16 个）→ `getNodeProducer`；
   * - 候选检索类（image_search / art_image_search / pattern_search / color_search）→ `getNodeCandidateOps`。
   */
  const runNodeById = useCallback(
    async (id: string, selectIndex?: number): Promise<CanvasRunOutcome> => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node) return { kind: 'not_started', reason: `节点 ${id} 不存在（可先用 canvas_list_nodes 查清单）` };
      if (node.data?.isGenerating) {
        return { kind: 'not_started', reason: `节点「${node.type}」正在运行中，请稍候再试` };
      }

      // 候选检索类（图片 / 艺术图 / 纹样 / 配色）：候选只存在组件本地 state，故由组件暴露
      // 「列候选 + 确保已检索 + 选中」；未传 selectIndex 时先回候选清单（供 Agent 判断），
      // 传了则选中并核对产物真的落盘。
      const candidateOps = getNodeCandidateOps(id);
      if (candidateOps) {
        if (selectIndex === undefined) {
          if (candidateOps.list().length === 0) await candidateOps.ensure();
          const candidates = candidateOps.list();
          if (candidates.length === 0) {
            return {
              kind: 'not_started',
              reason:
                '该节点当前没有候选（检索无结果、仍在加载，或关键词为空）；可先改上游文本/关键词后重试',
            };
          }
          // 候选可用但不完整时（如聚合检索部分来源失败）一并回传，不阻断选定
          return { kind: 'candidates', candidates, warnings: candidateOps.warnings?.() ?? [] };
        }
        const reason = await candidateOps.select(selectIndex);
        if (reason) return { kind: 'not_started', reason };
        const selected = nodesRef.current.find((n) => n.id === id);
        if (!selected?.data?.imageUrl) {
          const detail = selected?.data?.error ? `（节点报错：${selected.data.error}）` : '';
          return {
            kind: 'not_started',
            reason: `已提交选中但产物未落盘${detail}——通常是候选已被清空或保存失败，请重试`,
          };
        }
        // 选定时也带上「候选不完整」的提示：Agent 可能直接带 select_index 调用（没先取候选）
        return { kind: 'ran', warnings: candidateOps.warnings?.() ?? [] };
      }

      // 渲染类节点（图书卡片 / 小票 / 水彩 / 地图海报…）：调用组件注册的生成入口，
      // 等它把产物渲染并写入 data.imageUrl；未注册（组件未挂载）时如实报错，不伪造产物。
      const produce = getNodeProducer(id);
      if (produce) {
        try {
          await produce();
        } catch (err: any) {
          return { kind: 'not_started', reason: `生成失败：${err?.message || err?.detail || err}` };
        }
        const produced = nodesRef.current.find((n) => n.id === id);
        if (!produced?.data?.imageUrl) {
          // 组件的生成函数失败时只 toast + 写 data.error（不抛），故把节点错误一并转述，不静默
          const detail = produced?.data?.error ? `（节点报错：${produced.data.error}）` : '';
          return {
            kind: 'not_started',
            reason: `生成已执行但没有产出图片${detail}——通常是缺少上游图片/图书元数据或关键参数未填，请先核对输入再重试`,
          };
        }
        return { kind: 'ran', warnings: [] };
      }
      const d = node.data ?? {};
      const upstream = firstUpstreamText(
        node,
        nodesRef.current,
        edgesRef.current,
        portTypesRef.current
      ).trim();

      // 分派本体：返回空串＝已发起运行，非空＝未发起的原因（下面统一包成 CanvasRunOutcome）
      const dispatchRun = (): string => {
        switch (node.type) {
          // AI 三类：与「运行」按钮同一入口（内部已含输入收集与待运行原因）
          case 'image_analysis':
          case 'text_generation':
          case 'image_generation':
            return runNode(node) ?? '';
          // 图书元数据：按当前 ISBN 重新拉取（改 ISBN 后可用它重新获取）
          case 'book_info': {
            const isbn = typeof d.isbn === 'string' ? d.isbn.trim() : '';
            if (!isbn) return '图书元数据节点缺少 ISBN（先写入 data.isbn 再运行）';
            handleRetryBookFor(id);
            return '';
          }
          case 'weather': {
            const city = typeof d.city === 'string' ? d.city.trim() : '';
            if (!upstream && !city) return '天气查询缺少城市（连线文本节点或写入 data.city）';
            handleFetchWeatherFor(id, city);
            return '';
          }
          case 'calendar':
            handleFetchCalendarFor(id, typeof d.date === 'string' ? d.date : '');
            return '';
          case 'wikipedia_search': {
            const query = typeof d.query === 'string' ? d.query : '';
            if (!upstream && !query.trim()) {
              return 'Wikipedia 检索缺少关键词（连线文本节点或写入 data.query）';
            }
            const payload: WikipediaSearchRequest = {
              query,
              language: typeof d.language === 'string' ? d.language : 'zh',
              limit: typeof d.limit === 'number' ? d.limit : 10,
            };
            handleSearchWikipediaFor(id, payload);
            return '';
          }
          case 'zhihu_search': {
            const mode: ZhihuSearchMode = d.mode === 'zhida' ? 'zhida' : 'zhihu';
            const query = typeof d.query === 'string' ? d.query : '';
            if (!upstream && !query.trim()) {
              return '知乎检索缺少关键词（连线文本节点或写入 data.query）';
            }
          const tab = (d.tabData ?? {})[mode];
          // 与节点内 handleQuery 同口径：模式 tab 里的 count/model 优先（model 兼容顶层旧字段），
          // 直答模式后端不使用 count（节点传 0），站内模式数量上限与节点一致（MAX_COUNT）
          const payload: ZhihuSearchRequest = {
            mode,
            query,
            count:
              mode === 'zhida'
                ? 0
                : Math.min(
                    typeof tab?.count === 'number'
                      ? tab.count
                      : typeof d.count === 'number'
                        ? d.count
                        : 5,
                    ZHIHU_MAX_COUNT[mode]
                  ),
            model:
              typeof tab?.model === 'string'
                ? tab.model
                : typeof d.model === 'string'
                  ? d.model
                  : 'zhida-fast-1p5',
          };
            handleFetchZhihuFor(id, payload);
            return '';
          }
          case 'web_search': {
            const query = typeof d.query === 'string' ? d.query : '';
            if (!upstream && !query.trim()) {
              return '网络搜索缺少关键词（连线文本节点或写入 data.query）';
            }
            const source: WebSearchSource = WEB_SEARCH_SOURCES.includes(d.source as WebSearchSource)
              ? (d.source as WebSearchSource)
              : 'random';
            const tab = (d.tabData ?? {})[source];
            const payload: WebSearchRequest = {
              query,
              count: typeof tab?.count === 'number' ? tab.count : 5,
              source,
            };
            handleFetchWebSearchFor(id, payload);
            return '';
          }
          case 'text_translation': {
            const text = typeof d.inputText === 'string' ? d.inputText : '';
            if (!text.trim() && !upstream) {
              return '文本翻译缺少待翻译文本（连线文本节点或写入 data.inputText）';
            }
            const source: TranslationSource =
              d.source === 'google' || d.source === 'deeplx' ? d.source : 'random';
            const payload: TranslationRequest = {
              text,
              from: typeof d.from === 'string' ? d.from : 'auto',
              to: typeof d.to === 'string' ? d.to : 'en',
              source,
            };
            handleFetchTranslationFor(id, payload);
            return '';
          }
          case 'vufind_call_number': {
            // ISBN 解析与 VuFind 节点同口径（上游继承会写入 data.isbn，故本地值优先）：
            // ① 本节点已落盘的 isbn；② 沿连线向上追溯的 book_info；③ 画布根 book_info 兜底；
            // ④ 上级文本恰好是纯 ISBN。
            const ownIsbn = typeof d.isbn === 'string' ? d.isbn.trim() : '';
            const connectedBook = findConnectedBookInfoUpstream(id, nodesRef.current, edgesRef.current);
            const connectedIsbn =
              typeof connectedBook?.data?.isbn === 'string' ? connectedBook.data.isbn.trim() : '';
            const rootBook = findRootBookInfo(nodesRef.current, edgesRef.current);
            const rootIsbn = typeof rootBook?.data?.isbn === 'string' ? rootBook.data.isbn.trim() : '';
            const isbn =
              ownIsbn || connectedIsbn || rootIsbn || (PURE_ISBN_TEXT.test(upstream) ? upstream : '');
            if (!isbn) return 'VuFind 馆藏缺少 ISBN（连线图书元数据节点，或写入 data.isbn）';
            handleFetchVuFindCallNumberFor(id, isbn);
            return '';
          }
          // 候选检索类的候选能力未注册（数据只在组件内部）时的兜底说明；正常情况已在上面处理
          case 'image_search':
          case 'art_image_search':
          case 'pattern_search':
          case 'color_search':
            return '该类型节点正在自动检索或候选数据尚未就绪（候选由节点组件维护）；请稍后重试，或先确认关键词/上游文本已存在';
          default:
            return `节点类型 ${node.type} 没有可由助手触发的运行入口（交互选择类节点请按画布上的操作方式使用）`;
        }
      };

      const reason = dispatchRun();
      return reason ? { kind: 'not_started', reason } : { kind: 'ran', warnings: [] };
      // 稳定回调：仅读取 refs / 稳定 handler，闭包不会过期
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

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
    handleExportImageBgRemoveFor,
    handleExportStickerFor,
    handleExportJournalFor,
    handleExportTextImageFor,
    handleExportOilPaintFor,
    handleExportImageProcessFor,
    handleExportEmbossFoilFor,
    handleExportGlassRefractFor,
    handleExportEditorialFor,
    handleExportWatercolorBrushFor,
    handleExportInkWashFor,
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
    removeNode,
    runNodeById,
    handleRetryBookFor,
    handleFetchBookFor,
    handleForceRefreshBookFor,
    handleResetBookFor,
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
    handleLoadChatSessionFor,
    handleResetChatWorkspaceFor,
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
    handleUpdateTextEditorFor,
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
    handleUpdateImageBgRemoveStateFor,
    handleExportImageBgRemoveFor,
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
    handleExportWatercolorBrushFor,
    handleUpdateWatercolorBrushStateFor,
    handleExportInkWashFor,
    handleUpdateInkWashStateFor,
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