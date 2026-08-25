import type { CanvasNodeType, NodePortType } from '../../platform/types';
import { DEFAULT_SIZES } from './graphTypes';

export type { NodePortType } from '../../platform/types';

/** 节点的主题色（用于左上角指示圆点） */
export const NODE_COLORS: Record<CanvasNodeType, string> = {
  book_info: 'oklch(0.65 0.15 50)',
  text: 'oklch(0.65 0.15 140)',
  image_upload: 'oklch(0.65 0.15 200)',
  image_generation: 'oklch(0.65 0.15 240)',
  image_analysis: 'oklch(0.65 0.15 260)',
  chat: 'oklch(0.65 0.15 280)',
  text_generation: 'oklch(0.65 0.15 340)',
  text_aggregate: 'oklch(0.65 0.15 165)',
  prompt_search: 'oklch(0.65 0.15 25)',
  skill_search: 'oklch(0.7 0.15 310)',
  calendar: 'oklch(0.65 0.15 80)',
  weather: 'oklch(0.6 0.15 220)',
  map_poster: 'oklch(0.62 0.15 160)',
  image_search: 'oklch(0.68 0.15 300)',
  art_image_search: 'oklch(0.7 0.14 330)',
  
  zhihu_search: 'oklch(0.66 0.18 250)',
  wikipedia_search: 'oklch(0.62 0.12 45)',
  text_translation: 'oklch(0.65 0.18 180)',
  web_search: 'oklch(0.6 0.18 130)',
  receipt_printer: 'oklch(0.68 0.15 40)',
  book_card: 'oklch(0.66 0.15 15)',
  stamp_cutter: 'oklch(0.68 0.16 25)',
  map_art: 'oklch(0.65 0.18 80)',
  pattern_search: 'oklch(0.65 0.16 20)',
  color_search: 'oklch(0.68 0.18 45)',
  oil_paint: 'oklch(0.66 0.16 60)',
  image_process: 'oklch(0.66 0.15 105)',
  sticker_maker: 'oklch(0.72 0.15 340)',
  journal_maker: 'oklch(0.7 0.14 150)',
  text_image: 'oklch(0.68 0.15 195)',
};

