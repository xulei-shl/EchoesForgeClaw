import React from 'react';
import clsx from 'clsx';

export type BadgeVariant = 'default' | 'success' | 'error' | 'warning' | 'info';

export interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  showDot?: boolean;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'default',
  children,
  showDot = false,
  className,
}) => {
  const variants: Record<BadgeVariant, string> = {
    default: 'text-ink-faint border-paper-grid bg-paper-grid/20',
    success: 'text-success border-success/50 bg-success/5',
    error: 'text-error border-error/50 bg-error/5',
    warning: 'text-amber-600 border-amber-600/50 bg-amber-600/5',
    info: 'text-blue-500 border-blue-500/50 bg-blue-500/5',
  };

  const dotColors: Record<BadgeVariant, string> = {
    default: 'bg-ink-faint',
    success: 'bg-success',
    error: 'bg-error',
    warning: 'bg-amber-600',
    info: 'bg-blue-500',
  };

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-xs font-sans border border-dashed",
        variants[variant],
        className
      )}
    >
      {showDot && (
        <span className={clsx("h-1.5 w-1.5 rounded-full", dotColors[variant])} />
      )}
      {children}
    </span>
  );
};

export default Badge;
