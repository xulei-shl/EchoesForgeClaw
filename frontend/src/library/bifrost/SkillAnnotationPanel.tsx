import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Tag as TagIcon,
  StickyNote,
  Users,
  Trash2,
  Plus,
  X,
  Sparkles,
  ShieldCheck,
  Undo2,
  Clock,
  User as UserIcon,
} from 'lucide-react';
import type { CachedBifrostSkill, PublicNote } from '../../shared/types';
import { RatingStars } from '../../shared/components/ui/RatingStars';
import { Textarea } from '../../shared/components/ui/Textarea';
import { Toggle } from '../../shared/components/ui/Toggle';
import { Button } from '../../shared/components/ui/Button';
import { Badge } from '../../shared/components/ui/Badge';
import { useFeedback } from '../../shared/components/ui/FeedbackProvider';
import { useAuth } from '../../shared/stores/authStore';
import { adminService, annotationService } from '../../shared/services/admin';

export interface SkillAnnotationPanelProps {
  skill: CachedBifrostSkill;
  /** 全站候选公共标签池（Admin 可快速点击候选） */
  candidateTags?: string[];
  /** 标注保存成功回调，用于刷新父组件状态 */
  onAnnotationChange?: (data: { rating: number; note: string; isPublic: boolean }) => void;
  /** 全局标签变更回调（Admin 专属） */
  onTagsChange?: (newTags: string[]) => void;
  /** 公开经验变更回调 */
  onPublicNotesChange?: (notes: PublicNote[]) => void;
}

