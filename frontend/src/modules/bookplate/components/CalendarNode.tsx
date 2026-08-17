import React, { memo, useEffect, useState } from 'react';
import { CalendarDays, Loader2, Search, AlertTriangle } from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { Streamdown, cjk, code } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';
import { NODE_COLORS } from '../nodeTypes';

/** 本地时区的今天（yyyy-MM-dd），避免 toISOString 的 UTC 偏移导致跨天。 */
function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface CalendarNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 最近一次查询的日期（yyyy-MM-dd） */
  date?: string;
  /** 查询结果（万年历文本，写入 data.output 作为对外输出） */
  output?: string;
  isGenerating?: boolean;
  error?: string | null;
  /** 提交查询（date 为 yyyy-MM-dd） */
  onFetch?: (id: string, date: string) => void;
  onRemove?: (id: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  /** 卡片底部「+」插槽 */
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const CalendarNodeInner: React.FC<CalendarNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  date,
  output = '',
  isGenerating = false,
  error = null,
  onFetch,
  onRemove,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
}) => {
  const [dateInput, setDateInput] = useState(() => date || todayLocal());

  // 外部内容变化（撤销/重做/历史恢复）时同步草稿日期
  useEffect(() => {
    if (date) setDateInput(date);
  }, [date]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const d = dateInput.trim();
    if (!d || isGenerating) return;
    onFetch?.(id, d);
  };

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '万年历'}
      dotColor={NODE_COLORS.calendar}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 420, height: 480 }}
      className={isGenerating && !error ? 'transition-[box-shadow,border-color,opacity] duration-200 border-transparent' : ''}
      glowOverlay={isGenerating && !error ? <BeamGlow /> : undefined}
      showRightAnchor
      footer={footer}
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-3">
        {/* 查询表单：始终可见，便于重复查询 */}
        <form onSubmit={handleSubmit} className="shrink-0 flex gap-2">
          <input
            type="date"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            disabled={isGenerating}
            className="flex-1 h-10 min-w-0 rounded-md border border-dashed border-paper-grid bg-transparent px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!dateInput.trim() || isGenerating}
            className="flex items-center justify-center w-10 h-10 shrink-0 rounded-md bg-accent text-paper hover:bg-accent-hover active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
            title="查询"
          >
            <Search size={15} strokeWidth={2} />
          </button>
        </form>

        {/* 结果 / 加载 / 错误区 */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
          {isGenerating ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
              <Loader2 className="w-5 h-5 text-accent animate-spin" strokeWidth={1.5} />
              <p className="text-xs font-serif text-accent">正在查询万年历...</p>
            </div>
          ) : error ? (
            <div className="p-3 rounded-md border border-error/20 bg-error/5 flex items-start gap-2.5">
              <AlertTriangle size={14} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
              <p className="flex-1 min-w-0 text-[12px] text-error/90 leading-relaxed break-words font-sans">{error}</p>
            </div>
          ) : output.trim() ? (
            <div className="w-full min-w-0 font-sans text-sm leading-relaxed">
              <Streamdown
                plugins={{ cjk, code }}
                isAnimating={false}
                caret="block"
                linkSafety={{ enabled: false }}
              >
                {normalizeMarkdown(output)}
              </Streamdown>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[140px]">
              <div className="w-14 h-14 rounded-full border border-dashed border-paper-grid bg-paper-grid/20 flex items-center justify-center text-ink-faint">
                <CalendarDays size={24} strokeWidth={1.5} />
              </div>
              <p className="text-sm font-serif text-ink-light">选择日期查询节假日与农历万年历</p>
              <p className="text-xs text-ink-faint font-sans">默认查询今天</p>
            </div>
          )}
        </div>
      </div>
    </CanvasNode>
  );
};

export const CalendarNode = memo(CalendarNodeInner);
CalendarNode.displayName = 'CalendarNode';
export default CalendarNode;
