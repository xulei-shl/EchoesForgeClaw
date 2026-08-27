import type { NodePortType, NodeRunSettings } from '../../platform/types';
import {
  TEXT_ROLE,
  bookMetadataText,
  findConnectedBookInfoUpstream,
  findRootBookInfo,
  matchPortType,
  nodeOutputImages,
  nodeOutputText,
  resolveDirectParents,
} from './nodeTypes';
import type { PortTypesLookup } from './nodeTypes';
import type { EdgeData, NodeData } from './graphTypes';

// 端口类型查找类型定义在基础模块 nodeTypes.ts（textTemplate 等不依赖 execution 的模块也引用），
// 此处再导出以保持既有调用方的 import 路径不变
export type { PortTypesLookup } from './nodeTypes';

/** 可执行节点的运行设置默认值（破坏性更新：默认手动运行、不注入图书元数据） */
export const DEFAULT_RUN_SETTINGS: NodeRunSettings = { includeBook: false };

/**
 * 用 Markdown 结构拼接输入：每类来源用 `## 标题` 标注，块间用 `---` 分隔线隔离。
 * 单块不加标题，纯文本直接返回，避免冗余。
 */
function markdownSections(sections: { label: string; values: string[] }[]): string {
  return sections
    .map(({ label, values }) => {
      const blocks = values.filter((v) => v.trim());
      if (blocks.length === 0) return '';
      if (blocks.length === 1) return `## ${label}\n\n${blocks[0]}`;
      return `## ${label}\n\n${blocks.join('\n\n---\n\n')}`;
    })
    .filter((s) => s.trim())
    .join('\n\n---\n\n');
}

/**
 * 节点运行输入（执行引擎 runNode 与自动运行检查共用）：
 * - 输入 = 所有直接连线的上级节点输出（画线连上即输入，1 级，不向上追溯）；
 * - 图书元数据：受「包含图书元数据」开关注入（关闭即不注入图书内容，直接连线同样受控）；
 *   开启时直接连线的 book_info 优先，未直接连线时沿连线向上追溯实际连通的 book_info，
 *   无连通时才回退画布根节点；
 * - 文本/图片等上级按「输出端口类型」统一分组（collectNodeInputs），文本再按角色配置表
 *   （TEXT_ROLE）分桶：prompt（主提示词）/ analysis（分析）/ 普通文本上下文。
 */
export interface RunInputs {
  /** 直接上级节点列表 */
  parents: NodeData[];
  /** 图书元数据节点（includeBook 关闭时为 undefined；开启时直接 book_info 优先，无则连线上游，再兜底画布根节点） */
  book?: NodeData;
  /** 图书元数据文本（过滤图片字段） */
  metadataText: string;
  /** 分析文本（TEXT_ROLE 中 role=analysis 的上级，如图片分析）合并 */
  analysis: string;
  /** 文本上下文（TEXT_ROLE 未配置角色的文本输出上级，如文本 / AI 对话）合并 */
  text: string;
  /** 提示词（TEXT_ROLE 中 role=prompt 的上级，如提示词生成）合并 */
  prompt: string;
  /** 主提示词来源节点列表 */
  promptNodes: NodeData[];
  /** 图片输出上级（output 端口类型为 image，含图片上传 / 图像生成…） */
  imageNodes: NodeData[];
  /** 参考图（图片上传节点 data URL；图像生成上级节点的本地图片路径，见 resolveReferenceImage） */
  refImage?: string;
  /** 图像生成最终提示词：提示词节点优先，无则回退图书元数据；图片分析/文本/AI对话直接上级并入上下文 */
  imagePrompt: string;
}

