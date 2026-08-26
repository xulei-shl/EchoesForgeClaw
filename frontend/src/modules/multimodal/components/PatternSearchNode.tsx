import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Check, ImageOff, Loader2, RefreshCw, Search, X } from 'lucide-react';
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

/** 纹样单项数据结构 */
export interface PatternItem {
  id: string;
  name_cn: string;
  name_en: string;
  category: string;
  summary: string;
  meaning: string;
  visual_keywords: string[];
  batch?: string;
  card_image?: string;
  full_image_url: string;
  thumb_url: string;
  preview_url: string;
  detail_page?: string;
  image_size?: string;
  source_note?: string;
}

/** 选中纹样元数据 */
export interface PatternSelection {
  id: string;
  name_cn: string;
  name_en: string;
  category: string;
  summary: string;
  meaning: string;
  visual_keywords?: string[];
  full_image_url: string;
}

export interface PatternSearchNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 已选纹样图片本地 URL（node.data.imageUrl，对外图片输出） */
  imageUrl?: string | null;
  /** 已选纹样元数据 */
  selectedPattern?: PatternSelection | null;
  /** 选中的分类（持久化在 node.data.category） */
  category?: string;
  /** 连线上级文本（连线即输入：优先作为检索关键词） */
  upstreamKeyword?: string;
  /** 页面级错误 */
  error?: string | null;
  /** 选中一个纹样：下载图片并返回详情文本写回 node.data（失败抛错） */
  onSelectPattern?: (id: string, pattern: PatternItem) => Promise<void>;
  /** 编辑器状态写入 node.data（category 等；undoable=false 仅持久化不记撤销历史） */
  onUpdateEditor?: (id: string, patch: Record<string, any>, undoable: boolean) => void;
  onRemove?: (id: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  hasDownstream?: boolean;
}

const PER_PAGE_RANDOM = 24;
const PER_PAGE_ALL = 100;

/** 内置默认传统纹样分类（静态兜底 + 数量标注） */
export const DEFAULT_PATTERN_CATEGORIES: { name: string; count: number }[] = [
  { name: '植物花卉纹', count: 20 },
  { name: '动物瑞兽纹', count: 20 },
  { name: '几何锦纹', count: 20 },
  { name: '云水山石纹', count: 15 },
  { name: '吉祥器物纹', count: 15 },
  { name: '文字福寿与组合纹', count: 10 },
];

