import React, { memo, useEffect, useState, useCallback } from 'react';
import { CalendarDays, Loader2, Search, AlertTriangle, Sparkles } from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { DatePicker } from '../../../platform/components/ui/DatePicker';
import { Streamdown, cjk, code } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';
import { NODE_COLORS } from '../nodeTypes';

/** 格式化日期为 YYYY-MM-DD */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 本地时区的今天（yyyy-MM-dd），避免 toISOString 的 UTC 偏移导致跨天 */
function todayLocal(): string {
  return formatDate(new Date());
}

/** 获取相对今天的偏移日期（yyyy-MM-dd） */
function getOffsetDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return formatDate(d);
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

const QUICK_PRESETS = [
  { label: '今天', getDays: 0 },
  { label: '明天', getDays: 1 },
  { label: '昨天', getDays: -1 },
];

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

  const handleQuery = useCallback(
    (targetDate?: string) => {
      const d = (targetDate || dateInput).trim();
      if (!d || isGenerating) return;
      onFetch?.(id, d);
    },
    [dateInput, id, isGenerating, onFetch]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleQuery();
  };

  const handleQuickPreset = (offset: number) => {
    const d = getOffsetDate(offset);
    setDateInput(d);
    handleQuery(d);
  };

  const renderActionBar = () => {
    if (isGenerating) return undefined;
    return (
      <NodeActionBar>
        {(output.trim() || error) && (
          <NodeActionBar.Retry
            onClick={() => handleQuery()}
            error={!!error}
            tooltip={error ? '重试查询' : '重新查询'}
          />
        )}
        {output.trim() && (
          <NodeActionBar.Copy
            text={output}
            tooltip="复制万年历内容"
            toastMessage="万年历信息已复制到剪贴板"
          />
        )}
      </NodeActionBar>
    );
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
      actionBar={renderActionBar()}
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-3">
        {/* 顶部表单与快捷预设 */}
        <div className="shrink-0 space-y-2">
          <form onSubmit={handleSubmit} className="flex gap-2 items-center">
            <div className="flex-1 min-w-0">
              <DatePicker
                value={dateInput}
                onChange={(newVal) => setDateInput(newVal)}
                disabled={isGenerating}
                placeholder="选择日期（YYYY-MM-DD）"
              />
            </div>
            <button
              type="submit"
              disabled={!dateInput.trim() || isGenerating}
              title="查询此日期"
              className="flex items-center justify-center w-10 h-10 shrink-0 rounded-md bg-accent text-paper hover:bg-accent-hover active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Search size={15} strokeWidth={2} />
            </button>
          </form>

          {/* 快捷日期预设胶囊 */}
          <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar py-0.5 select-none">
            <span className="text-[11px] font-serif text-ink-faint shrink-0 mr-0.5">快捷：</span>
            {QUICK_PRESETS.map((preset) => {
              const pDate = getOffsetDate(preset.getDays);
              const isSelected = dateInput === pDate;
              return (
                <button
                  key={preset.label}
                  type="button"
                  disabled={isGenerating}
                  onClick={() => handleQuickPreset(preset.getDays)}
                  className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-sans border transition-all active:scale-[0.96] ${
                    isSelected
                      ? 'border-accent/60 bg-accent/10 text-accent font-medium'
                      : 'border-dashed border-paper-grid text-ink-light hover:border-paper-grid hover:text-ink hover:bg-paper-grid/20'
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 结果 / 加载 / 错误区 */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
          {isGenerating ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[160px]">
              <div className="w-12 h-12 rounded-full border border-dashed border-accent/40 bg-accent/5 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-accent animate-spin" strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-serif text-accent font-medium">正在研读历法与节气...</p>
                <p className="text-[11px] font-mono text-ink-faint tabular-nums">{dateInput}</p>
              </div>
            </div>
          ) : error ? (
            <div className="p-3.5 rounded-md border border-error/20 bg-error/5 flex items-start gap-2.5">
              <AlertTriangle size={15} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-1.5 font-sans">
                <p className="text-[12px] text-error/90 leading-relaxed break-words">{error}</p>
                <button
                  type="button"
                  onClick={() => handleQuery()}
                  className="inline-flex items-center text-[11px] text-error font-medium hover:underline active:scale-[0.96] transition-transform"
                >
                  重试查询
                </button>
              </div>
            </div>
          ) : output.trim() ? (
            <div className="w-full min-w-0 font-sans text-sm leading-relaxed p-3 rounded-md bg-paper/60 border border-dashed border-paper-grid">
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
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[180px]">
              <div className="w-14 h-14 rounded-full border border-dashed border-paper-grid bg-paper-grid/20 flex items-center justify-center text-ink-faint">
                <CalendarDays size={24} strokeWidth={1.5} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-serif text-ink-light">选择日期查询节假日与农历万年历</p>
                <p className="text-xs text-ink-faint font-sans">支持查询法定节假日放假安排、生肖干支与廿四节气</p>
              </div>
              <button
                type="button"
                onClick={() => handleQuickPreset(0)}
                className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-serif text-accent border border-dashed border-accent/40 bg-accent/5 hover:bg-accent/10 active:scale-[0.96] transition-all"
              >
                <Sparkles size={13} strokeWidth={1.75} />
                查询今日万年历
              </button>
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

