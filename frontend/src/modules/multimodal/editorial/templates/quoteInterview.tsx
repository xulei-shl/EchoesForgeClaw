import type { EditorialTemplate, CanvasRenderContext } from '../types';

/**
 * 💬 访谈金句模板 (Interview & Perspectives)
 * 特征：勃艮第酒红与柔金配色、居中跨栏巨幅双引号金句卡片、3 栏文本动态避让
 */
const drawQuoteInterviewDecorations = (
  ctx: CanvasRenderingContext2D,
  { typography, accentColor, layoutProjection }: CanvasRenderContext
) => {
  if (!layoutProjection.pullquote || !layoutProjection.pullquoteCardRect) return;
  const pqRect = layoutProjection.pullquoteCardRect;

  ctx.save();
  ctx.fillStyle = 'rgba(122, 31, 53, 0.06)';
  ctx.fillRect(pqRect.x, pqRect.y, pqRect.width, pqRect.height);

  ctx.fillStyle = accentColor;
  ctx.fillRect(pqRect.x, pqRect.y, 4, pqRect.height);

  ctx.fillStyle = 'rgba(122, 31, 53, 0.15)';
  ctx.font = `bold ${Math.round(typography.bodyFontSize * 3.5)}px serif`;
  ctx.textBaseline = 'top';
  ctx.fillText('“', pqRect.x + 12, pqRect.y + 4);

  ctx.fillStyle = accentColor;
  ctx.font = layoutProjection.pullquote.font;
  ctx.textBaseline = 'top';

  for (let i = 0; i < layoutProjection.pullquote.lines.length; i++) {
    const line = layoutProjection.pullquote.lines[i]!;
    ctx.fillText(line.text, line.x, line.y);
  }
  ctx.restore();
};

export const quoteInterviewTemplate: EditorialTemplate = {
  id: 'quote_interview',
  name: '访谈金句',
  englishName: 'Interview & Quote',
  description: '勃艮第酒红与金、巨幅跨栏双引号金句卡片、3 栏文本动态避让、章节大标',
  columns: 3,
  defaultRatio: '3:4',
  features: {
    layoutType: 'quote',
    hasDatelineRule: false,
    hasAccentRule: true,
    headlinePlacement: 'top',
    pullquotePlacement: 'card',
  },
  defaultArticle: {
    masthead: 'PERSPECTIVES · IN-DEPTH INTERVIEW',
    eyebrow: 'CHAPTER 03 · THE CRAFT',
    headline: 'THE ART OF QUIET PERSISTENCE',
    deck: 'A conversation on slow design, organic typography, and how algorithms can amplify human sensibility.',
    author: 'INTERVIEW BY FORGE EDITORIAL',
    pullquote: '“我们不是在填充网格，而是在用光线、间隙与字形的重力，谱写一首可以被阅读的视觉乐章。”',
    body: '在快节奏的数字化浪潮中，我们常常忽略了留白的力量。真正的设计质感往往沉淀在那些看似微不足道的细节里：字距的呼吸、栏宽的舒适度、以及引语卡片在版面中沉稳的锚定点。通过智能避让与分词度量，每一个段落都在向读者诉说着关于专注与耐心的故事。',
    folio: 'PERSPECTIVES · VOL 03',
    issueDate: 'AUTUMN 2026',
  },
  defaultTypography: {
    headlineFont: 'Huiwen-mincho, "Noto Serif SC", serif',
    bodyFont: 'Huiwen-mincho, "Noto Serif SC", serif',
    textColor: '#2b1e22',
    accentColor: '#7a1f35',
    secondaryColor: '#d4a373',
    bodyFontSize: 18,
    bodyLineHeight: 30,
    dropCap: true,
    dropCapLines: 3,
    colGap: 30,
  },
  defaultBackground: {
    type: 'color',
    color: '#fdfbf7',
  },
  renderDecorations: ({ typography, layoutProjection }) => {
    if (!layoutProjection.pullquote || !layoutProjection.pullquoteCardRect) return null;
    const pqRect = layoutProjection.pullquoteCardRect;

    return (
      <div
        className="absolute pointer-events-none"
        style={{
          left: `${pqRect.x}px`,
          top: `${pqRect.y}px`,
          width: `${pqRect.width}px`,
          height: `${pqRect.height}px`,
          backgroundColor: 'rgba(122, 31, 53, 0.06)',
          borderLeft: `4px solid ${typography.accentColor || '#7a1f35'}`,
          padding: '16px 20px',
        }}
      >
        <div
          className="font-serif font-bold text-5xl leading-none opacity-20 -mt-2 -ml-1 select-none"
          style={{ color: typography.accentColor || '#7a1f35' }}
        >
          “
        </div>
        <div
          className="font-bold italic"
          style={{
            font: layoutProjection.pullquote.font,
            color: typography.accentColor || '#7a1f35',
            lineHeight: `${layoutProjection.pullquote.lineHeight}px`,
          }}
        >
          {layoutProjection.pullquote.lines.map((l, i) => (
            <div key={i}>{l.text}</div>
          ))}
        </div>
      </div>
    );
  },
  drawDecorations: drawQuoteInterviewDecorations,
};
