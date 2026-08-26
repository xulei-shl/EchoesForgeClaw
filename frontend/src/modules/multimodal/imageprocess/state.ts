/**
 * 图片处理状态公共核心函数（对齐「图书小票」buildReceiptState 的归一化角色）
 *
 * 效果解析 / 参数兜底 / 效果切换语义集中在此，节点组件不重复实现这些规则：
 * - 参数桶按效果隔离，切换效果互不覆盖、切回恢复各自参数；
 * - 切换效果 = 输出失效（清空 imageUrl 回编辑态）：保证下游读到的 data.imageUrl
 *   始终是「当前所选效果」的结果，「保存到数据库」同样只在生成动作后按当前效果产出。
 */

import type { ImageFxId, ImageFxParamValue, ImageProcessState } from './types';
import { defaultFxParamsOf, getImageFxEffect } from './effects/registry';

/** 读取某效果的完整参数表（已存参数覆盖默认值；缺字段安全回落） */
export function resolveFxParams(
  effectId: ImageFxId | string | null | undefined,
  data?: Partial<ImageProcessState>
): { effect: ReturnType<typeof getImageFxEffect>; params: Record<string, ImageFxParamValue> } {
  const effect = getImageFxEffect(effectId ?? data?.effectId);
  const saved = data?.fxParams?.[effect.id] ?? {};
  return { effect, params: { ...defaultFxParamsOf(effect), ...saved } };
}

/**
 * 效果切换补丁：写入新效果 id + 参数桶补默认值，并使旧结果失效
 * （imageUrl 清空回编辑态 / isSaved 复位，避免下游与数据库拿到旧效果的结果）。
 */
export function switchFxEffectPatch(
  nextEffectId: ImageFxId | string,
  data?: Partial<ImageProcessState>
): Partial<ImageProcessState> {
  const effect = getImageFxEffect(nextEffectId);
  const savedBucket = data?.fxParams?.[effect.id] ?? {};
  return {
    effectId: effect.id,
    fxParams: {
      ...(data?.fxParams ?? {}),
      [effect.id]: { ...defaultFxParamsOf(effect), ...savedBucket },
    },
    imageUrl: null,
    isSaved: false,
    error: null,
  };
}