export function resolveNodeRunInputs(
  node: NodeData,
  nodes: NodeData[],
  edges: EdgeData[],
  portTypesOf: PortTypesLookup
): RunInputs {
  const { parents, images, text: textOutputParents } = collectNodeInputs(
    node,
    nodes,
    edges,
    portTypesOf
  );
  const settings: NodeRunSettings = node.data?.settings ?? DEFAULT_RUN_SETTINGS;
  // 图书元数据：受「包含图书元数据」开关注入（直接连线同样受控——关闭即完全不注入图书内容）。
  // 开启时直接连线的 book_info 优先；未直接连线时沿连线向上追溯实际连通的 book_info
  // （画布可存在多个互不连通的图书元数据节点，不能写死取根节点），无连通者才回退画布根节点。
  // 注：历史记录（useGenerationHistory / useImageOutputHandlers）无条件记录图书元数据，不受此开关影响。
  const book = settings.includeBook
    ? parents.find((p) => p.type === 'book_info') ??
      findConnectedBookInfoUpstream(node.id, nodes, edges) ??
      findRootBookInfo(nodes, edges)
    : undefined;
  const metadataText = bookMetadataText(book?.data);
  // 文本输出上级按角色配置表（TEXT_ROLE）分桶：book 走图书元数据通道（不并入文本上下文）；
  // prompt = 主提示词来源；analysis = 图片分析；其余文本输出节点（含后续新增类型）默认
  // 并入「文本上下文」——无需逐个枚举节点类型。
  const textOutputs = textOutputParents.filter((p) => TEXT_ROLE[p.type] !== 'book');
  const promptNodes = textOutputs.filter((p) => TEXT_ROLE[p.type] === 'prompt');
  const analysisNodes = textOutputs.filter((p) => TEXT_ROLE[p.type] === 'analysis');
  const plainTextNodes = textOutputs.filter((p) => !TEXT_ROLE[p.type]);
  const promptValues = promptNodes.map((p) => nodeOutputText(p));
  const analysisValues = analysisNodes.map((p) => nodeOutputText(p));
  const textValues = plainTextNodes.map((p) => nodeOutputText(p));
  const analysis = markdownSections([{ label: '图片分析', values: analysisValues }]);
  // 通用文本上下文：包含 promptNodes（如上游提示词生成/AI文本生成节点）与普通文本上级（text / chat / text_aggregate / 检索工具等）
  const text = markdownSections([
    { label: '提示词', values: promptValues },
    { label: '文本上下文', values: textValues },
  ]);
  const prompt = markdownSections([{ label: '提示词', values: promptValues }]);
  // 参考图：图片输出上级（图片上传 / 图像生成…，按端口类型推导，后续新增图片输出节点自动生效）。
  // data URL（图片上传）优先，其次本地路径。
  const refImage = resolveReferenceImage(images);
  // 图像生成提示词 = 提示词（无则回退图书元数据）+ 图片分析 + 文本上下文。
  // 与 AI 对话节点同口径（所见即所得）：除图书元数据走 includeBook 穿透外，
  // 任何直连上级的文本输出都并入上下文。
  const promptSource = promptValues.some((v) => v.trim()) ? promptValues : [metadataText];
  const imagePrompt = markdownSections([
    { label: '提示词', values: promptSource },
    { label: '图片分析', values: analysisValues },
    { label: '文本上下文', values: textValues },
  ]);
  return {
    parents,
    book,
    metadataText,
    analysis,
    text,
    prompt,
    promptNodes,
    imageNodes: images,
    refImage,
    imagePrompt,
  };
}

/**
 * 统一输入收集器（所有节点的「谁是我的输入」的唯一入口）：
 * 把直接上级按「输出端口类型」分组（画线连上即输入，1 级，不向上追溯）。
 * 端口声明来自后端 node_types.py（唯一权威，经 node-registry 下发）+ 前端 NODE_PORT_TYPES 兜底，
 * 因此新增节点类型 / 新增输出类型（音频、视频…）时**无需改动此处**——
 * 只要模板声明了 output_type，该节点就会自动落入对应分组供下游消费。
 */
export interface CollectedInputs {
  /** 全部直接上级节点 */
  parents: NodeData[];
  /** 按输出端口类型分组的直接上级（key 为端口类型声明，含 any；未来 audio/video 等自动落入） */
  byPortType: Partial<Record<NodePortType, NodeData[]>>;
  /** 文本输出上级（output ∈ text/any，含图书元数据等） */
  text: NodeData[];
  /** 图片输出上级（output === image） */
  images: NodeData[];
  /** 文档输出上级（output === document） */
  documents: NodeData[];
}

