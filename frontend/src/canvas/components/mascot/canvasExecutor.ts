/**
 * 前端画布操作执行器
 *
 * 供 Mascot Agent（Canvas Assistant）在接收到 extension_ui_request
 * （方法为 select 且 title 带有 "CANVAS_OP:" 前缀）时自动解析并执行。
 * 纯状态操作，零 React 组件上下文依赖，直接操作全局 useCanvasState。
 * 操作分两类：写操作（create_node / connect_nodes）与只读操作
 * （list_nodes / read_node_output，把画布节点内容回传给 Agent）。
 */
import { nodesRef, edgesRef, setNodes, setEdges } from '../../../shared/stores/useCanvasState';
import api from '../../../shared/services/api';
import { seedDataFor } from '../../core/seedData';
import { getNodeTitle, nodeOutputImages, nodeOutputText, type GraphNode } from '../../nodes/_shared/nodeTypes';
import type { NodeType, NodeData } from '../../core/graphTypes';

/** 单次读取节点输出的正文上限（防止超长产物撑爆模型上下文；超出部分明确标注截断） */
const MAX_READ_TEXT_CHARS = 20000;

/** data URL 收敛为占位符：内联 base64 对模型不可读，塞进工具结果纯属浪费上下文 */
function collapseImageUrl(url: string): string {
  if (!url.startsWith('data:')) return url;
  const mime = /^data:([^;,]+)/.exec(url)?.[1] ?? 'image';
  return `${mime} 内联图片（base64 已省略，长度 ${url.length}）`;
}

/** 节点当前是否有可消费的对外输出（文本或图片任一非空） */
function nodeHasOutput(node: GraphNode): boolean {
  return nodeOutputText(node).length > 0 || nodeOutputImages(node).length > 0;
}

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

      case 'list_nodes': {
        // 只读：返回节点清单（不含输出正文），供 Agent 先定位再按需读取
        const nodes: NodeData[] = nodesRef.current || [];
        const items = nodes.map((n) => ({
          id: n.id,
          type: n.type,
          title: getNodeTitle(n),
          x: n.x,
          y: n.y,
          has_output: nodeHasOutput(n),
          is_generating: !!n.data?.isGenerating,
        }));
        return {
          success: true,
          count: items.length,
          nodes: items,
          ...(items.length ? {} : { message: '画布上暂无节点' }),
        };
      }

      case 'read_node_output': {
        // 只读：读取指定节点的当前输出（文本正文 + 图片引用列表）
        const nodeId = (realParams.node_id || (params && (params as any).node_id)) as string;
        if (!nodeId) {
          return { success: false, error: '缺少必填的节点 ID (node_id)，可先用 list_nodes 查节点清单' };
        }
        const nodes: NodeData[] = nodesRef.current || [];
        const target = nodes.find((n) => n.id === nodeId);
        if (!target) {
          return {
            success: false,
            error: `节点 ${nodeId} 不存在（可能已被删除），请用 list_nodes 获取最新节点清单`,
          };
        }
        const text = nodeOutputText(target);
        const images = nodeOutputImages(target);
        const truncated = text.length > MAX_READ_TEXT_CHARS;
        return {
          success: true,
          node_id: nodeId,
          type: target.type,
          title: getNodeTitle(target),
          is_generating: !!target.data?.isGenerating,
          has_output: nodeHasOutput(target),
          text: truncated ? text.slice(0, MAX_READ_TEXT_CHARS) : text,
          ...(truncated ? { truncated: true, total_chars: text.length } : {}),
          images: images.map(collapseImageUrl),
          ...(nodeHasOutput(target)
            ? {}
            : { message: '该节点当前没有可读取的输出（尚未运行或输出为空）' }),
        };
      }

      default:
        return { success: false, error: `不支持的画布操作: ${op}` };
    }
  } catch (err: any) {
    return { success: false, error: err.message || '画布操作执行异常' };
  }
}
