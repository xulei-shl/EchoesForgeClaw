import React from 'react';
import { BookOpen, Globe, Heart, History, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Navbar } from '../../shared/components/layout/Navbar';
import { GenerationCard } from '../../library/gallery/GenerationCard';
import { GenerationGridCard } from '../../library/gallery/GenerationGridCard';
import { GenerationDetailPanel } from '../../library/gallery/GenerationDetailPanel';
import { useGenerationList } from '../../library/gallery/useGenerationList';
import { EmptyState } from '../../shared/components/ui/EmptyState';
import { ViewToggle } from '../../shared/components/ui/ViewToggle';
import { Select } from '../../shared/components/ui/Select';
import { getStartCreationRoute } from '../../shared/utils/creation';
import { generationNodeTypeLabel } from '../../shared/utils/generation';
import type { GalleryMode } from '../../shared/types';

const MODE_CONFIG: Record<GalleryMode, { title: string }> = {
  history: { title: '历史记录' },
  favorites: { title: '我的收藏' },
  gallery: { title: '公开画廊' },
};

const MODE_ICON: Record<GalleryMode, React.ReactNode> = {
  history: <History size={20} strokeWidth={1.75} />,
  favorites: <Heart size={20} strokeWidth={1.75} />,
  gallery: <Globe size={20} strokeWidth={1.75} />,
};

