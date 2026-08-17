import React, { useCallback, useEffect, useState } from 'react';
import { Boxes, FolderSync, Loader2, RefreshCw, Search, Trash2, FileText, FolderTree } from 'lucide-react';
import { adminService } from '../../platform/services/admin';
import type { CachedBifrostSkill } from '../../platform/types';
import { Button } from '../../platform/components/ui/Button';
import { Card } from '../../platform/components/ui/Card';
import { Badge } from '../../platform/components/ui/Badge';
import { Dialog } from '../../platform/components/ui/Dialog';
import { Input } from '../../platform/components/ui/Input';
import { PageHeader, FieldLabel } from '../components/AdminBits';
import { useFeedback } from '../../platform/components/ui/FeedbackProvider';

export const BifrostSkillsPage: React.FC = () => {
  const [skills, setSkills] = useState<CachedBifrostSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [syncingAll, setSyncingAll] = useState(false);
  const [detail, setDetail] = useState<CachedBifrostSkill | null>(null);
  const [q, setQ] = useState('');
  const [remoteAvailable, setRemoteAvailable] = useState(true);
  const { dialog, showToast } = useFeedback();

  /** 拉取列表（force=true 绕过后端 TTL 缓存强制刷新远端；搜索词变化自动触发） */
  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      setError('');
      try {
        const res = await adminService.listBifrostSkills({ q: q.trim() || undefined, force });
        setSkills(res.skills ?? []);
        setRemoteAvailable(res.remote_available !== false);
      } catch (e: any) {
        setError(e?.message || '加载失败，请重试');
      } finally {
        setLoading(false);
      }
    },
    [q]
  );

  // 初始加载 + 搜索防抖（停止输入 350ms 后重新拉取；刷新按钮走 force 直调）
  useEffect(() => {
    const t = window.setTimeout(() => {
      void load();
    }, 350);
    return () => window.clearTimeout(t);
  }, [load]);

  const markBusy = useCallback((name: string, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  }, []);

  const syncOne = async (s: CachedBifrostSkill) => {
    markBusy(s.name, true);
    try {
      await adminService.syncBifrostSkill(s.name);
      showToast(`「${s.name}」已同步最新版本`, { type: 'success' });
      await load();
    } catch (e: any) {
      showToast(e?.message || '同步失败，请重试', { type: 'error' });
    } finally {
      markBusy(s.name, false);
    }
  };

  /** 已缓存的 skill */
  const cachedSkills = skills.filter((s) => s.cached !== false);
  /** 全部未缓存时改为全部下载，否则只同步已缓存项 */
  const syncTargets = cachedSkills.length > 0 ? cachedSkills : skills;

  const syncAll = async () => {
    if (!syncTargets.length) return;
    const isDownloadAll = syncTargets === skills;
    const ok = await dialog.confirm({
      title: '同步全部',
      message: isDownloadAll
        ? `将从 Bifrost 逐个下载全部 ${syncTargets.length} 个远端 skill 到本地共享缓存，确定继续？`
        : `将从 Bifrost 逐个拉取 ${syncTargets.length} 个已缓存 skill 的最新版本并覆盖本地共享包，确定继续？`,
      confirmText: '同步全部',
    });
    if (!ok) return;
    setSyncingAll(true);
    try {
      for (const s of syncTargets) {
        await adminService.syncBifrostSkill(s.name);
      }
      showToast('全部 skill 已同步', { type: 'success' });
      await load();
    } catch (e: any) {
      showToast(e?.message || '同步中断，请重试', { type: 'error' });
    } finally {
      setSyncingAll(false);
    }
  };

  const removeOne = async (s: CachedBifrostSkill) => {
    const ok = await dialog.confirm({
      title: '删除 skill',
      message: `确定从共享区彻底删除「${s.name}」吗？指向它的用户登记软链会一并清理，之后画布安装会重新下载。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    markBusy(s.name, true);
    try {
      const res = await adminService.deleteBifrostSkill(s.name);
      showToast(
        res.cleaned_registries > 0
          ? `已删除「${s.name}」，并清理 ${res.cleaned_registries} 个用户登记`
          : `已删除「${s.name}」`,
        { type: 'success' }
      );
      await load();
    } catch (e: any) {
      showToast(e?.message || '删除失败，请重试', { type: 'error' });
    } finally {
      markBusy(s.name, false);
    }
  };

  const formatDate = (t?: number | string | null) => {
    if (t == null) return '';
    const d = typeof t === 'number' ? new Date(t * 1000) : new Date(t);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { hour12: false });
  };

  const anyBusy = syncingAll || busy.size > 0;
  const remoteUnavailable = skills.length > 0 && !remoteAvailable;

  return (
    <div>
      <PageHeader
        title="Bifrost Skills"
        subtitle="本地缓存的 skill 包（runtime/.agent/skills）+ 远端仓库浏览；「同步最新/下载并缓存」覆盖所有用户共享的同一份，画布上再次安装走本地缓存秒级完成"
        actions={
          <div className="flex items-center gap-2">
            {skills.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void syncAll()}
                isLoading={syncingAll}
                disabled={anyBusy}
              >
                <FolderSync size={14} strokeWidth={2} className="mr-1" />
                同步全部
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void load(true)} title="刷新（强制拉取 Bifrost 最新信息）">
              <RefreshCw size={14} strokeWidth={2} className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
        }
      />

      {loading && (
        <Card className="p-10 flex items-center justify-center gap-2 text-ink-light text-sm font-sans">
          <Loader2 className="w-4 h-4 animate-spin text-accent" strokeWidth={1.5} />
          加载中...
        </Card>
      )}

      {!loading && error && (
        <div className="py-12 flex flex-col items-center gap-3">
          <span className="text-sm text-error font-sans">{error}</span>
          <Button variant="ghost" size="sm" onClick={() => void load(true)}>
            <RefreshCw size={14} strokeWidth={1.5} className="mr-1" />
            重试
          </Button>
        </div>
      )}

      {!loading && !error && (
        <div>
          {/* 搜索远端仓库（含未缓存的 skill） */}
          <div className="relative mb-3">
            <Search
              size={15}
              strokeWidth={1.5}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索 Bifrost 仓库…（含远端未缓存的 skill，点「下载并缓存」拉取）"
              className="pl-9"
            />
          </div>
          {remoteUnavailable && (
            <p className="text-xs text-ink-faint font-sans mb-3">
              Bifrost 暂不可达，远端信息未加载（本地缓存仍可管理，同步操作会实时校验）
            </p>
          )}
          {skills.length === 0 ? (
            <Card className="py-14 flex flex-col items-center gap-3 text-center">
              <Boxes size={36} strokeWidth={1} className="text-ink-faint" />
              <p className="font-serif text-base text-ink">
                {remoteAvailable ? '暂无匹配的 Bifrost Skill' : '暂无缓存的 Bifrost Skill'}
              </p>
              <p className="text-sm text-ink-light font-sans">
                {remoteAvailable
                  ? '在画布的 Skill 检索节点中安装过的 skill 会出现在这里；也可在上方搜索远端仓库后点「下载并缓存」'
                  : 'Bifrost 不可达时仅能管理本地已有缓存，同步操作会实时校验'}
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {skills.map((s) => {
                const isBusy = busy.has(s.name);
                const isCached = s.cached !== false;
                return (
                  <Card 
                    key={s.name} 
                    className="p-4 cursor-pointer transition hover:shadow-md active:scale-[0.96]"
                    onClick={() => setDetail(s)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-serif text-sm font-semibold text-ink">{s.name}</p>
                          {isCached ? <Badge>本地缓存</Badge> : <Badge>未缓存</Badge>}
                          {s.latest_version && <Badge>远端 v{s.latest_version}</Badge>}
                          {s.license && <Badge>{s.license}</Badge>}
                        </div>
                        <p className="mt-1 text-xs text-ink-light font-sans line-clamp-2">
                          {s.description || '（无描述）'}
                        </p>
                        <div className="flex items-center gap-3 mt-2 text-[10px] text-ink-faint font-sans tabular-nums">
                          <span>
                            {isCached
                              ? `${s.files.length} 个文件`
                              : typeof s.file_count === 'number'
                                ? `远端 ${s.file_count} 个文件`
                                : '未下载'}
                          </span>
                          {isCached && <span>本地更新：{formatDate(s.updated_at) || '—'}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="secondary"
                          isLoading={isBusy}
                          disabled={anyBusy && !isBusy}
                          onClick={(e) => { e.stopPropagation(); void syncOne(s); }}
                        >
                          <FolderSync size={14} strokeWidth={1.5} className="mr-1" />
                          {isCached ? '同步最新' : '下载并缓存'}
                        </Button>
                        {isCached && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={anyBusy}
                            onClick={(e) => { e.stopPropagation(); void removeOne(s); }}
                            className="text-error hover:bg-error/10"
                          >
                            <Trash2 size={14} strokeWidth={1.5} className="mr-1" />
                            删除
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 详情弹窗 */}
      <Dialog
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? detail.name : ''}
        panelClassName="max-w-2xl"
        footer={
          <Button size="sm" onClick={() => setDetail(null)}>
            关闭
          </Button>
        }
      >
        {detail && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 flex-wrap text-xs text-ink-light font-sans -mt-2">
              {detail.latest_version && <Badge>远端 v{detail.latest_version}</Badge>}
              {detail.license && <Badge>{detail.license}</Badge>}
              <span className="tabular-nums">本地更新于 {formatDate(detail.updated_at) || '—'}</span>
            </div>
            
            {detail.description && (
              <p className="text-sm text-ink leading-relaxed">{detail.description}</p>
            )}

            <div className="space-y-1.5">
              <FieldLabel>
                <FileText size={14} className="inline mr-1" />
                SKILL.md 内容
              </FieldLabel>
              <pre className="text-xs text-ink-light font-sans whitespace-pre-wrap bg-paper border border-paper-grid rounded-md p-3 max-h-60 overflow-y-auto custom-scrollbar">
                {detail.body || '（无内容）'}
              </pre>
            </div>

            {Array.isArray(detail.files) && detail.files.length > 0 && (
              <div className="space-y-1.5">
                <FieldLabel>
                  <FolderTree size={14} className="inline mr-1" />
                  文件结构（<span className="tabular-nums">{detail.files.length}</span> 个）
                </FieldLabel>
                <div className="bg-paper border border-paper-grid rounded-md p-3 max-h-48 overflow-y-auto custom-scrollbar space-y-1">
                  {detail.files.map((f) => (
                    <p key={f} className="text-[11px] text-ink-light font-mono truncate pl-3 border-l-2 border-paper-grid/60 hover:bg-paper-grid/20 rounded-r transition-colors px-1 py-0.5">
                      {f}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
};

export default BifrostSkillsPage;
