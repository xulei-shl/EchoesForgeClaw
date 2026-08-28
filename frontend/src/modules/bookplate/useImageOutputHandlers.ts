import { useCallback } from 'react';
import api from '../../platform/services/api';
import generationsService from '../../platform/services/generations';
import { flushSnapshot } from '../../platform/stores/useCanvasState';
import { SMALL_TOOL_TIMEOUT_MS } from '../../platform/utils/timeouts';
import { findConnectedBookInfoUpstream, findRootBookInfo } from './nodeTypes';
import type { EdgeData, NodeData, NodeType } from './graphTypes';
import type { GlamSearchSelection } from '../../modules/multimodal/components/ArtImageSearchNode';
import type { ImageSearchSelection } from '../../modules/multimodal/components/ImageSearchNode';
import type { ColorItem } from '../../modules/multimodal/components/ColorSearchNode';
import type { PatternItem } from '../../modules/multimodal/components/PatternSearchNode';

/** 图片输出节点 handler 所需的共享依赖（均为 ref / 稳定 setter，闭包不会过期） */
export interface ImageOutputCtx {
  nodesRef: React.MutableRefObject<NodeData[]>;
  edgesRef: React.MutableRefObject<EdgeData[]>;
  generationIds: React.MutableRefObject<Record<string, number>>;
  setFavoritedState: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setPublishedState: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setSelectedImageId: React.Dispatch<React.SetStateAction<string | null>>;
  setStaleRecordIds?: React.Dispatch<React.SetStateAction<Set<string>>>;
  recordHistory: () => void;
  updateNodeData: (id: string, patch: Record<string, any>) => void;
}

/* ===================================================================== */
/* 选中图片 → 下载到本地 → 写回 node.data 的工厂                          */
/* （图片检索 / 艺术图片检索 / 纹样 / 配色共用同一流程）                  */
/* ===================================================================== */

export interface SelectImageConfig {
  nodeType: NodeType;
  endpoint: string;
  /** 组装请求 body（args 为组件传入参数：如 url/meta / pattern / color） */
  buildBody: (...args: any[]) => Record<string, any>;
  /** 从响应提取图片 URL */
  imageUrlOf: (res: any) => string;
  /** 从响应提取对外文本输出（仅 includeOutput 时写入） */
  outputOf?: (res: any) => string;
  /** 是否写入对外文本输出（search 类节点不写入，仅存选中对象） */
  includeOutput?: boolean;
  /** 成功写回 node.data 的额外字段 */
  extraPatch: (res: any, ...args: any[]) => Record<string, any>;
  /** 图片 URL 为空时的抛错文案 */
  emptyError: string;
  /** 失败文案（统一补「超时，请重试」/「失败，请重试」后缀） */
  errLabel: string;
}

/** 生成本节点的「选中图片并落盘」异步稳定回调（记录撤销历史；失败抛出供组件处理） */
export function useSelectImageHandler(
  ctx: ImageOutputCtx,
  config: SelectImageConfig
): (id: string, ...args: any[]) => Promise<void> {
  return useCallback(
    async (id: string, ...args: any[]) => {
      const node = ctx.nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== config.nodeType) return;
      ctx.updateNodeData(id, { error: null });
      try {
        const res: any = await api.post(config.endpoint, config.buildBody(...args), {
          timeout: SMALL_TOOL_TIMEOUT_MS,
        });
        const imageUrl = config.imageUrlOf(res);
        if (!imageUrl) throw new Error(config.emptyError);

        ctx.recordHistory();
        ctx.updateNodeData(id, {
          imageUrl,
          ...(config.includeOutput ? { output: config.outputOf?.(res) ?? '' } : {}),
          ...config.extraPatch(res, ...args),
          error: null,
        });
      } catch (error: any) {
        console.error(`Save image failed [${config.endpoint}]:`, error);
        ctx.updateNodeData(id, {
          error: error?.isTimeout
            ? `${config.errLabel}超时，请重试`
            : error?.detail || `${config.errLabel}失败，请重试`,
        });
        throw error;
      }
    },
    // 稳定回调：仅读取 refs / 稳定 setter，闭包不会过期
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
}

/* ===================================================================== */
/* 导出图片 → 落盘 → 写数据库历史记录 → 写回 node.data 的工厂            */
/* （图书小票 / 邮票共用同一流程）                                        */
/* ===================================================================== */

export interface ImageExportConfig {
  nodeType: NodeType;
  /** 历史记录 node_type */
  historyNodeType: string;
  /** stage2/stage3 prompt 文案 */
  promptOf: (state: any) => string;
  /** 成功写回 node.data 的额外字段（state 已整体并入） */
  okExtras: (state: any) => Record<string, any>;
  /** 历史记录保存成功后的附加副作用（如小票清 stale 标记） */
  onHistorySaved: (id: string) => void;
  /** 图片 URL 为空时的抛错文案 */
  emptyError: string;
  /** 失败文案 */
  errLabel: string;
  /** 历史记录保存失败时的警告前缀（不阻断导出） */
  historyWarn: string;
}

