import React from 'react';
import { Sparkles, SlidersHorizontal } from 'lucide-react';
import type { StampAspectRatio, StampGrid } from './types';

interface StampCutterToolbarProps {
  grid: StampGrid;
  aspectRatio: StampAspectRatio;
  withMargin: boolean;
  isStudioOpen: boolean;
  hasStudioActive?: boolean;
  onGridChange: (grid: StampGrid) => void;
  onRatioChange: (ratio: StampAspectRatio) => void;
  onToggleMargin: () => void;
  onToggleStudio: () => void;
}

export const StampCutterToolbar: React.FC<StampCutterToolbarProps> = ({
  grid,
  aspectRatio,
  withMargin,
  isStudioOpen,
  hasStudioActive,
  onGridChange,
  onRatioChange,
  onToggleMargin,
  onToggleStudio,
}) => {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-paper-grid/20 border border-paper-grid/40 text-xs font-sans text-ink-light select-none shrink-0 flex-wrap">
      {/* 左组：版式与比例 */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-ink-faint text-[11px] px-0.5 whitespace-nowrap">版式:</span>
          <select
            value={`${grid.rows}x${grid.cols}`}
            aria-label="邮票多联网格版式"
            onChange={(e) => {
              const [r, c] = e.target.value.split('x').map(Number);
              if (r && c) {
                onGridChange({ rows: r, cols: c });
              }
            }}
            className="bg-paper/90 border border-paper-grid/60 text-ink rounded px-1.5 py-0.5 text-xs font-medium tabular-nums focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
          >
            <optgroup label="基础">
              <option value="1x1">1×1 单张</option>
            </optgroup>
            <optgroup label="竖版多联">
              <option value="2x1">1×2 竖双联</option>
              <option value="3x1">1×3 竖三联</option>
              <option value="4x1">1×4 竖四联</option>
            </optgroup>
            <optgroup label="横版多联">
              <option value="1x2">2×1 横双联</option>
              <option value="1x3">3×1 横三联</option>
              <option value="1x4">4×1 横四联</option>
            </optgroup>
            <optgroup label="方形/网格多联">
              <option value="2x2">2×2 四方联</option>
              <option value="2x3">3×2 六联</option>
              <option value="3x2">2×3 六联</option>
              <option value="3x3">3×3 九联</option>
            </optgroup>
          </select>
        </div>

        <div className="w-px h-3.5 bg-paper-grid/60 my-auto shrink-0" />

        <div className="flex items-center p-0.5 rounded-md bg-paper-grid/30 border border-paper-grid/50 select-none shrink-0">
          {(['3:4', '4:3', '1:1', 'free'] as StampAspectRatio[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRatioChange(r)}
              className={`px-1.5 py-0.5 rounded text-[11px] tabular-nums active:scale-[0.96] transition-[color,background-color,transform] duration-150 cursor-pointer ${
                aspectRatio === r
                  ? 'bg-paper shadow-2xs text-accent font-medium'
                  : 'text-ink-light hover:text-ink hover:bg-paper-grid/40'
              }`}
            >
              {r === 'free' ? '自由' : r}
            </button>
          ))}
        </div>
      </div>

      {/* 右组：纸边开关与工坊高级面板开关 */}
      <div className="flex items-center gap-1.5 shrink-0">

        <button
          type="button"
          onClick={onToggleMargin}
          aria-pressed={withMargin}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs active:scale-[0.96] transition-[color,background-color,transform] duration-150 cursor-pointer ${
            withMargin
              ? 'bg-accent/15 text-accent font-medium'
              : 'hover:bg-paper-grid/40 text-ink-light'
          }`}
          title={withMargin ? '关闭纸边' : '开启纸边'}
        >
          <Sparkles size={12} />
          <span>纸边</span>
        </button>

        <button
          type="button"
          onClick={onToggleStudio}
          aria-pressed={isStudioOpen}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs active:scale-[0.96] transition-[color,background-color,transform] duration-150 cursor-pointer ${
            isStudioOpen
              ? 'bg-accent text-white font-medium shadow-2xs'
              : hasStudioActive
                ? 'bg-accent/20 text-accent font-medium border border-accent/40'
                : 'hover:bg-paper-grid/40 text-ink-light'
          }`}
          title="展开/收起 Stamp Studio 邮票工坊参数"
        >
          <SlidersHorizontal size={12} />
          <span>工坊</span>
        </button>
      </div>
    </div>
  );
};
