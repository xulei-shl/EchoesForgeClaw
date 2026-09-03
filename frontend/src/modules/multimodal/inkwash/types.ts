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
  | 'transparent';  // 透明背景：无底色，导出透明 PNG 供下游拼贴/图层合成

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
}

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
  paperStyle: 'raw_xuan',
  aspectRatio: '1:1',
  resolution: 1024,
  seed: 2026,
  imageUrl: null,
  isSaved: false,
  error: null,
  uploadedImage: null,
};

/** 8. 意境配方参数预设 */
export const INKWASH_PRESET_RECIPES: Record<
  Exclude<InkWashCompositionMode, 'custom'>,
  Partial<InkWashState>
> = {
  zen_splash: {
    size: 0.72,
    flow: 0.75,
    bleed: 0.65,
    dry: 0.35,
    color: 0.4,
    bink: 0.08,
    inkColor: '#16161e',
    paperStyle: 'raw_xuan',
  },
  mountain_mist: {
    size: 0.55,
    flow: 0.82,
    bleed: 0.72,
    dry: 0.4,
    color: 0.65,
    bink: 0.04,
    inkColor: '#182838',
    paperStyle: 'raw_xuan',
  },
  misty_rain: {
    size: 0.45,
    flow: 0.68,
    bleed: 0.8,
    dry: 0.3,
    color: 0.55,
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
    size: 0.5,
    flow: 0.6,
    bleed: 0.45,
    dry: 0.55,
    color: 0.35,
    bink: 0.0,
    inkColor: '#16161e',
    paperStyle: 'raw_xuan',
  },
  splashing_waves: {
    size: 0.68,
    flow: 0.88,
    bleed: 0.6,
    dry: 0.38,
    color: 0.7,
    bink: 0.12,
    inkColor: '#182838',
    paperStyle: 'raw_xuan',
  },
};
