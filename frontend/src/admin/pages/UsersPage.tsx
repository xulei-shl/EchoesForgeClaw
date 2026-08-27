import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
  Users as UsersIcon,
} from 'lucide-react';
import { adminService } from '../../platform/services/admin';
import { useAuth } from '../../platform/stores/authStore';
import type { User } from '../../platform/types';
import { Button } from '../../platform/components/ui/Button';
import { Dialog } from '../../platform/components/ui/Dialog';
import { Input } from '../../platform/components/ui/Input';
import { Select } from '../../platform/components/ui/Select';
import { Toggle } from '../../platform/components/ui/Toggle';
import { Badge } from '../../platform/components/ui/Badge';
import { Card } from '../../platform/components/ui/Card';
import { FieldLabel, PageHeader } from '../components/AdminBits';
import { useFeedback } from '../../platform/components/ui/FeedbackProvider';

const ROLE_LABEL: Record<string, string> = { admin: '管理员', user: '普通用户' };

/** 时间格式化 */
const fmtTime = (s?: string) =>
  s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '—';

interface FormState {
  username: string;
  password: string;
  role: 'admin' | 'user';
  is_active: boolean;
}

const EMPTY_FORM: FormState = { username: '', password: '', role: 'user', is_active: true };

/** 内存级 SWR 缓存：页面切换 0ms 瞬间秒开 */
let cachedUsersData: User[] | null = null;

