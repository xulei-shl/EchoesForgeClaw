import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';

export interface EditorialTextModalProps {
  editingTextId: string | null;
  editingTextValue: string;
  textInputRef: React.RefObject<HTMLTextAreaElement | null>;
  onValueChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

/** 自由文本居中编辑模态框组件 */
export const EditorialTextModal: React.FC<EditorialTextModalProps> = ({
  editingTextId,
  editingTextValue,
  textInputRef,
  onValueChange,
  onSave,
  onCancel,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSave();
    }
  };

  return (
    <AnimatePresence initial={false}>
      {editingTextId && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96, x: '-50%', y: '-50%' }}
          animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
          exit={{ opacity: 0, scale: 0.97, x: '-50%', y: '-50%' }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="absolute z-50 flex flex-col gap-2 p-3 rounded-2xl bg-paper/95 backdrop-blur-md shadow-2xl border border-paper-grid/60"
          style={{
            top: '50%',
            left: '50%',
            width: 280,
            maxWidth: 'calc(100% - 24px)',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between text-xs text-ink-light px-0.5 select-none">
            <span className="font-medium text-ink">
              {editingTextId === 'new' ? '添加文字' : '编辑文字'}
            </span>
            <span className="text-[10px] text-ink-faint">Enter 确认 · Shift+Enter 换行</span>
          </div>
          <textarea
            ref={textInputRef}
            value={editingTextValue}
            onChange={(e) => onValueChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full h-20 resize-none rounded-lg border border-paper-grid/60 bg-paper px-2.5 py-1.5 text-xs text-ink leading-relaxed outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 transition-colors font-sans"
            autoFocus
            placeholder="输入文字…"
          />
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={onCancel}
              className="px-2.5 py-1 text-xs text-ink-light rounded-md hover:bg-paper-grid/30 active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out"
            >
              取消
            </button>
            <button
              type="button"
              onClick={onSave}
              className="flex items-center gap-1 px-3 py-1 text-xs text-white font-medium bg-accent rounded-md hover:bg-accent-hover active:scale-[0.96] shadow-sm transition-[background-color,transform] duration-150 ease-out"
            >
              <Check size={12} strokeWidth={2.5} />
              确认
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
