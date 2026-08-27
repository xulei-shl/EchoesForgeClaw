import { createContext, useContext } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** 一次整体移动中的单节点位移 */
export interface NodeMove {
  id: string;
  x: number;
  y: number;
}

interface CanvasContextType {
  scale: number;
  /** 主选中节点 ID（普通点击；驱动连线高亮 / 操作栏等单选语义） */
  activeNodeId?: string | null;
  /** 设置主选中节点 ID（兼容回退；新代码优先用 selectNode / toggleNodeSelection） */
  setActiveNodeId?: (id: string | null) => void;
  /** 多选节点集合（普通点击单选也在集合内；空集 = 无选中） */
  selectedIds?: Set<string>;
  /** 普通点击选中：替换整个选择集，并设为主选中节点；传 null 清空 */
  selectNode?: (id: string | null) => void;
  /** Ctrl/Cmd+点击：切换某节点的多选成员资格（并将其设为主选中节点） */
  toggleNodeSelection?: (id: string) => void;
  /**
   * 解析与指定节点一起拖动的节点集合（含起始坐标）：
   * 节点属于分组 → 整组联动；在多选集内 → 全部选中节点联动；否则仅自身。
   * altKey=true 时绕过分组联动，仅拖当前节点（精细调整）。
   */
  resolveDragGroup?: (id: string, altKey: boolean) => NodeMove[];
  /** 整体拖动中（每帧）实时回调：批量重绘相关连线（命令式，不触发 React 渲染） */
  onMultiDrag?: (moves: NodeMove[]) => void;
  /** 整体拖动提交：一次历史记录 + 一次批量位置更新 */
  onMultiPositionChange?: (moves: NodeMove[]) => void;
  /** 节点输出锚点按下（开始手动拖线连线）；未提供则锚点仅展示 */
  onAnchorPointerDown?: (nodeId: string, e: ReactPointerEvent) => void;
}

export const CanvasContext = createContext<CanvasContextType>({ scale: 1 });

export const useCanvas = () => useContext(CanvasContext);
