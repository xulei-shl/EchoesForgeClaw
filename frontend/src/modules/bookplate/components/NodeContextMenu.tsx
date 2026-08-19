import React, { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { NodePickerList, type NodePickerItem } from './NodePickerList';

interface NodeContextMenuProps {
  /** 视口坐标（右键按下位置） */
  x: number;
  y: number;
  /** 节点标题 */
  title: string;
  /** 添加下一级节点可选项 */
  items: NodePickerItem[];
  onPick: (item: NodePickerItem) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** 菜单宽度（w-[480px]）与最大高度估算，用于视口边缘防溢出 */
const MENU_WIDTH = 480;
const MENU_MAX_HEIGHT = 560;

const NodeContextMenu: React.FC<NodeContextMenuProps> = ({
  x,
  y,
  title,
  items,
  onPick,
  onDelete,
  onClose,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部 / Esc / 滚动画布时关闭
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // 滚动画布关闭；但菜单内部滚动列表时不关闭（允许用滚轮滚动节点列表）
    const onScroll = (e: WheelEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onScroll, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onScroll);
    };
  }, [onClose]);

  // 视口边缘防溢出：水平超界左移；垂直贴边
  const left = x + MENU_WIDTH > window.innerWidth - 8 ? Math.max(8, x - MENU_WIDTH) : x;
  const top = Math.max(8, Math.min(y, window.innerHeight - MENU_MAX_HEIGHT));

  return (
    <div
      ref={ref}
      className="fixed z-[100] w-[480px] bg-paper border border-paper-grid rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3.5 py-2.5 border-b border-dashed border-paper-grid bg-paper-grid/10 flex items-center justify-between">
        <p className="text-xs font-medium font-sans text-ink truncate max-w-[280px]" title={title}>
          {title} · <span className="text-ink-light font-normal">添加子节点</span>
        </p>
        <span className="text-[10px] text-ink-faint font-sans">点击或搜索快速添加</span>
      </div>
      <div>
        <NodePickerList items={items} onPick={onPick} />
      </div>
      <div className="border-t border-dashed border-paper-grid p-1.5 bg-paper-grid/5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-sans text-error hover:bg-error/10 active:scale-[0.98] transition-all"
        >
          <Trash2 size={13} strokeWidth={2} />
          删除此节点（含后续连线子节点）
        </button>
      </div>
    </div>
  );
};


export default NodeContextMenu;
