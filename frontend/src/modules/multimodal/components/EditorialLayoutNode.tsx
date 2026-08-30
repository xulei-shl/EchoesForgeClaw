import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  Trash2,
  Loader2,
  RotateCw,
  RotateCcw,
  ChevronsUp,
  ChevronsDown,
  FileText,
  Sliders,
  Heart,
  Globe,
  Wand2,
  Check,
} from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  type EditorialArticleData,
  type EditorialImageItem,
  type EditorialPageRatio,
  type EditorialState,
  type EditorialTypographySettings,
  EDITORIAL_PAGE_RATIOS,
} from '../editorial/types';
import { EDITORIAL_PRESETS, getEditorialPreset } from '../editorial/presets';
import { computeEditorialLayout } from '../editorial/engine/layoutEngine';
import { exportEditorialToPng } from '../editorial/render/canvasExporter';
import {
  JOURNAL_FONTS,
  JOURNAL_TEXT_COLORS,
  snapRotateCw,
  snapRotateCcw,
  usePreloadJournalFonts,
} from '../journal';

export interface EditorialLayoutNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  data?: Partial<EditorialState> & {
    imageUrl?: string | null;
    isExporting?: boolean;
    error?: string | null;
    isSaved?: boolean;
  };
  upstreamImages?: string[];
  upstreamText?: string;
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
  onResizeLive?: (id: string, width: number, height: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  mismatchBadge?: string | null;
  onUpdateState?: (id: string, patch: Partial<EditorialState>, undoable?: boolean) => void;
  onExport?: (id: string, dataUrl: string, state: EditorialState) => Promise<void>;
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

const pointerAngleOf = (px: number, py: number, cx: number, cy: number) =>
  (Math.atan2(px - cx, -(py - cy)) * 180) / Math.PI;

const defaultPreset = EDITORIAL_PRESETS[0]!;

/** 异步读取图像自然宽高比 (naturalWidth / naturalHeight) */
function probeImageAspectRatio(src: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve(img.naturalWidth / img.naturalHeight);
      } else {
        resolve(1);
      }
    };
    img.onerror = () => resolve(1);
    img.src = src;
  });
}

/** 矢量条形码组件（与 Canvas Exporter 完全一致） */
const BarcodeSvg: React.FC<{ width: number; height: number; color?: string }> = ({
  width,
  height,
  color = '#000000',
}) => {
  const barCount = 36;
  const unitW = width / (barCount * 1.5);
  const bars = useMemo(() => {
    const res: { x: number; w: number }[] = [];
    let curX = 0;
    for (let i = 0; i < barCount; i++) {
      const isThick = i % 3 === 0 || i % 7 === 0;
      const w = isThick ? unitW * 2 : unitW;
      res.push({ x: curX, w });
      curX += w + unitW * 0.8;
      if (curX > width) break;
    }
    return res;
  }, [width, unitW]);

  return (
    <svg width={width} height={height} className="overflow-visible">
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={height} fill={color} />
      ))}
    </svg>
  );
};

