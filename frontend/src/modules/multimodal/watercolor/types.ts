/**
 * 物理水彩手绘 (p5.brush) 节点类型定义与配方模板
 */

/** 1. 构图几何母题（决定画布的主体骨架结构） */
export type WatercolorLayoutMode =
  | 'blobs'       // ☁️ 有机块面（自然分形生长的多层多边形云团，纯净水彩晕染）
  | 'strata'      // ⛰️ 层叠流线（横贯画布的山川等高线地貌）
  | 'flow_lines'  // 〰️ 流场线描（顺应流场的自由速写与动态飞线）
  | 'radial'      // 🌸 极坐标放射（纯植物花瓣多层展开与色彩渗透）
  | 'grid'        // ▦ 几何方阵（现代主义包豪斯色块与贯穿排线）
  | 'rings'       // 🌀 同心环系（写意圆相、东方水墨书法粗重笔触）
  | 'cutouts'     // ✂️ 负空间镂空（马蒂斯现代几何剪纸与孔洞）
  | 'waves'       // 🌊 浮世浪峰（翻滚卷曲的浮世绘巨浪浪头与密集排线）
  | 'spray'       // ✨ 气溶胶喷绘（粗粝喷枪微粒、街头艺术与气溶胶晕染）
  | 'mineral';    // 🪨 拓印岩彩（粗砺炭质与天然矿物岩石截面肌理）

/** 2. 预设模式标识（自由创想或 10 款完全差异化美学配方） */
export type WatercolorCompositionMode =
  | 'custom'              // 🎨 自由创想（完全由用户自由拼装所有参数）
  | 'watercolor_clouds'   // 💧 云阶水彩（纯净水彩有机云团晕染，无杂乱直线）
  | 'topographic_strata'  // ⛰️ 山川层峦（东方青绿等高线山峦）
  | 'matisse_cutouts'     // ✂️ 剪纸留白（马蒂斯现代几何剪纸造型）
  | 'botanical_bloom'     // 🌸 绽放花轮（纯粹植物花瓣层次渐变，无机械射线）
  | 'bauhaus_grid'        // 📐 包豪斯版画（现代主义色块构成与贯穿一体排线）
  | 'zen_splash'          // 🖌️ 破墨飞白（东方水墨书法粗重圆相与写意渗透）
  | 'abstract_sketch'     // ✏️ 表现手绘（纯粹向量流场速写与飞线动势）
  | 'ukiyo_wave'          // 🌊 浮世浪涌（卷曲翻滚的浮世绘巨浪浪峰与密实排线）
  | 'aerosol_spray'       // ✨ 气溶胶喷绘（喷枪微粒、气溶胶街头晕染与星云散点）
  | 'mineral_rubbing';    // 🪨 拓印岩彩（干画粉彩多层涂抹与粗粝矿物岩石截面）

/** 3. 主笔刷材质 */
export type WatercolorBrushType =
  | 'auto'
  | 'watercolor'
  | 'pastel'
  | 'charcoal'
  | 'rotring'
  | 'pen'
  | '2B'
  | 'HB'
  | '2H'
  | 'cpencil'
  | 'spray'
  | 'marker';

/** 4. 向量流场引导 */
export type WatercolorFieldMode =
  | 'auto'
  | 'seabed'
  | 'waves'
  | 'curved'
  | 'spiral'
  | 'zigzag'
  | 'hand'
  | 'columns'
  | 'none';

/** 5. 填色与排线技法 */
export type WatercolorTechnique =
  | 'auto'
  | 'watercolor'   // 物理水彩晕染扩散 (Bleed + Granulation)
  | 'massing'      // 干画粉彩多层手势涂抹 (Massing)
  | 'hatching'     // 单向密集扫描排线 (Hatching)
  | 'hatch_array'  // 贯穿一体连续排线 (Hatch Array)
  | 'wash'         // 清透平涂水洗 (Wash)
  | 'contour';     // 仅纯手绘线条轮廓 (Contour Only)

export interface WatercolorPalette {
  id: string;
  name: string;
  colors: string[];
}

