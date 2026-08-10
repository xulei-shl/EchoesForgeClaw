import api from './api';
import type {
  AppSetting,
  AppSettingPayload,
  FastClawAgentConfig,
  FastClawAgentConfigPayload,
  LLMConfig,
  LLMConfigPayload,
  PromptTemplate,
  PromptTemplatePayload,
  StageConfig,
  StageConfigPayload,
  User,
  UserPayload,
} from '../types';

/** 管理后台 API（均需管理员权限，接口层 403 兜底） */
export const adminService = {
  /* ---------------- 用户管理 ---------------- */

  listUsers: (): Promise<User[]> => api.get<User[], User[]>('/users'),
  createUser: (payload: UserPayload): Promise<User> =>
    api.post<User, User>('/users', payload),
  updateUser: (userId: number | string, payload: Partial<UserPayload>): Promise<User> =>
    api.patch<User, User>(`/users/${userId}`, payload),
  deleteUser: (userId: number | string): Promise<{ message: string }> =>
    api.delete(`/users/${userId}`),

  /* ---------------- 模型配置 ---------------- */

  listLlmConfigs: (): Promise<LLMConfig[]> =>
    api.get<LLMConfig[], LLMConfig[]>('/admin/llm-configs'),
  createLlmConfig: (payload: LLMConfigPayload): Promise<LLMConfig> =>
    api.post<LLMConfig, LLMConfig>('/admin/llm-configs', payload),
  updateLlmConfig: (id: number, payload: Partial<LLMConfigPayload>): Promise<LLMConfig> =>
    api.patch<LLMConfig, LLMConfig>(`/admin/llm-configs/${id}`, payload),
  deleteLlmConfig: (id: number): Promise<{ message: string }> =>
    api.delete(`/admin/llm-configs/${id}`),

  /* ---------------- FastClaw Agent 配置 ---------------- */

  listFastClawAgents: (): Promise<FastClawAgentConfig[]> =>
    api.get<FastClawAgentConfig[], FastClawAgentConfig[]>('/admin/fastclaw-agents'),
  createFastClawAgent: (payload: FastClawAgentConfigPayload): Promise<FastClawAgentConfig> =>
    api.post<FastClawAgentConfig, FastClawAgentConfig>('/admin/fastclaw-agents', payload),
  updateFastClawAgent: (id: number, payload: Partial<FastClawAgentConfigPayload>): Promise<FastClawAgentConfig> =>
    api.patch<FastClawAgentConfig, FastClawAgentConfig>(`/admin/fastclaw-agents/${id}`, payload),
  deleteFastClawAgent: (id: number): Promise<{ message: string }> =>
    api.delete(`/admin/fastclaw-agents/${id}`),

  /* ---------------- 提示词模板 ---------------- */

  listPrompts: (params?: { module?: string; stage?: string }): Promise<PromptTemplate[]> =>
    api.get<PromptTemplate[], PromptTemplate[]>('/admin/prompts', { params }),
  createPrompt: (payload: PromptTemplatePayload): Promise<PromptTemplate> =>
    api.post<PromptTemplate, PromptTemplate>('/admin/prompts', payload),
  updatePrompt: (id: number, payload: Partial<PromptTemplatePayload>): Promise<PromptTemplate> =>
    api.patch<PromptTemplate, PromptTemplate>(`/admin/prompts/${id}`, payload),
  deletePrompt: (id: number): Promise<{ message: string }> =>
    api.delete(`/admin/prompts/${id}`),

  /* ---------------- 阶段绑定 ---------------- */

  listStageConfigs: (params?: { module?: string }): Promise<StageConfig[]> =>
    api.get<StageConfig[], StageConfig[]>('/admin/stage-configs', { params }),
  upsertStageConfig: (payload: StageConfigPayload): Promise<StageConfig> =>
    api.post<StageConfig, StageConfig>('/admin/stage-configs', payload),
  updateStageConfig: (id: number, payload: Partial<StageConfigPayload>): Promise<StageConfig> =>
    api.patch<StageConfig, StageConfig>(`/admin/stage-configs/${id}`, payload),
  deleteStageConfig: (id: number): Promise<{ message: string }> =>
    api.delete(`/admin/stage-configs/${id}`),

  /* ---------------- 系统设置 ---------------- */

  listSettings: (): Promise<AppSetting[]> =>
    api.get<AppSetting[], AppSetting[]>('/admin/settings'),
  createSetting: (payload: AppSettingPayload): Promise<AppSetting> =>
    api.post<AppSetting, AppSetting>('/admin/settings', payload),
  updateSetting: (key: string, payload: { value?: string; description?: string }): Promise<AppSetting> =>
    api.put<AppSetting, AppSetting>(`/admin/settings/${encodeURIComponent(key)}`, payload),
  deleteSetting: (key: string): Promise<{ message: string }> =>
    api.delete(`/admin/settings/${encodeURIComponent(key)}`),
};

export default adminService;
