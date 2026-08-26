import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  Check,
  Loader2,
  Search,
  Upload,
  X,
  StickyNote,
} from 'lucide-react';
import api from '../../../platform/services/api';
import { annotationService } from '../../../platform/services/admin';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Dialog } from '../../../platform/components/ui/Dialog';
import { Button } from '../../../platform/components/ui/Button';
import { Input } from '../../../platform/components/ui/Input';
import { Select } from '../../../platform/components/ui/Select';
import { RatingStars } from '../../../platform/components/ui/RatingStars';
import { NoteEditModal } from '../../../platform/components/ui/NoteEditModal';
import { NODE_COLORS } from '../nodeTypes';
import type { BifrostSkill, InstalledSkill, SkillSelection } from '../../../platform/types';

export interface SkillSearchNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 已选 skill 集合（受控：整块替换，支持多选） */
  selections?: SkillSelection[];
  onUpdateSkills?: (id: string, selections: SkillSelection[]) => void;
  onRemove?: () => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const MAX_ZIP_BYTES = 20 * 1024 * 1024;

const SkillSearchNodeInner: React.FC<SkillSearchNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  selections = [],
  onUpdateSkills,
  onRemove,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 检索结果（Bifrost） */
  const [skills, setSkills] = useState<BifrostSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [ratingFilter, setRatingFilter] = useState('');
  const [editingTarget, setEditingTarget] = useState<BifrostSkill | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const requestSeq = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 已选 skill 名称集合（按 name 判等去重） */
  const selectedNames = useMemo(() => new Set(selections.map((s) => s.name)), [selections]);

  const loadSkills = useCallback(async (keyword?: string) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError('');
    try {
      const res: { skills: BifrostSkill[] } = await api.get(
        '/modules/bookplate/skills/bifrost-search',
        {
          params: keyword?.trim() ? { q: keyword.trim() } : {},
          timeout: 20000,
        }
      );
      if (seq !== requestSeq.current) return;
      setSkills(res.skills ?? []);
    } catch (e: any) {
      if (seq !== requestSeq.current) return;
      setError(e?.message || '加载 skill 失败，请重试');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  const openPicker = useCallback(() => {
    setQ('');
    setRatingFilter('');
    setSkills([]);
    setUploadError('');
    setLoading(true);
    setError('');
    setPickerOpen(true);
  }, []);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
  }, []);

  /** 快捷打星 */
  const handleUpdateRating = async (s: BifrostSkill, nextRating: number) => {
    try {
      const res = await annotationService.setAnnotation({
        resource_type: 'bifrost_skill',
        resource_id: s.name,
        rating: nextRating,
        note: s.user_note ?? s.note ?? '',
      });
      setSkills((prev) =>
        prev.map((item) =>
          item.name === s.name
            ? { ...item, user_rating: res.rating, user_note: res.note, note: res.note }
            : item
        )
      );
      if (selectedNames.has(s.name)) {
        onUpdateSkills?.(
          id,
          selections.map((item) =>
            item.name === s.name
              ? { ...item, userRating: res.rating, userNote: res.note, note: res.note }
              : item
          )
        );
      }
    } catch {
      /* ignore */
    }
  };

  /** 保存打标与备注 */
  const handleSaveAnnotation = async (rating: number, note: string) => {
    if (!editingTarget) return;
    try {
      const res = await annotationService.setAnnotation({
        resource_type: 'bifrost_skill',
        resource_id: editingTarget.name,
        rating,
        note,
      });
      setSkills((prev) =>
        prev.map((item) =>
          item.name === editingTarget.name
            ? { ...item, user_rating: res.rating, user_note: res.note, note: res.note }
            : item
        )
      );
      if (selectedNames.has(editingTarget.name)) {
        onUpdateSkills?.(
          id,
          selections.map((item) =>
            item.name === editingTarget.name
              ? { ...item, userRating: res.rating, userNote: res.note, note: res.note }
              : item
          )
        );
      }
    } catch {
      /* ignore */
    }
  };

  /** 切换某个 skill 的选择状态（已在集合中则移除，否则追加）。不触发安装/卸载。 */
  const toggleSelection = useCallback(
    (sel: SkillSelection) => {
      const exists = selections.some((s) => s.name === sel.name);
      const next = exists
        ? selections.filter((s) => s.name !== sel.name)
        : [...selections, sel];
      onUpdateSkills?.(id, next);
    },
    [id, selections, onUpdateSkills]
  );

  // 客户端星级过滤
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

  // 搜索防抖：输入停止 350ms 后重新加载
  useEffect(() => {
    if (!pickerOpen) return;
    const t = window.setTimeout(() => {
      void loadSkills(q);
    }, 350);
    return () => window.clearTimeout(t);
  }, [pickerOpen, q, loadSkills]);

  /** 从 Bifrost 安装；成功后加入选择集（不关闭 picker，支持多选）。
   *  已选中的条目再次点击 = 取消选择：仅从选择集移除，不重复安装、不卸载工作区 skill。 */
  const handleInstallBifrost = async (s: BifrostSkill) => {
    setUploadError('');
    setError('');
    if (selectedNames.has(s.name)) {
      toggleSelection({ name: s.name, source: 'bifrost' });
      return;
    }
    try {
      const meta: InstalledSkill = await api.post('/modules/bookplate/skills/install', {
        name: s.name,
      });
      toggleSelection({
        name: meta.name,
        description: meta.description,
        body: meta.body,
        path: meta.path,
        files: meta.files,
        source: 'bifrost',
        note: meta.user_note ?? meta.note,
        userRating: meta.user_rating ?? s.user_rating,
        userNote: meta.user_note ?? s.user_note,
      });
    } catch (e: any) {
      setError(e?.message || '安装失败，请重试');
    }
  };

  /** 上传本地 skill zip：后端校验 SKILL.md 结构（含 name/description frontmatter） */
  const handleUploadZip = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setUploadError('请选择 .zip 格式的 skill 压缩包');
      return;
    }
    if (file.size > MAX_ZIP_BYTES) {
      setUploadError('文件超过 20MB 上限');
      return;
    }
    setUploading(true);
    setUploadError('');
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const meta: InstalledSkill = await api.post('/modules/bookplate/skills/upload', form, {
        timeout: 60000,
      });
      const sel: SkillSelection = {
        name: meta.name,
        description: meta.description,
        body: meta.body,
        path: meta.path,
        files: meta.files,
        source: 'upload',
        note: meta.note,
      };
      // 已选同名 skill：视为「更新版本」，原位替换数据而非取消选择；未选则追加
      const exists = selections.some((s) => s.name === sel.name);
      onUpdateSkills?.(
        id,
        exists ? selections.map((s) => (s.name === sel.name ? sel : s)) : [...selections, sel]
      );
    } catch (e: any) {
      // 校验失败原因（缺 SKILL.md / 缺 name / description）直接展示给用户
      setUploadError(e?.detail || e?.message || '上传失败，请重试');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    void handleUploadZip(files[0]);
  };

  const actionBar = selections.length > 0 ? (
    <NodeActionBar>
      <NodeActionBar.Custom
        icon={<Search size={16} strokeWidth={1.5} />}
        tooltip="重新选择技能"
        onClick={openPicker}
      />
    </NodeActionBar>
  ) : undefined;

  const renderBifrostList = () => (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar -mx-2 px-2 space-y-1.5">
      {loading && (
        <div className="py-10 flex items-center justify-center gap-2 text-sm text-ink-light font-sans">
          <Loader2 className="w-4 h-4 animate-spin text-accent" strokeWidth={1.5} />
          加载中...
        </div>
      )}
      {!loading && error && (
        <div className="py-10 text-center">
          <p className="text-sm text-error font-sans">{error}</p>
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => void loadSkills(q)}>
            重试
          </Button>
        </div>
      )}
      {!loading && !error && filteredSkills.length === 0 && (
        <div className="py-10 flex flex-col items-center gap-2 text-center">
          <Archive size={30} strokeWidth={1} className="text-ink-faint" />
          <p className="text-sm text-ink-light font-sans">
            {q.trim() || ratingFilter ? '没有匹配筛选条件的 skill' : 'Bifrost Skills 仓库为空（或未配置）'}
          </p>
        </div>
      )}
      {!loading &&
        !error &&
        filteredSkills.map((s) => {
          const isSelected = selectedNames.has(s.name);
          const noteText = s.user_note || s.note;
          return (
            <div
              key={s.id}
              className={`flex items-start gap-3 p-2.5 rounded-md border transition-colors cursor-pointer active:scale-[0.98] ${
                isSelected
                  ? 'border-accent/50 bg-accent-surface/60'
                  : 'border-transparent hover:border-paper-grid hover:bg-paper-grid/30'
              }`}
              onClick={() => void handleInstallBifrost(s)}
            >
              <div className="w-9 h-9 shrink-0 rounded bg-paper border border-paper-grid flex items-center justify-center">
                <Archive size={16} strokeWidth={1.5} className="text-ink-light" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-ink truncate">{s.name}</p>
                  {s.latest_version && (
                    <span className="shrink-0 text-[10px] text-ink-faint font-mono">v{s.latest_version}</span>
                  )}
                  {typeof s.file_count === 'number' && (
                    <span className="shrink-0 text-[10px] text-ink-faint border border-dashed border-paper-grid rounded-pill px-1.5 py-px font-mono tabular-nums">
                      {s.file_count} 文件
                    </span>
                  )}
                  <div onClick={(e) => e.stopPropagation()} className="ml-auto flex items-center gap-2">
                    <RatingStars
                      value={s.user_rating || 0}
                      onChange={(r) => void handleUpdateRating(s, r)}
                      size="xs"
                    />
                    <button
                      type="button"
                      onClick={() => setEditingTarget(s)}
                      title={noteText ? `备注：${noteText}` : '添加私有备注'}
                      className={`p-1 rounded hover:bg-paper-grid transition ${
                        noteText ? 'text-accent' : 'text-ink-faint hover:text-ink'
                      }`}
                    >
                      <StickyNote size={13} />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-ink-light line-clamp-2 leading-relaxed mt-1">{s.description || '（无描述）'}</p>
                {noteText && (
                  <p className="text-[11px] text-accent font-sans mt-1 line-clamp-1 italic bg-accent-surface/50 px-1.5 py-0.5 rounded border border-accent/20">
                    备注：{noteText}
                  </p>
                )}
                {s.compatibility && (
                  <p className="text-[10px] text-ink-faint font-mono mt-1">兼容: {s.compatibility}</p>
                )}
              </div>
              <span
                className={`shrink-0 self-center text-[10px] rounded-pill px-2 py-1 border flex items-center gap-1 transition-colors duration-150 ml-2 ${
                  isSelected
                    ? 'text-accent border-accent/40 bg-accent-surface font-medium'
                    : 'text-accent border-dashed border-accent/30'
                }`}
              >
                {isSelected ? (
                  <>
                    <Check size={11} strokeWidth={2.5} />
                    已选
                  </>
                ) : (
                  '安装'
                )}
              </span>
            </div>
          );
        })}
    </div>
  );

  /** 已选 skill 的 chip 列表（置于列表下方，不干扰搜索与列表坐标） */
  const renderSelectedChips = () => {
    if (selections.length === 0) return null;
    return (
      <div className="shrink-0 pt-2.5 pb-1 border-t border-dashed border-paper-grid space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-serif font-medium text-ink">已选 Skill</span>
            <span className="text-[10px] font-mono tabular-nums text-accent bg-accent-surface border border-accent/30 rounded-pill px-1.5 py-0.5">
              {selections.length}
            </span>
          </div>
          {selections.length > 1 && (
            <button
              type="button"
              onClick={() => onUpdateSkills?.(id, [])}
              className="text-[11px] text-ink-faint hover:text-error transition-colors font-sans"
            >
              清空
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto custom-scrollbar py-0.5">
          {selections.map((s) => (
            <span
              key={s.name}
              className="inline-flex items-center gap-1.5 text-[11px] text-accent bg-accent-surface border border-accent/40 rounded-pill pl-2 pr-1 py-1 font-mono transition-transform active:scale-[0.96]"
            >
              {s.source === 'upload' ? (
                <Upload size={10} strokeWidth={2} />
              ) : (
                <Archive size={10} strokeWidth={2} />
              )}
              <span className="truncate max-w-[160px]">{s.name}</span>
              {s.userRating ? (
                <span className="text-[10px] text-amber-500 font-sans">★{s.userRating}</span>
              ) : null}
              <button
                type="button"
                aria-label={`移除 ${s.name}`}
                className="p-0.5 rounded-full hover:bg-accent/20 text-accent/70 hover:text-accent transition-colors"
                onClick={() => toggleSelection(s)}
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            </span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <CanvasNode
        id={id}
        initialX={initialX}
        initialY={initialY}
        title={title || 'Skill 检索'}
        dotColor={NODE_COLORS.skill_search}
        onRemove={onRemove}
        onPositionChange={onPositionChange}
        onSizeChange={onSizeChange}
        onDrag={onDrag}
        onContextMenu={onContextMenu}
        resizable
        defaultSize={{ width: 440, height: 460 }}
        footer={footer}
        actionBar={actionBar}
        showLeftAnchor
        showRightAnchor
      >
        {selections.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-14 h-14 rounded-full bg-paper border border-dashed border-paper-grid flex items-center justify-center">
              <Archive size={22} strokeWidth={1.5} className="text-ink-faint" />
            </div>
            <div>
              <p className="font-serif text-sm text-ink">尚未选择 skill</p>
              <p className="text-xs text-ink-light mt-0.5">从 Bifrost 仓库检索安装，或上传本地 skill zip</p>
            </div>
            <Button size="sm" onClick={openPicker}>
              选择 Skill
            </Button>
          </div>
        ) : (
          <div className="flex flex-col h-full overflow-hidden gap-3">
            <div className="shrink-0 flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-accent-surface border border-dashed border-accent/40 flex items-center justify-center shrink-0">
                <Archive size={15} strokeWidth={1.5} className="text-accent" />
              </div>
              <div className="min-w-0">
                <p className="font-serif text-sm font-semibold text-ink truncate">
                  已选 {selections.length} 个 skill
                </p>
                <p className="text-xs text-ink-light truncate">
                  {selections.map((s) => s.name).join('、')}
                </p>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto pr-1.5 custom-scrollbar space-y-2.5">
              {selections.map((s) => {
                const noteText = s.userNote || s.note;
                return (
                  <div key={s.name} className="rounded-lg border border-paper-grid bg-paper/40 p-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] text-accent border border-dashed border-accent/30 rounded-pill px-1.5 py-px font-mono shrink-0">
                          {s.source === 'upload' ? '上传' : 'Bifrost'}
                        </span>
                        <p className="text-xs font-medium text-ink truncate">{s.name}</p>
                      </div>
                      {s.userRating ? (
                        <RatingStars value={s.userRating} readonly size="xs" />
                      ) : null}
                    </div>
                    {s.description && (
                      <p className="text-[11px] text-ink-light line-clamp-2 leading-relaxed">{s.description}</p>
                    )}
                    {noteText && (
                      <p className="text-[10px] text-accent font-sans italic line-clamp-2 bg-accent-surface/30 px-1.5 py-0.5 rounded border border-accent/20">
                        备注：{noteText}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CanvasNode>

      {typeof document !== 'undefined' &&
        createPortal(
          <>
            <Dialog
              open={pickerOpen}
              onClose={closePicker}
              title="选择 Skill"
              panelClassName="max-w-2xl h-[620px] max-h-[90vh] flex flex-col"
            >
              <div className="h-full flex flex-col gap-3">
                {/* 上传本地 zip */}
                <div className="shrink-0 rounded-md border border-dashed border-paper-grid bg-paper-grid/20 p-3">
                  <div className="flex items-center gap-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".zip,application/zip"
                      className="hidden"
                      onChange={handlePickFile}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      isLoading={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload size={14} strokeWidth={1.5} className="mr-1" />
                      上传本地 skill zip
                    </Button>
                    <p className="text-xs text-ink-faint font-sans">
                      zip 根目录必须包含 SKILL.md（含 name / description 元数据）
                    </p>
                  </div>
                  {uploadError && (
                    <p className="mt-2 text-xs text-error font-sans flex items-start gap-1">
                      <X size={11} strokeWidth={2} className="shrink-0 mt-0.5" />
                      {uploadError}
                    </p>
                  )}
                </div>

                {/* Bifrost 检索输入框与星级筛选 */}
                <div className="shrink-0 flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search
                      size={15}
                      strokeWidth={1.5}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
                    />
                    <Input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="搜索 Bifrost Skills 仓库…（点击条目切换选择）"
                      className="pl-9"
                      autoFocus
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
                </div>

                {/* 结果列表（弹性填充可用空间） */}
                {renderBifrostList()}

                {/* 已选列表（置于列表下方，零布局偏移） */}
                {renderSelectedChips()}

                {/* 底部操作与完成 */}
                <div className="shrink-0 flex items-center justify-between pt-2.5 border-t border-dashed border-paper-grid">
                  <p className="text-[11px] text-ink-faint font-sans tabular-nums">
                    {selections.length > 0
                      ? `共已选择 ${selections.length} 个 skill`
                      : '尚未选择 skill'}
                  </p>
                  <Button variant="ghost" size="sm" onClick={closePicker}>
                    <Check size={14} strokeWidth={2} className="mr-1" />
                    完成
                  </Button>
                </div>
              </div>
            </Dialog>

            {/* 独立备注编辑弹窗 */}
            <NoteEditModal
              open={Boolean(editingTarget)}
              onClose={() => setEditingTarget(null)}
              resourceName={editingTarget?.name || ''}
              initialRating={editingTarget?.user_rating || 0}
              initialNote={editingTarget?.user_note || editingTarget?.note || ''}
              onSave={handleSaveAnnotation}
            />
          </>,
          document.body
        )}
    </>
  );
};

export const SkillSearchNode = memo(SkillSearchNodeInner);
SkillSearchNode.displayName = 'SkillSearchNode';
export default SkillSearchNode;

