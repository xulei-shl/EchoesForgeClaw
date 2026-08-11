import type { CanvasNodeType, InputSlot, InputSlotName, NodeTemplate } from '../../platform/types';

export type { InputSlot, InputSlotName } from '../../platform/types';

/** 节点模板的默认尺寸（画布布局用，与各节点组件 defaultSize 一致） */
export const NODE_DEFAULT_SIZES: Record<CanvasNodeType, { width: number; height: number }> = {
  book_info: { width: 440, height: 540 },
  image_analysis: { width: 420, height: 460 },
  prompt_generation: { width: 420, height: 500 },
  image_generation: { width: 420, height: 540 },
  text: { width: 420, height: 400 },
  image_upload: { width: 420, height: 420 },
  chat: { width: 420, height: 560 },
};

/** 节点的主题色（用于左上角指示圆点） */
export const NODE_COLORS: Record<CanvasNodeType, string> = {
  book_info: 'oklch(0.65 0.15 50)',
  text: 'oklch(0.65 0.15 140)',
  image_upload: 'oklch(0.65 0.15 200)',
  image_generation: 'oklch(0.65 0.15 240)',
  image_analysis: 'oklch(0.65 0.15 260)',
  chat: 'oklch(0.65 0.15 280)',
  prompt_generation: 'oklch(0.65 0.15 340)',
};

export interface NodeTemplateDef {
  type: CanvasNodeType;
  name: string;
  description: string;
  category: 'input' | 'analysis' | 'generate' | 'output';
  configurable: boolean;
  defaultSize: { width: number; height: number };
}

/**
 * 节点模板元数据（展示层；输入槽位 inputSlots 已下沉后端 node_types.py，
 * 经 node-registry 下发，执行引擎用 buildInputSlotsMap 转换后驱动，这里不再声明）
 */
export const NODE_TEMPLATES: NodeTemplateDef[] = [
  {
    type: 'book_info',
    name: '图书元数据',
    description: '通过豆瓣 API 获取 ISBN 对应的图书元数据',
    category: 'input',
    configurable: false,
    defaultSize: NODE_DEFAULT_SIZES.book_info,
  },
  {
    type: 'image_analysis',
    name: '图片分析',
    description: '多模态模型分析封面 / 参考图，输出艺术风格与主题色分析',
    category: 'analysis',
    configurable: true,
    defaultSize: NODE_DEFAULT_SIZES.image_analysis,
  },
  {
    type: 'prompt_generation',
    name: '提示词生成',
    description: '基于图书元数据与图片分析流式生成图像提示词',
    category: 'generate',
    configurable: true,
    defaultSize: NODE_DEFAULT_SIZES.prompt_generation,
  },
  {
    type: 'image_generation',
    name: '图像生成',
    description: '根据提示词生成藏书票图片',
    category: 'output',
    configurable: true,
    defaultSize: NODE_DEFAULT_SIZES.image_generation,
  },
  {
    type: 'text',
    name: '文本',
    description: '手动输入 / 编辑 Markdown 文本，作为工作流中的笔记或说明',
    category: 'input',
    configurable: false,
    defaultSize: NODE_DEFAULT_SIZES.text,
  },
  {
    type: 'image_upload',
    name: '图片上传',
    description: '手动上传一张图片到画布，作为工作流中的参考素材',
    category: 'input',
    configurable: false,
    defaultSize: NODE_DEFAULT_SIZES.image_upload,
  },
  {
    type: 'chat',
    name: 'AI 对话',
    description: '多轮对话 AI 助手，可绑定大模型或 FastClaw Agent，输出最后一轮回复',
    category: 'generate',
    configurable: true,
    defaultSize: NODE_DEFAULT_SIZES.chat,
  },
];

export const NODE_TEMPLATE_MAP: Record<CanvasNodeType, NodeTemplateDef> = Object.fromEntries(
  NODE_TEMPLATES.map((t) => [t.type, t])
) as Record<CanvasNodeType, NodeTemplateDef>;

/** 模板类别中文标签（「+」菜单分组标题） */
export const CATEGORY_LABELS: Record<NodeTemplateDef['category'], string> = {
  input: '输入',
  analysis: '分析',
  generate: '生成',
  output: '输出',
};

/**
 * 获取节点显示标题：优先使用用户配置的变体名称，否则回退到模板名称，最后 fallback 为类型标识
 */
