import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, X, Check } from 'lucide-react';
import { Mascot, type MascotRefHandle } from './Mascot';
import { FeedbackModal } from './FeedbackModal';
import {
  MASCOT_CHARACTERS,
  DEFAULT_MASCOT_ID,
  MASCOT_POSITION_STORAGE_KEY,
  MASCOT_CHARACTER_STORAGE_KEY,
  getMascotAssetPaths,
} from './constants';

const WIDGET_SIZE = 110;
const PADDING_EDGE = 12;

interface WidgetPosition {
  x: number;
  y: number;
}

/**
 * 屏幕边缘约束：保证小组件完全在可视区域内
 */
function clampPosition(x: number, y: number, size: number): WidgetPosition {
  const maxX = Math.max(PADDING_EDGE, window.innerWidth - size - PADDING_EDGE);
  const maxY = Math.max(PADDING_EDGE, window.innerHeight - size - PADDING_EDGE);
  return {
    x: Math.min(Math.max(PADDING_EDGE, x), maxX),
    y: Math.min(Math.max(PADDING_EDGE, y), maxY),
  };
}

/**
 * 计算默认右下角坐标
 */
function getDefaultPosition(size: number): WidgetPosition {
  if (typeof window === 'undefined') return { x: 100, y: 100 };
  return {
    x: Math.max(PADDING_EDGE, window.innerWidth - size - 28),
    y: Math.max(PADDING_EDGE, window.innerHeight - size - 28),
  };
}

