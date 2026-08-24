export interface User {
  id: number | string;
  username: string;
  role?: 'admin' | 'user';
  is_active?: boolean;
  created_at?: string;
  avatar?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ApiError {
  message: string;
  code?: string;
  status?: number;
}

/** Agent 中间步骤（FastClaw 事件归一化后的展示形态，持久化到历史记录） */
export interface AgentStep {
  type: 'agent_tool_call' | 'agent_tool_result' | 'agent_status';
  id?: string;
  name?: string;
  arguments?: string;
  result?: string;
  message?: string;
}

/** 生成记录各阶段结果（image_generation 节点为 stage1/2/3 结构；其他节点类型由各自保存方定义） */
export interface GenerationStageResults {
  stage1?: {
    isbn?: string;
    /** 豆瓣元数据快照 */
    metadata?: Record<string, any>;
  };
  stage2?: {
    prompt?: string;
    /** 上游图片分析节点的分析文本 */
    analysis?: string;
    /** Agent 模式中间步骤（持久化，刷新/历史页仍可见） */
    agent_steps?: AgentStep[];
  };
  stage3?: {
    image_url?: string;
    prompt?: string;
    /** Agent 模式中间步骤（持久化，刷新/历史页仍可见） */
    agent_steps?: AgentStep[];
  };
}

/** 历史 / 收藏 / 画廊共用的生成记录 */
export interface Generation {
  id: number;
  /** 产出该结果的节点模板类型（image_generation 等），取代旧 module 维度 */
  node_type: string;
  name: string;
  stage_results: GenerationStageResults;
  /** 最终产物地址（图片/音频/视频等 URL；文本类结果可为空） */
  result_url?: string | null;
  status: string;
  created_at: string;
  is_favorited?: boolean;
  is_public?: boolean;
  /** 公开画廊中分享者的用户名 */
  username?: string | null;
}

export type GalleryMode = 'history' | 'favorites' | 'gallery';

/** 节点类型及其在作用域内的记录数量（类型筛选项） */
export interface NodeTypeCount {
  node_type: string;
  count: number;
}

/** 列表接口的分页响应信封 */
export interface GenerationPage {
  items: Generation[];
  total: number;
  skip: number;
  limit: number;
  /** 当前作用域内各节点类型的记录数量（类型筛选项；不受 keyword/node_type 过滤影响） */
  node_type_counts?: NodeTypeCount[];
}

/* ===================================================================== */
/* 管理后台（Phase 6）类型                                              */
/* ===================================================================== */

/** 模型类型：text（文本）/ multimodal（多模态）/ image（图像）/ video（视频）/ audio（音频） */
export type LLMKind = 'text' | 'multimodal' | 'image' | 'video' | 'audio';

export interface LLMConfig {
  id: number;
  name: string;
  kind: LLMKind;
  base_url: string;
  model_name: string;
  is_active: boolean;
  /** 是否已配置 api_key（api_key 本身永不回传） */
  has_api_key: boolean;
  created_at: string;
}

export interface LLMConfigPayload {
  name: string;
  kind: LLMKind;
  api_key?: string;
  base_url?: string;
  model_name?: string;
  is_active?: boolean;
}

export interface PromptTemplate {
  id: number;
  /** 系统种子身份标识（仅启动写入使用，用户模板为空，只读） */
  key?: string | null;
  name: string;
  /** 所属节点模板类型（text_generation / image_analysis 等） */
  node_type: string;
  content: string;
  is_active: boolean;
  created_at: string;
}

export interface PromptTemplatePayload {
  name: string;
  node_type: string;
  content: string;
  is_active?: boolean;
}

export interface FastClawAgentConfig {
  id: number;
  name: string;
  /** FastClaw agent 真实名字（如 "Xulei"），拉取选择/懒解析回填后可用 */
  agent_name?: string;
  base_url: string;
  agent_id: string;
  is_active: boolean;
  /** 是否已配置 api_key（api_key 本身永不回传） */
  has_api_key: boolean;
  created_at: string;
}

export interface FastClawAgentConfigPayload {
  name: string;
  agent_name?: string;
  base_url?: string;
  api_key?: string;
  agent_id?: string;
  is_active?: boolean;
}

export interface SkillAgentConfig {
  id: number;
  name: string;
  /** 引用的「模型配置」（url/key/model 全部复用之） */
  llm_config_id: number | null;
  /** 引用的「提示词模板」（作为系统提示词，可空） */
  prompt_id: number | null;
  /** 引用的「绘图模型配置」（kind='image'，可空 = 不启用绘图工具） */
  image_llm_config_id: number | null;
  llm_config_name?: string | null;
  prompt_name?: string | null;
  image_llm_config_name?: string | null;
  /** 展示用（引用解析或旧字段回退） */
  base_url: string;
  model_name: string;
  system_prompt: string;
  is_active: boolean;
  /** 是否已配置 api_key（api_key 本身永不回传） */
  has_api_key: boolean;
  created_at: string;
}

export interface SkillAgentConfigPayload {
  name: string;
  llm_config_id?: number | null;
  prompt_id?: number | null;
  image_llm_config_id?: number | null;
  is_active?: boolean;
}

/* ===================================================================== */
/* 节点画板（Phase 6 重构）                                              */
/* ===================================================================== */

/** 节点模板类型（bookplate 模块） */
export type CanvasNodeType =
  | 'book_info'
  | 'image_analysis'
  | 'text_generation'
  | 'image_generation'
  /** 文本节点：手动编辑 Markdown 文本（无需配置） */
  | 'text'
  /** 图片上传节点：手动上传一张图片（无需配置） */
  | 'image_upload'
  /** AI 对话节点：多轮对话 AI 助手（可配置绑定 LLM / Agent） */
  | 'chat'
  /** 文本聚合节点：用占位符模板把多个上级文本按自定义格式拼接（无需配置，纯文本变换） */
  | 'text_aggregate'
  /** 提示词检索节点：从 Bifrost 提示词库检索并选用一条提示词，输出其内容为文本（无需配置） */
  | 'prompt_search'
  /** Skill 检索节点：从 Bifrost Skills 仓库检索并安装 skill（或上传本地 zip），作为 Skill Agent 的 skill 来源 */
  | 'skill_search'
  /** 万年历节点：查询指定日期的节假日与农历万年历（无需配置） */
  | 'calendar'
  /** 天气查询节点：查询指定城市当前天气，可连线文本节点传入城市（无需配置） */
  | 'weather'
  /** 城市地图海报节点：搜索城市并生成地图海报图片（多模态工具，浏览器端渲染导出，无需配置） */
  | 'map_poster'
  /** 图片检索节点：检索 Unsplash / Pixabay 免版权图片并选一张作为图片输出（多模态工具，无需配置） */
  | 'image_search'
  /** 艺术图片检索节点：聚合 13 家博物馆开放图片 API，关键词检索或随机浏览并选一张作为图片输出（GLAM 工具，无需配置） */
  | 'art_image_search'
  /** 知乎检索节点：知乎开发者平台 3 类检索（站内搜索 / 全网搜索 / 直答），结果以文本输出（文本工具，无需配置） */
  | 'zhihu_search'
  /** Wikipedia 检索节点：Wikipedia 官方公开词条检索 + 文章全文，结果以文本输出（文本工具，匿名无需密钥） */
  | 'wikipedia_search'
  /** 文本翻译节点：Google 翻译 / DeepLX 多引擎翻译，支持随机源与自动降级（文本工具） */
  | 'text_translation'
  /** 网络搜索节点：知乎全网 / Tavily / Exa / 豆包等多源网络检索 */
  | 'web_search'
  /** 图书小票生成节点：热敏纸风格小票、借书卡、古籍排版等书目推荐卡片（多模态工具） */
  | 'receipt_printer'
  /** 图书卡片节点：书目元数据与封面填入 HTML 推广卡片模板，浏览器端截图为图片输出（多模态工具） */
  | 'book_card'
  /** 邮票截图框节点：锯齿邮票框自由截取，生成带打孔边缘与边框的邮票图片（多模态工具） */
  | 'stamp_cutter'
  /** 贴纸制作节点：一键抠图移除背景，生成带白边描边与投影的 die-cut 贴纸图片（多模态工具） */
  | 'sticker_maker'
  /** 手账制作节点：多图拼贴排版（拖移/缩放/旋转/图层/随机布局），合成整张手账页图片（多模态工具） */
  | 'journal_maker'
  /** 文本成图节点：输入文字并调整字体/字号/颜色/横竖排/描边与背景，渲染为图片输出（多模态工具，无需配置） */
  | 'text_image'
  /** 艺术地图生成节点：基于 prettymaps 服务端生成艺术风格地图图片（多模态工具） */
  | 'map_art'
  /** 中国传统纹样检索节点：100 款传统纹样分类浏览/关键词检索/随机浏览（多模态工具） */
  | 'pattern_search'
  /** 中国传统配色节点：742 款中国传统色检索/分类浏览/5色调色板生成器 */
  | 'color_search'
  /** 湿油彩效果节点：图片合成带颜料厚度与湿润高光的湿油彩效果 */
  | 'oil_paint'
  /** 图片处理节点：噪点 / ASCII / 网点 / 抖动（多模态工具） */
  | 'image_process';

/**
 * 节点端口类型（输入/输出）：text / image 为当前实际使用的类型，
 * document / audio / video 为未来节点预留，any 表示任意类型（如 AI 对话的任意上级内容）。
 * 类型契约由后端 node_types.py 模板声明（唯一权威），经 node-registry 下发前端做连线校验。
 */
export type NodePortType = 'text' | 'image' | 'document' | 'audio' | 'video' | 'any';

/** AI 对话节点的一条消息 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 是否正在流式输出（展示打字光标） */
  streaming?: boolean;
  /**
   * 首条 user 消息携带的上下文（图书元数据 + 上级节点内容），UI 不展示；
   * 发送时经 toWireChatMessages 展开进 content，随每轮完整历史重发（LLM 模式多轮可见）。
   */
  context?: string;
  /**
   * 本轮用户附带发送的图片（data URL），随消息展示在气泡内，发送时随请求透传。
   */
  images?: string[];
  /**
   * 首条 user 消息携带的上下文图片（上级图片节点的输出，data URL），UI 不展示；
   * 发送时经 toWireChatMessages 并入 images，随每轮完整历史重发（LLM 模式多轮可见）。
   */
  contextImages?: string[];
  /** 注入的结构化上下文块（按上级节点分别独立展示，折叠卡片渲染） */
  contextBlocks?: InjectedContextBlock[];
  /** 该轮回复被用户主动停止（保留已流出的部分，展示「重试」入口） */
  interrupted?: boolean;
  /**
   * 该轮回复的思考过程（模型 reasoning 推理文本，DeepSeek 等端点）。
   * 与回答正文分开存储：UI 折叠展示，不并入 content、不随多轮历史回传。
   */
  reasoning?: string;
  /** Agent 模式中间步骤（工具调用 / 思考状态），附加在 assistant 消息上 */
  agentSteps?: AgentStep[];
  /** Skill Agent 执行产生的文件（agent_file 事件），渲染为下载/预览卡片 */
  files?: AgentFile[];
}

