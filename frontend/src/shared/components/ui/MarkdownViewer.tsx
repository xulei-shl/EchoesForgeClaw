import React, { memo, useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { Streamdown, cjk, code } from '../../utils/markdown';
import { normalizeMarkdown } from '../../utils/normalizeMarkdown';

export interface MarkdownViewerProps {
  /** Markdown 原始正文（内置 normalizeMarkdown 预处理） */
  content?: string | null;
  /** 外层容器自定义样式（如最大高度、边框等） */
  className?: string;
  /** 空内容占位提示，默认「（无内容）」 */
  emptyText?: string;
  /** 是否开启右上角一键复制按钮（默认 false） */
  copyable?: boolean;
  /** 是否允许文本选中（默认 true） */
  selectable?: boolean;
}

export const MarkdownViewer: React.FC<MarkdownViewerProps> = memo(({
  content,
  className = '',
  emptyText = '（无内容）',
  copyable = false,
  selectable = true,
}) => {
  const [copied, setCopied] = useState(false);

  const text = (content ?? '').trim();

  const handleCopy = useCallback(() => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  if (!text) {
    return (
      <div
        className={`p-4 rounded-xl border border-paper-grid bg-paper/40 text-xs text-ink-faint font-sans text-center ${className}`}
      >
        {emptyText}
      </div>
    );
  }

  return (
    <div
      className={`relative group rounded-xl border border-paper-grid bg-paper/60 p-3.5 font-sans text-xs sm:text-sm text-ink leading-relaxed overflow-y-auto custom-scrollbar ${
        selectable ? 'select-text' : ''
      } ${className}`}
    >
      {copyable && (
        <button
          type="button"
          onClick={handleCopy}
          title={copied ? '已复制' : '复制 Markdown 正文'}
          className="absolute right-2.5 top-2.5 z-10 p-1.5 rounded-md bg-paper/80 backdrop-blur-sm border border-paper-grid text-ink-light hover:text-ink hover:bg-paper transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 shadow-xs flex items-center gap-1 text-[11px]"
        >
          {copied ? (
            <>
              <Check size={12} className="text-accent" />
              <span className="text-accent font-medium">已复制</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>复制</span>
            </>
          )}
        </button>
      )}

      <Streamdown
        plugins={{ cjk, code }}
        isAnimating={false}
        caret="block"
        linkSafety={{ enabled: false }}
      >
        {normalizeMarkdown(text)}
      </Streamdown>
    </div>
  );
});

MarkdownViewer.displayName = 'MarkdownViewer';
export default MarkdownViewer;
