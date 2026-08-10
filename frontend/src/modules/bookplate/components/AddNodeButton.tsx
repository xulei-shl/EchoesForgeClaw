import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { NodePickerList, type NodePickerItem } from './NodePickerList';

export type { NodePickerItem } from './NodePickerList';

interface AddNodeButtonProps {
  /** 可选项列表（按模板分组） */
  items: NodePickerItem[];
  onPick: (item: NodePickerItem) => void;
  /** 添加进行中的子节点 id（选中后短暂禁用，防止重复点击） */
  pendingChildId?: string | null;
}

const AddNodeButtonInner: React.FC<AddNodeButtonProps> = ({ items, onPick, pendingChildId }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭弹层
  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 画布平移/缩放时关闭弹层，避免错位
  useEffect(() => {
    if (!open) return;
    const onCanvasMove = () => setOpen(false);
    window.addEventListener('wheel', onCanvasMove, { passive: true });
    return () => window.removeEventListener('wheel', onCanvasMove);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="添加下一级节点"
        className="group flex items-center justify-center w-7 h-7 rounded-full bg-paper border border-dashed border-paper-grid text-ink-light shadow-sm hover:text-accent hover:border-accent/50 hover:shadow-md active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Plus size={15} strokeWidth={2} className="transition-transform duration-200 group-hover:rotate-90" />
      </button>

      {open && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 z-50">
          <div className="bg-paper border border-paper-grid rounded-lg shadow-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-dashed border-paper-grid bg-paper-grid/10">
              <p className="text-xs font-sans text-ink-light">添加下一级节点</p>
            </div>
            <div className="max-h-72 overflow-y-auto">
              <NodePickerList items={items} onPick={(item) => { setOpen(false); onPick(item); }} pendingChildId={pendingChildId} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const AddNodeButton = React.memo(AddNodeButtonInner);
AddNodeButton.displayName = 'AddNodeButton';
export default AddNodeButton;
