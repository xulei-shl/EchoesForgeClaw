import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip } from '../ui/Tooltip';
import { useFeedback } from '../ui/FeedbackProvider';
import { Play, RefreshCw, Pencil, Check, X, Download, Eraser, Settings2, Copy, RotateCcw } from 'lucide-react';

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

NodeActionBar.Eraser = (props: Omit<BaseButtonProps, 'icon' | 'tooltip' | 'downstreamTooltip'> & { hasDownstream?: boolean; tooltip?: string; downstreamTooltip?: string }) => (
  <BaseButton
    icon={<Eraser size={16} strokeWidth={1.5} />}
    tooltip={props.tooltip || "清空"}
    downstreamTooltip={props.downstreamTooltip || "有下级节点，不可清空"}
    {...props}
  />
);

NodeActionBar.Reset = (props: Omit<BaseButtonProps, 'icon' | 'tooltip' | 'downstreamTooltip'> & { hasDownstream?: boolean; tooltip?: string; downstreamTooltip?: string }) => (
  <BaseButton
    icon={<RotateCcw size={16} strokeWidth={1.5} />}
    tooltip={props.tooltip || "重置为默认"}
    downstreamTooltip={props.downstreamTooltip || "有下级节点，不可重置"}
    {...props}
  />
);

NodeActionBar.SettingsTrigger = React.forwardRef<HTMLButtonElement, Omit<BaseButtonProps, 'icon' | 'tooltip' | 'downstreamTooltip'> & { hasDownstream?: boolean, active?: boolean, tooltip?: string, downstreamTooltip?: string }>(
  ({ active, className = '', tooltip, downstreamTooltip, ...props }, ref) => (
    <BaseButton
      ref={ref}
      icon={<Settings2 size={16} strokeWidth={1.5} />}
      tooltip={tooltip || "设置"}
      downstreamTooltip={downstreamTooltip || "有下级节点，不可修改设置"}
      className={active ? `opacity-60 ${className}` : className}
      {...props}
    />
  )
);
NodeActionBar.SettingsTrigger.displayName = 'SettingsTrigger';

export interface CopyButtonProps extends Omit<BaseButtonProps, 'icon' | 'tooltip'> {
  /** 需要复制的文本内容（与 onCopy 二选一，优先调用 onCopy） */
  text?: string;
  /** 自定义复制回调函数（如需特殊格式化或异步获取） */
  onCopy?: () => Promise<void> | void;
  /** 默认悬浮提示文案，缺省「复制」 */
  tooltip?: string;
  /** 复制成功后的提示文案，缺省「已复制」 */
  copiedTooltip?: string;
  /** 复制成功后弹出的 Toast 消息，缺省「已复制到剪贴板」，设为 null/空字符串 则不弹 */
  toastMessage?: string | null;
}

NodeActionBar.Copy = ({
  text,
  onCopy,
  tooltip = '复制',
  copiedTooltip = '已复制',
  toastMessage = '已复制到剪贴板',
  onClick,
  ...props
}: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);
  const { showToast } = useFeedback();

  const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    if (onCopy) {
      try {
        await onCopy();
        setCopied(true);
        if (toastMessage) showToast(toastMessage, { type: 'success' });
        setTimeout(() => setCopied(false), 2000);
      } catch {
        showToast('复制失败，请重试', { type: 'error' });
      }
      return;
    }

    if (text) {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (toastMessage) showToast(toastMessage, { type: 'success' });
        setTimeout(() => setCopied(false), 2000);
      } catch {
        showToast('复制失败，请重试', { type: 'error' });
      }
    }
  };

  return (
    <BaseButton
      icon={
        <AnimatePresence mode="wait" initial={false}>
          {copied ? (
            <motion.span
              key="check"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="inline-flex"
            >
              <Check size={16} strokeWidth={2} className="text-accent" />
            </motion.span>
          ) : (
            <motion.span
              key="copy"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="inline-flex"
            >
              <Copy size={16} strokeWidth={1.5} />
            </motion.span>
          )}
        </AnimatePresence>
      }
      tooltip={copied ? copiedTooltip : tooltip}
      onClick={handleCopy}
      {...props}
    />
  );
};

// Generic Custom Button
NodeActionBar.Custom = (props: BaseButtonProps) => <BaseButton {...props} />;
NodeActionBar.Button = BaseButton;
