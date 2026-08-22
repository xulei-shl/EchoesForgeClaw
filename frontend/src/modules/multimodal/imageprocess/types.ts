/**
 * 图片处理（Image Process）类型定义
 *
 * 多效果架构参照「图书小票生成」的多模板注册表模式：
 * 每个效果一个声明式定义（参数 schema + 渲染函数），注册表统一存取，
 * 状态由公共核心函数 buildImageProcessState 归一化；
 * 后续新增效果（ASCII / 网点 / 抖动）= 新增一个效果文件 + 注册表登记一行。
 */

/** 效果注册表 id（第一阶段仅噪点） */
export type ImageFxId = 'grain';

/** 数值滑杆参数声明（节点 UI 按声明自动渲染滑杆行） */
export interface ImageFxSliderParamDef {
  kind: 'slider';
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** 数值展示格式化（缺省显示原始值） */
  display?: (value: number) => string;
}

/** 枚举分段参数声明（如 单色 | 彩色，UI 渲染为分段按钮组） */
export interface ImageFxSegmentParamDef {
  kind: 'segment';
  key: string;
  label: string;
  default: string;
  options: { value: string; label: string }[];
}

export type ImageFxParamDef = ImageFxSliderParamDef | ImageFxSegmentParamDef;

/** 效果参数取值（滑杆数值或分段字符串值） */
export type ImageFxParamValue = number | string;

/** 效果渲染选项 */
export interface ImageFxRenderOptions {
  /** 输出最长边像素上限（预览用小值提速，导出生成用大值保清晰） */
  maxEdge?: number;
}

/**
 * 图片处理效果定义：声明式参数 + 渲染函数。
 * 预览与「生成」共用同一 render 实现，保证所见即所得。
 */
export interface ImageFxEffectDef {
  id: ImageFxId;
  /** 效果名（效果 tab 标签 / 历史记录 prompt 文案） */
  name: string;
  description: string;
  /** 参数声明列表（顺序即 UI 排列顺序；default 同时是参数默认值来源） */
  params: ImageFxParamDef[];
  /**
   * 加载输入图并应用效果，返回结果画布。
   * src 为 data URL / 同源静态 URL（跨域封面需服务器允许匿名读取）。
   */
  render: (
    src: string,
    params: Record<string, ImageFxParamValue>,
    options?: ImageFxRenderOptions
  ) => Promise<HTMLCanvasElement>;
}

/** 噪点效果参数（Grainy-image 移植） */
export interface GrainFxParams {
  /** 噪点强度 0-1（默认 0.3，与源项目一致） */
  intensity: number;
  /** 颗粒大小（px，g×g 块共享同一噪声值） */
  grainSize: number;
  /** mono = 单色亮度噪声（源项目口径）；color = RGB 独立彩色噪声 */
  mode: 'mono' | 'color';
}

/** 图片处理节点持久化状态（写入 node.data） */
export interface ImageProcessState {
  /** 当前选中效果 id（对齐小票节点 templateId 的角色） */
  effectId?: ImageFxId;
  /** 各效果参数桶（键为效果 id）：切换效果互不覆盖、切回恢复各自参数 */
  fxParams?: Partial<Record<ImageFxId, Record<string, ImageFxParamValue>>>;
  /** 处理结果图片（对外输出；下游经 data.imageUrl 约定自动读取） */
  imageUrl?: string | null;
  /** 用户本地上传/替换的图片（data URL），优先于上游输入 */
  uploadedImage?: string | null;
  /** 是否已保存到数据库（generations 表） */
  isSaved?: boolean;
  error?: string | null;
}
