import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Check, ImageOff, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import api from '../../../platform/services/api';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { SMALL_TOOL_TIMEOUT_MS } from '../../../platform/utils/timeouts';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import { SearchImageThumbnail } from './SearchImageThumbnail';

/** 检索结果项（后端 image-search 归一化后的统一形态） */
export interface ImageSearchItem {
  id: string;
  source: string;
  thumbUrl: string;
  previewUrl: string;
  fullUrl: string;
  width: number;
  height: number;
  photographer: string;
  description: string;
  pageUrl: string;
  downloadUrl: string | null;
}

/** 选中图片写入 node.data.selectedImage 的元数据（持久化，供下游/展示使用） */
export interface ImageSearchSelection {
  source: string;
  sourceLabel?: string;
  photographer: string;
  description: string;
  pageUrl: string;
  downloadUrl: string | null;
  previewUrl: string;
}

export interface ImageSearchNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 已选图片本地 URL（node.data.imageUrl，对外图片输出） */
  imageUrl?: string | null;
  /** 已选图片元数据（署名等） */
  selectedImage?: ImageSearchSelection | null;
  /** 当前来源 tab（持久化在 node.data.provider：unsplash / pixabay / nasa-image） */
  provider?: string;
  /** 连线上级文本（连线即输入：优先作为检索关键词） */
  upstreamKeyword?: string;
  /** 页面级错误（选择保存失败等，写入 node.data.error） */
  error?: string | null;
  /** 选择一张图：下载到本地并写回 node.data.imageUrl（失败抛错） */
  onSelectImage?: (id: string, url: string, meta: ImageSearchSelection) => Promise<void>;
  /** 编辑器状态写入 node.data（provider 等；undoable=false 仅持久化不记撤销历史） */
  onUpdateEditor?: (id: string, patch: Record<string, any>, undoable: boolean) => void;
  onRemove?: (id: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  hasDownstream?: boolean;
}

const PROVIDERS: { value: string; label: string; title?: string }[] = [
  { value: 'unsplash', label: 'Unsplash', title: 'Unsplash 免版权图库' },
  { value: 'pixabay', label: 'Pixabay', title: 'Pixabay 免版权图库' },
  { value: 'nasa-image', label: 'NASA', title: 'NASA 图片库' },
];

/** 每页条数（网格 3 列 × 8 行） */
const PER_PAGE = 24;

/** 每个图库提供商的独立缓存与检索状态 */
interface ProviderCacheState {
  items: ImageSearchItem[];
  hasMore: boolean;
  searchError: string;
  loaded: boolean;
  lastLoadedQuery: string;
}

type ProviderCacheMap = Record<string, ProviderCacheState>;

const initialProviderCache = (): ProviderCacheMap =>
  Object.fromEntries(
    PROVIDERS.map((p) => [p.value, { items: [], hasMore: false, searchError: '', loaded: false, lastLoadedQuery: '' }])
  );

