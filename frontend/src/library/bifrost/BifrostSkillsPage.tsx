import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Boxes,
  CheckSquare,
  Download,
  FileText,
  FolderTree,
  Loader2,
  PlusCircle,
  RefreshCw,
  Search,
  Square,
  StickyNote,
} from 'lucide-react';
import { Navbar } from '../../shared/components/layout/Navbar';
import { bifrostService } from '../../shared/services/bifrost';
import type { CachedBifrostSkill, SkillSelection } from '../../shared/types';
import { Button } from '../../shared/components/ui/Button';
import { Card } from '../../shared/components/ui/Card';
import { Badge } from '../../shared/components/ui/Badge';
import { Drawer } from '../../shared/components/ui/Drawer';
import { Input } from '../../shared/components/ui/Input';
import { Select } from '../../shared/components/ui/Select';
import { RatingStars } from '../../shared/components/ui/RatingStars';
import { NoteEditModal } from '../../shared/components/ui/NoteEditModal';
import { MarkdownViewer } from '../../shared/components/ui/MarkdownViewer';
import { useFeedback } from '../../shared/components/ui/FeedbackProvider';
import { SkillFileTree } from '../../shared/components/ui/SkillFileTree';
import { ViewToggle, type ViewMode } from '../../shared/components/ui/ViewToggle';
import { useBifrostSkills } from './useBifrostSkills';

