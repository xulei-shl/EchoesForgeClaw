import React from 'react';
import type {
  EditorialArticleData,
  LayoutProjection,
  PageRatioPreset,
  EditorialTemplate,
  EditorialTypographySettings,
} from '../types';
import { BarcodeSvg } from './widgets/BarcodeSvg';

export interface EditorialFixedLayoutLayerProps {
  article: EditorialArticleData;
  typography: EditorialTypographySettings;
  ratioPreset: PageRatioPreset;
  activeTemplate: EditorialTemplate;
  layoutProjection: LayoutProjection;
  scale: number;
}

/** 杂志固定排版模板渲染层组件 */
export const EditorialFixedLayoutLayer: React.FC<EditorialFixedLayoutLayerProps> = ({
  article,
  typography,
  ratioPreset,
  activeTemplate,
  layoutProjection,
  scale,
}) => {
  const layoutType = activeTemplate.features?.layoutType || 'newspaper';

  return (
    <>
      {/* 1. 委托独立模板渲染专属装饰层 (Strategy Pattern) */}
      {activeTemplate.renderDecorations && (
        <activeTemplate.renderDecorations
          article={article}
          typography={typography}
          ratioPreset={ratioPreset}
          layoutProjection={layoutProjection}
          scale={scale}
        />
      )}

      {/* 2. 通用刊头与分割线（当非特定模板时降级渲染） */}
      {article.masthead &&
        !activeTemplate.features.hasDatelineRule &&
        layoutType !== 'inverted' &&
        layoutType !== 'cover' && (
          <div
            className={`absolute font-bold flex ${
              layoutType === 'minimal' ? 'justify-center text-center' : 'justify-between'
            } items-center pointer-events-none`}
            style={{
              top: `${Math.round(ratioPreset.height * 0.045)}px`,
              left: `${Math.round(ratioPreset.width * 0.065)}px`,
              right: `${Math.round(ratioPreset.width * 0.065)}px`,
              fontSize: `${Math.round(ratioPreset.width * 0.013)}px`,
              color:
                layoutType === 'minimal'
                  ? typography.secondaryColor || '#9c9288'
                  : typography.accentColor || '#000000',
              fontFamily: typography.headlineFont,
              letterSpacing: layoutType === 'minimal' ? '3px' : '1px',
              borderBottom: '1px solid rgba(0,0,0,0.1)',
              paddingBottom: `${Math.round(ratioPreset.height * 0.008)}px`,
            }}
          >
            <span>{article.masthead.toUpperCase()}</span>
            {layoutType !== 'minimal' && article.issueDate && (
              <span className="opacity-60">{article.issueDate}</span>
            )}
          </div>
        )}

      {/* 3. 大标题 Headline */}
      <div
        className="absolute font-bold leading-tight pointer-events-none"
        style={{
          left: `${layoutProjection.headlineRegion.x}px`,
          top: `${layoutProjection.headlineRegion.y}px`,
          width: `${layoutProjection.headlineRegion.width}px`,
          font: layoutProjection.headlineFont,
          color: layoutType === 'inverted' ? '#ffffff' : typography.textColor,
          transform: layoutType === 'bold_poster' ? 'rotate(-4deg)' : undefined,
          transformOrigin: 'top left',
          textAlign: layoutType === 'minimal' ? 'center' : 'left',
          letterSpacing: layoutType === 'minimal' ? '0.1em' : undefined,
        }}
      >
        {layoutProjection.headlineLines.map((line, idx) => (
          <div
            key={idx}
            style={{
              lineHeight: `${layoutProjection.headlineLineHeight}px`,
            }}
          >
            {line.text}
          </div>
        ))}
      </div>

      {/* 4. 导语 Deck 与短强调线 */}
      {layoutProjection.deckLines.length > 0 && layoutProjection.deckRegion && (
        <div
          className="absolute font-medium italic opacity-85 pointer-events-none"
          style={{
            left: `${layoutProjection.deckRegion.x}px`,
            top: `${layoutProjection.deckRegion.y}px`,
            width: `${layoutProjection.deckRegion.width}px`,
            fontFamily: typography.headlineFont,
            color: layoutType === 'inverted' ? '#333333' : typography.textColor,
          }}
        >
          {layoutProjection.deckLines.map((line, idx) => (
            <div
              key={idx}
              style={{
                fontSize: `${Math.round(typography.bodyFontSize * 1.2)}px`,
                lineHeight: `${Math.round(typography.bodyFontSize * 1.55)}px`,
              }}
            >
              {line.text}
            </div>
          ))}

          {/* 导语下方 Accent Rule */}
          {activeTemplate.features.hasAccentRule && (
            <div
              className="mt-3.5"
              style={{
                width: `${Math.round(ratioPreset.width * 0.06)}px`,
                height: '3.5px',
                backgroundColor: typography.accentColor || '#b85a3a',
              }}
            />
          )}
        </div>
      )}

      {/* 5. 精彩金句卡片 (Pullquote Card) */}
      {layoutProjection.pullquote &&
        layoutProjection.pullquoteCardRect &&
        layoutType !== 'quote' && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: `${layoutProjection.pullquoteCardRect.x}px`,
              top: `${layoutProjection.pullquoteCardRect.y}px`,
              width: `${layoutProjection.pullquoteCardRect.width}px`,
              height: `${layoutProjection.pullquoteCardRect.height}px`,
              backgroundColor: 'rgba(184, 90, 58, 0.08)',
              borderLeft: `4px solid ${typography.accentColor || '#b85a3a'}`,
              padding: '16px 20px',
            }}
          >
            <div
              className="font-bold italic"
              style={{
                font: layoutProjection.pullquote.font,
                color: typography.textColor,
                lineHeight: `${layoutProjection.pullquote.lineHeight}px`,
              }}
            >
              {layoutProjection.pullquote.lines.map((l, i) => (
                <div key={i}>{l.text}</div>
              ))}
            </div>
          </div>
        )}

      {/* 6. 首字下沉 Drop Cap */}
      {layoutProjection.dropCap && (
        <div
          className="absolute font-bold leading-none pointer-events-none flex items-center justify-center"
          style={{
            left: `${layoutProjection.dropCap.x}px`,
            top: `${layoutProjection.dropCap.y}px`,
            fontSize: `${layoutProjection.dropCap.height}px`,
            color: typography.accentColor || '#000000',
            fontFamily: typography.headlineFont,
            border:
              layoutType === 'minimal' ? '1px solid rgba(139, 94, 60, 0.3)' : undefined,
            padding: layoutType === 'minimal' ? '2px 6px' : undefined,
          }}
        >
          {layoutProjection.dropCap.text}
        </div>
      )}

      {/* 7. 正文流各行 */}
      {layoutProjection.bodyLines.map((line, idx) => (
        <div
          key={idx}
          className="absolute whitespace-nowrap overflow-visible pointer-events-none"
          style={{
            left: `${line.x}px`,
            top: `${line.y}px`,
            fontSize: `${typography.bodyFontSize}px`,
            fontFamily: typography.bodyFont,
            color: typography.textColor,
            lineHeight: `${typography.bodyLineHeight}px`,
          }}
        >
          {line.text}
        </div>
      ))}

      {/* 8. 页脚版记与期号 */}
      <div
        className="absolute flex items-center justify-between font-semibold pointer-events-none opacity-60"
        style={{
          bottom: `${Math.round(ratioPreset.height * 0.028)}px`,
          left: `${Math.round(ratioPreset.width * 0.065)}px`,
          right: `${Math.round(ratioPreset.width * 0.065)}px`,
          fontSize: `${Math.round(ratioPreset.width * 0.0115)}px`,
          color: typography.secondaryColor || typography.textColor,
          fontFamily: typography.accentFont || typography.headlineFont,
        }}
      >
        <span>{article.folio || 'ECHOES FORGE EDITORIAL'}</span>
        {layoutType !== 'newspaper' && <span>{article.issueDate}</span>}
      </div>

      {/* 9. 底部条形码装饰 */}
      {activeTemplate.features.hasBarcode && (
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: `${Math.round(ratioPreset.height * 0.048)}px`,
            left: `${Math.round(ratioPreset.width * 0.065)}px`,
          }}
        >
          <BarcodeSvg
            width={Math.round(ratioPreset.width * 0.13)}
            height={Math.round(ratioPreset.height * 0.018)}
            color={typography.textColor || '#000000'}
          />
        </div>
      )}
    </>
  );
};
