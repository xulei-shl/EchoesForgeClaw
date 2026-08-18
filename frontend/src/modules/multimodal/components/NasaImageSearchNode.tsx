import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Check, Film, Image as ImageIcon, ImageOff, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import api from '../../../platform/services/api';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import { Select } from '../../../platform/components/ui/Select';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { SMALL_TOOL_TIMEOUT_MS } from '../../../platform/utils/timeouts';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import { SearchImageThumbnail } from './SearchImageThumbnail';

/** 检索结果项（后端 image-search 归一化后的统一形态） */
export interface NasaSearchItem {
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
export interface NasaSearchSelection {
  source: string;
  /** 来源类别展示名（NASA 图片库 / NASA 视频库） */
  sourceLabel: string;
  photographer: string;
  description: string;
  pageUrl: string;
  previewUrl: string;
}

export interface NasaImageSearchNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 已选图片本地 URL（node.data.imageUrl，对外图片输出） */
  imageUrl?: string | null;
  /** 已选图片元数据（署名等） */
  selectedImage?: NasaSearchSelection | null;
  /** 当前类别（持久化在 node.data.provider：nasa-image / nasa-video） */
  provider?: string;
  /** 连线上级文本（连线即输入：优先作为检索关键词） */
  upstreamKeyword?: string;
  /** 页面级错误（选择保存失败等，写入 node.data.error） */
  error?: string | null;
  /** 选择一张图：下载到本地并写回 node.data.imageUrl（失败抛错） */
  onSelectImage?: (id: string, url: string, meta: NasaSearchSelection) => Promise<void>;
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

/** 两个类别（与后端 image-search-service 的 provider 一致）。\n *  NASA Images 官方公开图片库（images-api.nasa.gov）：公有领域，无需注册与 API Key。 */
const PROVIDERS: { value: string; label: string; title: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }> }[] = [
  {
    value: 'nasa-image',
    label: '图片',
    title: 'NASA 图片库 · 关键词检索（留空 = 随机浏览）· 公有领域无需凭据',
    icon: ImageIcon,
  },
  {
    value: 'nasa-video',
    label: '视频',
    title: 'NASA 视频库 · 以预览帧图展示（留空 = 随机浏览）· 公有领域无需凭据',
    icon: Film,
  },
];

/** 每页条数（网格 3 列） */
const PER_PAGE = 24;

interface ProviderCacheState {
  items: NasaSearchItem[];
  searchError: string;
  /** 当前已加载到的页码（用于「加载更多」追加下一页） */
  page: number;
  /** 是否还有更多可加载（items + 已翻页数 < 后端 total_hits） */
  hasMore: boolean;
}

const initialProviderCache = (): Record<string, ProviderCacheState> =>
  Object.fromEntries(
    PROVIDERS.map((p) => [p.value, { items: [], searchError: '', page: 1, hasMore: false }])
  );

