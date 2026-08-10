import api from './api';
import type { AuthResponse, User } from '../types';

export const authService = {
  // api 拦截器已将响应解包为 data，因此第二个泛型参数直接声明返回数据类型
  login: (username: string, password?: string): Promise<AuthResponse> => {
    return api.post<AuthResponse, AuthResponse>('/auth/login', { username, password })
      .catch((err: any) => {
        // 仅在后端完全不可达时提供 mock（401/422 等业务错误正常抛出）
        if (!err?.response) {
          return new Promise<AuthResponse>((resolve) => {
            setTimeout(() => {
              resolve({
                token: 'mock-token-12345',
                user: {
                  id: '1',
                  username: username,
                }
              });
            }, 500);
          });
        }
        throw err;
      });
  },
  
  logout: (): Promise<void> => {
    return api.post<void, void>('/auth/logout').catch(() => Promise.resolve());
  },
  
  getCurrentUser: (): Promise<User> => {
    return api.get<User, User>('/users/me');
  }
};
