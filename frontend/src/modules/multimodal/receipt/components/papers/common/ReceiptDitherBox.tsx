import React, { useEffect, useRef, useState } from 'react';
import { Upload, RefreshCw, Trash2 } from 'lucide-react';
import { createDitheredImage } from '../../../dither';
import { stopEvent } from './stopEvent';

export interface ReceiptDitherBoxProps {
  imageUrl?: string | null;
  ditherEnabled?: boolean;
  upstreamImageUrl?: string | null;
  themeDashedColor: string;
  themeFaintColor: string;
  disabled?: boolean;
  onImageChange: (dataUrl: string, customImage: boolean) => void;
  onRestoreUpstream?: () => void;
  onClearImage?: () => void;
}

/**
 * 热敏小票插图点阵化展示与上传组件
 */
export const ReceiptDitherBox: React.FC<ReceiptDitherBoxProps> = ({
  imageUrl,
  ditherEnabled = true,
  upstreamImageUrl,
  themeDashedColor,
  themeFaintColor,
  disabled = false,
  onImageChange,
  onRestoreUpstream,
  onClearImage,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ditheredPreview, setDitheredPreview] = useState<string | null>(null);
  const [isDithering, setIsDithering] = useState(false);

  // 处理图片点阵化预览
  useEffect(() => {
    let active = true;
    if (!imageUrl || imageUrl.trim() === '') {
      setDitheredPreview(null);
      return;
    }

    if (ditherEnabled) {
      setIsDithering(true);
      createDitheredImage(imageUrl, { targetWidth: 400 })
        .then((res) => {
          if (active) {
            setDitheredPreview(res);
            setIsDithering(false);
          }
        })
        .catch(() => {
          if (active) {
            setDitheredPreview(imageUrl);
            setIsDithering(false);
          }
        });
    } else {
      setDitheredPreview(imageUrl);
      setIsDithering(false);
    }

    return () => {
      active = false;
    };
  }, [imageUrl, ditherEnabled]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        onImageChange(dataUrl, true);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      className="relative group border border-dashed rounded p-1 text-center"
      style={{ borderColor: themeDashedColor }}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="image/*"
        disabled={disabled}
        className="hidden"
      />

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
            <div
              data-export-ignore="true"
              className="export-ignore absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition-opacity"
            >
              <button
                type="button"
                onClick={() => {
                  if (!disabled) fileInputRef.current?.click();
                }}
                onMouseDown={stopEvent}
                onPointerDown={stopEvent}
                className="p-1.5 rounded bg-white/90 text-neutral-800 hover:bg-white text-[11px] flex items-center gap-1 shadow-xs cursor-pointer"
                title="更换图片"
              >
                <Upload size={12} /> 更换
              </button>
              {upstreamImageUrl && imageUrl !== upstreamImageUrl && onRestoreUpstream && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestoreUpstream();
                  }}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  className="p-1.5 rounded bg-white/90 text-neutral-800 hover:bg-white text-[11px] flex items-center gap-1 shadow-xs cursor-pointer"
                  title="恢复上游图片"
                >
                  <RefreshCw size={12} /> 恢复上游
                </button>
              )}
              {imageUrl && onClearImage && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearImage();
                  }}
                  onMouseDown={stopEvent}
                  onPointerDown={stopEvent}
                  className="p-1.5 rounded bg-red-500 text-white hover:bg-red-600 text-[11px] flex items-center gap-1 shadow-xs cursor-pointer"
                  title="移除图片"
                >
                  <Trash2 size={12} /> 移除
                </button>
              )}
            </div>
          )}
          {ditherEnabled && (
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
            style={{ color: themeFaintColor }}
          >
            <Upload size={20} strokeWidth={1.5} />
            <span className="text-[11px]">点击上传照片 / 插图</span>
          </div>
          {upstreamImageUrl && !disabled && onRestoreUpstream && (
            <button
              type="button"
              data-export-ignore="true"
              onClick={(e) => {
                e.stopPropagation();
                onRestoreUpstream();
              }}
              onMouseDown={stopEvent}
              onPointerDown={stopEvent}
              className="export-ignore text-[11px] px-2.5 py-1 rounded bg-accent/10 border border-accent/40 text-accent hover:bg-accent/20 flex items-center gap-1 transition-colors z-10 font-sans cursor-pointer active:scale-95"
            >
              <RefreshCw size={11} /> 使用上游图片
            </button>
          )}
        </div>
      )}
    </div>
  );
};
