import type { EditorialTemplate, CanvasRenderContext } from '../types';

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
 * 特征：贯穿纯黑 Ribbon 挂签（+90° 顺时针自上而下顺读）、独立刊头右移规线、100% 所见即所得居中贴纸印章、底部条形码
 */
const drawCoverRibbonDecorations = (
  ctx: CanvasRenderingContext2D,
  { article, typography, W, H, accentColor, secondaryColor }: CanvasRenderContext
) => {
  const ribbonX = Math.round(W * 0.055);
  const ribbonW = Math.round(W * 0.065);
  const ribbonH = Math.round(H * 0.17);
  const ribbonText = article.issueDate ? `ISSUE · ${article.issueDate}` : 'ISSUE · VOL 08';
  const ribbonFontSize = Math.round(W * 0.0115);

  // 1. 绘制左上角纯黑 Ribbon 挂签
  ctx.save();
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(ribbonX, 0, ribbonW, ribbonH);

  // 顺时针旋转 90°（与 DOM transform: rotate(90deg) 100% 对齐，自上向下顺读）
  ctx.save();
  ctx.translate(ribbonX + ribbonW / 2, ribbonH / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${ribbonFontSize}px ${typography.accentFont || 'monospace'}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ribbonText.toUpperCase(), 0, 0);
  ctx.restore();
  ctx.restore();

  // 2. 刊头与日期（位于挂签右侧，形成清晰纵横秩序，彻底杜绝重叠）
  const mastheadX = ribbonX + ribbonW + Math.round(W * 0.035);
  const mastheadY = Math.round(H * 0.042);
  const rightMargin = Math.round(W * 0.065);

  if (article.masthead) {
    ctx.save();
    ctx.fillStyle = accentColor || '#e53e3e';
    ctx.font = `bold ${Math.round(W * 0.012)}px ${typography.accentFont || typography.headlineFont}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(article.masthead.toUpperCase(), mastheadX, mastheadY);

    if (article.issueDate) {
      ctx.textAlign = 'right';
      ctx.fillStyle = secondaryColor || '#718096';
      ctx.font = `500 ${Math.round(W * 0.0105)}px ${typography.accentFont || 'monospace'}`;
      ctx.fillText(article.issueDate, W - rightMargin, mastheadY);
    }

    const lineY = mastheadY + Math.round(W * 0.012) + Math.round(H * 0.01);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mastheadX, lineY);
    ctx.lineTo(W - rightMargin, lineY);
    ctx.stroke();
    ctx.restore();
  }

  // 3. 贴纸印章 (多行折行与中心坐标计算，严格与 DOM 1:1 对齐)
  if (article.badgeText) {
    const badgeSize = Math.round(W * 0.14);
    const radius = badgeSize / 2;
    const badgeRightMargin = Math.round(W * 0.075);
    const badgeTopMargin = Math.round(H * 0.10);

    const cx = W - badgeRightMargin - radius;
    const cy = badgeTopMargin + radius;

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
    const lineHeight = fontSize + 4;
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
  renderDecorations: ({ article, typography, ratioPreset }) => {
    const W = ratioPreset.width;
    const H = ratioPreset.height;
    const ribbonX = Math.round(W * 0.055);
    const ribbonW = Math.round(W * 0.065);
    const ribbonH = Math.round(H * 0.17);
    const ribbonText = article.issueDate ? `ISSUE · ${article.issueDate}` : 'ISSUE · VOL 08';
    const ribbonFontSize = Math.round(W * 0.0115);

    const mastheadX = ribbonX + ribbonW + Math.round(W * 0.035);
    const mastheadY = Math.round(H * 0.042);
    const rightMargin = Math.round(W * 0.065);

    const badgeLines = parseBadgeLines(article.badgeText);
    const badgeSize = Math.round(W * 0.14);
    const radius = badgeSize / 2;
    const badgeRightMargin = Math.round(W * 0.075);
    const badgeTopMargin = Math.round(H * 0.10);
    const badgeCx = W - badgeRightMargin - radius;
    const badgeCy = badgeTopMargin + radius;

    return (
      <>
        {/* 1. 侧边纯黑 Ribbon 挂签 */}
        <div
          className="absolute top-0 bg-[#0a0a0a] text-white flex items-center justify-center pointer-events-none overflow-hidden"
          style={{
            left: `${ribbonX}px`,
            width: `${ribbonW}px`,
            height: `${ribbonH}px`,
          }}
        >
          <div
            className="font-bold tracking-wider uppercase whitespace-nowrap select-none"
            style={{
              transform: 'rotate(90deg)',
              transformOrigin: 'center center',
              fontSize: `${ribbonFontSize}px`,
              fontFamily: typography.accentFont || 'monospace',
              color: '#ffffff',
            }}
          >
            {ribbonText}
          </div>
        </div>

        {/* 2. 刊头与日期（位于挂签右侧，干净排布） */}
        {article.masthead && (
          <div
            className="absolute flex items-center justify-between font-bold pointer-events-none"
            style={{
              top: `${mastheadY}px`,
              left: `${mastheadX}px`,
              right: `${rightMargin}px`,
              fontSize: `${Math.round(W * 0.012)}px`,
              color: typography.accentColor || '#e53e3e',
              fontFamily: typography.accentFont || typography.headlineFont,
              borderBottom: '1px solid rgba(0, 0, 0, 0.12)',
              paddingBottom: `${Math.round(H * 0.008)}px`,
            }}
          >
            <span>{article.masthead.toUpperCase()}</span>
            {article.issueDate && (
              <span
                className="font-normal opacity-70"
                style={{
                  fontSize: `${Math.round(W * 0.0105)}px`,
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
              left: `${badgeCx - radius}px`,
              top: `${badgeCy - radius}px`,
              width: `${badgeSize}px`,
              height: `${badgeSize}px`,
              border: `2px solid ${typography.accentColor || '#e53e3e'}`,
              color: typography.accentColor || '#e53e3e',
              transform: 'rotate(-8deg)',
              transformOrigin: 'center center',
            }}
          >
            <div
              className="absolute rounded-full border border-dashed pointer-events-none"
              style={{
                inset: '6px',
                borderColor: typography.accentColor || '#e53e3e',
                borderWidth: '1.2px',
              }}
            />
            <div
              className="z-10 px-2 flex flex-col items-center justify-center leading-tight"
              style={{
                fontSize: `${Math.round(radius * 0.25)}px`,
                gap: '2px',
              }}
            >
              {badgeLines.map((line, idx) => (
                <div key={idx} className="tracking-wider uppercase whitespace-nowrap font-bold">
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    );
  },
  drawDecorations: drawCoverRibbonDecorations,
};
