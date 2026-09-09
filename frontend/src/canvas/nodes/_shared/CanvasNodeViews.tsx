import React from 'react';
import { BookInfoNode } from '../general/BookInfoNode';
import { ImageAnalysisNode } from '../multimodal/ImageAnalysisNode';
import { TextGenerationNode } from '../text/TextGenerationNode';
import { ChatNodeHost, type ChatHostDeps } from '../ai/infra/ChatNodeHost';
import { PiChatNodeHost } from '../ai/infra/PiChatNodeHost';
import { ImageNode } from '../multimodal/ImageNode';
import { TextNode } from '../text/TextNode';
import { ImageUploadNode } from '../general/ImageUploadNode';
import { TextAggregateNode } from '../text/TextAggregateNode';
import { PromptSearchNode } from '../general/PromptSearchNode';
import { SkillSearchNode } from '../general/SkillSearchNode';
import { CalendarNode } from '../general/CalendarNode';
import { WeatherNode } from '../general/WeatherNode';
import { ZhihuSearchNode, type ZhihuSearchRequest } from '../general/ZhihuSearchNode';
import { WikipediaSearchNode, type WikipediaSearchRequest } from '../general/WikipediaSearchNode';
import { TextTranslationNode, type TranslationRequest } from '../text/TextTranslationNode';
import { WebSearchNode, type WebSearchRequest, type WebSearchSource } from '../general/WebSearchNode';
import { VuFindCallNumberNode } from '../general/VuFindCallNumberNode';
import { MapPosterNode } from '../multimodal/MapPosterNode';
import { ImageSearchNode, type ImageSearchSelection } from '../multimodal/ImageSearchNode';
import { ArtImageSearchNode, type GlamSearchSelection } from '../multimodal/ArtImageSearchNode';
import { ReceiptPrinterNode } from '../multimodal/ReceiptPrinterNode';
import { BookCardNode } from '../multimodal/BookCardNode';
import { StampCutterNode } from '../multimodal/StampCutterNode';
import { ImageBgRemoveNode } from '../multimodal/ImageBgRemoveNode';
import { StickerMakerNode } from '../multimodal/StickerMakerNode';
import { JournalMakerNode } from '../multimodal/JournalMakerNode';
import { TextImageNode } from '../multimodal/TextImageNode';
import { OilPaintNode } from '../multimodal/OilPaintNode';
import { ImageProcessNode } from '../multimodal/ImageProcessNode';
import { EmbossFoilNode } from '../multimodal/EmbossFoilNode';
import { GlassRefractNode } from '../multimodal/GlassRefractNode';
import { EditorialLayoutNode } from '../multimodal/EditorialLayoutNode';
import { WatercolorBrushNode } from '../multimodal/WatercolorBrushNode';
import { InkWashNode } from '../multimodal/InkWashNode';
import { MapArtNode } from '../multimodal/MapArtNode';
import { PatternSearchNode, type PatternItem } from '../multimodal/PatternSearchNode';
import { ColorSearchNode, type ColorItem } from '../multimodal/ColorSearchNode';
import { MAP_POSTER_DEFAULTS } from '../multimodal/engines/map/defaults';
import { MAP_ART_DEFAULTS } from '../multimodal/engines/map/art-defaults';
import {
  findConnectedBookInfoUpstream,
  findRootBookInfo,
  getNodeTitle,
  matchPortType,
  nodeOutputImages,
  resolveDirectParents,
} from './nodeTypes';
import {
  DEFAULT_RUN_SETTINGS,
  allUpstreamTexts,
  collectNodeInputs,
  firstExtraJsonUpstreamText,
  firstUpstreamText,
  isBookCoverEnabled,
  isBookMetadataEnabled,
  resolveReferenceImage,
  type PortTypesLookup,
} from '../../core/execution';
import { buildInjectedContextBlocks } from '../ai/infra/contextBlocks';
import type { EdgeData, NodeData, NodeSize } from '../../core/graphTypes';
import type {
  ChatNodeSettings,
  NodeRunSettings,
  PromptSelection,
  RegistryNodeConfig,
  SkillSelection,
} from '../../../shared/types';

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
  /** 图书元数据节点：重置图书元数据，回到输入框状态 */
  handleResetBookFor: (id: string) => void;
  /** 图书元数据节点：手动上传封面兜底（落盘 + 回写 book_cache） */
  handleUploadCoverFor: (id: string, file: File) => void;
  handleDownloadBookData: (id: string) => void;
  /** VuFind 索书号节点：下载获取到的元数据 JSON */
  handleDownloadVuFindData: (id: string) => void;
  handleRunAnalysisFor: (id: string, image?: string) => void;
  handleRetryPromptFor: (id: string) => void;
  handleEditContent: (id: string, content: string) => void;
  handleRunFor: (id: string) => void;
  handleUpdateRunSettingsFor: (id: string, settings: NodeRunSettings) => void;
  handleRetryImageFor: (id: string) => void;
  /** 藏书票图像节点：手动保存到数据库历史记录表 */
  handleSaveImageFor: (id: string) => Promise<void>;
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
  /** 知乎检索节点：按模式检索 / 直答（关键词由页面合并上游文本 / 手动输入） */
  handleFetchZhihuFor: (id: string, payload: ZhihuSearchRequest) => void;
  /** Wikipedia 检索节点：关键词检索（返回结果列表，写入 data.results） */
  handleSearchWikipediaFor: (id: string, payload: WikipediaSearchRequest) => void;
  /** Wikipedia 检索节点：打开一篇检索结果的文章全文（写入 data.output） */
  handleOpenWikipediaArticleFor: (id: string, title: string) => void;
  /** Wikipedia 检索节点：从全文视图返回检索结果列表（仅切视图，不清空输出） */
  handleBackToWikipediaResultsFor: (id: string) => void;
  /** Wikipedia 检索节点：编辑器状态写入 node.data（如 summaryMode 切换，仅持久化，不记撤销历史） */
  handleUpdateWikipediaEditorFor: (id: string, patch: Record<string, any>) => void;
  /** 网络搜索节点：多源检索（关键词由页面合并上游文本 / 手动输入） */
  handleFetchWebSearchFor: (id: string, payload: WebSearchRequest) => void;
  /** 网络搜索节点：编辑器状态写入 node.data（仅持久化，不记撤销历史） */
  handleUpdateWebSearchEditorFor: (id: string, patch: Record<string, any>) => void;
  /** 知乎检索节点：编辑器状态写入 node.data（仅持久化，不记撤销历史） */
  handleUpdateZhihuEditorFor: (id: string, patch: Record<string, any>, undoable?: boolean) => void;
  /** 文本翻译节点：按配置翻译上级文本（语言/翻译源由节点组件传入，页面合并上游文本后转发后端） */
  handleFetchTranslationFor: (id: string, payload: TranslationRequest) => void;
  /** 文本翻译节点：编辑器状态写入 node.data（仅持久化，不记撤销历史） */
  handleUpdateTranslationEditorFor: (id: string, patch: Record<string, any>) => void;
  /** 地图海报节点：导出 PNG data URL 落盘（保存到后端 + 记历史 + 写回 node.data） */
  handleExportMapPosterFor: (id: string, dataUrl: string) => Promise<void>;
  /** 地图海报节点：编辑器状态写入 node.data（undoable=true 记撤销历史；平移缩放仅持久化） */
  handleUpdateMapPosterEditorFor: (id: string, patch: Record<string, any>, undoable: boolean) => void;
  /** 艺术地图生成节点：后端已落盘并返回 image_url，直接写入 node.data.imageUrl */
  handleExportMapArtFor: (id: string, imageUrl: string) => Promise<void>;
  /** 艺术地图生成节点：编辑器状态写入 node.data（undoable=true 记撤销历史） */
  handleUpdateMapArtEditorFor: (id: string, patch: Record<string, any>, undoable: boolean) => void;
  /** 图片检索节点：选中图片 → 下载到本地 → 写回 node.data.imageUrl（作为图片输出） */
  handleSelectSearchImageFor: (id: string, url: string, meta: ImageSearchSelection) => Promise<void>;
  /** VuFind 馆藏状态（provider 等）写入 node.data（仅持久化，不记撤销历史） */
  handleUpdateImageSearchEditorFor: (id: string, patch: Record<string, any>, undoable: boolean) => void;
  /** VuFind 馆藏节点：根据 ISBN 获取索书号（ISBN 由页面合并上游文本 / 手动输入） */
  handleFetchVuFindCallNumberFor: (id: string, isbn: string) => void;
  /** VuFind 索书号节点：编辑器状态写入 node.data（仅持久化，不记撤销历史） */
  handleUpdateVuFindEditorFor: (id: string, patch: Record<string, any>) => void;
  /** 艺术图片检索节点：选中图片 → 下载到本地 → 写回 node.data.imageUrl（作为图片输出） */
  handleSelectGlamImageFor: (id: string, url: string, meta: GlamSearchSelection) => Promise<void>;
  /** 艺术图片检索节点：编辑器状态（provider 等）写入 node.data（仅持久化，不记撤销历史） */
  handleUpdateGlamEditorFor: (id: string, patch: Record<string, any>, undoable?: boolean) => void;
  /** 中国传统纹样检索节点：选中纹样 → 下载到本地并获取详情文本 → 写回 node.data */
  handleSelectPatternFor: (id: string, pattern: PatternItem) => Promise<void>;
  /** 中国传统纹样检索节点：编辑器状态（category 等）写入 node.data（仅持久化，不记撤销历史） */
  handleUpdatePatternEditorFor: (id: string, patch: Record<string, any>, undoable?: boolean) => void;
  /** 中国传统配色节点：选用传统色（保存图片 + 生成配色 Markdown 写入 node.data） */
  handleSelectColorFor: (id: string, color: ColorItem, palette?: ColorItem[]) => Promise<void>;
  /** 中国传统配色节点：编辑器状态（category/tab/palette 等）写入 node.data */
  handleUpdateColorEditorFor: (id: string, patch: Record<string, any>, undoable?: boolean) => void;
  /** 图书小票节点：导出 PNG data URL 落盘（保存到后端 + 记录数据库历史 + 写回 node.data） */
  handleExportReceiptFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  /** 图书小票节点：状态更新写入 node.data（持久化） */
  handleUpdateReceiptStateFor: (id: string, patch: Record<string, any>) => void;
  /** 图书卡片节点：导出 PNG data URL 落盘（保存到后端 + 记录数据库历史 + 写回 node.data） */
  handleExportBookCardFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  /** 图书卡片节点：状态更新写入 node.data（持久化） */
  handleUpdateBookCardStateFor: (id: string, patch: Record<string, any>) => void;
  /** 邮票制作节点：导出 PNG data URL 落盘（保存到后端 + 记录数据库历史 + 写回 node.data） */
  handleExportStampFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  /** 抠图节点：导出 PNG data URL 落盘（保存到后端 + 记录数据库历史 + 写回 node.data） */
  handleExportImageBgRemoveFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  handleExportStickerFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  /** 手账制作节点：导出 PNG data URL 落盘（保存到后端 + 记录数据库历史 + 写回 node.data） */
  handleExportJournalFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  /** 邮票制作节点：状态更新写入 node.data（持久化） */
  handleUpdateStampStateFor: (id: string, patch: Record<string, any>) => void;
  /** 抠图节点：状态更新写入 node.data（持久化） */
  handleUpdateImageBgRemoveStateFor: (id: string, patch: Record<string, any>) => void;
  handleUpdateStickerMakerStateFor: (id: string, patch: Record<string, any>) => void;
  /** 手账制作节点：状态更新写入 node.data（用户排版动作带 undoable 记撤销历史） */
  handleUpdateJournalMakerStateFor: (
    id: string,
    patch: Record<string, any>,
    undoable?: boolean
  ) => void;
  /** 文本成图节点：样式更新写入 node.data（离散选择带 undoable 记撤销历史） */
  handleUpdateTextImageStateFor: (
    id: string,
    patch: Record<string, any>,
    undoable?: boolean
  ) => void;
  /** 文本成图节点：导出 PNG data URL 落盘（保存到后端 + 记录数据库历史 + 写回 node.data） */
  handleExportTextImageFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  /** 湿油彩效果节点：导出 PNG data URL 落盘（保存到后端 + 记录数据库历史 + 写回 node.data） */
  handleExportOilPaintFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  /** 湿油彩效果节点：状态更新写入 node.data（持久化） */
  handleUpdateOilPaintStateFor: (id: string, patch: Record<string, any>) => void;
  /** 图片处理节点：导出 PNG data URL 落盘（保存到后端 + 记录数据库历史 + 写回 node.data） */
  handleExportImageProcessFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  /** 图片处理节点：状态更新写入 node.data（持久化） */
  handleUpdateImageProcessStateFor: (id: string, patch: Record<string, any>) => void;
  /** 微浮雕高光节点：导出 PNG data URL 落盘（保存到后端 + 记录数据库历史 + 写回 node.data） */
  handleExportEmbossFoilFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  /** 微浮雕高光节点：状态更新写入 node.data（持久化） */
  handleUpdateEmbossFoilStateFor: (id: string, patch: Record<string, any>) => void;
  /** 玻璃折射节点：导出 PNG data URL 落盘（保存到后端 + 记录数据库历史 + 写回 node.data） */
  handleExportGlassRefractFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  /** 玻璃折射节点：状态更新写入 node.data（持久化） */
  handleUpdateGlassRefractStateFor: (id: string, patch: Record<string, any>) => void;
  /** 杂志排版节点：导出 PNG data URL 落盘（保存到后端 + 记录数据库历史 + 写回 node.data） */
  handleExportEditorialFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  /** 杂志排版节点：状态更新写入 node.data（用户排版动作带 undoable 记撤销历史） */
  handleUpdateEditorialStateFor: (
    id: string,
    patch: Record<string, any>,
    undoable?: boolean
  ) => void;
  /** 物理水彩手绘节点：导出 PNG data URL 落盘（保存到后端 + 记录数据库历史 + 写回 node.data） */
  handleExportWatercolorBrushFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  /** 物理水彩手绘节点：状态更新写入 node.data（持久化） */
  handleUpdateWatercolorBrushStateFor: (id: string, patch: Record<string, any>) => void;
  /** 水墨写意节点：导出 PNG data URL 落盘（保存到后端 + 记录数据库历史 + 写回 node.data） */
  handleExportInkWashFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  /** 水墨写意节点：状态更新写入 node.data（持久化） */
  handleUpdateInkWashStateFor: (id: string, patch: Record<string, any>) => void;
  /** 文本聚合节点：保存占位符模板 */
  handleUpdateAggregateTemplateFor: (id: string, template: string) => void;
  /** 文本聚合节点：重命名某上级节点的占位符别名 */
  handleRenameAggregatePlaceholderFor: (id: string, parentId: string, alias: string) => void;
  handleUpdateChatSettingsFor: (id: string, settings: ChatNodeSettings) => void;
  handleClearChatFor: (id: string) => void;
  /** AI 对话节点（Skill Agent）：从历史列表载入指定会话（切换 workspaceId，宿主自动水合） */
  handleLoadChatSessionFor: (id: string, workspaceId: string) => void;
  /** AI 对话节点（Skill Agent）：删除当前会话后重置为全新工作区 */
  handleResetChatWorkspaceFor: (id: string) => void;
  handleNodeContextMenu: (e: React.MouseEvent, nodeId: string) => void;
  handlePositionChange: (id: string, x: number, y: number) => void;
  handleSizeChange: (id: string, width: number, height: number) => void;
  handleNodeDrag: (id: string, x: number, y: number) => void;
  handleNodeResizeLive: (id: string, width: number, height: number) => void;
}

