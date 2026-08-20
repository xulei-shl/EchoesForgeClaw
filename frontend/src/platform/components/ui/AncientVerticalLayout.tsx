import React from 'react';
import { parseJuDou, type JudouToken } from '../../utils/judou';

export interface AncientVerticalLayoutProps {
  /** 正文原始文本 */
  text: string;
  /** 篇目大字（首列大字卷号/标题，可选） */
  headerTitle?: string;
  /** 尾列小字（校勘/出品署名，可选） */
  footerNote?: string;
  /** 字体大小，默认 14px */
  fontSize?: number;
  /** 乌丝栏列宽（行高），默认 30px */
  columnWidth?: number;
  /** 字符纵向间距，默认 4px */
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
  /** 点击编辑触发 */
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
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
 * 特性：
 * 1. 原生 CSS `writing-mode: vertical-rl` 流式排版，文字自上而下、写满自右向左自然折列；
 * 2. 标点符号自动转化为古籍朱笔句读（朱圈/朱点），以角标形态精准附着在字右上角；
 * 3. 纵向乌丝栏栅格底纹与文字流精准贴合；
 * 4. 支持篇目大字、尾列校勘小字，适用于古籍书签、藏书票、文摘卡等全平台节点。
 */
export const AncientVerticalLayout: React.FC<AncientVerticalLayoutProps> = ({
  text,
  headerTitle,
  footerNote,
  fontSize = 14,
  columnWidth = 30,
  letterSpacing = 4,
  fontFamily = DEFAULT_MINCHO_FONT,
  textColor = 'currentColor',
  puncColor = '#b82828',
  showRuledLines = true,
  ruledLineColor,
  convertNumbers = true,
  onClick,
  className = '',
  style = {},
  title,
}) => {
  // 解析为古籍 Token 序列
  const tokens = React.useMemo(() => {
    return parseJuDou(text, { convertNumbers, preserveLineBreaks: true });
  }, [text, convertNumbers]);

  const defaultRuledColor = ruledLineColor || `color-mix(in srgb, ${textColor} 35%, transparent)`;

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
      {/* 1. 首列篇目大字（自右向左流的首部） */}
      {headerTitle ? (
        <span
          className="inline-block font-bold text-center select-text"
          style={{
            fontSize: `${Math.round(fontSize * 1.25)}px`,
            letterSpacing: `${letterSpacing * 1.5}px`,
            marginRight: '2px',
            marginLeft: `${columnWidth * 0.15}px`,
            marginBottom: '16px',
          }}
        >
          {headerTitle}
        </span>
      ) : null}

      {/* 2. 流式正文字符与朱批句读 */}
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

      {/* 3. 尾列小字署名/校勘跋文 */}
      {footerNote ? (
        <span
          className="inline-block opacity-80 select-text"
          style={{
            fontFamily: DEFAULT_KAITI_FONT,
            fontSize: `${Math.max(10, Math.round(fontSize * 0.82))}px`,
            letterSpacing: `${letterSpacing}px`,
            marginRight: `${columnWidth * 0.2}px`,
            marginTop: 'auto',
          }}
        >
          {footerNote}
        </span>
      ) : null}
    </div>
  );
};
