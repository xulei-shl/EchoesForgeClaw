import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';

export interface NodeEdgeHandle {
  /** 以节点左上角坐标实时重绘连线（拖拽跟随用，不触发 React 渲染） */
  setPositions: (sourceX: number, sourceY: number, targetX: number, targetY: number) => void;
}

interface NodeEdgeProps {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  // Options for node dimensions to calculate border anchor points
  sourceWidth?: number;
  sourceHeight?: number;
  targetWidth?: number;
  targetHeight?: number;
  /** 同源分支的序号（0 起）与总数，用于弓形错开（几何扇出，随当前兄弟数重排）；单边时默认 0/1 */
  branchIndex?: number;
  branchCount?: number;
  /** 连线色调序号：优先用目标节点的稳定 branchSerial（删除/重排不换色），缺省回退到位置序号 */
  tintIndex?: number;
  /** 端口类型不匹配：false 时整条连线以错误色渲染（红色标注） */
  compatible?: boolean;
  /** 当前连线是否高亮（所属源节点或目标节点被激活） */
  highlighted?: boolean;
  /** 当前存在激活节点，但本连线不关联（弱化态） */
  dimmed?: boolean;
  /** 点击连线中间的删除按钮 */
  onDelete?: () => void;
}

/** 分支连线端点色调：序号 0 保持主 accent（与单边视觉一致），后续分支取柔和对比色 */
const BRANCH_TINTS = [
  'var(--color-accent, #A0622B)',
  '#5B8A5B',
  '#4A7BA6',
  '#9A5B8E',
  '#B06048',
  '#7A8A4A',
];

/** 分支弓形最大垂直偏移（px），随连线水平距离缩放 */
const BRANCH_BOW = 72;

