import type { GraphSnapshot, GraphSnapshotEdge, GraphSnapshotNode } from '../../shared/types';
import { sanitizeNodeData } from './graphSnapshotSanitize';
import type { EdgeData, NodeData } from './graphTypes';

/**
 * 画板连线子图快照构建（保存历史时调用，纯函数）。
 *
 * 从结果节点沿入边向上 BFS 收集全部可达祖先直到根（含结果节点自身），
 * 导出为可持久化的 GraphSnapshot（节点数据经 sanitizeNodeData 清洗降体积）。
 * 画廊/历史「画板」导入时据此重建完整连线链路。
 */

const MAX_SNAPSHOT_NODES = 200;

/** 沿入边向上 BFS，收集节点 id 的全部祖先（含自身），用于圈定快照子图边界。 */
export function collectAncestorIds(resultNodeId: string, edges: EdgeData[]): Set<string> {
  const visited = new Set<string>([resultNodeId]);
  const queue = [resultNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const e of edges) {
      if (e.target === current && !visited.has(e.source)) {
        visited.add(e.source);
        queue.push(e.source);
      }
    }
  }
  return visited;
}

/** 把节点集合压入快照节点结构（清洗 data，坐标保留供导入布局）。 */
function toSnapshotNode(n: NodeData): GraphSnapshotNode {
  return {
    id: n.id,
    type: n.type,
    configId: n.configId,
    configName: n.configName,
    x: n.x,
    y: n.y,
    data: sanitizeNodeData(n.type, n.data),
  };
}

/**
 * 构建结果节点的上游连线子图快照。
 * 返回 null 表示无法构建（如结果节点不存在）。
 */
export function buildGraphSnapshot(
  resultNodeId: string,
  nodes: NodeData[],
  edges: EdgeData[]
): GraphSnapshot | null {
  if (!nodes.some((n) => n.id === resultNodeId)) return null;

  const ids = collectAncestorIds(resultNodeId, edges);
  const snapshotNodes = nodes
    .filter((n) => ids.has(n.id))
    .slice(0, MAX_SNAPSHOT_NODES)
    .map(toSnapshotNode);

  // 只保留两端都在子图内的边
  const inSet = new Set(snapshotNodes.map((n) => n.id));
  const snapshotEdges: GraphSnapshotEdge[] = edges
    .filter((e) => inSet.has(e.source) && inSet.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));

  return {
    version: 1,
    resultNodeId,
    nodes: snapshotNodes,
    edges: snapshotEdges,
  };
}