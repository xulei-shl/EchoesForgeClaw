import { useCallback } from 'react';
import type { NodeData, NodeType } from './graphTypes';

/** 编辑器 patch 工厂所需的共享依赖（均为 ref / 稳定 setter，闭包不会过期） */
export interface EditorPatchFns<T = any> {
  nodesRef: React.MutableRefObject<NodeData[]> | React.RefObject<NodeData[]>;
  recordHistory: () => void;
  updateNodeData: (id: string, patch: T) => void;
}

/** 判断 patch 相对节点当前数据是否有实际变化（逐 key 浅比较） */
export function patchHasChanged(
  cur: Record<string, any> | undefined,
  patch: Record<string, any>
): boolean {
  for (const [k, v] of Object.entries(patch)) {
    if (cur?.[k] !== v) return true;
  }
  return false;
}

/**
 * 生成「编辑器状态写入 node.data」的稳定回调（undoable 时记撤销历史）：
 * - 节点类型不在白名单内静默忽略；
 * - patch 无实际变化不写回（避免无意义渲染 / 污染撤销栈）。
 *
 * 多 tab / 编辑器类节点（知乎 / Wikipedia / 翻译 / 网络搜索 / 地图海报 / 艺术地图 /
 * 图片检索 / 艺术图片检索 / 纹样 / 配色 / 邮票）共用同一实现——后续新增此类节点时
 * 一行工厂调用即可，无需复制此逻辑。
 */
export function useEditorPatchHandler(
  nodeTypes: NodeType[],
  fns: EditorPatchFns
): (id: string, patch: Record<string, any>, undoable?: boolean) => void {
  return useCallback(
    (id: string, patch: Record<string, any>, undoable = false) => {
      const node = fns.nodesRef.current?.find((n) => n.id === id);
      if (!node || !nodeTypes.includes(node.type)) return;
      if (!patchHasChanged(node.data ?? {}, patch)) return;
      if (undoable) fns.recordHistory();
      fns.updateNodeData(id, patch);
    },
    // 稳定回调：仅读取 refs / 稳定 setter，闭包不会过期
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
}