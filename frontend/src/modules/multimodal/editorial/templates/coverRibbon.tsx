import type { EditorialTemplate, CanvasRenderContext, TemplateRenderProps } from '../types';

/**
 * 分割印章文本为多行，确保圆形内完美居中
 */
function parseBadgeLines(text?: string): string[] {
  if (!text || !text.trim()) return [];
  const trimmed = text.trim();
  if (trimmed.includes('·')) {
    return trimmed.split('·').map((s) => s.trim()).filter(Boolean);
  }
  if (trimmed.includes('\n')) {
    return trimmed.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  const words = trimmed.split(' ').filter(Boolean);
  if (words.length >= 3) {
    const mid = Math.ceil(words.length / 2);
    return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
  }
  return [trimmed];
}

/**
 * ⚡ 封面先锋模板 (Avant-Garde Cover)
 * 特征：贯穿纯黑 Ribbon 挂签、独立错开刊头、100% 所见即所得居中贴纸印章、底部条形码
 */
const drawCoverRibbonDecorations = (
  ctx: CanvasRenderingContext2D,
  { article, typography, W, H, accentColor, secondaryColor }: CanvasRenderContext
) => {
  // 1. 侧边黑色 Ribbon 标签
  const ribbonX = Math.round(W * 0.06);
  const ribbonW = Math.round(W * 0.075);
  const ribbonH = Math.round(H * 0.16);
  ctx.save();
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(ribbonX, 0, ribbonW, ribbonH);

  ctx.save();
  ctx.translate(ribbonX + ribbonW / 2, ribbonH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(W * 0.018)}px ${typography.headlineFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(article.issueDate ? `ISSUE ${article.issueDate}` : 'ISSUE 08', 0, 0);
  ctx.restore();
  ctx.restore();

  // 2. 刊头与日期（位于挂签右侧，形成清晰纵横秩序，杜绝重叠）
  if (article.masthead) {
    const mX = Math.round(W * 0.16);
    const topY = Math.round(H * 0.045);
    const rightMargin = Math.round(W * 0.065);

    ctx.save();
    ctx.fillStyle = accentColor || '#e53e3e';
    ctx.font = `bold ${Math.round(W * 0.0125)}px ${typography.accentFont || typography.headlineFont}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(article.masthead.toUpperCase(), mX, topY);

    if (article.issueDate) {
      ctx.textAlign = 'right';
      ctx.fillStyle = secondaryColor || '#718096';
      ctx.font = `500 ${Math.round(W * 0.011)}px ${typography.accentFont || 'monospace'}`;
      ctx.fillText(article.issueDate, W - rightMargin, topY);
    }

    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mX, topY + Math.round(H * 0.012));
    ctx.lineTo(W - rightMargin, topY + Math.round(H * 0.012));
    ctx.stroke();
    ctx.restore();
  }

  // 3. 贴纸印章 (多行折行与中心坐标计算，严格与 DOM 1:1 对齐)
  if (article.badgeText) {
    const badgeSize = Math.round(W * 0.15);
    const radius = badgeSize / 2;
    const rightMargin = Math.round(W * 0.08);
    const topMargin = Math.round(H * 0.11);

    const cx = W - rightMargin - radius;
    const cy = topMargin + radius;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((-8 * Math.PI) / 180);

    // 外圈实线圆
    ctx.strokeStyle = accentColor || '#e53e3e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    // 内圈虚线圆
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, radius - 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 内部多行文字居中排版
    const lines = parseBadgeLines(article.badgeText);
    const fontSize = Math.round(radius * 0.25);
    const lineHeight = Math.round(fontSize * 1.35);
    ctx.fillStyle = accentColor || '#e53e3e';
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const totalH = lines.length * lineHeight;
    const startY = -(totalH / 2) + lineHeight / 2;

    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i]!.toUpperCase(), 0, startY + i * lineHeight);
    }

    ctx.restore();
  }
};

const CoverRibbonDecorations = ({ article, typography, ratioPreset }: TemplateRenderProps) => {
  const badgeLines = parseBadgeLines(article.badgeText);
  const badgeSize = Math.round(ratioPreset.width * 0.15);

  return (
    <>
      {/* 1. 侧边 Ribbon 挂签 */}
      <div
        className="absolute top-0 bg-[#0a0a0a] text-white flex items-center justify-center font-bold tracking-widest pointer-events-none"
        style={{
          left: `${Math.round(ratioPreset.width * 0.06)}px`,
          width: `${Math.round(ratioPreset.width * 0.075)}px`,
          height: `${Math.round(ratioPreset.height * 0.16)}px`,
          fontSize: `${Math.round(ratioPreset.width * 0.018)}px`,
          writingMode: 'vertical-rl',
          fontFamily: typography.headlineFont,
        }}
      >
        {article.issueDate ? `ISSUE ${article.issueDate}` : 'ISSUE 08'}
      </div>

      {/* 2. 刊头与日期（位于挂签右侧，干净排布） */}
      {article.masthead && (
        <div
          className="absolute flex items-center justify-between font-bold pointer-events-none"
          style={{
            top: `${Math.round(ratioPreset.height * 0.045)}px`,
            left: `${Math.round(ratioPreset.width * 0.16)}px`,
            right: `${Math.round(ratioPreset.width * 0.065)}px`,
            fontSize: `${Math.round(ratioPreset.width * 0.0125)}px`,
            color: typography.accentColor || '#e53e3e',
            fontFamily: typography.accentFont || typography.headlineFont,
            borderBottom: '1px solid rgba(0,0,0,0.1)',
            paddingBottom: `${Math.round(ratioPreset.height * 0.008)}px`,
          }}
        >
          <span>{article.masthead.toUpperCase()}</span>
          {article.issueDate && (
            <span
              className="font-normal opacity-70"
              style={{
                fontSize: `${Math.round(ratioPreset.width * 0.011)}px`,
                color: typography.secondaryColor || '#718096',
                fontFamily: 'monospace',
              }}
            >
              {article.issueDate}
            </span>
          )}
        </div>
      )}

      {/* 3. 贴纸印章 (Sticker Stamp Badge) */}
      {badgeLines.length > 0 && (
        <div
          className="absolute flex flex-col items-center justify-center rounded-full pointer-events-none font-sans font-bold text-center select-none"
          style={{
            right: `${Math.round(ratioPreset.width * 0.08)}px`,
            top: `${Math.round(ratioPreset.height * 0.11)}px`,
            width: `${badgeSize}px`,
            height: `${badgeSize}px`,
            border: `2px solid ${typography.accentColor || '#e53e3e'}`,
            color: typography.accentColor || '#e53e3e',
            transform: 'rotate(-8deg)',
            fontSize: `${Math.round(badgeSize * 0.125)}px`,
            lineHeight: 1.35,
          }}
        >
          <div
            className="absolute rounded-full border border-dashed"
            style={{
              inset: '5px',
              borderColor: typography.accentColor || '#e53e3e',
            }}
          />
          <div className="z-10 px-1 flex flex-col items-center justify-center">
            {badgeLines.map((line, idx) => (
              <div key={idx} className="tracking-wide uppercase whitespace-nowrap">
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
};

export const coverRibbonTemplate: EditorialTemplate = {
  id: 'cover_ribbon',
  name: '封面先锋',
  englishName: 'Avant-Garde Cover',
  description: '纯黑 Ribbon 挂签、先锋超大无衬线字重大标、SPECIAL EDITION 贴纸印章、底部条形码',
  columns: 2,
  defaultRatio: '3:4',
  features: {
    layoutType: 'cover',
    hasRibbonTag: true,
    hasBarcode: true,
    hasStickerBadge: true,
    headlinePlacement: 'overlap',
    pullquotePlacement: 'none',
  },
  defaultArticle: {
    masthead: 'ECHOES FORGE CLAW · VOL. 08',
    eyebrow: 'COLLECTION · NO. 2026',
    headline: 'AVANT-GARDE',
    deck: 'AN EXPERIMENTAL PUBLICATION EXPLORING THE BOUNDARIES OF COMPUTATIONAL GRAPHIC DESIGN',
    author: 'BY ECHOES FORGE LAB',
    badgeText: 'SPECIAL EDITION · 2026',
    pullquote: '',
    body: '封面设计的先锋性在于对传统网格的解构与重组。大字重标题横跨版面，与大幅焦点影像形成剧烈的图文穿插，黑色挂签带与矢量条形码构成了强烈的工业印刷记号。信息在极简与极繁之间剧烈震荡，带来充满张力的现代冲击感。',
    folio: 'FORGE VOL. 08 · NO. 2026',
    issueDate: '01 - 09 - 2026',
  },
  defaultTypography: {
    headlineFont: 'MiSans, "Helvetica Neue", Arial, sans-serif',
    bodyFont: 'MiSans, "Helvetica Neue", sans-serif',
    textColor: '#0a0a0a',
    accentColor: '#e53e3e',
    secondaryColor: '#718096',
    bodyFontSize: 20,
    bodyLineHeight: 32,
    dropCap: true,
    dropCapLines: 3,
    colGap: 40,
  },
  defaultBackground: {
    type: 'color',
    color: '#fcfcfc',
  },
  renderDecorations: CoverRibbonDecorations,
  drawDecorations: drawCoverRibbonDecorations,
};