export const WATERCOLOR_PRESET_PALETTES: WatercolorPalette[] = [
  {
    id: 'traditional_oriental',
    name: '黛蓝·朱砂·天青·藤黄',
    colors: ['#2F4F4F', '#C84C32', '#4B88A2', '#ECC85B', '#8C9B7A', '#8F4B5E'],
  },
  {
    id: 'mineral_earth',
    name: '石青·赭石·雌黄·螺钻',
    colors: ['#3A6073', '#964B00', '#DCAE1D', '#3B8B88', '#B85D43', '#5E738B'],
  },
  {
    id: 'pastel_spring',
    name: '薄荷·樱粉·鹅黄·云雾蓝',
    colors: ['#A8D8B9', '#F4A7B9', '#F9E264', '#90B4CE', '#D2B4DE', '#F8C471'],
  },
  {
    id: 'monochrome_pencil',
    name: '炭黑·冷灰·铅笔灰·暖白',
    colors: ['#1A1A1A', '#333333', '#555555', '#7F7F7F', '#AFAFAF', '#424856'],
  },
  {
    id: 'vivid_impression',
    name: '群青·柠檬黄·品红·翠绿',
    colors: ['#1B4965', '#E9C46A', '#E76F51', '#2A9D8F', '#264653', '#F4A261'],
  },
];

export type WatercolorAspectRatio =
  | '1:1'
  | '3:4'
  | '4:3'
  | '9:16'
  | '16:9';

export type WatercolorResolution = 1024 | 2048;

/** 完整状态模型 */
export interface WatercolorBrushState {
  mode: WatercolorCompositionMode;      // 当前选中的配方或自由创想
  layoutMode: WatercolorLayoutMode;     // 几何构图母题
  paletteId: string;
  customColors: string[];
  brushType: WatercolorBrushType;       // 主画笔材质
  fieldMode: WatercolorFieldMode;       // 向量流场
  technique: WatercolorTechnique;       // 填色/排线技法
  curvature: number;                    // 几何形体曲率 (0.0 尖锐折角 ~ 1.0 饱满圆润样条)
  density: number;                      // 元素疏密/数量系数 (0.3 极简稀疏 ~ 2.0 繁密丰富)
  wiggle: number;                       // 手绘微颤 (0.2 ~ 2.5)
  bleedStrength: number;                // 水彩出血扩散 (0.0 ~ 0.8)
  textureStrength: number;              // 纸纹留白强度 (0.0 ~ 1.0)
  borderStrength: number;               // 水渍边缘强度 (0.0 ~ 1.0)
  hatchDist: number;                    // 排线间距 (3 ~ 24)
  grain: number;                        // 碳粉颗粒感 (0.1 ~ 1.0)
  seed: number;                         // 随机数种子
  transparentBackground?: boolean;      // 是否使用透明背景
  aspectRatio?: WatercolorAspectRatio;  // 画幅比例
  resolution?: WatercolorResolution;    // 导出分辨率基准
  imageUrl: string | null;
  isSaved?: boolean;
  error?: string | null;
}

/** 10 款完全差异化精选美学配方模板字典（零同质化，各具代表性） */
export const WATERCOLOR_PRESET_RECIPES: Record<
  Exclude<WatercolorCompositionMode, 'custom'>,
  Partial<WatercolorBrushState>
