/**
 * 邮票制作（Stamp Cutter）类型定义
 */

/** 邮票常用长宽比 */
export type StampAspectRatio = '3:4' | '4:3' | '1:1' | 'free';

/** 归一化选框坐标 (0 ~ 1 范围) */
export interface StampCropBox {
  /** 选框左上角 X 轴归一化坐标 (0 ~ 1) */
  x: number;
  /** 选框左上角 Y 轴归一化坐标 (0 ~ 1) */
  y: number;
  /** 选框归一化宽度 (0 ~ 1) */
  width: number;
  /** 选框归一化高度 (0 ~ 1) */
  height: number;
}

/** 邮票网格/多联版式配置（行数与列数） */
export interface StampGrid {
  /** 行数（竖向分割，默认 1） */
  rows: number;
  /** 列数（横向分割，默认 1） */
  cols: number;
}

/** 邮票常用多联预设 */
export type StampLayoutPreset =
  | '1x1' // 单张
  | '1x2' // 竖双联
  | '1x3' // 竖三联
  | '1x4' // 竖四联
  | '2x1' // 横双联
  | '3x1' // 横三联
  | '4x1' // 横四联
  | '2x2' // 四方联
  | '3x3' // 九联
  | 'custom'; // 自定义行列

/** 邮票排版文字项 */
export interface StampTextItem {
  /** 唯一标识 */
  id: string;
  /** 文字内容 */
  text: string;
  /** 字体族名称 (默认思源宋体/上图东观体) */
  fontFamily?: string;
  /** 文字颜色 (Hex/RGB/颜色名) */
  color?: string;
  /** 排版方向：横排 (horizontal) 或 竖排 (vertical) */
  writingMode?: 'horizontal' | 'vertical';
  /** 对齐方式：左对齐 (left)、居中对齐 (center)、右对齐 (right) */
  textAlign?: 'left' | 'center' | 'right';
  /** 中心点 X (0~100 百分比，相对于邮票整张画布) */

  x: number;
  /** 中心点 Y (0~100 百分比，相对于邮票整张画布) */
  y: number;
  /** 字号缩放比例 (相对于邮票宽度的百分比，默认 6 左右) */
  w: number;
  /** 旋转角度 (度，默认 0) */
  angle: number;
  /** 图层层级 (z-index) */
  z: number;
}

/** 邮票常用边缘/齿孔打孔风格 */
export type EdgeStyle = 'perforated' | 'wavy' | 'rouletted' | 'imperforate';

/** 邮票印刷工艺：雕刻凹版、平版胶印（原色直出）、照相凹版、凸版活字 */
export type PrintMethod = 'engraved' | 'offset' | 'photogravure' | 'typeset';

/** 邮票古典边框样式：无、单线、经典双线角块、滚珠珍珠珠边、拱形 */
export type FrameStyle = 'none' | 'rule' | 'classic' | 'ornate' | 'arched';

/** 邮票图像视窗遮罩形状：无、矩形、拱门、椭圆、正圆 */
export type VignetteShape = 'none' | 'rect' | 'arch' | 'oval' | 'circle';

/** 邮票四角蚀刻角饰：无、卷草、莨苕叶、装饰艺术、罗盘玫瑰 */
export type OrnamentStyle = 'none' | 'scroll' | 'leaf' | 'deco' | 'rosette';

/** 邮票防伪底纹样式：无、几何度盘机雕曲线、网状底纹、交叉线、渐变图板、点画斑点、半色调 */
export type GroundStyle =
  | 'none'
  | 'guilloche'
  | 'burelage'
  | 'crosshatch'
  | 'panel'
  | 'stipple'
  | 'halftone';

/** 邮戳样式：波浪副戳、圆形日戳、双联组合戳、网格戳 */
export type PostmarkStyle = 'bars' | 'datestamp' | 'both' | 'grid';

/** 邮票铭记字体分类 */
export type StampTypeface =
  | 'serif'
  | 'didone'
  | 'grotesque'
  | 'condensed'
  | 'typewriter'
  | 'script';

/** 邮票工坊（Stamp Studio）完整高级参数配置 */
export interface StampStudioSettings {
  /** 印刷工艺 */
  print: PrintMethod;
  /** 油墨颜色 (Hex) */
  inkColor: string;
  /** 油墨权重/厚度 (0~2) */
  ink: number;
  /** 雕版凸起感浮雕 (0~1) */
  relief: number;

  /** 是否绘制边框与铭记饰件总开关 */
  designOn: boolean;
  /** 边框风格 */
  frame: FrameStyle;
  /** 边框与铭记颜色 (Hex) */
  frameColor: string;
  /** 边框内缩边距比例 (0.02~0.2) */
  margin: number;
  /** 四角角饰风格 */
  ornament: OrnamentStyle;
  /** 角饰相对缩放大小 (0.04~0.22) */
  ornamentSize: number;
  /** 图像视窗形状 */
  vignette: VignetteShape;
  /** 是否勾勒视窗轮廓内细线 */
  vignetteRule: boolean;
  /** 视窗轮廓线颜色 */
  vignetteColor: string;
  /** 视窗边缘羽化柔和度 (0~1) */
  feather: number;
  /** 画面填充适配方式 */
  artFit: 'contain' | 'cover' | 'stretch';

