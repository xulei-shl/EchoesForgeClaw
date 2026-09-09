import type {
  EditorialArticleData,
  EditorialFreeTextItem,
  EditorialTemplate,
  EditorialTextAlign,
  EditorialTextStyle,
  EditorialTypographySettings,
} from '../types';

/**
 * 🎨 自由排版模板 (Free Canvas)
 * 特征：不再由引擎自动排文——每块文本（标题/导语/作者/正文/金句…）都作为独立图层，
 * 可自由拖动、缩放、旋转，并单独设置字体/字号/颜色/对齐/横竖排。
 * 所有块默认「绑定」文章字段（bind），因此图书元数据与上级节点继承的文本会自动流入对应块。
 *
 * 提供多种「初始骨架」布局（FREE_LAYOUT_SKELETONS）：仅改变块的几何与样式，
 * 由于内容来自绑定的文章字段，切换骨架不会丢失任何继承/编辑过的文本。
 */

/* ==================== 骨架构建器 ==================== */

interface FreeBlockPalette {
  textColor: string;
  accentColor: string;
  secondaryColor: string;
  headlineFont: string;
  bodyFont: string;
  monoFont: string;
}

interface FreeBlockSpec {
  fontFamily?: string;
  color?: string;
  fontStyle?: EditorialTextStyle;
  textAlign?: EditorialTextAlign;
  writingMode?: 'horizontal' | 'vertical';
}

function makeBlockBuilder(typography: EditorialTypographySettings) {
  const palette: FreeBlockPalette = {
    textColor: typography.textColor || '#1a1a1a',
    accentColor: typography.accentColor || '#b85a3a',
    secondaryColor: typography.secondaryColor || '#777777',
    headlineFont: typography.headlineFont || 'sans-serif',
    bodyFont: typography.bodyFont || 'serif',
    monoFont: typography.accentFont || typography.headlineFont || 'monospace',
  };
  let n = 0;
  const block = (
    bind: keyof EditorialArticleData | undefined,
    text: string,
    x: number,
    y: number,
    width: number,
    fontSize: number,
    spec: FreeBlockSpec = {}
  ): EditorialFreeTextItem => {
    n += 1;
    return {
      id: `ft_${bind || 'custom'}_${n}`,
      bind,
      text,
      x,
      y,
      width,
      fontSize,
      fontFamily: spec.fontFamily || palette.headlineFont,
      color: spec.color || palette.textColor,
      textAlign: spec.textAlign || 'left',
      fontStyle: spec.fontStyle || 'normal',
      rotation: 0,
      zIndex: n,
      writingMode: spec.writingMode || 'horizontal',
    };
  };
  return { block, palette };
}

/** 单个初始骨架 */
export interface FreeLayoutSkeleton {
  id: string;
  name: string;
  description?: string;
  build: (
    article: EditorialArticleData,
    typography: EditorialTypographySettings
  ) => EditorialFreeTextItem[];
}

/* ==================== 各骨架定义 ==================== */

// 经典期刊：顶部居中大标题 + 导语 + 作者，正文居左，金句与图片居右
const classicSkeleton: FreeLayoutSkeleton = {
  id: 'classic',
  name: '经典期刊',
  description: '顶部居中大标题，正文居左、金句与图片居右的经典杂志排布',
  build: (article, typography) => {
    const { block, palette } = makeBlockBuilder(typography);
    return [
      block('headline', article.headline || '自由排版标题', 6, 8, 88, 58, {
        textAlign: 'center',
        fontStyle: 'bold',
      }),
      block('deck', article.deck || '', 10, 20, 80, 18, {
        color: palette.secondaryColor,
        fontStyle: 'italic',
        textAlign: 'center',
      }),
      block('author', article.author || '', 10, 28, 80, 14, {
        fontFamily: palette.monoFont,
        textAlign: 'center',
      }),
      block('body', article.body || '', 8, 38, 50, typography.bodyFontSize || 18, {
        fontFamily: palette.bodyFont,
      }),
      block('pullquote', article.pullquote || '', 64, 38, 28, 22, {
        color: palette.accentColor,
        fontStyle: 'italic',
      }),
    ];
  },
};

