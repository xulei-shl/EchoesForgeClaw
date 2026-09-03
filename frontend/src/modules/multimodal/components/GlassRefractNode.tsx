import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import {
  Sparkles,
  Heart,
  Globe,
  Upload,
  Trash2,
  Loader2,
  Check,
  SlidersHorizontal,
} from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  type GlassPattern,
  type GlassRefractState,
  type GlassRefractParams,
  DEFAULT_GLASS_PARAMS,
  getGlassPresetByPattern,
  loadImage,
  GlassRenderer,
  renderGlassRefractFromImage,
  GlassRefractStudioPanel,
  PATTERN_OPTIONS,
} from '../glassrefract';

export interface GlassRefractNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 节点持久化数据 */
  data?: Partial<GlassRefractState>;
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
  onUpdateState?: (id: string, patch: Partial<GlassRefractState>) => void;
  /** 导出图片：PNG Data URL 落盘保存 + 写入历史数据库 */
  onExport?: (
    id: string,
    dataUrl: string,
    state: Partial<GlassRefractState>
  ) => Promise<void>;
}

const GlassRefractNodeInner: React.FC<GlassRefractNodeProps> = ({
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
  const pattern: GlassPattern = data.pattern || 'cross';
  const scale = data.scale !== undefined ? data.scale : DEFAULT_GLASS_PARAMS.scale;
  const relief = data.relief !== undefined ? data.relief : DEFAULT_GLASS_PARAMS.relief;
  const thickness = data.thickness !== undefined ? data.thickness : DEFAULT_GLASS_PARAMS.thickness;
  const angle = data.angle !== undefined ? data.angle : DEFAULT_GLASS_PARAMS.angle;
  const dispersion = data.dispersion !== undefined ? data.dispersion : DEFAULT_GLASS_PARAMS.dispersion;
  const specular = data.specular !== undefined ? data.specular : DEFAULT_GLASS_PARAMS.specular;
  const gap = data.gap !== undefined ? data.gap : DEFAULT_GLASS_PARAMS.gap;
  const seed = data.seed !== undefined ? data.seed : DEFAULT_GLASS_PARAMS.seed;

  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const hasGenerated = Boolean(data?.imageUrl && !isEditing);
  const isSaved = Boolean(data?.isSaved);

  // DOM 与 WebGL 渲染器引用
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GlassRenderer | null>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);
  const currentImageSrcRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 当外部 data.imageUrl 变更时同步编辑态
  useEffect(() => {
    setIsEditing(!data?.imageUrl);
  }, [data?.imageUrl]);

  const patchState = useCallback(
    (patch: Partial<GlassRefractState>) => {
      onUpdateState?.(id, patch);
    },
    [id, onUpdateState]
  );

  // 切换玻璃图案风格（同步载入对应风格的预设参数）
  const handlePatternChange = useCallback(
    (nextPattern: GlassPattern) => {
      const preset = getGlassPresetByPattern(nextPattern);
      patchState({
        pattern: nextPattern,
        scale: preset.params.scale ?? DEFAULT_GLASS_PARAMS.scale,
        relief: preset.params.relief ?? DEFAULT_GLASS_PARAMS.relief,
        thickness: preset.params.thickness ?? DEFAULT_GLASS_PARAMS.thickness,
        angle: preset.params.angle ?? DEFAULT_GLASS_PARAMS.angle,
        dispersion: preset.params.dispersion ?? DEFAULT_GLASS_PARAMS.dispersion,
        specular: preset.params.specular ?? DEFAULT_GLASS_PARAMS.specular,
        gap: preset.params.gap ?? DEFAULT_GLASS_PARAMS.gap,
        seed: preset.params.seed ?? DEFAULT_GLASS_PARAMS.seed,
      });
    },
    [patchState]
  );

  // 统一重置回默认参数（编辑态重置全部滑块参数；结果态一并清空成图回到编辑态）
  const handleResetParams = useCallback(() => {
    const patch: Partial<GlassRefractState> = {
      ...DEFAULT_GLASS_PARAMS,
    };
    if (data?.imageUrl && !isEditing) {
      setIsEditing(true);
      patch.imageUrl = null;
      patch.isSaved = false;
    }
    patchState(patch);
    showToast('已重置为默认玻璃折射参数', { type: 'success' });
  }, [data?.imageUrl, isEditing, patchState, showToast]);

  // 换一批随机雨滴分布
  const handleRandomizeRain = useCallback(() => {
    const nextSeed = Math.floor(Math.random() * 10000);
    patchState({ seed: nextSeed });
  }, [patchState]);

  // 初始化 WebGL 渲染器
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      if (!rendererRef.current) {
        rendererRef.current = new GlassRenderer(canvas);
      }
    } catch (err: any) {
      console.error('初始化 WebGL 失败:', err);
    }

    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  // 加载底图纹理并上传到 GPU
  useEffect(() => {
    if (!activeImageSrc) {
      loadedImageRef.current = null;
      currentImageSrcRef.current = null;
      return;
    }

    let isMounted = true;
    loadImage(activeImageSrc)
      .then((img) => {
        if (!isMounted) return;
        loadedImageRef.current = img;
        currentImageSrcRef.current = activeImageSrc;
        if (!rendererRef.current && canvasRef.current) {
          try {
            rendererRef.current = new GlassRenderer(canvasRef.current);
          } catch (e) {
            console.error('创建 WebGL 渲染器失败:', e);
          }
        }
        if (rendererRef.current) {
          rendererRef.current.upload(img);
          // 触发初次重绘
          requestRedraw();
        }
      })
      .catch((err) => {
        console.error('加载底图失败:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [activeImageSrc]);

  // 稳定参数引用，避免高频拖拽滑块时反复重建 requestRedraw 闭包
  const latestParamsRef = useRef<GlassRefractParams>({
    pattern,
    scale,
    relief,
    thickness,
    angle,
    dispersion,
    specular,
    gap,
    seed,
  });
  latestParamsRef.current = {
    pattern,
    scale,
    relief,
    thickness,
    angle,
    dispersion,
    specular,
    gap,
    seed,
  };

  // requestAnimationFrame 驱动的 GPU 重绘（单例稳定引用，降低 React 重复调度开销）
  const renderQueuedRef = useRef(false);
  const requestRedraw = useCallback(() => {
    if (renderQueuedRef.current || !containerRef.current) {
      return;
    }
    renderQueuedRef.current = true;
    requestAnimationFrame(() => {
      renderQueuedRef.current = false;
      const img = loadedImageRef.current;
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!img || !container || !canvas) return;

      if (!rendererRef.current) {
        try {
          rendererRef.current = new GlassRenderer(canvas);
          rendererRef.current.upload(img);
        } catch (err) {
          console.error('初始化 WebGL 失败:', err);
          return;
        }
      }

      const renderer = rendererRef.current;
      if (!renderer) return;

      const containerRect = container.getBoundingClientRect();
      if (containerRect.width <= 0 || containerRect.height <= 0) return;

      // 按原图比例自适应视口尺寸
      const imgAspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height || 1);
      const containerAspect = containerRect.width / containerRect.height;

      let drawW = containerRect.width;
      let drawH = containerRect.height;
      if (imgAspect > containerAspect) {
        drawH = drawW / imgAspect;
      } else {
        drawW = drawH * imgAspect;
      }

      // DPR 适配，最高限制在 1600 以保证实时流畅度
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pixelW = Math.round(drawW * dpr);
      const pixelH = Math.round(drawH * dpr);

      renderer.draw(pixelW, pixelH, latestParamsRef.current);

      canvas.style.width = `${Math.floor(drawW)}px`;
      canvas.style.height = `${Math.floor(drawH)}px`;
    });
  }, []);

  // 当参数或底图变更时实时触发 WebGL 绘制
  useEffect(() => {
    if (isEditing && activeImageSrc) {
      requestRedraw();
    }
  }, [
    isEditing,
    activeImageSrc,
    pattern,
    scale,
    relief,
    thickness,
    angle,
    dispersion,
    specular,
    gap,
    seed,
    requestRedraw,
  ]);

  // 监听容器尺寸变化（包括节点缩放、面板展开/收起）自动触发 WebGL 重绘自适应
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (activeImageSrc) {
        requestRedraw();
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [activeImageSrc, requestRedraw]);

  // 当状态切回编辑态时延时一帧重绘
  useEffect(() => {
    if (!hasGenerated && activeImageSrc) {
      requestAnimationFrame(() => {
        requestRedraw();
      });
    }
  }, [hasGenerated, activeImageSrc, requestRedraw]);

  // 执行高保真烘焙生成
  const handleGenerate = useCallback(async () => {
    if (!activeImageSrc || isGenerating) return;
    setIsGenerating(true);
    try {
      const img = await loadImage(activeImageSrc);
      const dataUrl = await renderGlassRefractFromImage(
        img,
        {
          pattern,
          scale,
          relief,
          thickness,
          angle,
          dispersion,
          specular,
          gap,
          seed,
        },
        { maxEdge: 1800 }
      );

      patchState({
        pattern,
        scale,
        relief,
        thickness,
        angle,
        dispersion,
        specular,
        gap,
        seed,
        imageUrl: dataUrl,
        isSaved: false,
      });
      setIsEditing(false);
      showToast('玻璃折射图片生成完成（可点击保存按钮写入数据库）', { type: 'success' });
    } catch (err: unknown) {
      console.error('生成玻璃折射图片失败:', err);
      showToast(err instanceof Error ? err.message : '生成失败，请重试', { type: 'error' });
    } finally {
      setIsGenerating(false);
    }
  }, [
    activeImageSrc,
    isGenerating,
    pattern,
    scale,
    relief,
    thickness,
    angle,
    dispersion,
    specular,
    gap,
    seed,
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
        pattern,
        scale,
        relief,
        thickness,
        angle,
        dispersion,
        specular,
        gap,
        seed,
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
    pattern,
    scale,
    relief,
    thickness,
    angle,
    dispersion,
    specular,
    gap,
    seed,
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
    link.download = `glass-refract-${pattern}-${Date.now()}.png`;
    link.click();
    showToast('图片已下载', { type: 'success' });
  }, [data?.imageUrl, pattern, showToast]);

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

  // 恢复上级输入图片
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

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '玻璃折射'}
      dotColor={NODE_COLORS.glass_refract || 'oklch(0.68 0.16 210)'}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 440, height: 620 }}
      className={`transition-[box-shadow,ring-color] duration-150 ease-out motion-reduce:transition-none ${
        isSelected ? 'ring-2 ring-accent/70 shadow-md' : ''
      }`}
      showLeftAnchor={true}
      showRightAnchor={true}
      onClick={() => onSelect?.(id)}
      footer={footer}
      mismatchBadge={mismatchBadge}
      sideDrawer={
        <GlassRefractStudioPanel
          isOpen={Boolean(isEditing && isDrawerOpen)}
          pattern={pattern}
          scale={scale}
          relief={relief}
          thickness={thickness}
          angle={angle}
          dispersion={dispersion}
          specular={specular}
          gap={gap}
          seed={seed}
          disabled={isGenerating}
          onUpdate={patchState}
          onRandomizeRain={handleRandomizeRain}
          onClose={() => setIsDrawerOpen(false)}
        />
      }
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
                tooltip="清空结果并重置为初始默认参数"
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
                tooltip="生成玻璃折射图片"
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
        className="hidden"
        onChange={handleFileUpload}
      />

      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
        {/* 控制工具栏（编辑态展示：9 风格图标切分栏横版排列 + 右侧侧边吸附抽屉展开按钮） */}
        {!hasGenerated && (
          <div className="relative z-20 flex items-center gap-1.5 p-1.5 rounded-xl bg-paper/95 border border-paper-grid/80 text-xs font-sans text-ink-light select-none shadow-2xs shrink-0">
            {/* 9 种玻璃图案横向等宽 Segmented 选择栏（符合单选组无障碍标准） */}
            <div
              role="radiogroup"
              aria-label="玻璃图案风格"
              className="grid grid-cols-9 flex-1 p-0.5 rounded-lg bg-paper-grid/40 border border-paper-grid/60 gap-0.5 shadow-2xs min-w-0"
            >
              {PATTERN_OPTIONS.map((opt) => {
                const isChecked = pattern === opt.value;
                const IconComponent = opt.icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={isChecked}
                    aria-label={`${opt.label}风格`}
                    onClick={() => handlePatternChange(opt.value)}
                    disabled={isGenerating}
                    className={`flex flex-col items-center justify-center py-1 px-0.5 rounded-md text-[10px] font-medium leading-tight transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-out cursor-pointer active:scale-[0.96] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-1.5 focus-visible:ring-accent ${
                      isChecked
                        ? 'bg-paper text-accent font-semibold shadow-2xs border border-paper-grid/40'
                        : 'text-ink-light hover:text-ink hover:bg-paper-grid/30 border border-transparent'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <IconComponent size={13} strokeWidth={1.5} className="shrink-0 mb-0.5" aria-hidden="true" />
                    <span className="truncate text-[10px] leading-none tracking-tight">{opt.label}</span>
                  </button>
                );
              })}
            </div>

            {/* 右侧吸附抽屉展开/收起按钮（带 34px 扩展热区与焦点环） */}
            <Tooltip content={isDrawerOpen ? '收起参数配置抽屉' : '展开侧边参数配置抽屉'}>
              <button
                type="button"
                onClick={() => setIsDrawerOpen((prev) => !prev)}
                disabled={isGenerating}
                className={`relative p-1.5 rounded-md border transition-[color,border-color,background-color,transform] duration-150 ease-out active:scale-[0.96] motion-reduce:transform-none shrink-0 cursor-pointer before:absolute before:-inset-1 before:content-[''] focus-visible:outline-none focus-visible:ring-1.5 focus-visible:ring-accent ${
                  isDrawerOpen
                    ? 'bg-accent/15 border-accent/40 text-accent font-medium shadow-2xs'
                    : 'border-paper-grid/70 text-ink-faint hover:text-accent hover:border-accent/60 bg-paper/60'
                }`}
                aria-label={isDrawerOpen ? '收起配置抽屉' : '展开配置抽屉'}
              >
                <SlidersHorizontal size={13} strokeWidth={1.5} />
              </button>
            </Tooltip>
          </div>
        )}

        {/* 核心视口（编辑态：实时 WebGL GPU 渲染画布；结果态：高清成品展示） */}
        <div
          ref={containerRef}
          className="relative flex-1 min-h-0 w-full overflow-hidden rounded-xl bg-paper-grid/15 border border-paper-grid/50 flex items-center justify-center select-none"
        >
          {/* 1. 结果展示模式（支持点击放大查看，带 Image Outline 保持深浅色模式边缘清晰度） */}
          {hasGenerated && data.imageUrl && (
            <PhotoProvider>
              <div className="relative w-full h-full flex items-center justify-center p-2 transition-opacity duration-150 ease-out">
                <PhotoView src={data.imageUrl}>
                  <img
                    src={data.imageUrl}
                    alt={title ? `${title}玻璃折射成品` : '玻璃折射效果预览'}
                    className="max-w-full max-h-full object-contain rounded shadow-sm cursor-zoom-in outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
                  />
                </PhotoView>

                {/* 风格与尺寸参数微标 */}
                <div className="absolute bottom-2.5 left-2.5 z-20 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-paper/85 backdrop-blur-xs border border-paper-grid/70 text-[10px] text-ink-light font-sans shadow-2xs select-none pointer-events-none">
                  <span>{getGlassPresetByPattern(pattern)?.name || pattern}</span>
                  <span className="text-ink-faint">·</span>
                  <span className="tabular-nums">周期 {scale}px</span>
                </div>
              </div>
            </PhotoProvider>
          )}

          {/* 2. 实时 WebGL 渲染模式（常驻 DOM 保证 WebGL 上下文不丢失） */}
          <div
            className={`relative w-full h-full flex items-center justify-center p-2 transition-opacity duration-150 ease-out ${
              !hasGenerated && activeImageSrc ? 'block' : 'hidden'
            }`}
          >
            <canvas
              ref={canvasRef}
              className="max-w-full max-h-full object-contain rounded shadow-sm"
            />
          </div>

          {/* 3. 空状态提示（可直接点击唤起本地文件选择） */}
          {!hasGenerated && !activeImageSrc && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="group/empty flex flex-col items-center justify-center gap-2 p-6 text-center rounded-xl border border-dashed border-paper-grid/80 hover:border-accent/60 hover:bg-paper/60 transition-[background-color,border-color] duration-150 ease-out cursor-pointer active:scale-[0.98] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-1.5 focus-visible:ring-accent"
              aria-label="点击上传玻璃折射底图"
            >
              <div className="p-2.5 rounded-full bg-paper-grid/40 text-ink-faint group-hover/empty:bg-accent/15 group-hover/empty:text-accent transition-colors duration-150">
                <Upload size={20} strokeWidth={1.5} />
              </div>
              <div className="flex flex-col gap-0.5 text-xs">
                <span className="font-medium text-ink-light group-hover/empty:text-accent transition-colors duration-150">
                  点击上传图片 或 连接上游节点
                </span>
                <span className="text-[11px] text-ink-faint">
                  支持 JPG、PNG、WebP 等格式作为玻璃底图
                </span>
              </div>
            </button>
          )}

          {/* 4. 高保真烘焙中视口加载遮罩反馈 */}
          {isGenerating && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-paper/65 backdrop-blur-xs transition-opacity duration-150 ease-out text-ink">
              <Loader2 size={24} className="animate-spin text-accent" />
              <span className="text-xs font-serif font-medium text-ink-light">正在烘焙高清玻璃折射...</span>
            </div>
          )}

          {recordDeleted && hasGenerated && !isExporting && (
            <div className="absolute bottom-2 left-2 right-2 px-2 py-1 rounded bg-error/15 border border-error/30 text-error text-[10px] text-center pointer-events-none">
              记录已从数据库中删除，重新保存可恢复
            </div>
          )}
        </div>
      </div>
    </CanvasNode>
  );
};

export const GlassRefractNode = memo(GlassRefractNodeInner);