export interface NodeTemplateDef {
  type: CanvasNodeType;
  name: string;
  description: string;
  category: 'input' | 'analysis' | 'generate' | 'output' | 'tool' | 'multimodal' | 'glam';
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
    defaultSize: DEFAULT_SIZES.book_info,
  },
  {
    type: 'image_analysis',
    name: '图片分析',
    description: '多模态模型分析封面 / 参考图，输出艺术风格与主题色分析',
    category: 'analysis',
    configurable: true,
    defaultSize: DEFAULT_SIZES.image_analysis,
  },
  {
    type: 'text_generation',
    name: 'AI 文本生成',
    description: '基于上游输入流式生成文本内容',
    category: 'generate',
    configurable: true,
    defaultSize: DEFAULT_SIZES.text_generation,
  },
  {
    type: 'image_generation',
    name: '图像生成',
    description: '根据提示词生成藏书票图片',
    category: 'output',
    configurable: true,
    defaultSize: DEFAULT_SIZES.image_generation,
  },
  {
    type: 'text',
    name: '文本',
    description: '手动输入 / 编辑 Markdown 文本，作为工作流中的笔记或说明',
    category: 'input',
    configurable: false,
    defaultSize: DEFAULT_SIZES.text,
  },
  {
    type: 'image_upload',
    name: '图片上传',
    description: '手动上传一张图片到画布，作为工作流中的参考素材',
    category: 'input',
    configurable: false,
    defaultSize: DEFAULT_SIZES.image_upload,
  },
  {
    type: 'chat',
    name: 'AI 对话',
    description: '多轮对话 AI 助手，可绑定大模型或 Agent',
    category: 'generate',
    configurable: true,
    defaultSize: DEFAULT_SIZES.chat,
  },
  {
    type: 'text_aggregate',
    name: '文本聚合',
    description: '用占位符模板把多个上级文本按自定义格式拼接',
    category: 'tool',
    configurable: false,
    defaultSize: DEFAULT_SIZES.text_aggregate,
  },
  {
    type: 'prompt_search',
    name: '提示词检索',
    description: '从 Bifrost 提示词库检索选用后供下游节点使用',
    category: 'input',
    configurable: false,
    defaultSize: DEFAULT_SIZES.prompt_search,
  },
  {
    type: 'skill_search',
    name: 'Skill 检索',
    description: '从 Bifrost 检索或上传本地 skill zip，传入 Skill Agent',
    category: 'input',
    configurable: false,
    defaultSize: DEFAULT_SIZES.skill_search,
  },
  {
    type: 'calendar',
    name: '万年历',
    description: '查询指定日期的节假日与农历万年历',
    category: 'tool',
    configurable: false,
    defaultSize: DEFAULT_SIZES.calendar,
  },
  {
    type: 'weather',
    name: '天气查询',
    description: '查询指定城市当前天气',
    category: 'tool',
    configurable: false,
    defaultSize: DEFAULT_SIZES.weather,
  },
  {
    type: 'map_poster',
    name: '城市地图海报',
    description: '搜索城市并生成地图海报图片',
    category: 'multimodal',
    configurable: false,
    defaultSize: DEFAULT_SIZES.map_poster,
  },
  {
    type: 'image_search',
    name: '图片检索',
    description: '检索 Unsplash / Pixabay / NASA 等平台的免版权图片',
    category: 'multimodal',
    configurable: false,
    defaultSize: DEFAULT_SIZES.image_search,
  },
  {
    type: 'art_image_search',
    name: '艺术图片检索',
    description: '聚合博物馆 / 图书馆开放 API，关键词检索或随机浏览',
    category: 'glam',
    configurable: false,
    defaultSize: DEFAULT_SIZES.art_image_search,
  },
  
  {
    type: 'zhihu_search',
    name: '知乎检索',
    description: '知乎开发者平台 3 类检索：站内 / 全网 / 直答',
    category: 'tool',
    configurable: false,
    defaultSize: DEFAULT_SIZES.zhihu_search,
  },
  {
    type: 'wikipedia_search',
    name: 'Wikipedia 检索',
    description: '检索 Wikipedia 官方公开词条并获取全文 / 简介',
    category: 'tool',
    configurable: false,
    defaultSize: DEFAULT_SIZES.wikipedia_search,
  },
  {
    type: 'text_translation',
    name: '文本翻译',
    description: 'Google 翻译 / DeepLX 多引擎翻译，支持随机源与降级',
    category: 'tool',
    configurable: false,
    defaultSize: DEFAULT_SIZES.text_translation,
  },
  {
    type: 'web_search',
    name: '网络搜索',
    description: '知乎全网 / Tavily / Exa / 豆包等多源网络检索',
    category: 'tool',
    configurable: false,
    defaultSize: DEFAULT_SIZES.web_search,
  },
  {
    type: 'receipt_printer',
    name: '图书小票生成',
    description: '生成热敏纸小票、借书卡、古籍排版等书目推荐卡片',
    category: 'multimodal',
    configurable: false,
    defaultSize: DEFAULT_SIZES.receipt_printer,
  },
  {
    type: 'book_card',
    name: '图书卡片',
    description: '将元数据与封面图填入 HTML 模板并截图为图片',
    category: 'multimodal',
    configurable: false,
    defaultSize: DEFAULT_SIZES.book_card,
  },
  {
    type: 'stamp_cutter',
    name: '邮票截图框',
    description: '锯齿邮票框自由截取，生成带打孔边缘与边框的邮票图片',
    category: 'multimodal',
    configurable: false,
    defaultSize: DEFAULT_SIZES.stamp_cutter,
  },
  {
    type: 'sticker_maker',
    name: '贴纸制作',
    description: '一键抠图移除背景，生成带白边描边与投影的 die-cut 贴纸图片',
    category: 'multimodal',
    configurable: false,
    defaultSize: DEFAULT_SIZES.sticker_maker,
  },
  {
    type: 'journal_maker',
    name: '手账制作',
    description: '多图拼贴排版（拖移/缩放/旋转/图层排序/随机布局），合成图片',
    category: 'multimodal',
    configurable: false,
    defaultSize: DEFAULT_SIZES.journal_maker,
  },
  {
    type: 'text_image',
    name: '文本成图',
    description: '输入文字并调整字体/字号/颜色等参数，渲染为图片',
    category: 'multimodal',
    configurable: false,
    defaultSize: DEFAULT_SIZES.text_image,
  },
  {
    type: 'map_art',
    name: '艺术地图生成',
    description: '基于 prettymaps 服务端生成艺术风格地图图片',
    category: 'multimodal',
    configurable: false,
    defaultSize: DEFAULT_SIZES.map_art,
  },
  {
    type: 'pattern_search',
    name: '中国传统纹样',
    description: '检索/浏览 100 款中国传统纹样（AI生成版）',
    category: 'multimodal',
    configurable: false,
    defaultSize: DEFAULT_SIZES.pattern_search,
  },
  {
    type: 'color_search',
    name: '中国传统配色',
    description: '检索/浏览 742 款中国传统色，支持 5 色智能调色板生成',
    category: 'multimodal',
    configurable: false,
    defaultSize: DEFAULT_SIZES.color_search,
  },
  {
    type: 'oil_paint',
    name: '湿油彩效果',
    description: '图片合成带颜料厚度与湿润高光的湿油彩效果',
    category: 'multimodal',
    configurable: false,
    defaultSize: DEFAULT_SIZES.oil_paint,
  },
  {
    type: 'image_process',
    name: '图片处理',
    description: '噪点 / ASCII / 网点 / 抖动等风格化效果',
    category: 'multimodal',
    configurable: false,
    defaultSize: DEFAULT_SIZES.image_process,
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
  tool: '文本工具',
  multimodal: '多模态工具',
  glam: 'GLAM工具',
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
 * 注册表到达后用后端权威值覆盖）。output = 主输出类型（展示标签）；outputs = 全部输出类型
 * （复合节点可同时产出多种，如纹样节点输出图片 + 文本，缺省 = [output]）；
 * inputs = 接受哪些类型的上级输入。
 */
export const NODE_PORT_TYPES: Record<
  CanvasNodeType,
  { output: NodePortType; outputs?: NodePortType[]; inputs: NodePortType[] }
> = {
  book_info: { output: 'text', inputs: [] },
  text: { output: 'text', inputs: [] },
  image_upload: { output: 'image', inputs: [] },
  image_analysis: { output: 'text', inputs: ['image', 'text'] },
  text_generation: { output: 'text', inputs: ['text'] },
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
  // 城市地图海报：客户端渲染导出图片，无上游输入
  map_poster: { output: 'image', inputs: [] },
  // 图片检索：输出选中图片（本地 URL）；可连线文本节点作为检索关键词（连线即输入）
  image_search: { output: 'image', inputs: ['text'] },
  // 艺术图片检索：输出选中图片（本地 URL）；可连线文本节点作为检索关键词（连线即输入）
  art_image_search: { output: 'image', inputs: ['text'] },
  
  // 知乎检索：输出检索/问答结果文本；可连线文本节点作为检索关键词 / 直答问题（连线即输入）
  zhihu_search: { output: 'text', inputs: ['text'] },
  // Wikipedia 检索：输出文章全文文本；可连线文本节点作为检索关键词（连线即输入）
  wikipedia_search: { output: 'text', inputs: ['text'] },
  // 文本翻译：输出翻译结果文本；可连线文本节点作为待翻译文本（连线即输入）
  text_translation: { output: 'text', inputs: ['text'] },
  // 网络搜索：输出检索结果文本；可连线文本节点作为检索关键词（连线即输入）
  web_search: { output: 'text', inputs: ['text'] },
  // 图书小票生成：输出生成的小票图片；可连线图书元数据/文本作为内容输入，图片作为插图输入（连线即输入）
  receipt_printer: { output: 'image', inputs: ['text', 'image'] },
  // 图书卡片：输出生成的卡片图片；可连线图书元数据（封面兜底根节点）与文本/图片上级（连线即输入）
  book_card: { output: 'image', inputs: ['text', 'image'] },
  // 邮票截图框：输出生成的邮票图片；可连线图片或图书元数据作为输入源（连线即输入）
  stamp_cutter: { output: 'image', inputs: ['image', 'text'] },
  // 贴纸制作：输出生成的贴纸图片；可连线图片或图书元数据作为输入源（连线即输入）
  sticker_maker: { output: 'image', inputs: ['image', 'text'] },
  // 手账制作：输出合成的整张手账页图片；可连线多张图片或图书元数据一并作为素材源（连线即输入）
  journal_maker: { output: 'image', inputs: ['image', 'text'] },
  // 文本成图：手动输入文字渲染为图片（默认透明背景），不接受上游输入
  text_image: { output: 'image', inputs: [] },
  map_art: { output: 'image', inputs: ['text'] },
  // 中国传统纹样：复合输出——主输出为图片（纹样卡片图），同时产出详情说明文本；
  // 下游按自身接受的输入类型取用（图片分析/图像生成拿图片，文本聚合/AI对话拿文本或两者都拿）
  pattern_search: { output: 'image', outputs: ['image', 'text'], inputs: ['text'] },
  // 中国传统配色：复合输出——主输出为图片（传统色卡图），同时产出调色板与搭配方案 Markdown 文本；
  color_search: { output: 'image', outputs: ['image', 'text'], inputs: ['text'] },
  // 湿油彩效果：输出生成的油画图片；可连线图片或图书元数据作为输入源（连线即输入）
  oil_paint: { output: 'image', inputs: ['image', 'text'] },
  // 图片处理：输出处理结果图片；可连线图片或图书元数据作为输入源（连线即输入）
  image_process: { output: 'image', inputs: ['image', 'text'] },
};

/** 节点端口声明：主输出 + 全部输出类型 + 接受的上游输入类型列表 */
export interface NodePortDeclaration {
  /** 主输出类型（展示标签用；复合节点的首要产出） */
  output: NodePortType;
  /** 全部输出类型（复合节点可同时产出多种；缺省 = [output]） */
  outputs: NodePortType[];
  /** 接受的输入类型列表 */
  inputs: NodePortType[];
}

/** 端口类型查找（由画布提供：后端模板声明优先，前端静态镜像兜底） */
export type PortTypesLookup = (type: CanvasNodeType) => NodePortDeclaration;

/**
 * 文本输出上级在「图像生成提示词」中的角色（仅影响提示词拼装的分桶与标注）：
 * - book：图书元数据，走图书通道（includeBook 开关注入），不并入文本上下文；
 * - prompt：主提示词（提示词生成节点），有则优先作为提示词来源；
 * - analysis：图片分析结果，单独标注为「## 图片分析」并入提示词；
 * - 未配置 = 普通文本上下文（并入「## 文本上下文」）。
 * 约定式：后续新增文本输出节点类型时**无需改动执行引擎**——默认归入文本上下文；
 * 若需特殊角色（主提示词 / 分析等），在此表加一行即可。
 */
export const TEXT_ROLE: Partial<Record<CanvasNodeType, 'book' | 'prompt' | 'analysis'>> = {
  book_info: 'book',
  text_generation: 'prompt',
  image_analysis: 'analysis',
};

/** 连线端口匹配结果：match（匹配）/ mismatch（不匹配，红色标注）/ unknown（类型未知，不判定） */
export type PortMatch = 'match' | 'mismatch' | 'unknown';

/**
 * 判断「源节点输出类型」是否能被「目标节点输入类型列表」接受：
 * - 源可为单类型或复合输出的类型列表（复合节点命中任一即匹配）；
 * - any 匹配任意；目标输入列表为空 = 不接受任何上游输入；
 * - 任一侧类型未知（如注册表未加载）返回 unknown，不判为不匹配，避免误报。
 */
export function matchPortType(
  source: NodePortType | NodePortType[] | undefined,
  targetTypes: NodePortType[] | undefined
): PortMatch {
  if (!source || !targetTypes) return 'unknown';
  if (targetTypes.length === 0) return 'mismatch';
  const sources = Array.isArray(source) ? source : [source];
  if (sources.includes('any') || targetTypes.includes('any')) return 'match';
  return sources.some((s) => targetTypes.includes(s)) ? 'match' : 'mismatch';
}

/**
 * 获取节点显示标题：优先使用用户配置的变体名称，否则回退到模板名称，最后 fallback 为类型标识
 */
export function getNodeTitle(node: { type: CanvasNodeType; configName?: string }): string {
  return node.configName ?? NODE_TEMPLATE_MAP[node.type]?.name ?? node.type;
}

/**
 * 获取节点的动态标题：优先取随使用变化的名称
 * （提示词检索 = 已选提示词名；技能检索 = 首个已选技能名），回退到 getNodeTitle。
 */
export function getNodeDynamicTitle(node: {
  type: CanvasNodeType;
  configName?: string;
  data?: any;
}): string {
  const d = node.data;
  if (node.type === 'prompt_search') {
    const name = d?.promptName;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  if (node.type === 'skill_search') {
    const name = Array.isArray(d?.skillSelections) ? d.skillSelections[0]?.name : undefined;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return getNodeTitle(node);
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
 * 提取任意节点的对外输出文本（供下游作为输入）。
 * 约定式（与端口类型声明配套）：产出文本的节点把对外文本存入 data.output / data.content /
 * data.analysis 任一字段（按此优先级）；结构化数据（图书元数据 / skill 列表）走类型专属格式化。
 * 返回空串表示该节点当前无可消费的文本输出。
 */
export function nodeOutputText(node: GraphNode | undefined): string {
  if (!node || !node.data) return '';
  switch (node.type) {
    case 'book_info':
      return bookMetadataText(node.data);
    case 'text':
    case 'text_generation':
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
    case 'pattern_search':
      return typeof node.data.output === 'string' ? node.data.output : '';
    case 'color_search':
      return typeof node.data.output === 'string' ? node.data.output : '';
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
 * 提取任意节点的对外图片输出（data URL 或可访问的图片 URL，供下游节点作为参考图 / 视觉上下文）。
 * 约定式：产出图片的节点把对外图片存入 data.imageUrl（图片上传 / 图像生成即此约定），
 * 后续新增图片输出节点类型时无需在此枚举即可被下游引用。
 * 返回空数组表示该节点当前无可用图片输出。
 */
export function nodeOutputImages(node: GraphNode | undefined): string[] {
  if (!node || !node.data) return [];
  const url = node.data.imageUrl;
  return typeof url === 'string' && url ? [url] : [];
}