const NodeEdge = forwardRef<NodeEdgeHandle, NodeEdgeProps>(function NodeEdge(
  {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourceWidth = 400,
    sourceHeight = 540,
    targetWidth = 420,
    targetHeight = 500,
    branchIndex = 0,
    branchCount = 1,
    tintIndex,
    compatible = true,
    highlighted = false,
    dimmed = false,
    onDelete,
  },
  ref
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const basePathRef = useRef<SVGPathElement>(null);
  const flowPathRef = useRef<SVGPathElement>(null);
  const hitPathRef = useRef<SVGPathElement>(null);
  const deleteBtnRef = useRef<SVGForeignObjectElement>(null);

  // 尺寸在渲染期间恒定（拖拽只改位置），用 ref 供命令式重绘读取
  const sizesRef = useRef({ sourceWidth, sourceHeight, targetWidth, targetHeight });
  sizesRef.current = { sourceWidth, sourceHeight, targetWidth, targetHeight };

  // 分支序号/总数在拖拽重绘期间恒定（props 变化会触发重新渲染并同步）
  const branchRef = useRef({ index: 0, count: 1 });
  branchRef.current = { index: branchIndex, count: branchCount };

  /** 计算并写入路径 / 包围盒 / 视图（DOM 直改，无渲染开销） */
  const apply = (sx: number, sy: number, tx: number, ty: number) => {
    const { sourceWidth: sw, sourceHeight: sh, targetHeight: th } = sizesRef.current;
    const { index: branchIndex, count: branchCount } = branchRef.current;
    // 源节点右边框垂直中心
    const startX = sx + sw;
    const startY = sy + sh / 2;

    // 目标节点左边框垂直中心
    const endX = tx;
    const endY = ty + th / 2;

    // 贝塞尔曲线控制点（水平延伸）
    const dx = Math.abs(endX - startX);
    const controlPointXOffset = Math.max(dx / 2, 40);
    // 同源分支弓形错开：按序号对称分布，端点固定、中段分离，避免曲线重叠
    const branchT = branchCount > 1 ? branchIndex / (branchCount - 1) - 0.5 : 0;
    const bowY = branchT * BRANCH_BOW * Math.min(1, dx / 260);
    const cp1X = startX + controlPointXOffset;
    const cp1Y = startY + bowY;
    const cp2X = endX - controlPointXOffset;
    const cp2Y = endY + bowY;

    const path = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;

    // SVG needs to cover the bounding box of the curve
    const bowAbs = Math.abs(bowY);
    const minX = Math.min(startX, endX) - 50;
    const minY = Math.min(startY, endY) - 50 - bowAbs;
    const maxX = Math.max(startX, endX) + 50;
    const maxY = Math.max(startY, endY) + 50 + bowAbs;
    const width = maxX - minX;
    const height = maxY - minY;

    const svg = svgRef.current;
    if (!svg) return;
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
    svg.style.transform = `translate(${minX}px, ${minY}px)`;
    basePathRef.current?.setAttribute('d', path);
    flowPathRef.current?.setAttribute('d', path);
    hitPathRef.current?.setAttribute('d', path);

    // 计算贝塞尔曲线中点（t=0.5）以放置删除按钮
    const btn = deleteBtnRef.current;
    if (btn) {
      const midX = 0.125 * (startX + 3 * cp1X + 3 * cp2X + endX);
      const midY = 0.125 * (startY + 3 * cp1Y + 3 * cp2Y + endY);
      btn.setAttribute('x', String(midX));
      btn.setAttribute('y', String(midY));
    }
  };

  // 每次渲染（props 变化）后应用最新路径
  useLayoutEffect(() => {
    apply(sourceX, sourceY, targetX, targetY);
  });

  useImperativeHandle(ref, () => ({
    setPositions: apply,
  }));

  return (
    <svg
      ref={svgRef}
      className="absolute top-0 left-0 pointer-events-none group transition-opacity duration-200"
      style={{ overflow: 'visible', opacity: dimmed ? 0.35 : 1, zIndex: highlighted ? 100 : 0 }}
    >
      <defs>
        <linearGradient id={`grad-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop
            offset="0%"
            stopColor={highlighted ? 'var(--color-accent, #A0622B)' : 'var(--color-paper-grid, #E4E1DA)'}
            stopOpacity={highlighted ? 0.8 : 1}
          />
          <stop
            offset="100%"
            stopColor={
              compatible
                ? BRANCH_TINTS[(tintIndex ?? branchIndex) % BRANCH_TINTS.length]
                : 'var(--color-error, #C0392B)'
            }
          />
        </linearGradient>
        {highlighted && (
          <filter id={`glow-${id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="1.5" floodColor="var(--color-accent, #A0622B)" floodOpacity="0.45" />
          </filter>
        )}
      </defs>
      {/* Hit target for hover and interactions (高亮跨越节点时不拦截下方节点事件) */}
      <path
        ref={hitPathRef}
        fill="none"
        stroke="transparent"
        strokeWidth="24"
        className={highlighted ? 'pointer-events-none' : 'pointer-events-auto cursor-pointer'}
      />
      {/* Base line */}
      <path
        ref={basePathRef}
        fill="none"
        stroke="var(--color-paper-grid, #E4E1DA)"
        strokeWidth={highlighted ? 3.5 : 2}
        strokeDasharray={highlighted ? '6,4' : '5,5'}
      />
      {/* Animated flowing line */}
      <path
        ref={flowPathRef}
        fill="none"
        stroke={`url(#grad-${id})`}
        strokeWidth={highlighted ? 3.5 : 2}
        strokeDasharray={highlighted ? '6,4' : '5,5'}
        filter={highlighted ? `url(#glow-${id})` : undefined}
        className="animate-flow"
      />
      {/* Delete button (positioned at bezier midpoint) */}
      {onDelete && (
        <foreignObject
          ref={deleteBtnRef}
          width="1"
          height="1"
          style={{ overflow: 'visible', pointerEvents: 'none' }}
        >
          <div
            title="删除连线"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
            className={`w-6 h-6 bg-paper border border-error text-error rounded-full flex items-center justify-center cursor-pointer pointer-events-auto hover:scale-110 hover:bg-error hover:text-white transition-all duration-200 shadow-sm ${
              highlighted ? 'opacity-80 hover:opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            style={{ marginLeft: '-12px', marginTop: '-12px' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        </foreignObject>
      )}
    </svg>
  );
});

export { NodeEdge };
export default NodeEdge;
