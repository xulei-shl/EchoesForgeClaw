import api from './api';
import type { AuthResponse, User } from '../types';

export const authService = {
  // api 拦截器已将响应解包为 data，因此第二个泛型参数直接声明返回数据类型
  login: (username: string, password?: string): Promise<AuthResponse> => {
    return api.post<AuthResponse, AuthResponse>('/auth/login', { username, password });
  },
  
  logout: (): Promise<void> => {
    return api.post<void, void>('/auth/logout').catch(() => Promise.resolve());
  },
  
  getCurrentUser: (): Promise<User> => {
    return api.get<User, User>('/users/me');
  }
};
