/**
 * 手账制作（Journal Maker）类型定义
 */

/** 手账页面画布预设（导出像素尺寸） */
export type JournalPagePresetId = '3:4' | '1:1' | '4:3';

export interface JournalPagePreset {
  id: JournalPagePresetId;
  label: string;
  width: number;
  height: number;
}

/** 画布预设清单（组件下拉与合成引擎共用） */
export const JOURNAL_PAGE_PRESETS: JournalPagePreset[] = [
  { id: '3:4', label: '竖版 3:4', width: 1200, height: 1600 },
  { id: '1:1', label: '方版 1:1', width: 1400, height: 1400 },
  { id: '4:3', label: '横版 4:3', width: 1600, height: 1200 },
];

export function journalPagePresetOf(id: JournalPagePresetId | string): JournalPagePreset {
  return JOURNAL_PAGE_PRESETS.find((p) => p.id === id) ?? JOURNAL_PAGE_PRESETS[0];
}

/** 页面背景中的单个径向 Mesh 光斑 */
export interface MeshSpot {
  /** 中心点 X (0~100) */
  x: number;
  /** 中心点 Y (0~100) */
  y: number;
  /** 辐射半径 X (0~100) */
  rx: number;
  /** 辐射半径 Y (0~100) */
  ry: number;
  /** 颜色（支持 hex / rgb / rgba / oklch） */
  color: string;
}

/** 页面背景：纯色、线性渐变或多点 Mesh 网状光斑 */
export interface JournalBackground {
  kind: 'solid' | 'linear' | 'mesh';
  /** 颜色标（solid 取第 1 个；linear 至少 2 个；mesh 作为底层渐变） */
  colors: string[];
  /** 渐变角度 deg（CSS 口径：0° 向上、顺时针增大），默认 135 */
  angle?: number;
  /** 自定义色调 hex 基准（若有） */
  tintHex?: string;
  /** 浓度/不透明度（0~100，默认 75） */
  opacity?: number;
  /** 是否叠加白色点阵网格（默认 true） */
  dotGrid?: boolean;
  /** 是否启用四周 15% 边缘软羽化遮罩（默认 true） */
  edgeFade?: boolean;
  /** 多点 Mesh 光斑（kind === 'mesh' 时有效） */
  meshSpots?: MeshSpot[];
}

/** 辅助：十六进制转 RGBA 字符串 */
export function hexToRgbaStr(hex: string, alpha = 1): string {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  if (clean.length === 8) {
    const a = parseInt(clean.slice(6, 8), 16) / 255;
    clean = clean.slice(0, 6);
    alpha = Math.min(alpha, a);
  }
  const num = parseInt(clean, 16);
  if (Number.isNaN(num)) return `rgba(255, 255, 255, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
}

/** 辅助：RGB 转 HSL */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

/** 辅助：HSL 转 RGBA 字符串 */
function hslToRgbaStr(h: number, s: number, l: number, a = 1): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c; g = x; b = 0;
  } else if (h < 120) {
    r = x; g = c; b = 0;
  } else if (h < 180) {
    r = 0; g = c; b = x;
  } else if (h < 240) {
    r = 0; g = x; b = c;
  } else if (h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  return `rgba(${Math.round((r + m) * 255)}, ${Math.round((g + m) * 255)}, ${Math.round((b + m) * 255)}, ${Number(a.toFixed(3))})`;
}

/**
 * 用户自定义单色自适应衍生 Mesh 描述符：
 * 以主色为核心，自适应派生多色相偏移与透明度梯度的 Mesh 光晕
 */
export function deriveTintMesh(hex: string, opacity = 75): JournalBackground {
  const normHex = hex.startsWith('#') ? hex : `#${hex}`;
  const clean = normHex.replace('#', '');
  const num = parseInt(clean.slice(0, 6), 16) || 0;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const [h, s, l] = rgbToHsl(r, g, b);
  const factor = Math.max(0.1, Math.min(1, opacity / 100));

  const spots: MeshSpot[] = [
    // 左上：主色光晕（强）
    { x: 22, y: 16, rx: 46, ry: 36, color: hslToRgbaStr(h, s, l, 0.85 * factor) },
    // 右上：色相微偏 +25°（暖光/过渡）
    { x: 78, y: 16, rx: 46, ry: 36, color: hslToRgbaStr(h + 25, Math.min(100, s + 5), l, 0.75 * factor) },
    // 左中：色相偏移 +60°（丰富层次）
    { x: 22, y: 52, rx: 46, ry: 36, color: hslToRgbaStr(h + 60, s, Math.max(20, l - 5), 0.65 * factor) },
    // 右中：色相反向偏移 -30°
    { x: 78, y: 52, rx: 46, ry: 36, color: hslToRgbaStr(h - 30, s, Math.min(95, l + 5), 0.7 * factor) },
    // 左下：色相偏 +120° 或自然淡化
    { x: 22, y: 86, rx: 46, ry: 36, color: hslToRgbaStr(h + 120, Math.max(30, s - 10), l, 0.6 * factor) },
  ];

  // 底层极淡渐变
  const baseGrad = [
    hslToRgbaStr(h + 10, Math.min(60, s), 96, 0.9),
    hslToRgbaStr(h + 40, Math.min(50, s), 94, 0.9),
    hslToRgbaStr(h - 20, Math.min(60, s), 95, 0.9),
  ];

  return {
    kind: 'mesh',
    tintHex: normHex,
    opacity,
    colors: baseGrad,
    meshSpots: spots,
    dotGrid: true,
    edgeFade: true,
  };
}