/** 骨架卡片 */
const SkeletonCard: React.FC<{ mode: 'grid' | 'list' }> = ({ mode }) => {
  if (mode === 'grid') {
    return (
      <div className="rounded-lg bg-node-bg border border-paper-grid/50 overflow-hidden animate-pulse">
        <div className="aspect-[4/3] bg-paper-grid/40" />
        <div className="p-3.5 space-y-2">
          <div className="h-4 w-3/5 rounded bg-paper-grid/50" />
          <div className="h-3 w-2/5 rounded bg-paper-grid/30" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3.5 border-b border-paper-grid/40 animate-pulse">
      <div className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-md bg-paper-grid/40" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-4 w-2/5 rounded bg-paper-grid/50" />
        <div className="h-3 w-1/4 rounded bg-paper-grid/30" />
        <div className="h-3 w-1/5 rounded bg-paper-grid/30" />
      </div>
    </div>
  );
};

interface GenerationListPageProps {
  mode: GalleryMode;
}

export const GalleryPage: React.FC<GenerationListPageProps> = ({ mode }) => {
  const config = MODE_CONFIG[mode];
  const {
    items,
    total,
    loading,
    isRefreshing,
    loadingMore,
    error,
    selected,
    selectedId,
    setSelectedId,
    keyword,
    setKeyword,
    nodeType,
    nodeTypeCounts,
    handleTypeChange,
    viewMode,
    handleViewModeChange,
    sentinelRef,
    load,
    hasMore,
    hasFilter,
    clearFilter,
    hasPrev,
    hasNext,
    handlePrev,
    handleNext,
    canManage,
    handleToggleFavorite,
    handleTogglePublic,
    handleRemoveGeneration,
    handleRemoveFromFavorites,
    handleOpenInCanvas,
  } = useGenerationList({ mode });

  const emptyStateConfig = {
    history: {
      icon: <BookOpen size={44} strokeWidth={1.2} />,
      title: '还没有历史记录',
      desc: '去创作并保存第一件属于你的水墨或图书作品吧',
      cta: '开始创作',
      to: getStartCreationRoute(),
    },
    favorites: {
      icon: <Heart size={44} strokeWidth={1.2} />,
      title: '还没有收藏',
      desc: '在画廊或历史记录中点击「收藏」，留存你的心仪作品',
      cta: '去画廊看看',
      to: '/gallery',
    },
    gallery: {
      icon: <Globe size={44} strokeWidth={1.2} />,
      title: '画廊还空着',
      desc: '创作作品后点击「公开」，与大家分享你的灵感',
      cta: '开始创作',
      to: getStartCreationRoute(),
    },
  }[mode];

  return (
    <div className="min-h-screen bg-paper flex flex-col selection:bg-accent/20">
      {/* 宣纸方格背景 */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(#E4E1DA 1px, transparent 1px), linear-gradient(90deg, #E4E1DA 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          opacity: 0.2,
        }}
      />

      <div className="relative z-10 flex flex-col min-h-screen">
        <Navbar />

        <main className="flex-1 w-full max-w-[1040px] mx-auto px-4 sm:px-6 py-7">
          {/* 页头导航栏与工具条 */}
          <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-2.5">
              <span className="text-accent p-1.5 rounded-lg bg-accent/10">{MODE_ICON[mode]}</span>
              <h1 className="font-serif text-2xl font-bold text-ink">{config.title}</h1>
              {!loading && !error && (
                <span className="ml-1 text-xs text-ink-faint font-sans tabular-nums px-2 py-0.5 bg-paper-grid/30 rounded-full">
                  共 {total} 条
                </span>
              )}
            </div>

            {/* 检索、筛选与视图控制 */}
            <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
              {/* 类型选择 */}
              <Select
                size="sm"
                value={nodeType}
                onChange={handleTypeChange}
                className="w-32 sm:w-36"
                options={[
                  { label: '全部类型', value: '' },
                  ...[...nodeTypeCounts]
                    .sort((a, b) =>
                      generationNodeTypeLabel(a.node_type).localeCompare(
                        generationNodeTypeLabel(b.node_type),
                        'zh'
                      )
                    )
                    .map((t) => ({
                      label: `${generationNodeTypeLabel(t.node_type)}（${t.count}）`,
                      value: t.node_type,
                    })),
                ]}
              />

              {/* 搜索框 */}
              <div className="relative flex-1 sm:w-48">
                <Search
                  size={14}
                  strokeWidth={1.75}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
                />
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索题名…"
                  className="h-8 w-full rounded-md border border-paper-grid/80 bg-paper/80 pl-7 pr-7 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
                />
                {keyword && (
                  <button
                    type="button"
                    onClick={() => setKeyword('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink transition-colors p-0.5"
                  >
                    <X size={13} strokeWidth={2} />
                  </button>
                )}
              </div>

              {/* 视图模式切换 */}
              <ViewToggle mode={viewMode} onChange={handleViewModeChange} />
            </div>
          </header>

          {/* 首屏骨架屏 */}
          {(loading || (isRefreshing && items.length === 0)) && (
            <div
              className={
                viewMode === 'grid'
                  ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'
                  : 'bg-node-bg border border-paper-grid/70 rounded-lg overflow-hidden shadow-sm'
              }
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonCard key={i} mode={viewMode} />
              ))}
            </div>
          )}

          {/* 错误态 */}
          {!loading && error && (
            <div className="py-20 flex flex-col items-center gap-4">
              <span className="text-sm text-error font-sans">{error}</span>
              <button
                type="button"
                onClick={load}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 border border-accent text-accent text-sm font-serif rounded-md hover:bg-accent-surface active:scale-[0.96] transition-all"
              >
                <RefreshCw size={14} strokeWidth={1.5} />
                重试
              </button>
            </div>
          )}

          {/* 空态 */}
          {!loading && !error && items.length === 0 && !isRefreshing && (
            hasFilter ? (
              <EmptyState
                icon={<Search size={44} strokeWidth={1.2} />}
                title="没有符合条件的记录"
                description="试试更换搜索关键词或选择「全部类型」筛选"
                action={{
                  label: '清除筛选',
                  onClick: clearFilter,
                }}
              />
            ) : (
              <EmptyState
                icon={emptyStateConfig.icon}
                title={emptyStateConfig.title}
                description={emptyStateConfig.desc}
                action={{
                  label: emptyStateConfig.cta,
                  to: emptyStateConfig.to,
                }}
              />
            )
          )}

          {/* 列表/网格内容区 */}
          {!loading && !error && items.length > 0 && (
            <div className="relative">
              {/* 后台刷新蒙层 */}
              {isRefreshing && (
                <div className="absolute inset-0 z-10 bg-paper/30 backdrop-blur-[1px] rounded-lg transition-opacity flex justify-center">
                  <div className="sticky top-[30vh] h-fit bg-paper shadow-md p-2 rounded-full text-accent border border-paper-grid">
                    <Loader2 className="w-5 h-5 animate-spin" strokeWidth={2} />
                  </div>
                </div>
              )}

              {/* 网格视图 */}
              {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <AnimatePresence initial={false}>
                    {items.map((gen) => {
                      const manage = canManage(gen);
                      return (
                        <motion.div
                          key={gen.id}
                          layout="position"
                          initial={{ opacity: 0, scale: 0.98 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          transition={{ duration: 0.2 }}
                        >
                          <GenerationGridCard
                            gen={gen}
                            active={gen.id === selectedId}
                            onOpen={() => setSelectedId(gen.id)}
                            onToggleFavorite={() => handleToggleFavorite(gen)}
                            onTogglePublic={manage ? () => handleTogglePublic(gen) : undefined}
                            onOpenInCanvas={() => handleOpenInCanvas(gen)}
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
                </div>
              ) : (
                /* 列表视图 */
                <div className="bg-node-bg border border-paper-grid/70 rounded-lg overflow-hidden shadow-sm">
                  <AnimatePresence initial={false}>
                    {items.map((gen) => {
                      const manage = canManage(gen);
                      return (
                        <motion.div
                          key={gen.id}
                          layout="position"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <GenerationCard
                            gen={gen}
                            active={gen.id === selectedId}
                            onOpen={() => setSelectedId(gen.id)}
                            onToggleFavorite={() => handleToggleFavorite(gen)}
                            onTogglePublic={manage ? () => handleTogglePublic(gen) : undefined}
                            onOpenInCanvas={() => handleOpenInCanvas(gen)}
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
                </div>
              )}

              {/* 触底加载哨兵 */}
              <div
                ref={sentinelRef}
                className="py-8 flex items-center justify-center gap-2 text-xs text-ink-faint font-sans"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="w-4 h-4 text-accent animate-spin" strokeWidth={1.5} />
                    加载中...
                  </>
                ) : hasMore ? (
                  <span>向下滑动加载更多</span>
                ) : (
                  <span>— 已展示全部作品 —</span>
                )}
              </div>
            </div>
          )}

          {/* 详情抽屉面板 */}
          <GenerationDetailPanel
            gen={selected}
            onClose={() => setSelectedId(null)}
            onToggleFavorite={handleToggleFavorite}
            onTogglePublic={handleTogglePublic}
            onOpenInCanvas={handleOpenInCanvas}
            onRemove={
              mode === 'favorites' ? handleRemoveFromFavorites : handleRemoveGeneration
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

export default GalleryPage;
