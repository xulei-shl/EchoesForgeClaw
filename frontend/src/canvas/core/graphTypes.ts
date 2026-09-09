import type { CanvasNodeType, ChatMessage } from '../../shared/types';
import { NODE_SIZES } from './nodeLayout';

/** 节点类型别名（bookplate 模块） */
export type NodeType = CanvasNodeType;

export interface NodeData {
  id: string;
  type: NodeType;
  /** 绑定的节点配置 id（节点变体）；未绑定则使用默认配置（环境变量） */
  configId?: number;
  /** 节点变体名称（标题展示用） */
  configName?: string;
  x: number;
  y: number;
  data: any;
}

export interface EdgeData {
  id: string;
  source: string;
  target: string;
}

/** 画布分组（软分组）：不承载节点实体，仅按 memberIds 聚合的视觉/操作单元。
 *  组边界由成员位置+尺寸实时推导，移动、解散均不影响节点与连线数据。 */
export interface CanvasGroup {
  id: string;
  name: string;
  /** 分组主题色（hex，低饱和纸感色系，见 canvasGroups.GROUP_COLORS），以高透明度渲染 */
  color: string;
  memberIds: string[];
}

export interface NodeSize {
  width: number;
  height: number;
}

/** 撤销/重做历史栈深度上限 */
export const HISTORY_LIMIT = 50;

/** 撤销/重做快照：结构/内容/位置（节点数据含坐标）。
 *  不含视口、节点尺寸与收藏/公开等服务端状态（避免与服务端 API 状态打架）。 */
export interface HistorySnapshot {
  nodes: NodeData[];
  edges: EdgeData[];
  groups: CanvasGroup[];
  generationIds: Record<string, number>;
}

/** 连线锚点默认尺寸（ResizeObserver 上报前使用），与各组件 defaultSize 保持一致 */
export const DEFAULT_SIZES: Record<NodeType, NodeSize> = NODE_SIZES;

/** 进行中的豆瓣查询节点 id，防止快速连点/重试时并发响应互相覆盖 */
export const bookInfoInflight = new Set<string>();

/**
 * 自愈一个「标记生成中但无活动流」的节点，避免其永久停留在加载态（挂载自愈与撤销自愈共用）。
 * @param hasActiveStream 该节点是否仍存在进行中的流：撤销自愈传 streamControllers 判断；
 *                        挂载恢复时传 false——本次挂载不可能有活动流
 */
export function selfHealNode(
  node: NodeData,
  hasActiveStream: boolean
): NodeData {
  if (!node.data?.isGenerating || hasActiveStream) return node;
  return {
    ...node,
    data: {
      ...node.data,
      isGenerating: false,
      error: node.data.error ?? '生成已中断，请重试',
    },
  };
}

/** 发送给后端的消息历史：把首条 user 消息上隐藏的 context 元数据展开到 content（UI 展示保持精简）。
 *  上下文由此随每轮完整历史重发（LLM 模式），模型在多轮中始终可见，不会在第二轮丢失。
 *  隐藏的 contextImages 上下文图片并入 images 字段，同样随历史重发。 */
export const toWireChatMessages = (msgs: ChatMessage[]): ChatMessage[] =>
  msgs.map((m) => {
    // 思考过程（reasoning）仅用于 UI 展示：剥离后不随多轮历史回传
    // （省 token，且避免把上一轮的内部思考重新喂给模型/端点）
    const clean: ChatMessage = m.reasoning ? { ...m, reasoning: undefined } : m;
    const expanded = clean.context
      ? { ...clean, content: `${clean.context}\n\n${clean.content}`, context: undefined }
      : clean;
    if (!expanded.contextImages?.length) {
      return expanded.contextImages ? { ...expanded, contextImages: undefined } : expanded;
    }
    return {
      ...expanded,
      images: [...expanded.contextImages, ...(expanded.images ?? [])],
      contextImages: undefined,
    };
  });
