import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { annotationService } from '../../shared/services/admin';
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
import { Pagination } from '../../shared/components/ui/Pagination';
import { SkillFileTree } from '../../shared/components/ui/SkillFileTree';

/** 内存级 SWR 缓存 */
let cachedSkills: CachedBifrostSkill[] | null = null;

export const BifrostSkillsPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useFeedback();

  const [skills, setSkills] = useState<CachedBifrostSkill[]>(() => cachedSkills ?? []);
  const [loading, setLoading] = useState(() => !cachedSkills);
  const [error, setError] = useState('');
  const [downloadingName, setDownloadingName] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [ratingFilter, setRatingFilter] = useState('');

  // 多选集合：存储选中的 skill name
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());

  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 24;

  const [detail, setDetail] = useState<CachedBifrostSkill | null>(null);
  const [detailTab, setDetailTab] = useState<'doc' | 'files'>('doc');
  const [editingNoteTarget, setEditingNoteTarget] = useState<CachedBifrostSkill | null>(null);

  /** 加载 Skills 列表 */
  const load = useCallback(
    async (force = false, showLoading = true) => {
      if (showLoading && !cachedSkills) setLoading(true);
      setError('');
      try {
        const res = await bifrostService.listSkills({ q: q.trim() || undefined, force });
        const fetched = res.skills ?? [];
        if (!q.trim()) cachedSkills = fetched;
        setSkills(fetched);
      } catch (e: any) {
        if (!cachedSkills) setError(e?.message || '加载 Skills 失败，请重试');
      } finally {
        setLoading(false);
      }
    },
    [q]
  );

  // 挂载初次加载
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      void load(false, !cachedSkills);
    }
  }, [load]);

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
  }, [q, ratingFilter]);

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

  /** 更新星级打标 */
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

  /** 保存私有备注 */
  const handleSaveNote = async (nextRating: number, nextNote: string) => {
    if (!editingNoteTarget) return;
    try {
      const res = await annotationService.setAnnotation({
        resource_type: 'bifrost_skill',
        resource_id: editingNoteTarget.name,
        rating: nextRating,
        note: nextNote.trim(),
      });
      setSkills((prev) =>
        prev.map((s) =>
          s.name === editingNoteTarget.name
            ? { ...s, user_rating: res.rating, user_note: res.note, note: res.note }
            : s
        )
      );
      if (detail && detail.name === editingNoteTarget.name) {
        setDetail({ ...detail, user_rating: res.rating, user_note: res.note, note: res.note });
      }
      showToast('备注已保存', { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || '保存备注失败', { type: 'error' });
    }
  };

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

  /** 客户端打标筛选 */
  const filteredSkills = useMemo(() => {
    return skills.filter((s) => {
      if (ratingFilter === '5' && (s.user_rating ?? 0) !== 5) return false;
      if (ratingFilter === '4+' && (s.user_rating ?? 0) < 4) return false;
      if (ratingFilter === '3+' && (s.user_rating ?? 0) < 3) return false;
      if (ratingFilter === 'rated' && !(s.user_rating && s.user_rating > 0)) return false;
      if (ratingFilter === 'unrated' && (s.user_rating && s.user_rating > 0)) return false;
      if (ratingFilter === 'noted' && !s.user_note?.trim() && !s.note?.trim()) return false;
      return true;
    });
  }, [skills, ratingFilter]);

  const totalPages = Math.ceil(filteredSkills.length / PAGE_SIZE);
  const currentSkills = filteredSkills.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // 当前详情在筛选结果中的索引，用于抽屉内上一条/下一条连续检视
  const detailIndex = useMemo(() => {
    if (!detail) return -1;
    return filteredSkills.findIndex((s) => s.name === detail.name);
  }, [detail, filteredSkills]);

  const hasPrev = detailIndex > 0;
  const hasNext = detailIndex >= 0 && detailIndex < filteredSkills.length - 1;

  const handlePrev = useCallback(() => {
    if (detailIndex > 0) {
      const prevSkill = filteredSkills[detailIndex - 1];
      void openDetail(prevSkill);
      const targetPage = Math.floor((detailIndex - 1) / PAGE_SIZE) + 1;
      if (targetPage !== currentPage) setCurrentPage(targetPage);
    }
  }, [detailIndex, filteredSkills, currentPage, openDetail]);

  const handleNext = useCallback(() => {
    if (detailIndex >= 0 && detailIndex < filteredSkills.length - 1) {
      const nextSkill = filteredSkills[detailIndex + 1];
      void openDetail(nextSkill);
      const targetPage = Math.floor((detailIndex + 1) / PAGE_SIZE) + 1;
      if (targetPage !== currentPage) setCurrentPage(targetPage);
    }
  }, [detailIndex, filteredSkills, currentPage, openDetail]);



  /** 全选/取消当前页 */
  const handleToggleSelectPage = () => {
    const pageSkillNames = currentSkills.map((s) => s.name);
    const allInPage = pageSkillNames.every((n) => selectedNames.has(n));
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (allInPage) {
        pageSkillNames.forEach((n) => next.delete(n));
      } else {
        pageSkillNames.forEach((n) => next.add(n));
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

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 顶部标题栏 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-paper-grid pb-5">
          <div>
            <div className="flex items-center gap-2.5">
              <Boxes size={24} className="text-accent" />
              <h1 className="font-serif text-2xl font-bold text-ink">Bifrost Skills 技能库</h1>
            </div>
            <p className="text-sm text-ink-light font-sans mt-1">
              浏览与检索所有可用 Skills，支持多选批量载入画板、星级打标与私有备注、一键打包 ZIP 下载
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* 批量载入画板按钮 */}
            {selectedNames.size > 0 && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleLoadSkillsToCanvas(selectedSkills)}
                className="flex items-center gap-1.5 shadow-sm animate-fade-in"
              >
                <PlusCircle size={14} />
                载入画板 ({selectedNames.size})
              </Button>
            )}

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

          {/* 页面多选控制 */}
          {currentSkills.length > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={handleToggleSelectPage}
                className="text-xs text-ink-light hover:text-accent font-sans flex items-center gap-1 transition-colors"
              >
                {currentSkills.every((s) => selectedNames.has(s.name)) ? (
                  <>
                    <CheckSquare size={14} className="text-accent" /> 取消本页
                  </>
                ) : (
                  <>
                    <Square size={14} /> 全选本页
                  </>
                )}
              </button>

              {selectedNames.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedNames(new Set())}
                  className="text-xs text-ink-faint hover:text-error font-sans transition-colors ml-2"
                >
                  清空已选
                </button>
              )}

              <span className="text-xs text-ink-faint font-sans ml-2">
                共 {filteredSkills.length} 个 Skill
              </span>
            </div>
          )}
        </div>

        {/* 加载骨架屏 */}
        {loading && skills.length === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="p-4 rounded-2xl border border-dashed border-paper-grid bg-node-bg space-y-3 animate-pulse">
                <div className="h-5 w-2/5 bg-paper-grid/50 rounded" />
                <div className="h-4 w-full bg-paper-grid/30 rounded" />
                <div className="h-3 w-4/5 bg-paper-grid/25 rounded" />
              </div>
            ))}
          </div>
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

        {/* Skills 网格 */}
        {(skills.length > 0 || (!loading && !error)) && (
          <div>
            {filteredSkills.length === 0 ? (
              <Card className="py-16 flex flex-col items-center gap-3 text-center">
                <Boxes size={40} strokeWidth={1} className="text-ink-faint" />
                <p className="font-serif text-base text-ink">没有找到匹配的 Skill</p>
                <p className="text-sm text-ink-light font-sans">
                  {q.trim() || ratingFilter ? '尝试调整或清除搜索条件' : '暂无可用 Skills'}
                </p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {currentSkills.map((s) => {
                  const isChecked = selectedNames.has(s.name);
                  const isDownloading = downloadingName === s.name;
                  const noteText = s.user_note || s.note;

                  return (
                    <Card
                      key={s.name}
                      className={`p-4 rounded-2xl transition-all duration-200 flex flex-col group relative ${
                        isChecked
                          ? 'border-accent ring-1 ring-accent/30 bg-accent-surface/10'
                          : 'hover:border-accent/40 hover:shadow-md'
                      }`}
                    >
                      {/* 卡片头部：复选框 + 名称 + 评分 */}
                      <div className="flex items-start gap-2.5">
                        <button
                          type="button"
                          onClick={() => toggleSelect(s.name)}
                          className="mt-0.5 text-ink-light hover:text-accent transition-colors shrink-0"
                          title={isChecked ? '取消选择' : '勾选此项'}
                        >
                          {isChecked ? (
                            <CheckSquare size={17} className="text-accent" />
                          ) : (
                            <Square size={17} className="text-ink-faint group-hover:text-ink-light" />
                          )}
                        </button>

                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => void openDetail(s)}>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="font-serif text-sm font-semibold text-ink truncate group-hover:text-accent transition-colors" title={s.name}>
                              {s.name}
                            </p>
                            {s.latest_version && (
                              <span className="text-[10px] font-mono text-ink-faint border border-paper-grid rounded-pill px-1.5 py-px shrink-0">
                                v{s.latest_version}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* 打星评分 */}
                        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                          <RatingStars
                            value={s.user_rating || 0}
                            onChange={(r) => void handleUpdateRating(s.name, r, noteText)}
                            size="xs"
                          />
                        </div>
                      </div>

                      {/* 描述信息 */}
                      <p
                        className="mt-2 text-xs text-ink-light font-sans line-clamp-2 leading-relaxed cursor-pointer"
                        onClick={() => void openDetail(s)}
                      >
                        {s.description || '（暂无详细功能描述）'}
                      </p>

                      {/* 私有备注展示与编辑 */}
                      {noteText ? (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingNoteTarget(s);
                          }}
                          className="text-[11px] text-accent font-sans mt-2.5 line-clamp-1 italic bg-accent-surface/50 px-2 py-1 rounded border border-accent/20 hover:border-accent/40 transition-colors flex items-center justify-between cursor-pointer"
                        >
                          <span className="truncate">备注：{noteText}</span>
                          <StickyNote size={12} className="shrink-0 ml-1 opacity-70" />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingNoteTarget(s);
                          }}
                          className="text-[11px] text-ink-faint hover:text-accent font-sans mt-2.5 self-start flex items-center gap-1 transition-colors"
                        >
                          <StickyNote size={12} />
                          添加私有备注
                        </button>
                      )}

                      {/* 底部信息与动作按钮 */}
                      <div className="flex items-center justify-between gap-2 mt-auto pt-3.5 border-t border-paper-grid/50">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <button
                            type="button"
                            onClick={() => void openDetail(s)}
                            className="text-xs text-accent hover:text-accent-hover font-sans underline underline-offset-2"
                          >
                            查看详情
                          </button>
                        </div>

                        {/* 快捷操作：打包下载 + 单项载入画板 */}
                        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => void handleDownloadZip(s.name)}
                            disabled={isDownloading}
                            className="p-1.5 rounded-md hover:bg-paper-grid/80 text-ink-light hover:text-ink transition-colors disabled:opacity-50"
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
                    {detail.latest_version && <Badge>v{detail.latest_version}</Badge>}
                    {detail.license && <span className="text-xs text-ink-faint font-mono">({detail.license})</span>}
                  </div>
                  <p className="text-xs text-ink-light font-sans">{detail.description || '（无描述）'}</p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-light">评分：</span>
                  <RatingStars
                    value={detail.user_rating || 0}
                    onChange={(r) => void handleUpdateRating(detail.name, r, detail.user_note || detail.note)}
                    size="sm"
                  />
                </div>
              </div>

              {/* 私有备注区域 */}
              <div className="space-y-1.5 bg-paper/50 p-3 rounded-xl border border-paper-grid">
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
                    <FileText size={14} /> SKILL.md 文档
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
                    emptyText="（暂无 SKILL.md 文档正文）"
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
            title="打标与私有备注"
            resourceName={editingNoteTarget.name}
            initialRating={editingNoteTarget.user_rating ?? 0}
            initialNote={editingNoteTarget.user_note ?? editingNoteTarget.note ?? ''}
            onSave={handleSaveNote}
          />
        )}
      </main>
    </div>
  );
};

export default BifrostSkillsPage;
