import { useEffect, useMemo, useRef } from 'react';
import type { EditorialArticleData, EditorialImageItem, EditorialState } from '../types';
import {
  mapBookToEditorialArticle,
  isEditorialFieldFillable,
  bookMetadataFingerprint,
} from '../fromBook';

/** 异步读取图像自然宽高比 (naturalWidth / naturalHeight) */
export function probeImageAspectRatio(src: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve(img.naturalWidth / img.naturalHeight);
      } else {
        resolve(1);
      }
    };
    img.onerror = () => resolve(1);
    img.src = src;
  });
}

export interface UseEditorialSyncProps {
  id: string;
  presetId: string;
  data?: Partial<EditorialState>;
  defaultArticle: EditorialArticleData;
  upstreamBookData?: import('../../receipt/types').BookMetadataInput | null;
  upstreamTexts?: string[];
  upstreamImages?: string[];
  items: EditorialImageItem[];
  setArticle: React.Dispatch<React.SetStateAction<EditorialArticleData>>;
  setItems: React.Dispatch<React.SetStateAction<EditorialImageItem[]>>;
  onUpdateState?: (id: string, patch: Partial<EditorialState>, undoable?: boolean) => void;
}

/**
 * 处理上游图书元数据、上游文本和上游图片的数据同步 Hook
 */
export function useEditorialSync({
  id,
  presetId,
  data = {},
  defaultArticle,
  upstreamBookData,
  upstreamTexts,
  upstreamImages,
  items,
  setArticle,
  setItems,
  onUpdateState,
}: UseEditorialSyncProps) {
  const dismissedSourcesRef = useRef<Set<string>>(new Set(data.dismissedSources || []));

  useEffect(() => {
    if (data.dismissedSources !== undefined) {
      dismissedSourcesRef.current = new Set(data.dismissedSources);
    }
  }, [data.dismissedSources]);

  // 1. 图书与文本同步
  const bookFingerprint = useMemo(() => bookMetadataFingerprint(upstreamBookData), [upstreamBookData]);
  const initialArticleRef = useRef<EditorialArticleData | undefined>(undefined);
  if (initialArticleRef.current === undefined) {
    initialArticleRef.current = data.article || defaultArticle;
  }

  const appendedTexts = useMemo(
    () => (upstreamTexts || []).map((t) => (t || '').trim()).filter(Boolean),
    [upstreamTexts]
  );
  const appendedSignature = useMemo(() => appendedTexts.join('\u0000'), [appendedTexts]);

  const lastBookFingerprintRef = useRef<string>('');
  const lastAppendedRef = useRef<string>('');
  const lastPresetIdRef = useRef<string>(presetId);

  useEffect(() => {
    const templateChanged = lastPresetIdRef.current !== presetId;
    if (templateChanged) lastPresetIdRef.current = presetId;
    const bookChanged =
      Boolean(bookFingerprint) &&
      (templateChanged || bookFingerprint !== lastBookFingerprintRef.current);
    const textsChanged = templateChanged || appendedSignature !== lastAppendedRef.current;
    if (!bookChanged && !textsChanged) return;
    if (bookChanged) lastBookFingerprintRef.current = bookFingerprint;
    if (textsChanged) lastAppendedRef.current = appendedSignature;

    const patch =
      upstreamBookData && (bookChanged || templateChanged)
        ? mapBookToEditorialArticle(upstreamBookData)
        : {};

    setArticle((prev) => {
      const merged = { ...prev };

      // 1) 图书元数据 → 各字段（只填空/占位字段，保留用户修改）
      for (const [key, value] of Object.entries(patch)) {
        const k = key as keyof EditorialArticleData;
        const cur = String(prev[k] ?? '');
        const def = String(defaultArticle[k] ?? '');
        const seed = String(initialArticleRef.current?.[k] ?? '');
        if (isEditorialFieldFillable(cur, def, seed)) {
          merged[k] = value as string;
        }
      }

      // 2) 其他文本 → 追加到正文
      if (appendedTexts.length > 0) {
        const bookBody = String(patch.body ?? '').trim();
        const curBody = String(merged.body ?? '').trim();
        const seedBody = String(initialArticleRef.current?.body ?? '');
        let baseBody = '';
        if (bookBody) {
          baseBody = bookBody;
        } else if (!isEditorialFieldFillable(curBody, String(defaultArticle.body ?? ''), seedBody)) {
          baseBody = curBody;
        }
        merged.body = [baseBody, ...appendedTexts].filter(Boolean).join('\n\n');
      }

      onUpdateState?.(id, { article: merged });
      return merged;
    });
  }, [
    presetId,
    bookFingerprint,
    appendedSignature,
    appendedTexts,
    upstreamBookData,
    defaultArticle,
    id,
    onUpdateState,
    setArticle,
  ]);

  // 2. 多图并集装载并探测真实自然宽高比
  useEffect(() => {
    if (!upstreamImages || upstreamImages.length === 0) return;

    let isMounted = true;
    (async () => {
      const existingUrls = new Set(items.map((it) => it.src));
      const toAdd = upstreamImages.filter(
        (url) => url && !existingUrls.has(url) && !dismissedSourcesRef.current.has(url)
      );
      if (toAdd.length === 0) return;

      const defaultPlacements = [
        { x: 52, y: 14, width: 42, height: 48 },
        { x: 6, y: 58, width: 38, height: 34 },
        { x: 52, y: 64, width: 42, height: 30 },
      ];

      const newItems: EditorialImageItem[] = [];
      for (let idx = 0; idx < toAdd.length; idx++) {
        const imgUrl = toAdd[idx]!;
        const ar = await probeImageAspectRatio(imgUrl);
        const p = defaultPlacements[(items.length + idx) % defaultPlacements.length]!;

        newItems.push({
          id: `img_${Date.now()}_${idx}`,
          src: imgUrl,
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

      if (!isMounted || newItems.length === 0) return;
      setItems((prev) => {
        const merged = [...prev, ...newItems];
        onUpdateState?.(id, { images: merged });
        return merged;
      });
    })();

    return () => {
      isMounted = false;
    };
  }, [upstreamImages, id, onUpdateState, items, setItems]);

  return {
    dismissedSourcesRef,
  };
}
