import React, { forwardRef } from 'react';
import clsx from 'clsx';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={clsx(
          "w-full rounded-md border border-dashed bg-transparent px-3 py-2.5 text-sm text-ink leading-relaxed placeholder:text-ink-faint focus:outline-none focus:ring-1 transition-colors font-sans",
          error
            ? "border-error focus:border-error focus:ring-error"
            : "border-paper-grid focus:border-accent focus:ring-accent",
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export default Textarea;
