import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../platform/stores/authStore';
import { Button } from '../../platform/components/ui/Button';
import { Input } from '../../platform/components/ui/Input';

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  // 优先取 401 跳转前记录的来源页，其次取路由 state
  const from =
    sessionStorage.getItem('redirectAfterLogin') ||
    (location.state as any)?.from?.pathname ||
    '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('请输入用户名');
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      await login(username, password);
      sessionStorage.removeItem('redirectAfterLogin');
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err?.message || err?.detail || '登录失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative">
      {/* 纸张网格背景装饰 */}
      <div className="absolute inset-0 pointer-events-none grid-paper opacity-50">
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <h2 className="mt-6 text-center text-3xl font-serif font-extrabold text-ink">
          登录 BookForge
        </h2>
        <p className="mt-2 text-center text-sm text-ink-light font-sans">
          开始您的阅读推广素材创作之旅
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-node-bg py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-dashed border-paper-grid relative">
          
          {/* 左侧活页孔装饰 */}
          <div className="absolute left-[-26px] top-6 bottom-6 w-4 paper-holes"></div>

          <form className="space-y-6 ml-4" onSubmit={handleSubmit}>
            <Input
              label="用户名"
              id="username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="例如: admin"
            />

            <Input
              label="密码"
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="可选"
            />

            {error && (
              <div className="text-error text-sm font-sans">{error}</div>
            )}

            <div>
              <Button type="submit" className="w-full" isLoading={isLoading}>
                登录
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
