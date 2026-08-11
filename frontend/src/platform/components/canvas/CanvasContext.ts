import { createContext, useContext } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

interface CanvasContextType {
  scale: number;
  /** 节点输出锚点按下（开始手动拖线连线）；未提供则锚点仅展示 */
  onAnchorPointerDown?: (nodeId: string, e: ReactPointerEvent) => void;
}

export const CanvasContext = createContext<CanvasContextType>({ scale: 1 });

export const useCanvas = () => useContext(CanvasContext);