const ImageSearchNodeInner: React.FC<ImageSearchNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  imageUrl = null,
  selectedImage = null,
  provider = 'unsplash',
  upstreamKeyword = '',
  error = null,
  onSelectImage,
  onUpdateEditor,
  onRemove,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  hasDownstream,
}) => {
  const { showToast } = useFeedback();

  // ---- 编辑器状态（provider 持久化；query 跨 Tab 共享；结果集按 provider 隔离缓存） ----
  const [activeProvider, setActiveProvider] = useState<string>(provider);
  const [query, setQuery] = useState('');
  const [providerCache, setProviderCache] = useState<ProviderCacheMap>(initialProviderCache);
  const [loadingType, setLoadingType] = useState<'search' | 'refresh' | 'more' | 'auto' | null>(null);
  const loading = loadingType !== null;
  const [savingId, setSavingId] = useState<string | null>(null);

  /** 请求序号：丢弃过期响应，防止快速切换/输入时旧结果覆盖新结果 */
  const requestSeq = useRef(0);
  /** 用于对比上游关键词变更 */
  const prevUpstreamRef = useRef(upstreamKeyword);

  const currentCache = providerCache[activeProvider];
  const items = currentCache.items;
  const hasMore = currentCache.hasMore;
  const searchError = currentCache.searchError;

  /** 生效关键词：连线上级文本优先，其次当前手动输入 */
  const effectiveQuery = upstreamKeyword.trim() || query.trim();

  const load = useCallback(
    async (
      targetProvider: string,
      queryText: string,
      page: number,
      replace: boolean,
      type: 'search' | 'refresh' | 'more' | 'auto' = 'auto'
    ) => {
      const seq = ++requestSeq.current;
      setLoadingType(type);
      setProviderCache((prev) => ({
        ...prev,
        [targetProvider]: {
          ...prev[targetProvider],
          searchError: '',
        },
      }));
      try {
        const res: { items?: ImageSearchItem[]; total?: number | null } = await api.post(
          '/modules/bookplate/image-search',
          {
            provider: targetProvider,
            query: queryText,
            page,
            per_page: PER_PAGE,
          },
          { timeout: SMALL_TOOL_TIMEOUT_MS }
        );
        if (seq !== requestSeq.current) return;
        const list = Array.isArray(res.items) ? res.items : [];
        const total = typeof res.total === 'number' ? res.total : null;
        setProviderCache((prev) => {
          const currentItems = prev[targetProvider].items;
          const nextItems = replace ? list : [...currentItems, ...list];
          const hasMore =
            total == null
              ? list.length >= PER_PAGE
              : (replace ? list.length : currentItems.length + list.length) < total;
          return {
            ...prev,
            [targetProvider]: {
              ...prev[targetProvider],
              items: nextItems,
              hasMore,
              searchError: '',
              loaded: true,
              lastLoadedQuery: queryText,
            },
          };
        });
      } catch (e: any) {
        if (seq !== requestSeq.current) return;
        setProviderCache((prev) => ({
          ...prev,
          [targetProvider]: {
            ...prev[targetProvider],
            searchError: e?.detail || e?.message || '图片检索失败，请重试',
            items: replace ? [] : prev[targetProvider].items,
            loaded: true,
            lastLoadedQuery: queryText,
          },
        }));
      } finally {
        if (seq === requestSeq.current) setLoadingType(null);
      }
    },
    []
  );

  // 外部恢复（撤销/重做/历史恢复/切页回来）：node.data.provider 与本地不一致时同步
  useEffect(() => {
    if (provider !== activeProvider) setActiveProvider(provider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  // 挂载 / Provider 切换：若该来源尚未加载过，则拉取第一批（已有数据则复用缓存，不重复请求）
  const isLoaded = providerCache[activeProvider].loaded;
  useEffect(() => {
    if (!isLoaded) {
      void load(activeProvider, effectiveQuery, 1, true, 'auto');
    }
  }, [activeProvider, isLoaded, load, effectiveQuery]);

  // 上游连线关键词发生实质变化时，自动重新检索当前 provider
  useEffect(() => {
    if (prevUpstreamRef.current !== upstreamKeyword) {
      prevUpstreamRef.current = upstreamKeyword;
      void load(activeProvider, upstreamKeyword.trim() || query.trim(), 1, true, 'auto');
    }
  }, [upstreamKeyword, activeProvider, query, load]);

  const switchProvider = (p: string) => {
    if (p === activeProvider) return;
    setActiveProvider(p);
    // 仅持久化到 node.data（切页保持），不记撤销历史
    onUpdateEditor?.(id, { provider: p }, false);
  };

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    void load(activeProvider, effectiveQuery, 1, true, 'search');
  };

  /** 换一批：同条件重新拉取（无关键词时 Unsplash 会换一批随机图） */
  const handleRefresh = () => {
    if (loading) return;
    void load(activeProvider, effectiveQuery, 1, true, 'refresh');
  };

  const handleLoadMore = () => {
    if (loading || !hasMore) return;
    const nextPage = Math.floor(items.length / PER_PAGE) + 1;
    void load(activeProvider, effectiveQuery, nextPage, false, 'more');
  };

  const handleSelect = async (item: ImageSearchItem) => {
    if (hasDownstream || savingId) return;
    setSavingId(item.id);
    const providerMeta = PROVIDERS.find((p) => p.value === item.source);
    const sourceLabel = providerMeta?.value === 'nasa-image' ? 'NASA 图片库' : providerMeta?.label;
    try {
      await onSelectImage?.(id, item.previewUrl, {
        source: item.source,
        sourceLabel,
        photographer: item.photographer,
        description: item.description,
        pageUrl: item.pageUrl,
        downloadUrl: item.downloadUrl,
        previewUrl: item.previewUrl,
      });
      showToast('已选择图片，可连线输出到下游节点', { type: 'success' });
    } catch {
      // 页面 handler 已写入 node.data.error 并 toast，无需重复提示
    } finally {
      setSavingId(null);
    }
  };

  const handleDownload = () => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    const ext = imageUrl.split('.').pop()?.split('?')[0]?.toLowerCase() || 'png';
    const prefix = activeProvider === 'nasa-image' ? 'nasa-image' : 'search-image';
    a.href = imageUrl;
    a.download = `${prefix}-${Date.now()}.${ext}`;
    a.click();
  };

  const activeProviderMeta = PROVIDERS.find((p) => p.value === activeProvider);
  const providerLabel = activeProviderMeta?.label ?? activeProvider;

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '图片检索'}
      dotColor={NODE_COLORS.image_search}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 440, height: 560 }}
      showLeftAnchor
      showRightAnchor
      footer={footer}
      actionBar={
        <NodeActionBar>
          {imageUrl && (
            <NodeActionBar.Download
              tooltip="下载已选图片"
              onClick={handleDownload}
            />
          )}
        </NodeActionBar>
      }
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
          {/* 来源 tab + 换一批 */}
          <div className="shrink-0 flex items-center gap-1.5">
            <div className="flex items-center gap-0.5 rounded-md border border-dashed border-paper-grid p-0.5">
              {PROVIDERS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => switchProvider(p.value)}
                  title={p.title ?? ''}
                  className={`px-2.5 h-7 rounded text-xs font-serif transition-colors ${
                    activeProvider === p.value
                      ? 'bg-accent text-paper'
                      : 'text-ink-light hover:text-ink hover:bg-paper-grid/40'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              title="换一批"
              className="flex items-center justify-center w-8 h-8 rounded-md border border-dashed border-paper-grid text-ink-light hover:text-ink hover:bg-paper-grid/40 active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw size={13} strokeWidth={2} className={loadingType === 'refresh' ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* 关键词检索 */}
          <form onSubmit={handleSearch} className="shrink-0 relative">
            <Search
              size={13}
              strokeWidth={2}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={upstreamKeyword.trim() ? `上游关键词：${upstreamKeyword.trim()}` : `搜索${providerLabel}图片…`}
              className="w-full h-9 rounded-md border border-dashed border-paper-grid bg-transparent pl-8 pr-16 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-9 top-1/2 -translate-y-1/2 p-0.5 rounded text-ink-faint hover:text-error hover:bg-paper-grid/40 active:scale-[0.96] transition-all"
                title="清除"
              >
                <X size={13} strokeWidth={2} />
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              className="absolute right-1 top-1/2 -translate-y-1/2 px-2 h-7 rounded-md text-xs text-ink-light hover:text-ink hover:bg-paper-grid/40 active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title="检索"
            >
              {loadingType === 'search' ? <Loader2 size={13} strokeWidth={2} className="animate-spin" /> : '检索'}
            </button>
          </form>

          {/* 结果网格 / 加载 / 错误 */}
          <div className="relative flex-1 min-h-0">
            {loading && items.length === 0 && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-center">
                <Loader2 size={20} strokeWidth={1.5} className="text-accent animate-spin" />
                <p className="text-xs font-serif text-ink-light">
                  {effectiveQuery ? `正在检索「${effectiveQuery}」…` : `正在加载${providerLabel}图片…`}
                </p>
              </div>
            )}
            <div className="h-full overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
              {!loading && searchError && (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-3">
                  <ImageOff size={24} strokeWidth={1.5} className="text-error/70" />
                  <p className="text-xs text-error font-sans break-words">{searchError}</p>
                  <button
                    type="button"
                    onClick={handleRefresh}
                    className="text-[11px] text-error font-medium hover:underline active:scale-[0.96] transition-transform"
                  >
                    重试
                  </button>
                </div>
              )}
              {!loading && !searchError && items.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-3">
                  <ImageOff size={24} strokeWidth={1.5} className="text-ink-faint" />
                  <p className="text-xs text-ink-light font-sans">
                    {effectiveQuery ? `没有匹配「${effectiveQuery}」的图片` : '暂无图片，点击「换一批」试试'}
                  </p>
                </div>
              )}
              {items.length > 0 && (
                <div className="grid grid-cols-3 gap-1.5 pb-1">
                  {items.map((item) => {
                    const saving = savingId === item.id;
                    const isSelected = !!(
                      selectedImage &&
                      (selectedImage.previewUrl === item.previewUrl ||
                        (selectedImage.pageUrl && selectedImage.pageUrl === item.pageUrl) ||
                        (selectedImage.downloadUrl && selectedImage.downloadUrl === item.downloadUrl))
                    );
                    const conciseLabel = (item.description || item.photographer || '图片')
                      .split(',')[0]
                      .trim();

                    const bottomLabel = item.photographer
                      ? (conciseLabel && conciseLabel !== item.photographer
                        ? `@${item.photographer} · ${conciseLabel}`
                        : `@${item.photographer}`)
                      : conciseLabel;

                    const tooltipContent = (
                      <div className="flex flex-col gap-1 text-[11px] max-w-[240px]">
                        {item.photographer && (
                          <div className="font-medium text-ink flex items-center gap-1">
                            <span className="text-ink-faint text-[10px]">摄影师:</span>
                            <span className="truncate">@{item.photographer}</span>
                          </div>
                        )}
                        {item.description && (
                          <div className="text-ink-light text-[10px] leading-snug line-clamp-3">
                            <span className="text-ink-faint mr-1">说明:</span>
                            <span>{item.description}</span>
                          </div>
                        )}
                      </div>
                    );

                    return (
                      <Tooltip key={item.id} content={tooltipContent}>
                        <div
                          className={`relative rounded-md overflow-hidden transition-all bg-paper/40 group ${
                            isSelected
                              ? 'border-2 border-accent ring-1 ring-accent/30 shadow-sm'
                              : 'border border-paper-grid'
                          }`}
                        >
                          <SearchImageThumbnail
                            thumbUrl={item.thumbUrl}
                            previewUrl={item.previewUrl}
                            alt={conciseLabel}
                          />
                          {/* 底部说明：悬停时平滑淡入，保持默认缩略图纯净 */}
                          {bottomLabel && (
                            <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/75 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-10">
                              <p className="text-[9px] text-white/95 truncate font-sans drop-shadow-sm">
                                {bottomLabel}
                              </p>
                            </div>
                          )}
                          {/* 选择 / 已选 徽章与操作按钮 */}
                          {isSelected ? (
                            <div
                              title="当前已选为输出图片"
                              className="absolute top-1 right-1 px-1.5 h-5 rounded-full flex items-center gap-0.5 bg-accent text-paper text-[10px] font-sans font-medium shadow-sm pointer-events-none z-10"
                            >
                              <Check size={11} strokeWidth={2.5} />
                              <span>已选</span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleSelect(item)}
                              disabled={saving || hasDownstream}
                              title={
                                hasDownstream
                                  ? '有下级节点，不可更换输出（需先断开连线）'
                                  : '选择此图作为节点输出'
                              }
                              className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center bg-black/45 text-white/90 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent disabled:opacity-40 disabled:hover:bg-black/45 disabled:cursor-not-allowed active:scale-95 z-10"
                            >
                              {saving ? (
                                <Loader2 size={12} strokeWidth={2} className="animate-spin" />
                              ) : (
                                <Check size={12} strokeWidth={2.5} />
                              )}
                            </button>
                          )}
                        </div>
                      </Tooltip>
                    );
                  })}
                </div>
              )}
              {/* 加载更多 */}
              {!loading && items.length > 0 && hasMore && (
                <button
                  type="button"
                  onClick={handleLoadMore}
                  className="w-full py-2 mt-1 rounded-md border border-dashed border-paper-grid text-[11px] text-ink-light hover:text-ink hover:bg-paper-grid/30 active:scale-[0.96] transition-all"
                >
                  加载更多
                </button>
              )}
              {loadingType === 'more' && items.length > 0 && (
                <div className="py-2 flex items-center justify-center">
                  <Loader2 size={14} strokeWidth={1.5} className="text-ink-faint animate-spin" />
                </div>
              )}
            </div>
          </div>

          {/* 页面级错误（选择保存失败） */}
          {error && (
            <div className="shrink-0 px-2.5 py-1.5 rounded-md border border-error/20 bg-error/5 text-[11px] text-error break-words">
              {error}
            </div>
          )}

          {/* 已选图片（对外输出） */}
          <div className="shrink-0 flex items-center gap-2.5 pt-2 border-t border-dashed border-paper-grid">
            {imageUrl ? (
              <>
                <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
                  <PhotoView src={imageUrl}>
                    <Tooltip content="点击查看已选图片">
                      <img
                        src={imageUrl}
                        alt="已选图片"
                        referrerPolicy="no-referrer"
                        decoding="async"
                        className="h-12 w-12 rounded-md border border-paper-grid object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
                      />
                    </Tooltip>
                  </PhotoView>
                </PhotoProvider>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-serif text-ink truncate flex items-center gap-1.5">
                    <span>已选择图片</span>
                    {hasDownstream && (
                      <span className="text-[9px] font-sans px-1 py-0.5 rounded border border-dashed border-paper-grid text-ink-faint">
                        输出已连接
                      </span>
                    )}
                    <span className="text-ink-faint text-[10px]">
                      {selectedImage?.sourceLabel ? `· ${selectedImage.sourceLabel}` : selectedImage?.source ? `· ${selectedImage.source}` : ''}
                    </span>
                  </p>
                  <p className="text-[10px] text-ink-faint font-sans truncate" title={selectedImage?.description || selectedImage?.photographer || ''}>
                    {(() => {
                      const metaText = selectedImage?.photographer
                        ? (selectedImage.description
                          ? `摄影师：${selectedImage.photographer} · ${selectedImage.description.split(',')[0].trim()}`
                          : `摄影师：${selectedImage.photographer}`)
                        : selectedImage?.description
                          ? selectedImage.description.split(',').slice(0, 2).join(', ')
                          : null;

                      if (hasDownstream) {
                        return metaText
                          ? `${metaText}（输出已连接到下游）`
                          : '输出已连接到下游节点，如需更换请先断开连线';
                      }
                      return metaText || '可作为图片输出给下游节点';
                    })()}
                  </p>
                </div>
              </>
            ) : (
              <span className="text-[10px] font-sans text-ink-faint flex items-center gap-1">
                <Search size={11} strokeWidth={1.5} />
                悬停缩略图点击「✓」选择图片，可作为图片输出给下游节点
              </span>
            )}
          </div>
        </div>
    </CanvasNode>
  );
};

export const ImageSearchNode = memo(ImageSearchNodeInner);
ImageSearchNode.displayName = 'ImageSearchNode';
export default ImageSearchNode;
