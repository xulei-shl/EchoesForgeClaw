import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Copy,
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
  /** FastClaw agent 真实名字（拉取选择时记录，随保存落库） */
  agent_name: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  base_url: '',
  api_key: '',
  agent_id: '',
  agent_name: '',
  is_active: true,
};

/** 「拉取」返回的 FastClaw agent（id 必填；name 为真实名字，无名字时与 id 相同） */
interface PulledAgent {
  id: string;
  name: string;
  model: string;
}

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
  /** 拉取结果列表；非空时表单弹窗切换为「选择 Agent」单选列表 */
  const [pullAgents, setPullAgents] = useState<PulledAgent[] | null>(null);
  const [pickedAgentId, setPickedAgentId] = useState('');
  /** 拉取列表的搜索关键词（匹配名字 / ID / 模型） */
  const [pullSearch, setPullSearch] = useState('');
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
    setPullAgents(null);
    setPickedAgentId('');
    setPullSearch('');
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
      agent_name: c.agent_name || '',
      is_active: c.is_active,
    });
    setFormError('');
  };

  /** 拉取该 Key 可访问的 FastClaw agent 列表（优先 /api/agents 拿真实名字），弹出列表供手动选择 */
  const handlePullAgents = async () => {
    // 新建：需填 Base URL + API Key；编辑：api_key 留空（前端拿不到已保存的 Key）时
    // 传 config_id，由服务端用库中保存的 Key 探测；显式输入的 Base URL/Key 优先
    const params: Record<string, string | number> = {};
    if (form.base_url.trim()) {
      params.base_url = form.base_url.trim();
    } else if (editing?.base_url) {
      params.base_url = editing.base_url;
    } else {
      setFormError('请先填写 Base URL');
      return;
    }
    if (form.api_key.trim()) {
      params.api_key = form.api_key.trim();
    } else if (editing?.has_api_key) {
      // 编辑且原配置已有 Key：Key 留空时用库中已保存的 Key
      params.config_id = editing.id;
    } else {
      // 新建，或编辑的配置原本没有 Key：必须填写
      setFormError('请先填写 API Key');
      return;
    }
    setPullingAgents(true);
    setFormError('');
    try {
      const data: any = await api.get('/modules/bookplate/fastclaw-probe', { params });
      const agents = Array.isArray(data?.agents) ? data.agents : [];
      if (agents.length === 0) {
        showToast(
          '该 Key 下没有可访问的 Agent：请确认 Key 为 admin/user 类型且 Agent 属于该账号；agent 类型 Key 需先在 FastClaw 中绑定 Agent',
          { type: 'error' }
        );
        return;
      }
      // 弹出单选列表，由管理员手动点选要绑定的 Agent（不再自动填入第一个）
      setPullAgents(
        agents.map((a: any) => ({
          id: a.id || '',
          name: (a.name && a.name !== a.id ? a.name : a.id) || '',
          model: a.model || '',
        }))
      );
      setPickedAgentId('');
      setPullSearch('');
    } catch (e: any) {
      setFormError(e?.message || '拉取失败，请检查 Base URL 与 API Key');
    } finally {
      setPullingAgents(false);
    }
  };

  /** 拉取列表按关键词过滤后的结果（名字 / ID / 模型，不区分大小写） */
  const filteredPullAgents = useMemo(() => {
    if (!pullAgents) return [];
    const q = pullSearch.trim().toLowerCase();
    if (!q) return pullAgents;
    return pullAgents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        a.model.toLowerCase().includes(q)
    );
  }, [pullAgents, pullSearch]);

  /** 确认选择：把选中的 Agent id + 真实名字写入表单并关闭列表 */
  const handleApplyPicked = () => {
    if (!pickedAgentId) return;
    const picked = pullAgents?.find((a) => a.id === pickedAgentId);
    setForm({ ...form, agent_id: pickedAgentId, agent_name: picked?.name || '' });
    showToast(`已选择 Agent：${picked?.name || pickedAgentId}`, { type: 'success' });
    setPullAgents(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setFormError('请输入配置名称');
    if (!form.agent_id.trim()) return setFormError('请输入 Agent ID（可点击「拉取」从列表中选择）');

    setSaving(true);
    setFormError('');
    try {
      const base = { name: form.name.trim(), agent_name: form.agent_name.trim(), base_url: form.base_url.trim(), agent_id: form.agent_id.trim(), is_active: form.is_active };
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

  const handleDuplicate = async (c: FastClawAgentConfig) => {
    try {
      await adminService.duplicateFastClawAgent(c.id);
      showToast(`已复制「${c.name}」`, { type: 'success' });
      load();
    } catch (e: any) {
      showToast(e?.message || '复制失败，请重试', { type: 'error' });
    }
  };

  return (
    <div>
      <PageHeader
        title="Agent 配置"
        subtitle="FastClaw Agent 接入参数（Base URL + API Key + Agent ID）"
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
        // 选择列表打开时，遮罩/Esc 只收起列表，不关闭整个表单（避免误触清空已填的 Base URL/Key）
        onClose={pullAgents ? () => setPullAgents(null) : resetForm}
        title={
          <div className="flex items-center gap-2">
            <Bot size={18} strokeWidth={1.5} className="text-accent" />
            {pullAgents
              ? '选择要绑定的 Agent'
              : editing
                ? `编辑配置：${editing.name}`
                : '新建 Agent 配置'}
          </div>
        }
      >
        {pullAgents ? (
          /* 拉取结果单选列表：手动点选后「确定」才写入 agent_id */
          <div className="space-y-3">
            <p className="text-xs text-ink-light font-sans">
              共拉取到 {pullAgents.length} 个 Agent
              {pullSearch.trim() ? `，匹配 ${filteredPullAgents.length} 个` : ''}
              ，选择要绑定到本配置的 Agent：
            </p>
            <div className="relative">
              <Search
                size={14}
                strokeWidth={1.5}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
              />
              <Input
                value={pullSearch}
                onChange={(e) => setPullSearch(e.target.value)}
                placeholder="搜索名字 / ID / 模型"
                className="pl-8"
                autoFocus
              />
            </div>
            <div className="max-h-[280px] overflow-y-auto space-y-2 pr-1">
              {filteredPullAgents.length === 0 ? (
                <p className="text-center text-sm text-ink-faint font-sans py-6">没有匹配的 Agent</p>
              ) : (
                filteredPullAgents.map((a) => {
                  const active = pickedAgentId === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setPickedAgentId(a.id)}
                      className={`w-full flex items-start gap-3 rounded-md border p-3 text-left transition-all active:scale-[0.99] ${
                        active
                          ? 'border-accent/60 bg-accent-surface ring-1 ring-accent/40'
                          : 'border-paper-grid hover:border-paper-grid/70 hover:bg-paper-grid/20'
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                          active ? 'border-accent' : 'border-paper-grid'
                        }`}
                      >
                        {active && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-sans text-sm font-medium text-ink truncate">{a.name}</span>
                        <span className="block text-xs text-ink-faint font-mono truncate mt-0.5">
                          {a.id}
                          {a.model ? ` · ${a.model}` : ''}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="flex justify-end gap-3 pt-3 border-t border-dashed border-paper-grid">
              <Button type="button" variant="ghost" size="sm" onClick={() => setPullAgents(null)}>
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                // 未选择，或选中项被搜索过滤掉时禁用（避免应用不可见的选中项）
                disabled={!pickedAgentId || !filteredPullAgents.some((a) => a.id === pickedAgentId)}
                onClick={handleApplyPicked}
              >
                确定
              </Button>
            </div>
          </div>
        ) : (
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
                  onChange={(e) => setForm({ ...form, agent_id: e.target.value, agent_name: '' })}
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
                点击「拉取」从弹出列表中选择要绑定的 Agent；编辑时 Key 留空则使用已保存的 Key
              </p>
              {form.agent_name && (
                <p className="text-xs text-ink-light font-sans">已识别 Agent：{form.agent_name}</p>
              )}
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
        )}
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
                      <span title={c.agent_id}>agent: {c.agent_name || c.agent_id || '—'}</span>
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
                      onClick={() => handleDuplicate(c)}
                      title="复制（沿用 Base URL / API Key / Agent ID）"
                      className="p-1.5 rounded-md text-ink-light hover:text-accent hover:bg-accent-surface transition-colors active:scale-95"
                    >
                      <Copy size={15} strokeWidth={1.5} />
                    </button>
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
