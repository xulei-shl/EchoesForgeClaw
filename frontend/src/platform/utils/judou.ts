/**
 * 古籍排版与句读解析通用工具库 (Judou Ancient Typography Utilities)
 *
 * 核心功能：
 * 1. 阿拉伯数字转古代中文数字（支持整数、小数、大数）
 * 2. 古籍句读解析与标点清洗（将标点规范为朱圈/朱点，过滤现代括号、引号等）
 * 3. 古籍流式排版 Token 序列生成
 */

const NUM_MAP = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/**
 * 将整数字符串转换为中文大写/汉字数字（内部算法）
 */
function toZhDigit(digitStr: string): string {
  const unit = ['千', '百', '十', ''];
  const quot = ['万', '亿', '兆', '京', '垓'];

  let breakLen = Math.ceil(digitStr.length / 4);
  let notBreakSegment = digitStr.length % 4 || 4;
  let segment: string;
  const zeroFlag: string[] = [];
  const allZeroFlag: string[] = [];
  let result = '';

  while (breakLen > 0) {
    if (!result) {
      // 第一次执行（高位分段）
      segment = digitStr.slice(0, notBreakSegment);
      const segmentLen = segment.length;
      for (let i = 0; i < segmentLen; i++) {
        const val = Number(segment[i]);
        if (val !== 0) {
          if (zeroFlag.length > 0) {
            result += '零' + NUM_MAP[val] + unit[4 - segmentLen + i];
            if (i === segmentLen - 1 && breakLen > 1) {
              result += quot[breakLen - 2];
            }
            zeroFlag.length = 0;
          } else {
            result += NUM_MAP[val] + unit[4 - segmentLen + i];
            if (i === segmentLen - 1 && breakLen > 1) {
              result += quot[breakLen - 2];
            }
          }
        } else {
          if (segmentLen === 1) {
            result += NUM_MAP[val];
            break;
          }
          zeroFlag.push(segment[i]);
        }
      }
    } else {
      segment = digitStr.slice(notBreakSegment, notBreakSegment + 4);
      notBreakSegment += 4;

      for (let j = 0; j < segment.length; j++) {
        const val = Number(segment[j]);
        if (val !== 0) {
          if (zeroFlag.length > 0) {
            if (j === 0) {
              result += quot[breakLen - 1] + NUM_MAP[val] + unit[j];
            } else {
              result += '零' + NUM_MAP[val] + unit[j];
            }
            zeroFlag.length = 0;
          } else {
            result += NUM_MAP[val] + unit[j];
          }
          if (j === segment.length - 1 && breakLen > 1) {
            result += quot[breakLen - 2];
          }
        } else {
          if (j === 0 && zeroFlag.length > 0 && allZeroFlag.length === 0) {
            result += quot[breakLen - 1];
            zeroFlag.length = 0;
            zeroFlag.push(segment[j]);
          } else if (allZeroFlag.length > 0) {
            if (breakLen === 1) {
              result += '';
            } else {
              zeroFlag.length = 0;
            }
          } else {
            zeroFlag.push(segment[j]);
          }

          if (j === segment.length - 1 && zeroFlag.length === 4 && breakLen !== 1) {
            if (breakLen === 1) {
              allZeroFlag.length = 0;
              zeroFlag.length = 0;
              result += quot[breakLen - 1];
            } else {
              allZeroFlag.push(segment[j]);
            }
          }
        }
      }
    }
    --breakLen;
  }

  // 针对 "一十" 开头的习惯优化为 "十"（如 12 -> 十二，而不是 一十二）
  if (result.startsWith('一十')) {
    result = result.slice(1);
  }

  return result || '零';
}

const NUM_REGEX = /^(\d+)(\.\d+)?$/;

/**
 * 将阿拉伯数字转为规范古籍汉字数字
 * 例如: 2026 -> 二千零二十六, 12 -> 十二, 3.14 -> 三点一四
 */