/** 某节点的入边端口类型不匹配数（软提示：红色连线 + 节点徽标） */
export function mismatchBadgeOf(node: NodeData, h: NodeViewHelpers): string | null {
  let count = 0;
  for (const e of h.edges) {
    if (e.target !== node.id) continue;
    const src = h.nodes.find((n) => n.id === e.source);
    if (!src) continue;
    const m = matchPortType(h.portTypesOf(src.type).outputs, h.portTypesOf(node.type).inputs);
    if (m === 'mismatch') count++;
  }
  return count > 0 ? `类型不匹配 ×${count}` : null;
}

/** 小票/邮票节点上游图片解析（共用同一口径，避免两处重复） */
function resolveUpstreamImage(node: NodeData, h: NodeViewHelpers): {
  upstreamImageUrl: string | null;
  upstreamBookData: any;
} {
  const inputs = collectNodeInputs(node, h.nodes, h.edges, h.portTypesOf);
  const nonBookImageParents = inputs.images.filter((p) => p.type !== 'book_info');
  const directParentImage = resolveReferenceImage(nonBookImageParents) ?? null;
  const connectedBookNode = findConnectedBookInfoUpstream(node.id, h.nodes, h.edges);
  const connectedBookData = connectedBookNode?.data ?? null;
  const connectedBookCover =
    connectedBookData?.cover_image_local || connectedBookData?.cover_image || connectedBookData?.coverUrl || null;
  const rootBookNode = findRootBookInfo(h.nodes, h.edges);
  const rootBookData = rootBookNode?.data ?? null;
  const rootBookCover =
    rootBookData?.cover_image_local || rootBookData?.cover_image || rootBookData?.coverUrl || null;
  return {
    upstreamImageUrl: directParentImage || connectedBookCover || rootBookCover || null,
    upstreamBookData: connectedBookData || rootBookData || null,
  };
}