/** 兼容历史持久化描述符 */
export function normalizeJournalBackground(value: unknown): JournalBackground {
  if (typeof value === 'string') return deriveTintMesh(value, 75);
  const bg = value as JournalBackground | null | undefined;
  if (bg && bg.kind) {
    if (bg.kind === 'mesh' && bg.meshSpots?.length) return bg;
    if (bg.kind === 'solid' && bg.colors?.length) {
      return deriveTintMesh(bg.colors[0], bg.opacity ?? 75);
    }
    if (Array.isArray(bg.colors) && bg.colors.length > 0) return bg;
  }
  return JOURNAL_DEFAULTS.background;
}

/** 描述符 → CSS 背景（页面预览与色板小样共用） */
export function journalBackgroundCss(bg: JournalBackground, includeDotGrid = true): string {
  if (!bg) return '#ffffff';
  
  if (bg.kind === 'solid') {
    return bg.colors?.[0] || '#ffffff';
  }

  const dotGridCss = includeDotGrid && bg.dotGrid !== false
    ? 'radial-gradient(circle, rgba(255, 255, 255, 0.9) 0.5px, transparent 0.5px) 0 0 / 5px 5px'
    : '';

  if (bg.kind === 'mesh' && bg.meshSpots?.length) {
    const spotGradients = bg.meshSpots.map((spot) => {
      const transparentColor = spot.color.includes('rgba')
        ? spot.color.replace(/[\d.]+\)$/, '0)')
        : 'rgba(255, 255, 255, 0)';
      return `radial-gradient(${spot.rx}% ${spot.ry}% at ${spot.x}% ${spot.y}%, ${spot.color} 0%, ${transparentColor} 100%)`;
    });
    const baseLinear = bg.colors?.length >= 2
      ? `linear-gradient(${bg.angle ?? 135}deg, ${bg.colors.join(', ')})`
      : bg.colors?.[0] || '#ffffff';
    
    return [dotGridCss, ...spotGradients, baseLinear].filter(Boolean).join(', ');
  }

  if (bg.kind === 'linear' && bg.colors?.length >= 2) {
    const linear = `linear-gradient(${bg.angle ?? 135}deg, ${bg.colors.join(', ')})`;
    return [dotGridCss, linear].filter(Boolean).join(', ');
  }

  return bg.colors?.[0] || '#ffffff';
}

/**
 * 更新任意背景的浓度（透明度）：
 * 若为自定义 Tint Mesh，重新派生光斑；
 * 若为预设 Mesh，更新 opacity 字段并按比例调整 spot 的 alpha
 */
export function updateBackgroundOpacity(bg: JournalBackground, opacity: number): JournalBackground {
  opacity = Math.max(10, Math.min(100, opacity));
  if (bg.tintHex) {
    return deriveTintMesh(bg.tintHex, opacity);
  }
  if (bg.kind === 'mesh' && bg.meshSpots?.length) {
    const prevOpacity = bg.opacity || 80;
    const ratio = (opacity / 100) / (prevOpacity / 100);
    const nextSpots = bg.meshSpots.map((spot) => {
      const color = spot.color.replace(/rgba\(([\d\s,]+),\s*([\d.]+)\)/, (_, rgb, a) => {
        const nextA = Math.min(1, Math.max(0, Number(a) * ratio));
        return `rgba(${rgb}, ${Number(nextA.toFixed(3))})`;
      });
      return { ...spot, color };
    });
    return {
      ...bg,
      opacity,
      meshSpots: nextSpots,
    };
  }
  return { ...bg, opacity };
}

