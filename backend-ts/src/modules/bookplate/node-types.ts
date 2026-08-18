/**
 * bookplate 节点模板定义（对应 Python `app/modules/bookplate/node_types.py`）。
 * 节点模板是画板节点类型的静态定义；管理端基于模板创建「节点配置」（NodeConfig）。
 */

export const NODE_TYPES = {
  BOOK_INFO: 'book_info',
  IMAGE_ANALYSIS: 'image_analysis',
  PROMPT: 'prompt_generation',
  IMAGE: 'image_generation',
  TEXT: 'text',
  IMAGE_UPLOAD: 'image_upload',
  CHAT: 'chat',
  TEXT_AGGREGATE: 'text_aggregate',
  PROMPT_SEARCH: 'prompt_search',
  SKILL_SEARCH: 'skill_search',
  CALENDAR: 'calendar',
  WEATHER: 'weather',
  /** 地图海报生成（多模态工具）：浏览器端渲染地图为图片（Leaflet 瓦片 / MapLibre 艺术主题） */
  MAP_POSTER: 'map_poster',
  /** 图片检索（多模态工具）：检索 Unsplash / Pixabay 免版权图片并选一张输出（凭据在系统设置配置） */
  IMAGE_SEARCH: 'image_search',
  /** 艺术图片检索（GLAM 工具）：聚合 12 家博物馆开放图片 API，检索/随机浏览并选一张输出（部分源凭据在系统设置配置） */
  ART_IMAGE_SEARCH: 'art_image_search',
} as const;

export type NodeType = (typeof NODE_TYPES)[keyof typeof NODE_TYPES];

export interface NodeTemplate {
  type: NodeType;
  name: string;
  description: string;
  category: 'input' | 'analysis' | 'generate' | 'output' | 'tool' | 'multimodal' | 'glam';
  configurable: boolean;
  output_type?: 'text' | 'image' | 'document';
  input_types?: string[];
}

export const NODE_TEMPLATES: NodeTemplate[] = [
  {
    type: NODE_TYPES.BOOK_INFO,
    name: '图书元数据',
    description: '通过豆瓣 API 获取 ISBN 对应的图书元数据',
    category: 'input',
    configurable: false,
    output_type: 'text',
  },
  {
    type: NODE_TYPES.IMAGE_ANALYSIS,
    name: '图片分析',
    description: '多模态模型分析封面 / 参考图，输出艺术风格与主题色分析',
    category: 'analysis',
    configurable: true,
    output_type: 'text',
    input_types: ['image', 'text'],
  },
  {
    type: NODE_TYPES.PROMPT,
    name: '提示词生成',
    description: '基于图书元数据与图片分析流式生成图像提示词',
    category: 'generate',
    configurable: true,
    output_type: 'text',
    input_types: ['text'],
  },
  {
    type: NODE_TYPES.IMAGE,
    name: '图像生成',
    description: '根据提示词生成藏书票图片',
    category: 'output',
    configurable: true,
    output_type: 'image',
    input_types: ['text', 'image'],
  },
  {
    type: NODE_TYPES.TEXT,
    name: '文本',
    description: '手动输入 / 编辑 Markdown 文本，作为工作流中的笔记或说明',
    category: 'input',
    configurable: false,
    output_type: 'text',
  },
  {
    type: NODE_TYPES.IMAGE_UPLOAD,
    name: '图片上传',
    description: '手动上传一张图片到画布，作为工作流中的参考素材',
    category: 'input',
    configurable: false,
    output_type: 'image',
  },
  {
    type: NODE_TYPES.CHAT,
    name: 'AI 对话',
    description: '多轮对话 AI 助手，可绑定大模型或 FastClaw Agent，输出最后一轮回复',
    category: 'generate',
    configurable: true,
    output_type: 'text',
    input_types: ['text', 'image', 'document'],
  },
  {
    type: NODE_TYPES.TEXT_AGGREGATE,
    name: '文本聚合',
    description: '用占位符模板把多个上级文本按自定义格式拼接（如 ## 标题 + {占位符}）',
    category: 'tool',
    configurable: false,
    output_type: 'text',
    input_types: ['text'],
  },
  {
    type: NODE_TYPES.PROMPT_SEARCH,
    name: '提示词检索',
    description: '从 Bifrost 提示词库检索并选用一条提示词，将其内容作为文本输出',
    category: 'input',
    configurable: false,
    output_type: 'text',
  },
  {
    type: NODE_TYPES.SKILL_SEARCH,
    name: 'Skill 检索',
    description: '从 Bifrost Skills 仓库检索并安装 skill（或直接上传本地 skill zip），作为 Skill Agent 的 skill 来源',
    category: 'input',
    configurable: false,
    output_type: 'document',
  },
  {
    type: NODE_TYPES.CALENDAR,
    name: '万年历',
    description: '查询指定日期的节假日与农历万年历（MXNZP API，无需配置）',
    category: 'tool',
    configurable: false,
    output_type: 'text',
  },
  {
    type: NODE_TYPES.WEATHER,
    name: '天气查询',
    description: '查询指定城市当前天气（wttr.in，可连线文本节点传入城市，无需配置）',
    category: 'tool',
    configurable: false,
    output_type: 'text',
    input_types: ['text'],
  },
  {
    type: NODE_TYPES.MAP_POSTER,
    name: '地图海报生成',
    description: '搜索地点并生成地图海报图片（Leaflet 瓦片 / MapLibre 艺术主题，浏览器端渲染导出）',
    category: 'multimodal',
    configurable: false,
    output_type: 'image',
  },
  {
    type: NODE_TYPES.IMAGE_SEARCH,
    name: '图片检索',
    description: '检索 Unsplash / Pixabay 免版权图片并选择一张作为图片输出（凭据在管理端「系统设置」配置）',
    category: 'multimodal',
    configurable: false,
    output_type: 'image',
    input_types: ['text'],
  },
  {
    type: NODE_TYPES.ART_IMAGE_SEARCH,
    name: '艺术图片检索',
    description: '聚合 12 家博物馆 / 图书馆开放图片 API（MET / Rijksmuseum / AIC 等），关键词检索或随机浏览并选一张作为图片输出（部分源凭据在管理端「系统设置」配置）',
    category: 'glam',
    configurable: false,
    output_type: 'image',
    input_types: ['text'],
  },
];
