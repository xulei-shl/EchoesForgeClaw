import type { BorrowerRecordItem } from './types';

/** 常见百家姓库（常见单姓与少量复姓） */
const CHINESE_SURNAMES = [
  '李', '王', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴',
  '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗',
  '梁', '宋', '郑', '谢', '韩', '唐', '冯', '于', '董', '萧',
  '程', '曹', '袁', '邓', '许', '傅', '沈', '曾', '彭', '吕',
  '苏', '卢', '蒋', '蔡', '贾', '丁', '魏', '薛', '叶', '阎',
  '余', '潘', '杜', '戴', '夏', '钟', '汪', '田', '任', '姜',
  '范', '方', '石', '姚', '谭', '廖', '邹', '熊', '金', '陆',
  '郝', '孔', '白', '崔', '康', '毛', '邱', '秦', '江', '史',
  '顾', '侯', '邵', '孟', '龙', '万', '段', '雷', '钱', '汤',
  '尹', '黎', '易', '常', '武', '乔', '贺', '赖', '龚', '文',
  '欧阳', '诸葛', '司马',
];

/** 文雅常见名字用字库（用于随机拼接姓名） */
const CHINESE_GIVEN_NAME_CHARS = [
  '远', '涵', '然', '思', '书', '言', '清', '哲', '舟', '安',
  '南', '语', '乐', '阳', '若', '舒', '彦', '予', '桐', '锦',
  '文', '博', '之', '维', '嘉', '宜', '润', '恒', '宇', '辰',
  '泽', '轩', '浩', '宁', '琛', '逸', '晨', '枫', '临', '渊',
  '初', '寻', '微', '影', '衡', '川', '淮', '越', '竹', '素',
  '华', '峰', '云', '雪', '琳', '菲', '洁', '婷', '欣', '琪',
  '羽', '铭', '凯', '航', '朗', '谦', '正', '景', '齐', '墨',
];

/**
 * 随机生成脱敏借阅人中文姓名
 * - 3 个字姓名（约 75%）：中间字替换为“某”（如“李某远”、“王某涵”）
 * - 2 个字姓名（约 25%）：第二个字替换为“某”（如“张某”、“陈某”）
 * - 4 个字复姓：倒数第二字替换为“某”（如“欧阳某远”）
 */
export function generateRandomMaskedChineseName(excludeNames?: Set<string>): string {
  for (let attempt = 0; attempt < 80; attempt++) {
    const surname = CHINESE_SURNAMES[Math.floor(Math.random() * CHINESE_SURNAMES.length)];
    let name: string;

    if (surname.length > 1) {
      // 复姓（2字）+ 1字尾名 -> 欧阳某远
      const lastChar = CHINESE_GIVEN_NAME_CHARS[Math.floor(Math.random() * CHINESE_GIVEN_NAME_CHARS.length)];
      name = `${surname}某${lastChar}`;
    } else {
      // 单姓（1字）：25% 生成2字姓名，75% 生成3字姓名
      const isTwoChar = Math.random() < 0.25;
      if (isTwoChar) {
        name = `${surname}某`;
      } else {
        const lastChar = CHINESE_GIVEN_NAME_CHARS[Math.floor(Math.random() * CHINESE_GIVEN_NAME_CHARS.length)];
        name = `${surname}某${lastChar}`;
      }
    }

    if (!excludeNames || !excludeNames.has(name)) {
      return name;
    }
  }

  // 极端碰撞兜底
  const fallbackSurname = CHINESE_SURNAMES[Math.floor(Math.random() * CHINESE_SURNAMES.length)];
  return `${fallbackSurname}某`;
}

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

export interface BorrowerFontOption {
  id: string;
  name: string;
  fontFamily: string;
}

/** 8 款复古与手写借阅字体清单（互不重复轮换） */
export const CHINESE_BORROWER_FONTS: readonly BorrowerFontOption[] = [
  { id: 'font-handwriting-hetang', name: '荷塘月色手写体', fontFamily: "'荷塘月色手写体', 'Zhi Mang Xing', cursive" },
  { id: 'font-handwriting-jinnian', name: '今年也要加油鸭', fontFamily: "'今年也要加油鸭', 'Zhi Mang Xing', cursive" },
  { id: 'font-handwriting-feiyang', name: '平方赖江湖飞扬体', fontFamily: "'平方赖江湖飞扬体', 'Zhi Mang Xing', cursive" },
  { id: 'font-handwriting-pingfang', name: '平方乔木体', fontFamily: "'平方乔木体', 'Zhi Mang Xing', cursive" },
  { id: 'font-handwriting-yangrendong', name: '杨任东竹石体', fontFamily: "'杨任东竹石体', 'Zhi Mang Xing', cursive" },
  { id: 'font-handwriting-yansiyuan', name: '余思源颜黄体', fontFamily: "'余思源颜黄体', 'Zhi Mang Xing', cursive" },
  { id: 'font-handwriting-yunfeng', name: '云峰寒蝉体', fontFamily: "'云峰寒蝉体', 'Zhi Mang Xing', cursive" },
  { id: 'font-handwriting-cn', name: '钟齐志莽行书', fontFamily: "'钟齐志莽行书', 'Zhi Mang Xing', cursive" },
] as const;

/**
 * 随机生成一组互不重复的借阅人手写字体序列
 */
export function generateDistinctFontClasses(count: number): string[] {
  let pool = [...CHINESE_BORROWER_FONTS].sort(() => 0.5 - Math.random());
  const result: string[] = [];

  for (let i = 0; i < count; i++) {
    if (pool.length === 0) {
      pool = [...CHINESE_BORROWER_FONTS].sort(() => 0.5 - Math.random());
    }
    result.push(pool.pop()!.id);
  }

  return result;
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

  // 随机挑选不重复的姓名（中文动态生成脱敏姓名，英文从名单抽取）
  const pickedEnglish = [...ENGLISH_NAMES].sort(() => 0.5 - Math.random());
  const usedChineseNames = new Set<string>();

  // 提前生成各行互不重复的手写字体序列
  const fontSequence = generateDistinctFontClasses(count);

  const records: BorrowerRecordItem[] = [];

  for (let i = 0; i < count; i++) {
    const isCn = Math.random() < 0.85;
    let name: string;
    if (isCn) {
      name = generateRandomMaskedChineseName(usedChineseNames);
      usedChineseNames.add(name);
    } else {
      name = pickedEnglish.pop() || 'Reader';
    }

    const dateStr = formatDate(new Date(timestamps[i]));
    const rotation = ROTATION_CLASSES[randomInt(0, ROTATION_CLASSES.length - 1)];
    const fontClass = isCn ? fontSequence[i] : 'font-handwriting-en';

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