const EditorialLayoutNodeInner: React.FC<EditorialLayoutNodeProps> = ({
  id,
  initialX = 100,
  initialY = 100,
  title,
  data = {},
  upstreamImages,
  upstreamText,
  isFavorited = false,
  isPublic = false,
  isSelected = false,
  onSelect,
  onRemove,
  onToggleFavorite,
  onTogglePublic,
  onPositionChange,
  onSizeChange,
  onDrag,
  onResizeLive,
  footer,
  onContextMenu,
  mismatchBadge,
  onUpdateState,
  onExport,
}) => {
  const { showToast } = useFeedback();
  usePreloadJournalFonts();

  // 预设与基础配置
  const [presetId, setPresetId] = useState<string>(data.presetId || defaultPreset.id);
  const activePreset = useMemo(() => getEditorialPreset(presetId), [presetId]);

  const [pageSize, setPageSize] = useState<EditorialPageRatio>(
    data.pageSize || activePreset.defaultRatio
  );
  const ratioPreset = useMemo(
    () => EDITORIAL_PAGE_RATIOS.find((r) => r.id === pageSize) || EDITORIAL_PAGE_RATIOS[0]!,
    [pageSize]
  );

  const [article, setArticle] = useState<EditorialArticleData>(
    data.article || activePreset.defaultArticle
  );
  const [typography, setTypography] = useState<EditorialTypographySettings>(
    data.typography || activePreset.defaultTypography
  );
  const [background, setBackground] = useState(
    data.background || activePreset.defaultBackground
  );

  const [items, setItems] = useState<EditorialImageItem[]>(data.images || []);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'preview' | 'article' | 'style'>('preview');
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const stageWrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gestureRef = useRef<GestureState | null>(null);

  // 测量舞台容器的真实物理尺寸，用于计算精准的 CSS Transform Scale
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({
    width: 440,
    height: 580,
  });

  useEffect(() => {
    const el = stageWrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setStageSize({ width, height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 缩放系数：stage容器实际像素 / 基准高清分辨率
  const scale = useMemo(() => {
    if (!ratioPreset.width || !stageSize.width || !stageSize.height) return 0.4;
    const scaleX = stageSize.width / ratioPreset.width;
    const scaleY = stageSize.height / ratioPreset.height;
    return Math.min(scaleX, scaleY);
  }, [ratioPreset.width, ratioPreset.height, stageSize.width, stageSize.height]);

  const isSaved = Boolean(data?.isSaved);
  const hasGenerated = Boolean(data?.imageUrl) && !isEditing;

  // 1. 同步上游文本
  useEffect(() => {
    if (upstreamText && upstreamText.trim() && !data.article?.body) {
      setArticle((prev) => ({
        ...prev,
        body: upstreamText.trim(),
      }));
    }
  }, [upstreamText, data.article?.body]);

  // 2. 多图并集装载并探测真实自然宽高比
  const dismissedSourcesRef = useRef<Set<string>>(new Set(data.dismissedSources || []));
  useEffect(() => {
    if (!upstreamImages || upstreamImages.length === 0) return;

    let isMounted = true;
    (async () => {
      const existingUrls = new Set(items.map((it) => it.src));
      const toAdd = upstreamImages.filter(
        (url) => url && !existingUrls.has(url) && !dismissedSourcesRef.current.has(url)
      );
      if (toAdd.length === 0) return;

      const defaultPlacements = [
        { x: 44, y: 18, width: 50, height: 60 },
        { x: 6, y: 56, width: 38, height: 32 },
        { x: 48, y: 54, width: 46, height: 34 },
      ];

      const newItems: EditorialImageItem[] = [];
      for (let idx = 0; idx < toAdd.length; idx++) {
        const imgUrl = toAdd[idx]!;
        const ar = await probeImageAspectRatio(imgUrl);
        const p = defaultPlacements[(items.length + idx) % defaultPlacements.length]!;

        newItems.push({
          id: `img_${Date.now()}_${idx}`,
          src: imgUrl,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
          aspectRatio: ar,
          rotation: 0,
          wrapMode: 'box',
          zIndex: items.length + newItems.length + 1,
        });
      }

      if (!isMounted || newItems.length === 0) return;
      setItems((prev) => {
        const merged = [...prev, ...newItems];
        onUpdateState?.(id, { images: merged });
        return merged;
      });
    })();

    return () => {
      isMounted = false;
    };
  }, [upstreamImages, id, onUpdateState, items]);

  // 3. 计算排版结果（100% 以基准分辨率计算）
  const currentState: EditorialState = useMemo(
    () => ({
      presetId,
      pageSize,
      article,
      images: items,
      typography,
      background,
      dismissedSources: Array.from(dismissedSourcesRef.current),
      imageUrl: data.imageUrl,
      isSaved: data.isSaved,
    }),
    [presetId, pageSize, article, items, typography, background, data.imageUrl, data.isSaved]
  );

  const layoutProjection = useMemo(() => {
    return computeEditorialLayout(currentState, ratioPreset, activePreset);
  }, [currentState, ratioPreset, activePreset]);

  // 4. 切换预设
  const handleSelectPreset = (newPresetId: string) => {
    const p = getEditorialPreset(newPresetId);
    setPresetId(newPresetId);
    setTypography((prev) => ({
      ...prev,
      headlineFont: p.defaultTypography.headlineFont,
      bodyFont: p.defaultTypography.bodyFont,
      bodyFontSize: p.defaultTypography.bodyFontSize,
      bodyLineHeight: p.defaultTypography.bodyLineHeight,
      dropCap: p.defaultTypography.dropCap,
    }));
    setBackground(p.defaultBackground);
    onUpdateState?.(
      id,
      {
        presetId: newPresetId,
        typography: p.defaultTypography,
        background: p.defaultBackground,
      },
      true
    );
    showToast(`已切换版面风格：${p.name}`, { type: 'info' });
  };

  // 5. 独立手势状态机（按 scale 精准换算回百分比）
  const beginGesture = (
    e: React.PointerEvent,
    item: EditorialImageItem,
    mode: GestureMode
  ) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}

    setSelectedItemId(item.id);

    const el = stageWrapperRef.current;
    if (!el) return;
    const stageRect = el.getBoundingClientRect();
    const itemPxW = (item.width / 100) * ratioPreset.width * scale;
    const naturalRatio = item.aspectRatio || 1;
    const itemPxH = itemPxW / naturalRatio;
    const itemPxX = (item.x / 100) * ratioPreset.width * scale;
    const itemPxY = (item.y / 100) * ratioPreset.height * scale;

    const centerPx = stageRect.left + itemPxX + itemPxW / 2;
    const centerPy = stageRect.top + itemPxY + itemPxH / 2;

    gestureRef.current = {
      mode,
      itemId: item.id,
      startPx: e.clientX,
      startPy: e.clientY,
      startX: item.x,
      startY: item.y,
      startW: item.width,
      startAngle: item.rotation || 0,
      startPointerAngle: pointerAngleOf(e.clientX, e.clientY, centerPx, centerPy),
      centerPx,
      centerPy,
    };
  };

  const moveGesture = (e: React.PointerEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    e.stopPropagation();
    e.preventDefault();

    const actualWidthPx = ratioPreset.width * scale;
    const actualHeightPx = ratioPreset.height * scale;
    if (actualWidthPx <= 0 || actualHeightPx <= 0) return;

    if (g.mode === 'move') {
      const dxPct = ((e.clientX - g.startPx) / actualWidthPx) * 100;
      const dyPct = ((e.clientY - g.startPy) / actualHeightPx) * 100;
      const nextX = Math.round(Math.max(-30, Math.min(110, g.startX + dxPct)));
      const nextY = Math.round(Math.max(-30, Math.min(110, g.startY + dyPct)));

      setItems((prev) =>
        prev.map((it) => (it.id === g.itemId ? { ...it, x: nextX, y: nextY } : it))
      );
    } else if (g.mode === 'resize') {
      const dxPct = ((e.clientX - g.startPx) / actualWidthPx) * 100;
      const nextW = Math.round(Math.max(12, Math.min(100, g.startW + dxPct)));
      setItems((prev) =>
        prev.map((it) => (it.id === g.itemId ? { ...it, width: nextW } : it))
      );
    } else if (g.mode === 'rotate') {
      const curPointerAngle = pointerAngleOf(
        e.clientX,
        e.clientY,
        g.centerPx,
        g.centerPy
      );
      const delta = curPointerAngle - g.startPointerAngle;
      const nextAngle = Math.round((g.startAngle + delta + 360) % 360);
      setItems((prev) =>
        prev.map((it) => (it.id === g.itemId ? { ...it, rotation: nextAngle } : it))
      );
    }
  };

  const endGesture = (e: React.PointerEvent) => {
    if (!gestureRef.current) return;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    gestureRef.current = null;
    onUpdateState?.(id, { images: items }, true);
  };

  // 旋转与对齐摆正操作
  const rotateStepItem = (itemId: string, direction: 'cw' | 'ccw') => {
    setItems((prev) => {
      const updated = prev.map((it) => {
        if (it.id !== itemId) return it;
        const cur = it.rotation || 0;
        const nextAngle = direction === 'cw' ? snapRotateCw(cur) : snapRotateCcw(cur);
        return { ...it, rotation: nextAngle };
      });
      onUpdateState?.(id, { images: updated }, true);
      return updated;
    });
  };

  const bumpLayer = (itemId: string, mode: 'top' | 'bottom') => {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.id === itemId);
      if (idx === -1) return prev;
      const item = prev[idx]!;
      const without = prev.filter((it) => it.id !== itemId);
      const updated = mode === 'top' ? [...without, item] : [item, ...without];
      const reindexed = updated.map((it, i) => ({ ...it, zIndex: i + 1 }));
      onUpdateState?.(id, { images: reindexed }, true);
      return reindexed;
    });
  };

  // 本地图片上传
  const handleUploadImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const uploadPlacements = [
      { x: 44, y: 18, width: 50, height: 60 },
      { x: 6, y: 56, width: 38, height: 32 },
      { x: 48, y: 54, width: 46, height: 34 },
    ];

    const newItems: EditorialImageItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve((ev.target?.result as string) || '');
        reader.readAsDataURL(file);
      });
      if (!dataUrl) continue;
      const ar = await probeImageAspectRatio(dataUrl);
      const p = uploadPlacements[(items.length + newItems.length) % uploadPlacements.length]!;

      newItems.push({
        id: `img_upload_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        src: dataUrl,
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
        aspectRatio: ar,
        rotation: 0,
        wrapMode: 'box',
        zIndex: items.length + newItems.length + 1,
      });
    }

    if (newItems.length > 0) {
      setItems((prev) => {
        const updated = [...prev, ...newItems];
        onUpdateState?.(id, { images: updated }, true);
        return updated;
      });
      showToast(`已添加 ${newItems.length} 张图片素材`, { type: 'success' });
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 删除图片素材
  const handleDeleteItem = (itemId: string) => {
    const item = items.find((it) => it.id === itemId);
    if (item?.src) {
      dismissedSourcesRef.current.add(item.src);
    }
    setItems((prev) => {
      const next = prev.filter((it) => it.id !== itemId);
      onUpdateState?.(
        id,
        {
          images: next,
          dismissedSources: Array.from(dismissedSourcesRef.current),
        },
        true
      );
      return next;
    });
    if (selectedItemId === itemId) setSelectedItemId(null);
  };

  // 1. 本地生成画报预览（不直接入库，需手动点击保存）
  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      showToast('正在利用 Pretext 渲染印刷级高清画报...', { type: 'info' });
      const dataUrl = await exportEditorialToPng(currentState, ratioPreset, activePreset);
      onUpdateState?.(id, { imageUrl: dataUrl, isSaved: false }, true);
      setIsEditing(false);
      setSelectedItemId(null);
      showToast('杂志画报生成完成（可点击右下角保存按钮写入数据库）', { type: 'success' });
    } catch (err: any) {
      showToast(`生成失败: ${err.message || '未知错误'}`, { type: 'error' });
    } finally {
      setIsGenerating(false);
    }
  };

  // 2. 独立保存到数据库
  const handleSaveToDatabase = async () => {
    const imgUrl = data?.imageUrl;
    if (!imgUrl || isSaving || !onExport) return;
    setIsSaving(true);
    try {
      await onExport(id, imgUrl, {
        ...currentState,
        imageUrl: imgUrl,
        isSaved: true,
      });
      onUpdateState?.(id, { isSaved: true });
      onSelect?.(id);
      showToast('画报已保存到数据库，已解锁公开与收藏', { type: 'success' });
    } catch (err: any) {
      showToast(err?.detail || err?.message || '保存到数据库失败，请重试', { type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownload = () => {
    if (!data?.imageUrl) return;
    const a = document.createElement('a');
    a.href = data.imageUrl;
    a.download = `editorial-${article.headline || Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('已开始下载画报 PNG', { type: 'success' });
  };

  const handleReset = () => {
    setPresetId(defaultPreset.id);
    setPageSize(defaultPreset.defaultRatio);
    setArticle(defaultPreset.defaultArticle);
    setTypography(defaultPreset.defaultTypography);
    setBackground(defaultPreset.defaultBackground);
    setItems([]);
    onUpdateState?.(
      id,
      {
        presetId: defaultPreset.id,
        pageSize: defaultPreset.defaultRatio,
        article: defaultPreset.defaultArticle,
        typography: defaultPreset.defaultTypography,
        background: defaultPreset.defaultBackground,
        images: [],
        imageUrl: null,
        isSaved: false,
      },
      true
    );
    setIsEditing(true);
    showToast('已重置为默认杂志版式', { type: 'info' });
  };

  const runToggle = async (
    action: ((id: string) => Promise<boolean>) | undefined,
    msg: (active: boolean) => string
  ) => {
    if (!action) return;
    try {
      const nextState = await action(id);
      showToast(msg(nextState), { type: 'success' });
    } catch {
      showToast('操作失败，请重试', { type: 'error' });
    }
  };

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '杂志排版'}
      dotColor={NODE_COLORS.editorial_layout}
      resizable
      defaultSize={{ width: 540, height: 720 }}
      className={`transition-[opacity,transform,box-shadow,border-color] duration-150 ease-out ${
        isSelected ? 'ring-2 ring-purple-500 shadow-md' : ''
      }`}
      showLeftAnchor={true}
      showRightAnchor={true}
      onClick={() => onSelect?.(id)}
      onRemove={onRemove ? () => onRemove(id) : undefined}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onResizeLive={onResizeLive}
      footer={footer}
      onContextMenu={onContextMenu}
      mismatchBadge={mismatchBadge}
      actionBar={
        <NodeActionBar>
          {hasGenerated ? (
            <>
              <NodeActionBar.Retry
                onClick={() => setIsEditing(true)}
                disabled={isSaving}
                tooltip="返回编辑排版模式"
                aria-label="返回编辑排版模式"
              />
              <NodeActionBar.Custom
                icon={<Upload size={16} strokeWidth={1.5} />}
                tooltip="添加图片素材（可多选）"
                aria-label="添加图片素材"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSaving}
              />
              <NodeActionBar.Custom
                icon={<Check size={16} strokeWidth={isSaved ? 2.5 : 1.5} className={isSaved ? 'text-accent' : ''} />}
                onClick={handleSaveToDatabase}
                disabled={isSaving || isSaved}
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
                disabled={!isSaved || isSaving || !onToggleFavorite}
              />
              <NodeActionBar.Custom
                icon={<Globe size={16} strokeWidth={1.5} className={isSaved && isPublic ? 'text-accent' : ''} />}
                tooltip={!isSaved ? '请先保存到数据库后再公开' : isPublic ? '从画廊撤下' : '公开到画廊'}
                aria-label={!isSaved ? '请先保存到数据库后再公开' : isPublic ? '从画廊撤下' : '公开到画廊'}
                onClick={() =>
                  runToggle(onTogglePublic, (act) => (act ? '已公开到画廊' : '已撤下'))
                }
                disabled={!isSaved || isSaving || !onTogglePublic}
              />
              <NodeActionBar.Download
                onClick={handleDownload}
                disabled={isSaving}
                tooltip="直接下载画报 PNG"
                aria-label="直接下载画报 PNG"
              />
              <NodeActionBar.Reset
                onClick={handleReset}
                disabled={isSaving}
                tooltip="重置为默认版式"
                aria-label="重置为默认版式"
              />
            </>
          ) : (
            <>
              <NodeActionBar.Custom
                icon={
                  isGenerating ? (
                    <Loader2 size={16} className="animate-spin text-purple-400" />
                  ) : (
                    <Wand2 size={16} strokeWidth={1.5} />
                  )
                }
                tooltip="生成杂志画报"
                aria-label="生成杂志画报"
                onClick={handleGenerate}
                disabled={isGenerating}
              />
              <NodeActionBar.Custom
                icon={<Upload size={16} strokeWidth={1.5} />}
                tooltip="添加图片素材（可多选）"
                aria-label="添加图片素材"
                onClick={() => fileInputRef.current?.click()}
                disabled={isGenerating}
              />
              <NodeActionBar.Reset
                onClick={handleReset}
                disabled={isGenerating}
                tooltip="重置为默认版式"
                aria-label="重置为默认版式"
              />
            </>
          )}
        </NodeActionBar>
      }
    >
      <div className="flex flex-col h-full bg-[#18181b] text-neutral-200 select-none overflow-hidden text-xs">
        {/* 隐藏的本地文件上传 input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={handleUploadImages}
        />

        {/* 已生成且非编辑模式：展示高保真大图预览 */}
        {hasGenerated && data.imageUrl ? (
          <div
            className="flex-1 relative overflow-hidden bg-neutral-950/80 flex items-center justify-center p-3 group/preview cursor-pointer"
            onDoubleClick={() => setIsEditing(true)}
            title="双击重新进入编辑排版"
          >
            <div
              className="relative shadow-2xl overflow-hidden select-none flex items-center justify-center"
              style={{
                aspectRatio: `${ratioPreset.aspectRatio}`,
                height: '100%',
                maxHeight: '100%',
              }}
            >
              <img
                src={data.imageUrl}
                alt="Generated Editorial"
                className="w-full h-full object-contain rounded-sm shadow-2xl transition-transform duration-200 group-hover/preview:scale-[1.01]"
              />
            </div>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/70 backdrop-blur-md rounded-full text-[11px] text-white/90 opacity-0 group-hover/preview:opacity-100 transition-opacity pointer-events-none shadow-lg">
              双击或点击右下角按钮返回编辑排版
            </div>
          </div>
        ) : (
          /* 编辑排版模式：100% 绝对所见即所得基准容器 */
          <>
            {/* 顶部工具栏 */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-neutral-900/80 gap-2 shrink-0">
              <div className="flex items-center gap-1.5">
                <select
                  value={presetId}
                  onChange={(e) => handleSelectPreset(e.target.value)}
                  className="bg-neutral-800 text-neutral-200 text-xs px-2 py-1 rounded border border-white/10 outline-none hover:border-purple-500/50 cursor-pointer"
                >
                  {EDITORIAL_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.englishName})
                    </option>
                  ))}
                </select>

                <select
                  value={pageSize}
                  onChange={(e) => {
                    const r = e.target.value as EditorialPageRatio;
                    setPageSize(r);
                    onUpdateState?.(id, { pageSize: r }, true);
                  }}
                  className="bg-neutral-800 text-neutral-300 text-xs px-1.5 py-1 rounded border border-white/10 outline-none cursor-pointer"
                >
                  {EDITORIAL_PAGE_RATIOS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setActiveTab(activeTab === 'article' ? 'preview' : 'article')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded transition text-xs ${
                    activeTab === 'article'
                      ? 'bg-purple-600 text-white'
                      : 'text-neutral-400 hover:bg-white/10 hover:text-white'
                  }`}
                  title="编辑文章内容"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>文章</span>
                </button>

                <button
                  onClick={() => setActiveTab(activeTab === 'style' ? 'preview' : 'style')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded transition text-xs ${
                    activeTab === 'style'
                      ? 'bg-purple-600 text-white'
                      : 'text-neutral-400 hover:bg-white/10 hover:text-white'
                  }`}
                  title="排版与字体"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>排版</span>
                </button>
              </div>
            </div>

            {/* 主排版舞台区域：所见即所得 Scale 容器 */}
            <div className="flex-1 relative overflow-hidden bg-neutral-950/70 flex items-center justify-center p-3">
              {/* 真实物理包裹层，动态监听宽高 */}
              <div
                ref={stageWrapperRef}
                className="relative shadow-2xl overflow-hidden select-none transition-all duration-150"
                style={{
                  aspectRatio: `${ratioPreset.aspectRatio}`,
                  height: '100%',
                  maxHeight: '100%',
                  width: 'auto',
                  backgroundColor: background.color || '#ffffff',
                }}
                onClick={() => setSelectedItemId(null)}
              >
                {/* 100% 绝对基准高清容器（应用精准 CSS Scale 缩放，与 Canvas Exporter 完全 1:1 对齐） */}
                <div
                  className="absolute top-0 left-0 origin-top-left pointer-events-auto"
                  style={{
                    width: `${ratioPreset.width}px`,
                    height: `${ratioPreset.height}px`,
                    transform: `scale(${scale})`,
                    backgroundColor: background.color || '#ffffff',
                  }}
                >
                  {/* 1. 侧边 Ribbon 标签 */}
                  {activePreset.features.hasRibbonTag && (
                    <div
                      className="absolute top-0 bg-black text-white flex items-center justify-center font-bold tracking-widest pointer-events-none"
                      style={{
                        left: `${Math.round(ratioPreset.width * 0.06)}px`,
                        width: `${Math.round(ratioPreset.width * 0.08)}px`,
                        height: `${Math.round(ratioPreset.height * 0.16)}px`,
                        fontSize: `${Math.round(ratioPreset.width * 0.022)}px`,
                        writingMode: 'vertical-rl',
                        fontFamily: typography.headlineFont,
                      }}
                    >
                      {article.issueDate ? `ISSUE ${article.issueDate}` : 'ISSUE 08'}
                    </div>
                  )}

                  {/* 2. 刊头 Masthead 与细分割线 */}
                  {article.masthead && (
                    <div
                      className="absolute font-bold flex justify-between items-center pointer-events-none"
                      style={{
                        top: `${Math.round(ratioPreset.height * 0.045)}px`,
                        left: `${Math.round(ratioPreset.width * 0.065)}px`,
                        right: `${Math.round(ratioPreset.width * 0.065)}px`,
                        fontSize: `${Math.round(ratioPreset.width * 0.014)}px`,
                        color: typography.accentColor || '#000000',
                        fontFamily: typography.headlineFont,
                        letterSpacing: '1px',
                        borderBottom: '1px solid rgba(0,0,0,0.12)',
                        paddingBottom: `${Math.round(ratioPreset.height * 0.008)}px`,
                      }}
                    >
                      <span>{article.masthead.toUpperCase()}</span>
                      {article.issueDate && <span className="opacity-60">{article.issueDate}</span>}
                    </div>
                  )}

                  {/* 3. 图片素材层（严格按自然比例渲染，与 Canvas 和 Pretext 障碍物 100% 吻合） */}
                  {items.map((item) => {
                    const isSelectedItem = selectedItemId === item.id;
                    const imgPxX = (item.x / 100) * ratioPreset.width;
                    const imgPxY = (item.y / 100) * ratioPreset.height;
                    const imgPxW = (item.width / 100) * ratioPreset.width;
                    const naturalRatio = item.aspectRatio || 1;
                    const imgPxH = imgPxW / naturalRatio;

                    return (
                      <div
                        key={item.id}
                        className={`absolute touch-none transition-shadow ${
                          isSelectedItem ? 'ring-4 ring-purple-500 ring-offset-2 z-30 shadow-2xl' : 'z-10'
                        }`}
                        style={{
                          left: `${imgPxX}px`,
                          top: `${imgPxY}px`,
                          width: `${imgPxW}px`,
                          height: `${imgPxH}px`,
                          transform: `rotate(${item.rotation || 0}deg)`,
                          transformOrigin: 'center center',
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedItemId(item.id);
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
                          className="w-full h-full object-cover rounded-sm shadow-md cursor-move block"
                        />

                        {/* 常驻悬浮微操作栏 */}
                        {isSelectedItem && (
                          <div
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            className={`absolute left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-900/95 backdrop-blur-md shadow-2xl border border-white/20 z-50 pointer-events-auto ${
                              item.y < 16 ? '-bottom-14' : '-top-14'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => rotateStepItem(item.id, 'ccw')}
                              className="p-1 rounded text-neutral-300 hover:text-white hover:bg-white/10"
                              title="逆时针旋转 90° (摆正)"
                            >
                              <RotateCcw className="w-5 h-5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => rotateStepItem(item.id, 'cw')}
                              className="p-1 rounded text-neutral-300 hover:text-white hover:bg-white/10"
                              title="顺时针旋转 90° (摆正)"
                            >
                              <RotateCw className="w-5 h-5" />
                            </button>
                            <div className="w-px h-5 bg-white/20 my-auto" />
                            <button
                              type="button"
                              onClick={() => bumpLayer(item.id, 'top')}
                              className="p-1 rounded text-neutral-300 hover:text-white hover:bg-white/10"
                              title="置顶图层"
                            >
                              <ChevronsUp className="w-5 h-5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => bumpLayer(item.id, 'bottom')}
                              className="p-1 rounded text-neutral-300 hover:text-white hover:bg-white/10"
                              title="置底图层"
                            >
                              <ChevronsDown className="w-5 h-5" />
                            </button>
                            <div className="w-px h-5 bg-white/20 my-auto" />
                            <button
                              type="button"
                              onClick={() => handleDeleteItem(item.id)}
                              className="p-1 rounded text-red-400 hover:text-red-300 hover:bg-red-500/20"
                              title="移除图片"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>
                        )}

                        {/* 选中时的缩放手柄与旋转手柄 */}
                        {isSelectedItem && (
                          <>
                            {/* 右下角缩放手柄 */}
                            <div
                              onPointerDown={(e) => beginGesture(e, item, 'resize')}
                              onPointerMove={moveGesture}
                              onPointerUp={endGesture}
                              onPointerCancel={endGesture}
                              title="拖拽放大缩小"
                              className="absolute -right-4 -bottom-4 w-9 h-9 rounded-full bg-purple-600 border-4 border-white shadow-2xl cursor-nwse-resize hover:scale-115 active:scale-95 transition-transform flex items-center justify-center z-40"
                            >
                              <div className="w-3 h-3 rounded-full bg-white" />
                            </div>

                            {/* 底部引线旋转手柄 */}
                            <div className="absolute left-1/2 -bottom-12 -translate-x-1/2 flex flex-col items-center pointer-events-none z-40">
                              <div className="w-1 h-5 bg-purple-500" />
                              <div
                                onPointerDown={(e) => beginGesture(e, item, 'rotate')}
                                onPointerMove={moveGesture}
                                onPointerUp={endGesture}
                                onPointerCancel={endGesture}
                                title="按住自由旋转"
                                className="w-9 h-9 rounded-full bg-purple-600 border-4 border-white shadow-2xl cursor-grab active:cursor-grabbing hover:scale-115 transition-transform pointer-events-auto flex items-center justify-center text-white text-xs"
                              >
                                <RotateCw className="w-4 h-4" />
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}

                  {/* 4. 大标题 Headline（与 Canvas Exporter 完全 1:1） */}
                  <div
                    className="absolute font-bold leading-tight pointer-events-none"
                    style={{
                      left: `${layoutProjection.headlineRegion.x}px`,
                      top: `${layoutProjection.headlineRegion.y}px`,
                      width: `${layoutProjection.headlineRegion.width}px`,
                      font: layoutProjection.headlineFont,
                      color: typography.textColor,
                    }}
                  >
                    {layoutProjection.headlineLines.map((line, idx) => (
                      <div
                        key={idx}
                        style={{
                          lineHeight: `${layoutProjection.headlineLineHeight}px`,
                        }}
                      >
                        {line.text}
                      </div>
                    ))}
                  </div>

                  {/* 5. 导语 Deck */}
                  {layoutProjection.deckLines.length > 0 && layoutProjection.deckRegion && (
                    <div
                      className="absolute font-medium opacity-80 pointer-events-none"
                      style={{
                        left: `${layoutProjection.deckRegion.x}px`,
                        top: `${layoutProjection.deckRegion.y}px`,
                        width: `${layoutProjection.deckRegion.width}px`,
                        fontFamily: typography.headlineFont,
                        color: typography.textColor,
                      }}
                    >
                      {layoutProjection.deckLines.map((line, idx) => (
                        <div
                          key={idx}
                          style={{
                            fontSize: `${Math.round(typography.bodyFontSize * 1.25)}px`,
                            lineHeight: `${Math.round(typography.bodyFontSize * 1.6)}px`,
                          }}
                        >
                          {line.text}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 6. 首字下沉 Drop Cap */}
                  {layoutProjection.dropCap && (
                    <div
                      className="absolute font-bold leading-none pointer-events-none"
                      style={{
                        left: `${layoutProjection.dropCap.x}px`,
                        top: `${layoutProjection.dropCap.y}px`,
                        fontSize: `${layoutProjection.dropCap.height}px`,
                        color: typography.accentColor || '#000000',
                        fontFamily: typography.headlineFont,
                      }}
                    >
                      {layoutProjection.dropCap.text}
                    </div>
                  )}

                  {/* 7. 正文流各行（Pretext 0.05ms 计算出的精准槽位） */}
                  {layoutProjection.bodyLines.map((line, idx) => (
                    <div
                      key={idx}
                      className="absolute whitespace-nowrap overflow-visible pointer-events-none"
                      style={{
                        left: `${line.x}px`,
                        top: `${line.y}px`,
                        fontSize: `${typography.bodyFontSize}px`,
                        fontFamily: typography.bodyFont,
                        color: typography.textColor,
                        lineHeight: `${typography.bodyLineHeight}px`,
                      }}
                    >
                      {line.text}
                    </div>
                  ))}

                  {/* 8. 页脚版记与期号 */}
                  <div
                    className="absolute flex items-center justify-between font-semibold opacity-50 pointer-events-none"
                    style={{
                      bottom: `${Math.round(ratioPreset.height * 0.035)}px`,
                      left: `${Math.round(ratioPreset.width * 0.065)}px`,
                      right: `${Math.round(ratioPreset.width * 0.065)}px`,
                      fontSize: `${Math.round(ratioPreset.width * 0.012)}px`,
                      color: typography.textColor,
                      fontFamily: typography.headlineFont,
                    }}
                  >
                    <span>{article.folio || 'ECHOES FORGE EDITORIAL'}</span>
                    <span>{article.issueDate}</span>
                  </div>

                  {/* 9. 底部条形码装饰（按预设开关，与 Canvas Exporter 完全对齐） */}
                  {activePreset.features.hasBarcode && (
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        bottom: `${Math.round(ratioPreset.height * 0.06)}px`,
                        left: `${Math.round(ratioPreset.width * 0.065)}px`,
                      }}
                    >
                      <BarcodeSvg
                        width={Math.round(ratioPreset.width * 0.14)}
                        height={Math.round(ratioPreset.height * 0.02)}
                        color="#000000"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* 抽屉浮层：文章内容编辑 */}
              <AnimatePresence>
                {activeTab === 'article' && (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="absolute inset-y-2 right-2 w-72 bg-neutral-900/95 backdrop-blur-md border border-white/10 rounded-lg p-3 shadow-2xl z-40 flex flex-col gap-2.5 overflow-y-auto text-xs"
                  >
                    <div className="flex items-center justify-between font-medium text-neutral-200 pb-1 border-b border-white/10">
                      <span>文章结构编辑</span>
                      <button
                        onClick={() => setActiveTab('preview')}
                        className="text-neutral-400 hover:text-white"
                      >
                        ✕
                      </button>
                    </div>

                    <div>
                      <label className="block text-[10px] text-neutral-400 mb-1">刊头 / 眉标 (Masthead)</label>
                      <input
                        type="text"
                        value={article.masthead || ''}
                        onChange={(e) => {
                          const masthead = e.target.value;
                          setArticle((prev) => ({ ...prev, masthead }));
                          onUpdateState?.(id, { article: { ...article, masthead } });
                        }}
                        className="w-full bg-neutral-800 border border-white/10 rounded px-2 py-1 text-neutral-200 outline-none focus:border-purple-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-neutral-400 mb-1">大标题 (Headline)</label>
                      <input
                        type="text"
                        value={article.headline || ''}
                        onChange={(e) => {
                          const headline = e.target.value;
                          setArticle((prev) => ({ ...prev, headline }));
                          onUpdateState?.(id, { article: { ...article, headline } });
                        }}
                        className="w-full bg-neutral-800 border border-white/10 rounded px-2 py-1 text-neutral-200 font-bold outline-none focus:border-purple-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-neutral-400 mb-1">导语 / 副标题 (Deck)</label>
                      <textarea
                        rows={2}
                        value={article.deck || ''}
                        onChange={(e) => {
                          const deck = e.target.value;
                          setArticle((prev) => ({ ...prev, deck }));
                          onUpdateState?.(id, { article: { ...article, deck } });
                        }}
                        className="w-full bg-neutral-800 border border-white/10 rounded px-2 py-1 text-neutral-200 outline-none focus:border-purple-500 resize-none"
                      />
                    </div>

                    <div className="flex-1 flex flex-col">
                      <label className="block text-[10px] text-neutral-400 mb-1">正文全文 (Body)</label>
                      <textarea
                        rows={6}
                        value={article.body || ''}
                        onChange={(e) => {
                          const body = e.target.value;
                          setArticle((prev) => ({ ...prev, body }));
                          onUpdateState?.(id, { article: { ...article, body } });
                        }}
                        className="w-full flex-1 bg-neutral-800 border border-white/10 rounded px-2 py-1 text-neutral-200 outline-none focus:border-purple-500 resize-none leading-relaxed"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-neutral-400 mb-1">页脚版记 / 期号</label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          placeholder="Folio"
                          value={article.folio || ''}
                          onChange={(e) => {
                            const folio = e.target.value;
                            setArticle((prev) => ({ ...prev, folio }));
                            onUpdateState?.(id, { article: { ...article, folio } });
                          }}
                          className="flex-1 bg-neutral-800 border border-white/10 rounded px-2 py-1 text-neutral-200 outline-none"
                        />
                        <input
                          type="text"
                          placeholder="Date"
                          value={article.issueDate || ''}
                          onChange={(e) => {
                            const issueDate = e.target.value;
                            setArticle((prev) => ({ ...prev, issueDate }));
                            onUpdateState?.(id, { article: { ...article, issueDate } });
                          }}
                          className="w-24 bg-neutral-800 border border-white/10 rounded px-2 py-1 text-neutral-200 outline-none"
                        />
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* 抽屉浮层：字体与排版样式 */}
                {activeTab === 'style' && (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="absolute inset-y-2 right-2 w-64 bg-neutral-900/95 backdrop-blur-md border border-white/10 rounded-lg p-3 shadow-2xl z-40 flex flex-col gap-3 overflow-y-auto text-xs"
                  >
                    <div className="flex items-center justify-between font-medium text-neutral-200 pb-1 border-b border-white/10">
                      <span>字体与排版</span>
                      <button
                        onClick={() => setActiveTab('preview')}
                        className="text-neutral-400 hover:text-white"
                      >
                        ✕
                      </button>
                    </div>

                    <div>
                      <label className="block text-[10px] text-neutral-400 mb-1">标题字体</label>
                      <select
                        value={typography.headlineFont}
                        onChange={(e) => {
                          const f = e.target.value;
                          setTypography((prev) => ({ ...prev, headlineFont: f }));
                          onUpdateState?.(id, { typography: { ...typography, headlineFont: f } });
                        }}
                        className="w-full bg-neutral-800 text-neutral-200 text-xs px-2 py-1.5 rounded border border-white/10 outline-none"
                      >
                        {JOURNAL_FONTS.map((font) => (
                          <option key={font.id} value={font.family}>
                            {font.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-neutral-400 mb-1">正文字体</label>
                      <select
                        value={typography.bodyFont}
                        onChange={(e) => {
                          const f = e.target.value;
                          setTypography((prev) => ({ ...prev, bodyFont: f }));
                          onUpdateState?.(id, { typography: { ...typography, bodyFont: f } });
                        }}
                        className="w-full bg-neutral-800 text-neutral-200 text-xs px-2 py-1.5 rounded border border-white/10 outline-none"
                      >
                        {JOURNAL_FONTS.map((font) => (
                          <option key={font.id} value={font.family}>
                            {font.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="flex justify-between text-[10px] text-neutral-400 mb-1">
                        <span>正文字号</span>
                        <span>{typography.bodyFontSize}px</span>
                      </div>
                      <input
                        type="range"
                        min={14}
                        max={28}
                        step={1}
                        value={typography.bodyFontSize}
                        onChange={(e) => {
                          const s = Number(e.target.value);
                          const lh = Math.round(s * 1.6);
                          setTypography((prev) => ({ ...prev, bodyFontSize: s, bodyLineHeight: lh }));
                          onUpdateState?.(id, { typography: { ...typography, bodyFontSize: s, bodyLineHeight: lh } });
                        }}
                        className="w-full accent-purple-500 cursor-pointer"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-neutral-300">首字下沉 (Drop Cap)</span>
                      <input
                        type="checkbox"
                        checked={typography.dropCap}
                        onChange={(e) => {
                          const dc = e.target.checked;
                          setTypography((prev) => ({ ...prev, dropCap: dc }));
                          onUpdateState?.(id, { typography: { ...typography, dropCap: dc } });
                        }}
                        className="accent-purple-500 w-4 h-4 cursor-pointer"
                      />
                    </div>

                    <div className="pt-1 border-t border-white/10">
                      <label className="block text-[10px] text-neutral-400 mb-1.5">文字颜色预设</label>
                      <div className="flex flex-wrap gap-1.5">
                        {JOURNAL_TEXT_COLORS.map((col) => (
                          <button
                            key={col.name}
                            onClick={() => {
                              setTypography((prev) => ({ ...prev, textColor: col.color }));
                              onUpdateState?.(id, { typography: { ...typography, textColor: col.color } });
                            }}
                            className={`w-5 h-5 rounded-full border ${
                              typography.textColor === col.color ? 'border-purple-500 scale-110' : 'border-white/20'
                            } transition`}
                            style={{ backgroundColor: col.color }}
                            title={col.name}
                          />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        )}
      </div>
    </CanvasNode>
  );
};

export const EditorialLayoutNode = memo(EditorialLayoutNodeInner);
