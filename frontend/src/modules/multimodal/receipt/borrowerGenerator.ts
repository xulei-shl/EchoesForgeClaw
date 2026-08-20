import type { BorrowerRecordItem } from './types';

/** 经典中文读者/借阅人名单库（80% 权重） */
const CHINESE_NAMES = [
  '林徽因',
  '徐志摩',
  '金岳霖',
  '钱钟书',
  '杨绛',
  '周树人',
  '沈从文',
  '朱自清',
  '老舍',
  '张爱玲',
  '萧红',
  '冰心',
  '巴金',
  '梁思成',
  '汪曾祺',
  '木心',
  '三毛',
  '戴望舒',
  '郁达夫',
  '卞之琳',
  '丰子恺',
  '胡适',
  '闻一多',
  '茅盾',
  '顾城',
  '海子',
  '北岛',
  '史铁生',
  '王小波',
  '李银河',
];

/** 经典英文读者/借阅人名单库（20% 权重） */
const ENGLISH_NAMES = [
  'A. Doyle',
  'V. Woolf',
  'E. Hemingway',
  'J. Austen',
  'F. Kafka',
  'G. Orwell',
  'O. Wilde',
  'J. Joyce',
  'W. S. Maugham',
  'E. Brontë',
  'C. Dickens',
  'F. S. Fitzgerald',
  'H. Hesse',
  'A. Camus',
  'J. L. Borges',
  'I. Calvino',
  'U. Eco',
  'M. Proust',
];

/** 印章微旋角度样式列表 */
const ROTATION_CLASSES = [
  '',
  'rotate-1',
  '-rotate-2',
  'rotate-2',
  '-rotate-1',
  'rotate-0',
];

/**
 * 判断是否为中文名字
 */
export function isChineseName(name: string): boolean {
  return /[\u4e00-\u9fa5]/.test(name);
}

/**
 * 解析年份数字
 */
function parseYear(yearStr?: string): number {
  if (!yearStr) return new Date().getFullYear() - 3;
  const match = yearStr.match(/\d{4}/);
  if (match) {
    const y = parseInt(match[0], 10);
    if (!isNaN(y) && y > 1900 && y <= new Date().getFullYear()) {
      return y;
    }
  }
  return new Date().getFullYear() - 3;
}

/**
 * 格式化为 YYYY-MM-DD
 */
function formatDate(d: Date): string {
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 生成介于 [min, max] 之间的随机整数
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 随机生成借书卡的借阅记录
 *
 * @param count 生成条数（默认 3~4 条）
 * @param pubYear 图书出版年（作为起始时间基准）
 */
export function generateRandomBorrowerRecords(
  count = 4,
  pubYear?: string
): BorrowerRecordItem[] {
  const startYear = parseYear(pubYear);
  const now = new Date();
  const currentYear = now.getFullYear();

  // 起始日期：出版年后或今年前3年
  const effectiveStartYear = Math.min(startYear, currentYear);
  const startTimestamp = new Date(effectiveStartYear, 0, 1).getTime();
  const endTimestamp = now.getTime();

  // 随机生成 N 个递增的时间戳
  const timestamps: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = startTimestamp + Math.random() * (endTimestamp - startTimestamp);
    timestamps.push(t);
  }
  timestamps.sort((a, b) => a - b);

  // 随机挑选不重复的姓名
  const pickedChinese = [...CHINESE_NAMES].sort(() => 0.5 - Math.random());
  const pickedEnglish = [...ENGLISH_NAMES].sort(() => 0.5 - Math.random());

  const records: BorrowerRecordItem[] = [];

  for (let i = 0; i < count; i++) {
    const isCn = Math.random() < 0.8;
    const name = isCn
      ? pickedChinese.pop() || '某读者'
      : pickedEnglish.pop() || 'Reader';

    const dateStr = formatDate(new Date(timestamps[i]));
    const rotation = ROTATION_CLASSES[randomInt(0, ROTATION_CLASSES.length - 1)];
    const fontClass = isCn ? 'font-handwriting-cn' : 'font-handwriting-en';

    records.push({
      id: `record-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      date: dateStr,
      name,
      rotation,
      fontClass,
    });
  }

  return records;
}