/** 描述符比较键（选中态高亮 / 去重） */
export function journalBackgroundKey(bg: JournalBackground): string {
  if (bg.tintHex) return `mesh:tint:${bg.tintHex}`;
  if (bg.kind === 'mesh') return `mesh:${(bg.colors ?? []).join(',')}:${bg.meshSpots?.length || 0}`;
  return `${bg.kind}:${bg.angle ?? ''}:${(bg.colors ?? []).join(',')}`;
}

/** 预设全息与主题 Mesh 底色（截图 2 经典款 + 晨雾、落日、薄荷等） */
export const JOURNAL_BG_PRESETS: Array<{ label: string; bg: JournalBackground }> = [
  {
    label: '全息',
    bg: {
      kind: 'mesh',
      opacity: 85,
      dotGrid: true,
      edgeFade: true,
      colors: ['#fff2ec', '#f3e9ff', '#e6fbf2'],
      meshSpots: [
        { x: 22, y: 14, rx: 45, ry: 35, color: 'rgba(242, 78, 30, 0.85)' },
        { x: 78, y: 14, rx: 45, ry: 35, color: 'rgba(255, 114, 98, 0.85)' },
        { x: 22, y: 50, rx: 45, ry: 35, color: 'rgba(162, 89, 255, 0.8)' },
        { x: 78, y: 50, rx: 45, ry: 35, color: 'rgba(26, 188, 254, 0.8)' },
        { x: 22, y: 86, rx: 45, ry: 35, color: 'rgba(10, 207, 131, 0.8)' },
      ],
    },
  },
  {
    label: '落日',
    bg: {
      kind: 'mesh',
      opacity: 80,
      dotGrid: true,
      edgeFade: true,
      colors: ['#fff6ee', '#fdeef2', '#fce8df'],
      meshSpots: [
        { x: 24, y: 18, rx: 48, ry: 38, color: 'rgba(255, 122, 69, 0.8)' },
        { x: 76, y: 22, rx: 46, ry: 36, color: 'rgba(255, 180, 80, 0.75)' },
        { x: 30, y: 56, rx: 48, ry: 38, color: 'rgba(250, 140, 180, 0.7)' },
        { x: 80, y: 64, rx: 46, ry: 36, color: 'rgba(255, 100, 120, 0.75)' },
        { x: 40, y: 88, rx: 50, ry: 40, color: 'rgba(255, 195, 140, 0.65)' },
      ],
    },
  },
  {
    label: '樱粉',
    bg: {
      kind: 'mesh',
      opacity: 80,
      dotGrid: true,
      edgeFade: true,
      colors: ['#fff2f6', '#fdf0f8', '#f8eefa'],
      meshSpots: [
        { x: 20, y: 16, rx: 46, ry: 36, color: 'rgba(255, 117, 168, 0.8)' },
        { x: 80, y: 18, rx: 48, ry: 38, color: 'rgba(255, 175, 204, 0.75)' },
        { x: 25, y: 54, rx: 46, ry: 36, color: 'rgba(218, 140, 255, 0.7)' },
        { x: 75, y: 58, rx: 46, ry: 36, color: 'rgba(255, 140, 175, 0.75)' },
        { x: 30, y: 86, rx: 48, ry: 38, color: 'rgba(255, 195, 215, 0.65)' },
      ],
    },
  },
  {
    label: '薄荷',
    bg: {
      kind: 'mesh',
      opacity: 80,
      dotGrid: true,
      edgeFade: true,
      colors: ['#f0faf4', '#ebf9f5', '#e6f7f2'],
      meshSpots: [
        { x: 22, y: 16, rx: 46, ry: 36, color: 'rgba(16, 185, 129, 0.75)' },
        { x: 78, y: 18, rx: 46, ry: 36, color: 'rgba(52, 211, 153, 0.75)' },
        { x: 22, y: 52, rx: 46, ry: 36, color: 'rgba(45, 212, 191, 0.7)' },
        { x: 78, y: 54, rx: 46, ry: 36, color: 'rgba(56, 189, 248, 0.65)' },
        { x: 35, y: 86, rx: 48, ry: 38, color: 'rgba(110, 231, 183, 0.6)' },
      ],
    },
  },
  {
    label: '晴空',
    bg: {
      kind: 'mesh',
      opacity: 80,
      dotGrid: true,
      edgeFade: true,
      colors: ['#f0f7ff', '#eaf2fd', '#e5effd'],
      meshSpots: [
        { x: 24, y: 16, rx: 46, ry: 36, color: 'rgba(14, 165, 233, 0.8)' },
        { x: 78, y: 18, rx: 46, ry: 36, color: 'rgba(96, 165, 250, 0.75)' },
        { x: 22, y: 54, rx: 46, ry: 36, color: 'rgba(129, 140, 248, 0.7)' },
        { x: 80, y: 56, rx: 46, ry: 36, color: 'rgba(56, 189, 248, 0.75)' },
        { x: 40, y: 88, rx: 48, ry: 38, color: 'rgba(186, 230, 253, 0.65)' },
      ],
    },
  },
  {
    label: '晨雾',
    bg: {
      kind: 'mesh',
      opacity: 70,
      dotGrid: true,
      edgeFade: true,
      colors: ['#faf8f5', '#f5f2ee', '#f0ede8'],
      meshSpots: [
        { x: 22, y: 18, rx: 48, ry: 38, color: 'rgba(214, 180, 150, 0.55)' },
        { x: 78, y: 22, rx: 46, ry: 36, color: 'rgba(195, 190, 180, 0.5)' },
        { x: 28, y: 58, rx: 48, ry: 38, color: 'rgba(180, 195, 190, 0.45)' },
        { x: 78, y: 64, rx: 46, ry: 36, color: 'rgba(205, 185, 170, 0.5)' },
        { x: 35, y: 86, rx: 48, ry: 38, color: 'rgba(220, 210, 200, 0.45)' },
      ],
    },
  },
  {
    label: '奶油',
    bg: {
      kind: 'mesh',
      opacity: 75,
      dotGrid: true,
      edgeFade: true,
      colors: ['#fffbf2', '#fef5e6', '#fdf0d8'],
      meshSpots: [
        { x: 22, y: 16, rx: 46, ry: 36, color: 'rgba(251, 191, 36, 0.65)' },
        { x: 78, y: 18, rx: 46, ry: 36, color: 'rgba(245, 158, 11, 0.6)' },
        { x: 22, y: 54, rx: 46, ry: 36, color: 'rgba(252, 211, 77, 0.55)' },
        { x: 80, y: 58, rx: 46, ry: 36, color: 'rgba(251, 146, 60, 0.6)' },
        { x: 40, y: 88, rx: 48, ry: 38, color: 'rgba(254, 240, 138, 0.5)' },
      ],
    },
  },
];

