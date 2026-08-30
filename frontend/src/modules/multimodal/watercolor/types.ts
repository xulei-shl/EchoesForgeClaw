/**
 * 物理水彩手绘 (p5.brush) 节点类型定义
 */

export type WatercolorCompositionMode =
  | 'wave_strips'        // 〰️ 流动波浪色带（垂直波浪色带 + 水彩形变多边形与马克笔排线交错）
  | 'watercolor_clouds'   // 💧 云阶水彩晕染（多层分形水彩云团 + 留白擦除 + GPU 水渍边缘暗化）
  | 'grid_hatch'         // ▦ 格律排线矩阵（网格几何 + 多角度扫描排线 + 喷枪底色）
  | 'vector_vortex'      // 🌀 向量流场涡旋（同心圆/螺旋参数曲线 + 涡旋流场 + 细针管笔高频密织）
  | 'abstract_sketch';   // ✏️ 表现主义手绘（多材质笔尖混合 + 随机压感与飞溅碳粉）

export type WatercolorBrushType =
  | 'watercolor'
  | 'pen'
  | 'rotring'
  | '2B'
  | 'HB'
  | '2H'
  | 'cpencil'
  | 'pastel'
  | 'charcoal'
  | 'marker'
  | 'spray';

export type WatercolorFieldMode =
  | 'hand'
  | 'curved'
  | 'zigzag'
  | 'waves'
  | 'seabed'
  | 'spiral'
  | 'columns';

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

export interface WatercolorBrushState {
  mode: WatercolorCompositionMode;
  paletteId: string;
  customColors: string[];
  brushType: WatercolorBrushType;
  wiggle: number;           // 手绘微颤 (0.1 ~ 3.0)
  bleedStrength: number;    // 水彩出血扩散 (0.0 ~ 1.0)
  textureStrength: number;  // 纸纹留白强度 (0.0 ~ 1.0)
  borderStrength: number;   // 水渍边缘强度 (0.0 ~ 1.0)
  hatchDist: number;        // 排线间距 (3 ~ 24)
  fieldMode: WatercolorFieldMode;
  grain: number;            // 碳粉颗粒感 (0.1 ~ 1.0)
  seed: number;             // 随机数种子
  imageUrl: string | null;
  isSaved?: boolean;
  error?: string | null;
}

export const WATERCOLOR_DEFAULT_PARAMS: WatercolorBrushState = {
  mode: 'wave_strips',
  paletteId: 'traditional_oriental',
  customColors: [],
  brushType: 'watercolor',
  wiggle: 1.2,
  bleedStrength: 0.35,
  textureStrength: 0.6,
  borderStrength: 0.5,
  hatchDist: 8,
  fieldMode: 'hand',
  grain: 0.7,
  seed: 42,
  imageUrl: null,
  isSaved: false,
  error: null,
};
