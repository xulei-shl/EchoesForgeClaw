import React from 'react';
import clsx from 'clsx';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, disabled, label, className }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={clsx(
      "relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-full border transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 disabled:cursor-not-allowed",
      checked ? "bg-accent border-accent" : "bg-node-bg border-paper-grid",
      className
    )}
    title={label}
  >
    <span
      className={clsx(
        "inline-block h-4 w-4 transform rounded-full bg-paper border border-paper-grid shadow-sm transition-transform",
        checked ? "translate-x-5" : "translate-x-0.5"
      )}
    />
  </button>
);

export default Toggle;
