import React, { useState, type KeyboardEvent } from 'react';
import { Tag, X, Plus } from 'lucide-react';

export interface TagInputProps {
  value: string[];
  onChange: (nextTags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  maxTags?: number;
  className?: string;
  disabled?: boolean;
}

/**
 * 通用轻量 TagInput 标签输入组件
 * - 支持 Enter / 逗号 / 分号 生成新标签
 * - 输入框为空时按 Backspace 删除前一个标签
 * - 历史/候选标签一键点选追加
 */
export const TagInput: React.FC<TagInputProps> = ({
  value = [],
  onChange,
  suggestions = [],
  placeholder = '输入标签后按回车…',
  maxTags = 12,
  className = '',
  disabled = false,
}) => {
  const [inputValue, setInputValue] = useState('');

  const addTag = (tagStr: string) => {
    const trimmed = tagStr.trim().replace(/^#+/, '');
    if (!trimmed) return;
    if (value.includes(trimmed)) {
      setInputValue('');
      return;
    }
    if (value.length >= maxTags) return;
    onChange([...value, trimmed]);
    setInputValue('');
  };

  const removeTag = (indexToRemove: number) => {
    onChange(value.filter((_, idx) => idx !== indexToRemove));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，' || e.key === ';' || e.key === '；') {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      e.preventDefault();
      removeTag(value.length - 1);
    }
  };

  // 过滤出未被选中的候选标签（最多展示 8 个最常用）
  const unselectedSuggestions = suggestions
    .filter((s) => s && !value.includes(s))
    .slice(0, 8);

  return (
    <div className={`space-y-1.5 ${className}`}>
      {/* 标签容器与输入框 */}
      <div
        className={`min-h-[38px] p-1.5 bg-paper-grid/20 border border-paper-grid rounded-md flex flex-wrap items-center gap-1.5 transition-colors focus-within:border-accent focus-within:bg-paper ${
          disabled ? 'opacity-60 pointer-events-none' : ''
        }`}
      >
        <Tag size={13} className="text-ink-faint ml-1 mr-0.5 shrink-0" />

        {value.map((tag, idx) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-xs font-sans bg-accent-surface text-accent border border-accent/25 animate-in fade-in zoom-in-95 duration-100"
          >
            <span>#{tag}</span>
            <button
              type="button"
              onClick={() => removeTag(idx)}
              className="hover:text-error rounded-full p-0.5 focus:outline-none transition-colors"
              aria-label={`移除标签 ${tag}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}

        {value.length < maxTags && (
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (inputValue.trim()) addTag(inputValue);
            }}
            placeholder={value.length === 0 ? placeholder : ''}
            disabled={disabled}
            className="flex-1 min-w-[90px] bg-transparent text-xs font-sans text-ink placeholder:text-ink-faint outline-none px-1 py-0.5"
          />
        )}
      </div>

      {/* 候选历史标签建议 */}
      {unselectedSuggestions.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-ink-faint font-sans pt-0.5">
          <span className="shrink-0">已有标签：</span>
          {unselectedSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addTag(s)}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-dashed border-paper-grid bg-paper hover:border-accent/40 hover:text-accent transition-colors active:scale-[0.96]"
              title={`点击添加「${s}」`}
            >
              <Plus size={10} className="opacity-60" />
              <span>{s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default TagInput;
