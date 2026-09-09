import React, { memo, useState, useEffect, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';
import clsx from 'clsx';

export interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  className?: string;
  inputWidth?: string;
  formatDisplay?: (val: number) => string;
}

/**
 * 经典加减步进输入控件 (Stepper)
 * 采用 Matcha Latté 纸感设计：[ - ] [ 输入框 ] [ + ]
 * 支持点击步进、Shift 大步长加速、手动直接打字输入与键盘上下键微调
 */
export const NumberStepper: React.FC<NumberStepperProps> = memo(({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  unit = '',
  disabled = false,
  className,
  inputWidth = 'w-12',
  formatDisplay,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [draftText, setDraftText] = useState<string>(String(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const isEscapingRef = useRef(false);

  useEffect(() => {
    if (!isFocused) {
      setDraftText(String(value));
    }
  }, [value, isFocused]);

  const commit = (rawText: string) => {
    const cleaned = rawText.trim().replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    if (!Number.isNaN(parsed)) {
      const stepDecimals = String(step).includes('.') ? String(step).split('.')[1].length : 0;
      const rounded = stepDecimals > 0 ? Number(parsed.toFixed(stepDecimals)) : Math.round(parsed);
      const clamped = Math.max(min, Math.min(max, rounded));
      onChange(clamped);
      setDraftText(String(clamped));
    } else {
      setDraftText(String(value));
    }
  };

  const handleStep = (delta: number) => {
    if (disabled) return;
    const stepDecimals = String(step).includes('.') ? String(step).split('.')[1].length : 0;
    // 如果处于编辑聚焦态且输入了有效数字，以当前输入的数值为基准步进，否则以 value 为基准
    const activeRaw = isFocused ? draftText.trim().replace(/[^0-9.-]/g, '') : '';
    const parsedDraft = activeRaw !== '' ? parseFloat(activeRaw) : NaN;
    const baseValue = !Number.isNaN(parsedDraft) ? parsedDraft : value;
    const rawNext = baseValue + delta;
    const rounded = stepDecimals > 0 ? Number(rawNext.toFixed(stepDecimals)) : Math.round(rawNext);
    const next = Math.max(min, Math.min(max, rounded));
    onChange(next);
    setDraftText(String(next));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      commit(draftText);
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      isEscapingRef.current = true;
      setDraftText(String(value));
      inputRef.current?.blur();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.shiftKey ? step * 5 : step;
      handleStep(delta);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const delta = e.shiftKey ? step * 5 : step;
      handleStep(-delta);
    }
  };

  const canDecrease = !disabled && value > min;
  const canIncrease = !disabled && value < max;

  const displayString = formatDisplay
    ? formatDisplay(value)
    : `${value}${unit}`;

  return (
    <div
      className={clsx(
        'flex items-center h-6 px-0.5 rounded bg-paper-grid/25 border border-paper-grid/50 shrink-0 select-none transition-colors',
        isFocused && 'border-accent/70 ring-1 ring-accent/30 bg-paper/70',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        disabled={!canDecrease}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          const delta = e.shiftKey ? step * 5 : step;
          handleStep(-delta);
        }}
        title="减小 (Shift+点击快速步进)"
        className={clsx(
          'w-5 h-5 flex items-center justify-center rounded text-ink-light transition-all',
          canDecrease
            ? 'hover:text-accent hover:bg-paper active:scale-90 cursor-pointer'
            : 'opacity-30 cursor-not-allowed'
        )}
      >
        <Minus size={10} strokeWidth={2.2} />
      </button>

      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        disabled={disabled}
        value={isFocused ? draftText : displayString}
        onChange={(e) => setDraftText(e.target.value)}
        onFocus={(e) => {
          setIsFocused(true);
          setDraftText(String(value));
          e.target.select();
        }}
        onBlur={() => {
          setIsFocused(false);
          if (isEscapingRef.current) {
            isEscapingRef.current = false;
            setDraftText(String(value));
            return;
          }
          commit(draftText);
        }}
        onKeyDown={handleKeyDown}
        className={clsx(
          'h-5 text-center text-[11px] tabular-nums font-mono text-ink bg-transparent focus:outline-none transition-colors px-0.5',
          inputWidth
        )}
      />

      <button
        type="button"
        disabled={!canIncrease}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          const delta = e.shiftKey ? step * 5 : step;
          handleStep(delta);
        }}
        title="增加 (Shift+点击快速步进)"
        className={clsx(
          'w-5 h-5 flex items-center justify-center rounded text-ink-light transition-all',
          canIncrease
            ? 'hover:text-accent hover:bg-paper active:scale-90 cursor-pointer'
            : 'opacity-30 cursor-not-allowed'
        )}
      >
        <Plus size={10} strokeWidth={2.2} />
      </button>
    </div>
  );
});

NumberStepper.displayName = 'NumberStepper';

export interface NumberStepperRowProps extends NumberStepperProps {
  label: React.ReactNode;
  labelWidth?: string;
  rowClassName?: string;
}

/**
 * 行级加减步进器组件：左侧标签，右侧步进器
 */
export const NumberStepperRow: React.FC<NumberStepperRowProps> = memo(({
  label,
  labelWidth = 'w-20',
  rowClassName,
  ...stepperProps
}) => {
  return (
    <div
      className={clsx(
        'flex items-center justify-between gap-1.5 min-w-0 select-none text-[10px] sm:text-[11px]',
        stepperProps.disabled && 'opacity-60 cursor-not-allowed',
        rowClassName
      )}
    >
      <span className={clsx('text-ink-faint shrink-0 whitespace-nowrap text-left', labelWidth)}>
        {label}
      </span>
      <NumberStepper {...stepperProps} />
    </div>
  );
});

NumberStepperRow.displayName = 'NumberStepperRow';
