import { DEFAULT_SIZES, type CanvasGroup, type NodeData, type NodeSize } from './graphTypes';

/** 组边界四周内边距（画布坐标，不随缩放变化） */
export const GROUP_PADDING = 24;

/** 默认分组名（用户清空名称时的回退值） */
export const DEFAULT_GROUP_NAME = '未命名分组';

/**
 * 分组预设色（低饱和、中低亮度、偏灰的纸感色系）：
 * 与 paper/ink/accent 视觉变量相容，实际渲染时以高透明度混入背景
 * （背景 ~8%、边框 ~68%、标题底色 ~12%，见 CanvasGroupFrame）。
 */
export const GROUP_COLORS = [
  { name: '纸墨灰', value: '#64748B' },
  { name: '靛青', value: '#4F6B8A' },
  { name: '青绿', value: '#4D857B' },
  { name: '土黄', value: '#A4864A' },
  { name: '暗玫红', value: '#9A5965' },
  { name: '紫灰', value: '#766B91' },
  { name: '棕褐', value: '#98785B' },
  { name: '松绿', value: '#5F8068' },
] as const;

/** 新分组默认取色：按已有分组数量在预设色板中轮换，避免相邻分组同色 */
export function nextGroupColor(existing: CanvasGroup[]): string {
  return GROUP_COLORS[existing.length % GROUP_COLORS.length].value;
}

/** 新分组默认名：分组 1、分组 2 …（按现有数量递增） */
export function nextGroupName(existing: CanvasGroup[]): string {
  return `分组 ${existing.length + 1}`;
}

/**
 * 由成员节点位置 + 实际尺寸推导组包围盒（四周加内边距）。
 * 组不承载实体，边界实时派生：成员移动 / 调整尺寸 / 自动布局后自动跟随。
 */
export function computeGroupBounds(
  members: NodeData[],
  sizes: Record<string, NodeSize>,
  padding: number = GROUP_PADDING
): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of members) {
    const size = sizes[n.id] ?? DEFAULT_SIZES[n.type];
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + size.width);
    maxY = Math.max(maxY, n.y + size.height);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}