export const UsersPage: React.FC = () => {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>(() => cachedUsersData ?? []);
  const [loading, setLoading] = useState(() => !cachedUsersData);
  const [error, setError] = useState('');

  // 新建 / 编辑表单
  const [editing, setEditing] = useState<User | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const { dialog, showToast } = useFeedback();

  const load = useCallback(async (force = false) => {
    const hasCache = !force && !!cachedUsersData;
    if (!hasCache) setLoading(true);
    setError('');
    try {
      const res = await adminService.listUsers();
      cachedUsersData = res;
      setUsers(res);
    } catch (e: any) {
      if (!cachedUsersData) setError(e?.message || '加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setFormError('');
    setEditing(null);
    setShowCreate(false);
  };

  const openCreate = () => {
    resetForm();
    setShowCreate(true);
  };

  const openEdit = (u: User) => {
    setShowCreate(false);
    setEditing(u);
    setForm({ username: u.username, password: '', role: u.role === 'admin' ? 'admin' : 'user', is_active: u.is_active ?? true });
    setFormError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username.trim()) {
      setFormError('用户名不能为空');
      return;
    }
    if (!editing && form.password.length < 1) {
      setFormError('请设置初始密码');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        const payload: Partial<{ username: string; password: string; role: 'admin' | 'user'; is_active: boolean }> = {
          username: form.username.trim(),
          role: form.role,
          is_active: form.is_active,
        };
        if (form.password) payload.password = form.password;
        await adminService.updateUser(editing.id, payload);
        showToast('用户信息已更新', { type: 'success' });
      } else {
        await adminService.createUser({
          username: form.username.trim(),
          password: form.password,
          role: form.role,
          is_active: form.is_active,
        });
        showToast('用户已创建', { type: 'success' });
      }
      resetForm();
      load();
    } catch (err: any) {
      setFormError(err?.message || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (u: User, next: boolean) => {
    try {
      await adminService.updateUser(u.id, { is_active: next });
      showToast(next ? `已启用 ${u.username}` : `已停用 ${u.username}`, { type: 'success' });
      load();
    } catch (e: any) {
      showToast(e?.message || '操作失败，请重试', { type: 'error' });
    }
  };

  const handleResetPassword = async (u: User) => {
    const pwd = await dialog.prompt({
      title: '重置密码',
      message: `为「${u.username}」设置新密码：`,
      confirmText: '重置',
      placeholder: '请输入新密码',
    });
    if (pwd === null) return;
    if (!pwd.trim()) return showToast('密码不能为空', { type: 'error' });
    try {
      await adminService.updateUser(u.id, { password: pwd });
      showToast('密码已重置', { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || '重置失败，请重试', { type: 'error' });
    }
  };

  const handleDelete = async (u: User) => {
    if (u.id === me?.id) return showToast('不能删除当前登录的管理员账号', { type: 'error' });
    const ok = await dialog.confirm({
      title: '删除用户',
      message: `确定删除用户「${u.username}」吗？其所有生成记录将一并删除。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await adminService.deleteUser(u.id);
      showToast('用户已删除', { type: 'success' });
      setUsers((prev) => {
        const next = prev.filter((it) => it.id !== u.id);
        cachedUsersData = next;
        return next;
      });
      void load(true);
    } catch (e: any) {
      showToast(e?.message || '删除失败，请重试', { type: 'error' });
    }
  };

  return (
    <div>
      <PageHeader
        title="用户管理"
        subtitle="新建、启用/停用、重置密码与删除用户（账号由管理员创建，无公开注册）"
        actions={
          !showCreate && !editing && (
            <Button size="sm" onClick={openCreate}>
              <Plus size={15} strokeWidth={2} className="mr-1" />
              新建用户
            </Button>
          )
        }
      />

      {/* 新建/编辑表单弹窗 */}
      <Dialog
        open={showCreate || !!editing}
        onClose={resetForm}
        title={
          <div className="flex items-center gap-2">
            {editing ? <Pencil size={18} strokeWidth={1.5} className="text-accent" /> : <UserPlus size={18} strokeWidth={1.5} className="text-accent" />}
            {editing ? `编辑用户：${editing.username}` : '新建用户'}
          </div>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <FieldLabel required>用户名</FieldLabel>
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="登录用户名"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel required={!editing}>{editing ? '重置密码（留空不修改）' : '初始密码'}</FieldLabel>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={editing ? '留空则保持原密码' : '设置初始密码'}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>角色</FieldLabel>
              <Select
                value={form.role}
                onChange={(val) => setForm({ ...form, role: val as 'admin' | 'user' })}
                options={[
                  { label: '普通用户', value: 'user' },
                  { label: '管理员', value: 'admin' },
                ]}
              />
            </div>
            <div className="space-y-1.5 flex items-end pb-1">
              <div className="flex items-center gap-2.5">
                <Toggle
                  checked={form.is_active}
                  onChange={(v) => setForm({ ...form, is_active: v })}
                  label="账号状态"
                />
                <span className="text-sm font-sans text-ink-light">
                  {form.is_active ? '启用' : '停用'}
                </span>
              </div>
            </div>
          </div>
          {formError && <p className="text-sm text-error font-sans">{formError}</p>}
          <div className="flex justify-end gap-3 pt-4 border-t border-dashed border-paper-grid">
            <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
              取消
            </Button>
            <Button type="submit" size="sm" isLoading={saving}>
              保存
            </Button>
          </div>
        </form>
      </Dialog>

      {/* 首次冷启动表格骨架屏 */}
      {loading && users.length === 0 && (
        <Card className="overflow-hidden p-4 space-y-3 animate-pulse" aria-busy="true" aria-label="正在加载用户列表">
          <div className="flex justify-between items-center pb-2 border-b border-dashed border-paper-grid">
            <div className="h-4 w-20 bg-paper-grid/50 rounded" />
            <div className="h-4 w-12 bg-paper-grid/35 rounded" />
            <div className="h-4 w-12 bg-paper-grid/35 rounded" />
            <div className="h-4 w-24 bg-paper-grid/30 rounded" />
            <div className="h-4 w-16 bg-paper-grid/35 rounded" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex justify-between items-center py-2.5 border-b border-dashed border-paper-grid/60 last:border-b-0">
              <div className="h-4 w-28 bg-paper-grid/45 rounded" />
              <div className="h-4 w-12 bg-paper-grid/30 rounded" />
              <div className="h-5 w-14 bg-paper-grid/35 rounded-full" />
              <div className="h-3.5 w-24 bg-paper-grid/25 rounded" />
              <div className="h-6 w-20 bg-paper-grid/30 rounded" />
            </div>
          ))}
        </Card>
      )}

      {/* 错误态 */}
      {error && users.length === 0 && (
        <div className="py-12 flex flex-col items-center gap-3">
          <span className="text-sm text-error font-sans">{error}</span>
          <Button variant="ghost" size="sm" onClick={() => void load(true)}>
            <RefreshCw size={14} strokeWidth={1.5} className="mr-1" />
            重试
          </Button>
        </div>
      )}

      {/* 用户表格 */}
      {users.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm font-sans">
            <thead>
              <tr className="border-b border-dashed border-paper-grid text-left text-xs text-ink-light">
                <th className="px-5 py-3 font-medium">用户名</th>
                <th className="px-3 py-3 font-medium">角色</th>
                <th className="px-3 py-3 font-medium">状态</th>
                <th className="px-3 py-3 font-medium">创建时间</th>
                <th className="px-5 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isMe = u.id === me?.id;
                return (
                  <tr key={String(u.id)} className="border-b border-dashed border-paper-grid last:border-b-0 hover:bg-accent-surface/40 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-ink font-medium">{u.username}</span>
                        {isMe && (
                          <span className="text-[11px] text-accent border border-dashed border-accent/50 rounded-pill px-1.5 py-px">当前账号</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-ink-light">{ROLE_LABEL[u.role ?? 'user'] ?? u.role}</td>
                    <td className="px-3 py-3">
                      <Badge variant={u.is_active ? 'success' : 'default'} showDot>
                        {u.is_active ? '启用' : '停用'}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-ink-faint tabular-nums text-xs">{fmtTime(u.created_at)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Toggle
                          checked={u.is_active ?? true}
                          onChange={(v) => handleToggleActive(u, v)}
                          disabled={isMe}
                          label={u.is_active ? '停用' : '启用'}
                        />
                        <button
                          onClick={() => handleResetPassword(u)}
                          title="重置密码"
                          className="p-1.5 rounded-md text-ink-light hover:text-accent hover:bg-accent-surface transition-colors active:scale-[0.96]"
                        >
                          <KeyRound size={15} strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={() => openEdit(u)}
                          title="编辑"
                          className="p-1.5 rounded-md text-ink-light hover:text-accent hover:bg-accent-surface transition-colors active:scale-[0.96]"
                        >
                          <Pencil size={15} strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={() => handleDelete(u)}
                          title={isMe ? '不能删除当前账号' : '删除'}
                          disabled={isMe}
                          className="p-1.5 rounded-md text-ink-light hover:text-error hover:bg-error/5 transition-colors active:scale-[0.96] disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Trash2 size={15} strokeWidth={1.5} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {!loading && !error && users.length === 0 && (
        <Card className="overflow-hidden">
          <div className="py-14 flex flex-col items-center gap-3 text-center">
            <UsersIcon size={36} strokeWidth={1} className="text-ink-faint" />
            <p className="font-serif text-base text-ink">还没有用户</p>
            <p className="text-sm text-ink-light font-sans">点击「新建用户」创建第一个账号</p>
          </div>
        </Card>
      )}

    </div>
  );
};

export default UsersPage;