export const JOURNAL_DEFAULTS = {
  background: JOURNAL_BG_PRESETS[0].bg,
  pageSize: '3:4' as JournalPagePresetId,
  removeBackground: false,
};

/** 页面上的一张拼贴素材：中心点 x/y 与宽 w 均为页面百分比，angle 度，z 图层序 */
export interface JournalMakerItem {
  id: string;
  src: string;
  x: number;
  y: number;
  w: number;
  angle: number;
  z: number;
}

/** 手账制作节点内部持久化状态 */
export interface JournalMakerState {
  /** 页面拼贴素材（编辑态的完整事实来源，含上级/封面/上传全部来源） */
  items: JournalMakerItem[];
  /** 页面背景描述符（纯色 / 线性渐变，随节点保存） */
  background: JournalBackground;
  /** 画布预设 id */
  pageSize: JournalPagePresetId;
  /** 生成时是否先对每张素材做 AI 抠图去底（默认关） */
  removeBackground: boolean;
  /** 合成的整张手账页图片 URL (PNG) */
  imageUrl?: string | null;
  /** 本地多选上传的素材（删除即彻底移除） */
  uploadedImages?: string[] | null;
  /** 被用户去掉的上级/封面来源 src 记忆（防止装载同步自动回填） */
  dismissedSources?: string[] | null;
  /** 是否已保存到数据库 (generations 表) */
  isSaved?: boolean;
  error?: string | null;
}
