import api from './api';
import type { BifrostFolder, BifrostPrompt, CachedBifrostSkill } from '../types';

export const bifrostService = {
  /** 提示词文件夹列表（白名单过滤后） */
  listFolders: (params?: { force?: boolean }): Promise<{ folders: BifrostFolder[] }> =>
    api.get<{ folders: BifrostFolder[] }, { folders: BifrostFolder[] }>(
      '/modules/bookplate/bifrost/folders',
      { params }
    ),

  /** 提示词列表（支持文件夹过滤、关键字搜索、分页、强制穿透 TTL 缓存） */
  listPrompts: (params?: {
    folder_id?: string;
    q?: string;
    skip?: number;
    limit?: number;
    force?: boolean;
  }): Promise<{ prompts: BifrostPrompt[]; total: number }> =>
    api.get<{ prompts: BifrostPrompt[]; total: number }, { prompts: BifrostPrompt[]; total: number }>(
      '/modules/bookplate/bifrost/prompts',
      { params, timeout: 20000 }
    ),

  /** 单个提示词详情（富化当前用户的 user_rating 与 user_note） */
  getPrompt: (promptId: string): Promise<BifrostPrompt> =>
    api.get<BifrostPrompt, BifrostPrompt>(
      `/modules/bookplate/bifrost/prompts/${encodeURIComponent(promptId)}`
    ),

  /** 检索 Bifrost Skills 仓库（共享区本地缓存优先 + 远端合并浏览，支持分页与 force 刷新） */
  listSkills: (params?: {
    q?: string;
    skip?: number;
    limit?: number;
    force?: boolean;
  }): Promise<{ skills: CachedBifrostSkill[]; total: number; remote_available: boolean }> =>
    api.get<{ skills: CachedBifrostSkill[]; total: number; remote_available: boolean }, { skills: CachedBifrostSkill[]; total: number; remote_available: boolean }>(
      '/modules/bookplate/skills/bifrost-search',
      { params, timeout: 30000 }
    ),

  /** 获取单个 Bifrost Skill 详情（SKILL.md 正文 + 文件树 + 用户打标备注） */
  getSkillDetail: (name: string): Promise<CachedBifrostSkill> =>
    api.get<CachedBifrostSkill, CachedBifrostSkill>(
      `/modules/bookplate/skills/bifrost/${encodeURIComponent(name)}`,
      { timeout: 15000 }
    ),

  /** 打包下载单个 Bifrost Skill ZIP 文件 */
  downloadSkillZip: async (name: string): Promise<void> => {
    const blob = await api.get<Blob, Blob>(
      `/modules/bookplate/skills/bifrost/${encodeURIComponent(name)}/download`,
      { responseType: 'blob' as any, timeout: 60000 }
    );
    const url = URL.createObjectURL(blob as unknown as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

export default bifrostService;
