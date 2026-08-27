import React from 'react';
import { Eraser, Globe, Heart, Download, LayoutGrid, Undo2, Redo2, ZoomIn, ZoomOut, Target } from 'lucide-react';
import { Tooltip } from '../../../platform/components/ui/Tooltip';

export interface CanvasActionBarProps {
  /** 画布上是否有节点（决定「清空」是否可用） */
  hasNodes: boolean;
  /** 是否已生成第三阶段图片（决定「收藏/公开/导出」是否可用） */
  hasImage: boolean;
  /** 最近生成图片的收藏 / 公开状态 */
  isFavorited?: boolean;
  isPublic?: boolean;
  isMockImage?: boolean;
  onClear: () => void;
  onExport: () => void;
  onFavorite?: () => void;
  onPublic?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** 一键按层级重排所有节点 */
  onAutoLayout?: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFocus: () => void;
}

export const CanvasActionBar: React.FC<CanvasActionBarProps> = ({
  hasNodes,
  hasImage,
  isFavorited = false,
  isPublic = false,
  isMockImage = false,
  onClear,
  onExport,
  onFavorite,
  onPublic,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onAutoLayout,
  onZoomIn,
  onZoomOut,
  onFocus,
}) => {
  const btnClass = (disabled: boolean) =>
    `flex items-center justify-center w-10 h-10 rounded-md active:scale-[0.96] transition-transform duration-100 ease-out ` +
    (disabled
      ? 'text-ink-faint opacity-40 cursor-not-allowed'
      : 'text-ink-light hover:text-ink hover:bg-paper-grid/30 transition-colors') +
    ' focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  return (
    <div className="absolute right-5 top-1/2 -translate-y-1/2 z-10 pointer-events-auto">
      <div className="flex flex-col items-center gap-0.5 bg-node-bg border border-dashed border-paper-grid rounded-xl p-1.5 shadow-[0_4px_16px_rgba(43,41,38,0.10)]">
        <Tooltip content="放大">
          <button
            className={btnClass(false)}
            onClick={onZoomIn}
          >
            <ZoomIn size={18} strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip content="缩小">
          <button
            className={btnClass(false)}
            onClick={onZoomOut}
          >
            <ZoomOut size={18} strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip content="聚焦画布">
          <button
            className={btnClass(false)}
            onClick={onFocus}
          >
            <Target size={18} strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip content="撤销 (Ctrl+Z)">
          <button
            className={btnClass(!canUndo)}
            disabled={!canUndo}
            onClick={onUndo}
          >
            <Undo2 size={18} strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip content="重做 (Ctrl+Shift+Z / Ctrl+Y)">
          <button
            className={btnClass(!canRedo)}
            disabled={!canRedo}
            onClick={onRedo}
          >
            <Redo2 size={18} strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip content="自动布局：按层级重排所有节点">
          <button
            className={btnClass(!hasNodes)}
            disabled={!hasNodes}
            onClick={onAutoLayout}
          >
            <LayoutGrid size={18} strokeWidth={1.5} />
          </button>
        </Tooltip>
        <div className="w-8 border-t border-paper-grid my-1" />
        <Tooltip content="清空画布">
          <button
            className={btnClass(!hasNodes)}
            disabled={!hasNodes}
            onClick={onClear}
          >
            <Eraser size={18} strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip content={isFavorited ? '取消收藏' : '收藏（作用于选中节点）'}>
          <button
            className={btnClass(!hasImage || isMockImage)}
            disabled={!hasImage || !onFavorite || isMockImage}
            onClick={onFavorite}
          >
            <Heart
              size={18}
              strokeWidth={1.5}
              className={isFavorited ? 'fill-accent text-accent' : ''}
            />
          </button>
        </Tooltip>
        <Tooltip content={isPublic ? '从画廊撤下' : '公开到画廊（作用于选中节点）'}>
          <button
            className={btnClass(!hasImage || isMockImage)}
            disabled={!hasImage || !onPublic || isMockImage}
            onClick={onPublic}
          >
            <Globe size={18} strokeWidth={1.5} className={isPublic ? 'text-accent' : ''} />
          </button>
        </Tooltip>
        <Tooltip content="导出结果（选中节点）">
          <button
            className={btnClass(!hasImage)}
            disabled={!hasImage}
            onClick={onExport}
          >
            <Download size={18} strokeWidth={1.5} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
};

export default CanvasActionBar;