const PatternSearchNodeInner: React.FC<PatternSearchNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  imageUrl = null,
  selectedPattern = null,
  category = '',
  upstreamKeyword = '',
  error = null,
  onSelectPattern,
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

  // 分类列表状态（默认使用内置分类兜底，无需等待接口返回即可显示全部 6 大类别）
  const [categories, setCategories] = useState<string[]>(
    DEFAULT_PATTERN_CATEGORIES.map((c) => c.name)
  );
  const [activeCategory, setActiveCategory] = useState<string>(category);

  // 检索输入与状态
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<PatternItem[]>([]);
  const [, setTotal] = useState<number>(0);
  const [loadingType, setLoadingType] = useState<'search' | 'refresh' | 'auto' | null>(null);
  const loading = loadingType !== null;
  const [searchError, setSearchError] = useState<string>('');
  const [savingId, setSavingId] = useState<string | null>(null);

  /** 请求序号：防并发竞争 */
  const requestSeq = useRef(0);
  const prevUpstreamRef = useRef(upstreamKeyword);

  /** 生效关键词：连线上级文本优先，其次当前手动输入 */
  const effectiveQuery = upstreamKeyword.trim() || query.trim();

  // 1. 获取分类列表
  useEffect(() => {
    let unmounted = false;
    async function fetchCategories() {
      try {
        const res: any = await api.get('/modules/bookplate/pattern-search/categories', {
          timeout: SMALL_TOOL_TIMEOUT_MS,
        });
        if (!unmounted && Array.isArray(res?.categories)) {
          setCategories(res.categories);
        }
      } catch (e) {
        console.error('Failed to fetch pattern categories:', e);
      }
    }
    void fetchCategories();
    return () => {
      unmounted = true;
    };
  }, []);

  // 2. 加载纹样数据
  const load = useCallback(
    async (
      cat: string,
      queryText: string,
      type: 'search' | 'refresh' | 'auto' = 'auto',
      isRandom = false
    ) => {
      const seq = ++requestSeq.current;
      setLoadingType(type);
      setSearchError('');

      const hasFilter = Boolean(cat || queryText);
      const effectivePerPage = isRandom && !hasFilter ? PER_PAGE_RANDOM : PER_PAGE_ALL;

      try {
        const res: { items?: PatternItem[]; total?: number } = await api.post(
          '/modules/bookplate/pattern-search',
          {
            category: cat || null,
            query: queryText || null,
            page: 1,
            per_page: effectivePerPage,
            random: isRandom,
          },
          { timeout: SMALL_TOOL_TIMEOUT_MS }
        );

        if (seq !== requestSeq.current) return;
        const list = Array.isArray(res.items) ? res.items : [];
        setItems(list);
        setTotal(typeof res.total === 'number' ? res.total : list.length);
        setSearchError('');
      } catch (e: any) {
        if (seq !== requestSeq.current) return;
        setSearchError(e?.detail || e?.message || '纹样检索失败，请重试');
        setItems([]);
        setTotal(0);
      } finally {
        if (seq === requestSeq.current) setLoadingType(null);
      }
    },
    []
  );

  // 外部恢复同步
  useEffect(() => {
    if (category !== activeCategory) {
      setActiveCategory(category);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  // 挂载初次加载（随机 24 款）
  useEffect(() => {
    void load(activeCategory, effectiveQuery, 'auto', !effectiveQuery && !activeCategory);
  }, [activeCategory, effectiveQuery, load]);

  // 上游关键词变化响应
  useEffect(() => {
    if (prevUpstreamRef.current !== upstreamKeyword) {
      prevUpstreamRef.current = upstreamKeyword;
      void load(activeCategory, upstreamKeyword.trim() || query.trim(), 'auto', false);
    }
  }, [upstreamKeyword, activeCategory, query, load]);

  const handleCategoryChange = (cat: string) => {
    setActiveCategory(cat);
    onUpdateEditor?.(id, { category: cat }, false);
    void load(cat, effectiveQuery, 'search', !effectiveQuery && !cat);
  };

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    void load(activeCategory, effectiveQuery, 'search', false);
  };

  const handleRefresh = () => {
    if (loading) return;
    void load(activeCategory, effectiveQuery, 'refresh', true);
  };

  /** 仅当已选图且有下游连线时才锁定，未选图时始终允许用户选择 */
  const isLocked = Boolean(hasDownstream && imageUrl);

  const handleSelect = async (item: PatternItem) => {
    if (isLocked || savingId) return;
    setSavingId(item.id);
    try {
      await onSelectPattern?.(id, item);
      showToast(`已选择纹样「${item.name_cn}」，图片与说明已输出给下游节点`, {
        type: 'success',
      });
    } catch {
      // handler 会设置 error 并展示
    } finally {
      setSavingId(null);
    }
  };

  const handleDownload = () => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    const ext = imageUrl.split('.').pop()?.split('?')[0]?.toLowerCase() || 'png';
    const patternName = selectedPattern?.name_cn || 'pattern';
    a.href = imageUrl;
    a.download = `chinese-pattern-${patternName}-${Date.now()}.${ext}`;
    a.click();
  };

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '中国传统纹样'}
      dotColor={NODE_COLORS.pattern_search}
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
            <NodeActionBar.Download tooltip="下载已选纹样图片" onClick={handleDownload} />
          )}
        </NodeActionBar>
      }
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
          {/* 分类下拉/选择 + 换一批 */}
          <div className="shrink-0 flex items-center gap-1.5">
            <Select
              size="sm"
              value={activeCategory}
              onChange={handleCategoryChange}
              options={[
                { value: '', label: '全部类别 (100 款)' },
                ...categories.map((cat) => {
                  const meta = DEFAULT_PATTERN_CATEGORIES.find((c) => c.name === cat);
                  return { value: cat, label: meta ? `${cat} (${meta.count} 款)` : cat };
                }),
              ]}
              className="flex-1 min-w-0"
            />

            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              title="换一批随机纹样"
              className="flex items-center justify-center w-8 h-8 rounded-md border border-dashed border-paper-grid text-ink-light hover:text-ink hover:bg-paper-grid/40 active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <RefreshCw
                size={13}
                strokeWidth={2}
                className={loadingType === 'refresh' ? 'animate-spin' : ''}
              />
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
              placeholder={
                upstreamKeyword.trim()
                  ? `上游关键词：${upstreamKeyword.trim()}`
                  : '搜索纹样名称、题材、寓意（如：莲花、龙、回纹）…'
              }
              className="w-full h-8 rounded-md border border-dashed border-paper-grid bg-transparent pl-8 pr-16 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-sans"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  void load(activeCategory, '', 'search', !activeCategory);
                }}
                className="absolute right-9 top-1/2 -translate-y-1/2 p-0.5 rounded text-ink-faint hover:text-error hover:bg-paper-grid/40 active:scale-[0.96] transition-all"
                title="清除"
              >
                <X size={13} strokeWidth={2} />
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              className="absolute right-1 top-1/2 -translate-y-1/2 px-2 h-6 rounded text-xs text-ink-light hover:text-ink hover:bg-paper-grid/40 active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title="检索"
            >
              {loadingType === 'search' ? (
                <Loader2 size={12} strokeWidth={2} className="animate-spin" />
              ) : (
                '检索'
              )}
            </button>
          </form>

          {/* 结果网格 / 加载 / 错误 */}
          <div className="relative flex-1 min-h-0">
            {loading && items.length === 0 && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-center">
                <Loader2 size={20} strokeWidth={1.5} className="text-accent animate-spin" />
                <p className="text-xs font-serif text-ink-light">正在检索中国传统纹样…</p>
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
                    {effectiveQuery ? `未找到关于「${effectiveQuery}」的传统纹样` : '暂无纹样数据'}
                  </p>
                </div>
              )}
              {items.length > 0 && (
                <div className="grid grid-cols-3 gap-1.5 pb-1">
                  {items.map((item) => {
                    const saving = savingId === item.id;
                    const isSelected = !!(
                      (selectedPattern &&
                        (selectedPattern.id === item.id ||
                          selectedPattern.full_image_url === item.full_image_url)) ||
                      (imageUrl &&
                        (imageUrl.includes(`pattern_${item.id}`) ||
                          (item.card_image && imageUrl.includes(item.card_image.split('/').pop() || ''))))
                    );

                    const tooltipContent = (
                      <div className="flex flex-col gap-1 text-[11px] max-w-[240px]">
                        <div className="font-medium text-ink flex items-center justify-between gap-1 border-b border-paper-grid/50 pb-1">
                          <span className="text-accent">{item.name_cn}</span>
                          <span className="text-[10px] text-ink-faint">{item.category}</span>
                        </div>
                        {item.meaning && (
                          <div className="text-ink-light text-[10px]">
                            <span className="text-ink-faint mr-1 font-medium">寓意:</span>
                            <span>{item.meaning}</span>
                          </div>
                        )}
                        {item.summary && (
                          <div className="text-ink-light text-[10px] leading-snug line-clamp-3">
                            <span className="text-ink-faint mr-1 font-medium">简介:</span>
                            <span>{item.summary}</span>
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
                            thumbUrl={item.thumb_url}
                            previewUrl={item.preview_url}
                            alt={item.name_cn}
                          />
                          {/* 底部纹样名称与分类标签 */}
                          <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/80 via-black/45 to-transparent opacity-90 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-10">
                            <p className="text-[9px] text-white/95 truncate font-serif drop-shadow-sm font-medium">
                              {item.name_cn}
                            </p>
                          </div>
                          {/* 选择 / 已选 按钮 */}
                          {isSelected ? (
                            <div
                              title="当前已选为此纹样输出"
                              className="absolute top-1 right-1 px-1.5 h-5 rounded-full flex items-center gap-0.5 bg-accent text-paper text-[10px] font-sans font-medium shadow-sm pointer-events-none z-10"
                            >
                              <Check size={11} strokeWidth={2.5} />
                              <span>已选</span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleSelect(item)}
                              disabled={saving || isLocked}
                              title={
                                isLocked
                                  ? '有下级节点，不可更换输出（需先断开连线）'
                                  : '选择此纹样作为节点输出'
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
            </div>
          </div>

          {/* 页面级错误 */}
          {error && (
            <div className="shrink-0 px-2.5 py-1.5 rounded-md border border-error/20 bg-error/5 text-[11px] text-error break-words">
              {error}
            </div>
          )}

          {/* 已选纹样（对外输出展示） */}
          <div className="shrink-0 flex items-center gap-2.5 pt-2 border-t border-dashed border-paper-grid">
            {imageUrl ? (
              <>
                <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
                  <PhotoView src={imageUrl}>
                    <Tooltip content="点击查看纹样高清大图">
                      <img
                        src={imageUrl}
                        alt={selectedPattern?.name_cn || '已选纹样'}
                        referrerPolicy="no-referrer"
                        decoding="async"
                        className="h-12 w-12 rounded-md border border-paper-grid object-cover cursor-zoom-in hover:opacity-90 transition-opacity shrink-0"
                      />
                    </Tooltip>
                  </PhotoView>
                </PhotoProvider>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-serif text-ink truncate flex items-center gap-1.5">
                    <span className="font-medium text-accent">{selectedPattern?.name_cn || '已选择纹样'}</span>
                    {selectedPattern?.category && (
                      <span className="text-[10px] text-ink-faint">
                        · {selectedPattern.category}
                      </span>
                    )}
                    {hasDownstream && (
                      <span className="text-[9px] font-sans px-1 py-0.5 rounded border border-dashed border-paper-grid text-ink-faint">
                        输出已连接
                      </span>
                    )}
                  </p>
                  <p
                    className="text-[10px] text-ink-faint font-sans truncate"
                    title={selectedPattern?.summary || selectedPattern?.meaning || ''}
                  >
                    {(() => {
                      if (selectedPattern?.meaning) {
                        return `寓意：${selectedPattern.meaning}`;
                      }
                      if (selectedPattern?.summary) {
                        return selectedPattern.summary;
                      }
                      if (hasDownstream) {
                        return '输出已连接到下游节点，如需更换请先断开连线';
                      }
                      return '已输出纹样图片与详情说明文本';
                    })()}
                  </p>
                </div>
              </>
            ) : (
              <span className="text-[10px] font-sans text-ink-faint flex items-center gap-1">
                <Search size={11} strokeWidth={1.5} />
                悬停缩略图点击「✓」选择纹样，图片与说明文本将输出给下游节点
              </span>
            )}
          </div>
        </div>
    </CanvasNode>
  );
};

export const PatternSearchNode = memo(PatternSearchNodeInner);
PatternSearchNode.displayName = 'PatternSearchNode';
export default PatternSearchNode;