/**
 * 手账制作节点上游素材解析（多图并集，不走单图优先级）：
 *
 * 封面加载规则：
 *   1. 根节点图书元数据（无入边者）——无论是否连线，始终加载其封面图；
 *   2. 非根节点图书元数据——只有直连（1 级）时才加载其封面图；
 *   3. 其他图片输出上级（图片上传/图像生成等）——直连即各取首图加载。
 *
 * 三者去重后返回（以 src 字符串为键），避免相同封面重复出现。
 */
function resolveUpstreamImages(node: NodeData, h: NodeViewHelpers): string[] {
  const inputs = collectNodeInputs(node, h.nodes, h.edges, h.portTypesOf);

  // 1) 直连图片输出上级（book_info 输出 type 为 text，已在 collectNodeInputs 被排除在外）
  const parentImages = inputs.images
    .map((p) => nodeOutputImages(p)[0])
    .filter((src): src is string => Boolean(src));

  // 2) 直连的图书元数据节点封面（连线即加载）
  const connectedBookCovers = inputs.parents
    .filter((p) => p.type === 'book_info')
    .map((p) => {
      const d = p.data ?? {};
      return d.cover_image_local || d.cover_image || d.coverUrl || null;
    })
    .filter((src): src is string => Boolean(src));

  // 3) 根节点图书元数据封面（无论是否连线始终加载）
  const rootNode = findRootBookInfo(h.nodes, h.edges);
  const rootCover =
    rootNode?.data?.cover_image_local || rootNode?.data?.cover_image || rootNode?.data?.coverUrl || null;

  // 去重合并
  const seen = new Set<string>();
  return [...parentImages, ...connectedBookCovers, ...(rootCover ? [rootCover] : [])].filter((src) => {
    if (seen.has(src)) return false;
    seen.add(src);
    return true;
  });
}

let latestHandleRemove: ((id: string) => void) | null = null;
let latestContextMenu: ((e: React.MouseEvent, id: string) => void) | null = null;

const removeCallbackCache = new Map<string, () => void>();
const contextMenuCallbackCache = new Map<string, (e: React.MouseEvent) => void>();

function getStableRemove(id: string, h: NodeViewHelpers): () => void {
  latestHandleRemove = h.handleRemove;
  let cb = removeCallbackCache.get(id);
  if (!cb) {
    cb = () => latestHandleRemove?.(id);
    removeCallbackCache.set(id, cb);
  }
  return cb;
}

function getStableContextMenu(id: string, h: NodeViewHelpers): (e: React.MouseEvent) => void {
  latestContextMenu = h.handleNodeContextMenu;
  let cb = contextMenuCallbackCache.get(id);
  if (!cb) {
    cb = (e: React.MouseEvent) => latestContextMenu?.(e, id);
    contextMenuCallbackCache.set(id, cb);
  }
  return cb;
}

