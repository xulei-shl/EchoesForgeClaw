import React from 'react';
import { Search, X, Loader2 } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading?: boolean;
  placeholder?: string;
}

export const SearchBar = React.memo(({ value, onChange, onSubmit, loading, placeholder = '搜索...' }: SearchBarProps) => {
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') onSubmit(); };
  return (
    <div className="relative flex items-center gap-1.5">
      <div className="relative flex-1">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          className="w-full h-8 pl-8 pr-7 text-xs rounded-lg border border-paper-grid bg-paper focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {value && (
          <button className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink" onClick={() => onChange('')}>
            <X size={14} />
          </button>
        )}
      </div>
      <button
        className="h-8 px-3 text-xs font-medium rounded-lg bg-accent text-paper hover:bg-accent/90 disabled:opacity-50 flex items-center gap-1"
        onClick={onSubmit} disabled={loading || !value.trim()}
      >
        {loading && <Loader2 size={12} className="animate-spin" />}
        搜索
      </button>
    </div>
  );
});