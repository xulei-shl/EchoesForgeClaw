import React from 'react';
import { getReceiptTheme } from '../../themes';
import type { ReceiptState } from '../../types';
import { ReceiptZigzagEdge } from './common/ReceiptZigzagEdge';
import { stopEvent } from './common/stopEvent';

export interface BookExcerptPaperProps {
  state: ReceiptState;
  onChange: (patch: Partial<ReceiptState>) => void;
  upstreamImageUrl?: string | null;
  disabled?: boolean;
}

/**
 * 预设 4：清新文艺书摘小票纸张组件 (Book Excerpt View)
 *
 * 紧凑手账便签排版：
 * 1. 材质与内衬：复古草木绿手账纸色 + 纸浆微颗粒光晕 + 精致浅绿便签内衬细边框
 * 2. 顶部：左上角 @打字机账号，右上角极简墨绿小方块 ■ 003 编号
 * 3. 标题：汇文明朝体 / Shippori Mincho「书摘分享」+ 墨绿底白字加粗横幅「BOOK EXCERPT SHARING」
 * 4. 中段：单段中文精彩书摘 + 贴合字迹的浅绿横线笔记本条纹底纹
 * 5. 底部右下角：汇文明朝体题名（无书名号）+ 作者 + 出版社 · 出版年
 * 6. 底部：锯齿撕纸边
 */
