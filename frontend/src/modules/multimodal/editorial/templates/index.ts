/**
 * 杂志排版模块 - 独立模板注册中心 (Template Registry)
 * 统一聚合所有独立模板，支持策略模式分发与极简扩展
 */

import type { EditorialTemplate } from '../types';
import { newspaperEssayTemplate } from './newspaperEssay';
import { coverRibbonTemplate } from './coverRibbon';
import { quoteInterviewTemplate } from './quoteInterview';
import { invertedContrastTemplate } from './invertedContrast';
import { galleryDuoTemplate } from './galleryDuo';
import { minimalEditorialTemplate } from './minimalEditorial';
import { boldPosterTemplate } from './boldPoster';
import { freeBoardTemplate } from './freeBoard';

export const EDITORIAL_TEMPLATES: EditorialTemplate[] = [
  newspaperEssayTemplate,
  coverRibbonTemplate,
  quoteInterviewTemplate,
  invertedContrastTemplate,
  galleryDuoTemplate,
  minimalEditorialTemplate,
  boldPosterTemplate,
  freeBoardTemplate,
];

export const DEFAULT_EDITORIAL_TEMPLATE = EDITORIAL_TEMPLATES[0]!;

export const EDITORIAL_TEMPLATE_MAP: Record<string, EditorialTemplate> = EDITORIAL_TEMPLATES.reduce(
  (acc, t) => {
    acc[t.id] = t;
    return acc;
  },
  {} as Record<string, EditorialTemplate>
);

export function getEditorialTemplate(id: string): EditorialTemplate {
  return EDITORIAL_TEMPLATE_MAP[id] || DEFAULT_EDITORIAL_TEMPLATE;
}

export * from './newspaperEssay';
export * from './coverRibbon';
export * from './quoteInterview';
export * from './invertedContrast';
export * from './galleryDuo';
export * from './minimalEditorial';
export * from './boldPoster';
export * from './freeBoard';