/** 生成本节点的「导出 PNG → 落盘 → 历史记录」异步稳定回调（失败抛出供组件处理） */
export function useImageExportHandler(
  ctx: ImageOutputCtx,
  config: ImageExportConfig
): (id: string, dataUrl: string, state: any) => Promise<void> {
  return useCallback(
    async (id: string, dataUrl: string, state: any) => {
      const node = ctx.nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== config.nodeType) return;
      ctx.updateNodeData(id, { isExporting: true, error: null });
      try {
        const res: any = await api.post(
          '/modules/bookplate/save-image',
          { image: dataUrl },
          { timeout: SMALL_TOOL_TIMEOUT_MS }
        );
        const imageUrl = typeof res?.image_url === 'string' ? res.image_url : '';
        if (!imageUrl) throw new Error(config.emptyError);

        // 组装历史记录保存到数据库 (generations 表)：失败不阻断导出
        try {
          const rootBook =
            findConnectedBookInfoUpstream(id, ctx.nodesRef.current, ctx.edgesRef.current) ??
            findRootBookInfo(ctx.nodesRef.current, ctx.edgesRef.current);
          const promptText = config.promptOf(state);
          const gen = await generationsService.create({
            node_type: config.historyNodeType,
            stage_results: {
              stage1: rootBook
                ? { isbn: rootBook.data?.isbn || '', metadata: rootBook.data || {} }
                : undefined,
              stage2: {
                prompt: promptText,
              },
              stage3: {
                image_url: imageUrl,
                prompt: promptText,
              },
            },
            result_url: imageUrl,
            status: 'completed',
          });
          ctx.generationIds.current[id] = gen.id;
          flushSnapshot();
          // 新记录默认 is_favorited=false, is_public=false，重置 UI 态避免旧记录残留
          ctx.setFavoritedState((prev) => ({ ...prev, [id]: false }));
          ctx.setPublishedState((prev) => ({ ...prev, [id]: false }));
          config.onHistorySaved(id);
        } catch (dbErr) {
          console.warn(config.historyWarn, dbErr);
        }

        // 新图生成成功：自动选中，使全局操作栏作用于本节点（对齐 ImageNode）
        ctx.setSelectedImageId(id);
        ctx.recordHistory();
        ctx.updateNodeData(id, {
          ...state,
          ...config.okExtras(state),
          imageUrl,
          isExporting: false,
          error: null,
        });
      } catch (error: any) {
        console.error(`Export image failed [${config.nodeType}]:`, error);
        ctx.updateNodeData(id, {
          isExporting: false,
          error: error?.isTimeout
            ? `${config.errLabel}超时，请重试`
            : error?.detail || `${config.errLabel}失败，请重试`,
        });
        throw error;
      }
    },
    // 稳定回调：仅读取 refs / 稳定 setter，闭包不会过期
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
}

