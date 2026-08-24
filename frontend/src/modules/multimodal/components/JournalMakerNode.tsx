import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wand2,
  Heart,
  Globe,
  Upload,
  Trash2,
  Eraser,
  Loader2,
  Check,
  Shuffle,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  RotateCcw,
  RotateCw,
  Type,
} from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import { ColorPickerPopover } from '../../../platform/components/ui/ColorPicker';
import { Slider } from '../../../platform/components/ui/Slider';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import { removeImageBackground } from '../sticker';
import {
  type JournalBackground,
  type JournalMakerItem,
  type JournalMakerState,
  type JournalPagePresetId,
  JOURNAL_PAGE_PRESETS,
  JOURNAL_BG_PRESETS,
  JOURNAL_DEFAULTS,
  journalPagePresetOf,
  journalBackgroundCss,
  journalBackgroundKey,
  normalizeJournalBackground,
  deriveTintMesh,
  updateBackgroundOpacity,
  defaultPlacement,
  defaultTextPlacement,
  nextJournalItemId,
  randomizeLayout,
  snapRotateCw,
  snapRotateCcw,
  composeJournalPage,
  DEFAULT_TEXT,
  DEFAULT_FONT_FAMILY,
  DEFAULT_TEXT_COLOR,
  usePreloadJournalFonts,
  JournalTextItem,
  JournalTextToolbar,
  downloadJournalImage,
} from '../journal';

export interface JournalMakerNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 节点持久化数据 */
  data?: Partial<JournalMakerState> & {
    imageUrl?: string | null;
    isExporting?: boolean;
    error?: string | null;
  };
  /** 上游素材来源（直连图片上级 + 图书元数据封面，并集装载） */
  upstreamImages?: string[];
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
  hasDownstream?: boolean;
  mismatchBadge?: string | null;
  /** 状态更新写入 node.data（undoable=true 记撤销历史，用于用户排版动作） */
  onUpdateState?: (
    id: string,
    patch: Partial<JournalMakerState>,
    undoable?: boolean
  ) => void;
  /** 导出手账页：PNG Data URL 落盘保存 + 写入历史数据库 */
  onExport?: (id: string, dataUrl: string, state: JournalMakerState) => Promise<void>;
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

const W_MIN = 6;
const W_MAX = 120;

/** 会话级抠图缓存：同一 src 不重复跑 U²-Net */
const mattingCache = new Map<string, string>();

