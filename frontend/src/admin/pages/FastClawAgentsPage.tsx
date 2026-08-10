import React, { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  KeyRound,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { adminService } from '../../platform/services/admin';
import api from '../../platform/services/api';
import type { FastClawAgentConfig } from '../../platform/types';
import { Button } from '../../platform/components/ui/Button';
import { Dialog } from '../../platform/components/ui/Dialog';
import { Input } from '../../platform/components/ui/Input';
import { Toggle } from '../../platform/components/ui/Toggle';
import { Badge } from '../../platform/components/ui/Badge';
import { Card } from '../../platform/components/ui/Card';
import { FieldLabel, PageHeader } from '../components/AdminBits';
import { useFeedback } from '../../platform/components/ui/FeedbackProvider';

interface FormState {
  name: string;
  base_url: string;
  api_key: string;
  agent_id: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  base_url: '',
  api_key: '',
  agent_id: '',
  is_active: true,
};

export const FastClawAgentsPage: React.FC = () => {
  const [items, setItems] = useState<FastClawAgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState<FastClawAgentConfig | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [pullingAgents, setPullingAgents] = useState(false);
  const { dialog, showToast } = useFeedback();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminService.listFastClawAgents();
      setItems(res);
    } catch (e: any) {
      setError(e?.message || '加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
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

  const openEdit = (c: FastClawAgentConfig) => {
    setShowCreate(false);
    setEditing(c);
    setForm({
      name: c.name,
      base_url: c.base_url,
      api_key: '',
      agent_id: c.agent_id,
      is_active: c.is_active,
    });
    setFormError('');
  };

  /** 拉取该 Key 可访问的 FastClaw agent 列表（GET /v1/agents），方便填入 agent_id */
  const handlePullAgents = async () => {
    if (!form.base_url.trim() || !form.api_key.trim()) {
      setFormError('请先填写 Base URL 与 API Key');
      return;
    }
    setPullingAgents(true);
    setFormError('');
    try {
      const data: any = await api.get('/modules/bookplate/fastclaw-probe', {
        params: { base_url: form.base_url.trim(), api_key: form.api_key.trim() },
      });
      const agents = Array.isArray(data?.agents) ? data.agents : [];
      if (agents.length === 0) {
        showToast(
          '该 Key 下没有可访问的 Agent：请确认 Key 为 admin/user 类型且 Agent 属于该账号；agent 类型 Key 需先在 FastClaw 中绑定 Agent',
          { type: 'error' }
        );
        return;
      }
      // 自动填入第一个 agent；全部罗列在提示中
      setForm({ ...form, agent_id: agents[0].id || '' });
      showToast(
        `已从 FastClaw 拉取 ${agents.length} 个 Agent（${agents.map((a: any) => a.id).join(', ')}）`,
        { type: 'success' }
      );
    } catch (e: any) {
      setFormError(e?.message || '拉取失败，请检查 Base URL 与 API Key');
    } finally {
      setPullingAgents(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setFormError('请输入配置名称');
    if (!form.agent_id.trim()) return setFormError('请输入 Agent ID（可点击「拉取」自动获取）');

    setSaving(true);
    setFormError('');
    try {
      const base = { name: form.name.trim(), base_url: form.base_url.trim(), agent_id: form.agent_id.trim(), is_active: form.is_active };
      if (editing) {
        const payload: Record<string, any> = { ...base };
        if (form.api_key) payload.api_key = form.api_key.trim();
        await adminService.updateFastClawAgent(editing.id, payload);
        showToast('Agent 配置已更新', { type: 'success' });
      } else {
        await adminService.createFastClawAgent({ ...base, api_key: form.api_key.trim() });
        showToast('Agent 配置已创建', { type: 'success' });
      }
      resetForm();
      load();
    } catch (err: any) {
      setFormError(err?.message || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (c: FastClawAgentConfig, next: boolean) => {
    try {
      await adminService.updateFastClawAgent(c.id, { is_active: next });
      showToast(next ? `已启用 ${c.name}` : `已停用 ${c.name}`, { type: 'success' });
      load();
    } catch (e: any) {
      showToast(e?.message || '操作失败，请重试', { type: 'error' });
    }
  };

  const handleDelete = async (c: FastClawAgentConfig) => {
    const ok = await dialog.confirm({
      title: '删除 Agent 配置',
      message: `确定删除 FastClaw Agent 配置「${c.name}」吗？引用它的阶段配置将解除绑定。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await adminService.deleteFastClawAgent(c.id);
      showToast('Agent 配置已删除', { type: 'success' });
      load();
    } catch (e: any) {
      showToast(e?.message || '删除失败，请重试', { type: 'error' });
    }
  };

  return (
    <div>
      <PageHeader
        title="Agent 配置"
        subtitle="FastClaw Agent 接入参数（Base URL + API Key + Agent ID）；在「阶段配置」中按阶段选择启用"
        actions={
          !showCreate && !editing && (
            <Button size="sm" onClick={openCreate}>
              <Plus size={15} strokeWidth={2} className="mr-1" />
              新建配置
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
            <Bot size={18} strokeWidth={1.5} className="text-accent" />
            {editing ? `编辑配置：${editing.name}` : '新建 Agent 配置'}
          </div>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <FieldLabel required>配置名称</FieldLabel>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：藏书票主 Agent / 图像 Agent"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>Base URL</FieldLabel>
              <Input
                value={form.base_url}
                onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                placeholder="如 http://127.0.0.1:8787"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>{editing?.has_api_key ? 'API Key（留空保持原 Key 不变）' : 'API Key'}</FieldLabel>
              <Input
                type="password"
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                placeholder={editing?.has_api_key ? '已配置 · 留空不修改' : 'fcak_...'}
                autoComplete="off"
              />
              {editing?.has_api_key && (
                <p className="text-xs text-ink-faint font-sans flex items-center gap-1">
                  <KeyRound size={11} strokeWidth={1.5} />
                  当前已配置 Key，出于安全考虑不会回显
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <FieldLabel required>Agent ID</FieldLabel>
              <div className="flex gap-2">
                <Input
                  value={form.agent_id}
                  onChange={(e) => setForm({ ...form, agent_id: e.target.value })}
                  placeholder="agt_..."
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  isLoading={pullingAgents}
                  onClick={handlePullAgents}
                  title="使用当前 Base URL + API Key 拉取可访问的 Agent 列表"
                  className="shrink-0"
                >
                  <Search size={14} strokeWidth={1.5} className="mr-1 shrink-0" />
                  <span className="whitespace-nowrap">拉取</span>
                </Button>
              </div>
              <p className="text-xs text-ink-faint font-sans flex items-center gap-1">
                <Link2 size={11} strokeWidth={1.5} />
                填写 Base URL 与 Key 后点击「拉取」自动获取
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 pt-2">
            <Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="启用状态" />
            <span className="text-sm font-sans text-ink-light">{form.is_active ? '启用' : '停用'}</span>
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

      {/* 加载态 */}
      {loading && (
        <Card className="p-10 flex items-center justify-center gap-2 text-ink-light text-sm font-sans">
          <Loader2 className="w-4 h-4 animate-spin text-accent" strokeWidth={1.5} />
          加载中...
        </Card>
      )}

      {!loading && error && (
        <div className="py-12 flex flex-col items-center gap-3">
          <span className="text-sm text-error font-sans">{error}</span>
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw size={14} strokeWidth={1.5} className="mr-1" />
            重试
          </Button>
        </div>
      )}

      {/* 列表 */}
      {!loading && !error && (
        <div className="space-y-3">
          {items.length === 0 ? (
            <Card className="py-14 flex flex-col items-center gap-3 text-center">
              <Bot size={36} strokeWidth={1} className="text-ink-faint" />
              <p className="font-serif text-base text-ink">还没有 Agent 配置</p>
              <p className="text-sm text-ink-light font-sans">配置后可在「阶段配置」中为各阶段选择 Agent 模式</p>
            </Card>
          ) : (
            items.map((c) => (
              <Card key={c.id} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-serif text-base font-semibold text-ink">{c.name}</span>
                      <span className="text-xs text-ink-light border border-dashed border-paper-grid rounded-pill px-2 py-px font-sans">
                        Agent
                      </span>
                      <Badge variant={c.is_active ? 'success' : 'default'} showDot>
                        {c.is_active ? '启用' : '停用'}
                      </Badge>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 flex-wrap text-xs text-ink-faint font-mono">
                      <span>agent_id: {c.agent_id || '—'}</span>
                      <span className="max-w-[260px] truncate" title={c.base_url}>
                        base_url: {c.base_url || '—'}
                      </span>
                      <span className="flex items-center gap-1">
                        <KeyRound size={11} strokeWidth={1.5} />
                        {c.has_api_key ? '已配置 Key' : '未配置 Key'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Toggle checked={c.is_active} onChange={(v) => handleToggleActive(c, v)} label={c.is_active ? '停用' : '启用'} />
                    <button
                      onClick={() => openEdit(c)}
                      title="编辑"
                      className="p-1.5 rounded-md text-ink-light hover:text-accent hover:bg-accent-surface transition-colors active:scale-95"
                    >
                      <Pencil size={15} strokeWidth={1.5} />
                    </button>
                    <button
                      onClick={() => handleDelete(c)}
                      title="删除"
                      className="p-1.5 rounded-md text-ink-light hover:text-error hover:bg-error/5 transition-colors active:scale-95"
                    >
                      <Trash2 size={15} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default FastClawAgentsPage;
