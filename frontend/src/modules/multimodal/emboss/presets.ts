/**
 * 微浮雕高光效果预设配置表
 */

import type { EmbossFoilPreset } from './types';

export const EMBOSS_FOIL_PRESETS: EmbossFoilPreset[] = [
  {
    id: 'topography',
    name: '等高线微光',
    description: '等高线指纹肌理 + 磨砂银白微光 + 邮票打孔（开箱经典款，对齐参考图质感）',
    params: {
      reliefStyle: 'topography',
      shimmerType: 'matte_silver',
      depth: 68,
      brightness: 72,
      radius: 46,
      lightAngle: 225,
      withPerforation: true,
      withMargin: true,
    },
  },
  {
    id: 'paper_emboss',
    name: '纸质浮雕暖金',
    description: '纸张微凹凸浮雕 + 奢雅香槟暖金高光 + 邮票纸边',
    params: {
      reliefStyle: 'paper_emboss',
      shimmerType: 'warm_gold',
      depth: 60,
      brightness: 75,
      radius: 50,
      lightAngle: 240,
      withPerforation: true,
      withMargin: true,
    },
  },
  {
    id: 'rainbow_foil',
    name: '全息彩虹卡牌',
    description: '几何等高网格 + 宝可梦式彩虹镭射全息光斑 + 平滑卡片边框',
    params: {
      reliefStyle: 'contour_mesh',
      shimmerType: 'rainbow_foil',
      depth: 75,
      brightness: 85,
      radius: 40,
      lightAngle: 215,
      withPerforation: false,
      withMargin: true,
    },
  },
  {
    id: 'aurora_vintage',
    name: '极光幻彩邮票',
    description: '细腻磨砂肌理 + 青紫极光幻彩渐变 + 经典复古邮票锯齿',
    params: {
      reliefStyle: 'fine_grain',
      shimmerType: 'aurora_cyan',
      depth: 55,
      brightness: 78,
      radius: 48,
      lightAngle: 230,
      withPerforation: true,
      withMargin: true,
    },
  },
  {
    id: 'clean_silver',
    name: '极简银箔卡片',
    description: '细腻微浮雕 + 现代纯净银白冷光 + 满版无白边设计',
    params: {
      reliefStyle: 'fine_grain',
      shimmerType: 'matte_silver',
      depth: 45,
      brightness: 65,
      radius: 55,
      lightAngle: 225,
      withPerforation: false,
      withMargin: false,
    },
  },
];

export const DEFAULT_PRESET_ID = 'topography';

export function getEmbossFoilPreset(id?: string): EmbossFoilPreset {
  return (
    EMBOSS_FOIL_PRESETS.find((p) => p.id === id) ||
    EMBOSS_FOIL_PRESETS[0]
  );
}
