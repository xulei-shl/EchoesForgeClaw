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
 * 随机生成一组古籍印章（数量 6~14 枚全随机、位置全域散布、大小 18~70px 显著分层、无倾斜旋转）
 * @param count 印章数量，默认随机 6 ~ 14 枚
 */
export function generateRandomSeals(count?: number): ReceiptSealItem[] {
  // 数量全随机：6 ~ 14 枚
  const totalCount = count ?? (Math.floor(Math.random() * 9) + 6);

  // 随机洗牌选取不重复的印章图片
  const shuffledAssets = [...SEAL_ASSETS].sort(() => Math.random() - 0.5);

  // 16 个古籍经典散布区域模型（覆盖正文全域上中下各列）
  const zonePool = [
    {
      name: '迎首章（右上）',
      getCoords: () => ({
        leftPercent: Number((78 + Math.random() * 10).toFixed(1)), // 78% ~ 88%
        topPercent: Number((5 + Math.random() * 10).toFixed(1)), // 5% ~ 15%
        width: Math.round(30 + Math.random() * 12), // 30 ~ 42px
      }),
    },
    {
      name: '右上迎首随形印',
      getCoords: () => ({
        leftPercent: Number((68 + Math.random() * 12).toFixed(1)), // 68% ~ 80%
        topPercent: Number((16 + Math.random() * 10).toFixed(1)), // 16% ~ 26%
        width: Math.round(20 + Math.random() * 12), // 20 ~ 32px
      }),
    },
    {
      name: '右列行间上段印',
      getCoords: () => ({
        leftPercent: Number((70 + Math.random() * 14).toFixed(1)), // 70% ~ 84%
        topPercent: Number((28 + Math.random() * 12).toFixed(1)), // 28% ~ 40%
        width: Math.round(18 + Math.random() * 12), // 18 ~ 30px
      }),
    },
    {
      name: '右列行间名章',
      getCoords: () => ({
        leftPercent: Number((68 + Math.random() * 14).toFixed(1)), // 68% ~ 82%
        topPercent: Number((42 + Math.random() * 14).toFixed(1)), // 42% ~ 56%
        width: Math.round(24 + Math.random() * 14), // 24 ~ 38px
      }),
    },
    {
      name: '右列行间下段印',
      getCoords: () => ({
        leftPercent: Number((72 + Math.random() * 14).toFixed(1)), // 72% ~ 86%
        topPercent: Number((58 + Math.random() * 12).toFixed(1)), // 58% ~ 70%
        width: Math.round(18 + Math.random() * 14), // 18 ~ 32px
      }),
    },
    {
      name: '右下押字大印',
      getCoords: () => ({
        leftPercent: Number((66 + Math.random() * 18).toFixed(1)), // 66% ~ 84%
        topPercent: Number((74 + Math.random() * 13).toFixed(1)), // 74% ~ 87%
        width: Math.round(42 + Math.random() * 16), // 42 ~ 58px
      }),
    },
    {
      name: '中列天头章',
      getCoords: () => ({
        leftPercent: Number((40 + Math.random() * 18).toFixed(1)), // 40% ~ 58%
        topPercent: Number((5 + Math.random() * 11).toFixed(1)), // 5% ~ 16%
        width: Math.round(20 + Math.random() * 14), // 20 ~ 34px
      }),
    },
    {
      name: '中列上中随形章',
      getCoords: () => ({
        leftPercent: Number((36 + Math.random() * 20).toFixed(1)), // 36% ~ 56%
        topPercent: Number((18 + Math.random() * 14).toFixed(1)), // 18% ~ 32%
        width: Math.round(18 + Math.random() * 12), // 18 ~ 30px
      }),
    },
    {
      name: '中列右跨栏大印',
      getCoords: () => ({
        leftPercent: Number((50 + Math.random() * 14).toFixed(1)), // 50% ~ 64%
        topPercent: Number((36 + Math.random() * 16).toFixed(1)), // 36% ~ 52%
        width: Math.round(44 + Math.random() * 18), // 44 ~ 62px
      }),
    },
    {
      name: '中列左跨栏鉴赏大印',
      getCoords: () => ({
        leftPercent: Number((34 + Math.random() * 14).toFixed(1)), // 34% ~ 48%
        topPercent: Number((48 + Math.random() * 18).toFixed(1)), // 48% ~ 66%
        width: Math.round(38 + Math.random() * 18), // 38 ~ 56px
      }),
    },
    {
      name: '中列地头小章',
      getCoords: () => ({
        leftPercent: Number((38 + Math.random() * 20).toFixed(1)), // 38% ~ 58%
        topPercent: Number((72 + Math.random() * 14).toFixed(1)), // 72% ~ 86%
        width: Math.round(20 + Math.random() * 16), // 20 ~ 36px
      }),
    },
    {
      name: '左上藏书名章',
      getCoords: () => ({
        leftPercent: Number((10 + Math.random() * 16).toFixed(1)), // 10% ~ 26%
        topPercent: Number((5 + Math.random() * 13).toFixed(1)), // 5% ~ 18%
        width: Math.round(22 + Math.random() * 16), // 22 ~ 38px
      }),
    },
    {
      name: '左列上中随形印',
      getCoords: () => ({
        leftPercent: Number((12 + Math.random() * 16).toFixed(1)), // 12% ~ 28%
        topPercent: Number((20 + Math.random() * 14).toFixed(1)), // 20% ~ 34%
        width: Math.round(18 + Math.random() * 10), // 18 ~ 28px
      }),
    },
    {
      name: '左列中部题跋名印',
      getCoords: () => ({
        leftPercent: Number((10 + Math.random() * 18).toFixed(1)), // 10% ~ 28%
        topPercent: Number((36 + Math.random() * 16).toFixed(1)), // 36% ~ 52%
        width: Math.round(26 + Math.random() * 14), // 26 ~ 40px
      }),
    },
    {
      name: '左列中下小方印',
      getCoords: () => ({
        leftPercent: Number((12 + Math.random() * 18).toFixed(1)), // 12% ~ 30%
        topPercent: Number((54 + Math.random() * 14).toFixed(1)), // 54% ~ 68%
        width: Math.round(18 + Math.random() * 14), // 18 ~ 32px
      }),
    },
    {
      name: '左下压角巨印',
      getCoords: () => ({
        leftPercent: Number((10 + Math.random() * 16).toFixed(1)), // 10% ~ 26%
        topPercent: Number((72 + Math.random() * 15).toFixed(1)), // 72% ~ 87%
        width: Math.round(52 + Math.random() * 18), // 52 ~ 70px（重器压角大印）
      }),
    },
  ];

  // 随机洗牌区域池
  const shuffledZones = [...zonePool].sort(() => Math.random() - 0.5);

  // 选取前 totalCount 个区域
  const selectedZones = shuffledZones.slice(0, totalCount);

  return selectedZones.map((zone, idx) => {
    const coords = zone.getCoords();
    const src = `/assets/receipt/yin/${shuffledAssets[idx % shuffledAssets.length]}`;
    return {
      id: `seal-${idx + 1}`,
      src,
      name: zone.name,
      leftPercent: coords.leftPercent,
      topPercent: coords.topPercent,
      width: coords.width,
      rotate: 0, // 无倾斜旋转效果
      opacity: Number((0.6 + Math.random() * 0.28).toFixed(2)), // 0.60 ~ 0.88
    };
  });
}