export const BifrostSkillsPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useFeedback();

  const {
    items: skills,
    filteredItems,
    total,
    loading,
    isRefreshing,
    loadingMore,
    hasMore,
    error,
    q,
    setQ,
    ratingFilter,
    setRatingFilter,
    sentinelRef,
    load,
    updateRating: handleUpdateRating,
    saveNote: handleSaveNote,
  } = useBifrostSkills();

  const [downloadingName, setDownloadingName] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem('bf-skills-view') as ViewMode) || 'list'
  );

  const handleViewModeChange = (nextMode: ViewMode) => {
    setViewMode(nextMode);
    try {
      localStorage.setItem('bf-skills-view', nextMode);
    } catch {}
  };

  // 多选集合：存储选中的 skill name
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());

  const [detail, setDetail] = useState<CachedBifrostSkill | null>(null);
  const [detailTab, setDetailTab] = useState<'doc' | 'files'>('doc');
  const [editingNoteTarget, setEditingNoteTarget] = useState<CachedBifrostSkill | null>(null);

  /** 打开详情弹窗并补齐完整 SKILL.md 与文件树 */
  const openDetail = useCallback(
    async (s: CachedBifrostSkill) => {
      setDetail(s);
      setDetailTab('doc');
      try {
        const full = await bifrostService.getSkillDetail(s.name);
        setDetail((prev) => (prev && prev.name === s.name ? { ...prev, ...full } : prev));
      } catch {
        /* 离线等降级展示列表信息 */
      }
    },
    []
  );

  /** 打包下载 ZIP */
  const handleDownloadZip = async (skillName: string) => {
    if (downloadingName) return;
    setDownloadingName(skillName);
    try {
      showToast(`正在打包下载「${skillName}」...`, { type: 'info' });
      await bifrostService.downloadSkillZip(skillName);
      showToast(`「${skillName}.zip」下载完成`, { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || '下载失败，请重试', { type: 'error' });
    } finally {
      setDownloadingName(null);
    }
  };

  /** 切换多选状态 */
  const toggleSelect = (skillName: string) => {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(skillName)) next.delete(skillName);
      else next.add(skillName);
      return next;
    });
  };

  /** 详情抽屉打星同步 */
  const onUpdateRating = useCallback(
    async (skillName: string, rating: number, currentNote?: string) => {
      setDetail((prev) => (prev && prev.name === skillName ? { ...prev, user_rating: rating } : prev));
      await handleUpdateRating(skillName, rating, currentNote);
    },
    [handleUpdateRating]
  );

  /** 模态框保存备注 */
  const onSaveNoteModal = useCallback(
    async (rating: number, note: string) => {
      if (!editingNoteTarget) return;
      const targetName = editingNoteTarget.name;
      setDetail((prev) =>
        prev && prev.name === targetName
          ? { ...prev, user_rating: rating, user_note: note, note }
          : prev
      );
      await handleSaveNote(targetName, rating, note);
      setEditingNoteTarget(null);
    },
    [editingNoteTarget, handleSaveNote]
  );

  // 当前详情在筛选结果中的索引，用于抽屉内上一条/下一条连续检视
  const detailIndex = useMemo(() => {
    if (!detail) return -1;
    return filteredItems.findIndex((s) => s.name === detail.name);
  }, [detail, filteredItems]);

  const hasPrev = detailIndex > 0;
  const hasNext = detailIndex >= 0 && detailIndex < filteredItems.length - 1;

  const handlePrev = useCallback(() => {
    if (detailIndex > 0) {
      const prevSkill = filteredItems[detailIndex - 1];
      void openDetail(prevSkill);
    }
  }, [detailIndex, filteredItems, openDetail]);

  const handleNext = useCallback(() => {
    if (detailIndex >= 0 && detailIndex < filteredItems.length - 1) {
      const nextSkill = filteredItems[detailIndex + 1];
      void openDetail(nextSkill);
    }
  }, [detailIndex, filteredItems, openDetail]);

  /** 全选/取消已加载项 */
  const handleToggleSelectAll = () => {
    const skillNames = filteredItems.map((s) => s.name);
    const allInList = skillNames.length > 0 && skillNames.every((n) => selectedNames.has(n));
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (allInList) {
        skillNames.forEach((n) => next.delete(n));
      } else {
        skillNames.forEach((n) => next.add(n));
      }
      return next;
    });
  };

  /** 一键在画板创建 Skill 检索节点并载入选中项 */
  const handleLoadSkillsToCanvas = (targetSkills: CachedBifrostSkill[]) => {
    if (!targetSkills.length) {
      showToast('请先选择至少一个 Skill', { type: 'warning' });
      return;
    }
    try {
      const skillSelections: SkillSelection[] = targetSkills.map((s) => ({
        name: s.name,
        description: s.description,
        body: s.body,
        path: `skills/${s.name}`,
        files: Array.isArray(s.files) ? s.files.map((f: any) => (typeof f === 'string' ? f : f.path)) : [],
        source: 'bifrost',
        note: s.user_note || s.note,
        userRating: s.user_rating,
        userNote: s.user_note || s.note,
      }));

      const payload = {
        type: 'skill_search',
        data: {
          skillSelections,
        },
      };
      sessionStorage.setItem('bf-canvas-node-import', JSON.stringify(payload));
      showToast(`正在前往画板载入 ${targetSkills.length} 个 Skill...`, { type: 'info' });
      navigate('/bookplate');
    } catch {
      showToast('暂存 Skill 信息失败', { type: 'error' });
    }
  };

  // 批量载入所选的 Skills
  const selectedSkills = useMemo(() => {
    return skills.filter((s) => selectedNames.has(s.name));
  }, [skills, selectedNames]);

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

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 顶部标题栏 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-paper-grid pb-5">
          <div>
            <div className="flex items-center gap-2.5">
              <Boxes size={24} className="text-accent" />
              <h1 className="font-serif text-2xl font-bold text-ink">Bifrost Skills</h1>
            </div>
            <p className="text-sm text-ink-light font-sans mt-1">
              浏览与检索所有可用技能，支持多选批量载入画板、星级打标与备注、一键打包 ZIP 下载
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* 批量载入画板按钮 */}
            {selectedNames.size > 0 && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleLoadSkillsToCanvas(selectedSkills)}
                className="flex items-center gap-1.5 shadow-sm"
              >
                <PlusCircle size={14} />
                载入画板 (<span className="tabular-nums font-mono">{selectedNames.size}</span>)
              </Button>
            )}

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

        {/* 筛选与批量控制栏 */}
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
              placeholder="搜索 Skill 名称或功能描述…"
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

          {/* 页面多选控制与视图切换 */}
          <div className="flex items-center gap-3 ms-auto flex-wrap">
            {filteredItems.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  className="text-xs text-ink-light hover:text-accent font-sans flex items-center gap-1 active:scale-[0.96] transition-all"
                >
                  {filteredItems.every((s) => selectedNames.has(s.name)) ? (
                    <>
                      <CheckSquare size={14} className="text-accent" /> 取消全选
                    </>
                  ) : (
                    <>
                      <Square size={14} /> 全选已载入
                    </>
                  )}
                </button>

                {selectedNames.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedNames(new Set())}
                    className="text-xs text-ink-faint hover:text-error font-sans active:scale-[0.96] transition-colors ml-1"
                  >
                    清空已选
                  </button>
                )}

                <span className="text-xs text-ink-faint font-sans ml-1">
                  共 <span className="tabular-nums font-mono text-ink font-medium">{total}</span> 个 Skill
                </span>
              </div>
            )}
            <ViewToggle mode={viewMode} onChange={handleViewModeChange} />
          </div>
        </div>

        {/* 加载骨架屏 */}
        {loading && skills.length === 0 && (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="p-4 rounded-[20px] border border-dashed border-paper-grid bg-node-bg space-y-3 animate-pulse">
                  <div className="h-5 w-2/5 bg-paper-grid/50 rounded" />
                  <div className="h-4 w-full bg-paper-grid/30 rounded" />
                  <div className="h-3 w-4/5 bg-paper-grid/25 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="p-3 rounded-xl border border-dashed border-paper-grid bg-node-bg flex items-center gap-3.5 animate-pulse">
                  <div className="w-5 h-5 rounded bg-paper-grid/40 shrink-0" />
                  <div className="w-36 h-4 rounded bg-paper-grid/50 shrink-0" />
                  <div className="flex-1 h-3.5 rounded bg-paper-grid/30 hidden md:block" />
                  <div className="w-20 h-6 rounded bg-paper-grid/30 shrink-0" />
                </div>
              ))}
            </div>
          )
        )}

        {/* 错误提示 */}
        {error && skills.length === 0 && (
          <Card className="py-12 flex flex-col items-center gap-3 text-center">
            <span className="text-sm text-error font-sans">{error}</span>
            <Button variant="secondary" size="sm" onClick={() => void load(true)}>
              <RefreshCw size={14} className="mr-1.5" />
              重新加载
            </Button>
          </Card>
        )}

        {/* Skills 内容区（网格 vs 高密度列表） */}
        {(skills.length > 0 || (!loading && !error)) && (
          <div>
            {filteredItems.length === 0 ? (
              <Card className="py-16 flex flex-col items-center gap-3 text-center">
                <Boxes size={40} strokeWidth={1} className="text-ink-faint" />
                <p className="font-serif text-base text-ink">没有找到匹配的 Skill</p>
                <p className="text-sm text-ink-light font-sans">
                  {q.trim() || ratingFilter ? '尝试调整或清除搜索条件' : '暂无可用 Skills'}
                </p>
              </Card>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4.5">
                {filteredItems.map((s) => {
                  const isChecked = selectedNames.has(s.name);
                  const isDownloading = downloadingName === s.name;
                  const noteText = s.user_note || s.note;

                  return (
                    <Card
                      key={s.name}
                      className={`p-4 rounded-[20px] transition-[border-color,box-shadow,background-color,transform] duration-200 ease-out flex flex-col group relative ${
                        isChecked
                          ? 'border-accent ring-1 ring-accent/30 bg-accent-surface/10'
                          : 'hover:border-accent/40 hover:shadow-md hover:-translate-y-0.5'
                      }`}
                    >
                      {/* 卡片头部：复选框 + 名称 + 评分 + 稳定徽标行 */}
                      <div className="flex items-start gap-2.5">
                        <button
                          type="button"
                          onClick={() => toggleSelect(s.name)}
                          className="h-7 w-7 -ml-1 -mt-0.5 flex items-center justify-center rounded-md hover:bg-paper-grid/40 text-ink-light hover:text-accent active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out shrink-0"
                          title={isChecked ? '取消选择' : '勾选此项'}
                        >
                          {isChecked ? (
                            <CheckSquare size={17} className="text-accent" />
                          ) : (
                            <Square size={17} className="text-ink-faint group-hover:text-ink-light" />
                          )}
                        </button>

                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => void openDetail(s)}>
                          <div className="flex items-center justify-between gap-2">
                            <p
                              className="font-serif text-sm font-semibold text-ink truncate flex-1 group-hover:text-accent transition-colors"
                              title={s.name}
                            >
                              {s.name}
                            </p>
                            <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                              <RatingStars
                                value={s.user_rating || 0}
                                onChange={(r) => void handleUpdateRating(s.name, r, noteText)}
                                size="xs"
                              />
                            </div>
                          </div>
                          {/* 紧随标题的固定元数据徽标行，位置整齐划一 */}
                          <div className="flex items-center gap-1.5 mt-1 min-h-[1.25rem] flex-wrap">
                            {s.cached ? (
                              s.cached_version ? (
                                <Badge variant={s.latest_version && s.cached_version !== s.latest_version ? 'warning' : 'success'} className="text-[10px] px-1.5 py-px">
                                  本地 v{s.cached_version}
                                </Badge>
                              ) : (
                                <Badge className="text-[10px] px-1.5 py-px">本地缓存</Badge>
                              )
                            ) : (
                              <Badge className="text-[10px] px-1.5 py-px">未缓存</Badge>
                            )}
                            {s.latest_version && (!s.cached || s.cached_version !== s.latest_version) && (
                              <span className="text-[10px] font-mono text-ink-faint border border-paper-grid rounded-pill px-1.5 py-px shrink-0">
                                远端 v{s.latest_version}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 描述信息（预留双行基准槽位高度，保持顶边和底边对齐） */}
                      <p
                        className="mt-2 text-xs text-ink-light font-sans line-clamp-2 leading-relaxed cursor-pointer min-h-[2.25rem]"
                        onClick={() => void openDetail(s)}
                        title={s.description || '（暂无详细功能描述）'}
                      >
                        {s.description || '（暂无详细功能描述）'}
                      </p>

                      {/* 私有备注展示与编辑（统一槽位高度与基线，并通过 mt-auto 紧贴操作栏） */}
                      <div className="mt-auto pt-3">
                        {noteText ? (
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingNoteTarget(s);
                            }}
                            className="h-7 text-[11px] text-accent font-sans italic bg-accent-surface/50 px-2.5 rounded-lg border border-accent/20 hover:border-accent/40 transition-colors flex items-center justify-between cursor-pointer group/note"
                            title={`备注：${noteText}`}
                          >
                            <span className="truncate">备注：{noteText}</span>
                            <StickyNote size={12} className="shrink-0 ml-1.5 opacity-70 group-hover/note:opacity-100 transition-opacity" />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingNoteTarget(s);
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

                      {/* 底部信息与动作按钮：单行绝对对齐，零折叠 */}
                      <div className="flex items-center justify-between gap-2 pt-3 mt-3 border-t border-paper-grid/50">
                        <div className="min-w-0 flex-1">
                          {(s.cached ? s.updated_at : s.remote_updated_at) ? (
                            <span className="text-[10px] text-ink-faint font-sans tabular-nums truncate block" title={s.cached ? `本地更新: ${formatDate(s.updated_at)}` : `远端更新: ${formatDate(s.remote_updated_at)}`}>
                              {s.cached ? formatDate(s.updated_at) : formatDate(s.remote_updated_at)}
                            </span>
                          ) : null}
                        </div>

                        {/* 快捷操作：打包下载 + 单项载入画板 */}
                        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => void handleDownloadZip(s.name)}
                            disabled={isDownloading}
                            className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-paper-grid/80 text-ink-light hover:text-ink active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out disabled:opacity-50"
                            title="打包下载 Skill (.zip)"
                          >
                            {isDownloading ? (
                              <Loader2 size={14} className="animate-spin text-accent" />
                            ) : (
                              <Download size={14} />
                            )}
                          </button>

                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleLoadSkillsToCanvas([s])}
                            className="text-xs px-2.5 py-1 h-7 flex items-center gap-1"
                            title="在画板中创建包含此 Skill 的检索节点"
                          >
                            <PlusCircle size={13} className="text-accent" />
                            载入画板
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : (
              /* 高密度列表视图 */
              <div className="space-y-2">
                {filteredItems.map((s) => {
                  const isChecked = selectedNames.has(s.name);
                  const isDownloading = downloadingName === s.name;
                  const noteText = s.user_note || s.note;

                  return (
                    <div
                      key={s.name}
                      onClick={() => void openDetail(s)}
                      className={`p-3 rounded-xl border border-dashed border-paper-grid transition-[border-color,box-shadow,background-color] duration-150 ease-out flex items-center gap-3.5 cursor-pointer group ${
                        isChecked
                          ? 'border-accent bg-accent-surface/15 ring-1 ring-accent/30'
                          : 'bg-node-bg hover:border-accent/40 hover:shadow-xs'
                      }`}
                    >
                      {/* 复选框 */}
                      <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleSelect(s.name)}
                          className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-paper-grid/50 text-ink-light hover:text-accent active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out"
                          title={isChecked ? '取消选择' : '勾选此项'}
                        >
                          {isChecked ? (
                            <CheckSquare size={17} className="text-accent" />
                          ) : (
                            <Square size={17} className="text-ink-faint group-hover:text-ink-light" />
                          )}
                        </button>
                      </div>

                      {/* 技能名称与版本/时间元数据组 */}
                      <div className="w-56 sm:w-64 shrink-0 min-w-0 flex flex-col justify-center">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-serif text-sm font-semibold text-ink truncate group-hover:text-accent transition-colors" title={s.name}>
                            {s.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 min-w-0 flex-wrap text-[10px] text-ink-faint font-sans tabular-nums">
                          {s.cached ? (
                            s.cached_version ? (
                              <Badge variant={s.latest_version && s.cached_version !== s.latest_version ? 'warning' : 'success'} className="text-[10px] px-1.5 py-px">
                                本地 v{s.cached_version}
                              </Badge>
                            ) : (
                              <Badge className="text-[10px] px-1.5 py-px">本地缓存</Badge>
                            )
                          ) : (
                            <Badge className="text-[10px] px-1.5 py-px">未缓存</Badge>
                          )}
                          {s.latest_version && (!s.cached || s.cached_version !== s.latest_version) && (
                            <span className="font-mono text-ink-faint border border-paper-grid rounded-pill px-1.5 py-px shrink-0">
                              远端 v{s.latest_version}
                            </span>
                          )}
                          {(s.cached ? s.updated_at : s.remote_updated_at) && (
                            <span className="text-ink-faint truncate">
                              {s.cached ? formatDate(s.updated_at) : formatDate(s.remote_updated_at)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 功能描述与私有备注 */}
                      <div className="flex-1 min-w-0 hidden md:block">
                        <p
                          className="text-xs text-ink-light font-sans truncate"
                          title={s.description || '（暂无详细功能描述）'}
                        >
                          {s.description || '（暂无详细功能描述）'}
                        </p>
                        {noteText && (
                          <p
                            className="text-[11px] text-accent font-sans italic truncate mt-0.5"
                            title={`备注：${noteText}`}
                          >
                            备注：{noteText}
                          </p>
                        )}
                      </div>

                      {/* 打星评分 */}
                      <div onClick={(e) => e.stopPropagation()} className="shrink-0 hidden sm:block">
                        <RatingStars
                          value={s.user_rating || 0}
                          onChange={(r) => void handleUpdateRating(s.name, r, noteText)}
                          size="xs"
                        />
                      </div>

                      {/* 快捷操作：打包下载 + 单项载入画板 */}
                      <div className="flex items-center gap-1.5 shrink-0 ms-auto md:ms-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => void handleDownloadZip(s.name)}
                          disabled={isDownloading}
                          className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-paper-grid/80 text-ink-light hover:text-ink active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out disabled:opacity-50"
                          title="打包下载 Skill (.zip)"
                        >
                          {isDownloading ? (
                            <Loader2 size={14} className="animate-spin text-accent" />
                          ) : (
                            <Download size={14} />
                          )}
                        </button>

                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleLoadSkillsToCanvas([s])}
                          className="text-xs px-2.5 py-1 h-7 flex items-center gap-1"
                          title="在画板中创建包含此 Skill 的检索节点"
                        >
                          <PlusCircle size={13} className="text-accent" />
                          <span className="hidden sm:inline">载入画板</span>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 流式触底哨兵与加载更多状态 */}
            <div ref={sentinelRef} className="py-6 flex justify-center items-center">
              {loadingMore && (
                <div className="flex items-center gap-2 text-xs font-sans text-ink-light">
                  <Loader2 size={16} className="animate-spin text-accent" />
                  <span>加载更多技能...</span>
                </div>
              )}
              {!hasMore && filteredItems.length > 0 && (
                <span className="text-xs text-ink-faint font-sans select-none">已加载全部 {total} 个技能</span>
              )}
            </div>
          </div>
        )}

        {/* 详情侧边栏抽屉 */}
        <Drawer
          isOpen={!!detail}
          onClose={() => setDetail(null)}
          title="Skill 详情"
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPrev={handlePrev}
          onNext={handleNext}
          prevTitle="上一个 Skill (←)"
          nextTitle="下一个 Skill (→)"
          width="w-[560px] xl:w-[640px] max-w-[92vw]"
          footer={
            detail ? (
              <>
                <Button variant="ghost" onClick={() => setDetail(null)}>
                  关闭
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void handleDownloadZip(detail.name)}
                  disabled={downloadingName === detail.name}
                  className="flex items-center gap-1.5"
                >
                  {downloadingName === detail.name ? (
                    <Loader2 size={14} className="animate-spin text-accent" />
                  ) : (
                    <Download size={14} />
                  )}
                  打包下载 (.zip)
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    handleLoadSkillsToCanvas([detail]);
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
              {/* 头部摘要信息 */}
              <div className="flex items-start justify-between gap-3 flex-wrap border-b border-paper-grid pb-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-serif text-lg font-bold text-ink">{detail.name}</span>
                    {detail.cached
                      ? (detail.cached_version
                        ? <Badge variant={detail.latest_version && detail.cached_version !== detail.latest_version ? 'warning' : 'success'}>
                            本地 v{detail.cached_version}
                          </Badge>
                        : <Badge>本地缓存</Badge>)
                      : <Badge>未缓存</Badge>}
                    {detail.latest_version && (!detail.cached || detail.cached_version !== detail.latest_version) && (
                      <Badge>远端 v{detail.latest_version}</Badge>
                    )}
                    {detail.license && <span className="text-xs text-ink-faint font-mono">({detail.license})</span>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-ink-light font-sans tabular-nums mt-1">
                    {detail.cached && detail.updated_at && (
                      <span>本地更新: {formatDate(detail.updated_at)}</span>
                    )}
                    {detail.remote_updated_at && (
                      <span>远端更新: {formatDate(detail.remote_updated_at)}</span>
                    )}
                  </div>
                  <p className="text-xs text-ink-light font-sans">{detail.description || '（无描述）'}</p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-light">评分：</span>
                  <RatingStars
                    value={detail.user_rating || 0}
                    onChange={(r) => void onUpdateRating(detail.name, r, detail.user_note || detail.note)}
                    size="sm"
                  />
                </div>
              </div>

              {/* 私有备注区域 */}
              <div className="space-y-1.5 bg-paper/50 p-3 rounded-xl border border-paper-grid">
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
                <div className="text-xs text-ink font-sans">
                  {detail.user_note || detail.note ? (
                    <span className="text-accent italic">{detail.user_note || detail.note}</span>
                  ) : (
                    <span className="text-ink-faint">暂无备注（可在画板节点与此页面同步管理）</span>
                  )}
                </div>
              </div>

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

                {/* SKILL.md 文档区（内置双速渐进高亮，毫秒级即刻挂载，无需多余延迟） */}
                {detailTab === 'doc' && (
                  <MarkdownViewer
                    content={detail.body}
                    emptyText="（暂无 SKILL.md 文档）"
                    copyable
                    className="max-h-[460px]"
                  />
                )}

                {/* 文件树列表区（树形结构 + 默认文件夹折叠 + 即时搜索） */}
                {detailTab === 'files' && (
                  <SkillFileTree files={detail.files} maxHeightClass="max-h-[460px]" />
                )}
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
            initialNote={editingNoteTarget.user_note ?? editingNoteTarget.note ?? ''}
            onSave={onSaveNoteModal}
          />
        )}
      </main>
    </div>
  );
};

export default BifrostSkillsPage;
