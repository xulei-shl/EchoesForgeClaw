import React, { memo, useRef, useState } from 'react';
import { ImagePlus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { Tooltip } from '../../../platform/components/ui/Tooltip';
import { useFeedback } from '../../../platform/components/ui/FeedbackProvider';
import { NODE_COLORS } from '../nodeTypes';

// 允许上传的位图格式（与图片分析节点 / 后端魔数校验一致）
const RASTER_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
// 上传体积上限（与后端 MAX_UPLOAD_IMAGE_BYTES 保持一致）
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
// 超过该体积的原始图片在持久化前会被缩放/压缩（画布快照存于 sessionStorage，空间有限）
const MAX_STORE_BYTES = 1.5 * 1024 * 1024;
// 持久化图片的最长边像素上限
const MAX_STORE_DIM = 1600;

/** 读取 File → base64 data URL */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解析失败'));
    img.src = dataUrl;
  });
}

/**
 * 处理待持久化的图片：
 * - 小图（尺寸与体积均未超限）原样保留，保留原格式与透明度；
 * - 大图经 canvas 缩放（最长边 ≤ MAX_STORE_DIM）并压缩为 JPEG，避免撑爆 sessionStorage。
 *   PNG 透明度会先铺白底再压缩，防止透明区域在 JPEG 下变成黑色；GIF 动画退化为静态帧。
 */
async function optimizeDataUrl(dataUrl: string, rawSize: number): Promise<string> {
  const img = await loadImage(dataUrl);
  if (img.width <= MAX_STORE_DIM && img.height <= MAX_STORE_DIM && rawSize <= MAX_STORE_BYTES) {
    return dataUrl;
  }
  const scale = Math.min(1, MAX_STORE_DIM / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  // 先铺白底，避免透明图片（如 PNG）压缩为 JPEG 时透明区域变黑
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

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
  /** 是否存在下级连线节点 */
  hasDownstream?: boolean;
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
  hasDownstream,
}) => {
  const { showToast } = useFeedback();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 拖拽悬停高亮
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    if (imageUrl && hasDownstream) {
      showToast('该图片已有下级节点，无法替换。请先删除下级节点。', { type: 'warning' });
      return;
    }
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
    if (imageUrl && hasDownstream) {
      showToast('该图片已有下级节点，无法替换。请先删除下级节点。', { type: 'warning' });
      return;
    }
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
            tooltip={imageUrl ? (hasDownstream ? '已有下级节点，无法替换' : '替换图片') : '上传图片'}
            onClick={() => {
              if (imageUrl && hasDownstream) {
                showToast('该图片已有下级节点，无法替换。请先删除下级节点。', { type: 'warning' });
                return;
              }
              fileInputRef.current?.click();
            }}
            disabled={!!(imageUrl && hasDownstream)}
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
