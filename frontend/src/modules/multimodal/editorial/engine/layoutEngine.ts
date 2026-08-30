/**
 * 杂志排版核心引擎 (layoutEngine) - Pretext 无 DOM 极速图文混排
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
  EditorialPreset,
  EditorialState,
  Interval,
  LayoutProjection,
  PageRatioPreset,
  PositionedLine,
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
  maxSize = 96
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
  const lineHeight = Math.round(best * 1.12);
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
 * 在单栏区域内流动排版文本
 */
export function layoutTextColumn(
  prepared: PreparedTextWithSegments,
  startCursor: LayoutCursor,
  region: Rect,
  lineHeight: number,
  obstacles: BandObstacle[],
  minSlotWidth = 48
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

      lines.push({
        x: Math.round(slot.left),
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

  // 1. 计算页边距与多栏网格
  const marginX = Math.round(W * 0.065);
  const marginTop = Math.round(H * 0.07);
  const marginBottom = Math.round(H * 0.06);
  const colGap = typography.colGap || Math.round(W * 0.032);
  const colCount = Math.max(1, Math.min(3, preset.columns || 2));

  const contentW = W - marginX * 2;
  const singleColW = Math.round((contentW - colGap * (colCount - 1)) / colCount);

  // 2. 将图片转化为障碍物
  const obstacles: BandObstacle[] = [];
  const hPad = Math.round(typography.bodyFontSize * 0.9);
  const vPad = Math.round(typography.bodyFontSize * 0.3);

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
      height: Math.round(imgH),
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

  // 3. 计算大标题排版
  const headlineText = (article.headline || 'UNTITLED ARTICLE').trim();
  const headlineFontFamily = typography.headlineFont || 'sans-serif';
  const headlineMaxW =
    preset.features.headlinePlacement === 'left-col' && colCount > 1
      ? singleColW
      : contentW;

  const { font: headlineFont, lineHeight: headlineLineHeight } = fitHeadlineFontSize(
    headlineText,
    headlineFontFamily,
    headlineMaxW,
    Math.round(W * 0.045),
    Math.round(W * 0.125)
  );

  const headlinePrepared = getCachedPreparedText(headlineText, headlineFont);
  const headlineY = marginTop + (article.masthead ? Math.round(H * 0.03) : 0);
  const headlineRegion: Rect = {
    x: marginX,
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

  // 4. 计算导语 (Deck)
  const deckLines: PositionedLine[] = [];
  let bodyStartY = headlineBottom + Math.round(typography.bodyFontSize * 1.5);
  let deckRegion: Rect | undefined;

  if (article.deck && article.deck.trim()) {
    const deckFont = `500 ${Math.round(typography.bodyFontSize * 1.25)}px ${typography.headlineFont}`;
    const deckLineHeight = Math.round(typography.bodyFontSize * 1.6);
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
      bodyStartY = Math.max(...deckLines.map((l) => l.y + deckLineHeight)) + Math.round(typography.bodyFontSize * 1.2);
    }
  }

  // 5. 划分多栏正文区域
  const columns: Rect[] = [];
  const bodyH = Math.max(100, H - marginBottom - bodyStartY);

  for (let c = 0; c < colCount; c++) {
    const colX = marginX + c * (singleColW + colGap);
    columns.push({
      x: colX,
      y: bodyStartY,
      width: singleColW,
      height: bodyH,
    });
  }

  // 6. 首字下沉 (Drop Cap) 计算
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
    const totalDcW = Math.ceil(dcWidth) + 12;

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
      horizontalPadding: 4,
      verticalPadding: 0,
    });

    layoutBodyText = rawBody.slice(1).trimStart();
  }

  // 7. 正文流动排版 (Multi-Column Flow with Cursor Handoff)
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
      Math.round(typography.bodyFontSize * 3)
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
    pullquote: null,
    columns,
    obstacles,
  };
}
