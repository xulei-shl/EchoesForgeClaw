import React, { memo, useState, useCallback, useMemo, useEffect } from 'react';
import { Copy, Check } from 'lucide-react';
import { Streamdown, cjk, code } from '../../utils/markdown';
import { normalizeMarkdown } from '../../utils/normalizeMarkdown';
import { copyTextToClipboard } from '../../utils/clipboard';
import { useFeedback } from './FeedbackProvider';

/** 单例化插件配置对象：轻量极速版（仅 CJK 中文排版，< 2ms 首绘）与全量版（含 Shiki 语法高亮） */
const FAST_PLUGINS = { cjk };
const FULL_PLUGINS = { cjk, code };

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
  const { showToast } = useFeedback();

  const text = (content ?? '').trim();

  // 记忆化预处理正文，避免每次重新渲染全量正则扫码
  const normalizedText = useMemo(() => normalizeMarkdown(text), [text]);

  // 大文档优化：包含代码块或超长文本时，首帧以 FAST_PLUGINS 毫秒级极速首绘（0 卡顿），
  // 避开抽屉平移动画的 220ms 窗口，待动效停稳后静默升级为 Shiki 语法高亮
  const isLargeDoc = text.length > 2500 || text.includes('```');
  const [highlightActive, setHighlightActive] = useState(!isLargeDoc);

  useEffect(() => {
    if (!isLargeDoc) {
      setHighlightActive(true);
      return;
    }
    setHighlightActive(false);
    const timer = window.setTimeout(() => {
      setHighlightActive(true);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [text, isLargeDoc]);

  const handleCopy = useCallback(async () => {
    if (!text) return;
    try {
      await copyTextToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('复制失败，已全选正文，请按 Ctrl+C 手动复制', { type: 'error' });
    }
  }, [text, showToast]);

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
          className="absolute right-2.5 top-2.5 z-10 p-1.5 rounded-md bg-paper/95 border border-paper-grid text-ink-light hover:text-ink hover:bg-paper transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 shadow-xs flex items-center gap-1 text-[11px]"
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
        plugins={highlightActive ? FULL_PLUGINS : FAST_PLUGINS}
        isAnimating={false}
        caret="block"
        linkSafety={{ enabled: false }}
      >
        {normalizedText}
      </Streamdown>
    </div>
  );
});

MarkdownViewer.displayName = 'MarkdownViewer';
export default MarkdownViewer;
