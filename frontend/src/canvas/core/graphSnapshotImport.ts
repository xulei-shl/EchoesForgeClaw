import type { GraphSnapshot } from '../../shared/types';
import type { EdgeData, NodeData } from './graphTypes';
import { seedDataFor } from './seedData';

/**
 * 画板连线子图快照的水合（导入「画板」时调用，纯函数）。
 *
 * 把持久化的 GraphSnapshot 重建成可落画布的节点/连线：
 * - 重新生成节点 id（避免与现有画布冲突）
 * - 沿原子图相对布局平移到现有画布右侧（与老 3 节点导入的接缝一致）
 * - 清洗后的 data 与 seedDataFor 默认值合并，补足水合所需的完整字段
 */

export const NODE_GAP = 380;

/** 现有画布最右边缘 x（用于把新子图放到右侧，避免重叠；80 为第一列的空位起点）。 */
export function nextCanvasX(nodes: NodeData[]): number {
  return nodes.reduce((m, n) => Math.max(m, n.x + NODE_GAP), 80);
}

/**
 * 把快照水合为画布节点/连线。
 * @param snapshot 持久化的上游子图快照
 * @param existingNodes 现有画布节点（用于计算右侧空位）
 * @param startY 子图左上起始 y（默认 120，与旧导入一致）
 * @returns 新节点、新连线、以及快照中结果节点重映射后的 id
 */
export function hydrateGraphSnapshot(
  snapshot: GraphSnapshot,
  existingNodes: NodeData[],
  startY = 120
): { nodes: NodeData[]; edges: EdgeData[]; resultNodeId: string } {
  // 1. 重新生成节点 id：`node-import-<序号>`，杜绝与画布已有 id 冲突
  const idMap = new Map<string, string>();
  snapshot.nodes.forEach((n, i) => {
    idMap.set(n.id, `node-import-${i}`);
  });

  // 2. 布局平移：保留子图内部相对位置，整体移到现有画布右侧
  const minX = Math.min(...snapshot.nodes.map((n) => n.x));
  const minY = Math.min(...snapshot.nodes.map((n) => n.y));
  const dx = nextCanvasX(existingNodes) - minX;
  const dy = startY - minY;

  const nodes: NodeData[] = snapshot.nodes.map((snode) => ({
    id: idMap.get(snode.id)!,
    type: snode.type,
    configId: snode.configId,
    configName: snode.configName,
    x: Math.round(snode.x + dx),
    y: Math.round(snode.y + dy),
    data: {
      ...seedDataFor(snode.type),
      ...snode.data,
      isGenerating: false,
    },
  }));

  // 3. 重映射连线两端的 id
  const edges: EdgeData[] = snapshot.edges.map((e) => ({
    id: `edge-import-${idMap.get(e.source)}-${idMap.get(e.target)}`,
    source: idMap.get(e.source)!,
    target: idMap.get(e.target)!,
  }));

  return {
    nodes,
    edges,
    resultNodeId: idMap.get(snapshot.resultNodeId)!,
  };
}