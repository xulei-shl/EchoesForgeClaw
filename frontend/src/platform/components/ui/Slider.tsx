import React, { memo, useId } from 'react';
import clsx from 'clsx';

export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size'> {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  size?: 'sm' | 'md';
  showProgress?: boolean;
  className?: string;
}

/**
 * 基础原子滑杆组件
 * 采用 Matcha Latté 纸感设计：抹茶绿填充进度条、精细纸白圆纽扣滑块及触觉回弹动画
 */
export const Slider: React.FC<SliderProps> = memo(({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  size = 'sm',
  showProgress = true,
  className,
  style,
  ...rest
}) => {
  const safeMin = Number(min);
  const safeMax = Number(max);
  const safeVal = Number(value);
  const percent = safeMax > safeMin
    ? Math.max(0, Math.min(100, ((safeVal - safeMin) / (safeMax - safeMin)) * 100))
    : 0;

  const trackBg = showProgress
    ? `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${percent}%, var(--color-paper-grid) ${percent}%, var(--color-paper-grid) 100%)`
    : 'var(--color-paper-grid)';

  return (
    <input
      type="range"
      min={safeMin}
      max={safeMax}
      step={step}
      value={safeVal}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        background: trackBg,
        ...style,
      }}
      className={clsx(
        'retro-slider w-full appearance-none rounded-full cursor-pointer transition-[opacity,transform] outline-none',
        'focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'h-1.5' : 'h-2',
        className
      )}
      {...rest}
    />
  );
});

Slider.displayName = 'Slider';

export interface SliderRowProps extends SliderProps {
  label: React.ReactNode;
  display?: React.ReactNode;
  unit?: string;
  labelWidth?: string;
  valueWidth?: string;
  rowClassName?: string;
}

/**
 * 带标签与等宽数字展示的行级滑杆组件
 */
export const SliderRow: React.FC<SliderRowProps> = memo(({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  display,
  unit = '',
  disabled = false,
  onChange,
  labelWidth = 'w-7',
  valueWidth = 'min-w-[40px]',
  rowClassName,
  className,
  ...sliderProps
}) => {
  const id = useId();
  const displayVal = display !== undefined ? display : `${value}${unit}`;

  return (
    <label
      htmlFor={id}
      className={clsx(
        'flex items-center gap-1.5 min-w-0 select-none text-[10px] sm:text-[11px]',
        disabled && 'opacity-60 cursor-not-allowed',
        rowClassName
      )}
    >
      <span className={clsx('text-ink-faint shrink-0 whitespace-nowrap text-left', labelWidth)}>
        {label}
      </span>
      <div className="flex-1 min-w-0 flex items-center">
        <Slider
          id={id}
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={onChange}
          aria-label={typeof label === 'string' ? label : undefined}
          aria-valuetext={typeof displayVal === 'string' ? displayVal : `${value}`}
          className={className}
          {...sliderProps}
        />
      </div>
      <span
        className={clsx(
          'text-ink-light text-right whitespace-nowrap tabular-nums font-mono shrink-0 pl-0.5',
          valueWidth
        )}
      >
        {displayVal}
      </span>
    </label>
  );
});

SliderRow.displayName = 'SliderRow';

export default Slider;
