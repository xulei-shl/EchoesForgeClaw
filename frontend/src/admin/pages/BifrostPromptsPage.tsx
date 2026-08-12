import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Braces,
  ImageOff,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { adminService } from '../../platform/services/admin';
import type { BifrostFolder, BifrostPrompt } from '../../platform/types';
import { Button } from '../../platform/components/ui/Button';
import { Input } from '../../platform/components/ui/Input';
import { Select } from '../../platform/components/ui/Select';
import { Dialog } from '../../platform/components/ui/Dialog';
import { Card } from '../../platform/components/ui/Card';
import { Badge } from '../../platform/components/ui/Badge';
import { FieldLabel, PageHeader } from '../components/AdminBits';
import { useFeedback } from '../../platform/components/ui/FeedbackProvider';

export const BifrostPromptsPage: React.FC = () => {
  const [folders, setFolders] = useState<BifrostFolder[]>([]);
  const [prompts, setPrompts] = useState<BifrostPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [q, setQ] = useState('');
  const [folderId, setFolderId] = useState('');

  const [detail, setDetail] = useState<BifrostPrompt | null>(null);
  const [uploading, setUploading] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawData, setRawData] = useState<string>('');
  const [rawLoading, setRawLoading] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{ x: number; y: number; url: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { dialog, showToast } = useFeedback();

  // 白名单只读展示（配置在 /admin/settings）：当前白名单文件夹名称列表
  const [wlFolderNames, setWlFolderNames] = useState<string[]>([]);
  const [wlConfigured, setWlConfigured] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [folderRes, promptRes, settingRes] = await Promise.all([
        adminService.listBifrostFolders(),
        adminService.listBifrostPrompts({
          folder_id: folderId || undefined,
          q: q || undefined,
        }),
        adminService.listSettings(),
      ]);
      setFolders(folderRes.folders);
      setPrompts(promptRes.prompts);
      // 白名单只读回显：把设置里的 ID/名称映射为文件夹名称列表
      const raw = (settingRes.find((s) => s.key === 'bitfrost.allowed_folders')?.value || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      setWlConfigured(raw.length > 0);
      if (raw.length) {
        const names = new Set<string>();
        for (const f of folderRes.folders) {
          if (raw.includes(String(f.id).toLowerCase()) || raw.includes((f.name || '').toLowerCase())) {
            names.add(f.name);
          }
        }
        setWlFolderNames([...names]);
      } else {
        setWlFolderNames([]);
      }
    } catch (e: any) {
      setError(e?.message || '加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [folderId, q]);

  useEffect(() => {
    load();
  }, [load]);

  // 搜索防抖：仅当关键词变化时触发（文件夹变化由上方 load 依赖 effect 直接加载，避免重复请求）
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

  return (
    <div>
      <PageHeader
        title="Bifrost 提示词"
        subtitle="浏览 / 检索 Bifrost Prompt Repository；正文编辑请在 Bifrost 后台进行，预览图在此管理"
        actions={
          <Button size="sm" variant="ghost" onClick={() => void load()} title="刷新">
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
            中管理（bitfrost.base_url / bitfrost.username / bitfrost.password）。
          </p>
        </Card>
      )}

      {/* 工具栏 */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
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
        {/* 白名单只读展示（配置入口在系统设置） */}
        {wlConfigured && (
          <Link
            to="/admin/settings"
            title="在系统设置中调整白名单文件夹"
            className="flex items-center gap-1.5 h-10 px-3 rounded-md border border-dashed border-accent/40 bg-accent/5 text-sm text-accent font-sans hover:bg-accent/10 transition-colors"
          >
            <ShieldCheck size={14} strokeWidth={1.5} />
            <span className="hidden md:inline truncate max-w-[14rem]">
              白名单：{wlFolderNames.join('、') || '已配置'}
            </span>
            <span className="md:hidden">白名单已配置</span>
          </Link>
        )}
        {(q || folderId) && (
          <button
            onClick={() => {
              setQ('');
              setFolderId('');
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
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            <RefreshCw size={14} strokeWidth={1.5} className="mr-1" />
            重试
          </Button>
        </div>
      )}

      {/* 提示词网格 */}
      {!loading && !error && (
        <div>
          {prompts.length === 0 ? (
            <Card className="py-14 flex flex-col items-center gap-3 text-center">
              <BookOpen size={36} strokeWidth={1} className="text-ink-faint" />
              <p className="font-serif text-base text-ink">没有匹配的提示词</p>
              <p className="text-sm text-ink-light font-sans">
                {q.trim() || folderId
                  ? '尝试清除筛选条件'
                  : '请先在 Bifrost 后台创建提示词'}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {prompts.map((p) => (
                <Card
                  key={p.id}
                  className="p-2.5 rounded-2xl cursor-pointer transition hover:shadow-md active:scale-[0.96]"
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
                  <div className="px-1 pt-2 pb-1 antialiased">
                    <p className="font-serif text-sm font-semibold text-ink truncate" title={p.name}>
                      {p.name}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-light font-sans line-clamp-2">
                      {p.content || '（空内容）'}
                    </p>
                    <div className="flex items-center gap-2 mt-3">
                      {p.folder_name && <Badge>{p.folder_name}</Badge>}
                      <span className="text-[10px] text-ink-faint font-sans tabular-nums">
                        {formatDate(p.updated_at)}
                      </span>
                    </div>
                  </div>
                </Card>
              ))}
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
      >
        {detail && (
          <div className="space-y-6">
            <div className="p-1 rounded-xl border border-dashed border-paper-grid bg-paper overflow-hidden">
              {detail.preview_image ? (
                <div className="relative rounded-lg overflow-hidden after:absolute after:inset-0 after:rounded-lg after:ring-1 after:ring-inset after:ring-black/5 dark:after:ring-white/5">
                  <img src={detail.preview_image} alt={detail.name} className="w-full max-h-72 object-contain" />
                </div>
              ) : (
                <div className="h-36 flex flex-col items-center justify-center gap-2 text-ink-faint">
                  <ImageOff size={28} strokeWidth={1} />
                  <span className="text-xs font-sans">暂无预览图</span>
                </div>
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

            <div className="space-y-1.5">
              <FieldLabel>提示词内容（来自最新版本）</FieldLabel>
              <pre className="text-sm text-ink font-sans whitespace-pre-wrap bg-paper border border-paper-grid rounded-md p-3 max-h-60 overflow-y-auto">
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

            <div className="space-y-1.5">
              <FieldLabel>预览图</FieldLabel>
              <div className="flex items-center gap-2">
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
              <p className="text-xs text-ink-light font-sans">
                图片存于本地（{detail.preview_image ? '已配置' : '未配置'}），画布检索节点悬停 / 详情时展示
              </p>
            </div>

            <div className="flex justify-end pt-2 border-t border-dashed border-paper-grid">
              <Button size="sm" onClick={() => setDetail(null)}>
                关闭
              </Button>
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
