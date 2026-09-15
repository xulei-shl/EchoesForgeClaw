/**
 * Mascot 吉祥物配置与常量定义
 */

export interface MascotCharacter {
  id: string;
  name: string;
  category?: string;
}

export const DEFAULT_MASCOT_ID = 'fox';

export const MASCOT_POSITION_STORAGE_KEY = 'canvas_mascot_widget_pos_v1';
export const MASCOT_CHARACTER_STORAGE_KEY = 'canvas_mascot_character_v1';

/** 57 种可用角色列表（含 52 独立角色及艺术变体） */
export const MASCOT_CHARACTERS: MascotCharacter[] = [
  { id: 'fox', name: '小狐狸' },
  { id: 'cat', name: '小猫' },
  { id: 'panda', name: '大熊猫' },
  { id: 'otter', name: '水獭' },
  { id: 'bunny', name: '小兔子' },
  { id: 'bear', name: '小熊' },
  { id: 'dino', name: '小恐龙' },
  { id: 'koala', name: '考拉' },
  { id: 'frog', name: '小青蛙' },
  { id: 'penguin', name: '小企鹅' },
  { id: 'tiger', name: '小老虎' },
  { id: 'sheep', name: '绵羊' },
  { id: 'deer', name: '小鹿' },
  { id: 'owl', name: '猫头鹰' },
  { id: 'raccoon', name: '浣熊' },
  { id: 'redpanda', name: '小熊猫' },
  { id: 'hamster', name: '仓鼠' },
  { id: 'hedgehog', name: '小刺猬' },
  { id: 'pug', name: '八哥犬' },
  { id: 'sloth', name: '树懒' },
  { id: 'astronaut', name: '宇航员' },
  { id: 'wizard', name: '魔法师' },
  { id: 'knight', name: '骑士' },
  { id: 'pirate', name: '海盗' },
  { id: 'scientist', name: '科学家' },
  { id: 'chef', name: '大厨' },
  { id: 'nurse', name: '护士' },
  { id: 'builder', name: '建造师' },
  { id: 'scout', name: '侦察员' },
  { id: 'skater', name: '滑板手' },
  { id: 'gearbot', name: '齿轮机器人' },
  { id: 'postbot', name: '邮递机器人' },
  { id: 'drone', name: '无人机' },
  { id: 'crt', name: 'CRT复古屏' },
  { id: 'tv', name: '电视机' },
  { id: 'radio', name: '收音机' },
  { id: 'rocket', name: '小火箭' },
  { id: 'toaster', name: '面包机' },
  { id: 'lantern', name: '灯笼' },
  { id: 'cube', name: '魔方立方体' },
  { id: 'grandpa', name: '老爷爷' },
  { id: 'granny', name: '老奶奶' },
  { id: 'glasses', name: '眼镜伙伴' },
  { id: 'beard', name: '大胡子' },
  { id: 'bald', name: '光头先生' },
  { id: 'afro', name: '爆炸头' },
  { id: 'cap', name: '棒球帽' },
  { id: 'ballerina', name: '芭蕾舞者' },
  { id: 'hijabi', name: '头巾伙伴' },
  { id: 'sikh', name: '包头伙伴' },
  { id: 'clockwork', name: '发条发条' },
  { id: 'kamran', name: '卡姆兰' },
  { id: 'fox-ink', name: '狐狸 (水墨)' },
  { id: 'fox-paper', name: '狐狸 (剪纸)' },
  { id: 'fox-pixel', name: '狐狸 (像素)' },
  { id: 'fox-riso', name: '狐狸 (孔版印刷)' },
  { id: 'fox-sketch', name: '狐狸 (素描)' },
];

/** 获取对应角色的精灵图路径 */
export function getMascotAssetPaths(characterId: string): { directions: string; reactions: string } {
  const safeId = MASCOT_CHARACTERS.some((c) => c.id === characterId) ? characterId : DEFAULT_MASCOT_ID;
  return {
    directions: `/mascots/${safeId}-directions.webp`,
    reactions: `/mascots/${safeId}-reactions.webp`,
  };
}
