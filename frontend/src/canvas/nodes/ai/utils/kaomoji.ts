/**
 * 精选高兼容性、俏皮可爱的颜文字候选池（跨平台字符集安全，不折行）
 */
export const KAOMOJI_PRESETS = [
  '(｡•ㅅ•｡)',
  "('•_•')",
  '(¬‿¬)',
  '(•‿•)',
  '(*¯︶¯*)',
  '(•̀ᴗ•́)و',
  '( ¯꒳¯ )',
  '( ˘ω˘ )',
  '( ⊙_⊙)',
  '(•̀ω•́ )',
  '( ˙▿˙ )',
  '( ˘･з･)',
  '(=^･ω･^=)',
  '( ˘ ³˘)',
  '(๑•̀ㅂ•́)و',
  '(ง •_•)ง',
] as const;

/**
 * 随机抽取一个颜文字
 */
export function getRandomKaomoji(): string {
  const idx = Math.floor(Math.random() * KAOMOJI_PRESETS.length);
  return KAOMOJI_PRESETS[idx];
}

/**
 * 根据确定性种子（如消息 ID 或轮次索引）计算稳定颜文字
 */
export function getStableKaomoji(seed: string | number): string {
  if (typeof seed === 'number') {
    return KAOMOJI_PRESETS[Math.abs(seed) % KAOMOJI_PRESETS.length];
  }
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return KAOMOJI_PRESETS[Math.abs(hash) % KAOMOJI_PRESETS.length];
}
