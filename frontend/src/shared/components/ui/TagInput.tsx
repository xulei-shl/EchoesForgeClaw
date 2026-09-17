import React, { useState, useMemo, type KeyboardEvent, useRef } from 'react';
import { Tag, X, Plus, ChevronDown, ChevronUp, Search } from 'lucide-react';

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
 * - 支持输入 Typeahead 实时智能联想补全
 * - 支持「已有标签」高频快捷点选 + 折叠/展开全部标签盘（带内部搜索与滚动防爆）
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
  const [isExpanded, setIsExpanded] = useState(false);
  const [tagFilterQuery, setTagFilterQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

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

  // 输入时的实时联想补全列表
  const typeaheadMatches = useMemo(() => {
    const q = inputValue.trim().replace(/^#+/, '').toLowerCase();
    if (!q) return [];
    return suggestions
      .filter((s) => s && !value.includes(s) && s.toLowerCase().includes(q))
      .slice(0, 5);
  }, [inputValue, suggestions, value]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，' || e.key === ';' || e.key === '；') {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      e.preventDefault();
      removeTag(value.length - 1);
    }
  };

  // 所有未被选中的已有标签
  const allUnselected = useMemo(() => {
    return suggestions.filter((s) => s && !value.includes(s));
  }, [suggestions, value]);

  // 展开抽屉内的搜索过滤
  const expandedList = useMemo(() => {
    if (!tagFilterQuery.trim()) return allUnselected;
    const q = tagFilterQuery.toLowerCase().trim();
    return allUnselected.filter((s) => s.toLowerCase().includes(q));
  }, [allUnselected, tagFilterQuery]);

  // 折叠状态下仅展示前 8 个常用
  const previewSuggestions = allUnselected.slice(0, 8);

  return (
    <div className={`space-y-1.5 ${className}`} ref={containerRef}>
      {/* 标签容器与输入框 */}
      <div className="relative">
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
                setTimeout(() => {
                  if (inputValue.trim()) addTag(inputValue);
                }, 150);
              }}
              placeholder={value.length === 0 ? placeholder : ''}
              disabled={disabled}
              className="flex-1 min-w-[90px] bg-transparent text-xs font-sans text-ink placeholder:text-ink-faint outline-none px-1 py-0.5"
            />
          )}
        </div>

        {/* 键入实时联想浮层（Typeahead Dropdown） */}
        {typeaheadMatches.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-paper border border-dashed border-paper-grid rounded-md shadow-md z-30 py-1 animate-in fade-in zoom-in-95 duration-100">
            <div className="px-2 py-0.5 text-[10px] text-ink-faint font-sans">匹配已有标签（点击添加）：</div>
            {typeaheadMatches.map((match) => (
              <button
                key={match}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTag(match);
                }}
                className="w-full text-left px-2.5 py-1 text-xs text-ink hover:bg-paper-grid/50 hover:text-accent flex items-center justify-between font-sans transition-colors"
              >
                <span>#{match}</span>
                <Plus size={11} className="text-ink-faint" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 已有标签区域：防爆折叠 + 内部滚动与搜索 */}
      {allUnselected.length > 0 && (
        <div className="pt-0.5">
          {!isExpanded ? (
            /* 默认收起态：展示常用前 8 个 + 展开全部按钮 */
            <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-ink-faint font-sans">
              <span className="shrink-0">已有标签：</span>
              {previewSuggestions.map((s) => (
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
              {allUnselected.length > 8 && (
                <button
                  type="button"
                  onClick={() => setIsExpanded(true)}
                  className="inline-flex items-center gap-0.5 text-accent hover:text-accent-hover px-1.5 py-0.5 font-medium transition-colors"
                >
                  <span>全部 ({allUnselected.length})</span>
                  <ChevronDown size={12} />
                </button>
              )}
            </div>
          ) : (
            /* 展开态：带内部搜索过滤和固定高度滚动槽，无论多少标签都不会撑爆弹窗 */
            <div className="p-2 bg-paper-grid/15 border border-dashed border-paper-grid rounded-md space-y-1.5 animate-in fade-in duration-150">
              <div className="flex items-center justify-between gap-2">
                <div className="relative flex-1">
                  <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                  <input
                    type="text"
                    value={tagFilterQuery}
                    onChange={(e) => setTagFilterQuery(e.target.value)}
                    placeholder="过滤已有标签…"
                    className="w-full h-6 pl-5 pr-2 text-[11px] font-sans bg-paper border border-paper-grid rounded focus:outline-none focus:border-accent text-ink placeholder:text-ink-faint"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsExpanded(false);
                    setTagFilterQuery('');
                  }}
                  className="text-[11px] text-ink-faint hover:text-ink shrink-0 flex items-center gap-0.5 font-sans px-1"
                >
                  <span>收起</span>
                  <ChevronUp size={11} />
                </button>
              </div>

              {/* 滚动便签云（锁死最大高度 max-h-28 约 112px） */}
              <div className="max-h-28 overflow-y-auto flex flex-wrap gap-1.5 pr-1">
                {expandedList.length > 0 ? (
                  expandedList.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => addTag(s)}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] rounded border border-dashed border-paper-grid bg-paper hover:border-accent/40 hover:text-accent transition-colors active:scale-[0.96]"
                      title={`点击添加「${s}」`}
                    >
                      <Plus size={10} className="opacity-60" />
                      <span>{s}</span>
                    </button>
                  ))
                ) : (
                  <div className="text-[11px] text-ink-faint py-1 w-full text-center font-sans">
                    未找到匹配标签
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TagInput;
