import React, { useState } from 'react';
import { Star } from 'lucide-react';

export interface RatingStarsProps {
  /** 当前星级 (0~5) */
  value?: number;
  /** 星级变化回调（如果提供则进入可交互模式，点击同星级可重置为 0） */
  onChange?: (nextRating: number) => void;
  /** 是否只读（默认 false，若无 onChange 则自动只读） */
  readonly?: boolean;
  /** 尺寸规格 */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** 是否在后方展示星级数字（如 "4.0"） */
  showNumber?: boolean;
  /** 自定义容器 className */
  className?: string;
}

const SIZE_MAP = {
  xs: { icon: 11, stroke: 1.5, gap: 'gap-0.5' },
  sm: { icon: 14, stroke: 1.5, gap: 'gap-1' },
  md: { icon: 18, stroke: 1.5, gap: 'gap-1.5' },
  lg: { icon: 22, stroke: 1.5, gap: 'gap-2' },
};

export const RatingStars: React.FC<RatingStarsProps> = ({
  value = 0,
  onChange,
  readonly = false,
  size = 'sm',
  showNumber = false,
  className = '',
}) => {
  const [hoverValue, setHoverValue] = useState<number | null>(null);

  const effectiveRating = hoverValue !== null ? hoverValue : (value || 0);
  const isInteractive = !readonly && Boolean(onChange);
  const config = SIZE_MAP[size] || SIZE_MAP.sm;

  const handleClick = (star: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isInteractive || !onChange) return;
    // 点击同星级重置为 0
    const next = value === star ? 0 : star;
    onChange(next);
  };

  return (
    <div
      className={`inline-flex items-center select-none ${config.gap} ${className}`}
      onMouseLeave={() => isInteractive && setHoverValue(null)}
      title={isInteractive ? (value > 0 ? `当前 ${value} 星（点击同星级可取消）` : '点击打标（1-5 星）') : (value > 0 ? `${value} 星` : '未打标')}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const isFilled = star <= effectiveRating;
        return (
          <button
            key={star}
            type="button"
            disabled={!isInteractive}
            onClick={(e) => handleClick(star, e)}
            onMouseEnter={() => isInteractive && setHoverValue(star)}
            className={`transition-transform focus:outline-none p-0.5 rounded ${
              isInteractive
                ? 'cursor-pointer hover:scale-110 active:scale-95 text-ink-faint hover:text-amber-400'
                : 'cursor-default'
            }`}
          >
            <Star
              size={config.icon}
              strokeWidth={config.stroke}
              className={`transition-colors duration-150 ${
                isFilled
                  ? 'text-amber-400 fill-amber-400 drop-shadow-sm'
                  : 'text-ink-faint/60 hover:text-amber-300'
              }`}
            />
          </button>
        );
      })}
      {showNumber && value > 0 && (
        <span className="text-xs font-mono font-medium text-amber-600 dark:text-amber-400 ml-1">
          {value}★
        </span>
      )}
    </div>
  );
};

export default RatingStars;
