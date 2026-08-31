/**
 * 微浮雕高光效果预设配置表
 */

import type { EmbossFoilPreset } from './types';

export const EMBOSS_FOIL_PRESETS: EmbossFoilPreset[] = [
  {
    id: 'topography_opal',
    name: '欧泊等高线',
    description: '等高线指纹肌理 + 欧泊翡翠天青幻彩高光 + 邮票打孔（开箱旗舰推荐）',
    params: {
      reliefStyle: 'topography',
      shimmerType: 'prismatic_opal',
      depth: 68,
      brightness: 76,
      radius: 46,
      lightAngle: 225,
      withPerforation: true,
      withMargin: true,
    },
  },
  {
    id: 'cyber_neon',
    name: '赛博霓虹卡',
    description: '几何等高网格 + 赛博电光洋红/电青激光 + 满版无打孔边框',
    params: {
      reliefStyle: 'contour_mesh',
      shimmerType: 'neon_cyber',
      depth: 72,
      brightness: 82,
      radius: 42,
      lightAngle: 215,
      withPerforation: false,
      withMargin: true,
    },
  },
  {
    id: 'rose_emboss',
    name: '玫瑰香槟浮雕',
    description: '纸张微凹凸浮雕 + 暮色玫瑰粉金微光 + 经典邮票纸边',
    params: {
      reliefStyle: 'paper_emboss',
      shimmerType: 'rose_champagne',
      depth: 62,
      brightness: 76,
      radius: 48,
      lightAngle: 240,
      withPerforation: true,
      withMargin: true,
    },
  },
  {
    id: 'nebula_grain',
    name: '星云幻夜磨砂',
    description: '细腻磨砂肌理 + 星云魅夜紫蓝荧光 + 满版璀璨星尘',
    params: {
      reliefStyle: 'fine_grain',
      shimmerType: 'nebula_violet',
      depth: 55,
      brightness: 80,
      radius: 50,
      lightAngle: 230,
      withPerforation: false,
      withMargin: true,
    },
  },
  {
    id: 'rainbow_foil',
    name: '全息彩虹闪卡',
    description: '几何等高网格 + 宝可梦式全光谱彩虹镭射全息光斑 + 平滑卡牌',
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
    id: 'warm_gold',
    name: '经典烫金浮雕',
    description: '纸质微浮雕 + 奢雅古典香槟暖金 + 邮票白边',
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
    id: 'platinum_minimal',
    name: '珠光铂金冷光',
    description: '细腻微浮雕 + 冰蓝淡粉纯净冷冽铂金 + 满版无白边设计',
    params: {
      reliefStyle: 'fine_grain',
      shimmerType: 'pearl_platinum',
      depth: 48,
      brightness: 70,
      radius: 52,
      lightAngle: 225,
      withPerforation: false,
      withMargin: false,
    },
  },
];

export const DEFAULT_PRESET_ID = 'topography_opal';

export function getEmbossFoilPreset(id?: string): EmbossFoilPreset {
  return (
    EMBOSS_FOIL_PRESETS.find((p) => p.id === id) ||
    EMBOSS_FOIL_PRESETS[0]
  );
}
