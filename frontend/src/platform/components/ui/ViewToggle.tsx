import React from 'react';
import { LayoutGrid, List } from 'lucide-react';

export type ViewMode = 'grid' | 'list';

export interface ViewToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
}

export const ViewToggle: React.FC<ViewToggleProps> = ({ mode, onChange, className = '' }) => {
  const getBtnClass = (active: boolean) =>
    `p-1.5 rounded text-xs font-sans flex items-center justify-center transition-all duration-150 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
      active
        ? 'bg-paper text-accent shadow-sm border border-paper-grid/50 font-medium'
        : 'text-ink-faint hover:text-ink hover:bg-paper-grid/20'
    }`;

  return (
    <div
      role="group"
      aria-label="视图模式切换"
      className={`inline-flex items-center p-0.5 rounded-md bg-paper-grid/25 border border-paper-grid/40 ${className}`}
    >
      <button
        type="button"
        aria-pressed={mode === 'grid'}
        aria-label="网格视图"
        title="网格视图"
        onClick={() => onChange('grid')}
        className={getBtnClass(mode === 'grid')}
      >
        <LayoutGrid size={15} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-pressed={mode === 'list'}
        aria-label="列表视图"
        title="列表视图"
        onClick={() => onChange('list')}
        className={getBtnClass(mode === 'list')}
      >
        <List size={15} strokeWidth={1.75} />
      </button>
    </div>
  );
};

export default ViewToggle;
