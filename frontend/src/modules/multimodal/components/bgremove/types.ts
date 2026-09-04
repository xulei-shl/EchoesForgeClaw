/**
 * 抠图节点（ImageBgRemoveNode）类型定义
 */

export interface ImageBgRemoveState {
  /** 最终落盘导出的图片 URL */
  imageUrl?: string | null;
  /** 基础透明抠图的 Data URL 缓存（便于切换背景色时毫秒级无损重绘） */
  rawCutoutUrl?: string | null;
  /** 当前选中的背景颜色（空字符串 '' 为透明背景） */
  bgColor?: string;
  /** 用户本地手动上传/覆盖的图片 Data URL */
  uploadedImage?: string | null;
  /** 节点错误信息 */
  error?: string | null;
  /** 是否已保存到数据库 (generations 表) */
  isSaved?: boolean;
  /** 是否正在导出落盘 */
  isExporting?: boolean;
}

export interface ImageBgRemoveNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 节点持久化数据 */
  data?: Partial<ImageBgRemoveState>;
  /** 上游连线传入的图片地址（图片上传/AI生图/纹样/图书封面等） */
  upstreamImageUrl?: string | null;
  isFavorited?: boolean;
  isPublic?: boolean;
  isSelected?: boolean;
  recordDeleted?: boolean;
  onSelect?: (id: string) => void;
  onRemove?: (id: string) => void;
  onToggleFavorite?: (id: string) => Promise<boolean>;
  onTogglePublic?: (id: string) => Promise<boolean>;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  footer?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  mismatchBadge?: string | null;
  /** 状态更新写入 node.data */
  onUpdateState?: (id: string, patch: Partial<ImageBgRemoveState>) => void;
  /** 导出落盘：PNG Data URL 保存 + 写入历史数据库 */
  onExport?: (id: string, dataUrl: string, state: ImageBgRemoveState) => Promise<void>;
}
