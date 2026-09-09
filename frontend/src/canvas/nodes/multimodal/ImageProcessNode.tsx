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
  Check,
  Layers,
  SlidersHorizontal,
  Tv,
  CircleDot,
  Grid3X3,
  Terminal,
} from 'lucide-react';
import { CanvasNode } from '../_shared/CanvasNode';
import { NodeActionBar } from '../_shared/NodeActionBar';
import { Tooltip } from '../../../shared/components/ui/Tooltip';
import { useFeedback } from '../../../shared/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../_shared/nodeTypes';
import {
  applyImageFx,
  defaultFxParamsOf,
  resolveFxParams,
  switchFxEffectPatch,
  TEXTURE_STYLE_PRESETS,
  ImageProcessStudioPanel,
} from './engines/imageprocess';
import type {
  ImageProcessState,
  ImageFxId,
  ImageFxParamValue,
  TextureStyleId,
} from './engines/imageprocess';

/** 预览渲染最长边（提速）；导出生成用大值保清晰 */
const PREVIEW_MAX_EDGE = 1024;
const EXPORT_MAX_EDGE = 2048;

/** 6 大效果模板配置（用于顶部横版切换栏，对齐 GlassRefractNode 交互规范） */
const EFFECT_CONFIGS: {
  id: ImageFxId;
  name: string;
  shortLabel: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
}[] = [
  { id: 'crt', name: 'CRT显像管', shortLabel: 'CRT', icon: Tv },
  { id: 'texture', name: '触感质感', shortLabel: '质感', icon: Layers },
  { id: 'grain', name: '胶片颗粒', shortLabel: '颗粒', icon: Sparkles },
  { id: 'halftone', name: '半色调印刷', shortLabel: '网点', icon: CircleDot },
  { id: 'dither', name: '像素抖动', shortLabel: '抖动', icon: Grid3X3 },
  { id: 'ascii', name: '字符艺术', shortLabel: '字符', icon: Terminal },
];

export interface ImageProcessNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 节点持久化数据 */
  data?: Partial<ImageProcessState>;
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
  onUpdateState?: (id: string, patch: Partial<ImageProcessState>) => void;
  /** 导出处理结果：PNG Data URL 落盘保存 + 写入历史数据库 */
  onExport?: (
    id: string,
    dataUrl: string,
    state: Partial<ImageProcessState> & { effectName: string }
  ) => Promise<void>;
}


