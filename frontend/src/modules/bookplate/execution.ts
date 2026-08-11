import type { CanvasNodeType, NodePortType, NodeRunSettings } from '../../platform/types';
import {
  bookMetadataText,
  findRootBookInfo,
  matchPortType,
  nodeOutputText,
  resolveDirectParents,
} from './nodeTypes';
import type { EdgeData, NodeData } from './graphTypes';

/** 端口类型查找（由画布提供：后端模板声明优先，前端静态镜像兜底） */
export type PortTypesLookup = (
  type: CanvasNodeType
) => { output: NodePortType; inputs: NodePortType[] };

/** 可执行节点的运行设置默认值（破坏性更新：默认手动运行、不注入图书元数据） */
export const DEFAULT_RUN_SETTINGS: NodeRunSettings = { includeBook: false, autoRun: false };

/**
 * 节点运行输入（执行引擎 runNode 与自动运行检查共用）：
 * - 输入 = 所有直接连线的上级节点输出（画线连上即输入，1 级，不向上追溯）；
 * - 图书元数据：直接连线的 book_info 优先；未连线时按「包含图书元数据」开关注入画布根节点；
 * - 各类型输出经 nodeOutputText 按类型提取并合并（支持多个同类上级）。
 */
export interface RunInputs {
  /** 直接上级节点列表 */
  parents: NodeData[];
  /** 图书元数据节点（直接 book_info 或 includeBook 注入的根节点） */
  book?: NodeData;
  /** 图书元数据文本（过滤图片字段） */
  metadataText: string;
  /** 分析文本（image_analysis 直接上级合并） */
  analysis: string;
  /** 文本上下文（text / chat 直接上级合并） */
  text: string;
  /** 提示词（prompt_generation 直接上级合并） */
  prompt: string;
  /** 提示词来源节点列表 */
  promptNodes: NodeData[];
  /** 显式连接的「图片上传」节点 */
  uploadNode?: NodeData;
  /** 参考图 data URL（图片上传节点已上传时） */
  refImage?: string;
  /** 图像生成最终提示词：提示词节点优先，无则回退图书元数据；文本/AI对话直接上级并入上下文 */
  imagePrompt: string;
}

export function resolveNodeRunInputs(
  node: NodeData,
  nodes: NodeData[],
  edges: EdgeData[]
): RunInputs {
  const parents = resolveDirectParents(node.id, nodes, edges);
  const settings: NodeRunSettings = node.data?.settings ?? DEFAULT_RUN_SETTINGS;
  // 图书元数据：直接连线的 book_info 优先；未连线时按「包含图书元数据」开关注入画布根节点
  const book =
    parents.find((p) => p.type === 'book_info') ??
    (settings.includeBook ? findRootBookInfo(nodes, edges) : undefined);
  const metadataText = bookMetadataText(book?.data);
  const analysis = parents
    .filter((p) => p.type === 'image_analysis')
    .map((p) => nodeOutputText(p))
    .filter((t) => t.trim())
    .join('\n\n');
  const text = parents
    .filter((p) => p.type === 'text' || p.type === 'chat')
    .map((p) => nodeOutputText(p))
    .filter((t) => t.trim())
    .join('\n\n');
  const promptNodes = parents.filter((p) => p.type === 'prompt_generation');
  const prompt = promptNodes
    .map((p) => nodeOutputText(p))
    .filter((t) => t.trim())
    .join('\n\n');
  const uploadNode = parents.find((p) => p.type === 'image_upload');
  const refImage =
    typeof uploadNode?.data?.imageUrl === 'string' ? uploadNode.data.imageUrl : undefined;
  const imagePrompt = [prompt || metadataText, text].filter((t) => t.trim()).join('\n\n');
  return {
    parents,
    book,
    metadataText,
    analysis,
    text,
    prompt,
    promptNodes,
    uploadNode,
    refImage,
    imagePrompt,
  };
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
    const m = matchPortType(portTypes(p.type).output, portTypes(node.type).inputs);
    return m === 'mismatch';
  });
}

/** 把不匹配上级并入待运行原因，给用户明确提示（如「连线「图片上传」类型不匹配」） */
export function withMismatchHint(base: string, mismatch: NodeData[]): string {
  if (mismatch.length === 0) return base;
  const names = mismatch.map((p) => p.configName ?? p.type).join('、');
  return `${base}（连线「${names}」类型不匹配，已标红）`;
}
