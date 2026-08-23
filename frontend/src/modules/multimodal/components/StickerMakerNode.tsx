import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wand2,
  Heart,
  Globe,
  Upload,
  Trash2,
  Eraser,
  Layers,
  Loader2,
  Pencil,
  Check,
  Pipette,
} from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import { ColorPickerPopover } from '../../../platform/components/ui/ColorPicker';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  type StickerMakerState,
  type StickerBackgroundRemovalProgress,
  removeImageBackground,
  renderStickerFromImage,
  DEFAULT_STICKER_SHADOW,
  downloadStickerImage,
} from '../sticker';

export interface StickerMakerNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 节点持久化数据 */
  data?: Partial<StickerMakerState> & {
    imageUrl?: string | null;
    uploadedImage?: string | null;
    isExporting?: boolean;
    error?: string | null;
  };
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
  onUpdateState?: (id: string, patch: Partial<StickerMakerState>) => void;
  /** 导出贴纸：PNG Data URL 落盘保存 + 写入历史数据库 */
  onExport?: (id: string, dataUrl: string, state: StickerMakerState) => Promise<void>;
}

/** 白边宽度滑杆范围 */
const OUTLINE_WIDTH_MIN = 0;
const OUTLINE_WIDTH_MAX = 48;
const OUTLINE_WIDTH_STEP = 2;

/** 预设白边颜色 */
const OUTLINE_COLOR_PRESETS = ['#ffffff', '#f7f5f2', '#19191d', '#ff8fab', '#7dd3fc'];

/** 预设白边颜色悬浮说明 */
const OUTLINE_COLOR_LABELS: Record<string, string> = {
  '#ffffff': '纯白（经典模切白边）',
  '#f7f5f2': '米白（柔和纸质感）',
  '#19191d': '深黑（墨色描边）',
  '#ff8fab': '樱粉（粉嫩描边）',
  '#7dd3fc': '天蓝（清爽描边）',
};

