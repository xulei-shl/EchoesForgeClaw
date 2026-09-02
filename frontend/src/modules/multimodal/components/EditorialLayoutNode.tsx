import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import {
  Upload,
  Loader2,
  Heart,
  Globe,
  Wand2,
  Check,
  Type,
} from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  type EditorialArticleData,
  type EditorialFreeTextItem,
  type EditorialImageItem,
  type EditorialPageRatio,
  type EditorialState,
  type EditorialTypographySettings,
  type FreeTextBlockWrapResult,
  EDITORIAL_PAGE_RATIOS,
} from '../editorial/types';
import {
  getEditorialTemplate,
  DEFAULT_EDITORIAL_TEMPLATE,
  getFreeLayoutSkeleton,
  DEFAULT_FREE_LAYOUT_SKELETON,
} from '../editorial/templates';
import {
  computeEditorialLayout,
  layoutFreeTextBlock,
} from '../editorial/engine/layoutEngine';
import { usePreloadJournalFonts, snapRotateCw, snapRotateCcw } from '../journal';

// 拆分出的 Hooks
import { useEditorialSync } from '../editorial/hooks/useEditorialSync';
import { useEditorialGestures } from '../editorial/hooks/useEditorialGestures';
import { useEditorialActions } from '../editorial/hooks/useEditorialActions';

// 拆分出的排版图层与抽屉组件
import { EditorialToolbar } from '../editorial/components/EditorialToolbar';
import { EditorialImageLayer } from '../editorial/components/EditorialImageLayer';
import { EditorialFreeTextLayer } from '../editorial/components/EditorialFreeTextLayer';
import { EditorialFreeTextToolbar } from '../editorial/components/EditorialFreeTextToolbar';
import { EditorialFixedLayoutLayer } from '../editorial/components/EditorialFixedLayoutLayer';
import { EditorialArticleDrawer } from '../editorial/components/EditorialArticleDrawer';
import { EditorialStyleDrawer } from '../editorial/components/EditorialStyleDrawer';
import { EditorialTextModal } from '../editorial/components/EditorialTextModal';

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
  /** 其他文本节点输入（不含图书元数据）：默认追加到正文文本底部 */
  upstreamTexts?: string[];
  /** 上游图书元数据（book_info 节点，兼容豆瓣 API 结构）——参照图书小票节点 */
  upstreamBookData?: import('../receipt/types').BookMetadataInput | null;
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

const defaultPreset = DEFAULT_EDITORIAL_TEMPLATE;

