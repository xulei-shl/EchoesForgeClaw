/**
 * 文本成图节点：支持多文本组件排版，自由调整字体 / 字号 / 颜色 / 横竖排 / 描边 / 旋转与层级，
 * 浏览器端渲染为高清 PNG 输出（背景默认无 = 透明）。预览与导出共用同一 Canvas 渲染。
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wand2,
  Heart,
  Globe,
  Loader2,
  Check,
  SlidersHorizontal,
  Type,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  RotateCcw,
  RotateCw,
  Trash2,
  Edit3,
} from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  type TextImageItem,
  type TextImageState,
  TEXT_IMAGE_CANVAS,
  TEXT_IMAGE_DEFAULTS,
  getTextImageCanvasPreset,
  normalizeTextImageState,
  composeTextImage,
  downloadTextImage,
  TextImageStudioPanel,
} from '../textimage';
import { DEFAULT_FONT_FAMILY, DEFAULT_TEXT_COLOR, formatFontFamily } from '../journal/text/fontRegistry';
import { usePreloadJournalFonts } from '../journal/text/FontControls';
import { textFontSize } from '../journal/text/drawText';

export interface TextImageNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 节点持久化数据 */
  data?: Partial<TextImageState>;
  isFavorited?: boolean;
  isPublic?: boolean;
  isSelected?: boolean;
  recordDeleted?: boolean;
  onSelect?: (id: string) => void;
  onRemove?: (id: string) => void;
  onToggleFavorite?: (id: string) => Promise<boolean>;
  onTogglePublic?: (id: string) => Promise<boolean>;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  mismatchBadge?: string | null;
  /** 样式更新写入 node.data（undoable=true 记撤销历史，用于离散样式选择） */
  onUpdateState?: (
    id: string,
    patch: Partial<TextImageState>,
    undoable?: boolean
  ) => void;
  /** 导出文本图片：PNG Data URL 落盘保存 + 写入历史数据库 */
  onExport?: (id: string, dataUrl: string, state: TextImageState) => Promise<void>;
}

type GestureMode = 'move' | 'resize' | 'rotate';

interface GestureState {
  mode: GestureMode;
  itemId: string;
  startPx: number;
  startPy: number;
  startX: number;
  startY: number;
  startW: number;
  startAngle: number;
  startPointerAngle: number;
  centerPx: number;
  centerPy: number;
}

/** 指针相对中心的方向角（deg，以上方为 0，顺时针为正） */
const pointerAngleOf = (px: number, py: number, cx: number, cy: number) =>
  (Math.atan2(px - cx, -(py - cy)) * 180) / Math.PI;

const W_MIN = 2;
const W_MAX = 50;

/** 透明底棋盘格衬托（PNG alpha 可视化） */
const checkerStyle: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, rgba(23,23,23,0.06) 25%, transparent 25%, transparent 75%, rgba(23,23,23,0.06) 75%), linear-gradient(45deg, rgba(23,23,23,0.06) 25%, transparent 25%, transparent 75%, rgba(23,23,23,0.06) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px',
};

/**
 * 单个文本组件渲染视图（支持拖拽、缩放字号、旋转手柄、描边与高保真排版）
 */
interface TextImageItemViewProps {
  item: TextImageItem;
  selected: boolean;
  isGesturing: boolean;
  stageWidth: number;
  disabled?: boolean;
  onSelect: () => void;
  onOpenEdit: () => void;
  onGestureStart: (e: React.PointerEvent<HTMLElement>, item: TextImageItem, mode: GestureMode) => void;
  onGestureMove: (e: React.PointerEvent<HTMLElement>) => void;
  onGestureEnd: (e: React.PointerEvent<HTMLElement>) => void;
}

