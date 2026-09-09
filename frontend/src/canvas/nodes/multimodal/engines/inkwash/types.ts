/**
 * 水墨写意 (InkWash) 节点数据类型与预设配方定义
 * 基于 WebGL2 流体动力学模拟水墨晕染、渗漏扩散与宣纸纤维吸收
 */

/** 1. 绘制笔刷模式 */
export type InkWashToolMode =
  | 'pen'     // ✒️ 勾线笔（焦墨细线，随速度阻尼与压感变化，微带水分）
  | 'brush'   // 🖌️ 运水毛笔（铺展水分，搅动流场，带动墨色渗润晕化）
  | 'white';  // ⚪ 白墨点染（白毫留白，覆盖与提亮光影）

/** 2. 写意意境配方标识 */
export type InkWashCompositionMode =
  | 'custom'          // 🎨 自由挥毫（留白生宣，供自由交互挥洒）
  | 'image_trace'     // 🖼️ 底图拓印（根据上游图像明暗与边缘梯度，宣纸水墨拓印）
  | 'zen_splash'      // 🖌️ 破墨飞白（苍劲书法圆相、浓墨破水、飞白留韵）
  | 'mountain_mist'   // ⛰️ 远山烟岚（层峦叠嶂、远山如黛、烟雨溟蒙）
  | 'misty_rain'      // 🌧️ 烟雨江南（柔水润墨、水汽氤氲、水墨清岚）
  | 'plum_branch'     // 🌸 疏影横斜（劲挺寒枝、点染墨梅、虚实相生）
  | 'lone_boat'       // ⛵ 寒江独钓（澄江如练、一叶轻舟、计白当黑）
  | 'scorched_bamboo' // 🎋 焦墨劲竹（焦墨干擦、节节凌云、骨法用笔）
  | 'splashing_waves';// 🌊 惊涛骇浪（激流翻卷、水汽喷涌、气势磅礴）

/** 3. 宣纸材质与底色风格 */
export type InkWashPaperStyle =
  | 'raw_xuan'      // 生宣：墨韵洇漫，吸水迅速，古朴温润 (暖白微黄)
  | 'sized_xuan'    // 熟宣：墨色收敛，质地细腻，清雅澄净 (柔和米白)
  | 'antique_silk'  // 仿古绢本：微赭微黄，古画风雅，绢丝质感 (绢本古金)
  | 'pure_white'    // 澄心雪白：明亮爽脆，黑白对比鲜明
  | 'transparent'   // 透明背景：无底色，导出透明 PNG 供下游拼贴/图层合成
  | 'image';        // 背景图：继承上游连线输入或图书封面，带有透明度蒙版，配合水墨正片叠底拓印

/** 4. 画幅比例 */
export type InkWashAspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

/** 5. 导出分辨率 */
export type InkWashResolution = 1024 | 1536 | 2048;

/** 6. 名家名墨色板 */
export interface InkWashPalette {
  id: string;
  name: string;
  hex: string;
  inkAbs: [number, number, number]; // WebGL 吸光率向量 [R, G, B]
}

export const INKWASH_PRESET_INKS: InkWashPalette[] = [
  {
    id: 'pine_smoke',
    name: '松烟焦墨',
    hex: '#16161e',
    inkAbs: [1.0, 0.97, 0.88], // 微冷青黑，经典松烟墨
  },
  {
    id: 'indigo_black',
    name: '宿墨青黛',
    hex: '#182838',
    inkAbs: [1.1, 0.88, 0.65], // 深黛靛青，冷峻苍茫
  },
  {
    id: 'tea_sepia',
    name: '熟赭茶墨',
    hex: '#382618',
    inkAbs: [0.65, 0.85, 1.15], // 暖赭茶墨，古雅沉郁
  },
  {
    id: 'cinnabar_red',
    name: '丹砂朱墨',
    hex: '#7c1c1c',
    inkAbs: [0.45, 1.25, 1.25], // 丹砂朱砂，印泥题款
  },
  {
    id: 'amethyst_purple',
    name: '螺钿紫墨',
    hex: '#2c1838',
    inkAbs: [0.95, 1.25, 0.75], // 典雅紫墨，幽深贵气
  },
  {
    id: 'gold_leaf',
    name: '泥金流霞',
    hex: '#8a6c20',
    inkAbs: [0.55, 0.7, 1.2],   // 泥金勾染，璀璨沉厚
  },
];

