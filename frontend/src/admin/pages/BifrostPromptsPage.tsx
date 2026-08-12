import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Braces,
  Check,
  ChevronDown,
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

  // 白名单文件夹多选（显示名称、保存 ID；留空 = 允许全部）
  const [wlOpen, setWlOpen] = useState(false);
  const [wlLoading, setWlLoading] = useState(false);
  const [allFolders, setAllFolders] = useState<BifrostFolder[]>([]);
  const [wlSelected, setWlSelected] = useState<Set<string>>(new Set());
  const [wlSaving, setWlSaving] = useState(false);
  const wlRef = useRef<HTMLDivElement>(null);
  // 防抖保存：快速切换多个文件夹时只发最后一次请求，避免 updateSetting 乱序落库
  const wlTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [folderRes, promptRes] = await Promise.all([
        adminService.listBifrostFolders(),
        adminService.listBifrostPrompts({
          folder_id: folderId || undefined,
          q: q || undefined,
        }),
      ]);
      setFolders(folderRes.folders);
      setPrompts(promptRes.prompts);
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

  // 白名单下拉：点击外部关闭
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wlRef.current && !wlRef.current.contains(e.target as Node)) {
        setWlOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // 展开下拉时加载全部文件夹 + 当前白名单设置（兼容 ID 或名称），保证数据最新
  const openWhitelist = useCallback(async () => {
    setWlOpen((v) => {
      if (v) return false;
      void (async () => {
        setWlLoading(true);
        try {
          const [folderRes, settingRes] = await Promise.all([
            adminService.listBifrostFolders({ all: true }),
            adminService.listSettings(),
          ]);
          setAllFolders(folderRes.folders);
          const raw = (settingRes.find((s) => s.key === 'bitfrost.allowed_folders')?.value || '')
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean);
          const selected = new Set<string>();
          if (raw.length) {
            for (const f of folderRes.folders) {
              // 匹配 ID 或名称（设置里可能是旧的手填名称）
              if (
                raw.includes(String(f.id).toLowerCase()) ||
                raw.includes((f.name || '').toLowerCase())
              ) {
                selected.add(f.id);
              }
            }
          }
          setWlSelected(selected);
        } catch {
          // 白名单加载失败不阻断主列表
        } finally {
          setWlLoading(false);
        }
      })();
      return true;
    });
  }, []);

  const saveWhitelist = useCallback(async (next: Set<string>) => {
    setWlSaving(true);
    try {
      const ids = [...next];
      await adminService.updateSetting('bitfrost.allowed_folders', {
        value: ids.join(','),
        description:
          'Bifrost 白名单文件夹（逗号分隔的文件夹 ID；留空 = 允许全部；仅白名单内的提示词出现在管理页与画布检索列表）',
      });
      showToast(ids.length ? `已保存白名单：${ids.length} 个文件夹` : '已清空白名单（允许全部）', {
        type: 'success',
      });
      await load();
    } catch (e: any) {
      showToast(e?.message || '保存白名单失败，请重试', { type: 'error' });
    } finally {
      setWlSaving(false);
    }
  }, [load, showToast]);

  const saveWhitelistRef = useRef(saveWhitelist);
  saveWhitelistRef.current = saveWhitelist;

  // 勾选立即更新 UI，防抖 300ms 后只发最后一次保存请求
  const toggleWhitelist = useCallback((folderId: string) => {
    setWlSelected((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      if (wlTimer.current) window.clearTimeout(wlTimer.current);
      wlTimer.current = window.setTimeout(() => {
        void saveWhitelistRef.current(next);
      }, 300);
      return next;
    });
  }, []);

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
      <div className="flex items-center gap-3 mb-4">
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
        {/* 白名单文件夹多选 */}
        <div className="relative" ref={wlRef}>
          <button
            type="button"
            onClick={() => void openWhitelist()}
            title="设置白名单文件夹：仅这些文件夹下的提示词出现在管理页与画布检索列表"
            className="flex items-center gap-1.5 h-10 px-3 rounded-md border border-dashed border-paper-grid text-sm text-ink font-sans hover:border-accent hover:text-accent transition-colors"
          >
            <ShieldCheck size={14} strokeWidth={1.5} className={wlSelected.size ? 'text-accent' : 'text-ink-faint'} />
            <span>白名单</span>
            {wlSelected.size > 0 && (
              <span className="text-[10px] font-mono text-accent border border-accent/40 bg-accent/5 rounded-pill px-1.5">
                {wlSelected.size}
              </span>
            )}
            <ChevronDown size={14} className="text-ink-faint" />
          </button>
          {wlOpen && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-paper border border-dashed border-paper-grid rounded-md shadow-xl z-50 overflow-hidden">
              <div className="px-3 py-2 border-b border-dashed border-paper-grid">
                <p className="text-xs text-ink-light font-sans">
                  仅选中的文件夹下的提示词会显示；不选 = 允许全部
                </p>
              </div>
              <div className="max-h-60 overflow-y-auto py-1">
                {wlLoading ? (
                  <p className="px-3 py-4 flex items-center justify-center gap-2 text-xs text-ink-faint font-sans">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" strokeWidth={1.5} />
                    加载文件夹…
                  </p>
                ) : allFolders.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-ink-faint font-sans text-center">暂无文件夹</p>
                ) : (
                  allFolders.map((f) => {
                    const checked = wlSelected.has(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => toggleWhitelist(f.id)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-paper-grid/40 transition-colors"
                      >
                        <span
                          className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ${
                            checked ? 'bg-accent border-accent text-white' : 'border-paper-grid text-transparent'
                          }`}
                        >
                          <Check size={12} strokeWidth={2.5} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                        {typeof f.prompts_count === 'number' && (
                          <span className="shrink-0 text-[10px] text-ink-faint font-mono tabular-nums">
                            {f.prompts_count}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
              <div className="flex items-center justify-between px-3 py-2 border-t border-dashed border-paper-grid">
                <button
                  type="button"
                  disabled={wlSaving}
                  onClick={() => {
                    setWlSelected(new Set());
                    void saveWhitelist(new Set());
                  }}
                  className="text-xs text-ink-light hover:text-error font-sans transition-colors disabled:opacity-50"
                >
                  清空（允许全部）
                </button>
                {wlSaving && <Loader2 size={13} className="animate-spin text-accent" strokeWidth={1.5} />}
              </div>
            </div>
          )}
        </div>
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
                  className="p-3 cursor-pointer transition hover:shadow-md active:scale-[0.99]"
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
                  <div className="h-32 rounded-md overflow-hidden bg-paper border border-dashed border-paper-grid flex items-center justify-center">
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
                  <p className="mt-2 font-serif text-sm font-semibold text-ink truncate" title={p.name}>
                    {p.name}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-light font-sans line-clamp-2">
                    {p.content || '（空内容）'}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    {p.folder_name && <Badge>{p.folder_name}</Badge>}
                    <span className="text-[10px] text-ink-faint font-sans tabular-nums">
                      {formatDate(p.updated_at)}
                    </span>
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
          <div className="space-y-4">
            <div className="rounded-md border border-dashed border-paper-grid bg-paper overflow-hidden">
              {detail.preview_image ? (
                <img src={detail.preview_image} alt={detail.name} className="w-full max-h-72 object-contain" />
              ) : (
                <div className="h-36 flex flex-col items-center justify-center gap-2 text-ink-faint">
                  <ImageOff size={28} strokeWidth={1} />
                  <span className="text-xs font-sans">暂无预览图</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap text-xs text-ink-light font-sans">
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
          className="fixed z-[80] pointer-events-none"
          style={{ left: hoverPreview.x, top: hoverPreview.y }}
        >
          <div className="bg-paper border border-dashed border-paper-grid rounded-lg shadow-xl p-1.5">
            <img src={hoverPreview.url} alt="" className="w-56 h-56 object-cover rounded" />
          </div>
        </div>
      )}
    </div>
  );
};

export default BifrostPromptsPage;
