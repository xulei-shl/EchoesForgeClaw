import React, { memo, useEffect, useRef, useState } from 'react';
import { BookOpen, ExternalLink, Loader2, AlertTriangle, Search, RefreshCw, ImagePlus } from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { BeamGlow } from '../../../platform/components/node/BeamGlow';
import { NODE_COLORS } from '../nodeTypes';

interface BookMetadata {
  isbn: string;
  title: string;
  author: string;
  publisher: string;
  /** 豆瓣客户端返回 snake_case 字段；同时兼容 camelCase 命名 */
  pub_year?: string;
  publishDate?: string;
  cover_image?: string;
  /** 豆瓣原始 URL 的本地缓存地址（优先用于展示） */
  cover_image_local?: string;
  coverUrl?: string;
  summary?: string;
  description?: string;
  rating?: number | string;
  pages?: string | number;
  subtitle?: string;
  translator?: string;
  producer?: string;
  original_title?: string;
  series?: string;
  url?: string;
}

export interface BookInfoNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  data: BookMetadata;
  /** 豆瓣 API 请求进行中 */
  isGenerating?: boolean;
  /** 请求失败的错误信息（显示在组件框内） */
  error?: string | null;
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
  /** 空态节点内联输入 ISBN 后提交 */
  onFetch?: (id: string, isbn: string) => void;
  onDownload?: (id: string) => void;
  /** 强制重新从豆瓣 API 获取数据并覆盖缓存 */
  onForceRefresh?: (id: string) => void;
  /** 手动上传封面（自动下载失败兜底）：落盘 runtime/covers 并回写 book_cache */
  onUploadCover?: (id: string, file: File) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  /** 卡片底部「+」插槽 */
  footer?: React.ReactNode;
  /** 根节点右键菜单回调 */
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const BookInfoNodeInner: React.FC<BookInfoNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  data,
  isGenerating = false,
  error = null,
  onRemove,
  onRetry,
  onFetch,
  onDownload,
  onForceRefresh,
  onUploadCover,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
}) => {
  // 封面加载失败时显示占位图（豆瓣限流/缓存缺失时避免破图）
  const [coverFailed, setCoverFailed] = useState(false);
  // 空态内联 ISBN 输入
  const [isbnInput, setIsbnInput] = useState('');
  const coverInputRef = useRef<HTMLInputElement>(null);
  const coverUrl = data.cover_image_local || data.cover_image || data.coverUrl;
  const publishDate = data.pub_year || data.publishDate;
  const description = data.summary || data.description;

  useEffect(() => {
    setCoverFailed(false);
  }, [coverUrl]);

  // 重试（isGenerating 转 true）时重置失败态，让同一封面 URL 有机会重新加载
  useEffect(() => {
    if (isGenerating) setCoverFailed(false);
  }, [isGenerating]);

  const handleIsbnSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const isbn = isbnInput.trim();
    if (!isbn || isGenerating) return;
    onFetch?.(id, isbn);
  };

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || "图书元数据"}
      dotColor={NODE_COLORS.book_info}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 440, height: 540 }}
      className={`transition-[box-shadow,border-color,opacity] duration-200 ${isGenerating && !error ? 'border-transparent' : ''}`}
      glowOverlay={isGenerating && !error ? <BeamGlow /> : undefined}
      showRightAnchor={true}
      footer={footer}
      actionBar={
        <>
          <NodeActionBar>
          {error && (
            <NodeActionBar.Retry
              onClick={() => onRetry?.(id)}
              disabled={isGenerating}
              error={true}
            />
          )}
          {!error && data.isbn && onDownload && (
            <NodeActionBar.Download
              onClick={() => onDownload?.(id)}
              disabled={isGenerating}
              tooltip="下载元数据"
            />
          )}
          {!error && data.isbn && onForceRefresh && (
            <NodeActionBar.Custom
              icon={<RefreshCw size={16} strokeWidth={1.5} />}
              tooltip="强制更新（重新从豆瓣获取并覆盖缓存）"
              onClick={() => onForceRefresh?.(id)}
              disabled={isGenerating}
            />
          )}
          {!error && data.url && (
            <NodeActionBar.Custom
              icon={<ExternalLink size={16} strokeWidth={1.5} />}
              tooltip="在豆瓣中查看"
              onClick={() => window.open(data.url, '_blank', 'noopener,noreferrer')}
              disabled={isGenerating}
            />
          )}
          {!error && data.isbn && onUploadCover && (
            <NodeActionBar.Custom
              icon={<ImagePlus size={16} strokeWidth={1.5} />}
              tooltip="上传封面（自动下载失败时的兜底）"
              onClick={() => coverInputRef.current?.click()}
              disabled={isGenerating}
            />
          )}
          </NodeActionBar>
          {data.isbn && onUploadCover && (
            <input
              ref={coverInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUploadCover(id, file);
                e.target.value = '';
              }}
            />
          )}
        </>
      }
    >
      <div className="h-full flex flex-col flex-1 min-h-0">
        <div className="relative z-10 flex flex-col gap-4 flex-1 min-h-0">
          {isGenerating ? (
            /* 加载骨架屏 */
            <div className="flex gap-4 w-full">
              <div className="w-28 shrink-0 flex flex-col gap-2">
                <div className="w-full h-40 bg-paper-grid/60 border border-dashed border-paper-grid rounded-sm animate-pulse" />
              </div>
              <div className="flex-1 flex flex-col gap-2.5 min-w-0 justify-center">
                <div className="h-5 bg-paper-grid/60 rounded-sm animate-pulse" style={{ width: '72%' }} />
                <div className="h-4 bg-paper-grid/60 rounded-sm animate-pulse" style={{ width: '48%' }} />
                <div className="h-4 bg-paper-grid/60 rounded-sm animate-pulse" style={{ width: '60%' }} />
                <div className="h-4 bg-paper-grid/60 rounded-sm animate-pulse" style={{ width: '36%' }} />
                <div className="mt-1 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-accent animate-spin" strokeWidth={1.5} />
                  <span className="text-xs font-serif text-accent">正在获取图书信息...</span>
                </div>
              </div>
            </div>
          ) : error ? (
            /* 错误态：组件框内展示错误信息 */
            <div className="flex-1 flex flex-col gap-3 min-h-[180px]">
              <div className="p-3 rounded-md border border-error/20 bg-error/5 flex items-start gap-2.5">
                <AlertTriangle size={14} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 font-sans">
                  <p className="text-[12px] text-error/90 leading-relaxed break-words">{error}</p>
                </div>
              </div>
            </div>
          ) : !data.isbn ? (
            /* 空态：内联输入 ISBN 发起查询 */
            <div className="flex-1 flex flex-col items-center justify-center gap-4 min-h-[200px]">
              <div className="w-14 h-14 rounded-full border border-dashed border-paper-grid bg-paper-grid/20 flex items-center justify-center text-ink-faint">
                <BookOpen size={26} strokeWidth={1.5} />
              </div>
              <p className="text-sm font-serif text-ink-light">输入 ISBN 获取图书元数据</p>
              <form onSubmit={handleIsbnSubmit} className="w-full max-w-[300px] flex gap-2">
                <input
                  value={isbnInput}
                  onChange={(e) => setIsbnInput(e.target.value)}
                  placeholder="如 9787020002207"
                  inputMode="numeric"
                  className="flex-1 h-10 min-w-0 rounded-md border border-dashed border-paper-grid bg-transparent px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors font-mono"
                />
                <button
                  type="submit"
                  disabled={!isbnInput.trim() || isGenerating}
                  className="flex items-center justify-center w-10 h-10 rounded-md bg-accent text-paper hover:bg-accent-hover active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  title="查询"
                >
                  <Search size={15} strokeWidth={2} />
                </button>
              </form>
            </div>
          ) : (
            <>
              {/* 上半部分：封面 + 元数据（左右布局，不收缩） */}
              <div className="flex gap-4 shrink-0">
                {/* Cover */}
                <div className="w-28 shrink-0 flex flex-col gap-2">
                  {coverUrl && !coverFailed ? (
                    <img
                      src={coverUrl}
                      alt={data.title}
                      className="w-full h-40 object-cover rounded-sm outline outline-1 outline-[oklch(0_0_0/0.1)] outline-offset-[-1px]"
                      onError={() => setCoverFailed(true)}
                    />
                  ) : (
                    <div className="w-full h-40 bg-paper-grid/40 border border-dashed border-paper-grid rounded-sm flex items-center justify-center text-ink-faint">
                      <BookOpen size={28} strokeWidth={1.5} />
                    </div>
                  )}
                  {data.rating != null && data.rating !== '' && (
                    <div className="text-xs text-ink-faint text-center tabular-nums">★ {String(data.rating)}</div>
                  )}

                </div>

                {/* Metadata（不含摘要） */}
                <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                  <h3 className="font-serif text-base font-bold text-ink leading-tight break-words" style={{ textWrap: 'balance' }}>{data.title}</h3>
                  {data.subtitle && (
                    <p className="font-serif text-sm text-ink-light leading-tight -mt-0.5 break-words">{data.subtitle}</p>
                  )}

                  <div className="text-sm text-ink-light space-y-0.5">
                    <MetaRow label="作者" value={data.author} />
                    {data.translator && <MetaRow label="译者" value={data.translator} />}
                    {data.publisher && <MetaRow label="出版社" value={data.publisher} />}
                    {data.producer && <MetaRow label="出品方" value={data.producer} />}
                    {publishDate && <MetaRow label="出版年" value={publishDate} />}
                    {data.original_title && <MetaRow label="原作名" value={data.original_title} />}
                    {data.series && <MetaRow label="丛书" value={data.series} />}
                  </div>
                </div>
              </div>

              {/* 下半部分：摘要 */}
              {description && (
                <div className="border-t border-dashed border-paper-grid pt-3 flex-1 min-h-0 overflow-y-auto pr-1">
                  <details className="group" open>
                    <summary className="list-none [&::-webkit-details-marker]:hidden text-sm text-ink-light cursor-pointer hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded w-max select-none shrink-0 mb-1">
                      <span className="inline-flex items-center gap-1">
                        内容摘要
                        <svg className="w-3.5 h-3.5 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                      </span>
                    </summary>
                    <div className="mt-2 text-sm leading-relaxed text-ink font-sans" style={{ textWrap: 'pretty' }}>
                      {description.split('\n').map((line, i) => (
                        <p key={i} className="mb-1 last:mb-0">{line}</p>
                      ))}
                    </div>
                  </details>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </CanvasNode>
  );
};

const MetaRow: React.FC<{ label: string; value?: string }> = ({ label, value }) => {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="text-ink-faint w-14 shrink-0">{label}</span>
      <span className="flex-1 text-ink min-w-0 break-words">{value}</span>
    </div>
  );
};

export const BookInfoNode = memo(BookInfoNodeInner);
BookInfoNode.displayName = 'BookInfoNode';
export default BookInfoNode;
