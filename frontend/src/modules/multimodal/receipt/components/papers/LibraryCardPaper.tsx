import React, { useRef } from 'react';
import { Plus, X, Upload, RefreshCw, Trash2, Dices } from 'lucide-react';
import { getReceiptTheme } from '../../themes';
import {
  generateRandomBorrowerRecords,
  isChineseName,
  CHINESE_BORROWER_FONTS,
  generateRandomMaskedChineseName,
} from '../../borrowerGenerator';
import type { BorrowerRecordItem, ReceiptState } from '../../types';
import { stopEvent } from './common/stopEvent';

export interface LibraryCardPaperProps {
  state: ReceiptState;
  onChange: (patch: Partial<ReceiptState>) => void;
  upstreamImageUrl?: string | null;
  disabled?: boolean;
}

/**
 * 预设 2：复古图书馆借书卡组件 (Library Card View)
 */
export const LibraryCardPaper = React.forwardRef<HTMLDivElement, LibraryCardPaperProps>(
  (
    {
      state,
      onChange,
      upstreamImageUrl,
      disabled = false,
    },
    ref
  ) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 从元数据字段中提取 author, title, pub_year
    const authorField = state.metaFields?.find((f) => f.key === 'author') || {
      key: 'author',
      label: 'Author',
      value: '',
    };
    const titleField = state.metaFields?.find((f) => f.key === 'title') || {
      key: 'title',
      label: 'Title',
      value: '',
    };
    const yearField = state.metaFields?.find((f) => f.key === 'pub_year') || {
      key: 'pub_year',
      label: 'Year',
      value: '',
    };

    const handleUpdateMeta = (key: string, value: string) => {
      if (disabled) return;
      const fields = [...(state.metaFields || [])];
      const idx = fields.findIndex((f) => f.key === key);
      if (idx >= 0) {
        fields[idx] = { ...fields[idx], value };
      } else {
        fields.push({ key, label: key, value, visible: true });
      }
      onChange({ metaFields: fields });
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (dataUrl) {
          onChange({ imageUrl: dataUrl, coverImageUrl: dataUrl, customImage: true });
        }
      };
      reader.readAsDataURL(file);
    };

    // 借阅记录操作
    const records = state.borrowerRecords || [];
    const totalRows = 7;
    const emptyRowsCount = Math.max(0, totalRows - records.length);

    const handleUpdateRecord = (id: string, patch: Partial<BorrowerRecordItem>) => {
      if (disabled) return;
      const updated = records.map((r) => {
        if (r.id !== id) return r;
        const nextName = patch.name !== undefined ? patch.name : r.name;
        const isCn = isChineseName(nextName);
        let fontClass = patch.fontClass !== undefined ? patch.fontClass : r.fontClass;

        if (!isCn) {
          fontClass = 'font-handwriting-en';
        } else if (!fontClass || fontClass === 'font-handwriting-en') {
          // 若之前是英文或未设置字体，分配一个当前卡片未使用的中文字体
          const usedFonts = new Set(records.filter((rec) => rec.id !== id).map((rec) => rec.fontClass));
          const available = CHINESE_BORROWER_FONTS.filter((f) => !usedFonts.has(f.id));
          fontClass =
            available.length > 0
              ? available[Math.floor(Math.random() * available.length)].id
              : CHINESE_BORROWER_FONTS[Math.floor(Math.random() * CHINESE_BORROWER_FONTS.length)].id;
        }

        return { ...r, ...patch, fontClass };
      });
      onChange({ borrowerRecords: updated });
    };

    const handleRemoveRecord = (id: string) => {
      if (disabled) return;
      onChange({ borrowerRecords: records.filter((r) => r.id !== id) });
    };

    const handleAddRecord = () => {
      if (disabled) return;
      const nowStr = new Date().toISOString().slice(0, 10);
      const usedFonts = new Set(records.map((r) => r.fontClass));
      const available = CHINESE_BORROWER_FONTS.filter((f) => !usedFonts.has(f.id));
      const fontClass =
        available.length > 0
          ? available[Math.floor(Math.random() * available.length)].id
          : CHINESE_BORROWER_FONTS[Math.floor(Math.random() * CHINESE_BORROWER_FONTS.length)].id;

      const usedNames = new Set(records.map((r) => r.name));
      const newName = generateRandomMaskedChineseName(usedNames);

      const newRecord: BorrowerRecordItem = {
        id: `rec-${Date.now()}`,
        date: nowStr,
        name: newName,
        rotation: 'rotate-1',
        fontClass,
      };
      onChange({ borrowerRecords: [...records, newRecord] });
    };

    const handleRefreshRandomBorrowers = () => {
      if (disabled) return;
      const yearVal = yearField.value || '2020';
      const newRecords = generateRandomBorrowerRecords(4, yearVal);
      onChange({ borrowerRecords: newRecords });
    };

    const theme = getReceiptTheme(state.themeId, state.customThemeColor);

    return (
      <div
        ref={ref}
        data-receipt-paper="true"
        className="relative w-full max-w-[380px] min-h-[720px] mx-auto my-2 rounded-sm shadow-xl overflow-hidden flex flex-col border select-text transition-colors duration-300"
        style={{ backgroundColor: theme.bg, borderColor: theme.dashed }}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          accept="image/*"
          disabled={disabled}
          className="hidden"
        />

        {/* 1. 全局柔和水印底图 */}
        {state.imageUrl && (
          <div
            className="absolute inset-0 w-full h-full pointer-events-none z-[1] opacity-15"
            style={{
              backgroundImage: `url(${state.imageUrl})`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: '60% 70%',
              backgroundSize: '80%',
              mixBlendMode: 'multiply',
              filter: 'saturate(60%) sepia(15%) brightness(1.05) blur(0.5px)',
            }}
          />
        )}

        {/* 悬浮图片操作工具条（有下级节点时隐藏，导出时自动忽略） */}
        {!disabled && (
          <div
            data-export-ignore="true"
            className="export-ignore absolute top-2 left-2 z-30 flex items-center gap-1.5 opacity-0 hover:opacity-100 transition-opacity bg-white/80 backdrop-blur-xs p-1 rounded border border-gray-200 shadow-xs"
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-1 rounded hover:bg-black/5 text-gray-700 text-[11px] flex items-center gap-1 cursor-pointer"
              title="上传水印底图"
            >
              <Upload size={12} /> 上传底图
            </button>
            {upstreamImageUrl && state.imageUrl !== upstreamImageUrl && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange({ imageUrl: upstreamImageUrl, customImage: false });
                }}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                className="p-1 rounded hover:bg-black/5 text-gray-700 text-[11px] flex items-center gap-1 cursor-pointer"
                title="恢复上游图片"
              >
                <RefreshCw size={12} /> 恢复上游
              </button>
            )}
            {state.imageUrl && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange({ imageUrl: '', customImage: false });
                }}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                className="p-1 rounded hover:bg-red-50 text-red-600 text-[11px] flex items-center gap-1 cursor-pointer"
                title="移除底图"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        )}

        {/* 2. 头部信息区 */}
        <div
          className="p-5 pb-3 relative z-10 border-b border-transparent transition-colors duration-300"
          style={{ backgroundColor: theme.bg }}
        >
          {/* 卡片右上角 No. CARD_NUMBER（继承 ISBN 后 4 位） */}
          <div className="absolute top-4 right-4 flex items-center gap-1 font-typewriter text-xs tracking-widest border px-1.5 py-0.5 rounded bg-white/60 shadow-2xs"
              style={{ color: theme.faint, borderColor: theme.dashed }}>
            <span>No.</span>
            <input
              type="text"
              value={state.cardNumber || ''}
              disabled={disabled}
              onChange={(e) => onChange({ cardNumber: e.target.value })}
              onMouseDown={stopEvent}
              onPointerDown={stopEvent}
              placeholder="5399"
              title={disabled ? '有下级节点，不可修改' : '卡片编号（默认继承 ISBN 后四位）'}
              className="w-12 bg-transparent outline-none font-bold hover:border-b hover:border-current focus:border-b disabled:cursor-not-allowed disabled:hover:border-transparent"
              style={{ color: theme.faint }}
            />
          </div>

          {/* 居中标题与副标 */}
          <div className="text-center mb-3 mt-1">
            <input
              type="text"
              value={state.storeName || '書海回响'}
              disabled={disabled}
              onChange={(e) => onChange({ storeName: e.target.value })}
              onMouseDown={stopEvent}
              onPointerDown={stopEvent}
              placeholder="書海回响"
              className="w-full text-center text-3xl font-shangtu tracking-[0.2em] font-bold mb-1 bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
              style={{ color: theme.text }}
            />
            <div className="flex items-center justify-center gap-2 opacity-60">
              <div className="h-[1px] w-8" style={{ backgroundColor: theme.faint }} />
              <input
                type="text"
                value={state.subtitle || 'SHANGHAI LIBRARY'}
                disabled={disabled}
                onChange={(e) => onChange({ subtitle: e.target.value })}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="SHANGHAI LIBRARY"
                className="text-[10px] font-shangtu uppercase tracking-widest bg-transparent outline-none text-center w-36 border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                style={{ color: theme.faint }}
              />
              <div className="h-[1px] w-8" style={{ backgroundColor: theme.faint }} />
            </div>
          </div>

          {/* 元数据字段区：Author, Title, Call No., Year */}
          <div className="space-y-2 text-xs">
            {/* Author */}
            <div className="flex items-baseline border-b pb-1" style={{ borderColor: theme.dashed }}>
              <label className="w-12 text-[10px] font-typewriter uppercase tracking-wider shrink-0" style={{ color: theme.accent }}>
                Author
              </label>
              <input
                type="text"
                value={authorField.value || ''}
                disabled={disabled}
                onChange={(e) => handleUpdateMeta('author', e.target.value)}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="[作者]"
                className="flex-1 text-base font-youyouyisong bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                style={{ color: theme.text }}
              />
            </div>

            {/* Title */}
            <div className="flex items-baseline border-b pb-1" style={{ borderColor: theme.dashed }}>
              <label className="w-12 text-[10px] font-typewriter uppercase tracking-wider shrink-0" style={{ color: theme.accent }}>
                Title
              </label>
              <input
                type="text"
                value={titleField.value || ''}
                disabled={disabled}
                onChange={(e) => handleUpdateMeta('title', e.target.value)}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                placeholder="[题名]"
                className="flex-1 text-lg font-youyouyisong font-bold bg-transparent outline-none tracking-wide border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                style={{ color: theme.text }}
              />
            </div>

            {/* Call No. & Year */}
            <div className="flex gap-4 pt-1">
              <div className="flex-1 px-2 py-0.5">
                <label className="block text-[9px] font-typewriter uppercase opacity-70" style={{ color: theme.accent }}>
                  Call No.
                </label>
                <input
                  type="text"
                  value={state.callNumber || ''}
                  disabled={disabled}
                  onChange={(e) => onChange({ callNumber: e.target.value })}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  placeholder="[索书号留空/自定义]"
                  className="w-full text-sm font-typewriter font-bold bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                  style={{ color: theme.text }}
                />
              </div>

              <div className="w-24 px-2 py-0.5">
                <label className="block text-[9px] font-typewriter uppercase opacity-70" style={{ color: theme.accent }}>
                  Year
                </label>
                <input
                  type="text"
                  value={yearField.value || ''}
                  disabled={disabled}
                  onChange={(e) => handleUpdateMeta('pub_year', e.target.value)}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  placeholder="2024"
                  className="w-full text-sm font-typewriter font-bold bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                  style={{ color: theme.text }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* 3. 中段表头（背景色自适应当前纸色，分割线自适应主题） */}
        <div
          className="border-y-2 h-9 flex items-center relative z-20 shadow-2xs transition-colors duration-300"
          style={{
            backgroundColor: `color-mix(in srgb, ${theme.text} 7%, ${theme.bg})`,
            borderColor: theme.accent,
          }}
        >
          <div className="w-[32%] flex items-center justify-center">
            <span className="text-[10px] font-bold font-typewriter uppercase" style={{ color: theme.accent }}>
              Date Due
            </span>
          </div>
          <div className="w-[68%] flex items-center justify-between px-3">
            <span className="text-[10px] font-bold font-typewriter uppercase" style={{ color: theme.accent }}>
              Borrower's Name
            </span>
            {!disabled && (
              <div data-export-ignore="true" className="export-ignore flex items-center gap-1 opacity-75 hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={handleRefreshRandomBorrowers}
                  className="p-1 rounded hover:bg-black/10 text-[10px] flex items-center gap-0.5 cursor-pointer font-sans"
                  style={{ color: theme.accent }}
                  title="随机刷新借阅人和日期"
                >
                  <Dices size={12} /> 随机
                </button>
                <button
                  type="button"
                  onClick={handleAddRecord}
                  className="p-1 rounded hover:bg-black/10 text-[10px] flex items-center gap-0.5 cursor-pointer font-sans"
                  style={{ color: theme.accent }}
                  title="添加借阅记录"
                >
                  <Plus size={12} /> 添加
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 4. 借阅记录网格区 */}
        <div className="flex-1 relative flex flex-col z-20">
          {/* 竖向红色分隔线 */}
          <div
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: '32%',
              width: '2px',
              backgroundColor: '#ef4444',
              opacity: 0.6,
              zIndex: 5,
            }}
          />

          {/* 借阅记录行 */}
          {records.map((record) => {
            return (
              <div
                key={record.id}
                className="group/row flex border-b h-11 relative items-center transition-colors"
                style={{ borderColor: `color-mix(in srgb, ${theme.dashed} 80%, transparent)` }}
              >
                {/* 左侧：Date Due */}
                <div className="w-[32%] px-2 flex items-center justify-center">
                  <input
                    type="text"
                    value={record.date}
                    disabled={disabled}
                    onChange={(e) => handleUpdateRecord(record.id, { date: e.target.value })}
                    onMouseDown={stopEvent}
                    onPointerDown={stopEvent}
                    className={`font-stamp text-xs text-center w-full bg-transparent outline-none font-bold ${
                      record.rotation || ''
                    } border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent`}
                    style={{ color: theme.accent }}
                  />
                </div>

                {/* 右侧：Borrower's Name */}
                <div className="w-[68%] px-3 flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={record.name}
                    disabled={disabled}
                    onChange={(e) => handleUpdateRecord(record.id, { name: e.target.value })}
                    onMouseDown={stopEvent}
                    onPointerDown={stopEvent}
                    style={{ color: theme.text }}
                    className={`${
                      record.fontClass || 'font-handwriting-cn'
                    } text-xl flex-1 bg-transparent outline-none tracking-wide border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent`}
                  />
                  {!disabled && (
                    <button
                      type="button"
                      data-export-ignore="true"
                      onClick={() => handleRemoveRecord(record.id)}
                      className="export-ignore opacity-0 group-hover/row:opacity-100 text-red-400 hover:text-red-600 p-0.5 transition-opacity"
                      title="删除此行"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* 补齐空行 */}
          {Array.from({ length: emptyRowsCount }).map((_, idx) => (
            <div
              key={`empty-${idx}`}
              className="flex border-b h-11 relative"
              style={{ borderColor: `color-mix(in srgb, ${theme.dashed} 80%, transparent)` }}
            />
          ))}
        </div>

        {/* 5. 底部区域 */}
        <div
          className="relative p-5 pb-8 border-t-[3px] border-double z-20 transition-colors duration-300"
          style={{ borderColor: theme.accent, background: `linear-gradient(to bottom, ${theme.bg}bf, ${theme.bg})` }}
        >
          {/* 上半部分：借阅须知（中文） + 图书馆 Logo 并排 */}
          <div className="flex justify-between items-center gap-2">
            {/* 左侧中文须知 */}
            <div className="w-[64%] text-justify">
              <textarea
                value={state.footerMessage || ''}
                disabled={disabled}
                onChange={(e) => onChange({ footerMessage: e.target.value })}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                rows={4}
                className="w-full text-[10px] leading-relaxed font-youyouyisong font-medium bg-transparent outline-none resize-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
                style={{ color: theme.text }}
              />
            </div>

            {/* 右侧图书馆 Logo 印章图（位于中文须知右侧，位置舒适居中） */}
            <div className="w-28 opacity-85 mix-blend-multiply flex items-center justify-end shrink-0 pointer-events-none pr-1">
              <img
                src="/assets/receipt/logozi_shl.jpg"
                alt="Logo"
                className="w-full h-auto mix-blend-multiply filter contrast-125 brightness-105 saturate-50"
              />
            </div>
          </div>

          {/* 下半部分：英文借阅归还提示（横向延展） */}
          <div className="mt-1">
            <input
              type="text"
              value={state.bottomNote || ''}
              disabled={disabled}
              onChange={(e) => onChange({ bottomNote: e.target.value })}
              onMouseDown={stopEvent}
              onPointerDown={stopEvent}
              className="w-full text-[8px] uppercase tracking-wider font-typewriter bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
              style={{ color: `color-mix(in srgb, ${theme.accent} 70%, transparent)` }}
            />
          </div>
        </div>

        {/* 底部活页圆孔打孔效果 */}
        <div
          className="absolute bottom-2.5 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full z-30 pointer-events-none"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.06)',
            boxShadow: 'inset 1px 1px 2px rgba(0, 0, 0, 0.25), 0 1px 0 rgba(255, 255, 255, 0.8)',
          }}
        />
      </div>
    );
  }
);

LibraryCardPaper.displayName = 'LibraryCardPaper';
