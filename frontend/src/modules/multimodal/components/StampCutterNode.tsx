import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Scissors,
  Heart,
  Globe,
  Upload,
  Trash2,
  Sparkles,
  Loader2,
  Pencil,
  Check,
} from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  type StampAspectRatio,
  type StampCropBox,
  type StampCutterState,
  renderStampFromImage,
  loadImage,
  downloadStampImage,
} from '../stamp';

export interface StampCutterNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 节点持久化数据 */
  data?: Partial<StampCutterState> & {
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
  mismatchBadge?: string | null;
  /** 状态更新写入 node.data */
  onUpdateState?: (id: string, patch: Partial<StampCutterState>) => void;
  /** 导出邮票：PNG Data URL 落盘保存 + 写入历史数据库 */
  onExport?: (id: string, dataUrl: string, state: StampCutterState) => Promise<void>;
}

/** 默认 3:4 比例的初始选框 */
const DEFAULT_CROP_BOX: StampCropBox = {
  x: 0.2,
  y: 0.15,
  width: 0.6,
  height: 0.7,
};

const StampCutterNodeInner: React.FC<StampCutterNodeProps> = ({
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

  // 1. 输入图片四级优先级：本地上传 > 直连图片/穿透封面/根节点封面兜底
  const activeImageSrc = useMemo(() => {
    return data?.uploadedImage || upstreamImageUrl || null;
  }, [data?.uploadedImage, upstreamImageUrl]);

  const [withMargin, setWithMargin] = useState<boolean>(
    data.withMargin !== undefined ? data.withMargin : true
  );
  const [aspectRatio, setAspectRatio] = useState<StampAspectRatio>(
    data.aspectRatio || '3:4'
  );
  const [cropBox, setCropBox] = useState<StampCropBox>(
    data.cropBox || DEFAULT_CROP_BOX
  );
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isAnimatingCrop, setIsAnimatingCrop] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 拖拽与缩放状态
  const [isDraggingBox, setIsDraggingBox] = useState(false);
  const [isResizingBox, setIsResizingBox] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; box: StampCropBox } | null>(null);

  // 当外部 data.imageUrl 变更时同步编辑态
  useEffect(() => {
    if (data?.imageUrl) {
      setIsEditing(false);
    } else {
      setIsEditing(true);
    }
  }, [data?.imageUrl]);

  // 根据选定比例调整选框高度/宽度
  const applyAspectRatio = useCallback(
    (ratio: StampAspectRatio, currentBox: StampCropBox) => {
      if (ratio === 'free') return currentBox;
      let targetRatio = 3 / 4;
      if (ratio === '4:3') targetRatio = 4 / 3;
      if (ratio === '1:1') targetRatio = 1;

      // 获取当前图片实际物理比例以做精准换算
      const img = imgRef.current;
      const imgRatio = img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;

      // 归一化坐标系下的宽高比换算
      const normRatio = targetRatio / imgRatio;
      let newW = currentBox.width;
      let newH = newW / normRatio;

      if (newH > 0.9) {
        newH = 0.85;
        newW = newH * normRatio;
      }
      if (newW > 0.9) {
        newW = 0.85;
        newH = newW / normRatio;
      }

      const newX = Math.max(0, Math.min(1 - newW, currentBox.x + (currentBox.width - newW) / 2));
      const newY = Math.max(0, Math.min(1 - newH, currentBox.y + (currentBox.height - newH) / 2));

      return {
        x: newX,
        y: newY,
        width: Math.min(1, newW),
        height: Math.min(1, newH),
      };
    },
    []
  );

  // 切换长宽比
  const handleRatioChange = (ratio: StampAspectRatio) => {
    setAspectRatio(ratio);
    const adjusted = applyAspectRatio(ratio, cropBox);
    setCropBox(adjusted);
    onUpdateState?.(id, { aspectRatio: ratio, cropBox: adjusted });
  };

  // 切换白边开关
  const handleToggleMargin = () => {
    const next = !withMargin;
    setWithMargin(next);
    onUpdateState?.(id, { withMargin: next });
  };

  // 鼠标在选框内按下开始拖拽移动
  const handleBoxPointerDown = (e: React.PointerEvent) => {
    if (!isEditing || isExporting || isAnimatingCrop) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDraggingBox(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      box: { ...cropBox },
    };
  };

  // 选框右下角手柄缩放
  const handleResizePointerDown = (e: React.PointerEvent) => {
    if (!isEditing || isExporting || isAnimatingCrop) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsResizingBox(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      box: { ...cropBox },
    };
  };

  // 拖拽与缩放移动事件
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current || !imgRef.current) return;
    const imgRect = imgRef.current.getBoundingClientRect();
    if (imgRect.width <= 0 || imgRect.height <= 0) return;

    const deltaX = (e.clientX - dragStartRef.current.mouseX) / imgRect.width;
    const deltaY = (e.clientY - dragStartRef.current.mouseY) / imgRect.height;
    const origBox = dragStartRef.current.box;

    if (isDraggingBox) {
      const nextX = Math.max(0, Math.min(1 - origBox.width, origBox.x + deltaX));
      const nextY = Math.max(0, Math.min(1 - origBox.height, origBox.y + deltaY));
      setCropBox((prev) => ({ ...prev, x: nextX, y: nextY }));
    } else if (isResizingBox) {
      let nextW = Math.max(0.15, Math.min(1 - origBox.x, origBox.width + deltaX));
      let nextH = Math.max(0.15, Math.min(1 - origBox.y, origBox.height + deltaY));

      if (aspectRatio !== 'free') {
        const img = imgRef.current;
        const imgRatio = img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
        let targetRatio = 3 / 4;
        if (aspectRatio === '4:3') targetRatio = 4 / 3;
        if (aspectRatio === '1:1') targetRatio = 1;
        const normRatio = targetRatio / imgRatio;

        nextH = nextW / normRatio;
        if (origBox.y + nextH > 1) {
          nextH = 1 - origBox.y;
          nextW = nextH * normRatio;
        }
      }

      setCropBox((prev) => ({
        ...prev,
        width: Math.min(1 - origBox.x, nextW),
        height: Math.min(1 - origBox.y, nextH),
      }));
    }
  };

  // 松开鼠标，保存状态
  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDraggingBox || isResizingBox) {
      setIsDraggingBox(false);
      setIsResizingBox(false);
      dragStartRef.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // 忽略可能未 capture 的异常
      }
      onUpdateState?.(id, { cropBox });
    }
  };

  // 鼠标滚轮在图片上快速缩放选框
  const handleWheelOnImage = (e: React.WheelEvent) => {
    if (!isEditing || isExporting || isAnimatingCrop) return;
    e.stopPropagation();
    const zoomFactor = e.deltaY < 0 ? 0.05 : -0.05;
    setCropBox((prev) => {
      let newW = Math.max(0.15, Math.min(1, prev.width * (1 + zoomFactor)));
      let newH = Math.max(0.15, Math.min(1, prev.height * (1 + zoomFactor)));

      if (aspectRatio !== 'free') {
        const img = imgRef.current;
        const imgRatio = img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
        let targetRatio = 3 / 4;
        if (aspectRatio === '4:3') targetRatio = 4 / 3;
        if (aspectRatio === '1:1') targetRatio = 1;
        const normRatio = targetRatio / imgRatio;
        newH = newW / normRatio;
      }

      const newX = Math.max(0, Math.min(1 - newW, prev.x + (prev.width - newW) / 2));
      const newY = Math.max(0, Math.min(1 - newH, prev.y + (prev.height - newH) / 2));
      const next = { x: newX, y: newY, width: newW, height: newH };
      onUpdateState?.(id, { cropBox: next });
      return next;
    });
  };

  // 重置选框到居中初始状态（若在成品展示态，则清空生成图片回退到选框模式）
  const handleResetCrop = useCallback(() => {
    const initial = applyAspectRatio('3:4', DEFAULT_CROP_BOX);
    setCropBox(initial);
    setAspectRatio('3:4');
    setWithMargin(true);
    if (data?.imageUrl && !isEditing) {
      setIsEditing(true);
      onUpdateState?.(id, {
        imageUrl: null,
        cropBox: initial,
        aspectRatio: '3:4',
        withMargin: true,
      });
      showToast('已重置并返回选框模式', { type: 'success' });
    } else {
      onUpdateState?.(id, { cropBox: initial, aspectRatio: '3:4', withMargin: true });
      showToast('选框已重置为居中', { type: 'success' });
    }
  }, [applyAspectRatio, data?.imageUrl, isEditing, id, onUpdateState, showToast]);

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

  // 执行纯前端离线截取（不写数据库，毫秒级所见即所得）
  const handleExecuteCrop = useCallback(async () => {
    if (!activeImageSrc || isExporting) return;
    setIsAnimatingCrop(true);

    try {
      // 1. 加载源图
      const img = await loadImage(activeImageSrc);

      // 2. 离线 Canvas 高保真渲染
      const resultDataUrl = await renderStampFromImage(img, cropBox, {
        withMargin,
      });

      // 3. 优雅过渡延迟让动画自然展现
      await new Promise((resolve) => setTimeout(resolve, 360));

      // 4. 更新节点数据（此时为未保存到数据库状态）
      onUpdateState?.(id, {
        imageUrl: resultDataUrl,
        isSaved: false,
        withMargin,
        aspectRatio,
        cropBox,
        uploadedImage: data.uploadedImage || null,
      });

      setIsEditing(false);
      showToast('邮票截取完成（可点击保存按钮写入数据库）', { type: 'success' });
    } catch (err: any) {
      console.error('截取邮票失败:', err);
      showToast(err?.message || '生成邮票失败，请重试', { type: 'error' });
    } finally {
      setIsAnimatingCrop(false);
    }
  }, [activeImageSrc, isExporting, cropBox, withMargin, id, aspectRatio, data.uploadedImage, onUpdateState, showToast]);

  // 独立保存到数据库
  const handleSaveToDatabase = useCallback(async () => {
    const imgUrl = data?.imageUrl;
    if (!imgUrl || isExporting || !onExport) return;
    setIsExporting(true);

    try {
      await onExport(id, imgUrl, {
        withMargin,
        aspectRatio,
        cropBox,
        uploadedImage: data.uploadedImage || null,
        isSaved: true,
      });
      onUpdateState?.(id, { isSaved: true });
      onSelect?.(id);
      showToast('邮票已保存到数据库，已解锁公开与收藏', { type: 'success' });
    } catch (err: any) {
      console.error('保存到数据库失败:', err);
      showToast(err?.detail || err?.message || '保存失败，请重试', { type: 'error' });
    } finally {
      setIsExporting(false);
    }
  }, [data?.imageUrl, isExporting, onExport, id, withMargin, aspectRatio, cropBox, data?.uploadedImage, onUpdateState, onSelect, showToast]);

  // 本地直接下载 PNG（随时可用，不影响下载）
  const handleDownload = useCallback(() => {
    const url = data?.imageUrl;
    if (!url) return;
    downloadStampImage(url, `stamp-${Date.now()}.png`);
    showToast('邮票图片已下载', { type: 'success' });
  }, [data?.imageUrl, showToast]);

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
      title={title || '邮票截图框'}
      dotColor={NODE_COLORS.stamp_cutter || 'oklch(0.68 0.16 25)'}
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
                tooltip="重新调整选框"
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
                icon={<Check size={16} strokeWidth={isSaved ? 2.5 : 1.5} className={isSaved ? 'text-accent' : ''} />}
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
              {/* 下载按钮（随时可用，不影响下载） */}
              <NodeActionBar.Download
                onClick={handleDownload}
                disabled={isExporting}
                tooltip="直接下载邮票 PNG"
              />
              <NodeActionBar.Reset
                onClick={handleResetCrop}
                disabled={isExporting}
                tooltip="重置为初始选框态"
              />
            </>
          ) : (
            <>
              <NodeActionBar.Custom
                icon={
                  isExporting || isAnimatingCrop ? (
                    <Loader2 size={16} className="animate-spin text-accent" />
                  ) : (
                    <Scissors size={16} strokeWidth={1.5} />
                  )
                }
                tooltip="截取并生成邮票"
                onClick={handleExecuteCrop}
                disabled={!activeImageSrc || isExporting || isAnimatingCrop}
              />
              <NodeActionBar.Custom
                icon={<Upload size={16} strokeWidth={1.5} />}
                tooltip="上传/替换本地图片"
                onClick={() => fileInputRef.current?.click()}
                disabled={isExporting || isAnimatingCrop}
              />
              {data?.uploadedImage && (
                <NodeActionBar.Custom
                  icon={<Trash2 size={16} strokeWidth={1.5} className="text-error/80 hover:text-error" />}
                  tooltip="恢复上级继承图片（清空本地上传）"
                  onClick={handleClearUpload}
                  disabled={isExporting || isAnimatingCrop}
                />
              )}
              <NodeActionBar.Reset
                onClick={handleResetCrop}
                disabled={isExporting || isAnimatingCrop}
                tooltip="重置选框位置"
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
        {/* 顶部工具栏（仅在选框模式下展示核心比例与纸边选项） */}
        {isEditing && (
          <div className="flex items-center justify-between gap-1 px-1.5 py-1 rounded bg-paper-grid/20 border border-paper-grid/40 text-xs font-sans text-ink-light select-none">
            <div className="flex items-center gap-1">
              <span className="text-ink-faint text-[11px] px-0.5">比例:</span>
              {(['3:4', '4:3', '1:1', 'free'] as StampAspectRatio[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => handleRatioChange(r)}
                  className={`px-1.5 py-0.5 rounded transition ${
                    aspectRatio === r
                      ? 'bg-accent/15 text-accent font-medium'
                      : 'hover:bg-paper-grid/40 text-ink-light'
                  }`}
                >
                  {r === 'free' ? '自由' : r}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleToggleMargin}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition ${
                  withMargin
                    ? 'bg-accent/15 text-accent font-medium'
                    : 'hover:bg-paper-grid/40 text-ink-light'
                }`}
                title={withMargin ? '开启白边' : '关闭白边'}
              >
                <Sparkles size={12} />
                <span>纸边</span>
              </button>
            </div>
          </div>
        )}

        {/* 核心操作与预览画布 */}
        <div
          ref={containerRef}
          className="relative flex-1 min-h-0 w-full overflow-hidden rounded bg-paper-grid/10 border border-paper-grid/40 flex items-center justify-center select-none"
          onWheel={handleWheelOnImage}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <AnimatePresence mode="wait">
            {!hasGenerated ? (
              // 选框编辑模式
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
                    {/* 底图 */}
                    <img
                      ref={imgRef}
                      src={activeImageSrc}
                      alt="Crop Source"
                      className="max-w-full max-h-[420px] object-contain rounded shadow-sm pointer-events-none"
                      crossOrigin="anonymous"
                    />

                    {/* 全局暗色蒙层 */}
                    <div className="absolute inset-0 bg-black/45 pointer-events-none rounded transition-opacity duration-300" />

                    {/* 镂空高亮/打孔锯齿邮票选框 */}
                    <motion.div
                      style={{
                        position: 'absolute',
                        left: `${cropBox.x * 100}%`,
                        top: `${cropBox.y * 100}%`,
                        width: `${cropBox.width * 100}%`,
                        height: `${cropBox.height * 100}%`,
                      }}
                      animate={
                        isAnimatingCrop
                          ? {
                              scale: 1.15,
                              boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
                            }
                          : { scale: 1 }
                      }
                      transition={{ type: 'spring', damping: 20, stiffness: 220 }}
                      onPointerDown={handleBoxPointerDown}
                      className={`group cursor-move z-10 box-border flex items-center justify-center ${
                        isDraggingBox ? 'cursor-grabbing' : ''
                      }`}
                    >
                      {/* 选框内的清晰高亮原图镜像 */}
                      <div className="absolute inset-0 overflow-hidden rounded-[2px] shadow-lg pointer-events-none">
                        <div
                          className="absolute"
                          style={{
                            left: `-${(cropBox.x / cropBox.width) * 100}%`,
                            top: `-${(cropBox.y / cropBox.height) * 100}%`,
                            width: `${(1 / cropBox.width) * 100}%`,
                            height: `${(1 / cropBox.height) * 100}%`,
                          }}
                        >
                          <img
                            src={activeImageSrc}
                            alt=""
                            className="w-full h-full object-contain pointer-events-none"
                            crossOrigin="anonymous"
                          />
                        </div>
                      </div>

                      {/* 白色纸边框 (withMargin) */}
                      {withMargin && (
                        <div className="absolute inset-0 border-[6px] border-white/95 pointer-events-none shadow-sm" />
                      )}

                      {/* 锯齿打孔描边装饰 */}
                      <div className="absolute inset-0 border-2 border-dashed border-white/80 pointer-events-none" />

                      {/* 中央截取快捷悬浮按钮 */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExecuteCrop();
                        }}
                        disabled={isExporting || isAnimatingCrop}
                        className="relative z-20 px-2.5 py-1 rounded-full bg-paper/90 backdrop-blur text-ink font-medium text-xs shadow-md hover:bg-white hover:scale-105 active:scale-95 transition flex items-center gap-1.5 opacity-0 group-hover:opacity-100 duration-150"
                      >
                        <Scissors size={13} className="text-accent" />
                        <span>点击截取</span>
                      </button>

                      {/* 缩放手柄（右下角） */}
                      <div
                        onPointerDown={handleResizePointerDown}
                        className="absolute -right-1.5 -bottom-1.5 w-4 h-4 bg-accent rounded-full border-2 border-white cursor-se-resize shadow-md flex items-center justify-center hover:scale-125 transition"
                        title="拖拽缩放选框"
                      >
                        <div className="w-1.5 h-1.5 bg-white rounded-full" />
                      </div>
                    </motion.div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-ink-faint gap-2 p-6 text-center">
                    <Upload size={32} strokeWidth={1.2} />
                    <p className="text-xs">请连线上级图片或点击上方按钮上传本地图片</p>
                  </div>
                )}
              </motion.div>
            ) : (
              // 截取完成展示模式
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
                      alt="Stamp Output"
                      className="max-w-full max-h-[440px] object-contain drop-shadow-md select-none pointer-events-none"
                    />

                    {/* 快捷悬浮重新编辑按钮 */}
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-paper/90 backdrop-blur text-ink text-xs shadow-md border border-paper-grid/40 hover:bg-white hover:text-accent transition flex items-center gap-1.5 opacity-0 group-hover:opacity-100 duration-150"
                    >
                      <Pencil size={12} />
                      <span>重新裁剪</span>
                    </button>
                  </div>
                ) : (
                  <div className="text-xs text-ink-faint">暂无邮票生成结果</div>
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

export const StampCutterNode = memo(StampCutterNodeInner);
StampCutterNode.displayName = 'StampCutterNode';
export default StampCutterNode;
