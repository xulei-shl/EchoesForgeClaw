/**
 * Bookplate 模块节点布局工具
 *
 * 集中管理各节点模板类型的默认尺寸和坐标计算，
 * 确保与各节点组件的 defaultSize 保持一致。
 */

export type NodeType =
  | 'book_info'
  | 'image_analysis'
  | 'prompt_generation'
  | 'image_generation'
  | 'text'
  | 'image_upload'
  | 'chat'
  | 'text_aggregate'
  | 'prompt_search'
  | 'skill_search'
  | 'calendar'
  | 'weather'
  | 'map_poster';

/** 各节点模板类型的默认尺寸（必须与组件 defaultSize 一致） */
export const NODE_SIZES: Record<NodeType, { width: number; height: number }> = {
  book_info:        { width: 440, height: 540 },
  image_analysis:   { width: 420, height: 460 },
  prompt_generation:{ width: 420, height: 500 },
  image_generation: { width: 420, height: 540 },
  text:             { width: 420, height: 400 },
  image_upload:     { width: 420, height: 420 },
  chat:             { width: 420, height: 560 },
  text_aggregate:   { width: 460, height: 520 },
  prompt_search:    { width: 420, height: 440 },
  skill_search:     { width: 440, height: 460 },
  calendar:         { width: 420, height: 480 },
  weather:          { width: 420, height: 460 },
  map_poster:       { width: 460, height: 560 },
};

/** 节点间水平间距（px） */
const NODE_GAP = 80;

/** 分支兄弟节点间的垂直间距（px） */
const NODE_V_GAP = 48;

/** 计算 BookInfo 节点的初始位置 */
export function getBookInfoPosition(): { x: number; y: number } {
  return {
    x: 100,
    y: window.innerHeight * 0.4 - 260,
  };
}

/**
 * 计算下一阶段节点的位置（与前序节点顶边对齐，水平右移）
 *
 * @param sourceX      前序节点的 X 坐标
 * @param sourceY      前序节点的 Y 坐标
 * @param sourceNodeId 前序节点 id，用于查询实际尺寸
 * @param actualSizes  ResizeObserver 上报的实际节点尺寸映射
 * @param sourceType   前序节点类型，用于回退到默认尺寸
 */
export function getNextNodePosition(
  sourceX: number,
  sourceY: number,
  sourceNodeId: string,
  actualSizes: Record<string, { width: number; height: number }>,
  sourceType: NodeType,
  targetType: NodeType,
): { x: number; y: number } {
  const sourceSize = actualSizes[sourceNodeId] ?? NODE_SIZES[sourceType];
  const targetHeight = NODE_SIZES[targetType].height;

  // 计算垂直居中对齐时的 Y 坐标
  const newY = sourceY + (sourceSize.height - targetHeight) / 2;

  return {
    x: sourceX + sourceSize.width + NODE_GAP,
    y: newY,
  };
}

interface BranchNodeAnchor {
  x: number;
  y: number;
  id: string;
  type: NodeType;
}

/**
 * 计算分支节点的位置（兄弟级联布局）：
 *
 * - 无同级兄弟：与锚点（父）节点垂直居中，水平右移（与 getNextNodePosition 一致，
 *   遵循 lessons.md #2「垂直居中对齐」）。
 * - 有同级兄弟：x 固定对齐锚点列，y 级联在「最低兄弟」下方，避免重叠，
 *   且尊重用户手动拖动后的布局（以兄弟实际位置为基准）。
 *
 * 尺寸一律读取 actualSizes 实际上报值，缺失时回退默认尺寸（lessons.md #3：数学坐标为准）。
 */
export function getBranchNodePosition(
  anchor: BranchNodeAnchor,
  siblings: BranchNodeAnchor[],
  actualSizes: Record<string, { width: number; height: number }>,
  targetType: NodeType,
): { x: number; y: number } {
  const anchorSize = actualSizes[anchor.id] ?? NODE_SIZES[anchor.type];
  const targetHeight = NODE_SIZES[targetType].height;
  const columnX = anchor.x + anchorSize.width + NODE_GAP;

  if (siblings.length === 0) {
    return {
      x: columnX,
      y: anchor.y + (anchorSize.height - targetHeight) / 2,
    };
  }

  const bottom = (s: BranchNodeAnchor) => {
    const size = actualSizes[s.id] ?? NODE_SIZES[s.type];
    return s.y + size.height;
  };
  const lowest = siblings.reduce((a, b) => (bottom(b) > bottom(a) ? b : a));

  return {
    x: columnX,
    y: bottom(lowest) + NODE_V_GAP,
  };
}

/** 自动布局输入的节点/连线最小形状（与 BookplatePage 的 NodeData/EdgeData 兼容） */
export interface LayoutNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

/** 自动布局的起始 Y（根区块顶部）与根区块间距 */
const LAYOUT_ORIGIN_Y = 100;
const ROOT_GAP = 120;

/**
 * 自动布局：按层级分列 + 父节点居中的子树布局。
 *
 * - 根 = 无入边节点（通常为 BookInfo）；层 0 节点位于最左列，逐层右移 NODE_GAP。
 * - 每个节点的子树（其后代）垂直堆叠为一个区块，父节点垂直居中于该区块
 *   （lessons.md #2：垂直居中对齐，保证连线平缓）。
 * - 子节点按创建顺序（nodes 数组序）排列，与分支颜色（branchSerial）序号一致。
 * - 列宽取该层节点实际宽度最大值，窄节点在列内水平居中；尺寸缺失回退默认值。
 * - 孤儿节点（父级被删）作为独立根处理。
 */
