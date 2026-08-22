import React from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { SearchImageThumbnail } from './SearchImageThumbnail';
import type { ColorItem } from './ColorSearchNode';

interface ColorSearchTabProps {
  categories: string[];
  activeCategory: string;
  onCategoryChange: (cat: string) => void;
  activeTemp: string;
  onTempChange: (temp: string) => void;
  query: string;
  onQueryChange: (v: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  onClearQuery: () => void;
  loading: boolean;
  searchError: string;
  items: ColorItem[];
  onSelect: (color: ColorItem) => void;
  savingId: string | null;
  isLocked: boolean;
  selectedColor: ColorItem | null;
  upstreamKeyword: string;
}

export const ColorSearchTab = React.memo<ColorSearchTabProps>(({
  categories,
  activeCategory,
  onCategoryChange,
  activeTemp,
  onTempChange,
  query,
  onQueryChange,
  onSubmit,
  onClearQuery,
  loading,
  searchError,
  items,
  onSelect,
  savingId,
  isLocked,
  selectedColor,
  upstreamKeyword,
}) => {
  return (
    <div className="flex-1 flex flex-col min-h-0 gap-2">
      <div className="shrink-0 flex items-center gap-1.5 flex-wrap">
        <div className="relative min-w-[100px] flex-1">
          <select
            value={activeCategory}
            onChange={(e) => onCategoryChange(e.target.value)}
            className="w-full h-7 pl-2 pr-6 rounded-md border border-dashed border-paper-grid bg-transparent text-xs font-serif text-ink focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
          >
            <option value="" className="bg-paper text-ink">全部色系 (742 色)</option>
            {categories.map((cat) => (
              <option key={cat} value={cat} className="bg-paper text-ink">{cat}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-0.5 bg-ink/5 p-0.5 rounded-md border border-paper-grid/40">
          {['暖', '冷', '中性'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTempChange(t)}
              className={`px-1.5 py-0.5 text-[11px] font-serif rounded transition-colors ${
                activeTemp === t ? 'bg-paper text-ink font-bold shadow-xs' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="flex-1 min-w-[120px] flex items-center gap-1">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={upstreamKeyword ? `上游词: ${upstreamKeyword}` : '搜色名/拼音/HEX'}
              className="w-full h-7 pl-2 pr-5 rounded-md border border-dashed border-paper-grid bg-transparent text-xs text-ink placeholder:text-ink-muted/50 focus:outline-none focus:border-accent transition-colors font-serif"
            />
            {query && (
              <button
                type="button"
                onClick={onClearQuery}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {searchError ? (
          <div className="h-full flex items-center justify-center text-xs text-red-500 font-serif p-4 text-center">
            {searchError}
          </div>
        ) : items.length === 0 && !loading ? (
          <div className="h-full flex flex-col items-center justify-center text-ink-muted text-xs font-serif p-4 text-center gap-1">
            <span>未找到匹配的传统色</span>
            <button
              type="button"
              onClick={onClearQuery}
              className="text-accent underline hover:opacity-80"
            >
              重置筛选条件
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {items.map((color) => {
              const isSelected = selectedColor?.id === color.id;
              return (
                <div
                  key={color.id}
                  className={`group relative flex flex-col rounded-lg border overflow-hidden transition-all duration-200 ${
                    isSelected
                      ? 'border-accent ring-2 ring-accent/30 shadow-md scale-[1.02]'
                      : 'border-paper-grid/60 hover:border-accent/60 hover:shadow-xs'
                  }`}
                >
                  <div
                    className="relative aspect-4/3 overflow-hidden cursor-pointer"
                    style={{ backgroundColor: color.hex }}
                  >
                    <SearchImageThumbnail
                      thumbUrl={color.thumb_url || ''}
                      previewUrl={color.full_image_url || color.thumb_url || ''}
                      alt={color.name}
                      className="!aspect-4/3"
                    />
                    <span
                      className="absolute top-1 left-1 w-3 h-3 rounded-full border border-white/60 shadow-xs z-10 pointer-events-none"
                      style={{ backgroundColor: color.hex }}
                      title={`HEX: ${color.hex}`}
                    />
                    {isSelected ? (
                      <div
                        title="当前已选为此传统色输出"
                        className="absolute top-1 right-1 px-1.5 h-5 rounded-full flex items-center gap-0.5 bg-accent text-paper text-[10px] font-sans font-medium shadow-sm pointer-events-none z-10"
                      >
                        <Check size={11} strokeWidth={2.5} />
                        <span>已选</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onSelect(color); }}
                        disabled={savingId === color.id || isLocked}
                        title={isLocked ? '有下级节点，不可更换输出' : '选用此传统色作为基准色并输出'}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center bg-black/45 text-white/90 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent disabled:opacity-40 disabled:hover:bg-black/45 disabled:cursor-not-allowed active:scale-95 z-10"
                      >
                        {savingId === color.id ? (
                          <Loader2 size={12} strokeWidth={2} className="animate-spin" />
                        ) : (
                          <Check size={12} strokeWidth={2.5} />
                        )}
                      </button>
                    )}
                  </div>
                  <div
                    className="px-2 py-1.5 flex flex-col justify-between transition-colors"
                    style={{ backgroundColor: `${color.hex}15` }}
                  >
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="text-xs font-serif font-bold text-ink truncate">{color.name}</span>
                      <span className="text-[10px] font-mono text-ink-muted truncate">{color.id}</span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[10px] font-mono text-ink-muted">{color.hex}</span>
                      <span className="text-[9px] font-serif px-1 rounded bg-black/5 text-ink-muted">{color.temperature || '中性'}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});