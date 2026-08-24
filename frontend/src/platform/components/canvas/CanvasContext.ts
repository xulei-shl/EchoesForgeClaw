import { createContext, useContext } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

interface CanvasContextType {
  scale: number;
  /** 当前激活/选中的节点 ID（点击、操作或聚焦） */
  activeNodeId?: string | null;
  /** 设置当前激活节点 ID */
  setActiveNodeId?: (id: string | null) => void;
  /** 节点输出锚点按下（开始手动拖线连线）；未提供则锚点仅展示 */
  onAnchorPointerDown?: (nodeId: string, e: ReactPointerEvent) => void;
}

export const CanvasContext = createContext<CanvasContextType>({ scale: 1 });

export const useCanvas = () => useContext(CanvasContext);
