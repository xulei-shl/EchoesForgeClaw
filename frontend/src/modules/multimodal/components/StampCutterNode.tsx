import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  Scissors,
  Heart,
  Globe,
  Upload,
  Trash2,
  Loader2,
  Check,
  Type,
} from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  type StampAspectRatio,
  type StampCropBox,
  type StampGrid,
  type StampTextItem,
  type StampCutterState,
  type StampStudioSettings,
  defaultStudioSettings,
  StampTextToolbar,
  StampCutterToolbar,
  StampCropEditor,
  StampTextEditModal,
  StampResultPreview,
  StampStudioPanel,
  renderStampFromImage,
  loadImage,
  downloadStampImage,
} from '../stamp';
import { usePreloadJournalFonts } from '../journal/text/FontControls';

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

  // 预加载全部手账与邮票共用字体
  usePreloadJournalFonts();

  // 1. 输入图片优先级：本地上传 > 上游输入图片
  const activeImageSrc = useMemo(() => {
    return data?.uploadedImage || upstreamImageUrl || null;
  }, [data?.uploadedImage, upstreamImageUrl]);

  // 2. 核心状态管理
  const [withMargin, setWithMargin] = useState<boolean>(
    data.withMargin !== undefined ? data.withMargin : true
  );
  const [aspectRatio, setAspectRatio] = useState<StampAspectRatio>(
    data.aspectRatio || '3:4'
  );
  const [grid, setGrid] = useState<StampGrid>(
    data.grid || { rows: 1, cols: 1 }
  );
  const [cropBox, setCropBox] = useState<StampCropBox>(
    data.cropBox || DEFAULT_CROP_BOX
  );
  const [textItems, setTextItems] = useState<StampTextItem[]>(
    data.textItems || []
  );

  // 3. Stamp Studio 工坊状态
  const [studioSettings, setStudioSettings] = useState<StampStudioSettings>(
    data.studioSettings || defaultStudioSettings
  );
  const [templateId, setTemplateId] = useState<string | null>(
    data.templateId || null
  );
  const [isStudioOpen, setIsStudioOpen] = useState<boolean>(false);

  // 4. 文字编辑交互状态
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [isAddingNewText, setIsAddingNewText] = useState<boolean>(false);
  const [pendingTextPreset, setPendingTextPreset] = useState<{
    writingMode?: 'horizontal' | 'vertical';
    w?: number;
  } | null>(null);

  // 5. 流程状态
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isAnimatingCrop, setIsAnimatingCrop] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 同步外部状态
  useEffect(() => {
    if (data?.imageUrl) {
      setIsEditing(false);
    } else {
      setIsEditing(true);
    }
  }, [data?.imageUrl]);

  useEffect(() => {
    if (data?.textItems !== undefined) {
      setTextItems(data.textItems);
    }
  }, [data?.textItems]);

  useEffect(() => {
    if (data?.studioSettings !== undefined) {
      setStudioSettings(data.studioSettings);
    }
  }, [data?.studioSettings]);

  // 根据选定比例和多联网格调整选框
  const applyAspectRatio = useCallback(
    (ratio: StampAspectRatio, currentBox: StampCropBox, currentGrid: StampGrid = grid) => {
      if (ratio === 'free') return currentBox;
      let singleRatio = 3 / 4;
      if (ratio === '4:3') singleRatio = 4 / 3;
      if (ratio === '1:1') singleRatio = 1;

      const targetRatio = (singleRatio * currentGrid.cols) / currentGrid.rows;
      let newW = currentBox.width;
      let newH = newW / targetRatio;

      if (newH > 0.9) {
        newH = 0.85;
        newW = newH * targetRatio;
      }
      if (newW > 0.9) {
        newW = 0.85;
        newH = newW / targetRatio;
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
    [grid]
  );

  // 切换长宽比
  const handleRatioChange = (ratio: StampAspectRatio) => {
    setAspectRatio(ratio);
    const adjusted = applyAspectRatio(ratio, cropBox, grid);
    setCropBox(adjusted);
    onUpdateState?.(id, { aspectRatio: ratio, cropBox: adjusted, grid, textItems, studioSettings, templateId });
  };

  // 切换多联版式
  const handleGridChange = (newGrid: StampGrid) => {
    setGrid(newGrid);
    const adjusted = applyAspectRatio(aspectRatio, cropBox, newGrid);
    setCropBox(adjusted);
    onUpdateState?.(id, { grid: newGrid, cropBox: adjusted, textItems, studioSettings, templateId });
  };

  // 切换白边开关
  const handleToggleMargin = () => {
    const next = !withMargin;
    setWithMargin(next);
    onUpdateState?.(id, { withMargin: next, textItems, studioSettings, templateId });
  };

  // 更新工坊设置
  const handleUpdateStudio = useCallback(
    (patch: Partial<StampStudioSettings>, newTemplateId?: string | null) => {
      setStudioSettings((prev) => {
        const next = { ...prev, ...patch };
        const tid = newTemplateId !== undefined ? newTemplateId : templateId;
        if (newTemplateId !== undefined) {
          setTemplateId(newTemplateId);
        }
        onUpdateState?.(id, { studioSettings: next, templateId: tid });
        return next;
      });
      showToast('工坊参数已更新', { type: 'success' });
    },
    [id, templateId, onUpdateState, showToast]
  );

  // 文字添加与编辑
  const handleAddText = useCallback(
    (preset?: { text: string; writingMode?: 'horizontal' | 'vertical'; w?: number }) => {
      setIsAddingNewText(true);
      setEditingTextId('new');
      setEditingText(preset?.text || '');
      setPendingTextPreset(preset ? { writingMode: preset.writingMode, w: preset.w } : null);
    },
    []
  );

  const handleUpdateTextItem = useCallback(
    (itemId: string, patch: Partial<StampTextItem>) => {
      setTextItems((prev) => {
        const next = prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it));
        onUpdateState?.(id, { textItems: next });
        return next;
      });
    },
    [id, onUpdateState]
  );

  const handleDeleteTextItem = useCallback(
    (itemId: string) => {
      setTextItems((prev) => {
        const next = prev.filter((it) => it.id !== itemId);
        onUpdateState?.(id, { textItems: next });
        return next;
      });
      setSelectedTextId(null);
      showToast('已删除文字', { type: 'success' });
    },
    [id, onUpdateState, showToast]
  );

  const handleBumpTextLayer = useCallback(
    (itemId: string, mode: 'up' | 'down' | 'top' | 'bottom') => {
      const sorted = [...textItems].sort((a, b) => a.z - b.z);
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
      const next = sorted.map((it, i) => ({ ...it, z: i }));
      setTextItems(next);
      onUpdateState?.(id, { textItems: next });
    },
    [textItems, id, onUpdateState]
  );

  const handleRotateStepText = useCallback(
    (itemId: string, direction: 'cw' | 'ccw') => {
      setTextItems((prev) => {
        const next = prev.map((it) => {
          if (it.id !== itemId) return it;
          const step = direction === 'cw' ? 90 : -90;
          const raw = (it.angle || 0) + step;
          const snapped = Math.round(raw / 90) * 90;
          const normalized = ((snapped % 360) + 360) % 360;
          return { ...it, angle: normalized > 180 ? normalized - 360 : normalized };
        });
        onUpdateState?.(id, { textItems: next });
        return next;
      });
    },
    [id, onUpdateState]
  );

  const confirmTextEdit = useCallback(() => {
    if (!editingTextId) return;

    if (isAddingNewText && editingTextId === 'new') {
      const count = textItems.length;
      const maxZ = textItems.reduce((m, it) => Math.max(m, it.z), 0);

      let defaultX = 50;
      let defaultY = 50;
      let defaultW = 7;
      let defaultText = '¥6.00';
      let defaultWritingMode: 'horizontal' | 'vertical' = 'horizontal';
      let defaultColor = '#8b5e3c';

      if (count === 0) {
        defaultX = 20;
        defaultY = 16;
        defaultW = 9;
        defaultText = '¥6.00';
        defaultColor = '#8b5e3c';
      } else if (count === 1) {
        defaultX = 84;
        defaultY = 26;
        defaultW = 7;
        defaultText = '北京\nBEIJING';
        defaultWritingMode = 'vertical';
        defaultColor = '#2d2a24';
      } else if (count === 2) {
        defaultX = 18;
        defaultY = 92;
        defaultW = 4.5;
        defaultText = '2024-1';
        defaultColor = '#2d2a24';
      } else {
        defaultX = 50;
        defaultY = 92;
        defaultW = 5;
        defaultText = '中国邮政 CHINA';
        defaultColor = '#2d2a24';
      }

      const newItem: StampTextItem = {
        id: `st-text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text: editingText.trim() || defaultText,
        fontFamily: '思源宋体',
        color: defaultColor,
        writingMode: pendingTextPreset?.writingMode || defaultWritingMode,
        textAlign: 'center',
        x: defaultX,
        y: defaultY,
        w: pendingTextPreset?.w || defaultW,
        angle: 0,
        z: maxZ + 1,
      };

      const next = [...textItems, newItem];
      setTextItems(next);
      setSelectedTextId(newItem.id);
      onUpdateState?.(id, { textItems: next });
      setIsAddingNewText(false);
      setEditingTextId(null);
      setEditingText('');
      setPendingTextPreset(null);
      showToast('已添加文字素材', { type: 'success' });
      return;
    }

    setTextItems((prev) => {
      const next = prev.map((it) =>
        it.id === editingTextId ? { ...it, text: editingText.trim() || '文字' } : it
      );
      onUpdateState?.(id, { textItems: next });
      return next;
    });
    setIsAddingNewText(false);
    setEditingTextId(null);
    setEditingText('');
    setPendingTextPreset(null);
  }, [
    editingTextId,
    isAddingNewText,
    editingText,
    pendingTextPreset,
    textItems,
    id,
    onUpdateState,
    showToast,
  ]);

  // 监听键盘删除与取消
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingTextId) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (selectedTextId) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          handleDeleteTextItem(selectedTextId);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setSelectedTextId(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTextId, editingTextId, handleDeleteTextItem]);

  // 重置选框与工坊全部参数为初始极简模式
  const handleResetCrop = useCallback(() => {
    const defaultGrid = { rows: 1, cols: 1 };
    setGrid(defaultGrid);
    const initial = applyAspectRatio('3:4', DEFAULT_CROP_BOX, defaultGrid);
    setCropBox(initial);
    setAspectRatio('3:4');
    setWithMargin(true);
    setTextItems([]);
    setSelectedTextId(null);
    const minimalSettings: StampStudioSettings = { ...defaultStudioSettings, designOn: false };
    setStudioSettings(minimalSettings);
    setTemplateId(null);

    const patch: Partial<StampCutterState> = {
      cropBox: initial,
      aspectRatio: '3:4',
      withMargin: true,
      grid: defaultGrid,
      textItems: [],
      studioSettings: minimalSettings,
      templateId: null,
    };

    if (data?.imageUrl && !isEditing) {
      setIsEditing(true);
      patch.imageUrl = null;
    }
    showToast('已重置为初始极简参数', { type: 'success' });
    onUpdateState?.(id, patch);
  }, [applyAspectRatio, data?.imageUrl, isEditing, id, onUpdateState, showToast]);

  // 上传图片
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
        onUpdateState?.(id, { uploadedImage: result, imageUrl: null, textItems, studioSettings, templateId });
        setIsEditing(true);
        showToast('已加载本地图片', { type: 'success' });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // 清空上传图片恢复上级
  const handleClearUpload = () => {
    onUpdateState?.(id, { uploadedImage: null, imageUrl: null, textItems, studioSettings, templateId });
    setIsEditing(true);
    showToast('已恢复上级输入图片', { type: 'success' });
  };

  // 执行截取与全套工坊渲染
  const handleExecuteCrop = useCallback(async () => {
    if (!activeImageSrc || isExporting) return;
    setIsAnimatingCrop(true);

    try {
      const img = await loadImage(activeImageSrc);
      const resultDataUrl = await renderStampFromImage(img, cropBox, {
        withMargin,
        grid,
        textItems,
        studioSettings,
      });

      await new Promise((resolve) => setTimeout(resolve, 220));

      onUpdateState?.(id, {
        imageUrl: resultDataUrl,
        isSaved: false,
        withMargin,
        aspectRatio,
        grid,
        cropBox,
        textItems,
        studioSettings,
        templateId,
        uploadedImage: data.uploadedImage || null,
      });

      setIsEditing(false);
      // 保留 isStudioOpen 状态：用户重新调整选框与排版时无缝恢复原有工坊吸附状态
      showToast('邮票制作完成，可点击保存入库', { type: 'success' });
    } catch (err: any) {
      console.error('截取邮票失败:', err);
      showToast(err?.message || '生成邮票失败，请重试', { type: 'error' });
    } finally {
      setIsAnimatingCrop(false);
    }
  }, [
    activeImageSrc,
    isExporting,
    cropBox,
    withMargin,
    grid,
    textItems,
    studioSettings,
    templateId,
    id,
    aspectRatio,
    data.uploadedImage,
    onUpdateState,
    showToast,
  ]);

  // 保存到数据库
  const handleSaveToDatabase = useCallback(async () => {
    const imgUrl = data?.imageUrl;
    if (!imgUrl || isExporting || !onExport) return;
    setIsExporting(true);

    try {
      await onExport(id, imgUrl, {
        withMargin,
        aspectRatio,
        grid,
        cropBox,
        textItems,
        studioSettings,
        templateId,
        uploadedImage: data.uploadedImage || null,
        isSaved: true,
      });
      onUpdateState?.(id, { isSaved: true });
      onSelect?.(id);
      showToast('邮票已保存入库，已解锁公开与收藏', { type: 'success' });
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
    withMargin,
    aspectRatio,
    grid,
    cropBox,
    textItems,
    studioSettings,
    templateId,
    data?.uploadedImage,
    onUpdateState,
    onSelect,
    showToast,
  ]);

  // 下载 PNG
  const handleDownload = useCallback(() => {
    const url = data?.imageUrl;
    if (!url) return;
    downloadStampImage(url, `stamp-${Date.now()}.png`);
    showToast('邮票图片已下载', { type: 'success' });
  }, [data?.imageUrl, showToast]);

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
  const selectedTextItem = useMemo(
    () => textItems.find((it) => it.id === selectedTextId),
    [textItems, selectedTextId]
  );

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '邮票工坊'}
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
      sideDrawer={
        isEditing ? (
          <StampStudioPanel
            isOpen={isStudioOpen}
            settings={studioSettings}
            templateId={templateId}
            onUpdate={handleUpdateStudio}
            onClose={() => setIsStudioOpen(false)}
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
                tooltip="重新调整选框与排版"
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
              <NodeActionBar.Custom
                icon={<Check size={16} strokeWidth={isSaved ? 2.5 : 1.5} className={isSaved ? 'text-accent' : ''} />}
                onClick={handleSaveToDatabase}
                disabled={isExporting || isSaved}
                tooltip={isSaved ? '已保存入库' : '保存入库（保存后可公开/收藏）'}
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
                  !isSaved
                    ? '请先保存入库后再收藏'
                    : isFavorited
                      ? '取消收藏'
                      : '收藏'
                }
                onClick={() =>
                  isSaved && runToggle(onToggleFavorite, (act) => (act ? '已收藏' : '已取消收藏'))
                }
                disabled={!isSaved || isExporting || !onToggleFavorite}
              />
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
                    ? '请先保存入库后再公开'
                    : isPublic
                      ? '从画廊撤下'
                      : '公开到画廊'
                }
                onClick={() =>
                  isSaved && runToggle(onTogglePublic, (act) => (act ? '已公开' : '已撤下'))
                }
                disabled={!isSaved || isExporting || !onTogglePublic}
              />
              <NodeActionBar.Download
                onClick={handleDownload}
                disabled={isExporting}
                tooltip="直接下载邮票 PNG"
              />
              <NodeActionBar.Reset
                onClick={handleResetCrop}
                disabled={isExporting}
                tooltip="重置为初始极简参数"
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
                icon={<Type size={16} strokeWidth={1.5} />}
                tooltip="添加文字素材 (面值/地名/志号)"
                onClick={() => handleAddText()}
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
                tooltip="重置为初始极简参数"
              />
            </>
          )}
          <NodeActionBar.ExternalLink
            href="https://github.com/jal-co/stampstudio"
            tooltip="点击使用完整功能"
          />
        </NodeActionBar>
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      <div className="h-full flex flex-col flex-1 min-h-0 gap-2 relative">
        {/* 顶部工具栏 */}
        {isEditing && (
          <StampCutterToolbar
            grid={grid}
            aspectRatio={aspectRatio}
            withMargin={withMargin}
            isStudioOpen={isStudioOpen}
            hasStudioActive={Boolean(studioSettings.designOn || templateId)}
            onGridChange={handleGridChange}
            onRatioChange={handleRatioChange}
            onToggleMargin={handleToggleMargin}
            onToggleStudio={() => setIsStudioOpen((prev) => !prev)}
          />
        )}

        {/* 主视口区域：选框编辑器 vs 结果展示 */}
        <div className="relative flex-1 min-h-0 w-full overflow-hidden rounded-lg bg-paper-grid/10 border border-paper-grid/40 flex items-center justify-center select-none">
          {/* 选中文本悬浮微交互工具栏 */}
          {isEditing && selectedTextItem && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
              <StampTextToolbar
                variant="floating"
                item={selectedTextItem}
                disabled={isExporting || isAnimatingCrop}
                onUpdate={(patch) => handleUpdateTextItem(selectedTextItem.id, patch)}
                onOpenEdit={() => {
                  setIsAddingNewText(false);
                  setPendingTextPreset(null);
                  setEditingTextId(selectedTextItem.id);
                  setEditingText(selectedTextItem.text || '');
                }}
                onDelete={() => handleDeleteTextItem(selectedTextItem.id)}
                onBumpLayer={(mode) => handleBumpTextLayer(selectedTextItem.id, mode)}
                onRotateStep={(dir) => handleRotateStepText(selectedTextItem.id, dir)}
                onClose={() => setSelectedTextId(null)}
              />
            </div>
          )}

          <AnimatePresence mode="wait" initial={false}>
            {!hasGenerated ? (
              <StampCropEditor
                key="crop-editor"
                activeImageSrc={activeImageSrc}
                cropBox={cropBox}
                grid={grid}
                aspectRatio={aspectRatio}
                withMargin={withMargin}
                vignetteShape={studioSettings.designOn ? studioSettings.vignette : 'none'}
                textItems={textItems}
                selectedTextId={selectedTextId}
                isExporting={isExporting}
                isAnimatingCrop={isAnimatingCrop}
                studioSettings={studioSettings}
                onCropBoxChange={(nextBox) => {
                  setCropBox(nextBox);
                }}
                onCropBoxCommit={(committedBox) => {
                  onUpdateState?.(id, { cropBox: committedBox, textItems });
                }}
                onUpdateTextItems={(nextItems) => {
                  setTextItems(nextItems);
                  onUpdateState?.(id, { textItems: nextItems });
                }}
                onSelectText={setSelectedTextId}
                onOpenEditText={(textId) => {
                  const it = textItems.find((t) => t.id === textId);
                  setIsAddingNewText(false);
                  setPendingTextPreset(null);
                  setEditingTextId(textId);
                  setEditingText(it?.text || '');
                }}
                onExecuteCrop={handleExecuteCrop}
                onUploadClick={() => fileInputRef.current?.click()}
              />
            ) : (
              <StampResultPreview
                key="result-preview"
                imageUrl={data?.imageUrl || null}
                onEditAgain={() => setIsEditing(true)}
              />
            )}
          </AnimatePresence>

          {/* 内联文字编辑弹层 */}
          {editingTextId && (
            <StampTextEditModal
              isNew={isAddingNewText && editingTextId === 'new'}
              value={editingText}
              onChange={setEditingText}
              onConfirm={confirmTextEdit}
              onCancel={() => {
                setIsAddingNewText(false);
                setEditingTextId(null);
                setEditingText('');
                setPendingTextPreset(null);
              }}
              onSelectPreset={(pst) => {
                if (editingTextId === 'new') {
                  setPendingTextPreset({
                    ...(pst.writingMode ? { writingMode: pst.writingMode } : {}),
                    ...(pst.w ? { w: pst.w } : {}),
                  });
                } else if (selectedTextItem) {
                  handleUpdateTextItem(selectedTextItem.id, {
                    ...(pst.writingMode ? { writingMode: pst.writingMode } : {}),
                    ...(pst.w ? { w: pst.w } : {}),
                  });
                }
              }}
            />
          )}
        </div>

        {/* 状态与弱提示 */}
        {recordDeleted && hasGenerated && !isExporting && (
          <div className="flex items-center justify-end gap-1.5 text-right text-xs text-ink-faint font-sans">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/60" />
            记录已从画廊移除 · 收藏将重新入库
          </div>
        )}
      </div>
    </CanvasNode>
  );
};

export const StampCutterNode = memo(StampCutterNodeInner);
StampCutterNode.displayName = 'StampCutterNode';
export default StampCutterNode;