  /** 国名铭记文本 (顶部，如 CHINA POST 或 UNITED STATES POSTAGE) */
  country: string;
  /** 国名是否沿拱顶视窗呈弧形弯曲 */
  countryArc: boolean;
  /** 经典面额文本 (如 ¥1.20 或 13¢) */
  denomination: string;
  /** 面额角锚点位置 */
  denomAnchor: 'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-left' | 'top-right';
  /** 面额是否反白刻入实心色块底座 (Corner Tablets) */
  tablets: boolean;
  /** 底部副题/说明文本 (如 黄山迎客松 或 HALLET PEAK) */
  caption: string;
  /** 副题是否置于古典飘带上 (Ribbon) */
  ribbon: boolean;
  /** 铭记与面额字体族 */
  typeface: StampTypeface;

  /** 防伪底纹样式 */
  ground: GroundStyle;
  /** 底纹线条颜色 (Hex) */
  groundColor: string;
  /** 底纹线条粗细 (0~1) */
  groundWeight: number;
  /** 底纹线条间距密度 (0~1) */
  groundScale: number;
  /** 底纹旋转弧度角度 (0~1 圈) */
  groundAngle: number;
  /** 底纹油墨强度/不透明度 (0~1) */
  groundStrength: number;
  /** 底纹是否铺满至图案下方 */
  groundUnderArt: boolean;
  /** 底纹对文字的扩散避让光晕清除度 (0~1) */
  groundClear: number;

  /** 纸张岁月泛黄老化度 (0 = 崭新洁白, 1 = 深褐色古纸) */
  toning: number;
  /** 纸张微观纤维质感 (0~1) */
  fiber: number;
  /** 潮湿引起的复古锈斑/霉斑 (Foxing, 0~1) */
  foxing: number;
  /** 手感岁月折痕与边缘磨损 (Wear, 0~1) */
  wear: number;

  /** 齿孔/裁切边缘工艺 */
  edge: EdgeStyle;
  /** 齿孔密度规数 (每 20mm 孔数, 7~16, 常用 11.5) */
  gauge: number;
  /** 孔径相对齿距比例 (0.2~0.55) */
  holeSize: number;
  /** 撕扯留下的毛茸毛边纤维 (0~1) */
  tear: number;

  /** 是否盖上盖销邮戳 */
  postmarkOn: boolean;
  /** 邮戳类型 */
  postmarkStyle: PostmarkStyle;
  /** 邮戳颜色 (Hex，默认 '#1c1b1f') */
  postmarkColor?: string;
  /** 邮戳所属城市名 */
  postmarkCity: string;
  /** 邮戳底部环形文本（默认 '中国邮政'） */
  postmarkSubtext?: string;
  /** 邮戳印鉴日期 */
  postmarkDate: string;
  /** 邮戳倾斜旋转角度 (度数 -180° ~ +180°) */
  postmarkAngle: number;
  /** 邮戳盖印中心坐标 (归一化 0~1) */
  postmarkPos: { x: number; y: number };
  /** 邮戳盖印墨印深浅浓度 (0~1) */
  postmarkStrength: number;
}

/** 邮票齿孔打孔与柔和投影渲染参数 */
export interface StampEffectOptions {
  /** 多联网格版式（默认 { rows: 1, cols: 1 } 单张） */
  grid?: StampGrid;
  /** 是否包含白色纸边（默认 true，内容四周留白） */
  withMargin?: boolean;
  /** 内容到锯齿边的白边宽度 (px)，默认 46 */
  margin?: number;
  /** 半圆打孔半径 (px)，默认 14 */
  holeRadius?: number;
  /** 打孔间距 (px)，默认 holeRadius * 2 + 18 */
  pitch?: number;
  /** 邮票外留白 (px，给立体投影空间)，默认 90 */
  outerPad?: number;
  /** 投影不透明度 (0 ~ 255)，默认 70 */
  shadowAlpha?: number;
  /** 背景色（默认 null 为真透明 RGBA，传颜色字符串则为填充底色） */
  bgColor?: string | null;
  /** 邮票排版文字项列表 */
  textItems?: StampTextItem[];
  /** Stamp Studio 工坊高级参数配置（可选，启用时触发高级工坊渲染管道） */
  studioSettings?: Partial<StampStudioSettings>;
  /** 是否跳过绘制盖销邮戳（用于离屏底图缓存优化） */
  skipPostmark?: boolean;
}

/** 邮票制作节点内部持久化状态 */
export interface StampCutterState {
  /** 多联网格版式（行与列） */
  grid?: StampGrid;
  /** 是否带白边 */
  withMargin: boolean;
  /** 长宽比设置 */
  aspectRatio: StampAspectRatio;
  /** 选框归一化坐标 */
  cropBox: StampCropBox | null;
  /** 邮票排版文字素材列表 */
  textItems?: StampTextItem[];
  /** 导出的最终高清邮票图片 URL (PNG) */
  imageUrl?: string | null;
  /** 用户本地直接上传/替换的图片 (Base64 Data URL) */
  uploadedImage?: string | null;
  /** 是否已保存到数据库 (generations 表) */
  isSaved?: boolean;
  /** 错误信息 */
  error?: string | null;
  /** 当前选中的模板预设 ID */
  templateId?: string | null;
  /** 当前的 Stamp Studio 高级工坊配置 */
  studioSettings?: StampStudioSettings;
}


