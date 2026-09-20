/**
 * 模块级画布命令层（供画板助手工具执行器使用）
 *
 * 动机：Mascot Agent（画板助手）的工具执行器 `canvasExecutor.ts` 挂载在 App 级
 * `MascotWidget` 中，生命周期与画布页（`CanvasPage`）解耦；写操作若直接调用模块级
 * `setNodes` / `setEdges`，会绕开画布自己的 `recordHistory` —— Agent 建的节点/连线
 * 撤销不了，且与 UI 交互路径口径不一致（同一操作两条路径两种可撤销性）。
 *
 * 因此把「需要画布内撤销历史与关联清理」的写操作收敛为命令注册表：
 * - `CanvasPage` 挂载时注入实现（复用 `recordHistory` / `updateNodeData` / 节点删除 /
 *   连线删除），卸载时传 `null` 清空；
 * - 执行器拿不到命令层时**明确报错**，绝不降级直改 store（否则会产生不可撤销的变更）。
 *
 * 另含一项「运行节点」命令（`runNodeById`）：节点的运行入口分散在画布页的各个
 * handler（AI 三类走 `runNode`，检索/工具类走各自的 fetch handler，渲染类节点走
 * 组件自己注册的生成入口 —— 见 `nodeProducers.ts`），只有画布页能拿到这些闭包，
 * 故同样由画布页注入。它不是写操作、不记撤销历史。
 */
import type { NodeCandidate } from './nodeProducers';

/**
 * 运行节点的结果：用可识别联合编码三种情况，避免用 `started + 可选字段` 拼出一个每个调用方
 * 都要猜形状的对象。
 * - `ran`：已发起/完成一次真正的运行（产物由节点自身产生或渲染）；`warnings` 为运行成功但
 *   需要被告知的提示（如聚合检索部分来源失败），通常为空数组。
 * - `candidates`：候选类节点已备好候选清单，**等调用方用 `select_index` 选定一个**；
 *   `warnings` 为「候选可用但不完整」的提示（如聚合检索部分来源失败），须原样回传。
 * - `not_started`：未运行，`reason` 必须原样回传给 Agent（不得静默）。
 */
export type CanvasRunOutcome =
  | { kind: 'ran'; warnings: string[] }
  | { kind: 'candidates'; candidates: NodeCandidate[]; warnings: string[] }
  | { kind: 'not_started'; reason: string };

export interface CanvasRemoveNodeOptions {
  /** 是否级联删除其全部下游子孙节点（默认 true，与画布 UI 一致） */
  cascade?: boolean;
  /** 确认已在调用方（如扩展侧 ctx.ui.confirm）完成：true 时前端不再弹自家确认框，避免双重弹窗 */
  confirmed?: boolean;
}

export interface CanvasRemoveNodeResult {
  /** 实际被删除的节点 id（含级联子孙；节点不存在时为空数组） */
  deletedIds: string[];
  /** 随删除一并移除的连线 id */
  deletedEdges: string[];
}

export interface CanvasCommands {
  /** 记录一步撤销历史（在任何结构性/内容/位置变更前调用） */
  recordHistory: () => void;
  /** 更新节点 data（浅合并 patch，不记历史，由调用方负责） */
  updateNodeData: (id: string, patch: Record<string, any>) => void;
  /** 删除节点（含级联、进行中流中止与尺寸/收藏/公开/generation 关联清理） */
  removeNode: (id: string, opts?: CanvasRemoveNodeOptions) => Promise<CanvasRemoveNodeResult>;
  /** 删除一条连线（记历史）；返回该连线是否存在并被删除 */
  removeEdge: (edgeId: string) => boolean;
  /**
   * 运行一个节点（与画布 UI 手点「运行 / 检索 / 生成 / 选中」同口径）。
   * - 渲染类节点（16 个产物节点）的生成是异步的，故本方法为 async（见 nodeProducers.ts）；
   * - 候选类节点（检索结果类）：不传 `selectIndex` 时回 `candidates`（清单供 Agent 判断），
   *   传 `selectIndex` 时选中该候选并落盘为产物；
   * - 未发起时回 `not_started` 与原因，调用方必须原样回传，不得静默。
   */
  runNodeById: (id: string, selectIndex?: number) => Promise<CanvasRunOutcome>;
}

let commands: CanvasCommands | null = null;

/** 画布页挂载时注入实现，卸载时传 null 清空 */
export function registerCanvasCommands(cmds: CanvasCommands | null): void {
  commands = cmds;
}

/**
 * 取当前画布命令层；画布页未挂载时为 null。
 * 调用方必须据此返回明确错误，不得降级直改 store。
 */
export function getCanvasCommands(): CanvasCommands | null {
  return commands;
}
