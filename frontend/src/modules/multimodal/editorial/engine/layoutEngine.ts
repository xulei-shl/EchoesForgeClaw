/**
 * 杂志排版核心引擎 (layoutEngine) - Pretext 无 DOM 极速图文混排
 * 支持 7 种标志性杂志版式的几何结构计算与多栏流体排版
 */

import {
  prepareWithSegments,
  layoutNextLine,
  walkLineRanges,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from '@chenglou/pretext';
import type {
  BandObstacle,
  DropCapPlacement,
  EditorialFreeTextItem,
  EditorialImageItem,
  EditorialPreset,
  EditorialState,
  FreeTextBlockWrapResult,
  Interval,
  LayoutProjection,
  PageRatioPreset,
  PositionedLine,
  PullQuotePlacement,
  Rect,
} from '../types';
import {
  carveTextLineSlots,
  getPolygonIntervalForBand,
  getRectIntervalsForBand,
  transformRectToPolygon,
} from './wrapGeometry';

const preparedCache = new Map<string, PreparedTextWithSegments>();

export function getCachedPreparedText(text: string, font: string): PreparedTextWithSegments {
  const key = `${font}:::${text}`;
  const cached = preparedCache.get(key);
  if (cached) return cached;
  const prepared = prepareWithSegments(text, font);
  preparedCache.set(key, prepared);
  return prepared;
}

/**
 * 检查给定文本在某宽度下是否产生单词内断行（用于大标题美化）
 */
function checkBreaksInsideWord(prepared: PreparedTextWithSegments, maxWidth: number): boolean {
  let breaks = false;
  walkLineRanges(prepared, maxWidth, (line) => {
    if (line.end.graphemeIndex !== 0) breaks = true;
  });
  return breaks;
}

/**
 * 二分查找最佳标题字阶
 */
export function fitHeadlineFontSize(
  text: string,
  fontFamily: string,
  maxWidth: number,
  minSize = 28,
  maxSize = 120
): { fontSize: number; font: string; lineHeight: number } {
  let low = minSize;
  let high = maxSize;
  let best = low;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const fontSpec = `bold ${mid}px ${fontFamily}`;
    const prep = getCachedPreparedText(text, fontSpec);

    if (!checkBreaksInsideWord(prep, maxWidth)) {
      best = mid;
      low = mid + 2;
    } else {
      high = mid - 2;
    }
  }

  const finalFont = `bold ${best}px ${fontFamily}`;
  const lineHeight = Math.round(best * 1.08);
  return { fontSize: best, font: finalFont, lineHeight };
}

/**
 * 获取指定行扫描带下所有障碍物的阻挡区间集合
 */
function getBlockedIntervalsForBand(
  obstacles: BandObstacle[],
  bandTop: number,
  bandBottom: number
): Interval[] {
  const blocked: Interval[] = [];
  for (let i = 0; i < obstacles.length; i++) {
    const obs = obstacles[i]!;
    if (obs.kind === 'polygon') {
      const inter = getPolygonIntervalForBand(
        obs.points,
        bandTop,
        bandBottom,
        obs.horizontalPadding,
        obs.verticalPadding
      );
      if (inter) blocked.push(inter);
    } else if (obs.kind === 'rects') {
      const inters = getRectIntervalsForBand(
        obs.rects,
        bandTop,
        bandBottom,
        obs.horizontalPadding,
        obs.verticalPadding
      );
      for (let j = 0; j < inters.length; j++) blocked.push(inters[j]!);
    }
  }
  return blocked;
}

/**
 * 将图片素材转化为排版障碍物（矩形 / 旋转多边形避让区间）
 * 供固定版式正文流动与自由排版文本块绕排共用
 */
