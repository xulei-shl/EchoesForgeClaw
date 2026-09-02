import { useState } from 'react';
import type {
  EditorialArticleData,
  EditorialFreeTextItem,
  EditorialImageItem,
  EditorialPageRatio,
  PageRatioPreset,
  EditorialState,
  EditorialTemplate,
  EditorialTypographySettings,
} from '../types';
import { getEditorialTemplate, DEFAULT_FREE_LAYOUT_SKELETON, getFreeLayoutSkeleton } from '../templates';
import { exportEditorialToPng } from '../render/canvasExporter';
import { snapRotateCw, snapRotateCcw } from '../../journal';
import { probeImageAspectRatio } from './useEditorialSync';

export interface UseEditorialActionsProps {
  id: string;
  currentState: EditorialState;
  ratioPreset: PageRatioPreset;
  activeTemplate: EditorialTemplate;
  items: EditorialImageItem[];
  article: EditorialArticleData;
  typography: EditorialTypographySettings;
  presetId: string;
  data?: Partial<EditorialState> & {
    imageUrl?: string | null;
    isSaved?: boolean;
  };
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  dismissedSourcesRef: React.MutableRefObject<Set<string>>;
  seededFreeTextForRef: React.MutableRefObject<string | null>;
  showToast: (msg: string, opts?: { type?: 'info' | 'success' | 'error' | 'warning' }) => void;
  setPresetId: React.Dispatch<React.SetStateAction<string>>;
  setPageSize: React.Dispatch<React.SetStateAction<EditorialPageRatio>>;
  setArticle: React.Dispatch<React.SetStateAction<EditorialArticleData>>;
  setTypography: React.Dispatch<React.SetStateAction<EditorialTypographySettings>>;
  setBackground: React.Dispatch<React.SetStateAction<EditorialState['background']>>;
  setItems: React.Dispatch<React.SetStateAction<EditorialImageItem[]>>;
  setFreeTexts: React.Dispatch<React.SetStateAction<EditorialFreeTextItem[]>>;
  setFreeSkeletonId: React.Dispatch<React.SetStateAction<string>>;
  setSelectedItemId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedTextId: React.Dispatch<React.SetStateAction<string | null>>;
  setEditingTextId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsEditing: React.Dispatch<React.SetStateAction<boolean>>;
  onUpdateState?: (id: string, patch: Partial<EditorialState>, undoable?: boolean) => void;
  onExport?: (id: string, dataUrl: string, state: EditorialState) => Promise<void>;
  onSelect?: (id: string) => void;
}

/**
 * 杂志排版业务操作与状态更新 Hook
 */
