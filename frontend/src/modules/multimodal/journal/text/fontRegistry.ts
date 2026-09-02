/**
 * 手账制作文本模块 - 字体注册表与动态按需加载服务
 */

export interface JournalFontPreset {
  id: string;
  name: string;
  family: string;
  googleFont: string;
  category: 'chinese' | 'english';
  localOnly?: boolean;
}

export const JOURNAL_FONTS: JournalFontPreset[] = [
  { id: 'system_default', name: '系统默认', family: 'MiSans, "PingFang SC", "Noto Sans SC", sans-serif', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'shangtudongguan', name: '上图东观体', family: '上图东观体', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'youyouyisong', name: '又又意宋', family: '又又意宋', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'huiwenmincho', name: '汇文明朝体', family: 'Huiwen-mincho', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'cangeryukai', name: '仓耳玉楷', family: '仓耳玉楷', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'zhaohuadaziji', name: '朝华打字机', family: '朝华打字机', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'fangzepingxianyasong', name: '方正屏显雅宋', family: '方正屏显雅宋', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'hetangyueseshouxie', name: '荷塘月色手写体', family: '荷塘月色手写体', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'jinnianyeyaojiayouya', name: '今年也要加油鸭', family: '今年也要加油鸭', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'pingfanglaijianghu', name: '平方赖江湖飞扬体', family: '平方赖江湖飞扬体', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'pingfangqiaomu', name: '平方乔木体', family: '平方乔木体', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'qingliulishu', name: '青柳隶书', family: '青柳隶书', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'yangrendongzhushi', name: '杨任东竹石体', family: '杨任东竹石体', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'yusiyuanyanhuangti', name: '余思源颜黄体', family: '余思源颜黄体', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'yunfenghanchanti', name: '云峰寒蝉体', family: '云峰寒蝉体', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'zhongqizhimangxingshu', name: '钟齐志莽行书', family: '钟齐志莽行书', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'runzhijiayinzhangkai', name: '润植家如印奏章楷', family: '润植家如印奏章楷', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'hanchanfangsong', name: '寒蝉活仿宋', family: '寒蝉活仿宋', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'hanchansongti', name: '寒蝉活宋体', family: '寒蝉活宋体', googleFont: '', category: 'chinese', localOnly: true },
  { id: 'mashanzheng', name: '马善政楷', family: 'Ma Shan Zheng', googleFont: 'Ma+Shan+Zheng', category: 'chinese' },
  { id: 'zhimangxing', name: '志莽行书', family: 'Zhi Mang Xing', googleFont: 'Zhi+Mang+Xing', category: 'chinese' },
  { id: 'liujianmaocao', name: '刘建毛草', family: 'Liu Jian Mao Cao', googleFont: 'Liu+Jian+Mao+Cao', category: 'chinese' },
  { id: 'longcang', name: '龙苍草书', family: 'Long Cang', googleFont: 'Long+Cang', category: 'chinese' },
  { id: 'notoserif', name: '思源宋体', family: 'Noto Serif SC', googleFont: 'Noto+Serif+SC:wght@500;700', category: 'chinese' },
  { id: 'caveat', name: 'Caveat 灵动', family: 'Caveat', googleFont: 'Caveat:wght@600', category: 'english' },
];

export const DEFAULT_FONT_FAMILY = JOURNAL_FONTS[0].family;

/** 手账特色手写墨水色板预设 */
export interface JournalColorPreset {
  name: string;
  color: string;
  border?: boolean;
}

export const JOURNAL_TEXT_COLORS: JournalColorPreset[] = [
  { name: '浓墨', color: '#2d2a24' },
  { name: '朱砂', color: '#8b261e' },
  { name: '胭脂', color: '#c85554' },
  { name: '青黛', color: '#2c4f54' },
  { name: '霁蓝', color: '#3b5998' },
  { name: '暖咖', color: '#8b5e3c' },
  { name: '姜黄', color: '#d48806' },
  { name: '月白', color: '#ffffff', border: true },
];

export const DEFAULT_TEXT_COLOR = JOURNAL_TEXT_COLORS[0].color;

const loadedFontsCache = new Set<string>();

/**
 * 动态加载指定的 Google Font 并在 DOM 和 document.fonts 中注册
 */
export async function loadFontFamily(family: string = DEFAULT_FONT_FAMILY): Promise<void> {
  if (typeof document === 'undefined') return;
  const preset: JournalFontPreset = JOURNAL_FONTS.find((f) => f.family.toLowerCase() === family.toLowerCase()) || {
    id: 'custom',
    name: family,
    family,
    googleFont: family.replace(/ /g, '+'),
    category: 'chinese',
  };

  if (preset.localOnly) {
    loadedFontsCache.add(family);
    return;
  }

  const linkId = `journal-font-${family.toLowerCase().replace(/\s+/g, '-')}`;
  if (!document.getElementById(linkId)) {
    const link = document.createElement('link');
    link.id = linkId;
    link.href = `https://fonts.googleapis.com/css2?family=${preset.googleFont}&display=swap`;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }

  if (loadedFontsCache.has(family)) return;

  const fontSpec = `16px "${family}"`;
  if (document.fonts && document.fonts.check(fontSpec)) {
    loadedFontsCache.add(family);
    return;
  }

  try {
    if (document.fonts) {
      await Promise.race([
        document.fonts.load(fontSpec),
        new Promise((_, reject) => setTimeout(() => reject(new Error('font load timeout')), 3000)),
      ]);
      loadedFontsCache.add(family);
    }
  } catch {
    // 超时后降级使用默认系统字体，不阻断主流程
  }
}

/**
 * 批量预加载所有手账字体预设（在空闲时或初始化时调用）
 */
export function preloadAllJournalFonts(): void {
  if (typeof window === 'undefined') return;
  const families = JOURNAL_FONTS.filter((f) => !f.localOnly).map((f) => f.googleFont).join('&family=');
  if (!families) return;
  const linkId = 'journal-all-fonts-bundle';
  if (!document.getElementById(linkId)) {
    const link = document.createElement('link');
    link.id = linkId;
    link.href = `https://fonts.googleapis.com/css2?family=${families}&display=swap`;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
}
