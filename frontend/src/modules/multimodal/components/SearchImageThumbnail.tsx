import React, { memo, useState, useCallback, useEffect } from 'react';
import { ImageOff, RotateCcw } from 'lucide-react';
import { PhotoView } from 'react-photo-view';

export interface SearchImageThumbnailProps {
  /** 缩略图地址（优先加载） */
  thumbUrl: string;
  /** 高清预览图地址（PhotoView 及 fallback 加载） */
  previewUrl: string;
  /** 描述或标题（用于辅助标签） */
  alt?: string;
  className?: string;
}

/**
 * 通用检索图片缩略图组件：
 * 1. 免疫 Referer 防盗链（referrerPolicy="no-referrer"）
 * 2. 多级自动 Fallback：thumbUrl 失败后自动尝试 previewUrl
 * 3. 骨架屏（Skeleton）与平滑淡入（Fade-in）
 * 4. 失败状态优雅占位与单图独立重试
 */
export const SearchImageThumbnail: React.FC<SearchImageThumbnailProps> = memo(({
  thumbUrl,
  previewUrl,
  alt = '',
  className = '',
}) => {
  const [currentSrc, setCurrentSrc] = useState<string>(thumbUrl);
  const [hasTriedFallback, setHasTriedFallback] = useState(false);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [retryKey, setRetryKey] = useState(0);

  // 外部传入 thumbUrl 变更时同步重置内部状态
  useEffect(() => {
    setCurrentSrc(thumbUrl);
    setHasTriedFallback(false);
    setStatus('loading');
  }, [thumbUrl]);

  const handleError = useCallback(() => {
    // 若 thumbUrl 加载失败且存在不同的 previewUrl，自动尝试一次 previewUrl 回退
    if (!hasTriedFallback && previewUrl && previewUrl !== currentSrc) {
      setHasTriedFallback(true);
      setCurrentSrc(previewUrl);
      setStatus('loading');
      return;
    }
    setStatus('error');
  }, [hasTriedFallback, previewUrl, currentSrc]);

  const handleLoad = useCallback(() => {
    setStatus('loaded');
  }, []);

  const handleRetry = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setStatus('loading');
    setHasTriedFallback(false);
    const separator = thumbUrl.includes('?') ? '&' : '?';
    setCurrentSrc(`${thumbUrl}${separator}_retry=${Date.now()}`);
    setRetryKey((k) => k + 1);
  }, [thumbUrl]);

  return (
    <div className={`relative w-full aspect-square overflow-hidden bg-paper-grid/20 flex items-center justify-center select-none ${className}`}>
      {/* 骨架屏占位：加载中展示轻量脉冲微光 */}
      {status === 'loading' && (
        <div className="absolute inset-0 bg-paper-grid/30 animate-pulse pointer-events-none" />
      )}

      {/* 加载失败状态：优雅占位与单图重试 */}
      {status === 'error' ? (
        <div className="flex flex-col items-center justify-center p-2 text-center text-ink-faint gap-1 z-10">
          <ImageOff size={18} strokeWidth={1.5} className="text-ink-faint/70" />
          <span className="text-[9px] font-sans text-ink-faint">加载失败</span>
          <button
            type="button"
            onClick={handleRetry}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-paper border border-paper-grid text-[9px] text-ink-light hover:text-ink hover:border-accent active:scale-[0.96] transition-all"
            title="重新尝试加载此图片"
          >
            <RotateCcw size={9} strokeWidth={2} />
            <span>重试</span>
          </button>
        </div>
      ) : (
        <PhotoView src={previewUrl || currentSrc}>
          <img
            key={retryKey}
            src={currentSrc}
            alt={alt}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={handleError}
            onLoad={handleLoad}
            className={`w-full h-full object-cover cursor-zoom-in group-hover:opacity-90 text-transparent select-none transition-opacity duration-200 ${
              status === 'loaded' ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          />
        </PhotoView>
      )}
    </div>
  );
});

SearchImageThumbnail.displayName = 'SearchImageThumbnail';
export default SearchImageThumbnail;
