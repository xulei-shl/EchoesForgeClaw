import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { useAuth } from '../../stores/authStore';
import { Button } from '../ui/Button';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();

  const getNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    `font-sans px-3 py-2 text-sm font-medium rounded-md active:scale-[0.96] transition-all ${
      isActive
        ? 'text-accent bg-accent/5'
        : 'text-ink hover:text-accent hover:bg-ink/5'
    }`;

  const getAdminLinkClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center gap-1.5 font-sans px-3 py-2 text-sm font-medium rounded-md active:scale-[0.96] transition-all ${
      isActive
        ? 'text-accent bg-accent/10'
        : 'text-accent/90 hover:text-accent hover:bg-accent/5'
    }`;

  return (
    <nav className="border-b border-paper-grid/50 bg-paper/80 backdrop-blur-md shadow-sm shadow-ink/5 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center">
            <Link to="/" className="flex items-center gap-2 active:scale-[0.96] transition-transform">
              <img src="/icon.png" alt="BookForge" className="h-7 w-7" />
              <span className="font-serif text-xl font-bold text-ink">BookForge</span>
            </Link>
            <div className="hidden md:flex ml-10 space-x-1">
              <NavLink to="/" end className={getNavLinkClass}>首页</NavLink>
              <NavLink to="/bookplate" className={getNavLinkClass}>藏书票</NavLink>
              {user && (
                <>
                  <NavLink to="/history" className={getNavLinkClass}>历史</NavLink>
                  <NavLink to="/favorites" className={getNavLinkClass}>收藏</NavLink>
                  <NavLink to="/gallery" className={getNavLinkClass}>画廊</NavLink>
                  {user.role === 'admin' && (
                    <NavLink to="/admin/users" className={getAdminLinkClass}>
                      <Settings size={16} strokeWidth={2} />
                      管理后台
                    </NavLink>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            {user ? (
              <>
                <span className="text-sm text-ink-light font-sans">欢迎, {user.username}</span>
                <Button variant="ghost" size="sm" onClick={logout}>退出</Button>
              </>
            ) : (
              <Link to="/login" className="active:scale-[0.96] inline-block transition-transform">
                <Button variant="secondary" size="sm">登录</Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};
