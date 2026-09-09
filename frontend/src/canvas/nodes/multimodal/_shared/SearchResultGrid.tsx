import React from 'react';
import { Loader2, AlertTriangle, Layers } from 'lucide-react';

interface SearchResultGridProps {
  loading: boolean;
  error: string | null;
  items: any[];
  emptyMessage: string;
  hasMore: boolean;
  onLoadMore: () => void;
  renderItem: (item: any, index: number) => React.ReactNode;
}

export const SearchResultGrid = React.memo(({ loading, error, items, emptyMessage, hasMore, onLoadMore, renderItem }: SearchResultGridProps) => {
  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-ink-faint" /></div>;
  if (error) return <div className="flex items-center justify-center gap-2 py-8 text-xs text-red-400"><AlertTriangle size={14} />{error}</div>;
  if (items.length === 0) return <div className="flex flex-col items-center justify-center py-12 text-ink-faint"><Layers size={28} className="mb-2" /><span className="text-xs">{emptyMessage}</span></div>;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">{items.map((item, i) => renderItem(item, i))}</div>
      {hasMore && <button className="h-8 text-xs font-medium rounded-lg border border-paper-grid hover:bg-paper-grid/20" onClick={onLoadMore}>加载更多</button>}
    </div>
  );
});