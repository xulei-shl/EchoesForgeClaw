import React from 'react';
import type { ReactNode } from 'react';

/** 页面标题 + 副标题 + 右侧操作区 */
export const PageHeader: React.FC<{
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}> = ({ title, subtitle, actions }) => (
  <div className="flex items-start justify-between gap-4 mb-6">
    <div>
      <h2 className="font-serif text-xl font-semibold text-ink">{title}</h2>
      {subtitle && <p className="text-sm text-ink-light font-sans mt-1">{subtitle}</p>}
    </div>
    {actions && <div className="shrink-0">{actions}</div>}
  </div>
);

export const FieldLabel: React.FC<{ children: ReactNode; required?: boolean }> = ({
  children,
  required,
}) => (
  <label className="text-sm font-sans text-ink-light">
    {children}
    {required && <span className="text-error ml-0.5">*</span>}
  </label>
);
