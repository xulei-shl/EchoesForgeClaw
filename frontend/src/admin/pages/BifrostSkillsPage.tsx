import React, { useCallback, useEffect, useState } from 'react';
import { Boxes, FolderSync, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { adminService } from '../../platform/services/admin';
import type { CachedBifrostSkill } from '../../platform/types';
import { Button } from '../../platform/components/ui/Button';
import { Card } from '../../platform/components/ui/Card';
import { Badge } from '../../platform/components/ui/Badge';
import { PageHeader } from '../components/AdminBits';
import { useFeedback } from '../../platform/components/ui/FeedbackProvider';

export const BifrostSkillsPage: React.FC = () => {
  const [skills, setSkills] = useState<CachedBifrostSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [syncingAll, setSyncingAll] = useState(false);
  const { dialog, showToast } = useFeedback();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminService.listBifrostSkills();
      setSkills(res.skills ?? []);
    } catch (e: any) {
      setError(e?.message || '加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
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

  const syncAll = async () => {
    if (!skills.length) return;
    const ok = await dialog.confirm({
      title: '同步全部',
      message: `将从 Bifrost 逐个拉取 ${skills.length} 个 skill 的最新版本并覆盖本地共享包，确定继续？`,
      confirmText: '同步全部',
    });
    if (!ok) return;
    setSyncingAll(true);
    try {
      for (const s of skills) {
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
  const remoteUnavailable = skills.length > 0 && skills.every((s) => !s.latest_version);

  return (
    <div>
      <PageHeader
        title="Bifrost Skills"
        subtitle="服务器本地缓存的 Bifrost skill 包（runtime/.agent/skills）；「同步最新」覆盖所有用户共享的同一份，画布上再次安装走本地缓存秒级完成"
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
            <Button size="sm" variant="ghost" onClick={() => void load()} title="刷新">
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
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            <RefreshCw size={14} strokeWidth={1.5} className="mr-1" />
            重试
          </Button>
        </div>
      )}

      {!loading && !error && (
        <div>
          {remoteUnavailable && (
            <p className="text-xs text-ink-faint font-sans mb-3">
              Bifrost 暂不可达，远端版本信息未加载（本地缓存仍可管理，同步操作会实时校验）
            </p>
          )}
          {skills.length === 0 ? (
            <Card className="py-14 flex flex-col items-center gap-3 text-center">
              <Boxes size={36} strokeWidth={1} className="text-ink-faint" />
              <p className="font-serif text-base text-ink">暂无缓存的 Bifrost Skill</p>
              <p className="text-sm text-ink-light font-sans">
                在画布的 Skill 检索节点中安装过的 skill 会出现在这里；也可在此手动同步或删除
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {skills.map((s) => {
                const isBusy = busy.has(s.name);
                return (
                  <Card key={s.name} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-serif text-sm font-semibold text-ink">{s.name}</p>
                          {s.latest_version && <Badge>远端 v{s.latest_version}</Badge>}
                          {s.license && <Badge>{s.license}</Badge>}
                        </div>
                        <p className="mt-1 text-xs text-ink-light font-sans line-clamp-2">
                          {s.description || '（无描述）'}
                        </p>
                        <div className="flex items-center gap-3 mt-2 text-[10px] text-ink-faint font-sans tabular-nums">
                          <span>{s.files.length} 个文件</span>
                          <span>本地更新：{formatDate(s.updated_at) || '—'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="secondary"
                          isLoading={isBusy}
                          disabled={anyBusy && !isBusy}
                          onClick={() => void syncOne(s)}
                        >
                          <FolderSync size={14} strokeWidth={1.5} className="mr-1" />
                          同步最新
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={anyBusy}
                          onClick={() => void removeOne(s)}
                          className="text-error hover:bg-error/10"
                        >
                          <Trash2 size={14} strokeWidth={1.5} className="mr-1" />
                          删除
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BifrostSkillsPage;
