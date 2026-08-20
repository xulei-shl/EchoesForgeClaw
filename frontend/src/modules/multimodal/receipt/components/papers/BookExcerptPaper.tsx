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
 * 经典手账便签排版：
 * 1. 顶部：左上角账号/署名，右上角豆瓣评分（替代原 003 编号）
 * 2. 标题：大字号「书摘分享」+ 绿色反白胶囊英文横幅「BOOK EXCERPT SHARING」
 * 3. 中段：单一段落书摘主体（霞鹜文楷手写体 + 便签横线本底纹）
 * 4. 底部右下角：结构化图书元数据（题名、作者、出版社·出版年、ISBN）
 * 5. 底部：锯齿撕纸边
 */
export const BookExcerptPaper = React.forwardRef<HTMLDivElement, BookExcerptPaperProps>(
  ({ state, onChange, disabled = false }, ref) => {
    const theme = getReceiptTheme(state.themeId);

    // 提取元数据字段（title, author, pub_info, isbn）
    const metaFields = state.metaFields || [];
    const titleField = metaFields.find((f) => f.key === 'title') || {
      key: 'title',
      label: '题名',
      value: '《明亮的夜晚》',
    };
    const authorField = metaFields.find((f) => f.key === 'author') || {
      key: 'author',
      label: '作者',
      value: '崔恩荣',
    };
    const pubInfoField = metaFields.find((f) => f.key === 'pub_info') || {
      key: 'pub_info',
      label: '出版信息',
      value: '台海出版社 · 2023',
    };
    const isbnField = metaFields.find((f) => f.key === 'isbn') || {
      key: 'isbn',
      label: 'ISBN',
      value: state.barcodeText || '9787516835159',
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
      const patch: Partial<ReceiptState> = { metaFields: fields };
      if (key === 'isbn') {
        patch.barcodeText = value;
      }
      onChange(patch);
    };

    // 专属横线本间距（每行 38px，与字体行高精准贴合）
    const notebookLineStyle: React.CSSProperties = {
      backgroundImage: `repeating-linear-gradient(transparent, transparent 37px, color-mix(in srgb, ${theme.text} 18%, transparent) 37px, color-mix(in srgb, ${theme.text} 18%, transparent) 38px)`,
      lineHeight: '38px',
      backgroundAttachment: 'local',
    };

    return (
      <div
        ref={ref}
        data-receipt-paper="true"
        className="relative w-full max-w-[380px] min-h-[740px] mx-auto my-2 rounded-sm shadow-xl flex flex-col justify-between select-text transition-colors duration-300 font-sans border border-black/10"
        style={{
          backgroundColor: theme.bg,
          color: theme.text,
        }}
      >
        {/* 卡片主体内容区 */}
        <div className="p-6 pb-2 flex-1 flex flex-col justify-between">
          {/* ========== 1. 顶部行：左侧 @账号署名，右侧 豆瓣评分 ========== */}
          <div>
            <div className="flex justify-between items-center text-xs">
              {/* 左上角用户 Handle / 署名 */}
              <div className="flex items-center gap-0.5 opacity-80 hover:opacity-100 transition-opacity">
                <input
                  type="text"
                  value={state.userHandle || '@SH-LIBRARY'}
                  disabled={disabled}
                  onChange={(e) => onChange({ userHandle: e.target.value })}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  placeholder="@SH-LIBRARY"
                  style={{ color: theme.text }}
                  className="font-mono text-xs bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent w-28"
                />
              </div>

              {/* 右上角豆瓣评分（原 003 编号替换为评分） */}
              <div
                className="flex items-center gap-1.5 font-mono text-xs font-bold px-1.5 py-0.5 rounded border"
                style={{
                  color: theme.text,
                  borderColor: `color-mix(in srgb, ${theme.text} 25%, transparent)`,
                  backgroundColor: `color-mix(in srgb, ${theme.text} 6%, transparent)`,
                }}
                title={disabled ? '有下级节点，不可修改' : '豆瓣评分 (Rating)'}
              >
                <span
                  className="w-2 h-2 shrink-0 rounded-xs inline-block"
                  style={{ backgroundColor: theme.accent || theme.text }}
                />
                <input
                  type="text"
                  value={state.rating || '8.9'}
                  disabled={disabled}
                  onChange={(e) => onChange({ rating: e.target.value })}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  placeholder="8.9"
                  className="w-9 text-center font-bold tabular-nums bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                  style={{ color: theme.text }}
                />
              </div>
            </div>

            {/* ========== 2. 标题区：「书摘分享」+ 虚线 + 英文反白胶囊横幅 ========== */}
            <div className="mt-4 mb-6 text-center">
              {/* 大标题：书摘分享 */}
              <input
                type="text"
                value={state.storeName || '书摘分享'}
                disabled={disabled}
                onChange={(e) => onChange({ storeName: e.target.value })}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="书摘分享"
                style={{
                  fontFamily: "'LXGW WenKai', 'Noto Serif SC', 'PingFang SC', serif",
                  color: theme.text,
                }}
                className="w-full text-center text-4xl font-bold tracking-[0.22em] bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent my-1"
              />

              {/* 细虚线 */}
              <div
                className="my-3 border-b border-dashed"
                style={{ borderColor: theme.dashed || `color-mix(in srgb, ${theme.text} 30%, transparent)` }}
              />

              {/* 英文反白横幅色块：BOOK EXCERPT SHARING */}
              <div className="flex justify-center">
                <div
                  className="px-3.5 py-1 rounded-sm shadow-2xs inline-flex items-center justify-center transition-colors"
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
                    className="font-mono text-[11px] font-black uppercase tracking-wider text-white text-center bg-transparent outline-none w-52 border-b border-transparent hover:border-dashed hover:border-white/60 disabled:cursor-not-allowed disabled:hover:border-transparent"
                  />
                </div>
              </div>
            </div>

            {/* ========== 3. 中段书摘主体（单一段落，文楷手账横线排版） ========== */}
            <div className="mt-6 px-1">
              <textarea
                value={state.excerptText || ''}
                disabled={disabled}
                onChange={(e) => onChange({ excerptText: e.target.value })}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="在此输入精彩书摘（单一段落）..."
                rows={6}
                style={{
                  ...notebookLineStyle,
                  fontFamily: "'LXGW WenKai', 'Zhi Mang Xing', 'Noto Serif SC', serif",
                  color: theme.text,
                }}
                className="w-full text-[17px] tracking-wide text-justify font-medium bg-transparent outline-none resize-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent transition-all"
              />
            </div>
          </div>

          {/* ========== 4. 底部右下角图书元数据（题名、作者、出版社·出版年、ISBN） ========== */}
          <div className="mt-8 mb-4 flex flex-col items-end text-right space-y-1.5 pr-1">
            {/* ① 题名（大字号《书名》） */}
            <div className="w-full flex justify-end">
              <input
                type="text"
                value={titleField.value || '《明亮的夜晚》'}
                disabled={disabled}
                onChange={(e) => handleUpdateMeta('title', e.target.value)}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="《题名》"
                style={{
                  fontFamily: "'LXGW WenKai', 'Noto Serif SC', 'PingFang SC', serif",
                  color: theme.text,
                }}
                className="w-full text-right text-3xl font-bold tracking-wider bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
              />
            </div>

            {/* ② 作者 */}
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
                  fontFamily: "'LXGW WenKai', 'Noto Serif SC', 'PingFang SC', serif",
                  color: theme.text,
                }}
                className="w-full text-right text-base font-semibold tracking-wide bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
              />
            </div>

            {/* ③ 出版社 · 出版年 */}
            <div className="w-full flex justify-end">
              <input
                type="text"
                value={pubInfoField.value || '台海出版社 · 2023'}
                disabled={disabled}
                onChange={(e) => handleUpdateMeta('pub_info', e.target.value)}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="出版社 · 出版年"
                style={{
                  fontFamily: "'LXGW WenKai', 'Noto Serif SC', sans-serif",
                  color: theme.faint,
                }}
                className="w-full text-right text-xs tracking-tight bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
              />
            </div>

            {/* ④ ISBN */}
            <div className="w-full flex justify-end">
              <div className="flex items-center gap-1 opacity-75 hover:opacity-100 transition-opacity">
                <span className="font-mono text-[10px] uppercase text-ink-faint">ISBN</span>
                <input
                  type="text"
                  value={isbnField.value || state.barcodeText || '9787516835159'}
                  disabled={disabled}
                  onChange={(e) => handleUpdateMeta('isbn', e.target.value)}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  placeholder="ISBN 编码"
                  style={{
                    color: theme.faint,
                  }}
                  className="font-mono text-[11px] text-right bg-transparent outline-none w-36 border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
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