/** 注入 AI 对话节点的单项上下文块（由各上级节点或图书元数据生成） */
export interface InjectedContextBlock {
  id: string;
  title: string;
  nodeType?: CanvasNodeType;
  text?: string;
  images?: string[];
}

/** AI 对话节点的上下文加载设置（节点内可开关） */
export interface ChatNodeSettings {
  /** 加载连线上游图书元数据作为上下文（无连通时取画布根节点） */
  includeBook: boolean;
  /** 加载紧随的上一级节点内容作为上下文 */
  includeUpstream: boolean;
  /**
   * 加载紧随上级节点的图片输出（图片上传 / 图像生成节点）作为上下文；
   * 默认开启：旧节点持久化的设置未含该字段，undefined 视为开启。
   */
  includeUpstreamImages?: boolean;
  /**
   * 随图书元数据注入封面图作为视觉上下文（镜像图片分析节点的封面传递）；
   * 仅当 includeBook 开启且封面可用时生效。默认开启：undefined 视为开启。
   */
  includeBookCover?: boolean;
  /**
   * 节点内手动选择的模型名（服务商 /models 列表，默认 = 节点配置的默认模型）；
   * 仅 LLM 模式生效。undefined = 跟随节点配置。
   */
  modelOverride?: string;
  /**
   * 节点内手动选择的 FastClaw Agent 配置 id（全部启用 agent 列表，默认 = 节点配置绑定的 Agent）；
   * 仅 Agent 模式生效。undefined = 跟随节点配置。
   */
  agentOverride?: number;
}

