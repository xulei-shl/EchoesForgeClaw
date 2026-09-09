import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  RefreshCw,
  Eye,
  Sparkles,
  Image as ImageIcon,
  Check,
  AlertCircle,
  X,
  Heart,
  Globe,
  Trash2,
} from 'lucide-react';
import { CanvasNode } from '../_shared/CanvasNode';
import { NodeActionBar } from '../_shared/NodeActionBar';
import { useFeedback } from '../../../shared/components/ui/FeedbackProvider';
import { DEFAULT_SIZES } from '../../core/graphTypes';
import { NODE_COLORS } from '../_shared/nodeTypes';
import { removeImageBackground, loadSafeImage, type MattingProgress } from './engines/matting';
import { BgColorBar } from './bgremove/BgColorBar';
import type { ImageBgRemoveNodeProps } from './bgremove/types';

export const ImageBgRemoveNode: React.FC<ImageBgRemoveNodeProps> = ({
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 状态维护
  const [uploadedImage, setUploadedImage] = useState<string | null>(data.uploadedImage || null);
  const [rawCutoutUrl, setRawCutoutUrl] = useState<string | null>(data.rawCutoutUrl || null);
  const [bgColor, setBgColor] = useState<string>(data.bgColor || '');
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(data.imageUrl || null);
  const [viewOriginal, setViewOriginal] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [progress, setProgress] = useState<MattingProgress | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);

  // 有效输入图（本地手动上传优先，其次上游连线输入）
  const activeImageSrc = uploadedImage || upstreamImageUrl || null;

  // 上游图片变更时（且未手动上传），自动重置未保存的抠图状态
  const prevUpstreamRef = useRef<string | null | undefined>(upstreamImageUrl);
  useEffect(() => {
    if (prevUpstreamRef.current !== upstreamImageUrl) {
      prevUpstreamRef.current = upstreamImageUrl;
      if (!uploadedImage && !data?.isSaved) {
        setRawCutoutUrl(null);
        setPreviewDataUrl(null);
      }
    }
  }, [upstreamImageUrl, uploadedImage, data?.isSaved]);

  // 当外部 data 变化时同步
  useEffect(() => {
    if (data.rawCutoutUrl !== undefined) setRawCutoutUrl(data.rawCutoutUrl);
    if (data.bgColor !== undefined) setBgColor(data.bgColor);
    if (data.uploadedImage !== undefined) setUploadedImage(data.uploadedImage);
  }, [data.rawCutoutUrl, data.bgColor, data.uploadedImage]);

  // 合成纯色背景与透明前景
  const compositeWithColor = useCallback(async (cutoutUrl: string, color: string): Promise<string> => {
    if (!color) return cutoutUrl;
    try {
      const img = await loadSafeImage(cutoutUrl);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return cutoutUrl;

      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    } catch {
      return cutoutUrl;
    }
  }, []);

  // 执行 AI 智能去背景
  const handleRemoveBg = useCallback(
    async (targetBgColor?: string) => {
      if (!activeImageSrc) {
        showToast('请先提供或上传待去背景图片', { type: 'warning' });
        return;
      }

      const colorToApply = targetBgColor !== undefined ? targetBgColor : bgColor;
      if (targetBgColor !== undefined) {
        setBgColor(targetBgColor);
      }

      setIsProcessing(true);
      setProgress({ phase: 'loading', progress: 0 });
      onUpdateState?.(id, { error: null });

      try {
        const result = await removeImageBackground(
          activeImageSrc,
          { maxEdge: 2048 },
          (p) => setProgress(p),
        );

        const rawCutout = result.dataUrl;
        setRawCutoutUrl(rawCutout);

        // 叠加当前选中的背景色
        const finalPreview = await compositeWithColor(rawCutout, colorToApply);
        setPreviewDataUrl(finalPreview);
        setViewOriginal(false);

        onUpdateState?.(id, {
          rawCutoutUrl: rawCutout,
          bgColor: colorToApply,
          imageUrl: finalPreview,
          isSaved: false,
          error: null,
        });

        showToast(
          colorToApply ? '去背景完成，已应用背景底色' : '去背景完成（透明背景）',
          { type: 'success' },
        );
      } catch (err: any) {
        console.error('Matting failed:', err);
        const msg = err?.message || '去背景失败，请重试';
        onUpdateState?.(id, { error: msg });
        showToast(msg, { type: 'error' });
      } finally {
        setIsProcessing(false);
        setProgress(null);
      }
    },
    [activeImageSrc, bgColor, compositeWithColor, id, onUpdateState, showToast],
  );

  // 切换背景色时响应（若尚未去背景，自动触发一键去背景）
  const handleColorChange = useCallback(
    async (newColor: string) => {
      setBgColor(newColor);
      onUpdateState?.(id, { bgColor: newColor, isSaved: false });

      if (rawCutoutUrl) {
        const composited = await compositeWithColor(rawCutoutUrl, newColor);
        setPreviewDataUrl(composited);
        onUpdateState?.(id, { imageUrl: composited });
      } else if (activeImageSrc && !isProcessing) {
        showToast('正在开始一键去背景并应用所选底色…', { type: 'info' });
        await handleRemoveBg(newColor);
      }
    },
    [
      id,
      rawCutoutUrl,
      activeImageSrc,
      isProcessing,
      compositeWithColor,
      handleRemoveBg,
      onUpdateState,
      showToast,
    ],
  );

  // 独立保存到数据库（落盘 + generations 记录）
  const handleSaveToDatabase = useCallback(async () => {
    const targetUrl = previewDataUrl || rawCutoutUrl;
    if (!targetUrl || isExporting || !onExport) return;

    setIsExporting(true);
    try {
      await onExport(id, targetUrl, {
        imageUrl: targetUrl,
        rawCutoutUrl,
        bgColor,
        uploadedImage,
        isSaved: true,
      });
      onUpdateState?.(id, { isSaved: true });
      onSelect?.(id);
      showToast('去背景图片已保存到数据库，已解锁公开与收藏', { type: 'success' });
    } catch (err: any) {
      console.error('保存去背景图片失败:', err);
      showToast(err?.detail || err?.message || '保存失败，请重试', { type: 'error' });
    } finally {
      setIsExporting(false);
    }
  }, [
    previewDataUrl,
    rawCutoutUrl,
    isExporting,
    onExport,
    id,
    bgColor,
    uploadedImage,
    onUpdateState,
    onSelect,
    showToast,
  ]);

  // 直接下载 PNG 到本地
  const handleDownload = useCallback(() => {
    const url = previewDataUrl || rawCutoutUrl;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `cutout_${Date.now()}.png`;
    a.click();
  }, [previewDataUrl, rawCutoutUrl]);

  // 重置状态
  const handleReset = useCallback(() => {
    setRawCutoutUrl(null);
    setPreviewDataUrl(null);
    setBgColor('');
    onUpdateState?.(id, {
      rawCutoutUrl: null,
      imageUrl: null,
      bgColor: '',
      isSaved: false,
      error: null,
    });
    showToast('已重置抠图结果', { type: 'success' });
  }, [id, onUpdateState, showToast]);

  // 清空本地上传
  const handleClearUpload = useCallback(() => {
    setUploadedImage(null);
    setRawCutoutUrl(null);
    setPreviewDataUrl(null);
    onUpdateState?.(id, {
      uploadedImage: null,
      rawCutoutUrl: null,
      imageUrl: null,
      isSaved: false,
    });
  }, [id, onUpdateState]);

  // 本地文件选择
  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast('请选择有效的图片文件', { type: 'error' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setUploadedImage(dataUrl);
      setRawCutoutUrl(null);
      setPreviewDataUrl(null);
      onUpdateState?.(id, {
        uploadedImage: dataUrl,
        rawCutoutUrl: null,
        imageUrl: null,
        isSaved: false,
      });
    };
    reader.readAsDataURL(file);
  }, [id, onUpdateState, showToast]);

  // 处理拖拽图片上传交互
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isProcessing) {
      setIsDraggingFile(true);
    }
  }, [isProcessing]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingFile(false);
      if (isProcessing) return;

      const file = e.dataTransfer.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect, isProcessing],
  );

  // 收藏/公开切换辅助函数
  const runToggle = async (
    fn: ((id: string) => Promise<boolean>) | undefined,
    okMsg: (active: boolean) => string,
  ) => {
    if (!fn) return;
    try {
      const active = await fn(id);
      showToast(okMsg(active), { type: 'success' });
    } catch {
      showToast('操作失败，请重试', { type: 'error' });
    }
  };

  const hasResult = Boolean(previewDataUrl || rawCutoutUrl);
  const isSaved = Boolean(data?.isSaved);
  const busy = isProcessing || isExporting;

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '抠图'}
      dotColor={NODE_COLORS.image_bg_remove || 'oklch(0.70 0.16 300)'}
      defaultSize={DEFAULT_SIZES.image_bg_remove}
      resizable
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      footer={footer}
      onContextMenu={onContextMenu}
      mismatchBadge={mismatchBadge}
      onClick={() => onSelect?.(id)}
      showLeftAnchor={true}
      showRightAnchor={true}
      className={`transition-[opacity,transform,box-shadow,border-color] duration-150 ease-out ${
        isSelected ? 'ring-2 ring-accent/70 shadow-md' : ''
      }`}
      actionBar={
        <NodeActionBar>
          {hasResult ? (
            <>
              {/* 重新去背景 */}
              <NodeActionBar.Retry
                onClick={() => handleRemoveBg()}
                disabled={busy}
                tooltip="重新抠图"
                aria-label="重新抠图"
              />
              {/* 上传/替换图片 */}
              <NodeActionBar.Custom
                icon={<Upload size={16} strokeWidth={1.5} />}
                tooltip="上传/替换本地图片"
                aria-label="上传/替换本地图片"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              />
              {/* 恢复上级继承 */}
              {uploadedImage && (
                <NodeActionBar.Custom
                  icon={<Trash2 size={16} strokeWidth={1.5} className="text-error/80 hover:text-error" />}
                  tooltip="恢复上级继承图片（清空本地上传）"
                  aria-label="恢复上级继承图片"
                  onClick={handleClearUpload}
                  disabled={busy}
                />
              )}
              {/* 保存到数据库 */}
              <NodeActionBar.Custom
                icon={
                  <Check
                    size={16}
                    strokeWidth={isSaved ? 2.5 : 1.5}
                    className={isSaved ? 'text-accent' : ''}
                  />
                }
                onClick={handleSaveToDatabase}
                disabled={busy || isSaved}
                tooltip={isSaved ? '已保存到数据库' : '保存到数据库（保存后可公开/收藏/输出下游）'}
                aria-label={isSaved ? '已保存到数据库' : '保存到数据库'}
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
                tooltip={!isSaved ? '请先保存到数据库后再收藏' : isFavorited ? '取消收藏' : '收藏'}
                aria-label={!isSaved ? '请先保存到数据库后再收藏' : isFavorited ? '取消收藏' : '收藏'}
                onClick={() =>
                  isSaved && runToggle(onToggleFavorite, (act) => (act ? '已收藏' : '已取消收藏'))
                }
                disabled={!isSaved || busy || !onToggleFavorite}
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
                tooltip={!isSaved ? '请先保存到数据库后再公开' : isPublic ? '从画廊撤下' : '公开到画廊'}
                aria-label={!isSaved ? '请先保存到数据库后再公开' : isPublic ? '从画廊撤下' : '公开到画廊'}
                onClick={() =>
                  isSaved && runToggle(onTogglePublic, (act) => (act ? '已公开' : '已撤下'))
                }
                disabled={!isSaved || busy || !onTogglePublic}
              />
              {/* 下载按钮 */}
              <NodeActionBar.Download
                onClick={handleDownload}
                disabled={busy}
                tooltip="直接下载 PNG"
                aria-label="直接下载去背景图片 PNG"
              />
              {/* 重置 */}
              <NodeActionBar.Reset
                onClick={handleReset}
                disabled={busy}
                tooltip="重置抠图结果"
                aria-label="重置抠图结果"
              />
            </>
          ) : (
            <>
              {/* 一键去背景 */}
              <NodeActionBar.Custom
                icon={
                  isProcessing ? (
                    <RefreshCw size={16} className="animate-spin text-accent" />
                  ) : (
                    <Sparkles size={16} strokeWidth={1.5} />
                  )
                }
                tooltip="一键去背景"
                aria-label="一键去背景"
                onClick={() => handleRemoveBg()}
                disabled={busy || !activeImageSrc}
              />
              {/* 上传/替换图片 */}
              <NodeActionBar.Custom
                icon={<Upload size={16} strokeWidth={1.5} />}
                tooltip="上传/替换本地图片"
                aria-label="上传/替换本地图片"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              />
              {/* 恢复上级继承 */}
              {uploadedImage && (
                <NodeActionBar.Custom
                  icon={<Trash2 size={16} strokeWidth={1.5} className="text-error/80 hover:text-error" />}
                  tooltip="恢复上级继承图片（清空本地上传）"
                  aria-label="恢复上级继承图片"
                  onClick={handleClearUpload}
                  disabled={busy}
                />
              )}
              {/* 重置 */}
              <NodeActionBar.Reset
                onClick={handleReset}
                disabled={busy}
                tooltip="重置状态"
                aria-label="重置状态"
              />
            </>
          )}
        </NodeActionBar>
      }
    >
      <div className="flex-1 flex flex-col min-h-0 gap-2.5">
        {/* 顶部工具栏：输入图源状态与视图切换 */}
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-ink-light">
            <ImageIcon size={13} className="text-accent" />
            <span className="truncate max-w-[140px]" title={uploadedImage ? '本地上传图片' : upstreamImageUrl ? '连线上游图片' : '未指定图片源'}>
              {uploadedImage ? '本地上传图片' : upstreamImageUrl ? '连线上游图片' : '未指定图片源'}
            </span>
            {uploadedImage && (
              <button
                type="button"
                onClick={handleClearUpload}
                className="relative -m-1.5 p-1.5 text-ink-lighter hover:text-error rounded-sm ml-0.5 active:scale-[0.96] transition-[transform,color] duration-100 ease-out cursor-pointer flex items-center justify-center"
                title="清除本地替换图，恢复上级输入"
                aria-label="清除本地替换图，恢复上级输入"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1">
            {hasResult && activeImageSrc && (
              <button
                type="button"
                onClick={() => setViewOriginal(!viewOriginal)}
                className={`px-2 py-0.5 text-xs rounded-md transition-[transform,border-color,background-color,color] duration-100 ease-out active:scale-[0.96] flex items-center gap-1 border cursor-pointer ${
                  viewOriginal
                    ? 'bg-accent/15 text-accent border-accent/40 font-medium'
                    : 'bg-paper text-ink-light border-paper-grid hover:border-accent/60'
                }`}
              >
                <Eye size={12} />
                <span>{viewOriginal ? '看效果' : '看原图'}</span>
              </button>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        {/* 中间预览主视口 */}
        <div className="relative flex-1 min-h-0 rounded-xl border border-paper-grid/80 overflow-hidden bg-paper-light flex items-center justify-center">
          {activeImageSrc ? (
            <div
              className="relative w-full h-full flex items-center justify-center p-2 transition-colors duration-150"
              style={{
                backgroundColor: hasResult && !viewOriginal && bgColor ? bgColor : undefined,
              }}
            >
              {/* 透明棋盘格底纹（仅在看去背景图且背景透明时展示，复用设计系统 sticker-checker-bg） */}
              {!viewOriginal && !bgColor && hasResult && (
                <div className="absolute inset-0 sticker-checker-bg pointer-events-none opacity-60" />
              )}

              {/* 图像渲染（移除 transition-all 防止主线程重排卡顿，补充微妙 1px Image Outlines） */}
              <img
                src={viewOriginal || !hasResult ? activeImageSrc : previewDataUrl || rawCutoutUrl!}
                alt="去背景效果预览"
                className="max-w-full max-h-full object-contain select-none ring-1 ring-black/5 dark:ring-white/10 rounded-xs drop-shadow-xs"
              />

              {/* 待去背景状态：原图标记与中心快捷触发按钮 */}
              {!hasResult && !isProcessing && (
                <div className="absolute inset-0 bg-ink/5 hover:bg-ink/10 transition-colors flex flex-col items-center justify-center pointer-events-none p-4">
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-paper/90 border border-paper-grid text-ink-light text-[11px] font-medium backdrop-blur-xs">
                    原图（待去背景）
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemoveBg()}
                    className="pointer-events-auto px-4 py-2 rounded-xl bg-accent text-paper font-medium text-xs shadow-md hover:bg-accent-light active:scale-[0.96] transition-[transform,background-color,box-shadow] duration-100 ease-out flex items-center gap-1.5 cursor-pointer z-10"
                  >
                    <Sparkles size={14} />
                    <span>一键智能去背景</span>
                  </button>
                </div>
              )}

              {/* 原图标记徽章（仅在已有抠图结果但切换看原图时展示） */}
              {viewOriginal && hasResult && (
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-ink/75 text-paper text-[11px] font-medium backdrop-blur-xs">
                  原图视图
                </div>
              )}
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              aria-label="上传待去背景图片"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`w-full h-full flex flex-col items-center justify-center p-6 text-center cursor-pointer transition-[background-color,border-color,transform] duration-150 gap-2 text-ink-light outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                isDraggingFile
                  ? 'bg-accent/10 scale-[0.99] border-2 border-dashed border-accent'
                  : 'hover:bg-paper/40 border border-transparent'
              }`}
            >
              <div className="w-12 h-12 rounded-full bg-paper flex items-center justify-center border border-paper-grid text-ink-lighter transition-transform duration-150 hover:scale-105">
                <Upload size={20} />
              </div>
              <p className="text-xs font-serif font-medium">点击或拖拽图片至此处</p>
              <p className="text-[11px] text-ink-lighter">支持常见图像格式，或在画布中连入上游图片节点</p>
            </div>
          )}

          {/* 加载/推理中遮罩层：基于 AnimatePresence 实现平滑淡入淡出 */}
          <AnimatePresence>
            {isProcessing && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="absolute inset-0 bg-paper/85 backdrop-blur-xs flex flex-col items-center justify-center p-4 gap-2.5 z-20"
              >
                <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                <div className="text-center">
                  <p className="text-xs font-medium text-ink">
                    {progress?.phase === 'loading' ? (
                      <>
                        正在初始化离线模型 (
                        <span className="tabular-nums font-mono">
                          {Math.round(progress.progress ?? 0)}%
                        </span>
                        )
                      </>
                    ) : (
                      '正在利用本地硬件去背景中...'
                    )}
                  </p>
                  <p className="text-[11px] text-ink-lighter mt-0.5">
                    计算纯本地进行，无需服务器 GPU
                  </p>
                </div>
                {progress?.phase === 'loading' && typeof progress.progress === 'number' && (
                  <div className="w-40 h-1.5 bg-paper-grid rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent transition-[width] duration-150 ease-out"
                      style={{ width: `${Math.min(100, Math.max(0, progress.progress))}%` }}
                    />
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 背景色彩配置条 */}
        <BgColorBar
          currentColor={bgColor}
          onChangeColor={handleColorChange}
          disabled={isProcessing || !activeImageSrc}
          hasResult={hasResult}
        />

        {/* 提示信息：使用 AnimatePresence 实现高度与透明度平滑折叠，消除 Layout Shift */}
        <AnimatePresence>
          {recordDeleted && hasResult && !isExporting && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-amber-50 text-amber-800 text-xs border border-amber-200">
                <AlertCircle size={13} className="shrink-0 text-amber-600" />
                <span>该记录已从数据库中删除，可重新点击「保存」再次归档</span>
              </div>
            </motion.div>
          )}

          {data.error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-red-50 text-red-700 text-xs border border-red-200">
                <AlertCircle size={13} className="shrink-0 text-red-500" />
                <span className="truncate">{data.error}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </CanvasNode>
  );
};
