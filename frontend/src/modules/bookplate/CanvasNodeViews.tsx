import React from 'react';
import { BookInfoNode } from './components/BookInfoNode';
import { ImageAnalysisNode } from './components/ImageAnalysisNode';
import { PromptNode } from './components/PromptNode';
import { ChatNodeHost, type ChatHostDeps } from './ChatNodeHost';
import { ImageNode } from './components/ImageNode';
import { TextNode } from './components/TextNode';
import { ImageUploadNode } from './components/ImageUploadNode';
import { TextAggregateNode } from './components/TextAggregateNode';
import { PromptSearchNode } from './components/PromptSearchNode';
import { SkillSearchNode } from './components/SkillSearchNode';
import { CalendarNode } from './components/CalendarNode';
import { WeatherNode } from './components/WeatherNode';
import { MapPosterNode } from '../../modules/multimodal/components/MapPosterNode';
import { ImageSearchNode, type ImageSearchSelection } from '../../modules/multimodal/components/ImageSearchNode';
import { ArtImageSearchNode, type GlamSearchSelection } from '../../modules/multimodal/components/ArtImageSearchNode';
import { MAP_POSTER_DEFAULTS } from '../../modules/multimodal/map/defaults';
import { getNodeTitle, matchPortType, nodeOutputText, resolveDirectParents } from './nodeTypes';
import {
  DEFAULT_RUN_SETTINGS,
  collectNodeInputs,
  resolveReferenceImage,
  type PortTypesLookup,
} from './execution';
import { buildInjectedContextBlocks } from './contextBlocks';
import type { EdgeData, NodeData, NodeSize } from './graphTypes';
import type {
  ChatNodeSettings,
  NodeRunSettings,
  PromptSelection,
  RegistryNodeConfig,
  SkillSelection,
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
  /** AI 对话节点宿主依赖（useChat 迁移：state setter + 端口类型查找） */
  chatDeps: ChatHostDeps;
  /** 提示词检索节点：选用一条 Bifrost 提示词 */
  handleUpdatePromptFor: (id: string, selection: PromptSelection) => void;
  /** Skill 检索节点：整块替换已选 skill 集合（多选） */
  handleUpdateSkillsFor: (id: string, selections: SkillSelection[]) => void;
  /** 万年历节点：按日期查询节假日 / 农历万年历 */
  handleFetchCalendarFor: (id: string, date: string) => void;
  /** 天气查询节点：按城市查询当前天气（城市由页面合并上游文本 / 手动输入） */
  handleFetchWeatherFor: (id: string, city: string) => void;
  /** 地图海报节点：导出 PNG data URL 落盘（保存到后端 + 记历史 + 写回 node.data） */
  handleExportMapPosterFor: (id: string, dataUrl: string) => Promise<void>;
  /** 地图海报节点：编辑器状态写入 node.data（undoable=true 记撤销历史；平移缩放仅持久化） */
  handleUpdateMapPosterEditorFor: (id: string, patch: Record<string, any>, undoable: boolean) => void;
  /** 图片检索节点：选中图片 → 下载到本地 → 写回 node.data.imageUrl（作为图片输出） */
  handleSelectSearchImageFor: (id: string, url: string, meta: ImageSearchSelection) => Promise<void>;
  /** 图片检索节点：编辑器状态（provider 等）写入 node.data（仅持久化，不记撤销历史） */
  handleUpdateImageSearchEditorFor: (id: string, patch: Record<string, any>, undoable: boolean) => void;
  /** 艺术图片检索节点：选中图片 → 下载到本地 → 写回 node.data.imageUrl（作为图片输出） */
  handleSelectGlamImageFor: (id: string, url: string, meta: GlamSearchSelection) => Promise<void>;
  /** 艺术图片检索节点：编辑器状态（provider 等）写入 node.data（仅持久化，不记撤销历史） */
  handleUpdateGlamEditorFor: (id: string, patch: Record<string, any>, undoable: boolean) => void;
  /** 文本聚合节点：保存占位符模板 */
  handleUpdateAggregateTemplateFor: (id: string, template: string) => void;
  /** 文本聚合节点：重命名某上级节点的占位符别名 */
  handleRenameAggregatePlaceholderFor: (id: string, parentId: string, alias: string) => void;
  handleUpdateChatSettingsFor: (id: string, settings: ChatNodeSettings) => void;
  handleClearChatFor: (id: string) => void;
  handleNodeContextMenu: (e: React.MouseEvent, nodeId: string) => void;
  handlePositionChange: (id: string, x: number, y: number) => void;
  handleSizeChange: (id: string, width: number, height: number) => void;
  handleNodeDrag: (id: string, x: number, y: number) => void;
}

