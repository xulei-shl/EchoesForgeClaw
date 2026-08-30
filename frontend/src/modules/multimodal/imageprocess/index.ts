/**
 * 图片处理（Image Process）效果引擎模块
 *
 * 架构参照「图书小票」多模板模式：效果注册表（effects/registry.ts）
 * + 声明式参数 + 统一渲染分发；状态语义见 state.ts。
 */

export * from './types';
export * from './shared';
export * from './effects/registry';
export * from './effects/grain';
export * from './effects/halftone';
export * from './effects/dither';
export * from './effects/ascii';
export * from './effects/texture';
export * from './effects/crt';
export * from './state';

import { getImageFxEffect } from './effects/registry';
import type { ImageFxId, ImageFxParamValue, ImageFxRenderOptions } from './types';

/**
 * 应用指定效果：加载输入图 → 效果 render → 输出 PNG Data URL。
 * 预览与「生成」共用同一实现（所见即所得），仅 maxEdge 不同。
 */
export async function applyImageFx(
  effectId: ImageFxId | string,
  src: string,
  params: Record<string, ImageFxParamValue>,
  options?: ImageFxRenderOptions
): Promise<string> {
  const effect = getImageFxEffect(effectId);
  const canvas = await effect.render(src, params, options);
  return canvas.toDataURL('image/png');
}
