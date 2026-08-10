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
  module: string;
  stage: string;
  content: string;
  is_active: boolean;
  created_at: string;
}

export interface PromptTemplatePayload {
  name: string;
  module: string;
  stage: string;
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

export interface StageConfig {
  id: number;
  module: string;
  stage: string;
  llm_config_id: number | null;
  prompt_id: number | null;
  agent_config_id: number | null;
  llm_config_name: string | null;
  prompt_name: string | null;
  agent_config_name: string | null;
  /** 绑定 agent 的 FastClaw 真实名字（如 "Xulei"） */
  agent_config_agent_name?: string | null;
  created_at: string;
}

export interface StageConfigPayload {
  module: string;
  stage: string;
  llm_config_id: number | null;
  prompt_id: number | null;
  agent_config_id: number | null;
}

/** bookplate 各阶段生效模式（前端据此决定画布节点调用方式与展示） */
export interface StageEffectiveMode {
  mode: 'llm' | 'agent';
  agent_name?: string | null;
}

export interface BookplateEffectiveConfig {
  stage2: StageEffectiveMode;
  'stage2.cover': StageEffectiveMode;
  stage3: StageEffectiveMode;
}

export interface AppSetting {
  id: number;
  key: string;
  value: string;
  description: string;
  updated_at: string;
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