export function collectNodeInputs(
  node: NodeData,
  nodes: NodeData[],
  edges: EdgeData[],
  portTypesOf: PortTypesLookup
): CollectedInputs {
  const parents = resolveDirectParents(node.id, nodes, edges);
  const byPortType: Partial<Record<NodePortType, NodeData[]>> = {};
  for (const p of parents) {
    // 复合输出节点（如纹样节点同时输出图片与文本）按声明的每个类型分别入桶
    for (const out of portTypesOf(p.type).outputs) {
      (byPortType[out] ??= []).push(p);
    }
  }
  /**
   * 文本/图片输出直接上级：按「声明的全部输出类型」推导（outputs 含 text/any 或 image/any）。
   * 复合节点（如纹样）对文本与图片消费者都算上级；但节点尚未产出实际输出时
   * （如纹样未选中，imageUrl 与 output 均为空）不参与，避免给下游注入空内容。
   */
  const textParents = parents.filter((p) => {
    const outs = portTypesOf(p.type).outputs;
    return (
      (outs.includes('text') || outs.includes('any')) &&
      !(p.type === 'pattern_search' && !nodeOutputText(p)) &&
      !(p.type === 'color_search' && !nodeOutputText(p))
    );
  });
  const imageParents = parents.filter((p) => {
    const outs = portTypesOf(p.type).outputs;
    return (
      (outs.includes('image') || outs.includes('any')) &&
      !(p.type === 'pattern_search' && nodeOutputImages(p).length === 0) &&
      !(p.type === 'color_search' && nodeOutputImages(p).length === 0)
    );
  });

  return {
    parents,
    byPortType,
    text: textParents,
    images: imageParents,
    documents: byPortType.document ?? [],
  };
}

/**
 * 取「第一个有内容的线上级文本」作为输入（连线即输入：优先于手动输入）。
 * 按端口类型推导文本输出上级，任一非空返回原值；无则返回空串。
 * 天气 / 知乎 / Wikipedia / 翻译 / 网络搜索 / 图片检索等节点共用（消除各处重复表达式）。
 */
export function firstUpstreamText(
  node: NodeData,
  nodes: NodeData[],
  edges: EdgeData[],
  portTypesOf: PortTypesLookup
): string {
  return (
    collectNodeInputs(node, nodes, edges, portTypesOf)
      .text.map((p) => nodeOutputText(p))
      .find((v) => v.trim()) ?? ''
  );
}

/**
 * 取「能解析为 JSON 补充字段」的线上级文本（命中即用，多上级逐个尝试）。
 * 用于图书卡片 / 图书小票等消费「字段 JSON」的节点：若同一节点还连线了图书元数据
 * （其文本输出是整段 key: value 元数据而非 JSON），需优先取 VuFind 馆藏等
 * 输出 `{"CALL_NUMBER": "..."}` 的专门节点，而非一刀切取第一个上级。
 * 无命中 JSON 时回退 firstUpstreamText（兼容普通文本上级）。
 */
export function firstExtraJsonUpstreamText(
  node: NodeData,
  nodes: NodeData[],
  edges: EdgeData[],
  portTypesOf: PortTypesLookup
): string {
  const texts = collectNodeInputs(node, nodes, edges, portTypesOf)
    .text.map((p) => nodeOutputText(p))
    .filter((v) => v.trim());
  for (const t of texts) {
    const trimmed = t.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return trimmed;
    } catch {
      // 非 JSON 文本，跳过继续
    }
  }
  return texts[0] ?? '';
}

/**
 * 参考图来源解析（图生图）：从「图片输出上级」分组中取第一张可用图片作为参考图。
 * data URL（图片上传）优先——无需转换即可直接使用；本地路径（如 /static/generated）
 * 其次，发起请求前由调用方转 data URL。返回空 = 无可用参考图。
 */
export function resolveReferenceImage(imageNodes: NodeData[]): string | undefined {
  for (const p of imageNodes) {
    const img = nodeOutputImages(p)[0];
    if (typeof img === 'string' && img.startsWith('data:')) return img;
  }
  for (const p of imageNodes) {
    const img = nodeOutputImages(p)[0];
    if (typeof img === 'string' && img) return img;
  }
  return undefined;
}

/**
 * 收集与该节点端口类型不匹配的直接上级节点（软提示用：红色连线 + 节点徽标 + 运行提示）。
 * 类型未知（如注册表未加载）不判为不匹配。
 */
export function collectMismatchParents(
  node: NodeData,
  nodes: NodeData[],
  edges: EdgeData[],
  portTypes: PortTypesLookup
): NodeData[] {
  return resolveDirectParents(node.id, nodes, edges).filter((p) => {
    const m = matchPortType(portTypes(p.type).outputs, portTypes(node.type).inputs);
    return m === 'mismatch';
  });
}

/** 把不匹配上级并入待运行原因，给用户明确提示（如「连线「图片上传」类型不匹配」） */
export function withMismatchHint(base: string, mismatch: NodeData[]): string {
  if (mismatch.length === 0) return base;
  const names = mismatch.map((p) => p.configName ?? p.type).join('、');
  return `${base}（连线「${names}」类型不匹配，已标红）`;
}
