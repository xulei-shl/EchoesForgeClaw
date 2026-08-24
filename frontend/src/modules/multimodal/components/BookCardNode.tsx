import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Heart, Globe, Shuffle } from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  BOOK_CARD_TEMPLATES,
  DECOR_IMAGES,
  DEFAULT_BOOK_CARD_TEMPLATE_ID,
  buildCardHtml,
  downloadBookCardImage,
  generateCardQrDataUrl,
  getBookCardTemplate,
  hasDecorImages,
  measureCardRoot,
  randomDecorIndex,
  renderCardToDataUrl,
  resolveCardFields,
} from '../bookcard';
import type { BookCardState } from '../bookcard';

/** 图书卡片节点的图书元数据输入（与 receipt 共用豆瓣 API 兼容结构） */
interface CardBookMetadata {
  title?: string;
  subtitle?: string;
  author?: string;
  publisher?: string;
  pub_year?: string;
  rating?: number | string;
  summary?: string;
  description?: string;
  coverUrl?: string;
  cover_image?: string;
  cover_image_local?: string;
  [key: string]: unknown;
}

export interface BookCardNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 节点持久化数据 */
  data?: Partial<BookCardState> & {
    error?: string | null;
    isExporting?: boolean;
  };
  /** 上游图书元数据（直连 book_info，兜底画布根节点） */
  upstreamBookData?: CardBookMetadata | null;
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
  hasDownstream?: boolean;
  mismatchBadge?: string | null;
  /** 状态更新写入 node.data（持久化） */
  onUpdateState?: (id: string, patch: Partial<BookCardState>) => void;
  /** 导出卡片：PNG data URL 落盘保存 + 写入历史记录数据库 */
  onExport?: (id: string, dataUrl: string, state: BookCardState) => Promise<void>;
}

