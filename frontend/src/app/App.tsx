import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '../platform/stores/authStore';
import { FeedbackProvider } from '../platform/components/ui/FeedbackProvider';
import HomePage from './routes/HomePage';
import LoginPage from './routes/LoginPage';

import BookplatePage from './routes/BookplatePage';
import GenerationListPage from './routes/GenerationListPage';
import AdminLayout from '../admin/AdminLayout';
import UsersPage from '../admin/pages/UsersPage';
import LlmConfigsPage from '../admin/pages/LlmConfigsPage';
import PromptsPage from '../admin/pages/PromptsPage';
import BifrostPromptsPage from '../admin/pages/BifrostPromptsPage';
import NodeConfigsPage from '../admin/pages/NodeConfigsPage';
import FastClawAgentsPage from '../admin/pages/FastClawAgentsPage';
import SkillAgentConfigsPage from '../admin/pages/SkillAgentConfigsPage';
import SettingsPage from '../admin/pages/SettingsPage';

// 路由守卫：未登录时跳转登录页，登录后回到原页面
const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div className="min-h-screen bg-paper flex items-center justify-center">加载中...</div>;
  }

  return user ? <>{children}</> : <Navigate to="/login" replace state={{ from: location }} />;
};

// 管理员路由守卫：非管理员（或未登录）不可进入管理后台
const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div className="min-h-screen bg-paper flex items-center justify-center">加载中...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/bookplate"
        element={
          <PrivateRoute>
            <BookplatePage />
          </PrivateRoute>
        }
      />
      <Route
        path="/history"
        element={
          <PrivateRoute>
            <GenerationListPage mode="history" />
          </PrivateRoute>
        }
      />
      <Route
        path="/favorites"
        element={
          <PrivateRoute>
            <GenerationListPage mode="favorites" />
          </PrivateRoute>
        }
      />
      <Route
        path="/gallery"
        element={
          <PrivateRoute>
            <GenerationListPage mode="gallery" />
          </PrivateRoute>
        }
      />
      {/* 管理后台（仅管理员） */}
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminLayout />
          </AdminRoute>
        }
      >
        <Route index element={<Navigate to="/admin/users" replace />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="llm-configs" element={<LlmConfigsPage />} />
        <Route path="prompts" element={<PromptsPage />} />
        <Route path="bifrost-prompts" element={<BifrostPromptsPage />} />
        <Route path="node-configs" element={<NodeConfigsPage />} />
        <Route path="fastclaw-agents" element={<FastClawAgentsPage />} />
        <Route path="skill-agent-configs" element={<SkillAgentConfigsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <FeedbackProvider>
        <Router>
          <AppRoutes />
        </Router>
      </FeedbackProvider>
    </AuthProvider>
  );
};

export default App;
