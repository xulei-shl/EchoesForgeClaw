import React, { useEffect, useRef, useState } from 'react';
import { Plus, X, Upload, RefreshCw, Star, Trash2 } from 'lucide-react';
import { getReceiptTheme } from '../themes';
import { createBarcodeSvgUri } from '../barcode';
import { createDitheredImage } from '../dither';
import type { ReceiptItem, ReceiptMetaField, ReceiptState } from '../types';

interface ReceiptPaperProps {
  state: ReceiptState;
  onChange: (patch: Partial<ReceiptState>) => void;
  /** 上游可用的图片（如藏书票图或图书封面） */
  upstreamImageUrl?: string | null;
}

export const ReceiptPaper: React.FC<ReceiptPaperProps> = ({
  state,
  onChange,
  upstreamImageUrl,
}) => {
  const theme = getReceiptTheme(state.themeId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ditheredPreview, setDitheredPreview] = useState<string | null>(null);
  const [isDithering, setIsDithering] = useState(false);

  // 处理图片点阵化预览
  useEffect(() => {
    let active = true;
    const currentImg = state.imageUrl || upstreamImageUrl;
    if (!currentImg) {
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
  }, [state.imageUrl, upstreamImageUrl, state.ditherEnabled]);

  // 本地图片上传
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        onChange({ imageUrl: dataUrl });
      }
    };
    reader.readAsDataURL(file);
  };

  // 添加条目
  const handleAddItem = () => {
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
    onChange({ items: (state.items || []).filter((it) => it.id !== id) });
  };

  // 更新条目
  const handleUpdateItem = (id: string, patch: Partial<ReceiptItem>) => {
    onChange({
      items: (state.items || []).map((it) => (it.id === id ? { ...it, ...patch } : it)),
    });
  };

  // 更新元数据字段
  const handleUpdateMetaField = (key: string, value: string) => {
    onChange({
      metaFields: (state.metaFields || []).map((f) => (f.key === key ? { ...f, value } : f)),
    });
  };

  const barcodeSvg = createBarcodeSvgUri(state.barcodeText || '9787020002207', theme.text);

  return (
    <div
      className="relative w-full max-w-[380px] mx-auto my-2 rounded-sm shadow-md transition-colors duration-300 font-mono select-none"
      style={{
        backgroundColor: theme.bg,
        color: theme.text,
      }}
    >
      {/* 隐藏的文件上传 input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="image/*"
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
            value={state.storeName}
            onChange={(e) => onChange({ storeName: e.target.value })}
            placeholder="店名 / 图书馆名称"
            className="w-full text-center font-black text-xl tracking-wider uppercase bg-transparent outline-none border-b border-transparent hover:border-dashed hover:border-current focus:border-solid focus:border-current transition-colors"
            style={{ color: theme.text }}
          />
          <input
            type="text"
            value={state.subtitle}
            onChange={(e) => onChange({ subtitle: e.target.value })}
            placeholder="副标题"
            className="w-full text-center text-[11px] font-semibold tracking-widest uppercase mt-0.5 bg-transparent outline-none opacity-70 border-b border-transparent hover:border-dashed hover:border-current focus:border-solid"
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
              value={state.dateTimeText}
              onChange={(e) => onChange({ dateTimeText: e.target.value })}
              className="text-right bg-transparent outline-none w-36"
              style={{ color: theme.text }}
            />
          </div>
          <div className="flex justify-between items-center">
            <span style={{ color: theme.faint }}>Terminal:</span>
            <input
              type="text"
              value={state.terminal}
              onChange={(e) => onChange({ terminal: e.target.value })}
              className="text-right bg-transparent outline-none w-32"
              style={{ color: theme.text }}
            />
          </div>
          <div className="flex justify-between items-center">
            <span style={{ color: theme.faint }}>Served by:</span>
            <input
              type="text"
              value={state.servedBy}
              onChange={(e) => onChange({ servedBy: e.target.value })}
              className="text-right bg-transparent outline-none w-32"
              style={{ color: theme.text }}
            />
          </div>
          {/* 索书号字段（支持留空或人工填入） */}
          <div className="flex justify-between items-center">
            <span style={{ color: theme.faint }}>索书号 (Call No):</span>
            <input
              type="text"
              value={state.callNumber}
              onChange={(e) => onChange({ callNumber: e.target.value })}
              placeholder="[未填写]"
              className="text-right bg-transparent outline-none w-36 font-semibold placeholder:text-opacity-40"
              style={{ color: theme.accent || theme.text }}
            />
          </div>
          {/* 评分字段 */}
          {state.rating && (
            <div className="flex justify-between items-center">
              <span style={{ color: theme.faint }}>豆瓣评分 (Rating):</span>
              <div className="flex items-center gap-1">
                <Star size={11} className="fill-current text-amber-500" />
                <input
                  type="text"
                  value={state.rating}
                  onChange={(e) => onChange({ rating: e.target.value })}
                  className="text-right bg-transparent outline-none w-14 font-bold"
                  style={{ color: theme.text }}
                />
              </div>
            </div>
          )}
        </div>

        {/* 分割线 */}
        <div className="border-b border-dashed" style={{ borderColor: theme.dashed }} />

        {/* --- 插图区域 --- */}
        <div className="relative group border border-dashed rounded p-1 text-center" style={{ borderColor: theme.dashed }}>
          {ditheredPreview ? (
            <div className="relative overflow-hidden rounded">
              <img
                src={ditheredPreview}
                alt="小票插图"
                className={`w-full max-h-48 object-contain mx-auto transition-opacity ${isDithering ? 'opacity-50' : 'opacity-100'}`}
              />
              {/* 悬浮操作层 */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 rounded bg-white/90 text-neutral-800 hover:bg-white text-[11px] flex items-center gap-1 shadow-sm"
                  title="更换图片"
                >
                  <Upload size={12} /> 更换
                </button>
                {state.imageUrl && upstreamImageUrl && state.imageUrl !== upstreamImageUrl && (
                  <button
                    type="button"
                    onClick={() => onChange({ imageUrl: upstreamImageUrl })}
                    className="p-1.5 rounded bg-white/90 text-neutral-800 hover:bg-white text-[11px] flex items-center gap-1 shadow-sm"
                    title="恢复上游图片"
                  >
                    <RefreshCw size={12} /> 恢复上游
                  </button>
                )}
                {state.imageUrl && (
                  <button
                    type="button"
                    onClick={() => onChange({ imageUrl: null })}
                    className="p-1.5 rounded bg-red-500 text-white hover:bg-red-600 text-[11px] flex items-center gap-1 shadow-sm"
                    title="移除图片"
                  >
                    <Trash2 size={12} /> 移除
                  </button>
                )}
              </div>
              {state.ditherEnabled && (
                <div className="text-[10px] mt-1 opacity-60 tracking-wider">
                  [ LO-FI DITHERED PRINT ]
                </div>
              )}
            </div>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="py-8 flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:bg-black/5 rounded transition-colors"
              style={{ color: theme.faint }}
            >
              <Upload size={20} strokeWidth={1.5} />
              <span className="text-[11px]">点击上传照片 / 插图</span>
            </div>
          )}
        </div>

        {/* 分割线 */}
        <div className="border-b border-dashed" style={{ borderColor: theme.dashed }} />

        {/* --- 结构化图书元数据（书名、作者、出版社等） --- */}
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
                    value={field.value}
                    onChange={(e) => handleUpdateMetaField(field.key, e.target.value)}
                    className="text-right flex-1 bg-transparent outline-none font-semibold border-b border-transparent hover:border-dashed hover:border-current"
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
                <button
                  type="button"
                  onClick={() => handleRemoveItem(item.id)}
                  className="opacity-0 group-hover/item:opacity-100 text-red-500 hover:text-red-700 p-0.5"
                  title="删除此项"
                >
                  <X size={12} />
                </button>
                <input
                  type="text"
                  value={item.label}
                  onChange={(e) => handleUpdateItem(item.id, { label: e.target.value })}
                  placeholder="品名 / 书名"
                  className="flex-1 bg-transparent outline-none font-bold uppercase"
                  style={{ color: theme.text }}
                />
                {item.count !== undefined && (
                  <input
                    type="text"
                    value={item.count}
                    onChange={(e) => handleUpdateItem(item.id, { count: e.target.value })}
                    placeholder="数量"
                    className="w-8 text-center bg-transparent outline-none opacity-70"
                    style={{ color: theme.faint }}
                  />
                )}
                {item.value !== undefined && (
                  <input
                    type="text"
                    value={item.value}
                    onChange={(e) => handleUpdateItem(item.id, { value: e.target.value })}
                    placeholder="价格/数值"
                    className="w-20 text-right bg-transparent outline-none font-bold"
                    style={{ color: theme.text }}
                  />
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={handleAddItem}
              className="w-full py-1 text-center text-[11px] opacity-60 hover:opacity-100 border border-dashed rounded hover:border-current flex items-center justify-center gap-1 transition-opacity"
              style={{ borderColor: theme.dashed, color: theme.text }}
            >
              <Plus size={11} /> 增加品目
            </button>
            <div className="border-b border-dashed pt-1" style={{ borderColor: theme.dashed }} />
          </div>
        )}

        {/* --- TOTAL 统计行 --- */}
        {state.totalValue && (
          <div className="flex justify-between items-center font-black text-sm">
            <input
              type="text"
              value={state.totalLabel}
              onChange={(e) => onChange({ totalLabel: e.target.value })}
              className="bg-transparent outline-none uppercase w-28"
              style={{ color: theme.text }}
            />
            <input
              type="text"
              value={state.totalValue}
              onChange={(e) => onChange({ totalValue: e.target.value })}
              className="text-right bg-transparent outline-none flex-1 font-black text-base"
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
            value={state.barcodeText}
            onChange={(e) => onChange({ barcodeText: e.target.value })}
            placeholder="ISBN / 条形码数字"
            className="text-center text-[10px] tracking-widest bg-transparent outline-none opacity-60 hover:opacity-100 font-mono w-44"
            style={{ color: theme.text }}
          />
        </div>

        {/* --- 底部寄语 / 标语 --- */}
        <div className="text-center pt-2 space-y-1">
          <textarea
            value={state.footerMessage}
            onChange={(e) => onChange({ footerMessage: e.target.value })}
            placeholder="底部提示语（如 THANK YOU / 寄语）"
            rows={2}
            className="w-full text-center font-bold text-xs bg-transparent outline-none uppercase resize-none leading-tight tracking-wider"
            style={{ color: theme.text }}
          />
          <input
            type="text"
            value={state.bottomNote}
            onChange={(e) => onChange({ bottomNote: e.target.value })}
            placeholder="最底部小字备注"
            className="w-full text-center text-[10px] bg-transparent outline-none opacity-60 tracking-tight"
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
