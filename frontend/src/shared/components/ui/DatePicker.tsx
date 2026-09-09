import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Calendar as CalendarIcon, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

export interface DatePickerProps {
  /** 当前选中的日期（格式：YYYY-MM-DD） */
  value?: string;
  /** 日期变更回调 */
  onChange?: (value: string) => void;
  /** 禁用状态 */
  disabled?: boolean;
  /** 占位符提示 */
  placeholder?: string;
  /** 自定义外层样式类名 */
  className?: string;
  /** 尺寸 */
  size?: 'sm' | 'md';
}

/** 格式化日期为 YYYY-MM-DD */
function formatDate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 获取本地当天的 YYYY-MM-DD */
function getTodayString(): string {
  const now = new Date();
  return formatDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** 解析 YYYY-MM-DD 为年、月（1-12）、日 */
function parseDateString(str?: string): { year: number; month: number; day: number } | null {
  if (!str) return null;
  const parts = str.split('-').map((p) => parseInt(p, 10));
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return { year: parts[0], month: parts[1], day: parts[2] };
  }
  return null;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export const DatePicker: React.FC<DatePickerProps> = ({
  value = '',
  onChange,
  disabled = false,
  placeholder = '请选择日期',
  className,
  size = 'md',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 解析初始选中的年月日，或以今天作为导航基准
  const parsedValue = useMemo(() => parseDateString(value), [value]);
  const todayStr = useMemo(() => getTodayString(), []);

  const [viewYear, setViewYear] = useState(() => {
    if (parsedValue) return parsedValue.year;
    return new Date().getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    if (parsedValue) return parsedValue.month;
    return new Date().getMonth() + 1;
  });

  // 当外部 value 变化时，如果选择器未打开，同步视图年月
  useEffect(() => {
    if (parsedValue && !isOpen) {
      setViewYear(parsedValue.year);
      setViewMonth(parsedValue.month);
    }
  }, [parsedValue, isOpen]);

  // 点击外部关闭弹窗
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 月份导航操作
  const handlePrevMonth = () => {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handlePrevYear = () => setViewYear((y) => y - 1);
  const handleNextYear = () => setViewYear((y) => y + 1);

  // 计算当前月份日历网格（周一为第一列，共 42 格）
  const calendarCells = useMemo(() => {
    const firstDayOfMonth = new Date(viewYear, viewMonth - 1, 1);
    // getDay(): 0=周日, 1=周一, ... 6=周六
    let dayOfWeek = firstDayOfMonth.getDay();
    // 转换为周一为 0，周日为 6
    dayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    const daysInCurrentMonth = new Date(viewYear, viewMonth, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth - 1, 0).getDate();

    const cells: Array<{
      dateStr: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      isSelected: boolean;
      isToday: boolean;
    }> = [];

    // 上个月的补全日期
    for (let i = dayOfWeek - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevM = viewMonth === 1 ? 12 : viewMonth - 1;
      const prevY = viewMonth === 1 ? viewYear - 1 : viewYear;
      const str = formatDate(prevY, prevM, d);
      cells.push({
        dateStr: str,
        dayNumber: d,
        isCurrentMonth: false,
        isSelected: str === value,
        isToday: str === todayStr,
      });
    }

    // 本月日期
    for (let d = 1; d <= daysInCurrentMonth; d++) {
      const str = formatDate(viewYear, viewMonth, d);
      cells.push({
        dateStr: str,
        dayNumber: d,
        isCurrentMonth: true,
        isSelected: str === value,
        isToday: str === todayStr,
      });
    }

    // 下个月的补全日期（补齐 42 格或 35 格，保持网格整齐）
    const totalCells = cells.length > 35 ? 42 : 35;
    const remaining = totalCells - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const nextM = viewMonth === 12 ? 1 : viewMonth + 1;
      const nextY = viewMonth === 12 ? viewYear + 1 : viewYear;
      const str = formatDate(nextY, nextM, d);
      cells.push({
        dateStr: str,
        dayNumber: d,
        isCurrentMonth: false,
        isSelected: str === value,
        isToday: str === todayStr,
      });
    }

    return cells;
  }, [viewYear, viewMonth, value, todayStr]);

  const handleSelectDate = (dateStr: string) => {
    onChange?.(dateStr);
    setIsOpen(false);
  };

  const handleTodayClick = () => {
    const today = getTodayString();
    const parsed = parseDateString(today);
    if (parsed) {
      setViewYear(parsed.year);
      setViewMonth(parsed.month);
    }
    onChange?.(today);
    setIsOpen(false);
  };

  const handleClearClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange?.('');
    setIsOpen(false);
  };

  return (
    <div className={clsx('relative inline-block w-full', className)} ref={containerRef}>
      {/* 触发输入框 */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
        className={clsx(
          'flex items-center justify-between w-full cursor-pointer rounded-md border border-dashed border-paper-grid bg-transparent font-mono transition-colors select-none focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent group',
          size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-10 px-3 text-sm',
          disabled && 'opacity-50 cursor-not-allowed',
          isOpen && 'border-accent ring-1 ring-accent'
        )}
      >
        <span className={clsx('truncate', !value ? 'text-ink-faint' : 'text-ink')}>
          {value || placeholder}
        </span>
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          {value && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClearClick}
              title="清除日期"
              className="p-0.5 rounded text-ink-faint hover:text-error hover:bg-paper-grid/50 transition-colors"
            >
              <X size={13} strokeWidth={2} />
            </span>
          )}
          <CalendarIcon
            size={14}
            strokeWidth={1.75}
            className={clsx(
              'text-ink-faint transition-colors group-hover:text-ink',
              isOpen && 'text-accent'
            )}
          />
        </div>
      </div>

      {/* 下拉日历面板 */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            // 阻断指针与拖拽事件，防止 Canvas 画布拖拽误判
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="absolute top-full mt-1.5 left-0 z-50 w-[280px] rounded-lg border border-dashed border-paper-grid bg-paper p-3 shadow-lg select-none"
          >
            {/* 顶部月份与年份导航 */}
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-dashed border-paper-grid">
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={handlePrevYear}
                  title="上一年"
                  className="p-1 rounded-md text-ink-faint hover:text-ink hover:bg-paper-grid/50 active:scale-[0.96] transition"
                >
                  <ChevronsLeft size={14} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  title="上一月"
                  className="p-1 rounded-md text-ink-faint hover:text-ink hover:bg-paper-grid/50 active:scale-[0.96] transition"
                >
                  <ChevronLeft size={14} strokeWidth={2} />
                </button>
              </div>

              <div className="font-serif text-sm font-medium text-ink tracking-wide">
                {viewYear}年 {String(viewMonth).padStart(2, '0')}月
              </div>

              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={handleNextMonth}
                  title="下一月"
                  className="p-1 rounded-md text-ink-faint hover:text-ink hover:bg-paper-grid/50 active:scale-[0.96] transition"
                >
                  <ChevronRight size={14} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={handleNextYear}
                  title="下一年"
                  className="p-1 rounded-md text-ink-faint hover:text-ink hover:bg-paper-grid/50 active:scale-[0.96] transition"
                >
                  <ChevronsRight size={14} strokeWidth={2} />
                </button>
              </div>
            </div>

            {/* 星期表头 */}
            <div className="grid grid-cols-7 gap-1 text-center font-serif text-xs text-ink-faint mb-1.5">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-1">
                  {w}
                </div>
              ))}
            </div>

            {/* 日期格子网格 */}
            <div className="grid grid-cols-7 gap-1">
              {calendarCells.map((cell) => {
                return (
                  <button
                    key={cell.dateStr}
                    type="button"
                    onClick={() => handleSelectDate(cell.dateStr)}
                    className={clsx(
                      'h-7 w-full flex items-center justify-center rounded-md font-mono text-xs transition-colors active:scale-[0.96]',
                      cell.isSelected
                        ? 'bg-accent text-paper font-semibold shadow-sm'
                        : cell.isCurrentMonth
                        ? 'text-ink hover:bg-paper-grid/60'
                        : 'text-ink-faint/35 hover:bg-paper-grid/30 hover:text-ink-faint',
                      cell.isToday && !cell.isSelected && 'border border-accent/60 font-semibold text-accent'
                    )}
                  >
                    {cell.dayNumber}
                  </button>
                );
              })}
            </div>

            {/* 底部快捷操作栏 */}
            <div className="mt-2.5 pt-2 border-t border-dashed border-paper-grid flex items-center justify-between text-xs font-serif">
              <button
                type="button"
                onClick={handleTodayClick}
                className="text-accent hover:text-accent-hover font-medium active:scale-[0.96] transition"
              >
                今天
              </button>
              {value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange?.('');
                    setIsOpen(false);
                  }}
                  className="text-ink-faint hover:text-error active:scale-[0.96] transition"
                >
                  清除
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DatePicker;
