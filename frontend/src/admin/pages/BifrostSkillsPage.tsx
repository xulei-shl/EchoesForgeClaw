import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, FolderSync, Loader2, RefreshCw, Search, StickyNote, Trash2, FileText, FolderTree } from 'lucide-react';
import { adminService, annotationService } from '../../shared/services/admin';
import type { CachedBifrostSkill } from '../../shared/types';
import { Button } from '../../shared/components/ui/Button';
import { Card } from '../../shared/components/ui/Card';
import { Badge } from '../../shared/components/ui/Badge';
import { Dialog } from '../../shared/components/ui/Dialog';
import { Input } from '../../shared/components/ui/Input';
import { Select } from '../../shared/components/ui/Select';
import { Textarea } from '../../shared/components/ui/Textarea';
import { RatingStars } from '../../shared/components/ui/RatingStars';
import { PageHeader, FieldLabel } from '../components/AdminBits';
import { useFeedback } from '../../shared/components/ui/FeedbackProvider';

/** 内存级 SWR 缓存：页面切换 0ms 瞬间秒开 */
let cachedBifrostSkillsData: CachedBifrostSkill[] | null = null;

export const BifrostSkillsPage: React.FC = () => {
  const [skills, setSkills] = useState<CachedBifrostSkill[]>(() => cachedBifrostSkillsData ?? []);
  const [loading, setLoading] = useState(() => !cachedBifrostSkillsData);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [syncingAll, setSyncingAll] = useState(false);
  const [detail, setDetail] = useState<CachedBifrostSkill | null>(null);
  const [q, setQ] = useState('');
  const [ratingFilter, setRatingFilter] = useState('');
  const [remoteAvailable, setRemoteAvailable] = useState(true);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const { dialog, showToast } = useFeedback();

  // 增量渲染：大目录先渲染前 N 条，触底自动加载更多（避免一次性渲染几百条卡片卡顿）
  const [visibleCount, setVisibleCount] = useState(60);
  const observerTarget = useRef<HTMLDivElement>(null);

  // 打开详情时同步备注草稿
  useEffect(() => {
    setNoteDraft(detail?.user_note ?? detail?.note ?? '');
  }, [detail]);

  /** 打开详情：先用列表信息即时渲染，再按需拉取完整详情（body/files）补齐 */
  const openDetail = useCallback(
    async (s: CachedBifrostSkill) => {
      setDetail(s);
      try {
        const full = await adminService.getBifrostSkillDetail(s.name);
        setDetail((prev) => (prev && prev.name === s.name ? { ...prev, ...full } : prev));
      } catch (e: any) {
        // 远端不可达等场景降级展示列表信息（无 body/files，弹窗相应位置显示「无内容」）
        showToast(e?.message || '详情加载失败，已展示列表信息', { type: 'error' });
      }
    },
    [showToast]
  );

  /** 保存用户的评分 */
  const handleUpdateRating = async (skillName: string, nextRating: number, currentNote?: string) => {
    try {
      const targetSkill = skills.find((s) => s.name === skillName);
      const res = await annotationService.setAnnotation({
        resource_type: 'bifrost_skill',
        resource_id: skillName,
        rating: nextRating,
        note: currentNote !== undefined ? currentNote : (targetSkill?.user_note ?? targetSkill?.note ?? ''),
      });
      setSkills((prev) =>
        prev.map((s) =>
          s.name === skillName
            ? { ...s, user_rating: res.rating, user_note: res.note, note: res.note }
            : s
        )
      );
      if (detail && detail.name === skillName) {
        setDetail({ ...detail, user_rating: res.rating, user_note: res.note, note: res.note });
      }
      showToast(nextRating > 0 ? `已评为 ${nextRating} 星` : '已清除评分', { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || '评分更新失败', { type: 'error' });
    }
  };

  /** 保存用户的私有备注 */
  const saveNote = async () => {
    if (!detail) return;
    setSavingNote(true);
    try {
      const res = await annotationService.setAnnotation({
        resource_type: 'bifrost_skill',
        resource_id: detail.name,
        rating: detail.user_rating ?? 0,
        note: noteDraft.trim(),
      });
      setDetail({ ...detail, user_rating: res.rating, user_note: res.note, note: res.note });
      setSkills((prev) =>
        prev.map((s) =>
          s.name === detail.name
            ? { ...s, user_rating: res.rating, user_note: res.note, note: res.note }
            : s
        )
      );
      showToast('备注已保存', { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || '保存失败，请重试', { type: 'error' });
    } finally {
      setSavingNote(false);
    }
  };

  /** 拉取列表（force=true 绕过后端 TTL 缓存强制刷新远端） */
  const load = useCallback(
    async (force = false, showLoading = true) => {
      if (showLoading && !cachedBifrostSkillsData) setLoading(true);
      setError('');
      try {
        const res = await adminService.listBifrostSkills({ q: q.trim() || undefined, force });
        const fetched = res.skills ?? [];
        if (!q.trim()) cachedBifrostSkillsData = fetched;
        setSkills(fetched);
        setRemoteAvailable(res.remote_available !== false);
      } catch (e: any) {
        if (!cachedBifrostSkillsData) setError(e?.message || '加载失败，请重试');
      } finally {
        setLoading(false);
      }
    },
    [q]
  );

  // 初次挂载立即拉取（零延迟），仅搜索词变化时防抖 350ms
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      void load(false, !cachedBifrostSkillsData);
      return;
    }
    const t = window.setTimeout(() => {
      void load(false, false);
    }, 350);
    return () => window.clearTimeout(t);
  }, [q, load]);

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

  // 客户端多维过滤
  const filteredSkills = useMemo(() => {
    return skills.filter((s) => {
      if (ratingFilter === '5' && (s.user_rating ?? 0) !== 5) return false;
      if (ratingFilter === '4+' && (s.user_rating ?? 0) < 4) return false;
      if (ratingFilter === '3+' && (s.user_rating ?? 0) < 3) return false;
      if (ratingFilter === 'rated' && !(s.user_rating && s.user_rating > 0)) return false;
      if (ratingFilter === 'unrated' && (s.user_rating && s.user_rating > 0)) return false;
      if (ratingFilter === 'noted' && !(s.user_note?.trim() || s.note?.trim())) return false;
      return true;
    });
  }, [skills, ratingFilter]);

  // 搜索词/筛选条件变化时重置增量渲染计数
  useEffect(() => {
    setVisibleCount(60);
  }, [q, ratingFilter]);

  // 触底自动加载更多（增量渲染，避免大目录一次性渲染卡顿）
  useEffect(() => {
    if (filteredSkills.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + 60, filteredSkills.length));
        }
      },
      { rootMargin: '200px' }
    );
    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }
    return () => observer.disconnect();
  }, [filteredSkills.length, visibleCount]);

  const anyBusy = syncingAll || busy.size > 0;
  const remoteUnavailable = skills.length > 0 && !remoteAvailable;

  return (
    <div>
      <PageHeader
        title="Bifrost Skills"
        subtitle="本地缓存的 skill 包（runtime/.agent/skills）+ 远端仓库浏览；「同步最新/下载并缓存」覆盖共享包，个人打标与备注独立存储"
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

      {/* 首次冷启动骨架屏 */}
      {loading && skills.length === 0 && (
        <div className="space-y-3 animate-pulse" aria-busy="true" aria-label="正在加载 Skills">
          <div className="h-9 w-64 bg-paper-grid/45 rounded-lg mb-4" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-4 rounded-lg border border-dashed border-paper-grid bg-node-bg space-y-2.5">
              <div className="flex justify-between items-center">
                <div className="h-5 w-40 bg-paper-grid/50 rounded" />
                <div className="h-4 w-20 bg-paper-grid/35 rounded" />
              </div>
              <div className="h-4 w-3/4 bg-paper-grid/30 rounded" />
              <div className="h-3 w-32 bg-paper-grid/25 rounded" />
            </div>
          ))}
        </div>
      )}

      {error && skills.length === 0 && (
        <div className="py-12 flex flex-col items-center gap-3">
          <span className="text-sm text-error font-sans">{error}</span>
          <Button variant="ghost" size="sm" onClick={() => void load(true)}>
            <RefreshCw size={14} strokeWidth={1.5} className="mr-1" />
            重试
          </Button>
        </div>
      )}

      {(skills.length > 0 || (!loading && !error)) && (
        <div>
          {/* 工具栏：搜索与星级过滤 */}
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search
                size={15}
                strokeWidth={1.5}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
              />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索 Bifrost 仓库…（含远端未缓存的 skill）"
                className="pl-9"
              />
            </div>
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
            {(q || ratingFilter) && (
              <button
                onClick={() => {
                  setQ('');
                  setRatingFilter('');
                }}
                className="text-sm text-accent hover:text-accent-hover font-sans active:scale-[0.96] transition-colors"
              >
                清除筛选
              </button>
            )}
          </div>

          {remoteUnavailable && (
            <p className="text-xs text-ink-faint font-sans mb-3">
              Bifrost 暂不可达，远端信息未加载（本地缓存仍可管理，同步操作会实时校验）
            </p>
          )}

          {filteredSkills.length === 0 ? (
            <Card className="py-14 flex flex-col items-center gap-3 text-center">
              <Boxes size={36} strokeWidth={1} className="text-ink-faint" />
              <p className="font-serif text-base text-ink">
                {remoteAvailable ? '暂无匹配的 Bifrost Skill' : '暂无缓存的 Bifrost Skill'}
              </p>
              <p className="text-sm text-ink-light font-sans">
                {q.trim() || ratingFilter
                  ? '尝试清除筛选条件'
                  : remoteAvailable
                  ? '在画布的 Skill 检索节点中安装过的 skill 会出现在这里；也可在上方搜索远端仓库后点「下载并缓存」'
                  : 'Bifrost 不可达时仅能管理本地已有缓存，同步操作会实时校验'}
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredSkills.slice(0, visibleCount).map((s) => {
                const isBusy = busy.has(s.name);
                const isCached = s.cached !== false;
                const noteText = s.user_note || s.note;
                return (
                  <Card 
                    key={s.name} 
                    className="p-4 cursor-pointer transition-colors duration-150 hover:border-accent/40 active:scale-[0.98] shadow-xs"
                    onClick={() => void openDetail(s)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-serif text-sm font-semibold text-ink">{s.name}</p>
                          {isCached ? <Badge>本地缓存</Badge> : <Badge>未缓存</Badge>}
                          {isCached && s.cached_version && (
                            <Badge variant={s.latest_version && s.cached_version !== s.latest_version ? 'warning' : 'success'}>
                              本地 v{s.cached_version}
                              {s.latest_version && s.cached_version !== s.latest_version && ` → 远端 v${s.latest_version}`}
                            </Badge>
                          )}
                          {s.latest_version && <Badge>远端 v{s.latest_version}</Badge>}
                          {s.license && <Badge>{s.license}</Badge>}
                          <div onClick={(e) => e.stopPropagation()} className="ml-1">
                            <RatingStars
                              value={s.user_rating || 0}
                              onChange={(r) => void handleUpdateRating(s.name, r, noteText)}
                              size="xs"
                            />
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-ink-light font-sans line-clamp-2">
                          {s.description || '（无描述）'}
                        </p>
                        {noteText && (
                          <p className="mt-1.5 text-[11px] text-accent font-sans line-clamp-1 italic bg-accent-surface/50 px-2 py-0.5 rounded border border-accent/20 flex items-center gap-1 inline-flex">
                            <StickyNote size={11} strokeWidth={1.5} className="shrink-0" />
                            备注：{noteText}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-[10px] text-ink-faint font-sans tabular-nums">
                          <span>
                            {isCached
                              ? `${s.file_count ?? 0} 个文件`
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
              {filteredSkills.length > 0 && visibleCount < filteredSkills.length && (
                <div ref={observerTarget} className="py-4 flex justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-ink-faint" />
                </div>
              )}
              {filteredSkills.length > 60 && visibleCount >= filteredSkills.length && (
                <p className="text-xs text-ink-faint font-sans text-center py-4">
                  已加载全部 {filteredSkills.length} 个
                </p>
              )}
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
              {detail.cached !== false && detail.cached_version && (
                <Badge variant={detail.latest_version && detail.cached_version !== detail.latest_version ? 'warning' : 'success'}>
                  本地 v{detail.cached_version}
                  {detail.latest_version && detail.cached_version !== detail.latest_version && ` → 远端 v${detail.latest_version}`}
                </Badge>
              )}
              {detail.latest_version && <Badge>远端 v{detail.latest_version}</Badge>}
              {detail.license && <Badge>{detail.license}</Badge>}
              <span className="tabular-nums">本地更新于 {formatDate(detail.updated_at) || '—'}</span>
            </div>
            
            {detail.description && (
              <p className="text-sm text-ink leading-relaxed">{detail.description}</p>
            )}

            {/* 我的评分与私有备注 */}
            <div className="rounded-lg border border-dashed border-paper-grid bg-paper-grid/20 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <FieldLabel>我的评分</FieldLabel>
                <RatingStars
                  value={detail.user_rating || 0}
                  onChange={(r) => void handleUpdateRating(detail.name, r, detail.user_note ?? detail.note)}
                  size="md"
                  showNumber
                />
              </div>
              <div className="space-y-1.5 pt-1">
                <FieldLabel>
                  <StickyNote size={13} className="inline mr-1" />
                  我的备注
                </FieldLabel>
                <div className="flex gap-2 items-start">
                  <Textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="填写当前账户对该 Skill 的私有备注（如使用场景、注意事项）…"
                    rows={2}
                    maxLength={500}
                    className="text-xs font-sans flex-1"
                  />
                  <Button
                    size="sm"
                    isLoading={savingNote}
                    disabled={noteDraft === (detail.user_note ?? detail.note ?? '')}
                    onClick={() => void saveNote()}
                  >
                    保存备注
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <FieldLabel>
                <FileText size={14} className="inline mr-1" />
                SKILL.md 内容
              </FieldLabel>
              <pre className="text-xs text-ink-light font-sans whitespace-pre-wrap bg-paper border border-paper-grid rounded-md p-3 max-h-48 overflow-y-auto custom-scrollbar">
                {detail.body || '（无内容）'}
              </pre>
            </div>

            {Array.isArray(detail.files) && detail.files.length > 0 && (
              <div className="space-y-1.5">
                <FieldLabel>
                  <FolderTree size={14} className="inline mr-1" />
                  文件结构（<span className="tabular-nums">{detail.files.length}</span> 个）
                </FieldLabel>
                <div className="bg-paper border border-paper-grid rounded-md p-3 max-h-36 overflow-y-auto custom-scrollbar space-y-1">
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

