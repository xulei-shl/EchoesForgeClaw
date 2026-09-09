/**
 * 轻量级条形码（Code 128 变体 / 标准条形码）纯前端生成模块
 *
 * 零外部依赖，输出 Canvas 绘制与 SVG Data URI，
 * 适用于小票底部 ISBN、馆藏借阅号及防伪条形码展示。
 */

// Code 128 常用模式表（每位表示 11 个模块宽度中的黑白条宽度序列）
// 简化高容错模式：支持数字及常规 ASCII 字母
const CODE128_PATTERNS: Record<number, string> = {
  0: '11011001100', 1: '11001101100', 2: '11001100110', 3: '10010011000', 4: '10010001100',
  5: '10001001100', 6: '10011001000', 7: '10011000100', 8: '10001100100', 9: '11001001000',
  10: '11001000100', 11: '11000100100', 12: '10110011100', 13: '10011011100', 14: '10011001110',
  15: '10111001100', 16: '10011101100', 17: '10011100110', 18: '11001110010', 19: '11001011100',
  20: '11001001110', 21: '11011100100', 22: '11001110100', 23: '11101101110', 24: '11101001100',
  25: '11100101100', 26: '11100100110', 27: '11101100100', 28: '11100110100', 29: '11100110010',
  30: '11011011000', 31: '11011000110', 32: '11000110110', 33: '10100011000', 34: '10001011000',
  35: '10001000110', 36: '10110001000', 37: '10001101000', 38: '10001100010', 39: '11010001000',
  40: '11000101000', 41: '11000100010', 42: '10110111000', 43: '10110001110', 44: '10001101110',
  45: '10111011000', 46: '10111000110', 47: '10001110110', 48: '11101110110', 49: '11010001110',
  50: '11000101110', 51: '11011101000', 52: '11011100010', 53: '11011101110', 54: '11101011000',
  55: '11101000110', 56: '11100010110', 57: '11101101000', 58: '11101100010', 59: '11100011010',
  60: '11101111010', 61: '11001000010', 62: '11110001010', 63: '10100110000', 64: '10100001100',
  65: '10010110000', 66: '10010000110', 67: '10000101100', 68: '10000100110', 69: '10110010000',
  70: '10110000100', 71: '10011010000', 72: '10011000010', 73: '10000110100', 74: '10000110010',
  75: '11000010010', 76: '11001010000', 77: '11110111010', 78: '11000010100', 79: '10001111010',
  80: '10100111100', 81: '10010111100', 82: '10010011110', 83: '10111100100', 84: '10011110100',
  85: '10011110010', 86: '11110100100', 87: '11110010100', 88: '11110010010', 89: '11011011110',
  90: '11011110110', 91: '11110110110', 92: '10101111000', 93: '10100011110', 94: '10001011110',
  95: '10111101000', 96: '10111100010', 97: '11110101000', 98: '11110100010', 99: '10111011110',
  100: '10111101110', 101: '11101011110', 102: '11110101110', 103: '11010000100', 104: '11010010000',
  105: '11010011100', 106: '1100011101011', // STOP 符
};

const START_B = 104; // Code 128 Set B 起始符

/**
 * 将文本编码为 0/1 条码模块字符串
 */
export function encodeToCode128Bits(text: string): string {
  const clean = text.replace(/[^A-Za-z0-9\-._ ]/g, '') || '9787020002207';
  const codes: number[] = [START_B];

  for (let i = 0; i < clean.length; i++) {
    const charCode = clean.charCodeAt(i);
    // ASCII 32 ~ 127 映射到 Code 128 Set B 码值 (0 ~ 95)
    if (charCode >= 32 && charCode <= 126) {
      codes.push(charCode - 32);
    }
  }

  // 计算校验码 Checksum
  let checksum = codes[0];
  for (let i = 1; i < codes.length; i++) {
    checksum += codes[i] * i;
  }
  checksum %= 103;
  codes.push(checksum);
  codes.push(106); // Stop 符

  // 拼接模块比特串
  return codes.map((c) => CODE128_PATTERNS[c] || CODE128_PATTERNS[0]).join('');
}

/**
 * 在指定 Canvas 上绘制高精度条形码
 */
export function drawBarcodeToCanvas(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  color = '#000000',
  showText = true
): void {
  const bits = encodeToCode128Bits(text);
  const totalModules = bits.length;
  const moduleWidth = width / totalModules;
  const barHeight = showText ? height - 16 : height;

  ctx.fillStyle = color;

  for (let i = 0; i < totalModules; i++) {
    if (bits[i] === '1') {
      const barX = Math.floor(x + i * moduleWidth);
      const nextBarX = Math.floor(x + (i + 1) * moduleWidth);
      ctx.fillRect(barX, y, Math.max(1, nextBarX - barX), barHeight);
    }
  }

  if (showText) {
    ctx.font = `600 ${Math.max(11, Math.min(14, Math.round(height * 0.28)))}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;
    ctx.fillText(text, x + width / 2, y + barHeight + 3);
  }
}

/**
 * 生成条形码 SVG Data URI
 */
export function createBarcodeSvgUri(text: string, color = '#1E232A'): string {
  const bits = encodeToCode128Bits(text);
  const totalModules = bits.length;
  const height = 48;
  const width = totalModules * 2;

  let rects = '';
  for (let i = 0; i < totalModules; i++) {
    if (bits[i] === '1') {
      rects += `<rect x="${i * 2}" y="0" width="2" height="${height}" fill="${color}"/>`;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + 16}" width="${width}" height="${height + 16}">
    ${rects}
    <text x="${width / 2}" y="${height + 12}" font-family="monospace" font-size="12" font-weight="600" text-anchor="middle" fill="${color}">${text}</text>
  </svg>`;

  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
