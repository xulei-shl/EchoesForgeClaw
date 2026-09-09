import type { EdgeData, NodeData, NodeType } from './graphTypes';

/** 收集节点的全部子孙节点 id（沿出边 BFS，含自身）；分支/级联删除用 */
export function collectDescendantIds(nodeId: string, edges: EdgeData[]): string[] {
  const ids = new Set<string>([nodeId]);
  let frontier = [nodeId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const nid of frontier) {
      for (const edge of edges) {
        if (edge.source === nid && !ids.has(edge.target)) {
          ids.add(edge.target);
          next.push(edge.target);
        }
      }
    }
    frontier = next;
  }
  return [...ids];
}

/** 某节点是否已有指定类型的直接子节点 */
export function hasChildOfType(
  nodeId: string,
  type: NodeType,
  edges: EdgeData[],
  nodes: NodeData[]
): boolean {
  return edges.some(
    (e) => e.source === nodeId && nodes.find((n) => n.id === e.target)?.type === type
  );
}