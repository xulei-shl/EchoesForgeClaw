import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Copy,
  ImageOff,
  Loader2,
  Maximize2,
  PlusCircle,
  RefreshCw,
  Search,
  StickyNote,
} from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { Navbar } from '../../shared/components/layout/Navbar';
import type { BifrostPrompt } from '../../shared/types';
import { Button } from '../../shared/components/ui/Button';
import { Input } from '../../shared/components/ui/Input';
import { Select } from '../../shared/components/ui/Select';
import { Drawer } from '../../shared/components/ui/Drawer';
import { Card } from '../../shared/components/ui/Card';
import { Badge } from '../../shared/components/ui/Badge';
import { RatingStars } from '../../shared/components/ui/RatingStars';
import { NoteEditModal } from '../../shared/components/ui/NoteEditModal';
import { MarkdownViewer } from '../../shared/components/ui/MarkdownViewer';
import { useFeedback } from '../../shared/components/ui/FeedbackProvider';
import { ViewToggle, type ViewMode } from '../../shared/components/ui/ViewToggle';
import { useBifrostPrompts } from './useBifrostPrompts';
import { copyTextToClipboard } from '../../shared/utils/clipboard';

export const BifrostPromptsPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useFeedback();

  const {
    folders,
    items: prompts,
    filteredItems,
    total,
    loading,
    isRefreshing,
    loadingMore,
    hasMore,
    error,
    folderId,
    setFolderId,
    q,
    setQ,
    ratingFilter,
    setRatingFilter,
    sentinelRef,
    load,
    updateRating: handleUpdateRating,
    saveNote: handleSaveNote,
  } = useBifrostPrompts();

  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem('bf-prompts-view') as ViewMode) || 'grid'
  );

  const handleViewModeChange = (nextMode: ViewMode) => {
    setViewMode(nextMode);
    try {
      localStorage.setItem('bf-prompts-view', nextMode);
    } catch {}
  };

  const [detail, setDetail] = useState<BifrostPrompt | null>(null);
  const [editingNoteTarget, setEditingNoteTarget] = useState<BifrostPrompt | null>(null);

  /** 复制提示词正文（Clipboard API 失败时自动降级 execCommand） */
  const handleCopy = async (content: string, name: string) => {
    if (!content.trim()) {
      showToast('该提示词内容为空', { type: 'warning' });
      return;
    }
    try {
      await copyTextToClipboard(content);
      showToast(`已复制「${name}」正文`, { type: 'success' });
    } catch {
      showToast('复制失败，请手动选择正文复制', { type: 'error' });
    }
  };

  /** 一键在画板创建提示词节点并载入内容 */
  const handleLoadToCanvas = (p: BifrostPrompt) => {
    try {
      const payload = {
        type: 'prompt_search',
        data: {
          promptId: p.id,
          promptName: p.name,
          content: p.content,
          promptImage: p.preview_image,
          userRating: p.user_rating,
          userNote: p.user_note,
        },
      };
      sessionStorage.setItem('bf-canvas-node-import', JSON.stringify(payload));
      showToast(`正在前往画板载入「${p.name}」...`, { type: 'info' });
      navigate('/bookplate');
    } catch {
      showToast('暂存提示词失败', { type: 'error' });
    }
  };

  const formatDate = (s?: string | number | null) => {
    if (!s) return '';
    const d = typeof s === 'number' ? new Date(s * 1000) : new Date(s);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}/${m}/${day} ${h}:${min}`;
  };

  // 当前详情在筛选结果中的索引，用于抽屉内上一条/下一条连续检视
  const detailIndex = useMemo(() => {
    if (!detail) return -1;
    return filteredItems.findIndex((p) => p.id === detail.id);
  }, [detail, filteredItems]);

  const hasPrev = detailIndex > 0;
  const hasNext = detailIndex >= 0 && detailIndex < filteredItems.length - 1;

  const handlePrev = useCallback(() => {
    if (detailIndex > 0) {
      const prevPrompt = filteredItems[detailIndex - 1];
      setDetail(prevPrompt);
    }
  }, [detailIndex, filteredItems]);

  const handleNext = useCallback(() => {
    if (detailIndex >= 0 && detailIndex < filteredItems.length - 1) {
      const nextPrompt = filteredItems[detailIndex + 1];
      setDetail(nextPrompt);
    }
  }, [detailIndex, filteredItems]);

  /** 详情抽屉打星同步 */
  const onUpdateRating = useCallback(
    async (promptId: string, rating: number, currentNote?: string) => {
      setDetail((prev) => (prev && prev.id === promptId ? { ...prev, user_rating: rating } : prev));
      await handleUpdateRating(promptId, rating, currentNote);
    },
    [handleUpdateRating]
  );

  /** 模态框保存备注 */
  const onSaveNoteModal = useCallback(
    async (rating: number, note: string) => {
      if (!editingNoteTarget) return;
      const targetId = editingNoteTarget.id;
      setDetail((prev) =>
        prev && prev.id === targetId
          ? { ...prev, user_rating: rating, user_note: note }
          : prev
      );
      await handleSaveNote(targetId, rating, note);
      setEditingNoteTarget(null);
    },
    [editingNoteTarget, handleSaveNote]
  );

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 顶部标题栏 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-paper-grid pb-5">
          <div>
            <div className="flex items-center gap-2.5">
              <BookOpen size={24} className="text-accent" />
              <h1 className="font-serif text-2xl font-bold text-ink">Bifrost 提示词库</h1>
            </div>
            <p className="text-sm text-ink-light font-sans mt-1">
              浏览与检索所有提示词，支持评分打标、个人私有备注、正文一键复制与一键载入画板
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void load(true)}
              title="刷新（强制获取最新信息）"
              className="flex items-center gap-1.5"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              刷新
            </Button>
          </div>
        </div>

        {/* 筛选与搜索工具栏 */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search
              size={15}
              strokeWidth={1.5}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索提示词名称或正文内容…"
              className="pl-9"
            />
          </div>
          <Select
            value={folderId}
            onChange={(val) => setFolderId(val)}
            className="w-44"
            options={[{ label: '全部文件夹', value: '' }, ...folders.map((f) => ({ label: f.name, value: f.id }))]}
          />
          <Select
            value={ratingFilter}
            onChange={(val) => setRatingFilter(val)}
            className="w-36"
            options={[
              { label: '全部打标', value: '' },
              { label: '★ 5 星', value: '5' },
              { label: '★ 4 星及以上', value: '4+' },
              { label: '★ 3 星及以上', value: '3+' },
              { label: '已打标', value: 'rated' },
              { label: '未打标', value: 'unrated' },
              { label: '仅有备注', value: 'noted' },
            ]}
          />
          {(q || folderId || ratingFilter) && (
            <button
              onClick={() => {
                setQ('');
                setFolderId('');
                setRatingFilter('');
              }}
              className="text-sm text-accent hover:text-accent-hover font-sans active:scale-[0.96] transition-colors"
            >
              清除筛选
            </button>
          )}
          <div className="flex items-center gap-3 ms-auto">
            <span className="text-xs text-ink-faint font-sans">
              共 <span className="tabular-nums font-mono text-ink font-medium">{total}</span> 条提示词
            </span>
            <ViewToggle mode={viewMode} onChange={handleViewModeChange} />
          </div>
        </div>

        {/* 骨架屏加载状态 */}
        {loading && prompts.length === 0 && (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="p-3 rounded-[20px] border border-dashed border-paper-grid bg-node-bg space-y-3 animate-pulse">
                  <div className="h-32 rounded-[10px] bg-paper-grid/30" />
                  <div className="h-4 w-3/5 bg-paper-grid/50 rounded" />
                  <div className="h-3 w-4/5 bg-paper-grid/25 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="p-3 rounded-xl border border-dashed border-paper-grid bg-node-bg flex items-center gap-3.5 animate-pulse">
                  <div className="w-14 h-14 rounded-lg bg-paper-grid/40 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-1/4 rounded bg-paper-grid/50" />
                    <div className="h-3 w-3/4 rounded bg-paper-grid/30" />
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* 错误状态 */}
        {error && prompts.length === 0 && (
          <Card className="py-12 flex flex-col items-center gap-3 text-center">
            <span className="text-sm text-error font-sans">{error}</span>
            <Button variant="secondary" size="sm" onClick={() => void load(true)}>
              <RefreshCw size={14} className="mr-1.5" />
              重新加载
            </Button>
          </Card>
        )}

        {/* 提示词内容区（网格 vs 列表） */}
        {(prompts.length > 0 || (!loading && !error)) && (
          <div>
            {filteredItems.length === 0 ? (
              <Card className="py-16 flex flex-col items-center gap-3 text-center">
                <BookOpen size={40} strokeWidth={1} className="text-ink-faint" />
                <p className="font-serif text-base text-ink">没有找到匹配的提示词</p>
                <p className="text-sm text-ink-light font-sans">
                  {q.trim() || folderId || ratingFilter ? '尝试调整或清除筛选条件' : '暂无可用提示词'}
                </p>
              </Card>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4.5">
                {filteredItems.map((p) => (
                  <Card
                    key={p.id}
                    className="p-3 rounded-[20px] cursor-pointer transition-[border-color,box-shadow,transform] duration-200 ease-out hover:border-accent/40 hover:shadow-md hover:-translate-y-0.5 flex flex-col group relative"
                    onClick={() => setDetail(p)}
                  >
                    {/* 封面缩略图 */}
                    <div className="h-36 relative rounded-[10px] overflow-hidden bg-paper border border-paper-grid flex items-center justify-center shrink-0">
                      {p.preview_image ? (
                        <img
                          src={p.preview_image}
                          alt={p.name}
                          className="w-full h-full object-cover transition-transform duration-200 ease-out group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <ImageOff size={28} strokeWidth={1} className="text-ink-faint" />
                      )}
                    </div>

                    {/* 卡片主体 */}
                    <div className="pt-2.5 flex-1 flex flex-col min-w-0">
                      {/* 标题与评分（预留双行基准槽位高度，长标题优雅折行） */}
                      <div className="flex items-start justify-between gap-2 min-h-[2.5rem]">
                        <p
                          className="font-serif text-sm font-semibold text-ink line-clamp-2 break-words flex-1 group-hover:text-accent transition-colors"
                          title={p.name}
                        >
                          {p.name}
                        </p>
                        {/* 打星组件 */}
                        <div onClick={(e) => e.stopPropagation()} className="shrink-0 mt-0.5">
                          <RatingStars
                            value={p.user_rating || 0}
                            onChange={(r) => void handleUpdateRating(p.id, r, p.user_note)}
                            size="xs"
                          />
                        </div>
                      </div>

                      {/* 正文预览（预留双行基准槽位高度，保持顶边和底边对齐） */}
                      <p
                        className="mt-1.5 text-xs text-ink-light font-sans line-clamp-2 leading-relaxed min-h-[2.25rem]"
                        title={p.content || '（暂无正文内容）'}
                      >
                        {p.content || '（暂无正文内容）'}
                      </p>

                      {/* 私有备注展示与编辑（统一槽位高度与基线，并通过 mt-auto 紧贴操作栏） */}
                      <div className="mt-auto pt-3">
                        {p.user_note ? (
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingNoteTarget(p);
                            }}
                            className="h-7 text-[11px] text-accent font-sans italic bg-accent-surface/50 px-2.5 rounded-lg border border-accent/20 hover:border-accent/40 transition-colors flex items-center justify-between cursor-pointer group/note"
                            title={`备注：${p.user_note}`}
                          >
                            <span className="truncate">备注：{p.user_note}</span>
                            <StickyNote size={12} className="shrink-0 ml-1.5 opacity-70 group-hover/note:opacity-100 transition-opacity" />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingNoteTarget(p);
                            }}
                            className="h-7 w-full text-[11px] text-ink-faint hover:text-accent font-sans px-2.5 rounded-lg border border-dashed border-paper-grid hover:border-accent/40 hover:bg-accent-surface/20 transition-all flex items-center justify-between cursor-pointer active:scale-[0.98]"
                            title="添加私有备注"
                          >
                            <span className="flex items-center gap-1.5">
                              <StickyNote size={12} className="opacity-60" />
                              <span>添加私有备注</span>
                            </span>
                          </button>
                        )}
                      </div>

                      {/* 底部信息与动作按钮 */}
                      <div className="flex items-center justify-between gap-2 pt-3 mt-3 border-t border-paper-grid/50">
                        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                          {p.folder_name && <Badge>{p.folder_name}</Badge>}
                          {(typeof p.version_number === 'number' || p.version_number) && (
                            <span className="text-[10px] font-mono text-ink-faint border border-paper-grid rounded-pill px-1.5 py-px shrink-0">
                              v{p.version_number}
                            </span>
                          )}
                          <span className="text-[10px] text-ink-faint font-sans tabular-nums truncate">
                            {formatDate(p.updated_at)}
                          </span>
                        </div>

                        {/* 快捷操作区 */}
                        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => void handleCopy(p.content, p.name)}
                            className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-paper-grid/80 text-ink-light hover:text-ink active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out"
                            title="复制提示词正文"
                          >
                            <Copy size={14} />
                          </button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleLoadToCanvas(p)}
                            className="text-xs px-2.5 py-1 h-7 flex items-center gap-1"
                            title="在画板中创建该提示词检索节点"
                          >
                            <PlusCircle size={13} className="text-accent" />
                            载入画板
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              /* 高密度列表视图 */
              <div className="space-y-2.5">
                {filteredItems.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setDetail(p)}
                    className="p-3 rounded-xl border border-dashed border-paper-grid bg-node-bg hover:border-accent/40 hover:shadow-xs transition-[border-color,box-shadow,background-color] duration-150 ease-out flex items-center gap-3.5 cursor-pointer group"
                  >
                    {/* 缩略图 */}
                    <div className="w-14 h-14 rounded-lg overflow-hidden bg-paper border border-paper-grid flex items-center justify-center shrink-0">
                      {p.preview_image ? (
                        <img
                          src={p.preview_image}
                          alt={p.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200 ease-out"
                          loading="lazy"
                        />
                      ) : (
                        <ImageOff size={22} strokeWidth={1} className="text-ink-faint" />
                      )}
                    </div>

                    {/* 主体信息 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p
                          className="font-serif text-sm font-semibold text-ink truncate group-hover:text-accent transition-colors"
                          title={p.name}
                        >
                          {p.name}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 min-w-0 flex-wrap text-[10px] text-ink-faint font-sans tabular-nums">
                        {p.folder_name && (
                          <Badge variant="default" className="text-[10px] shrink-0">
                            {p.folder_name}
                          </Badge>
                        )}
                        {(typeof p.version_number === 'number' || p.version_number) && (
                          <span className="font-mono text-ink-faint border border-paper-grid rounded-pill px-1.5 py-px shrink-0">
                            v{p.version_number}
                          </span>
                        )}
                        {p.updated_at && (
                          <span className="text-ink-faint truncate">
                            {formatDate(p.updated_at)}
                          </span>
                        )}
                      </div>
                      <p
                        className="text-xs text-ink-light font-sans line-clamp-1 mt-1"
                        title={p.content}
                      >
                        {p.content}
                      </p>
                      {p.user_note && (
                        <p className="text-[11px] text-accent font-sans italic truncate mt-0.5">
                          备注：{p.user_note}
                        </p>
                      )}
                    </div>

                    {/* 打星评分 */}
                    <div onClick={(e) => e.stopPropagation()} className="shrink-0 hidden sm:block">
                      <RatingStars
                        value={p.user_rating || 0}
                        onChange={(r) => void handleUpdateRating(p.id, r, p.user_note)}
                        size="xs"
                      />
                    </div>

                    {/* 快捷操作区 */}
                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => void handleCopy(p.content, p.name)}
                        className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-paper-grid/80 text-ink-light hover:text-ink active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out"
                        title="复制提示词正文"
                      >
                        <Copy size={14} />
                      </button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleLoadToCanvas(p)}
                        className="text-xs px-2.5 py-1 h-7 flex items-center gap-1"
                        title="在画板中创建该提示词检索节点"
                      >
                        <PlusCircle size={13} className="text-accent" />
                        <span className="hidden md:inline">载入画板</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 流式触底哨兵与加载更多状态 */}
            <div ref={sentinelRef} className="py-6 flex justify-center items-center">
              {loadingMore && (
                <div className="flex items-center gap-2 text-xs font-sans text-ink-light">
                  <Loader2 size={16} className="animate-spin text-accent" />
                  <span>加载更多提示词...</span>
                </div>
              )}
              {!hasMore && filteredItems.length > 0 && (
                <span className="text-xs text-ink-faint font-sans select-none">已加载全部 {total} 条提示词</span>
              )}
            </div>
          </div>
        )}

        {/* 详情侧边栏抽屉 */}
        <Drawer
          isOpen={!!detail}
          onClose={() => setDetail(null)}
          title="提示词详情"
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPrev={handlePrev}
          onNext={handleNext}
          prevTitle="上一个提示词 (←)"
          nextTitle="下一个提示词 (→)"
          width="w-[540px] xl:w-[600px] max-w-[92vw]"
          footer={
            detail ? (
              <>
                <Button variant="ghost" onClick={() => setDetail(null)}>
                  关闭
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void handleCopy(detail.content, detail.name)}
                  className="flex items-center gap-1.5"
                >
                  <Copy size={14} />
                  复制正文
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    handleLoadToCanvas(detail);
                    setDetail(null);
                  }}
                  className="flex items-center gap-1.5"
                >
                  <PlusCircle size={14} />
                  载入画板
                </Button>
              </>
            ) : null
          }
        >
          {detail && (
            <div className="space-y-4">
              {/* 标题与基础属性 */}
              <div className="space-y-2">
                <h3 className="font-serif text-lg font-bold text-ink leading-snug">{detail.name}</h3>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    {detail.folder_name && <Badge>{detail.folder_name}</Badge>}
                    {(typeof detail.version_number === 'number' || detail.version_number) && (
                      <span className="font-mono text-xs text-ink-light border border-paper-grid rounded-pill px-2 py-0.5">
                        版本 v{detail.version_number}
                      </span>
                    )}
                    <span className="text-xs text-ink-light">更新于: {formatDate(detail.updated_at)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-light">评分：</span>
                    <RatingStars
                      value={detail.user_rating || 0}
                      onChange={(r) => void onUpdateRating(detail.id, r, detail.user_note)}
                      size="sm"
                    />
                  </div>
                </div>
              </div>

              {/* 预览大图 */}
              {detail.preview_image && (
                <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
                  <PhotoView src={detail.preview_image}>
                    <div className="relative group cursor-pointer h-56 rounded-xl overflow-hidden border border-paper-grid bg-paper">
                      <img
                        src={detail.preview_image}
                        alt={detail.name}
                        className="w-full h-full object-cover group-hover:scale-102 transition-transform"
                      />
                      <div className="absolute right-3 bottom-3 p-1.5 rounded-lg bg-black/50 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs">
                        <Maximize2 size={13} /> 点击全屏预览
                      </div>
                    </div>
                  </PhotoView>
                </PhotoProvider>
              )}

              {/* 正文区域 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-ink font-serif">提示词正文内容</label>
                  <button
                    type="button"
                    onClick={() => void handleCopy(detail.content, detail.name)}
                    className="text-xs text-accent hover:text-accent-hover flex items-center gap-1"
                  >
                    <Copy size={13} />
                    复制正文
                  </button>
                </div>
                <MarkdownViewer
                  content={detail.content}
                  emptyText="（空）"
                  className="max-h-[360px]"
                />
              </div>

              {/* 私有备注区域 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-ink font-serif">我的备注</label>
                  <button
                    type="button"
                    onClick={() => setEditingNoteTarget(detail)}
                    className="text-xs text-accent hover:text-accent-hover flex items-center gap-1"
                  >
                    <StickyNote size={13} />
                    编辑备注
                  </button>
                </div>
                <div className="p-3 rounded-xl border border-paper-grid bg-paper/40 text-xs text-ink font-sans">
                  {detail.user_note ? (
                    <span className="text-accent italic">{detail.user_note}</span>
                  ) : (
                    <span className="text-ink-faint">暂无备注（可在节点和此页面同步记录私有见解）</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </Drawer>

        {/* 独立备注编辑模态框 */}
        {editingNoteTarget && (
          <NoteEditModal
            open={!!editingNoteTarget}
            onClose={() => setEditingNoteTarget(null)}
            title="打标与备注"
            resourceName={editingNoteTarget.name}
            initialRating={editingNoteTarget.user_rating ?? 0}
            initialNote={editingNoteTarget.user_note ?? ''}
            onSave={onSaveNoteModal}
          />
        )}
      </main>
    </div>
  );
};

export default BifrostPromptsPage;
