import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Printer, Loader2, Heart, Globe, Sparkles, Maximize2 } from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  ReceiptPaper,
  ReceiptToolbar,
  exportReceiptImage,
  downloadReceiptImage,
  buildReceiptState,
  type BookMetadataInput,
  type ReceiptState,
} from '../receipt';

export interface ReceiptPrinterNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 节点持久化数据 */
  data?: Partial<ReceiptState> & {
    /** 节点输出图（生成完成的完整小票，供下游 / 画廊读取） */
    imageUrl?: string | null;
    /** 小票内插图（图书封面 / 上游图片 / 自定义上传，与 imageUrl 输出互不覆盖） */
    coverImageUrl?: string | null;
    error?: string | null;
    isExporting?: boolean;
  };
  /** 上游图书元数据（直接上级或上下文注入） */
  upstreamBookData?: BookMetadataInput | null;
  /** 上游图片输出（图片上传 / 图像生成 / 艺术检索等） */
  upstreamImageUrl?: string | null;
  /** 上游文本节点原始文本（如 VuFind 索书号节点的 JSON 输出，解析 CALL_NUMBER 填充索书号字段） */
  upstreamTextExtra?: string;
  isFavorited?: boolean;
  isPublic?: boolean;
  /** 是否为全局操作栏当前作用目标（选中态高亮） */
  isSelected?: boolean;
  /** 历史记录已被删除（收藏/公开会重新生成记录）时的弱提示 */
  recordDeleted?: boolean;
  /** 点击节点选中（作为全局操作栏的作用目标） */
  onSelect?: (id: string) => void;
  onRemove?: (id: string) => void;
  /** 收藏切换，resolve 为新的收藏状态；失败时 reject */
  onToggleFavorite?: (id: string) => Promise<boolean>;
  /** 公开切换，resolve 为新的公开状态；失败时 reject */
  onTogglePublic?: (id: string) => Promise<boolean>;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  onResizeLive?: (id: string, width: number, height: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  hasDownstream?: boolean;
  mismatchBadge?: string | null;
  /** 状态更新写入 node.data（持久化） */
  onUpdateState?: (id: string, patch: Partial<ReceiptState>) => void;
  /** 导出小票：PNG data URL 落盘保存 + 写入历史记录数据库 */
  onExport?: (id: string, dataUrl: string, state: ReceiptState) => Promise<void>;
}

