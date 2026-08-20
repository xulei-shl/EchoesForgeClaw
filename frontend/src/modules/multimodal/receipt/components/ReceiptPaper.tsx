import React, { useEffect, useRef, useState } from 'react';
import { Plus, X, Upload, RefreshCw, Star, Trash2, Dices } from 'lucide-react';
import { getReceiptTheme } from '../themes';
import { createBarcodeSvgUri } from '../barcode';
import { createDitheredImage } from '../dither';
import { generateRandomBorrowerRecords, isChineseName } from '../borrowerGenerator';
import type { BorrowerRecordItem, ReceiptItem, ReceiptState } from '../types';

interface ReceiptPaperProps {
  state: ReceiptState;
  onChange: (patch: Partial<ReceiptState>) => void;
  /** 上游可用的图片（如藏书票图或图书封面） */
  upstreamImageUrl?: string | null;
  disabled?: boolean;
}

const stopEvent = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * 复古图书馆借书卡组件 (Library Card View)
 */
const LibraryCardPaper: React.FC<ReceiptPaperProps> = ({
  state,
  onChange,
  upstreamImageUrl,
  disabled = false,
}) => {
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
      const fontClass = isChineseName(nextName) ? 'font-handwriting-cn' : 'font-handwriting-en';
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
    const newRecord: BorrowerRecordItem = {
      id: `rec-${Date.now()}`,
      date: nowStr,
      name: '某读者',
      rotation: 'rotate-1',
      fontClass: 'font-handwriting-cn',
    };
    onChange({ borrowerRecords: [...records, newRecord] });
  };

  const handleRefreshRandomBorrowers = () => {
    if (disabled) return;
    const yearVal = yearField.value || '2020';
    const newRecords = generateRandomBorrowerRecords(4, yearVal);
    onChange({ borrowerRecords: newRecords });
  };

  const theme = getReceiptTheme(state.themeId);

  return (
    <div
      className="relative w-full max-w-[380px] min-h-[720px] mx-auto my-2 rounded-sm shadow-xl overflow-hidden flex flex-col border border-[#d1d5db] select-text transition-colors duration-300"
      style={{ backgroundColor: theme.bg }}
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

      {/* 悬浮图片操作工具条（有下级节点时隐藏） */}
      {!disabled && (
        <div className="absolute top-2 left-2 z-30 flex items-center gap-1.5 opacity-0 hover:opacity-100 transition-opacity bg-white/80 backdrop-blur-xs p-1 rounded border border-gray-200 shadow-xs">
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
        <div className="absolute top-4 right-4 flex items-center gap-1 text-gray-500 font-typewriter text-xs tracking-widest border border-gray-300 px-1.5 py-0.5 rounded bg-white/60 shadow-2xs">
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
            className="w-12 bg-transparent outline-none font-bold text-gray-700 hover:border-b hover:border-gray-400 focus:border-b focus:border-gray-600 disabled:cursor-not-allowed disabled:hover:border-transparent"
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
            className="w-full text-center text-3xl font-shangtu text-gray-800 tracking-[0.2em] font-bold mb-1 bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-gray-300 disabled:cursor-not-allowed disabled:hover:border-transparent"
          />
          <div className="flex items-center justify-center gap-2 opacity-60">
            <div className="h-[1px] w-8 bg-gray-400"></div>
            <input
              type="text"
              value={state.subtitle || 'SHANGHAI LIBRARY'}
              disabled={disabled}
              onChange={(e) => onChange({ subtitle: e.target.value })}
              onMouseDown={stopEvent}
              onPointerDown={stopEvent}
              placeholder="SHANGHAI LIBRARY"
              className="text-[10px] font-shangtu text-gray-600 uppercase tracking-widest bg-transparent outline-none text-center w-36 border-b border-transparent hover:border-dashed hover:border-gray-300 disabled:cursor-not-allowed disabled:hover:border-transparent"
            />
            <div className="h-[1px] w-8 bg-gray-400"></div>
          </div>
        </div>

        {/* 元数据字段区：Author, Title, Call No., Year */}
        <div className="space-y-2 text-xs">
          {/* Author */}
          <div className="flex items-baseline border-b border-blue-200 pb-1">
            <label className="w-14 text-[10px] text-blue-800 font-typewriter uppercase tracking-wider shrink-0 font-bold">
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
              className="flex-1 text-base font-youyouyisong text-gray-800 bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-blue-300 disabled:cursor-not-allowed disabled:hover:border-transparent"
            />
          </div>

          {/* Title */}
          <div className="flex items-baseline border-b border-blue-200 pb-1">
            <label className="w-14 text-[10px] text-blue-800 font-typewriter uppercase tracking-wider shrink-0 font-bold">
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
              className="flex-1 text-lg font-youyouyisong font-semibold text-gray-900 bg-transparent outline-none tracking-wide border-b border-transparent hover:border-dashed hover:border-blue-300 disabled:cursor-not-allowed disabled:hover:border-transparent"
            />
          </div>

          {/* Call No. & Year */}
          <div className="flex gap-4 pt-1">
            <div className="flex-1 px-1 py-0.5 border-b border-blue-100">
              <label className="block text-[9px] text-blue-800 font-typewriter uppercase opacity-70 font-bold">
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
                className="w-full text-sm font-typewriter text-gray-700 font-bold bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-blue-300 disabled:cursor-not-allowed disabled:hover:border-transparent"
              />
            </div>
            <div className="w-24 px-1 py-0.5 border-b border-blue-100">
              <label className="block text-[9px] text-blue-800 font-typewriter uppercase opacity-70 font-bold">
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
                className="w-full text-sm font-typewriter text-gray-700 font-bold bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-blue-300 disabled:cursor-not-allowed disabled:hover:border-transparent"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 3. 中段表头 */}
      <div
        className="border-y-2 h-9 flex items-center relative z-20 shadow-2xs transition-colors duration-300"
        style={{
          backgroundColor: `color-mix(in srgb, ${theme.text} 8%, ${theme.bg})`,
          borderColor: `color-mix(in srgb, ${theme.text} 80%, #1e3a8a 20%)`,
        }}
      >
        <div className="w-[32%] flex items-center justify-center">
          <span
            className="text-[11px] font-bold font-typewriter uppercase tracking-wider"
            style={{ color: `color-mix(in srgb, ${theme.text} 90%, #1e3a8a 10%)` }}
          >
            Date Due
          </span>
        </div>
        <div className="w-[68%] flex items-center justify-between px-3">
          <span
            className="text-[11px] font-bold font-typewriter uppercase tracking-wider"
            style={{ color: `color-mix(in srgb, ${theme.text} 90%, #1e3a8a 10%)` }}
          >
            Borrower's Name
          </span>
          {!disabled && (
            <div className="flex items-center gap-1 opacity-75 hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={handleRefreshRandomBorrowers}
                className="p-1 rounded hover:bg-black/10 text-[10px] flex items-center gap-0.5 cursor-pointer font-sans"
                style={{ color: theme.text }}
                title="随机刷新借阅人和日期"
              >
                <Dices size={12} /> 随机
              </button>
              <button
                type="button"
                onClick={handleAddRecord}
                className="p-1 rounded hover:bg-black/10 text-[10px] flex items-center gap-0.5 cursor-pointer font-sans"
                style={{ color: theme.text }}
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
              className="group/row flex border-b h-11 relative items-center hover:bg-black/5 transition-colors"
              style={{
                borderColor: `color-mix(in srgb, ${theme.text} 15%, transparent)`,
              }}
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
                  style={{ color: `color-mix(in srgb, ${theme.text} 90%, #1e3a8a 10%)` }}
                  className={`font-stamp text-xs text-center w-full bg-transparent outline-none font-bold ${
                    record.rotation || ''
                  } border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent`}
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
                    onClick={() => handleRemoveRecord(record.id)}
                    className="opacity-0 group-hover/row:opacity-100 text-red-400 hover:text-red-600 p-0.5 transition-opacity"
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
            style={{
              borderColor: `color-mix(in srgb, ${theme.text} 15%, transparent)`,
            }}
          />
        ))}
      </div>

      {/* 5. 底部区域 */}
      <div
        className="relative p-4 pb-7 border-t-[3px] border-double border-blue-900 z-20 flex justify-between items-end transition-colors duration-300"
        style={{
          background: `linear-gradient(to bottom, ${theme.bg}d9, ${theme.bg})`,
        }}
      >
        {/* 左侧借阅须知 */}
        <div className="w-[65%] text-justify space-y-1">
          <textarea
            value={state.footerMessage || ''}
            disabled={disabled}
            onChange={(e) => onChange({ footerMessage: e.target.value })}
            onMouseDown={stopEvent}
            onPointerDown={stopEvent}
            rows={4}
            className="w-full text-[10px] leading-relaxed text-gray-600 font-youyouyisong bg-transparent outline-none resize-none border-b border-transparent hover:border-dashed hover:border-gray-300 disabled:cursor-not-allowed disabled:hover:border-transparent"
          />
          <input
            type="text"
            value={state.bottomNote || ''}
            disabled={disabled}
            onChange={(e) => onChange({ bottomNote: e.target.value })}
            onMouseDown={stopEvent}
            onPointerDown={stopEvent}
            className="w-full text-[8px] uppercase tracking-wider text-blue-900/80 font-typewriter bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-gray-300 disabled:cursor-not-allowed disabled:hover:border-transparent"
          />
        </div>

        {/* 右侧图书馆 Logo 印章图 */}
        <div className="w-28 opacity-85 mix-blend-multiply flex items-center justify-end pointer-events-none relative -bottom-2 right-0">
          <img
            src="/assets/receipt/logozi_shl.jpg"
            alt="Logo"
            className="w-full h-auto mix-blend-multiply filter contrast-125 brightness-105"
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
};

