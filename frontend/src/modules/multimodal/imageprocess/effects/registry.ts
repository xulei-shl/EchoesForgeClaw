/**
 * 图片处理效果注册表（对齐「图书小票生成」templates.ts 的注册表模式）
 *
 * - 每个效果一个 ImageFxEffectDef，在此登记后自动出现在效果切换 UI；
 * - getImageFxEffect 对未知 id 兜底首个效果（与 getReceiptTemplate 口径一致）；
 * - registerImageFxEffect 预留运行时扩展。
 */

import type { ImageFxEffectDef, ImageFxId, ImageFxParamValue } from '../types';
import { fxDefaultParams } from '../shared';
import { GRAIN_FX_EFFECT } from './grain';

/** 效果注册表 */
const imageFxRegistry = new Map<string, ImageFxEffectDef>([
  [GRAIN_FX_EFFECT.id, GRAIN_FX_EFFECT],
]);

/** 获取所有可用效果（UI 效果切换列表按此渲染） */
export function getAllImageFxEffects(): ImageFxEffectDef[] {
  return Array.from(imageFxRegistry.values());
}

/** 获取指定效果；未知 id 兜底首个已注册效果 */
export function getImageFxEffect(id?: ImageFxId | string | null): ImageFxEffectDef {
  if (id && imageFxRegistry.has(id)) {
    return imageFxRegistry.get(id)!;
  }
  return getAllImageFxEffects()[0];
}

/** 注册自定义效果（扩展机制） */
export function registerImageFxEffect(effect: ImageFxEffectDef): void {
  imageFxRegistry.set(effect.id, effect);
}

/**
 * 从效果参数声明提取默认参数表
 */
export function defaultFxParamsOf(effect: ImageFxEffectDef): Record<string, ImageFxParamValue> {
  return fxDefaultParams(effect.params);
}
