import React, { useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '../../shared/stores/authStore';
import { Button } from '../../shared/components/ui/Button';
import { Input } from '../../shared/components/ui/Input';

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  // 优先取 401 跳转前记录的来源页，其次取路由 state
  const from =
    sessionStorage.getItem('redirectAfterLogin') ||
    (location.state as any)?.from?.pathname ||
    '/';

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUsername(e.target.value);
    if (error) setError('');
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    if (error) setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('请输入用户名');
      usernameInputRef.current?.focus();
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      await login(username, password);
      sessionStorage.removeItem('redirectAfterLogin');
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err?.message || err?.detail || '用户名或密码错误');
      // 密码错误时自动聚焦并选中密码输入框，方便用户直接重新输入
      setTimeout(() => {
        passwordInputRef.current?.focus();
        passwordInputRef.current?.select();
      }, 50);
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
              ref={usernameInputRef}
              label="用户名"
              id="username"
              type="text"
              required
              value={username}
              onChange={handleUsernameChange}
              placeholder="例如: admin"
              autoComplete="username"
              className={error && !username.trim() ? '!border-error' : ''}
            />

            <Input
              ref={passwordInputRef}
              label="密码"
              id="password"
              type="password"
              value={password}
              onChange={handlePasswordChange}
              placeholder="可选"
              autoComplete="current-password"
              className={error ? '!border-error/80' : ''}
            />

            {error && (
              <div 
                role="alert"
                aria-live="polite"
                className="login-error-banner flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-error/10 border border-error/25 text-error text-xs font-sans"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-error stroke-[1.75]" />
                <span className="leading-snug">{error}</span>
              </div>
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
