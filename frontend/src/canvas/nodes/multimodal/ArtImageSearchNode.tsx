import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Check, ImageOff, Landmark, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import api from '../../../shared/services/api';
import { CanvasNode } from '../_shared/CanvasNode';
import { NodeActionBar } from '../_shared/NodeActionBar';
import { Tooltip } from '../../../shared/components/ui/Tooltip';
import { Select } from '../../../shared/components/ui/Select';
import { useFeedback } from '../../../shared/components/ui/FeedbackProvider';
import { SMALL_TOOL_TIMEOUT_MS } from '../../../shared/utils/timeouts';
import { NODE_COLORS } from '../_shared/nodeTypes';
import { SearchImageThumbnail } from './SearchImageThumbnail';

/** 检索结果项（后端 glam-search 归一化后的统一形态） */
export interface GlamSearchItem {
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
export interface GlamSearchSelection {
  source: string;
  /** 来源博物馆展示名 */
  sourceLabel: string;
  photographer: string;
  description: string;
  pageUrl: string;
  previewUrl: string;
}

export interface ArtImageSearchNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 已选图片本地 URL（node.data.imageUrl，对外图片输出） */
  imageUrl?: string | null;
  /** 已选图片元数据（署名等） */
  selectedImage?: GlamSearchSelection | null;
  /** 当前来源（持久化在 node.data.provider） */
  provider?: string;
  /** 连线上级文本（连线即输入：优先作为检索关键词） */
  upstreamKeyword?: string;
  /** 页面级错误（选择保存失败等，写入 node.data.error） */
  error?: string | null;
  /** 选择一张图：下载到本地并写回 node.data.imageUrl（失败抛错） */
  onSelectImage?: (id: string, url: string, meta: GlamSearchSelection) => Promise<void>;
  /** 编辑器状态写入 node.data（provider 等；undoable=false 仅持久化不记撤销历史） */
  onUpdateEditor?: (id: string, patch: Record<string, any>, undoable: boolean) => void;
  onRemove?: (id: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/** 前端展示层屏蔽的来源（图片服务器在当前网络不可达，检索结果无法返回图片）：
 *  - AIC（ai-chicago）：www.artic.edu/iiif 对国内直连与数据中心代理出口均返回 403（区域/反爬封锁）
 *  - Harvard：nrs.harvard.edu 持续 429 限流
 * 后端对应源的检索逻辑保留不删；换到可达的网络环境后，从这里移除来源并恢复 PROVIDERS 条目即可。 */
const HIDDEN_GLAM_SOURCES = ['ai-chicago', 'harvard'];

/** 13 家博物馆来源（与后端 glam-search-service 的 GlamProvider 一致）；'all' = 全部来源聚合检索。
 *  ai-chicago / harvard 因图片不可达被屏蔽（见 HIDDEN_GLAM_SOURCES），不在此列出。 */
const PROVIDERS: { value: string; label: string; title: string }[] = [
  { value: 'all', label: '全部来源', title: '同时检索全部已配置博物馆（未配置 Key 的源自动跳过）' },
  { value: 'met', label: 'MET', title: '大都会艺术博物馆（无需配置）' },
  { value: 'rijks', label: 'Rijksmuseum', title: '荷兰国立博物馆（无需配置）' },
  { value: 'artsmia', label: 'MIA', title: '明尼阿波利斯美术馆（无需配置）' },
  { value: 'cleveland', label: 'Cleveland', title: '克利夫兰美术馆（无需配置）' },
  { value: 'smk', label: 'SMK', title: '丹麦国立美术馆（无需配置）' },
  { value: 'wellcome', label: 'Wellcome', title: 'Wellcome 馆藏（无需配置）' },
  { value: 'nypl', label: 'NYPL', title: '纽约公共图书馆（需 nypl.api_key）' },
  { value: 'smithsonian', label: 'Smithsonian', title: '史密森尼学会（需 smithsonian.api_key）' },
  { value: 'paris', label: 'Paris Musées', title: '巴黎博物馆（需 paris.api_key）' },
  { value: 'europeana', label: 'Europeana', title: 'Europeana（需 europeana.api_key）' },
  { value: 'loc', label: 'LoC', title: '美国国会图书馆（无需配置；需配置 loc.proxy 代理）' },
];

/** 每页条数（网格 3 列） */
const PER_PAGE = 30;

interface ProviderCacheState {
  items: GlamSearchItem[];
  searchError: string;
  sourceLabel: string;
  /** 是否还有更多可加载（后端 has_more 精确判断） */
  hasMore: boolean;
  /** 该来源是否已按当前关键词加载过（切来源时复用缓存，避免重复请求） */
  loaded: boolean;
  /** 上次加载时使用的关键词（用于判断缓存是否仍有效） */
  lastLoadedQuery: string;
  /** 命中总数（单源模式后端 total；聚合模式恒 null） */
  total: number | null;
  /** 各来源分页游标（key=来源名）：单源模式仅用本来源一项，聚合模式用于逐源推进 offset */
  cursors: Record<string, number>;
}

const initialProviderCache = (): Record<string, ProviderCacheState> =>
  Object.fromEntries(
    PROVIDERS.map((p) => [
      p.value,
      {
        items: [],
        searchError: '',
        sourceLabel: '',
        hasMore: false,
        loaded: false,
        lastLoadedQuery: '',
        total: null,
        cursors: {},
      },
    ])
  );

const ArtImageSearchNodeInner: React.FC<ArtImageSearchNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  imageUrl = null,
  selectedImage = null,
  provider = 'all',
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
}) => {
  const { showToast } = useFeedback();

  // ---- 编辑器状态（provider 持久化；检索词为全局共享状态，切换来源时保留不清空） ----
  const [activeProvider, setActiveProvider] = useState<string>(provider);
  const [query, setQuery] = useState('');
  const [providerCache, setProviderCache] = useState<Record<string, ProviderCacheState>>(initialProviderCache);
  const [loadingType, setLoadingType] = useState<'search' | 'refresh' | 'more' | 'auto' | null>(null);
  const loading = loadingType !== null;
  const [savingId, setSavingId] = useState<string | null>(null);
  /** 后端已配置的可用来源（null = 尚未加载 / 加载失败，此时展示全部） */
  const [availableProviders, setAvailableProviders] = useState<string[] | null>(null);

  /** 请求序号：丢弃过期响应，防止快速切换/输入时旧结果覆盖新结果 */
  const requestSeq = useRef(0);
  /** 用于对比上游关键词变更 */
  const prevUpstreamRef = useRef(upstreamKeyword);

  const currentCache = providerCache[activeProvider];
  const items = currentCache.items;
  const searchError = currentCache.searchError;
  const hasMore = currentCache.hasMore;

  /** 生效关键词：连线上级文本优先，其次当前来源的手动输入 */
  const effectiveQuery = upstreamKeyword.trim() || query.trim();

  const handleQueryChange = (val: string) => {
    setQuery(val);
  };

  const load = useCallback(
    async (
      targetProvider: string,
      queryText: string,
      replace: boolean,
      type: 'search' | 'refresh' | 'more' | 'auto',
      cursors: Record<string, number>
    ): Promise<boolean> => {
      const seq = ++requestSeq.current;
      // 新检索（replace）一律从 offset 0 开始（重置全部来源游标）
      const effectiveCursors = replace ? {} : cursors;
      setLoadingType(type);
      setProviderCache((prev) => ({
        ...prev,
        [targetProvider]: { ...prev[targetProvider], searchError: '' },
      }));
      try {
        // 聚合模式：透传各来源游标，后端逐源推进，避免共用一个全局偏移跳过中间结果；
        // 单源模式：只传本来源的 offset。
        const body =
          targetProvider === 'all'
            ? { provider: targetProvider, query: queryText, limit: PER_PAGE, offsets: effectiveCursors }
            : {
                provider: targetProvider,
                query: queryText,
                limit: PER_PAGE,
                offset: effectiveCursors[targetProvider] ?? 0,
              };
        const res: {
          items?: GlamSearchItem[];
          label?: string;
          has_more?: boolean;
          total?: number | null;
          next_offset?: number;
          per_source?: Record<string, { nextOffset?: number; total?: number | null }>;
        } = await api.post('/modules/bookplate/glam-search', body, { timeout: SMALL_TOOL_TIMEOUT_MS });
        if (seq !== requestSeq.current) return false;
        // 聚合模式：过滤掉被屏蔽来源（AIC / Harvard）的条目，避免展示无法加载的破图；单源模式不在此列，不会命中
        const list = (Array.isArray(res.items) ? res.items : []).filter(
          (it) => targetProvider !== 'all' || !HIDDEN_GLAM_SOURCES.includes(it.source)
        );
        setProviderCache((prev) => {
          const cache = prev[targetProvider];
          const nextCursors =
            targetProvider === 'all'
              ? Object.fromEntries(
                  Object.entries(res.per_source ?? {}).map(([src, info]) => [
                    src,
                    typeof info?.nextOffset === 'number' ? info.nextOffset : 0,
                  ])
                )
              : {
                  ...cache.cursors,
                  [targetProvider]:
                    typeof res.next_offset === 'number'
                      ? res.next_offset
                      : (effectiveCursors[targetProvider] ?? 0) + list.length,
                };
          return {
            ...prev,
            [targetProvider]: {
              ...cache,
              items: replace ? list : [...cache.items, ...list],
              searchError: '',
              sourceLabel: typeof res.label === 'string' ? res.label : '',
              hasMore: !!res.has_more,
              loaded: true,
              lastLoadedQuery: queryText,
              total: targetProvider === 'all' ? null : typeof res.total === 'number' ? res.total : null,
              cursors: nextCursors,
            },
          };
        });
        return true;
      } catch (e: any) {
        if (seq !== requestSeq.current) return false;
        setProviderCache((prev) => ({
          ...prev,
          [targetProvider]: {
            ...prev[targetProvider],
            searchError: e?.detail || e?.message || '艺术图片检索失败，请重试',
            items: replace ? [] : prev[targetProvider].items,
            loaded: true,
            lastLoadedQuery: queryText,
          },
        }));
        return false;
      } finally {
        if (seq === requestSeq.current) setLoadingType(null);
      }
    },
    []
  );

  /** 可用来源列表（含「全部来源」；加载中/失败时回退为完整列表） */
  const visibleProviders = availableProviders
    ? PROVIDERS.filter((p) => p.value === 'all' || availableProviders.includes(p.value))
    : PROVIDERS;

  // 挂载时拉取可用来源（未配置 Key 的源不展示在来源下拉）
  useEffect(() => {
    let cancelled = false;
    api
      .get('/modules/bookplate/glam-providers')
      .then((res: any) => {
        if (cancelled) return;
        setAvailableProviders(Array.isArray(res?.providers) ? res.providers : null);
      })
      .catch(() => {
        if (!cancelled) setAvailableProviders(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 外部恢复（撤销/重做/历史恢复/切页回来）：node.data.provider 与本地不一致时同步
  useEffect(() => {
    if (provider !== activeProvider) setActiveProvider(provider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  // 当前来源不可用（如持久化的 Key 已移除）时回退到首个可用来源
  useEffect(() => {
    if (!availableProviders) return;
    if (visibleProviders.some((p) => p.value === activeProvider)) return;
    const fallback = visibleProviders.find((p) => p.value !== 'all')?.value ?? 'met';
    setActiveProvider(fallback);
    onUpdateEditor?.(id, { provider: fallback }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableProviders, activeProvider]);

  // 挂载 / Provider 切换：以当前生效关键词检索该来源。检索词为全局共享，切换来源时保留不清空。
  // 若该来源已按当前关键词加载过则复用缓存（避免重复请求），否则重新检索（替换旧结果）。
  useEffect(() => {
    const cache = providerCache[activeProvider];
    if (!cache.loaded || cache.lastLoadedQuery !== effectiveQuery) {
      void load(activeProvider, effectiveQuery, true, 'auto', {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProvider]);

  // 上游连线关键词发生实质变化时，自动重新检索当前 provider
  useEffect(() => {
    if (prevUpstreamRef.current !== upstreamKeyword) {
      prevUpstreamRef.current = upstreamKeyword;
      void load(activeProvider, upstreamKeyword.trim() || query.trim(), true, 'auto', {});
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
    void load(activeProvider, effectiveQuery, true, 'search', {});
  };

  /** 换一批：同条件重新拉取（无关键词时各源返回随机一批作品） */
  const handleRefresh = () => {
    if (loading) return;
    void load(activeProvider, effectiveQuery, true, 'refresh', {});
  };

  /** 加载更多：按各来源游标继续拉取下一批（仅关键词检索且后端 has_more 时有此按钮） */
  const handleLoadMore = () => {
    if (loading) return;
    void load(activeProvider, effectiveQuery, false, 'more', currentCache.cursors);
  };

  const handleSelect = async (item: GlamSearchItem) => {
    if (savingId) return;
    setSavingId(item.id);
    try {
      await onSelectImage?.(id, item.previewUrl, {
        source: item.source,
        // 全部来源模式下用该项自身的来源名；单源模式用缓存里的来源全名
        sourceLabel: activeProvider === 'all' ? sourceShortLabel(item.source) : currentCache.sourceLabel || item.source,
        photographer: item.photographer,
        description: item.description,
        pageUrl: item.pageUrl,
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
    a.href = imageUrl;
    a.download = `art-image-${Date.now()}.${ext}`;
    a.click();
  };

  const activeProviderMeta = PROVIDERS.find((p) => p.value === activeProvider);

  /** 来源短名（全部来源模式下每个结果项标注来源用） */
  const sourceShortLabel = (source: string) => PROVIDERS.find((p) => p.value === source)?.label || source;

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '艺术图片检索'}
      dotColor={NODE_COLORS.art_image_search}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 460, height: 580 }}
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
          {/* 来源选择 + 换一批 */}
          <div className="shrink-0 flex items-center gap-1.5">
            <div className="flex-1 min-w-0">
              <Select
                size="sm"
                value={activeProvider}
                onChange={switchProvider}
                options={visibleProviders.map((p) => ({ value: p.value, label: p.label, title: p.title }))}
              />
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              title="换一批（无关键词时随机浏览该馆藏品）"
              className="flex items-center justify-center w-8 h-8 rounded-md border border-dashed border-paper-grid text-ink-light hover:text-ink hover:bg-paper-grid/40 active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <RefreshCw size={13} strokeWidth={2} className={loadingType === 'refresh' ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* 来源提示 */}
          <p className="shrink-0 text-[10px] font-sans text-ink-faint leading-snug truncate" title={activeProviderMeta?.title}>
            <Landmark size={10} strokeWidth={1.5} className="inline mr-1 -mt-px" />
            {currentCache.sourceLabel || activeProviderMeta?.title || activeProvider}
            {currentCache.total != null && effectiveQuery && currentCache.loaded && (
              <span className="ml-1.5 text-ink-faint/80">· {items.length}/{currentCache.total}</span>
            )}
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
              placeholder={upstreamKeyword.trim() ? `上游关键词：${upstreamKeyword.trim()}` : '搜索作品（留空 = 随机浏览）…'}
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
                  {activeProvider === 'all'
                    ? `正在聚合检索全部博物馆${effectiveQuery ? `：「${effectiveQuery}」` : '（随机）'}…`
                    : effectiveQuery
                      ? `正在检索「${effectiveQuery}」…`
                      : '正在随机浏览馆藏…'}
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
                    {effectiveQuery ? `没有匹配「${effectiveQuery}」的作品` : '暂无作品，点击「换一批」试试'}
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
                    const conciseLabel = (item.description || item.photographer || '作品')
                      .split(/[;,]/)[0]
                      .trim()
                      .slice(0, 30);

                    const tooltipContent = (
                      <div className="flex flex-col gap-1 text-[11px] max-w-[240px]">
                        <div className="font-medium text-ink flex items-center justify-between gap-1.5">
                          <span className="truncate">{item.photographer || '佚名 / 馆藏作品'}</span>
                          <span className="text-[9px] text-ink-faint shrink-0 px-1 py-0.5 rounded border border-dashed border-paper-grid">
                            {sourceShortLabel(item.source)}
                          </span>
                        </div>
                        {item.description && (
                          <div className="text-ink-light text-[10px] leading-snug line-clamp-3">
                            {item.description}
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
                          {/* 全部来源模式：标注该图所属博物馆 */}
                          {activeProvider === 'all' && (
                            <span className="absolute top-1 left-1 px-1 py-px rounded-sm bg-black/45 text-white/90 text-[8px] font-sans backdrop-blur-sm pointer-events-none max-w-[60%] truncate z-10">
                              {sourceShortLabel(item.source)}
                            </span>
                          )}
                          {/* 底部标题：悬停时平滑淡入，保持默认缩略图纯净 */}
                          {item.description && (
                            <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/75 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-10">
                              <p className="text-[9px] text-white/95 truncate font-sans drop-shadow-sm">{item.description}</p>
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
                              disabled={saving}
                              title="选择此作品作为节点输出"
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
              {/* 滚动到底部：关键词检索且还有更多时显示加载更多（追加下一批） */}
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
                    <span>已选择作品</span>
                    {selectedImage?.sourceLabel && (
                      <span className="text-ink-faint text-[10px]">· {selectedImage.sourceLabel}</span>
                    )}
                  </p>
                  <p className="text-[10px] text-ink-faint font-sans truncate" title={selectedImage?.description || selectedImage?.photographer || ''}>
                    {selectedImage?.description
                      ? selectedImage.description
                      : '可作为图片输出给下游节点'}
                  </p>
                </div>
              </>
            ) : (
              <span className="text-[10px] font-sans text-ink-faint flex items-center gap-1">
                <Search size={11} strokeWidth={1.5} />
                悬停缩略图点击「✓」选择作品，可作为图片输出给下游节点
              </span>
            )}
          </div>
        </div>
    </CanvasNode>
  );
};

export const ArtImageSearchNode = memo(ArtImageSearchNodeInner);
ArtImageSearchNode.displayName = 'ArtImageSearchNode';
export default ArtImageSearchNode;
