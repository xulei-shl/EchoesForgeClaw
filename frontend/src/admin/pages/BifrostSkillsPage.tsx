import React, { useCallback, useState } from 'react';
import { Boxes, FolderSync, Loader2, RefreshCw, Search, StickyNote, Trash2, FileText, FolderTree } from 'lucide-react';
import { adminService } from '../../shared/services/admin';
import type { CachedBifrostSkill } from '../../shared/types';
import { Button } from '../../shared/components/ui/Button';
import { Card } from '../../shared/components/ui/Card';
import { Badge } from '../../shared/components/ui/Badge';
import { Dialog } from '../../shared/components/ui/Dialog';
import { Input } from '../../shared/components/ui/Input';
import { Select } from '../../shared/components/ui/Select';
import { RatingStars } from '../../shared/components/ui/RatingStars';
import { MarkdownViewer } from '../../shared/components/ui/MarkdownViewer';
import { PageHeader } from '../components/AdminBits';
import { useFeedback } from '../../shared/components/ui/FeedbackProvider';
import { SkillFileTree } from '../../shared/components/ui/SkillFileTree';
import { useBifrostSkills } from '../../library/bifrost/useBifrostSkills';

export const BifrostSkillsPage: React.FC = () => {
  const {
    items: skills,
    filteredItems: filteredSkills,
    total,
    loading,
    isRefreshing,
    loadingMore,
    hasMore,
    error,
    remoteAvailable,
    q,
    setQ,
    ratingFilter,
    setRatingFilter,
    tagFilter,
    setTagFilter,
    availableTags,
    sentinelRef,
    load,
  } = useBifrostSkills({
    pageSize: 60,
    fetcher: adminService.listBifrostSkills,
  });

  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [syncingAll, setSyncingAll] = useState(false);
  const [detail, setDetail] = useState<CachedBifrostSkill | null>(null);
  const [detailTab, setDetailTab] = useState<'doc' | 'files'>('doc');
  const { dialog, showToast } = useFeedback();

  /** 打开详情：先用列表信息即时渲染，再按需拉取完整详情（body/files）补齐 */
  const openDetail = useCallback(
    async (s: CachedBifrostSkill) => {
      setDetail(s);
      setDetailTab('doc');
      try {
        const full = await adminService.getBifrostSkillDetail(s.name);
        setDetail((prev) => (prev && prev.name === s.name ? { ...prev, ...full } : prev));
      } catch (e: any) {
        showToast(e?.message || '详情加载失败，已展示列表信息', { type: 'error' });
      }
    },
    [showToast]
  );

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
      await load(true);
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
      await load(true);
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
      await load(true);
    } catch (e: any) {
      showToast(e?.message || '删除失败，请重试', { type: 'error' });
    } finally {
      markBusy(s.name, false);
    }
  };

  const formatDate = (t?: number | string | null) => {
    if (t == null) return '';
    const d = typeof t === 'number' ? new Date(t * 1000) : new Date(t);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}/${m}/${day} ${h}:${min}`;
  };

  const anyBusy = syncingAll || busy.size > 0;
  const remoteUnavailable = skills.length > 0 && !remoteAvailable;

  return (
    <div>
      <PageHeader
        title="Bifrost Skills"
        subtitle="本地缓存的 skill 包（runtime/.agent/skills）+ 远端仓库运维；「同步最新/下载并缓存」覆盖共享包，个人打标与备注在 Library 库中管理"
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
              <RefreshCw size={14} strokeWidth={2} className={isRefreshing ? 'animate-spin' : ''} />
            </Button>
          </div>
        }
      />

      {/* 工具栏：搜索与星级过滤 */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
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
        <Select
          value={tagFilter}
          onChange={(val) => setTagFilter(val)}
          className="w-36"
          options={[
            { label: '全部标签', value: '' },
            ...availableTags.map((t) => ({ label: `#${t}`, value: t })),
          ]}
        />
        {(q || ratingFilter || tagFilter) && (
          <button
            onClick={() => {
              setQ('');
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
            共 <span className="tabular-nums font-mono text-ink font-medium">{total}</span> 个 Skill
          </span>
        </div>
      </div>

      {/* 首次冷启动骨架屏 */}
      {loading && skills.length === 0 && (
        <div className="space-y-3 animate-pulse" aria-busy="true" aria-label="正在加载 Skills">
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
                {q.trim() || ratingFilter || tagFilter
                  ? '尝试清除筛选条件'
                  : remoteAvailable
                  ? '在画布的 Skill 检索节点中安装过的 skill 会出现在这里；也可在上方搜索远端仓库后点「下载并缓存」'
                  : 'Bifrost 不可达时仅能管理本地已有缓存，同步操作会实时校验'}
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredSkills.map((s) => {
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
                          {isCached
                            ? (s.cached_version
                              ? <Badge variant={s.latest_version && s.cached_version !== s.latest_version ? 'warning' : 'success'}>
                                  本地 v{s.cached_version}
                                </Badge>
                              : <Badge>本地缓存</Badge>)
                            : <Badge>未缓存</Badge>}
                          {s.latest_version && <Badge>远端 v{s.latest_version}</Badge>}
                          {s.license && <Badge>{s.license}</Badge>}
                          {Boolean(s.user_rating && s.user_rating > 0) && (
                            <div onClick={(e) => e.stopPropagation()} className="ml-1">
                              <RatingStars
                                value={s.user_rating}
                                readonly
                                size="xs"
                              />
                            </div>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-ink-light font-sans line-clamp-2">
                          {s.description || '（无描述）'}
                        </p>
                        {s.user_tags && s.user_tags.length > 0 && (
                          <div className="flex items-center gap-1 mt-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                            {s.user_tags.slice(0, 3).map((tag) => (
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
                            {s.user_tags.length > 3 && (
                              <span className="text-[10px] text-ink-faint border border-dashed border-paper-grid px-1 rounded">
                                +{s.user_tags.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                        {noteText && (
                          <p className="mt-1.5 text-[11px] text-accent font-sans line-clamp-1 italic bg-accent-surface/50 px-2 py-0.5 rounded border border-accent/20 flex items-center gap-1 inline-flex">
                            <StickyNote size={11} strokeWidth={1.5} className="shrink-0" />
                            备注：{noteText}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-[10px] text-ink-faint font-sans tabular-nums flex-wrap">
                          <span>
                            {isCached
                              ? `${s.file_count ?? 0} 个文件`
                              : typeof s.file_count === 'number'
                                ? `远端 ${s.file_count} 个文件`
                                : '未下载'}
                          </span>
                          {isCached ? (
                            <span>本地更新：{formatDate(s.updated_at) || '—'}</span>
                          ) : (
                            s.remote_updated_at && <span>远端更新：{formatDate(s.remote_updated_at)}</span>
                          )}
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
              <div ref={sentinelRef} className="py-4 flex justify-center">
                {loadingMore && <Loader2 className="w-4 h-4 animate-spin text-ink-faint" />}
              </div>
              {!hasMore && filteredSkills.length > 0 && (
                <p className="text-xs text-ink-faint font-sans text-center py-4">
                  已加载全部 {total} 个技能
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
        panelClassName="max-w-2xl h-[800px] max-h-[88vh] flex flex-col"
        footer={
          <Button size="sm" onClick={() => setDetail(null)}>
            关闭
          </Button>
        }
      >
        {detail && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 flex-wrap text-xs text-ink-light font-sans -mt-2">
              {detail.cached !== false && (
                detail.cached_version
                  ? <Badge variant={detail.latest_version && detail.cached_version !== detail.latest_version ? 'warning' : 'success'}>
                      本地 v{detail.cached_version}
                    </Badge>
                  : <Badge>本地缓存</Badge>
              )}
              {detail.latest_version && <Badge>远端 v{detail.latest_version}</Badge>}
              {detail.license && <Badge>{detail.license}</Badge>}
              {detail.cached !== false ? (
                <span className="tabular-nums">本地更新于 {formatDate(detail.updated_at) || '—'}</span>
              ) : (
                detail.remote_updated_at && <span className="tabular-nums">远端更新于 {formatDate(detail.remote_updated_at)}</span>
              )}
            </div>
            
            {detail.description && (
              <p className="text-sm text-ink leading-relaxed">{detail.description}</p>
            )}

            {/* 个人标注信息（只读展示，在 Library 资源库中可编辑管理） */}
            {(Boolean(detail.user_rating) || (detail.user_tags && detail.user_tags.length > 0) || Boolean(detail.user_note || detail.note)) && (
              <div className="rounded-lg border border-dashed border-paper-grid bg-paper-grid/15 p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-serif font-semibold text-ink flex items-center gap-1.5">
                    <StickyNote size={13} className="text-accent" />
                    个人标注
                    <span className="text-[10px] font-sans text-ink-faint font-normal">（只读，在 Library 库中可编辑）</span>
                  </span>
                  {Boolean(detail.user_rating && detail.user_rating > 0) && (
                    <RatingStars
                      value={detail.user_rating}
                      readonly
                      size="sm"
                    />
                  )}
                </div>

                {detail.user_tags && detail.user_tags.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {detail.user_tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[11px] px-2 py-0.5 rounded-pill bg-accent-surface text-accent border border-accent/20 font-sans"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                {(detail.user_note || detail.note) && (
                  <p className="text-xs text-ink-light font-sans italic bg-paper/60 p-2 rounded border border-paper-grid/50">
                    {detail.user_note || detail.note}
                  </p>
                )}
              </div>
            )}

            {/* 详情选项卡：文档预览 vs 文件列表 */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 border-b border-paper-grid">
                <button
                  type="button"
                  onClick={() => setDetailTab('doc')}
                  className={`pb-2 px-1 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                    detailTab === 'doc'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-ink-light hover:text-ink'
                  }`}
                >
                  <FileText size={14} /> SKILL.md
                </button>
                <button
                  type="button"
                  onClick={() => setDetailTab('files')}
                  className={`pb-2 px-1 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                    detailTab === 'files'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-ink-light hover:text-ink'
                  }`}
                >
                  <FolderTree size={14} /> 文件列表 ({detail.files?.length ?? detail.file_count ?? 0})
                </button>
              </div>

              {/* SKILL.md 文档区 */}
              {detailTab === 'doc' && (
                <MarkdownViewer
                  content={detail.body}
                  emptyText="（暂无 SKILL.md 文档）"
                  copyable
                  className="max-h-[500px]"
                />
              )}

              {/* 文件树列表区 */}
              {detailTab === 'files' && (
                <SkillFileTree files={detail.files} maxHeightClass="max-h-[500px]" />
              )}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};

export default BifrostSkillsPage;

