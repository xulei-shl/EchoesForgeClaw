import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Sparkles,
  MessageSquareHeart,
  GripHorizontal,
  X,
  Check,
  Search,
  RotateCcw,
} from 'lucide-react';
import { Mascot, type MascotRefHandle } from './Mascot';
import { FeedbackModal } from './FeedbackModal';
import {
  MASCOT_CHARACTERS,
  MASCOT_CATEGORIES,
  DEFAULT_MASCOT_ID,
  MASCOT_POSITION_STORAGE_KEY,
  MASCOT_CHARACTER_STORAGE_KEY,
  getMascotAssetPaths,
} from './constants';

const WIDGET_SIZE = 110;
const PADDING_EDGE = 14;
/** 默认贴近视口右下角的安全边距 */
const DEFAULT_MARGIN_RIGHT = 24;
const DEFAULT_MARGIN_BOTTOM = 24;

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
 * 计算默认坐标：视口右下角安全停靠区，避免遮挡页面核心内容与分页/输入栏
 */
function getDefaultPosition(size: number): WidgetPosition {
  if (typeof window === 'undefined') return { x: 100, y: 100 };
  return {
    x: Math.max(PADDING_EDGE, window.innerWidth - size - DEFAULT_MARGIN_RIGHT),
    y: Math.max(PADDING_EDGE, window.innerHeight - size - DEFAULT_MARGIN_BOTTOM),
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

  // 换装弹窗过滤状态
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // 拖动交互控制
  const [isDragging, setIsDragging] = useState(false);
  const dragInfoRef = useRef<{
    startX: number;
    startY: number;
    initialPos: WidgetPosition;
    hasMoved: boolean;
    pointerId: number;
    target: HTMLElement;
  } | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // 窗口 resize 时自动调整边界并重算朝向中心
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

  // 重置到默认右下角位置
  const handleResetPosition = () => {
    const defaultPos = getDefaultPosition(WIDGET_SIZE);
    setPosition(defaultPos);
    try {
      localStorage.removeItem(MASCOT_POSITION_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    window.setTimeout(() => {
      mascotRef.current?.recalibratePosition();
    }, 50);
  };

  // 开始拖拽：原生 Pointer Capture + 阻断向底层画布冒泡 + rAF 帧级调度
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    // 严防事件向底层画板及节点穿透
    e.stopPropagation();

    const target = e.currentTarget;
    const pointerId = e.pointerId;

    try {
      target.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }

    dragInfoRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialPos: { ...position },
      hasMoved: false,
      pointerId,
      target,
    };

    let latestPos = { ...position };

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
        latestPos = clampPosition(nextX, nextY, WIDGET_SIZE);

        // rAF 批处理调度：对齐 VSync 刷新帧，严禁高回报率鼠标密集触发 React 重绘
        if (rafIdRef.current === null) {
          rafIdRef.current = window.requestAnimationFrame(() => {
            setPosition(latestPos);
            rafIdRef.current = null;
          });
        }
      }
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);

      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      const info = dragInfoRef.current;
      dragInfoRef.current = null;
      setIsDragging(false);

      if (!info) return;

      try {
        if (info.target.hasPointerCapture(info.pointerId)) {
          info.target.releasePointerCapture(info.pointerId);
        }
      } catch {
        /* ignore */
      }

      if (info.hasMoved) {
        const finalDx = upEvent.clientX - info.startX;
        const finalDy = upEvent.clientY - info.startY;
        const finalPos = clampPosition(
          info.initialPos.x + finalDx,
          info.initialPos.y + finalDy,
          WIDGET_SIZE
        );
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
        // 未显著位移：点击戳一下纯动效，不弹窗
        mascotRef.current?.boop();
      }
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp);
  };

  const currentCharacter =
    MASCOT_CHARACTERS.find((c) => c.id === characterId) || MASCOT_CHARACTERS[0];
  const { directions, reactions } = getMascotAssetPaths(characterId);

  // 过滤后的角色列表
  const filteredCharacters = useMemo(() => {
    let list = MASCOT_CHARACTERS;
    if (activeCategory !== 'all') {
      list = list.filter((c) => c.category === activeCategory);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
    }
    return list;
  }, [activeCategory, searchQuery]);

  return (
    <>
      {/* 任意可拖拽浮动挂件容器：GPU 硬件加速位移（translate3d），0 layout 重排，0 延迟阻滞 */}
      <div
        className="fixed select-none left-0 top-0 will-change-transform"
        style={{
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
          zIndex: 9980,
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
      >
        <div className="relative group flex flex-col items-center">
          {/* 1. 顶部悬浮胶囊工具栏：重构排版，杜绝折行，充裕呼吸感与物理出场动效 */}
          <div
            style={{ transformOrigin: 'bottom center' }}
            className={`absolute -top-11 left-1/2 -translate-x-1/2 flex items-center gap-1 px-1.5 py-1 rounded-full bg-paper/95 border border-paper-grid/80 shadow-[0_4px_16px_rgba(0,0,0,0.08)] backdrop-blur-md whitespace-nowrap pointer-events-auto transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${
              isDragging
                ? 'opacity-0 translate-y-2 scale-95 pointer-events-none duration-75'
                : 'opacity-0 translate-y-1 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100'
            }`}
          >
            {/* 反馈入口按钮 */}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setIsFeedbackOpen(true);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-sans font-medium text-ink-light hover:text-accent hover:bg-accent/10 active:scale-[0.96] transition-[background-color,color,transform] duration-150 cursor-pointer"
            >
              <MessageSquareHeart size={13} strokeWidth={1.75} className="text-accent shrink-0" />
              <span>反馈建议</span>
            </button>

            {/* 极简轻柔间距点 */}
            <span className="w-0.5 h-3 bg-paper-grid/60 rounded-full shrink-0 select-none" />

            {/* 换装形象选择入口 */}
            <button
              type="button"
              title="切换吉祥物形象"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setIsPickerOpen(true);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-sans font-medium text-ink-light hover:text-accent hover:bg-accent/10 active:scale-[0.96] transition-[background-color,color,transform] duration-150 cursor-pointer"
            >
              <Sparkles size={13} strokeWidth={1.75} className="text-amber-500 shrink-0" />
              <span>角色换装</span>
            </button>

            {/* 极简轻柔间距点 */}
            <span className="w-0.5 h-3 bg-paper-grid/60 rounded-full shrink-0 select-none" />

            {/* 复位到默认右下角 */}
            <button
              type="button"
              title="重置到右下角"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                handleResetPosition();
              }}
              className="p-1 rounded-full text-ink-light hover:text-accent hover:bg-accent/10 active:scale-[0.96] transition-[background-color,color,transform] duration-150 cursor-pointer"
            >
              <RotateCcw size={12} strokeWidth={1.75} className="shrink-0" />
            </button>

            {/* 底部精巧小三角指示器 */}
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-paper border-r border-b border-paper-grid/80 shadow-xs" />
          </div>

          {/* 2. Mascot 核心形象：手感优化，拖拽抓取与悬停升起，拖拽期间冻结内部无用计算 */}
          <div
            className={`transition-[transform,filter] duration-150 ease-out ${
              isDragging
                ? 'scale-[1.06] drop-shadow-[0_16px_32px_rgba(0,0,0,0.18)]'
                : 'group-hover:scale-[1.02] group-hover:drop-shadow-md'
            }`}
          >
            <Mascot
              ref={mascotRef}
              directions={directions}
              reactions={reactions}
              size={WIDGET_SIZE}
              label={currentCharacter.name}
              isDragging={isDragging}
            />
          </div>

          {/* 3. 底部拖动提示胶囊：充裕留白，视觉轻盈 */}
          <div
            className={`absolute -bottom-6.5 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-sans tracking-wide bg-paper/90 border border-paper-grid/50 shadow-xs text-ink-faint whitespace-nowrap pointer-events-none transition-[opacity,transform] duration-150 ${
              isDragging
                ? 'opacity-0 translate-y-1'
                : 'opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0'
            }`}
          >
            <GripHorizontal size={11} strokeWidth={1.75} className="text-ink-faint/80" />
            <span>按住可拖动</span>
          </div>
        </div>
      </div>

      {/* 4. 57 角色换装网格抽屉：分类 Tab、关键词搜索与同心圆弧卡片 */}
      {isPickerOpen && (
        <div
          className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/35 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={() => setIsPickerOpen(false)}
        >
          <div
            className="bg-paper border border-paper-grid rounded-2xl shadow-2xl p-5 max-w-2xl w-full h-[560px] max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 顶栏 */}
            <div className="flex items-center justify-between pb-3 border-b border-paper-grid/80">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-accent" />
                <h3 className="text-base font-serif font-bold text-ink">挑选专属画板吉祥物</h3>
                <span className="text-xs text-ink-faint font-sans tabular-nums">
                  ({MASCOT_CHARACTERS.length} 种形象)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsPickerOpen(false)}
                className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-paper-grid/30 active:scale-[0.96] transition-[background-color,color,transform]"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>

            {/* 搜索与分类 Tab */}
            <div className="pt-3 pb-2 space-y-2.5">
              {/* 搜索输入框 */}
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
                />
                <input
                  type="text"
                  placeholder="搜索形象名称，如 狐狸、小猫、护士、宇航员..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs font-sans rounded-lg border border-paper-grid/80 bg-paper focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink text-xs"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* 分类切换 Tab */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {MASCOT_CATEGORIES.map((cat) => {
                  const isActive = activeCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setActiveCategory(cat.id)}
                      className={`px-3 py-1 rounded-full text-xs font-sans font-medium whitespace-nowrap transition-colors active:scale-[0.96] ${
                        isActive
                          ? 'bg-accent text-paper shadow-xs'
                          : 'bg-paper-grid/20 text-ink-light hover:bg-paper-grid/40 hover:text-ink'
                      }`}
                    >
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 角色网格卡片：min-h-0 保障 flex 稳定，px-2 保障高亮光圈与阴影绝不被 overflow 容器截断，左右对称 */}
            <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2.5 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 content-start">
              {filteredCharacters.map((char) => {
                const isSelected = char.id === characterId;
                return (
                  <button
                    key={char.id}
                    type="button"
                    onClick={() => selectCharacter(char.id)}
                    className={`group/item flex flex-col items-center gap-2 p-2.5 rounded-xl border transition-[border-color,background-color,transform,box-shadow] duration-150 active:scale-[0.96] ${
                      isSelected
                        ? 'border-accent bg-accent/10 shadow-sm ring-1 ring-accent/30'
                        : 'border-paper-grid/70 hover:border-accent/50 hover:bg-paper-grid/20 hover:scale-[1.02]'
                    }`}
                  >
                    <div
                      className="w-14 h-14 relative overflow-hidden rounded-full bg-paper border border-paper-grid/60 group-hover/item:scale-105 transition-transform duration-150"
                      style={{
                        backgroundImage: `url(/mascots/${char.id}-directions.webp)`,
                        backgroundSize: '300% 300%',
                        backgroundPosition: '50% 50%',
                      }}
                    />
                    <div className="flex flex-col items-center gap-0.5 w-full">
                      <span className="text-xs font-sans font-medium text-ink truncate w-full text-center">
                        {char.name}
                      </span>
                      {isSelected ? (
                        <span className="text-[10px] text-accent font-sans font-semibold flex items-center gap-0.5">
                          <Check size={11} strokeWidth={2.5} /> 当前使用
                        </span>
                      ) : (
                        <span className="text-[10px] text-ink-faint font-sans opacity-0 group-hover/item:opacity-100 transition-opacity">
                          点击选用
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
              {filteredCharacters.length === 0 && (
                <div className="col-span-full py-12 text-center text-xs text-ink-faint font-sans">
                  没有找到匹配的形象，换个关键词试试看吧
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 5. 反馈收集表单弹窗 */}
      <FeedbackModal
        open={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
        mascotName={currentCharacter.name}
      />
    </>
  );
};
