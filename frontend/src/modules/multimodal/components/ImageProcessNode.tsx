import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
} from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  applyImageFx,
  getAllImageFxEffects,
  resolveFxParams,
  switchFxEffectPatch,
} from '../imageprocess';
import type { ImageProcessState, ImageFxParamValue, ImageFxSliderParamDef } from '../imageprocess';

/** 预览渲染最长边（提速）；导出生成用大值保清晰 */
const PREVIEW_MAX_EDGE = 1024;
const EXPORT_MAX_EDGE = 2048;

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
  hasDownstream?: boolean;
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

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}

const SliderRow: React.FC<SliderRowProps> = memo(({
  label,
  value,
  min,
  max,
  step,
  display,
  disabled = false,
  onChange,
}) => (
  <label className="flex items-center gap-2 flex-1 min-w-0">
    <span className="text-ink-faint text-[11px] whitespace-nowrap">{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      aria-valuetext={display}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="flex-1 min-w-0 accent-[color:var(--accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded-sm"
    />
    <span className="text-[11px] text-ink-light w-12 text-right whitespace-nowrap tabular-nums">{display}</span>
  </label>
));
SliderRow.displayName = 'SliderRow';

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
  hasDownstream,
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
  const allEffects = useMemo(() => getAllImageFxEffects(), []);
  const paramsKey = JSON.stringify(params);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isRenderingPreview, setIsRenderingPreview] = useState(false);
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);
  /** 预览手动重试计数（仅触发重渲，不写入持久化参数） */
  const [previewNonce, setPreviewNonce] = useState(0);

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
      patchState({
        fxParams: {
          ...(data.fxParams ?? {}),
          [effect.id]: { ...params, [key]: value },
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
        onUpdateState?.(id, { uploadedImage: result, imageUrl: null });
        setIsEditing(true);
        showToast('已加载本地图片', { type: 'success' });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // 清空本地上传图片，恢复上游继承
  const handleClearUpload = () => {
    onUpdateState?.(id, { uploadedImage: null, imageUrl: null });
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

  // 参数控件按声明分组：滑杆每行两个，分段控件独占一行右对齐
  const sliderDefs = effect.params.filter((p): p is ImageFxSliderParamDef => p.kind === 'slider');
  const segmentDefs = effect.params.filter((p) => p.kind === 'segment');
  const sliderRows: ImageFxSliderParamDef[][] = [];
  for (let i = 0; i < sliderDefs.length; i += 2) {
    sliderRows.push(sliderDefs.slice(i, i + 2));
  }

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
      defaultSize={{ width: 440, height: 560 }}
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
                hasDownstream={hasDownstream}
                downstreamTooltip="有下级节点，不可重新调整"
                tooltip="重新调整参数"
              />
              <NodeActionBar.Custom
                icon={<Upload size={16} strokeWidth={1.5} />}
                tooltip="上传/替换本地图片"
                downstreamTooltip="有下级节点，不可更换图片"
                onClick={() => fileInputRef.current?.click()}
                disabled={isExporting}
                hasDownstream={hasDownstream}
              />
              {data?.uploadedImage && (
                <NodeActionBar.Custom
                  icon={<Trash2 size={16} strokeWidth={1.5} className="text-error/80 hover:text-error" />}
                  tooltip="恢复上级继承图片（清空本地上传）"
                  downstreamTooltip="有下级节点，不可清空图片"
                  onClick={handleClearUpload}
                  disabled={isExporting}
                  hasDownstream={hasDownstream}
                />
              )}
              {/* 独立保存到数据库按钮 */}
              <NodeActionBar.Custom
                icon={<Check size={16} strokeWidth={1.5} className={isSaved ? 'text-accent' : ''} />}
                onClick={handleSaveToDatabase}
                disabled={isExporting || isSaved}
                hasDownstream={hasDownstream}
                downstreamTooltip="有下级节点，不可保存"
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
                onClick={() => patchState({ imageUrl: null, isSaved: false })}
                disabled={isExporting}
                hasDownstream={hasDownstream}
                downstreamTooltip="有下级节点，不可重置"
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
                tooltip={`生成${effect.name}效果`}
                downstreamTooltip="有下级节点，不可生成"
                onClick={handleGenerate}
                disabled={!activeImageSrc || isGenerating}
                hasDownstream={hasDownstream}
              />
              <NodeActionBar.Custom
                icon={<Upload size={16} strokeWidth={1.5} />}
                tooltip="上传/替换本地图片"
                downstreamTooltip="有下级节点，不可更换图片"
                onClick={() => fileInputRef.current?.click()}
                disabled={isGenerating}
                hasDownstream={hasDownstream}
              />
              {data?.uploadedImage && (
                <NodeActionBar.Custom
                  icon={<Trash2 size={16} strokeWidth={1.5} className="text-error/80 hover:text-error" />}
                  tooltip="恢复上级继承图片（清空本地上传）"
                  downstreamTooltip="有下级节点，不可清空图片"
                  onClick={handleClearUpload}
                  disabled={isGenerating}
                  hasDownstream={hasDownstream}
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

      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
        {/* 控制工具栏（编辑态展示：效果切换 + 按声明渲染的参数控件） */}
        {!hasGenerated && (
          <div className="flex flex-col gap-1.5 px-1.5 py-1.5 rounded-md bg-paper-grid/20 border border-paper-grid/40 text-xs font-sans text-ink-light select-none">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 min-w-0" title={effect.description}>
                <Layers size={14} className="text-ink-faint shrink-0" />
                <select
                  value={effect.id}
                  disabled={hasDownstream || isGenerating}
                  onChange={(e) => handleEffectChange(e.target.value)}
                  aria-label="处理效果"
                  className="bg-paper border border-paper-grid text-ink rounded px-2 py-1 text-xs outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {allEffects.map((fx) => (
                    <option key={fx.id} value={fx.id}>
                      {fx.name}
                    </option>
                  ))}
                </select>
              </label>
              {segmentDefs.map((def) =>
                def.kind === 'segment' ? (
                  <div key={def.key} className="flex items-center gap-1 shrink-0" role="radiogroup" aria-label={def.label}>
                    <span className="text-ink-faint text-[11px] px-0.5">{def.label}:</span>
                    {def.options.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={params[def.key] === opt.value}
                        onClick={() => setParam(def.key, opt.value)}
                        disabled={hasDownstream || isGenerating}
                        className={`px-2 py-0.5 rounded text-xs transition-colors duration-150 active:scale-[0.96] ${
                          params[def.key] === opt.value
                            ? 'bg-accent/15 text-accent font-medium'
                            : 'hover:bg-paper-grid/40 text-ink-light'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ) : null
              )}
            </div>
            {sliderRows.map((row, rowIndex) => (
              <div key={rowIndex} className="flex items-center justify-between gap-2">
                {row.map((def) => (
                  <SliderRow
                    key={def.key}
                    label={def.label}
                    value={Number(params[def.key])}
                    min={def.min}
                    max={def.max}
                    step={def.step}
                    display={def.display ? def.display(Number(params[def.key])) : String(params[def.key])}
                    disabled={hasDownstream || isGenerating}
                    onChange={(v) => setParam(def.key, v)}
                  />
                ))}
              </div>
            ))}
            {effect.id === 'dither' && params.palette === 'custom' && (
              <div className="flex items-center gap-1.5">
                <span className="text-ink-faint text-[11px] whitespace-nowrap">自定义:</span>
                <input
                  type="text"
                  value={String(params.customPalette ?? '#000000,#ffffff')}
                  onChange={(e) => setParam('customPalette', e.target.value)}
                  placeholder="#000000,#ffffff,..."
                  className="flex-1 bg-paper border border-paper-grid text-ink rounded px-2 py-1 text-xs outline-none focus:border-accent disabled:opacity-60 font-mono"
                  disabled={hasDownstream || isGenerating}
                />
              </div>
            )}
          </div>
        )}

        {/* 预览区（编辑态=实时效果预览；结果态=生成结果） */}
        <div className="relative flex-1 min-h-0 w-full overflow-hidden rounded bg-paper-grid/10 border border-paper-grid/40 flex items-center justify-center select-none">
          <AnimatePresence mode="wait" initial={false}>
            {!hasGenerated ? (
              <motion.div
                key="editor"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="relative w-full h-full flex items-center justify-center overflow-hidden p-2"
              >
                {activeImageSrc ? (
                  previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={`${effect.name}效果实时预览`}
                      className="max-w-full max-h-full object-contain rounded"
                    />
                  ) : previewError ? (
                    <div className="flex flex-col items-center gap-2 text-ink-faint p-4 text-center">
                      <span className="text-xs">{previewError}</span>
                      <button
                        type="button"
                        onClick={() => setPreviewNonce((n) => n + 1)}
                        className="px-2.5 py-1 rounded text-xs bg-paper-grid/40 hover:bg-paper-grid/70 active:scale-[0.96] transition-colors duration-150"
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
                  <div className="flex flex-col items-center justify-center text-ink-faint gap-2 p-6 text-center">
                    <Upload size={32} strokeWidth={1.5} />
                    <p className="text-xs">请连线上级图片或点击上方按钮上传本地图片</p>
                  </div>
                )}
                {isRenderingPreview && activeImageSrc && previewUrl && (
                  <div className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-1 rounded-full bg-paper/85 backdrop-blur text-[11px] text-ink-light shadow-sm">
                    <Loader2 size={12} className="animate-spin" />
                    渲染中…
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="preview"
                initial={{ scale: 0.96, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.96, opacity: 0 }}
                transition={{ type: 'spring', damping: 24, stiffness: 260 }}
                className="relative w-full h-full flex items-center justify-center p-3"
              >
                {data.imageUrl ? (
                  <div className="relative group max-w-full max-h-full flex items-center justify-center">
                    <img
                      src={data.imageUrl}
                      alt={`${effect.name}效果结果`}
                      className="max-w-full max-h-[440px] object-contain drop-shadow-md select-none pointer-events-none rounded"
                    />
                    {!hasDownstream && (
                      <button
                        type="button"
                        onClick={() => setIsEditing(true)}
                        className="absolute bottom-3 right-3 px-2.5 py-1.5 rounded-full bg-paper/90 backdrop-blur text-ink text-xs shadow-md border border-paper-grid/40 hover:bg-white hover:text-accent active:scale-[0.96] transition-[opacity,transform,background-color,color] flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent duration-150"
                      >
                        <Pencil size={12} strokeWidth={1.5} />
                        <span>调整参数</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-ink-faint">暂无处理结果</div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {isGenerating && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/35 backdrop-blur-sm text-paper">
              <Loader2 size={28} className="animate-spin" />
              <span className="text-xs">正在处理图片…</span>
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

export const ImageProcessNode = memo(ImageProcessNodeInner);
ImageProcessNode.displayName = 'ImageProcessNode';
export default ImageProcessNode;
