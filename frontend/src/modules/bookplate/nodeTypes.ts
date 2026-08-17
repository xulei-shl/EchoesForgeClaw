import type { CanvasNodeType, NodePortType } from '../../platform/types';

export type { NodePortType } from '../../platform/types';

/** 节点模板的默认尺寸（画布布局用，与各节点组件 defaultSize 一致） */
export const NODE_DEFAULT_SIZES: Record<CanvasNodeType, { width: number; height: number }> = {
  book_info: { width: 440, height: 540 },
  image_analysis: { width: 420, height: 460 },
  prompt_generation: { width: 420, height: 500 },
  image_generation: { width: 420, height: 540 },
  text: { width: 420, height: 400 },
  image_upload: { width: 420, height: 420 },
  chat: { width: 420, height: 560 },
  text_aggregate: { width: 460, height: 520 },
  prompt_search: { width: 420, height: 440 },
  skill_search: { width: 440, height: 460 },
  calendar: { width: 420, height: 480 },
  weather: { width: 420, height: 460 },
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
  text_aggregate: 'oklch(0.65 0.15 165)',
  prompt_search: 'oklch(0.65 0.15 25)',
  skill_search: 'oklch(0.7 0.15 310)',
  calendar: 'oklch(0.65 0.15 80)',
  weather: 'oklch(0.6 0.15 220)',
};

export interface NodeTemplateDef {
  type: CanvasNodeType;
  name: string;
  description: string;
  category: 'input' | 'analysis' | 'generate' | 'output' | 'tool';
  configurable: boolean;
  defaultSize: { width: number; height: number };
}

/**
 * 节点模板元数据（展示层）。输入/输出端口类型（output_type / input_types）
 * 由后端 node_types.py 模板声明（唯一权威），经 node-registry 下发，
 * 前端以 NODE_PORT_TYPES 静态镜像兜底并做连线类型匹配校验。
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
  {
    type: 'text_aggregate',
    name: '文本聚合',
    description: '用占位符模板把多个上级文本按自定义格式拼接（如 ## 标题 + {占位符}）',
    category: 'tool',
    configurable: false,
    defaultSize: NODE_DEFAULT_SIZES.text_aggregate,
  },
  {
    type: 'prompt_search',
    name: '提示词检索',
    description: '从 Bifrost 提示词库检索并选用一条提示词，将其内容作为文本输出',
    category: 'input',
    configurable: false,
    defaultSize: NODE_DEFAULT_SIZES.prompt_search,
  },
  {
    type: 'skill_search',
    name: 'Skill 检索',
    description: '从 Bifrost Skills 仓库检索并安装 skill（或上传本地 zip），作为 Skill Agent 的 skill 来源',
    category: 'input',
    configurable: false,
    defaultSize: NODE_DEFAULT_SIZES.skill_search,
  },
  {
    type: 'calendar',
    name: '万年历',
    description: '查询指定日期的节假日与农历万年历（MXNZP API，无需配置）',
    category: 'tool',
    configurable: false,
    defaultSize: NODE_DEFAULT_SIZES.calendar,
  },
  {
    type: 'weather',
    name: '天气查询',
    description: '查询指定城市当前天气（wttr.in，可连线文本节点传入城市，无需配置）',
    category: 'tool',
    configurable: false,
    defaultSize: NODE_DEFAULT_SIZES.weather,
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
  tool: '小工具',
};

/* ===================================================================== */
/* 端口类型（输入/输出）声明与连线匹配                                    */
/* ===================================================================== */

/** 端口类型中文标签 */
export const PORT_TYPE_LABELS: Record<NodePortType, string> = {
  text: '文本',
  image: '图片',
  document: '文档',
  audio: '音频',
  video: '视频',
  any: '任意',
};

/**
 * 节点输入/输出端口类型（前端静态镜像，与后端 node_types.py 声明保持一致；
 * 注册表到达后用后端权威值覆盖）。output = 该节点产出什么；inputs = 接受哪些类型的上级输入。
 */
