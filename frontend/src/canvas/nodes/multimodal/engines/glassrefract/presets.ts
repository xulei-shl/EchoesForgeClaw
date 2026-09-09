/**
 * 玻璃折射预设库
 */

import type { GlassPattern, GlassPreset, GlassRefractParams } from './types';

export const DEFAULT_PRESET_ID = 'vintage_cross';

export const DEFAULT_GLASS_PARAMS: GlassRefractParams = {
  pattern: 'cross',
  scale: 26,
  relief: 1.07,
  thickness: 91,
  angle: 0,
  dispersion: 0.01,
  specular: 0.32,
  gap: 0.06,
  seed: 7,
};

export const GLASS_PRESETS: GlassPreset[] = [
  {
    id: 'classic_fluted',
    name: '经典长虹',
    pattern: 'fluted',
    description: '半圆柱竖条纹瓦楞，中间通透边缘折射，常用于法式门窗与隔断',
    params: {
      pattern: 'fluted',
      scale: 32,
      relief: 1.2,
      thickness: 85,
      angle: 0,
      dispersion: 0.012,
      specular: 0.35,
    },
  },
  {
    id: 'vintage_cross',
    name: '法式十字格',
    pattern: 'cross',
    description: '正交双向圆柱叠加形成的枕状透镜方格，经典优雅',
    params: {
      pattern: 'cross',
      scale: 26,
      relief: 1.07,
      thickness: 91,
      angle: 0,
      dispersion: 0.01,
      specular: 0.32,
    },
  },
  {
    id: 'retro_block',
    name: '复古玻璃砖',
    pattern: 'block',
    description: '平顶倒角采光玻璃砖，中间保持平视，边缘自然畸变并带砖缝阴影',
    params: {
      pattern: 'block',
      scale: 75,
      relief: 1.3,
      thickness: 110,
      angle: 0,
      dispersion: 0.008,
      specular: 0.28,
      gap: 0.06,
    },
  },
  {
    id: 'rainy_window',
    name: '雨夜车窗',
    pattern: 'rain',
    description: '表面密布的不规则雨水水珠小透镜，宛若雨夜车窗外的朦胧街景',
    params: {
      pattern: 'rain',
      scale: 45,
      relief: 1.4,
      thickness: 70,
      angle: 0,
      dispersion: 0.015,
      specular: 0.4,
      seed: 19,
    },
  },
  {
    id: 'water_ripple',
    name: '水波倒影',
    pattern: 'ripple',
    description: '同心圆波纹涟漪，宛若雨滴落入池塘产生的层层晕染',
    params: {
      pattern: 'ripple',
      scale: 40,
      relief: 0.95,
      thickness: 80,
      angle: 0,
      dispersion: 0.01,
      specular: 0.3,
    },
  },
  {
    id: 'dynamic_wave',
    name: '律动波浪',
    pattern: 'wave',
    description: '锯齿折线瓦楞波纹，呈现流线型韵律美感',
    params: {
      pattern: 'wave',
      scale: 36,
      relief: 1.15,
      thickness: 95,
      angle: 45,
      dispersion: 0.012,
      specular: 0.35,
    },
  },
  {
    id: 'hammered_facet',
    name: '欧式锤纹',
    pattern: 'hammer',
    description: '三向 60° 交错微切面，类似荔枝纹与手工压花玻璃',
    params: {
      pattern: 'hammer',
      scale: 30,
      relief: 1.25,
      thickness: 75,
      angle: 15,
      dispersion: 0.009,
      specular: 0.25,
    },
  },
  {
    id: 'flemish_flow',
    name: '佛兰芒流动曲面',
    pattern: 'flemish',
    description: '双层域扰动自然流动曲面，呈现古典手工吹制玻璃的温润与波荡',
    params: {
      pattern: 'flemish',
      scale: 60,
      relief: 1.0,
      thickness: 85,
      angle: 0,
      dispersion: 0.012,
      specular: 0.3,
    },
  },
  {
    id: 'frosted_blur',
    name: '冰霜磨砂',
    pattern: 'frosted',
    description: '高频多阶微噪点折射，提供高级柔和的隐私磨砂质感',
    params: {
      pattern: 'frosted',
      scale: 14,
      relief: 0.75,
      thickness: 60,
      angle: 0,
      dispersion: 0.005,
      specular: 0.15,
    },
  },
];

/**
 * 根据 ID 获取预设，找不到则回退默认
 */
export function getGlassPreset(id?: string): GlassPreset {
  const found = GLASS_PRESETS.find((p) => p.id === id);
  return found || GLASS_PRESETS[1]; // default vintage_cross
}

/**
 * 根据图案风格获取对应的优化预设参数
 */
export function getGlassPresetByPattern(pattern: GlassPattern): GlassPreset {
  const found = GLASS_PRESETS.find((p) => p.pattern === pattern);
  return found || GLASS_PRESETS[0];
}

/**
 * 风格图案说明文案
 */
export const PATTERN_DESCRIPTIONS: Record<GlassPattern, string> = {
  fluted: '半圆柱竖条纹并排，中间平缓边缘强折射，经典长虹瓦楞质感。',
  cross: '正交双向圆柱叠加形成的网格枕形微凸透镜，规整而富有光感。',
  block: '具有平滑四角倒角的平顶玻璃砖，中间保持平视，边缘产生折射。',
  ripple: '以视口中心向外辐射的同心圆波纹，呈现水波涟漪倒影效果。',
  rain: '散落晶莹雨水水珠透镜，每个水滴都是独立的小折射球镜。',
  wave: '条形波纹中叠加横向三角波折线扰动，赋予波浪动态韵律。',
  hammer: '三向 60° 三角波交汇形成的蜂窝六边形微切面，仿锤击荔枝纹。',
  flemish: '流体噪声二次扰动扭曲，还原古典手工流动玻璃的波荡质感。',
  frosted: '三频段密集体积噪点叠加形成的微透镜散布，呈现高级朦胧磨砂。',
};
