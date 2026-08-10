import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Globe, Heart, History, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Navbar } from '../../platform/components/layout/Navbar';
import { GenerationCard } from '../../platform/components/gallery/GenerationCard';
import { GenerationDetailPanel } from '../../platform/components/gallery/GenerationDetailPanel';
import { Select } from '../../platform/components/ui/Select';
import { generationsService } from '../../platform/services/generations';
import { useFeedback } from '../../platform/components/ui/FeedbackProvider';
import { useAuth } from '../../platform/stores/authStore';
import {
  broadcastGenerationDeleted,
  getCanvasGenerationIds,
} from '../../platform/stores/useCanvasState';
import { getStartCreationRoute } from '../../platform/utils/creation';
import type { GalleryMode, Generation } from '../../platform/types';

/** 每页条数（后端 limit 上限为 100） */
const PAGE_SIZE = 20;

const MODULE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '全部模块' },
  { value: 'bookplate', label: '藏书票' },
];

const MODE_CONFIG: Record<GalleryMode, { title: string }> = {
  history: { title: '历史记录' },
  favorites: { title: '我的收藏' },
  gallery: { title: '公开画廊' },
};

const MODE_ICON: Record<GalleryMode, React.ReactNode> = {
  history: <History size={20} strokeWidth={1.5} />,
  favorites: <Heart size={20} strokeWidth={1.5} />,
  gallery: <Globe size={20} strokeWidth={1.5} />,
};

/** 加载骨架卡片：与 GenerationCard 同布局，减少内容出现时的跳动 */
const SkeletonCard: React.FC = () => (
  <div className="flex items-center gap-4 px-4 py-4 border-b border-dashed border-paper-grid animate-pulse" aria-hidden="true">
    {/* 缩略图占位 */}
    <div className="w-20 h-20 shrink-0 rounded-sm bg-paper-grid/60" />
    {/* 元数据占位 */}
    <div className="flex-1 min-w-0 space-y-2">
      <div className="h-4 w-2/5 rounded-sm bg-paper-grid/60" />
      <div className="h-3 w-1/4 rounded-sm bg-paper-grid/50" />
      <div className="h-3 w-1/5 rounded-sm bg-paper-grid/40" />
    </div>
    {/* 操作按钮占位 */}
    <div className="flex items-center gap-2 shrink-0">
      <div className="h-6 w-12 rounded-sm bg-paper-grid/40" />
      <div className="h-6 w-12 rounded-sm bg-paper-grid/40" />
      <div className="h-6 w-6 rounded-sm bg-paper-grid/40" />
    </div>
  </div>
);

interface GenerationListPageProps {
  mode: GalleryMode;
}

