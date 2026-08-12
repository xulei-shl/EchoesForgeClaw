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

/** 生成记录各阶段结果（藏书票模块） */
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
  module: string;
  name: string;
  stage_results: GenerationStageResults;
  final_image_url?: string | null;
  status: string;
  created_at: string;
  is_favorited?: boolean;
  is_public?: boolean;
  /** 公开画廊中分享者的用户名 */
  username?: string | null;
}

export type GalleryMode = 'history' | 'favorites' | 'gallery';

/** 列表接口的分页响应信封 */
export interface GenerationPage {
  items: Generation[];
  total: number;
  skip: number;
  limit: number;
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
  /** 所属节点模板类型（prompt_generation / image_analysis 等） */
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

/* ===================================================================== */
/* 节点画板（Phase 6 重构）                                              */
/* ===================================================================== */

/** 节点模板类型（bookplate 模块） */
export type CanvasNodeType =
  | 'book_info'
  | 'image_analysis'
  | 'prompt_generation'
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
  | 'prompt_search';

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
  /** 该轮回复被用户主动停止（保留已流出的部分，展示「重试」入口） */
  interrupted?: boolean;
  /** Agent 模式中间步骤（工具调用 / 思考状态），附加在 assistant 消息上 */
  agentSteps?: AgentStep[];
}

/** AI 对话节点的上下文加载设置（节点内可开关） */
export interface ChatNodeSettings {
  /** 加载连线上游图书元数据作为上下文（无连通时取画布根节点） */
  includeBook: boolean;
  /** 加载紧随的上一级节点内容作为上下文 */
  includeUpstream: boolean;
}

/** 可执行节点（图片分析 / 提示词生成 / 图像生成）的运行设置（节点内可开关） */
export interface NodeRunSettings {
  /** 包含图书元数据：未直接连线时，优先注入连线上游图书元数据，无连通时注入画布根节点 */
  includeBook: boolean;
  /** 输入就绪时自动运行；关闭则点击「运行」按钮手动执行 */
  autoRun: boolean;
}

/** 节点模板（后端 node_types.py 定义，经 node-registry 下发） */
export interface NodeTemplate {
  type: CanvasNodeType;
  name: string;
  description: string;
  /** 模板类别：input（输入）/ analysis（分析）/ generate（生成）/ output（输出） */
  category: 'input' | 'analysis' | 'generate' | 'output';
  /** 是否需要 llm/agent 配置（false 为基础节点，画板直接可用） */
  configurable: boolean;
  /** 输出类型：该模板产出什么（连线类型匹配校验用） */
  output_type?: NodePortType;
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
  llm_config_name: string | null;
  prompt_name: string | null;
  agent_config_name: string | null;
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
  mode: 'llm' | 'agent';
  agent_name?: string | null;
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
}

/** 提示词检索节点：选用一条提示词后写入节点的数据 */
export interface PromptSelection {
  promptId: string;
  name?: string;
  content?: string;
  imageUrl?: string | null;
}
