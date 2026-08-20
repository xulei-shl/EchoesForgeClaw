import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Download, Printer, Loader2, Sparkles } from 'lucide-react';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../../bookplate/nodeTypes';
import {
  ReceiptPaper,
  ReceiptToolbar,
  exportReceiptImage,
  mergeBookMetadataIntoReceipt,
  TEMPLATE_BOOK_RECOMMEND,
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
    imageUrl?: string | null;
    error?: string | null;
    isExporting?: boolean;
  };
  /** 上游图书元数据（直接上级或上下文注入） */
  upstreamBookData?: BookMetadataInput | null;
  /** 上游图片输出（图片上传 / 图像生成 / 艺术检索等） */
  upstreamImageUrl?: string | null;
  onRemove?: (id: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
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
  onRemove,
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
  const [isExporting, setIsExporting] = useState(false);

  // 构造小票的有效当前状态（缺省时以预设书目推荐小票为初始值）
  const currentState: ReceiptState = {
    ...TEMPLATE_BOOK_RECOMMEND.createInitialState(),
    ...data,
  } as ReceiptState;

  // 跟踪图书元数据是否已完成初始同步
  const syncedBookIsbnRef = useRef<string | null>(null);

  // 自动继承：当检测到上游图书元数据接入且尚未同步过时，自动初始化小票
  useEffect(() => {
    if (upstreamBookData && upstreamBookData.isbn && upstreamBookData.isbn !== syncedBookIsbnRef.current) {
      syncedBookIsbnRef.current = upstreamBookData.isbn;
      const patched = mergeBookMetadataIntoReceipt(upstreamBookData, currentState);
      onUpdateState?.(id, patched);
    }
  }, [upstreamBookData, id]);

  // 手动从上游重新同步图书元数据
  const handleManualSyncBook = useCallback(() => {
    if (!upstreamBookData) return;
    const patched = mergeBookMetadataIntoReceipt(upstreamBookData, currentState);
    onUpdateState?.(id, patched);
    showToast('已从图书元数据更新小票内容', 'success');
  }, [upstreamBookData, currentState, id, onUpdateState, showToast]);

  // 状态变更分发
  const handleChange = useCallback(
    (patch: Partial<ReceiptState>) => {
      onUpdateState?.(id, patch);
    },
    [id, onUpdateState]
  );

  // 导出小票图片并保存到数据库/历史记录
  const handleExportAndSave = useCallback(async () => {
    setIsExporting(true);
    try {
      const dataUrl = await exportReceiptImage(currentState, { scale: 2 });
      if (onExport) {
        await onExport(id, dataUrl, currentState);
        showToast('小票已生成并保存到历史记录', 'success');
      } else {
        // 直接触发浏览器本地下载
        const link = document.createElement('a');
        link.download = `receipt-${Date.now()}.png`;
        link.href = dataUrl;
        link.click();
        showToast('小票图片已下载', 'success');
      }
    } catch (err: any) {
      console.error('导出小票失败:', err);
      showToast(err?.message || '生成小票失败，请重试', 'error');
    } finally {
      setIsExporting(false);
    }
  }, [currentState, id, onExport, showToast]);

  // 本地直接下载 PNG
  const handleDirectDownload = useCallback(async () => {
    try {
      const dataUrl = await exportReceiptImage(currentState, { scale: 2 });
      const link = document.createElement('a');
      link.download = `${currentState.storeName || 'receipt'}-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      showToast('小票图片已下载', 'success');
    } catch (err: any) {
      console.error('下载小票失败:', err);
      showToast('下载失败，请重试', 'error');
    }
  }, [currentState, showToast]);

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
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 440, height: 640 }}
      showLeftAnchor={true}
      showRightAnchor={true}
      footer={footer}
      mismatchBadge={mismatchBadge}
      actionBar={
        <NodeActionBar>
          <NodeActionBar.Custom
            icon={
              isExporting ? (
                <Loader2 size={16} className="animate-spin text-accent" />
              ) : (
                <Printer size={16} strokeWidth={1.5} />
              )
            }
            tooltip="生成并保存小票（记录到数据库）"
            onClick={handleExportAndSave}
            disabled={isExporting}
            hasDownstream={hasDownstream}
          />
          <NodeActionBar.Download
            onClick={handleDirectDownload}
            disabled={isExporting}
            tooltip="直接下载小票 PNG"
          />
          <NodeActionBar.Custom
            icon={<Sparkles size={16} strokeWidth={1.5} />}
            tooltip="切换点阵化滤镜"
            onClick={() => handleChange({ ditherEnabled: !currentState.ditherEnabled })}
          />
        </NodeActionBar>
      }
    >
      <div className="h-full flex flex-col flex-1 min-h-0 gap-2">
        {/* 顶部控制栏（模板、纸张颜色、点阵开关、同步图书） */}
        <ReceiptToolbar
          state={currentState}
          onChange={handleChange}
          onSyncUpstreamBook={handleManualSyncBook}
          hasUpstreamBook={!!upstreamBookData}
        />

        {/* 主体小票预览与就地编辑区域 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-1 py-1 rounded bg-paper-grid/10 border border-paper-grid/40 flex items-start justify-center">
          <ReceiptPaper
            state={currentState}
            onChange={handleChange}
            upstreamImageUrl={upstreamImageUrl || upstreamBookData?.coverUrl}
          />
        </div>
      </div>
    </CanvasNode>
  );
};

export const ReceiptPrinterNode = memo(ReceiptPrinterNodeInner);
ReceiptPrinterNode.displayName = 'ReceiptPrinterNode';
export default ReceiptPrinterNode;