/**
 * 经典标准热敏小票组件 (Standard Thermal Receipt)
 */
const StandardReceiptPaper: React.FC<ReceiptPaperProps> = ({
  state,
  onChange,
  upstreamImageUrl,
  disabled = false,
}) => {
  const theme = getReceiptTheme(state.themeId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ditheredPreview, setDitheredPreview] = useState<string | null>(null);
  const [isDithering, setIsDithering] = useState(false);

  // 处理图片点阵化预览
  useEffect(() => {
    let active = true;
    const currentImg = state.imageUrl;
    if (!currentImg || currentImg.trim() === '') {
      setDitheredPreview(null);
      return;
    }

    if (state.ditherEnabled) {
      setIsDithering(true);
      createDitheredImage(currentImg, { targetWidth: 400 })
        .then((res) => {
          if (active) {
            setDitheredPreview(res);
            setIsDithering(false);
          }
        })
        .catch(() => {
          if (active) {
            setDitheredPreview(currentImg);
            setIsDithering(false);
          }
        });
    } else {
      setDitheredPreview(currentImg);
      setIsDithering(false);
    }

    return () => {
      active = false;
    };
  }, [state.imageUrl, state.ditherEnabled]);

  // 本地图片上传
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

  // 添加条目
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

  // 删除条目
  const handleRemoveItem = (id: string) => {
    if (disabled) return;
    onChange({ items: (state.items || []).filter((it) => it.id !== id) });
  };

  // 更新条目
  const handleUpdateItem = (id: string, patch: Partial<ReceiptItem>) => {
    if (disabled) return;
    onChange({
      items: (state.items || []).map((it) => (it.id === id ? { ...it, ...patch } : it)),
    });
  };

  // 更新元数据字段
  const handleUpdateMetaField = (key: string, value: string) => {
    if (disabled) return;
    onChange({
      metaFields: (state.metaFields || []).map((f) => (f.key === key ? { ...f, value } : f)),
    });
  };

  const barcodeSvg = createBarcodeSvgUri(state.barcodeText || '9787020002207', theme.text);

  return (
    <div
      className="relative w-full max-w-[380px] mx-auto my-2 rounded-sm shadow-md transition-colors duration-300 font-mono"
      style={{
        backgroundColor: theme.bg,
        color: theme.text,
      }}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="image/*"
        disabled={disabled}
        className="hidden"
      />

      {/* 顶部撕纸锯齿装饰 */}
      <div
        className="w-full h-3"
        style={{
          background: `radial-gradient(circle, transparent, transparent 50%, ${theme.bg} 50%, ${theme.bg} 100%) -7px -8px / 16px 16px repeat-x`,
        }}
      />

      <div className="px-5 py-4 flex flex-col gap-3.5 text-xs">
        {/* --- 店名 / 馆名 --- */}
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
        <div
          className="relative group border border-dashed rounded p-1 text-center"
          style={{ borderColor: theme.dashed }}
        >
          {ditheredPreview ? (
            <div className="relative overflow-hidden rounded">
              <img
                src={ditheredPreview}
                alt="小票插图"
                className={`w-full max-h-48 object-contain mx-auto transition-opacity ${
                  isDithering ? 'opacity-50' : 'opacity-100'
                }`}
              />
              {!disabled && (
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                  <button
                    type="button"
                    onClick={() => {
                      if (!disabled) fileInputRef.current?.click();
                    }}
                    onMouseDown={stopEvent}
                    onPointerDown={stopEvent}
                    className="p-1.5 rounded bg-white/90 text-neutral-800 hover:bg-white text-[11px] flex items-center gap-1 shadow-sm cursor-pointer"
                    title="更换图片"
                  >
                    <Upload size={12} /> 更换
                  </button>
                  {upstreamImageUrl && state.imageUrl !== upstreamImageUrl && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onChange({ imageUrl: upstreamImageUrl, coverImageUrl: upstreamImageUrl, customImage: false });
                      }}
                      onMouseDown={stopEvent}
                      onPointerDown={stopEvent}
                      className="p-1.5 rounded bg-white/90 text-neutral-800 hover:bg-white text-[11px] flex items-center gap-1 shadow-sm cursor-pointer"
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
                        onChange({ imageUrl: '', coverImageUrl: '', customImage: false });
                      }}
                      onMouseDown={stopEvent}
                      onPointerDown={stopEvent}
                      className="p-1.5 rounded bg-red-500 text-white hover:bg-red-600 text-[11px] flex items-center gap-1 shadow-sm cursor-pointer"
                      title="移除图片"
                    >
                      <Trash2 size={12} /> 移除
                    </button>
                  )}
                </div>
              )}
              {state.ditherEnabled && (
                <div className="text-[10px] mt-1 opacity-60 tracking-wider">[ LO-FI DITHERED PRINT ]</div>
              )}
            </div>
          ) : (
            <div className="py-6 flex flex-col items-center justify-center gap-2">
              <div
                onClick={() => {
                  if (!disabled) fileInputRef.current?.click();
                }}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded transition-colors ${
                  disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-black/5'
                }`}
                style={{ color: theme.faint }}
              >
                <Upload size={20} strokeWidth={1.5} />
                <span className="text-[11px]">点击上传照片 / 插图</span>
              </div>
              {upstreamImageUrl && !disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange({ imageUrl: upstreamImageUrl, coverImageUrl: upstreamImageUrl, customImage: false });
                  }}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  className="text-[11px] px-2.5 py-1 rounded bg-accent/10 border border-accent/40 text-accent hover:bg-accent/20 flex items-center gap-1 transition-colors z-10 font-sans cursor-pointer active:scale-95"
                >
                  <RefreshCw size={11} /> 使用上游图片
                </button>
              )}
            </div>
          )}
        </div>

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

        {/* --- 经典清单列表项 (Items) --- */}
        {state.items && state.items.length > 0 && (
          <div className="space-y-2">
            {state.items.map((item) => (
              <div key={item.id} className="group/item flex items-center justify-between gap-1 text-[12px]">
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(item.id)}
                    className="opacity-0 group-hover/item:opacity-100 text-red-500 hover:text-red-700 p-0.5 cursor-pointer"
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
                onClick={handleAddItem}
                className="w-full py-1 text-center text-[11px] opacity-60 hover:opacity-100 border border-dashed rounded hover:border-current flex items-center justify-center gap-1 transition-opacity cursor-pointer"
                style={{ borderColor: theme.dashed, color: theme.text }}
              >
                <Plus size={11} /> 增加品目
              </button>
            )}
            <div className="border-b border-dashed pt-1" style={{ borderColor: theme.dashed }} />
          </div>
        )}

        {/* --- TOTAL 统计行 --- */}
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
        <div className="flex flex-col items-center gap-1.5 pt-1">
          <img src={barcodeSvg} alt="条形码" className="h-14 max-w-full object-contain" />
          <input
            type="text"
            value={state.barcodeText || ''}
            disabled={disabled}
            onChange={(e) => onChange({ barcodeText: e.target.value })}
            onMouseDown={stopEvent}
            onPointerDown={stopEvent}
            placeholder="ISBN / 条形码数字"
            className="text-center text-[10px] tracking-widest bg-transparent outline-none opacity-60 hover:opacity-100 font-mono w-44 border-b border-transparent hover:border-dashed hover:border-current disabled:cursor-not-allowed disabled:hover:border-transparent"
            style={{ color: theme.text }}
          />
        </div>

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
      <div
        className="w-full h-3"
        style={{
          background: `radial-gradient(circle, transparent, transparent 50%, ${theme.bg} 50%, ${theme.bg} 100%) -7px 0px / 16px 16px repeat-x`,
        }}
      />
    </div>
  );
};

export const ReceiptPaper: React.FC<ReceiptPaperProps> = (props) => {
  if (props.state.templateId === 'reading_log') {
    return <LibraryCardPaper {...props} />;
  }
  return <StandardReceiptPaper {...props} />;
};