export const GenerationListPage: React.FC<GenerationListPageProps> = ({ mode }) => {
  const { user } = useAuth();
  const config = MODE_CONFIG[mode];

  const [items, setItems] = useState<Generation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [moduleFilter, setModuleFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isFirstLoad = useRef(true);
  // 记录下一次请求的 offset（删除条目时同步修正，避免加载中删除导致跳项）
  const nextSkipRef = useRef(0);
  const { dialog, showToast } = useFeedback();

  const fetchPage = useCallback(
    async (skip: number, limit: number) => {
      const params: { skip: number; limit: number; module?: string; keyword?: string } = { skip, limit };
      if (moduleFilter) params.module = moduleFilter;
      if (debouncedKeyword) params.keyword = debouncedKeyword;
      if (mode === 'history') return generationsService.listMine(params);
      if (mode === 'favorites') return generationsService.listFavorites(params);
      return generationsService.listPublic(params);
    },
    [mode, moduleFilter, debouncedKeyword]
  );

  /** 首屏加载 / 重试 */
  const load = useCallback(async () => {
    if (isFirstLoad.current) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError('');
    try {
      const res = await fetchPage(0, PAGE_SIZE);
      setItems(res.items);
      setTotal(res.total);
      nextSkipRef.current = res.items.length;
    } catch (e: any) {
      setError(e?.message || '加载失败，请重试');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      isFirstLoad.current = false;
    }
  }, [fetchPage]);
  useEffect(() => {
    load();
  }, [load]);
  /** 关键词防抖：停止输入后才触发检索 */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword), 400);
    return () => clearTimeout(t);
  }, [keyword]);

  /** 滚动触底加载下一页（追加去重） */
  const loadMore = useCallback(async () => {
    if (loading || loadingMore || items.length >= total) return;
    const skip = nextSkipRef.current;
    setLoadingMore(true);
    try {
      const res = await fetchPage(skip, PAGE_SIZE);
      setItems((prev) => {
        const seen = new Set(prev.map((g) => g.id));
        return [...prev, ...res.items.filter((g) => !seen.has(g.id))];
      });
      setTotal(res.total);
      nextSkipRef.current = skip + res.items.length;
    } catch (e: any) {
      showToast(e?.message || '加载更多失败，请重试', { type: 'error' });
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, loading, loadingMore, items.length, total, showToast]);

  /** 哨兵是否接近视口底部 */
  const sentinelNearViewport = useCallback(() => {
    const el = sentinelRef.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.top <= window.innerHeight + 300;
  }, []);

  const maybeLoadMore = useCallback(() => {
    if (loading || loadingMore || items.length >= total) return;
    if (sentinelNearViewport()) loadMore();
  }, [loading, loadingMore, items.length, total, sentinelNearViewport, loadMore]);

  // 窗口滚动触发加载
  useEffect(() => {
    window.addEventListener('scroll', maybeLoadMore, { passive: true });
    return () => window.removeEventListener('scroll', maybeLoadMore);
  }, [maybeLoadMore]);

  // 自愈：状态变化（如删除后 hasMore 重新为真）时若哨兵仍在视口内则继续加载
  useEffect(() => {
    maybeLoadMore();
  }, [items.length, total, maybeLoadMore]);

  /** 用接口返回的最新记录更新列表（并按当前模式过滤不可见项） */
  const applyUpdated = (updated: Generation) => {
    // 收藏页取消收藏 / 画廊撤下公开后，条目不再属于当前列表
    const invisible =
      (mode === 'favorites' && !updated.is_favorited) ||
      (mode === 'gallery' && !updated.is_public);
    if (invisible) {
      removeItem(updated.id);
      return;
    }
    setItems((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
  };

  /** 从列表移除一条并同步总数与下一次请求 offset */
  const removeItem = (id: number) => {
    setItems((prev) => prev.filter((g) => g.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    nextSkipRef.current = Math.max(0, nextSkipRef.current - 1);
  };

  /** 该记录是否仍被画布中的图片节点引用（读 sessionStorage 画布快照，与画板页面同一 key） */
  const isReferencedOnCanvas = useCallback(
    (genId: number) => {
      const map = getCanvasGenerationIds(String(user?.id ?? 'anon'));
      return Object.values(map).includes(genId);
    },
    [user?.id]
  );

  /** 各操作 handler 返回是否成功，供详情面板区分成功/失败提示 */
  const handleToggleFavorite = async (gen: Generation): Promise<boolean> => {
    try {
      const updated = gen.is_favorited
        ? await generationsService.unfavorite(gen.id)
        : await generationsService.favorite(gen.id);
      applyUpdated(updated);
      showToast(gen.is_favorited ? '已取消收藏' : '已收藏', { type: 'success' });
      return true;
    } catch (e: any) {
      showToast(e?.message || '操作失败，请重试', { type: 'error' });
      return false;
    }
  };

  const handleTogglePublic = async (gen: Generation): Promise<boolean> => {
    try {
      const updated = gen.is_public
        ? await generationsService.unshare(gen.id)
        : await generationsService.share(gen.id);
      applyUpdated(updated);
      showToast(gen.is_public ? '已从画廊撤下' : '已公开到画廊', { type: 'success' });
      return true;
    } catch (e: any) {
      showToast(e?.message || '操作失败，请重试', { type: 'error' });
      return false;
    }
  };

  const handleRemoveGeneration = async (gen: Generation): Promise<boolean> => {
    const onCanvas = isReferencedOnCanvas(gen.id);
    const ok = await dialog.confirm({
      title: '删除记录',
      message: onCanvas
        ? '该作品在画布上仍有对应的图片节点。删除历史记录只会移除这条记录，画布节点及其图片会保留（可继续收藏/导出），是否继续？'
        : '确定删除这条记录吗？删除后不可恢复。',
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return false;
    try {
      await generationsService.remove(gen.id);
      removeItem(gen.id);
      if (selectedId === gen.id) setSelectedId(null);
      // 跨 tab 广播：通知打开中的画布 tab 实时清理该记录的失效映射
      broadcastGenerationDeleted(String(user?.id ?? 'anon'), gen.id);
      showToast('记录已删除', { type: 'success' });
      return true;
    } catch (e: any) {
      showToast(e?.message || '删除失败，请重试', { type: 'error' });
      return false;
    }
  };

  /** 收藏页的「删除」语义为取消收藏 */
  const handleRemoveFromFavorites = async (gen: Generation): Promise<boolean> => {
    if (!gen.is_favorited) return false;
    try {
      const updated = await generationsService.unfavorite(gen.id);
      applyUpdated(updated);
      if (selectedId === gen.id) setSelectedId(null);
      showToast('已取消收藏', { type: 'success' });
      return true;
    } catch (e: any) {
      showToast(e?.message || '操作失败，请重试', { type: 'error' });
      return false;
    }
  };

  const selected = items.find((g) => g.id === selectedId) ?? null;
  const selectedIndex = selectedId ? items.findIndex((g) => g.id === selectedId) : -1;
  
  const hasPrev = selectedIndex > 0;
  const hasNext = selectedIndex !== -1 && selectedIndex < items.length - 1;

  const handlePrev = useCallback(() => {
    if (hasPrev) setSelectedId(items[selectedIndex - 1].id);
  }, [hasPrev, items, selectedIndex]);

  const handleNext = useCallback(() => {
    if (hasNext) setSelectedId(items[selectedIndex + 1].id);
  }, [hasNext, items, selectedIndex]);

  const canManage = (gen: Generation) =>
    mode === 'history' ||
    (mode === 'favorites' && gen.username === user?.username) ||
    (mode === 'gallery' && gen.username === user?.username);

  const hasMore = items.length < total;

  const emptyState = {
    history: {
      icon: <BookOpen size={40} strokeWidth={1} className="text-ink-faint" />,
      title: '还没有历史记录',
      desc: '去创作并保存第一件作品吧',
      cta: '开始创作',
      to: getStartCreationRoute(),
    },
    favorites: {
      icon: <Heart size={40} strokeWidth={1} className="text-ink-faint" />,
      title: '还没有收藏',
      desc: '在画廊或创作页面点击「收藏」即可收藏作品',
      cta: '去画廊看看',
      to: '/gallery',
    },
    gallery: {
      icon: <Globe size={40} strokeWidth={1} className="text-ink-faint" />,
      title: '画廊还空着',
      desc: '创作后点击「公开」即可分享你的作品',
      cta: '开始创作',
      to: getStartCreationRoute(),
    },
  }[mode];

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      {/* 方格纸背景 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(#E4E1DA 1px, transparent 1px), linear-gradient(90deg, #E4E1DA 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          opacity: 0.25,
        }}
      />

      <div className="relative z-10 flex flex-col min-h-screen">
        <Navbar />

        <main className="flex-1 w-full max-w-[960px] mx-auto px-4 sm:px-6 py-8">
          {/* 页头 */}
          <header className="flex items-center gap-3 mb-6">
            <span className="text-accent">{MODE_ICON[mode]}</span>
            <div>
              <h1 className="font-serif text-2xl font-bold text-ink">{config.title}</h1>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="relative">
                <Search size={14} strokeWidth={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索题名…"
                  className="h-8 w-44 rounded-md border border-dashed border-paper-grid bg-transparent pl-7 pr-7 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
                />
                {keyword && (
                  <button
                    onClick={() => setKeyword('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-light transition-colors"
                  >
                    <X size={14} strokeWidth={1.5} />
                  </button>
                )}
              </div>
                <Select
                  value={moduleFilter}
                  onChange={(val) => setModuleFilter(val)}
                  options={MODULE_OPTIONS}
                  size="sm"
                  className="min-w-[96px]"
                />
              {!loading && !error && (
                <span className="text-xs text-ink-faint font-sans tabular-nums">
                  共 {total} 条
                </span>
              )}
            </div>
          </header>

          {/* 加载态：骨架屏（与真实列表同容器样式） */}
          {(loading || (isRefreshing && items.length === 0)) && (
            <div
              role="status"
              className="bg-node-bg border border-dashed border-paper-grid rounded-lg overflow-hidden shadow-[0_2px_8px_rgba(43,41,38,0.06)]"
            >
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <span className="sr-only">加载中...</span>
            </div>
          )}

          {/* 错误态 */}
          {!loading && error && (
            <div className="py-20 flex flex-col items-center gap-4">
              <span className="text-sm text-error font-sans">{error}</span>
              <button
                onClick={load}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 border border-dashed border-accent text-accent text-sm font-serif rounded-sm hover:bg-accent-surface active:scale-[0.97] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <RefreshCw size={14} strokeWidth={1.5} />
                重试
              </button>
            </div>
          )}

          {/* 空态 */}
          {!loading && !error && items.length === 0 && !isRefreshing && (
            <div className="py-20 flex flex-col items-center gap-4 text-center">
              {emptyState.icon}
              <div>
                <p className="font-serif text-lg text-ink">{emptyState.title}</p>
                <p className="text-sm text-ink-light font-sans mt-1">{emptyState.desc}</p>
              </div>
              <Link
                to={emptyState.to}
                className="px-5 py-2 bg-accent text-paper text-sm font-serif rounded-md hover:bg-accent-hover active:scale-[0.97] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {emptyState.cta}
              </Link>
            </div>
          )}

          {/* 列表 + 无限滚动 */}
          {!loading && !error && items.length > 0 && (
            <div className="relative bg-node-bg border border-dashed border-paper-grid rounded-lg overflow-hidden shadow-[0_2px_8px_rgba(43,41,38,0.06)]">
              {isRefreshing && (
                <div className="absolute inset-0 z-10 bg-paper/40 backdrop-blur-[1px] transition-opacity">
                  <div className="sticky top-[30vh] left-1/2 -translate-x-1/2 w-fit bg-paper shadow-[0_4px_16px_rgba(43,41,38,0.12)] p-2.5 rounded-full text-accent">
                    <Loader2 className="w-5 h-5 animate-spin" strokeWidth={2} />
                  </div>
                </div>
              )}
              <AnimatePresence initial={false}>
                {items.map((gen) => {
                  const manage = canManage(gen);
                  return (
                    <motion.div
                      key={gen.id}
                      layout="position"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ opacity: { duration: 0.2 }, layout: { duration: 0.2 } }}
                      className="overflow-hidden"
                    >
                      <GenerationCard
                        gen={gen}
                        active={gen.id === selectedId}
                        onOpen={() => setSelectedId(gen.id)}
                        onToggleFavorite={() => handleToggleFavorite(gen)}
                        onTogglePublic={manage ? () => handleTogglePublic(gen) : undefined}
                        onRemove={
                          mode === 'history'
                            ? () => handleRemoveGeneration(gen)
                            : mode === 'favorites'
                              ? undefined
                              : manage
                                ? () => handleRemoveGeneration(gen)
                                : undefined
                        }
                        removeTitle={mode === 'favorites' ? '取消收藏' : '删除记录'}
                      />
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {/* 触底哨兵：滚动到此处自动加载下一页 */}
              <div ref={sentinelRef} className="py-5 flex items-center justify-center gap-2 text-xs text-ink-faint font-sans">
                {loadingMore ? (
                  <>
                    <Loader2 className="w-4 h-4 text-accent animate-spin" strokeWidth={1.5} />
                    加载中...
                  </>
                ) : hasMore ? (
                  <span>下拉加载更多</span>
                ) : (
                  <span>— 没有更多了 —</span>
                )}
              </div>
            </div>
          )}

          {/* 详情面板 */}
          <GenerationDetailPanel
            gen={selected}
            onClose={() => setSelectedId(null)}
            onToggleFavorite={handleToggleFavorite}
            onTogglePublic={handleTogglePublic}
            onRemove={
              mode === 'favorites'
                ? handleRemoveFromFavorites
                : handleRemoveGeneration
            }
            canManage={selected ? canManage(selected) : true}
            canRemove={selected ? mode !== 'favorites' && canManage(selected) : true}
            removeTitle={mode === 'favorites' ? '取消收藏' : '删除记录'}
            hasPrev={hasPrev}
            hasNext={hasNext}
            onPrev={handlePrev}
            onNext={handleNext}
          />
        </main>
      </div>

    </div>
  );
};

export default GenerationListPage;
