import React from 'react';
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
import {
  Settings,
  Cpu,
  FileText,
  GitBranch,
  Users,
  Bot,
  BookOpen,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../platform/stores/authStore';

const NAV_ITEMS = [
  { to: '/admin/users', label: '用户管理', icon: Users },
  { to: '/admin/llm-configs', label: '模型配置', icon: Cpu },
  { to: '/admin/prompts', label: '提示词管理', icon: FileText },
  { to: '/admin/bifrost-prompts', label: 'Bifrost 提示词', icon: BookOpen },
  { to: '/admin/fastclaw-agents', label: 'Agent 配置', icon: Bot },
  { to: '/admin/node-configs', label: '节点管理', icon: GitBranch },
  { to: '/admin/settings', label: '系统设置', icon: Settings },
];

/** 页面标题映射 */
const TITLE_MAP: Record<string, string> = {
  '/admin/users': '用户管理',
  '/admin/llm-configs': '模型配置',
  '/admin/prompts': '提示词管理',
  '/admin/bifrost-prompts': 'Bifrost 提示词',
  '/admin/node-configs': '节点管理',
  '/admin/fastclaw-agents': 'Agent 配置',
  '/admin/settings': '系统设置',
};

export const AdminLayout: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const title = TITLE_MAP[location.pathname] ?? '管理后台';

  return (
    <div className="min-h-screen bg-paper flex">
      {/* 方格纸背景 */}
      <div className="fixed inset-0 pointer-events-none grid-paper opacity-20" />

      {/* 左侧边栏 240px */}
      <aside className="relative z-10 w-60 shrink-0 border-r border-dashed border-paper-grid bg-node-bg flex flex-col min-h-screen">
        {/* 品牌区 */}
        <div className="px-5 py-5 border-b border-dashed border-paper-grid">
          <div className="flex items-center gap-2.5">
            <img src="/icon.png" alt="BookForge Logo" className="h-9 w-9 rounded-md" />
            <div>
              <p className="font-serif text-base font-semibold text-ink leading-tight">管理后台</p>
              <p className="text-xs text-ink-light font-sans">BookForge Admin</p>
            </div>
          </div>
        </div>

        {/* 导航 */}
        <nav className="flex-1 px-3 py-4 space-y-1" aria-label="管理后台导航">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-sans transition active:scale-[0.97] border border-transparent ${
                  isActive
                    ? 'bg-accent-surface text-accent border-dashed border-accent/40 font-medium'
                    : 'text-ink-light hover:text-ink hover:bg-paper-grid/30'
                }`
              }
            >
              <item.icon size={17} strokeWidth={1.5} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* 底部：用户信息 + 返回 */}
        <div className="px-5 py-4 border-t border-dashed border-paper-grid space-y-3">
          {user && (
            <p className="text-xs text-ink-light font-sans truncate">
              当前管理员：<span className="text-ink font-medium">{user.username}</span>
            </p>
          )}
          <Link
            to="/bookplate"
            className="flex items-center gap-2 text-sm text-ink-light hover:text-accent font-sans transition-colors"
          >
            <ArrowLeft size={15} strokeWidth={1.5} />
            返回创作台
          </Link>
        </div>
      </aside>

      {/* 右侧内容区 */}
      <main className="relative z-10 flex-1 min-w-0 flex flex-col">
        <header className="h-14 border-b border-dashed border-paper-grid bg-paper/70 flex items-center px-6 sticky top-0 backdrop-blur-sm">
          <h1 className="font-serif text-lg font-semibold text-ink">{title}</h1>
        </header>
        <div className="flex-1 w-full max-w-[860px] mx-auto px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;
