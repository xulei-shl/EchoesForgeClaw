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
    tagFilter,
    setTagFilter,
    availableTags,
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
          userTags: p.user_tags,
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
    async (promptId: string, rating: number, currentNote?: string, currentTags?: string[]) => {
      setDetail((prev) => (prev && prev.id === promptId ? { ...prev, user_rating: rating } : prev));
      await handleUpdateRating(promptId, rating, currentNote, currentTags);
    },
    [handleUpdateRating]
  );

  /** 模态框保存打标、备注与标签 */
  const onSaveNoteModal = useCallback(
    async (rating: number, note: string, tags: string[]) => {
      if (!editingNoteTarget) return;
      const targetId = editingNoteTarget.id;
      setDetail((prev) =>
        prev && prev.id === targetId
          ? { ...prev, user_rating: rating, user_note: note, user_tags: tags }
          : prev
      );
      await handleSaveNote(targetId, rating, note, tags);
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
          {availableTags.length > 0 && (
            <Select
              value={tagFilter}
              onChange={(val) => setTagFilter(val)}
              className="w-36"
              options={[
                { label: '全部标签', value: '' },
                ...availableTags.map((t) => ({ label: `#${t}`, value: t })),
              ]}
            />
          )}
          {(q || folderId || ratingFilter || tagFilter) && (
            <button
              onClick={() => {
                setQ('');
                setFolderId('');
                setRatingFilter('');
                setTagFilter('');
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
                      {/* 第 1 行：主标题纯享行（名称单行截断，不换行） */}
                      <p
                        className="font-serif text-sm font-semibold text-ink truncate group-hover:text-accent transition-colors"
                        title={p.name}
                      >
                        {p.name}
                      </p>

                      {/* 第 2 行：核心元数据行（文件夹分类/版本居左，打星 RatingStars 居右两极平衡） */}
                      <div className="flex items-center justify-between gap-2 mt-2 h-5">
                        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                          {p.folder_name && <Badge className="text-[10px] px-1.5 py-px">{p.folder_name}</Badge>}
                          {(typeof p.version_number === 'number' || p.version_number) && (
                            <span className="text-[10px] font-mono text-ink-faint border border-paper-grid rounded-pill px-1.5 py-px shrink-0">
                              v{p.version_number}
                            </span>
                          )}
                        </div>

                        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                          <RatingStars
                            value={p.user_rating || 0}
                            onChange={(r) => void handleUpdateRating(p.id, r, p.user_note)}
                            size="xs"
                          />
                        </div>
                      </div>

                      {/* 第 3 区：正文预览（固定两行基准槽位高度，保持严格等高对齐） */}
                      <p className="mt-2 text-xs text-ink-light font-sans line-clamp-2 leading-relaxed h-9 overflow-hidden">
                        {p.content || '（暂无正文内容）'}
                      </p>

                      {/* 第 4 区：微标签与私有备注轻量微聚合行 */}
                      <div className="mt-2 flex items-center justify-between gap-1.5 min-h-[1.5rem]" onClick={(e) => e.stopPropagation()}>
                        {/* 微标签 */}
                        <div className="flex items-center gap-1 min-w-0 flex-wrap">
                          {p.user_tags && p.user_tags.length > 0 ? (
                            <>
                              {p.user_tags.slice(0, 2).map((tag) => (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}
                                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                                    tagFilter === tag
                                      ? 'bg-accent text-paper border-accent font-medium'
                                      : 'bg-paper-grid/20 border-dashed border-paper-grid text-ink-light hover:border-accent/40 hover:text-accent'
                                  }`}
                                  title={`按标签「${tag}」过滤`}
                                >
                                  #{tag}
                                </button>
                              ))}
                              {p.user_tags.length > 2 && (
                                <span
                                  className="text-[10px] text-ink-faint border border-dashed border-paper-grid px-1 rounded"
                                  title={p.user_tags.slice(2).map((t) => `#${t}`).join(', ')}
                                >
                                  +{p.user_tags.length - 2}
                                </span>
                              )}
                            </>
                          ) : null}
                        </div>

                        {/* 私有备注触发与展示 */}
                        <div className="shrink-0 max-w-[55%]">
                          {p.user_note ? (
                            <button
                              type="button"
                              onClick={() => setEditingNoteTarget(p)}
                              className="h-5 text-[10px] text-accent font-sans italic bg-accent-surface/50 px-2 rounded border border-accent/20 hover:border-accent/40 transition-colors flex items-center gap-1 max-w-full group/note truncate"
                              title={`备注：${p.user_note}`}
                            >
                              <StickyNote size={10} className="shrink-0 opacity-70 group-hover/note:opacity-100" />
                              <span className="truncate">{p.user_note}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setEditingNoteTarget(p)}
                              className="h-5 text-[10px] text-ink-faint hover:text-accent font-sans px-1.5 rounded hover:bg-paper-grid/40 transition-colors flex items-center gap-1 opacity-60 hover:opacity-100"
                              title="添加私有备注"
                            >
                              <StickyNote size={11} />
                              <span>备注</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 第 5 区：底部信息与动作按钮（mt-auto 绝对沉底） */}
                      <div className="flex items-center justify-between gap-2 pt-2.5 mt-auto border-t border-paper-grid/40">
                        <span className="text-[10px] text-ink-faint font-sans tabular-nums truncate">
                          {formatDate(p.updated_at)}
                        </span>

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

                    {/* 标识与版本组（纯粹双行：1行名称单行截断，2行文件夹与版本；时间移至右侧详情面板） */}
                    <div className="w-44 sm:w-52 shrink-0 min-w-0 flex flex-col justify-center gap-1">
                      <p
                        className="font-serif text-sm font-semibold text-ink truncate group-hover:text-accent transition-colors"
                        title={p.name}
                      >
                        {p.name}
                      </p>
                      <div className="flex items-center gap-1.5 min-w-0 flex-wrap text-[10px] text-ink-faint font-sans tabular-nums">
                        {p.folder_name && (
                          <Badge variant="default" className="text-[10px] px-1.5 py-px shrink-0">
                            {p.folder_name}
                          </Badge>
                        )}
                        {(typeof p.version_number === 'number' || p.version_number) && (
                          <span className="font-mono text-ink-faint border border-paper-grid rounded-pill px-1.5 py-px shrink-0">
                            v{p.version_number}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 正文内容与私有备注（中间弹性区域，支持舒展） */}
                    <div className="flex-1 min-w-0 hidden md:block px-2">
                      <p className="text-xs text-ink-light font-sans truncate">
                        {p.content}
                      </p>
                      {p.user_note && (
                        <p className="text-[11px] text-accent font-sans italic truncate mt-0.5 flex items-center gap-1" title={`备注：${p.user_note}`}>
                          <StickyNote size={11} className="shrink-0 opacity-70" />
                          <span className="truncate">{p.user_note}</span>
                        </p>
                      )}
                    </div>

                    {/* 用户标注列：上行打星评价，下行微标签（聚合为同一列上下展示） */}
                    <div className="w-28 shrink-0 hidden sm:flex flex-col justify-center items-start gap-1" onClick={(e) => e.stopPropagation()}>
                      <RatingStars
                        value={p.user_rating || 0}
                        onChange={(r) => void handleUpdateRating(p.id, r, p.user_note)}
                        size="xs"
                      />
                      {p.user_tags && p.user_tags.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap">
                          {p.user_tags.slice(0, 2).map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}
                              className={`text-[10px] px-1.5 py-px rounded border transition-colors ${
                                tagFilter === tag
                                  ? 'bg-accent text-paper border-accent font-medium'
                                  : 'bg-paper-grid/20 border-dashed border-paper-grid text-ink-light hover:border-accent/40 hover:text-accent'
                              }`}
                              title={`按标签「${tag}」过滤`}
                            >
                              #{tag}
                            </button>
                          ))}
                          {p.user_tags.length > 2 && (
                            <span
                              className="text-[10px] text-ink-faint border border-dashed border-paper-grid px-1 rounded"
                              title={p.user_tags.slice(2).map((t) => `#${t}`).join(', ')}
                            >
                              +{p.user_tags.length - 2}
                            </span>
                          )}
                        </div>
                      )}
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
                    {detail.updated_at && (
                      <span className="text-xs text-ink-faint font-sans tabular-nums">
                        更新时间: {formatDate(detail.updated_at)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink-light">评分：</span>
                      <RatingStars
                        value={detail.user_rating || 0}
                        onChange={(r) => void onUpdateRating(detail.id, r, detail.user_note, detail.user_tags)}
                        size="sm"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingNoteTarget(detail)}
                      className="text-xs text-accent hover:text-accent-hover flex items-center gap-1 font-sans transition-colors"
                    >
                      <StickyNote size={13} />
                      编辑标注
                    </button>
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
                <label className="text-xs font-semibold text-ink font-serif block">我的备注</label>
                <div className="p-3 rounded-xl border border-paper-grid bg-paper/40 text-xs text-ink font-sans">
                  {detail.user_note ? (
                    <span className="text-accent italic">{detail.user_note}</span>
                  ) : (
                    <span className="text-ink-faint">暂无备注（可在节点和此页面同步记录私有见解）</span>
                  )}
                </div>
              </div>

              {/* 标签展示区域 */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink font-serif block">我的标签</label>
                <div className="flex items-center gap-1.5 flex-wrap p-3 rounded-xl border border-paper-grid bg-paper/40">
                  {detail.user_tags && detail.user_tags.length > 0 ? (
                    detail.user_tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-xs px-2 py-0.5 rounded-pill bg-accent-surface text-accent border border-accent/25"
                      >
                        #{tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-ink-faint">暂无标签（可在编辑标注中添加）</span>
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
            initialTags={editingNoteTarget.user_tags ?? []}
            suggestedTags={availableTags}
            onSave={onSaveNoteModal}
          />
        )}
      </main>
    </div>
  );
};

export default BifrostPromptsPage;
