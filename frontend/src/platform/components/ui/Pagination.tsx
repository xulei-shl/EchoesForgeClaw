import React from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  className = '',
}) => {
  if (totalPages <= 1) return null;

  const pages: (number | string)[] = [];

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('...');
    
    let start = Math.max(2, currentPage - 1);
    let end = Math.min(totalPages - 1, currentPage + 1);
    
    if (currentPage <= 3) end = 4;
    if (currentPage >= totalPages - 2) start = totalPages - 3;
    
    for (let i = start; i <= end; i++) pages.push(i);
    
    if (currentPage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  return (
    <nav className={`flex items-center justify-center gap-1 ${className}`} aria-label="Pagination">
      <button
        type="button"
        disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
        className="p-1.5 rounded-md text-ink hover:bg-accent-surface hover:text-accent disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink transition-colors"
        aria-label="Previous page"
      >
        <ChevronLeft size={16} strokeWidth={2} />
      </button>

      {pages.map((p, i) =>
        typeof p === 'string' ? (
          <span key={`dots-${i}`} className="px-1 text-ink-faint">
            <MoreHorizontal size={14} strokeWidth={2} />
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            className={`min-w-[32px] h-8 px-2 flex items-center justify-center rounded-md text-sm font-sans font-medium transition-colors ${
              currentPage === p
                ? 'bg-accent text-white'
                : 'text-ink hover:bg-accent-surface hover:text-accent'
            }`}
            aria-current={currentPage === p ? 'page' : undefined}
          >
            {p}
          </button>
        )
      )}

      <button
        type="button"
        disabled={currentPage === totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        className="p-1.5 rounded-md text-ink hover:bg-accent-surface hover:text-accent disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink transition-colors"
        aria-label="Next page"
      >
        <ChevronRight size={16} strokeWidth={2} />
      </button>
    </nav>
  );
};
