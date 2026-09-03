import React, { useRef, useEffect } from 'react';
import { Check } from 'lucide-react';
import { STAMP_TEXT_PRESETS, type StampTextPresetGroup, type StampTextPresetItem } from './StampTextToolbar';

interface StampTextEditModalProps {
  isNew: boolean;
  value: string;
  onChange: (val: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onSelectPreset?: (preset: {
    text: string;
    writingMode?: 'horizontal' | 'vertical';
    w?: number;
  }) => void;
}

export const StampTextEditModal: React.FC<StampTextEditModalProps> = ({
  isNew,
  value,
  onChange,
  onConfirm,
  onCancel,
  onSelectPreset,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    if (!isNew) {
      textareaRef.current?.select();
    }
  }, [isNew]);

  return (
    <div
      className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
      onClick={onCancel}
    >
      <div
        className="bg-paper border border-paper-grid/80 rounded-xl p-3.5 shadow-2xl w-full max-w-[320px] flex flex-col gap-2.5 animate-in fade-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between text-xs font-medium text-ink">
          <span className="font-sans font-semibold">
            {isNew ? '添加邮票文字' : '编辑邮票文字'}
          </span>
          <span className="text-[10px] text-ink-faint">Enter 确定 · Shift+Enter 换行</span>
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onConfirm();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          className="w-full h-20 bg-paper-grid/20 border border-paper-grid/60 rounded-md p-2 text-xs font-sans text-ink focus:outline-none focus:ring-1 focus:ring-accent resize-none"
          placeholder="输入面值、地名、志号或发行文字..."
        />

        {/* 常用邮票词条快捷填充 */}
        <div className="flex flex-col gap-1.5 pt-1 border-t border-paper-grid/40">
          <span className="text-[10px] text-ink-faint select-none">快捷填入常用邮票格式:</span>
          <div className="flex flex-col gap-1">
            {STAMP_TEXT_PRESETS.map((group: StampTextPresetGroup) => (
              <div key={group.group} className="flex items-center gap-1 flex-wrap">
                <span className="text-[10px] text-ink-faint w-14 shrink-0">{group.group}:</span>
                {group.items.map((pst: StampTextPresetItem) => (
                  <button
                    key={pst.label}
                    type="button"
                    onClick={() => {
                      onChange(pst.text);
                      onSelectPreset?.({
                        text: pst.text,
                        writingMode: pst.writingMode,
                        w: pst.w,
                      });
                    }}
                    className="px-1.5 py-0.5 rounded bg-paper-grid/30 hover:bg-paper-grid/60 text-ink-light hover:text-ink text-[10px] active:scale-95 transition"
                  >
                    {pst.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-paper-grid/40">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 rounded text-xs text-ink-light hover:bg-paper-grid/40 transition"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex items-center gap-1 px-3.5 py-1 rounded text-xs bg-accent text-white font-medium hover:bg-accent/90 transition shadow-xs"
          >
            <Check size={12} strokeWidth={2.5} />
            <span>确定</span>
          </button>
        </div>
      </div>
    </div>
  );
};
