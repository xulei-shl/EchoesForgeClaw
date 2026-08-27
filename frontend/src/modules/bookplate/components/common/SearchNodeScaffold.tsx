import React, { memo } from 'react';
import { Link2, Search, Loader2, AlertTriangle } from 'lucide-react';
import { Streamdown, cjk, code } from '../../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../../platform/utils/normalizeMarkdown';

/** 上级连线输入高光卡片 */
export interface UpstreamLinkCardProps {
  label?: string;
  content: string;
  onTrigger: () => void;
  buttonText?: string;
  buttonIcon?: React.ReactNode;
  disabled?: boolean;
  isLoading?: boolean;
  extraControls?: React.ReactNode;
}

export const UpstreamLinkCard: React.FC<UpstreamLinkCardProps> = memo(({
  label = '上级连线传入内容',
  content,
  onTrigger,
  buttonText = '检索',
  buttonIcon = <Search size={11} strokeWidth={2} />,
  disabled = false,
  isLoading = false,
  extraControls,
}) => {
  return (
    <div className="flex items-center justify-between p-2 rounded-lg border border-accent/40 bg-accent/5 shrink-0 gap-2">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="w-6 h-6 rounded-full bg-accent/15 flex items-center justify-center shrink-0 text-accent">
          <Link2 size={12} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-serif text-accent uppercase tracking-wider">{label}</div>
          <div className="text-xs font-medium text-ink truncate font-mono" title={content}>
            {content}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {extraControls}
        <button
          type="button"
          onClick={onTrigger}
          disabled={disabled || isLoading}
          title={`以该内容${buttonText}`}
          className="flex items-center justify-center gap-1 px-2.5 h-7 rounded-md bg-accent text-paper text-xs font-sans hover:bg-accent-hover active:scale-[0.96] transition-transform duration-100 ease-out disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
        >
          {isLoading ? (
            <Loader2 size={11} className="animate-spin" strokeWidth={2} />
          ) : (
            buttonIcon
          )}
          <span>{isLoading ? '处理中' : buttonText}</span>
        </button>
      </div>
    </div>
  );
});
UpstreamLinkCard.displayName = 'UpstreamLinkCard';

/** 统一加载态骨架 */
export interface SearchNodeLoadingViewProps {
  text?: string;
  subtext?: string;
  icon?: React.ReactNode;
}

export const SearchNodeLoadingView: React.FC<SearchNodeLoadingViewProps> = memo(({
  text = '正在获取数据...',
  subtext,
  icon,
}) => {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[160px]">
      <div className="w-12 h-12 rounded-full border border-dashed border-accent/40 bg-accent/5 flex items-center justify-center">
        {icon || <Loader2 className="w-5 h-5 text-accent animate-spin" strokeWidth={1.5} />}
      </div>
      <div className="space-y-1">
        <p className="text-xs font-serif text-accent font-medium">{text}</p>
        {subtext && <p className="text-[11px] font-mono text-ink-faint">{subtext}</p>}
      </div>
    </div>
  );
});
SearchNodeLoadingView.displayName = 'SearchNodeLoadingView';

/** 统一错误提示条 */
export interface SearchNodeErrorViewProps {
  error: string;
  onRetry?: () => void;
  retryText?: string;
}

export const SearchNodeErrorView: React.FC<SearchNodeErrorViewProps> = memo(({
  error,
  onRetry,
  retryText = '重试查询',
}) => {
  return (
    <div className="p-3.5 rounded-md border border-error/20 bg-error/5 flex items-start gap-2.5">
      <AlertTriangle size={15} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1.5 font-sans">
        <p className="text-[12px] text-error/90 leading-relaxed break-words">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center text-[11px] text-error font-medium hover:underline active:scale-[0.96] transition-transform duration-100 ease-out"
          >
            {retryText}
          </button>
        )}
      </div>
    </div>
  );
});
SearchNodeErrorView.displayName = 'SearchNodeErrorView';

/** 统一空态指引 */
export interface SearchNodeEmptyViewProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  actionButton?: React.ReactNode;
}

export const SearchNodeEmptyView: React.FC<SearchNodeEmptyViewProps> = memo(({
  icon,
  title,
  description,
  actionButton,
}) => {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-center min-h-[180px]">
      <div className="w-14 h-14 rounded-full border border-dashed border-paper-grid bg-paper-grid/20 flex items-center justify-center text-ink-faint">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-serif text-ink-light" style={{ textWrap: 'balance' }}>
          {title}
        </p>
        {description && (
          <p className="text-xs text-ink-faint font-sans" style={{ textWrap: 'pretty' }}>
            {description}
          </p>
        )}
      </div>
      {actionButton}
    </div>
  );
});
SearchNodeEmptyView.displayName = 'SearchNodeEmptyView';

/** 统一 Markdown 输出呈现 */
export interface SearchNodeContentViewProps {
  content: string;
  isGenerating?: boolean;
  className?: string;
}

export const SearchNodeContentView: React.FC<SearchNodeContentViewProps> = memo(({
  content,
  isGenerating = false,
  className = '',
}) => {
  if (!content.trim()) return null;
  return (
    <div className={`w-full min-w-0 font-sans text-sm leading-relaxed p-3 rounded-md bg-paper/60 border border-dashed border-paper-grid overflow-hidden ${className}`}>
      <Streamdown
        plugins={{ cjk, code }}
        isAnimating={isGenerating}
        caret="block"
        linkSafety={{ enabled: false }}
      >
        {normalizeMarkdown(content)}
      </Streamdown>
    </div>
  );
});
SearchNodeContentView.displayName = 'SearchNodeContentView';
