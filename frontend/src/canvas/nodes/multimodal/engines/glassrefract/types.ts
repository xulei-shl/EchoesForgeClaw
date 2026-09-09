/**
 * 玻璃折射（Glass Refraction）类型定义
 */

export type GlassPattern =
  | 'fluted'
  | 'cross'
  | 'block'
  | 'ripple'
  | 'rain'
  | 'wave'
  | 'hammer'
  | 'flemish'
  | 'frosted';

/**
 * 玻璃折射渲染核心参数
 */
export interface GlassRefractParams {
  /** 玻璃纹理图案风格 */
  pattern: GlassPattern;
  /** 单元格大小 (Cell size / Drop size)，单位 px，通常 6 ~ 220 */
  scale: number;
  /** 表面浮雕起伏强度 (Relief)，0 ~ 3.0 (0% ~ 300%) */
  relief: number;
  /** 折射景深距离 (Depth)，单位 px，通常 0 ~ 200 */
  thickness: number;
  /** 旋转角度 (Angle)，0 ~ 180 度 */
  angle: number;
  /** 物理色散分光差 (Dispersion)，0 ~ 0.1 (0% ~ 10%) */
  dispersion: number;
  /** 菲涅尔高光与表面光泽 (Sheen)，0 ~ 1.0 (0% ~ 100%) */
  specular: number;
  /** 玻璃砖缝阴影宽度 (Mortar / Gap)，仅在 block 模式下生效，0 ~ 0.5 */
  gap?: number;
  /** 随机雨滴分布种子 (Seed)，仅在 rain 模式下生效 */
  seed?: number;
}

/**
 * 节点持久化状态
 */
export interface GlassRefractState extends GlassRefractParams {
  /** 预设 ID（可选） */
  presetId?: string;
  /** 生成的 PNG 图片 Data URL 或服务端保存 URL */
  imageUrl?: string | null;
  /** 本地用户自主上传的图片 Data URL */
  uploadedImage?: string | null;
  /** 是否已保存到数据库记录 */
  isSaved?: boolean;
  /** 错误信息 */
  error?: string | null;
  /** 正在生成中 */
  isGenerating?: boolean;
  /** 正在导出到数据库 */
  isExporting?: boolean;
}

/**
 * 玻璃折射预设描述
 */
export interface GlassPreset {
  id: string;
  name: string;
  pattern: GlassPattern;
  description: string;
  params: Partial<GlassRefractParams>;
}
