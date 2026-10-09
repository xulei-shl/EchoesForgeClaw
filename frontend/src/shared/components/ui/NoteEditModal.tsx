import React, { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Textarea } from './Textarea';
import { RatingStars } from './RatingStars';
import { TagInput } from './TagInput';
import { Toggle } from './Toggle';
import { Sparkles, Trash2, Users } from 'lucide-react';
import type { PublicNote } from '../../types';

export interface NoteEditModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  resourceName: string;
  initialRating?: number;
  initialNote?: string;
  initialTags?: string[];
  initialIsPublic?: boolean;
  suggestedTags?: string[];
  showPublicToggle?: boolean;
  publicNotes?: PublicNote[];
  onSave: (rating: number, note: string, tags: string[], isPublic?: boolean) => Promise<void> | void;
  saving?: boolean;
}

export const NoteEditModal: React.FC<NoteEditModalProps> = ({
  open,
  onClose,
  title = '打标与备注',
  resourceName,
  initialRating = 0,
  initialNote = '',
  initialTags = [],
  initialIsPublic = false,
  suggestedTags = [],
  showPublicToggle = false,
  publicNotes = [],
  onSave,
  saving = false,
}) => {
  const [rating, setRating] = useState(initialRating);
  const [note, setNote] = useState(initialNote);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [isPublic, setIsPublic] = useState(initialIsPublic);

  useEffect(() => {
    if (open) {
      setRating(initialRating || 0);
      setNote(initialNote || '');
      setTags(initialTags || []);
      setIsPublic(Boolean(initialIsPublic && initialNote.trim()));
    }
  }, [open, initialRating, initialNote, initialTags, initialIsPublic]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(rating, note.trim(), tags, Boolean(note.trim() && isPublic));
    onClose();
  };

  const handleClear = () => {
    setRating(0);
    setNote('');
    setTags([]);
    setIsPublic(false);
  };

  return (
    <Dialog open={open} onClose={onClose} title={title} panelClassName="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <p className="text-xs text-ink-faint font-sans">目标对象</p>
          <p className="text-sm font-semibold text-ink font-serif truncate mt-0.5" title={resourceName}>
            {resourceName}
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-ink mb-1.5">我的评分（1-5 星）</label>
          <div className="flex items-center gap-3 bg-paper-grid/20 border border-paper-grid rounded-md p-2.5">
            <RatingStars value={rating} onChange={setRating} size="md" />
            <span className="text-xs font-sans text-ink-light">
              {rating > 0 ? `${rating} 星` : '未评分（点击星星打标）'}
            </span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-ink mb-1.5">我的标签（0~多个，按回车添加）</label>
          <TagInput
            value={tags}
            onChange={setTags}
            suggestions={suggestedTags}
            placeholder="输入标签并按回车…"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-medium text-ink">我的备注与经验</label>
            {(rating > 0 || note.trim() || tags.length > 0) && (
              <button
                type="button"
                onClick={handleClear}
                className="text-[11px] text-ink-faint hover:text-error transition-colors flex items-center gap-1 font-sans"
              >
                <Trash2 size={12} />
                清空所有标注
              </button>
            )}
          </div>
          <Textarea
            value={note}
            onChange={(e) => {
              const val = e.target.value;
              setNote(val);
              if (!val.trim()) setIsPublic(false);
            }}
            placeholder="心得体会/模型调用建议/避坑指南…"
            rows={3}
            className="text-xs font-sans"
            autoFocus
          />
        </div>

        {/* 公开共享开关 */}
        {showPublicToggle && (
          <div className="flex items-center justify-between p-2.5 rounded border border-paper-grid bg-paper-grid/10">
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-ink">公开至团队</p>
              <p className="text-[10px] text-ink-faint font-sans">
                开启后沉淀为团队公共经验，同事查阅可见
              </p>
            </div>
            <Toggle
              checked={isPublic}
              onChange={(next) => {
                if (!note.trim()) return;
                setIsPublic(next);
              }}
              disabled={!note.trim()}
              label="公开至团队"
            />
          </div>
        )}

        {/* 同事公开经验列表 */}
        {publicNotes.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-dashed border-paper-grid">
            <p className="text-xs font-serif font-semibold text-ink flex items-center gap-1.5">
              <Users size={13} className="text-accent" />
              同事公开经验交流（{publicNotes.length}）
            </p>
            <div className="space-y-2 max-h-36 overflow-y-auto custom-scrollbar pr-1">
              {publicNotes.map((pn, i) => (
                <div key={i} className="p-2 rounded bg-paper-grid/15 border border-paper-grid text-[11px] space-y-1">
                  <div className="flex items-center justify-between text-ink-faint">
                    <span className="font-medium text-ink">{pn.display_name || pn.username}</span>
                    {pn.updated_at && <span>{pn.updated_at.slice(0, 10)}</span>}
                  </div>
                  <p className="text-ink leading-relaxed whitespace-pre-wrap">{pn.note}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-dashed border-paper-grid">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="submit" size="sm" isLoading={saving}>
            <Sparkles size={14} className="mr-1" />
            保存标注
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default NoteEditModal;
