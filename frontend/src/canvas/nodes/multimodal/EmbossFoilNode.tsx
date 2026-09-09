import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import {
  Sparkles,
  Heart,
  Globe,
  Upload,
  Trash2,
  Loader2,
  Pencil,
  Check,
  Layers,
  SlidersHorizontal,
  Stamp,
  Crosshair,
  RotateCcw,
  X,
} from 'lucide-react';
import { CanvasNode } from '../_shared/CanvasNode';
import { NodeActionBar } from '../_shared/NodeActionBar';
import { useFeedback } from '../../../shared/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../_shared/nodeTypes';
import {
  type EmbossFoilState,
  type EmbossReliefStyle,
  type FoilShimmerType,
  type LightPoint,
  DEFAULT_PRESET_ID,
  getEmbossFoilPreset,
  loadImage,
  renderEmbossFoilFromImage,
  EmbossFoilStudioPanel,
} from './engines/emboss';

export interface EmbossFoilNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 节点持久化数据 */
  data?: Partial<EmbossFoilState>;
  /** 上游图书元数据封面图或直接上级图片输出 */
  upstreamImageUrl?: string | null;
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
  /** 状态更新写入 node.data */
  onUpdateState?: (id: string, patch: Partial<EmbossFoilState>) => void;
  /** 导出图片：PNG Data URL 落盘保存 + 写入历史数据库 */
  onExport?: (
    id: string,
    dataUrl: string,
    state: Partial<EmbossFoilState>
  ) => Promise<void>;
}