/** 生成本节点的「后端已落盘，写回 imageUrl」异步稳定回调（地图海报 / 艺术地图共用） */
export function useSimpleImageExportHandler(
  ctx: ImageOutputCtx,
  nodeType: NodeType
): (id: string, imageUrl: string) => Promise<void> {
  return useCallback(
    async (id: string, imageUrl: string) => {
      const node = ctx.nodesRef.current.find((n) => n.id === id);
      if (!node || node.type !== nodeType) return;
      ctx.recordHistory();
      ctx.updateNodeData(id, { imageUrl, error: null });
    },
    // 稳定回调：仅读取 refs / 稳定 setter，闭包不会过期
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
}

/* ===================================================================== */
/* 各图片输出节点 handler 组装                                            */
/* ===================================================================== */

const IMAGE_SEARCH_SAVE_CONFIG: SelectImageConfig = {
  nodeType: 'image_search',
  endpoint: '/modules/bookplate/image-search/save',
  buildBody: (url: string, meta: ImageSearchSelection) => ({
    url,
    source: meta?.source ?? null,
    download_url: meta?.downloadUrl ?? null,
  }),
  imageUrlOf: (res) => (typeof res?.image_url === 'string' ? res.image_url : ''),
  extraPatch: (_res, _url, meta: ImageSearchSelection) => ({ selectedImage: meta }),
  emptyError: '保存图片失败',
  errLabel: '图片保存',
};

const GLAM_SAVE_CONFIG: SelectImageConfig = {
  nodeType: 'art_image_search',
  endpoint: '/modules/bookplate/glam-search/save',
  buildBody: (url: string) => ({ url }),
  imageUrlOf: (res) => (typeof res?.image_url === 'string' ? res.image_url : ''),
  extraPatch: (_res, _url, meta: GlamSearchSelection) => ({ selectedImage: meta }),
  emptyError: '保存图片失败',
  errLabel: '图片保存',
};

const PATTERN_SAVE_CONFIG: SelectImageConfig = {
  nodeType: 'pattern_search',
  endpoint: '/modules/bookplate/pattern-search/save',
  buildBody: (pattern: PatternItem) => ({
    id: pattern.id,
    image_url: pattern.full_image_url || pattern.preview_url || pattern.thumb_url,
  }),
  imageUrlOf: (res) => (typeof res?.image_url === 'string' ? res.image_url : ''),
  outputOf: (res) => (typeof res?.detail_markdown === 'string' ? res.detail_markdown : ''),
  includeOutput: true,
  extraPatch: (_res, pattern: PatternItem) => ({
    selectedPattern: {
      id: pattern.id,
      name_cn: pattern.name_cn,
      name_en: pattern.name_en,
      category: pattern.category,
      summary: pattern.summary,
      meaning: pattern.meaning,
      visual_keywords: pattern.visual_keywords,
      full_image_url: pattern.full_image_url,
    },
  }),
  emptyError: '保存纹样图片失败',
  errLabel: '纹样保存',
};

const COLOR_SAVE_CONFIG: SelectImageConfig = {
  nodeType: 'color_search',
  endpoint: '/modules/bookplate/color-search/save',
  buildBody: (color: ColorItem, palette?: ColorItem[]) => ({ color, palette }),
  imageUrlOf: (res) => (typeof res?.imageUrl === 'string' ? res.imageUrl : ''),
  outputOf: (res) => (typeof res?.output === 'string' ? res.output : ''),
  includeOutput: true,
  extraPatch: (res, color: ColorItem, palette?: ColorItem[]) => ({
    selectedColor: res.selectedColor || color,
    palette: res.palette || palette || [color],
  }),
  emptyError: '保存传统色图片失败',
  errLabel: '色彩保存',
};

export interface ImageOutputHandlers {
  handleSelectSearchImageFor: (
    id: string,
    url: string,
    meta: ImageSearchSelection
  ) => Promise<void>;
  handleSelectGlamImageFor: (id: string, url: string, meta: GlamSearchSelection) => Promise<void>;
  handleSelectPatternFor: (id: string, pattern: PatternItem) => Promise<void>;
  handleSelectColorFor: (id: string, color: ColorItem, palette?: ColorItem[]) => Promise<void>;
  handleExportReceiptFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  handleExportBookCardFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  handleExportStampFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  handleExportStickerFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  handleExportJournalFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  handleExportTextImageFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  handleExportOilPaintFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  handleExportImageProcessFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  handleExportEmbossFoilFor: (id: string, dataUrl: string, state: any) => Promise<void>;
  handleExportMapPosterFor: (id: string, imageUrl: string) => Promise<void>;
  handleExportMapArtFor: (id: string, imageUrl: string) => Promise<void>;
}

export function useImageOutputHandlers(ctx: ImageOutputCtx): ImageOutputHandlers {
  const handleSelectSearchImageFor = useSelectImageHandler(ctx, IMAGE_SEARCH_SAVE_CONFIG);
  const handleSelectGlamImageFor = useSelectImageHandler(ctx, GLAM_SAVE_CONFIG);
  const handleSelectPatternFor = useSelectImageHandler(ctx, PATTERN_SAVE_CONFIG);
  const handleSelectColorFor = useSelectImageHandler(ctx, COLOR_SAVE_CONFIG);

  // 小票：插图（图书封面 / 上游图片）持久化到 coverImageUrl，imageUrl 记录生成的完整小票
  //（供下游 / 画廊读取），两者互不覆盖；新记录就绪后排掉「记录已删除」弱提示
  const handleExportReceiptFor = useImageExportHandler(ctx, {
    nodeType: 'receipt_printer',
    historyNodeType: 'receipt_printer',
    promptOf: (state) =>
      state?.storeName ? `${state.storeName} - ${state.subtitle || '图书小票'}` : '图书小票',
    okExtras: (state) => ({
      coverImageUrl:
        state && typeof state.imageUrl === 'string' && state.imageUrl.trim() !== ''
          ? state.imageUrl
          : null,
    }),
    onHistorySaved: (id) => {
      ctx.setStaleRecordIds?.((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    emptyError: '保存小票图片失败',
    errLabel: '小票图片保存',
    historyWarn: '记录小票到历史数据库失败(不阻断导出):',
  });

  // 图书卡片：与图书小票同流程——手动点击生成 → /save-image 落盘 → generations 记录
  const handleExportBookCardFor = useImageExportHandler(ctx, {
    nodeType: 'book_card',
    historyNodeType: 'book_card',
    promptOf: () => '图书卡片生成',
    okExtras: () => ({}),
    onHistorySaved: (id) => {
      ctx.setStaleRecordIds?.((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    emptyError: '保存卡片图片失败',
    errLabel: '卡片图片保存',
    historyWarn: '记录卡片到历史数据库失败(不阻断导出):',
  });

  const handleExportStampFor = useImageExportHandler(ctx, {
    nodeType: 'stamp_cutter',
    historyNodeType: 'stamp_cutter',
    promptOf: () => '邮票截图',
    okExtras: () => ({}),
    onHistorySaved: () => {},
    emptyError: '保存邮票图片失败',
    errLabel: '邮票图片保存',
    historyWarn: '记录邮票到历史数据库失败(不阻断导出):',
  });

  // 贴纸制作：与邮票同流程——手动点击保存 → /save-image 落盘 → generations 记录
  const handleExportStickerFor = useImageExportHandler(ctx, {
    nodeType: 'sticker_maker',
    historyNodeType: 'sticker_maker',
    promptOf: () => '贴纸制作',
    okExtras: () => ({}),
    onHistorySaved: () => {},
    emptyError: '保存贴纸图片失败',
    errLabel: '贴纸图片保存',
    historyWarn: '记录贴纸到历史数据库失败(不阻断导出):',
  });

  // 手账制作：与贴纸同流程——手动点击保存 → /save-image 落盘 → generations 记录
  const handleExportJournalFor = useImageExportHandler(ctx, {
    nodeType: 'journal_maker',
    historyNodeType: 'journal_maker',
    promptOf: () => '手账制作',
    okExtras: () => ({}),
    onHistorySaved: () => {},
    emptyError: '保存手账图片失败',
    errLabel: '手账图片保存',
    historyWarn: '记录手账到历史数据库失败(不阻断导出):',
  });

  // 文本成图：与手账同流程——手动点击保存 → /save-image 落盘 → generations 记录
  const handleExportTextImageFor = useImageExportHandler(ctx, {
    nodeType: 'text_image',
    historyNodeType: 'text_image',
    promptOf: () => '文本成图',
    okExtras: () => ({}),
    onHistorySaved: () => {},
    emptyError: '保存文本图片失败',
    errLabel: '文本图片保存',
    historyWarn: '记录文本成图到历史数据库失败(不阻断导出):',
  });

  // 湿油彩效果：与邮票同流程——手动点击保存 → /save-image 落盘 → generations 记录
  const handleExportOilPaintFor = useImageExportHandler(ctx, {
    nodeType: 'oil_paint',
    historyNodeType: 'oil_paint',
    promptOf: () => '湿油彩效果',
    okExtras: () => ({}),
    onHistorySaved: () => {},
    emptyError: '保存湿油彩图片失败',
    errLabel: '湿油彩图片保存',
    historyWarn: '记录湿油彩到历史数据库失败(不阻断导出):',
  });

  // 图片处理：与邮票/湿油彩同流程——手动点击保存 → /save-image 落盘 → generations 记录
  //（prompt 记录当前所选效果名，如「图片处理 · 噪点」，多效果切换后记录可追溯）
  const handleExportImageProcessFor = useImageExportHandler(ctx, {
    nodeType: 'image_process',
    historyNodeType: 'image_process',
    promptOf: (state) =>
      `图片处理 · ${state?.effectName || '未知效果'}`,
    okExtras: () => ({}),
    onHistorySaved: () => {},
    emptyError: '保存处理结果图片失败',
    errLabel: '图片处理保存',
    historyWarn: '记录图片处理到历史数据库失败(不阻断导出):',
  });

  // 微浮雕高光：与图片处理/邮票同流程——手动点击保存 → /save-image 落盘 → generations 记录
  const handleExportEmbossFoilFor = useImageExportHandler(ctx, {
    nodeType: 'emboss_foil',
    historyNodeType: 'emboss_foil',
    promptOf: () => '微浮雕高光',
    okExtras: () => ({}),
    onHistorySaved: () => {},
    emptyError: '保存微浮雕高光图片失败',
    errLabel: '微浮雕高光保存',
    historyWarn: '记录微浮雕高光到历史数据库失败(不阻断导出):',
  });

  const handleExportMapPosterFor = useSimpleImageExportHandler(ctx, 'map_poster');
  const handleExportMapArtFor = useSimpleImageExportHandler(ctx, 'map_art');

  return {
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
    handleExportMapPosterFor,
    handleExportMapArtFor,
  };
}