export const BookExcerptPaper = React.forwardRef<HTMLDivElement, BookExcerptPaperProps>(
  ({ state, onChange, disabled = false }, ref) => {
    const theme = getReceiptTheme(state.themeId || 'sage');

    // 提取元数据字段（title, author, pub_info）
    const metaFields = state.metaFields || [];
    const titleField = metaFields.find((f) => f.key === 'title') || {
      key: 'title',
      label: '题名',
      value: '明亮的夜晚',
    };
    const authorField = metaFields.find((f) => f.key === 'author') || {
      key: 'author',
      label: '作者',
      value: '崔恩荣',
    };
    const pubInfoField = metaFields.find((f) => f.key === 'pub_info') || {
      key: 'pub_info',
      label: '出版信息',
      value: '光启书局 · 2026',
    };

    const handleUpdateMeta = (key: string, value: string) => {
      if (disabled) return;
      const fields = [...metaFields];
      const idx = fields.findIndex((f) => f.key === key);
      if (idx >= 0) {
        fields[idx] = { ...fields[idx], value };
      } else {
        fields.push({ key, label: key, value, visible: true });
      }
      onChange({ metaFields: fields });
    };

    // 汇文明朝体 / 明朝体字体栈
    const minchoFontFamily =
      "'Huiwen-mincho', 'Huiwen Mincho', 'Shippori Mincho B1', 'Shippori Mincho', 'Songti SC', 'Noto Serif SC', 'Source Han Serif SC', serif";

    // 专属中文手账横线本间距（每行 38px，与文字行高精准贴合）
    const notebookLineStyle: React.CSSProperties = {
      backgroundImage: `repeating-linear-gradient(transparent, transparent 37px, color-mix(in srgb, ${theme.text} 22%, transparent) 37px, color-mix(in srgb, ${theme.text} 22%, transparent) 38px)`,
      lineHeight: '38px',
      backgroundAttachment: 'local',
    };

    // 复古纸张微光晕与纸浆颗粒噪点纹理
    const paperTextureStyle: React.CSSProperties = {
      backgroundImage: `
        radial-gradient(ellipse at 50% 25%, rgba(255, 255, 255, 0.28) 0%, rgba(0, 0, 0, 0.035) 100%),
        url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.055'/%3E%3C/svg%3E")
      `,
    };

    return (
      <div
        ref={ref}
        data-receipt-paper="true"
        className="relative w-full max-w-[360px] min-h-[580px] mx-auto my-2 rounded-xs shadow-xl flex flex-col justify-between select-text transition-colors duration-300 font-sans border border-black/10 overflow-hidden"
        style={{
          backgroundColor: theme.bg,
          color: theme.text,
        }}
      >
        {/* 复古纸浆肌理与微光晕覆盖层 */}
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={paperTextureStyle}
        />

        {/* 古籍四周双边框（外粗内细文武边） */}
        <div
          className="relative z-1 m-3 p-[3px] flex-1 flex flex-col transition-colors"
          style={{
            border: `2.5px solid color-mix(in srgb, ${theme.text} 85%, transparent)`,
          }}
        >
          <div
            className="p-3.5 pb-2 flex-1 flex flex-col justify-between transition-colors"
            style={{
              border: `0.8px solid color-mix(in srgb, ${theme.text} 45%, transparent)`,
            }}
          >
            <div>
              {/* ========== 1. 顶部 Header：左侧 @账号，中央 绝对居中古籍鱼尾，右侧 ■ 003 编号 ========== */}
              <div className="relative flex justify-between items-center text-xs pb-1">
                {/* 左上角用户 Handle / 署名 */}
                <div className="flex items-center gap-0.5 opacity-85 hover:opacity-100 transition-opacity">
                  <input
                    type="text"
                    value={state.userHandle || '@Dieforella'}
                    disabled={disabled}
                    onChange={(e) => onChange({ userHandle: e.target.value })}
                    onMouseDown={stopEvent}
                    onPointerDown={stopEvent}
                    placeholder="@Dieforella"
                    style={{ color: theme.text }}
                    className="font-mono text-xs bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent w-24 tracking-wide"
                  />
                </div>

                {/* 中央古籍版心鱼尾纹装饰 (Fishtail Ornament - 绝对水平中轴居中) */}
                <div
                  className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 pointer-events-none flex items-center opacity-75"
                  title="古籍版心鱼尾"
                >
                  <svg width="22" height="10" viewBox="0 0 22 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                    {/* 上鱼尾 */}
                    <path d="M0 0H22V4L11 9L0 4Z" fill={theme.text} fillOpacity="0.85" />
                    {/* 鱼尾内嵌细线 */}
                    <path d="M4 2H18V3.5L11 7L4 3.5Z" fill={theme.bg} />
                  </svg>
                </div>

                {/* 右上角极简墨绿实心方块 ■ 003 编号 */}
                <div
                  className="flex items-center gap-1 font-mono text-xs font-bold opacity-85 hover:opacity-100 transition-opacity"
                  title={disabled ? '有下级节点，不可修改' : '便签序号 (No.)'}
                >
                  <span
                    className="w-2.5 h-2.5 shrink-0 inline-block"
                    style={{ backgroundColor: theme.accent || theme.text }}
                  />
                  <input
                    type="text"
                    value={state.serialNumber || '003'}
                    disabled={disabled}
                    onChange={(e) => onChange({ serialNumber: e.target.value })}
                    onMouseDown={stopEvent}
                    onPointerDown={stopEvent}
                    placeholder="003"
                    className="w-10 text-right font-bold tabular-nums bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent tracking-widest"
                    style={{ color: theme.text }}
                  />
                </div>
              </div>

            {/* ========== 2. 标题区：「书摘分享」+ 虚线 + 墨绿底白字横幅 ========== */}
            <div className="mt-8 mb-3 text-center">
              {/* 大标题：书摘分享（汇文明朝体大字号） */}
              <input
                type="text"
                value={state.storeName || '书摘分享'}
                disabled={disabled}
                onChange={(e) => onChange({ storeName: e.target.value })}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="书摘分享"
                style={{
                  fontFamily: minchoFontFamily,
                  color: theme.text,
                }}
                className="w-full text-center text-[44px] font-medium tracking-[0.22em] bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent my-1 leading-tight"
              />

              {/* 细虚线 */}
              <div
                className="my-2 border-b border-dashed"
                style={{ borderColor: theme.dashed || `color-mix(in srgb, ${theme.text} 26%, transparent)` }}
              />

              {/* 英文反白横幅色块：BOOK EXCERPT SHARING */}
              <div className="flex justify-center">
                <div
                  className="px-3 py-0.5 rounded-[3px] shadow-2xs inline-flex items-center justify-center transition-colors"
                  style={{
                    backgroundColor: theme.accent || theme.text,
                  }}
                >
                  <input
                    type="text"
                    value={state.englishBanner || 'BOOK EXCERPT SHARING'}
                    disabled={disabled}
                    onChange={(e) => onChange({ englishBanner: e.target.value })}
                    onMouseDown={stopEvent}
                    onPointerDown={stopEvent}
                    placeholder="BOOK EXCERPT SHARING"
                    className="font-sans text-[11px] font-black uppercase tracking-[0.15em] text-white text-center bg-transparent outline-none w-48 border-b border-transparent hover:border-dashed hover:border-white/60 disabled:cursor-not-allowed disabled:hover:border-transparent"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ========== 3. 中段书摘主体（在上下两部分之间自然垂直居中） ========== */}
          <div className="flex-1 flex flex-col justify-center my-3 px-1">
            <textarea
              value={state.excerptText || ''}
              disabled={disabled}
              onChange={(e) => onChange({ excerptText: e.target.value })}
              onMouseDown={stopEvent}
              onPointerDown={stopEvent}
              placeholder="在此输入中文精彩书摘..."
              rows={5}
              style={{
                ...notebookLineStyle,
                fontFamily: "'Zhi Mang Xing', 'LXGW WenKai', cursive",
                color: theme.text,
              }}
              className="w-full text-[19px] tracking-wide text-justify font-normal bg-transparent outline-none resize-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent transition-all"
            />
          </div>

          {/* ========== 4. 底部右下角图书元数据（题名 + 作者 + 出版社·出版年） ========== */}
          <div className="mt-2 mb-1 flex flex-col items-end text-right space-y-1 pr-1">
            {/* ① 题名（明朝体，无书名号） */}
            <div className="w-full flex justify-end">
              <input
                type="text"
                value={titleField.value || '明亮的夜晚'}
                disabled={disabled}
                onChange={(e) => handleUpdateMeta('title', e.target.value)}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="题名"
                style={{
                  fontFamily: minchoFontFamily,
                  color: theme.text,
                }}
                className="w-full text-right text-[28px] font-medium tracking-[0.06em] bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent leading-tight my-0.5"
              />
            </div>

            {/* ② 作者署名（明朝体） */}
            <div className="w-full flex justify-end">
              <input
                type="text"
                value={authorField.value || '崔恩荣'}
                disabled={disabled}
                onChange={(e) => handleUpdateMeta('author', e.target.value)}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="作者"
                style={{
                  fontFamily: minchoFontFamily,
                  color: theme.text,
                }}
                className="w-full text-right text-[15px] font-normal tracking-widest opacity-85 bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
              />
            </div>

            {/* ③ 出版社 · 出版年（明朝体） */}
            <div className="w-full flex justify-end">
              <input
                type="text"
                value={pubInfoField.value || '光启书局 · 2026'}
                disabled={disabled}
                onChange={(e) => handleUpdateMeta('pub_info', e.target.value)}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="出版社 · 出版年"
                style={{
                  fontFamily: minchoFontFamily,
                  color: theme.faint,
                }}
                className="w-full text-right text-[12px] font-normal tracking-tight opacity-75 bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ========== 5. 底部撕纸锯齿装饰 ========== */}
      <ReceiptZigzagEdge position="bottom" bgColor={theme.bg} />
    </div>
    );
  }
);

BookExcerptPaper.displayName = 'BookExcerptPaper';
