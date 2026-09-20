/**
 * 前端画布操作执行器
 *
 * 供 Mascot Agent（Canvas Assistant）在接收到 extension_ui_request
 * （方法为 select 且 title 带有 "CANVAS_OP:" 前缀）时自动解析并执行。
 * 零 React 组件上下文依赖：画布状态操作直接操作全局 useCanvasState，
 * 检索类操作（search_prompts / search_skills）经前端 api 客户端携带已登录用户凭据
 * 调后端（pi 子进程内 fetch 无凭据，直连已鉴权路由会 401）。
 * 操作分四类：写操作（create_node / connect_nodes / update_node / disconnect_nodes /
 * delete_node，一律经 canvasCommands 命令层，保证可撤销）、只读操作
 * （list_nodes / read_node_output / get_node_details / get_node_params）、检索操作。
 */
import { nodesRef, edgesRef, setNodes, setEdges } from '../../../shared/stores/useCanvasState';
import api from '../../../shared/services/api';
import { bifrostService } from '../../../shared/services/bifrost';
import { seedDataFor } from '../../core/seedData';
import { collectDescendantIds } from '../../core/nodeGraph';
import { getCanvasCommands } from '../../core/canvasCommands';
import {
  NODE_PORT_TYPES,
  getNodeTitle,
  nodeOutputImages,
  nodeOutputText,
  type GraphNode,
} from '../../nodes/_shared/nodeTypes';
import type { NodeType, NodeData } from '../../core/graphTypes';

/** 单次读取节点输出的正文上限（防止超长产物撑爆模型上下文；超出部分明确标注截断） */
const MAX_READ_TEXT_CHARS = 20000;

/** 单字段回执预览上限（写入回执 / 节点详情共用） */
const MAX_FIELD_CHARS = 200;

/** 画布页未挂载时命令层不可用：明确报错，不降级直改 store（否则产生不可撤销的变更） */
const CANVAS_NOT_MOUNTED = '画布未挂载，无法执行变更操作（请在画板页重试）';

/**
 * 拒绝由 Agent 写入的字段：
 * - `isGenerating` / `error` / `output` / `imageUrl`：生成状态与产物只能由节点自身运行产生，
 *   否则 Agent 可凭空伪造生成结果（含 base64 图片）；
 * - `configId`：受管节点的后台模型/提示词绑定，属管理员权限，需要时走 canvas_send_feedback。
 */
const WRITE_DENYLIST: ReadonlySet<string> = new Set([
  'isGenerating',
  'error',
  'output',
  'imageUrl',
  'configId',
]);

/** 字段值回执预览：长文本截断、data URL 收敛占位符、长对象序列化截断 */
function previewValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('data:')) return collapseImageUrl(value);
    if (value.length > MAX_FIELD_CHARS) {
      return `${value.slice(0, MAX_FIELD_CHARS)}…（共 ${value.length} 字符，已截断）`;
    }
    return value;
  }
  if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
    const json = JSON.stringify(value);
    if (json.length > MAX_FIELD_CHARS) {
      return `${json.slice(0, MAX_FIELD_CHARS)}…（共 ${json.length} 字符，已截断）`;
    }
    return value;
  }
  return value;
}

/** data 入参归一：支持扁平对象或 JSON 字符串（模型偶尔把对象序列化成字符串传参） */
function parseDataParam(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore bad json */
    }
  }
  return {};
}

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

/**
 * data 键名别名：文本类节点的正文实际写入 `data.content`，但历史文档（SKILL.md 速查表、
 * 工具 promptGuidelines）示范成了 `text` 键，模型照此传参会写出一个无人读取的旁键。
 * 此处统一归一，并回传 warnings 让模型自我纠正（不静默吞掉，否则键名错误会一直复现）。
 */
const DATA_KEY_ALIASES: Partial<Record<NodeType, Record<string, string>>> = {
  text: { text: 'content' },
  text_generation: { text: 'content' },
};

/** data 键名归一：已显式提供目标键时不覆盖；返回新对象，不修改入参 */
function normalizeDataKeys(
  type: NodeType,
  data: Record<string, unknown>
): { data: Record<string, unknown>; aliased: string[] } {
  const aliases = DATA_KEY_ALIASES[type];
  if (!aliases) return { data, aliased: [] };
  const normalized = { ...data };
  const aliased: string[] = [];
  for (const [from, to] of Object.entries(aliases)) {
    if (!(from in normalized)) continue;
    const target = normalized[to];
    if (target === undefined || target === '') normalized[to] = normalized[from];
    delete normalized[from];
    aliased.push(`${from} → ${to}`);
  }
  return { data: normalized, aliased };
}