// 居中海报：超大居中标题 + 居中正文与金句，适合封面感
const posterSkeleton: FreeLayoutSkeleton = {
  id: 'poster',
  name: '居中海报',
  description: '超大居中大标题，正文/金句/作者全部居中，封面海报氛围',
  build: (article, typography) => {
    const { block, palette } = makeBlockBuilder(typography);
    return [
      block('headline', article.headline || '自由排版标题', 8, 12, 84, 70, {
        textAlign: 'center',
        fontStyle: 'bold',
      }),
      block('deck', article.deck || '', 14, 28, 72, 18, {
        color: palette.secondaryColor,
        fontStyle: 'italic',
        textAlign: 'center',
      }),
      block('pullquote', article.pullquote || '', 14, 40, 72, 22, {
        color: palette.accentColor,
        fontStyle: 'italic',
        textAlign: 'center',
      }),
      block('body', article.body || '', 16, 54, 68, typography.bodyFontSize || 18, {
        fontFamily: palette.bodyFont,
        textAlign: 'center',
      }),
      block('author', article.author || '', 20, 88, 60, 13, {
        fontFamily: palette.monoFont,
        textAlign: 'center',
      }),
    ];
  },
};

// 左右分栏：标题/导语/作者/引语靠左，正文独立右栏，层次分明
const leftcolSkeleton: FreeLayoutSkeleton = {
  id: 'leftcol',
  name: '左右分栏',
  description: '标题与作者引语靠左，正文独立右栏，结构感强',
  build: (article, typography) => {
    const { block, palette } = makeBlockBuilder(typography);
    return [
      block('headline', article.headline || '自由排版标题', 6, 8, 42, 46, {
        fontStyle: 'bold',
      }),
      block('deck', article.deck || '', 6, 22, 42, 16, {
        color: palette.secondaryColor,
        fontStyle: 'italic',
      }),
      block('author', article.author || '', 6, 32, 38, 14, {
        fontFamily: palette.monoFont,
      }),
      block('pullquote', article.pullquote || '', 6, 42, 42, 20, {
        color: palette.accentColor,
        fontStyle: 'italic',
      }),
      block('body', article.body || '', 52, 8, 42, typography.bodyFontSize || 18, {
        fontFamily: palette.bodyFont,
      }),
    ];
  },
};

// 大字压叠：超大标题铺满上部，正文底部横条，金句右上角
const oversizeSkeleton: FreeLayoutSkeleton = {
  id: 'oversize',
  name: '大字压叠',
  description: '超大标题铺满上部，正文横置底部，金句置于右上角，冲击力强',
  build: (article, typography) => {
    const { block, palette } = makeBlockBuilder(typography);
    return [
      block('headline', article.headline || '自由排版标题', 4, 6, 92, 88, {
        fontStyle: 'bold',
      }),
      block('pullquote', article.pullquote || '', 64, 22, 30, 22, {
        color: palette.accentColor,
        fontStyle: 'italic',
      }),
      block('body', article.body || '', 8, 66, 84, typography.bodyFontSize || 18, {
        fontFamily: palette.bodyFont,
      }),
      block('author', article.author || '', 8, 90, 40, 14, {
        fontFamily: palette.monoFont,
      }),
    ];
  },
};

// 兼容旧导出名：默认（经典期刊）骨架
export function seedFreeTextsFromArticle(
  article: EditorialArticleData,
  typography: EditorialTypographySettings
): EditorialFreeTextItem[] {
  return classicSkeleton.build(article, typography);
}

export const FREE_LAYOUT_SKELETONS: FreeLayoutSkeleton[] = [
  classicSkeleton,
  posterSkeleton,
  leftcolSkeleton,
  oversizeSkeleton,
];

export function getFreeLayoutSkeleton(id: string): FreeLayoutSkeleton {
  return FREE_LAYOUT_SKELETONS.find((s) => s.id === id) || classicSkeleton;
}

export const DEFAULT_FREE_LAYOUT_SKELETON = 'classic';

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