export function getNodeTitle(node: { type: CanvasNodeType; configName?: string }): string {
  return node.configName ?? NODE_TEMPLATE_MAP[node.type]?.name ?? node.type;
}

/* ===================================================================== */
/* 声明式输入收集（执行引擎与节点组件共用）                              */
/* ===================================================================== */

/** 图的最小形状（BookplatePage 的 NodeData/EdgeData 结构兼容） */
export interface GraphNode {
  id: string;
  type: CanvasNodeType;
  data?: any;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export type InputSlotsMap = Record<CanvasNodeType, InputSlot[]>;

/**
 * 把后端 node-registry 下发的模板声明（snake_case input_slots）转换为
 * 执行引擎查找用的「节点类型 → 输入槽位数组」映射。无声明/空声明 = 无上游输入。
 */
export function buildInputSlotsMap(templates: NodeTemplate[]): InputSlotsMap {
  const map = {} as InputSlotsMap;
  for (const t of templates) {
    if (t.input_slots && t.input_slots.length > 0) {
      map[t.type] = t.input_slots;
    }
  }
  return map;
}

/** 排除图片/封面等无法作为文本上下文展示的字段（isbn 保留，与后端 _agent_prompt_message 一致） */
const META_SKIP_KEYS = new Set([
  'cover_image',
  'cover_image_local',
  'coverUrl',
  'image_url',
  'image_url_local',
  'isGenerating',
  'error',
]);

/**
 * 图书元数据 → 文本上下文（过滤图片字段，镜像后端 _agent_prompt_message 逻辑）
 */
export function bookMetadataText(data: any): string {
  if (!data || typeof data !== 'object') return '';
  const lines: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (META_SKIP_KEYS.has(k)) continue;
    if (v === undefined || v === null || v === '') continue;
    lines.push(`${k}: ${v}`);
  }
  return lines.join('\n');
}

/**
 * 提取任意节点的对外输出文本（供下游作为输入）：
 * - 文本节点 → content；提示词生成 → content；图片分析 → analysis；
 * - AI 对话 → 最后一轮助手回复；图像生成 → prompt；图书元数据 → 过滤图片后的元数据。
 * 返回空串表示该节点当前无可消费的文本输出。
 */
export function nodeOutputText(node: GraphNode | undefined): string {
  if (!node || !node.data) return '';
  switch (node.type) {
    case 'book_info':
      return bookMetadataText(node.data);
    case 'text':
    case 'prompt_generation':
      return typeof node.data.content === 'string' ? node.data.content : '';
    case 'image_analysis':
      return typeof node.data.analysis === 'string' ? node.data.analysis : '';
    case 'chat':
      return typeof node.data.output === 'string' ? node.data.output : '';
    case 'image_generation':
      return typeof node.data.prompt === 'string' ? node.data.prompt : '';
    case 'image_upload':
      return '';
  }
}

/**
 * 沿入边向上 BFS，找到最近的、类型属于 types 中任意一种的祖先节点。
 * 语义与旧版 findUpstream(nodeId, type) 一致，只是支持多种候选类型。
 */
function findUpstreamAny(
  nodeId: string,
  types: CanvasNodeType[],
  nodes: GraphNode[],
  edges: GraphEdge[]
): GraphNode | undefined {
  const typeSet = new Set(types);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  let frontier = [nodeId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const nid of frontier) {
      if (visited.has(nid)) continue;
      visited.add(nid);
      for (const edge of edges) {
        if (edge.target !== nid) continue;
        const parent = nodeById.get(edge.source);
        if (!parent) continue;
        if (typeSet.has(parent.type)) return parent;
        next.push(parent.id);
      }
    }
    frontier = next;
  }
  return undefined;
}

export type ResolvedNodeInputs = Partial<Record<InputSlotName, GraphNode>>;

/**
 * 按 inputSlots 声明收集上游输入来源节点（声明由后端下发，经 buildInputSlotsMap 转换）。
 * 不提取内容，由调用方按类型提取（nodeOutputText / 直接读 data）。无匹配上游的槽位为 undefined。
 */
export function resolveNodeInputs(
  node: GraphNode,
  nodes: GraphNode[],
  edges: GraphEdge[],
  inputSlots: InputSlotsMap
): ResolvedNodeInputs {
  const slots = inputSlots[node.type];
  const result: ResolvedNodeInputs = {};
  if (!slots) return result;
  for (const slot of slots) {
    result[slot.slot] = findUpstreamAny(node.id, slot.from, nodes, edges);
  }
  return result;
}
