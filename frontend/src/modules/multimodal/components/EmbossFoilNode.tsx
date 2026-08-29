import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  ChevronUp,
  SlidersHorizontal,
  Stamp,
  Crosshair,
  RotateCcw,
} from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { Select, type SelectOption } from '../../../platform/components/ui/Select';
import { SliderRow } from '../../../platform/components/ui/Slider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  type EmbossFoilState,
  type EmbossReliefStyle,
  type FoilShimmerType,
  EMBOSS_FOIL_PRESETS,
  DEFAULT_PRESET_ID,
  getEmbossFoilPreset,
  loadImage,
  renderEmbossFoilFromImage,
} from '../emboss';

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

const RELIEF_STYLE_OPTIONS: { label: string; value: EmbossReliefStyle }[] = [
  { label: '等高线', value: 'topography' },
  { label: '纸质浮雕', value: 'paper_emboss' },
  { label: '细腻磨砂', value: 'fine_grain' },
  { label: '网格几何', value: 'contour_mesh' },
];

const SHIMMER_TYPE_OPTIONS: { label: string; value: FoilShimmerType }[] = [
  { label: '磨砂银白', value: 'matte_silver' },
  { label: '彩虹镭射', value: 'rainbow_foil' },
  { label: '暖金微光', value: 'warm_gold' },
  { label: '极光幻彩', value: 'aurora_cyan' },
];

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
  const shimmerType: FoilShimmerType = data.shimmerType || 'matte_silver';
  const depth = data.depth !== undefined ? data.depth : 68;
  const brightness = data.brightness !== undefined ? data.brightness : 72;
  const radius = data.radius !== undefined ? data.radius : 46;
  const lightAngle = data.lightAngle !== undefined ? data.lightAngle : 225;
  const lightX = data.lightX ?? null;
  const lightY = data.lightY ?? null;
  const withPerforation = data.withPerforation !== undefined ? data.withPerforation : true;
  const withMargin = data.withMargin !== undefined ? data.withMargin : true;

  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  // 计算默认自然光照中心（依据 lightAngle 三角换算，225° 默认偏左上）
  const defaultLightPos = useMemo(() => {
    const rad = (lightAngle * Math.PI) / 180;
    return {
      x: Math.round(50 + Math.cos(rad) * 28),
      y: Math.round(50 + Math.sin(rad) * 28),
    };
  }, [lightAngle]);

  const activeLightX = lightX != null ? lightX : defaultLightPos.x;
  const activeLightY = lightY != null ? lightY : defaultLightPos.y;

  // 3D 鼠标互动卡片 ref
  const cardContainerRef = useRef<HTMLDivElement>(null);
  const cardElementRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        shimmerType: preset.params.shimmerType || 'matte_silver',
        depth: preset.params.depth ?? 65,
        brightness: preset.params.brightness ?? 70,
        radius: preset.params.radius ?? 45,
        lightAngle: preset.params.lightAngle ?? 225,
        lightX: null,
        lightY: null,
        withPerforation: preset.params.withPerforation ?? true,
        withMargin: preset.params.withMargin ?? true,
      });
    },
    [patchState]
  );

  // 鼠标在 3D 卡片上移动：计算倾斜角度与高光坐标
  const handleCardMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardElementRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const px = (x / rect.width) * 100;
    const py = (y / rect.height) * 100;

    // 旋转倾斜限制在 ±12deg
    const rx = ((py - 50) / 50) * -12;
    const ry = ((px - 50) / 50) * 12;

    el.style.setProperty('--pointer-x', `${px.toFixed(1)}%`);
    el.style.setProperty('--pointer-y', `${py.toFixed(1)}%`);
    el.style.setProperty('--rotate-x', `${rx.toFixed(1)}deg`);
    el.style.setProperty('--rotate-y', `${ry.toFixed(1)}deg`);
    el.style.setProperty('--shine-opacity', '1');
  }, []);

  const handleCardMouseLeave = useCallback(() => {
    const el = cardElementRef.current;
    if (!el) return;
    el.style.setProperty('--pointer-x', `${activeLightX}%`);
    el.style.setProperty('--pointer-y', `${activeLightY}%`);
    el.style.setProperty('--rotate-x', '0deg');
    el.style.setProperty('--rotate-y', '0deg');
    el.style.setProperty('--shine-opacity', '0.75');
  }, [activeLightX, activeLightY]);

  // 点击卡片直接锁定高光中心坐标（即点即落，所见即所得）
  const handleCardClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = cardElementRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const px = Math.round(Math.max(0, Math.min(100, (x / rect.width) * 100)));
      const py = Math.round(Math.max(0, Math.min(100, (y / rect.height) * 100)));

      patchState({ lightX: px, lightY: py });
    },
    [patchState]
  );

  // 清除自定义高光锁定，恢复自然光位
  const handleResetLightPos = useCallback(() => {
    patchState({ lightX: null, lightY: null });
    showToast('已恢复默认自然光位', { type: 'success' });
  }, [patchState, showToast]);

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
          lightX: lightX != null ? lightX : undefined,
          lightY: lightY != null ? lightY : undefined,
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
        lightX: lightX != null ? lightX : null,
        lightY: lightY != null ? lightY : null,
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
    lightX,
    lightY,
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
        lightX: lightX != null ? lightX : null,
        lightY: lightY != null ? lightY : null,
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
    lightX,
    lightY,
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

  const presetOptions: SelectOption[] = useMemo(
    () =>
      EMBOSS_FOIL_PRESETS.map((p) => ({
        label: p.name,
        value: p.id,
        title: p.description,
      })),
    []
  );

  // CSS 动态高光渐变规则（用于实时 3D 预览）
  const shimmerGradientCss = useMemo(() => {
    const alpha = (brightness / 100) * 0.9;
    const posX = `var(--pointer-x, ${activeLightX}%)`;
    const posY = `var(--pointer-y, ${activeLightY}%)`;
    switch (shimmerType) {
      case 'matte_silver':
        return `radial-gradient(circle at ${posX} ${posY}, rgba(255, 255, 255, ${alpha}) 0%, rgba(240, 245, 255, ${alpha * 0.7}) 20%, rgba(215, 225, 240, ${alpha * 0.3}) 45%, transparent 70%)`;
      case 'rainbow_foil':
        return `radial-gradient(circle at ${posX} ${posY}, rgba(255, 255, 255, ${alpha}) 0%, rgba(255, 220, 100, ${alpha * 0.85}) 18%, rgba(255, 120, 180, ${alpha * 0.75}) 35%, rgba(160, 100, 255, ${alpha * 0.65}) 52%, rgba(80, 220, 255, ${alpha * 0.45}) 70%, transparent 85%)`;
      case 'warm_gold':
        return `radial-gradient(circle at ${posX} ${posY}, rgba(255, 255, 235, ${alpha}) 0%, rgba(255, 220, 130, ${alpha * 0.85}) 22%, rgba(230, 175, 60, ${alpha * 0.45}) 50%, rgba(180, 120, 30, ${alpha * 0.12}) 75%, transparent 90%)`;
      case 'aurora_cyan':
        return `radial-gradient(circle at ${posX} ${posY}, rgba(240, 255, 255, ${alpha}) 0%, rgba(64, 224, 208, ${alpha * 0.8}) 25%, rgba(138, 43, 226, ${alpha * 0.45}) 55%, transparent 80%)`;
    }
  }, [shimmerType, brightness, activeLightX, activeLightY]);

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
                onClick={() => patchState({ imageUrl: null, isSaved: false })}
                disabled={isExporting}
                tooltip="清空结果回到参数编辑态"
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
        className="hidden"
        onChange={handleFileUpload}
      />

      <div className="h-full flex flex-col flex-1 min-h-0 gap-2.5">
        {/* 控制工具栏（编辑态展示：预设切换 + 高密度参数调节面板） */}
        {!hasGenerated && (
          <div className="relative z-20 flex flex-col gap-1.5 p-2 rounded-xl bg-paper/95 border border-paper-grid/80 text-xs font-sans text-ink-light select-none shadow-2xs shrink-0">
            {/* 顶部预设切换行 + 打孔/留白快捷开关 + 折叠按钮 */}
            <div className="flex items-center justify-between gap-2 pb-1 border-b border-paper-grid/40">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <Layers size={13} className="text-accent shrink-0" />
                <span className="text-ink-faint text-[10px] shrink-0 font-medium">预设</span>
                <Select
                  size="sm"
                  value={presetId}
                  disabled={isGenerating}
                  onChange={handlePresetChange}
                  options={presetOptions}
                  className="w-full min-w-[100px] max-w-[150px] text-xs"
                />
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => patchState({ withPerforation: !withPerforation })}
                  disabled={isGenerating}
                  title={withPerforation ? '已开启邮票齿孔' : '已关闭邮票齿孔'}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition duration-150 ${
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
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition duration-150 ${
                    withMargin
                      ? 'bg-accent/15 border-accent/40 text-accent font-medium'
                      : 'bg-paper-grid/20 border-paper-grid/50 text-ink-faint hover:bg-paper-grid/40'
                  }`}
                >
                  <Sparkles size={11} />
                  <span>留白</span>
                </button>

                <Tooltip content={isPanelCollapsed ? '展开参数配置' : '收起参数配置，最大化查看 3D 预览'}>
                  <button
                    type="button"
                    onClick={() => setIsPanelCollapsed(!isPanelCollapsed)}
                    className="p-1 rounded-md border border-paper-grid/70 text-ink-faint hover:text-accent hover:border-accent/60 bg-paper/60 transition-[color,border-color,transform] active:scale-[0.94] shrink-0"
                    aria-label={isPanelCollapsed ? '展开面板' : '收起面板'}
                  >
                    {isPanelCollapsed ? <SlidersHorizontal size={12} /> : <ChevronUp size={12} />}
                  </button>
                </Tooltip>
              </div>
            </div>

            {/* 可平滑收起的参数设置区 */}
            <AnimatePresence initial={false}>
              {!isPanelCollapsed && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden flex flex-col gap-1.5"
                >
                  {/* 肌理风格等宽分段 */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-ink-faint text-[10px] shrink-0 w-6 text-left">肌理</span>
                    <div className="flex-1 min-w-0 grid grid-cols-4 p-0.5 rounded-md bg-paper-grid/40 border border-paper-grid/60 gap-0.5 shadow-2xs">
                      {RELIEF_STYLE_OPTIONS.map((opt) => {
                        const isChecked = reliefStyle === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => patchState({ reliefStyle: opt.value })}
                            disabled={isGenerating}
                            className={`py-0.5 rounded text-[10px] font-medium leading-none text-center transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96] truncate ${
                              isChecked
                                ? 'bg-paper text-accent font-medium shadow-2xs border border-paper-grid/40'
                                : 'text-ink-light hover:text-ink hover:bg-paper-grid/30'
                            } disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 高光类型等宽分段 */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-ink-faint text-[10px] shrink-0 w-6 text-left">高光</span>
                    <div className="flex-1 min-w-0 grid grid-cols-4 p-0.5 rounded-md bg-paper-grid/40 border border-paper-grid/60 gap-0.5 shadow-2xs">
                      {SHIMMER_TYPE_OPTIONS.map((opt) => {
                        const isChecked = shimmerType === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => patchState({ shimmerType: opt.value })}
                            disabled={isGenerating}
                            className={`py-0.5 rounded text-[10px] font-medium leading-none text-center transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96] truncate ${
                              isChecked
                                ? 'bg-paper text-accent font-medium shadow-2xs border border-paper-grid/40'
                                : 'text-ink-light hover:text-ink hover:bg-paper-grid/30'
                            } disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 滑杆参数 2x2 等宽对齐网格（精简 2 字标签，彻底消除重叠） */}
                  <div className="grid gap-x-4 gap-y-1.5 grid-cols-2 pt-0.5">
                    <SliderRow
                      label="深度"
                      value={depth}
                      min={0}
                      max={100}
                      step={1}
                      labelWidth="w-6"
                      valueWidth="min-w-[26px]"
                      disabled={isGenerating}
                      onChange={(v) => patchState({ depth: v })}
                    />
                    <SliderRow
                      label="亮度"
                      value={brightness}
                      min={0}
                      max={100}
                      step={1}
                      labelWidth="w-6"
                      valueWidth="min-w-[26px]"
                      disabled={isGenerating}
                      onChange={(v) => patchState({ brightness: v })}
                    />
                    <SliderRow
                      label="散焦"
                      value={radius}
                      min={10}
                      max={80}
                      step={1}
                      labelWidth="w-6"
                      valueWidth="min-w-[26px]"
                      disabled={isGenerating}
                      onChange={(v) => patchState({ radius: v })}
                    />
                    <SliderRow
                      label="角度"
                      value={lightAngle}
                      min={0}
                      max={360}
                      step={5}
                      display={`${lightAngle}°`}
                      labelWidth="w-6"
                      valueWidth="min-w-[30px]"
                      disabled={isGenerating}
                      onChange={(v) => patchState({ lightAngle: v })}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
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
              {lightX != null && lightY != null ? (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-paper/90 backdrop-blur-md border border-accent/40 text-[10px] text-accent font-medium shadow-xs">
                  <Crosshair size={11} className="text-accent animate-pulse" />
                  <span>光位: {lightX}%, {lightY}%</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleResetLightPos();
                    }}
                    title="恢复默认自然光位"
                    className="p-0.5 rounded-full hover:bg-accent/15 text-ink-faint hover:text-accent transition duration-150"
                  >
                    <RotateCcw size={10} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-paper/70 backdrop-blur-xs border border-paper-grid/60 text-[10px] text-ink-faint pointer-events-none shadow-2xs">
                  <Crosshair size={10} className="text-ink-faint/70" />
                  <span>点击卡片锁定光位</span>
                </div>
              )}
            </div>
          )}
          <AnimatePresence mode="wait" initial={false}>
            {!hasGenerated ? (
              <motion.div
                key="editor"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="relative w-full h-full flex items-center justify-center overflow-hidden p-3"
              >
                {activeImageSrc ? (
                  <div
                    ref={cardElementRef}
                    onClick={handleCardClick}
                    onMouseMove={handleCardMouseMove}
                    onMouseLeave={handleCardMouseLeave}
                    style={{
                      transform: 'perspective(1000px) rotateX(var(--rotate-x, 0deg)) rotateY(var(--rotate-y, 0deg))',
                      transformStyle: 'preserve-3d',
                      transition: 'transform 0.08s ease-out',
                    }}
                    className={`relative max-w-full max-h-full flex items-center justify-center rounded cursor-crosshair group shadow-lg ${
                      withMargin ? 'p-3 bg-white' : 'bg-transparent'
                    }`}
                    title="点击画面任意位置可直接锁定高光落点（所见即所得）"
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

                    {/* 5. 自定义高光焦点指示器（点击定光后的微光瞄准圈） */}
                    {lightX != null && lightY != null && (
                      <div
                        className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20 transition-all duration-150"
                        style={{ left: `${lightX}%`, top: `${lightY}%` }}
                      >
                        <div className="relative flex items-center justify-center w-6 h-6">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent/40 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 border-2 border-white bg-accent shadow-xs" />
                        </div>
                      </div>
                    )}

                    {/* 悬浮快捷生成按钮 */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleGenerate();
                      }}
                      disabled={isGenerating}
                      className="absolute z-30 px-3 py-1.5 rounded-full bg-paper/90 backdrop-blur text-ink font-medium text-xs shadow-md hover:bg-white hover:text-accent hover:scale-105 active:scale-95 transition flex items-center gap-1.5 opacity-0 group-hover:opacity-100 duration-150"
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
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ type: 'spring', damping: 24, stiffness: 260 }}
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
                      className="absolute bottom-3 right-3 px-2.5 py-1.5 rounded-full bg-paper/90 backdrop-blur text-ink text-xs shadow-md border border-paper-grid/40 hover:bg-white hover:text-accent active:scale-[0.96] transition-[opacity,transform,background-color,color] flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 duration-150"
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
