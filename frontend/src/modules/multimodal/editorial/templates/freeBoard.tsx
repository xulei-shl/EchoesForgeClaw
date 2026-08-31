import type {
  EditorialArticleData,
  EditorialFreeTextItem,
  EditorialTemplate,
  EditorialTypographySettings,
} from '../types';

/**
 * 🎨 自由排版模板 (Free Canvas)
 * 特征：不再由引擎自动排文——每块文本（标题/导语/作者/正文/金句…）都作为独立图层，
 * 可自由拖动、缩放、旋转，并单独设置字体/字号/颜色/对齐/横竖排。
 * 所有块默认「绑定」文章字段（bind），因此图书元数据与上级节点继承的文本会自动流入对应块。
 */

/** 默认自由排版文本块工厂：依据文章内容 + 排版设置生成一套合理的初始布局 */
export function seedFreeTextsFromArticle(
  article: EditorialArticleData,
  typography: EditorialTypographySettings
): EditorialFreeTextItem[] {
  const blocks: EditorialFreeTextItem[] = [];
  const push = (
    bind: keyof EditorialArticleData | undefined,
    text: string,
    x: number,
    y: number,
    width: number,
    fontSize: number,
    fontFamily: string,
    color: string,
    fontStyle: EditorialFreeTextItem['fontStyle'] = 'normal',
    textAlign: EditorialFreeTextItem['textAlign'] = 'left'
  ) => {
    blocks.push({
      id: `ft_${bind || 'custom'}_${blocks.length + 1}`,
      bind,
      text,
      x,
      y,
      width,
      fontSize,
      fontFamily,
      color,
      textAlign,
      fontStyle,
      rotation: 0,
      zIndex: blocks.length + 1,
      writingMode: 'horizontal',
    });
  };

  const textColor = typography.textColor || '#1a1a1a';
  const accentColor = typography.accentColor || '#b85a3a';
  const secondaryColor = typography.secondaryColor || '#777777';

  // 大标题（居中顶部大字号）—— fontSize 基于标准画布（如 1200×1600）
  push(
    'headline',
    article.headline || '自由排版标题',
    (100 - 88) / 2,
    8,
    88,
    64,
    typography.headlineFont || 'sans-serif',
    textColor,
    'bold',
    'center'
  );
  // 导语 / 副标题
  push(
    'deck',
    article.deck || '',
    12,
    22,
    76,
    21,
    typography.headlineFont || 'sans-serif',
    secondaryColor,
    'italic',
    'center'
  );
  // 作者 / 出处
  push(
    'author',
    article.author || '',
    12,
    34,
    40,
    15,
    typography.accentFont || typography.headlineFont || 'monospace',
    textColor,
    'normal',
    'left'
  );
  // 正文段落
  push(
    'body',
    article.body || '',
    12,
    46,
    54,
    typography.bodyFontSize || 19,
    typography.bodyFont || 'serif',
    textColor,
    'normal',
    'left'
  );
  // 精彩金句（靠右，强调色斜体）
  push(
    'pullquote',
    article.pullquote || '',
    66,
    30,
    32,
    26,
    typography.headlineFont || 'sans-serif',
    accentColor,
    'italic',
    'left'
  );

  return blocks;
}

export const freeBoardTemplate: EditorialTemplate = {
  id: 'free_board',
  name: '自由排版',
  englishName: 'Free Canvas',
  description:
    '所见即所得自由画布：标题/导语/作者/正文/金句等每块文本均可独立拖动、缩放、旋转，并单独设置字体/字号/颜色/对齐；绑定的文本自动继承图书元数据与上级节点内容',
  columns: 1,
  defaultRatio: '3:4',
  features: {
    layoutType: 'free',
    headlinePlacement: 'middle',
    pullquotePlacement: 'none',
  },
  defaultArticle: {
    masthead: '',
    eyebrow: '',
    headline: '自由排版 · 标题区',
    deck: '在下方自由拖动、缩放每一块文字，双击或点击「文案」即可编辑内容。',
    author: '— BY YOUR OWN TYPE',
    pullquote: '',
    body: '这是一段正文文本示例：每块文本都支持独立移动、改变大小，并可单独设置字体、字号、颜色与对齐方式。绑定字段的内容（如来自图书元数据或上级节点）会自动流入对应文本块。',
    folio: '',
    issueDate: '',
  },
  defaultTypography: {
    headlineFont: 'MiSans, "Helvetica Neue", sans-serif',
    bodyFont: '方正屏显雅宋, "Noto Serif SC", serif',
    accentFont: 'JetBrains Mono, monospace',
    textColor: '#1a1a1a',
    accentColor: '#b85a3a',
    secondaryColor: '#777777',
    bodyFontSize: 19,
    bodyLineHeight: 31,
    dropCap: false,
    colGap: 0,
  },
  defaultBackground: {
    type: 'color',
    color: '#ffffff',
  },
};