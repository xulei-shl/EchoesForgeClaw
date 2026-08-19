import { useCallback, useEffect } from 'react';
import generationsService from '../../platform/services/generations';
import { getCanvasEventKey, type CanvasDeleteEvent } from '../../platform/stores/useCanvasState';

export interface FavoritesSyncDeps {
  userId: string;
  generationIds: React.MutableRefObject<Record<string, number>>;
  setFavoritedState: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setPublishedState: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setStaleRecordIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  ensureGeneration: (nodeId: string) => Promise<number>;
  favoritedRef: React.MutableRefObject<Record<string, boolean>>;
  publishedRef: React.MutableRefObject<Record<string, boolean>>;
  busyFav: React.MutableRefObject<Set<string>>;
  busyPub: React.MutableRefObject<Set<string>>;
}

export function useFavoritesSync({
  userId,
  generationIds,
  setFavoritedState,
  setPublishedState,
  setStaleRecordIds,
  ensureGeneration,
  favoritedRef,
  publishedRef,
  busyFav,
  busyPub,
}: FavoritesSyncDeps) {
  const invalidateGenerationLink = useCallback((nodeId: string) => {
    delete generationIds.current[nodeId];
    setFavoritedState((prev) => ({ ...prev, [nodeId]: false }));
    setPublishedState((prev) => ({ ...prev, [nodeId]: false }));
    setStaleRecordIds((prev) => {
      if (prev.has(nodeId)) return prev;
      const next = new Set(prev);
      next.add(nodeId);
      return next;
    });
  }, [generationIds, setFavoritedState, setPublishedState, setStaleRecordIds]);

  /** 从服务端同步各图片节点的收藏/公开状态（挂载与撤销恢复后调用） */
  const syncFavoritesFromServer = useCallback(async () => {
    const entries = Object.entries(generationIds.current);
    if (entries.length === 0) return;
    try {
      const results = await Promise.allSettled(
        entries.map(([, genId]) => generationsService.get(genId))
      );
      const favPatch: Record<string, boolean> = {};
      const pubPatch: Record<string, boolean> = {};
      entries.forEach(([nodeId], i) => {
        const r = results[i];
        if (r.status === 'rejected') {
          if ((r.reason as any)?.status === 404) invalidateGenerationLink(nodeId);
          return;
        }
        const g = r.value;
        if (!g) return;
        favPatch[nodeId] = !!g.is_favorited;
        pubPatch[nodeId] = !!g.is_public;
      });
      setFavoritedState((prev) => ({ ...prev, ...favPatch }));
      setPublishedState((prev) => ({ ...prev, ...pubPatch }));
    } catch (e) {
      console.error('同步画板收藏/公开状态失败:', e);
    }
  }, [invalidateGenerationLink, generationIds, setFavoritedState, setPublishedState]);

  useEffect(() => {
    void syncFavoritesFromServer();
  }, [syncFavoritesFromServer]);

  // 跨 tab 联动：history/收藏/画廊页在其他 tab 删除记录后写入事件 key，本 tab 实时失效对应节点关联
  useEffect(() => {
    const eventKey = getCanvasEventKey(userId || 'anon');
    const onStorage = (e: StorageEvent) => {
      if (e.key !== eventKey || !e.newValue) return;
      try {
        const payload: CanvasDeleteEvent = JSON.parse(e.newValue);
        if (typeof payload?.genId !== 'number') return;
        for (const [nodeId, genId] of Object.entries(generationIds.current)) {
          if (genId === payload.genId) invalidateGenerationLink(nodeId);
        }
      } catch {
        /* 负载损坏，忽略 */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [userId, invalidateGenerationLink, generationIds]);

  const clearStaleFlag = useCallback((imageNodeId: string) => {
    setStaleRecordIds((prev) => {
      if (!prev.has(imageNodeId)) return prev;
      const next = new Set(prev);
      next.delete(imageNodeId);
      return next;
    });
  }, []);

  const toggleFavoriteForImage = async (imageNodeId: string): Promise<boolean> => {
    if (busyFav.current.has(imageNodeId)) return !!favoritedRef.current[imageNodeId];
    busyFav.current.add(imageNodeId);
    try {
      const genId = await ensureGeneration(imageNodeId);
      const currently = !!favoritedRef.current[imageNodeId];
      const updated = currently
        ? await generationsService.unfavorite(genId)
        : await generationsService.favorite(genId);
      const next = updated.is_favorited ?? !currently;
      setFavoritedState((prev) => ({ ...prev, [imageNodeId]: next }));
      clearStaleFlag(imageNodeId);
      return next;
    } catch (err: any) {
      console.warn('收藏失败:', err.message);
      return !!favoritedRef.current[imageNodeId];
    } finally {
      busyFav.current.delete(imageNodeId);
    }
  };

  const togglePublicForImage = async (imageNodeId: string): Promise<boolean> => {
    if (busyPub.current.has(imageNodeId)) return !!publishedRef.current[imageNodeId];
    busyPub.current.add(imageNodeId);
    try {
      const genId = await ensureGeneration(imageNodeId);
      const currently = !!publishedRef.current[imageNodeId];
      const updated = currently
        ? await generationsService.unshare(genId)
        : await generationsService.share(genId);
      const next = updated.is_public ?? !currently;
      setPublishedState((prev) => ({ ...prev, [imageNodeId]: next }));
      clearStaleFlag(imageNodeId);
      return next;
    } catch (err: any) {
      console.warn('公开失败:', err.message);
      return !!publishedRef.current[imageNodeId];
    } finally {
      busyPub.current.delete(imageNodeId);
    }
  };

  return {
    invalidateGenerationLink,
    syncFavoritesFromServer,
    toggleFavoriteForImage,
    togglePublicForImage,
    clearStaleFlag,
  };
}