const ImageProcessNodeInner: React.FC<ImageProcessNodeProps> = ({
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

  // 1. 输入图片优先级：本地上传 > 直连图片/穿透封面（与湿油彩一致）
  const activeImageSrc = useMemo(
    () => data?.uploadedImage || upstreamImageUrl || null,
    [data?.uploadedImage, upstreamImageUrl]
  );

  // 当前效果与参数（注册表解析；历史数据缺字段安全回落默认值）
  const { effect, params } = useMemo(
    () => resolveFxParams(data?.effectId, data),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.effectId, data?.fxParams]
  );
  const paramsKey = JSON.stringify(params);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isRenderingPreview, setIsRenderingPreview] = useState(false);
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  /** 预览手动重试计数（仅触发重渲，不写入持久化参数） */
  const [previewNonce, setPreviewNonce] = useState(0);
  /** 拖拽文件悬停高亮状态 */
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 当外部 data.imageUrl 变更时同步编辑态
  useEffect(() => {
    setIsEditing(!data?.imageUrl);
  }, [data?.imageUrl]);

  // 实时预览：输入图 / 效果 / 参数变化后防抖重渲（预览与「生成」共用同一实现）
  useEffect(() => {
    if (!activeImageSrc || !isEditing) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setIsRenderingPreview(true);
      setPreviewError(null);
      applyImageFx(effect.id, activeImageSrc, params, { maxEdge: PREVIEW_MAX_EDGE })
        .then((url) => {
          if (!cancelled) setPreviewUrl(url);
        })
        .catch((err: unknown) => {
          console.error('实时预览图片处理失败:', err);
          if (!cancelled) {
            setPreviewUrl(null);
            setPreviewError(err instanceof Error ? err.message : '预览失败，请重试');
          }
        })
        .finally(() => {
          if (!cancelled) setIsRenderingPreview(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeImageSrc, isEditing, effect.id, paramsKey, previewNonce]);

  const patchState = useCallback(
    (patch: Partial<ImageProcessState>) => {
      onUpdateState?.(id, patch);
    },
    [id, onUpdateState],
  );

  /** 更新当前效果的某个参数（参数按效果分桶存储，切换互不覆盖） */
  const setParam = useCallback(
    (key: string, value: ImageFxParamValue) => {
      let nextEffectParams = { ...params, [key]: value };
      // 若切换触感质感的具体风格，自动联动官方推荐的最佳预设滑杆参数
      if (
        effect.id === 'texture' &&
        key === 'style' &&
        typeof value === 'string' &&
        value in TEXTURE_STYLE_PRESETS
      ) {
        const preset = TEXTURE_STYLE_PRESETS[value as TextureStyleId];
        if (preset) {
          nextEffectParams = {
            ...nextEffectParams,
            detail: preset.detail,
            intensity: preset.intensity,
            contrast: preset.contrast,
          };
        }
      }
      patchState({
        fxParams: {
          ...(data.fxParams ?? {}),
          [effect.id]: nextEffectParams,
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effect.id, paramsKey, data?.fxParams, patchState],
  );

  /** 切换效果：旧结果立即失效（清空 imageUrl 回编辑态），保证输出与所选效果一致 */
  const handleEffectChange = useCallback(
    (nextEffectId: string) => {
      patchState(switchFxEffectPatch(nextEffectId, data));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, patchState],
  );

  // 生成：全尺寸渲染当前效果写入 imageUrl（预览小图与导出共用同一实现，所见即所得）
  const handleGenerate = useCallback(async () => {
    if (!activeImageSrc || isGenerating) return;
    setIsGenerating(true);
    try {
      const dataUrl = await applyImageFx(effect.id, activeImageSrc, params, {
        maxEdge: EXPORT_MAX_EDGE,
      });
      onUpdateState?.(id, {
        effectId: effect.id,
        fxParams: {
          ...(data.fxParams ?? {}),
          [effect.id]: params,
        },
        imageUrl: dataUrl,
        isSaved: false,
      });
      showToast('图片处理完成（可点击保存按钮写入数据库）', { type: 'success' });
    } catch (err: unknown) {
      console.error('图片处理失败:', err);
      showToast(err instanceof Error ? err.message : '图片处理失败，请重试', { type: 'error' });
    } finally {
      setIsGenerating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeImageSrc, isGenerating, effect.id, paramsKey, id, onUpdateState, showToast]);

  // 独立保存到数据库
  const handleSaveToDatabase = useCallback(async () => {
    const imgUrl = data?.imageUrl;
    if (!imgUrl || isExporting || !onExport) return;
    setIsExporting(true);
    try {
      await onExport(id, imgUrl, {
        effectId: data.effectId,
        fxParams: data.fxParams,
        uploadedImage: data.uploadedImage ?? null,
        imageUrl: imgUrl,
        isSaved: true,
        effectName: effect.name,
      });
      onUpdateState?.(id, { isSaved: true });
      onSelect?.(id);
      showToast('已保存到数据库，已解锁公开与收藏', { type: 'success' });
    } catch (err: any) {
      console.error('保存到数据库失败:', err);
      showToast(err?.detail || err?.message || '保存失败，请重试', { type: 'error' });
    } finally {
      setIsExporting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isExporting, onExport, id, effect.name, onUpdateState, onSelect, showToast]);

  // 本地直接下载 PNG（随时可用）
  const handleDownload = useCallback(() => {
    const url = data?.imageUrl;
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `image-process-${effect.id}-${Date.now()}.png`;
    link.click();
    showToast('图片已下载', { type: 'success' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.imageUrl, effect.id, showToast]);

  // 统一图片文件处理（支持 input 上传与拖拽 Drop）
  const processUploadedFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        showToast('请选择图片文件', { type: 'warning' });
        return;
      }
      const reader = new FileReader();
      reader.onload = (evt) => {
        const result = evt.target?.result as string;
        if (result) {
          onUpdateState?.(id, { uploadedImage: result, imageUrl: null });
          setIsEditing(true);
          showToast('已加载本地图片', { type: 'success' });
        }
      };
      reader.readAsDataURL(file);
    },
    [id, onUpdateState, showToast]
  );

  // 本地上传图片
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processUploadedFile(file);
    e.target.value = '';
  };

  // 拖拽上传图片
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processUploadedFile(file);
  };

  // 清空本地上传图片，恢复上游继承
  const handleClearUpload = () => {
    onUpdateState?.(id, { uploadedImage: null, imageUrl: null });
    setIsEditing(true);
    showToast('已恢复上级输入图片', { type: 'success' });
  };

  // 统一重置回当前模板默认参数（编辑态恢复默认；结果态一并清空成图回到编辑态）
  const handleResetParams = useCallback(() => {
    const defaultParams = defaultFxParamsOf(effect);
    const patch: Partial<ImageProcessState> = {
      fxParams: {
        ...(data?.fxParams ?? {}),
        [effect.id]: defaultParams,
      },
    };
    if (data?.imageUrl && !isEditing) {
      setIsEditing(true);
      patch.imageUrl = null;
      patch.isSaved = false;
    }
    patchState(patch);
    showToast(`已重置为${effect.name}初始默认参数`, { type: 'success' });
  }, [effect, data?.fxParams, data?.imageUrl, isEditing, patchState, showToast]);

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

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '图片处理'}
      dotColor={NODE_COLORS.image_process || 'oklch(0.66 0.15 105)'}
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
      showLeftAnchor={true}
      showRightAnchor={true}
      onClick={() => onSelect?.(id)}
      footer={footer}
      sideDrawer={
        isEditing ? (
          <ImageProcessStudioPanel
            isOpen={isDrawerOpen}
            effect={effect}
            params={params}
            activeImageSrc={activeImageSrc}
            disabled={isGenerating}
            onParamChange={setParam}
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
              {/* 收藏按钮（未保存时禁用并提示） */}
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
              {/* 公开按钮（未保存时禁用并提示） */}
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
              {/* 下载按钮（随时可用） */}
              <NodeActionBar.Download
                onClick={handleDownload}
                disabled={isExporting}
                tooltip="直接下载结果 PNG"
              />
              <NodeActionBar.Reset
                onClick={handleResetParams}
                disabled={isExporting}
                tooltip="清空结果回到参数编辑态并重置参数"
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
                tooltip={`生成${effect.name}效果`}
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
        {/* 控制工具栏（编辑态展示：6 效果图标切分栏横版排列 + 右侧侧边吸附抽屉展开按钮） */}
        {!hasGenerated && (
          <div className="relative z-20 flex items-center gap-1.5 p-1.5 rounded-xl bg-paper/95 border border-paper-grid/80 text-xs font-sans text-ink-light select-none shadow-2xs shrink-0">
            {/* 6 种工艺横向等宽 Segmented 选择栏 */}
            <div
              role="radiogroup"
              aria-label="图片处理效果模板"
              className="grid grid-cols-6 flex-1 p-0.5 rounded-lg bg-paper-grid/40 border border-paper-grid/60 gap-0.5 shadow-2xs min-w-0"
            >
              {EFFECT_CONFIGS.map((cfg) => {
                const isChecked = effect.id === cfg.id;
                const IconComponent = cfg.icon;
                return (
                  <button
                    key={cfg.id}
                    type="button"
                    role="radio"
                    aria-checked={isChecked}
                    aria-label={cfg.name}
                    onClick={() => handleEffectChange(cfg.id)}
                    disabled={isGenerating}
                    className={`flex flex-col items-center justify-center py-1.5 px-0.5 rounded-md text-[10px] font-medium leading-tight transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-out cursor-pointer active:scale-[0.96] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-1.5 focus-visible:ring-accent ${
                      isChecked
                        ? 'bg-paper text-accent font-semibold shadow-2xs border border-paper-grid/40'
                        : 'text-ink-light hover:text-ink hover:bg-paper-grid/30 border border-transparent'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <IconComponent size={14} strokeWidth={1.5} className="shrink-0 mb-0.5" aria-hidden="true" />
                    <span className="truncate text-[10px] leading-none tracking-tight">{cfg.shortLabel}</span>
                  </button>
                );
              })}
            </div>

            {/* 右侧吸附抽屉展开/收起按钮（带扩展热区与焦点环） */}
            <Tooltip content={isDrawerOpen ? '收起参数配置抽屉' : '展开侧边参数配置抽屉'}>
              <button
                type="button"
                onClick={() => setIsDrawerOpen((prev) => !prev)}
                disabled={isGenerating}
                className={`relative p-1.5 rounded-md border transition-[color,border-color,background-color,transform] duration-150 ease-out active:scale-[0.96] motion-reduce:transform-none shrink-0 cursor-pointer before:absolute before:-inset-1 before:content-[''] focus-visible:outline-none focus-visible:ring-1.5 focus-visible:ring-accent ${
                  isDrawerOpen
                    ? 'bg-accent text-white border-accent shadow-2xs'
                    : 'bg-paper/80 border-paper-grid/70 text-ink-light hover:text-accent hover:border-accent/60'
                } disabled:cursor-not-allowed disabled:opacity-50`}
                aria-label={isDrawerOpen ? '收起参数配置抽屉' : '展开侧边参数配置抽屉'}
                aria-pressed={isDrawerOpen}
              >
                <SlidersHorizontal size={14} strokeWidth={1.5} />
              </button>
            </Tooltip>
          </div>
        )}

        {/* 预览区（编辑态=实时效果预览；结果态=生成结果；采用严格同心圆角与弹性自适应） */}
        <div className="relative flex-1 min-h-0 w-full overflow-hidden rounded-xl bg-paper-grid/10 border border-paper-grid/40 flex items-center justify-center select-none">
          <AnimatePresence initial={false}>
            {!hasGenerated ? (
              <motion.div
                key="editor"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                className="absolute inset-0 flex items-center justify-center overflow-hidden p-2.5"
              >
                {activeImageSrc ? (
                  previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={`${effect.name}效果实时预览`}
                      className="max-w-full max-h-full object-contain rounded-lg shadow-sm outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
                    />
                  ) : previewError ? (
                    <div className="flex flex-col items-center gap-2 text-ink-faint p-4 text-center">
                      <span className="text-xs">{previewError}</span>
                      <button
                        type="button"
                        onClick={() => setPreviewNonce((n) => n + 1)}
                        className="px-2.5 py-1 rounded text-xs bg-paper-grid/40 hover:bg-paper-grid/70 active:scale-[0.96] transition-[background-color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-1.5 focus-visible:ring-accent"
                      >
                        重试
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-ink-faint">
                      <Loader2 size={20} className="animate-spin text-accent" />
                      <span className="text-xs">正在生成预览…</span>
                    </div>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDragOver(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDragOver(false);
                    }}
                    onDrop={handleDrop}
                    className={`group/empty flex flex-col items-center justify-center gap-2.5 p-6 text-center rounded-xl border border-dashed transition-[border-color,background-color,transform,color] duration-150 ease-out cursor-pointer active:scale-[0.98] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      isDragOver
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-paper-grid/80 hover:border-accent hover:bg-paper-grid/20 text-ink-faint hover:text-ink'
                    }`}
                    aria-label="点击或拖拽上传本地图片"
                  >
                    <div className="w-11 h-11 rounded-full bg-paper-grid/30 flex items-center justify-center text-ink-light group-hover/empty:bg-accent/15 group-hover/empty:text-accent transition-colors duration-150">
                      <Upload size={22} strokeWidth={1.5} />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium text-ink-light group-hover/empty:text-accent transition-colors duration-150">
                        点击上传图片 或 拖拽到此
                      </span>
                      <span className="text-[11px] text-ink-faint">
                        支持 JPG、PNG、WebP，也可连线上级节点
                      </span>
                    </div>
                  </button>
                )}

                {/* 实时预览渲染中状态药丸（淡入淡出平滑过渡） */}
                <AnimatePresence>
                  {isRenderingPreview && activeImageSrc && previewUrl && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.12, ease: 'easeOut' }}
                      className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-paper/90 backdrop-blur-md border border-paper-grid/60 text-[11px] font-sans text-ink-light shadow-sm"
                    >
                      <Loader2 size={12} className="animate-spin text-accent" />
                      <span>渲染中…</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ) : (
              <motion.div
                key="preview"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                className="absolute inset-0 flex items-center justify-center p-3"
              >
                {data.imageUrl ? (
                  <div className="relative w-full h-full flex items-center justify-center">
                    <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
                      <PhotoView src={data.imageUrl}>
                        <img
                          src={data.imageUrl}
                          alt={`${effect.name}效果结果`}
                          className="max-w-full max-h-full object-contain drop-shadow-md select-none rounded-lg outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10 cursor-zoom-in hover:opacity-95 transition-opacity duration-150"
                        />
                      </PhotoView>
                    </PhotoProvider>

                    {/* 成品效果微标（对齐系统级规范，左下角弱化信息，不遮挡主画面） */}
                    <div className="absolute bottom-2.5 left-2.5 z-10 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-paper/85 backdrop-blur-xs border border-paper-grid/70 text-[10px] text-ink-light font-sans shadow-2xs select-none pointer-events-none">
                      <span>{effect.name}</span>
                      <span className="text-ink-faint">·</span>
                      <span className="text-ink-faint">点击放大</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-ink-faint">暂无处理结果</div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* 高清导出生成中遮罩（带平滑淡入淡出） */}
          <AnimatePresence>
            {isGenerating && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2.5 bg-black/40 backdrop-blur-xs text-paper"
              >
                <Loader2 size={26} className="animate-spin text-accent" />
                <span className="text-xs tracking-wide">正在处理图片…</span>
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

export const ImageProcessNode = memo(ImageProcessNodeInner);
ImageProcessNode.displayName = 'ImageProcessNode';
export default ImageProcessNode;
