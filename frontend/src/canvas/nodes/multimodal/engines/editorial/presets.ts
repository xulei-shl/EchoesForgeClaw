/**
 * 杂志排版模块 - 预设接入层 (Presets Gateway)
 * 映射并导出来自 templates/ 的独立模块化预设
 */

import {
  EDITORIAL_TEMPLATES,
  DEFAULT_EDITORIAL_TEMPLATE,
  getEditorialTemplate,
} from './templates';
import type { EditorialPreset } from './types';

export const EDITORIAL_PRESETS: EditorialPreset[] = EDITORIAL_TEMPLATES;
export const DEFAULT_EDITORIAL_PRESET: EditorialPreset = DEFAULT_EDITORIAL_TEMPLATE;

export function getEditorialPreset(id: string): EditorialPreset {
  return getEditorialTemplate(id);
}

export {
  EDITORIAL_TEMPLATES,
  DEFAULT_EDITORIAL_TEMPLATE,
  getEditorialTemplate,
} from './templates';