export const SkillAnnotationPanel: React.FC<SkillAnnotationPanelProps> = ({
  skill,
  candidateTags = [],
  onAnnotationChange,
  onTagsChange,
  onPublicNotesChange,
}) => {
  const { user } = useAuth();
  const { showToast, dialog } = useFeedback();
  const isAdmin = user?.role === 'admin';

  // --- 全局标签管理状态 ---
  const [globalTags, setGlobalTags] = useState<string[]>(skill.tags || []);
  const [newTagInput, setNewTagInput] = useState('');
  const [savingTags, setSavingTags] = useState(false);

  // --- 个人私有标注状态 ---
  const [rating, setRating] = useState<number>(skill.user_rating || 0);
  const [note, setNote] = useState<string>(skill.user_note || skill.note || '');
  const [isPublic, setIsPublic] = useState<boolean>(skill.is_public || false);
  const [savingAnnotation, setSavingAnnotation] = useState(false);

  // --- 公开经验列表状态 ---
  const [publicNotes, setPublicNotes] = useState<PublicNote[]>(skill.public_notes || []);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // 当外部传入的 skill 变化时同步内部状态
  useEffect(() => {
    setGlobalTags(skill.tags || []);
    setRating(skill.user_rating || 0);
    const resolvedNote = skill.user_note || skill.note || '';
    setNote(resolvedNote);
    setIsPublic(Boolean(skill.is_public && resolvedNote.trim()));
    setPublicNotes(skill.public_notes || []);
  }, [skill]);

  // 获取公开备忘列表
  const reloadPublicNotes = useCallback(async () => {
    setLoadingNotes(true);
    try {
      const res = await annotationService.getPublicNotes('bifrost_skill', skill.name);
      const list = res.public_notes || [];
      setPublicNotes(list);
      onPublicNotesChange?.(list);
    } catch {
      /* 静默失败 */
    } finally {
      setLoadingNotes(false);
    }
  }, [skill.name, onPublicNotesChange]);

  // 当没有公开列表或 skill 切换时按需拉取
  useEffect(() => {
    if (!skill.public_notes) {
      void reloadPublicNotes();
    }
  }, [skill.name, skill.public_notes, reloadPublicNotes]);

  // -------------------------------------------------------------
  // 1. 全局业务标签管控（Admin 专属）
  // -------------------------------------------------------------
  const handleAddGlobalTag = async (tagToAdd: string) => {
    const trimmed = tagToAdd.trim();
    if (!trimmed || globalTags.includes(trimmed)) return;
    const nextTags = [...globalTags, trimmed];
    setSavingTags(true);
    try {
      const res = await adminService.setBifrostSkillTags(skill.name, nextTags);
      setGlobalTags(res.tags);
      onTagsChange?.(res.tags);
      setNewTagInput('');
      showToast(`已添加全局分类「${trimmed}」`, { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || '更新分类标签失败', { type: 'error' });
    } finally {
      setSavingTags(false);
    }
  };

  const handleRemoveGlobalTag = async (tagToRemove: string) => {
    const nextTags = globalTags.filter((t) => t !== tagToRemove);
    setSavingTags(true);
    try {
      const res = await adminService.setBifrostSkillTags(skill.name, nextTags);
      setGlobalTags(res.tags);
      onTagsChange?.(res.tags);
      showToast(`已移除全局分类「${tagToRemove}」`, { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || '更新分类标签失败', { type: 'error' });
    } finally {
      setSavingTags(false);
    }
  };

  // 快捷可选标签候选池（全站出现过但当前 skill 尚未添加的标签）
  const candidateList = useMemo(() => {
    const set = new Set(globalTags);
    return candidateTags.filter((t) => t && !set.has(t)).slice(0, 10);
  }, [candidateTags, globalTags]);

  // -------------------------------------------------------------
  // 2. 我的评星与备忘保存
  // -------------------------------------------------------------
  const handleSaveAnnotation = async () => {
    setSavingAnnotation(true);
    const trimmedNote = note.trim();
    const resolvedPublic = Boolean(trimmedNote && isPublic);

    try {
      const res = await annotationService.setAnnotation({
        resource_type: 'bifrost_skill',
        resource_id: skill.name,
        rating,
        note: trimmedNote,
        is_public: resolvedPublic,
      });

      setRating(res.rating);
      setNote(res.note);
      setIsPublic(Boolean(res.is_public));

      onAnnotationChange?.({
        rating: res.rating,
        note: res.note,
        isPublic: Boolean(res.is_public),
      });

      showToast('个人标注与心得已保存', { type: 'success' });
      // 若开启或关闭了公开，重新刷新公共经验区
      void reloadPublicNotes();
    } catch (e: any) {
      showToast(e?.message || '保存标注失败', { type: 'error' });
    } finally {
      setSavingAnnotation(false);
    }
  };

  // -------------------------------------------------------------
  // 3. 团队经验治理与撤回
  // -------------------------------------------------------------
  /** 用户本人撤回公开经验 */
  const handleRevokeMyPublicNote = async () => {
    const ok = await dialog.confirm({
      title: '撤回公开经验',
      message: '确定将自己的心得转为私有吗？团队同事将不再可见。',
      confirmText: '撤回公开',
    });
    if (!ok) return;

    try {
      await annotationService.revokePublicNote('bifrost_skill', skill.name);
      setIsPublic(false);
      onAnnotationChange?.({ rating, note, isPublic: false });
      showToast('已撤回公开经验，已转为仅自己可见', { type: 'success' });
      void reloadPublicNotes();
    } catch (e: any) {
      showToast(e?.message || '撤回失败', { type: 'error' });
    }
  };

  /** 管理员违规清退某条公开经验 */
  const handleModeratePublicNote = async (targetUserId: number, targetUsername: string) => {
    const ok = await dialog.confirm({
      title: '清理公开备忘',
      message: `确定清理用户「${targetUsername}」的公开经验吗？清理后将转为其个人私有备忘。`,
      confirmText: '清理内容',
      danger: true,
    });
    if (!ok) return;

    try {
      await adminService.deleteBifrostSkillPublicNote(skill.name, targetUserId);
      showToast(`已清理「${targetUsername}」的公开经验`, { type: 'success' });
      void reloadPublicNotes();
    } catch (e: any) {
      showToast(e?.message || '清理失败', { type: 'error' });
    }
  };

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}/${m}/${day} ${h}:${min}`;
  };

  return (
    <div className="space-y-6">
      {/* ======================================================== */}
      {/* 区块 1：全局业务分类（Admin 管控）                         */}
      {/* ======================================================== */}
      <div className="rounded-lg border border-paper-grid bg-node-bg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TagIcon size={14} className="text-accent" />
            <span className="text-xs font-serif font-semibold text-ink">分类标签</span>
            {isAdmin ? (
              <Badge variant="warning" className="text-[10px]">
                <ShieldCheck size={11} className="mr-0.5 inline" /> 管理员维护
              </Badge>
            ) : (
              <span className="text-[10px] font-sans text-ink-faint">（由系统管理员统一设置）</span>
            )}
          </div>
          {typeof skill.star_count === 'number' && skill.star_count > 0 && (
            <span className="text-xs font-sans text-ink-light flex items-center gap-1">
              <Users size={12} className="text-ink-faint" />
              共 <span className="font-mono text-ink font-semibold">{skill.star_count}</span> 人评星
            </span>
          )}
        </div>

        {/* 标签列表展示 */}
        <div className="flex items-center gap-1.5 flex-wrap min-h-6">
          {globalTags.length === 0 ? (
            <span className="text-xs font-sans text-ink-faint italic">暂无分类标签</span>
          ) : (
            globalTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-accent-surface border border-accent/30 text-accent font-sans"
              >
                #{tag}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => void handleRemoveGlobalTag(tag)}
                    disabled={savingTags}
                    className="hover:text-error transition-colors p-0.5 rounded-full"
                    title={`移除标签「${tag}」`}
                  >
                    <X size={11} />
                  </button>
                )}
              </span>
            ))
          )}
        </div>

        {/* 管理员专属标签编辑框与推荐池 */}
        {isAdmin && (
          <div className="pt-2 border-t border-dashed border-paper-grid space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddGlobalTag(newTagInput);
                  }
                }}
                placeholder="输入新分类标签并按回车…"
                className="flex-1 text-xs px-2.5 py-1.5 rounded border border-paper-grid bg-paper text-ink focus:border-accent focus:outline-none"
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={!newTagInput.trim() || savingTags}
                isLoading={savingTags}
                onClick={() => void handleAddGlobalTag(newTagInput)}
              >
                <Plus size={13} className="mr-0.5" />
                添加分类
              </Button>
            </div>

            {/* 常用已有候选标签云 */}
            {candidateList.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1 text-[11px] text-ink-light font-sans">
                <span className="text-ink-faint">推荐候选：</span>
                {candidateList.map((cand) => (
                  <button
                    key={cand}
                    type="button"
                    onClick={() => void handleAddGlobalTag(cand)}
                    disabled={savingTags}
                    className="px-1.5 py-0.5 rounded border border-dashed border-paper-grid hover:border-accent hover:text-accent bg-paper/50 transition-colors"
                  >
                    + {cand}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* 区块 2：我的评星与备忘（私有 + 可选公开）                    */}
      {/* ======================================================== */}
      <div className="rounded-lg border border-paper-grid bg-node-bg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <StickyNote size={14} className="text-accent" />
            <span className="text-xs font-serif font-semibold text-ink">我的评星与备忘</span>
          </div>
          <div className="flex items-center gap-2">
            <RatingStars value={rating} onChange={setRating} size="sm" />
            <span className="text-xs font-sans text-ink-light">
              {rating > 0 ? `${rating} 星` : '未评分'}
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Textarea
            value={note}
            onChange={(e) => {
              const val = e.target.value;
              setNote(val);
              if (!val.trim()) setIsPublic(false);
            }}
            placeholder="记录针对此 Skill 的使用心得、避坑指南等…"
            rows={3}
            className="text-xs font-sans"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <Toggle
              checked={isPublic}
              onChange={(next) => {
                if (!note.trim()) return;
                setIsPublic(next);
              }}
              disabled={!note.trim()}
              label="公开至团队"
            />
            <span
              className={`text-xs font-sans ${
                !note.trim()
                  ? 'text-ink-faint cursor-not-allowed'
                  : isPublic
                  ? 'text-accent font-medium'
                  : 'text-ink-light'
              }`}
            >
              公开至团队
            </span>
          </div>

          <Button
            size="sm"
            variant="primary"
            onClick={() => void handleSaveAnnotation()}
            isLoading={savingAnnotation}
          >
            <Sparkles size={13} className="mr-1" />
            保存标注
          </Button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 区块 3：团队公开经验与备忘交流区                            */}
      {/* ======================================================== */}
      <div className="rounded-lg border border-paper-grid bg-node-bg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-accent" />
            <span className="text-xs font-serif font-semibold text-ink">
              备忘记录交流
            </span>
            <span className="text-[10px] font-sans px-1.5 py-0.5 rounded-full bg-paper-grid/30 text-ink-light font-mono">
              {publicNotes.length}
            </span>
          </div>
          {loadingNotes && (
            <span className="text-[11px] font-sans text-ink-faint">刷新中…</span>
          )}
        </div>

        {publicNotes.length === 0 ? (
          <div className="py-6 text-center text-xs text-ink-faint font-sans space-y-1">
            <p>暂无公开分享的备忘</p>
            <p className="text-[11px]">在上方撰写备忘记录并开启「公开至团队」，为团队提供第一份使用经验吧！</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-72 overflow-y-auto custom-scrollbar pr-1">
            {publicNotes.map((item, idx) => {
              const isMyNote = user?.id && item.user_id === user.id;
              return (
                <div
                  key={`${item.user_id}-${idx}`}
                  className="p-3 rounded border border-paper-grid bg-paper space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between text-ink-light font-sans">
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full bg-paper-grid/40 flex items-center justify-center text-ink-faint">
                        <UserIcon size={12} />
                      </div>
                      <span className="font-medium text-ink">
                        {item.display_name || item.username}
                      </span>
                      {isMyNote && (
                        <Badge variant="success" className="text-[10px] py-0 px-1.5">
                          我公开的
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-ink-faint text-[11px]">
                      {item.updated_at && (
                        <span className="flex items-center gap-1">
                          <Clock size={11} />
                          {formatDate(item.updated_at)}
                        </span>
                      )}

                      {/* 本人撤回操作 */}
                      {isMyNote && (
                        <button
                          type="button"
                          onClick={() => void handleRevokeMyPublicNote()}
                          className="text-ink-faint hover:text-accent transition-colors flex items-center gap-0.5 ml-1"
                          title="撤回公开经验（转为私有）"
                        >
                          <Undo2 size={12} />
                          撤回
                        </button>
                      )}

                      {/* 管理员清退操作 */}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => void handleModeratePublicNote(item.user_id, item.username)}
                          className="text-ink-faint hover:text-error transition-colors flex items-center gap-0.5 ml-1"
                          title="管理员清理不当公开经验"
                        >
                          <Trash2 size={12} />
                          清理
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 笔记正文 */}
                  <p className="text-ink font-sans leading-relaxed whitespace-pre-wrap break-words bg-node-bg/60 p-2 rounded border border-paper-grid/50">
                    {item.note}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SkillAnnotationPanel;