export function buildImageObstacles(
  images: EditorialImageItem[],
  W: number,
  H: number,
  hPad: number,
  vPad: number,
  captionLineH: number
): BandObstacle[] {
  const obstacles: BandObstacle[] = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    if (img.wrapMode === 'none') continue;

    const imgW = (img.width / 100) * W;
    const imgH = img.aspectRatio
      ? imgW / img.aspectRatio
      : ((img.height || 40) / 100) * H;

    const imgPx: Rect = {
      x: Math.round((img.x / 100) * W),
      y: Math.round((img.y / 100) * H),
      width: Math.round(imgW),
      height: Math.round(imgH + (img.caption ? captionLineH : 0)),
    };

    if (img.rotation && img.rotation !== 0) {
      const polygon = transformRectToPolygon(imgPx, img.rotation);
      obstacles.push({
        kind: 'polygon',
        points: polygon,
        horizontalPadding: hPad,
        verticalPadding: vPad,
      });
    } else {
      obstacles.push({
        kind: 'rects',
        rects: [imgPx],
        horizontalPadding: hPad,
        verticalPadding: vPad,
      });
    }
  }
  return obstacles;
}

/**
 * 在单栏区域内流动排版文本
 */
export function layoutTextColumn(
  prepared: PreparedTextWithSegments,
  startCursor: LayoutCursor,
  region: Rect,
  lineHeight: number,
  obstacles: BandObstacle[],
  minSlotWidth = 48,
  align: 'left' | 'center' | 'right' = 'left'
): { lines: PositionedLine[]; endCursor: LayoutCursor | null } {
  let cursor: LayoutCursor = startCursor;
  let lineTop = region.y;
  const lines: PositionedLine[] = [];

  while (lineTop + lineHeight <= region.y + region.height) {
    const bandTop = lineTop;
    const bandBottom = lineTop + lineHeight;
    const blocked = getBlockedIntervalsForBand(obstacles, bandTop, bandBottom);

    const slots = carveTextLineSlots(
      { left: region.x, right: region.x + region.width },
      blocked,
      minSlotWidth
    );

    if (slots.length === 0) {
      lineTop += lineHeight;
      continue;
    }

    // 逐个槽位排入文本
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      const slotWidth = slot.right - slot.left;
      const line = layoutNextLine(prepared, cursor, slotWidth);
      if (!line) {
        return { lines, endCursor: null }; // 文本全部排完
      }

      let x = slot.left;
      if (align === 'center') x = slot.left + (slotWidth - line.width) / 2;
      else if (align === 'right') x = slot.right - line.width;

      lines.push({
        x: Math.round(x),
        y: Math.round(lineTop),
        width: line.width,
        text: line.text,
      });

      cursor = line.end;
    }

    lineTop += lineHeight;
  }

  return { lines, endCursor: cursor };
}

/**
 * 自由排版文本块块内绕排：
 * 以文本块矩形为排版区域，图片为障碍物，用 Pretext 逐行流动排文（含 textAlign 对齐），
 * 返回逐行坐标与内容实际占用高度。
 * - 竖排（writingMode vertical）或带旋转的块 → 返回 null（绕排语义不适用，维持 CSS 换行）
 * - 空文本 → 返回 null（维持空块占位渲染）
 */
