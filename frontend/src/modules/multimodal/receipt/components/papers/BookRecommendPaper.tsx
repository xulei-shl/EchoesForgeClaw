import React from 'react';
import { Star } from 'lucide-react';
import { getReceiptTheme } from '../../themes';
import type { ReceiptState } from '../../types';
import { ReceiptZigzagEdge } from './common/ReceiptZigzagEdge';
import { ReceiptDitherBox } from './common/ReceiptDitherBox';
import { ReceiptBarcodeBox } from './common/ReceiptBarcodeBox';
import { stopEvent } from './common/stopEvent';

export interface BookRecommendPaperProps {
  state: ReceiptState;
  onChange: (patch: Partial<ReceiptState>) => void;
  upstreamImageUrl?: string | null;
  disabled?: boolean;
}

/**
 * 预设 1：书目推荐小票组件 (Book Recommend View)
 */
export const BookRecommendPaper = React.forwardRef<HTMLDivElement, BookRecommendPaperProps>(
  (
    {
      state,
      onChange,
      upstreamImageUrl,
      disabled = false,
    },
    ref
  ) => {
    const theme = getReceiptTheme(state.themeId);

    // 更新图书元数据字段
    const handleUpdateMetaField = (key: string, value: string) => {
      if (disabled) return;
      onChange({
        metaFields: (state.metaFields || []).map((f) => (f.key === key ? { ...f, value } : f)),
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
          {/* --- 馆名 / 店名 --- */}
          <div className="text-center">
            <input
              type="text"
              value={state.storeName || ''}
              disabled={disabled}
              onChange={(e) => onChange({ storeName: e.target.value })}
              onMouseDown={stopEvent}
              onPointerDown={stopEvent}
              placeholder="店名 / 图书馆名称"
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

            {/* 索书号字段 */}
            <div className="flex justify-between items-center">
              <span style={{ color: theme.faint }}>索书号 (Call No):</span>
              <input
                type="text"
                value={state.callNumber || ''}
                disabled={disabled}
                onChange={(e) => onChange({ callNumber: e.target.value })}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="[未填写]"
                className="text-right bg-transparent outline-none w-36 font-semibold placeholder:text-opacity-40 border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                style={{ color: theme.accent || theme.text }}
              />
            </div>

            {/* 馆藏状态字段 */}
            {state.status !== undefined && state.status !== null && (
              <div className="flex justify-between items-center">
                <span style={{ color: theme.faint }}>馆藏状态 (Status):</span>
                <input
                  type="text"
                  value={state.status || ''}
                  disabled={disabled}
                  onChange={(e) => onChange({ status: e.target.value })}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  placeholder="[在馆可借]"
                  className="text-right bg-transparent outline-none w-32 font-semibold placeholder:text-opacity-40 border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                  style={{ color: theme.accent || theme.text }}
                />
              </div>
            )}

            {/* 评分字段 */}
            {state.rating !== undefined && state.rating !== null && String(state.rating).trim() !== '' && (
              <div className="flex justify-between items-center">
                <span style={{ color: theme.faint }}>豆瓣评分 (Rating):</span>
                <div className="flex items-center gap-1">
                  <Star size={11} className="fill-current text-amber-500" />
                  <input
                    type="text"
                    value={state.rating}
                    disabled={disabled}
                    onChange={(e) => onChange({ rating: e.target.value })}
                    onMouseDown={stopEvent}
                    onPointerDown={stopEvent}
                    className="text-right bg-transparent outline-none w-14 font-bold border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                    style={{ color: theme.text }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 分割线 */}
          <div className="border-b border-dashed" style={{ borderColor: theme.dashed }} />

          {/* --- 插图区域 --- */}
          <ReceiptDitherBox
            imageUrl={state.imageUrl}
            ditherEnabled={state.ditherEnabled}
            upstreamImageUrl={upstreamImageUrl}
            themeDashedColor={theme.dashed}
            themeFaintColor={theme.faint}
            disabled={disabled}
            onImageChange={(dataUrl, customImage) => {
              onChange({ imageUrl: dataUrl, coverImageUrl: dataUrl, customImage });
            }}
            onRestoreUpstream={() => {
              if (upstreamImageUrl) {
                onChange({ imageUrl: upstreamImageUrl, coverImageUrl: upstreamImageUrl, customImage: false });
              }
            }}
            onClearImage={() => {
              onChange({ imageUrl: '', coverImageUrl: '', customImage: false });
            }}
          />

          {/* 分割线 */}
          <div className="border-b border-dashed" style={{ borderColor: theme.dashed }} />

          {/* --- 结构化图书元数据 --- */}
          {state.metaFields && state.metaFields.length > 0 && (
            <div className="space-y-1.5">
              {state.metaFields
                .filter((f) => f.visible !== false)
                .map((field) => (
                  <div key={field.key} className="flex justify-between items-start gap-2 text-[12px]">
                    <span className="shrink-0 opacity-70" style={{ color: theme.faint }}>
                      {field.label}:
                    </span>
                    <input
                      type="text"
                      value={field.value || ''}
                      disabled={disabled}
                      onChange={(e) => handleUpdateMetaField(field.key, e.target.value)}
                      onMouseDown={stopEvent}
                      onPointerDown={stopEvent}
                      className="text-right flex-1 bg-transparent outline-none font-semibold border-b border-transparent hover:border-dashed hover:border-current focus:border-solid focus:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                      style={{ color: theme.text }}
                    />
                  </div>
                ))}
              <div className="border-b border-dashed pt-1" style={{ borderColor: theme.dashed }} />
            </div>
          )}

          {/* --- 馆藏推荐指数 / TOTAL --- */}
          {state.totalValue && (
            <div className="flex justify-between items-center font-black text-sm">
              <input
                type="text"
                value={state.totalLabel || ''}
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
                className="text-right bg-transparent outline-none flex-1 font-black text-base border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                style={{ color: theme.accent || theme.text }}
              />
            </div>
          )}

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

BookRecommendPaper.displayName = 'BookRecommendPaper';
