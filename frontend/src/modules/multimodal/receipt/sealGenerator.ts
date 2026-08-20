import type { ReceiptSealItem } from './types';

/**
 * 39 枚古籍印章真迹素材清单
 */
export const SEAL_ASSETS = [
  'm_0068-1.2-22A-2.jpg',
  'm_0068-2.5-6A-4.jpg',
  'm_0068-3.7-12A-4.jpg',
  'm_0640-1-3A-2.jpg',
  'm_0640-1-6B-1.jpg',
  'm_0640-1-6B-2.jpg',
  'm_0640-1-7B-2.jpg',
  'm_0640-2-1B-2.jpg',
  'm_0640-2-3B-1.jpg',
  'm_1224-1-10B-1.jpg',
  'm_1224-1-12B-1.jpg',
  'm_1224-1-28B-1.jpg',
  'm_1224-1-33A-1.jpg',
  'm_1224-1-34B-1.jpg',
  'm_1224-1-39A-1.jpg',
  'm_1224-1-43A-1.jpg',
  'm_1224-1-48B-1.jpg',
  'm_1224-1-4B-1.jpg',
  'm_1224-1-5A-1.jpg',
  'm_1224-1-6B-1.jpg',
  'm_1224-2-26B-1.jpg',
  'm_1224-2-2B-1.jpg',
  'm_1224-2-30B-1.jpg',
  'm_1224-2-38B-1.jpg',
  'm_1224-2-44B-1.jpg',
  'm_1224-2-5A-1.jpg',
  'm_1224-2-9A-1.jpg',
  'm_1251-2-60B-2.jpg',
  'm_1273-1.4-4A-2.jpg',
  'm_1342-1-14A-3.jpg',
  'm_1342-1-5A-1.jpg',
  'm_1342-2-12A-1.jpg',
  'm_1342-3-14A-2.jpg',
  'm_1342-4-1A-1.jpg',
  'm_1342-4-4A-1.jpg',
  'm_1342-4-8A-1.jpg',
  'm_1435-2-21A-2.jpg',
  'm_1467-3-11A-6.jpg',
  'm_1507-3-26A-4.jpg',
];

/**
 * 获取随机印章素材 URL 路径
 */
export function getRandomSealSrc(): string {
  const randomIndex = Math.floor(Math.random() * SEAL_ASSETS.length);
  return `/assets/receipt/yin/${SEAL_ASSETS[randomIndex]}`;
}

/**
 * 随机生成一组古籍印章（数量、位置、大小与角度随机）
 * @param count 印章数量，默认 3~4 枚
 */
export function generateRandomSeals(count?: number): ReceiptSealItem[] {
  const totalCount = count ?? (Math.random() > 0.35 ? 4 : 3);

  // 随机洗牌选取不重复的印章图片
  const shuffledAssets = [...SEAL_ASSETS].sort(() => Math.random() - 0.5);

  const presets: Array<{
    id: string;
    positionPreset: ReceiptSealItem['positionPreset'];
    name: string;
    getDefaults: (src: string) => ReceiptSealItem;
  }> = [
    {
      id: 'seal-1',
      positionPreset: 'top-right',
      name: '引首章',
      getDefaults: (src) => ({
        id: 'seal-1',
        src,
        name: '引首章',
        positionPreset: 'top-right',
        width: Math.round(27 + Math.random() * 6), // 27 ~ 33px
        top: Math.round(20 + Math.random() * 12), // 20 ~ 32px
        right: Math.round(6 + Math.random() * 6), // 6 ~ 12px
        rotate: Number((Math.random() * 4 - 2).toFixed(1)), // -2° ~ +2°
        opacity: Number((0.8 + Math.random() * 0.12).toFixed(2)), // 0.80 ~ 0.92
      }),
    },
    {
      id: 'seal-2',
      positionPreset: 'bottom-left',
      name: '压角章',
      getDefaults: (src) => ({
        id: 'seal-2',
        src,
        name: '压角章',
        positionPreset: 'bottom-left',
        width: Math.round(40 + Math.random() * 8), // 40 ~ 48px
        bottom: Math.round(24 + Math.random() * 12), // 24 ~ 36px
        left: Math.round(4 + Math.random() * 8), // 4 ~ 12px
        rotate: Number((Math.random() * 4 - 2).toFixed(1)), // -2° ~ +2°
        opacity: Number((0.75 + Math.random() * 0.12).toFixed(2)), // 0.75 ~ 0.87
      }),
    },
    {
      id: 'seal-3',
      positionPreset: 'middle-cross',
      name: '鉴赏章',
      getDefaults: (src) => ({
        id: 'seal-3',
        src,
        name: '鉴赏章',
        positionPreset: 'middle-cross',
        width: Math.round(34 + Math.random() * 7), // 34 ~ 41px
        topPercent: Math.round(42 + Math.random() * 12), // 42% ~ 54%
        left: Math.round(-18 + Math.random() * 6), // -18 ~ -12px 跨栏
        rotate: Number((Math.random() * 6 - 3).toFixed(1)), // -3° ~ +3°
        opacity: Number((0.65 + Math.random() * 0.12).toFixed(2)), // 0.65 ~ 0.77
      }),
    },
    {
      id: 'seal-4',
      positionPreset: 'top-left',
      name: '藏书章',
      getDefaults: (src) => ({
        id: 'seal-4',
        src,
        name: '藏书章',
        positionPreset: 'top-left',
        width: Math.round(21 + Math.random() * 5), // 21 ~ 26px
        top: Math.round(68 + Math.random() * 20), // 68 ~ 88px
        left: Math.round(6 + Math.random() * 8), // 6 ~ 14px
        rotate: Number((Math.random() * 4 - 2).toFixed(1)), // -2° ~ +2°
        opacity: Number((0.82 + Math.random() * 0.12).toFixed(2)), // 0.82 ~ 0.94
      }),
    },
  ];

  // 截取前 totalCount 个槽位并赋值
  const selectedPresets = presets.slice(0, totalCount);
  return selectedPresets.map((p, idx) => {
    const src = `/assets/receipt/yin/${shuffledAssets[idx % shuffledAssets.length]}`;
    return p.getDefaults(src);
  });
}
