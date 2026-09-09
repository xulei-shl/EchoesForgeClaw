import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && <label className="text-sm font-sans text-ink-light">{label}</label>}
        <input
          ref={ref}
          className={`flex h-10 w-full rounded-md border border-dashed border-paper-grid bg-transparent px-3 py-2 text-base md:text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50 transition-colors ${
            error ? 'border-error focus:border-error focus:ring-error' : ''
          } ${className}`}
          {...props}
        />
        {error && <span className="text-xs text-error font-sans">{error}</span>}
      </div>
    );
  }
);

Input.displayName = 'Input';
