/**
 * 前端画布操作执行器
 *
 * 供 Mascot Agent（Canvas Assistant）在接收到 extension_ui_request
 * （方法为 select 且 title 带有 "CANVAS_OP:" 前缀）时自动解析并执行。
 * 纯状态操作，零 React 组件上下文依赖，直接操作全局 useCanvasState。
 */
import { nodesRef, edgesRef, setNodes, setEdges } from '../../../shared/stores/useCanvasState';
import api from '../../../shared/services/api';
import { seedDataFor } from '../../core/seedData';
import type { NodeType, NodeData } from '../../core/graphTypes';

export function executeCanvasOp(
  op: string,
  params: Record<string, unknown>
): Record<string, unknown> {
  try {
    // 1. 参数解包防御：若参数被外层 params 对象包裹，解出内层真正参数
    let realParams = params;
    if (
      realParams &&
      typeof realParams === 'object' &&
      'params' in realParams &&
      typeof realParams.params === 'object' &&
      realParams.params !== null
    ) {
      realParams = realParams.params as Record<string, unknown>;
    }

    switch (op) {
      case 'create_node': {
        const type = (realParams.type || (params && (params as any).type)) as NodeType;
        if (!type) {
          return { success: false, error: '缺少必填的节点类型 (type)' };
        }

        const parentId = realParams.parent_id as string | undefined;
        const nodes: NodeData[] = nodesRef.current || [];
        const edges = edgesRef.current || [];
        const parent = parentId ? nodes.find((n) => n.id === parentId) : undefined;

        // 生成唯一节点 ID
        const nodeId = `${type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

        // 获取该类型节点的默认 seed 数据
        const defaultSeed = seedDataFor(type, parent);

        // 处理自定义 data：支持对象或 JSON 字符串安全解析
        let customData: Record<string, unknown> = {};
        if (realParams.data && typeof realParams.data === 'object' && !Array.isArray(realParams.data)) {
          customData = realParams.data as Record<string, unknown>;
        } else if (typeof realParams.data === 'string') {
          try {
            const parsed = JSON.parse(realParams.data);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              customData = parsed;
            }
          } catch {
            /* ignore bad json */
          }
        }

        // 计算新节点摆放坐标（标准卡片宽约 380~440px，横向偏移 460px 彻底避免与父节点重叠；同一父节点下多子节点 Y 轴错位）
        const siblingEdges = parentId ? edges.filter((e: any) => e.source === parentId) : [];
        const x = parent ? parent.x + 460 : 360 + (nodes.length % 5) * 40;
        const y = parent ? parent.y + siblingEdges.length * 120 : 240 + (nodes.length % 5) * 40;

        const newNode: NodeData = {
          id: nodeId,
          type,
          x,
          y,
          data: { ...defaultSeed, ...customData },
          ...(realParams.config_id ? { configId: Number(realParams.config_id) } : {}),
        };

        // 业务增强：若创建 book_info 且提供了 ISBN，自动异步抓取豆瓣图书元数据并水合填充
        if (type === 'book_info' && customData.isbn) {
          const isbnStr = String(customData.isbn).trim();
          if (isbnStr) {
            newNode.data.isGenerating = true;
            api
              .get<Record<string, unknown>, Record<string, unknown>>(
                `/modules/bookplate/isbn/${encodeURIComponent(isbnStr)}`
              )
              .then((bookMeta) => {
                setNodes((prev: NodeData[]) =>
                  prev.map((n) =>
                    n.id === nodeId
                      ? {
                          ...n,
                          data: {
                            ...n.data,
                            ...bookMeta,
                            isbn: isbnStr,
                            isGenerating: false,
                            error: null,
                          },
                        }
                      : n
                  )
                );
              })
              .catch((err: any) => {
                setNodes((prev: NodeData[]) =>
                  prev.map((n) =>
                    n.id === nodeId
                      ? {
                          ...n,
                          data: {
                            ...n.data,
                            isGenerating: false,
                            error: err.message || err.detail || '获取图书元数据失败',
                          },
                        }
                      : n
                  )
                );
              });
          }
        }

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
        const sourceId = (realParams.source_id || (params && (params as any).source_id)) as string;
        const targetId = (realParams.target_id || (params && (params as any).target_id)) as string;
        if (!sourceId || !targetId) {
          return { success: false, error: '必须同时提供 source_id 与 target_id' };
        }

        if (sourceId === targetId) {
          return { success: false, error: '无法自连接同一节点' };
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

        // DAG 防成环检查：检测 target 沿着出边是否能到达 source
        const wouldCreateCycle = (src: string, tgt: string): boolean => {
          const visited = new Set<string>([tgt]);
          const queue = [tgt];
          while (queue.length > 0) {
            const cur = queue.shift()!;
            for (const e of edges) {
              if (e.source !== cur || visited.has(e.target)) continue;
              if (e.target === src) return true;
              visited.add(e.target);
              queue.push(e.target);
            }
          }
          return false;
        };

        if (wouldCreateCycle(sourceId, targetId)) {
          return { success: false, error: `连线会导致循环依赖 (${source.type} 与 ${target.type} 形成闭环)` };
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