/** 可执行节点（图片分析 / 提示词生成 / 图像生成）的运行设置（节点内可开关） */
export interface NodeRunSettings {
  /** 包含图书元数据：未直接连线时，优先注入连线上游图书元数据，无连通时注入画布根节点 */
  includeBook: boolean;
  /**
   * 随图书元数据注入封面图作为图生图参考（与 AI 对话节点同口径，仅当 includeBook 开启且封面可用时生效）。
   * 默认开启：旧节点持久化的设置未含该字段，undefined 视为开启。
   */
  includeBookCover?: boolean;
  /** 图像生成节点专属：输出尺寸（如 1K/2K/3K/4K；未设置不上送，由模型/服务端决定） */
  imageSize?: string;
  /** 图像生成节点专属：宽高比（如 1:1/16:9；未设置不上送） */
  imageRatio?: string;
  /**
   * 节点内手动选择的模型名（服务商 /models 列表，默认 = 节点配置的默认模型）；
   * 仅 LLM 模式生效。undefined = 跟随节点配置。
   */
  modelOverride?: string;
}

/** 节点模板（后端 node_types.py 定义，经 node-registry 下发） */
export interface NodeTemplate {
  type: CanvasNodeType;
  name: string;
  description: string;
  /** 模板类别：input（输入）/ analysis（分析）/ generate（生成）/ output（输出）/ tool（文本工具）/ multimodal（多模态工具）/ glam（GLAM 工具） */
  category: 'input' | 'analysis' | 'generate' | 'output' | 'tool' | 'multimodal' | 'glam';
  /** 是否需要 llm/agent 配置（false 为基础节点，画板直接可用） */
  configurable: boolean;
  /** 输出类型：该模板产出什么（连线类型匹配校验用） */
  output_type?: NodePortType;
  /**
   * 复合输出类型：一个模板可同时产出多种类型（如纹样节点同时输出图片与文本），
   * 连线类型匹配按「命中任一」判断；缺省时等于 [output_type]。
   */
  output_types?: NodePortType[];
  /** 接受的输入类型列表：连线类型匹配校验用（空 = 不接受上游输入） */
  input_types?: NodePortType[];
}

