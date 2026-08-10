import api from './api';
import type { Generation, GenerationPage } from '../types';

export interface CreateGenerationPayload {
  module?: string;
  stage_results: Generation['stage_results'];
  final_image_url?: string;
  status?: string;
}

export interface ListGenerationsParams {
  skip?: number;
  limit?: number;
  /** 历史记录可按 module 过滤 */
  module?: string;
  /** 按题名关键词检索 */
  keyword?: string;
}

/** 历史 / 收藏 / 公开画廊 通用 API */
export const generationsService = {
  /** 我的历史记录（分页） */
  listMine: (params?: ListGenerationsParams): Promise<GenerationPage> =>
    api.get<GenerationPage, GenerationPage>('/generations', { params }),

  /** 我的收藏（分页） */
  listFavorites: (params?: ListGenerationsParams): Promise<GenerationPage> =>
    api.get<GenerationPage, GenerationPage>('/favorites', { params }),

  /** 公开画廊（分页） */
  listPublic: (params?: ListGenerationsParams): Promise<GenerationPage> =>
    api.get<GenerationPage, GenerationPage>('/public', { params }),

  /** 保存一次画布生成结果 */
  create: (payload: CreateGenerationPayload): Promise<Generation> =>
    api.post<Generation, Generation>('/generations', payload),

  /** 查询单条生成记录（含当前用户的收藏/公开状态） */
  get: (generationId: number): Promise<Generation> =>
    api.get<Generation, Generation>(`/generations/${generationId}`),

  /** 删除我的生成记录 */
  remove: (generationId: number): Promise<{ message: string }> =>
    api.delete(`/generations/${generationId}`),

  /** 收藏（返回更新后的记录） */
  favorite: (generationId: number): Promise<Generation> =>
    api.post<Generation, Generation>('/favorites', { generation_id: generationId }),

  /** 取消收藏 */
  unfavorite: (generationId: number): Promise<Generation> =>
    api.delete<Generation, Generation>(`/favorites/${generationId}`),

  /** 公开到画廊 */
  share: (generationId: number): Promise<Generation> =>
    api.post<Generation, Generation>('/public', { generation_id: generationId }),

  /** 从画廊撤下 */
  unshare: (generationId: number): Promise<Generation> =>
    api.delete<Generation, Generation>(`/public/${generationId}`),
};

export default generationsService;
