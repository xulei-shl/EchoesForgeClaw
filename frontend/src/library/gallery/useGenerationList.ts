import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { generationsService } from '../../shared/services/generations';
import { useFeedback } from '../../shared/components/ui/FeedbackProvider';
import { useAuth } from '../../shared/stores/authStore';
import {
  broadcastGenerationDeleted,
  getCanvasGenerationIds,
} from '../../shared/stores/useCanvasState';
import type { GalleryMode, Generation, NodeTypeCount } from '../../shared/types';
import type { ViewMode } from '../../shared/components/ui/ViewToggle';

const PAGE_SIZE = 20;

export interface UseGenerationListOptions {
  mode: GalleryMode;
}

export function useGenerationList({ mode }: UseGenerationListOptions) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { dialog, showToast } = useFeedback();

  const [items, setItems] = useState<Generation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');

  // 视图模式（画廊/收藏优先大图网格，历史优先列表；存 localStorage）
  const storageKey = `bf-view-mode-${mode}`;
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'grid' || saved === 'list') return saved;
    return mode === 'history' ? 'list' : 'grid';
  });

  const handleViewModeChange = (nextMode: ViewMode) => {
    setViewMode(nextMode);
    localStorage.setItem(storageKey, nextMode);
  };

  // 类型筛选：以 URL ?type= 为单一数据源
  const [searchParams, setSearchParams] = useSearchParams();
  const nodeType = searchParams.get('type') ?? '';
  const [nodeTypeCounts, setNodeTypeCounts] = useState<NodeTypeCount[]>([]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const isFirstLoad = useRef(true);
  const nextSkipRef = useRef(0);

  // 关键词防抖
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  const fetchPage = useCallback(
    async (skip: number, limit: number) => {
      const params: { skip: number; limit: number; keyword?: string; node_type?: string } = {
        skip,
        limit,
      };
      if (debouncedKeyword) params.keyword = debouncedKeyword;
      if (nodeType) params.node_type = nodeType;
      if (mode === 'history') return generationsService.listMine(params);
      if (mode === 'favorites') return generationsService.listFavorites(params);
      return generationsService.listPublic(params);
    },
    [mode, debouncedKeyword, nodeType]
  );

  // 首屏加载 / 重试
  const load = useCallback(async () => {
    if (isFirstLoad.current) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError('');
    try {
      const res = await fetchPage(0, PAGE_SIZE);
      setItems(res.items);
      setTotal(res.total);
      setNodeTypeCounts(res.node_type_counts ?? []);
      nextSkipRef.current = res.items.length;
    } catch (e: any) {
      setError(e?.message || '加载失败，请重试');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      isFirstLoad.current = false;
    }
  }, [fetchPage]);

  useEffect(() => {
    load();
  }, [load]);

  // 切换类型筛选
  const handleTypeChange = (val: string) => {
    setSelectedId(null);
    nextSkipRef.current = 0;
    const next = new URLSearchParams(searchParams);
    if (val) {
      next.set('type', val);
    } else {
      next.delete('type');
    }
    setSearchParams(next);
  };

  // 类型变化重置游标
  useEffect(() => {
    nextSkipRef.current = 0;
  }, [nodeType]);

  // 自动清理无效类型
  useEffect(() => {
    if (
      nodeType &&
      nodeTypeCounts.length > 0 &&
      !nodeTypeCounts.some((t) => t.node_type === nodeType)
    ) {
      const next = new URLSearchParams(searchParams);
      next.delete('type');
      setSearchParams(next, { replace: true });
    }
  }, [nodeType, nodeTypeCounts, searchParams, setSearchParams]);

  // 加载更多
  const loadMore = useCallback(async () => {
    if (loading || loadingMore || items.length >= total) return;
    const skip = nextSkipRef.current;
    setLoadingMore(true);
    try {
      const res = await fetchPage(skip, PAGE_SIZE);
      setItems((prev) => {
        const seen = new Set(prev.map((g) => g.id));
        return [...prev, ...res.items.filter((g) => !seen.has(g.id))];
      });
      setTotal(res.total);
      nextSkipRef.current = skip + res.items.length;
    } catch (e: any) {
      showToast(e?.message || '加载更多失败，请重试', { type: 'error' });
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, loading, loadingMore, items.length, total, showToast]);

  // 使用高性能 IntersectionObserver 实现丝滑触底加载
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || loading || items.length >= total) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, loading, items.length, total]);

  // 移除条目
  const removeItem = useCallback((id: number) => {
    setItems((prev) => prev.filter((g) => g.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    nextSkipRef.current = Math.max(0, nextSkipRef.current - 1);
  }, []);

  // 检验是否被画布引用
  const isReferencedOnCanvas = useCallback(
    (genId: number) => {
      const map = getCanvasGenerationIds(String(user?.id ?? 'anon'));
      return Object.values(map).includes(genId);
    },
    [user?.id]
  );

  // 乐观切换收藏（毫秒级响应，失败回滚）
  const handleToggleFavorite = async (gen: Generation): Promise<boolean> => {
    const prevFavorited = !!gen.is_favorited;
    const nextFavorited = !prevFavorited;

    // 1. 立即乐观更新本地状态
    setItems((prev) =>
      prev.map((g) => (g.id === gen.id ? { ...g, is_favorited: nextFavorited } : g))
    );

    try {
      const updated = nextFavorited
        ? await generationsService.favorite(gen.id)
        : await generationsService.unfavorite(gen.id);

      // 若在收藏页面取消收藏，条目平滑淡出并移除
      if (mode === 'favorites' && !updated.is_favorited) {
        removeItem(gen.id);
        if (selectedId === gen.id) setSelectedId(null);
      } else {
        setItems((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
      }
      showToast(nextFavorited ? '已收藏' : '已取消收藏', { type: 'success' });
      return true;
    } catch (e: any) {
      // 失败自动回滚
      setItems((prev) =>
        prev.map((g) => (g.id === gen.id ? { ...g, is_favorited: prevFavorited } : g))
      );
      showToast(e?.message || '操作失败，请重试', { type: 'error' });
      return false;
    }
  };

  // 乐观切换公开（毫秒级响应，失败回滚）
  const handleTogglePublic = async (gen: Generation): Promise<boolean> => {
    const prevPublic = !!gen.is_public;
    const nextPublic = !prevPublic;

    // 1. 立即乐观更新
    setItems((prev) =>
      prev.map((g) => (g.id === gen.id ? { ...g, is_public: nextPublic } : g))
    );

    try {
      const updated = nextPublic
        ? await generationsService.share(gen.id)
        : await generationsService.unshare(gen.id);

      // 若在画廊页面撤下公开，条目平滑移除
      if (mode === 'gallery' && !updated.is_public) {
        removeItem(gen.id);
        if (selectedId === gen.id) setSelectedId(null);
      } else {
        setItems((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
      }
      showToast(nextPublic ? '已公开到画廊' : '已从画廊撤下', { type: 'success' });
      return true;
    } catch (e: any) {
      // 失败回滚
      setItems((prev) =>
        prev.map((g) => (g.id === gen.id ? { ...g, is_public: prevPublic } : g))
      );
      showToast(e?.message || '操作失败，请重试', { type: 'error' });
      return false;
    }
  };

  // 删除生成记录
  const handleRemoveGeneration = async (gen: Generation): Promise<boolean> => {
    const onCanvas = isReferencedOnCanvas(gen.id);
    const ok = await dialog.confirm({
      title: '删除记录',
      message: onCanvas
        ? '该作品在画布上仍有对应的图片节点。删除历史记录只会移除这条记录，画布节点及其图片会保留，是否继续？'
        : '确定删除这条记录吗？删除后不可恢复。',
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return false;

    try {
      await generationsService.remove(gen.id);
      removeItem(gen.id);
      if (selectedId === gen.id) setSelectedId(null);
      broadcastGenerationDeleted(String(user?.id ?? 'anon'), gen.id);
      showToast('记录已删除', { type: 'success' });
      return true;
    } catch (e: any) {
      showToast(e?.message || '删除失败，请重试', { type: 'error' });
      return false;
    }
  };

  // 收藏页专用的取消收藏
  const handleRemoveFromFavorites = async (gen: Generation): Promise<boolean> => {
    return handleToggleFavorite(gen);
  };

  // 一键导入画板（业务闭环）
  const handleOpenInCanvas = (gen: Generation) => {
    try {
      sessionStorage.setItem('bf-canvas-import', JSON.stringify(gen));
      showToast('正在前往画板导入作品...', { type: 'info' });
      navigate('/bookplate');
    } catch {
      showToast('未能暂存作品信息', { type: 'error' });
    }
  };

  // 当前选中条目与前后导航
  const selectedIndex = selectedId ? items.findIndex((g) => g.id === selectedId) : -1;
  const selected = selectedIndex !== -1 ? items[selectedIndex] : null;
  const hasPrev = selectedIndex > 0;
  const hasNext = selectedIndex !== -1 && selectedIndex < items.length - 1;

  const handlePrev = useCallback(() => {
    if (hasPrev) setSelectedId(items[selectedIndex - 1].id);
  }, [hasPrev, items, selectedIndex]);

  const handleNext = useCallback(() => {
    if (hasNext) setSelectedId(items[selectedIndex + 1].id);
  }, [hasNext, items, selectedIndex]);

  // 详情打开时支持键盘左右方向键切换
  useEffect(() => {
    if (!selectedId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // 避免输入框内部操作时触发
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, handlePrev, handleNext]);

  const canManage = (gen: Generation) =>
    mode === 'history' ||
    (mode === 'favorites' && gen.username === user?.username) ||
    (mode === 'gallery' && gen.username === user?.username);

  const clearFilter = () => {
    setKeyword('');
    setSelectedId(null);
    nextSkipRef.current = 0;
    const next = new URLSearchParams(searchParams);
    next.delete('type');
    setSearchParams(next);
  };

  return {
    items,
    total,
    loading,
    isRefreshing,
    loadingMore,
    error,
    selected,
    selectedId,
    setSelectedId,
    selectedIndex,
    keyword,
    setKeyword,
    debouncedKeyword,
    nodeType,
    nodeTypeCounts,
    handleTypeChange,
    viewMode,
    handleViewModeChange,
    sentinelRef,
    load,
    hasMore: items.length < total,
    hasFilter: !!(debouncedKeyword || nodeType),
    clearFilter,
    hasPrev,
    hasNext,
    handlePrev,
    handleNext,
    canManage,
    handleToggleFavorite,
    handleTogglePublic,
    handleRemoveGeneration,
    handleRemoveFromFavorites,
    handleOpenInCanvas,
  };
}

export default useGenerationList;