export const NODE_PORT_TYPES: Record<CanvasNodeType, { output: NodePortType; inputs: NodePortType[] }> = {
  book_info: { output: 'text', inputs: [] },
  text: { output: 'text', inputs: [] },
  image_upload: { output: 'image', inputs: [] },
  image_analysis: { output: 'text', inputs: ['image', 'text'] },
  prompt_generation: { output: 'text', inputs: ['text'] },
  image_generation: { output: 'image', inputs: ['text', 'image'] },
  // chat 接受文本（上一级节点内容）+ 图片（图片上传 / 图像生成节点输出，作为视觉上下文）
  // + document（Skill 检索节点的 skill 包，作为 Skill Agent 的 skill 来源）
  chat: { output: 'text', inputs: ['text', 'image', 'document'] },
  text_aggregate: { output: 'text', inputs: ['text'] },
  prompt_search: { output: 'text', inputs: [] },
  // skill 包（文件夹 + SKILL.md + scripts），作为 Skill Agent 的上游 skill 来源
  skill_search: { output: 'document', inputs: [] },
  // 万年历：手动输入日期查询，不接受上游输入
  calendar: { output: 'text', inputs: [] },
  // 天气查询：可连线文本节点传入城市（连线即输入）；无连线时手动输入 / 自动定位
  weather: { output: 'text', inputs: ['text'] },
};

/** 端口类型查找（由画布提供：后端模板声明优先，前端静态镜像兜底） */
export type PortTypesLookup = (
  type: CanvasNodeType
) => { output: NodePortType; inputs: NodePortType[] };

/** 连线端口匹配结果：match（匹配）/ mismatch（不匹配，红色标注）/ unknown（类型未知，不判定） */
export type PortMatch = 'match' | 'mismatch' | 'unknown';

/**
 * 判断「源节点输出类型」是否能被「目标节点输入类型列表」接受：
 * - any 匹配任意；目标输入列表为空 = 不接受任何上游输入；
 * - 任一侧类型未知（如注册表未加载）返回 unknown，不判为不匹配，避免误报。
 */
export function matchPortType(
  source: NodePortType | undefined,
  targetTypes: NodePortType[] | undefined
): PortMatch {
  if (!source || !targetTypes) return 'unknown';
  if (targetTypes.length === 0) return 'mismatch';
  if (source === 'any' || targetTypes.includes('any')) return 'match';
  return targetTypes.includes(source) ? 'match' : 'mismatch';
}

/**
 * 获取节点显示标题：优先使用用户配置的变体名称，否则回退到模板名称，最后 fallback 为类型标识
 */
export function getNodeTitle(node: { type: CanvasNodeType; configName?: string }): string {
  return node.configName ?? NODE_TEMPLATE_MAP[node.type]?.name ?? node.type;
}

/* ===================================================================== */
/* 输入收集（连线即输入：只取直接上级，1 级，不向上追溯）               */
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

/**
 * 某节点的直接上级节点（沿入边过滤，仅 1 级）：画线连上即输入（所见即所得）。
 * 不再像旧版那样沿整条祖先链向上 BFS 追溯。泛型保持调用方节点类型（NodeData / GraphNode）。
 */
export function resolveDirectParents<T extends GraphNode>(
  nodeId: string,
  nodes: T[],
  edges: GraphEdge[]
): T[] {
  const sourceIds = new Set(edges.filter((e) => e.target === nodeId).map((e) => e.source));
  return nodes.filter((n) => sourceIds.has(n.id));
}

/**
 * 画布根图书元数据节点：优先取无入边的 book_info（根），否则取画布中第一个。
 * 仅作「无连通 book_info」时的兜底（如「包含图书元数据」开关注入）。
 */
export function findRootBookInfo<T extends GraphNode>(
  nodes: T[],
  edges: GraphEdge[]
): T | undefined {
  const books = nodes.filter((n) => n.type === 'book_info');
  if (books.length === 0) return undefined;
  const hasIncoming = new Set(edges.map((e) => e.target));
  return books.find((b) => !hasIncoming.has(b.id)) ?? books[0];
}

