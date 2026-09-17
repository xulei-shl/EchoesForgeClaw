import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bifrostService } from '../../shared/services/bifrost';
import { annotationService } from '../../shared/services/admin';
import { useFeedback } from '../../shared/components/ui/FeedbackProvider';
import type { CachedBifrostSkill } from '../../shared/types';

const DEFAULT_PAGE_SIZE = 24;

export interface UseBifrostSkillsOptions {
  pageSize?: number;
  fetcher?: (params: { q?: string; force?: boolean; skip?: number; limit?: number }) => Promise<{
    skills: CachedBifrostSkill[];
    total: number;
    remote_available?: boolean;
  }>;
}

export function useBifrostSkills(options: UseBifrostSkillsOptions = {}) {
  const { pageSize = DEFAULT_PAGE_SIZE, fetcher } = options;
  const { showToast } = useFeedback();

  const [items, setItems] = useState<CachedBifrostSkill[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [remoteAvailable, setRemoteAvailable] = useState(true);

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [ratingFilter, setRatingFilter] = useState('');

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

  // 获取某一页数据
  const fetchPage = useCallback(
    async (skip: number, limit: number, keyword: string, force = false) => {
      const fn = fetcher || bifrostService.listSkills;
      return fn({
        q: keyword || undefined,
        skip,
        limit,
        force,
      });
    },
    [fetcher]
  );

  // 首屏或重置加载
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
        const res = await fetchPage(0, pageSize, debouncedQ, force);
        if (seq !== requestSeq.current) return;
        setItems(res.skills ?? []);
        setTotal(res.total ?? 0);
        setRemoteAvailable(res.remote_available !== false);
        nextSkipRef.current = (res.skills ?? []).length;
      } catch (e: any) {
        if (seq !== requestSeq.current) return;
        setError(e?.message || '加载 Skills 失败，请重试');
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          setIsRefreshing(false);
          isFirstLoad.current = false;
        }
      }
    },
    [debouncedQ, fetchPage, pageSize]
  );

  // 搜索词变化时回到第一页并重新加载
  useEffect(() => {
    nextSkipRef.current = 0;
    void load(false);
  }, [debouncedQ, load]);

  // 加载更多（流式触底加载）
  const loadMore = useCallback(async () => {
    if (loading || loadingMore || isRefreshing || items.length >= total) return;
    const skip = nextSkipRef.current;
    setLoadingMore(true);
    try {
      const res = await fetchPage(skip, pageSize, debouncedQ, false);
      setItems((prev) => {
        const seen = new Set(prev.map((s) => s.name));
        const append = (res.skills ?? []).filter((s) => !seen.has(s.name));
        return [...prev, ...append];
      });
      setTotal(res.total ?? 0);
      nextSkipRef.current = skip + (res.skills ?? []).length;
    } catch (e: any) {
      showToast(e?.message || '加载更多失败，请重试', { type: 'error' });
    } finally {
      setLoadingMore(false);
    }
  }, [debouncedQ, fetchPage, items.length, loading, loadingMore, isRefreshing, pageSize, showToast, total]);

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

  // 快捷更新星级评分（乐观更新 + 失败回滚）
  const updateRating = async (skillName: string, nextRating: number, currentNote?: string): Promise<boolean> => {
    const target = items.find((s) => s.name === skillName);
    const prevRating = target?.user_rating ?? 0;
    const prevNote = target?.user_note ?? target?.note ?? '';

    // 1. 立即乐观更新
    setItems((prev) =>
      prev.map((s) =>
        s.name === skillName ? { ...s, user_rating: nextRating } : s
      )
    );

    try {
      const res = await annotationService.setAnnotation({
        resource_type: 'bifrost_skill',
        resource_id: skillName,
        rating: nextRating,
        note: currentNote !== undefined ? currentNote : prevNote,
      });
      setItems((prev) =>
        prev.map((s) =>
          s.name === skillName
            ? { ...s, user_rating: res.rating, user_note: res.note, note: res.note }
            : s
        )
      );
      showToast(nextRating > 0 ? `已评为 ${nextRating} 星` : '已清除评分', { type: 'success' });
      return true;
    } catch (e: any) {
      // 回滚
      setItems((prev) =>
        prev.map((s) =>
          s.name === skillName ? { ...s, user_rating: prevRating } : s
        )
      );
      showToast(e?.message || '评分更新失败', { type: 'error' });
      return false;
    }
  };

  // 快捷保存私有备注（乐观更新 + 失败回滚）
  const saveNote = async (skillName: string, nextRating: number, nextNote: string): Promise<boolean> => {
    const target = items.find((s) => s.name === skillName);
    const prevRating = target?.user_rating ?? 0;
    const prevNote = target?.user_note ?? target?.note ?? '';

    setItems((prev) =>
      prev.map((s) =>
        s.name === skillName
          ? { ...s, user_rating: nextRating, user_note: nextNote.trim(), note: nextNote.trim() }
          : s
      )
    );

    try {
      const res = await annotationService.setAnnotation({
        resource_type: 'bifrost_skill',
        resource_id: skillName,
        rating: nextRating,
        note: nextNote.trim(),
      });
      setItems((prev) =>
        prev.map((s) =>
          s.name === skillName
            ? { ...s, user_rating: res.rating, user_note: res.note, note: res.note }
            : s
        )
      );
      showToast('备注已保存', { type: 'success' });
      return true;
    } catch (e: any) {
      setItems((prev) =>
        prev.map((s) =>
          s.name === skillName
            ? { ...s, user_rating: prevRating, user_note: prevNote, note: prevNote }
            : s
        )
      );
      showToast(e?.message || '保存备注失败', { type: 'error' });
      return false;
    }
  };

  // 客户端过滤（基于星级/备注）
  const filteredItems = useMemo(() => {
    return items.filter((s) => {
      if (ratingFilter === '5' && (s.user_rating ?? 0) !== 5) return false;
      if (ratingFilter === '4+' && (s.user_rating ?? 0) < 4) return false;
      if (ratingFilter === '3+' && (s.user_rating ?? 0) < 3) return false;
      if (ratingFilter === 'rated' && !(s.user_rating && s.user_rating > 0)) return false;
      if (ratingFilter === 'unrated' && (s.user_rating && s.user_rating > 0)) return false;
      if (ratingFilter === 'noted' && !s.user_note?.trim() && !s.note?.trim()) return false;
      return true;
    });
  }, [items, ratingFilter]);

  return {
    items,
    setItems,
    filteredItems,
    total,
    loading,
    isRefreshing,
    loadingMore,
    hasMore: items.length < total,
    error,
    remoteAvailable,
    q,
    setQ,
    ratingFilter,
    setRatingFilter,
    sentinelRef,
    load,
    loadMore,
    updateRating,
    saveNote,
  };
}
