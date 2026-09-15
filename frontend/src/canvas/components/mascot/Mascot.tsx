import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import type { CSSProperties } from 'react';

const DIRECTIONS = [
  'up-left',
  'up',
  'up-right',
  'left',
  'center',
  'right',
  'down-left',
  'down',
  'down-right',
] as const;

const REACTIONS = [
  'blink',
  'heart',
  'sparkle',
  'surprised',
  'wink',
  'bashful',
  'sleepy',
  'dizzy',
  'delighted',
] as const;

type Direction = (typeof DIRECTIONS)[number];
type Reaction = (typeof REACTIONS)[number];

const CLOCKWISE: Direction[] = [
  'right',
  'down-right',
  'down',
  'down-left',
  'left',
  'up-left',
  'up',
  'up-right',
];

const SECTOR = (Math.PI * 2) / CLOCKWISE.length;
const HYSTERESIS = 0.12;
const DEAD_ZONE = 60;

const PAYOFFS: Reaction[] = ['heart', 'sparkle', 'delighted'];
const BOOP_PAYOFF = 120;
const BOOP_END = 560;
const SQUASH_MS = 420;
const DIZZY_AFTER = 4;
const DIZZY_WINDOW = 1600;
const DIZZY_END = 1100;

const SQUASH: Keyframe[] = [
  { transform: 'scale(1, 1)', easing: 'ease-in' },
  { transform: 'scale(1.10, 0.86)', offset: 0.18, easing: 'ease-out' },
  { transform: 'scale(0.95, 1.08)', offset: 0.45, easing: 'ease-in-out' },
  { transform: 'scale(1.03, 0.97)', offset: 0.72, easing: 'ease-in-out' },
  { transform: 'scale(1, 1)' },
];

function cell(index: number): CSSProperties {
  return { backgroundPosition: `${(index % 3) * 50}% ${Math.floor(index / 3) * 50}%` };
}

