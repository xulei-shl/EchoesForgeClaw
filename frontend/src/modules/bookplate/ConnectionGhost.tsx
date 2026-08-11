import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface ConnectionGhostHandle {
  /**
   * 更新连线终点与类型匹配状态（命令式，不触发 React 渲染）。
   * compatible: true=匹配（主色）/ false=不匹配（红）/ undefined=未悬停到目标（默认弱色）
   */
  setEnd: (clientX: number, clientY: number, compatible?: boolean) => void;
}

interface ConnectionGhostProps {
  /** 连线源节点 id（右锚点所在的节点） */
  sourceId: string;
}

/**
 * 手动拖线的幽灵连线（待确认的连线预览）：
 * 以客户端坐标绘制，fixed 覆盖层铺满视口，指针位置经 ref 命令式更新，全程零 React 渲染。
 * 拖动中根据端口类型匹配实时着色：匹配主色 / 不匹配红色 / 未悬停目标弱色。
 */
const ConnectionGhost = forwardRef<ConnectionGhostHandle, ConnectionGhostProps>(
  function ConnectionGhost({ sourceId }, ref) {
    const pathRef = useRef<SVGPathElement>(null);
    const flowPathRef = useRef<SVGPathElement>(null);
    const startRef = useRef({ x: 0, y: 0 });
    const endRef = useRef({ x: 0, y: 0 });

    // 起点 = 源节点右边框中点（客户端坐标）；节点被缩放/平移后 getBoundingClientRect 已含变换。
    // 初始终点 = 起点（幽灵线先退化为一个点，首次指针移动后展开）
    useEffect(() => {
      const el = document.getElementById(sourceId);
      if (el) {
        const r = el.getBoundingClientRect();
        startRef.current = { x: r.right, y: r.top + r.height / 2 };
      }
      endRef.current = { ...startRef.current };
      paint();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sourceId]);

    const paint = (compatible?: boolean) => {
      const path = pathRef.current;
      const flowPath = flowPathRef.current;
      if (!path) return;
      const { x: sx, y: sy } = startRef.current;
      const { x: ex, y: ey } = endRef.current;
      const dx = Math.abs(ex - sx);
      const cp = Math.max(dx / 2, 40);
      const d = `M ${sx} ${sy} C ${sx + cp} ${sy}, ${ex - cp} ${ey}, ${ex} ${ey}`;
      
      path.setAttribute('d', d);
      
      if (flowPath) {
        flowPath.setAttribute('d', d);
        if (compatible === undefined) {
          flowPath.style.display = 'none';
        } else {
          flowPath.style.display = 'block';
          flowPath.setAttribute(
            'stroke',
            compatible ? 'url(#ghost-grad-compat)' : 'url(#ghost-grad-err)'
          );
        }
      }
    };

    useImperativeHandle(ref, () => ({
      setEnd: (clientX, clientY, compatible) => {
        endRef.current = { x: clientX, y: clientY };
        paint(compatible);
      },
    }));

    return (
      <svg className="fixed inset-0 pointer-events-none" style={{ zIndex: 9999 }}>
        <defs>
          <linearGradient id="ghost-grad-compat" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--color-paper-grid, #E4E1DA)" />
            <stop offset="100%" stopColor="var(--color-accent, #A0622B)" />
          </linearGradient>
          <linearGradient id="ghost-grad-err" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--color-paper-grid, #E4E1DA)" />
            <stop offset="100%" stopColor="var(--color-error, #C0392B)" />
          </linearGradient>
        </defs>
        <path
          ref={pathRef}
          fill="none"
          stroke="var(--color-paper-grid, #E4E1DA)"
          strokeWidth="1.5"
          strokeDasharray="5,5"
          opacity="0.9"
        />
        <path
          ref={flowPathRef}
          fill="none"
          strokeWidth="2.5"
          strokeDasharray="5,5"
          className="animate-flow"
          style={{ display: 'none' }}
        />
      </svg>
    );
  }
);

export default ConnectionGhost;
