import type { CanvasNodeType, ChatMessage } from '../../platform/types';
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
  generationIds: Record<string, number>;
}

/** 连线锚点默认尺寸（ResizeObserver 上报前使用），与各组件 defaultSize 保持一致 */
export const DEFAULT_SIZES: Record<NodeType, NodeSize> = NODE_SIZES;

/** 进行中的豆瓣查询节点 id，防止快速连点/重试时并发响应互相覆盖 */
export const bookInfoInflight = new Set<string>();

/** 发送给后端的消息历史：把首条 user 消息上隐藏的 context 元数据展开到 content（UI 展示保持精简）。
 *  上下文由此随每轮完整历史重发（LLM 模式），模型在多轮中始终可见，不会在第二轮丢失。 */
export const toWireChatMessages = (msgs: ChatMessage[]): ChatMessage[] =>
  msgs.map((m) =>
    m.context ? { ...m, content: `${m.context}\n\n${m.content}`, context: undefined } : m
  );
