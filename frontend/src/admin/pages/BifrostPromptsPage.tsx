import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Braces,
  ImageOff,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Maximize2,
} from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { adminService, annotationService } from '../../platform/services/admin';
import type { BifrostFolder, BifrostPrompt } from '../../platform/types';
import { Button } from '../../platform/components/ui/Button';
import { Input } from '../../platform/components/ui/Input';
import { Select } from '../../platform/components/ui/Select';
import { Dialog } from '../../platform/components/ui/Dialog';
import { Card } from '../../platform/components/ui/Card';
import { Badge } from '../../platform/components/ui/Badge';
import { RatingStars } from '../../platform/components/ui/RatingStars';
import { Textarea } from '../../platform/components/ui/Textarea';
import { FieldLabel, PageHeader } from '../components/AdminBits';
import { useFeedback } from '../../platform/components/ui/FeedbackProvider';
import { Pagination } from '../../platform/components/ui/Pagination';

export const BifrostPromptsPage: React.FC = () => {
  const [folders, setFolders] = useState<BifrostFolder[]>([]);
  const [prompts, setPrompts] = useState<BifrostPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [q, setQ] = useState('');
  const [folderId, setFolderId] = useState('');
  const [ratingFilter, setRatingFilter] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 24;

  const [detail, setDetail] = useState<BifrostPrompt | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawData, setRawData] = useState<string>('');
  const [rawLoading, setRawLoading] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{ x: number; y: number; url: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { dialog, showToast } = useFeedback();

  // 打开详情时同步备注草稿
  useEffect(() => {
    setNoteDraft(detail?.user_note ?? '');
  }, [detail]);

  /** 保存用户对提示词的打标与备注 */
  const handleUpdateRating = async (promptId: string, nextRating: number, currentNote?: string) => {
    try {
      const res = await annotationService.setAnnotation({
        resource_type: 'bifrost_prompt',
        resource_id: promptId,
        rating: nextRating,
        note: currentNote !== undefined ? currentNote : (prompts.find((p) => p.id === promptId)?.user_note ?? ''),
      });
      setPrompts((prev) =>
        prev.map((p) =>
          p.id === promptId ? { ...p, user_rating: res.rating, user_note: res.note } : p
        )
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
  const handleSaveNote = async () => {
    if (!detail) return;
    setSavingNote(true);
    try {
      const res = await annotationService.setAnnotation({
        resource_type: 'bifrost_prompt',
        resource_id: detail.id,
        rating: detail.user_rating ?? 0,
        note: noteDraft.trim(),
      });
      setPrompts((prev) =>
        prev.map((p) =>
          p.id === detail.id ? { ...p, user_rating: res.rating, user_note: res.note } : p
        )
      );
      setDetail({ ...detail, user_rating: res.rating, user_note: res.note });
      showToast('备注已保存', { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || '备注保存失败', { type: 'error' });
    } finally {
      setSavingNote(false);
    }
  };



  /** force=true 绕过 TTL 缓存强制拉取 Bifrost（供「刷新」按钮使用） */
  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      setError('');
      try {
        const [folderRes, promptRes] = await Promise.all([
          adminService.listBifrostFolders(),
          adminService.listBifrostPrompts({
            folder_id: folderId || undefined,
            q: q || undefined,
            force,
          }),
        ]);
        setFolders(folderRes.folders);
        setPrompts(promptRes.prompts);
      } catch (e: any) {
        setError(e?.message || '加载失败，请重试');
      } finally {
        setLoading(false);
      }
    },
    [folderId, q]
  );

  // 挂载 + 文件夹变化：立即加载（q 变化不触发，交给下方防抖，避免每次输入发两次请求）
  const prevFolderRef = useRef(folderId);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      void load();
      return;
    }
    if (prevFolderRef.current !== folderId) {
      prevFolderRef.current = folderId;
      void load();
    }
  }, [folderId, load]);

  // 搜索防抖：仅关键词变化时触发
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

  // 当搜索或过滤条件变化时，重置回第一页
  useEffect(() => {
    setCurrentPage(1);
  }, [q, folderId, ratingFilter]);

  const notConfigured = !!error && error.includes('未配置');

  const refreshDetail = useCallback(async (id: string) => {
    try {
      const p = await adminService.getBifrostPrompt(id);
      setDetail((prev) => (prev && prev.id === id ? p : prev));
      return p;
    } catch {
      return null;
    }
  }, []);

  const handleUploadPreview = async (file: File) => {
    if (!detail) return;
    setUploading(true);
    try {
      await adminService.uploadBifrostPreview(detail.id, file);
      showToast('预览图已更新', { type: 'success' });
      await refreshDetail(detail.id);
      await load();
    } catch (e: any) {
      showToast(e?.message || '上传失败，请重试', { type: 'error' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleRaw = async () => {
    if (!detail) return;
    if (rawOpen) {
      setRawOpen(false);
      return;
    }
    setRawLoading(true);
    try {
      const raw = await adminService.getBifrostPromptRaw(detail.id);
      setRawData(JSON.stringify(raw, null, 2));
      setRawOpen(true);
    } catch (e: any) {
      showToast(e?.message || '获取原始响应失败', { type: 'error' });
    } finally {
      setRawLoading(false);
    }
  };

  const handleDeletePreview = async () => {
    if (!detail) return;
    const ok = await dialog.confirm({
      title: '删除预览图',
      message: `确定删除「${detail.name}」的预览图吗？`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await adminService.deleteBifrostPreview(detail.id);
      showToast('预览图已删除', { type: 'success' });
      await refreshDetail(detail.id);
      await load();
    } catch (e: any) {
      showToast(e?.message || '删除失败，请重试', { type: 'error' });
    }
  };

  const formatDate = (s?: string | null) =>
    s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '';

  // 客户端多维过滤（星级、备注等）
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

  return (
    <div>
      <PageHeader
        title="Bifrost 提示词"
        subtitle="浏览 / 检索 Bifrost Prompt Repository；正文编辑请在 Bifrost 后台进行，预览图与个人打标备注在此管理"
        actions={
          <Button size="sm" variant="ghost" onClick={() => void load(true)} title="刷新（强制拉取 Bifrost 最新信息）">
            <RefreshCw size={14} strokeWidth={2} className={loading ? 'animate-spin' : ''} />
          </Button>
        }
      />

      {/* 未配置提示 */}
      {notConfigured && (
        <Card className="p-4 mb-4 border-error/30">
          <p className="text-sm text-error font-sans">
            {error} —— 配置项在
            <Link to="/admin/settings" className="text-accent underline underline-offset-2 mx-1">
              系统设置
            </Link>
            中管理（bifrost.base_url / bifrost.username / bifrost.password）。
          </p>
        </Card>
      )}

      {/* 工具栏 */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search
            size={15}
            strokeWidth={1.5}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索提示词名称或内容…"
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
            className="text-sm text-accent hover:text-accent-hover font-sans active:scale-95 transition"
          >
            清除筛选
          </button>
        )}
      </div>

      {/* 加载态 */}
      {loading && (
        <Card className="p-10 flex items-center justify-center gap-2 text-ink-light text-sm font-sans">
          <Loader2 className="w-4 h-4 animate-spin text-accent" strokeWidth={1.5} />
          加载中...
        </Card>
      )}

      {!loading && error && !notConfigured && (
        <div className="py-12 flex flex-col items-center gap-3">
          <span className="text-sm text-error font-sans">{error}</span>
          <Button variant="ghost" size="sm" onClick={() => void load(true)}>
            <RefreshCw size={14} strokeWidth={1.5} className="mr-1" />
            重试
          </Button>
        </div>
      )}

      {/* 提示词网格 */}
      {!loading && !error && (
        <div>
          {filteredPrompts.length === 0 ? (
            <Card className="py-14 flex flex-col items-center gap-3 text-center">
              <BookOpen size={36} strokeWidth={1} className="text-ink-faint" />
              <p className="font-serif text-base text-ink">没有匹配的提示词</p>
              <p className="text-sm text-ink-light font-sans">
                {q.trim() || folderId || ratingFilter
                  ? '尝试清除筛选条件'
                  : '请先在 Bifrost 后台创建提示词'}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {currentPrompts.map((p) => (
                <Card
                  key={p.id}
                  className="p-2.5 rounded-2xl cursor-pointer transition hover:shadow-md active:scale-[0.98] flex flex-col"
                  onClick={() => {
                    // 切换详情时重置原始响应调试区，避免展示上一个提示词的残留数据
                    if (detail?.id !== p.id) {
                      setRawOpen(false);
                      setRawData('');
                    }
                    setDetail(p);
                  }}
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
                  <div className={`h-32 relative rounded-md overflow-hidden bg-paper flex items-center justify-center ${p.preview_image ? 'after:absolute after:inset-0 after:rounded-md after:ring-1 after:ring-inset after:ring-black/5 dark:after:ring-white/5' : 'border border-dashed border-paper-grid'}`}>
                    {p.preview_image ? (
                      <img
                        src={p.preview_image}
                        alt={p.name}
                        className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <ImageOff size={24} strokeWidth={1} className="text-ink-faint" />
                    )}
                  </div>
                  <div className="px-1 pt-2 pb-1 antialiased flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-serif text-sm font-semibold text-ink truncate flex-1" title={p.name}>
                        {p.name}
                      </p>
                      <div onClick={(e) => e.stopPropagation()}>
                        <RatingStars
                          value={p.user_rating || 0}
                          onChange={(r) => void handleUpdateRating(p.id, r, p.user_note)}
                          size="xs"
                        />
                      </div>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-light font-sans line-clamp-2">
                      {p.content || '（空内容）'}
                    </p>
                    {p.user_note && (
                      <p className="text-[11px] text-accent font-sans mt-1.5 line-clamp-1 italic bg-accent-surface/50 px-1.5 py-0.5 rounded border border-accent/20">
                        备注：{p.user_note}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-auto pt-2.5">
                      {p.folder_name && <Badge>{p.folder_name}</Badge>}
                      <span className="text-[10px] text-ink-faint font-sans tabular-nums ml-auto">
                        {formatDate(p.updated_at)}
                      </span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

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

      {/* 详情弹窗 */}
      <Dialog
        open={!!detail}
        onClose={() => {
          setDetail(null);
          setRawOpen(false);
          setRawData('');
        }}
        title={detail ? detail.name : ''}
        panelClassName="max-w-xl"
        footer={
          <Button size="sm" onClick={() => {
            setDetail(null);
            setRawOpen(false);
            setRawData('');
          }}>
            关闭
          </Button>
        }
      >
        {detail && (
          <div className="space-y-5">
            <div className="p-1 rounded-xl border border-dashed border-paper-grid bg-paper overflow-hidden">
              {detail.preview_image ? (
                <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
                  <PhotoView src={detail.preview_image}>
                    <div className="relative group rounded-lg overflow-hidden after:absolute after:inset-0 after:rounded-lg after:ring-1 after:ring-inset after:ring-black/5 dark:after:ring-white/5 cursor-pointer" title="点击全屏查看">
                      <img src={detail.preview_image} alt={detail.name} className="w-full max-h-56 object-contain bg-paper/50 group-hover:opacity-95 transition" />
                      <div className="absolute right-3 bottom-3 p-1.5 rounded bg-black/40 backdrop-blur-sm text-white/90 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-sm flex items-center justify-center">
                        <Maximize2 size={16} strokeWidth={2} />
                      </div>
                    </div>
                  </PhotoView>
                </PhotoProvider>
              ) : (
                <div className="h-36 flex flex-col items-center justify-center gap-2 text-ink-faint">
                  <ImageOff size={28} strokeWidth={1} />
                  <span className="text-xs font-sans">暂无预览图</span>
                </div>
              )}
            </div>

            {/* 预览图操作：紧跟预览图，便于连贯操作 */}
            <div className="flex items-center gap-2 flex-wrap -mt-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUploadPreview(file);
                }}
              />
              <Button size="sm" isLoading={uploading} onClick={() => fileInputRef.current?.click()}>
                <Upload size={14} strokeWidth={2} className="mr-1" />
                上传 / 更换
              </Button>
              {detail.preview_image && (
                <Button size="sm" variant="ghost" onClick={() => void handleDeletePreview()}>
                  <Trash2 size={14} strokeWidth={2} className="mr-1" />
                  删除预览图
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap text-xs text-ink-light font-sans -mt-2">
              {detail.folder_name && <Badge>{detail.folder_name}</Badge>}
              {typeof detail.version_number === 'number' && (
                <span className="font-mono">版本 v{detail.version_number}</span>
              )}
              <span className="tabular-nums">更新于 {formatDate(detail.updated_at)}</span>
            </div>
            {detail.commit_message && (
              <p className="text-xs text-ink-light font-sans">提交说明：{detail.commit_message}</p>
            )}

            {/* 我的评分与私有备注 */}
            <div className="rounded-lg border border-dashed border-paper-grid bg-paper-grid/20 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <FieldLabel>我的评分</FieldLabel>
                <RatingStars
                  value={detail.user_rating || 0}
                  onChange={(r) => void handleUpdateRating(detail.id, r, detail.user_note)}
                  size="md"
                  showNumber
                />
              </div>
              <div className="space-y-1.5 pt-1">
                <FieldLabel>我的备注</FieldLabel>
                <div className="flex gap-2 items-start">
                  <Textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="输入该提示词的心得或适用场景…"
                    rows={2}
                    className="text-xs font-sans flex-1"
                  />
                  <Button
                    size="sm"
                    onClick={() => void handleSaveNote()}
                    isLoading={savingNote}
                    disabled={noteDraft === (detail.user_note ?? '')}
                  >
                    保存备注
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <FieldLabel>提示词内容</FieldLabel>
              <pre className="text-sm text-ink font-sans whitespace-pre-wrap bg-paper border border-paper-grid rounded-md p-3 max-h-48 overflow-y-auto">
                {detail.content || '（空内容）'}
              </pre>
            </div>

            {/* 调试：Bifrost 原始响应（raw=true） */}
            <div className="pt-1">
              <button
                onClick={() => void toggleRaw()}
                className="inline-flex items-center gap-1.5 text-xs text-ink-light hover:text-accent font-sans transition active:scale-95"
              >
                <Braces size={13} strokeWidth={1.5} className={rawLoading ? 'animate-pulse' : ''} />
                {rawOpen ? '收起原始响应' : rawLoading ? '加载原始响应中…' : '查看原始响应（调试）'}
              </button>
              {rawOpen && (
                <pre className="mt-2 text-[11px] leading-relaxed text-ink font-mono whitespace-pre-wrap bg-paper border border-paper-grid rounded-md p-3 max-h-64 overflow-y-auto">
                  {rawData || '（空）'}
                </pre>
              )}
            </div>
          </div>
        )}
      </Dialog>

      {/* 悬停大图浮层 */}
      {hoverPreview && (
        <div
          className="fixed z-[80] pointer-events-none transition-opacity duration-200 animate-in fade-in zoom-in-[0.98]"
          style={{ left: hoverPreview.x, top: hoverPreview.y }}
        >
          <div className="bg-paper border border-paper-grid rounded-xl shadow-xl p-1.5">
            <div className="relative rounded-md overflow-hidden after:absolute after:inset-0 after:rounded-md after:ring-1 after:ring-inset after:ring-black/5 dark:after:ring-white/5">
              <img src={hoverPreview.url} alt="" className="w-56 h-56 object-cover" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BifrostPromptsPage;