const ReceiptPrinterNodeInner: React.FC<ReceiptPrinterNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  data = {},
  upstreamBookData,
  upstreamImageUrl,
  upstreamTextExtra,
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
  onResizeLive,
  footer,
  onContextMenu,
  hasDownstream,
  mismatchBadge,
  onUpdateState,
  onExport,
}) => {
  const { showToast } = useFeedback();
  const [isExporting, setIsExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2600);
  };

  const runToggle = async (
    fn: ((id: string) => Promise<boolean>) | undefined,
    okMsg: (active: boolean) => string
  ) => {
    if (!fn) return;
    try {
      const active = await fn(id);
      showNotice(okMsg(active));
    } catch {
      showNotice('操作失败，请重试');
    }
  };

  // 提取上游图书元数据特征指纹（isbn + 书名 + 作者 + 出版社 + 出品方 + 丛书 + 出版年 + 封面 + 评分）
  const currentFingerprint = useMemo(() => {
    if (!upstreamBookData) return '';
    const hasValidContent = Boolean(
      upstreamBookData.title?.trim() ||
      upstreamBookData.isbn?.trim() ||
      upstreamBookData.author?.trim()
    );
    if (!hasValidContent) return '';
    return [
      upstreamBookData.isbn || '',
      upstreamBookData.title || '',
      upstreamBookData.author || '',
      upstreamBookData.publisher || '',
      upstreamBookData.producer || '',
      upstreamBookData.series || '',
      upstreamBookData.pub_year || upstreamBookData.publishDate || '',
      upstreamBookData.cover_image_local || upstreamBookData.cover_image || upstreamBookData.coverUrl || '',
      upstreamBookData.rating !== undefined && upstreamBookData.rating !== null ? String(upstreamBookData.rating) : '',
    ].join('__');
  }, [upstreamBookData]);

  // 上游可用的有效图片源（优先连线上游图片节点，次之图书封面）
  const effectiveUpstreamImageUrl = useMemo(() => {
    return (
      upstreamImageUrl ||
      upstreamBookData?.cover_image_local ||
      upstreamBookData?.cover_image ||
      upstreamBookData?.coverUrl ||
      null
    );
  }, [upstreamImageUrl, upstreamBookData]);

  // 上游文本节点提供的索书号（如 VuFind 索书号节点输出 {"CALL_NUMBER": "..."}）由公共核心函数
  // buildReceiptState 的 upstreamTextExtra 选项统一继承：用户手动填写优先，
  // 空值或模板演示默认值时自动填入上游索书号（所有含 callNumber 字段的模板通用）。

  // 构造小票的合成状态函数（统一使用公共核心函数 buildReceiptState）
  const computeMergedState = useCallback(
    (overrides?: Partial<ReceiptState>) => {
      const currentData = { ...data, ...overrides };
      return buildReceiptState(
        currentData.templateId,
        upstreamBookData,
        currentData,
        {
          upstreamImageUrl: effectiveUpstreamImageUrl,
          upstreamTextExtra,
        }
      );
    },
    [data, upstreamBookData, effectiveUpstreamImageUrl, upstreamTextExtra]
  );

  // 本地即时响应状态（保证键盘输入零延迟且不被打断）
  const [localState, setLocalState] = useState<ReceiptState>(() => computeMergedState());

  // 外部 data / upstreamBookData / 上游图片变化时同步到本地状态
  useEffect(() => {
    setLocalState(computeMergedState());
  }, [computeMergedState]);

  // 跟踪已同步图书元数据的特征指纹
  const lastSyncedFingerprintRef = useRef<string>(currentFingerprint);

  // 自动继承：仅当上游图书元数据或图片发生实质变更（如从无到有、异步抓取完成或切换书籍）时触发同步
  useEffect(() => {
    if (!currentFingerprint || !upstreamBookData) return;
    if (currentFingerprint !== lastSyncedFingerprintRef.current) {
      lastSyncedFingerprintRef.current = currentFingerprint;
      const next = buildReceiptState(
        localState.templateId,
        upstreamBookData,
        {
          themeId: localState.themeId,
          ditherEnabled: localState.ditherEnabled,
          seals: localState.seals,
        },
        {
          overrideUserEdits: true,
          upstreamImageUrl: effectiveUpstreamImageUrl,
          upstreamTextExtra,
        }
      );
      setLocalState(next);
      onUpdateState?.(id, next);
    }
  }, [currentFingerprint, upstreamBookData, localState.templateId, localState.themeId, localState.ditherEnabled, localState.seals, effectiveUpstreamImageUrl, upstreamTextExtra, id, onUpdateState]);

  // 重置为默认：将小票所有字段完整重置到当前模板初始默认态（自动填充图书元数据与上游图片，保留选中的纸张颜色与点阵设置）
  const handleResetToDefault = useCallback(() => {
    lastSyncedFingerprintRef.current = currentFingerprint;
    const freshState = buildReceiptState(
      localState.templateId,
      upstreamBookData,
      {
        themeId: localState.themeId,
        ditherEnabled: localState.ditherEnabled,
      },
      {
        overrideUserEdits: true,
        upstreamImageUrl: effectiveUpstreamImageUrl,
        upstreamTextExtra,
      }
    );
    setLocalState(freshState);
    onUpdateState?.(id, freshState);
    showToast('小票已重置为默认', { type: 'success' });
  }, [upstreamBookData, currentFingerprint, localState.templateId, localState.themeId, localState.ditherEnabled, effectiveUpstreamImageUrl, upstreamTextExtra, id, onUpdateState, showToast]);

  // 状态变更分发：本地即刻响应 + 异步写入画布持久化
  const handleChange = useCallback(
    (patch: Partial<ReceiptState>) => {
      const resolvedPatch = { ...patch };
      if ('imageUrl' in patch && (patch.imageUrl === null || patch.imageUrl === undefined)) {
        resolvedPatch.imageUrl = effectiveUpstreamImageUrl;
      }
      setLocalState((prev) => ({ ...prev, ...resolvedPatch }));
      onUpdateState?.(id, resolvedPatch);
    },
    [id, onUpdateState, effectiveUpstreamImageUrl]
  );

  const paperRef = useRef<HTMLDivElement>(null);

  // 导出小票图片并保存到数据库/历史记录（极速 Canvas 离线矢量引擎，毫秒级所见即所得）
  const handleExportAndSave = useCallback(async () => {
    if (!onExport) return;
    setIsExporting(true);
    try {
      const dataUrl = await exportReceiptImage(localState, { scale: 2 });
      await onExport(id, dataUrl, localState);
      showToast('小票已生成并保存到历史记录', { type: 'success' });
    } catch (err: any) {
      console.error('导出小票失败:', err);
      showToast(err?.detail || err?.message || '生成小票失败，请重试', { type: 'error' });
    } finally {
      setIsExporting(false);
    }
  }, [localState, id, onExport, showToast]);

  // 本地直接下载 PNG（统一公共下载函数，毫秒级即时生成最新内容并下载）
  const handleDirectDownload = useCallback(async () => {
    try {
      await downloadReceiptImage(localState, { scale: 2 });
      showToast('小票图片已下载', { type: 'success' });
    } catch (err: any) {
      console.error('下载小票失败:', err);
      showToast('下载失败，请重试', { type: 'error' });
    }
  }, [localState, showToast]);

  const hasGeneratedImage = Boolean(data?.imageUrl);

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '图书小票生成'}
      dotColor={NODE_COLORS.receipt_printer || 'oklch(0.68 0.15 40)'}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onResizeLive={onResizeLive}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 440, height: 640 }}
      className={`transition-[box-shadow,border-color,opacity] duration-150 ease-out ${isSelected ? 'ring-2 ring-accent/70 shadow-md' : ''}`}
      showLeftAnchor={true}
      showRightAnchor={true}
      onClick={() => onSelect?.(id)}
      footer={footer}
      mismatchBadge={mismatchBadge}
      actionBar={
        <NodeActionBar>
          {hasGeneratedImage ? (
            <NodeActionBar.Retry
              onClick={handleExportAndSave}
              disabled={isExporting}
              hasDownstream={hasDownstream}
              downstreamTooltip="有下级节点，不可保存"
              tooltip="重新生成并保存小票（记录到数据库）"
            />
          ) : (
            <NodeActionBar.Custom
              icon={
                isExporting ? (
                  <Loader2 size={16} className="animate-spin text-accent" />
                ) : (
                  <Printer size={16} strokeWidth={1.5} />
                )
              }
              tooltip="生成并保存小票（记录到数据库）"
              downstreamTooltip="有下级节点，不可保存"
              onClick={handleExportAndSave}
              disabled={isExporting}
              hasDownstream={hasDownstream}
            />
          )}
          <NodeActionBar.Custom
            icon={<Heart size={16} strokeWidth={1.5} className={isFavorited ? 'fill-accent text-accent' : ''} />}
            tooltip={isFavorited ? '取消收藏' : '收藏'}
            onClick={() => runToggle(onToggleFavorite, (active) => (active ? '已收藏' : '已取消收藏'))}
            disabled={!hasGeneratedImage || isExporting || !onToggleFavorite}
          />
          <NodeActionBar.Custom
            icon={<Globe size={16} strokeWidth={1.5} className={isPublic ? 'text-accent' : ''} />}
            tooltip={isPublic ? '从画廊撤下' : '公开到画廊'}
            onClick={() => runToggle(onTogglePublic, (active) => (active ? '已公开' : '已撤下'))}
            disabled={!hasGeneratedImage || isExporting || !onTogglePublic}
          />
          <NodeActionBar.Custom
            icon={<Sparkles size={16} strokeWidth={1.5} />}
            tooltip={localState.ditherEnabled ? '点阵滤镜（已开启）' : '点阵滤镜（已关闭）'}
            downstreamTooltip="有下级节点，不可切换点阵滤镜"
            className={localState.ditherEnabled ? 'text-accent bg-accent/10 hover:bg-accent/20' : ''}
            onClick={() => handleChange({ ditherEnabled: !localState.ditherEnabled })}
            hasDownstream={hasDownstream}
            disabled={isExporting}
          />
          <NodeActionBar.Download
            onClick={handleDirectDownload}
            disabled={isExporting}
            tooltip="直接下载小票 PNG"
          />
          <NodeActionBar.Reset
            onClick={handleResetToDefault}
            disabled={isExporting}
            hasDownstream={hasDownstream}
            downstreamTooltip="有下级节点，不可重置"
            tooltip="重置为当前模板默认内容"
          />
        </NodeActionBar>
      }
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
        {/* 顶部控制栏（模板、纸张颜色） */}
        <ReceiptToolbar
          state={localState}
          onChange={handleChange}
          upstreamBookData={upstreamBookData}
          upstreamImageUrl={effectiveUpstreamImageUrl}
          upstreamTextExtra={upstreamTextExtra}
          disabled={isExporting || hasDownstream}
        />

        {/* 主体小票预览与就地编辑区域（已生成 PNG 时右上角浮钮可全屏查看最近一次导出结果） */}
        <div className="relative flex-1 min-h-0">
          <div className="h-full overflow-y-auto px-1 py-1 rounded bg-paper-grid/10 border border-paper-grid/40 flex items-start justify-center">
            <ReceiptPaper
              ref={paperRef}
              state={localState}
              onChange={handleChange}
              upstreamImageUrl={effectiveUpstreamImageUrl}
              disabled={isExporting || hasDownstream}
            />
          </div>
          {hasGeneratedImage && !isExporting && data?.imageUrl && (
            <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
              <PhotoView src={data.imageUrl}>
                <button
                  type="button"
                  title="查看大图"
                  className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-paper/90 backdrop-blur shadow-md border border-paper-grid/40 text-ink-light hover:text-accent hover:border-accent/50 transition-colors"
                >
                  <Maximize2 size={13} strokeWidth={1.75} />
                </button>
              </PhotoView>
            </PhotoProvider>
          )}
        </div>

        {/* 状态与弱提示（对齐 ImageNode） */}
        {recordDeleted && hasGeneratedImage && !isExporting && (
          <div className="flex items-center justify-end gap-1.5 text-right text-xs text-ink-faint font-sans">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/60" />
            记录已删除 · 收藏将重新生成记录
          </div>
        )}

        {notice && (
          <div className="text-right text-xs text-ink-faint font-sans">
            {notice}
          </div>
        )}
      </div>
    </CanvasNode>
  );
};

export const ReceiptPrinterNode = memo(ReceiptPrinterNodeInner);
ReceiptPrinterNode.displayName = 'ReceiptPrinterNode';
export default ReceiptPrinterNode;