/**
 * 沿入边向上追溯与某节点「实际连通」的图书元数据节点（BFS，取最近连通者）。
 * 画布允许存在多个互不连通的 book_info 节点（历史记录/画廊须记录真正参与生成的元数据，
 * 而非写死画布根节点）。book_info 无输入端口、恒为源头，故追溯自然终止。
 */
export function findConnectedBookInfoUpstream<T extends GraphNode>(
  nodeId: string,
  nodes: T[],
  edges: GraphEdge[]
): T | undefined {
  const visited = new Set<string>([nodeId]);
  const queue: string[] = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const p of resolveDirectParents(current, nodes, edges)) {
      if (visited.has(p.id)) continue;
      visited.add(p.id);
      if (p.type === 'book_info') return p;
      queue.push(p.id);
    }
  }
  return undefined;
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
 * 图书封面在浏览器可访问的 URL：优先本地代理（同源可 fetch → data URL），
 * 兜底豆瓣/内部地址（可能跨域 fetch 失败，收集时跳过）。chat 与图像生成节点共用。
 */
export function bookCoverImage(data: any): string {
  return (
    (typeof data?.cover_image_local === 'string' && data.cover_image_local) ||
    (typeof data?.cover_image === 'string' && data.cover_image) ||
    (typeof data?.coverUrl === 'string' && data.coverUrl) ||
    ''
  );
}

/**
 * 提取任意节点的对外输出文本（供下游作为输入）：
 * - 文本节点 → content；提示词生成 → content；图片分析 → analysis；
 * - AI 对话 → 最后一轮助手回复；图书元数据 → 过滤图片后的元数据。
 * - 图像生成 → 空串：该节点对外输出仅为图片（端口类型 image），其提示词是生成过程的
 *   记录元数据（写入历史记录 stage3.prompt），不作为文本传给下游节点。
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
      // 对外输出仅为图片（与端口声明 output: 'image' 一致）：提示词只作历史记录元数据，
      // 不传给下游。下游如需图片请用 nodeOutputImages（如 AI 对话节点的视觉上下文）。
      return '';
    case 'image_upload':
      return '';
    case 'text_aggregate':
      return typeof node.data.output === 'string' ? node.data.output : '';
    case 'prompt_search':
      return typeof node.data.content === 'string' ? node.data.content : '';
    case 'skill_search': {
      const selections = Array.isArray(node.data.skillSelections) ? node.data.skillSelections : [];
      if (selections.length === 0) return '';
      return selections
        .map(
          (s: { name: string; description?: string }) =>
            `• ${s.name}${s.description ? `: ${s.description}` : ''}`
        )
        .join('\n');
    }
    default: {
      // 约定式兜底：后续新增文本输出节点类型时，只要把对外文本存入
      // data.output / data.content / data.analysis 任一字段（按此优先级），
      // 即可被下游（含文本聚合占位符）默认引用，无需在此逐个枚举。
      const d = node.data;
      if (typeof d.output === 'string' && d.output) return d.output;
      if (typeof d.content === 'string' && d.content) return d.content;
      if (typeof d.analysis === 'string' && d.analysis) return d.analysis;
      return '';
    }
  }
}

/**
 * 提取任意节点的对外图片输出（data URL 或可访问的图片 URL，供 AI 对话节点作为视觉上下文）。
 * 目前产出图片的节点：图片上传（data URL）、图像生成（/static/generated 本地路径）。
 * 返回空数组表示该节点当前无可用图片输出。
 */
export function nodeOutputImages(node: GraphNode | undefined): string[] {
  if (!node || !node.data) return [];
  const d = node.data;
  switch (node.type) {
    case 'image_upload':
    case 'image_generation':
      return typeof d.imageUrl === 'string' && d.imageUrl ? [d.imageUrl] : [];
    default:
      return [];
  }
}


