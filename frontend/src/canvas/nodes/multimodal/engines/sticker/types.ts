/**
 * 贴纸制作（Sticker Maker）类型定义
 */

/** 贴纸白边描边参数（die-cut outline） */
export interface StickerOutlineOptions {
  /** 白边宽度（0 ~ 48 设计单位，对应最大 112px 描边半径） */
  width: number;
  /** 白边颜色 */
  color: string;
}

/** 贴纸投影参数 */
export interface StickerShadowOptions {
  /** 是否启用投影 */
  enabled: boolean;
  /** 投影距离 (px) */
  distance: number;
  /** 投影模糊 (px) */
  blur: number;
  /** 投影角度（度） */
  angle: number;
  /** 投影不透明度 (0 ~ 1) */
  opacity: number;
}

/** 贴纸渲染参数 */
export interface StickerRenderOptions {
  outline: StickerOutlineOptions;
  shadow: StickerShadowOptions;
  /** 工作画布最大边长（导出分辨率上限），默认 1600 */
  maxEdge?: number;
}

/** 抠图进度 */
export interface StickerBackgroundRemovalProgress {
  phase: 'loading' | 'processing';
  progress?: number;
}

/** 贴纸制作节点内部持久化状态 */
export interface StickerMakerState {
  /** 生成贴纸前是否先移除背景（AI 抠图） */
  removeBackground: boolean;
  /** 白边宽度 */
  outlineWidth: number;
  /** 白边颜色 */
  outlineColor: string;
  /** 是否启用投影 */
  shadowEnabled: boolean;
  /** 导出的最终贴纸图片 URL (PNG) */
  imageUrl?: string | null;
  /** 用户本地直接上传/替换的图片 (Base64 Data URL) */
  uploadedImage?: string | null;
  /** 是否已保存到数据库 (generations 表) */
  isSaved?: boolean;
  /** 错误信息 */
  error?: string | null;
}