/** 节点配置（节点模板的一个具体可执行实例 = 画板「+」菜单中的节点变体） */
export interface NodeConfig {
  id: number;
  node_type: CanvasNodeType;
  name: string;
  /** 可选自定义分组（画板「+」菜单分组展示）；空值按模板类型分组 */
  group?: string | null;
  /** 自定义分组排序序号（同组共享；0 表示未排序，按首见顺序回退） */
  group_order?: number;
  llm_config_id: number | null;
  prompt_id: number | null;
  agent_config_id: number | null;
  skill_agent_config_id: number | null;
  llm_config_name: string | null;
  prompt_name: string | null;
  agent_config_name: string | null;
  skill_agent_config_name: string | null;
  /** 绑定 agent 的 FastClaw 真实名字（如 "Xulei"） */
  agent_config_agent_name?: string | null;
  is_active: boolean;
  created_at: string;
}

export interface NodeConfigPayload {
  node_type: CanvasNodeType;
  name: string;
  group?: string | null;
  llm_config_id: number | null;
  prompt_id: number | null;
  agent_config_id: number | null;
  skill_agent_config_id: number | null;
  is_active?: boolean;
}

/** 节点注册表（画板「+」菜单数据源） */
export interface NodeRegistry {
  templates: NodeTemplate[];
  /** 启用的节点配置变体（含生效模式与可读名） */
  configs: RegistryNodeConfig[];
}

export interface RegistryNodeConfig {
  id: number;
  node_type: CanvasNodeType;
  name: string;
  /** 可选自定义分组（画板「+」菜单分组展示） */
  group?: string | null;
  /** 自定义分组排序序号 */
  group_order?: number;
  mode: 'llm' | 'agent' | 'skill_agent';
  agent_name?: string | null;
  skill_agent_config_name?: string | null;
  llm_config_name?: string | null;
  is_active: boolean;
}

export interface AppSetting {
  id: number;
  key: string;
  value: string;
  description: string;
  updated_at: string;
  /** 敏感设置项（如 API Key）：值为掩码，明文永不回传；留空保存表示不修改 */
  sensitive?: boolean;
}

export interface AppSettingPayload {
  key: string;
  value: string;
  description: string;
}

/** 管理后台创建/修改用户的请求体 */
export interface UserPayload {
  username: string;
  password: string;
  role: 'admin' | 'user';
  is_active: boolean;
}

