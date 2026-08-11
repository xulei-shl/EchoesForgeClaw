import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../types';
import { authService } from '../services/auth';
import { streamControllers, analysisUploads } from './useCanvasState';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (username: string, password?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState(true);
  // 上一会话用户 id：登出 / 切换账号（不登出直接换号登录）时中止画布模块的全部进行中流。
  // 画布页在路由切换 / 登出时会被卸载，组件内「user?.id 变更」effect 不一定执行；流若继续在
  // 后台完成，会以新会话身份保存历史记录（跨用户污染），故在 auth 层统一兜底。
  const lastUserIdRef = useRef<string | null>(null);
  const applySessionUser = useCallback((next: User | null) => {
    const nextId = next?.id != null ? String(next.id) : null;
    if (lastUserIdRef.current !== nextId) {
      lastUserIdRef.current = nextId;
      streamControllers.current.forEach((controller) => controller.abort());
      streamControllers.current.clear();
      analysisUploads.current.clear();
    }
    setUser(next);
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem('token');
      const storedUser = localStorage.getItem('user');
      if (storedToken && storedUser) {
        try {
          applySessionUser(JSON.parse(storedUser));
          setToken(storedToken);
          // 实际应用中可能需要向后端验证 token
        } catch (e) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      }
      setIsLoading(false);
    };

    initAuth();
  }, [applySessionUser]);

  const login = async (username: string, password?: string) => {
    try {
      const res = await authService.login(username, password);
      setToken(res.token);
      applySessionUser(res.user);
      localStorage.setItem('token', res.token);
      localStorage.setItem('user', JSON.stringify(res.user));
    } catch (error) {
      throw error;
    }
  };

  const logout = async () => {
    try {
      await authService.logout();
    } finally {
      setToken(null);
      applySessionUser(null);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