export function useEditorialActions({
  id,
  currentState,
  ratioPreset,
  activeTemplate,
  items,
  article,
  typography,
  presetId,
  data = {},
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
}: UseEditorialActionsProps) {
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // 1. 切换模板预设
  const handleSelectPreset = (newPresetId: string) => {
    const t = getEditorialTemplate(newPresetId);
    setPresetId(newPresetId);
    setPageSize(t.defaultRatio);
    setArticle(t.defaultArticle);
    const nextTypography = {
      ...t.defaultTypography,
      dropCap: typography.dropCap,
    };
    setTypography(nextTypography);
    setBackground(t.defaultBackground);
    setFreeTexts([]);
    seededFreeTextForRef.current = null;
    setSelectedTextId(null);
    setEditingTextId(null);
    onUpdateState?.(
      id,
      {
        presetId: newPresetId,
        pageSize: t.defaultRatio,
        article: t.defaultArticle,
        typography: nextTypography,
        background: t.defaultBackground,
        freeTexts: [],
      },
      true
    );
    showToast(`已切换版面风格：${t.name}`, { type: 'info' });
  };

  // 2. 本地图片上传
  const handleUploadImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const uploadPlacements = [
      { x: 52, y: 14, width: 42, height: 48 },
      { x: 6, y: 58, width: 38, height: 34 },
      { x: 52, y: 64, width: 42, height: 30 },
    ];

    const newItems: EditorialImageItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve((ev.target?.result as string) || '');
        reader.readAsDataURL(file);
      });
      if (!dataUrl) continue;
      const ar = await probeImageAspectRatio(dataUrl);
      const p = uploadPlacements[(items.length + newItems.length) % uploadPlacements.length]!;

      newItems.push({
        id: `img_upload_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        src: dataUrl,
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
        aspectRatio: ar,
        rotation: 0,
        wrapMode: 'box',
        zIndex: items.length + newItems.length + 1,
      });
    }

    if (newItems.length > 0) {
      setItems((prev) => {
        const updated = [...prev, ...newItems];
        onUpdateState?.(id, { images: updated }, true);
        return updated;
      });
      setIsEditing(true);
      showToast(`已添加 ${newItems.length} 张图片素材`, { type: 'success' });
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 3. 删除图片素材
  const handleDeleteItem = (itemId: string, selectedItemId: string | null) => {
    const item = items.find((it) => it.id === itemId);
    if (item?.src) {
      dismissedSourcesRef.current.add(item.src);
    }
    setItems((prev) => {
      const next = prev.filter((it) => it.id !== itemId);
      onUpdateState?.(
        id,
        {
          images: next,
          dismissedSources: Array.from(dismissedSourcesRef.current),
        },
        true
      );
      return next;
    });
    if (selectedItemId === itemId) setSelectedItemId(null);
  };

  // 4. 图片旋转与图层调整
  const rotateStepItem = (itemId: string, direction: 'cw' | 'ccw') => {
    setItems((prev) => {
      const updated = prev.map((it) => {
        if (it.id !== itemId) return it;
        const cur = it.rotation || 0;
        const nextAngle = direction === 'cw' ? snapRotateCw(cur) : snapRotateCcw(cur);
        return { ...it, rotation: nextAngle };
      });
      onUpdateState?.(id, { images: updated }, true);
      return updated;
    });
  };

  const bumpLayer = (itemId: string, mode: 'top' | 'bottom') => {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.id === itemId);
      if (idx === -1) return prev;
      const item = prev[idx]!;
      const without = prev.filter((it) => it.id !== itemId);
      const updated = mode === 'top' ? [...without, item] : [item, ...without];
      const reindexed = updated.map((it, i) => ({ ...it, zIndex: i + 1 }));
      onUpdateState?.(id, { images: reindexed }, true);
      return reindexed;
    });
  };

  // 5. 本地生成画报预览
  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      showToast('正在利用 Pretext 渲染印刷级高清画报...', { type: 'info' });
      const dataUrl = await exportEditorialToPng(currentState, ratioPreset, activeTemplate);
      onUpdateState?.(id, { imageUrl: dataUrl, isSaved: false }, true);
      setIsEditing(false);
      setSelectedItemId(null);
      showToast('杂志画报生成完成（可点击右下角保存按钮写入数据库）', { type: 'success' });
    } catch (err: any) {
      showToast(`生成失败: ${err.message || '未知错误'}`, { type: 'error' });
    } finally {
      setIsGenerating(false);
    }
  };

  // 6. 保存到数据库
  const handleSaveToDatabase = async () => {
    const imgUrl = data?.imageUrl;
    if (!imgUrl || isSaving || !onExport) return;
    setIsSaving(true);
    try {
      await onExport(id, imgUrl, {
        ...currentState,
        imageUrl: imgUrl,
        isSaved: true,
      });
      onUpdateState?.(id, { isSaved: true });
      onSelect?.(id);
      showToast('画报已保存到数据库，已解锁公开与收藏', { type: 'success' });
    } catch (err: any) {
      showToast(err?.detail || err?.message || '保存到数据库失败，请重试', { type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  // 7. 下载 PNG
  const handleDownload = () => {
    if (!data?.imageUrl) return;
    const a = document.createElement('a');
    a.href = data.imageUrl;
    a.download = `editorial-${article.headline || Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('已开始下载画报 PNG', { type: 'success' });
  };

  // 8. 重置版式
  const handleReset = () => {
    setPageSize(activeTemplate.defaultRatio);
    setArticle(activeTemplate.defaultArticle);
    setTypography(activeTemplate.defaultTypography);
    setBackground(activeTemplate.defaultBackground);
    setItems([]);
    setFreeTexts([]);
    setFreeSkeletonId(DEFAULT_FREE_LAYOUT_SKELETON);
    seededFreeTextForRef.current = null;
    setSelectedItemId(null);
    setSelectedTextId(null);
    setEditingTextId(null);
    onUpdateState?.(
      id,
      {
        presetId,
        pageSize: activeTemplate.defaultRatio,
        article: activeTemplate.defaultArticle,
        typography: activeTemplate.defaultTypography,
        background: activeTemplate.defaultBackground,
        freeSkeleton: DEFAULT_FREE_LAYOUT_SKELETON,
        images: [],
        freeTexts: [],
        imageUrl: null,
        isSaved: false,
      },
      true
    );
    setIsEditing(true);
    showToast(`已重置为【${activeTemplate.name}】默认版式`, { type: 'info' });
  };

  // 9. 应用自由排版骨架
  const applyFreeSkeleton = (skeletonId: string) => {
    const blocks = getFreeLayoutSkeleton(skeletonId).build(article, typography);
    setFreeSkeletonId(skeletonId);
    setFreeTexts(blocks);
    setSelectedTextId(null);
    setEditingTextId(null);
    onUpdateState?.(id, { freeTexts: blocks, freeSkeleton: skeletonId }, true);
    const skeleton = getFreeLayoutSkeleton(skeletonId);
    showToast(`已应用初始骨架：${skeleton.name}，可继续自由微调`, { type: 'success' });
  };

  // 10. 收藏与公开切换辅助
  const runToggle = async (
    action: ((id: string) => Promise<boolean>) | undefined,
    msg: (active: boolean) => string
  ) => {
    if (!action) return;
    try {
      const nextState = await action(id);
      showToast(msg(nextState), { type: 'success' });
    } catch {
      showToast('操作失败，请重试', { type: 'error' });
    }
  };

  return {
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
  };
}
