import api from './api';
import type {
  AppSetting,
  AppSettingPayload,
  BifrostFolder,
  BifrostPrompt,
  FastClawAgentConfig,
  FastClawAgentConfigPayload,
  LLMConfig,
  LLMConfigPayload,
  LLMKind,
  NodeConfig,
  NodeConfigPayload,
  PromptTemplate,
  PromptTemplatePayload,
  SkillAgentConfig,
  SkillAgentConfigPayload,
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
  /** 连通性测试：传 id 用库中保存的 Key，不传则用请求体里的三要素（新建前验证） */
  testLlmConfig: (payload: {
    id?: number;
    kind?: LLMKind;
    api_key?: string;
    base_url?: string;
    model_name?: string;
  }): Promise<{ ok: boolean; message: string }> =>
    api.post<{ ok: boolean; message: string }, { ok: boolean; message: string }>(
      '/admin/llm-configs/test',
      payload,
      // 测试需要真实调用远端，放宽默认 10s 超时
      { timeout: 60000 }
    ),

  /* ---------------- FastClaw Agent 配置 ---------------- */

  listFastClawAgents: (): Promise<FastClawAgentConfig[]> =>
    api.get<FastClawAgentConfig[], FastClawAgentConfig[]>('/admin/fastclaw-agents'),
  createFastClawAgent: (payload: FastClawAgentConfigPayload): Promise<FastClawAgentConfig> =>
    api.post<FastClawAgentConfig, FastClawAgentConfig>('/admin/fastclaw-agents', payload),
  updateFastClawAgent: (id: number, payload: Partial<FastClawAgentConfigPayload>): Promise<FastClawAgentConfig> =>
    api.patch<FastClawAgentConfig, FastClawAgentConfig>(`/admin/fastclaw-agents/${id}`, payload),
  deleteFastClawAgent: (id: number): Promise<{ message: string }> =>
    api.delete(`/admin/fastclaw-agents/${id}`),
  duplicateFastClawAgent: (id: number): Promise<FastClawAgentConfig> =>
    api.post<FastClawAgentConfig, FastClawAgentConfig>(`/admin/fastclaw-agents/${id}/duplicate`),

  /* ---------------- Skill Agent 配置 ---------------- */

  listSkillAgentConfigs: (): Promise<SkillAgentConfig[]> =>
    api.get<SkillAgentConfig[], SkillAgentConfig[]>('/admin/skill-agent-configs'),
  createSkillAgentConfig: (payload: SkillAgentConfigPayload): Promise<SkillAgentConfig> =>
    api.post<SkillAgentConfig, SkillAgentConfig>('/admin/skill-agent-configs', payload),
  updateSkillAgentConfig: (id: number, payload: Partial<SkillAgentConfigPayload>): Promise<SkillAgentConfig> =>
    api.patch<SkillAgentConfig, SkillAgentConfig>(`/admin/skill-agent-configs/${id}`, payload),
  deleteSkillAgentConfig: (id: number): Promise<{ message: string }> =>
    api.delete(`/admin/skill-agent-configs/${id}`),
  duplicateSkillAgentConfig: (id: number): Promise<SkillAgentConfig> =>
    api.post<SkillAgentConfig, SkillAgentConfig>(`/admin/skill-agent-configs/${id}/duplicate`),

  /* ---------------- 提示词模板 ---------------- */

  listPrompts: (params?: { node_type?: string }): Promise<PromptTemplate[]> =>
    api.get<PromptTemplate[], PromptTemplate[]>('/admin/prompts', { params }),
  createPrompt: (payload: PromptTemplatePayload): Promise<PromptTemplate> =>
    api.post<PromptTemplate, PromptTemplate>('/admin/prompts', payload),
  updatePrompt: (id: number, payload: Partial<PromptTemplatePayload>): Promise<PromptTemplate> =>
    api.patch<PromptTemplate, PromptTemplate>(`/admin/prompts/${id}`, payload),
  deletePrompt: (id: number): Promise<{ message: string }> =>
    api.delete(`/admin/prompts/${id}`),

  /* ---------------- 节点配置（节点管理） ---------------- */

  listNodeConfigs: (params?: { node_type?: string }): Promise<NodeConfig[]> =>
    api.get<NodeConfig[], NodeConfig[]>('/admin/node-configs', { params }),
  createNodeConfig: (payload: NodeConfigPayload): Promise<NodeConfig> =>
    api.post<NodeConfig, NodeConfig>('/admin/node-configs', payload),
  updateNodeConfig: (id: number, payload: Partial<NodeConfigPayload>): Promise<NodeConfig> =>
    api.patch<NodeConfig, NodeConfig>(`/admin/node-configs/${id}`, payload),
  deleteNodeConfig: (id: number): Promise<{ message: string }> =>
    api.delete(`/admin/node-configs/${id}`),
  /** 批量更新自定义分组排序（同组配置共享序号） */
  reorderNodeGroups: (groups: { group: string; order: number }[]): Promise<{ message: string }> =>
    api.post<{ message: string }, { message: string }>('/admin/node-configs/reorder-groups', { groups }),

  /* ---------------- Bifrost 提示词 ---------------- */

  /** all=true 时返回全部文件夹（不过滤白名单），供配置白名单多选用 */
  listBifrostFolders: (params?: { all?: boolean }): Promise<{ folders: BifrostFolder[] }> =>
    api.get<{ folders: BifrostFolder[] }, { folders: BifrostFolder[] }>('/admin/bifrost/folders', { params }),
  listBifrostPrompts: (params?: { folder_id?: string; q?: string }): Promise<{ prompts: BifrostPrompt[] }> =>
    api.get<{ prompts: BifrostPrompt[] }, { prompts: BifrostPrompt[] }>('/admin/bifrost/prompts', { params }),
  getBifrostPrompt: (promptId: string): Promise<BifrostPrompt> =>
    api.get<BifrostPrompt, BifrostPrompt>(`/admin/bifrost/prompts/${encodeURIComponent(promptId)}`),
  /** 调试：Bifrost 原始响应（raw=true 透传，排查正文提取 / 数据结构问题） */
  getBifrostPromptRaw: (promptId: string): Promise<unknown> =>
    api.get<unknown, unknown>(`/admin/bifrost/prompts/${encodeURIComponent(promptId)}?raw=true`),
  /** 上传 / 更换提示词预览图（multipart，axios 自动设置 boundary） */
  uploadBifrostPreview: (promptId: string, file: File): Promise<{ preview_image: string }> => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ preview_image: string }, { preview_image: string }>(
      `/admin/bifrost/prompts/${encodeURIComponent(promptId)}/preview`,
      form
    );
  },
  deleteBifrostPreview: (promptId: string): Promise<{ preview_image: null }> =>
    api.delete<{ preview_image: null }, { preview_image: null }>(
      `/admin/bifrost/prompts/${encodeURIComponent(promptId)}/preview`
    ),

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