export async function executeCanvasOp(
  op: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
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

        // 命令层缺失（画布页未挂载）时直接报错：写操作必须走画布自身的历史/清理路径
        const cmds = getCanvasCommands();
        if (!cmds) {
          return { success: false, error: CANVAS_NOT_MOUNTED };
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
        const customData = parseDataParam(realParams.data);

        // 键名归一（如文本类节点的 text → content），并记录见闻供回执提醒模型
        const { data: normalizedData, aliased } = normalizeDataKeys(type, customData);

        // 计算新节点摆放坐标（标准卡片宽约 380~440px，横向偏移 460px 彻底避免与父节点重叠；同一父节点下多子节点 Y 轴错位）
        const siblingEdges = parentId ? edges.filter((e: any) => e.source === parentId) : [];
        const x = parent ? parent.x + 460 : 360 + (nodes.length % 5) * 40;
        const y = parent ? parent.y + siblingEdges.length * 120 : 240 + (nodes.length % 5) * 40;

        const newNode: NodeData = {
          id: nodeId,
          type,
          x,
          y,
          data: { ...defaultSeed, ...normalizedData },
          ...(realParams.config_id ? { configId: Number(realParams.config_id) } : {}),
        };

        // 业务增强：若创建 book_info 且提供了 ISBN，自动异步抓取豆瓣图书元数据并水合填充
        // （异步水合不是用户编辑：经命令层 updateNodeData 写回，但不记撤销历史）
        const updateNode = cmds.updateNodeData;
        if (type === 'book_info' && customData.isbn) {
          const isbnStr = String(customData.isbn).trim();
          if (isbnStr) {
            newNode.data.isGenerating = true;
            api
              .get<Record<string, unknown>, Record<string, unknown>>(
                `/modules/bookplate/isbn/${encodeURIComponent(isbnStr)}`
              )
              .then((bookMeta) => {
                updateNode(nodeId, {
                  ...bookMeta,
                  isbn: isbnStr,
                  isGenerating: false,
                  error: null,
                });
              })
              .catch((err: any) => {
                updateNode(nodeId, {
                  isGenerating: false,
                  error: err.message || err.detail || '获取图书元数据失败',
                });
              });
          }
        }

        // 写入全局画布节点（先记历史：与画布 UI 交互同口径，Agent 建节点后可 Ctrl+Z 撤销）
        cmds.recordHistory();
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
          ...(aliased.length
            ? { warnings: [`data 键名已归一：${aliased.join('、')}（请直接使用目标键名）`] }
            : {}),
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

        const cmds = getCanvasCommands();
        if (!cmds) {
          return { success: false, error: CANVAS_NOT_MOUNTED };
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
        // 先记历史：与画布 UI 手动连线同口径（可 Ctrl+Z 撤销）
        cmds.recordHistory();
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

      // ---- 就地修正类操作（改内容 / 调参 / 断线 / 删节点） ----

      case 'update_node': {
        // 浅合并写入节点 data（复用画布命令层：先记历史再写入，可撤销）
        const nodeId = String(realParams.node_id ?? '');
        if (!nodeId) {
          return { success: false, error: '缺少必填的节点 ID (node_id)，可先用 list_nodes 查节点清单' };
        }
        const cmds = getCanvasCommands();
        if (!cmds) {
          return { success: false, error: CANVAS_NOT_MOUNTED };
        }
        const nodes: NodeData[] = nodesRef.current || [];
        const target = nodes.find((n) => n.id === nodeId);
        if (!target) {
          return {
            success: false,
            error: `节点 ${nodeId} 不存在（可能已被删除），请用 list_nodes 获取最新节点清单`,
          };
        }

        const patch = parseDataParam(realParams.data);
        if (Object.keys(patch).length === 0) {
          return {
            success: false,
            error: '缺少要修改的 data（需为扁平键值对象），可先用 get_node_details 读取该节点当前字段',
          };
        }

        // 键名归一（文本类节点 text → content），与 create_node 同口径
        const { data: normalized, aliased } = normalizeDataKeys(target.type, patch);

        // 拒绝伪造生成结果 / 越权改受管节点后台配置
        const denied = Object.keys(normalized).filter((k) => WRITE_DENYLIST.has(k));
        if (denied.length > 0) {
          const hint = denied.includes('configId')
            ? '受管节点的后台配置（configId）不可由助手修改，需要调整请用 canvas_send_feedback 提交需求。'
            : '生成状态与产物字段只能由节点自身运行产生，不能手工写入。';
          return {
            success: false,
            error: `不允许通过本工具修改字段：${denied.join('、')}。${hint}`,
          };
        }

        cmds.recordHistory();
        cmds.updateNodeData(nodeId, normalized);

        const merged: GraphNode = { ...target, data: { ...target.data, ...normalized } };
        const values: Record<string, unknown> = {};
        for (const key of Object.keys(normalized)) values[key] = previewValue(normalized[key]);

        return {
          success: true,
          node_id: nodeId,
          type: target.type,
          updated_keys: Object.keys(normalized),
          values,
          has_output: nodeHasOutput(merged),
          message: `已更新节点「${getNodeTitle(merged)}」的 ${Object.keys(normalized).length} 个字段（可用撤销恢复）`,
          ...(aliased.length
            ? { warnings: [`data 键名已归一：${aliased.join('、')}（请直接使用目标键名）`] }
            : {}),
        };
      }

      case 'get_node_params': {
        // 只读：返回某类型节点的可配置字段与默认值（数据源＝seedDataFor，不新建第二份真相）
        const type = String(realParams.node_type ?? '').trim() as NodeType;
        if (!type) {
          return { success: false, error: '缺少必填的节点类型 (node_type)' };
        }
        const seed = (seedDataFor(type, undefined) ?? {}) as Record<string, unknown>;
        const keys = Object.keys(seed);
        if (keys.length === 0) {
          return {
            success: false,
            error: `未知或不支持查询参数的节点类型：${type}。完整类型清单见 canvas-node-catalog 技能`,
          };
        }
        return {
          success: true,
          node_type: type,
          fields: keys.map((key) => ({ key, default: previewValue(seed[key]) })),
          note:
            'default 即该类型节点的初始值。多模态视觉/排版类节点的预设 ID（presetId / mode / effectId / templateId 等）用 canvas_get_presets 查询，不要凭记忆填写；写入用 canvas_update_node。',
        };
      }

      case 'get_node_details': {
        // 只读：读取单节点当前完整字段现状 + 端口声明，让模型「先读再改」而非猜字段名
        const nodeId = String(realParams.node_id ?? '');
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
        const ports = NODE_PORT_TYPES[target.type];
        const data: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(target.data ?? {})) {
          data[key] = previewValue(value);
        }
        return {
          success: true,
          node_id: nodeId,
          type: target.type,
          title: getNodeTitle(target),
          x: target.x,
          y: target.y,
          is_generating: !!target.data?.isGenerating,
          has_output: nodeHasOutput(target),
          ports: {
            inputs: ports?.inputs ?? [],
            outputs: ports?.outputs ?? (ports ? [ports.output] : []),
          },
          data,
          ...(target.configId
            ? { config_id: target.configId, config_name: target.configName ?? '' }
            : {}),
          note: 'configId / isGenerating / error / output / imageUrl 不可通过 canvas_update_node 修改。',
        };
      }

      case 'disconnect_nodes': {
        // 断开连线：复用命令层 removeEdge（记历史、可撤销）；非破坏操作不弹确认
        const cmds = getCanvasCommands();
        if (!cmds) {
          return { success: false, error: CANVAS_NOT_MOUNTED };
        }
        const edges = edgesRef.current || [];
        const nodes: NodeData[] = nodesRef.current || [];
        const edgeId = realParams.edge_id ? String(realParams.edge_id) : '';
        const sourceId = realParams.source_id ? String(realParams.source_id) : '';
        const targetId = realParams.target_id ? String(realParams.target_id) : '';

        let edge = edgeId ? edges.find((e: any) => e.id === edgeId) : undefined;
        if (!edge) {
          if (!sourceId || !targetId) {
            return {
              success: false,
              error:
                '请提供 edge_id，或同时提供 source_id 与 target_id。不确定节点 ID 时先用 canvas_list_nodes 获取清单',
            };
          }
          edge = edges.find((e: any) => e.source === sourceId && e.target === targetId);
        }
        if (!edge) {
          return {
            success: false,
            error: `未找到匹配的连线（${edgeId || `${sourceId} → ${targetId}`}），请用 canvas_list_nodes 核对节点 ID`,
          };
        }

        const src = nodes.find((n) => n.id === edge.source);
        const tgt = nodes.find((n) => n.id === edge.target);
        const removed = cmds.removeEdge(edge.id);
        if (!removed) {
          return { success: false, error: `连线 ${edge.id} 删除失败（可能已被移除）` };
        }
        return {
          success: true,
          edge_id: edge.id,
          source_id: edge.source,
          target_id: edge.target,
          message: `已断开「${src ? getNodeTitle(src) : edge.source}」→「${tgt ? getNodeTitle(tgt) : edge.target}」的连线（下游将不再继承该上游输入，可用撤销恢复）`,
        };
      }

      case 'delete_node': {
        // 删除节点：两段式（先取影响范围供扩展侧确认，再执行），删除一律走命令层的级联+流中止+关联清理
        const cmds = getCanvasCommands();
        if (!cmds) {
          return { success: false, error: CANVAS_NOT_MOUNTED };
        }
        const nodeId = String(realParams.node_id ?? '');
        if (!nodeId) {
          return { success: false, error: '缺少必填的节点 ID (node_id)，可先用 list_nodes 查节点清单' };
        }
        const nodes: NodeData[] = nodesRef.current || [];
        const edges = edgesRef.current || [];
        const target = nodes.find((n) => n.id === nodeId);
        if (!target) {
          return {
            success: false,
            error: `节点 ${nodeId} 不存在（可能已被删除），请用 canvas_list_nodes 获取最新节点清单`,
          };
        }

        const cascade = realParams.cascade !== false;
        const allIds = cascade ? collectDescendantIds(nodeId, edges) : [nodeId];
        const descendants = allIds
          .filter((id) => id !== nodeId)
          .map((id) => {
            const node = nodes.find((n) => n.id === id);
            return { id, title: node ? getNodeTitle(node) : '', type: node?.type ?? '' };
          });

        // 未确认：只回影响范围，不产生任何变更（由扩展侧 ctx.ui.confirm 陈述后二次调用）
        if (realParams.confirmed !== true) {
          return {
            success: true,
            requires_confirmation: true,
            node_id: nodeId,
            title: getNodeTitle(target),
            type: target.type,
            cascade,
            descendant_count: descendants.length,
            descendants,
            affected_edges: edges.filter(
              (e: any) => allIds.includes(e.source) || allIds.includes(e.target)
            ).length,
            is_generating: !!target.data?.isGenerating,
          };
        }

        const { deletedIds, deletedEdges } = await cmds.removeNode(nodeId, {
          cascade,
          confirmed: true,
        });
        if (deletedIds.length === 0) {
          return { success: false, error: `删除未执行：节点 ${nodeId} 已不存在` };
        }
        return {
          success: true,
          deleted_ids: deletedIds,
          deleted_count: deletedIds.length,
          deleted_edge_ids: deletedEdges,
          cascade,
          message: `已删除节点「${getNodeTitle(target)}」${descendants.length ? `及其下游 ${descendants.length} 个节点` : ''}（可用画布撤销恢复）`,
        };
      }

      // ---- 检索类操作（走前端已登录凭据调后端 Bifrost 接口） ----

      case 'search_prompts': {
        const query = String(realParams.query ?? '').trim();
        const limit = Number(realParams.limit) > 0 ? Number(realParams.limit) : 10;
        try {
          const res = await bifrostService.listPrompts({ q: query, limit });
          return {
            success: true,
            total: res.total,
            count: res.prompts.length,
            prompts: res.prompts,
          };
        } catch (err: any) {
          return { success: false, error: `提示词检索失败: ${err?.message || err?.detail || err}` };
        }
      }

      case 'search_skills': {
        const query = String(realParams.query ?? '').trim();
        const limit = Number(realParams.limit) > 0 ? Number(realParams.limit) : 10;
        try {
          const res = await bifrostService.listSkills({ q: query, limit });
          return {
            success: true,
            total: res.total,
            remote_available: res.remote_available,
            count: res.skills.length,
            // SKILL.md 正文（body）单条可达数千字符，对「找技能」无帮助——列表只回元数据，
            // 避免一次检索撑爆模型上下文（正文在用户安装后于工作区读取）。
            skills: res.skills.map((s) => ({
              name: s.name,
              description: s.description,
              cached: !!s.cached,
              latest_version: s.latest_version ?? '',
              file_count: s.file_count ?? 0,
            })),
          };
        } catch (err: any) {
          return { success: false, error: `Skill 检索失败: ${err?.message || err?.detail || err}` };
        }
      }

      default:
        return { success: false, error: `不支持的画布操作: ${op}` };
    }
  } catch (err: any) {
    return { success: false, error: err.message || '画布操作执行异常' };
  }
}
