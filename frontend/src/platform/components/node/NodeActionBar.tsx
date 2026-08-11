import React from 'react';
import { Tooltip } from '../ui/Tooltip';
import { Play, RefreshCw, Pencil, Check, X, Download, Eraser, Settings2 } from 'lucide-react';

export const ACTION_BTN_CLASS =
  'flex items-center justify-center w-7 h-7 rounded-full ' +
  'text-ink-light hover:text-ink hover:bg-paper-grid/40 ' +
  'active:scale-[0.97] transition ' +
  'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-ink-light disabled:hover:bg-transparent ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

export interface NodeActionBarProps {
  children: React.ReactNode;
  className?: string;
}

export interface BaseButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tooltip: string;
  icon: React.ReactNode;
  hasDownstream?: boolean;
  downstreamTooltip?: string;
  error?: boolean;
}

const BaseButton = React.forwardRef<HTMLButtonElement, BaseButtonProps>(
  (
    { tooltip, icon, hasDownstream, downstreamTooltip, error, className = '', disabled, ...props },
    ref
  ) => {
    const finalTooltip = (hasDownstream && downstreamTooltip) ? downstreamTooltip : tooltip;
    const finalDisabled = disabled || hasDownstream;
    let combinedClass = `${ACTION_BTN_CLASS} ${className}`;
    
    if (error) {
      combinedClass += ' text-error hover:text-error hover:bg-error/10';
    }

    return (
      <Tooltip content={finalTooltip}>
        <button
          ref={ref}
          disabled={finalDisabled}
          className={combinedClass}
          {...props}
        >
          {icon}
        </button>
      </Tooltip>
    );
  }
);
BaseButton.displayName = 'BaseButton';

export const NodeActionBar = ({ children, className = '' }: NodeActionBarProps) => {
  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      {children}
    </div>
  );
};

// Preset Buttons
NodeActionBar.Run = (props: Omit<BaseButtonProps, 'icon' | 'tooltip' | 'downstreamTooltip'> & { hasDownstream?: boolean }) => (
  <BaseButton
    icon={<Play size={16} strokeWidth={1.5} />}
    tooltip="运行"
    downstreamTooltip="有下级节点，不可运行"
    {...props}
  />
);

NodeActionBar.Retry = (props: Omit<BaseButtonProps, 'icon' | 'tooltip' | 'downstreamTooltip'> & { hasDownstream?: boolean, error?: boolean, tooltip?: string, downstreamTooltip?: string, icon?: React.ReactNode }) => (
  <BaseButton
    icon={props.icon || <RefreshCw size={16} strokeWidth={1.5} />}
    tooltip={props.tooltip || (props.error ? '重试' : '重新生成')}
    downstreamTooltip={props.downstreamTooltip || "有下级节点，不可重新生成"}
    {...props}
  />
);

NodeActionBar.Edit = (props: Omit<BaseButtonProps, 'icon' | 'tooltip' | 'downstreamTooltip'> & { hasDownstream?: boolean }) => (
  <BaseButton
    icon={<Pencil size={16} strokeWidth={1.5} />}
    tooltip="编辑"
    downstreamTooltip="有下级节点，不可编辑"
    {...props}
  />
);

NodeActionBar.Save = (props: Omit<BaseButtonProps, 'icon' | 'tooltip' | 'downstreamTooltip'>) => (
  <BaseButton
    icon={<Check size={16} strokeWidth={1.5} />}
    tooltip="保存 (Ctrl+Enter)"
    {...props}
  />
);

NodeActionBar.Cancel = (props: Omit<BaseButtonProps, 'icon' | 'tooltip' | 'downstreamTooltip'>) => (
  <BaseButton
    icon={<X size={16} strokeWidth={1.5} />}
    tooltip="取消 (Esc)"
    {...props}
  />
);

NodeActionBar.Download = (props: Omit<BaseButtonProps, 'icon' | 'tooltip' | 'downstreamTooltip'> & { tooltip?: string }) => (
  <BaseButton
    icon={<Download size={16} strokeWidth={1.5} />}
    tooltip={props.tooltip || "导出"}
    {...props}
  />
);

NodeActionBar.Eraser = (props: Omit<BaseButtonProps, 'icon' | 'tooltip' | 'downstreamTooltip'> & { hasDownstream?: boolean }) => (
  <BaseButton
    icon={<Eraser size={16} strokeWidth={1.5} />}
    tooltip="清空"
    downstreamTooltip="有下级节点，不可清空"
    {...props}
  />
);

NodeActionBar.SettingsTrigger = React.forwardRef<HTMLButtonElement, Omit<BaseButtonProps, 'icon' | 'tooltip' | 'downstreamTooltip'> & { hasDownstream?: boolean, active?: boolean, tooltip?: string }>(
  ({ active, className = '', tooltip, ...props }, ref) => (
    <BaseButton
      ref={ref}
      icon={<Settings2 size={16} strokeWidth={1.5} />}
      tooltip={tooltip || "设置"}
      className={active ? `opacity-60 ${className}` : className}
      {...props}
    />
  )
);
NodeActionBar.SettingsTrigger.displayName = 'SettingsTrigger';

// Generic Custom Button
NodeActionBar.Custom = (props: BaseButtonProps) => <BaseButton {...props} />;
NodeActionBar.Button = BaseButton;
