import type { NodeRunSettings } from '../../platform/types';
import {
  bookMetadataText,
  findConnectedBookInfoUpstream,
  findRootBookInfo,
  matchPortType,
  nodeOutputText,
  resolveDirectParents,
} from './nodeTypes';
import { isTextOutputNode } from './textTemplate';
import type { PortTypesLookup } from './nodeTypes';
import type { EdgeData, NodeData } from './graphTypes';

// 端口类型查找类型定义在基础模块 nodeTypes.ts（textTemplate 等不依赖 execution 的模块也引用），
// 此处再导出以保持既有调用方的 import 路径不变
export type { PortTypesLookup } from './nodeTypes';

/** 可执行节点的运行设置默认值（破坏性更新：默认手动运行、不注入图书元数据） */
export const DEFAULT_RUN_SETTINGS: NodeRunSettings = { includeBook: false, autoRun: false };

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
 * - 图书元数据：直接连线的 book_info 优先；未直接连线时按「包含图书元数据」开关注入——
 *   沿连线向上追溯实际连通的 book_info，无连通时才回退画布根节点；
 * - 各类型输出经 nodeOutputText 按类型提取并合并（支持多个同类上级）。
 */
export interface RunInputs {
  /** 直接上级节点列表 */
  parents: NodeData[];
  /** 图书元数据节点（直接 book_info；或 includeBook 时优先连线上游、无连通才回退根节点） */
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
  edges: EdgeData[],
  portTypesOf: PortTypesLookup
): RunInputs {
  const parents = resolveDirectParents(node.id, nodes, edges);
  const settings: NodeRunSettings = node.data?.settings ?? DEFAULT_RUN_SETTINGS;
  // 图书元数据：直接连线的 book_info 优先；未直接连线时按「包含图书元数据」开关注入——
  // 先沿连线向上追溯实际连通的 book_info（画布可存在多个互不连通的图书元数据节点，
  // 不能写死取根节点），无连通者才回退画布根节点
  const book =
    parents.find((p) => p.type === 'book_info') ??
    (settings.includeBook
      ? findConnectedBookInfoUpstream(node.id, nodes, edges) ?? findRootBookInfo(nodes, edges)
      : undefined);
  const metadataText = bookMetadataText(book?.data);
  const analysisValues = parents
    .filter((p) => p.type === 'image_analysis')
    .map((p) => nodeOutputText(p));
  // 文本上下文来源：按端口类型声明推导（output ∈ text/any）——文本 / AI 对话 / 文本聚合 /
  // 以及后续新增的任何文本输出节点，无需在此逐个枚举；排除已单独分桶的
  // 图书元数据（book）、图片分析（analysis）、提示词生成（prompt）。
  const textValues = parents
    .filter(
      (p) =>
        isTextOutputNode(p, portTypesOf) &&
        p.type !== 'book_info' &&
        p.type !== 'image_analysis' &&
        p.type !== 'prompt_generation'
    )
    .map((p) => nodeOutputText(p));
  const promptNodes = parents.filter((p) => p.type === 'prompt_generation');
  const promptValues = promptNodes.map((p) => nodeOutputText(p));
  const analysis = markdownSections([{ label: '图片分析', values: analysisValues }]);
  const text = markdownSections([{ label: '文本上下文', values: textValues }]);
  const prompt = markdownSections([{ label: '提示词', values: promptValues }]);
  const uploadNode = parents.find((p) => p.type === 'image_upload');
  const refImage =
    typeof uploadNode?.data?.imageUrl === 'string' ? uploadNode.data.imageUrl : undefined;
  const promptSource = promptValues.some((v) => v.trim()) ? promptValues : [metadataText];
  const imagePrompt = markdownSections([
    { label: '提示词', values: promptSource },
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
