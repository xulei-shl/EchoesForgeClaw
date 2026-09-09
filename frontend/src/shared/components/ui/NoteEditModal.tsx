import React, { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Textarea } from './Textarea';
import { RatingStars } from './RatingStars';
import { Sparkles, Trash2 } from 'lucide-react';

export interface NoteEditModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  resourceName: string;
  initialRating?: number;
  initialNote?: string;
  onSave: (rating: number, note: string) => Promise<void> | void;
  saving?: boolean;
}

export const NoteEditModal: React.FC<NoteEditModalProps> = ({
  open,
  onClose,
  title = '打标与备注',
  resourceName,
  initialRating = 0,
  initialNote = '',
  onSave,
  saving = false,
}) => {
  const [rating, setRating] = useState(initialRating);
  const [note, setNote] = useState(initialNote);

  useEffect(() => {
    if (open) {
      setRating(initialRating || 0);
      setNote(initialNote || '');
    }
  }, [open, initialRating, initialNote]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(rating, note.trim());
    onClose();
  };

  const handleClear = () => {
    setRating(0);
    setNote('');
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
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-medium text-ink">我的私有备注</label>
            {(rating > 0 || note.trim()) && (
              <button
                type="button"
                onClick={handleClear}
                className="text-[11px] text-ink-faint hover:text-error transition-colors flex items-center gap-1 font-sans"
              >
                <Trash2 size={12} />
                清空打标与备注
              </button>
            )}
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="仅自己可见的私有心得/使用场景说明…"
            rows={4}
            className="text-xs font-sans"
            autoFocus
          />
        </div>

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