/** 画布节点渲染：按节点类型分发到对应组件（bookplate 模块唯一渲染入口） */
export function renderCanvasNode(node: NodeData, h: NodeViewHelpers): React.ReactNode {
  const common = {
    id: node.id,
    initialX: node.x,
    initialY: node.y,
    title: getNodeTitle(node),
    onRemove: getStableRemove(node.id, h),
    onPositionChange: h.handlePositionChange,
    onSizeChange: h.handleSizeChange,
    onDrag: h.handleNodeDrag,
    onResizeLive: h.handleNodeResizeLive,
    onContextMenu: getStableContextMenu(node.id, h),
    footer: h.renderFooter(node),
  };
  const mismatchBadge = mismatchBadgeOf(node, h);
  const settings: NodeRunSettings = node.data?.settings ?? DEFAULT_RUN_SETTINGS;

  switch (node.type) {
    case 'book_info': {
      return (
        <BookInfoNode
          key={node.id}
          {...common}
          data={node.data}
          isGenerating={!!node.data.isGenerating}
          error={node.data.error ?? null}
          onRetry={h.handleRetryBookFor}
          onFetch={h.handleFetchBookFor}
          onForceRefresh={h.handleForceRefreshBookFor}
          onReset={h.handleResetBookFor}
          onUploadCover={h.handleUploadCoverFor}
          onDownload={h.handleDownloadBookData}
        />
      );
    }
    case 'image_analysis': {
      const config = h.configOf(node);
      // 上下文注入折叠块：与 图像生成 / AI 对话节点共用构建逻辑，展示本次运行并入
      // 分析请求的输入（文本类上级 / 图片类上级 / 图书元数据与封面）。封面注入与
      // 图像生成节点同口径：封面开关默认值跟随连通性（isBookCoverEnabled，未显式设置时
      // 无连通仅根节点兜底则默认关闭）
      const contextBlocks = buildInjectedContextBlocks(
        node,
        {
          includeBook: isBookMetadataEnabled(node, h.nodes, h.edges),
          includeBookCover: isBookCoverEnabled(node, h.nodes, h.edges),
          includeUpstreamText: true,
          includeUpstreamImages: true,
        },
        h.nodes,
        h.edges,
        h.portTypesOf
      );
      return (
        <ImageAnalysisNode
          key={node.id}
          {...common}
          analysis={node.data.analysis}
          agentSteps={node.data.agentSteps}
          agentName={config?.mode === 'agent' ? (config.agent_name ?? undefined) : undefined}
          group={config?.group?.trim() || undefined}
          mismatchBadge={mismatchBadge}
          isGenerating={!!node.data.isGenerating}
          error={node.data.error ?? null}
          onRun={h.handleRunAnalysisFor}
          settings={settings}
          contextBlocks={contextBlocks}
          onUpdateSettings={h.handleUpdateRunSettingsFor}
          hasBookInfo={h.hasBookInfo}
          showBookCoverOption
          bookMetadataEnabled={isBookMetadataEnabled(node, h.nodes, h.edges)}
          bookCoverEnabled={isBookCoverEnabled(node, h.nodes, h.edges)}
          mode={config?.mode}
          configId={node.configId ?? null}
        />
      );
    }
    case 'text_generation': {
      const config = h.configOf(node);
      // 上下文注入折叠块：与 AI 对话 / 图像生成节点共用构建逻辑，展示本次运行并入提示词的输入
      const contextBlocks = buildInjectedContextBlocks(
        node,
        {
          // 与 image_analysis / chat 调用点同口径：显式设置优先，未设置时按 book_info 连通性默认
          includeBook: isBookMetadataEnabled(node, h.nodes, h.edges),
          includeBookCover: false,
          includeUpstreamText: true,
          includeUpstreamImages: false,
        },
        h.nodes,
        h.edges,
        h.portTypesOf
      );
      return (
        <TextGenerationNode
          key={node.id}
          {...common}
          contextBlocks={contextBlocks}
          content={node.data.content}
          agentSteps={node.data.agentSteps}
          agentName={config?.mode === 'agent' ? (config.agent_name ?? undefined) : undefined}
          group={config?.group?.trim() || undefined}
          mismatchBadge={mismatchBadge}
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
      // 上下文注入折叠块：与 AI 对话节点共用构建逻辑，展示本次运行实际并入提示词的输入
      // （提示词节点 / 图片分析 / 文本类上级 / 图书元数据与封面 / 参考图）。与 chat 同口径
      // （所见即所得）：除图书元数据走 includeBook 穿透外，任何直连上级的文本/图片都并入。
      // 封面开关默认值跟随连通性（isBookCoverEnabled，未显式设置时无连通仅根节点兜底则默认关闭）
      const contextBlocks = buildInjectedContextBlocks(
        node,
        {
          includeBook: isBookMetadataEnabled(node, h.nodes, h.edges),
          includeBookCover: isBookCoverEnabled(node, h.nodes, h.edges),
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
          referenceImageUrl={refImage ?? null}
          referenceNote={referenceNote}
          referenceWaiting={imageParents.length > 0 && !refImage}
          isGenerating={!!node.data.isGenerating}
          error={node.data.error}
          isMock={node.data.isMock}
          isFavorited={!!h.favoritedState[node.id]}
          isPublic={!!h.publishedState[node.id]}
          isSaved={Boolean(node.data?.isSaved)}
          isSelected={node.id === h.activeImage?.id}
          recordDeleted={h.staleRecordIds.has(node.id)}
          onSelect={h.handleSelectImage}
          onRetry={h.handleRetryImageFor}
          onRun={h.handleRunFor}
          onSave={h.handleSaveImageFor}
          onToggleFavorite={h.handleToggleFavoriteFor}
          onTogglePublic={h.handleTogglePublicFor}
          settings={settings}
          onUpdateSettings={h.handleUpdateRunSettingsFor}
          showImageParams
          showBookCoverOption
          bookMetadataEnabled={isBookMetadataEnabled(node, h.nodes, h.edges)}
          bookCoverEnabled={isBookCoverEnabled(node, h.nodes, h.edges)}
          hasBookInfo={h.hasBookInfo}
          mode={config?.mode}
          configId={node.configId ?? null}
        />
      );
    }
    case 'text': {
      // 连线即输入：文本输出上级内容写入本节点（连线后仍可手动编辑，与翻译节点同口径）
      const upstreamText = firstUpstreamText(node, h.nodes, h.edges, h.portTypesOf);
      return (
        <TextNode
          key={node.id}
          {...common}
          content={node.data.content ?? ''}
          upstreamText={upstreamText}
          onEditContent={h.handleEditTextFor}
        />
      );
    }
    case 'image_upload': {
      return (
        <ImageUploadNode
          key={node.id}
          {...common}
          imageUrl={node.data.imageUrl ?? null}
          imageName={node.data.imageName ?? ''}
          onImageChange={h.handleImageChangeFor}
        />
      );
    }
    case 'chat': {
      // AI 对话节点宿主按模式分派：skill_agent（pi）走服务端真相源专用宿主，
      // LLM / FastClaw 维持 useChat 镜像宿主；展示组件 ChatNode 完全复用
      const chatConfig = h.configOf(node);
      if (chatConfig?.mode === 'skill_agent') {
        return <PiChatNodeHost key={node.id} node={node} h={h} deps={h.chatDeps} />;
      }
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
      return (
        <PromptSearchNode
          key={node.id}
          {...common}
          title={typeof node.data?.promptName === 'string' && node.data.promptName ? node.data.promptName : common.title}
          promptId={node.data?.promptId ?? null}
          promptName={typeof node.data?.promptName === 'string' ? node.data.promptName : ''}
          content={typeof node.data?.content === 'string' ? node.data.content : ''}
          promptImage={typeof node.data?.promptImage === 'string' ? node.data.promptImage : null}
          onUpdatePrompt={h.handleUpdatePromptFor}
        />
      );
    }
    case 'skill_search': {
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
          onUpdateSkills={h.handleUpdateSkillsFor}
        />
      );
    }
    case 'calendar': {
      return (
        <CalendarNode
          key={node.id}
          {...common}
          date={typeof node.data?.date === 'string' ? node.data.date : undefined}
          output={typeof node.data?.output === 'string' ? node.data.output : ''}
          isGenerating={!!node.data.isGenerating}
          error={node.data.error ?? null}
          onFetch={h.handleFetchCalendarFor}
        />
      );
    }
    case 'weather': {
      // 连线即输入：文本输出上级内容作为城市（collectNodeInputs 按端口类型统一分组，
      // 取第一个非空），优先于手动输入
      const upstreamCity = firstUpstreamText(node, h.nodes, h.edges, h.portTypesOf);
      return (
        <WeatherNode
          key={node.id}
          {...common}
          city={typeof node.data?.city === 'string' ? node.data.city : ''}
          upstreamCity={upstreamCity}
          output={typeof node.data?.output === 'string' ? node.data.output : ''}
          isGenerating={!!node.data.isGenerating}
          error={node.data.error ?? null}
          onFetch={h.handleFetchWeatherFor}
        />
      );
    }
    case 'zhihu_search': {
      const d = node.data ?? {};
      // 连线即输入：文本输出上级内容作为检索关键词 / 直答问题（collectNodeInputs
      // 按端口类型统一分组，取第一个非空），优先于手动输入（与天气节点同口径）
      const upstreamQuery = firstUpstreamText(node, h.nodes, h.edges, h.portTypesOf);
      return (
        <ZhihuSearchNode
          key={node.id}
          {...common}
          mode={d.mode === 'zhida' ? d.mode : 'zhihu'}
          query={typeof d.query === 'string' ? d.query : ''}
          tabData={d.tabData}
          count={typeof d.count === 'number' ? d.count : 5}
          model={typeof d.model === 'string' ? d.model : 'zhida-fast-1p5'}
          upstreamQuery={upstreamQuery}
          output={typeof d.output === 'string' ? d.output : ''}
          isGenerating={!!d.isGenerating}
          error={d.error ?? null}
          onFetch={h.handleFetchZhihuFor}
          onUpdateEditor={h.handleUpdateZhihuEditorFor}
        />
      );
    }
    case 'wikipedia_search': {
      const d = node.data ?? {};
      // 连线即输入：文本输出上级内容作为检索关键词（collectNodeInputs
      // 按端口类型统一分组，取第一个非空），优先于手动输入（与天气节点同口径）
      const upstreamKeyword = firstUpstreamText(node, h.nodes, h.edges, h.portTypesOf);
      const results = Array.isArray(d.results) ? d.results : [];
      return (
        <WikipediaSearchNode
          key={node.id}
          {...common}
          language={typeof d.language === 'string' ? d.language : 'zh'}
          query={typeof d.query === 'string' ? d.query : ''}
          limit={typeof d.limit === 'number' ? d.limit : 10}
          results={results}
          articleTitle={typeof d.articleTitle === 'string' ? d.articleTitle : ''}
          output={typeof d.output === 'string' ? d.output : ''}
          upstreamKeyword={upstreamKeyword}
          isGenerating={!!d.isGenerating}
          error={d.error ?? null}
          onSearch={h.handleSearchWikipediaFor}
          summaryMode={typeof d.summaryMode === 'boolean' ? d.summaryMode : false}
          onOpenArticle={h.handleOpenWikipediaArticleFor}
          onBackToResults={h.handleBackToWikipediaResultsFor}
          onUpdateEditor={h.handleUpdateWikipediaEditorFor}
        />
      );
    }
    case 'text_translation': {
      const d = node.data ?? {};
      const upstreamText = firstUpstreamText(node, h.nodes, h.edges, h.portTypesOf);
      return (
        <TextTranslationNode
          key={node.id}
          {...common}
          upstreamText={upstreamText}
          inputText={typeof d.inputText === 'string' ? d.inputText : ''}
          from={typeof d.from === 'string' ? d.from : 'auto'}
          to={typeof d.to === 'string' ? d.to : 'en'}
          source={d.source === 'google' || d.source === 'deeplx' ? d.source : 'random'}
          tabData={d.tabData ?? {}}
          output={typeof d.output === 'string' ? d.output : ''}
          isGenerating={!!d.isGenerating}
          error={d.error ?? null}
          onFetch={h.handleFetchTranslationFor}
          onUpdateEditor={h.handleUpdateTranslationEditorFor}
        />
      );
    }
    case 'web_search': {
      const d = node.data ?? {};
      const upstreamQuery = firstUpstreamText(node, h.nodes, h.edges, h.portTypesOf);
      const validSources: WebSearchSource[] = ['random', 'zhihu_global', 'tavily', 'exa', 'anysearch', 'doubao'];
      const activeSource: WebSearchSource = validSources.includes(d.source) ? d.source : 'random';
      return (
        <WebSearchNode
          key={node.id}
          {...common}
          upstreamQuery={upstreamQuery}
          source={activeSource}
          tabData={d.tabData ?? {}}
          output={typeof d.output === 'string' ? d.output : ''}
          isGenerating={!!d.isGenerating}
          error={d.error ?? null}
          onFetch={h.handleFetchWebSearchFor}
          onUpdateEditor={h.handleUpdateWebSearchEditorFor}
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
          theme={typeof d.theme === 'string' ? d.theme : MAP_POSTER_DEFAULTS.theme}
          sizeIndex={typeof d.sizeIndex === 'number' ? d.sizeIndex : MAP_POSTER_DEFAULTS.sizeIndex}
          distance={typeof d.distance === 'number' ? d.distance : MAP_POSTER_DEFAULTS.distance}
          cityName={typeof d.cityName === 'string' ? d.cityName : MAP_POSTER_DEFAULTS.cityName}
          countryName={typeof d.countryName === 'string' ? d.countryName : MAP_POSTER_DEFAULTS.countryName}
          lat={typeof d.lat === 'number' ? d.lat : MAP_POSTER_DEFAULTS.lat}
          lon={typeof d.lon === 'number' ? d.lon : MAP_POSTER_DEFAULTS.lon}
          onUpdateEditor={h.handleUpdateMapPosterEditorFor}
          onExport={h.handleExportMapPosterFor}
        />
      );
    }
    case 'image_search': {
      const d = node.data ?? {};
      // 连线即输入：文本输出上级内容作为检索关键词（优先于手动输入，与天气节点同口径）
      const upstreamKeyword = firstUpstreamText(node, h.nodes, h.edges, h.portTypesOf);
      return (
        <ImageSearchNode
          key={node.id}
          {...common}
          imageUrl={typeof d.imageUrl === 'string' ? d.imageUrl : null}
          selectedImage={d.selectedImage ?? null}
          provider={d.provider === 'pixabay' ? 'pixabay' : 'unsplash'}
          upstreamKeyword={upstreamKeyword}
          error={d.error ?? null}
          onSelectImage={h.handleSelectSearchImageFor}
          onUpdateEditor={h.handleUpdateImageSearchEditorFor}
        />
      );
    }
    case 'art_image_search': {
      const d = node.data ?? {};
      // 连线即输入：文本输出上级内容作为检索关键词（优先于手动输入，与天气节点同口径）
      const upstreamKeyword = firstUpstreamText(node, h.nodes, h.edges, h.portTypesOf);
      return (
        <ArtImageSearchNode
          key={node.id}
          {...common}
          imageUrl={typeof d.imageUrl === 'string' ? d.imageUrl : null}
          selectedImage={d.selectedImage ?? null}
          provider={typeof d.provider === 'string' ? d.provider : 'all'}
          upstreamKeyword={upstreamKeyword}
          error={d.error ?? null}
          onSelectImage={h.handleSelectGlamImageFor}
          onUpdateEditor={h.handleUpdateGlamEditorFor}
        />
      );
    }
    case 'receipt_printer': {
      const d = node.data ?? {};
      const { upstreamImageUrl, upstreamBookData } = resolveUpstreamImage(node, h);
      // 上游文本节点（如 VuFind 索书号）的 JSON 输出，解析 CALL_NUMBER 填充小票索书号字段
      const upstreamTextExtra = firstExtraJsonUpstreamText(node, h.nodes, h.edges, h.portTypesOf);
      return (
        <ReceiptPrinterNode
          key={node.id}
          {...common}
          data={d}
          upstreamBookData={upstreamBookData}
          upstreamImageUrl={upstreamImageUrl}
          upstreamTextExtra={upstreamTextExtra}
          isFavorited={!!h.favoritedState[node.id]}
          isPublic={!!h.publishedState[node.id]}
          isSelected={node.id === h.activeImage?.id}
          recordDeleted={h.staleRecordIds.has(node.id)}
          onSelect={h.handleSelectImage}
          onToggleFavorite={h.handleToggleFavoriteFor}
          onTogglePublic={h.handleTogglePublicFor}
          mismatchBadge={mismatchBadge}
          onUpdateState={h.handleUpdateReceiptStateFor}
          onExport={h.handleExportReceiptFor}
        />
      );
    }

    case 'book_card': {
      const d = node.data ?? {};
      const { upstreamBookData } = resolveUpstreamImage(node, h);
      // 收集直连图片输出上级（非 book_info）供用户分配封面/装饰角色
      const inputs = collectNodeInputs(node, h.nodes, h.edges, h.portTypesOf);
      const connectedImages = inputs.images
        .filter((p) => p.type !== 'book_info')
        .map((p) => nodeOutputImages(p)[0])
        .filter((src): src is string => Boolean(src));
      // 上游文本节点（如 VuFind 索书号）的 JSON 输出，供 parseExtraCardFields 解析覆盖
      const upstreamTextExtra = firstExtraJsonUpstreamText(node, h.nodes, h.edges, h.portTypesOf);
      return (
        <BookCardNode
          key={node.id}
          {...common}
          data={d}
          upstreamBookData={upstreamBookData}
          upstreamTextExtra={upstreamTextExtra}
          connectedImages={connectedImages}
          isFavorited={!!h.favoritedState[node.id]}
          isPublic={!!h.publishedState[node.id]}
          isSelected={node.id === h.activeImage?.id}
          recordDeleted={h.staleRecordIds.has(node.id)}
          onSelect={h.handleSelectImage}
          onToggleFavorite={h.handleToggleFavoriteFor}
          onTogglePublic={h.handleTogglePublicFor}
          mismatchBadge={mismatchBadge}
          onUpdateState={h.handleUpdateBookCardStateFor}
          onExport={h.handleExportBookCardFor}
        />
      );
    }

    case 'map_art': {
      const d = node.data ?? {};
      return (
        <MapArtNode
          key={node.id}
          {...common}
          imageUrl={typeof d.imageUrl === 'string' ? d.imageUrl : null}
          error={d.error ?? null}
          preset={typeof d.preset === 'string' ? d.preset : MAP_ART_DEFAULTS.preset}
          radius={typeof d.radius === 'number' ? d.radius : MAP_ART_DEFAULTS.radius}
          circle={typeof d.circle === 'boolean' ? d.circle : MAP_ART_DEFAULTS.circle}
          query={typeof d.query === 'string' ? d.query : ''}
          lat={typeof d.lat === 'number' ? d.lat : MAP_ART_DEFAULTS.lat}
          lon={typeof d.lon === 'number' ? d.lon : MAP_ART_DEFAULTS.lon}
          onUpdateEditor={h.handleUpdateMapArtEditorFor}
          onExport={h.handleExportMapArtFor}
        />
      );
    }

    case 'stamp_cutter': {
      const d = node.data ?? {};
      const { upstreamImageUrl } = resolveUpstreamImage(node, h);
      return (
        <StampCutterNode
          key={node.id}
          {...common}
          data={d}
          upstreamImageUrl={upstreamImageUrl}
          isFavorited={!!h.favoritedState[node.id]}
          isPublic={!!h.publishedState[node.id]}
          isSelected={node.id === h.activeImage?.id}
          recordDeleted={h.staleRecordIds.has(node.id)}
          onSelect={h.handleSelectImage}
          onToggleFavorite={h.handleToggleFavoriteFor}
          onTogglePublic={h.handleTogglePublicFor}
          mismatchBadge={mismatchBadge}
          onUpdateState={h.handleUpdateStampStateFor}
          onExport={h.handleExportStampFor}
        />
      );
    }

    case 'image_bg_remove': {
      const d = node.data ?? {};
      const { upstreamImageUrl } = resolveUpstreamImage(node, h);
      return (
        <ImageBgRemoveNode
          key={node.id}
          {...common}
          data={d}
          upstreamImageUrl={upstreamImageUrl}
          isFavorited={!!h.favoritedState[node.id]}
          isPublic={!!h.publishedState[node.id]}
          isSelected={node.id === h.activeImage?.id}
          recordDeleted={h.staleRecordIds.has(node.id)}
          onSelect={h.handleSelectImage}
          onToggleFavorite={h.handleToggleFavoriteFor}
          onTogglePublic={h.handleTogglePublicFor}
          mismatchBadge={mismatchBadge}
          onUpdateState={h.handleUpdateImageBgRemoveStateFor}
          onExport={h.handleExportImageBgRemoveFor}
        />
      );
    }

    case 'sticker_maker': {
      const d = node.data ?? {};
      const { upstreamImageUrl } = resolveUpstreamImage(node, h);
      return (
        <StickerMakerNode
          key={node.id}
          {...common}
          data={d}
          upstreamImageUrl={upstreamImageUrl}
          isFavorited={!!h.favoritedState[node.id]}
          isPublic={!!h.publishedState[node.id]}
          isSelected={node.id === h.activeImage?.id}
          recordDeleted={h.staleRecordIds.has(node.id)}
          onSelect={h.handleSelectImage}
          onToggleFavorite={h.handleToggleFavoriteFor}
          onTogglePublic={h.handleTogglePublicFor}
          mismatchBadge={mismatchBadge}
          onUpdateState={h.handleUpdateStickerMakerStateFor}
          onExport={h.handleExportStickerFor}
        />
      );
    }

    case 'journal_maker': {
      const d = node.data ?? {};
      const upstreamImages = resolveUpstreamImages(node, h);
      return (
        <JournalMakerNode
          key={node.id}
          {...common}
          data={d}
          upstreamImages={upstreamImages}
          isFavorited={!!h.favoritedState[node.id]}
          isPublic={!!h.publishedState[node.id]}
          isSelected={node.id === h.activeImage?.id}
          recordDeleted={h.staleRecordIds.has(node.id)}
          onSelect={h.handleSelectImage}
          onToggleFavorite={h.handleToggleFavoriteFor}
          onTogglePublic={h.handleTogglePublicFor}
          mismatchBadge={mismatchBadge}
          onUpdateState={h.handleUpdateJournalMakerStateFor}
          onExport={h.handleExportJournalFor}
        />
      );
    }

    case 'text_image': {
      const d = node.data ?? {};
      return (
        <TextImageNode
          key={node.id}
          {...common}
          data={d}
          isFavorited={!!h.favoritedState[node.id]}
          isPublic={!!h.publishedState[node.id]}
          isSelected={node.id === h.activeImage?.id}
          recordDeleted={h.staleRecordIds.has(node.id)}
          onSelect={h.handleSelectImage}
          onToggleFavorite={h.handleToggleFavoriteFor}
          onTogglePublic={h.handleTogglePublicFor}
          mismatchBadge={mismatchBadge}
          onUpdateState={h.handleUpdateTextImageStateFor}
          onExport={h.handleExportTextImageFor}
        />
      );
    }

    case 'pattern_search': {
      const d = node.data ?? {};
      // 连线即输入：文本输出上级内容作为检索关键词（优先于手动输入）
      const upstreamKeyword = firstUpstreamText(node, h.nodes, h.edges, h.portTypesOf);
      return (
        <PatternSearchNode
          key={node.id}
          {...common}
          imageUrl={typeof d.imageUrl === 'string' ? d.imageUrl : null}
          selectedPattern={d.selectedPattern ?? null}
          category={typeof d.category === 'string' ? d.category : ''}
          upstreamKeyword={upstreamKeyword}
          error={d.error ?? null}
          onSelectPattern={h.handleSelectPatternFor}
          onUpdateEditor={h.handleUpdatePatternEditorFor}
        />
      );
    }

    case 'oil_paint': {
      const d = node.data ?? {};
      const { upstreamImageUrl } = resolveUpstreamImage(node, h);
      return (
        <OilPaintNode
          key={node.id}
          {...common}
          data={d}
          upstreamImageUrl={upstreamImageUrl}
          isFavorited={!!h.favoritedState[node.id]}
          isPublic={!!h.publishedState[node.id]}
          isSelected={node.id === h.activeImage?.id}
          recordDeleted={h.staleRecordIds.has(node.id)}
          onSelect={h.handleSelectImage}
          onToggleFavorite={h.handleToggleFavoriteFor}
          onTogglePublic={h.handleTogglePublicFor}
          mismatchBadge={mismatchBadge}
          onUpdateState={h.handleUpdateOilPaintStateFor}
          onExport={h.handleExportOilPaintFor}
        />
      );
    }

    case 'image_process': {
      const d = node.data ?? {};
      const { upstreamImageUrl } = resolveUpstreamImage(node, h);
      return (
        <ImageProcessNode
          key={node.id}
          {...common}
          data={d}
          upstreamImageUrl={upstreamImageUrl}
          isFavorited={!!h.favoritedState[node.id]}
          isPublic={!!h.publishedState[node.id]}
          isSelected={node.id === h.activeImage?.id}
          recordDeleted={h.staleRecordIds.has(node.id)}
          onSelect={h.handleSelectImage}
          onToggleFavorite={h.handleToggleFavoriteFor}
          onTogglePublic={h.handleTogglePublicFor}
          mismatchBadge={mismatchBadge}
          onUpdateState={h.handleUpdateImageProcessStateFor}
          onExport={h.handleExportImageProcessFor}
        />
      );
    }

    case 'emboss_foil': {
      const d = node.data ?? {};
      const { upstreamImageUrl } = resolveUpstreamImage(node, h);
      return (
        <EmbossFoilNode
          key={node.id}
          {...common}
          data={d}
          upstreamImageUrl={upstreamImageUrl}
          isFavorited={!!h.favoritedState[node.id]}
          isPublic={!!h.publishedState[node.id]}
          isSelected={node.id === h.activeImage?.id}
          recordDeleted={h.staleRecordIds.has(node.id)}
          onSelect={h.handleSelectImage}
          onToggleFavorite={h.handleToggleFavoriteFor}
          onTogglePublic={h.handleTogglePublicFor}
          mismatchBadge={mismatchBadge}
          onUpdateState={h.handleUpdateEmbossFoilStateFor}
          onExport={h.handleExportEmbossFoilFor}
        />
      );
    }

    case 'glass_refract': {
      const d = node.data ?? {};
      const { upstreamImageUrl } = resolveUpstreamImage(node, h);
      return (
        <GlassRefractNode
          key={node.id}
          {...common}
          data={d}
          upstreamImageUrl={upstreamImageUrl}
          isFavorited={!!h.favoritedState[node.id]}
          isPublic={!!h.publishedState[node.id]}
          isSelected={node.id === h.activeImage?.id}
          recordDeleted={h.staleRecordIds.has(node.id)}
          onSelect={h.handleSelectImage}
          onToggleFavorite={h.handleToggleFavoriteFor}
          onTogglePublic={h.handleTogglePublicFor}
          mismatchBadge={mismatchBadge}
          onUpdateState={h.handleUpdateGlassRefractStateFor}
          onExport={h.handleExportGlassRefractFor}
        />
      );
    }

    case 'editorial_layout': {
      const d = node.data ?? {};
      const upstreamImages = resolveUpstreamImages(node, h);
      // 其他文本节点（不含图书元数据）：默认全部追加到正文底部（追加在图书元数据继承的正文之后）
      const upstreamTexts = allUpstreamTexts(node, h.nodes, h.edges, h.portTypesOf);
      // 上游图书元数据（直连 book_info 优先，无则连通上游，再兜底画布根节点）——与图书小票同口径
      const { upstreamBookData } = resolveUpstreamImage(node, h);
      return (
        <EditorialLayoutNode
          key={node.id}
          {...common}
          data={d}
          upstreamImages={upstreamImages}
          upstreamTexts={upstreamTexts}
          upstreamBookData={upstreamBookData}
          isFavorited={!!h.favoritedState[node.id]}
          isPublic={!!h.publishedState[node.id]}
          isSelected={node.id === h.activeImage?.id}
          recordDeleted={h.staleRecordIds.has(node.id)}
          onSelect={h.handleSelectImage}
          onToggleFavorite={h.handleToggleFavoriteFor}
          onTogglePublic={h.handleTogglePublicFor}
          mismatchBadge={mismatchBadge}
          onUpdateState={h.handleUpdateEditorialStateFor}
          onExport={h.handleExportEditorialFor}
        />
      );
    }

    case 'watercolor_brush': {
      const d = node.data ?? {};
      const upstreamText = firstUpstreamText(node, h.nodes, h.edges, h.portTypesOf);
      let upstreamColors: string[] | null = null;
      if (upstreamText) {
        try {
          const parsed = JSON.parse(upstreamText);
          if (Array.isArray(parsed?.colors)) upstreamColors = parsed.colors;
          else if (Array.isArray(parsed?.palette)) upstreamColors = parsed.palette.map((c: any) => c?.hex || c);
        } catch {
          // 非 JSON 则忽略
        }
      }
      const { upstreamImageUrl } = resolveUpstreamImage(node, h);

      return (
        <WatercolorBrushNode
          key={node.id}
          {...common}
          data={d}
          upstreamColors={upstreamColors}
          upstreamImageUrl={upstreamImageUrl}
          isFavorited={!!h.favoritedState[node.id]}
          isPublic={!!h.publishedState[node.id]}
          isSelected={node.id === h.activeImage?.id}
          recordDeleted={h.staleRecordIds.has(node.id)}
          onSelect={h.handleSelectImage}
          onToggleFavorite={h.handleToggleFavoriteFor}
          onTogglePublic={h.handleTogglePublicFor}
          mismatchBadge={mismatchBadge}
          onUpdateState={h.handleUpdateWatercolorBrushStateFor}
          onExport={h.handleExportWatercolorBrushFor}
        />
      );
    }

    case 'ink_wash': {
      const d = node.data ?? {};
      const upstreamText = firstUpstreamText(node, h.nodes, h.edges, h.portTypesOf);
      const { upstreamImageUrl } = resolveUpstreamImage(node, h);

      return (
        <InkWashNode
          key={node.id}
          {...common}
          data={d}
          upstreamText={upstreamText}
          upstreamImageUrl={upstreamImageUrl}
          isFavorited={!!h.favoritedState[node.id]}
          isPublic={!!h.publishedState[node.id]}
          isSelected={node.id === h.activeImage?.id}
          recordDeleted={h.staleRecordIds.has(node.id)}
          onSelect={h.handleSelectImage}
          onToggleFavorite={h.handleToggleFavoriteFor}
          onTogglePublic={h.handleTogglePublicFor}
          mismatchBadge={mismatchBadge}
          onUpdateState={h.handleUpdateInkWashStateFor}
          onExport={h.handleExportInkWashFor}
        />
      );
    }

    case 'color_search': {
      const d = node.data ?? {};
      // 连线即输入：文本输出上级内容作为检索关键词（优先于手动输入）
      const upstreamKeyword = firstUpstreamText(node, h.nodes, h.edges, h.portTypesOf);
      return (
        <ColorSearchNode
          key={node.id}
          {...common}
          imageUrl={typeof d.imageUrl === 'string' ? d.imageUrl : null}
          selectedColor={d.selectedColor ?? null}
          palette={Array.isArray(d.palette) ? d.palette : []}
          category={typeof d.category === 'string' ? d.category : ''}
          temperature={typeof d.temperature === 'string' ? d.temperature : ''}
          activeTab={d.activeTab ?? 'search'}
          paletteMethod={d.paletteMethod ?? 'auto'}
          upstreamKeyword={upstreamKeyword}
          error={d.error ?? null}
          onSelectColor={h.handleSelectColorFor}
          onUpdateEditor={h.handleUpdateColorEditorFor}
        />
      );
    }

    case 'vufind_call_number': {
      const d = node.data ?? {};
      // ISBN 来源优先级（连线穿透或兜底的根节点）：
      // 1) 沿连线向上追溯实际连通的图书元数据节点 → 取其 isbn；
      // 2) 无连通时回退画布根图书元数据节点 → 取其 isbn；
      // 3) 再回退任意线上级文本（如直接连线的文本节点输入 ISBN）。
      // firstUpstreamText 对 book_info 返回的是「整段 key: value 元数据文本」而非 isbn 单值，
      // 故不直接用其作为 ISBN，仅在文本上级恰好是纯 ISBN 时兜底。
      const connectedBook = findConnectedBookInfoUpstream(node.id, h.nodes, h.edges);
      const rootBook = findRootBookInfo(h.nodes, h.edges);
      const connectedIsbn = typeof connectedBook?.data?.isbn === 'string' ? connectedBook.data.isbn.trim() : '';
      const rootIsbn = typeof rootBook?.data?.isbn === 'string' ? rootBook.data.isbn.trim() : '';
      const upstreamText = firstUpstreamText(node, h.nodes, h.edges, h.portTypesOf).trim();
      const upstreamIsbn = connectedIsbn || rootIsbn || (/^[\dXx-]{10,17}$/.test(upstreamText) ? upstreamText : '');
      return (
        <VuFindCallNumberNode
          key={node.id}
          {...common}
          isbn={typeof d.isbn === 'string' ? d.isbn : ''}
          upstreamIsbn={upstreamIsbn}
          callNumber={typeof d.callNumber === 'string' ? d.callNumber : ''}
          bibliographic={
            d.bibliographic && typeof d.bibliographic === 'object'
              ? (d.bibliographic as {
                  title?: string;
                  author?: string;
                  contributor?: string;
                  publisher?: string;
                  pubYear?: string;
                })
              : null
          }
          recordUrl={typeof d.recordUrl === 'string' ? d.recordUrl : ''}
          holdings={Array.isArray(d.holdings) ? d.holdings : []}
          output={typeof d.output === 'string' ? d.output : ''}
          isGenerating={!!d.isGenerating}
          error={d.error ?? null}
          onFetch={h.handleFetchVuFindCallNumberFor}
          onUpdateEditor={h.handleUpdateVuFindEditorFor}
          onDownload={h.handleDownloadVuFindData}
        />
      );
    }

    default:
      return null;
  }
}