const TextImageItemView: React.FC<TextImageItemViewProps> = ({
  item,
  selected,
  isGesturing,
  stageWidth,
  disabled = false,
  onSelect,
  onOpenEdit,
  onGestureStart,
  onGestureMove,
  onGestureEnd,
}) => {
  const isVertical = item.writingMode === 'vertical';
  const fontSizePx = textFontSize(item.w, stageWidth || 360);
  const strokeWidthPx =
    item.strokeEnabled && item.strokeWidth
      ? Math.max(1, (item.strokeWidth * (stageWidth || 360)) / TEXT_IMAGE_CANVAS)
      : 0;

  return (
    <div
      data-text-item
      className={`absolute group/titem touch-none ${
        isGesturing ? 'will-change-transform select-none' : ''
      }`}
      style={{
        left: `${item.x}%`,
        top: `${item.y}%`,
        width: 'max-content',
        maxWidth: '92%',
        zIndex: selected ? 800 + item.z : item.z,
        transform: `translate(-50%, -50%) rotate(${item.angle}deg)`,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {/* 文本内容区域（支持横排/竖排、双击快速编辑、拖动） */}
      <div
        onPointerDown={(e) => onGestureStart(e, item, 'move')}
        onPointerMove={onGestureMove}
        onPointerUp={onGestureEnd}
        onPointerCancel={onGestureEnd}
        onDoubleClick={() => {
          if (!disabled) onOpenEdit();
        }}
        className={`cursor-move select-none transition-[outline,box-shadow] duration-150 ease-out rounded px-2 py-1 ${
          selected ? 'outline outline-2 outline-accent ring-2 ring-white/80 shadow-md' : ''
        }`}
        style={{
          fontFamily: formatFontFamily(item.fontFamily || DEFAULT_FONT_FAMILY),
          fontSize: `${fontSizePx}px`,
          color: item.color || DEFAULT_TEXT_COLOR,
          lineHeight: 1.35,
          textShadow: '0 1px 2px rgba(15,23,42,0.08)',
          WebkitTextStroke: strokeWidthPx > 0 ? `${strokeWidthPx}px ${item.strokeColor || '#ffffff'}` : undefined,
          ...(isVertical
            ? {
                writingMode: 'vertical-rl',
                textOrientation: 'mixed',
                letterSpacing: '0.12em',
                whiteSpace: 'pre-wrap',
                textAlign: item.textAlign === 'left' ? 'start' : item.textAlign === 'right' ? 'end' : 'center',
              }
            : {
                writingMode: 'horizontal-tb',
                whiteSpace: 'pre-wrap',
                textAlign: item.textAlign || 'center',
              }),
        }}
      >
        {item.text || ''}
      </div>

      {/* 选中态：右下角缩放手柄与底部旋转手柄 */}
      {selected && !disabled && (
        <>
          {/* 右下角缩放手柄：利用 before 伪元素扩展至 36px 隐形触控热区，外观保持 16px 精致尺寸 */}
          <div
            role="button"
            aria-label="拖拽调整字号大小"
            onPointerDown={(e) => onGestureStart(e, item, 'resize')}
            onPointerMove={onGestureMove}
            onPointerUp={onGestureEnd}
            onPointerCancel={onGestureEnd}
            title="拖拽调整字号大小"
            className="absolute -right-2 -bottom-2 w-4 h-4 rounded-full bg-accent border-2 border-white shadow-md cursor-nwse-resize hover:scale-110 active:scale-[0.96] transition-transform duration-150 ease-out flex items-center justify-center z-20 before:absolute before:-inset-2.5 before:content-['']"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white/80 pointer-events-none" />
          </div>

          {/* 底部居中旋转手柄与引线：利用 before 伪元素扩展至 36px 隐形触控热区 */}
          <div className="absolute left-1/2 -bottom-6 -translate-x-1/2 flex flex-col items-center pointer-events-none z-20">
            <div className="w-px h-2 bg-accent/70" />
            <div
              role="button"
              aria-label="拖拽旋转角度（Shift 键 15° 步进，支持 90° 软吸附）"
              onPointerDown={(e) => onGestureStart(e, item, 'rotate')}
              onPointerMove={onGestureMove}
              onPointerUp={onGestureEnd}
              onPointerCancel={onGestureEnd}
              title="拖拽旋转角度 (按住 Shift 可 15° 步进，接近正向自动吸附)"
              className="w-4 h-4 rounded-full bg-accent border-2 border-white shadow-md cursor-grab active:cursor-grabbing hover:scale-110 active:scale-[0.96] transition-transform duration-150 ease-out pointer-events-auto flex items-center justify-center before:absolute before:-inset-2.5 before:content-['']"
            >
              <div className="w-1 h-1 rounded-full bg-white/90 pointer-events-none" />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const TextImageNodeInner: React.FC<TextImageNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  data,
  isFavorited = false,
  isPublic = false,
  isSelected = false,
  recordDeleted = false,
  onSelect,
  onRemove,
  onToggleFavorite,
  onTogglePublic,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  mismatchBadge,
  onUpdateState,
  onExport,
}) => {
  const { showToast } = useFeedback();

  // 受控于 node.data：补齐默认值与历史数据
  const st = useMemo(() => normalizeTextImageState(data), [data]);

  const commit = useCallback(
    (p: Partial<TextImageState>, undoable = true) => {
      onUpdateState?.(id, p, undoable);
    },
    [id, onUpdateState]
  );

  // 本地文本组件列表
  const [items, setItems] = useState<TextImageItem[]>(st.items);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // 外部数据变更同步
  useEffect(() => {
    setItems(st.items);
  }, [st.items]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [isAddingNewText, setIsAddingNewText] = useState(false);
  const [activeGestureId, setActiveGestureId] = useState<string | null>(null);

  const [isWorking, setIsWorking] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const rafIdRef = useRef<number | null>(null);
  const latestPointerRef = useRef<{ clientX: number; clientY: number; shiftKey: boolean } | null>(null);

  // 清理可能未执行的手势 rAF 调度
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // 预加载全部手账字体预设
  usePreloadJournalFonts();

  // 监听舞台尺寸
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const box =
        'contentBoxSize' in entry && entry.contentBoxSize?.[0]
          ? { w: entry.contentBoxSize[0].inlineSize, h: entry.contentBoxSize[0].blockSize }
          : { w: entry.contentRect.width, h: entry.contentRect.height };
      setStageSize({ w: Math.round(box.w), h: Math.round(box.h) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (data?.imageUrl) setIsEditing(false);
    else setIsEditing(true);
  }, [data?.imageUrl]);

  // 节点失焦时自动清空内部组件选中与编辑态
  useEffect(() => {
    if (!isSelected) {
      setSelectedId(null);
      setEditingTextId(null);
      setIsAddingNewText(false);
    }
  }, [isSelected]);

  // 当前选中的文本项
  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedId) || null,
    [items, selectedId]
  );

  // 点击画板空白区域取消选中
  const handleCanvasBlankPointerDown = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest('[data-text-item]')) {
      setSelectedId(null);
    }
  }, []);

  // 更新单个文本项
  const handleUpdateItem = useCallback(
    (itemId: string, patch: Partial<TextImageItem>, undoable = true) => {
      setItems((prev) => {
        const next = prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it));
        commit({ items: next }, undoable);
        return next;
      });
    },
    [commit]
  );

  // 删除单个文本项
  const handleDeleteItem = useCallback(
    (itemId: string) => {
      const next = items.filter((it) => it.id !== itemId);
      setItems(next);
      setSelectedId(null);
      commit({ items: next }, true);
    },
    [items, commit]
  );

  // 图层层级调整
  const handleBumpLayer = useCallback(
    (itemId: string, mode: 'up' | 'down' | 'top' | 'bottom') => {
      setItems((prev) => {
        const target = prev.find((it) => it.id === itemId);
        if (!target) return prev;
        const sorted = [...prev].sort((a, b) => a.z - b.z);
        const idx = sorted.findIndex((it) => it.id === itemId);
        if (idx === -1) return prev;

        if (mode === 'up' && idx < sorted.length - 1) {
          const nextTarget = sorted[idx + 1];
          const tmp = target.z;
          target.z = nextTarget.z;
          nextTarget.z = tmp;
        } else if (mode === 'down' && idx > 0) {
          const prevTarget = sorted[idx - 1];
          const tmp = target.z;
          target.z = prevTarget.z;
          prevTarget.z = tmp;
        } else if (mode === 'top') {
          const maxZ = sorted[sorted.length - 1].z;
          target.z = maxZ + 1;
        } else if (mode === 'bottom') {
          const minZ = sorted[0].z;
          target.z = minZ - 1;
        }
        const reindexed = [...sorted].sort((a, b) => a.z - b.z).map((it, i) => ({ ...it, z: i + 1 }));
        commit({ items: reindexed }, true);
        return reindexed;
      });
    },
    [commit]
  );

  // 90度步进旋转
  const handleRotateStep = useCallback(
    (itemId: string, mode: 'cw' | 'ccw') => {
      setItems((prev) => {
        const next = prev.map((it) => {
          if (it.id !== itemId) return it;
          const delta = mode === 'cw' ? 90 : -90;
          const nextAngle = (Math.round((it.angle + delta) / 90) * 90) % 360;
          return { ...it, angle: nextAngle };
        });
        commit({ items: next }, true);
        return next;
      });
    },
    [commit]
  );

  // 快捷键：Delete / Backspace 快速删除，Escape 取消选中
  useEffect(() => {
    if (!isSelected || !selectedId || editingTextId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteItem(selectedId);
        showToast('已删除文本组件', { type: 'info' });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelected, selectedId, editingTextId, handleDeleteItem, showToast]);

  // 添加文本：弹出输入框（对齐手账制作交互规范）
  const handleAddText = useCallback(() => {
    setIsAddingNewText(true);
    setEditingTextId('new');
    setEditingText('');
    setTimeout(() => textInputRef.current?.focus(), 50);
  }, []);

  // 取消文本编辑
  const handleCancelTextEdit = useCallback(() => {
    setIsAddingNewText(false);
    setEditingTextId(null);
    setEditingText('');
  }, []);

  // 确认文本编辑 / 新增
  const confirmTextEdit = useCallback(() => {
    if (!editingTextId) return;

    if (isAddingNewText && editingTextId === 'new') {
      const textContent = editingText.trim() || '手写文字';
      const maxZ = items.reduce((m, it) => Math.max(m, it.z), 0);
      const count = items.length;
      const newItem: TextImageItem = {
        id: 'txt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        text: textContent,
        fontFamily: DEFAULT_FONT_FAMILY,
        w: 9,
        color: DEFAULT_TEXT_COLOR,
        writingMode: 'horizontal',
        textAlign: 'center',
        x: Math.min(85, Math.max(15, 50 + ((count % 5) - 2) * 6)),
        y: Math.min(85, Math.max(15, 50 + ((count % 5) - 2) * 6)),
        angle: 0,
        z: maxZ + 1,
        strokeEnabled: false,
        strokeColor: '#ffffff',
        strokeWidth: 4,
      };
      const nextItems = [...items, newItem];
      setItems(nextItems);
      commit({ items: nextItems }, true);
      setSelectedId(newItem.id);
      setIsAddingNewText(false);
      setEditingTextId(null);
      setEditingText('');
      showToast('已添加文本组件', { type: 'success' });
      return;
    }

    const nextItems = items.map((it) =>
      it.id === editingTextId ? { ...it, text: editingText.trim() || '手写文字' } : it
    );
    setItems(nextItems);
    commit({ items: nextItems }, true);
    setIsAddingNewText(false);
    setEditingTextId(null);
    setEditingText('');
  }, [editingTextId, isAddingNewText, editingText, items, commit, showToast]);

  // 文本弹窗快捷键
  const handleTextKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelTextEdit();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      confirmTextEdit();
    }
  };

  // ---- 手势：拖移 / 缩放 / 旋转（本地实时更新，pointerup 统一提交）----
  const beginGesture = (
    e: React.PointerEvent<HTMLElement>,
    item: TextImageItem,
    mode: GestureMode
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect?.(id);
    const stage = stageRef.current;
    if (!stage) return;

    let centerPx = 0;
    let centerPy = 0;
    let startPointerAngle = 0;
    if (mode === 'rotate') {
      const el = (e.currentTarget as HTMLElement).closest('[data-text-item]') as HTMLElement | null;
      const box = el?.getBoundingClientRect();
      if (box) {
        centerPx = box.left + box.width / 2;
        centerPy = box.top + box.height / 2;
        startPointerAngle = pointerAngleOf(e.clientX, e.clientY, centerPx, centerPy);
      }
    }

    gestureRef.current = {
      mode,
      itemId: item.id,
      startPx: e.clientX,
      startPy: e.clientY,
      startX: item.x,
      startY: item.y,
      startW: item.w,
      startAngle: item.angle,
      startPointerAngle,
      centerPx,
      centerPy,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setSelectedId(item.id);
    setActiveGestureId(item.id);
  };

  const moveGesture = (e: React.PointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    const stage = stageRef.current;
    if (!g || !stage) return;
    e.stopPropagation();

    // 记录最新一帧的指针位置与按键状态
    latestPointerRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      shiftKey: e.shiftKey,
    };

    // 已有 rAF 正在等待渲染周期，则无需重复注册，直接等待下一帧绘制
    if (rafIdRef.current !== null) return;

    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const ptr = latestPointerRef.current;
      const currentG = gestureRef.current;
      const currentStage = stageRef.current;
      if (!ptr || !currentG || !currentStage) return;

      const rect = currentStage.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      setItems((prev) =>
        prev.map((it) => {
          if (it.id !== currentG.itemId) return it;
          if (currentG.mode === 'move') {
            const dx = ((ptr.clientX - currentG.startPx) / rect.width) * 100;
            const dy = ((ptr.clientY - currentG.startPy) / rect.height) * 100;
            return {
              ...it,
              x: Math.round((currentG.startX + dx) * 10) / 10,
              y: Math.round((currentG.startY + dy) * 10) / 10,
            };
          }
          if (currentG.mode === 'resize') {
            const dw = ((ptr.clientX - currentG.startPx) / rect.width) * 100;
            return {
              ...it,
              w: Math.min(W_MAX, Math.max(W_MIN, Math.round((currentG.startW + dw) * 10) / 10)),
            };
          }
          // 旋转：增量旋转 + 磁吸 / Shift 步进
          const delta =
            pointerAngleOf(ptr.clientX, ptr.clientY, currentG.centerPx, currentG.centerPy) -
            currentG.startPointerAngle;
          const rawAngle = (currentG.startAngle + delta) % 360;
          let normalizedAngle = rawAngle < 0 ? rawAngle + 360 : rawAngle;

          if (ptr.shiftKey) {
            // 按住 Shift 键按 15° 步进约束
            normalizedAngle = Math.round(normalizedAngle / 15) * 15;
          } else {
            // 磁性软吸附：接近 0°/90°/180°/270°/360° (±3° 以内) 自动平滑归正
            const snapAngles = [0, 90, 180, 270, 360];
            for (const snap of snapAngles) {
              if (Math.abs(normalizedAngle - snap) <= 3) {
                normalizedAngle = snap === 360 ? 0 : snap;
                break;
              }
            }
          }
          return { ...it, angle: Math.round(normalizedAngle * 10) / 10 };
        })
      );
    });
  };

  const endGesture = (e: React.PointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    if (!g) return;
    e.stopPropagation();

    // 取消尚未派发的下一帧 rAF
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    latestPointerRef.current = null;

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* 未捕获时忽略 */
    }
    gestureRef.current = null;
    setActiveGestureId(null);
    commit({ items: itemsRef.current }, true);
  };

  // 生成：全分辨率 1080×1080 导出 PNG data URL
  const handleGenerate = useCallback(async () => {
    if (isWorking || isExporting) return;
    if (items.length === 0) {
      showToast('请先添加至少一段文字', { type: 'warning' });
      return;
    }
    setIsWorking(true);
    try {
      const resultDataUrl = await composeTextImage({ ...st, items });
      commit({ imageUrl: resultDataUrl, isSaved: false }, true);
      setIsEditing(false);
      setSelectedId(null);
      showToast('文本成图已生成（可点击保存按钮写入数据库）', { type: 'success' });
    } catch (err: any) {
      console.error('生成文本图片失败:', err);
      showToast(err?.message || '生成文本图片失败，请重试', { type: 'error' });
    } finally {
      setIsWorking(false);
    }
  }, [items, st, isWorking, isExporting, commit, showToast]);

  // 独立保存到数据库
  const handleSaveToDatabase = useCallback(async () => {
    const imgUrl = data?.imageUrl;
    if (!imgUrl || isExporting || !onExport) return;
    setIsExporting(true);
    try {
      await onExport(id, imgUrl, { ...st, items, imageUrl: imgUrl, isSaved: true });
      commit({ isSaved: true }, false);
      onSelect?.(id);
      showToast('文本成图已保存到数据库，已解锁公开与收藏', { type: 'success' });
    } catch (err: any) {
      console.error('保存到数据库失败:', err);
      showToast(err?.detail || err?.message || '保存失败，请重试', { type: 'error' });
    } finally {
      setIsExporting(false);
    }
  }, [data?.imageUrl, isExporting, onExport, id, st, items, commit, onSelect, showToast]);

  const handleDownload = useCallback(() => {
    const url = data?.imageUrl;
    if (!url) return;
    downloadTextImage(url, `text-image-${Date.now()}.png`);
    showToast('文本图片已下载', { type: 'success' });
  }, [data?.imageUrl, showToast]);

  const handleReset = useCallback(() => {
    setIsEditing(true);
    setSelectedId(null);
    commit({ ...TEXT_IMAGE_DEFAULTS, imageUrl: null, isSaved: false }, true);
    showToast('已重置文字与样式', { type: 'success' });
  }, [commit, showToast]);

  const runToggle = async (
    fn: ((id: string) => Promise<boolean>) | undefined,
    okMsg: (active: boolean) => string
  ) => {
    if (!fn) return;
    try {
      const active = await fn(id);
      showToast(okMsg(active), { type: 'success' });
    } catch {
      showToast('操作失败，请重试', { type: 'error' });
    }
  };

  const hasGenerated = Boolean(data?.imageUrl && !isEditing);
  const isSaved = Boolean(data?.isSaved);
  const busy = isWorking || isExporting;
  const locked = false;

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '文本成图'}
      dotColor={NODE_COLORS.text_image || 'oklch(0.68 0.15 195)'}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 440, height: 640 }}
      className={`transition-[opacity,transform,box-shadow,border-color] duration-150 ease-out ${
        isSelected ? 'ring-2 ring-accent/70 shadow-md' : ''
      }`}
      showLeftAnchor={false}
      showRightAnchor={true}
      onClick={() => onSelect?.(id)}
      footer={footer}
      mismatchBadge={mismatchBadge}
      sideDrawer={
        isEditing ? (
          <TextImageStudioPanel
            isOpen={isDrawerOpen}
            onClose={() => setIsDrawerOpen(false)}
            state={{ ...st, items }}
            selectedItem={selectedItem}
            onUpdateState={(p, undoable) => commit(p, undoable)}
            onUpdateItem={(itemId, patch, undoable) => handleUpdateItem(itemId, patch, undoable)}
            disabled={locked}
          />
        ) : undefined
      }
      actionBar={
        <NodeActionBar>
          {hasGenerated ? (
            <>
              <NodeActionBar.Retry
                onClick={() => setIsEditing(true)}
                disabled={busy}
                tooltip="返回编辑模式"
                aria-label="返回编辑模式"
              />
              <NodeActionBar.Custom
                icon={<Check size={16} strokeWidth={isSaved ? 2.5 : 1.5} className={isSaved ? 'text-accent' : ''} />}
                onClick={handleSaveToDatabase}
                disabled={busy || isSaved}
                tooltip={isSaved ? '已保存到数据库' : '保存到数据库（保存后可公开/收藏）'}
                aria-label={isSaved ? '已保存到数据库' : '保存到数据库'}
                className={isSaved ? 'text-accent opacity-70' : 'text-ink-light hover:text-accent'}
              />
              <NodeActionBar.Custom
                icon={
                  <Heart
                    size={16}
                    strokeWidth={1.5}
                    className={isSaved && isFavorited ? 'fill-accent text-accent' : ''}
                  />
                }
                tooltip={!isSaved ? '请先保存到数据库后再收藏' : isFavorited ? '取消收藏' : '收藏'}
                aria-label={!isSaved ? '请先保存到数据库后再收藏' : isFavorited ? '取消收藏' : '收藏'}
                onClick={() =>
                  isSaved && runToggle(onToggleFavorite, (act) => (act ? '已收藏' : '已取消收藏'))
                }
                disabled={!isSaved || busy || !onToggleFavorite}
              />
              <NodeActionBar.Custom
                icon={<Globe size={16} strokeWidth={1.5} className={isSaved && isPublic ? 'text-accent' : ''} />}
                tooltip={!isSaved ? '请先保存到数据库后再公开' : isPublic ? '从画廊撤下' : '公开到画廊'}
                aria-label={!isSaved ? '请先保存到数据库后再公开' : isPublic ? '从画廊撤下' : '公开到画廊'}
                onClick={() =>
                  isSaved && runToggle(onTogglePublic, (act) => (act ? '已公开' : '已撤下'))
                }
                disabled={!isSaved || busy || !onTogglePublic}
              />
              <NodeActionBar.Download
                onClick={handleDownload}
                disabled={isExporting}
                tooltip="直接下载 PNG"
                aria-label="直接下载文本图片 PNG"
              />
              <NodeActionBar.Reset
                onClick={handleReset}
                disabled={busy}
                tooltip="重置文本与结果"
                aria-label="重置文本与结果"
              />
            </>
          ) : (
            <>
              <NodeActionBar.Custom
                icon={
                  busy ? (
                    <Loader2 size={16} className="animate-spin text-accent" />
                  ) : (
                    <Wand2 size={16} strokeWidth={1.5} />
                  )
                }
                tooltip="生成图片"
                aria-label="生成图片"
                onClick={handleGenerate}
                disabled={busy || locked || items.length === 0}
              />
              <NodeActionBar.Custom
                icon={<Type size={16} strokeWidth={1.5} />}
                tooltip="添加文本（手账同款弹窗录入）"
                aria-label="添加文本"
                onClick={handleAddText}
                disabled={busy || locked}
              />
              <NodeActionBar.Custom
                icon={<SlidersHorizontal size={16} strokeWidth={1.5} className={isDrawerOpen ? 'text-accent' : ''} />}
                tooltip={isDrawerOpen ? '收起排版调优抽屉' : '展开文本排版调优抽屉'}
                aria-label={isDrawerOpen ? '收起排版调优抽屉' : '展开文本排版调优抽屉'}
                onClick={() => setIsDrawerOpen((prev) => !prev)}
                disabled={busy || locked}
              />
              <NodeActionBar.Reset
                onClick={handleReset}
                disabled={busy}
                tooltip="重置文本与样式"
                aria-label="重置文本与样式"
              />
            </>
          )}
        </NodeActionBar>
      }
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2.5">
        {/* 画布视口区域：外层升级为 rounded-2xl，符合 Concentric Border Radius 同心圆角法则 */}
        <div
          className="relative flex-1 min-h-[260px] w-full overflow-hidden rounded-2xl bg-paper-grid/15 border border-paper-grid/60 flex items-center justify-center select-none p-3 sm:p-4"
          onPointerDown={handleCanvasBlankPointerDown}
          onClick={handleCanvasBlankPointerDown}
        >
          <AnimatePresence initial={false}>
            {!hasGenerated ? (
              <motion.div
                key="editor"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                className="w-full h-full flex items-center justify-center overflow-hidden"
                onPointerDown={handleCanvasBlankPointerDown}
                onClick={handleCanvasBlankPointerDown}
              >
                {/* 自适应卡片舞台 Shell（按选中的比例 1:1, 3:4, 4:3, 9:16, 16:9 即时自适应，移除昂贵的尺寸动画以避免重排） */}
                <div
                  ref={stageRef}
                  className="relative max-w-full max-h-full rounded-xl overflow-hidden shadow-2xs border border-paper-grid/50 flex items-center justify-center"
                  style={{
                    aspectRatio: `${getTextImageCanvasPreset(st.aspectRatio).width} / ${getTextImageCanvasPreset(st.aspectRatio).height}`,
                    width: '100%',
                    backgroundColor: st.backgroundEnabled ? st.backgroundColor : undefined,
                    ...(st.backgroundEnabled ? {} : checkerStyle),
                  }}
                  onPointerDown={handleCanvasBlankPointerDown}
                  onClick={handleCanvasBlankPointerDown}
                >
                  {/* 空文本提示（纠正方向指引至右上角 NodeActionBar） */}
                  {items.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-ink-faint/70 gap-2 p-6 text-center pointer-events-none z-10">
                      <Type size={32} strokeWidth={1.2} />
                      <p className="text-xs">点击右上角「添加文本」按钮开始创作</p>
                    </div>
                  )}

                  {/* 选中文本组件时的极简微交互悬浮工具栏（智能上下避让：文字靠顶时切换至底端） */}
                  {selectedItem && (
                    <div
                      className={`absolute left-1/2 -translate-x-1/2 z-40 pointer-events-auto flex items-center gap-1 px-1.5 py-1 rounded-xl bg-paper/95 backdrop-blur-md shadow-md border border-paper-grid/80 select-none text-xs transition-[top,bottom,opacity] duration-150 ease-out ${
                        selectedItem.y < 22 ? 'bottom-2' : 'top-2'
                      }`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* 快速编辑文案 */}
                      <Tooltip content="编辑文字内容 (或双击文字)">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setIsAddingNewText(false);
                            setEditingTextId(selectedItem.id);
                            setEditingText(selectedItem.text || '');
                            setTimeout(() => textInputRef.current?.select(), 50);
                          }}
                          className="w-6.5 h-6.5 rounded-md flex items-center justify-center text-ink-light hover:text-accent hover:bg-paper-grid/40 active:scale-[0.96] transition-transform duration-150 ease-out cursor-pointer"
                          aria-label="编辑文字"
                        >
                          <Edit3 size={13} strokeWidth={2} />
                        </button>
                      </Tooltip>

                      <div className="w-px h-3 bg-paper-grid/70 my-auto shrink-0" />

                      {/* 图层控制：上移、下移、置顶、置底 */}
                      <div className="flex items-center gap-0.5">
                        {(
                          [
                            ['up', ArrowUp, '上移一层'],
                            ['down', ArrowDown, '下移一层'],
                            ['top', ChevronsUp, '置顶'],
                            ['bottom', ChevronsDown, '置底'],
                          ] as const
                        ).map(([mode, Icon, tip]) => (
                          <Tooltip key={mode} content={tip}>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleBumpLayer(selectedItem.id, mode)}
                              className="w-6 h-6 rounded-md flex items-center justify-center text-ink-light hover:text-accent hover:bg-paper-grid/40 active:scale-[0.96] transition-transform duration-150 ease-out disabled:opacity-40 cursor-pointer"
                              aria-label={tip}
                            >
                              <Icon size={12} strokeWidth={2} />
                            </button>
                          </Tooltip>
                        ))}
                      </div>

                      <div className="w-px h-3 bg-paper-grid/70 my-auto shrink-0" />

                      {/* 旋转控制：逆时针 90°、顺时针 90° */}
                      <div className="flex items-center gap-0.5">
                        <Tooltip content="逆时针旋转 90°">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleRotateStep(selectedItem.id, 'ccw')}
                            className="w-6 h-6 rounded-md flex items-center justify-center text-ink-light hover:text-accent hover:bg-paper-grid/40 active:scale-[0.96] transition-transform duration-150 ease-out disabled:opacity-40 cursor-pointer"
                            aria-label="逆时针旋转 90°"
                          >
                            <RotateCcw size={12} strokeWidth={2} />
                          </button>
                        </Tooltip>
                        <Tooltip content="顺时针旋转 90°">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleRotateStep(selectedItem.id, 'cw')}
                            className="w-6 h-6 rounded-md flex items-center justify-center text-ink-light hover:text-accent hover:bg-paper-grid/40 active:scale-[0.96] transition-transform duration-150 ease-out disabled:opacity-40 cursor-pointer"
                            aria-label="顺时针旋转 90°"
                          >
                            <RotateCw size={12} strokeWidth={2} />
                          </button>
                        </Tooltip>
                      </div>

                      <div className="w-px h-3 bg-paper-grid/70 my-auto shrink-0" />

                      {/* 侧边排版抽屉快捷打开 */}
                      <Tooltip content={isDrawerOpen ? '收起排版调优抽屉' : '展开文本排版调优抽屉 (字体/字号/颜色/排版/描边)'}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setIsDrawerOpen(!isDrawerOpen)}
                          className={`w-6.5 h-6.5 rounded-md flex items-center justify-center active:scale-[0.96] transition-transform duration-150 ease-out cursor-pointer ${
                            isDrawerOpen
                              ? 'bg-accent/15 text-accent'
                              : 'text-ink-light hover:text-accent hover:bg-paper-grid/40'
                          }`}
                          aria-label="排版调优抽屉"
                        >
                          <SlidersHorizontal size={12} strokeWidth={2} />
                        </button>
                      </Tooltip>

                      <div className="w-px h-3 bg-paper-grid/70 my-auto shrink-0" />

                      {/* 删除按钮 */}
                      <Tooltip content="删除该文字 (Delete)">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleDeleteItem(selectedItem.id)}
                          className="w-6.5 h-6.5 rounded-md flex items-center justify-center text-ink-faint hover:text-error hover:bg-error/15 active:scale-[0.96] transition-transform duration-150 ease-out disabled:opacity-40 cursor-pointer"
                          aria-label="删除该文字"
                        >
                          <Trash2 size={13} strokeWidth={2} />
                        </button>
                      </Tooltip>
                    </div>
                  )}

                  {/* 文本组件列表 */}
                  {[...items]
                    .sort((a, b) => a.z - b.z)
                    .map((item) => (
                      <TextImageItemView
                        key={item.id}
                        item={item}
                        selected={selectedId === item.id}
                        isGesturing={activeGestureId === item.id}
                        stageWidth={stageSize.w}
                        disabled={busy}
                        onSelect={() => {
                          onSelect?.(id);
                          setSelectedId(item.id);
                          setIsDrawerOpen(true);
                        }}
                        onOpenEdit={() => {
                          setIsAddingNewText(false);
                          setEditingTextId(item.id);
                          setEditingText(item.text || '');
                          setTimeout(() => textInputRef.current?.select(), 50);
                        }}
                        onGestureStart={beginGesture}
                        onGestureMove={moveGesture}
                        onGestureEnd={endGesture}
                      />
                    ))}

                  {/* 文本添加 / 编辑弹窗浮层 */}
                  {editingTextId && (
                    <div
                      className="absolute z-[1000] flex flex-col gap-2 p-2.5 rounded-xl bg-paper/95 backdrop-blur-md shadow-2xl border border-paper-grid/60"
                      style={{
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: 270,
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between text-xs text-ink-light px-0.5 select-none">
                        <span className="font-medium text-ink">
                          {editingTextId === 'new' ? '添加文本' : '编辑文本'}
                        </span>
                        <span className="text-[10px] text-ink-faint">Enter 确认 · Shift+Enter 换行</span>
                      </div>
                      <textarea
                        ref={textInputRef}
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onKeyDown={handleTextKeyDown}
                        className="w-full h-20 resize-none rounded-lg border border-paper-grid/60 bg-paper px-2.5 py-1.5 text-xs text-ink leading-relaxed outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 transition font-sans"
                        autoFocus
                        placeholder="输入文本内容…"
                      />
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={handleCancelTextEdit}
                          className="px-2.5 py-1 text-xs text-ink-light rounded-md hover:bg-paper-grid/30 active:scale-[0.96] transition cursor-pointer"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={confirmTextEdit}
                          className="flex items-center gap-1 px-3 py-1 text-xs text-white font-medium bg-accent rounded-md hover:bg-accent-hover active:scale-[0.96] shadow-sm transition cursor-pointer"
                        >
                          <Check size={12} strokeWidth={2.5} />
                          确认
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="preview"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                className="relative w-full h-full flex items-center justify-center"
              >
                {st.imageUrl ? (
                  <div className="relative max-w-full max-h-full flex items-center justify-center p-2.5 rounded-2xl bg-paper border border-paper-grid/60 shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_16px_48px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.02)]">
                    <img
                      src={st.imageUrl}
                      alt="Text Image Output"
                      className="max-w-full max-h-[520px] rounded-lg object-contain select-none pointer-events-none drop-shadow-sm"
                    />
                  </div>
                ) : (
                  <div className="text-xs text-ink-faint">暂无文本成图结果</div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 状态与弱提示 */}
        {recordDeleted && hasGenerated && !isExporting && (
          <div className="flex items-center justify-end gap-1.5 text-right text-xs text-ink-faint font-sans">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/60" />
            记录已删除 · 收藏将重新生成记录
          </div>
        )}
      </div>
    </CanvasNode>
  );
};

export const TextImageNode = memo(TextImageNodeInner);
TextImageNode.displayName = 'TextImageNode';
export default TextImageNode;

