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
const IDLE_TIMEOUT_MS = 14000;

/** 阶梯式连击弹性动画：连戳越快越弹 */
function getComboSquash(combo: number): Keyframe[] {
  const intensity = Math.min(Math.max(combo, 1), 3);
  const sx = (1 + 0.08 * intensity).toFixed(2);
  const sy = (1 - 0.12 * intensity).toFixed(2);
  const reboundX = (1 - 0.04 * intensity).toFixed(2);
  const reboundY = (1 + 0.07 * intensity).toFixed(2);

  return [
    { transform: 'scale(1, 1)', easing: 'ease-in' },
    { transform: `scale(${sx}, ${sy})`, offset: 0.18, easing: 'ease-out' },
    { transform: `scale(${reboundX}, ${reboundY})`, offset: 0.45, easing: 'ease-in-out' },
    { transform: 'scale(1.03, 0.97)', offset: 0.72, easing: 'ease-in-out' },
    { transform: 'scale(1, 1)' },
  ];
}

/** 连续 4 戳触发的眩晕不倒翁摇摆关键帧 */
const DIZZY_WOBBLE: Keyframe[] = [
  { transform: 'scale(1, 1) rotate(0deg)' },
  { transform: 'scale(1.10, 0.90) rotate(-11deg)', offset: 0.15, easing: 'ease-out' },
  { transform: 'scale(0.95, 1.05) rotate(10deg)', offset: 0.35, easing: 'ease-in-out' },
  { transform: 'scale(1.04, 0.96) rotate(-7deg)', offset: 0.55, easing: 'ease-in-out' },
  { transform: 'scale(0.98, 1.02) rotate(4deg)', offset: 0.75, easing: 'ease-in-out' },
  { transform: 'scale(1.01, 0.99) rotate(-1deg)', offset: 0.90, easing: 'ease-out' },
  { transform: 'scale(1, 1) rotate(0deg)' },
];
const DIZZY_WOBBLE_MS = 980;

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
  /** 拖拽中状态：为 true 时彻底暂停光标跟踪与朝向重排，保障 120fps 极速拖拽 */
  isDragging?: boolean;
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
  const {
    directions,
    reactions,
    size = 110,
    className = '',
    label = 'mascot',
    onInteract,
    isDragging = false,
  } = props;

  const rootRef = useRef<HTMLDivElement>(null);
  const squashRef = useRef<HTMLSpanElement>(null);
  const timersRef = useRef<number[]>([]);
  const idleTimerRef = useRef<number | null>(null);
  const boopsRef = useRef({ count: 0, at: 0 });
  const [direction, setDirection] = useState<Direction>('center');
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const [bubbleState, setBubbleState] = useState<'dizzy' | 'sleepy' | null>(null);

  // 视口坐标缓存：记录挂件中心 (cx, cy)，避免 pointermove 每帧 getBoundingClientRect
  const centerRef = useRef<{ cx: number; cy: number } | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const currentSectorRef = useRef<number>(-1);
  const isDraggingRef = useRef(isDragging);
  isDraggingRef.current = isDragging;

  const recalibratePosition = useCallback(() => {
    if (!rootRef.current) return;
    const box = rootRef.current.getBoundingClientRect();
    centerRef.current = {
      cx: box.left + box.width / 2,
      cy: box.top + box.height / 2,
    };
  }, []);

  // 待机打瞌睡计时器重置与唤醒
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    // 若当前正在打瞌睡，鼠标一动立刻唤醒
    setBubbleState((prev) => (prev === 'sleepy' ? null : prev));
    setReaction((prev) => (prev === 'sleepy' ? null : prev));

    idleTimerRef.current = window.setTimeout(() => {
      if (isDraggingRef.current) return;
      setReaction((curReaction) => {
        if (curReaction === null) {
          setBubbleState('sleepy');
          return 'sleepy';
        }
        return curReaction;
      });
    }, IDLE_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    recalibratePosition();
    resetIdleTimer();
    window.addEventListener('resize', recalibratePosition, { passive: true });
    window.addEventListener('scroll', recalibratePosition, { passive: true });
    return () => {
      window.removeEventListener('resize', recalibratePosition);
      window.removeEventListener('scroll', recalibratePosition);
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
    };
  }, [recalibratePosition, resetIdleTimer]);

  // 光标跟踪逻辑
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      // 移动光标即重置打瞌睡计时
      resetIdleTimer();

      // 拖拽过程中完全不进行任何角度计算和 setState，避免重排和卡顿
      if (isDraggingRef.current) return;
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
  }, [recalibratePosition, resetIdleTimer]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(window.clearTimeout);
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
    };
  }, []);

  // 戳一下交互（支持阶梯连击弹性与眩晕彩蛋）
  const boop = useCallback(
    (event?: React.MouseEvent<HTMLDivElement>) => {
      resetIdleTimer();
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
        // 连戳 4 次触发“眩晕”彩蛋
        boops.count = 0;
        setReaction('dizzy');
        setBubbleState('dizzy');

        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          squashRef.current?.animate(DIZZY_WOBBLE, {
            duration: DIZZY_WOBBLE_MS,
            easing: 'ease-out',
          });
        }

        later(DIZZY_END, null);
        timersRef.current.push(
          window.setTimeout(() => {
            setBubbleState(null);
          }, DIZZY_END)
        );
      } else {
        // 普通连击戳戳：阶梯式回弹缩放动画
        setBubbleState(null);
        setReaction('blink');
        later(BOOP_PAYOFF, PAYOFFS[(boops.count - 1) % PAYOFFS.length]);
        later(BOOP_END, null);

        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          squashRef.current?.animate(getComboSquash(boops.count), {
            duration: SQUASH_MS,
            easing: 'linear',
          });
        }
      }

      // 触发外部交互通知（如弹出表单）
      if (onInteract) {
        window.setTimeout(() => {
          onInteract(event);
        }, 400);
      }
    },
    [onInteract, resetIdleTimer]
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
      {/* 趣味彩蛋微气泡（眩晕 / 打瞌睡） */}
      {bubbleState && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-3 -right-2 z-20 flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-xs font-semibold text-amber-600 shadow-md ring-1 ring-amber-400/30 backdrop-blur-sm animate-bounce dark:bg-zinc-800/95 dark:text-amber-300 dark:ring-amber-500/30 select-none"
        >
          {bubbleState === 'dizzy' ? (
            <span>💫 晕啦~</span>
          ) : (
            <span className="font-mono tracking-wider text-indigo-500 dark:text-indigo-400">zZ 💤</span>
          )}
        </div>
      )}

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