const EditorialLayoutNodeInner: React.FC<EditorialLayoutNodeProps> = ({
  id,
  initialX = 100,
  initialY = 100,
  title,
  data = {},
  upstreamImages,
  upstreamTexts,
  upstreamBookData,
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

  // 1. 预设与版面配置状态
  const [presetId, setPresetId] = useState<string>(data.presetId || defaultPreset.id);
  const activeTemplate = useMemo(() => getEditorialTemplate(presetId), [presetId]);
  const layoutType = activeTemplate.features?.layoutType || 'newspaper';
  const isFreeLayout = layoutType === 'free';

  const [pageSize, setPageSize] = useState<EditorialPageRatio>(
    data.pageSize || activeTemplate.defaultRatio
  );
  const currentRatioId = isFreeLayout ? pageSize : (activeTemplate.defaultRatio || '3:4');
  const ratioPreset = useMemo(
    () => EDITORIAL_PAGE_RATIOS.find((r) => r.id === currentRatioId) || EDITORIAL_PAGE_RATIOS[0]!,
    [currentRatioId]
  );

  const [article, setArticle] = useState<EditorialArticleData>(
    data.article || activeTemplate.defaultArticle
  );
  const [typography, setTypography] = useState<EditorialTypographySettings>(
    data.typography || activeTemplate.defaultTypography
  );
  const [background, setBackground] = useState(
    data.background || activeTemplate.defaultBackground
  );

  const [items, setItems] = useState<EditorialImageItem[]>(data.images || []);
  const [freeTexts, setFreeTexts] = useState<EditorialFreeTextItem[]>(data.freeTexts || []);
  const [freeSkeletonId, setFreeSkeletonId] = useState<string>(
    data.freeSkeleton || DEFAULT_FREE_LAYOUT_SKELETON
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const [isAddingNewText, setIsAddingNewText] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'preview' | 'article' | 'style'>('preview');
  const [isEditing, setIsEditing] = useState<boolean>(!data?.imageUrl);

  // 2. 外部数据撤销/重做同步
  useEffect(() => {
    if (data.freeTexts !== undefined) {
      setFreeTexts(data.freeTexts);
      setSelectedTextId((cur) => {
        if (!cur) return null;
        return data.freeTexts?.some((ft) => ft.id === cur) ? cur : null;
      });
    }
  }, [data.freeTexts]);

  useEffect(() => {
    if (data.images !== undefined) {
      setItems(data.images);
      setSelectedItemId((cur) => {
        if (!cur) return null;
        return data.images?.some((it) => it.id === cur) ? cur : null;
      });
    }
  }, [data.images]);

  useEffect(() => {
    if (data.article !== undefined) setArticle(data.article);
  }, [data.article]);

  useEffect(() => {
    if (data.presetId !== undefined) setPresetId(data.presetId);
  }, [data.presetId]);

  useEffect(() => {
    if (data.pageSize !== undefined) setPageSize(data.pageSize);
  }, [data.pageSize]);

  useEffect(() => {
    if (data.typography !== undefined) setTypography(data.typography);
  }, [data.typography]);

  useEffect(() => {
    if (data.background !== undefined) setBackground(data.background);
  }, [data.background]);

  useEffect(() => {
    if (data.freeSkeleton !== undefined) setFreeSkeletonId(data.freeSkeleton);
  }, [data.freeSkeleton]);

  useEffect(() => {
    setIsEditing(!data?.imageUrl);
  }, [data?.imageUrl]);

  // 3. DOM 引用与舞台尺寸监听
  const stageWrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const toolbarTabsRef = useRef<HTMLDivElement>(null);
  const seededFreeTextForRef = useRef<string | null>(null);

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

  const scale = useMemo(() => {
    if (!ratioPreset.width || !stageSize.width || !stageSize.height) return 0.4;
    const scaleX = stageSize.width / ratioPreset.width;
    const scaleY = stageSize.height / ratioPreset.height;
    return Math.min(scaleX, scaleY);
  }, [ratioPreset.width, ratioPreset.height, stageSize.width, stageSize.height]);

  const isSaved = Boolean(data?.isSaved);
  const hasGenerated = Boolean(data?.imageUrl) && !isEditing;

  // 4. Hook 编排：上游同步
  const { dismissedSourcesRef } = useEditorialSync({
    id,
    presetId,
    data,
    defaultArticle: activeTemplate.defaultArticle,
    upstreamBookData,
    upstreamTexts,
    upstreamImages,
    items,
    setArticle,
    setItems,
    onUpdateState,
  });

  // 5. 排版状态与投影计算
  const currentState: EditorialState = useMemo(
    () => ({
      presetId,
      pageSize: currentRatioId,
      article,
      images: items,
      freeTexts,
      freeSkeleton: freeSkeletonId,
      typography,
      background,
      dismissedSources: Array.from(dismissedSourcesRef.current),
      imageUrl: data.imageUrl,
      isSaved: data.isSaved,
    }),
    [
      presetId,
      currentRatioId,
      article,
      items,
      freeTexts,
      freeSkeletonId,
      typography,
      background,
      dismissedSourcesRef,
      data.imageUrl,
      data.isSaved,
    ]
  );

  const layoutProjection = useMemo(() => {
    return computeEditorialLayout(currentState, ratioPreset, activeTemplate);
  }, [currentState, ratioPreset, activeTemplate]);

  // 6. Hook 编排：手势交互
  const { beginGesture, moveGesture, endGesture } = useEditorialGestures({
    id,
    ratioPreset,
    scale,
    items,
    freeTexts,
    stageWrapperRef,
    setItems,
    setFreeTexts,
    setSelectedItemId,
    setSelectedTextId,
    onUpdateState,
  });

  // 7. Hook 编排：业务操作
  const {
    isGenerating,
    isSaving,
    handleSelectPreset,
    handleUploadImages,
    handleDeleteItem,
    rotateStepItem,
    bumpLayer,
    handleGenerate,
    handleSaveToDatabase,
    handleDownload,
    handleReset,
    applyFreeSkeleton,
    runToggle,
  } = useEditorialActions({
    id,
    currentState,
    ratioPreset,
    activeTemplate,
    items,
    article,
    typography,
    presetId,
    data,
    fileInputRef,
    dismissedSourcesRef,
    seededFreeTextForRef,
    showToast,
    setPresetId,
    setPageSize,
    setArticle,
    setTypography,
    setBackground,
    setItems,
    setFreeTexts,
    setFreeSkeletonId,
    setSelectedItemId,
    setSelectedTextId,
    setEditingTextId,
    setIsEditing,
    onUpdateState,
    onExport,
    onSelect,
  });

  // 8. 自由排版文本块专用逻辑
  useEffect(() => {
    if (!isFreeLayout) return;
    if (freeTexts.length > 0) {
      seededFreeTextForRef.current = presetId;
      return;
    }
    const skeletonId = freeSkeletonId || DEFAULT_FREE_LAYOUT_SKELETON;
    const blocks = getFreeLayoutSkeleton(skeletonId).build(article, typography);
    seededFreeTextForRef.current = presetId;
    setFreeTexts(blocks);
    onUpdateState?.(id, {
      freeTexts: blocks,
      freeSkeleton: skeletonId,
    });
  }, [
    isFreeLayout,
    presetId,
    freeTexts,
    freeSkeletonId,
    article,
    typography,
    id,
    onUpdateState,
  ]);

  const freeTextWraps = useMemo(() => {
    const map = new Map<string, FreeTextBlockWrapResult | null>();
    if (!isFreeLayout || ratioPreset.width <= 0 || ratioPreset.height <= 0) return map;
    const W = ratioPreset.width;
    const H = ratioPreset.height;
    for (const ft of freeTexts) {
      const text = ft.bind ? String(article[ft.bind] ?? '') : ft.text;
      map.set(ft.id, layoutFreeTextBlock(ft, text, items, W, H));
    }
    return map;
  }, [isFreeLayout, freeTexts, items, article, ratioPreset]);

  const patchFreeText = (txtId: string, patch: Partial<EditorialFreeTextItem>, undoable = true) => {
    const updated = freeTexts.map((t) => (t.id === txtId ? { ...t, ...patch } : t));
    setFreeTexts(updated);
    onUpdateState?.(id, { freeTexts: updated }, undoable);
  };

  const removeFreeText = useCallback(
    (txtId: string) => {
      setFreeTexts((prev) => {
        const updated = prev.filter((t) => t.id !== txtId);
        onUpdateState?.(id, { freeTexts: updated }, true);
        return updated;
      });
      setSelectedTextId((cur) => (cur === txtId ? null : cur));
      setEditingTextId((cur) => (cur === txtId ? null : cur));
      showToast('已删除文本块', { type: 'success' });
    },
    [id, onUpdateState, showToast]
  );

  const bumpFreeTextLayer = (txtId: string, mode: 'up' | 'down' | 'top' | 'bottom') => {
    setFreeTexts((prev) => {
      const idx = prev.findIndex((t) => t.id === txtId);
      if (idx === -1) return prev;
      const arr = prev.filter((t) => t.id !== txtId);
      let at = idx;
      if (mode === 'top') at = arr.length;
      else if (mode === 'bottom') at = 0;
      else if (mode === 'up') at = Math.min(arr.length, idx + 1);
      else at = Math.max(0, idx - 1);
      const updated = [...arr.slice(0, at), prev[idx]!, ...arr.slice(at)].map((t, i) => ({
        ...t,
        zIndex: i + 1,
      }));
      onUpdateState?.(id, { freeTexts: updated }, true);
      return updated;
    });
  };

  const rotateFreeTextStep = (txtId: string, direction: 'cw' | 'ccw') => {
    setFreeTexts((prev) => {
      const updated = prev.map((t) => {
        if (t.id !== txtId) return t;
        const cur = t.rotation || 0;
        const nextAngle = direction === 'cw' ? snapRotateCw(cur) : snapRotateCcw(cur);
        return { ...t, rotation: nextAngle };
      });
      onUpdateState?.(id, { freeTexts: updated }, true);
      return updated;
    });
  };

  const addFreeTextBlock = () => {
    setIsEditing(true);
    setIsAddingNewText(true);
    setEditingTextId('new');
    setEditingTextValue('');
    setTimeout(() => textInputRef.current?.focus(), 50);
  };

  const openFreeTextEditor = (ft: EditorialFreeTextItem) => {
    setIsAddingNewText(false);
    setEditingTextId(ft.id);
    setEditingTextValue(ft.bind ? String(article[ft.bind] ?? '') : ft.text);
    setTimeout(() => textInputRef.current?.select(), 50);
  };

  const saveFreeTextEditor = () => {
    if (isAddingNewText && editingTextId === 'new') {
      const textContent = editingTextValue.trim() || '双击编辑文本';
      const newId = `ft_added_${Date.now()}`;
      const newBlock: EditorialFreeTextItem = {
        id: newId,
        bind: undefined,
        text: textContent,
        x: 34,
        y: 38,
        width: 34,
        fontSize: 26,
        fontFamily: typography.headlineFont || 'sans-serif',
        color: typography.textColor || '#1a1a1a',
        textAlign: 'center',
        fontStyle: 'normal',
        rotation: 0,
        zIndex: freeTexts.length + 1,
        writingMode: 'horizontal',
      };
      const blocks = [...freeTexts, newBlock];
      setFreeTexts(blocks);
      onUpdateState?.(id, { freeTexts: blocks }, true);
      setSelectedTextId(newId);
      setIsAddingNewText(false);
      setEditingTextId(null);
      setEditingTextValue('');
      return;
    }

    const target = freeTexts.find((t) => t.id === editingTextId);
    if (!target) {
      setIsAddingNewText(false);
      setEditingTextId(null);
      setEditingTextValue('');
      return;
    }
    const value = editingTextValue;
    if (target.bind) {
      const field = target.bind as keyof EditorialArticleData;
      const nextArticle = { ...article, [field]: value };
      setArticle(nextArticle);
      onUpdateState?.(id, { article: nextArticle, freeTexts }, true);
    } else {
      patchFreeText(editingTextId!, { text: value }, true);
    }
    setIsAddingNewText(false);
    setEditingTextId(null);
    setEditingTextValue('');
  };

  // 9. 键盘快捷键监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingTextId) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }

      if (selectedTextId) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          removeFreeText(selectedTextId);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setSelectedTextId(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTextId, editingTextId, removeFreeText]);

  // 10. 点击抽屉外部或按 ESC 自动关闭抽屉
  useEffect(() => {
    if (activeTab === 'preview') return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      if (drawerRef.current?.contains(target) || toolbarTabsRef.current?.contains(target)) {
        return;
      }

      if (
        target.closest?.('.z-\\[9999\\]') ||
        target.closest?.('[role="dialog"]') ||
        target.closest?.('[role="listbox"]')
      ) {
        return;
      }

      setActiveTab('preview');
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveTab('preview');
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeTab]);

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '杂志排版'}
      dotColor={NODE_COLORS.editorial_layout || 'oklch(0.68 0.15 285)'}
      resizable
      defaultSize={{ width: 540, height: 720 }}
      className={`transition-[opacity,transform,box-shadow,border-color] duration-150 ease-out ${
        isSelected ? 'ring-2 ring-accent/70 shadow-md' : ''
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
              {isFreeLayout && (
                <NodeActionBar.Custom
                  icon={<Type size={16} strokeWidth={1.5} />}
                  tooltip="添加自由文本"
                  onClick={addFreeTextBlock}
                  disabled={isSaving}
                />
              )}
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
                    <Loader2 size={16} className="animate-spin text-accent" />
                  ) : (
                    <Wand2 size={16} strokeWidth={1.5} />
                  )
                }
                tooltip="生成杂志画报"
                aria-label="生成杂志画报"
                onClick={handleGenerate}
                disabled={isGenerating}
              />
              {isFreeLayout && (
                <NodeActionBar.Custom
                  icon={<Type size={16} strokeWidth={1.5} />}
                  tooltip="添加自由文本"
                  onClick={addFreeTextBlock}
                  disabled={isGenerating}
                />
              )}
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
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={handleUploadImages}
      />

      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
        {hasGenerated && data.imageUrl ? (
          <div
            className="relative flex-1 min-h-0 w-full overflow-hidden rounded bg-paper-grid/10 border border-paper-grid/40 flex items-center justify-center p-2 sm:p-3 group/preview cursor-pointer select-none"
            onDoubleClick={() => setIsEditing(true)}
            title="双击重新进入编辑排版"
          >
            <div
              className="relative p-2 rounded-2xl bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_16px_48px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03),0_2px_4px_rgba(0,0,0,0.02)] flex items-center justify-center"
              style={{
                aspectRatio: `${ratioPreset.aspectRatio}`,
                height: '100%',
                maxHeight: '100%',
                width: 'auto',
              }}
            >
              <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
                <PhotoView src={data.imageUrl}>
                  <img
                    src={data.imageUrl}
                    alt="Generated Editorial"
                    className="w-full h-full object-contain rounded-lg shadow-2xs select-none cursor-zoom-in hover:opacity-90 transition-opacity drop-shadow-sm"
                  />
                </PhotoView>
              </PhotoProvider>
            </div>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-paper/95 backdrop-blur-md rounded-full text-[11px] text-ink shadow-md border border-paper-grid/50 opacity-0 group-hover/preview:opacity-100 transition-opacity pointer-events-none">
              双击或点击操作栏返回编辑排版
            </div>
          </div>
        ) : (
          <>
            {/* 顶部工具栏 */}
            <EditorialToolbar
              id={id}
              presetId={presetId}
              pageSize={pageSize}
              freeSkeletonId={freeSkeletonId}
              isFreeLayout={isFreeLayout}
              activeTab={activeTab}
              toolbarTabsRef={toolbarTabsRef}
              onSelectPreset={handleSelectPreset}
              onPageSizeChange={(r) => setPageSize(r)}
              onApplySkeleton={applyFreeSkeleton}
              onTabChange={setActiveTab}
              onUpdateState={onUpdateState}
            />

            {/* 主排版舞台区域 */}
            <div className="relative flex-1 min-h-0 w-full overflow-hidden rounded bg-paper-grid/10 border border-paper-grid/40 flex items-center justify-center select-none p-2 sm:p-3">
              <div
                ref={stageWrapperRef}
                className="relative rounded-2xl bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_16px_48px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03),0_2px_4px_rgba(0,0,0,0.02)] overflow-hidden select-none transition-[box-shadow,background-color] duration-150 ease-out"
                style={{
                  aspectRatio: `${ratioPreset.aspectRatio}`,
                  height: '100%',
                  maxHeight: '100%',
                  width: 'auto',
                  backgroundColor: background.color || '#ffffff',
                }}
                onClick={() => {
                  setSelectedItemId(null);
                  setSelectedTextId(null);
                }}
              >
                {/* 100% 绝对基准高清容器 */}
                <div
                  className="absolute top-0 left-0 origin-top-left pointer-events-auto select-none overflow-hidden"
                  style={{
                    width: `${ratioPreset.width}px`,
                    height: `${ratioPreset.height}px`,
                    transform: `scale(${scale})`,
                    backgroundColor: background.color || '#ffffff',
                    backgroundImage:
                      background.hasPaperNoise || layoutType === 'newspaper'
                        ? 'radial-gradient(circle, rgba(31,28,23,0.06) 1px, transparent 1.4px)'
                        : undefined,
                    backgroundSize: '16px 16px',
                  }}
                >
                  {/* 固定排版层 */}
                  {!isFreeLayout && (
                    <EditorialFixedLayoutLayer
                      article={article}
                      typography={typography}
                      ratioPreset={ratioPreset}
                      activeTemplate={activeTemplate}
                      layoutProjection={layoutProjection}
                      scale={scale}
                    />
                  )}

                  {/* 图片素材层 */}
                  <EditorialImageLayer
                    items={items}
                    selectedItemId={selectedItemId}
                    ratioPreset={ratioPreset}
                    scale={scale}
                    activeTemplate={activeTemplate}
                    typography={typography}
                    onSelectItem={setSelectedItemId}
                    onRotateItem={rotateStepItem}
                    onBumpLayer={bumpLayer}
                    onDeleteItem={(itemId) => handleDeleteItem(itemId, selectedItemId)}
                    beginGesture={beginGesture}
                    moveGesture={moveGesture}
                    endGesture={endGesture}
                  />

                  {/* 自由排版文本块层 */}
                  {isFreeLayout && (
                    <EditorialFreeTextLayer
                      freeTexts={freeTexts}
                      selectedTextId={selectedTextId}
                      article={article}
                      ratioPreset={ratioPreset}
                      scale={scale}
                      freeTextWraps={freeTextWraps}
                      onSelectText={setSelectedTextId}
                      onOpenEdit={openFreeTextEditor}
                      beginGesture={beginGesture}
                      moveGesture={moveGesture}
                      endGesture={endGesture}
                    />
                  )}
                </div>

                {/* 文本编辑居中浮层 */}
                <EditorialTextModal
                  editingTextId={editingTextId}
                  editingTextValue={editingTextValue}
                  textInputRef={textInputRef}
                  onValueChange={setEditingTextValue}
                  onSave={saveFreeTextEditor}
                  onCancel={() => {
                    setIsAddingNewText(false);
                    setEditingTextId(null);
                    setEditingTextValue('');
                  }}
                />
              </div>

              {/* 自由排版选中文本悬浮工具栏（浮于舞台顶层，不受内部 scale 和卡片 overflow-hidden 裁切影响） */}
              {isFreeLayout && (
                <EditorialFreeTextToolbar
                  selectedTextId={selectedTextId}
                  editingTextId={editingTextId}
                  freeTexts={freeTexts}
                  article={article}
                  onPatchFreeText={patchFreeText}
                  onOpenEdit={openFreeTextEditor}
                  onDeleteText={removeFreeText}
                  onBumpLayer={bumpFreeTextLayer}
                  onRotateStep={rotateFreeTextStep}
                />
              )}

              {/* 抽屉浮层：文章内容编辑 */}
              <EditorialArticleDrawer
                id={id}
                isOpen={activeTab === 'article'}
                article={article}
                drawerRef={drawerRef}
                onClose={() => setActiveTab('preview')}
                setArticle={setArticle}
                onUpdateState={onUpdateState}
              />

              {/* 抽屉浮层：字体与排版样式 */}
              <EditorialStyleDrawer
                id={id}
                isOpen={activeTab === 'style'}
                typography={typography}
                drawerRef={drawerRef}
                onClose={() => setActiveTab('preview')}
                setTypography={setTypography}
                onUpdateState={onUpdateState}
              />
            </div>
          </>
        )}
      </div>
    </CanvasNode>
  );
};

export const EditorialLayoutNode = memo(EditorialLayoutNodeInner);