/** 7. 节点核心参数持久化状态 */
export interface InkWashState {
  /** 意境配方标识 */
  mode: InkWashCompositionMode;
  /** 当前交互笔刷模式 */
  toolMode: InkWashToolMode;
  /** 笔触尺寸 (0.1 ~ 1.0) */
  size: number;
  /** 水流流动强度与扩散力 (0.1 ~ 1.0) */
  flow: number;
  /** 渗墨晕染扩散强度 (0.0 ~ 1.0) */
  bleed: number;
  /** 干燥速度 (0.05 ~ 0.95，越大干燥越快) */
  dry: number;
  /** 晕染边缘泛彩色散分离度 (0.0 ~ 1.0) */
  color: number;
  /** 运水毛笔自身含墨量 (0.0 ~ 0.8，0 为清水笔，>0 带有淡墨) */
  bink: number;
  /** 墨色 Hex 十六进制色值 */
  inkColor: string;
  /** 宣纸底色与纸张肌理风格 */
  paperStyle: InkWashPaperStyle;
  /** 画幅比例 */
  aspectRatio: InkWashAspectRatio;
  /** 导出分辨率基准 */
  resolution: InkWashResolution;
  /** 随机数种子（用于意境配方复现） */
  seed: number;
  /** 导出的 PNG 图片 Base64 / URL */
  imageUrl?: string | null;
  /** 是否已保存到数据库记录 */
  isSaved?: boolean;
  /** 错误信息 */
  error?: string | null;
  /** 外部输入/上传的参考底稿图片 */
  uploadedImage?: string | null;
  /** 画底背景图 URL（继承上游连线图片、图书封面或手动上传） */
  bgImageUrl?: string | null;
  /** 画底背景图浓度蒙版 (0.1 ~ 1.0，默认 0.35) */
  bgImageOpacity?: number;
  /** 书画题款与真迹印章列表（支持多段题款组件） */
  inscriptions?: InkWashInscriptionItem[];
  /** 单个题款兼容字段 */
  inscription?: InkWashInscriptionItem;
  /** 工笔白描底图拓印调校参数 */
  traceConfig?: InkWashTraceConfig;
}

/** 8. 诗书画印：独立题款与古籍钤印数据结构 */
export interface InkWashInscriptionItem {
  /** 唯一标识 */
  id: string;
  /** 是否启用该题款 */
  enabled: boolean;
  /** 题款正文（支持换行） */
  text: string;
  /** 书法字体名称（默认：钟齐志莽行书） */
  fontFamily?: string;
  /** 排版方式（默认：vertical 竖排，符合传统国画题跋） */
  writingMode?: 'vertical' | 'horizontal';
  /** 对齐方式（默认：center） */
  textAlign?: 'left' | 'center' | 'right';
  /** 题款墨色（默认：#16161e 焦墨） */
  color?: string;
  /** 字号相对画幅短边的比例 (0.015 ~ 0.08，默认 0.038) */
  fontSizeRatio?: number;
  /** 题款位置 X 百分比 (0 ~ 100) */
  x?: number;
  /** 题款位置 Y 百分比 (0 ~ 100) */
  y?: number;
  /** 是否钤印 */
  sealEnabled?: boolean;
  /** 古籍真迹印章图片 URL */
  sealSrc?: string;
}

/** 9. 工笔白描底图拓印参数配置 */
export interface InkWashTraceConfig {
  /** 勾线纯净度 / 结构阈值 (0.1 ~ 0.8，默认 0.35，越高越极简纯净，过滤杂线排线) */
  threshold: number;
  /** 去噪平滑等级 (1 ~ 5，默认 2，越过滤除微观颗粒) */
  smooth: number;
  /** 铁线描线宽缩放 (0.5 ~ 2.5，默认 1.0) */
  lineWidth: number;
  /** 焦墨浓度缩放 (0.5 ~ 2.0，默认 1.4) */
  density: number;
  /** 密集阴影排线抑制 (0.0 ~ 1.0，默认 0.6，越过滤版画素描密集线) */
  hatchSuppression: number;
}

export const DEFAULT_INKWASH_TRACE_CONFIG: InkWashTraceConfig = {
  threshold: 0.35,
  smooth: 2,
  lineWidth: 1.0,
  density: 1.4,
  hatchSuppression: 0.6,
};

export const INKWASH_TRACE_PRESETS: Record<
  string,
  { label: string; desc: string; config: InkWashTraceConfig }