export function computeAutoLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  actualSizes: Record<string, { width: number; height: number }>
): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  if (nodes.length === 0) return pos;

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const sizeOf = (id: string, type: NodeType) => actualSizes[id] ?? NODE_SIZES[type];

  // 子节点映射 + 入边标记（无入边者为根）
  const childrenMap = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    hasParent.add(edge.target);
    const list = childrenMap.get(edge.source) ?? [];
    list.push(edge.target);
    childrenMap.set(edge.source, list);
  }

  // 层级（BFS，取最大深度）
  const levelOf = new Map<string, number>();
  let roots = nodes.filter((n) => !hasParent.has(n.id));
  if (roots.length === 0) roots = nodes; // 异常兜底：全为孤立/环时全部当根
  for (const r of roots) levelOf.set(r.id, 0);
  const queue = [...roots];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const curLevel = levelOf.get(cur.id) ?? 0;
    for (const cid of childrenMap.get(cur.id) ?? []) {
      const nextLevel = curLevel + 1;
      if (!levelOf.has(cid) || levelOf.get(cid)! < nextLevel) {
        levelOf.set(cid, nextLevel);
        queue.push(nodeById.get(cid)!);
      }
    }
  }
  for (const n of nodes) if (!levelOf.has(n.id)) levelOf.set(n.id, 0);

  // 列宽与列 x（窄节点在列内居中）
  const maxLevel = Math.max(0, ...levelOf.values());
  const columnWidth = new Array<number>(maxLevel + 1).fill(0);
  for (const n of nodes) {
    const lvl = levelOf.get(n.id) ?? 0;
    columnWidth[lvl] = Math.max(columnWidth[lvl], sizeOf(n.id, n.type).width);
  }
  const columnX = new Array<number>(maxLevel + 1).fill(0);
  columnX[0] = 100; // 与 getBookInfoPosition 的起始 x 保持一致
  for (let i = 1; i <= maxLevel; i++) {
    columnX[i] = columnX[i - 1] + columnWidth[i - 1] + NODE_GAP;
  }

  // 子节点按创建顺序排序
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  for (const list of childrenMap.values()) {
    list.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  // 递归布局：返回节点子树的垂直区块 [top, bottom]，并把子树内节点坐标写入 pos
  const placed = new Set<string>();
  const placeNode = (nodeId: string, topOfBlock: number): { top: number; bottom: number } => {
    const node = nodeById.get(nodeId);
    if (!node) return { top: topOfBlock, bottom: topOfBlock };
    const lvl = levelOf.get(nodeId) ?? 0;
    const nodeSize = sizeOf(nodeId, node.type);
    const children = (childrenMap.get(nodeId) ?? []).filter((cid) => nodeById.has(cid));

    if (children.length === 0) {
      pos[nodeId] = {
        x: columnX[lvl] + (columnWidth[lvl] - nodeSize.width) / 2,
        y: topOfBlock,
      };
      placed.add(nodeId);
      return { top: topOfBlock, bottom: topOfBlock + nodeSize.height };
    }

    let cursor = topOfBlock;
    const blocks: Array<{ top: number; bottom: number }> = [];
    for (const cid of children) {
      const block = placeNode(cid, cursor);
      blocks.push(block);
      cursor = block.bottom + NODE_V_GAP;
    }
    const top = blocks[0].top;
    const bottom = blocks[blocks.length - 1].bottom;
    pos[nodeId] = {
      x: columnX[lvl] + (columnWidth[lvl] - nodeSize.width) / 2,
      y: (top + bottom) / 2 - nodeSize.height / 2,
    };
    placed.add(nodeId);
    return { top, bottom };
  };

  // 每个根子树一个垂直区块，根之间留大间距
  let cursorY = LAYOUT_ORIGIN_Y;
  for (const root of roots) {
    if (placed.has(root.id)) continue;
    const block = placeNode(root.id, cursorY);
    cursorY = block.bottom + ROOT_GAP;
  }

  return pos;
}

/** 聚焦视口的边界框（画布坐标系，含节点尺寸） */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 聚焦内边距（px，画布坐标） */
const FOCUS_PADDING = 80;

/**
 * 计算让给定边界框适配视口的 scale/position（画布坐标系 → 视口）。
 *
 * 规则：内容大于视口时缩小到恰好容纳（含内边距）；内容小于视口时保持 1x 不变（不放大），
 * 并将内容居中。scale 收敛在 [0.1, 1] 内，与画布缩放控件上下限一致。
 */
export function computeFitViewport(
  bounds: Bounds,
  viewportW: number,
  viewportH: number
): { scale: number; position: { x: number; y: number } } {
  const boxW = Math.max(bounds.maxX - bounds.minX, 1);
  const boxH = Math.max(bounds.maxY - bounds.minY, 1);
  const fitScale = Math.min(
    viewportW / (boxW + FOCUS_PADDING * 2),
    viewportH / (boxH + FOCUS_PADDING * 2)
  );
  const scale = Math.min(1, Math.max(0.1, fitScale));
  return {
    scale,
    position: {
      x: (viewportW - boxW * scale) / 2 - bounds.minX * scale,
      y: (viewportH - boxH * scale) / 2 - bounds.minY * scale,
    },
  };
}
