/**
 * bookplate 节点模板定义（对应 Python `app/modules/bookplate/node_types.py`）。
 * 节点模板是画板节点类型的静态定义；管理端基于模板创建「节点配置」（NodeConfig）。
 */

export const NODE_TYPES = {
  BOOK_INFO: 'book_info',
  IMAGE_ANALYSIS: 'image_analysis',
  TEXT_GENERATION: 'text_generation',
  IMAGE: 'image_generation',
  TEXT: 'text',
  IMAGE_UPLOAD: 'image_upload',
  CHAT: 'chat',
  TEXT_AGGREGATE: 'text_aggregate',
  PROMPT_SEARCH: 'prompt_search',
  SKILL_SEARCH: 'skill_search',
  CALENDAR: 'calendar',
  WEATHER: 'weather',
  /** 城市地图海报（多模态工具）：浏览器端渲染地图为图片（Leaflet 瓦片 / MapLibre 艺术主题） */
  MAP_POSTER: 'map_poster',
  /** 图片检索（多模态工具）：检索 Unsplash / Pixabay 免版权图片并选一张输出（凭据在系统设置配置） */
  IMAGE_SEARCH: 'image_search',
  /** 艺术图片检索（GLAM 工具）：聚合 13 家博物馆开放图片 API，检索/随机浏览并选一张输出（部分源凭据在系统设置配置） */
  ART_IMAGE_SEARCH: 'art_image_search',
  /** NASA 图片检索（多模态工具）：NASA Images 官方公开图片库（images-api.nasa.gov），图片 / 视频两类关键词检索，公有领域无需凭据 */
  NASA_IMAGE_SEARCH: 'nasa_image_search',
  /** 知乎检索（文本工具）：知乎开发者平台 3 类检索（站内搜索 / 全网搜索 / 直答），结果以文本输出（凭据在 /admin/settings 配置） */
  ZHIHU_SEARCH: 'zhihu_search',
  /** Wikipedia 检索（文本工具）：Wikipedia 官方公开 MediaWiki API 关键词检索 → 文章全文，结果以文本输出（匿名、无需密钥） */
  WIKIPEDIA_SEARCH: 'wikipedia_search',
  /** 文本翻译（文本工具）：Google 翻译 / DeepLX 翻译引擎，支持随机源与自动降级 */
  TEXT_TRANSLATION: 'text_translation',
  /** 网络搜索（文本工具）：知乎全网 / Tavily / Exa / 豆包等多源网络检索 */
  WEB_SEARCH: 'web_search',
  /** 图书小票生成（多模态工具）：生成热敏纸小票、借书卡、古籍排版等书目推荐卡片 */
  RECEIPT_PRINTER: 'receipt_printer',
  /** 图书卡片（多模态工具）：书目元数据 + 封面填入 HTML 模板，浏览器端截图为图片输出 */
  BOOK_CARD: 'book_card',
  /** 邮票截图框（多模态工具）：锯齿邮票框自由截取，生成带打孔边缘与边框的邮票图片 */
  STAMP_CUTTER: 'stamp_cutter',
  /** 艺术地图生成（多模态工具）：基于 prettymaps 服务端生成艺术风格地图图片 */
  MAP_ART: 'map_art',
  /** 中国传统纹样（多模态工具）：100 款中国传统纹样分类浏览/关键词检索/随机浏览，输出纹样图片与说明文本 */
  PATTERN_SEARCH: 'pattern_search',
  /** 中国传统配色（多模态工具）：742 款中国传统色检索/分类浏览/5色调色板生成器，输出色卡图片与配色方案文本 */
  COLOR_SEARCH: 'color_search',
  /** 湿油彩效果（多模态工具）：图片合成带颜料厚度与湿润高光的湿油彩效果 */
  OIL_PAINT: 'oil_paint',
  /** 图片处理（多模态工具）：噪点 / ASCII / 网点 / 抖动等风格化效果 */
  IMAGE_PROCESS: 'image_process',
  /** 贴纸制作（多模态工具）：一键抠图移除背景，生成带白边描边与投影的 die-cut 贴纸图片 */
  STICKER_MAKER: 'sticker_maker',
  /** 手账制作（多模态工具）：多图拼贴排版（拖移/缩放/旋转/图层/随机布局），合成整张手账页图片 */
  JOURNAL_MAKER: 'journal_maker',
  /** 文本成图（多模态工具）：输入文字并调整字体/字号/颜色/横竖排/描边与背景，浏览器端渲染为图片输出 */
  TEXT_IMAGE: 'text_image',
  /** VuFind 索书号（GLAM 工具）：通过 Lightpanda 浏览器自动化从 vufind.library.sh.cn 根据 ISBN 获取索书号 */
  VUFIND_CALL_NUMBER: 'vufind_call_number',
} as const;