const StickerMakerNodeInner: React.FC<StickerMakerNodeProps> = ({
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

  // 1. 输入图片优先级：本地上传 > 直连图片/穿透封面/根节点封面兜底
  const activeImageSrc = useMemo(() => {
    return data?.uploadedImage || upstreamImageUrl || null;
  }, [data?.uploadedImage, upstreamImageUrl]);

  const [removeBackground, setRemoveBackground] = useState<boolean>(
    data.removeBackground !== undefined ? data.removeBackground : true
  );
  const [outlineWidth, setOutlineWidth] = useState<number>(
    data.outlineWidth !== undefined ? data.outlineWidth : 18
  );
  const [outlineColor, setOutlineColor] = useState<string>(data.outlineColor || '#ffffff');
  const [shadowEnabled, setShadowEnabled] = useState<boolean>(
    data.shadowEnabled !== undefined ? data.shadowEnabled : true
  );
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [bgProgress, setBgProgress] = useState<StickerBackgroundRemovalProgress | null>(null);
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);

  const isCustomColor = useMemo(
    () => !OUTLINE_COLOR_PRESETS.includes((outlineColor || '').toLowerCase()),
    [outlineColor]
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 当外部 data.imageUrl 变更时同步编辑态
  useEffect(() => {
    if (data?.imageUrl) {
      setIsEditing(false);
    } else {
      setIsEditing(true);
    }
  }, [data?.imageUrl]);

  const updateParam = (patch: Partial<StickerMakerState>) => {
    onUpdateState?.(id, patch);
  };

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

  // 生成贴纸：可选 AI 抠图 → die-cut 白边描边 → 投影 → PNG
  const handleGenerate = useCallback(async () => {
    if (!activeImageSrc || isWorking || isExporting) return;
    setIsWorking(true);
    setBgProgress(null);

    try {
      // 1. 可选抠图移除背景（首次含模型下载进度）
      let sourceForRender = activeImageSrc;
      if (removeBackground) {
        const removed = await removeImageBackground(activeImageSrc, (progress) =>
          setBgProgress(progress)
        );
        sourceForRender = removed.dataUrl;
      }

      // 2. 离线 Canvas 渲染：白边描边 + 投影
      const resultDataUrl = await renderStickerFromImage(sourceForRender, {
        outline: { width: outlineWidth, color: outlineColor },
        shadow: { ...DEFAULT_STICKER_SHADOW, enabled: shadowEnabled },
      });

      // 3. 轻微延迟让状态过渡自然
      await new Promise((resolve) => setTimeout(resolve, 200));

      // 4. 更新节点数据（此时为未保存到数据库状态）
      onUpdateState?.(id, {
        imageUrl: resultDataUrl,
        isSaved: false,
        removeBackground,
        outlineWidth,
        outlineColor,
        shadowEnabled,
        uploadedImage: data.uploadedImage || null,
      });

      setIsEditing(false);
      showToast('贴纸生成完成（可点击保存按钮写入数据库）', { type: 'success' });
    } catch (err: any) {
      console.error('生成贴纸失败:', err);
      showToast(err?.message || '生成贴纸失败，请重试', { type: 'error' });
    } finally {
      setBgProgress(null);
      setIsWorking(false);
    }
  }, [
    activeImageSrc,
    isWorking,
    isExporting,
    removeBackground,
    outlineWidth,
    outlineColor,
    shadowEnabled,
    id,
    data.uploadedImage,
    onUpdateState,
    showToast,
  ]);

  // 独立保存到数据库
  const handleSaveToDatabase = useCallback(async () => {
    const imgUrl = data?.imageUrl;
    if (!imgUrl || isExporting || !onExport) return;
    setIsExporting(true);

    try {
      await onExport(id, imgUrl, {
        removeBackground,
        outlineWidth,
        outlineColor,
        shadowEnabled,
        uploadedImage: data.uploadedImage || null,
        isSaved: true,
      });
      onUpdateState?.(id, { isSaved: true });
      onSelect?.(id);
      showToast('贴纸已保存到数据库，已解锁公开与收藏', { type: 'success' });
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
    removeBackground,
    outlineWidth,
    outlineColor,
    shadowEnabled,
    onUpdateState,
    onSelect,
    showToast,
  ]);

  // 本地直接下载 PNG（随时可用，不影响已保存记录）
  const handleDownload = useCallback(() => {
    const url = data?.imageUrl;
    if (!url) return;
    downloadStickerImage(url, `sticker-${Date.now()}.png`);
    showToast('贴纸图片已下载', { type: 'success' });
  }, [data?.imageUrl, showToast]);

  // 重置：清空生成结果回编辑态并恢复默认参数
  const handleReset = useCallback(() => {
    const defaults = {
      removeBackground: true,
      outlineWidth: 18,
      outlineColor: '#ffffff',
      shadowEnabled: true,
    };
    setRemoveBackground(defaults.removeBackground);
    setOutlineWidth(defaults.outlineWidth);
    setOutlineColor(defaults.outlineColor);
    setShadowEnabled(defaults.shadowEnabled);
    if (data?.imageUrl && !isEditing) {
      setIsEditing(true);
      onUpdateState?.(id, { imageUrl: null, ...defaults });
      showToast('已重置并返回编辑模式', { type: 'success' });
    } else {
      onUpdateState?.(id, defaults);
      showToast('参数已重置为默认', { type: 'success' });
    }
  }, [data?.imageUrl, isEditing, id, onUpdateState, showToast]);

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
  const busy = isWorking || isExporting;

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '贴纸制作'}
      dotColor={NODE_COLORS.sticker_maker || 'oklch(0.72 0.16 340)'}
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
                disabled={busy}
                hasDownstream={hasDownstream}
                downstreamTooltip="有下级节点，不可重新调整"
                tooltip="返回编辑模式"
              />
              <NodeActionBar.Custom
                icon={<Upload size={16} strokeWidth={1.5} />}
                tooltip="上传/替换本地图片"
                downstreamTooltip="有下级节点，不可更换图片"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                hasDownstream={hasDownstream}
              />
              {data?.uploadedImage && (
                <NodeActionBar.Custom
                  icon={<Trash2 size={16} strokeWidth={1.5} className="text-error/80 hover:text-error" />}
                  tooltip="恢复上级继承图片（清空本地上传）"
                  downstreamTooltip="有下级节点，不可清空图片"
                  onClick={handleClearUpload}
                  disabled={busy}
                  hasDownstream={hasDownstream}
                />
              )}
              {/* 独立保存到数据库按钮 */}
              <NodeActionBar.Custom
                icon={<Check size={16} strokeWidth={isSaved ? 2.5 : 1.5} className={isSaved ? 'text-accent' : ''} />}
                onClick={handleSaveToDatabase}
                disabled={busy || isSaved}
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
                disabled={!isSaved || busy || !onToggleFavorite}
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
                disabled={!isSaved || busy || !onTogglePublic}
              />
              {/* 下载按钮 */}
              <NodeActionBar.Download
                onClick={handleDownload}
                disabled={isExporting}
                tooltip="直接下载贴纸 PNG"
              />
              <NodeActionBar.Reset
                onClick={handleReset}
                disabled={busy}
                hasDownstream={hasDownstream}
                downstreamTooltip="有下级节点，不可重置"
                tooltip="重置参数与结果"
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
                tooltip="生成贴纸"
                downstreamTooltip="有下级节点，不可生成"
                onClick={handleGenerate}
                disabled={!activeImageSrc || busy}
                hasDownstream={hasDownstream}
              />
              <NodeActionBar.Custom
                icon={<Upload size={16} strokeWidth={1.5} />}
                tooltip="上传/替换本地图片"
                downstreamTooltip="有下级节点，不可更换图片"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                hasDownstream={hasDownstream}
              />
              {data?.uploadedImage && (
                <NodeActionBar.Custom
                  icon={<Trash2 size={16} strokeWidth={1.5} className="text-error/80 hover:text-error" />}
                  tooltip="恢复上级继承图片（清空本地上传）"
                  downstreamTooltip="有下级节点，不可清空图片"
                  onClick={handleClearUpload}
                  disabled={busy}
                  hasDownstream={hasDownstream}
                />
              )}
              <NodeActionBar.Reset
                onClick={handleReset}
                disabled={busy}
                hasDownstream={hasDownstream}
                downstreamTooltip="有下级节点，不可重置"
                tooltip="重置参数"
              />
            </>
          )}
          <NodeActionBar.ExternalLink
            href="https://github.com/CatsJuice/sticker-forge"
            tooltip="点击使用完整功能"
          />
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
        {/* 顶部工具栏（仅在编辑模式展示抠图与样式参数） */}
        {isEditing && (
          <div className="flex flex-col gap-1.5 px-1.5 py-1 rounded bg-paper-grid/20 border border-paper-grid/40 text-xs font-sans text-ink-light select-none">
            <div className="flex items-center justify-between gap-1">
              {/* 移除背景开关 */}
              <Tooltip
                content={
                  removeBackground
                    ? '已开启 AI 抠图（自动去底保留主体）'
                    : '已关闭（保留原图背景直接生成）'
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
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition ${
                    removeBackground
                      ? 'bg-accent/15 text-accent font-medium'
                      : 'hover:bg-paper-grid/40 text-ink-light'
                  }`}
                >
                  <Eraser size={12} />
                  <span>移除背景</span>
                </button>
              </Tooltip>

              {/* 投影开关 */}
              <Tooltip
                content={
                  shadowEnabled
                    ? '已开启立体投影（添加柔和环境阴影）'
                    : '已关闭投影（仅保留模切描边）'
                }
              >
                <button
                  type="button"
                  onClick={() => {
                    const next = !shadowEnabled;
                    setShadowEnabled(next);
                    updateParam({ shadowEnabled: next });
                  }}
                  disabled={hasDownstream}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition ${
                    shadowEnabled
                      ? 'bg-accent/15 text-accent font-medium'
                      : 'hover:bg-paper-grid/40 text-ink-light'
                  }`}
                >
                  <Layers size={12} />
                  <span>投影</span>
                </button>
              </Tooltip>
            </div>

            <div className="flex items-center justify-between gap-2">
              {/* 白边宽度 */}
              <Tooltip content="模切白边宽度：调整贴纸外轮廓宽度 (0~48px)">
                <div className="flex items-center gap-1.5 flex-1">
                  <span className="text-ink-faint text-[11px] whitespace-nowrap">白边:</span>
                  <input
                    type="range"
                    min={OUTLINE_WIDTH_MIN}
                    max={OUTLINE_WIDTH_MAX}
                    step={OUTLINE_WIDTH_STEP}
                    value={outlineWidth}
                    disabled={hasDownstream}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setOutlineWidth(next);
                      updateParam({ outlineWidth: next });
                    }}
                    className="flex-1 h-1 accent-[var(--accent)] cursor-pointer"
                  />
                  <span className="text-[11px] text-ink-faint w-6 text-right tabular-nums font-mono">
                    {outlineWidth}
                  </span>
                </div>
              </Tooltip>

              {/* 白边颜色 */}
              <div className="flex items-center gap-1">
                {OUTLINE_COLOR_PRESETS.map((color) => (
                  <Tooltip
                    key={color}
                    content={OUTLINE_COLOR_LABELS[color] || `描边颜色 ${color}`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setOutlineColor(color);
                        updateParam({ outlineColor: color });
                      }}
                      disabled={hasDownstream}
                      style={{ backgroundColor: color }}
                      className={`w-4 h-4 rounded-full border transition ${
                        outlineColor.toLowerCase() === color
                          ? 'border-accent ring-2 ring-accent/40 scale-110'
                          : 'border-paper-grid/60 hover:scale-110'
                      }`}
                    />
                  </Tooltip>
                ))}

                {/* 自定义颜色与取色器 */}
                <ColorPickerPopover
                  value={outlineColor}
                  onChange={(hex) => {
                    setOutlineColor(hex);
                    updateParam({ outlineColor: hex });
                  }}
                  disabled={hasDownstream}
                  align="right"
                >
                  <Tooltip
                    content={
                      isCustomColor
                        ? `自定义描边颜色（当前: ${outlineColor}）`
                        : '自定义颜色 / 吸管取色'
                    }
                  >
                    <button
                      type="button"
                      disabled={hasDownstream}
                      style={{ backgroundColor: isCustomColor ? outlineColor : undefined }}
                      className={`w-4 h-4 rounded-full border flex items-center justify-center transition ${
                        isCustomColor
                          ? 'border-accent ring-2 ring-accent/40 scale-110 shadow-2xs'
                          : 'border-paper-grid/70 hover:border-accent hover:scale-110 bg-paper/80 text-ink-light hover:text-accent'
                      }`}
                    >
                      {!isCustomColor && <Pipette size={9} strokeWidth={2} />}
                    </button>
                  </Tooltip>
                </ColorPickerPopover>
              </div>
            </div>
          </div>
        )}

        {/* 核心操作与预览画布 */}
        <div className="relative flex-1 min-h-0 w-full overflow-hidden rounded bg-paper-grid/10 border border-paper-grid/40 flex items-center justify-center select-none">
          <AnimatePresence mode="wait">
            {!hasGenerated ? (
              // 编辑模式
              <motion.div
                key="editor"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="relative w-full h-full flex items-center justify-center overflow-hidden p-2"
              >
                {activeImageSrc ? (
                  <div className="relative inline-flex items-center justify-center max-w-full max-h-full">
                    <img
                      src={activeImageSrc}
                      alt="Sticker Source"
                      className="max-w-full max-h-[420px] object-contain rounded shadow-sm pointer-events-none"
                      crossOrigin="anonymous"
                    />

                    {/* 抠图进度浮层 */}
                    {(isWorking || bgProgress) && (
                      <div className="absolute inset-0 z-10 rounded bg-black/45 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 text-paper">
                        <Loader2 size={22} className="animate-spin" />
                        {bgProgress?.phase === 'loading' ? (
                          <>
                            <span className="text-xs">正在加载抠图模型…</span>
                            {typeof bgProgress.progress === 'number' && bgProgress.progress < 100 && (
                              <div className="w-32 h-1 rounded-full bg-white/25 overflow-hidden">
                                <div
                                  className="h-full bg-accent transition-all duration-200"
                                  style={{ width: `${Math.round(bgProgress.progress)}%` }}
                                />
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-xs">正在移除背景…</span>
                        )}
                      </div>
                    )}

                    {/* 中央生成快捷悬浮按钮 */}
                    {!isWorking && !bgProgress && (
                      <button
                        type="button"
                        onClick={handleGenerate}
                        disabled={!activeImageSrc || busy}
                        className="absolute bottom-3 right-3 z-20 px-2.5 py-1 rounded-full bg-paper/90 backdrop-blur text-ink font-medium text-xs shadow-md hover:bg-white hover:scale-105 active:scale-95 transition flex items-center gap-1.5"
                      >
                        <Wand2 size={13} className="text-accent" />
                        <span>生成贴纸</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-ink-faint gap-2 p-6 text-center">
                    <Upload size={32} strokeWidth={1.2} />
                    <p className="text-xs">请连线上级图片或点击上方按钮上传本地图片</p>
                  </div>
                )}
              </motion.div>
            ) : (
              // 生成完成展示模式
              <motion.div
                key="preview"
                initial={{ scale: 0.88, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.88, opacity: 0 }}
                transition={{ type: 'spring', damping: 22, stiffness: 240 }}
                className="relative w-full h-full flex items-center justify-center p-3"
              >
                {data.imageUrl ? (
                  <div className="relative group max-w-full max-h-full flex items-center justify-center">
                    <img
                      src={data.imageUrl}
                      alt="Sticker Output"
                      className="max-w-full max-h-[440px] object-contain drop-shadow-md select-none pointer-events-none sticker-checker-bg"
                    />

                    {/* 快捷悬浮重新编辑按钮 */}
                    {!hasDownstream && (
                      <button
                        type="button"
                        onClick={() => setIsEditing(true)}
                        className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-paper/90 backdrop-blur text-ink text-xs shadow-md border border-paper-grid/40 hover:bg-white hover:text-accent transition flex items-center gap-1.5 opacity-0 group-hover:opacity-100 duration-150"
                      >
                        <Pencil size={12} />
                        <span>重新编辑</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-ink-faint">暂无贴纸生成结果</div>
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

export const StickerMakerNode = memo(StickerMakerNodeInner);
StickerMakerNode.displayName = 'StickerMakerNode';
export default StickerMakerNode;
