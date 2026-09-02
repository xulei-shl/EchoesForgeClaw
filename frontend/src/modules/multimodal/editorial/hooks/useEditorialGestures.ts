import { useRef } from 'react';
import type { EditorialFreeTextItem, EditorialImageItem, PageRatioPreset, EditorialState } from '../types';

export type GestureMode = 'move' | 'resize' | 'rotate';
export type GestureLayer = 'image' | 'text';

export interface GestureState {
  mode: GestureMode;
  layer: GestureLayer;
  id: string;
  startPx: number;
  startPy: number;
  startX: number;
  startY: number;
  startW: number;
  startAngle: number;
  startPointerAngle: number;
  centerPx: number;
  centerPy: number;
}

export const pointerAngleOf = (px: number, py: number, cx: number, cy: number) =>
  (Math.atan2(px - cx, -(py - cy)) * 180) / Math.PI;

export interface UseEditorialGesturesProps {
  id: string;
  ratioPreset: PageRatioPreset;
  scale: number;
  items: EditorialImageItem[];
  freeTexts: EditorialFreeTextItem[];
  stageWrapperRef: React.RefObject<HTMLDivElement | null>;
  setItems: React.Dispatch<React.SetStateAction<EditorialImageItem[]>>;
  setFreeTexts: React.Dispatch<React.SetStateAction<EditorialFreeTextItem[]>>;
  setSelectedItemId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedTextId: React.Dispatch<React.SetStateAction<string | null>>;
  onUpdateState?: (id: string, patch: Partial<EditorialState>, undoable?: boolean) => void;
}

/**
 * 杂志排版与自由文本统一手势状态机 Hook
 */
export function useEditorialGestures({
  id,
  ratioPreset,
  scale,
  items,
  freeTexts,
  stageWrapperRef,
  setItems,
  setFreeTexts,
  setSelectedItemId,
  setSelectedTextId,
  onUpdateState,
}: UseEditorialGesturesProps) {
  const gestureRef = useRef<GestureState | null>(null);

  const beginGesture = (
    e: React.PointerEvent,
    layer: GestureLayer,
    idItem: string,
    mode: GestureMode
  ) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}

    setSelectedTextId(null);
    setSelectedItemId(null);
    if (layer === 'image') setSelectedItemId(idItem);
    else setSelectedTextId(idItem);

    const obj: { x: number; y: number; width: number; rotation?: number } | undefined =
      layer === 'image' ? items.find((it) => it.id === idItem) : freeTexts.find((it) => it.id === idItem);
    if (!obj) return;

    const el = stageWrapperRef.current;
    if (!el) return;
    const stageRect = el.getBoundingClientRect();
    const itemPxW = (obj.width / 100) * ratioPreset.width * scale;
    const itemPxH =
      layer === 'image'
        ? itemPxW / ((items.find((it) => it.id === idItem) as EditorialImageItem | undefined)?.aspectRatio || 1)
        : Math.max(24, ((freeTexts.find((it) => it.id === idItem) as EditorialFreeTextItem | undefined)?.fontSize || 20) * 1.5 * scale);
    const itemPxX = (obj.x / 100) * ratioPreset.width * scale;
    const itemPxY = (obj.y / 100) * ratioPreset.height * scale;

    const centerPx = stageRect.left + itemPxX + itemPxW / 2;
    const centerPy = stageRect.top + itemPxY + itemPxH / 2;

    gestureRef.current = {
      mode,
      layer,
      id: idItem,
      startPx: e.clientX,
      startPy: e.clientY,
      startX: obj.x,
      startY: obj.y,
      startW: obj.width,
      startAngle: obj.rotation || 0,
      startPointerAngle: pointerAngleOf(e.clientX, e.clientY, centerPx, centerPy),
      centerPx,
      centerPy,
    };
  };

  const moveGesture = (e: React.PointerEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    e.stopPropagation();
    e.preventDefault();

    const actualWidthPx = ratioPreset.width * scale;
    const actualHeightPx = ratioPreset.height * scale;
    if (actualWidthPx <= 0 || actualHeightPx <= 0) return;

    const map = <T extends { id: string }>(
      arr: T[],
      patch: (it: T) => T
    ): T[] => arr.map((it) => (it.id === g.id ? patch(it) : it));

    if (g.mode === 'move') {
      const dxPct = ((e.clientX - g.startPx) / actualWidthPx) * 100;
      const dyPct = ((e.clientY - g.startPy) / actualHeightPx) * 100;
      // 边界保护：严禁拖出画布顶部或左侧边缘（0~95%）
      const nextX = Math.round(Math.max(0, Math.min(95, g.startX + dxPct)));
      const nextY = Math.round(Math.max(0, Math.min(95, g.startY + dyPct)));

      if (g.layer === 'image') {
        setItems((prev) => map(prev, (it) => ({ ...it, x: nextX, y: nextY })));
      } else {
        setFreeTexts((prev) => map(prev, (it) => ({ ...it, x: nextX, y: nextY })));
      }
    } else if (g.mode === 'resize') {
      const dxPct = ((e.clientX - g.startPx) / actualWidthPx) * 100;
      const nextW = Math.round(Math.max(g.layer === 'text' ? 6 : 12, Math.min(100, g.startW + dxPct)));
      if (g.layer === 'image') {
        setItems((prev) => map(prev, (it) => ({ ...it, width: nextW })));
      } else {
        setFreeTexts((prev) => map(prev, (it) => ({ ...it, width: nextW })));
      }
    } else if (g.mode === 'rotate') {
      const curPointerAngle = pointerAngleOf(
        e.clientX,
        e.clientY,
        g.centerPx,
        g.centerPy
      );
      const delta = curPointerAngle - g.startPointerAngle;
      const nextAngle = Math.round((g.startAngle + delta + 360) % 360);
      if (g.layer === 'image') {
        setItems((prev) => map(prev, (it) => ({ ...it, rotation: nextAngle })));
      } else {
        setFreeTexts((prev) => map(prev, (it) => ({ ...it, rotation: nextAngle })));
      }
    }
  };

  const endGesture = (e: React.PointerEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    gestureRef.current = null;
    if (g.layer === 'image') {
      onUpdateState?.(id, { images: items }, true);
    } else if (g.layer === 'text') {
      onUpdateState?.(id, { freeTexts }, true);
    }
  };

  return {
    gestureRef,
    beginGesture,
    moveGesture,
    endGesture,
  };
}