function wrap(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

const layer: CSSProperties = {
  position: 'absolute',
  inset: 0,
  backgroundSize: '300% 300%',
  backgroundRepeat: 'no-repeat',
};

export interface MascotProps {
  /** 头部 9 方向 3x3 精灵图路径 */
  directions: string;
  /** 表情反应 3x3 精灵图路径 */
  reactions: string;
  /** 尺寸（像素，默认 110） */
  size?: number;
  className?: string;
  label?: string;
  /** 点击互动触发的回调（在 boop 表情后触发） */
  onInteract?: (event?: React.MouseEvent<HTMLDivElement>) => void;
}

export interface MascotRefHandle {
  boop: (event?: React.MouseEvent<HTMLDivElement>) => void;
  recalibratePosition: () => void;
}

/**
 * 动态吉祥物视图组件：
 * - 鼠标光标追踪方向
 * - 点击 Squash 弹性缩放 + 随机可爱表情
 * - 性能优化：视口坐标缓存 + rAF 节流，避免高频 Reflow
 */
export const Mascot = forwardRef<MascotRefHandle, MascotProps>(function Mascot(props, ref) {
  const { directions, reactions, size = 110, className = '', label = 'mascot', onInteract } = props;

  const rootRef = useRef<HTMLDivElement>(null);
  const squashRef = useRef<HTMLSpanElement>(null);
  const timersRef = useRef<number[]>([]);
  const boopsRef = useRef({ count: 0, at: 0 });
  const [direction, setDirection] = useState<Direction>('center');
  const [reaction, setReaction] = useState<Reaction | null>(null);

  // 视口坐标缓存：记录挂件中心 (cx, cy)，避免 pointermove 每帧 getBoundingClientRect
  const centerRef = useRef<{ cx: number; cy: number } | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const currentSectorRef = useRef<number>(-1);

  const recalibratePosition = useCallback(() => {
    if (!rootRef.current) return;
    const box = rootRef.current.getBoundingClientRect();
    centerRef.current = {
      cx: box.left + box.width / 2,
      cy: box.top + box.height / 2,
    };
  }, []);

  useEffect(() => {
    recalibratePosition();
    window.addEventListener('resize', recalibratePosition, { passive: true });
    window.addEventListener('scroll', recalibratePosition, { passive: true });
    return () => {
      window.removeEventListener('resize', recalibratePosition);
      window.removeEventListener('scroll', recalibratePosition);
    };
  }, [recalibratePosition]);

  // 光标跟踪逻辑
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      if (rafIdRef.current !== null) return;

      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        if (!centerRef.current) recalibratePosition();
        if (!centerRef.current) return;

        const dx = event.clientX - centerRef.current.cx;
        const dy = event.clientY - centerRef.current.cy;

        if (Math.hypot(dx, dy) < DEAD_ZONE) {
          currentSectorRef.current = -1;
          setDirection('center');
          return;
        }

        const angle = Math.atan2(dy, dx);
        const prevSector = currentSectorRef.current;

        // 滞后区间判断，避免在边界处抖动
        if (
          prevSector !== -1 &&
          Math.abs(wrap(angle - prevSector * SECTOR)) < SECTOR / 2 + HYSTERESIS
        ) {
          return;
        }

        const nextSector = (Math.round(angle / SECTOR) + CLOCKWISE.length) % CLOCKWISE.length;
        currentSectorRef.current = nextSector;
        setDirection(CLOCKWISE[nextSector]);
      });
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [recalibratePosition]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(window.clearTimeout);
    };
  }, []);

  // 戳一下交互
  const boop = useCallback(
    (event?: React.MouseEvent<HTMLDivElement>) => {
      timersRef.current.forEach(window.clearTimeout);
      timersRef.current = [];

      const later = (ms: number, next: Reaction | null) => {
        timersRef.current.push(window.setTimeout(() => setReaction(next), ms));
      };

      const now = Date.now();
      const boops = boopsRef.current;
      boops.count = now - boops.at < DIZZY_WINDOW ? boops.count + 1 : 1;
      boops.at = now;

      if (boops.count >= DIZZY_AFTER) {
        boops.count = 0;
        setReaction('dizzy');
        later(DIZZY_END, null);
      } else {
        setReaction('blink');
        later(BOOP_PAYOFF, PAYOFFS[(boops.count - 1) % PAYOFFS.length]);
        later(BOOP_END, null);
      }

      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        squashRef.current?.animate(SQUASH, { duration: SQUASH_MS, easing: 'linear' });
      }

      // 触发外部交互通知（如弹出表单）
      if (onInteract) {
        // 延迟触发：让用户先看到生动的戳戳表情动画
        window.setTimeout(() => {
          onInteract(event);
        }, 400);
      }
    },
    [onInteract]
  );

  useImperativeHandle(
    ref,
    () => ({
      boop,
      recalibratePosition,
    }),
    [boop, recalibratePosition]
  );

  return (
    <div
      ref={rootRef}
      role="button"
      tabIndex={0}
      aria-label={`互动吉祥物 ${label}`}
      className={`relative block shrink-0 select-none cursor-pointer ${className}`}
      style={{
        width: size,
        height: size,
        appearance: 'none',
      }}
    >
      <span
        ref={squashRef}
        style={{
          position: 'relative',
          display: 'block',
          width: '100%',
          height: '100%',
          transformOrigin: '50% 78%',
        }}
      >
        {/* 朝向精灵图 */}
        <span
          style={{
            ...layer,
            backgroundImage: `url(${directions})`,
            ...cell(DIRECTIONS.indexOf(direction)),
            opacity: reaction ? 0 : 1,
            transition: 'opacity 80ms ease',
          }}
        />
        {/* 表情精灵图 */}
        <span
          style={{
            ...layer,
            backgroundImage: `url(${reactions})`,
            ...cell(REACTIONS.indexOf(reaction ?? 'blink')),
            opacity: reaction ? 1 : 0,
            transition: 'opacity 80ms ease',
          }}
        />
      </span>
    </div>
  );
});