const NasaImageSearchNodeInner: React.FC<NasaImageSearchNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  imageUrl = null,
  selectedImage = null,
  provider = 'nasa-image',
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

  // ---- 编辑器状态（provider 持久化；检索词为节点内临时态） ----
  const [activeProvider, setActiveProvider] = useState<string>(provider);
  const [query, setQuery] = useState('');
  const [providerCache, setProviderCache] = useState<Record<string, ProviderCacheState>>(initialProviderCache);
  const [loadingType, setLoadingType] = useState<'search' | 'refresh' | 'more' | 'auto' | null>(null);
  const loading = loadingType !== null;
  const [savingId, setSavingId] = useState<string | null>(null);

  /** 请求序号：丢弃过期响应，防止快速切换/输入时旧结果覆盖新结果 */
  const requestSeq = useRef(0);
  /** 用于对比上游关键词变更 */
  const prevUpstreamRef = useRef(upstreamKeyword);

  const currentCache = providerCache[activeProvider];
  const items = currentCache.items;
  const searchError = currentCache.searchError;
  const hasMore = currentCache.hasMore;

  /** 生效关键词：连线上级文本优先，其次当前类别的手动输入 */
  const effectiveQuery = upstreamKeyword.trim() || query.trim();

  const handleQueryChange = (val: string) => {
    setQuery(val);
  };

  const load = useCallback(
    async (
      targetProvider: string,
      queryText: string,
      replace: boolean,
      pageParam = 1,
      type: 'search' | 'refresh' | 'more' | 'auto' = 'auto'
    ): Promise<boolean> => {
      const seq = ++requestSeq.current;
      // 新检索（replace）一律从第 1 页开始；「加载更多」在缓存页码基础上翻页
      const targetPage = replace ? 1 : pageParam;
      setLoadingType(type);
      setProviderCache((prev) => ({
        ...prev,
        [targetProvider]: { ...prev[targetProvider], searchError: '' },
      }));
      try {
        const res: { items?: NasaSearchItem[]; total?: number | null } = await api.post(
          '/modules/bookplate/image-search',
          {
            provider: targetProvider,
            query: queryText,
            page: targetPage,
            per_page: PER_PAGE,
          },
          { timeout: SMALL_TOOL_TIMEOUT_MS }
        );
        if (seq !== requestSeq.current) return false;
        const list = Array.isArray(res.items) ? res.items : [];
        const total = typeof res.total === 'number' ? res.total : null;
        // 是否还有更多：已翻到的最大页 * 每页条数 < 后端总命中数
        const loadedCount = (targetPage - 1) * PER_PAGE + list.length;
        const hasMore = total !== null ? loadedCount < total : false;
        setProviderCache((prev) => ({
          ...prev,
          [targetProvider]: {
            items: replace ? list : [...prev[targetProvider].items, ...list],
            searchError: '',
            page: targetPage,
            hasMore,
          },
        }));
        return true;
      } catch (e: any) {
        if (seq !== requestSeq.current) return false;
        setProviderCache((prev) => ({
          ...prev,
          [targetProvider]: {
            ...prev[targetProvider],
            searchError: e?.detail || e?.message || 'NASA 图片检索失败，请重试',
            items: replace ? [] : prev[targetProvider].items,
          },
        }));
        return false;
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

  // 挂载 / 类别切换：以当前生效关键词检索该类别（检索词切换类别时保留）
  useEffect(() => {
    void load(activeProvider, effectiveQuery, true, 1, 'auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProvider]);

  // 上游连线关键词发生实质变化时，自动重新检索当前类别
  useEffect(() => {
    if (prevUpstreamRef.current !== upstreamKeyword) {
      prevUpstreamRef.current = upstreamKeyword;
      void load(activeProvider, upstreamKeyword.trim() || query.trim(), true, 1, 'auto');
    }
  }, [upstreamKeyword, activeProvider, query, load]);

  const switchProvider = (p: string) => {
    if (p === activeProvider) return;
    setActiveProvider(p);
    // 离散编辑：持久化到 node.data（切页保持），不记撤销历史
    onUpdateEditor?.(id, { provider: p }, false);
  };

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    void load(activeProvider, effectiveQuery, true, 1, 'search');
  };

  /** 换一批：同条件重新拉取第 1 页（留空时库内默认条目） */
  const handleRefresh = () => {
    if (loading) return;
    void load(activeProvider, effectiveQuery, true, 1, 'refresh');
  };

  /** 加载更多：按当前缓存页码追加下一页 */
  const handleLoadMore = () => {
    if (loading) return;
    void load(activeProvider, effectiveQuery, false, currentCache.page + 1, 'more');
  };

  const handleSelect = async (item: NasaSearchItem) => {
    if (hasDownstream || savingId) return;
    setSavingId(item.id);
    try {
      await onSelectImage?.(id, item.previewUrl, {
        source: item.source,
        sourceLabel: PROVIDERS.find((p) => p.value === item.source)?.label === '视频' ? 'NASA 视频库' : 'NASA 图片库',
        photographer: item.photographer,
        description: item.description,
        pageUrl: item.pageUrl,
        previewUrl: item.previewUrl,
      });
      showToast('已选择图片，可连线输出到下游节点', { type: 'success', position: 'top-right' });
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
    a.href = imageUrl;
    a.download = `nasa-image-${Date.now()}.${ext}`;
    a.click();
  };

  const activeProviderMeta = PROVIDERS.find((p) => p.value === activeProvider);
  const ProviderIcon = activeProviderMeta?.icon ?? ImageIcon;

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || 'NASA 图片检索'}
      dotColor={NODE_COLORS.nasa_image_search}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 440, height: 580 }}
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
      <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
        <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
          {/* 类别选择 + 换一批 */}
          <div className="shrink-0 flex items-center gap-1.5">
            <div className="flex-1 min-w-0">
              <Select
                size="sm"
                value={activeProvider}
                onChange={switchProvider}
                options={PROVIDERS.map((p) => ({ value: p.value, label: p.label, title: p.title }))}
              />
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              title="换一批（留空时返回库内默认条目）"
              className="flex items-center justify-center w-8 h-8 rounded-md border border-dashed border-paper-grid text-ink-light hover:text-ink hover:bg-paper-grid/40 active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <RefreshCw size={13} strokeWidth={2} className={loadingType === 'refresh' ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* 类别提示 */}
          <p className="shrink-0 text-[10px] font-sans text-ink-faint leading-snug truncate" title={activeProviderMeta?.title}>
            <ProviderIcon size={10} strokeWidth={1.5} className="inline mr-1 -mt-px" />
            {activeProviderMeta?.title}
          </p>

          {/* 关键词检索 */}
          <form onSubmit={handleSearch} className="shrink-0 relative">
            <Search
              size={13}
              strokeWidth={2}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
            />
            <input
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder={upstreamKeyword.trim() ? `上游关键词：${upstreamKeyword.trim()}` : '搜索关键词（留空 = 随机浏览）…'}
              className="w-full h-9 rounded-md border border-dashed border-paper-grid bg-transparent pl-8 pr-16 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono"
            />
            {query && (
              <button
                type="button"
                onClick={() => handleQueryChange('')}
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
                  {effectiveQuery
                    ? `正在检索「${effectiveQuery}」…`
                    : '正在浏览 NASA 图库…'}
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
                        (selectedImage.pageUrl && selectedImage.pageUrl === item.pageUrl))
                    );
                    return (
                      <div
                        key={item.id}
                        className={`relative rounded-md overflow-hidden transition-all bg-paper/40 group ${
                          isSelected
                            ? 'border-2 border-accent ring-1 ring-accent/30 shadow-sm'
                            : 'border border-paper-grid'
                        }`}
                        title={item.description || item.photographer || item.id}
                      >
                        <SearchImageThumbnail
                          thumbUrl={item.thumbUrl}
                          previewUrl={item.previewUrl}
                          alt={item.description || item.photographer || ''}
                        />
                        {/* 底部标题 */}
                        {item.description && (
                          <div className="absolute inset-x-0 bottom-0 px-1 py-0.5 bg-gradient-to-t from-black/50 to-transparent pointer-events-none z-10">
                            <p className="text-[9px] text-white/90 truncate">{item.description}</p>
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
                                : '选择此图片作为节点输出'
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
                    );
                  })}
                </div>
              )}
              {/* 滚动到底部：还有更多时显示加载更多（追加下一页） */}
              {hasMore && !loading && items.length > 0 && (
                <div className="py-2 flex justify-center">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    className="px-4 h-8 rounded-md border border-dashed border-paper-grid text-xs text-ink-light hover:text-ink hover:bg-paper-grid/40 active:scale-[0.96] transition-all"
                  >
                    加载更多
                  </button>
                </div>
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
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-serif text-ink truncate flex items-center gap-1.5">
                    <span>已选择图片</span>
                    {hasDownstream && (
                      <span className="text-[9px] font-sans px-1 py-0.5 rounded border border-dashed border-paper-grid text-ink-faint">
                        输出已连接
                      </span>
                    )}
                    {selectedImage?.sourceLabel && (
                      <span className="text-ink-faint text-[10px]">· {selectedImage.sourceLabel}</span>
                    )}
                  </p>
                  <p className="text-[10px] text-ink-faint font-sans truncate">
                    {hasDownstream
                      ? (selectedImage?.description
                        ? `${selectedImage.description}（输出已连接到下游）`
                        : '输出已连接到下游节点，如需更换请先断开连线')
                      : (selectedImage?.description
                        ? selectedImage.description
                        : '可作为图片输出给下游节点')}
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
      </PhotoProvider>
    </CanvasNode>
  );
};

export const NasaImageSearchNode = memo(NasaImageSearchNodeInner);
NasaImageSearchNode.displayName = 'NasaImageSearchNode';
export default NasaImageSearchNode;
