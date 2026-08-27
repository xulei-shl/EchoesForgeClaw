import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const popupRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ x: 0, y: 0 });

  const toggleOpen = () => {
    if (!open && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      setCoords({ x: rect.right, y: rect.top + rect.height / 2 });
    }
    setOpen((v) => !v);
  };

  // 点击外部关闭弹层
  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (
        rootRef.current?.contains(e.target as Node) ||
        popupRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
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
    const onCanvasMove = (e: WheelEvent) => {
      if (
        rootRef.current?.contains(e.target as Node) ||
        popupRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener('wheel', onCanvasMove, { passive: true });
    return () => window.removeEventListener('wheel', onCanvasMove);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleOpen();
        }}
        title="添加下一级节点"
        className="group relative flex items-center justify-center w-7 h-7 rounded-full bg-paper border border-dashed border-paper-grid text-ink-light shadow-sm hover:text-accent hover:border-accent/50 hover:shadow-md active:scale-[0.96] transition-transform duration-100 ease-out before:absolute before:-inset-1.5 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Plus size={15} strokeWidth={2} className="transition-transform duration-200 group-hover:rotate-90" />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        (() => {
          const POPUP_WIDTH = 480;
          const POPUP_HEIGHT = 520;
          // 水平：优先右侧，右侧不够放左侧
          const isRightOverflow = coords.x + POPUP_WIDTH + 16 > window.innerWidth;
          const left = isRightOverflow ? Math.max(12, coords.x - POPUP_WIDTH - 24) : coords.x + 8;
          // 垂直：居中对齐按钮，并做视口上下贴边保护
          const top = Math.max(12, Math.min(coords.y - POPUP_HEIGHT / 2, window.innerHeight - POPUP_HEIGHT - 12));

          return (
            <div 
              ref={popupRef}
              className="fixed z-[9999] w-[480px] animate-in fade-in zoom-in-95 duration-150 ease-out" 
              style={{
                left,
                top,
                transformOrigin: isRightOverflow ? 'right center' : 'left center',
              }}
            >
              <div className="bg-paper border border-paper-grid rounded-xl shadow-2xl overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-dashed border-paper-grid bg-paper-grid/10 flex items-center justify-between">
                  <p className="text-xs font-sans font-medium text-ink-light">添加下一级节点</p>
                  <span className="text-[10px] text-ink-faint font-sans">点击或搜索快速添加</span>
                </div>
                <div>
                  <NodePickerList
                    items={items}
                    onPick={(item) => {
                      setOpen(false);
                      onPick(item);
                    }}
                    pendingChildId={pendingChildId}
                  />
                </div>
              </div>
            </div>
          );
        })(),
        document.body
      )}

    </div>
  );
};

export const AddNodeButton = React.memo(AddNodeButtonInner);
AddNodeButton.displayName = 'AddNodeButton';
export default AddNodeButton;
