import React from 'react';
import { BookInfoNode } from './components/BookInfoNode';
import { ImageAnalysisNode } from './components/ImageAnalysisNode';
import { PromptNode } from './components/PromptNode';
import { ChatNode } from './components/ChatNode';
import { ImageNode } from './components/ImageNode';
import { TextNode } from './components/TextNode';
import { ImageUploadNode } from './components/ImageUploadNode';
import { TextAggregateNode } from './components/TextAggregateNode';
import { getNodeTitle, matchPortType, resolveDirectParents } from './nodeTypes';
import { DEFAULT_RUN_SETTINGS, type PortTypesLookup } from './execution';
import type { EdgeData, NodeData, NodeSize } from './graphTypes';
import type {
  ChatNodeSettings,
  NodeRunSettings,
  RegistryNodeConfig,
} from '../../platform/types';

/** 节点渲染所需的全部依赖（由画布注入：稳定回调 + 派生状态 + 查找函数） */
export interface NodeViewHelpers {
  nodes: NodeData[];
  edges: EdgeData[];
  nodeSizes: Record<string, NodeSize>;
  favoritedState: Record<string, boolean>;
  publishedState: Record<string, boolean>;
  staleRecordIds: Set<string>;
  activeImage?: NodeData;
  hasBookInfo: boolean;
  portTypesOf: PortTypesLookup;
  configOf: (node: NodeData) => RegistryNodeConfig | undefined;
  renderFooter: (node: NodeData) => React.ReactNode;
  handleRemove: (id: string) => void;
  handleRetryBookFor: (id: string) => void;
  handleFetchBookFor: (id: string, isbn: string) => void;
  handleForceRefreshBookFor: (id: string) => void;
  handleDownloadBookData: (id: string) => void;
  handleRunAnalysisFor: (id: string, image?: string) => void;
  handleRetryPromptFor: (id: string) => void;
  handleEditContent: (id: string, content: string) => void;
  handleRunFor: (id: string) => void;
  handleUpdateRunSettingsFor: (id: string, settings: NodeRunSettings) => void;
  handleRetryImageFor: (id: string) => void;
  handleSelectImage: (id: string) => void;
  handleToggleFavoriteFor: (id: string) => Promise<boolean>;
  handleTogglePublicFor: (id: string) => Promise<boolean>;
  handleEditTextFor: (id: string, content: string) => void;
  handleImageChangeFor: (id: string, imageUrl: string | null, imageName: string) => void;
  handleSendChatFor: (id: string, text: string) => void;
  /** 文本聚合节点：保存占位符模板 */
  handleUpdateAggregateTemplateFor: (id: string, template: string) => void;
  /** 文本聚合节点：重命名某上级节点的占位符别名 */
  handleRenameAggregatePlaceholderFor: (id: string, parentId: string, alias: string) => void;
  handleUpdateChatSettingsFor: (id: string, settings: ChatNodeSettings) => void;
  handleClearChatFor: (id: string) => void;
  handleStopChatFor: (id: string) => void;
  handleRetryChatFor: (id: string) => void;
  handleNodeContextMenu: (e: React.MouseEvent, nodeId: string) => void;
  handlePositionChange: (id: string, x: number, y: number) => void;
  handleSizeChange: (id: string, width: number, height: number) => void;
  handleNodeDrag: (id: string, x: number, y: number) => void;
}

/** 某节点的入边端口类型不匹配数（软提示：红色连线 + 节点徽标） */
function mismatchBadgeOf(node: NodeData, h: NodeViewHelpers): string | null {
  let count = 0;
  for (const e of h.edges) {
    if (e.target !== node.id) continue;
    const src = h.nodes.find((n) => n.id === e.source);
    if (!src) continue;
    const m = matchPortType(h.portTypesOf(src.type).output, h.portTypesOf(node.type).inputs);
    if (m === 'mismatch') count++;
  }
  return count > 0 ? `类型不匹配 ×${count}` : null;
}

