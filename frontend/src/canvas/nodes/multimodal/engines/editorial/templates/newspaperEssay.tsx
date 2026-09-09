import type { EditorialTemplate, CanvasRenderContext } from '../types';

/**
 * 📰 报刊社论模板 (Newspaper Manifesto)
 * 特征：双轨刊头 Dateline 规线、打字机 mono 眉标、超大古典衬线标题、金句色块与 PRO TIP 编者卡片
 */
const drawNewspaperDecorations = (
  ctx: CanvasRenderingContext2D,
  { article, typography, W, H, textColor, secondaryColor, accentColor, layoutProjection }: CanvasRenderContext
) => {
  // 双轨 Dateline 规线
  const topY = Math.round(H * 0.045);
  const mX = Math.round(W * 0.065);
  ctx.save();
  ctx.fillStyle = secondaryColor;
  ctx.font = `500 ${Math.round(W * 0.0125)}px ${typography.accentFont || 'monospace'}`;
  ctx.textBaseline = 'middle';
  ctx.fillText((article.masthead || '01 · ECHOES ESSAY').toUpperCase(), mX, topY);

  if (article.issueDate) {
    ctx.textAlign = 'right';
    ctx.fillText(article.issueDate.toUpperCase(), W - mX, topY);
  }

  // 细分割线
  ctx.strokeStyle = textColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(mX, topY + Math.round(H * 0.012));
  ctx.lineTo(W - mX, topY + Math.round(H * 0.012));
  ctx.stroke();

  // 眉标 (Eyebrow)
  if (article.eyebrow) {
    ctx.textAlign = 'left';
    ctx.fillStyle = accentColor;
    ctx.font = `bold ${Math.round(W * 0.011)}px ${typography.accentFont || 'monospace'}`;
    ctx.fillText(article.eyebrow, mX, topY + Math.round(H * 0.035));
  }
  ctx.restore();

  // Pro Tip 编者卡片
  if (layoutProjection.proTipRect && layoutProjection.proTipLines) {
    const ptR = layoutProjection.proTipRect;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillRect(ptR.x, ptR.y, ptR.width, ptR.height);

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ptR.x, ptR.y, ptR.width, ptR.height);

    const badgeW = 60;
    const badgeH = 22;
    ctx.fillStyle = textColor;
    ctx.fillRect(ptR.x + 10, ptR.y + (ptR.height - badgeH) / 2, badgeW, badgeH);

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 10px ${typography.accentFont || 'monospace'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PRO TIP', ptR.x + 10 + badgeW / 2, ptR.y + ptR.height / 2);

    ctx.textAlign = 'left';
    ctx.fillStyle = textColor;
    ctx.font = `italic ${Math.round(typography.bodyFontSize * 0.82)}px ${typography.bodyFont}`;
    ctx.textBaseline = 'top';

    for (let i = 0; i < layoutProjection.proTipLines.length; i++) {
      const line = layoutProjection.proTipLines[i]!;
      ctx.fillText(line.text, line.x, line.y);
    }
    ctx.restore();
  }
};