> = {
  minimal: {
    label: '极简纯白描',
    desc: '大面积留白·过滤全部排线·仅留主轮廓大骨架',
    config: {
      threshold: 0.48,
      smooth: 3,
      lineWidth: 1.1,
      density: 1.5,
      hatchSuppression: 0.85,
    },
  },
  refined: {
    label: '工笔精描',
    desc: '骨肉停匀·保留优美衣褶内线与字形细节',
    config: {
      threshold: 0.32,
      smooth: 2,
      lineWidth: 0.9,
      density: 1.35,
      hatchSuppression: 0.5,
    },
  },
  engraving: {
    label: '古典版画',
    desc: '保留细腻素描排线与木刻版画质感',
    config: {
      threshold: 0.18,
      smooth: 1,
      lineWidth: 0.8,
      density: 1.2,
      hatchSuppression: 0.15,
    },
  },
};

/** 兼容类型别名 */
export type InkWashInscription = InkWashInscriptionItem;

/** 默认初始化参数 */
export const INKWASH_DEFAULT_PARAMS: InkWashState = {
  mode: 'zen_splash',
  toolMode: 'pen',
  size: 0.5,
  flow: 0.6,
  bleed: 0.55,
  dry: 0.45,
  color: 0.5,
  bink: 0.0,
  inkColor: '#16161e',
  traceConfig: DEFAULT_INKWASH_TRACE_CONFIG,
  paperStyle: 'raw_xuan',
  aspectRatio: '1:1',
  resolution: 1024,
  seed: 2026,
  imageUrl: null,
  isSaved: false,
  error: null,
  uploadedImage: null,
  bgImageUrl: null,
  bgImageOpacity: 0.35,
  inscriptions: [
    {
      id: 'insc_default',
      enabled: true,
      text: '',
      fontFamily: '钟齐志莽行书',
      writingMode: 'vertical',
      textAlign: 'center',
      color: '#16161e',
      fontSizeRatio: 0.038,
      x: 82,
      y: 28,
      sealEnabled: true,
      sealSrc: '/assets/receipt/yin/m_0640-1-3A-2.jpg',
    },
  ],
};

/** 8. 意境配方参数预设 */
export const INKWASH_PRESET_RECIPES: Record<
  Exclude<InkWashCompositionMode, 'custom'>,
  Partial<InkWashState>
> = {
  zen_splash: {
    size: 0.72,
    flow: 0.46,
    bleed: 0.52,
    dry: 0.50,
    color: 0.4,
    bink: 0.06,
    inkColor: '#16161e',
    paperStyle: 'raw_xuan',
  },
  mountain_mist: {
    size: 0.55,
    flow: 0.48,
    bleed: 0.55,
    dry: 0.46,
    color: 0.55,
    bink: 0.04,
    inkColor: '#182838',
    paperStyle: 'raw_xuan',
  },
  misty_rain: {
    size: 0.45,
    flow: 0.42,
    bleed: 0.58,
    dry: 0.45,
    color: 0.5,
    bink: 0.02,
    inkColor: '#1a2936',
    paperStyle: 'raw_xuan',
  },
  plum_branch: {
    size: 0.38,
    flow: 0.45,
    bleed: 0.35,
    dry: 0.55,
    color: 0.45,
    bink: 0.0,
    inkColor: '#16161e',
    paperStyle: 'sized_xuan',
  },
  lone_boat: {
    size: 0.42,
    flow: 0.5,
    bleed: 0.48,
    dry: 0.5,
    color: 0.35,
    bink: 0.0,
    inkColor: '#16161e',
    paperStyle: 'raw_xuan',
  },
  scorched_bamboo: {
    size: 0.48,
    flow: 0.3,
    bleed: 0.22,
    dry: 0.7,
    color: 0.2,
    bink: 0.0,
    inkColor: '#101016',
    paperStyle: 'sized_xuan',
  },
  image_trace: {
    size: 0.28,
    flow: 0.2,
    bleed: 0.12,
    dry: 0.85,
    color: 0.2,
    bink: 0.0,
    inkColor: '#121218',
    paperStyle: 'sized_xuan',
  },
  splashing_waves: {
    size: 0.65,
    flow: 0.52,
    bleed: 0.45,
    dry: 0.50,
    color: 0.65,
    bink: 0.08,
    inkColor: '#182838',
    paperStyle: 'raw_xuan',
  },
};
