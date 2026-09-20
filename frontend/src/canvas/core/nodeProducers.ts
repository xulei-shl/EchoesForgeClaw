/**
 * 节点「产物生成」注册表（供画板助手触发渲染类节点出图）
 *
 * 动机：`receipt_printer` / `book_card` / `watercolor_brush` / `map_poster` 等 16 个节点
 * 的产物必须在组件内部渲染（html2canvas / WebGL / 离屏模板 → dataUrl）后写回
 * `node.data.imageUrl`，渲染依赖组件内的 DOM 引用、离屏容器与本地编辑态——画布层无法代劳，
 * 这就是「Agent 建好节点、配好预设、连好上游，却始终没有图」的根因。
 *
 * 方案：组件在挂载时把自家「生成」入口（写 `data.imageUrl` 的那个函数，如
 * `handleGenerate` / `handleExecuteCrop` / `handleRemoveBg` / `handleGenerateAndSave`）
 * 注册进来；Agent 侧 `canvas_run_node` 经 `canvasCommands.runNodeById` 调用，调用后由
 * 调用方核对 `data.imageUrl` 是否真的产出来判断成败（**不伪造产物**）。
 *
 * 约定：
 * - 注册的是「生成产物」而非「保存到数据库」（`handleSaveToDatabase` 只影响历史记录/收藏，
 *   对下游取图没有意义）；
 * - 卸载即注销；查不到注册项时调用方必须明确报错（节点未挂载 / 该类型不支持），
 *   不得降级去猜或直接写 `imageUrl`（写入 denylist 是有意的防伪造设计）。
 */
import { useEffect, useRef } from 'react';

export type NodeProducer = () => Promise<void> | void;

const producers = new Map<string, NodeProducer>();

/** 组件挂载时注册本节点的生成入口 */
export function registerNodeProducer(id: string, produce: NodeProducer): void {
  producers.set(id, produce);
}

/** 组件卸载时注销（避免注册表残留已销毁组件的闭包） */
export function unregisterNodeProducer(id: string): void {
  producers.delete(id);
}

/** 取该节点的生成入口；未注册（组件未挂载 / 该类型无产物）返回 undefined */
export function getNodeProducer(id: string): NodeProducer | undefined {
  return producers.get(id);
}

/**
 * 在节点组件内注册生成入口（始终调用最新闭包，避免每次渲染重复注册）。
 * `produce` 应为该组件内「生成产物并写回 data.imageUrl」的那个函数。
 */
export function useNodeProducer(id: string, produce: NodeProducer): void {
  const latest = useRef(produce);
  latest.current = produce;
  useEffect(() => {
    registerNodeProducer(id, () => latest.current());
    return () => unregisterNodeProducer(id);
  }, [id]);
}

/* ===================================================================== */
/* 候选类节点（检索结果 "选中一个"）能力                                   */
/* ===================================================================== */

/** 候选条目（`index` 即 `select(index)` 的入参，与画布上候选网格的顺序一致） */
export interface NodeCandidate {
  index: number;
  title: string;
  subtitle?: string;
}

/**
 * 候选类节点（`image_search` / `art_image_search` / `pattern_search` / `color_search`）
 * 的内部能力。
 *
 * 动机：这四类节点的检索结果（候选图 / 纹样 / 颜色）只存在组件本地 state（如
 * `providerCache` / `items`），`node.data` 里只有「已选中的那一个」——Agent 因此既看不到
 * 候选、也无法触发选中，链路走到这一步就断了（下游拿不到图）。故由组件把自己手上的候选
 * 清单与选中入口注册出来，`canvas_run_node` 经此列出候选（供 Agent 判断），并用
 * `select_index` 调用 `select` 落盘产物。
 */
export interface NodeCandidateOps {
  /** 当前候选清单（已按界面展示顺序；索引稳定对应 `select(index)`） */
  list: () => NodeCandidate[];
  /**
   * 候选可用但「不完整」时的提示（如 GLAM 聚合部分博物馆失败）：
   * 由调用方原样回传给 Agent，不阻断运行（候选仍可取用）。未提供＝没有这类提示。
   */
  warnings?: () => string[];
  /** 确保候选已加载：无候选时按当前关键词触发一次检索（已有候选则立即返回） */
  ensure: () => Promise<void>;
  /** 选中第 index 个候选并落盘为产物；返回空串＝已选中，非空字符串＝未选中/失败原因 */
  select: (index: number) => Promise<string>;
}

const candidateOps = new Map<string, NodeCandidateOps>();

/** 组件挂载时注册本节点的候选清单与选中入口 */
export function registerNodeCandidateOps(id: string, ops: NodeCandidateOps): void {
  candidateOps.set(id, ops);
}

/** 组件卸载时注销 */
export function unregisterNodeCandidateOps(id: string): void {
  candidateOps.delete(id);
}

/** 取该节点的候选能力；未注册（非候选类节点 / 组件未挂载）返回 undefined */
export function getNodeCandidateOps(id: string): NodeCandidateOps | undefined {
  return candidateOps.get(id);
}

/** 在候选类节点组件内注册候选清单与选中入口（始终调用最新闭包） */
export function useNodeCandidateOps(id: string, ops: NodeCandidateOps): void {
  const latest = useRef(ops);
  latest.current = ops;
  useEffect(() => {
    registerNodeCandidateOps(id, {
      list: () => latest.current.list(),
      ensure: () => latest.current.ensure(),
      select: (index: number) => latest.current.select(index),
      warnings: () => latest.current.warnings?.() ?? [],
    });
    return () => unregisterNodeCandidateOps(id);
  }, [id]);
}
