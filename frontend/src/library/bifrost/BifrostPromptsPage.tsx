import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Copy,
  ImageOff,
  Maximize2,
  PlusCircle,
  RefreshCw,
  Search,
  StickyNote,
} from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { Navbar } from '../../shared/components/layout/Navbar';
import { bifrostService } from '../../shared/services/bifrost';
import { annotationService } from '../../shared/services/admin';
import type { BifrostFolder, BifrostPrompt } from '../../shared/types';
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
import { Pagination } from '../../shared/components/ui/Pagination';

/** 内存级 SWR 缓存：页面切换 0ms 瞬间秒开 */
let cachedFolders: BifrostFolder[] | null = null;
let cachedPrompts: BifrostPrompt[] | null = null;

export const BifrostPromptsPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useFeedback();

  const [folders, setFolders] = useState<BifrostFolder[]>(() => cachedFolders ?? []);
  const [prompts, setPrompts] = useState<BifrostPrompt[]>(() => cachedPrompts ?? []);
  const [loading, setLoading] = useState(() => !cachedPrompts);
  const [error, setError] = useState('');

  const [q, setQ] = useState('');
  const [folderId, setFolderId] = useState('');
  const [ratingFilter, setRatingFilter] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 24;

  const [detail, setDetail] = useState<BifrostPrompt | null>(null);
  const [editingNoteTarget, setEditingNoteTarget] = useState<BifrostPrompt | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{ x: number; y: number; url: string } | null>(null);

  /** 加载提示词与文件夹 */
  const load = useCallback(
    async (force = false, showLoading = true) => {
      if (showLoading && !cachedPrompts) setLoading(true);
      setError('');
      try {
        const [folderRes, promptRes] = await Promise.all([
          bifrostService.listFolders({ force }),
          bifrostService.listPrompts({
            folder_id: folderId || undefined,
            q: q || undefined,
            force,
          }),
        ]);
        cachedFolders = folderRes.folders;
        if (!folderId && !q) cachedPrompts = promptRes.prompts;
        setFolders(folderRes.folders ?? []);
        setPrompts(promptRes.prompts ?? []);
      } catch (e: any) {
        if (!cachedPrompts) setError(e?.message || '加载提示词失败，请重试');
      } finally {
        setLoading(false);
      }
    },
    [folderId, q]
  );

  // 文件夹变化立即加载
  const prevFolderRef = useRef(folderId);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      void load(false, !cachedPrompts);
      return;
    }
    if (prevFolderRef.current !== folderId) {
      prevFolderRef.current = folderId;
      void load(false, false);
    }
  }, [folderId, load]);

  // 搜索防抖
  const loadRef = useRef(load);
  loadRef.current = load;
  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      void loadRef.current();
    }, 350);
    return () => window.clearTimeout(t);
  }, [q]);

  // 条件变化回到第一页
  useEffect(() => {
    setCurrentPage(1);
  }, [q, folderId, ratingFilter]);

  /** 更新星级评分 */
  const handleUpdateRating = async (promptId: string, nextRating: number, currentNote?: string) => {
    try {
      const res = await annotationService.setAnnotation({
        resource_type: 'bifrost_prompt',
        resource_id: promptId,
        rating: nextRating,
        note: currentNote !== undefined ? currentNote : (prompts.find((p) => p.id === promptId)?.user_note ?? ''),
      });
      setPrompts((prev) =>
        prev.map((p) => (p.id === promptId ? { ...p, user_rating: res.rating, user_note: res.note } : p))
      );
      if (detail && detail.id === promptId) {
        setDetail({ ...detail, user_rating: res.rating, user_note: res.note });
      }
      showToast(nextRating > 0 ? `已评为 ${nextRating} 星` : '已清除评分', { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || '评分更新失败', { type: 'error' });
    }
  };

  /** 保存私有备注 */
  const handleSaveNote = async (nextRating: number, nextNote: string) => {
    if (!editingNoteTarget) return;
    try {
      const res = await annotationService.setAnnotation({
        resource_type: 'bifrost_prompt',
        resource_id: editingNoteTarget.id,
        rating: nextRating,
        note: nextNote.trim(),
      });
      setPrompts((prev) =>
        prev.map((p) =>
          p.id === editingNoteTarget.id ? { ...p, user_rating: res.rating, user_note: res.note } : p
        )
      );
      if (detail && detail.id === editingNoteTarget.id) {
        setDetail({ ...detail, user_rating: res.rating, user_note: res.note });
      }
      showToast('备注已保存', { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || '备注保存失败', { type: 'error' });
    }
  };

  /** 复制提示词正文 */
  const handleCopy = (content: string, name: string) => {
    if (!content.trim()) {
      showToast('该提示词内容为空', { type: 'warning' });
      return;
    }
    navigator.clipboard.writeText(content);
    showToast(`已复制「${name}」正文`, { type: 'success' });
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

  const formatDate = (s?: string | null) =>
    s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '';

  // 客户端打标/备注筛选
  const filteredPrompts = useMemo(() => {
    return prompts.filter((p) => {
      if (ratingFilter === '5' && (p.user_rating ?? 0) !== 5) return false;
      if (ratingFilter === '4+' && (p.user_rating ?? 0) < 4) return false;
      if (ratingFilter === '3+' && (p.user_rating ?? 0) < 3) return false;
      if (ratingFilter === 'rated' && !(p.user_rating && p.user_rating > 0)) return false;
      if (ratingFilter === 'unrated' && (p.user_rating && p.user_rating > 0)) return false;
      if (ratingFilter === 'noted' && !p.user_note?.trim()) return false;
      return true;
    });
  }, [prompts, ratingFilter]);

  const totalPages = Math.ceil(filteredPrompts.length / PAGE_SIZE);
  const currentPrompts = filteredPrompts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // 当前详情在筛选结果中的索引，用于抽屉内上一条/下一条连续检视
  const detailIndex = useMemo(() => {
    if (!detail) return -1;
    return filteredPrompts.findIndex((p) => p.id === detail.id);
  }, [detail, filteredPrompts]);

  const hasPrev = detailIndex > 0;
  const hasNext = detailIndex >= 0 && detailIndex < filteredPrompts.length - 1;

  const handlePrev = useCallback(() => {
    if (detailIndex > 0) {
      const prevPrompt = filteredPrompts[detailIndex - 1];
      setDetail(prevPrompt);
      const targetPage = Math.floor((detailIndex - 1) / PAGE_SIZE) + 1;
      if (targetPage !== currentPage) setCurrentPage(targetPage);
    }
  }, [detailIndex, filteredPrompts, currentPage]);

  const handleNext = useCallback(() => {
    if (detailIndex >= 0 && detailIndex < filteredPrompts.length - 1) {
      const nextPrompt = filteredPrompts[detailIndex + 1];
      setDetail(nextPrompt);
      const targetPage = Math.floor((detailIndex + 1) / PAGE_SIZE) + 1;
      if (targetPage !== currentPage) setCurrentPage(targetPage);
    }
  }, [detailIndex, filteredPrompts, currentPage]);



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
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
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
          <span className="text-xs text-ink-faint font-sans ml-auto">
            共 {filteredPrompts.length} 条提示词
          </span>
        </div>

        {/* 骨架屏加载状态 */}
        {loading && prompts.length === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="p-4 rounded-2xl border border-dashed border-paper-grid bg-node-bg space-y-3 animate-pulse">
                <div className="h-32 rounded-lg bg-paper-grid/30" />
                <div className="h-4 w-3/5 bg-paper-grid/50 rounded" />
                <div className="h-3 w-4/5 bg-paper-grid/25 rounded" />
              </div>
            ))}
          </div>
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

        {/* 提示词网格 */}
        {(prompts.length > 0 || (!loading && !error)) && (
          <div>
            {filteredPrompts.length === 0 ? (
              <Card className="py-16 flex flex-col items-center gap-3 text-center">
                <BookOpen size={40} strokeWidth={1} className="text-ink-faint" />
                <p className="font-serif text-base text-ink">没有找到匹配的提示词</p>
                <p className="text-sm text-ink-light font-sans">
                  {q.trim() || folderId || ratingFilter ? '尝试调整或清除筛选条件' : '暂无可用提示词'}
                </p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {currentPrompts.map((p) => (
                  <Card
                    key={p.id}
                    className="p-3.5 rounded-2xl cursor-pointer transition-all duration-200 hover:border-accent/40 hover:shadow-md flex flex-col group relative"
                    onClick={() => setDetail(p)}
                    onMouseEnter={(e) =>
                      p.preview_image &&
                      setHoverPreview({ x: e.clientX + 18, y: e.clientY + 12, url: p.preview_image })
                    }
                    onMouseMove={(e) =>
                      p.preview_image &&
                      setHoverPreview({ x: e.clientX + 18, y: e.clientY + 12, url: p.preview_image })
                    }
                    onMouseLeave={() => setHoverPreview(null)}
                  >
                    {/* 封面缩略图 */}
                    <div className="h-36 relative rounded-xl overflow-hidden bg-paper border border-paper-grid flex items-center justify-center shrink-0">
                      {p.preview_image ? (
                        <img
                          src={p.preview_image}
                          alt={p.name}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <ImageOff size={28} strokeWidth={1} className="text-ink-faint" />
                      )}
                    </div>

                    {/* 卡片主体 */}
                    <div className="pt-3 flex-1 flex flex-col min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-serif text-sm font-semibold text-ink truncate flex-1" title={p.name}>
                          {p.name}
                        </p>
                        {/* 打星组件 */}
                        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                          <RatingStars
                            value={p.user_rating || 0}
                            onChange={(r) => void handleUpdateRating(p.id, r, p.user_note)}
                            size="xs"
                          />
                        </div>
                      </div>

                      {/* 正文预览 */}
                      <p className="mt-1 text-xs text-ink-light font-sans line-clamp-2 leading-relaxed">
                        {p.content || '（暂无正文内容）'}
                      </p>

                      {/* 备注 */}
                      {p.user_note ? (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingNoteTarget(p);
                          }}
                          className="text-[11px] text-accent font-sans mt-2 line-clamp-1 italic bg-accent-surface/50 px-2 py-1 rounded border border-accent/20 hover:border-accent/40 transition-colors flex items-center justify-between"
                        >
                          <span className="truncate">备注：{p.user_note}</span>
                          <StickyNote size={12} className="shrink-0 ml-1 opacity-70" />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingNoteTarget(p);
                          }}
                          className="text-[11px] text-ink-faint hover:text-accent font-sans mt-2 self-start flex items-center gap-1 transition-colors"
                        >
                          <StickyNote size={12} />
                          添加私有备注
                        </button>
                      )}

                      {/* 底部信息与动作按钮 */}
                      <div className="flex items-center justify-between gap-2 mt-auto pt-3 border-t border-paper-grid/50">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {p.folder_name && <Badge>{p.folder_name}</Badge>}
                          <span className="text-[10px] text-ink-faint font-sans tabular-nums truncate">
                            {formatDate(p.updated_at)}
                          </span>
                        </div>

                        {/* 快捷操作区 */}
                        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => handleCopy(p.content, p.name)}
                            className="p-1.5 rounded-md hover:bg-paper-grid/80 text-ink-light hover:text-ink transition-colors"
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
            )}

            {/* 分页组件 */}
            {totalPages > 1 && (
              <div className="mt-8 flex justify-center">
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                />
              </div>
            )}
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
                  onClick={() => handleCopy(detail.content, detail.name)}
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
                  <div className="flex items-center gap-2">
                    {detail.folder_name && <Badge>{detail.folder_name}</Badge>}
                    <span className="text-xs text-ink-light">更新于: {formatDate(detail.updated_at)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-light">评分：</span>
                    <RatingStars
                      value={detail.user_rating || 0}
                      onChange={(r) => void handleUpdateRating(detail.id, r, detail.user_note)}
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
                    onClick={() => handleCopy(detail.content, detail.name)}
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
                  <label className="text-xs font-semibold text-ink font-serif">我的私有备注</label>
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
            title="打标与私有备注"
            resourceName={editingNoteTarget.name}
            initialRating={editingNoteTarget.user_rating ?? 0}
            initialNote={editingNoteTarget.user_note ?? ''}
            onSave={handleSaveNote}
          />
        )}

        {/* 悬停大图跟随浮层 */}
        {hoverPreview && (
          <div
            className="fixed z-[9999] pointer-events-none rounded-xl overflow-hidden border border-paper-grid bg-paper shadow-2xl animate-fade-in"
            style={{
              left: Math.min(hoverPreview.x, window.innerWidth - 340),
              top: Math.min(hoverPreview.y, window.innerHeight - 340),
              width: 320,
              height: 320,
            }}
          >
            <img src={hoverPreview.url} alt="" className="w-full h-full object-cover" />
          </div>
        )}
      </main>
    </div>
  );
};

export default BifrostPromptsPage;
