import React from 'react';
import { getReceiptTheme } from '../../themes';
import type { ReceiptState } from '../../types';
import { ReceiptDitherBox } from './common/ReceiptDitherBox';
import { stopEvent } from './common/stopEvent';

export interface RetroMenuPaperProps {
  state: ReceiptState;
  onChange: (patch: Partial<ReceiptState>) => void;
  upstreamImageUrl?: string | null;
  disabled?: boolean;
}

/**
 * 预设 5：复古菜单小票 (Retro Menu View)
 */
export const RetroMenuPaper = React.forwardRef<HTMLDivElement, RetroMenuPaperProps>(
  ({ state, onChange, upstreamImageUrl, disabled = false }, ref) => {
    const theme = getReceiptTheme(state.themeId, state.customThemeColor);

    const updateItem = (id: string, updates: Partial<any>) => {
      if (disabled) return;
      onChange({
        items: (state.items || []).map((item) => (item.id === id ? { ...item, ...updates } : item)),
      });
    };

    const bgStyle = {
      backgroundColor: theme.bg,
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100' height='100' filter='url(%23noise)' opacity='0.12'/%3E%3C/svg%3E")`,
    };

    return (
      <div
        ref={ref}
        data-receipt-paper="true"
        className="w-[340px] mx-auto my-2 transition-colors duration-300 drop-shadow-md flex flex-col"
        style={{ color: theme.text }}
      >
        {/* Top Block */}
        <div 
          className="pt-[25px] px-[20px] pb-4"
          style={{ 
            ...bgStyle, 
            WebkitMaskImage: 'radial-gradient(circle at 15px 0, transparent 15px, black 16px), linear-gradient(black, black)',
            WebkitMaskSize: '30px 20px, 100% calc(100% - 20px)',
            WebkitMaskPosition: 'top, bottom',
            WebkitMaskRepeat: 'repeat-x, no-repeat',
            maskImage: 'radial-gradient(circle at 15px 0, transparent 15px, black 16px), linear-gradient(black, black)',
            maskSize: '30px 20px, 100% calc(100% - 20px)',
            maskPosition: 'top, bottom',
            maskRepeat: 'repeat-x, no-repeat',
          }}
        >
          {/* 顶部插图 */}
          <div className="mb-5 border-2 p-1" style={{ borderColor: theme.bg, outline: `1px solid ${theme.text}`, backgroundColor: theme.text }}>
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
          </div>

          {/* 标题 */}
          <div className="mb-3">
            <textarea
              value={state.storeName || ''}
              disabled={disabled}
              onChange={(e) => {
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
                onChange({ storeName: e.target.value });
              }}
              onMouseDown={stopEvent}
              onPointerDown={stopEvent}
              ref={(el) => {
                if (el) {
                  el.style.height = 'auto';
                  el.style.height = el.scrollHeight + 'px';
                }
              }}
              placeholder="题名"
              rows={1}
              className="w-full text-left font-serif text-[22px] font-bold tracking-wide leading-tight bg-transparent outline-none resize-none border-b border-transparent hover:border-dashed hover:border-current focus:border-solid disabled:cursor-not-allowed disabled:hover:border-transparent overflow-hidden"
              style={{ color: theme.text, fontFamily: "'Songti SC', 'SimSun', '宋体', serif" }}
            />
          </div>

          {/* 分割线 */}
          <div className="h-[1px] mb-5" style={{ backgroundColor: theme.text }}></div>

          {/* 菜单区域 */}
          <div className="relative mb-2">
            <div className="mb-6 pl-1">
              <textarea
                value={state.subtitle || ''}
                disabled={disabled}
                onChange={(e) => {
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                  onChange({ subtitle: e.target.value });
                }}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                ref={(el) => {
                  if (el) {
                    el.style.height = 'auto';
                    el.style.height = el.scrollHeight + 'px';
                  }
                }}
                placeholder="作者"
                rows={1}
                className="w-full text-left font-serif text-[18px] italic leading-tight resize-none bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current focus:border-solid disabled:cursor-not-allowed disabled:hover:border-transparent overflow-hidden"
                style={{ color: theme.text, fontFamily: "'Kaiti SC', 'STKaiti', '楷体', serif" }}
              />
            </div>

            <div className="space-y-2.5 px-2 font-mono">
              {(state.items || []).map((item) => (
                <div key={item.id} className="flex justify-between items-start gap-2 text-[12px]">
                  <span className="shrink-0 opacity-70" style={{ color: theme.faint || theme.text }}>
                    {item.label}:
                  </span>
                  <input
                    type="text"
                    value={item.value || ''}
                    disabled={disabled}
                    onChange={(e) => updateItem(item.id, { value: e.target.value })}
                    onMouseDown={stopEvent}
                    onPointerDown={stopEvent}
                    className="text-right flex-1 bg-transparent outline-none font-semibold border-b border-transparent hover:border-dashed hover:border-current focus:border-solid disabled:cursor-not-allowed disabled:hover:border-transparent"
                    style={{ color: theme.text }}
                  />
                </div>
              ))}

              {/* 索书号（固定行，与条目行共享对齐边与间距节奏） */}
              <div className="flex justify-between items-start gap-2 text-[12px]">
                <span className="shrink-0 opacity-70" style={{ color: theme.faint || theme.text }}>
                  索书号:
                </span>
                <input
                  type="text"
                  value={state.callNumber || ''}
                  disabled={disabled}
                  onChange={(e) => onChange({ callNumber: e.target.value })}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  placeholder="[未填写]"
                  className="text-right flex-1 bg-transparent outline-none font-semibold placeholder:text-opacity-40 border-b border-transparent hover:border-dashed hover:border-current focus:border-solid disabled:cursor-not-allowed disabled:hover:border-transparent"
                  style={{ color: theme.accent || theme.text }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Middle Perforation Block (挖空圆点与边缘缺口) */}
        <div className="h-[30px] w-full flex relative">
          {/* Left Notch */}
          <div className="w-[15px] h-full" style={{ 
            ...bgStyle, 
            WebkitMaskImage: 'radial-gradient(circle at 0 50%, transparent 15px, black 16px)',
            maskImage: 'radial-gradient(circle at 0 50%, transparent 15px, black 16px)'
          }}></div>
          {/* Middle Dots */}
          <div className="flex-1 h-full" style={{ 
            ...bgStyle, 
            WebkitMaskImage: 'radial-gradient(circle, transparent 4px, black 4.5px)', 
            WebkitMaskSize: '16px 100%', 
            WebkitMaskPosition: 'center', 
            WebkitMaskRepeat: 'repeat-x',
            maskImage: 'radial-gradient(circle, transparent 4px, black 4.5px)', 
            maskSize: '16px 100%', 
            maskPosition: 'center', 
            maskRepeat: 'repeat-x'
          }}></div>
          {/* Right Notch */}
          <div className="w-[15px] h-full" style={{ 
            ...bgStyle, 
            WebkitMaskImage: 'radial-gradient(circle at 100% 50%, transparent 15px, black 16px)',
            maskImage: 'radial-gradient(circle at 100% 50%, transparent 15px, black 16px)'
          }}></div>
        </div>

        {/* Bottom Block */}
        <div 
          className="px-[20px] pb-[20px] pt-2"
          style={{ 
            ...bgStyle, 
            WebkitMaskImage: 'radial-gradient(circle at 15px 100%, transparent 15px, black 16px), linear-gradient(black, black)',
            WebkitMaskSize: '30px 20px, 100% calc(100% - 20px)',
            WebkitMaskPosition: 'bottom, top',
            WebkitMaskRepeat: 'repeat-x, no-repeat',
            maskImage: 'radial-gradient(circle at 15px 100%, transparent 15px, black 16px), linear-gradient(black, black)',
            maskSize: '30px 20px, 100% calc(100% - 20px)',
            maskPosition: 'bottom, top',
            maskRepeat: 'repeat-x, no-repeat',
          }}
        >
          {/* 底部插图 (固定尺寸水平细长方形) */}
          <div className="border-2 p-1 retro-bottom-img" style={{ borderColor: theme.bg, outline: `1px solid ${theme.text}`, backgroundColor: theme.text }}>
            <style>{`
              .retro-bottom-img img {
                height: 120px !important;
                max-height: 120px !important;
                object-fit: cover !important;
                object-position: center 25% !important;
              }
            `}</style>
            <ReceiptDitherBox
              imageUrl={state.bottomImageUrl}
              ditherEnabled={state.ditherEnabled}
              upstreamImageUrl={upstreamImageUrl}
              themeDashedColor={theme.dashed}
              themeFaintColor={theme.faint}
              disabled={disabled}
              onImageChange={(dataUrl, customImage) => {
                onChange({ bottomImageUrl: dataUrl, bottomCustomImage: customImage });
              }}
              onRestoreUpstream={() => {
                if (upstreamImageUrl) {
                  onChange({ bottomImageUrl: upstreamImageUrl, bottomCustomImage: false });
                }
              }}
              onClearImage={() => {
                onChange({ bottomImageUrl: '', bottomCustomImage: false });
              }}
            />
          </div>
        </div>
      </div>
    );
  }
);

RetroMenuPaper.displayName = 'RetroMenuPaper';
