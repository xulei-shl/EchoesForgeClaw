/**
 * 湿油彩效果（Oil Paint）类型定义
 *
 * 渲染管线移植自 docs/多模态工具/油画/wet-paint-flow-main（MIT）：
 * 结构张量方向场分析 → Poisson 圆盘三层播种 → Bézier ribbon 笔触 → 湿油彩合成。
 */

/** 湿油彩渲染核心参数（默认值与源项目一致） */
export interface WetPaintParams {
  /** 结构方向权重 */
  structure: number;
  /** 几何/等高线方向权重 */
  geometry: number;
  /** 语义（艺术向）方向权重 */
  semantic: number;
  /** 笔触长度倍率 */
  length: number;
  /** 笔触宽度倍率 */
  strokeSize: number;
  /** 笔触数量（千为单位，14 = 14000 笔） */
  strokeCountK: number;
  /** 笔触覆盖率 */
  coverage: number;
  /** 颜料厚度（impasto） */
  impasto: number;
  /** 颜料干燥度（0 全湿 → 1 全干） */
  dryness: number;
  /** 颜料黏度 */
  viscosity: number;
  /** 刷毛细节 */
  bristleDetail: number;
}

export const WET_PAINT_DEFAULT_PARAMS: WetPaintParams = {
  structure: 0.34,
  geometry: 0.28,
  semantic: 0.72,
  length: 1.48,
  strokeSize: 1,
  strokeCountK: 14,
  coverage: 0.99,
  impasto: 0.04,
  dryness: 0.69,
  viscosity: 0.58,
  bristleDetail: 0.82,
};

/** 输出风格：纯笔触（米色画布完整重绘）或融合（笔触叠加原图） */
export type OilPaintStyle = 'brush' | 'blend';

/** 湿油彩效果节点内部持久化状态（写入 node.data） */
export interface OilPaintState {
  /** 生成的湿油彩图片 URL（生成后为 Data URL，保存落库后替换为本地静态 URL） */
  imageUrl?: string | null;
  /** 用户本地上传/替换的图片（Base64 Data URL），优先于上游输入 */
  uploadedImage?: string | null;
  /** 是否已保存到数据库（generations 表） */
  isSaved?: boolean;
  /** 对外暴露的核心参数（滑杆） */
  strokeSize?: number;
  strokeCountK?: number;
  dryness?: number;
  /** 输出风格 */
  style?: OilPaintStyle;
  /** 错误信息 */
  error?: string | null;
}

/** 单次渲染选项 */
export interface WetPaintRenderOptions {
  /** 覆盖核心参数（缺省用 WET_PAINT_DEFAULT_PARAMS） */
  params?: Partial<WetPaintParams>;
  /** 输出最长边像素上限（默认 2048） */
  maxEdge?: number;
  /** 输出风格（默认 brush 纯笔触） */
  style?: OilPaintStyle;
  /** 重生成变体种子（改变播种序列，让「重新生成」有差异），默认 0 */
  variant?: number;
}
