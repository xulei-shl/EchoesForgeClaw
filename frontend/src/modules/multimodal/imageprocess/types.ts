/**
 * 图片处理（Image Process）类型定义
 *
 * 多效果架构参照「图书小票生成」的多模板注册表模式：
 * 每个效果一个声明式定义（参数 schema + 渲染函数），注册表统一存取，
 * 状态由公共核心函数 buildImageProcessState 归一化；
 * 后续新增效果（ASCII / 网点 / 抖动）= 新增一个效果文件 + 注册表登记一行。
 */

/** 效果注册表 id */
export type ImageFxId = 'grain' | 'halftone' | 'dither' | 'ascii' | 'texture';

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

/** 枚举分段参数声明（如 单色 | 彩色 或 1px | 2px，UI 渲染为分段按钮组） */
export interface ImageFxSegmentParamDef {
  kind: 'segment';
  key: string;
  label: string;
  default: ImageFxParamValue;
  options: { value: ImageFxParamValue; label: string }[];
}

/** 下拉选择参数声明（适用于选项较多的枚举，如质感风格切换） */
export interface ImageFxSelectParamDef {
  kind: 'select';
  key: string;
  label: string;
  default: string;
  options: { value: string; label: string; title?: string }[];
}

export type ImageFxParamDef =
  | ImageFxSliderParamDef
  | ImageFxSegmentParamDef
  | ImageFxSelectParamDef;

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

/** 网点效果参数（img-halftone 移植 + 扩展） */
export interface HalftoneFxParams {
  /** 网点点距（px，单元格边长） */
  dotSize: number;
  /** 满覆盖率时的最大点半径（相对点距比例，参考实现口径 0.7） */
  maxRadius: number;
  /** 网屏角度（度；彩色模式下四色板在此基础上按经典印刷网角错开） */
  angle: number;
  /** 网点形状 */
  shape: 'circle' | 'rect' | 'triangle' | 'hexagon';
  /** mono = 单色亮度网屏；cmyk = 四色分离叠印 */
  mode: 'mono' | 'cmyk';
}

/** 抖动效果参数（原创实现，思路参考 ditherjs） */
export interface DitherFxParams {
  /** 量化算法：ordered = Bayer 有序抖动；floyd_steinberg / atkinson = 误差扩散（蛇形扫描） */
  algorithm: 'ordered' | 'floyd_steinberg' | 'atkinson';
  /** 目标色板：mono = 黑白二值；gameboy = 掌机四阶绿；cga = 复古十六色；custom = 自定义十六进制色板 */
  palette: 'mono' | 'gameboy' | 'cga' | 'custom';
  /** 像素块边长（px，blockSize×blockSize 块共享同一量化结果，1 = 逐像素） */
  blockSize: number;
}

/** ASCII 字符画效果参数（asciify-engine 移植 + 增强） */
export interface AsciiFxParams {
  /** 输出字符列数（细节密度） */
  cols: number;
  /** 字符梯度预设：standard 经典 / dense 细腻 / blocks 块面 / braille 盲文 / dots 点阵 / katakana 片假名 / geometric 几何 / claudeCode 制表符 */
  charset:
    | 'standard'
    | 'dense'
    | 'blocks'
    | 'braille'
    | 'dots'
    | 'katakana'
    | 'geometric'
    | 'claudeCode';
  /** 配色方案：dark 黑底白字 / light 白底黑字 / matrix 终端绿 / gameboy 掌机绿 / dracula 暗紫 / color 彩色 / custom 自定义色板 */
  colorMode: 'dark' | 'light' | 'matrix' | 'gameboy' | 'dracula' | 'color' | 'custom';
  /** 自定义十六进制色板（如 #000000,#ffffff 或多色，首色为底色） */
  customPalette?: string;
  /** 亮度动态范围拉伸增强（解决低对比度原图发灰发糊） */
  normalize?: 'on' | 'off';
  /** 亮度→字符映射方向反转（白底配色建议开启，亮区用疏字符） */
  invert: 'normal' | 'inverted';
}

/** 触感质感风格 ID（24 种风格） */
export type TextureStyleId =
  | 'characters'
  | 'risograph'
  | 'dither'
  | 'cobalt-grain'
  | 'denim-grain'
  | 'harbor-grain'
  | 'meadow-grain'
  | 'block'
  | 'dots'
  | 'paper'
  | 'watercolor'
  | 'ink-wash'
  | 'cyanotype'
  | 'mixed'
  | 'pixel-art'
  | 'mosaic'
  | 'lego'
  | 'cross'
  | 'diamond'
  | 'lines'
  | 'diagonal'
  | 'braille'
  | 'voxel'
  | 'disco';

/** 触感质感滤镜参数（texture.fayaz 24 种质感算法移植） */
export interface TextureFxParams {
  /** 质感风格 */
  style: TextureStyleId;
  /** 细节密度 0-100（控制网格颗粒、体素或字符大小） */
  detail: number;
  /** 效果强度 0-100（控制原图与滤镜色彩融合比例） */
  intensity: number;
  /** 对比度 0-100（控制明暗张力与 S 曲线斜率） */
  contrast: number;
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
