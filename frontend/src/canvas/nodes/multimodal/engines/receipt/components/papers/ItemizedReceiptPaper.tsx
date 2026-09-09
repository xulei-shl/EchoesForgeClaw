import React from 'react';
import { Plus, X } from 'lucide-react';
import { getReceiptTheme } from '../../themes';
import type { ReceiptItem, ReceiptState } from '../../types';
import { ReceiptZigzagEdge } from './common/ReceiptZigzagEdge';
import { ReceiptBarcodeBox } from './common/ReceiptBarcodeBox';
import { stopEvent } from './common/stopEvent';

export interface ItemizedReceiptPaperProps {
  state: ReceiptState;
  onChange: (patch: Partial<ReceiptState>) => void;
  upstreamImageUrl?: string | null;
  disabled?: boolean;
}

/**
 * 预设 3：经典清单小票组件 (Itemized Receipt View)
 */
export const ItemizedReceiptPaper = React.forwardRef<HTMLDivElement, ItemizedReceiptPaperProps>(
  (
    {
      state,
      onChange,
      disabled = false,
    },
    ref
  ) => {
    const theme = getReceiptTheme(state.themeId, state.customThemeColor);

    // 添加清单条目
    const handleAddItem = () => {
      if (disabled) return;
      const newItems: ReceiptItem[] = [
        ...(state.items || []),
        {
          id: 'item-' + Date.now(),
          label: 'NEW ITEM',
          count: '01',
          value: '¥ 0.00',
        },
      ];
      onChange({ items: newItems });
    };

    // 删除清单条目
    const handleRemoveItem = (id: string) => {
      if (disabled) return;
      onChange({ items: (state.items || []).filter((it) => it.id !== id) });
    };

    // 更新清单条目
    const handleUpdateItem = (id: string, patch: Partial<ReceiptItem>) => {
      if (disabled) return;
      onChange({
        items: (state.items || []).map((it) => (it.id === id ? { ...it, ...patch } : it)),
      });
    };

    return (
      <div
        ref={ref}
        data-receipt-paper="true"
        className="relative w-full max-w-[380px] mx-auto my-2 rounded-sm shadow-md transition-colors duration-300 font-mono"
        style={{
          backgroundColor: theme.bg,
          color: theme.text,
        }}
      >
        {/* 顶部撕纸锯齿装饰 */}
        <ReceiptZigzagEdge position="top" bgColor={theme.bg} />

        <div className="px-5 py-4 flex flex-col gap-3.5 text-xs">
          {/* --- 店名 / 抬头 --- */}
          <div className="text-center">
            <input
              type="text"
              value={state.storeName || ''}
              disabled={disabled}
              onChange={(e) => onChange({ storeName: e.target.value })}
              onMouseDown={stopEvent}
              onPointerDown={stopEvent}
              placeholder="店名 / 组织名称"
              className="w-full text-center font-black text-xl tracking-wider uppercase bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current focus:border-solid focus:border-current transition-colors disabled:cursor-not-allowed disabled:hover:border-transparent"
              style={{ color: theme.text }}
            />
            <input
              type="text"
              value={state.subtitle || ''}
              disabled={disabled}
              onChange={(e) => onChange({ subtitle: e.target.value })}
              onMouseDown={stopEvent}
              onPointerDown={stopEvent}
              placeholder="副标题"
              className="w-full text-center text-[11px] font-semibold tracking-widest uppercase mt-0.5 bg-transparent outline-none opacity-70 border-b border-transparent hover:border-dashed hover:border-current focus:border-solid disabled:cursor-not-allowed disabled:hover:border-transparent"
              style={{ color: theme.faint }}
            />
          </div>

          {/* 分割线 */}
          <div className="border-b border-dashed" style={{ borderColor: theme.dashed }} />

          {/* --- 头部基本信息区 --- */}
          <div className="space-y-1 text-[11px]">
            <div className="flex justify-between items-center">
              <span style={{ color: theme.faint }}>Date:</span>
              <input
                type="text"
                value={state.dateTimeText || ''}
                disabled={disabled}
                onChange={(e) => onChange({ dateTimeText: e.target.value })}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                className="text-right bg-transparent outline-none w-36 border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                style={{ color: theme.text }}
              />
            </div>
            <div className="flex justify-between items-center">
              <span style={{ color: theme.faint }}>Terminal:</span>
              <input
                type="text"
                value={state.terminal || ''}
                disabled={disabled}
                onChange={(e) => onChange({ terminal: e.target.value })}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                className="text-right bg-transparent outline-none w-32 border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                style={{ color: theme.text }}
              />
            </div>
            <div className="flex justify-between items-center">
              <span style={{ color: theme.faint }}>Served by:</span>
              <input
                type="text"
                value={state.servedBy || ''}
                disabled={disabled}
                onChange={(e) => onChange({ servedBy: e.target.value })}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                className="text-right bg-transparent outline-none w-32 border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                style={{ color: theme.text }}
              />
            </div>
          </div>

          {/* 分割线 */}
          <div className="border-b border-dashed" style={{ borderColor: theme.dashed }} />

          {/* --- 经典清单列表项 (Items) --- */}
          <div className="space-y-2">
            {(state.items || []).map((item) => (
              <div key={item.id} className="group/item flex items-center justify-between gap-1 text-[12px]">
                {!disabled && (
                  <button
                    type="button"
                    data-export-ignore="true"
                    onClick={() => handleRemoveItem(item.id)}
                    className="export-ignore opacity-0 group-hover/item:opacity-100 text-red-500 hover:text-red-700 p-0.5 cursor-pointer"
                    title="删除此项"
                  >
                    <X size={12} />
                  </button>
                )}
                <input
                  type="text"
                  value={item.label || ''}
                  disabled={disabled}
                  onChange={(e) => handleUpdateItem(item.id, { label: e.target.value })}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  placeholder="品名 / 书名"
                  className="flex-1 bg-transparent outline-none font-bold uppercase border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                  style={{ color: theme.text }}
                />
                {item.count !== undefined && (
                  <input
                    type="text"
                    value={item.count || ''}
                    disabled={disabled}
                    onChange={(e) => handleUpdateItem(item.id, { count: e.target.value })}
                    onMouseDown={stopEvent}
                    onPointerDown={stopEvent}
                    placeholder="数量"
                    className="w-8 text-center bg-transparent outline-none opacity-70 border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                    style={{ color: theme.faint }}
                  />
                )}
                {item.value !== undefined && (
                  <input
                    type="text"
                    value={item.value || ''}
                    disabled={disabled}
                    onChange={(e) => handleUpdateItem(item.id, { value: e.target.value })}
                    onMouseDown={stopEvent}
                    onPointerDown={stopEvent}
                    placeholder="价格/数值"
                    className="w-20 text-right bg-transparent outline-none font-bold border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                    style={{ color: theme.text }}
                  />
                )}
              </div>
            ))}

            {!disabled && (
              <button
                type="button"
                data-export-ignore="true"
                onClick={handleAddItem}
                className="export-ignore w-full py-1 text-center text-[11px] opacity-60 hover:opacity-100 border border-dashed rounded hover:border-current flex items-center justify-center gap-1 transition-opacity cursor-pointer"
                style={{ borderColor: theme.dashed, color: theme.text }}
              >
                <Plus size={11} /> 增加品目
              </button>
            )}
          </div>

          {/* 分割线 */}
          <div className="border-b border-dashed" style={{ borderColor: theme.dashed }} />

          {/* --- TOTAL 统计行 --- */}
          <div className="flex justify-between items-center font-black text-sm">
            <input
              type="text"
              value={state.totalLabel || 'TOTAL'}
              disabled={disabled}
              onChange={(e) => onChange({ totalLabel: e.target.value })}
              onMouseDown={stopEvent}
              onPointerDown={stopEvent}
              className="bg-transparent outline-none uppercase w-28 border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
              style={{ color: theme.text }}
            />
            <input
              type="text"
              value={state.totalValue || ''}
              disabled={disabled}
              onChange={(e) => onChange({ totalValue: e.target.value })}
              onMouseDown={stopEvent}
              onPointerDown={stopEvent}
              placeholder="¥ 0.00"
              className="text-right bg-transparent outline-none flex-1 font-black text-base border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
              style={{ color: theme.accent || theme.text }}
            />
          </div>

          {/* 分割线 */}
          <div className="border-b border-dashed" style={{ borderColor: theme.dashed }} />

          {/* --- 条形码区域 --- */}
          <ReceiptBarcodeBox
            barcodeText={state.barcodeText}
            textColor={theme.text}
            disabled={disabled}
            onChange={(val) => onChange({ barcodeText: val })}
          />

          {/* --- 底部寄语 / 标语 --- */}
          <div className="text-center pt-2 space-y-1">
            <textarea
              value={state.footerMessage || ''}
              disabled={disabled}
              onChange={(e) => onChange({ footerMessage: e.target.value })}
              onMouseDown={stopEvent}
              onPointerDown={stopEvent}
              placeholder="底部提示语（如 THANK YOU / 寄语）"
              rows={2}
              className="w-full text-center font-bold text-xs bg-transparent outline-none uppercase resize-none leading-tight tracking-wider border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
              style={{ color: theme.text }}
            />
            <input
              type="text"
              value={state.bottomNote || ''}
              disabled={disabled}
              onChange={(e) => onChange({ bottomNote: e.target.value })}
              onMouseDown={stopEvent}
              onPointerDown={stopEvent}
              placeholder="最底部小字备注"
              className="w-full text-center text-[10px] bg-transparent outline-none opacity-60 tracking-tight border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
              style={{ color: theme.faint }}
            />
          </div>
        </div>

        {/* 底部撕纸锯齿装饰 */}
        <ReceiptZigzagEdge position="bottom" bgColor={theme.bg} />
      </div>
    );
  }
);

ItemizedReceiptPaper.displayName = 'ItemizedReceiptPaper';
