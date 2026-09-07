import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip } from '../ui/Tooltip';
import { useFeedback } from '../ui/FeedbackProvider';
import { Play, RefreshCw, Pencil, Check, X, Download, Eraser, Settings2, Copy, RotateCcw, ExternalLink, PanelRight, Loader2 } from 'lucide-react';

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
  error?: boolean;
}

const BaseButton = React.forwardRef<HTMLButtonElement, BaseButtonProps>(
  (
    { tooltip, icon, error, className = '', disabled, ...props },
    ref
  ) => {
    let combinedClass = `${ACTION_BTN_CLASS} ${className}`;

    if (error) {
      combinedClass += ' text-error hover:text-error hover:bg-error/10';
    }

    return (
      <Tooltip content={tooltip}>
        <button
          ref={ref}
          disabled={disabled}
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
NodeActionBar.Run = ({ tooltip, ...props }: Omit<BaseButtonProps, 'icon' | 'tooltip'> & { tooltip?: string }) => (
  <BaseButton
    icon={<Play size={16} strokeWidth={1.5} />}
    tooltip={tooltip || '运行'}
    {...props}
  />
);

NodeActionBar.Retry = (props: Omit<BaseButtonProps, 'icon' | 'tooltip'> & { error?: boolean, tooltip?: string, icon?: React.ReactNode }) => (
  <BaseButton
    icon={props.icon || <RefreshCw size={16} strokeWidth={1.5} />}
    tooltip={props.tooltip || (props.error ? '重试' : '重新生成')}
    {...props}
  />
);

NodeActionBar.Edit = (props: Omit<BaseButtonProps, 'icon' | 'tooltip'>) => (
  <BaseButton
    icon={<Pencil size={16} strokeWidth={1.5} />}
    tooltip="编辑"
    {...props}
  />
);

NodeActionBar.Save = (props: Omit<BaseButtonProps, 'icon' | 'tooltip'>) => (
  <BaseButton
    icon={<Check size={16} strokeWidth={1.5} />}
    tooltip="保存 (Ctrl+Enter)"
    {...props}
  />
);

NodeActionBar.Cancel = (props: Omit<BaseButtonProps, 'icon' | 'tooltip'>) => (
  <BaseButton
    icon={<X size={16} strokeWidth={1.5} />}
    tooltip="取消 (Esc)"
    {...props}
  />
);

NodeActionBar.Download = (props: Omit<BaseButtonProps, 'icon' | 'tooltip'> & { tooltip?: string }) => (
  <BaseButton
    icon={<Download size={16} strokeWidth={1.5} />}
    tooltip={props.tooltip || "导出"}
    {...props}
  />
);

NodeActionBar.Eraser = (props: Omit<BaseButtonProps, 'icon' | 'tooltip'> & { tooltip?: string }) => (
  <BaseButton
    icon={<Eraser size={16} strokeWidth={1.5} />}
    tooltip={props.tooltip || "清空"}
    {...props}
  />
);

NodeActionBar.Reset = (props: Omit<BaseButtonProps, 'icon' | 'tooltip'> & { tooltip?: string }) => (
  <BaseButton
    icon={<RotateCcw size={16} strokeWidth={1.5} />}
    tooltip={props.tooltip || "重置为默认"}
    {...props}
  />
);

NodeActionBar.SidePanel = ({
  open,
  loading,
  tooltip,
  className = '',
  ...props
}: Omit<BaseButtonProps, 'icon' | 'tooltip'> & {
  open?: boolean;
  loading?: boolean;
  tooltip?: string;
}) => (
  <BaseButton
    icon={
      loading ? (
        <Loader2 size={16} strokeWidth={1.5} className="animate-spin text-accent" />
      ) : (
        <PanelRight size={16} strokeWidth={1.5} />
      )
    }
    tooltip={tooltip || (open ? '收起侧边面板 (Esc)' : '侧边面板（产物 / 文件 / 历史）')}
    className={`${open ? 'text-accent bg-accent/10 hover:bg-accent/15' : ''} ${className}`}
    {...props}
  />
);

NodeActionBar.SettingsTrigger = React.forwardRef<HTMLButtonElement, Omit<BaseButtonProps, 'icon' | 'tooltip'> & { active?: boolean, tooltip?: string }>(
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

/** 复制文本到剪贴板，优先 Clipboard API，非安全上下文等场景降级为 execCommand */
export const copyTextToClipboard = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 忽略后尝试降级方案
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    if (!document.execCommand('copy')) {
      throw new Error('execCommand copy failed');
    }
  } finally {
    document.body.removeChild(textarea);
  }
};

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
        await copyTextToClipboard(text);
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

export interface ExternalLinkButtonProps extends Omit<BaseButtonProps, 'icon' | 'tooltip'> {
  /** 跳转的目标 URL */
  href?: string;
  /** 悬浮提示文案，缺省「打开链接」 */
  tooltip?: string;
  /** 链接打开方式，缺省「_blank」 */
  target?: string;
}

NodeActionBar.ExternalLink = ({
  href,
  tooltip = '打开链接',
  target = '_blank',
  onClick,
  ...props
}: ExternalLinkButtonProps) => {
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    if (href) {
      window.open(href, target, 'noopener,noreferrer');
    }
  };

  return (
    <BaseButton
      icon={<ExternalLink size={16} strokeWidth={1.5} />}
      tooltip={tooltip}
      onClick={handleClick}
      {...props}
    />
  );
};

// Generic Custom Button
NodeActionBar.Custom = (props: BaseButtonProps) => <BaseButton {...props} />;
NodeActionBar.Button = BaseButton;