> = {
  watercolor_clouds: {
    layoutMode: 'blobs',
    brushType: 'watercolor',
    fieldMode: 'curved',
    technique: 'watercolor',
    curvature: 0.92,
    density: 1.1,
    wiggle: 0.8,
    bleedStrength: 0.55,
    textureStrength: 0.75,
    borderStrength: 0.6,
    hatchDist: 8,
    paletteId: 'pastel_spring',
    transparentBackground: false,
    grain: 0.6,
  },
  topographic_strata: {
    layoutMode: 'strata',
    brushType: 'rotring',
    fieldMode: 'seabed',
    technique: 'watercolor',
    curvature: 0.8,
    density: 1.0,
    wiggle: 0.9,
    bleedStrength: 0.35,
    textureStrength: 0.65,
    borderStrength: 0.55,
    hatchDist: 7,
    paletteId: 'mineral_earth',
    transparentBackground: false,
    grain: 0.7,
  },
  matisse_cutouts: {
    layoutMode: 'cutouts',
    brushType: 'pastel',
    fieldMode: 'hand',
    technique: 'massing',
    curvature: 0.85,
    density: 0.8,
    wiggle: 1.1,
    bleedStrength: 0.2,
    textureStrength: 0.5,
    borderStrength: 0.4,
    hatchDist: 6,
    paletteId: 'vivid_impression',
    transparentBackground: false,
    grain: 0.8,
  },
  botanical_bloom: {
    layoutMode: 'radial',
    brushType: 'rotring',
    fieldMode: 'curved',
    technique: 'watercolor',
    curvature: 0.82,
    density: 1.0,
    wiggle: 0.7,
    bleedStrength: 0.45,
    textureStrength: 0.65,
    borderStrength: 0.5,
    hatchDist: 6,
    paletteId: 'pastel_spring',
    transparentBackground: false,
    grain: 0.6,
  },
  bauhaus_grid: {
    layoutMode: 'grid',
    brushType: 'rotring',
    fieldMode: 'none',
    technique: 'hatch_array',
    curvature: 0.15,
    density: 0.9,
    wiggle: 0.4,
    bleedStrength: 0.15,
    textureStrength: 0.4,
    borderStrength: 0.3,
    hatchDist: 9,
    paletteId: 'traditional_oriental',
    transparentBackground: false,
    grain: 0.5,
  },
  zen_splash: {
    layoutMode: 'rings',
    brushType: 'charcoal',
    fieldMode: 'hand',
    technique: 'watercolor',
    curvature: 0.9,
    density: 0.8,
    wiggle: 1.4,
    bleedStrength: 0.5,
    textureStrength: 0.8,
    borderStrength: 0.7,
    hatchDist: 8,
    paletteId: 'monochrome_pencil',
    transparentBackground: false,
    grain: 0.9,
  },
  abstract_sketch: {
    layoutMode: 'flow_lines',
    brushType: '2B',
    fieldMode: 'hand',
    technique: 'contour',
    curvature: 0.8,
    density: 1.2,
    wiggle: 1.3,
    bleedStrength: 0.2,
    textureStrength: 0.4,
    borderStrength: 0.3,
    hatchDist: 8,
    paletteId: 'monochrome_pencil',
    transparentBackground: false,
    grain: 0.85,
  },
  ukiyo_wave: {
    layoutMode: 'waves',
    brushType: 'cpencil',
    fieldMode: 'waves',
    technique: 'hatching',
    curvature: 0.75,
    density: 1.0,
    wiggle: 1.2,
    bleedStrength: 0.25,
    textureStrength: 0.55,
    borderStrength: 0.45,
    hatchDist: 6,
    paletteId: 'traditional_oriental',
    transparentBackground: false,
    grain: 0.7,
  },
  aerosol_spray: {
    layoutMode: 'spray',
    brushType: 'spray',
    fieldMode: 'curved',
    technique: 'wash',
    curvature: 0.6,
    density: 1.2,
    wiggle: 1.4,
    bleedStrength: 0.3,
    textureStrength: 0.7,
    borderStrength: 0.4,
    hatchDist: 10,
    paletteId: 'vivid_impression',
    transparentBackground: false,
    grain: 0.8,
  },
  mineral_rubbing: {
    layoutMode: 'mineral',
    brushType: 'pastel',
    fieldMode: 'hand',
    technique: 'massing',
    curvature: 0.35,
    density: 1.0,
    wiggle: 0.9,
    bleedStrength: 0.3,
    textureStrength: 0.8,
    borderStrength: 0.5,
    hatchDist: 8,
    paletteId: 'mineral_earth',
    transparentBackground: false,
    grain: 0.75,
  },
};

export const WATERCOLOR_DEFAULT_PARAMS: WatercolorBrushState = {
  mode: 'custom',
  layoutMode: 'blobs',
  paletteId: 'traditional_oriental',
  customColors: [],
  brushType: 'watercolor',
  fieldMode: 'curved',
  technique: 'watercolor',
  curvature: 0.8,
  density: 1.0,
  wiggle: 1.2,
  bleedStrength: 0.35,
  textureStrength: 0.6,
  borderStrength: 0.5,
  hatchDist: 8,
  grain: 0.7,
  seed: 42,
  transparentBackground: false,
  aspectRatio: '1:1',
  resolution: 1024,
  imageUrl: null,
  isSaved: false,
  error: null,
};
