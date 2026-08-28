/**
 * 微浮雕高光（Emboss Foil）类型定义
 */

/** 浮雕表面肌理风格 */
export type EmbossReliefStyle =
  | 'topography'    // 等高线指纹（Topographic Iso-lines）
  | 'paper_emboss'  // 纸质微浮雕（Paper Emboss Relief）
  | 'fine_grain'    // 细腻磨砂（Fine Shimmer Grain）
  | 'contour_mesh'; // 几何等高网格（Geometric Contour Mesh）

/** 光泽高光类型 */
export type FoilShimmerType =
  | 'matte_silver'  // 磨砂银白（Soft Matte Silver - 柔和自然漫反射，对齐参考图）
  | 'rainbow_foil'  // 彩虹镭射（Rainbow Holographic Spectrum - 全息彩虹光泽）
  | 'warm_gold'     // 暖金微光（Warm Gold Shimmer - 奢雅香槟暖金）
  | 'aurora_cyan';  // 极光幻彩（Aurora Cyan & Violet - 青紫幻彩极光）

/** 微浮雕高光渲染参数 */
export interface EmbossFoilParams {
  /** 浮雕肌理风格 */
  reliefStyle: EmbossReliefStyle;
  /** 光泽高光类型 */
  shimmerType: FoilShimmerType;
  /** 浮雕深度 / 纹理强度 (0 ~ 100)，默认 65 */
  depth: number;
  /** 高光亮度 (0 ~ 100)，默认 70 */
  brightness: number;
  /** 光斑扩散半径百分比 (10 ~ 80)，默认 45 */
  radius: number;
  /** 默认静态光源入射角度 (0 ~ 360 度)，默认 135 */
  lightAngle: number;
  /** 光斑中心归一化 X 坐标 (0 ~ 100)，未指定时由 lightAngle 决定 */
  lightX?: number;
  /** 光斑中心归一化 Y 坐标 (0 ~ 100)，未指定时由 lightAngle 决定 */
  lightY?: number;
  /** 是否开启邮票齿孔打孔边缘 */
  withPerforation: boolean;
  /** 是否包含白色纸边（内容四周留白） */
  withMargin: boolean;
}

/** 预设配置项 */
export interface EmbossFoilPreset {
  id: string;
  name: string;
  description: string;
  params: Partial<EmbossFoilParams>;
}

/** 节点内部持久化状态 */
export interface EmbossFoilState {
  /** 当前选中的预设 ID */
  presetId: string;
  /** 浮雕肌理风格 */
  reliefStyle: EmbossReliefStyle;
  /** 光泽高光类型 */
  shimmerType: FoilShimmerType;
  /** 浮雕深度 (0 ~ 100) */
  depth: number;
  /** 高光亮度 (0 ~ 100) */
  brightness: number;
  /** 光斑半径 (10 ~ 80) */
  radius: number;
  /** 光源角度 (0 ~ 360) */
  lightAngle: number;
  /** 是否带齿孔 */
  withPerforation: boolean;
  /** 是否带白边 */
  withMargin: boolean;
  /** 导出的最终高清 PNG 图片 URL (Data URL 或本地静态 URL) */
  imageUrl?: string | null;
  /** 用户本地直接上传/替换的图片 (Base64 Data URL) */
  uploadedImage?: string | null;
  /** 是否已保存到数据库 (generations 表) */
  isSaved?: boolean;
  /** 错误信息 */
  error?: string | null;
}
