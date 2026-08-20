import type { ReceiptTheme, ReceiptThemeId } from './types';

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
    text: '#1E232A',
    faint: '#6B7280',
    dashed: '#D1D5DB',
    accent: '#2563EB',
    previewColor: '#FFFFFF',
  },
  {
    id: 'cream',
    name: '复古米黄',
    bg: '#F6EFE1',
    text: '#2B231D',
    faint: '#7B6E62',
    dashed: '#D8CCBB',
    accent: '#A05A2C',
    previewColor: '#F6EFE1',
  },
  {
    id: 'pink',
    name: '淡雅粉红',
    bg: '#FCE7EB',
    text: '#382229',
    faint: '#87636F',
    dashed: '#E5C5CD',
    accent: '#BE3455',
    previewColor: '#FCE7EB',
  },
  {
    id: 'mint',
    name: '薄荷淡绿',
    bg: '#E2F4EA',
    text: '#1B3227',
    faint: '#567D6C',
    dashed: '#BDDECFAF',
    accent: '#2B7A56',
    previewColor: '#E2F4EA',
  },
  {
    id: 'sage',
    name: '草木青绿',
    bg: '#E2E6C4',
    text: '#49704C',
    faint: '#7D9B80',
    dashed: '#B6CBB1',
    accent: '#49704C',
    previewColor: '#E2E6C4',
  },
  {
    id: 'ancient',
    name: '古籍泛黄',
    bg: '#E4D1A9',
    text: '#262626',
    faint: '#6E604C',
    dashed: '#C4A878',
    accent: '#A63A2B',
    previewColor: '#E4D1A9',
  },
  {
    id: 'purple',
    name: '梦幻浅紫',
    bg: '#EDE7F6',
    text: '#2C223C',
    faint: '#726488',
    dashed: '#D5C8E7',
    accent: '#6D43B5',
    previewColor: '#EDE7F6',
  },
];

/** 运行时主题注册表（支持动态新增配色） */
const themeRegistry = new Map<string, ReceiptTheme>(
  DEFAULT_RECEIPT_THEMES.map((theme) => [theme.id, theme])
);

/**
 * 获取指定 ID 的主题配色（带兜底）
 */
export function getReceiptTheme(themeId?: ReceiptThemeId): ReceiptTheme {
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
