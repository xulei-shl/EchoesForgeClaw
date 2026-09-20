import React, { memo, useEffect, useMemo, useState } from 'react';
import { Streamdown, cjk, code } from '../../utils/markdown';
import { normalizeMarkdown } from '../../utils/normalizeMarkdown';

/**
 * Markdown 正文统一渲染（无卡片外壳，仅正文）：
 * - 收口各处重复的 Streamdown 调用（插件配置 / 流式光标 / linkSafety / normalizeMarkdown）
 * - 单例化插件对象，避免每次渲染新建配置导致 Streamdown 重新注册插件
 * - 流式 / 大文档渐进高亮：正文含代码块或超长时首帧用轻量插件毫秒级首绘，静默 240ms 后再升级
 *   Shiki 语法高亮；流式输出期间内容持续变化会不断重置计时器，即整段流式期间保持极速渲染。
 */
const FAST_PLUGINS = { cjk };
const FULL_PLUGINS = { cjk, code };

// 超过该长度视为大文档，首次渲染不启用 Shiki 语法高亮
const LARGE_DOC_CHARS = 2500;

export interface MarkdownContentProps {
  /** Markdown 正文（内置 normalizeMarkdown 预处理；空白内容不渲染） */
  content?: string | null;
  /** 流式生成中：显示流式光标 */
  isAnimating?: boolean;
  /**
   * 外层容器类名（调用方的字号 / 字体 / 卡片边框差异在此声明）。
   * 为空时不额外包裹 div，直接由调用方的容器承载（保持与旧实现一致的 DOM 层级，
   * 避免打断 index.css 里 `[data-streamdown="heading-*"]:first-child` 这类依赖直接父级的排版规则）
   */
  className?: string;
}

export const MarkdownContent: React.FC<MarkdownContentProps> = memo(
  ({ content, isAnimating = false, className = '' }) => {
    const text = (content ?? '').trim();
    const normalizedText = useMemo(() => normalizeMarkdown(text), [text]);

    const isLargeDoc = text.length > LARGE_DOC_CHARS || text.includes('```');
    const [highlightActive, setHighlightActive] = useState(!isLargeDoc);

    useEffect(() => {
      if (!isLargeDoc) {
        setHighlightActive(true);
        return;
      }
      setHighlightActive(false);
      const timer = window.setTimeout(() => setHighlightActive(true), 240);
      return () => window.clearTimeout(timer);
    }, [text, isLargeDoc]);

    if (!text) return null;

    const stream = (
      <Streamdown
        plugins={highlightActive ? FULL_PLUGINS : FAST_PLUGINS}
        isAnimating={isAnimating}
        caret="block"
        linkSafety={{ enabled: false }}
      >
        {normalizedText}
      </Streamdown>
    );

    return className ? <div className={className}>{stream}</div> : stream;
  }
);

MarkdownContent.displayName = 'MarkdownContent';
export default MarkdownContent;
