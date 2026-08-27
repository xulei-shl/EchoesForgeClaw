import React from 'react';
import { Link } from 'react-router-dom';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick?: () => void;
    to?: string;
  };
  secondaryAction?: {
    label: string;
    onClick?: () => void;
    to?: string;
  };
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className = '',
}) => {
  const btnPrimary =
    'px-5 py-2 bg-accent text-paper text-sm font-serif rounded-md hover:bg-accent-hover ' +
    'active:scale-[0.96] transition-all duration-150 shadow-sm shadow-ink/5 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  const btnSecondary =
    'px-4 py-2 border border-dashed border-paper-grid text-ink-light hover:text-ink hover:bg-paper-grid/20 ' +
    'text-sm font-serif rounded-md active:scale-[0.96] transition-all duration-150 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  return (
    <div
      role="status"
      className={`py-16 px-4 flex flex-col items-center justify-center text-center animate-fade-in ${className}`}
    >
      {icon && (
        <div className="mb-4 flex items-center justify-center text-ink-faint/80">
          {icon}
        </div>
      )}
      <h3 className="font-serif text-lg font-bold text-ink leading-snug tracking-wide" style={{ textWrap: 'balance' }}>
        {title}
      </h3>
      {description && (
        <p className="text-sm text-ink-light font-sans mt-1.5 max-w-md leading-relaxed" style={{ textWrap: 'pretty' }}>
          {description}
        </p>
      )}

      {(action || secondaryAction) && (
        <div className="mt-6 flex items-center gap-3 flex-wrap justify-center">
          {action && (
            action.to ? (
              <Link to={action.to} className={btnPrimary}>
                {action.label}
              </Link>
            ) : (
              <button onClick={action.onClick} className={btnPrimary}>
                {action.label}
              </button>
            )
          )}

          {secondaryAction && (
            secondaryAction.to ? (
              <Link to={secondaryAction.to} className={btnSecondary}>
                {secondaryAction.label}
              </Link>
            ) : (
              <button onClick={secondaryAction.onClick} className={btnSecondary}>
                {secondaryAction.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
};

export default EmptyState;
