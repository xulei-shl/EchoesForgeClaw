import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Heart, Globe, Shuffle, Pencil } from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Select } from '../../../platform/components/ui/Select';
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
  prepareCardDocument,
  randomDecorIndex,
  renderCardToDataUrl,
  mergeBookCardFields,
  waitForCardAssets,
} from '../bookcard';
import type { BookCardState, BookCardMetaField } from '../bookcard';
import { DEFAULT_META_FIELD_LABELS } from '../bookcard/types';

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
  /** 直连图片输出上级的图片列表（供用户分配封面/装饰角色） */
  connectedImages?: string[];
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
  connectedImages = [],
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

  const templateOptions = useMemo(
    () =>
      BOOK_CARD_TEMPLATES.map((t) => ({
        value: t.id,
        label: t.name,
      })),
    []
  );

  const patchState = useCallback(
    (patch: Partial<BookCardState>) => onUpdateState?.(id, patch),
    [id, onUpdateState]
  );

  const fieldOptions = data.fieldOptions ?? {};
  const patchFieldOption = useCallback(
    (patch: Partial<BookCardState['fieldOptions']>) => {
      patchState({ fieldOptions: { ...fieldOptions, ...patch } });
    },
    [fieldOptions, patchState]
  );

  // 用户编辑元数据字段（持久化，覆盖上游图书元数据）
  const metaFields = data.metaFields ?? [];
  const extraFields = data.extraFields ?? {};

  const patchMetaField = useCallback(
    (key: string, value: string) => {
      const existing = metaFields.find((f) => f.key === key);
      const next: BookCardMetaField[] = existing
        ? metaFields.map((f) => (f.key === key ? { ...f, value } : f))
        : [...metaFields, { key, label: DEFAULT_META_FIELD_LABELS[key] || key, value, visible: true }];
      patchState({ metaFields: next });
    },
    [metaFields, patchState]
  );

  const patchExtraField = useCallback(
    (key: string, value: string) => {
      patchState({ extraFields: { ...extraFields, [key]: value } });
    },
    [extraFields, patchState]
  );

  const clearMetaFields = useCallback(() => {
    patchState({ metaFields: [], extraFields: {} });
  }, [patchState]);

  // 编辑浮层状态
  const [isEditing, setIsEditing] = useState(false);
  const [editingFocus, setEditingFocus] = useState<string | null>(null);

  // 用户指定的连入图片角色下标（null = 使用默认来源）
  const coverImageIndex = data.coverImageIndex ?? null;
  const decorImageIndex = data.decorImageIndex ?? null;

  // 封面图优先级：连入图片指定封面 > 图书元数据封面
  const coverUrl = useMemo(() => {
    if (coverImageIndex != null && connectedImages[coverImageIndex]) {
      return connectedImages[coverImageIndex];
    }
    return upstreamBookData?.cover_image_local || upstreamBookData?.cover_image || upstreamBookData?.coverUrl || null;
  }, [coverImageIndex, connectedImages, upstreamBookData]);

  // 装饰图优先级：连入图片指定装饰 > 装饰图池随机
  const decorUrl = useMemo(() => {
    if (decorImageIndex != null && connectedImages[decorImageIndex]) {
      return connectedImages[decorImageIndex];
    }
    return DECOR_IMAGES.length > 0
      ? DECOR_IMAGES[(((decorIndex ?? 0) % DECOR_IMAGES.length) + DECOR_IMAGES.length) % DECOR_IMAGES.length]
      : null;
  }, [decorImageIndex, connectedImages, decorIndex]);

  // 填充后的 HTML：预览与导出共用同一份字符串（所见即所得由构造保证）。
  // 二维码为异步生成（索书号等字段值 → vufind 链接 data URL），故整体走 effect 而非同步 useMemo。
  const [filledHtml, setFilledHtml] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fields = mergeBookCardFields(upstreamBookData, metaFields, extraFields, fieldOptions);
      let qrcodeUrl: string | null = null;
      if (fields.CALL_NUMBER) {
        try {
          qrcodeUrl = await generateCardQrDataUrl(fields.CALL_NUMBER);
        } catch {
          qrcodeUrl = null;
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
  }, [templateId, upstreamBookData, metaFields, extraFields, coverUrl, decorUrl, fieldOptions]);

  // ---------- 预览（缩放 iframe） ----------
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [cardSize, setCardSize] = useState({ width: 850, height: 1200 });
  const [fitScale, setFitScale] = useState(0.4);

  // 输入变化防抖后刷新预览 HTML
  useEffect(() => {
    const timer = window.setTimeout(() => setPreviewHtml(filledHtml), 200);
    return () => window.clearTimeout(timer);
  }, [filledHtml]);

  const remeasureFit = useCallback(
    (natural?: { width: number; height: number }) => {
      const targetSize = natural || cardSize;
      if (natural) {
        setCardSize(natural);
      }
      const container = containerRef.current;
      if (!container || !targetSize.width || !targetSize.height) return;
      const padding = 16;
      const availWidth = Math.max(10, container.clientWidth - padding);
      const availHeight = Math.max(10, container.clientHeight - padding);
      const scale = Math.min(1, availWidth / targetSize.width, availHeight / targetSize.height);
      setFitScale(Math.max(0.05, scale));
    },
    [cardSize]
  );

  const handlePreviewLoad = useCallback(async () => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc?.body) return;

    // 1. 注入文档重置样式（消除 body 默认 padding/margin 并解除 100vh 限制）
    prepareCardDocument(doc);

    // 2. 测量初始自然尺寸（临时给 iframe 宽大测量视口，防止小视口挤压导致换行或变形）
    iframe.style.width = '1920px';
    iframe.style.height = '1920px';
    const initialSize = measureCardRoot(doc);
    setCardSize(initialSize);
    iframe.style.width = `${initialSize.width}px`;
    iframe.style.height = `${initialSize.height}px`;
    remeasureFit(initialSize);

    // 3. 等待所有图片与字体就绪后再次精确校准（防止异步图片撑开高度）
    try {
      await waitForCardAssets(doc);
      if (iframeRef.current?.contentDocument === doc) {
        iframe.style.width = '1920px';
        iframe.style.height = '1920px';
        const finalSize = measureCardRoot(doc);
        setCardSize(finalSize);
        iframe.style.width = `${finalSize.width}px`;
        iframe.style.height = `${finalSize.height}px`;
        remeasureFit(finalSize);
      }
    } catch {
      // 忽略图片加载超时
    }
  }, [remeasureFit]);

  // 容器尺寸变化时按当前自然尺寸重算缩放
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => remeasureFit());
    observer.observe(container);
    return () => observer.disconnect();
  }, [remeasureFit]);

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

  const usingConnectedDecor = decorImageIndex != null && connectedImages[decorImageIndex] != null;

  const handleShuffleDecor = useCallback(() => {
    if (usingConnectedDecor) {
      patchState({ decorImageIndex: null, imageUrl: null });
      showToast('已恢复装饰图池随机', { type: 'success' });
      return;
    }
    const next = randomDecorIndex(decorIndex);
    if (next == null) return;
    patchState({ decorIndex: next, imageUrl: null });
  }, [decorIndex, usingConnectedDecor, patchState, showToast]);

  // 生成并保存：渲染 PNG → 落盘 + 历史记录（同小票链路）
  const handleGenerateAndSave = useCallback(async () => {
    if (!onExport) return;
    if (!upstreamBookData && metaFields.length === 0 && Object.keys(extraFields).length === 0) {
      showToast('请连线图书元数据节点，或先在编辑面板中手动填写元数据', { type: 'error' });
      return;
    }
    setIsRendering(true);
    try {
      const dataUrl = await renderCardToDataUrl(filledHtml, { pixelRatio: 2 });
      await onExport(id, dataUrl, { templateId, decorIndex, coverImageIndex, decorImageIndex });
      showToast('卡片已生成并保存到历史记录', { type: 'success' });
    } catch (err: any) {
      console.error('生成图书卡片失败:', err);
      showToast(err?.message || '生成卡片失败，请重试', { type: 'error' });
    } finally {
      setIsRendering(false);
    }
  }, [filledHtml, id, onExport, showToast, templateId, decorIndex, upstreamBookData, metaFields, extraFields]);

  const handleDirectDownload = useCallback(async () => {
    if (!filledHtml) {
      showToast('卡片内容为空，请先填写元数据', { type: 'error' });
      return;
    }
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
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2 relative">
        {/* 顶部控制栏（单行紧凑整合：模板选择 + 换装饰图 + 字段选项） */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 p-1.5 bg-paper-grid/15 border border-paper-grid/60 rounded-md text-xs font-sans">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[11px] text-ink-faint shrink-0">模板</span>
            <Select
              size="sm"
              value={templateId}
              disabled={busy || hasDownstream}
              onChange={handleTemplateChange}
              options={templateOptions}
              className="w-28 sm:w-32 min-w-[100px]"
            />
            <button
              type="button"
              onClick={handleShuffleDecor}
              disabled={busy || hasDownstream || (!usingConnectedDecor && !hasDecorImages())}
              title={
                usingConnectedDecor
                  ? '清除装饰图角色分配，恢复图池随机'
                  : hasDecorImages()
                    ? '换一张装饰图'
                    : '未提供装饰图素材（放入 src/assets/card-decor/ 后可用）'
              }
              className="flex items-center gap-1 h-8 px-2 rounded-md border border-dashed border-paper-grid hover:border-accent hover:text-accent text-ink-faint active:scale-[0.96] transition-all text-xs shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Shuffle size={13} strokeWidth={1.5} />
              <span>{usingConnectedDecor ? '恢复图池' : '换图'}</span>
            </button>
          </div>

          {/* 编辑元数据按钮 */}
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            disabled={busy || hasDownstream}
            title={hasDownstream ? '有下级节点，不可编辑元数据' : '编辑卡片元数据（题名、作者、索书号等）'}
            className="flex items-center gap-1 h-8 px-2 rounded-md border border-dashed border-paper-grid hover:border-accent hover:text-accent text-ink-faint active:scale-[0.96] transition-all text-xs shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Pencil size={13} strokeWidth={1.5} />
            <span>编辑</span>
          </button>

          {/* 字段处理选项（行内紧凑放置，受 hasDownstream 控制） */}
          <div className="flex items-center gap-2.5 text-[11px] text-ink-faint shrink-0">
            <label
              className={`flex items-center gap-1 select-none transition-colors ${
                busy || hasDownstream ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:text-ink'
              }`}
              title={hasDownstream ? '有下级节点，不可修改选项' : undefined}
            >
              <input
                type="checkbox"
                checked={fieldOptions.showSubtitle !== false}
                disabled={busy || hasDownstream}
                onChange={(e) => patchFieldOption({ showSubtitle: e.target.checked })}
                className="accent-accent w-3.5 h-3.5 disabled:cursor-not-allowed"
              />
              <span>副题名</span>
            </label>
            <label
              className={`flex items-center gap-1 select-none transition-colors ${
                busy || hasDownstream ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:text-ink'
              }`}
              title={hasDownstream ? '有下级节点，不可修改选项' : undefined}
            >
              <input
                type="checkbox"
                checked={fieldOptions.firstAuthorOnly === true}
                disabled={busy || hasDownstream}
                onChange={(e) => patchFieldOption({ firstAuthorOnly: e.target.checked })}
                className="accent-accent w-3.5 h-3.5 disabled:cursor-not-allowed"
              />
              <span>仅首作者</span>
            </label>
          </div>
        </div>

        {/* 连入图片角色分配（直连图片输出上级时显示） */}
        {connectedImages.length > 0 && (
          <div className="flex flex-col gap-1 px-1.5 py-1.5 rounded-md border border-paper-grid/40 bg-paper-grid/10">
            <div className="flex items-center justify-between text-[10px] text-ink-faint font-sans px-0.5">
              <span>连入图片角色</span>
              <span className="text-[9px] text-ink-faint/70">点击分配或取消</span>
            </div>
            {connectedImages.map((img, idx) => {
              const isCover = coverImageIndex === idx;
              const isDecor = decorImageIndex === idx;
              const hasRole = isCover || isDecor;
              const roleDisabled = busy || hasDownstream;
              return (
                <div
                  key={idx}
                  className={`flex items-center gap-2 text-xs rounded-md px-1.5 py-1 transition-all ${
                    roleDisabled
                      ? 'opacity-60'
                      : hasRole
                        ? 'bg-accent/8 border border-accent/20'
                        : 'hover:bg-paper-grid/15'
                  }`}
                >
                  <img
                    src={img}
                    alt=""
                    className="w-5 h-7 object-cover rounded border border-paper-grid/80 shrink-0 bg-paper-grid/30 shadow-2xs"
                  />
                  <span className="truncate text-ink-light flex-1 text-[11px] font-mono">
                    img_{idx + 1}
                  </span>
                  <div className="inline-flex items-center rounded-md border border-paper-grid/60 bg-paper p-0.5 gap-0.5 shrink-0 shadow-2xs">
                    <button
                      type="button"
                      onClick={() => patchState({ coverImageIndex: isCover ? null : idx, imageUrl: null })}
                      disabled={roleDisabled}
                      title={hasDownstream ? '有下级节点，不可修改角色' : isCover ? '点击取消设为封面' : '设为卡片封面'}
                      className={`px-2 py-0.5 rounded text-[10px] font-sans transition-all active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 ${
                        isCover
                          ? 'bg-accent text-white font-medium shadow-xs'
                          : 'text-ink-light hover:text-ink hover:bg-paper-grid/40'
                      }`}
                    >
                      封面
                    </button>
                    <button
                      type="button"
                      onClick={() => patchState({ decorImageIndex: isDecor ? null : idx, imageUrl: null })}
                      disabled={roleDisabled}
                      title={hasDownstream ? '有下级节点，不可修改角色' : isDecor ? '点击取消设为装饰图' : '设为卡片装饰图'}
                      className={`px-2 py-0.5 rounded text-[10px] font-sans transition-all active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 ${
                        isDecor
                          ? 'bg-accent text-white font-medium shadow-xs'
                          : 'text-ink-light hover:text-ink hover:bg-paper-grid/40'
                      }`}
                    >
                      装饰
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 编辑元数据浮层 */}
        {isEditing && !busy && !hasDownstream && (
          <div className="absolute inset-0 z-40 bg-paper/98 backdrop-blur-sm p-3 flex flex-col rounded shadow-2xl border border-paper-grid/60 overflow-hidden select-text">
            <div className="flex items-center justify-between border-b border-paper-grid/40 pb-2 mb-2 shrink-0">
              <span className="text-[12px] font-bold text-ink flex items-center gap-1.5">
                <Pencil size={14} strokeWidth={1.5} />
                编辑卡片元数据
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { clearMetaFields(); setEditingFocus(null); }}
                  title="清除所有用户编辑，恢复为上游元数据默认值"
                  className="px-2 py-0.5 rounded text-[10px] border border-paper-grid/60 text-ink-faint hover:text-red-500 hover:border-red-300 transition-all"
                >
                  重置
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-2.5 py-0.5 bg-accent hover:bg-accent/90 active:bg-accent/80 text-white rounded text-[11px] font-medium shadow-xs transition-colors"
                >
                  完成
                </button>
              </div>
            </div>
            <div className="grow overflow-y-auto space-y-2.5 pr-0.5 text-[11px]">
              {([
                { key: 'title', label: '题名', placeholder: '图书题名', multiline: false },
                { key: 'author', label: '作者', placeholder: '著者姓名', multiline: false },
                { key: 'publisher', label: '出版社', placeholder: '出版机构', multiline: false },
                { key: 'pub_year', label: '出版年份', placeholder: '如 2024', multiline: false },
                { key: 'rating', label: '评分', placeholder: '如 9.0', multiline: false },
                { key: 'recommendation', label: '推荐语', placeholder: '推荐语（自动截断至 50 字）', multiline: true },
              ] as const).map((item) => {
                const { key, label, placeholder, multiline } = item;
                const metaField = metaFields.find((f) => f.key === key);
                const upstreamValue = upstreamBookData
                  ? (key === 'title' ? upstreamBookData.title :
                     key === 'author' ? upstreamBookData.author :
                     key === 'publisher' ? upstreamBookData.publisher :
                     key === 'pub_year' ? (upstreamBookData.pub_year || upstreamBookData.publishDate) :
                     key === 'rating' ? String(upstreamBookData.rating ?? '') :
                     key === 'recommendation' ? (upstreamBookData.summary || upstreamBookData.description) : '')
                  : '';
                const displayValue = String(metaField?.value ?? upstreamValue ?? '');
                return (
                  <div key={key}>
                    <label className="block font-semibold text-ink mb-0.5">{label}</label>
                    {multiline ? (
                      <textarea
                        autoFocus={editingFocus === key}
                        value={displayValue}
                        onChange={(e) => patchMetaField(key, e.target.value)}
                        placeholder={placeholder}
                        rows={3}
                        className="w-full px-2 py-1 bg-paper-grid/15 border border-paper-grid/50 focus:border-accent focus:bg-paper focus:ring-1 focus:ring-accent/30 rounded outline-none text-[12px] transition-all resize-y min-h-[60px]"
                      />
                    ) : (
                      <input
                        type="text"
                        autoFocus={editingFocus === key}
                        value={displayValue}
                        onChange={(e) => patchMetaField(key, e.target.value)}
                        placeholder={placeholder}
                        className="w-full px-2 py-1 bg-paper-grid/15 border border-paper-grid/50 focus:border-accent focus:bg-paper focus:ring-1 focus:ring-accent/30 rounded outline-none text-[12px] transition-all"
                      />
                    )}
                  </div>
                );
              })}
              {/* 索书号（独立显示，元数据节点不提供，专为兜底手动添加） */}
              <div className="pt-1.5 border-t border-paper-grid/30">
                <label className="block font-semibold text-ink mb-0.5">
                  索书号
                  <span className="text-[10px] text-ink-faint font-normal ml-1">（元数据节点不提供，手动输入后自动生成二维码）</span>
                </label>
                <input
                  type="text"
                  autoFocus={editingFocus === 'call_number'}
                  value={extraFields.CALL_NUMBER || metaFields.find((f) => f.key === 'call_number')?.value || ''}
                  onChange={(e) => patchExtraField('CALL_NUMBER', e.target.value)}
                  placeholder="如 I247.5/1234"
                  className="w-full px-2 py-1 bg-paper-grid/15 border border-paper-grid/50 focus:border-accent focus:bg-paper focus:ring-1 focus:ring-accent/30 rounded outline-none text-[12px] transition-all"
                />
              </div>
            </div>
          </div>
        )}

        {/* 预览区域：填充后 HTML 的等比缩放实时预览（与导出同一份 HTML 字符串） */}
        <div
          ref={containerRef}
          className="flex-1 min-h-0 overflow-hidden rounded bg-paper-grid/10 border border-paper-grid/40 flex items-center justify-center p-2 select-none"
        >
          {/* 缩放外壳：真实占位大小 = cardSize * fitScale，让 Flex 容器精准居中 */}
          <div
            className="relative rounded overflow-hidden shadow-md shrink-0 bg-white"
            style={{
              width: Math.max(1, Math.round(cardSize.width * fitScale)),
              height: Math.max(1, Math.round(cardSize.height * fitScale)),
            }}
          >
            {/* 内部绝对定位层：真实尺寸 cardSize，以 top left 为原点等比缩小 */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: cardSize.width,
                height: cardSize.height,
                transform: `scale(${fitScale})`,
                transformOrigin: 'top left',
              }}
            >
              <iframe
                ref={iframeRef}
                title="图书卡片预览"
                sandbox="allow-same-origin allow-scripts"
                srcDoc={previewHtml}
                onLoad={handlePreviewLoad}
                className="border-0 bg-transparent block"
                style={{
                  width: cardSize.width,
                  height: cardSize.height,
                  pointerEvents: 'none',
                }}
              />
            </div>
          </div>
        </div>

        {!upstreamBookData && metaFields.length === 0 && Object.keys(extraFields).length === 0 && (
          <div className="text-right text-xs text-ink-faint font-sans">
            未连线图书元数据 · 请点击「编辑」手动填写
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
