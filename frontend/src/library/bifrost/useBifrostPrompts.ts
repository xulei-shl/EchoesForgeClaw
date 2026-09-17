import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bifrostService } from '../../shared/services/bifrost';
import { annotationService } from '../../shared/services/admin';
import { useFeedback } from '../../shared/components/ui/FeedbackProvider';
import type { BifrostFolder, BifrostPrompt } from '../../shared/types';

const DEFAULT_PAGE_SIZE = 24;

export interface UseBifrostPromptsOptions {
  pageSize?: number;
  fetchPrompts?: (params: { folder_id?: string; q?: string; force?: boolean; skip?: number; limit?: number }) => Promise<{
    prompts: BifrostPrompt[];
    total: number;
  }>;
  fetchFolders?: (params?: { force?: boolean }) => Promise<{ folders: BifrostFolder[] }>;
}

export function useBifrostPrompts(options: UseBifrostPromptsOptions = {}) {
  const { pageSize = DEFAULT_PAGE_SIZE, fetchPrompts, fetchFolders } = options;
  const { showToast } = useFeedback();

  const [folders, setFolders] = useState<BifrostFolder[]>([]);
  const [items, setItems] = useState<BifrostPrompt[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const [folderId, setFolderId] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [ratingFilter, setRatingFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  const sentinelRef = useRef<HTMLDivElement>(null);
  const nextSkipRef = useRef(0);
  const isFirstLoad = useRef(true);
  const requestSeq = useRef(0);

  // 搜索词防抖
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQ(q.trim());
    }, 350);
    return () => window.clearTimeout(t);
  }, [q]);

  // 获取某一页提示词
  const fetchPage = useCallback(
    async (skip: number, limit: number, folder: string, keyword: string, force = false) => {
      const fn = fetchPrompts || bifrostService.listPrompts;
      return fn({
        folder_id: folder || undefined,
        q: keyword || undefined,
        skip,
        limit,
        force,
      });
    },
    [fetchPrompts]
  );

  // 首屏或重置加载（附带文件夹列表）
  const load = useCallback(
    async (force = false) => {
      const seq = ++requestSeq.current;
      if (isFirstLoad.current) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setError('');
      try {
        const folderFn = fetchFolders || bifrostService.listFolders;
        const [folderRes, promptRes] = await Promise.all([
          folderFn({ force }),
          fetchPage(0, pageSize, folderId, debouncedQ, force),
        ]);
        if (seq !== requestSeq.current) return;
        setFolders(folderRes.folders ?? []);
        setItems(promptRes.prompts ?? []);
        setTotal(promptRes.total ?? 0);
        nextSkipRef.current = (promptRes.prompts ?? []).length;
      } catch (e: any) {
        if (seq !== requestSeq.current) return;
        setError(e?.message || '加载提示词失败，请重试');
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          setIsRefreshing(false);
          isFirstLoad.current = false;
        }
      }
    },
    [debouncedQ, fetchPage, folderId, pageSize]
  );

  // 搜索词或文件夹变化时重置游标并重新加载
  useEffect(() => {
    nextSkipRef.current = 0;
    void load(false);
  }, [debouncedQ, folderId, load]);

  // 加载更多（流式触底加载）
  const loadMore = useCallback(async () => {
    if (loading || loadingMore || isRefreshing || items.length >= total) return;
    const skip = nextSkipRef.current;
    setLoadingMore(true);
    try {
      const res = await fetchPage(skip, pageSize, folderId, debouncedQ, false);
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const append = (res.prompts ?? []).filter((p) => !seen.has(p.id));
        return [...prev, ...append];
      });
      setTotal(res.total ?? 0);
      nextSkipRef.current = skip + (res.prompts ?? []).length;
    } catch (e: any) {
      showToast(e?.message || '加载更多失败，请重试', { type: 'error' });
    } finally {
      setLoadingMore(false);
    }
  }, [debouncedQ, fetchPage, folderId, items.length, loading, loadingMore, isRefreshing, pageSize, showToast, total]);

  // IntersectionObserver 监听底部哨兵
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || loading || items.length >= total) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          void loadMore();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, loading, items.length, total]);

  // 收集当前加载提示词的所有唯一标签列表
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (Array.isArray(item.user_tags)) {
        for (const t of item.user_tags) {
          if (t && t.trim()) set.add(t.trim());
        }
      }
    }
    return Array.from(set).sort();
  }, [items]);

  // 快捷更新星级评分（乐观更新 + 失败回滚）
  const updateRating = async (
    promptId: string,
    nextRating: number,
    currentNote?: string,
    currentTags?: string[]
  ): Promise<boolean> => {
    const target = items.find((p) => p.id === promptId);
    const prevRating = target?.user_rating ?? 0;
    const prevNote = target?.user_note ?? '';
    const prevTags = target?.user_tags ?? [];

    setItems((prev) =>
      prev.map((p) =>
        p.id === promptId ? { ...p, user_rating: nextRating } : p
      )
    );

    try {
      const res = await annotationService.setAnnotation({
        resource_type: 'bifrost_prompt',
        resource_id: promptId,
        rating: nextRating,
        note: currentNote !== undefined ? currentNote : prevNote,
        tags: currentTags !== undefined ? currentTags : prevTags,
      });
      setItems((prev) =>
        prev.map((p) =>
          p.id === promptId ? { ...p, user_rating: res.rating, user_note: res.note, user_tags: res.tags } : p
        )
      );
      showToast(nextRating > 0 ? `已评为 ${nextRating} 星` : '已清除评分', { type: 'success' });
      return true;
    } catch (e: any) {
      setItems((prev) =>
        prev.map((p) =>
          p.id === promptId ? { ...p, user_rating: prevRating } : p
        )
      );
      showToast(e?.message || '评分更新失败', { type: 'error' });
      return false;
    }
  };

  // 快捷保存私有备注与标签（乐观更新 + 失败回滚）
  const saveNote = async (
    promptId: string,
    nextRating: number,
    nextNote: string,
    nextTags?: string[]
  ): Promise<boolean> => {
    const target = items.find((p) => p.id === promptId);
    const prevRating = target?.user_rating ?? 0;
    const prevNote = target?.user_note ?? '';
    const prevTags = target?.user_tags ?? [];
    const resolvedTags = nextTags !== undefined ? nextTags : prevTags;

    setItems((prev) =>
      prev.map((p) =>
        p.id === promptId
          ? { ...p, user_rating: nextRating, user_note: nextNote.trim(), user_tags: resolvedTags }
          : p
      )
    );

    try {
      const res = await annotationService.setAnnotation({
        resource_type: 'bifrost_prompt',
        resource_id: promptId,
        rating: nextRating,
        note: nextNote.trim(),
        tags: resolvedTags,
      });
      setItems((prev) =>
        prev.map((p) =>
          p.id === promptId ? { ...p, user_rating: res.rating, user_note: res.note, user_tags: res.tags } : p
        )
      );
      showToast('标注已保存', { type: 'success' });
      return true;
    } catch (e: any) {
      setItems((prev) =>
        prev.map((p) =>
          p.id === promptId ? { ...p, user_rating: prevRating, user_note: prevNote, user_tags: prevTags } : p
        )
      );
      showToast(e?.message || '备注保存失败', { type: 'error' });
      return false;
    }
  };

  // 客户端过滤（基于星级/备注/标签）
  const filteredItems = useMemo(() => {
    return items.filter((p) => {
      if (ratingFilter === '5' && (p.user_rating ?? 0) !== 5) return false;
      if (ratingFilter === '4+' && (p.user_rating ?? 0) < 4) return false;
      if (ratingFilter === '3+' && (p.user_rating ?? 0) < 3) return false;
      if (ratingFilter === 'rated' && !(p.user_rating && p.user_rating > 0)) return false;
      if (ratingFilter === 'unrated' && (p.user_rating && p.user_rating > 0)) return false;
      if (ratingFilter === 'noted' && !p.user_note?.trim()) return false;
      if (tagFilter && (!p.user_tags || !p.user_tags.includes(tagFilter))) return false;
      return true;
    });
  }, [items, ratingFilter, tagFilter]);

  return {
    folders,
    items,
    setItems,
    filteredItems,
    total,
    loading,
    isRefreshing,
    loadingMore,
    hasMore: items.length < total,
    error,
    folderId,
    setFolderId,
    q,
    setQ,
    ratingFilter,
    setRatingFilter,
    tagFilter,
    setTagFilter,
    availableTags,
    sentinelRef,
    load,
    loadMore,
    updateRating,
    saveNote,
  };
}