export const MascotWidget: React.FC = () => {
  const mascotRef = useRef<MascotRefHandle>(null);
  const [characterId, setCharacterId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(MASCOT_CHARACTER_STORAGE_KEY);
      if (saved && MASCOT_CHARACTERS.some((c) => c.id === saved)) {
        return saved;
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_MASCOT_ID;
  });

  // 位置状态（支持任意拖拽与持久化）
  const [position, setPosition] = useState<WidgetPosition>(() => {
    try {
      const saved = localStorage.getItem(MASCOT_POSITION_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
          return clampPosition(parsed.x, parsed.y, WIDGET_SIZE);
        }
      }
    } catch {
      /* ignore */
    }
    return getDefaultPosition(WIDGET_SIZE);
  });

  // 弹窗状态
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // 拖动交互控制
  const [isDragging, setIsDragging] = useState(false);
  const dragInfoRef = useRef<{
    startX: number;
    startY: number;
    initialPos: WidgetPosition;
    hasMoved: boolean;
  } | null>(null);

  // 窗口 resize 时自动调整边界
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => clampPosition(prev.x, prev.y, WIDGET_SIZE));
      mascotRef.current?.recalibratePosition();
    };
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 角色切换持久化
  const selectCharacter = (id: string) => {
    setCharacterId(id);
    try {
      localStorage.setItem(MASCOT_CHARACTER_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
    setIsPickerOpen(false);
  };

  // 开始拖拽
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 鼠标左键或触摸有效
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    dragInfoRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialPos: { ...position },
      hasMoved: false,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!dragInfoRef.current) return;
      const dx = moveEvent.clientX - dragInfoRef.current.startX;
      const dy = moveEvent.clientY - dragInfoRef.current.startY;

      if (!dragInfoRef.current.hasMoved && Math.hypot(dx, dy) > 4) {
        dragInfoRef.current.hasMoved = true;
        setIsDragging(true);
      }

      if (dragInfoRef.current.hasMoved) {
        const nextX = dragInfoRef.current.initialPos.x + dx;
        const nextY = dragInfoRef.current.initialPos.y + dy;
        setPosition(clampPosition(nextX, nextY, WIDGET_SIZE));
      }
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);

      const info = dragInfoRef.current;
      dragInfoRef.current = null;
      setIsDragging(false);

      if (!info) return;

      if (info.hasMoved) {
        // 拖拽完成，保存位置并刷新朝向中心点
        const finalDx = upEvent.clientX - info.startX;
        const finalDy = upEvent.clientY - info.startY;
        const finalPos = clampPosition(info.initialPos.x + finalDx, info.initialPos.y + finalDy, WIDGET_SIZE);
        setPosition(finalPos);
        try {
          localStorage.setItem(MASCOT_POSITION_STORAGE_KEY, JSON.stringify(finalPos));
        } catch {
          /* ignore */
        }
        window.setTimeout(() => {
          mascotRef.current?.recalibratePosition();
        }, 50);
      } else {
        // 未显著移动，判定为「点击戳一下」交互
        mascotRef.current?.boop();
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const currentCharacter =
    MASCOT_CHARACTERS.find((c) => c.id === characterId) || MASCOT_CHARACTERS[0];
  const { directions, reactions } = getMascotAssetPaths(characterId);

  return (
    <>
      {/* 任意可拖拽浮动挂件容器 */}
      <div
        className="fixed select-none"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          zIndex: 9980,
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
      >
        <div className="relative group">
          {/* Mascot 核心形象：点击仅播放趣味表情动画，不弹窗打扰用户 */}
          <Mascot
            ref={mascotRef}
            directions={directions}
            reactions={reactions}
            size={WIDGET_SIZE}
            label={currentCharacter.name}
          />

          {/* 悬停快捷提示与换装按钮气泡 */}
          <div
            className={`absolute -top-7 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-paper/95 border border-paper-grid shadow-md backdrop-blur text-[11px] text-ink-light transition-all duration-200 pointer-events-auto ${
              isDragging
                ? 'opacity-0 scale-95 pointer-events-none'
                : 'opacity-0 group-hover:opacity-100 scale-100'
            }`}
          >
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setIsFeedbackOpen(true);
              }}
              className="cursor-pointer hover:text-accent font-sans whitespace-nowrap transition-colors"
            >
              点我反馈
            </button>
            <span className="text-paper-grid select-none">|</span>
            <button
              type="button"
              title="切换吉祥物形象"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setIsPickerOpen((prev) => !prev);
              }}
              className="text-ink-faint hover:text-accent transition-colors flex items-center gap-0.5"
            >
              <Sparkles size={12} />
              <span>换装</span>
            </button>
          </div>

          {/* 拖动提示角标（小手抓取指示） */}
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] text-ink-faint/70 font-sans tracking-tight opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            按住可拖动
          </div>
        </div>
      </div>

      {/* 52 角色换装网格抽屉/弹窗 */}
      {isPickerOpen && (
        <div
          className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={() => setIsPickerOpen(false)}
        >
          <div
            className="bg-paper border border-paper-grid rounded-xl shadow-2xl p-4 max-w-lg w-full max-h-[75vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-paper-grid">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-accent" />
                <h3 className="text-sm font-serif font-bold text-ink">挑选专属画板吉祥物</h3>
                <span className="text-xs text-ink-faint font-sans">
                  ({MASCOT_CHARACTERS.length} 种形象)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsPickerOpen(false)}
                className="p-1 rounded text-ink-faint hover:text-ink transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto py-3 grid grid-cols-4 sm:grid-cols-5 gap-2.5 flex-1 pr-1">
              {MASCOT_CHARACTERS.map((char) => {
                const isSelected = char.id === characterId;
                return (
                  <button
                    key={char.id}
                    type="button"
                    onClick={() => selectCharacter(char.id)}
                    className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all ${
                      isSelected
                        ? 'border-accent bg-accent/10 shadow-sm'
                        : 'border-paper-grid/60 hover:border-accent/60 hover:bg-paper-grid/20'
                    }`}
                  >
                    <div
                      className="w-12 h-12 relative overflow-hidden rounded-full bg-paper border border-paper-grid/40"
                      style={{
                        backgroundImage: `url(/mascots/${char.id}-directions.webp)`,
                        backgroundSize: '300% 300%',
                        backgroundPosition: '50% 50%',
                      }}
                    />
                    <span className="text-[11px] font-sans text-ink truncate w-full text-center">
                      {char.name}
                    </span>
                    {isSelected && (
                      <span className="text-[10px] text-accent font-sans flex items-center gap-0.5">
                        <Check size={10} strokeWidth={3} /> 已选
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 反馈表单弹窗 */}
      <FeedbackModal
        open={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
        mascotName={currentCharacter.name}
      />
    </>
  );
};
