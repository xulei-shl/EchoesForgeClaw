import React, { useRef } from 'react';
import { ImageOff, Maximize2, Trash2, Upload } from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { Button } from './Button';

export interface SkillPreviewPanelProps {
  /** Skill 名称，用于图片 alt 和标识 */
  skillName: string;
  /** 示例图 URL（为空或 null 时表示暂无示例图） */
  previewImage?: string | null;
  /** 是否只读模式（普通用户详情为 true，管理端为 false） */
  readOnly?: boolean;
  /** 上传/更换示例图回调 */
  onUpload?: (file: File) => Promise<void>;
  /** 删除示例图回调 */
  onDelete?: () => Promise<void>;
  /** 是否正在上传中 */
  isUploading?: boolean;
  /** 自定义外层样式 */
  className?: string;
}

/**
 * Skill 示例图展示与管理面板（低圈复杂度通用组件）：
 * - 普通用户端：只读展示 + 点击全屏放大预览
 * - 管理员端：展示 + 点击全屏放大预览 + 上传/更换 + 删除
 */
export const SkillPreviewPanel: React.FC<SkillPreviewPanelProps> = ({
  skillName,
  previewImage,
  readOnly = false,
  onUpload,
  onDelete,
  isUploading = false,
  className = '',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUpload) {
      void onUpload(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* 示例图主展示区 */}
      <div className="p-2 rounded-xl border border-dashed border-paper-grid bg-paper overflow-hidden">
        {previewImage ? (
          <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
            <PhotoView src={previewImage}>
              <div
                className="relative group rounded-lg overflow-hidden after:absolute after:inset-0 after:rounded-lg after:ring-1 after:ring-inset after:ring-black/5 dark:after:ring-white/5 cursor-pointer max-h-[460px] flex items-center justify-center bg-paper/50"
                title="点击全屏查看"
              >
                <img
                  src={previewImage}
                  alt={skillName}
                  className="w-full max-h-[440px] object-contain transition-transform duration-200 group-hover:scale-[1.01]"
                  loading="lazy"
                />
                <div className="absolute right-3 bottom-3 p-1.5 rounded-lg bg-black/50 backdrop-blur-sm text-white/90 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-sm flex items-center gap-1.5 text-xs font-sans">
                  <Maximize2 size={13} strokeWidth={2} />
                  <span>点击全屏预览</span>
                </div>
              </div>
            </PhotoView>
          </PhotoProvider>
        ) : (
          <div className="h-56 flex flex-col items-center justify-center gap-2.5 text-ink-faint">
            <ImageOff size={32} strokeWidth={1.2} />
            <span className="text-xs font-sans">暂无示例图</span>
            {!readOnly && onUpload && (
              <p className="text-[11px] text-ink-faint font-sans mt-0.5">
                支持上传 JPG / PNG / GIF / WebP 格式（最大 5MB）
              </p>
            )}
          </div>
        )}
      </div>

      {/* 管理操作区（仅非只读模式下显示） */}
      {!readOnly && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            size="sm"
            isLoading={isUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={14} strokeWidth={2} className="mr-1" />
            {previewImage ? '更换示例图' : '上传示例图'}
          </Button>

          {previewImage && onDelete && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void onDelete()}
            >
              <Trash2 size={14} strokeWidth={2} className="mr-1 text-error" />
              删除示例图
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
