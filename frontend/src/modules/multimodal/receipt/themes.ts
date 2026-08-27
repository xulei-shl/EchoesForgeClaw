import type { ReceiptTheme, ReceiptThemeId } from './types';
import { deriveReceiptThemeFromSeed } from './oklch';

/**
 * 预设热敏纸主题配色表
 *
 * 经典复古热敏打印纸色系，每款主题均包含相协调的纸张底色、油墨色、虚线色及点缀色。
 */
export const DEFAULT_RECEIPT_THEMES: ReceiptTheme[] = [
  {
    id: 'white',
    name: '经典素白',
    bg: '#FDFDFC',
    text: '#1E293B',
    faint: '#64748B',
    dashed: '#CBD5E1',
    accent: '#2563EB',
    previewColor: '#FFFFFF',
  },
  {
    id: 'cream',
    name: '复古米黄',
    bg: '#F6EFE1',
    text: '#453225',
    faint: '#7C695B',
    dashed: '#D6C7B2',
    accent: '#9E4F24',
    previewColor: '#F6EFE1',
  },
  {
    id: 'pink',
    name: '淡雅粉红',
    bg: '#FCE7EB',
    text: '#542231',
    faint: '#8C5668',
    dashed: '#E5C0C9',
    accent: '#B8284C',
    previewColor: '#FCE7EB',
  },
  {
    id: 'mint',
    name: '薄荷淡绿',
    bg: '#E2F4EA',
    text: '#164332',
    faint: '#497360',
    dashed: '#B6DCC8',
    accent: '#1B7A52',
    previewColor: '#E2F4EA',
  },
  {
    id: 'sage',
    name: '草木青绿',
    bg: '#E2E6C4',
    text: '#304F33',
    faint: '#4E6B51',
    dashed: '#B0C5AB',
    accent: '#436B46',
    previewColor: '#E2E6C4',
  },
  {
    id: 'ancient',
    name: '古籍泛黄',
    bg: '#E4D1A9',
    text: '#362419',
    faint: '#62503E',
    dashed: '#C2A473',
    accent: '#9C3022',
    previewColor: '#E4D1A9',
  },
  {
    id: 'purple',
    name: '梦幻浅紫',
    bg: '#EDE7F6',
    text: '#3C225A',
    faint: '#71558F',
    dashed: '#D0C1E5',
    accent: '#6B3BB2',
    previewColor: '#EDE7F6',
  },
];

/** 运行时主题注册表（支持动态新增配色） */
const themeRegistry = new Map<string, ReceiptTheme>(
  DEFAULT_RECEIPT_THEMES.map((theme) => [theme.id, theme])
);

/**
 * 获取指定 ID 的主题配色（带兜底与 OKLCH 动态派生）
 *
 * @param themeId 主题标识，支持 'custom'、预设 ID 或直接传入 16 进制颜色
 * @param customColor 自定义种子色 Hex（如 '#3B82F6'）
 */
export function getReceiptTheme(themeId?: ReceiptThemeId, customColor?: string): ReceiptTheme {
  if (themeId === 'custom' || (!themeRegistry.has(themeId || '') && themeId?.startsWith('#'))) {
    const seed = customColor || (themeId?.startsWith('#') ? themeId : '#3B82F6');
    return deriveReceiptThemeFromSeed(seed);
  }
  if (themeId && themeRegistry.has(themeId)) {
    return themeRegistry.get(themeId)!;
  }
  return DEFAULT_RECEIPT_THEMES[0];
}

/**
 * 获取所有可用主题列表
 */
export function getAllReceiptThemes(): ReceiptTheme[] {
  return Array.from(themeRegistry.values());
}

/**
 * 注册新主题（扩展机制）
 */
export function registerReceiptTheme(theme: ReceiptTheme): void {
  themeRegistry.set(theme.id, theme);
}