/** 某节点的入边端口类型不匹配数（软提示：红色连线 + 节点徽标） */
export function mismatchBadgeOf(node: NodeData, h: NodeViewHelpers): string | null {
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

/** 某节点是否有下级节点（沿出边判断）：有下级时节点组件禁用「影响输出」类操作（重跑 / 编辑 / 清空等）。
 *  各节点共用同一口径，抽成公共判定避免重复计算。 */
export function hasDownstreamOf(node: { id: string }, edges: EdgeData[]): boolean {
  return edges.some((e) => e.source === node.id);
}

/** 画布节点渲染：按节点类型分发到对应组件（bookplate 模块唯一渲染入口） */
export function renderCanvasNode(node: NodeData, h: NodeViewHelpers): React.ReactNode {
  const common = {
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
    case 'book_info': {
      const hasDownstream = hasDownstreamOf(node, h.edges);
      return (
        <BookInfoNode
          key={node.id}
          {...common}
          data={node.data}
          isGenerating={!!node.data.isGenerating}
          error={node.data.error ?? null}
          hasDownstream={hasDownstream}
          onRetry={h.handleRetryBookFor}
          onFetch={h.handleFetchBookFor}
          onForceRefresh={h.handleForceRefreshBookFor}
          onDownload={h.handleDownloadBookData}
        />
      );
    }
    case 'image_analysis': {
      const config = h.configOf(node);
      const hasDownstream = hasDownstreamOf(node, h.edges);
      return (
        <ImageAnalysisNode
          key={node.id}
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
          mode={config?.mode}
          configId={node.configId ?? null}
        />
      );
    }
    case 'prompt_generation': {
      const config = h.configOf(node);
      const hasDownstream = hasDownstreamOf(node, h.edges);
      return (
        <PromptNode
          key={node.id}
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
          mode={config?.mode}
          configId={node.configId ?? null}
        />
      );
    }
    case 'image_generation': {
      const config = h.configOf(node);
      // 参考图状态：输出端口类型为 image 的直接上级（图片上传 / 图像生成…，collectNodeInputs
      // 按类型声明统一分组，后续新增图片输出节点自动生效），画线连上即输入。
      // LLM 模式直接进 extra_body.image（必然使用）；Agent 模式经 imageUrls 传给 FastClaw
      // （物化到 workspace 供视觉模型/图像工具使用，是否实际采用取决于 Agent 行为）。
      const { images: imageParents } = collectNodeInputs(node, h.nodes, h.edges, h.portTypesOf);
      const refImage = resolveReferenceImage(imageParents);
      const uploadConnected = imageParents.some((p) => p.type === 'image_upload');
      const referenceNote =
        imageParents.length > 0
          ? refImage
            ? config?.mode === 'agent'
              ? '参考图已传入 Agent'
              : '已使用参考图 · 图生图'
            : uploadConnected
              ? '等待上传参考图（上传后点击运行）'
              : '等待上级图片输出'
          : undefined;
      const hasDownstream = hasDownstreamOf(node, h.edges);
      // 上下文注入折叠块：与 AI 对话节点共用构建逻辑，展示本次运行实际并入提示词的输入
      // （提示词节点 / 图片分析 / 文本类上级 / 图书元数据与封面 / 参考图）。与 chat 同口径
      // （所见即所得）：除图书元数据走 includeBook 穿透外，任何直连上级的文本/图片都并入。
      const contextBlocks = buildInjectedContextBlocks(
        node,
        {
          includeBook: settings.includeBook,
          includeBookCover: settings.includeBookCover !== false,
          includeUpstreamText: true,
          includeUpstreamImages: true,
        },
        h.nodes,
        h.edges,
        h.portTypesOf
      );
      return (
        <ImageNode
          key={node.id}
          {...common}
          contextBlocks={contextBlocks}
          imageUrl={node.data.imageUrl}
          agentSteps={node.data.agentSteps}
          agentName={config?.mode === 'agent' ? (config.agent_name ?? undefined) : undefined}
          group={config?.group?.trim() || undefined}
          mismatchBadge={mismatchBadge}
          hasDownstream={hasDownstream}
          referenceImageUrl={refImage ?? null}
          referenceNote={referenceNote}
          referenceWaiting={imageParents.length > 0 && !refImage}
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
          showImageParams
          showBookCoverOption
          hasBookInfo={h.hasBookInfo}
          mode={config?.mode}
          configId={node.configId ?? null}
        />
      );
    }
    case 'text': {
      const hasDownstream = hasDownstreamOf(node, h.edges);
      return (
        <TextNode
          key={node.id}
          {...common}
          content={node.data.content ?? ''}
          hasDownstream={hasDownstream}
          onEditContent={h.handleEditTextFor}
        />
      );
    }
    case 'image_upload': {
      const hasDownstream = hasDownstreamOf(node, h.edges);
      return (
        <ImageUploadNode
          key={node.id}
          {...common}
          imageUrl={node.data.imageUrl ?? null}
          imageName={node.data.imageName ?? ''}
          hasDownstream={hasDownstream}
          onImageChange={h.handleImageChangeFor}
        />
      );
    }
    case 'chat': {
      // AI 对话节点：每节点一个 ChatNodeHost（useChat 实例），内部渲染 ChatNode 并镜像消息回 store
      return <ChatNodeHost key={node.id} node={node} h={h} deps={h.chatDeps} />;
    }
    case 'text_aggregate': {
      return (
        <TextAggregateNode
          key={node.id}
          {...common}
          parents={resolveDirectParents(node.id, h.nodes, h.edges)}
          template={typeof node.data?.template === 'string' ? node.data.template : ''}
          placeholders={node.data?.placeholders ?? {}}
          output={typeof node.data?.output === 'string' ? node.data.output : ''}
          portTypesOf={h.portTypesOf}
          mismatchBadge={mismatchBadge}
          onUpdateTemplate={h.handleUpdateAggregateTemplateFor}
          onRenamePlaceholder={h.handleRenameAggregatePlaceholderFor}
        />
      );
    }
    case 'prompt_search': {
      const hasDownstream = hasDownstreamOf(node, h.edges);
      return (
        <PromptSearchNode
          key={node.id}
          {...common}
          title={typeof node.data?.promptName === 'string' && node.data.promptName ? node.data.promptName : common.title}
          promptId={node.data?.promptId ?? null}
          promptName={typeof node.data?.promptName === 'string' ? node.data.promptName : ''}
          content={typeof node.data?.content === 'string' ? node.data.content : ''}
          promptImage={typeof node.data?.promptImage === 'string' ? node.data.promptImage : null}
          hasDownstream={hasDownstream}
          onUpdatePrompt={h.handleUpdatePromptFor}
        />
      );
    }
    case 'skill_search': {
      const hasDownstream = hasDownstreamOf(node, h.edges);
      // 已选 skill 集合（多选）；存量节点仍是旧单数字段 -> 空数组（重新编辑即迁移）
      const selections: SkillSelection[] = Array.isArray(node.data?.skillSelections)
        ? node.data.skillSelections
        : [];
      return (
        <SkillSearchNode
          key={node.id}
          {...common}
          title={selections.length > 0 && selections[0].name ? selections[0].name : common.title}
          selections={selections}
          hasDownstream={hasDownstream}
          onUpdateSkills={h.handleUpdateSkillsFor}
        />
      );
    }
    case 'calendar': {
      const hasDownstream = hasDownstreamOf(node, h.edges);
      return (
        <CalendarNode
          key={node.id}
          {...common}
          date={typeof node.data?.date === 'string' ? node.data.date : undefined}
          output={typeof node.data?.output === 'string' ? node.data.output : ''}
          isGenerating={!!node.data.isGenerating}
          error={node.data.error ?? null}
          hasDownstream={hasDownstream}
          onFetch={h.handleFetchCalendarFor}
        />
      );
    }
    case 'weather': {
      const hasDownstream = hasDownstreamOf(node, h.edges);
      // 连线即输入：文本输出上级内容作为城市（collectNodeInputs 按端口类型统一分组，
      // 取第一个非空），优先于手动输入
      const upstreamCity =
        collectNodeInputs(node, h.nodes, h.edges, h.portTypesOf)
          .text.map((p) => nodeOutputText(p))
          .find((v) => v.trim()) ?? '';
      return (
        <WeatherNode
          key={node.id}
          {...common}
          city={typeof node.data?.city === 'string' ? node.data.city : ''}
          upstreamCity={upstreamCity}
          output={typeof node.data?.output === 'string' ? node.data.output : ''}
          isGenerating={!!node.data.isGenerating}
          error={node.data.error ?? null}
          hasDownstream={hasDownstream}
          onFetch={h.handleFetchWeatherFor}
        />
      );
    }
    case 'map_poster': {
      const d = node.data ?? {};
      return (
        <MapPosterNode
          key={node.id}
          {...common}
          imageUrl={typeof d.imageUrl === 'string' ? d.imageUrl : null}
          error={d.error ?? null}
          renderMode={d.renderMode ?? MAP_POSTER_DEFAULTS.renderMode}
          tileTheme={typeof d.tileTheme === 'string' ? d.tileTheme : MAP_POSTER_DEFAULTS.tileTheme}
          artisticTheme={typeof d.artisticTheme === 'string' ? d.artisticTheme : MAP_POSTER_DEFAULTS.artisticTheme}
          sizeIndex={typeof d.sizeIndex === 'number' ? d.sizeIndex : MAP_POSTER_DEFAULTS.sizeIndex}
          cityName={typeof d.cityName === 'string' ? d.cityName : MAP_POSTER_DEFAULTS.cityName}
          countryName={typeof d.countryName === 'string' ? d.countryName : MAP_POSTER_DEFAULTS.countryName}
          overlaySize={d.overlaySize ?? MAP_POSTER_DEFAULTS.overlaySize}
          showMarker={typeof d.showMarker === 'boolean' ? d.showMarker : MAP_POSTER_DEFAULTS.showMarker}
          lat={typeof d.lat === 'number' ? d.lat : MAP_POSTER_DEFAULTS.lat}
          lon={typeof d.lon === 'number' ? d.lon : MAP_POSTER_DEFAULTS.lon}
          zoom={typeof d.zoom === 'number' ? d.zoom : MAP_POSTER_DEFAULTS.zoom}
          hasDownstream={hasDownstreamOf(node, h.edges)}
          onUpdateEditor={h.handleUpdateMapPosterEditorFor}
          onExport={h.handleExportMapPosterFor}
        />
      );
    }
    case 'image_search': {
      const d = node.data ?? {};
      // 连线即输入：文本输出上级内容作为检索关键词（优先于手动输入，与天气节点同口径）
      const upstreamKeyword =
        collectNodeInputs(node, h.nodes, h.edges, h.portTypesOf)
          .text.map((p) => nodeOutputText(p))
          .find((v) => v.trim()) ?? '';
      return (
        <ImageSearchNode
          key={node.id}
          {...common}
          imageUrl={typeof d.imageUrl === 'string' ? d.imageUrl : null}
          selectedImage={d.selectedImage ?? null}
          provider={d.provider === 'pixabay' ? 'pixabay' : 'unsplash'}
          upstreamKeyword={upstreamKeyword}
          error={d.error ?? null}
          hasDownstream={hasDownstreamOf(node, h.edges)}
          onSelectImage={h.handleSelectSearchImageFor}
          onUpdateEditor={h.handleUpdateImageSearchEditorFor}
        />
      );
    }
    case 'art_image_search': {
      const d = node.data ?? {};
      // 连线即输入：文本输出上级内容作为检索关键词（优先于手动输入，与天气节点同口径）
      const upstreamKeyword =
        collectNodeInputs(node, h.nodes, h.edges, h.portTypesOf)
          .text.map((p) => nodeOutputText(p))
          .find((v) => v.trim()) ?? '';
      return (
        <ArtImageSearchNode
          key={node.id}
          {...common}
          imageUrl={typeof d.imageUrl === 'string' ? d.imageUrl : null}
          selectedImage={d.selectedImage ?? null}
          provider={typeof d.provider === 'string' ? d.provider : 'met'}
          category={typeof d.category === 'string' ? d.category : ''}
          upstreamKeyword={upstreamKeyword}
          error={d.error ?? null}
          hasDownstream={hasDownstreamOf(node, h.edges)}
          onSelectImage={h.handleSelectGlamImageFor}
          onUpdateEditor={h.handleUpdateGlamEditorFor}
        />
      );
    }
    default:
      return null;
  }
}