export function numToChinese(num: number | string): string {
  const str = String(num).trim();
  if (!NUM_REGEX.test(str)) {
    return str;
  }
  if (str === '0') return '零';

  const match = str.match(NUM_REGEX);
  if (!match) return str;

  const integerPart = match[1];
  const decimalPart = match[2] ? match[2].slice(1) : '';

  let result = toZhDigit(integerPart);
  if (decimalPart) {
    result += '点';
    for (let i = 0; i < decimalPart.length; i++) {
      result += NUM_MAP[Number(decimalPart[i])] || decimalPart[i];
    }
  }
  return result;
}

/**
 * 将一段文本中的所有阿拉伯数字替换为中文数字
 */
export function replaceNumbersToChinese(text: string): string {
  return text.replace(/(-?\d+)(\.\d+)?/g, (match) => {
    const n = Number(match);
    return isNaN(n) ? match : numToChinese(n);
  });
}

export type JudouType = 'circle' | 'dot'; // circle: 朱圈(句号/叹号/问号), dot: 朱点(逗号/顿号/分号)

export interface JudouToken {
  /** 字符（汉字、标点转换后的字等；换行符用 '\n' 表示） */
  char: string;
  /** 是否附带古籍句读朱批 */
  judou?: JudouType;
  /** 是否为段落换行标记 */
  isBreak?: boolean;
}

export interface ParseJudouOptions {
  /** 是否自动将阿拉伯数字转为中文，默认为 true */
  convertNumbers?: boolean;
  /** 是否保留自然换行换列，默认为 true */
  preserveLineBreaks?: boolean;
}

/**
 * 古籍标点符号与句读分词核心解析器
 *
 * 规则：
 * 1. 可选先将阿拉伯数字转换为中文汉字；
 * 2. 现代引号（“”‘’"''）、书名号（《》〈〉）、括号（（）[]【】）等古籍中不存在的标点自动略过；
 * 3. 停顿标点（，、；：,;）转换为上一字符的「朱点（dot）」；
 * 4. 结句标点（。！？!?）转换为上一字符的「朱圈（circle）」；
 * 5. 自动去除连续冗余句读；
 * 6. 支持换行符转化为折行 Token。
 */
export function parseJuDou(text: string, options: ParseJudouOptions = {}): JudouToken[] {
  const { convertNumbers = true, preserveLineBreaks = true } = options;

  let raw = (text || '').trim();
  if (convertNumbers) {
    raw = replaceNumbersToChinese(raw);
  }

  const tokens: JudouToken[] = [];
  const chars = Array.from(raw);

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];

    // 处理换行
    if (c === '\n' || c === '\r') {
      if (preserveLineBreaks) {
        // 避免连续多个多余空行
        if (tokens.length > 0 && !tokens[tokens.length - 1].isBreak) {
          tokens.push({ char: '\n', isBreak: true });
        }
      }
      continue;
    }

    if (c === ' ' || c === '\t') {
      continue;
    }

    // 结句断句标点 -> 朱圈
    if (/[。！？!?]/.test(c)) {
      if (tokens.length > 0 && !tokens[tokens.length - 1].isBreak) {
        tokens[tokens.length - 1].judou = 'circle';
      }
      continue;
    }

    // 语暂停顿标点 -> 朱点
    if (/[，、；：,;:]/.test(c)) {
      if (tokens.length > 0 && !tokens[tokens.length - 1].isBreak) {
        // 若之前已有朱圈，不降级为朱点
        if (tokens[tokens.length - 1].judou !== 'circle') {
          tokens[tokens.length - 1].judou = 'dot';
        }
      }
      continue;
    }

    // 现代无用辅助标点（引号、括号、书名号、破折号、省略号等）忽略不入古籍正文
    if (/[“”"‘’'《》〈〉（）()\[\]【】——…·\-_~]/.test(c)) {
      continue;
    }

    // 正规字符（汉字、西文字母等）
    tokens.push({ char: c });
  }

  return tokens;
}
