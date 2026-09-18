/**
 * Mascot 吉祥物配置与常量定义
 */

export interface MascotCharacter {
  id: string;
  name: string;
  category: 'animals' | 'people' | 'gadgets' | 'styles';
}

export const DEFAULT_MASCOT_ID = 'fox';

export const MASCOT_POSITION_STORAGE_KEY = 'canvas_mascot_widget_pos_v2';
export const MASCOT_CHARACTER_STORAGE_KEY = 'canvas_mascot_character_v1';
export const MASCOT_AGENT_WORKSPACE_STORAGE_KEY = 'canvas_mascot_agent_active_workspace_v1';

export const MASCOT_CATEGORIES: { id: string; name: string }[] = [
  { id: 'all', name: '全部' },
  { id: 'animals', name: '萌宠动物' },
  { id: 'people', name: '人物职业' },
  { id: 'gadgets', name: '奇趣器械' },
  { id: 'styles', name: '艺术变体' },
];

/** 57 种可用角色列表（含 52 独立角色及艺术变体） */
export const MASCOT_CHARACTERS: MascotCharacter[] = [
  // 动物族群
  { id: 'fox', name: '小狐狸', category: 'animals' },
  { id: 'cat', name: '小猫咪', category: 'animals' },
  { id: 'panda', name: '大熊猫', category: 'animals' },
  { id: 'otter', name: '小水獭', category: 'animals' },
  { id: 'bunny', name: '小兔子', category: 'animals' },
  { id: 'bear', name: '棕熊熊', category: 'animals' },
  { id: 'dino', name: '小恐龙', category: 'animals' },
  { id: 'koala', name: '考拉仔', category: 'animals' },
  { id: 'frog', name: '小青蛙', category: 'animals' },
  { id: 'penguin', name: '小企鹅', category: 'animals' },
  { id: 'tiger', name: '小脑斧', category: 'animals' },
  { id: 'sheep', name: '卷卷羊', category: 'animals' },
  { id: 'deer', name: '斑比鹿', category: 'animals' },
  { id: 'owl', name: '猫头鹰', category: 'animals' },
  { id: 'raccoon', name: '小浣熊', category: 'animals' },
  { id: 'redpanda', name: '小红熊猫', category: 'animals' },
  { id: 'hamster', name: '胖仓鼠', category: 'animals' },
  { id: 'hedgehog', name: '小刺猬', category: 'animals' },
  { id: 'pug', name: '巴哥犬', category: 'animals' },
  { id: 'sloth', name: '树懒宝', category: 'animals' },

  // 人物职业
  { id: 'nurse', name: '小护士', category: 'people' },
  { id: 'astronaut', name: '宇航员', category: 'people' },
  { id: 'wizard', name: '魔法师', category: 'people' },
  { id: 'knight', name: '铁甲骑士', category: 'people' },
  { id: 'pirate', name: '海盗船长', category: 'people' },
  { id: 'scientist', name: '大科学家', category: 'people' },
  { id: 'chef', name: '星级大厨', category: 'people' },
  { id: 'builder', name: '工程师', category: 'people' },
  { id: 'scout', name: '童子军', category: 'people' },
  { id: 'skater', name: '滑板手', category: 'people' },
  { id: 'ballerina', name: '芭蕾舞者', category: 'people' },
  { id: 'grandpa', name: '慈祥爷爷', category: 'people' },
  { id: 'granny', name: '和蔼奶奶', category: 'people' },
  { id: 'glasses', name: '眼镜达人', category: 'people' },
  { id: 'beard', name: '大胡子叔', category: 'people' },
  { id: 'bald', name: '智慧光头', category: 'people' },
  { id: 'afro', name: '爆炸头帅哥', category: 'people' },
  { id: 'cap', name: '鸭舌帽小哥', category: 'people' },
  { id: 'hijabi', name: '头巾友人', category: 'people' },
  { id: 'sikh', name: '包头行者', category: 'people' },
  { id: 'kamran', name: '原作者卡姆兰', category: 'people' },

  // 奇趣器械与道具
  { id: 'gearbot', name: '齿轮机器人', category: 'gadgets' },
  { id: 'postbot', name: '邮差机器人', category: 'gadgets' },
  { id: 'drone', name: '巡航无人机', category: 'gadgets' },
  { id: 'crt', name: '复古CRT屏', category: 'gadgets' },
  { id: 'tv', name: '老式电视机', category: 'gadgets' },
  { id: 'radio', name: '古董收音机', category: 'gadgets' },
  { id: 'rocket', name: '冲天火箭', category: 'gadgets' },
  { id: 'toaster', name: '跳式烤面包机', category: 'gadgets' },
  { id: 'lantern', name: '中式古风灯笼', category: 'gadgets' },
  { id: 'cube', name: '幻彩魔方', category: 'gadgets' },
  { id: 'clockwork', name: '发条机械', category: 'gadgets' },

  // 艺术风格变体
  { id: 'fox-ink', name: '狐狸 (东方水墨)', category: 'styles' },
  { id: 'fox-paper', name: '狐狸 (传统剪纸)', category: 'styles' },
  { id: 'fox-pixel', name: '狐狸 (复古像素)', category: 'styles' },
  { id: 'fox-riso', name: '狐狸 (孔版印刷)', category: 'styles' },
  { id: 'fox-sketch', name: '狐狸 (铅笔素描)', category: 'styles' },
];

/** 获取对应角色的精灵图路径 */
export function getMascotAssetPaths(characterId: string): { directions: string; reactions: string } {
  const safeId = MASCOT_CHARACTERS.some((c) => c.id === characterId) ? characterId : DEFAULT_MASCOT_ID;
  return {
    directions: `/mascots/${safeId}-directions.webp`,
    reactions: `/mascots/${safeId}-reactions.webp`,
  };
}