export function layoutFreeTextBlock(
  block: EditorialFreeTextItem,
  text: string,
  images: EditorialImageItem[],
  W: number,
  H: number,
  lineHeightFactor = 1.4
): FreeTextBlockWrapResult | null {
  if (block.writingMode === 'vertical') return null;
  if (block.rotation && block.rotation !== 0) return null;
  const raw = (text || '').trim();
  if (!raw) return null;

  const pxX = Math.round((block.x / 100) * W);
  const pxY = Math.round((block.y / 100) * H);
  const pxW = Math.round((block.width / 100) * W);
  if (pxW <= 0) return null;

  // 避让留白随块字号缩放（与固定版式 bodyFontSize 同比例），保证图文间距一致观感
  const hPad = Math.round(block.fontSize * 0.85);
  const vPad = Math.round(block.fontSize * 0.35);

  // 仅当图片与块存在重叠（含避让留白）时才启用绕排：
  // 无重叠维持原 CSS 换行（既有版面零回归），也避免多余计算
  const blockLeft = pxX - hPad;
  const blockRight = pxX + pxW + hPad;
  let overlaps = false;
  for (const img of images) {
    if (img.wrapMode === 'none') continue;
    const imgW = (img.width / 100) * W;
    const imgH = img.aspectRatio
      ? imgW / img.aspectRatio
      : ((img.height || 40) / 100) * H;
    const imgX = (img.x / 100) * W;
    const imgY = (img.y / 100) * H;
    // 水平区间重叠 && 图片下缘低于块上缘（块向下延伸至页底）
    if (blockLeft < imgX + imgW + hPad && blockRight > imgX - hPad && pxY - vPad < imgY + imgH + vPad) {
      overlaps = true;
      break;
    }
  }
  if (!overlaps) return null;

  const lineHeight = Math.round(block.fontSize * lineHeightFactor);
  const isBold = block.fontStyle === 'bold' || block.fontStyle === 'bold-italic';
  const isItalic = block.fontStyle === 'italic' || block.fontStyle === 'bold-italic';
  const font = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${block.fontSize}px ${
    block.fontFamily || 'serif'
  }`;
  const prepared = getCachedPreparedText(raw, font);

  const obstacles = buildImageObstacles(
    images,
    W,
    H,
    hPad,
    vPad,
    Math.round(block.fontSize * 1.5)
  );

  const region: Rect = {
    x: pxX,
    y: pxY,
    width: pxW,
    height: Math.max(1, Math.round(H - pxY)),
  };
  const result = layoutTextColumn(
    prepared,
    { segmentIndex: 0, graphemeIndex: 0 },
    region,
    lineHeight,
    obstacles,
    Math.max(24, Math.round(block.fontSize * 1.2)),
    block.textAlign || 'left'
  );

  if (result.lines.length === 0) return null;
  const contentHeight = result.lines.reduce(
    (max, l) => Math.max(max, l.y + lineHeight),
    pxY
  );
  return { lines: result.lines, contentHeight };
}

/**
 * 完整杂志页面排版计算
 */
export function computeEditorialLayout(
  state: EditorialState,
  pageRatio: PageRatioPreset,
  preset: EditorialPreset
): LayoutProjection {
  const { width: W, height: H } = pageRatio;
  const article = state.article || preset.defaultArticle;
  const typography = state.typography || preset.defaultTypography;
  const images = state.images || [];
  const layoutType = preset.features?.layoutType || 'newspaper';

  // 1. 根据版式计算页边距
  let marginX = Math.round(W * 0.065);
  let marginTop = Math.round(H * 0.065);
  let marginBottom = Math.round(H * 0.055);
  const colGap = typography.colGap || Math.round(W * 0.032);
  let colCount = Math.max(1, Math.min(3, preset.columns || 2));

  if (layoutType === 'minimal') {
    marginX = Math.round(W * 0.11);
    marginTop = Math.round(H * 0.09);
    marginBottom = Math.round(H * 0.08);
  } else if (layoutType === 'inverted') {
    marginX = Math.round(W * 0.05);
    marginTop = Math.round(H * 0.05);
    marginBottom = Math.round(H * 0.05);
  }

  let contentW = W - marginX * 2;

  // 2. 将图片转化为几何障碍物
  const hPad = Math.round(typography.bodyFontSize * 0.85);
  const vPad = Math.round(typography.bodyFontSize * 0.35);
  const obstacles: BandObstacle[] = buildImageObstacles(
    images,
    W,
    H,
    hPad,
    vPad,
    typography.bodyFontSize * 1.5
  );

  // 3. 针对不同版式的特征划分区域
  let splitPanelRect: Rect | undefined;
  let headlineMaxW = contentW;
  let headlineY = marginTop;

  if (layoutType === 'inverted') {
    const splitW = Math.round(W * 0.38);
    splitPanelRect = { x: 0, y: 0, width: splitW, height: H };
    headlineMaxW = splitW - marginX * 2;
    headlineY = marginTop + Math.round(H * 0.08);
  } else if (layoutType === 'newspaper') {
    // 报刊版式：Dateline 占位 -> Eyebrow -> 标题
    headlineY = marginTop + Math.round(H * 0.075);
  } else if (layoutType === 'cover') {
    headlineY = marginTop + Math.round(H * 0.08);
    headlineMaxW = contentW;
  } else if (article.masthead) {
    headlineY = marginTop + Math.round(H * 0.04);
  }

  // 4. 计算大标题排版
  const headlineText = (article.headline || 'UNTITLED ARTICLE').trim();
  const headlineFontFamily = typography.headlineFont || 'sans-serif';

  let minHeadSize = Math.round(W * 0.045);
  let maxHeadSize = Math.round(W * 0.095);

  if (layoutType === 'cover') {
    minHeadSize = Math.round(W * 0.06);
    maxHeadSize = Math.round(W * 0.13);
  } else if (layoutType === 'minimal') {
    minHeadSize = Math.round(W * 0.035);
    maxHeadSize = Math.round(W * 0.065);
  } else if (layoutType === 'newspaper') {
    minHeadSize = Math.round(W * 0.05);
    maxHeadSize = Math.round(W * 0.09);
  }

  const { font: headlineFont, lineHeight: headlineLineHeight } = fitHeadlineFontSize(
    headlineText,
    headlineFontFamily,
    headlineMaxW,
    minHeadSize,
    maxHeadSize
  );

  const headlinePrepared = getCachedPreparedText(headlineText, headlineFont);
  const headlineRegion: Rect = {
    x: layoutType === 'inverted' ? marginX : marginX,
    y: headlineY,
    width: headlineMaxW,
    height: Math.round(H * 0.35),
  };

  const { lines: headlineLines } = layoutTextColumn(
    headlinePrepared,
    { segmentIndex: 0, graphemeIndex: 0 },
    headlineRegion,
    headlineLineHeight,
    [],
    60
  );

  const headlineBottom =
    headlineLines.length > 0
      ? Math.max(...headlineLines.map((l) => l.y + headlineLineHeight))
      : headlineY + headlineLineHeight;

  // 5. 计算导语 (Deck)
  const deckLines: PositionedLine[] = [];
  let deckRegion: Rect | undefined;
  let bodyStartY = headlineBottom + Math.round(typography.bodyFontSize * 1.5);

  if (layoutType === 'inverted') {
    // 粗野反色版式中，导语放置在右侧白色区域顶部
    const rightX = Math.round(W * 0.42);
    const rightW = W - rightX - marginX;
    if (article.deck && article.deck.trim()) {
      const deckFont = `500 ${Math.round(typography.bodyFontSize * 1.2)}px ${typography.headlineFont}`;
      const deckLineHeight = Math.round(typography.bodyFontSize * 1.55);
      const deckPrepared = getCachedPreparedText(article.deck.trim(), deckFont);

      deckRegion = {
        x: rightX,
        y: marginTop + Math.round(H * 0.06),
        width: rightW,
        height: Math.round(H * 0.2),
      };

      const deckResult = layoutTextColumn(
        deckPrepared,
        { segmentIndex: 0, graphemeIndex: 0 },
        deckRegion,
        deckLineHeight,
        obstacles,
        60
      );
      deckLines.push(...deckResult.lines);

      if (deckLines.length > 0) {
        bodyStartY = Math.max(...deckLines.map((l) => l.y + deckLineHeight)) + Math.round(typography.bodyFontSize * 1.2);
      } else {
        bodyStartY = deckRegion.y + 60;
      }
    } else {
      bodyStartY = marginTop + Math.round(H * 0.08);
    }
  } else if (article.deck && article.deck.trim()) {
    const deckFont = `500 ${Math.round(typography.bodyFontSize * 1.2)}px ${typography.headlineFont}`;
    const deckLineHeight = Math.round(typography.bodyFontSize * 1.55);
    const deckPrepared = getCachedPreparedText(article.deck.trim(), deckFont);

    deckRegion = {
      x: marginX,
      y: headlineBottom + Math.round(typography.bodyFontSize * 0.8),
      width: contentW,
      height: Math.round(H * 0.2),
    };

    const deckResult = layoutTextColumn(
      deckPrepared,
      { segmentIndex: 0, graphemeIndex: 0 },
      deckRegion,
      deckLineHeight,
      obstacles,
      60
    );
    deckLines.push(...deckResult.lines);

    if (deckLines.length > 0) {
      bodyStartY = Math.max(...deckLines.map((l) => l.y + deckLineHeight)) + Math.round(typography.bodyFontSize * 1.5);
    }
  }

  // 6. 计算 Pro Tip 编者卡片（报刊社论专属）
  let proTipRect: Rect | undefined;
  let proTipLines: PositionedLine[] | undefined;
  let bodyEndY = H - marginBottom;

  if (layoutType === 'newspaper' && article.proTip && article.proTip.trim()) {
    const ptW = Math.round(contentW * 0.72);
    const ptH = Math.round(H * 0.065);
    const ptY = H - marginBottom - ptH - Math.round(H * 0.02);

    proTipRect = {
      x: marginX,
      y: ptY,
      width: ptW,
      height: ptH,
    };

    bodyEndY = ptY - Math.round(typography.bodyFontSize * 1.2);

    const ptFont = `italic ${Math.round(typography.bodyFontSize * 0.82)}px ${typography.bodyFont}`;
    const ptLineHeight = Math.round(typography.bodyFontSize * 1.35);
    const ptPrepared = getCachedPreparedText(article.proTip.trim(), ptFont);

    const ptResult = layoutTextColumn(
      ptPrepared,
      { segmentIndex: 0, graphemeIndex: 0 },
      { x: proTipRect.x + 80, y: proTipRect.y + 12, width: proTipRect.width - 96, height: ptH - 24 },
      ptLineHeight,
      [],
      40
    );
    proTipLines = ptResult.lines;
  }

  // 7. 计算金句引语 (Pull Quote) 卡片与障碍物避让
  let pullquotePlacement: PullQuotePlacement | null = null;
  let pullquoteCardRect: Rect | undefined;

  if (
    article.pullquote &&
    article.pullquote.trim() &&
    preset.features.pullquotePlacement === 'card'
  ) {
    const pqFont = `italic bold ${Math.round(typography.bodyFontSize * 1.15)}px ${typography.headlineFont}`;
    const pqLineHeight = Math.round(typography.bodyFontSize * 1.6);
    const pqPrepared = getCachedPreparedText(article.pullquote.trim(), pqFont);

    let pqCardW = Math.round(contentW * 0.46);
    let pqCardX = marginX;
    let pqCardY = bodyStartY + Math.round(H * 0.08);

    if (layoutType === 'newspaper') {
      // 报刊版式下引语卡片放置在右侧栏
      pqCardW = Math.round((contentW - colGap) / 2);
      pqCardX = marginX + pqCardW + colGap;
      pqCardY = bodyStartY + Math.round(H * 0.06);
    } else if (layoutType === 'quote') {
      // 访谈金句版式下引语居中跨栏放置
      pqCardW = Math.round(contentW * 0.68);
      pqCardX = marginX + Math.round((contentW - pqCardW) / 2);
      pqCardY = bodyStartY + Math.round(H * 0.05);
    }

    const pqLinesResult = layoutTextColumn(
      pqPrepared,
      { segmentIndex: 0, graphemeIndex: 0 },
      { x: pqCardX + 24, y: pqCardY + 20, width: pqCardW - 48, height: 260 },
      pqLineHeight,
      [],
      40
    );

    const pqContentH = pqLinesResult.lines.length * pqLineHeight + 40;
    const pqCardH = Math.max(100, pqContentH);

    pullquoteCardRect = {
      x: pqCardX,
      y: pqCardY,
      width: pqCardW,
      height: pqCardH,
    };

    pullquotePlacement = {
      x: pqCardX + 24,
      y: pqCardY + 20,
      width: pqCardW - 48,
      height: pqCardH - 40,
      lines: pqLinesResult.lines,
      font: pqFont,
      lineHeight: pqLineHeight,
    };

    // 把引语卡片作为障碍物插入，让正文环绕
    obstacles.push({
      kind: 'rects',
      rects: [pullquoteCardRect],
      horizontalPadding: hPad,
      verticalPadding: vPad,
    });
  }

  // 8. 划分多栏正文几何区域
  const columns: Rect[] = [];
  const bodyH = Math.max(100, bodyEndY - bodyStartY);

  if (layoutType === 'inverted') {
    // 粗野反色：正文仅在右侧白色区域分 2 栏
    const rightX = Math.round(W * 0.42);
    const rightW = W - rightX - marginX;
    const invColW = Math.round((rightW - colGap) / 2);
    for (let c = 0; c < 2; c++) {
      columns.push({
        x: rightX + c * (invColW + colGap),
        y: bodyStartY,
        width: invColW,
        height: bodyH,
      });
    }
  } else {
    // 标准对称多栏
    const singleColW = Math.round((contentW - colGap * (colCount - 1)) / colCount);
    for (let c = 0; c < colCount; c++) {
      const colX = marginX + c * (singleColW + colGap);
      columns.push({
        x: colX,
        y: bodyStartY,
        width: singleColW,
        height: bodyH,
      });
    }
  }

  // 9. 首字下沉 (Drop Cap) 计算
  let dropCapPlacement: DropCapPlacement | null = null;
  const rawBody = (article.body || '').trim();
  let layoutBodyText = rawBody;

  if (typography.dropCap && rawBody.length > 0 && columns.length > 0) {
    const firstChar = rawBody[0]!;
    const dropLines = typography.dropCapLines || 3;
    const dropCapH = typography.bodyLineHeight * dropLines - 4;
    const dropCapFont = `bold ${dropCapH}px ${typography.headlineFont}`;

    const dcPrep = getCachedPreparedText(firstChar, dropCapFont);
    let dcWidth = 0;
    walkLineRanges(dcPrep, 9999, (l) => {
      dcWidth = l.width;
    });
    const totalDcW = Math.ceil(dcWidth) + (layoutType === 'minimal' ? 18 : 12);

    const firstCol = columns[0]!;
    dropCapPlacement = {
      text: firstChar,
      x: firstCol.x,
      y: firstCol.y,
      width: totalDcW,
      height: dropCapH,
      font: dropCapFont,
      lineHeight: dropCapH,
    };

    // 把首字下沉区域加入障碍物列表
    obstacles.unshift({
      kind: 'rects',
      rects: [
        {
          x: firstCol.x,
          y: firstCol.y,
          width: totalDcW,
          height: dropCapH,
        },
      ],
      horizontalPadding: 6,
      verticalPadding: 0,
    });

    layoutBodyText = rawBody.slice(1).trimStart();
  }

  // 10. 正文流动排版 (Multi-Column Flow with Cursor Handoff)
  const bodyFont = `${typography.bodyFontSize}px ${typography.bodyFont}`;
  const bodyPrepared = getCachedPreparedText(layoutBodyText, bodyFont);
  const bodyLines: PositionedLine[] = [];
  let cursor: LayoutCursor | null = { segmentIndex: 0, graphemeIndex: 0 };

  for (let c = 0; c < columns.length; c++) {
    if (!cursor) break;
    const colRegion = columns[c]!;
    const colResult = layoutTextColumn(
      bodyPrepared,
      cursor,
      colRegion,
      typography.bodyLineHeight,
      obstacles,
      Math.round(typography.bodyFontSize * 2.8)
    );

    bodyLines.push(...colResult.lines);
    cursor = colResult.endCursor;
  }

  return {
    pageWidth: W,
    pageHeight: H,
    headlineFont,
    headlineLineHeight,
    headlineLines,
    headlineRegion,
    deckLines,
    deckRegion,
    dropCap: dropCapPlacement,
    bodyLines,
    pullquote: pullquotePlacement,
    pullquoteCardRect,
    proTipRect,
    proTipLines,
    splitPanelRect,
    columns,
    obstacles,
  };
}
