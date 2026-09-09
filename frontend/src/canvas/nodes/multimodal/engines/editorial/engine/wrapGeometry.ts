/**
 * 杂志排版几何与障碍物避让算法 (wrapGeometry)
 */

import type { Interval, Point, Rect } from '../types';

/**
 * 将带旋转角度的 Rect 变换为绝对坐标系下的 4 个多边形顶点
 */
export function transformRectToPolygon(rect: Rect, angleDeg: number): Point[] {
  const rad = (angleDeg * Math.PI) / 180;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;

  const localCorners: Point[] = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ];

  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return localCorners.map((p) => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  }));
}

/**
 * 获取多边形在指定 Y 坐标处的水平交点 X 列表（按升序排序）
 */
export function getPolygonXsAtY(points: Point[], y: number): number[] {
  const xs: number[] = [];
  const n = points.length;
  if (n < 3) return xs;

  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;

    if ((a.y <= y && y < b.y) || (b.y <= y && y < a.y)) {
      const t = (y - a.y) / (b.y - a.y);
      xs.push(a.x + t * (b.x - a.x));
    }
  }

  xs.sort((a, b) => a - b);
  return xs;
}

/**
 * 计算多边形在指定行扫描带 [bandTop, bandBottom] 内被阻挡的水平区间
 */
export function getPolygonIntervalForBand(
  points: Point[],
  bandTop: number,
  bandBottom: number,
  horizontalPadding = 16,
  verticalPadding = 4
): Interval | null {
  const sampleTop = bandTop - verticalPadding;
  const sampleBottom = bandBottom + verticalPadding;
  const startY = Math.floor(sampleTop);
  const endY = Math.ceil(sampleBottom);

  let left = Infinity;
  let right = -Infinity;

  for (let y = startY; y <= endY; y++) {
    const xs = getPolygonXsAtY(points, y + 0.5);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const runLeft = xs[i]!;
      const runRight = xs[i + 1]!;
      if (runLeft < left) left = runLeft;
      if (runRight > right) right = runRight;
    }
  }

  if (!Number.isFinite(left) || !Number.isFinite(right) || left >= right) {
    return null;
  }

  return {
    left: left - horizontalPadding,
    right: right + horizontalPadding,
  };
}

/**
 * 计算一组矩形在指定行扫描带内被阻挡的水平区间
 */
export function getRectIntervalsForBand(
  rects: Rect[],
  bandTop: number,
  bandBottom: number,
  horizontalPadding = 16,
  verticalPadding = 4
): Interval[] {
  const intervals: Interval[] = [];
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    if (bandBottom <= r.y - verticalPadding || bandTop >= r.y + r.height + verticalPadding) {
      continue;
    }
    intervals.push({
      left: r.x - horizontalPadding,
      right: r.x + r.width + horizontalPadding,
    });
  }
  return intervals;
}

/**
 * 槽位切分算法（Carve Text Line Slots）：
 * 给定一行基准可用区间 base 与一组被阻挡区间 blocked，
 * 剔除所有阻挡区域，切分出剩余可供文字排版的槽位片段（过滤掉过窄的碎片缝隙）。
 */
export function carveTextLineSlots(
  base: Interval,
  blocked: Interval[],
  minSlotWidth = 48
): Interval[] {
  let slots: Interval[] = [base];

  for (let i = 0; i < blocked.length; i++) {
    const b = blocked[i]!;
    const next: Interval[] = [];

    for (let j = 0; j < slots.length; j++) {
      const s = slots[j]!;
      // 无交集
      if (b.right <= s.left || b.left >= s.right) {
        next.push(s);
        continue;
      }
      // 左侧剩余
      if (b.left > s.left) {
        next.push({ left: s.left, right: b.left });
      }
      // 右侧剩余
      if (b.right < s.right) {
        next.push({ left: b.right, right: s.right });
      }
    }

    slots = next;
  }

  return slots.filter((slot) => slot.right - slot.left >= minSlotWidth);
}

/**
 * 点是否在多边形内部（射线法）
 */
export function isPointInPolygon(points: Point[], x: number, y: number): boolean {
  let inside = false;
  const n = points.length;
  for (let i = 0, prev = n - 1; i < n; prev = i++) {
    const a = points[i]!;
    const b = points[prev]!;
    const intersects =
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}