const BookCardNodeInner: React.FC<BookCardNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  data = {},
  upstreamBookData,
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
  hasDownstream,
  mismatchBadge,
  onUpdateState,
  onExport,
}) => {
  const { showToast } = useFeedback();
  const [isRendering, setIsRendering] = useState(false);

  // 模板 / 装饰图状态（装饰图未持久化时懒初始化随机值，模拟原图库随机选图）
  const templateId = data.templateId ?? DEFAULT_BOOK_CARD_TEMPLATE_ID;
  const [lazyDecorIndex] = useState(() => randomDecorIndex(null));
  const decorIndex = data.decorIndex ?? lazyDecorIndex;

  const patchState = useCallback(
    (patch: Partial<BookCardState>) => onUpdateState?.(id, patch),
    [id, onUpdateState]
  );

  // 封面图：直接取图书元数据节点（本地代理图优先，跨域远程图兜底）
  const coverUrl =
    upstreamBookData?.cover_image_local || upstreamBookData?.cover_image || upstreamBookData?.coverUrl || null;

  // 装饰图：图池按下标取（对应原 card_generator 从文件夹随机选 b-*.png）
  const decorUrl = DECOR_IMAGES.length > 0 ? DECOR_IMAGES[((decorIndex ?? 0) % DECOR_IMAGES.length + DECOR_IMAGES.length) % DECOR_IMAGES.length] : null;

  // 填充后的 HTML：预览与导出共用同一份字符串（所见即所得由构造保证）。
  // 二维码为异步生成（索书号等字段值 → vufind 链接 data URL），故整体走 effect 而非同步 useMemo。
  const [filledHtml, setFilledHtml] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fields = resolveCardFields(upstreamBookData);
      let qrcodeUrl: string | null = null;
      if (fields.CALL_NUMBER) {
        try {
          qrcodeUrl = await generateCardQrDataUrl(fields.CALL_NUMBER);
        } catch {
          qrcodeUrl = null; // 出码失败回退透明占位，不阻断渲染
        }
      }
      if (!cancelled) {
        setFilledHtml(
          buildCardHtml({
            templateHtml: getBookCardTemplate(templateId).html,
            fields,
            coverUrl,
            decorUrl,
            qrcodeUrl,
          })
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId, upstreamBookData, coverUrl, decorUrl]);

  // ---------- 预览（缩放 iframe） ----------
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [cardSize, setCardSize] = useState({ width: 800, height: 1200 });
  const [fitScale, setFitScale] = useState(0.4);

  // 输入变化防抖后刷新预览 HTML
  useEffect(() => {
    const timer = window.setTimeout(() => setPreviewHtml(filledHtml), 300);
    return () => window.clearTimeout(timer);
  }, [filledHtml]);

  const remeasureFit = useCallback((natural: { width: number; height: number }) => {
    setCardSize(natural);
    const container = containerRef.current;
    if (!container || !natural.width || !natural.height) return;
    const scale = Math.min(
      1,
      (container.clientWidth - 8) / natural.width,
      (container.clientHeight - 8) / natural.height
    );
    setFitScale(Math.max(0.05, scale));
  }, []);

  const handlePreviewLoad = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.body) return;
    remeasureFit(measureCardRoot(doc));
  }, [remeasureFit]);

  // 容器尺寸变化时按当前自然尺寸重算缩放
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => remeasureFit(cardSize));
    observer.observe(container);
    return () => observer.disconnect();
  }, [cardSize, remeasureFit]);

  // ---------- 交互 ----------
  const runToggle = async (
    fn: ((id: string) => Promise<boolean>) | undefined,
    okMsg: (active: boolean) => string
  ) => {
    if (!fn) return;
    try {
      const active = await fn(id);
      showToast(okMsg(active));
    } catch {
      showToast('操作失败，请重试');
    }
  };

  /** 切换模板 / 换装饰图：内容即产物口径——旧生成结果立即失效（对齐图片处理节点） */
  const handleTemplateChange = useCallback(
    (nextTemplateId: string) => {
      if (nextTemplateId === templateId) return;
      patchState({ templateId: nextTemplateId, imageUrl: null });
    },
    [templateId, patchState]
  );

  const handleShuffleDecor = useCallback(() => {
    const next = randomDecorIndex(decorIndex);
    if (next == null) return;
    patchState({ decorIndex: next, imageUrl: null });
  }, [decorIndex, patchState]);

  // 生成并保存：渲染 PNG → 落盘 + 历史记录（同小票链路）
  const handleGenerateAndSave = useCallback(async () => {
    if (!onExport) return;
    if (!upstreamBookData) {
      showToast('请先连线图书元数据节点（或画布中存在根书目节点）', { type: 'error' });
      return;
    }
    setIsRendering(true);
    try {
      const dataUrl = await renderCardToDataUrl(filledHtml, { pixelRatio: 2 });
      await onExport(id, dataUrl, { templateId, decorIndex });
      showToast('卡片已生成并保存到历史记录', { type: 'success' });
    } catch (err: any) {
      console.error('生成图书卡片失败:', err);
      showToast(err?.message || '生成卡片失败，请重试', { type: 'error' });
    } finally {
      setIsRendering(false);
    }
  }, [filledHtml, id, onExport, showToast, templateId, decorIndex, upstreamBookData]);

  const handleDirectDownload = useCallback(async () => {
    try {
      await downloadBookCardImage(filledHtml);
      showToast('卡片图片已下载', { type: 'success' });
    } catch (err: any) {
      console.error('下载图书卡片失败:', err);
      showToast('下载失败，请重试', { type: 'error' });
    }
  }, [filledHtml, showToast]);

  const hasGeneratedImage = Boolean(data?.imageUrl);
  const busy = isRendering || Boolean(data?.isExporting);

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '图书卡片'}
      dotColor={NODE_COLORS.book_card || 'oklch(0.66 0.15 15)'}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 440, height: 640 }}
      className={`transition-[opacity,transform,box-shadow,border-color] duration-150 ease-out ${isSelected ? 'ring-2 ring-accent/70 shadow-md' : ''}`}
      showLeftAnchor={true}
      showRightAnchor={true}
      onClick={() => onSelect?.(id)}
      footer={footer}
      mismatchBadge={mismatchBadge}
      actionBar={
        <NodeActionBar>
          <NodeActionBar.Custom
            icon={
              busy ? (
                <Loader2 size={16} className="animate-spin text-accent" />
              ) : (
                <ImageIcon size={16} strokeWidth={1.5} />
              )
            }
            tooltip="生成并保存卡片（记录到数据库）"
            downstreamTooltip="有下级节点，不可保存"
            onClick={handleGenerateAndSave}
            disabled={busy}
            hasDownstream={hasDownstream}
          />
          <NodeActionBar.Custom
            icon={<Heart size={16} strokeWidth={1.5} className={isFavorited ? 'fill-accent text-accent' : ''} />}
            tooltip={isFavorited ? '取消收藏' : '收藏'}
            onClick={() => runToggle(onToggleFavorite, (active) => (active ? '已收藏' : '已取消收藏'))}
            disabled={!hasGeneratedImage || busy || !onToggleFavorite}
          />
          <NodeActionBar.Custom
            icon={<Globe size={16} strokeWidth={1.5} className={isPublic ? 'text-accent' : ''} />}
            tooltip={isPublic ? '从画廊撤下' : '公开到画廊'}
            onClick={() => runToggle(onTogglePublic, (active) => (active ? '已公开' : '已撤下'))}
            disabled={!hasGeneratedImage || busy || !onTogglePublic}
          />
          <NodeActionBar.Download
            onClick={handleDirectDownload}
            disabled={busy}
            tooltip="直接下载卡片 PNG"
          />
        </NodeActionBar>
      }
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
        {/* 顶部控制栏（模板选择 + 换装饰图） */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-paper-grid/20 border border-paper-grid rounded-md text-xs font-sans">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[11px] text-ink-faint shrink-0">模板</span>
            <select
              value={templateId}
              disabled={busy || hasDownstream}
              onChange={(e) => handleTemplateChange(e.target.value)}
              title={
                BOOK_CARD_TEMPLATES.find((t) => t.id === templateId)?.name ?? templateId
              }
              className="bg-paper border border-paper-grid text-ink rounded px-2 py-1 text-xs outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60 max-w-[220px] truncate"
            >
              {BOOK_CARD_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleShuffleDecor}
            disabled={busy || hasDownstream || !hasDecorImages()}
            title={hasDecorImages() ? '换一张装饰图' : '未提供装饰图素材（放入 src/assets/card-decor/ 后可用）'}
            className="flex items-center gap-1 text-[11px] text-ink-faint hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Shuffle size={13} strokeWidth={1.5} />
            换装饰图
          </button>
        </div>

        {/* 预览区域：填充后 HTML 的等比缩放实时预览（与导出同一份 HTML 字符串） */}
        <div
          ref={containerRef}
          className="flex-1 min-h-0 overflow-hidden rounded bg-paper-grid/10 border border-paper-grid/40 flex items-start justify-center"
        >
          <div
            style={{
              transform: `scale(${fitScale})`,
              transformOrigin: 'top left',
              width: cardSize.width,
              height: cardSize.height,
            }}
          >
            <iframe
              ref={iframeRef}
              title="图书卡片预览"
              sandbox="allow-same-origin allow-scripts"
              srcDoc={previewHtml}
              onLoad={handlePreviewLoad}
              className="border-0 bg-white"
              style={{ width: cardSize.width, height: cardSize.height, pointerEvents: 'none' }}
            />
          </div>
        </div>

        {!upstreamBookData && (
          <div className="text-right text-xs text-ink-faint font-sans">
            未连线图书元数据 · 卡片内容为空
          </div>
        )}

        {recordDeleted && hasGeneratedImage && !busy && (
          <div className="flex items-center justify-end gap-1.5 text-right text-xs text-ink-faint font-sans">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/60" />
            记录已删除 · 收藏将重新生成记录
          </div>
        )}

        {data.error && (
          <div className="text-right text-xs text-red-500 font-sans">{data.error}</div>
        )}
      </div>
    </CanvasNode>
  );
};

export const BookCardNode = memo(BookCardNodeInner);
BookCardNode.displayName = 'BookCardNode';
export default BookCardNode;