/* ===================================================================== */
/* 用户通用标注（打标 1-5 星与私有备注）                                     */
/* ===================================================================== */

export interface UserAnnotation {
  resource_type: 'bifrost_prompt' | 'bifrost_skill';
  resource_id: string;
  rating: number;
  note: string;
}

export interface UserAnnotationPayload {
  resource_type: 'bifrost_prompt' | 'bifrost_skill';
  resource_id: string;
  rating?: number;
  note?: string;
}

/* ===================================================================== */
/* Bifrost 提示词（Prompt Repository 代理）                               */
/* ===================================================================== */

/** Bifrost 文件夹（官方数据，经后端代理） */
export interface BifrostFolder {
  id: string;
  name: string;
  description?: string | null;
  prompts_count?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Bifrost 提示词（紧凑结构：正文文本由 latest_version 提取，预览图来自本地元数据） */
export interface BifrostPrompt {
  id: string;
  name: string;
  folder_id: string | null;
  folder_name?: string | null;
  /** 从最新版本 messages 提取的正文文本 */
  content: string;
  /** 本地预览图访问路径（未上传时为 null） */
  preview_image: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  version_number?: number | null;
  commit_message?: string | null;
  /** 当前用户打标星级（1-5，0 为未打标） */
  user_rating?: number;
  /** 当前用户私有备注 */
  user_note?: string;
}

/** 提示词检索节点：选用一条提示词后写入节点的数据 */
export interface PromptSelection {
  promptId: string;
  name?: string;
  content?: string;
  imageUrl?: string | null;
  userRating?: number;
  userNote?: string;
}

/* ===================================================================== */
/* Skill（Skill Agent / Skill 检索节点）                                  */
/* ===================================================================== */

/** 已安装到用户工作区的 skill（含 SKILL.md 元数据 + 文件树） */
export interface InstalledSkill {
  name: string;
  description: string;
  body: string;
  /** 工作区内相对路径（如 skills/my-skill） */
  path: string;
  /** 文件树（相对路径列表） */
  files: string[];
  /** 用户私有备注 / 全局兼容备注 */
  note?: string;
  user_rating?: number;
  user_note?: string;
}

/** Admin 端：Bifrost Skill（本地缓存 + 远端未缓存合并浏览；Bifrost 可达时富化远端版本信息） */
export interface CachedBifrostSkill {
  name: string;
  description: string;
  body: string;
  /** 文件树（相对路径列表；未缓存时为空） */
  files: string[];
  /** 是否已缓存到本地共享区（false = 仅存在于远端仓库，点「同步最新」即可下载缓存） */
  cached?: boolean;
  /** 远端文件数 */
  file_count?: number;
  /** 本地共享包目录修改时间（unix 秒；未缓存时为 null） */
  updated_at?: number | null;
  /** 远端最新版本（Bifrost 可达时富化） */
  latest_version?: string;
  license?: string;
  compatibility?: string;
  remote_updated_at?: string | null;
  /** 用户私有备注 / 全局兼容备注 */
  note?: string;
  user_rating?: number;
  user_note?: string;
}

/** Bifrost Skills 仓库中的 skill（检索结果） */
export interface BifrostSkill {
  id: string;
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  /** SKILL.md 正文（不含 frontmatter） */
  skill_md_body?: string;
  latest_version?: string;
  file_count?: number;
  files?: { path: string }[];
  created_at?: string;
  updated_at?: string;
  /** 用户私有备注 / 全局兼容备注 */
  note?: string;
  user_rating?: number;
  user_note?: string;
}

/** Skill 检索节点：选用一个 skill 后写入节点的数据 */
export interface SkillSelection {
  /** skill 名称（工作区目录名） */
  name: string;
  description?: string;
  /** SKILL.md 正文 */
  body?: string;
  /** 工作区内相对路径（如 skills/my-skill） */
  path?: string;
  /** 文件树（相对路径列表） */
  files?: string[];
  /** 来源：bifrost / upload */
  source?: 'bifrost' | 'upload';
  /** 用户私有备注 */
  note?: string;
  userRating?: number;
  userNote?: string;
}

/** Skill Agent 执行产生的文件（agent_file 事件） */
export interface AgentFile {
  url: string;
  name: string;
  mime: string;
  size: number;
  path: string;
}
