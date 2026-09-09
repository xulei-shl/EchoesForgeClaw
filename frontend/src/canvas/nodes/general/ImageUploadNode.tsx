import React, { memo, useRef, useState } from 'react';
import { ImagePlus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { CanvasNode } from '../_shared/CanvasNode';
import { NodeActionBar } from '../_shared/NodeActionBar';
import { Tooltip } from '../../../shared/components/ui/Tooltip';
import { useFeedback } from '../../../shared/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../_shared/nodeTypes';
import {
  RASTER_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  fileToDataUrl,
  optimizeDataUrl,
} from '../../core/imageUpload';

export interface ImageUploadNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 已上传图片（data URL），无图时为 null */
  imageUrl?: string | null;
  /** 已上传图片的文件名（展示用） */
  imageName?: string;
  onRemove?: (id: string) => void;
  /** 上传 / 替换 / 移除图片：imageUrl 为 null 表示移除 */
  onImageChange?: (id: string, imageUrl: string | null, imageName: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  /** 卡片底部「+」插槽 */
  footer?: React.ReactNode;
  /** 根节点右键菜单回调 */
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const ImageUploadNodeInner: React.FC<ImageUploadNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  imageUrl = null,
  imageName = '',
  onRemove,
  onImageChange,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
}) => {
  const { showToast } = useFeedback();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 拖拽悬停高亮
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    if (!RASTER_IMAGE_TYPES.includes(file.type)) {
      showToast('请选择 PNG / JPG / WebP / GIF 格式的图片', { type: 'error' });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      showToast('图片大小不能超过 8MB', { type: 'error' });
      return;
    }
    try {
      const raw = await fileToDataUrl(file);
      const stored = await optimizeDataUrl(raw, file.size);
      onImageChange?.(id, stored, file.name);
    } catch (e: any) {
      showToast(e?.message || '图片处理失败，请重试', { type: 'error' });
    }
  };

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一文件
    if (file) void handleFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || '图片上传'}
      dotColor={NODE_COLORS.image_upload}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 420, height: 420 }}
      showLeftAnchor={true}
      showRightAnchor={true}
      footer={footer}
      actionBar={
        <NodeActionBar>
          <NodeActionBar.Custom
            icon={<RefreshCw size={16} strokeWidth={1.5} />}
            tooltip={imageUrl ? '替换图片' : '上传图片'}
            onClick={() => {
              fileInputRef.current?.click();
            }}
          />
          {imageUrl && (
            <NodeActionBar.Custom
              icon={<Trash2 size={16} strokeWidth={1.5} />}
              tooltip="移除图片"
              onClick={() => onImageChange?.(id, null, '')}
              className="text-ink-faint hover:text-error"
            />
          )}
        </NodeActionBar>
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handlePick}
      />
      <div className="relative h-full flex flex-col flex-1 min-h-0">
        {imageUrl ? (
          <div 
            className="relative group border border-dashed rounded-lg p-1 border-paper-grid bg-paper flex-1 min-h-0 overflow-hidden"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {dragOver && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-paper/80 backdrop-blur-sm border-2 border-accent text-accent font-medium rounded-lg transition-all">
                释放以替换图片
              </div>
            )}
            <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
              <PhotoView src={imageUrl}>
                <Tooltip content="点击全屏查看">
                  <img
                    src={imageUrl}
                    alt={imageName || '上传的图片'}
                    className="w-full h-full object-contain cursor-zoom-in group-hover:opacity-95 active:scale-[0.99] transition-transform transition-opacity"
                    loading="lazy"
                  />
                </Tooltip>
              </PhotoView>
            </PhotoProvider>
            {imageName && (
              <div className="absolute inset-x-2 bottom-2 px-2 py-1 rounded bg-paper/90 backdrop-blur-sm border border-paper-grid text-[10px] text-ink-light font-sans truncate pointer-events-none">
                {imageName}
              </div>
            )}
          </div>
        ) : (
          /* 空态：点击或拖拽上传 */
          <button
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`group w-full h-full min-h-[200px] flex flex-col items-center justify-center gap-2.5 rounded-md border border-dashed transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              dragOver
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-paper-grid bg-paper-grid/5 text-ink-faint hover:text-accent hover:border-accent/40 hover:bg-accent/5'
            }`}
          >
            <div className="flex items-center justify-center w-12 h-12 rounded-full border border-dashed border-paper-grid bg-paper/60 group-hover:scale-105 transition-transform duration-300">
              <ImagePlus size={22} strokeWidth={1.5} />
            </div>
            <div className="text-center">
              <p className="text-sm font-serif text-ink-light group-hover:text-accent transition-colors">
                {dragOver ? '松开鼠标上传' : '点击或拖拽图片到此处'}
              </p>
              <p className="mt-1 text-[11px] font-sans text-ink-faint">
                PNG / JPG / WebP / GIF · 不超过 8MB
              </p>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-sans border border-dashed border-paper-grid group-hover:border-accent/40 transition-colors">
              <Upload size={11} strokeWidth={2} />
              选择文件
            </span>
          </button>
        )}
      </div>
    </CanvasNode>
  );
};

export const ImageUploadNode = memo(ImageUploadNodeInner);
ImageUploadNode.displayName = 'ImageUploadNode';
export default ImageUploadNode;