const EmbossFoilNodeInner: React.FC<EmbossFoilNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  data = {},
  upstreamImageUrl,
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

  // 1. 输入图片优先级：本地上传 > 直连非图书图片 > 连线图书封面 > 根图书封面兜底
  const activeImageSrc = useMemo(
    () => data?.uploadedImage || upstreamImageUrl || null,
    [data?.uploadedImage, upstreamImageUrl]
  );

  // 参数状态与缺省回退
  const presetId = data.presetId || DEFAULT_PRESET_ID;
  const reliefStyle: EmbossReliefStyle = data.reliefStyle || 'topography';
  const shimmerType: FoilShimmerType = data.shimmerType || 'prismatic_opal';
  const depth = data.depth !== undefined ? data.depth : 68;
  const brightness = data.brightness !== undefined ? data.brightness : 72;
  const radius = data.radius !== undefined ? data.radius : 46;
  const lightAngle = data.lightAngle !== undefined ? data.lightAngle : 225;
  const lightPoints: LightPoint[] = useMemo(() => data.lightPoints || [], [data.lightPoints]);
  const withPerforation = data.withPerforation !== undefined ? data.withPerforation : true;
  const withMargin = data.withMargin !== undefined ? data.withMargin : true;

  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // 计算默认自然光照中心（依据 lightAngle 三角换算，225° 默认偏左上）
  const defaultLightPos = useMemo(() => {
    const rad = (lightAngle * Math.PI) / 180;
    return {
      x: Math.round(50 + Math.cos(rad) * 28),
      y: Math.round(50 + Math.sin(rad) * 28),
    };
  }, [lightAngle]);

  // 动效无障碍偏好
  const prefersReducedMotion = useReducedMotion();

  // 3D 鼠标互动卡片 ref 与布局缓存
  const cardContainerRef = useRef<HTMLDivElement>(null);
  const cardElementRef = useRef<HTMLDivElement>(null);
  const cardRectRef = useRef<DOMRect | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 组件卸载时清理 rAF
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // 当外部 data.imageUrl 变更时同步编辑态
  useEffect(() => {
    setIsEditing(!data?.imageUrl);
  }, [data?.imageUrl]);

  const patchState = useCallback(
    (patch: Partial<EmbossFoilState>) => {
      onUpdateState?.(id, patch);
    },
    [id, onUpdateState]
  );

  // 切换预设（重置自定义定光，采用预设默认自然光）
  const handlePresetChange = useCallback(
    (nextPresetId: string) => {
      const preset = getEmbossFoilPreset(nextPresetId);
      patchState({
        presetId: nextPresetId,
        reliefStyle: preset.params.reliefStyle || 'topography',
        shimmerType: preset.params.shimmerType || 'prismatic_opal',
        depth: preset.params.depth ?? 65,
        brightness: preset.params.brightness ?? 70,
        radius: preset.params.radius ?? 45,
        lightAngle: preset.params.lightAngle ?? 225,
        lightPoints: null,
        withPerforation: preset.params.withPerforation ?? true,
        withMargin: preset.params.withMargin ?? true,
      });
    },
    [patchState]
  );

  // 鼠标移入卡片：缓存尺寸并关闭 transition 达到 1:1 跟手
  const handleCardMouseEnter = useCallback(() => {
    const el = cardElementRef.current;
    if (!el) return;
    cardRectRef.current = el.getBoundingClientRect();
    el.style.transition = 'none';
  }, []);

  // 鼠标在 3D 卡片上移动：通过 rAF 计算倾斜角度与高光坐标（避免 Layout Thrashing）
  const handleCardMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = cardElementRef.current;
      if (!el) return;

      if (!cardRectRef.current || cardRectRef.current.width <= 0) {
        cardRectRef.current = el.getBoundingClientRect();
      }
      const rect = cardRectRef.current;
      if (!rect || rect.width <= 0 || rect.height <= 0) return;

      const clientX = e.clientX;
      const clientY = e.clientY;

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      rafIdRef.current = requestAnimationFrame(() => {
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const px = Math.max(0, Math.min(100, (x / rect.width) * 100));
        const py = Math.max(0, Math.min(100, (y / rect.height) * 100));

        // 减少动效模式下保持平面，不触发 3D 倾斜
        const rx = prefersReducedMotion ? 0 : ((py - 50) / 50) * -12;
        const ry = prefersReducedMotion ? 0 : ((px - 50) / 50) * 12;

        el.style.setProperty('--pointer-x', `${px.toFixed(1)}%`);
        el.style.setProperty('--pointer-y', `${py.toFixed(1)}%`);
        el.style.setProperty('--rotate-x', `${rx.toFixed(1)}deg`);
        el.style.setProperty('--rotate-y', `${ry.toFixed(1)}deg`);
        el.style.setProperty('--shine-opacity', '1');
      });
    },
    [prefersReducedMotion]
  );

  // 鼠标移出卡片：启用弹性 ease-out 回正
  const handleCardMouseLeave = useCallback(() => {
    const el = cardElementRef.current;
    if (!el) return;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    cardRectRef.current = null;

    el.style.transition = 'transform 0.26s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.2s ease-out';
    el.style.setProperty('--pointer-x', `${defaultLightPos.x}%`);
    el.style.setProperty('--pointer-y', `${defaultLightPos.y}%`);
    el.style.setProperty('--rotate-x', '0deg');
    el.style.setProperty('--rotate-y', '0deg');
    el.style.setProperty('--shine-opacity', '0.75');
  }, [defaultLightPos.x, defaultLightPos.y]);

  // 点击卡片直接添加高光落点（支持单点或多点，最多 6 个）
  const handleCardClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = cardElementRef.current;
      if (!el) return;
      const rect = cardRectRef.current || el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const px = Math.round(Math.max(0, Math.min(100, (x / rect.width) * 100)));
      const py = Math.round(Math.max(0, Math.min(100, (y / rect.height) * 100)));

      if (lightPoints.length >= 6) {
        showToast('最多支持添加 6 个高光落点', { type: 'warning' });
        return;
      }

      const newPoint: LightPoint = {
        id: `pt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        x: px,
        y: py,
      };

      patchState({ lightPoints: [...lightPoints, newPoint] });
    },
    [lightPoints, patchState, showToast]
  );

  // 删除单个高光落点
  const handleRemovePoint = useCallback(
    (pointId: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      const next = lightPoints.filter((pt) => pt.id !== pointId);
      patchState({ lightPoints: next.length > 0 ? next : null });
    },
    [lightPoints, patchState]
  );

  // 清除自定义高光锁定，恢复自然光位
  const handleResetLightPoints = useCallback(() => {
    patchState({ lightPoints: null });
    showToast('已恢复默认自然光位', { type: 'success' });
  }, [patchState, showToast]);

  // 重置工艺全部参数为初始默认预设（若处于预览态则一并清空成图回到编辑态）
  const handleResetParams = useCallback(() => {
    const defaultPreset = getEmbossFoilPreset(DEFAULT_PRESET_ID);
    const patch: Partial<EmbossFoilState> = {
      presetId: DEFAULT_PRESET_ID,
      reliefStyle: defaultPreset.params.reliefStyle || 'topography',
      shimmerType: defaultPreset.params.shimmerType || 'prismatic_opal',
      depth: defaultPreset.params.depth ?? 68,
      brightness: defaultPreset.params.brightness ?? 72,
      radius: defaultPreset.params.radius ?? 46,
      lightAngle: defaultPreset.params.lightAngle ?? 225,
      lightPoints: null,
      withPerforation: defaultPreset.params.withPerforation ?? true,
      withMargin: defaultPreset.params.withMargin ?? true,
    };

    if (data?.imageUrl && !isEditing) {
      setIsEditing(true);
      patch.imageUrl = null;
      patch.isSaved = false;
    }

    patchState(patch);
    showToast('已重置为初始默认参数', { type: 'success' });
  }, [data?.imageUrl, isEditing, patchState, showToast]);

  // 执行 Canvas 高保真渲染烘焙
  const handleGenerate = useCallback(async () => {
    if (!activeImageSrc || isGenerating) return;
    setIsGenerating(true);
    try {
      const img = await loadImage(activeImageSrc);
      const dataUrl = await renderEmbossFoilFromImage(
        img,
        {
          reliefStyle,
          shimmerType,
          depth,
          brightness,
          radius,
          lightAngle,
          lightPoints: lightPoints.length > 0 ? lightPoints : undefined,
          withPerforation,
          withMargin,
        },
        { maxEdge: 1800 }
      );

      patchState({
        presetId,
        reliefStyle,
        shimmerType,
        depth,
        brightness,
        radius,
        lightAngle,
        lightPoints: lightPoints.length > 0 ? lightPoints : null,
        withPerforation,
        withMargin,
        imageUrl: dataUrl,
        isSaved: false,
      });
      setIsEditing(false);
      showToast('微浮雕高光生成完成（可点击保存按钮写入数据库）', { type: 'success' });
    } catch (err: unknown) {
      console.error('生成微浮雕高光失败:', err);
      showToast(err instanceof Error ? err.message : '生成失败，请重试', { type: 'error' });
    } finally {
      setIsGenerating(false);
    }
  }, [
    activeImageSrc,
    isGenerating,
    reliefStyle,
    shimmerType,
    depth,
    brightness,
    radius,
    lightAngle,
    lightPoints,
    withPerforation,
    withMargin,
    presetId,
    patchState,
    showToast,
  ]);

  // 独立保存到数据库
  const handleSaveToDatabase = useCallback(async () => {
    const imgUrl = data?.imageUrl;
    if (!imgUrl || isExporting || !onExport) return;
    setIsExporting(true);
    try {
      await onExport(id, imgUrl, {
        presetId,
        reliefStyle,
        shimmerType,
        depth,
        brightness,
        radius,
        lightAngle,
        lightPoints: lightPoints.length > 0 ? lightPoints : null,
        withPerforation,
        withMargin,
        uploadedImage: data.uploadedImage ?? null,
        imageUrl: imgUrl,
        isSaved: true,
      });
      patchState({ isSaved: true });
      onSelect?.(id);
      showToast('已保存到数据库，已解锁公开与收藏', { type: 'success' });
    } catch (err: any) {
      console.error('保存到数据库失败:', err);
      showToast(err?.detail || err?.message || '保存失败，请重试', { type: 'error' });
    } finally {
      setIsExporting(false);
    }
  }, [
    data?.imageUrl,
    data?.uploadedImage,
    isExporting,
    onExport,
    id,
    presetId,
    reliefStyle,
    shimmerType,
    depth,
    brightness,
    radius,
    lightAngle,
    lightPoints,
    withPerforation,
    withMargin,
    patchState,
    onSelect,
    showToast,
  ]);

  // 本地直接下载 PNG
  const handleDownload = useCallback(() => {
    const url = data?.imageUrl;
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `emboss-foil-${Date.now()}.png`;
    link.click();
    showToast('图片已下载', { type: 'success' });
  }, [data?.imageUrl, showToast]);

  // 本地上传图片
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件', { type: 'warning' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      const result = evt.target?.result as string;
      if (result) {
        patchState({ uploadedImage: result, imageUrl: null });
        setIsEditing(true);
        showToast('已加载本地图片', { type: 'success' });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // 恢复上游图片
  const handleClearUpload = () => {
    patchState({ uploadedImage: null, imageUrl: null });
    setIsEditing(true);
    showToast('已恢复上级输入图片', { type: 'success' });
  };

  // 收藏与公开
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

  // CSS 动态高光渐变规则（支持单点/多点实时 3D 预览）
  const shimmerGradientCss = useMemo(() => {
    const alpha = (brightness / 100) * 0.9;
    const getGradForPos = (posX: string | number, posY: string | number) => {
      const xStr = typeof posX === 'number' ? `${posX}%` : posX;
      const yStr = typeof posY === 'number' ? `${posY}%` : posY;
      switch (shimmerType) {
        case 'prismatic_opal':
          return `radial-gradient(circle at ${xStr} ${yStr}, rgba(255, 255, 255, ${alpha}) 0%, rgba(255, 185, 210, ${alpha * 0.9}) 16%, rgba(130, 245, 215, ${alpha * 0.78}) 36%, rgba(120, 210, 255, ${alpha * 0.65}) 56%, rgba(205, 160, 255, ${alpha * 0.35}) 76%, transparent 90%)`;
        case 'neon_cyber':
          return `radial-gradient(circle at ${xStr} ${yStr}, rgba(255, 255, 255, ${alpha}) 0%, rgba(255, 45, 150, ${alpha * 0.92}) 20%, rgba(150, 60, 255, ${alpha * 0.75}) 46%, rgba(0, 240, 255, ${alpha * 0.48}) 72%, transparent 88%)`;
        case 'rose_champagne':
          return `radial-gradient(circle at ${xStr} ${yStr}, rgba(255, 255, 245, ${alpha}) 0%, rgba(255, 195, 150, ${alpha * 0.88}) 20%, rgba(245, 130, 175, ${alpha * 0.68}) 46%, rgba(195, 120, 195, ${alpha * 0.25}) 76%, transparent 90%)`;
        case 'nebula_violet':
          return `radial-gradient(circle at ${xStr} ${yStr}, rgba(255, 240, 255, ${alpha}) 0%, rgba(215, 75, 255, ${alpha * 0.88}) 20%, rgba(75, 110, 255, ${alpha * 0.62}) 50%, rgba(0, 210, 255, ${alpha * 0.25}) 78%, transparent 90%)`;
        case 'rainbow_foil':
          return `radial-gradient(circle at ${xStr} ${yStr}, rgba(255, 255, 255, ${alpha}) 0%, rgba(255, 220, 100, ${alpha * 0.85}) 18%, rgba(255, 120, 180, ${alpha * 0.75}) 35%, rgba(160, 100, 255, ${alpha * 0.65}) 52%, rgba(80, 220, 255, ${alpha * 0.45}) 70%, transparent 85%)`;
        case 'warm_gold':
          return `radial-gradient(circle at ${xStr} ${yStr}, rgba(255, 255, 235, ${alpha}) 0%, rgba(255, 220, 130, ${alpha * 0.85}) 22%, rgba(230, 175, 60, ${alpha * 0.45}) 50%, rgba(180, 120, 30, ${alpha * 0.12}) 75%, transparent 90%)`;
        case 'pearl_platinum':
          return `radial-gradient(circle at ${xStr} ${yStr}, rgba(255, 255, 255, ${alpha}) 0%, rgba(225, 240, 255, ${alpha * 0.82}) 20%, rgba(235, 220, 250, ${alpha * 0.48}) 48%, rgba(190, 205, 230, ${alpha * 0.16}) 76%, transparent 88%)`;
        case 'obsidian_gold':
          return `radial-gradient(circle at ${xStr} ${yStr}, rgba(255, 250, 235, ${alpha}) 0%, rgba(235, 195, 110, ${alpha * 0.9}) 18%, rgba(160, 115, 45, ${alpha * 0.65}) 44%, rgba(35, 38, 48, ${alpha * 0.35}) 72%, transparent 88%)`;
      }
    };

    if (lightPoints.length > 0) {
      return lightPoints.map((pt) => getGradForPos(pt.x, pt.y)).join(', ');
    }
    return getGradForPos(
      `var(--pointer-x, ${defaultLightPos.x}%)`,
      `var(--pointer-y, ${defaultLightPos.y}%)`
    );
  }, [shimmerType, brightness, lightPoints, defaultLightPos.x, defaultLightPos.y]);

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '微浮雕高光'}
      dotColor={NODE_COLORS.emboss_foil || 'oklch(0.68 0.16 160)'}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 440, height: 620 }}
      className={`transition-[opacity,transform,box-shadow,border-color] duration-150 ease-out ${
        isSelected ? 'ring-2 ring-accent/70 shadow-md' : ''
      }`}
      showLeftAnchor={true}
      showRightAnchor={true}
      onClick={() => onSelect?.(id)}
      footer={footer}
      sideDrawer={
        isEditing ? (
          <EmbossFoilStudioPanel
            isOpen={isDrawerOpen}
            presetId={presetId}
            reliefStyle={reliefStyle}
            shimmerType={shimmerType}
            depth={depth}
            brightness={brightness}
            radius={radius}
            lightAngle={lightAngle}
            lightPoints={lightPoints}
            withPerforation={withPerforation}
            withMargin={withMargin}
            disabled={isGenerating}
            onUpdate={patchState}
            onSelectPreset={handlePresetChange}
            onResetPoints={handleResetLightPoints}
            onClose={() => setIsDrawerOpen(false)}
          />
        ) : undefined
      }
      mismatchBadge={mismatchBadge}
      actionBar={
        <NodeActionBar>
          {hasGenerated ? (
            <>
              <NodeActionBar.Retry
                onClick={() => setIsEditing(true)}
                disabled={isExporting}
                tooltip="重新调整参数"
              />
              <NodeActionBar.Custom
                icon={<Upload size={16} strokeWidth={1.5} />}
                tooltip="上传/替换本地图片"
                onClick={() => fileInputRef.current?.click()}
                disabled={isExporting}
              />
              {data?.uploadedImage && (
                <NodeActionBar.Custom
                  icon={<Trash2 size={16} strokeWidth={1.5} className="text-error/80 hover:text-error" />}
                  tooltip="恢复上级继承图片（清空本地上传）"
                  onClick={handleClearUpload}
                  disabled={isExporting}
                />
              )}
              {/* 独立保存到数据库按钮 */}
              <NodeActionBar.Custom
                icon={<Check size={16} strokeWidth={1.5} className={isSaved ? 'text-accent' : ''} />}
                onClick={handleSaveToDatabase}
                disabled={isExporting || isSaved}
                tooltip={isSaved ? '已保存到数据库' : '保存到数据库（保存后可公开/收藏）'}
                className={isSaved ? 'text-accent opacity-70' : 'text-ink-light hover:text-accent'}
              />
              {/* 收藏按钮 */}
              <NodeActionBar.Custom
                icon={
                  <Heart
                    size={16}
                    strokeWidth={1.5}
                    className={isSaved && isFavorited ? 'fill-accent text-accent' : ''}
                  />
                }
                tooltip={
                  !isSaved
                    ? '请先保存到数据库后再收藏'
                    : isFavorited
                      ? '取消收藏'
                      : '收藏'
                }
                onClick={() =>
                  isSaved && runToggle(onToggleFavorite, (act) => (act ? '已收藏' : '已取消收藏'))
                }
                disabled={!isSaved || isExporting || !onToggleFavorite}
              />
              {/* 公开按钮 */}
              <NodeActionBar.Custom
                icon={
                  <Globe
                    size={16}
                    strokeWidth={1.5}
                    className={isSaved && isPublic ? 'text-accent' : ''}
                  />
                }
                tooltip={
                  !isSaved
                    ? '请先保存到数据库后再公开'
                    : isPublic
                      ? '从画廊撤下'
                      : '公开到画廊'
                }
                onClick={() =>
                  isSaved && runToggle(onTogglePublic, (act) => (act ? '已公开' : '已撤下'))
                }
                disabled={!isSaved || isExporting || !onTogglePublic}
              />
              {/* 下载按钮 */}
              <NodeActionBar.Download
                onClick={handleDownload}
                disabled={isExporting}
                tooltip="直接下载结果 PNG"
              />
              <NodeActionBar.Reset
                onClick={handleResetParams}
                disabled={isExporting}
                tooltip="重置为初始默认参数"
              />
            </>
          ) : (
            <>
              <NodeActionBar.Custom
                icon={
                  isGenerating ? (
                    <Loader2 size={16} className="animate-spin text-accent" />
                  ) : (
                    <Sparkles size={16} strokeWidth={1.5} />
                  )
                }
                tooltip="生成微浮雕高光图片"
                onClick={handleGenerate}
                disabled={!activeImageSrc || isGenerating}
              />
              <NodeActionBar.Custom
                icon={
                  <SlidersHorizontal
                    size={16}
                    strokeWidth={1.5}
                    className={isDrawerOpen ? 'text-accent' : ''}
                  />
                }
                tooltip={isDrawerOpen ? '收起配置抽屉' : '展开参数配置抽屉'}
                onClick={() => setIsDrawerOpen((prev) => !prev)}
                className={isDrawerOpen ? 'text-accent' : ''}
              />
              <NodeActionBar.Custom
                icon={<Upload size={16} strokeWidth={1.5} />}
                tooltip="上传/替换本地图片"
                onClick={() => fileInputRef.current?.click()}
                disabled={isGenerating}
              />
              {data?.uploadedImage && (
                <NodeActionBar.Custom
                  icon={<Trash2 size={16} strokeWidth={1.5} className="text-error/80 hover:text-error" />}
                  tooltip="恢复上级继承图片（清空本地上传）"
                  onClick={handleClearUpload}
                  disabled={isGenerating}
                />
              )}
              <NodeActionBar.Reset
                onClick={handleResetParams}
                disabled={isGenerating}
                tooltip="重置为初始默认参数"
              />
            </>
          )}
        </NodeActionBar>
      }
    >
      {/* 隐藏的真实文件上传 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        aria-label="上传工艺背景图片"
        className="hidden"
        onChange={handleFileUpload}
      />

      <div className="h-full flex flex-col flex-1 min-h-0 gap-2.5">
        {/* 控制工具栏（编辑态轻量顶栏：当前预设徽章 + 齿孔/留白快捷开关 + 侧边抽屉展开按钮） */}
        {isEditing && (
          <div className="relative z-20 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-paper/90 backdrop-blur-xs border border-paper-grid/70 text-xs font-sans text-ink-light select-none shadow-2xs shrink-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <Layers size={13} className="text-accent shrink-0" />
              <span className="text-ink-faint text-[10px] shrink-0 font-medium">预设</span>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(true)}
                disabled={isGenerating}
                title="点击展开抽屉切换预设方案"
                className="px-2 py-0.5 rounded-md bg-paper-grid/30 hover:bg-paper-grid/50 border border-paper-grid/50 text-ink text-xs font-medium truncate max-w-[140px] transition-colors cursor-pointer active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-accent"
              >
                {getEmbossFoilPreset(presetId).name}
              </button>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => patchState({ withPerforation: !withPerforation })}
                disabled={isGenerating}
                title={withPerforation ? '已开启邮票齿孔' : '已关闭邮票齿孔'}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] border transition-colors duration-150 cursor-pointer active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-accent ${
                  withPerforation
                    ? 'bg-accent/15 border-accent/40 text-accent font-medium'
                    : 'bg-paper-grid/20 border-paper-grid/50 text-ink-faint hover:bg-paper-grid/40'
                }`}
              >
                <Stamp size={11} />
                <span>齿孔</span>
              </button>

              <button
                type="button"
                onClick={() => patchState({ withMargin: !withMargin })}
                disabled={isGenerating}
                title={withMargin ? '已开启纸面留白' : '已关闭纸面留白'}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] border transition-colors duration-150 cursor-pointer active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-accent ${
                  withMargin
                    ? 'bg-accent/15 border-accent/40 text-accent font-medium'
                    : 'bg-paper-grid/20 border-paper-grid/50 text-ink-faint hover:bg-paper-grid/40'
                }`}
              >
                <Sparkles size={11} />
                <span>留白</span>
              </button>

              <button
                type="button"
                onClick={() => setIsDrawerOpen((prev) => !prev)}
                title={isDrawerOpen ? '收起配置抽屉' : '展开参数配置抽屉'}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] border transition-colors duration-150 cursor-pointer active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-accent ${
                  isDrawerOpen
                    ? 'bg-accent border-accent text-white font-medium shadow-2xs'
                    : 'bg-paper/80 border-paper-grid/70 text-ink-light hover:text-accent hover:border-accent/60'
                }`}
              >
                <SlidersHorizontal size={11} />
                <span>参数配置</span>
              </button>
            </div>
          </div>
        )}

        {/* 核心预览区（编辑态：3D 鼠标悬浮倾斜反光预览；结果态：高保真烘焙成图） */}
        <div
          ref={cardContainerRef}
          className="relative flex-1 min-h-0 w-full overflow-hidden rounded-xl bg-paper-grid/15 border border-paper-grid/50 flex items-center justify-center select-none"
        >
          {/* 画布层悬浮定光状态微 HUD */}
          {!hasGenerated && activeImageSrc && (
            <div className="absolute top-2 left-2 z-20 pointer-events-auto">
              {lightPoints.length > 0 ? (
                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-paper/95 backdrop-blur-md border border-accent/40 text-[10px] text-accent font-medium shadow-xs">
                  <Crosshair
                    size={11}
                    className={prefersReducedMotion ? 'text-accent' : 'text-accent animate-pulse'}
                  />
                  <span className="tabular-nums font-mono">
                    高光落点 ({lightPoints.length}/6)
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleResetLightPoints();
                    }}
                    title="清空落点并恢复默认自然光位"
                    aria-label="清空落点并恢复默认自然光位"
                    className="relative p-1 rounded-full hover:bg-accent/15 text-ink-faint hover:text-accent transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-accent after:absolute after:-inset-1.5 after:content-[''] cursor-pointer"
                  >
                    <RotateCcw size={10} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-paper/85 backdrop-blur-xs border border-paper-grid/70 text-[10px] text-ink-light pointer-events-none shadow-2xs">
                  <Crosshair size={10} className="text-ink-light/80" />
                  <span>点击画面添加单点/多点高光</span>
                </div>
              )}
            </div>
          )}
          <AnimatePresence initial={false}>
            {!hasGenerated ? (
              <motion.div
                key="editor"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.12, ease: 'easeOut' } }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="relative w-full h-full flex items-center justify-center overflow-hidden p-3"
              >
                {activeImageSrc ? (
                  <div
                    ref={cardElementRef}
                    onClick={handleCardClick}
                    onMouseEnter={handleCardMouseEnter}
                    onMouseMove={handleCardMouseMove}
                    onMouseLeave={handleCardMouseLeave}
                    style={{
                      transform:
                        'perspective(1000px) rotateX(var(--rotate-x, 0deg)) rotateY(var(--rotate-y, 0deg))',
                      transformStyle: 'preserve-3d',
                      willChange: 'transform',
                    }}
                    className={`relative max-w-full max-h-full flex items-center justify-center rounded cursor-crosshair group shadow-lg ${
                      withMargin ? 'p-3 bg-white' : 'bg-transparent'
                    }`}
                    title="点击画面任意位置可直接添加或调整高光落点（最多 6 个）"
                  >
                    {/* 1. 底层图片 */}
                    <img
                      src={activeImageSrc}
                      alt="Source"
                      className={`max-w-full max-h-[360px] object-contain rounded select-none pointer-events-none ${
                        reliefStyle === 'topography' ? 'contrast-105 saturate-95' : ''
                      }`}
                      crossOrigin="anonymous"
                    />

                    {/* 2. 等高线/浮雕肌理 CSS 滤镜层（增加微观质感） */}
                    <div
                      className="absolute inset-0 pointer-events-none opacity-40 mix-blend-overlay"
                      style={{
                        backgroundImage:
                          reliefStyle === 'topography'
                            ? `repeating-radial-gradient(circle at 50% 50%, rgba(0,0,0,0.18) 0, rgba(0,0,0,0.18) 1.5px, transparent 2px, transparent 6px)`
                            : reliefStyle === 'contour_mesh'
                              ? `repeating-linear-gradient(45deg, rgba(0,0,0,0.12) 0, rgba(0,0,0,0.12) 2px, transparent 3px, transparent 7px)`
                              : 'none',
                      }}
                    />

                    {/* 3. 动态全息高光反光层（跟随鼠标坐标平滑移动） */}
                    <div
                      className="absolute inset-0 rounded pointer-events-none transition-opacity duration-150"
                      style={{
                        background: shimmerGradientCss,
                        mixBlendMode: 'color-dodge',
                        opacity: 'var(--shine-opacity, 0.75)',
                      }}
                    />

                    {/* 4. 邮票打孔锯齿边框视觉修饰 */}
                    {withPerforation && (
                      <div className="absolute inset-0 border-2 border-dashed border-black/25 pointer-events-none rounded-[2px]" />
                    )}

                    {/* 5. 自定义高光焦点指示器（单点/多点瞄准微标与独立删除） */}
                    {lightPoints.map((pt, index) => (
                      <div
                        key={pt.id}
                        className="absolute -translate-x-1/2 -translate-y-1/2 z-20 transition-[transform,opacity] duration-150 ease-out group/point"
                        style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="relative flex items-center justify-center w-6 h-6">
                          {!prefersReducedMotion && (
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent/40 opacity-75 pointer-events-none" />
                          )}
                          <span className="relative inline-flex items-center justify-center rounded-full h-4 w-4 border-2 border-white bg-accent text-[9px] text-white font-bold shadow-xs pointer-events-none tabular-nums font-mono">
                            {index + 1}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => handleRemovePoint(pt.id, e)}
                            title={`删除高光落点 #${index + 1}`}
                            aria-label={`删除高光落点 #${index + 1}`}
                            className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-paper/95 text-ink-faint hover:text-error border border-paper-grid/60 shadow-xs opacity-0 group-hover/point:opacity-100 focus-visible:opacity-100 transition-opacity after:absolute after:-inset-2 after:content-[''] focus-visible:ring-1 focus-visible:ring-error cursor-pointer"
                          >
                            <X size={9} strokeWidth={2.5} />
                          </button>
                        </div>
                      </div>
                    ))}

                    {/* 悬浮快捷生成按钮（光学居中 + 标准 scale 触感） */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleGenerate();
                      }}
                      disabled={isGenerating}
                      className="absolute z-30 pl-2.5 pr-3.5 py-1.5 rounded-full bg-paper/90 backdrop-blur text-ink font-medium text-xs shadow-md hover:bg-white hover:text-accent active:scale-[0.96] transition-[transform,opacity,background-color,color] flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 duration-150 cursor-pointer"
                    >
                      <Sparkles size={13} className="text-accent" />
                      <span>点击生成高光图片</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-ink-faint gap-2 p-6 text-center">
                    <Upload size={32} strokeWidth={1.5} />
                    <p className="text-xs">请连线上级图片或点击上方按钮上传本地图片</p>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="preview"
                initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{
                  opacity: 0,
                  scale: prefersReducedMotion ? 1 : 0.98,
                  transition: { duration: 0.12, ease: 'easeOut' },
                }}
                transition={{ type: 'spring', damping: 26, stiffness: 320, mass: 0.8 }}
                className="relative w-full h-full flex items-center justify-center p-3"
              >
                {data.imageUrl ? (
                  <div className="relative group max-w-full max-h-full flex items-center justify-center">
                    <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
                      <PhotoView src={data.imageUrl}>
                        <img
                          src={data.imageUrl}
                          alt="Emboss Foil Output"
                          className="max-w-full max-h-[420px] object-contain drop-shadow-md select-none rounded cursor-zoom-in hover:opacity-95 transition-opacity"
                        />
                      </PhotoView>
                    </PhotoProvider>
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="absolute bottom-3 right-3 pl-2.5 pr-3.5 py-1.5 rounded-full bg-paper/90 backdrop-blur text-ink text-xs shadow-md border border-paper-grid/40 hover:bg-white hover:text-accent active:scale-[0.96] transition-[opacity,transform,background-color,color] flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 duration-150 cursor-pointer"
                    >
                      <Pencil size={12} strokeWidth={1.5} />
                      <span>调整参数</span>
                    </button>
                  </div>
                ) : (
                  <div className="text-xs text-ink-faint">暂无处理结果</div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {isGenerating && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/40 backdrop-blur-xs text-paper">
              <Loader2 size={28} className="animate-spin text-accent" />
              <span className="text-xs">正在渲染微浮雕高光…</span>
            </div>
          )}
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

export const EmbossFoilNode = memo(EmbossFoilNodeInner);
EmbossFoilNode.displayName = 'EmbossFoilNode';
export default EmbossFoilNode;