const JournalMakerNodeInner: React.FC<JournalMakerNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  data = {},
  upstreamImages,
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
  hasDownstream,
  mismatchBadge,
  onUpdateState,
  onExport,
}) => {
  const { showToast } = useFeedback();

  // 1. 拼贴项：本地态为渲染事实来源，手势结束才提交 node.data（一次手势一条撤销历史）
  const [items, setItems] = useState<JournalMakerItem[]>(data.items ?? []);
  const [background, setBackground] = useState<JournalBackground>(
    normalizeJournalBackground(data.background)
  );
  const [pageSize, setPageSize] = useState<JournalPagePresetId>(
    (data.pageSize as JournalPagePresetId) || JOURNAL_DEFAULTS.pageSize
  );
  const [removeBackground, setRemoveBackground] = useState<boolean>(
    data.removeBackground !== undefined ? data.removeBackground : JOURNAL_DEFAULTS.removeBackground
  );
  const [isWorking, setIsWorking] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [mattingProgress, setMattingProgress] = useState<{ done: number; total: number; modelPct?: number } | null>(null);
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [activeGestureId, setActiveGestureId] = useState<string | null>(null);

  const pageRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // 预加载所有手账字体预设
  usePreloadJournalFonts();
  /** items 实时镜像（手势结束提交用，避免在 setState updater 内做副作用） */
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  /** 手账页 contain-fit 尺寸（ResizeObserver 测容器后按预设比例计算） */
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
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

  const uploadedImages = useMemo(() => data.uploadedImages ?? [], [data.uploadedImages]);
  const dismissedSources = useMemo(() => data.dismissedSources ?? [], [data.dismissedSources]);
  const selectedItem = useMemo(() => items.find((it) => it.id === selectedId), [items, selectedId]);

  // 外部数据变更同步（撤销 / 上级触发 patch）
  useEffect(() => {
    setItems(data.items ?? []);
  }, [data.items]);

  useEffect(() => {
    if (data?.imageUrl) setIsEditing(false);
    else setIsEditing(true);
  }, [data?.imageUrl]);

  // 节点失焦时自动清空内部素材选中与文字编辑态
  useEffect(() => {
    if (!isSelected) {
      setSelectedId(null);
      setEditingTextId(null);
    }
  }, [isSelected]);

  // 按 Escape 键取消选中素材
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedId && !editingTextId) {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, editingTextId]);

  // 点击画板空白区域取消素材选中
  const handleCanvasBlankPointerDown = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest('[data-journal-item]')) {
      setSelectedId(null);
    }
  }, []);

  const commit = useCallback(
    (patch: Partial<JournalMakerState>, undoable?: boolean) => {
      onUpdateState?.(id, patch, undoable);
    },
    [id, onUpdateState]
  );

  // 2. 来源同步：上游/封面变更时自动追加新来源，并移除已断开的上级来源项（保留本地上传图）
  useEffect(() => {
    const upstreamSet = new Set(upstreamImages ?? []);
    const uploadSet = new Set(uploadedImages);
    const filtered = items.filter((it) => it.kind === 'text' || uploadSet.has(it.src) || upstreamSet.has(it.src));
    const removed = filtered.length < items.length;

    if (removed) {
      setItems(filtered);
    }

    const known = new Set(filtered.map((it) => it.src));
    const dismissed = new Set(dismissedSources);
    const missing = (upstreamImages ?? []).filter((src) => src && !known.has(src) && !dismissed.has(src));
    if (missing.length > 0) {
      const maxZ = filtered.reduce((m, it) => Math.max(m, it.z), -1);
      const added = missing.map((src, i) => ({
        id: nextJournalItemId(),
        src,
        ...defaultPlacement(),
        z: maxZ + 1 + i,
      }));
      setItems((prev) => {
        const knownNow = new Set(prev.map((it) => it.src));
        const fresh = added.filter((a) => !knownNow.has(a.src));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- items 变化重算；避免循环依赖
  }, [upstreamImages, dismissedSources, uploadedImages, items]);

  const updateParam = (patch: Partial<JournalMakerState>) => commit(patch);

  // 本地多选上传（一次性多张）
  const handleFilesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'));
    e.target.value = '';
    if (files.length === 0) {
      showToast('请选择图片文件', { type: 'warning' });
      return;
    }
    Promise.all(
      files.map(
        (file) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (evt) => resolve((evt.target?.result as string) || '');
            reader.onerror = () => reject(new Error('读取图片失败'));
            reader.readAsDataURL(file);
          })
      )
    )
      .then((urls) => {
        const valid = urls.filter(Boolean);
        if (!valid.length) return;
        const maxZ = items.reduce((m, it) => Math.max(m, it.z), -1);
        const added = valid.map((src, i) => ({
          id: nextJournalItemId(),
          src,
          ...defaultPlacement(),
          z: maxZ + 1 + i,
        }));
        const nextItems = [...items, ...added];
        setItems(nextItems);
        commit(
          {
            items: nextItems,
            uploadedImages: Array.from(new Set([...uploadedImages, ...valid])),
            imageUrl: null,
          },
          true
        );
        setIsEditing(true);
        showToast(`已添加 ${valid.length} 张素材`, { type: 'success' });
      })
      .catch(() => showToast('读取图片失败，请重试', { type: 'error' }));
  };

  // 清空本地上传素材（连同其拼贴项一并移除）
  const handleClearUploads = () => {
    if (uploadedImages.length === 0) return;
    const uploadSet = new Set(uploadedImages);
    const nextItems = items.filter((it) => !uploadSet.has(it.src));
    setItems(nextItems);
    commit({ items: nextItems, uploadedImages: [], imageUrl: null }, true);
    showToast('已清空本地上传素材', { type: 'success' });
  };

  // 添加文字素材（默认手写体、墨色、横向排版）
  const handleAddText = () => {
    if (hasDownstream) return;
    const maxZ = items.reduce((m, it) => Math.max(m, it.z), -1);
    const textItems = items.filter((it) => it.kind === 'text');
    const newItem: JournalMakerItem = {
      id: nextJournalItemId(),
      kind: 'text',
      src: '',
      text: DEFAULT_TEXT,
      fontFamily: DEFAULT_FONT_FAMILY,
      color: DEFAULT_TEXT_COLOR,
      writingMode: 'horizontal',
      ...defaultTextPlacement(textItems.length),
      z: maxZ + 1,
    };
    const nextItems = [...items, newItem];
    setItems(nextItems);
    commit({ items: nextItems, imageUrl: null }, true);
    setSelectedId(newItem.id);
    setEditingTextId(newItem.id);
    setEditingText(DEFAULT_TEXT);
    setIsEditing(true);
  };

  // 更新素材属性（字号、字体、颜色、排版方向等）
  const handleUpdateItem = useCallback(
    (itemId: string, patch: Partial<JournalMakerItem>) => {
      setItems((prev) => {
        const next = prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it));
        commit({ items: next }, true);
        return next;
      });
    },
    [commit]
  );

  // 确认文本编辑
  const confirmTextEdit = () => {
    if (!editingTextId) return;
    const nextItems = items.map((it) =>
      it.id === editingTextId ? { ...it, text: editingText || DEFAULT_TEXT } : it
    );
    setItems(nextItems);
    commit({ items: nextItems }, true);
    setEditingTextId(null);
    setEditingText('');
  };

  // 文本编辑快捷键：Enter 确认，Shift+Enter 换行，Escape 取消
  const handleTextKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setEditingTextId(null);
      setEditingText('');
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      confirmTextEdit();
    }
  };

  // 删除单个拼贴项：上传图彻底移除；上级/封面来源记入 dismissedSources 防自动回填
  const deleteItem = (item: JournalMakerItem) => {
    if (hasDownstream) return;
    const nextItems = items.filter((it) => it.id !== item.id);
    setItems(nextItems);
    setSelectedId(null);
    if (item.kind === 'text') {
      commit({ items: nextItems }, true);
    } else if (uploadedImages.includes(item.src)) {
      commit(
        { items: nextItems, uploadedImages: uploadedImages.filter((s) => s !== item.src) },
        true
      );
    } else {
      commit(
        { items: nextItems, dismissedSources: Array.from(new Set([...dismissedSources, item.src])) },
        true
      );
    }
  };

  // 图层操作：上移/下移一层，置顶/置底（z 重排为连续序）
  const bumpLayer = (itemId: string, mode: 'up' | 'down' | 'top' | 'bottom') => {
    if (hasDownstream) return;
    const sorted = [...items].sort((a, b) => a.z - b.z);
    const idx = sorted.findIndex((it) => it.id === itemId);
    if (idx < 0) return;
    let target = idx;
    if (mode === 'up') target = Math.min(sorted.length - 1, idx + 1);
    else if (mode === 'down') target = Math.max(0, idx - 1);
    else if (mode === 'top') target = sorted.length - 1;
    else target = 0;
    if (target === idx) return;
    const [picked] = sorted.splice(idx, 1);
    sorted.splice(target, 0, picked);
    const nextItems = sorted.map((it, i) => ({ ...it, z: i }));
    setItems(nextItems);
    commit({ items: nextItems }, true);
  };

  // 旋转操作：顺时针/逆时针步进 90 度并自动对齐摆正
  const rotateStepItem = (itemId: string, direction: 'cw' | 'ccw') => {
    if (hasDownstream) return;
    const nextItems = items.map((it) => {
      if (it.id !== itemId) return it;
      const nextAngle = direction === 'cw' ? snapRotateCw(it.angle) : snapRotateCcw(it.angle);
      return { ...it, angle: nextAngle };
    });
    setItems(nextItems);
    commit({ items: nextItems }, true);
  };

  // 随机布局：位置/大小/旋转/z 序全量重排
  const handleRandomize = () => {
    if (items.length === 0 || hasDownstream) return;
    const nextItems = randomizeLayout(items);
    setItems(nextItems);
    commit({ items: nextItems }, true);
    showToast('已随机重排布局', { type: 'success' });
  };

  // ---- 手势：拖移 / 缩放 / 旋转（本地实时更新，pointerup 一次性提交）----
  const beginGesture = (
    e: React.PointerEvent<HTMLElement>,
    item: JournalMakerItem,
    mode: GestureMode
  ) => {
    if (hasDownstream || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect?.(id);
    const page = pageRef.current;
    if (!page) return;
    let centerPx = 0;
    let centerPy = 0;
    let startPointerAngle = 0;
    if (mode === 'rotate') {
      const el = (e.currentTarget as HTMLElement).closest('[data-journal-item]') as HTMLElement | null;
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
    const page = pageRef.current;
    if (!g || !page) return;
    e.stopPropagation();
    const rect = page.getBoundingClientRect();
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== g.itemId) return it;
        if (g.mode === 'move') {
          const dx = ((e.clientX - g.startPx) / rect.width) * 100;
          const dy = ((e.clientY - g.startPy) / rect.height) * 100;
          return { ...it, x: g.startX + dx, y: g.startY + dy };
        }
        if (g.mode === 'resize') {
          const dw = ((e.clientX - g.startPx) / rect.width) * 100;
          return { ...it, w: Math.min(W_MAX, Math.max(W_MIN, g.startW + dw)) };
        }
        // 旋转：以起始指针方向为基准的增量旋转，抓取瞬间不跳变
        const delta = pointerAngleOf(e.clientX, e.clientY, g.centerPx, g.centerPy) - g.startPointerAngle;
        return { ...it, angle: Math.round((g.startAngle + delta) * 10) / 10 };
      })
    );
  };

  const endGesture = (e: React.PointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    if (!g) return;
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* 未捕获时忽略 */
    }
    gestureRef.current = null;
    setActiveGestureId(null);
    // 最后一次 move 的 setState 已在本次事件前冲刷，ref 即最新值；用户排版动作记撤销历史
    commit({ items: itemsRef.current }, true);
  };

  // 生成手账：可选逐图 AI 抠图（会话级缓存）→ Canvas 合成整张 PNG
  const handleGenerate = useCallback(async () => {
    if (items.length === 0 || isWorking || isExporting) return;
    setIsWorking(true);
    try {
      let sourceItems = items;
      if (removeBackground) {
        const matted: JournalMakerItem[] = [];
        for (let i = 0; i < items.length; i += 1) {
          const src = items[i].src;
          setMattingProgress({ done: i, total: items.length });
          let out = mattingCache.get(src);
          if (!out) {
            const removed = await removeImageBackground(src, (p) => {
              if (p.phase === 'loading' && typeof p.progress === 'number') {
                setMattingProgress({ done: i, total: items.length, modelPct: p.progress });
              }
            });
            out = removed.dataUrl;
            mattingCache.set(src, out);
          }
          matted.push({ ...items[i], src: out });
        }
        sourceItems = matted;
        setMattingProgress(null);
      }

      const resultDataUrl = await composeJournalPage(sourceItems, { background, pageSize });

      await new Promise((resolve) => setTimeout(resolve, 200));

      commit({
        items,
        background,
        pageSize,
        removeBackground,
        imageUrl: resultDataUrl,
        isSaved: false,
      });
      setIsEditing(false);
      setSelectedId(null);
      showToast('手账生成完成（可点击保存按钮写入数据库）', { type: 'success' });
    } catch (err: any) {
      console.error('生成手账失败:', err);
      showToast(err?.message || '生成手账失败，请重试', { type: 'error' });
    } finally {
      setMattingProgress(null);
      setIsWorking(false);
    }
  }, [items, isWorking, isExporting, removeBackground, background, pageSize, commit, showToast]);

  // 独立保存到数据库
  const handleSaveToDatabase = useCallback(async () => {
    const imgUrl = data?.imageUrl;
    if (!imgUrl || isExporting || !onExport) return;
    setIsExporting(true);
    try {
      await onExport(id, imgUrl, {
        items,
        background,
        pageSize,
        removeBackground,
        uploadedImages,
        dismissedSources,
        imageUrl: imgUrl,
        isSaved: true,
      });
      commit({ isSaved: true });
      onSelect?.(id);
      showToast('手账已保存到数据库，已解锁公开与收藏', { type: 'success' });
    } catch (err: any) {
      console.error('保存到数据库失败:', err);
      showToast(err?.detail || err?.message || '保存失败，请重试', { type: 'error' });
    } finally {
      setIsExporting(false);
    }
  }, [
    data?.imageUrl,
    isExporting,
    onExport,
    id,
    items,
    background,
    pageSize,
    removeBackground,
    uploadedImages,
    dismissedSources,
    commit,
    onSelect,
    showToast,
  ]);

  // 本地直接下载 PNG
  const handleDownload = useCallback(() => {
    const url = data?.imageUrl;
    if (!url) return;
    downloadJournalImage(url, `journal-${Date.now()}.png`);
    showToast('手账图片已下载', { type: 'success' });
  }, [data?.imageUrl, showToast]);

  // 重置：清空全部拼贴与来源记忆，恢复默认参数并从当前来源重装
  const handleReset = useCallback(() => {
    setBackground(JOURNAL_DEFAULTS.background);
    setPageSize(JOURNAL_DEFAULTS.pageSize);
    setRemoveBackground(JOURNAL_DEFAULTS.removeBackground);
    setItems([]);
    setSelectedId(null);
    setIsEditing(true);
    commit({
      items: [],
      background: JOURNAL_DEFAULTS.background,
      pageSize: JOURNAL_DEFAULTS.pageSize,
      removeBackground: JOURNAL_DEFAULTS.removeBackground,
      uploadedImages: [],
      dismissedSources: [],
      imageUrl: null,
      isSaved: false,
    });
    showToast('已重置（将重新装载上级与封面素材）', { type: 'success' });
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
  const preset = journalPagePresetOf(pageSize);

  // 手账页 contain-fit：按容器实测尺寸与预设比例计算页面像素尺寸（未测得前铺满宽度兜底）
  const pageFit = useMemo(() => {
    const ratio = preset.width / preset.height;
    const availW = Math.max(stageSize.w - 4, 0);
    const availH = Math.max(stageSize.h - 4, 0);
    if (!availW || !availH) return { w: '100%' as string | number, h: 'auto' as string | number };
    let w = availW;
    let h = w / ratio;
    if (h > availH) {
      h = availH;
      w = h * ratio;
    }
    return { w: Math.floor(w), h: Math.floor(h) };
  }, [stageSize, preset]);

  const renderLayerButtons = (item: JournalMakerItem, selected: boolean) => {
    const isNearTop = item.y < 12;
    return (
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className={`absolute left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-paper/95 backdrop-blur-md shadow-md border border-paper-grid/50 transition-[opacity,transform] duration-150 ease-out z-30 ${
          isNearTop ? '-bottom-9' : '-top-9'
        } ${
          selected
            ? 'opacity-100 scale-100 pointer-events-auto'
            : 'opacity-0 group-hover/jitem:opacity-100 scale-95 group-hover/jitem:scale-100 pointer-events-none group-hover/jitem:pointer-events-auto'
        }`}
      >
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
              disabled={hasDownstream}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                bumpLayer(item.id, mode);
              }}
              className="p-1 rounded text-ink-light hover:text-accent hover:bg-paper-grid/40 active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out disabled:opacity-40"
            >
              <Icon size={12} strokeWidth={1.8} />
            </button>
          </Tooltip>
        ))}
        <div className="w-px h-3 bg-paper-grid/50 my-auto mx-0.5" />
        <Tooltip content="逆时针旋转 90° (摆正)">
          <button
            type="button"
            disabled={hasDownstream}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              rotateStepItem(item.id, 'ccw');
            }}
            className="p-1 rounded text-ink-light hover:text-accent hover:bg-paper-grid/40 active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out disabled:opacity-40"
          >
            <RotateCcw size={12} strokeWidth={1.8} />
          </button>
        </Tooltip>
        <Tooltip content="顺时针旋转 90° (摆正)">
          <button
            type="button"
            disabled={hasDownstream}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              rotateStepItem(item.id, 'cw');
            }}
            className="p-1 rounded text-ink-light hover:text-accent hover:bg-paper-grid/40 active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out disabled:opacity-40"
          >
            <RotateCw size={12} strokeWidth={1.8} />
          </button>
        </Tooltip>
        <div className="w-px h-3 bg-paper-grid/50 my-auto mx-0.5" />
        <Tooltip content="移除该素材">
          <button
            type="button"
            disabled={hasDownstream}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              deleteItem(item);
            }}
            className="p-1 rounded text-ink-light hover:text-error hover:bg-error/10 active:scale-[0.96] transition-[background-color,color,transform] duration-150 ease-out disabled:opacity-40"
          >
            <Trash2 size={12} strokeWidth={1.8} />
          </button>
        </Tooltip>
      </div>
    );
  };

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '手账制作'}
      dotColor={NODE_COLORS.journal_maker || 'oklch(0.7 0.14 150)'}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 500, height: 700 }}
      className={`transition-[opacity,transform,box-shadow,border-color] duration-150 ease-out ${
        isSelected ? 'ring-2 ring-accent/70 shadow-md' : ''
      }`}
      showLeftAnchor={true}
      showRightAnchor={true}
      onClick={() => onSelect?.(id)}
      footer={footer}
      mismatchBadge={mismatchBadge}
      actionBar={
        <NodeActionBar>
          {hasGenerated ? (
            <>
              <NodeActionBar.Retry
                onClick={() => setIsEditing(true)}
                disabled={busy}
                hasDownstream={hasDownstream}
                downstreamTooltip="有下级节点，不可重新调整"
                tooltip="返回编辑模式"
                aria-label="返回编辑模式"
              />
              <NodeActionBar.Custom
                icon={<Upload size={16} strokeWidth={1.5} />}
                tooltip="添加图片（可多选）"
                aria-label="添加图片（可多选）"
                downstreamTooltip="有下级节点，不可更换图片"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                hasDownstream={hasDownstream}
              />
              <NodeActionBar.Custom
                icon={<Type size={16} strokeWidth={1.5} />}
                tooltip="添加文字（手写字体）"
                aria-label="添加文字"
                downstreamTooltip="有下级节点，不可添加文字"
                onClick={handleAddText}
                disabled={busy}
                hasDownstream={hasDownstream}
              />
              {uploadedImages.length > 0 && (
                <NodeActionBar.Custom
                  icon={<Trash2 size={16} strokeWidth={1.5} className="text-error/80 hover:text-error" />}
                  tooltip="清空本地上传素材"
                  aria-label="清空本地上传素材"
                  downstreamTooltip="有下级节点，不可清空图片"
                  onClick={handleClearUploads}
                  disabled={busy}
                  hasDownstream={hasDownstream}
                />
              )}
              <NodeActionBar.Custom
                icon={<Check size={16} strokeWidth={isSaved ? 2.5 : 1.5} className={isSaved ? 'text-accent' : ''} />}
                onClick={handleSaveToDatabase}
                disabled={busy || isSaved}
                hasDownstream={hasDownstream}
                downstreamTooltip="有下级节点，不可保存"
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
                tooltip={
                  !isSaved ? '请先保存到数据库后再收藏' : isFavorited ? '取消收藏' : '收藏'
                }
                aria-label={
                  !isSaved ? '请先保存到数据库后再收藏' : isFavorited ? '取消收藏' : '收藏'
                }
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
                tooltip="直接下载手账 PNG"
                aria-label="直接下载手账 PNG"
              />
              <NodeActionBar.Reset
                onClick={handleReset}
                disabled={busy}
                hasDownstream={hasDownstream}
                downstreamTooltip="有下级节点，不可重置"
                tooltip="重置素材与结果"
                aria-label="重置素材与结果"
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
                tooltip="生成手账"
                aria-label="生成手账"
                downstreamTooltip="有下级节点，不可生成"
                onClick={handleGenerate}
                disabled={items.length === 0 || busy}
                hasDownstream={hasDownstream}
              />
              <NodeActionBar.Custom
                icon={<Shuffle size={16} strokeWidth={1.5} />}
                tooltip="随机布局（位置/大小/旋转/图层全量重排）"
                aria-label="随机布局"
                downstreamTooltip="有下级节点，不可调整"
                onClick={handleRandomize}
                disabled={items.length === 0 || busy}
                hasDownstream={hasDownstream}
              />
              <NodeActionBar.Custom
                icon={<Type size={16} strokeWidth={1.5} />}
                tooltip="添加文字（手写字体）"
                aria-label="添加文字"
                downstreamTooltip="有下级节点，不可添加文字"
                onClick={handleAddText}
                disabled={busy}
                hasDownstream={hasDownstream}
              />
              <NodeActionBar.Custom
                icon={<Upload size={16} strokeWidth={1.5} />}
                tooltip="添加图片（可多选）"
                aria-label="添加图片（可多选）"
                downstreamTooltip="有下级节点，不可更换图片"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                hasDownstream={hasDownstream}
              />
              {uploadedImages.length > 0 && (
                <NodeActionBar.Custom
                  icon={<Trash2 size={16} strokeWidth={1.5} className="text-error/80 hover:text-error" />}
                  tooltip="清空本地上传素材"
                  aria-label="清空本地上传素材"
                  downstreamTooltip="有下级节点，不可清空图片"
                  onClick={handleClearUploads}
                  disabled={busy}
                  hasDownstream={hasDownstream}
                />
              )}
              <NodeActionBar.Reset
                onClick={handleReset}
                disabled={busy}
                hasDownstream={hasDownstream}
                downstreamTooltip="有下级节点，不可重置"
                tooltip="重置素材与参数"
                aria-label="重置素材与参数"
              />
            </>
          )}
        </NodeActionBar>
      }
    >
      {/* 隐藏的真实文件上传 input（多选） */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFilesUpload}
      />

      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
        {/* 顶部工具栏（仅编辑模式：抠图开关 / 画布尺寸 / 浓度滑杆 / 背景色盘） */}
        {isEditing && (
          <div className="flex flex-col gap-1.5 px-2 py-1.5 rounded-lg bg-paper-grid/20 border border-paper-grid/40 text-xs font-sans text-ink-light select-none">
            {/* 第 1 行：AI 抠图开关 + 画布尺寸选择 */}
            <div className="flex items-center justify-between gap-2">
              <Tooltip
                content={
                  removeBackground
                    ? '已开启 AI 抠图（点击「生成手账」时才会执行去底并合成模切效果）'
                    : '已关闭（保留原图背景直接拼贴）'
                }
              >
                <button
                  type="button"
                  onClick={() => {
                    const next = !removeBackground;
                    setRemoveBackground(next);
                    updateParam({ removeBackground: next });
                  }}
                  disabled={hasDownstream}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.96] shrink-0 ${
                    removeBackground
                      ? 'bg-accent/15 text-accent font-medium'
                      : 'hover:bg-paper-grid/40 text-ink-light'
                  }`}
                >
                  <Eraser size={12} />
                  <span>AI 抠图</span>
                </button>
              </Tooltip>

              {/* 画布尺寸分段选择 */}
              <div className="flex items-center gap-1 flex-1 justify-end max-w-[240px]">
                <span className="text-ink-faint text-[11px] whitespace-nowrap">尺寸:</span>
                <div className="flex flex-1 gap-1">
                  {JOURNAL_PAGE_PRESETS.map((p) => (
                    <Tooltip key={p.id} content={`${p.label} · 导出 ${p.width}×${p.height}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setPageSize(p.id);
                          updateParam({ pageSize: p.id });
                        }}
                        disabled={hasDownstream}
                        className={`flex-1 px-1.5 py-0.5 rounded border text-[11px] transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.96] ${
                          pageSize === p.id
                            ? 'bg-accent/15 border-accent/50 text-accent font-medium'
                            : 'border-paper-grid/50 hover:bg-paper-grid/30 text-ink-light'
                        }`}
                      >
                        {p.label}
                      </button>
                    </Tooltip>
                  ))}
                </div>
              </div>
            </div>

            {/* 第 2 行：透明度/浓度滑杆 + 背景色盘与自定义取色 */}
            <div className="flex items-center justify-between gap-2 pt-0.5">
              {/* 背景透明度/浓度滑杆 */}
              <Tooltip content="背景色彩浓度（透明度）：调整渐变光晕与网格通透度 (10%~100%)">
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <span className="text-ink-faint text-[11px] whitespace-nowrap">浓度:</span>
                  <div className="flex-1 min-w-[60px] flex items-center">
                    <Slider
                      min={10}
                      max={100}
                      step={5}
                      value={background.opacity ?? 75}
                      disabled={hasDownstream}
                      onChange={(nextOpacity) => {
                        const nextBg = updateBackgroundOpacity(background, nextOpacity);
                        setBackground(nextBg);
                        updateParam({ background: nextBg });
                      }}
                      aria-label="背景色彩浓度"
                      aria-valuetext={`${background.opacity ?? 75}%`}
                    />
                  </div>
                  <span className="text-[11px] text-ink-faint w-7 text-right tabular-nums font-mono">
                    {background.opacity ?? 75}%
                  </span>
                </div>
              </Tooltip>

              {/* 渐变底色预设 + 自定义取色 */}
              <div className="flex items-center gap-1 shrink-0">
                {JOURNAL_BG_PRESETS.map((p) => (
                  <Tooltip key={p.label} content={`背景 · ${p.label}`}>
                    <button
                      type="button"
                      onClick={() => {
                        const nextBg = updateBackgroundOpacity(p.bg, background.opacity ?? p.bg.opacity ?? 75);
                        setBackground(nextBg);
                        updateParam({ background: nextBg });
                      }}
                      disabled={hasDownstream}
                      style={{ background: journalBackgroundCss(p.bg, false) }}
                      className={`w-4 h-4 rounded-full border transition-[border-color,transform,box-shadow] duration-150 ease-out active:scale-[0.96] ${
                        journalBackgroundKey(background) === journalBackgroundKey(p.bg)
                          ? 'border-accent ring-2 ring-accent/40 scale-110 shadow-2xs'
                          : 'border-paper-grid/60 hover:scale-110'
                      }`}
                    />
                  </Tooltip>
                ))}

                {/* 自定义颜色取色器（自动按当前浓度派生 Mesh） */}
                <ColorPickerPopover
                  value={background.tintHex || (background.kind === 'solid' ? background.colors[0] : '#ff7262')}
                  onChange={(hex) => {
                    const nextBg = deriveTintMesh(hex, background.opacity ?? 75);
                    setBackground(nextBg);
                    updateParam({ background: nextBg });
                  }}
                  disabled={hasDownstream}
                  align="right"
                >
                  <Tooltip
                    content={
                      background.tintHex
                        ? `自定义色调（当前: ${background.tintHex}）`
                        : '自定义色调 / 吸管取色'
                    }
                  >
                    <button
                      type="button"
                      disabled={hasDownstream}
                      style={{
                        background: background.tintHex
                          ? `radial-gradient(circle, ${background.tintHex} 40%, rgba(255,255,255,0.8) 100%)`
                          : undefined,
                      }}
                      className={`w-4 h-4 rounded-full border flex items-center justify-center transition-[border-color,transform,box-shadow] duration-150 ease-out active:scale-[0.96] ${
                        background.tintHex
                          ? 'border-accent ring-2 ring-accent/40 scale-110 shadow-2xs'
                          : 'border-paper-grid/70 hover:border-accent hover:scale-110 bg-paper/80 text-ink-light hover:text-accent'
                      }`}
                    >
                      {!background.tintHex && (
                        <span className="w-1.5 h-1.5 rounded-full bg-accent/70" />
                      )}
                    </button>
                  </Tooltip>
                </ColorPickerPopover>
              </div>
            </div>
          </div>
        )}

        {/* 核心操作与预览画布 */}
        <div
          className="relative flex-1 min-h-0 w-full overflow-hidden rounded bg-paper-grid/10 border border-paper-grid/40 flex items-center justify-center select-none"
          onPointerDown={handleCanvasBlankPointerDown}
          onClick={handleCanvasBlankPointerDown}
        >
          <AnimatePresence mode="wait" initial={false}>
            {!hasGenerated ? (
              // 编辑模式：可交互手账页面
              <motion.div
                key="editor"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="relative w-full h-full flex items-center justify-center overflow-hidden p-2 sm:p-3"
                onPointerDown={handleCanvasBlankPointerDown}
                onClick={handleCanvasBlankPointerDown}
              >
                <div
                  ref={stageRef}
                  className="relative w-full h-full flex items-center justify-center overflow-hidden"
                  onPointerDown={handleCanvasBlankPointerDown}
                  onClick={handleCanvasBlankPointerDown}
                >
                  {/* Card Shell: 精致的白底外框与多层细腻阴影（参考 canvas-card.css） */}
                  <div
                    className="relative p-2 rounded-2xl bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_16px_48px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03),0_2px_4px_rgba(0,0,0,0.02)] flex items-center justify-center"
                    style={{
                      aspectRatio: `${preset.width} / ${preset.height}`,
                      width: pageFit.w,
                      height: pageFit.h,
                    }}
                    onPointerDown={handleCanvasBlankPointerDown}
                    onClick={handleCanvasBlankPointerDown}
                  >
                    {/* 内层 Art Canvas: 承载 Mesh 渐变、点阵网格与 15% 边缘淡出遮罩 */}
                    <div
                      ref={pageRef}
                      className="relative w-full h-full rounded-lg overflow-hidden bg-white select-none shadow-2xs"
                      onPointerDown={handleCanvasBlankPointerDown}
                      onClick={handleCanvasBlankPointerDown}
                    >
                      {/* 动态 Mesh 渐变与点阵背景层（带四周 15% 边缘淡出羽化遮罩） */}
                      <div
                        className="absolute inset-0 pointer-events-none"
                        style={{
                          background: journalBackgroundCss(background),
                          maskImage:
                            background.edgeFade !== false
                              ? 'linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent), linear-gradient(transparent, #000 15%, #000 85%, transparent)'
                              : undefined,
                          WebkitMaskImage:
                            background.edgeFade !== false
                              ? 'linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent), linear-gradient(transparent, #000 15%, #000 85%, transparent)'
                              : undefined,
                          maskComposite: 'intersect',
                          WebkitMaskComposite: 'source-in',
                        }}
                      />

                      {/* 空素材提示 */}
                      {items.length === 0 && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-ink-faint/70 gap-2 p-6 text-center pointer-events-none z-10">
                          <Upload size={32} strokeWidth={1.2} />
                          <p className="text-xs">连线上级图片或点击上方按钮添加素材</p>
                        </div>
                      )}

                      {/* 选中文本时的悬浮微交互工具栏（字体、颜色、横竖排、字号、图层与删除） */}
                      {selectedItem && selectedItem.kind === 'text' && !hasDownstream && (
                        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 max-w-[94%] pointer-events-auto">
                          <JournalTextToolbar
                            item={selectedItem}
                            disabled={hasDownstream}
                            onUpdate={(patch) => handleUpdateItem(selectedItem.id, patch)}
                            onOpenEdit={() => {
                              setEditingTextId(selectedItem.id);
                              setEditingText((selectedItem.text || '').replace(/\\n/g, '\n'));
                              setTimeout(() => textInputRef.current?.select(), 50);
                            }}
                            onDelete={() => deleteItem(selectedItem)}
                            onBumpLayer={(mode) => bumpLayer(selectedItem.id, mode)}
                            onRotateStep={(mode) => rotateStepItem(selectedItem.id, mode)}
                          />
                        </div>
                      )}

                      {/* 素材拼贴列表 */}
                      {[...items].sort((a, b) => a.z - b.z).map((item) => {
                        const selected = selectedId === item.id;
                        const isGesturingThis = activeGestureId === item.id;

                        if (item.kind === 'text') {
                          return (
                            <JournalTextItem
                              key={item.id}
                              item={item}
                              selected={selected}
                              isGesturing={isGesturingThis}
                              stageWidth={stageSize.w}
                              disabled={hasDownstream}
                              onSelect={() => {
                                onSelect?.(id);
                                setSelectedId(item.id);
                              }}
                              onOpenEdit={() => {
                                setEditingTextId(item.id);
                                setEditingText((item.text || '').replace(/\\n/g, '\n'));
                                setTimeout(() => textInputRef.current?.select(), 50);
                              }}
                              onGestureStart={beginGesture}
                              onGestureMove={moveGesture}
                              onGestureEnd={endGesture}
                            />
                          );
                        }

                        // 图片素材
                        return (
                          <div
                            key={item.id}
                            data-journal-item
                            className={`absolute group/jitem touch-none ${
                              isGesturingThis ? 'will-change-transform select-none' : ''
                            }`}
                            style={{
                              left: `${item.x}%`,
                              top: `${item.y}%`,
                              width: `${item.w}%`,
                              zIndex: selected ? 800 + item.z : item.z,
                              transform: `translate(-50%, -50%) rotate(${item.angle}deg)`,
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelect?.(id);
                              setSelectedId(item.id);
                            }}
                          >
                            <img
                              src={item.src}
                              alt=""
                              draggable={false}
                              onPointerDown={(e) => beginGesture(e, item, 'move')}
                              onPointerMove={moveGesture}
                              onPointerUp={endGesture}
                              onPointerCancel={endGesture}
                              className={`block w-full h-auto cursor-move drop-shadow-[0_3px_8px_rgba(15,23,42,0.18)] transition-[outline,box-shadow] duration-150 ease-out ${
                                selected ? 'outline outline-2 outline-accent ring-2 ring-white/80' : ''
                              }`}
                            />
                            {renderLayerButtons(item, selected)}

                            {selected && (
                              <>
                                {/* 右下角缩放手柄 */}
                                <div
                                  onPointerDown={(e) => beginGesture(e, item, 'resize')}
                                  onPointerMove={moveGesture}
                                  onPointerUp={endGesture}
                                  onPointerCancel={endGesture}
                                  title="拖拽调整大小"
                                  className="absolute -right-2 -bottom-2 w-4 h-4 rounded-full bg-accent border-2 border-white shadow-md cursor-nwse-resize hover:scale-110 active:scale-[0.96] transition-transform duration-150 ease-out flex items-center justify-center z-20"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
                                </div>
                                {/* 底部居中旋转手柄与引线 */}
                                <div className="absolute left-1/2 -bottom-6 -translate-x-1/2 flex flex-col items-center pointer-events-none z-20">
                                  {/* 连接引线 */}
                                  <div className="w-px h-2 bg-accent/70" />
                                  <div
                                    onPointerDown={(e) => beginGesture(e, item, 'rotate')}
                                    onPointerMove={moveGesture}
                                    onPointerUp={endGesture}
                                    onPointerCancel={endGesture}
                                    title="拖拽旋转"
                                    className="w-4 h-4 rounded-full bg-accent border-2 border-white shadow-md cursor-grab active:cursor-grabbing hover:scale-110 active:scale-[0.96] transition-transform duration-150 ease-out pointer-events-auto flex items-center justify-center"
                                  >
                                    <div className="w-1 h-1 rounded-full bg-white/90" />
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}

                      {/* 抠图与生成进度浮层 */}
                      <AnimatePresence>
                        {(isWorking || mattingProgress) && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15, ease: 'easeOut' }}
                            className="absolute inset-0 z-[999] bg-black/45 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 text-paper"
                          >
                            <Loader2 size={22} className="animate-spin" />
                            {mattingProgress ? (
                              <>
                                <span className="text-xs">
                                  正在 AI 抠图{' '}
                                  <span className="tabular-nums font-mono">
                                    {mattingProgress.done + 1}
                                  </span>
                                  /
                                  <span className="tabular-nums font-mono">
                                    {mattingProgress.total}
                                  </span>
                                  …
                                </span>
                                {typeof mattingProgress.modelPct === 'number' &&
                                  mattingProgress.modelPct < 100 && (
                                    <div className="w-32 h-1 rounded-full bg-white/25 overflow-hidden">
                                      <div
                                        className="h-full bg-accent transition-[width] duration-200 ease-out"
                                        style={{ width: `${Math.round(mattingProgress.modelPct)}%` }}
                                      />
                                    </div>
                                  )}
                              </>
                            ) : (
                              <span className="text-xs">正在合成手账页…</span>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* 文本编辑浮层 */}
                      {editingTextId && (
                        <div
                          className="absolute z-[1000] flex flex-col gap-2 p-2.5 rounded-xl bg-paper/95 backdrop-blur-md shadow-2xl border border-paper-grid/60"
                          style={{
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-between text-xs text-ink-light px-0.5">
                            <span className="font-medium text-ink">编辑文字</span>
                            <span className="text-[10px] text-ink-faint">Enter 确认 · Shift+Enter 换行</span>
                          </div>
                          <textarea
                            ref={textInputRef}
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={handleTextKeyDown}
                            className="w-52 h-20 resize-none rounded-lg border border-paper-grid/60 bg-paper px-2.5 py-1.5 text-xs text-ink leading-relaxed outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 transition font-sans"
                            autoFocus
                            placeholder="输入文字…"
                          />
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTextId(null);
                                setEditingText('');
                              }}
                              className="px-2.5 py-1 text-xs text-ink-light rounded-md hover:bg-paper-grid/30 active:scale-[0.96] transition"
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              onClick={confirmTextEdit}
                              className="px-3 py-1 text-xs text-white font-medium bg-accent rounded-md hover:bg-accent-hover active:scale-[0.96] shadow-sm transition"
                            >
                              确认
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              // 生成完成展示模式
              <motion.div
                key="preview"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="relative w-full h-full flex items-center justify-center p-3"
              >
                {data.imageUrl ? (
                  <div className="relative max-w-full max-h-full flex items-center justify-center p-2 rounded-2xl bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_16px_48px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03),0_2px_4px_rgba(0,0,0,0.02)]">
                    <img
                      src={data.imageUrl}
                      alt="Journal Output"
                      className="max-w-full max-h-[500px] rounded-lg object-contain select-none pointer-events-none drop-shadow-sm"
                    />
                  </div>
                ) : (
                  <div className="text-xs text-ink-faint">暂无手账生成结果</div>
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

export const JournalMakerNode = memo(JournalMakerNodeInner);
JournalMakerNode.displayName = 'JournalMakerNode';
export default JournalMakerNode;