export type NodeType = (typeof NODE_TYPES)[keyof typeof NODE_TYPES];

/** 端口类型：text / image / document 为当前实际使用的类型，audio / video 预留，any 表示任意 */
export type NodeOutputPortType = 'text' | 'image' | 'document' | 'audio' | 'video' | 'any';

export interface NodeTemplate {
  type: NodeType;
  name: string;
  description: string;
  category: 'input' | 'analysis' | 'generate' | 'output' | 'tool' | 'multimodal' | 'glam';
  configurable: boolean;
  output_type?: NodeOutputPortType;
  /**
   * 复合输出类型（一个节点可同时产出多种类型，如纹样节点同时输出图片与文本）；
   * 缺省时等于 [output_type]。下游按自身接受的输入类型取用对应输出。
   */
  output_types?: NodeOutputPortType[];
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
    type: NODE_TYPES.TEXT_GENERATION,
    name: 'AI 文本生成',
    description: '基于上游输入流式生成文本内容',
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
    description: '手动输入 / 编辑 Markdown 文本',
    category: 'input',
    configurable: false,
    output_type: 'text',
  },
  {
    type: NODE_TYPES.IMAGE_UPLOAD,
    name: '图片上传',
    description: '手动上传一张图片到画布',
    category: 'input',
    configurable: false,
    output_type: 'image',
  },
  {
    type: NODE_TYPES.CHAT,
    name: 'AI 对话',
    description: '多轮对话 AI 助手，可绑定大模型或 Agent',
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
    description: '从 Bifrost 提示词库检索选用后供下游节点使用',
    category: 'input',
    configurable: false,
    output_type: 'text',
  },
  {
    type: NODE_TYPES.SKILL_SEARCH,
    name: 'Skill 检索',
    description: '从 Bifrost 检索或上传本地 skill zip，传入 Skill Agent',
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
    name: '城市地图海报',
    description: '搜索城市并生成地图海报图片',
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
  {
    type: NODE_TYPES.NASA_IMAGE_SEARCH,
    name: 'NASA 图片检索',
    description: '检索 NASA Images 官方公开图片库（images-api.nasa.gov）：图片 / 视频两类关键词检索，全部公有领域，无需注册与 API Key（可连线文本节点传入关键词）',
    category: 'multimodal',
    configurable: false,
    output_type: 'image',
    input_types: ['text'],
  },
  {
    type: NODE_TYPES.ZHIHU_SEARCH,
    name: '知乎检索',
    description: '知乎开发者平台 3 类检索：站内搜索 / 全网搜索 / 直答问答，结果以文本输出（凭据在管理端「系统设置」配置，可连线文本节点传入关键词 / 问题）',
    category: 'tool',
    configurable: false,
    output_type: 'text',
    input_types: ['text'],
  },
  {
    type: NODE_TYPES.WIKIPEDIA_SEARCH,
    name: 'Wikipedia 检索',
    description: '检索 Wikipedia 官方公开词条并获取全文 / 简介',
    category: 'tool',
    configurable: false,
    output_type: 'text',
    input_types: ['text'],
  },
  {
    type: NODE_TYPES.TEXT_TRANSLATION,
    name: '文本翻译',
    description: 'Google 翻译 / DeepLX 多引擎翻译，支持随机源与自动降级（DeepLX URL 在管理端「系统设置」其他类别配置）',
    category: 'tool',
    configurable: false,
    output_type: 'text',
    input_types: ['text'],
  },
  {
    type: NODE_TYPES.WEB_SEARCH,
    name: '网络搜索',
    description: '知乎全网 / Tavily / Exa / 豆包等多源网络检索',
    category: 'tool',
    configurable: false,
    output_type: 'text',
    input_types: ['text'],
  },
  {
    type: NODE_TYPES.RECEIPT_PRINTER,
    name: '图书小票生成',
    description: '生成热敏纸小票、借书卡、古籍排版等书目推荐卡片',
    category: 'multimodal',
    configurable: false,
    output_type: 'image',
    input_types: ['text', 'image'],
  },
  {
    type: NODE_TYPES.BOOK_CARD,
    name: '图书卡片',
    description: '将元数据与封面图填入 HTML 模板并截图为图片',
    category: 'multimodal',
    configurable: false,
    output_type: 'image',
    input_types: ['text', 'image'],
  },
  {
    type: NODE_TYPES.STAMP_CUTTER,
    name: '邮票截图框',
    description: '锯齿邮票框自由截取，生成带打孔边缘与边框的邮票图片',
    category: 'multimodal',
    configurable: false,
    output_type: 'image',
    input_types: ['image', 'text'],
  },
  {
    type: NODE_TYPES.MAP_ART,
    name: '艺术地图生成',
    description: '基于 prettymaps 服务端生成艺术风格地图图片',
    category: 'multimodal',
    configurable: false,
    output_type: 'image',
    input_types: ['text'],
  },
  {
    type: NODE_TYPES.PATTERN_SEARCH,
    name: '中国传统纹样',
    description: '检索/浏览 100 款中国传统纹样（AI生成版）',
    category: 'multimodal',
    configurable: false,
    output_type: 'image',
    output_types: ['image', 'text'],
    input_types: ['text'],
  },
  {
    type: NODE_TYPES.COLOR_SEARCH,
    name: '中国传统配色',
    description: '检索/浏览 742 款中国传统色，支持 5 色智能调色板生成',
    category: 'multimodal',
    configurable: false,
    output_type: 'image',
    output_types: ['image', 'text'],
    input_types: ['text'],
  },
  {
    type: NODE_TYPES.OIL_PAINT,
    name: '湿油彩效果',
    description: '图片合成带颜料厚度与湿润高光的湿油彩效果',
    category: 'multimodal',
    configurable: false,
    output_type: 'image',
    input_types: ['image', 'text'],
  },
  {
    type: NODE_TYPES.IMAGE_PROCESS,
    name: '图片处理',
    description: '浏览器端 Canvas 多效果图片处理（第一阶段：噪点；后续 ASCII / 网点 / 抖动），效果注册表驱动切换，输出处理结果图片',
    category: 'multimodal',
    configurable: false,
    output_type: 'image',
    input_types: ['image', 'text'],
  },
  {
    type: NODE_TYPES.STICKER_MAKER,
    name: '贴纸制作',
    description: '一键抠图移除背景，生成带白边描边与投影的 die-cut 贴纸图片',
    category: 'multimodal',
    configurable: false,
    output_type: 'image',
    input_types: ['image', 'text'],
  },
  {
    type: NODE_TYPES.JOURNAL_MAKER,
    name: '手账制作',
    description: '多图拼贴排版（拖移/缩放/旋转/图层排序/随机布局），合成图片',
    category: 'multimodal',
    configurable: false,
    output_type: 'image',
    input_types: ['image', 'text'],
  },
  {
    type: NODE_TYPES.TEXT_IMAGE,
    name: '文本成图',
    description: '输入文字并调整字体/字号/颜色等参数，渲染为图片输出',
    category: 'multimodal',
    configurable: false,
    output_type: 'image',
  },
  {
    type: NODE_TYPES.VUFIND_CALL_NUMBER,
    name: 'VuFind 索书号',
    description: '通过 Lightpanda 浏览器自动化从 vufind.library.sh.cn 根据 ISBN 获取索书号，可连线图书元数据节点自动读取 ISBN，也可手动输入',
    category: 'glam',
    configurable: false,
    output_type: 'text',
    input_types: ['text'],
  },
];
