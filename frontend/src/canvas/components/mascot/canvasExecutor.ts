/**
 * 前端画布操作执行器
 *
 * 供 Mascot Agent（Canvas Assistant）在接收到 extension_ui_request
 * （方法为 select 且 title 带有 "CANVAS_OP:" 前缀）时自动解析并执行。
 * 纯状态操作，零 React 组件上下文依赖，直接操作全局 useCanvasState。
 */
import { nodesRef, edgesRef, setNodes, setEdges } from '../../../shared/stores/useCanvasState';
import { seedDataFor } from '../../core/seedData';
import type { NodeType, NodeData } from '../../core/graphTypes';

export function executeCanvasOp(
  op: string,
  params: Record<string, unknown>
): Record<string, unknown> {
  try {
    switch (op) {
      case 'create_node': {
        const type = params.type as NodeType;
        if (!type) {
          return { success: false, error: '缺少必填的节点类型 (type)' };
        }

        const parentId = params.parent_id as string | undefined;
        const nodes: NodeData[] = nodesRef.current || [];
        const parent = parentId ? nodes.find((n) => n.id === parentId) : undefined;

        // 生成唯一节点 ID
        const nodeId = `${type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        
        // 获取该类型节点的默认 seed 数据
        const defaultSeed = seedDataFor(type, parent);
        const customData = (params.data as Record<string, unknown>) || {};

        // 计算新节点摆放坐标（在父节点右侧偏移，或居中级联偏移）
        const x = parent ? parent.x + 280 : 360 + (nodes.length % 5) * 40;
        const y = parent ? parent.y + 40 : 240 + (nodes.length % 5) * 40;

        const newNode: NodeData = {
          id: nodeId,
          type,
          x,
          y,
          data: { ...defaultSeed, ...customData },
          ...(params.config_id ? { configId: Number(params.config_id) } : {}),
        };

        // 写入全局画布节点
        setNodes((prev: NodeData[]) => [...prev, newNode]);

        // 若指定了父节点，自动建立连线
        if (parentId) {
          const edgeId = `edge-${parentId}-${nodeId}`;
          setEdges((prev: any[]) => [...prev, { id: edgeId, source: parentId, target: nodeId }]);
        }

        return {
          success: true,
          node_id: nodeId,
          message: `节点「${type}」已在画布创建${parentId ? '并完成连线' : ''}`,
        };
      }

      case 'connect_nodes': {
        const sourceId = params.source_id as string;
        const targetId = params.target_id as string;
        if (!sourceId || !targetId) {
          return { success: false, error: '必须同时提供 source_id 与 target_id' };
        }

        const nodes: NodeData[] = nodesRef.current || [];
        const edges = edgesRef.current || [];

        const source = nodes.find((n) => n.id === sourceId);
        const target = nodes.find((n) => n.id === targetId);
        if (!source || !target) {
          return { success: false, error: `源节点或目标节点未找到 (source: ${sourceId}, target: ${targetId})` };
        }

        // 防重检查
        const existing = edges.find((e: any) => e.source === sourceId && e.target === targetId);
        if (existing) {
          return { success: true, edge_id: existing.id, message: '连线已存在，无需重复连接' };
        }

        const edgeId = `edge-${sourceId}-${targetId}`;
        setEdges((prev: any[]) => [...prev, { id: edgeId, source: sourceId, target: targetId }]);

        return {
          success: true,
          edge_id: edgeId,
          message: `已成功连接节点 ${source.type} → ${target.type}`,
        };
      }

      default:
        return { success: false, error: `不支持的画布操作: ${op}` };
    }
  } catch (err: any) {
    return { success: false, error: err.message || '画布操作执行异常' };
  }
}