/** 画布节点渲染：按节点类型分发到对应组件（bookplate 模块唯一渲染入口） */
export function renderCanvasNode(node: NodeData, h: NodeViewHelpers): React.ReactNode {
  const common = {
    key: node.id,
    id: node.id,
    initialX: node.x,
    initialY: node.y,
    title: getNodeTitle(node),
    onRemove: () => h.handleRemove(node.id),
    onPositionChange: h.handlePositionChange,
    onSizeChange: h.handleSizeChange,
    onDrag: h.handleNodeDrag,
    onContextMenu: (e: React.MouseEvent) => h.handleNodeContextMenu(e, node.id),
    footer: h.renderFooter(node),
  };
  const mismatchBadge = mismatchBadgeOf(node, h);
  const settings: NodeRunSettings = node.data?.settings ?? DEFAULT_RUN_SETTINGS;

  switch (node.type) {
    case 'book_info':
      return (
        <BookInfoNode
          {...common}
          data={node.data}
          isGenerating={!!node.data.isGenerating}
          error={node.data.error ?? null}
          onRetry={h.handleRetryBookFor}
          onFetch={h.handleFetchBookFor}
          onForceRefresh={h.handleForceRefreshBookFor}
          onDownload={h.handleDownloadBookData}
        />
      );
    case 'image_analysis': {
      const config = h.configOf(node);
      const hasDownstream = h.edges.some((e) => e.source === node.id);
      return (
        <ImageAnalysisNode
          {...common}
          analysis={node.data.analysis}
          agentSteps={node.data.agentSteps}
          agentName={config?.mode === 'agent' ? (config.agent_name ?? undefined) : undefined}
          group={config?.group?.trim() || undefined}
          mismatchBadge={mismatchBadge}
          hasDownstream={hasDownstream}
          isGenerating={!!node.data.isGenerating}
          error={node.data.error ?? null}
          onRun={h.handleRunAnalysisFor}
          settings={settings}
          onUpdateSettings={h.handleUpdateRunSettingsFor}
          hasBookInfo={h.hasBookInfo}
        />
      );
    }
    case 'prompt_generation': {
      const config = h.configOf(node);
      const hasDownstream = h.edges.some((e) => e.source === node.id);
      return (
        <PromptNode
          {...common}
          content={node.data.content}
          agentSteps={node.data.agentSteps}
          agentName={config?.mode === 'agent' ? (config.agent_name ?? undefined) : undefined}
          group={config?.group?.trim() || undefined}
          mismatchBadge={mismatchBadge}
          hasDownstream={hasDownstream}
          isGenerating={!!node.data.isGenerating}
          error={node.data.error ?? null}
          onRetry={h.handleRetryPromptFor}
          onEditContent={h.handleEditContent}
          onRun={h.handleRunFor}
          settings={settings}
          onUpdateSettings={h.handleUpdateRunSettingsFor}
          hasBookInfo={h.hasBookInfo}
        />
      );
    }
    case 'image_generation': {
      const config = h.configOf(node);
      // 参考图状态：直接连线的「图片上传」节点图片作为图生图参考（画线连上即输入）。
      // LLM 模式直接进 extra_body.image（必然使用）；Agent 模式经 imageUrls 传给 FastClaw
      // （物化到 workspace 供视觉模型/图像工具使用，是否实际采用取决于 Agent 行为）。
      const uploadNode = resolveDirectParents(node.id, h.nodes, h.edges).find(
        (p) => p.type === 'image_upload'
      );
      const refImage =
        typeof uploadNode?.data?.imageUrl === 'string' ? uploadNode.data.imageUrl : undefined;
      const referenceNote = uploadNode
        ? refImage
          ? config?.mode === 'agent'
            ? '参考图已传入 Agent'
            : '已使用参考图 · 图生图'
          : '等待上传参考图（上传后点击运行）'
        : undefined;
      return (
        <ImageNode
          {...common}
          imageUrl={node.data.imageUrl}
          agentSteps={node.data.agentSteps}
          agentName={config?.mode === 'agent' ? (config.agent_name ?? undefined) : undefined}
          group={config?.group?.trim() || undefined}
          mismatchBadge={mismatchBadge}
          referenceImageUrl={refImage ?? null}
          referenceNote={referenceNote}
          referenceWaiting={!!uploadNode && !refImage}
          isGenerating={!!node.data.isGenerating}
          error={node.data.error}
          isMock={node.data.isMock}
          isFavorited={!!h.favoritedState[node.id]}
          isPublic={!!h.publishedState[node.id]}
          isSelected={node.id === h.activeImage?.id}
          recordDeleted={h.staleRecordIds.has(node.id)}
          onSelect={h.handleSelectImage}
          onRetry={h.handleRetryImageFor}
          onRun={h.handleRunFor}
          onToggleFavorite={h.handleToggleFavoriteFor}
          onTogglePublic={h.handleTogglePublicFor}
          settings={settings}
          onUpdateSettings={h.handleUpdateRunSettingsFor}
          hasBookInfo={h.hasBookInfo}
        />
      );
    }
    case 'text': {
      const hasDownstream = h.edges.some((e) => e.source === node.id);
      return (
        <TextNode
          {...common}
          content={node.data.content ?? ''}
          hasDownstream={hasDownstream}
          onEditContent={h.handleEditTextFor}
        />
      );
    }
    case 'image_upload': {
      const hasDownstream = h.edges.some((e) => e.source === node.id);
      return (
        <ImageUploadNode
          {...common}
          imageUrl={node.data.imageUrl ?? null}
          imageName={node.data.imageName ?? ''}
          hasDownstream={hasDownstream}
          onImageChange={h.handleImageChangeFor}
        />
      );
    }
    case 'chat': {
      const hasDownstream = h.edges.some((e) => e.source === node.id);
      const config = h.configOf(node);
      return (
        <ChatNode
          {...common}
          messages={node.data.messages}
          hasDownstream={hasDownstream}
          mismatchBadge={mismatchBadge}
          agentName={config?.mode === 'agent' ? (config.agent_name ?? undefined) : undefined}
          group={config?.group?.trim() || undefined}
          isGenerating={!!node.data.isGenerating}
          error={node.data.error ?? null}
          settings={node.data.settings ?? { includeBook: true, includeUpstream: true }}
          onSend={h.handleSendChatFor}
          onUpdateSettings={h.handleUpdateChatSettingsFor}
          onClearChat={h.handleClearChatFor}
          onStop={h.handleStopChatFor}
          onRetry={h.handleRetryChatFor}
        />
      );
    }
    case 'text_aggregate': {
      const hasDownstream = h.edges.some((e) => e.source === node.id);
      return (
        <TextAggregateNode
          {...common}
          parents={resolveDirectParents(node.id, h.nodes, h.edges)}
          template={typeof node.data?.template === 'string' ? node.data.template : ''}
          placeholders={node.data?.placeholders ?? {}}
          output={typeof node.data?.output === 'string' ? node.data.output : ''}
          portTypesOf={h.portTypesOf}
          hasDownstream={hasDownstream}
          mismatchBadge={mismatchBadge}
          onUpdateTemplate={h.handleUpdateAggregateTemplateFor}
          onRenamePlaceholder={h.handleRenameAggregatePlaceholderFor}
        />
      );
    }
    default:
      return null;
  }
}
