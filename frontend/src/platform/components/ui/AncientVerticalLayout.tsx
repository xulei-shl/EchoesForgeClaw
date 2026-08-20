import React from 'react';
import { parseJuDou, type JudouToken } from '../../utils/judou';

export interface AncientVerticalLayoutProps {
  /** 正文原始文摘文本 */
  text: string;
  /** 第一竖栏：题名大字（顶格书写，如《資治通鑑 卷第一》/《大作家写给孩子们》） */
  bookTitle?: string;
  /** 第二竖栏：作者/责任者（古籍规范低两格书写，如《[俄] 列夫·托尔斯泰 著》/《宋 司马光 撰》） */
  authorName?: string;
  /** 兼容别名：篇目大字（若未传 bookTitle 时降级读取） */
  headerTitle?: string;
  /** 尾列小字：校勘跋文/出品题跋（如《中华书局 谨印》） */
  footerNote?: string;
  /** 字体大小，默认 13px */
  fontSize?: number;
  /** 乌丝栏列宽（行高），默认 30px */
  columnWidth?: number;
  /** 字符纵向间距，默认 3.5px */
  letterSpacing?: number;
  /** 字体栈，默认汇文明朝体/宋体 */
  fontFamily?: string;
  /** 墨色，默认继承当前主题文字颜色 */
  textColor?: string;
  /** 朱批颜色，默认 #b82828 (朱砂红) */
  puncColor?: string;
  /** 是否绘制乌丝栏纵向墨线底纹，默认 true */
  showRuledLines?: boolean;
  /** 乌丝栏线条颜色 */
  ruledLineColor?: string;
  /** 是否自动将阿拉伯数字转为中文，默认 true */
  convertNumbers?: boolean;
  /** 点击整个排版区域触发 */
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  /** 第一栏题名点击回调 */
  onTitleClick?: (e: React.MouseEvent<HTMLElement>) => void;
  /** 第二栏作者点击回调 */
  onAuthorClick?: (e: React.MouseEvent<HTMLElement>) => void;
  /** 正文流点击回调 */
  onTextClick?: (e: React.MouseEvent<HTMLElement>) => void;
  /** 尾列题跋点击回调 */
  onFooterClick?: (e: React.MouseEvent<HTMLElement>) => void;
  /** 题名悬浮提示 */
  titleTooltip?: string;
  /** 作者悬浮提示 */
  authorTooltip?: string;
  /** 正文悬浮提示 */
  textTooltip?: string;
  /** 题跋悬浮提示 */
  footerTooltip?: string;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

const DEFAULT_MINCHO_FONT =
  "'Huiwen-mincho', 'Huiwen Mincho', '又又意宋', 'Shippori Mincho B1', 'Shippori Mincho', 'Songti SC', 'Noto Serif SC', 'Source Han Serif SC', serif";
const DEFAULT_KAITI_FONT =
  "'Kaiti SC', 'STKaiti', 'KaiTi', '楷体', 'LXGW WenKai', serif";

/**
 * 全平台通用古籍竖向排版组件 (Ancient Vertical Layout)
 *
 * 核心古籍排版规范：
 * 1. 第一竖栏（最右）：题名大字顶格排列；
 * 2. 第二竖栏：作者/责任者低两格排列；
 * 3. 第三竖栏及之后：正文文摘流式排布，自上而下自右向左自然折列；
 * 4. 标点符号自动转换为朱笔句读（朱圈/朱点），以角标形态附着于文字右上角；
 * 5. 纵向乌丝栏栅格与各列精准贴合。
 */
export const AncientVerticalLayout: React.FC<AncientVerticalLayoutProps> = ({
  text,
  bookTitle,
  authorName,
  headerTitle,
  footerNote,
  fontSize = 13,
  columnWidth = 30,
  letterSpacing = 3.5,
  fontFamily = DEFAULT_MINCHO_FONT,
  textColor = 'currentColor',
  puncColor = '#b82828',
  showRuledLines = true,
  ruledLineColor,
  convertNumbers = true,
  onClick,
  onTitleClick,
  onAuthorClick,
  onTextClick,
  onFooterClick,
  titleTooltip,
  authorTooltip,
  textTooltip,
  footerTooltip,
  className = '',
  style = {},
  title,
}) => {
  // 解析为古籍 Token 序列
  const tokens = React.useMemo(() => {
    return parseJuDou(text, { convertNumbers, preserveLineBreaks: true });
  }, [text, convertNumbers]);

  const defaultRuledColor = ruledLineColor || `color-mix(in srgb, ${textColor} 35%, transparent)`;
  const effectiveTitle = bookTitle || headerTitle;

  // 乌丝栏栅格背景
  const ruledBackgroundStyle: React.CSSProperties = showRuledLines
    ? {
        backgroundImage: `repeating-linear-gradient(to left, transparent, transparent ${columnWidth - 1}px, ${defaultRuledColor} ${columnWidth - 1}px, ${defaultRuledColor} ${columnWidth}px)`,
        backgroundPosition: 'right top',
      }
    : {};

  return (
    <div
      onClick={onClick}
      className={`relative w-full h-full select-text overflow-hidden ${className}`}
      title={title}
      style={{
        writingMode: 'vertical-rl',
        textOrientation: 'mixed',
        fontFamily,
        color: textColor,
        lineHeight: `${columnWidth}px`,
        fontSize: `${fontSize}px`,
        ...ruledBackgroundStyle,
        ...style,
      }}
    >
      {/* 1. 第一竖栏（最右侧）：题名 / 书名卷次大字，顶格书写 */}
      {effectiveTitle ? (
        <div
          onClick={
            onTitleClick
              ? (e) => {
                  e.stopPropagation();
                  onTitleClick(e);
                }
              : undefined
          }
          title={titleTooltip || (onTitleClick ? '点击编辑题名/书名' : undefined)}
          className={`inline-block h-full align-top font-bold select-text ${
            onTitleClick ? 'cursor-pointer hover:opacity-75 transition-opacity' : ''
          }`}
          style={{
            width: `${columnWidth}px`,
            fontSize: `${Math.round(fontSize * 1.25)}px`,
            letterSpacing: `${letterSpacing * 1.4}px`,
            lineHeight: `${columnWidth}px`,
            paddingBottom: '16px',
          }}
        >
          {effectiveTitle}
        </div>
      ) : null}

      {/* 2. 第二竖栏：作者 / 责任者，古籍规范低两格书写 */}
      {authorName ? (
        <div
          onClick={
            onAuthorClick
              ? (e) => {
                  e.stopPropagation();
                  onAuthorClick(e);
                }
              : undefined
          }
          title={authorTooltip || (onAuthorClick ? '点击编辑作者/责任者' : undefined)}
          className={`inline-block h-full align-top select-text opacity-90 ${
            onAuthorClick ? 'cursor-pointer hover:opacity-100 hover:text-amber-900 transition-all' : ''
          }`}
          style={{
            width: `${columnWidth}px`,
            fontFamily: DEFAULT_KAITI_FONT,
            fontSize: `${fontSize}px`,
            letterSpacing: `${letterSpacing}px`,
            lineHeight: `${columnWidth}px`,
            paddingTop: `${fontSize * 2.4}px`, // 低两格
            paddingBottom: '16px',
          }}
        >
          {authorName}
        </div>
      ) : null}

      {/* 3. 第三竖栏及后续：流式正文字符与朱批句读 */}
      <div
        onClick={
          onTextClick
            ? (e) => {
                e.stopPropagation();
                onTextClick(e);
              }
            : undefined
        }
        title={textTooltip || (onTextClick ? '点击编辑正文文摘（朱笔句读）' : undefined)}
        className={`inline-block h-full align-top select-text ${
          onTextClick ? 'cursor-pointer hover:opacity-85 transition-opacity' : ''
        }`}
        style={{
          lineHeight: `${columnWidth}px`,
        }}
      >
        {tokens.map((token: JudouToken, idx: number) => {
          if (token.isBreak) {
            return <br key={`br-${idx}`} className="select-none" />;
          }

          return (
            <span
              key={`char-${idx}`}
              className="inline-block relative select-text"
              style={{
                letterSpacing: `${letterSpacing}px`,
                lineHeight: '1.2',
              }}
            >
              {token.char}
              {/* 朱圈 (句号/叹号/问号) */}
              {token.judou === 'circle' && (
                <span
                  className="absolute pointer-events-none select-none"
                  style={{
                    top: '-2px',
                    right: '-5px',
                    width: '5px',
                    height: '5px',
                    borderRadius: '50%',
                    border: `1.2px solid ${puncColor}`,
                    boxSizing: 'border-box',
                  }}
                  title="朱圈"
                />
              )}
              {/* 朱点 (逗号/顿号/分号) */}
              {token.judou === 'dot' && (
                <span
                  className="absolute pointer-events-none select-none"
                  style={{
                    top: '0px',
                    right: '-4px',
                    width: '3.5px',
                    height: '3.5px',
                    borderRadius: '50%',
                    backgroundColor: puncColor,
                  }}
                  title="朱点"
                />
              )}
            </span>
          );
        })}

        {/* 尾列小字署名/校勘跋文 */}
        {footerNote ? (
          <span
            onClick={
              onFooterClick
                ? (e) => {
                    e.stopPropagation();
                    onFooterClick(e);
                  }
                : undefined
            }
            title={footerTooltip || (onFooterClick ? '点击编辑跋文印记' : undefined)}
            className={`inline-block opacity-80 select-text ${
              onFooterClick ? 'cursor-pointer hover:opacity-100 hover:underline transition-opacity' : ''
            }`}
            style={{
              fontFamily: DEFAULT_KAITI_FONT,
              fontSize: `${Math.max(10, Math.round(fontSize * 0.82))}px`,
              letterSpacing: `${letterSpacing}px`,
              marginLeft: `${columnWidth * 0.3}px`,
              marginTop: 'auto',
            }}
          >
            {footerNote}
          </span>
        ) : null}
      </div>
    </div>
  );
};