export const newspaperEssayTemplate: EditorialTemplate = {
  id: 'newspaper_essay',
  name: '报刊社论',
  englishName: 'Newspaper Manifesto',
  description: '双轨刊头 Dateline 规线、打字机眉标、超大古典衬线标题、金句色块与 PRO TIP 编者卡片',
  columns: 2,
  defaultRatio: '3:4',
  features: {
    layoutType: 'newspaper',
    hasDatelineRule: true,
    hasAccentRule: true,
    hasProTipCard: true,
    headlinePlacement: 'top',
    pullquotePlacement: 'card',
  },
  defaultArticle: {
    masthead: '01 · ECHOES ESSAY',
    eyebrow: '— POSTED TODAY',
    headline: 'YOU DON’T NEED A DESIGNER TO SHIP YOUR FIRST DRAFT',
    deck: 'Six honest ways we are using algorithmic typography and fluid reflow to move faster from idea to artifact.',
    author: 'ECHOES FORGE EDITORIAL',
    pullquote: '',
    body: '01 · 视觉秩序的重构\n现代报刊排版的精髓在于构建明晰的视觉阶梯与阅读指引。通过双轨规线划分层级，大标题牢牢锁定第一视觉焦点，正文两栏如溪水般穿插流动。\n\n02 · 流体与几何避让\n文本在障碍物周围自然避让绕排，无论图片如何错落摆放，排版引擎都在毫秒间完成毫厘不差的字形重排，赋予数字版面宛如油墨印刷般的质感。',
    proTip: 'Don’t prompt for “good design.” Prompt for a mood — “Sunday paper”, “brutalist”, “Kinfolk”. Aesthetic specificity is the unlock.',
    folio: 'ECHOES FORGE · ISSUE 12',
    issueDate: '24 · AUG · 2026',
  },
  defaultTypography: {
    headlineFont: '方正屏显雅宋, "Noto Serif SC", "Playfair Display", serif',
    bodyFont: '方正屏显雅宋, "Noto Serif SC", serif',
    accentFont: '朝华打字机, "JetBrains Mono", monospace',
    textColor: '#1f1c17',
    accentColor: '#b85a3a',
    secondaryColor: '#6e6a5d',
    bodyFontSize: 19,
    bodyLineHeight: 31,
    dropCap: true,
    dropCapLines: 3,
    colGap: 36,
  },
  defaultBackground: {
    type: 'paper',
    color: '#f4efe4',
    hasPaperNoise: true,
  },
  renderDecorations: ({ article, typography, ratioPreset, layoutProjection }) => (
    <>
      {/* 双轨 Dateline 规线与眉标 */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: `${Math.round(ratioPreset.height * 0.045)}px`,
          left: `${Math.round(ratioPreset.width * 0.065)}px`,
          right: `${Math.round(ratioPreset.width * 0.065)}px`,
        }}
      >
        <div
          className="flex justify-between items-center font-mono font-medium tracking-widest pb-2"
          style={{
            fontSize: `${Math.round(ratioPreset.width * 0.0125)}px`,
            color: typography.secondaryColor || '#6e6a5d',
            borderBottom: `1.5px solid ${typography.textColor || '#1f1c17'}`,
          }}
        >
          <span>{(article.masthead || '01 · ECHOES ESSAY').toUpperCase()}</span>
          {article.issueDate && <span>{article.issueDate.toUpperCase()}</span>}
        </div>
        {article.eyebrow && (
          <div
            className="pt-2 font-mono font-bold tracking-widest"
            style={{
              fontSize: `${Math.round(ratioPreset.width * 0.011)}px`,
              color: typography.accentColor || '#b85a3a',
            }}
          >
            {article.eyebrow}
          </div>
        )}
      </div>

      {/* Pro Tip 编者按卡片 */}
      {layoutProjection.proTipRect && layoutProjection.proTipLines && (
        <div
          className="absolute flex items-center gap-3 bg-white/75 border border-black/15 p-2.5 pointer-events-none"
          style={{
            left: `${layoutProjection.proTipRect.x}px`,
            top: `${layoutProjection.proTipRect.y}px`,
            width: `${layoutProjection.proTipRect.width}px`,
            height: `${layoutProjection.proTipRect.height}px`,
          }}
        >
          <div className="px-2 py-1 bg-black text-white font-mono font-bold text-[10px] tracking-wider shrink-0">
            PRO TIP
          </div>
          <div
            className="font-serif italic leading-tight"
            style={{
              fontSize: `${Math.round(typography.bodyFontSize * 0.82)}px`,
              color: typography.textColor,
            }}
          >
            {layoutProjection.proTipLines.map((l, i) => (
              <div key={i}>{l.text}</div>
            ))}
          </div>
        </div>
      )}
    </>
  ),
  drawDecorations: drawNewspaperDecorations,
};
