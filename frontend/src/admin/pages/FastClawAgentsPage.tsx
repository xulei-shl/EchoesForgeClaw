import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  KeyRound,
  Link2,
  Pencil,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { adminService } from '../../shared/services/admin';
import api from '../../shared/services/api';
import type {
  FastClawAgentConfig,
  FastClawSkillCatalogItem,
  FastClawSkillSyncResult,
} from '../../shared/types';
import { Button } from '../../shared/components/ui/Button';
import { Dialog } from '../../shared/components/ui/Dialog';
import { Input } from '../../shared/components/ui/Input';
import { Toggle } from '../../shared/components/ui/Toggle';
import { Badge } from '../../shared/components/ui/Badge';
import { Card } from '../../shared/components/ui/Card';
import { FieldLabel, PageHeader } from '../components/AdminBits';
import { useFeedback } from '../../shared/components/ui/FeedbackProvider';

interface FormState {
  name: string;
  base_url: string;
  api_key: string;
  agent_id: string;
  /** FastClaw agent 真实名字（拉取选择时记录，随保存落库） */
  agent_name: string;
  is_active: boolean;
  /** 绑定的共享 skill 名（agent 级共享，不由画布节点注入） */
  skills: string[];
}

const EMPTY_FORM: FormState = {
  name: '',
  base_url: '',
  api_key: '',
  agent_id: '',
  agent_name: '',
  is_active: true,
  skills: [],
};

/** 「拉取」返回的 FastClaw agent（id 必填；name 为真实名字，无名字时与 id 相同） */
interface PulledAgent {
  id: string;
  name: string;
  model: string;
}

/** 内存级 SWR 缓存：页面切换 0ms 瞬间秒开 */
let cachedFastclawAgentsData: FastClawAgentConfig[] | null = null;

export const FastClawAgentsPage: React.FC = () => {
  const [items, setItems] = useState<FastClawAgentConfig[]>(() => cachedFastclawAgentsData ?? []);
  const [loading, setLoading] = useState(() => !cachedFastclawAgentsData);
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
  /** 可同步的共享 skill 候选（本地共享区 + 同捆包，与用户已安装列表无关） */
  const [skillCatalog, setSkillCatalog] = useState<FastClawSkillCatalogItem[]>([]);
  const [skillCatalogError, setSkillCatalogError] = useState('');
  const [skillQuery, setSkillQuery] = useState('');
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const { dialog, showToast } = useFeedback();

  const load = useCallback(async (force = false) => {
    const hasCache = !force && !!cachedFastclawAgentsData;
    if (!hasCache) setLoading(true);
    setError('');
    try {
      const res = await adminService.listFastClawAgents();
      cachedFastclawAgentsData = res;
      setItems(res);
    } catch (e: any) {
      if (!cachedFastclawAgentsData) setError(e?.message || '加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 技能候选只在管理端加载一次；失败不阻断配置表单（仍可保存其它字段）
  useEffect(() => {
    let alive = true;
    adminService
      .listFastClawSkillCatalog()
      .then((res) => {
        if (alive) setSkillCatalog(Array.isArray(res?.skills) ? res.skills : []);
      })
      .catch((e: any) => {
        if (alive) setSkillCatalogError(e?.message || '技能候选加载失败');
      });
    return () => {
      alive = false;
    };
  }, []);

  const filteredSkills = useMemo(() => {
    const q = skillQuery.trim().toLowerCase();
    if (!q) return skillCatalog;
    return skillCatalog.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q)
    );
  }, [skillCatalog, skillQuery]);

  const toggleFormSkill = (name: string) => {
    setForm((prev) => ({
      ...prev,
      skills: prev.skills.includes(name)
        ? prev.skills.filter((n) => n !== name)
        : [...prev.skills, name],
    }));
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setFormError('');
    setEditing(null);
    setShowCreate(false);
    setPullAgents(null);
    setPickedAgentId('');
    setPullSearch('');
    setSkillQuery('');
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
      skills: Array.isArray(c.skills) ? [...c.skills] : [],
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
      const wasEditing = !!editing;
      const base = {
        name: form.name.trim(),
        agent_name: form.agent_name.trim(),
        base_url: form.base_url.trim(),
        agent_id: form.agent_id.trim(),
        is_active: form.is_active,
        skills: form.skills,
      };
      let sync: FastClawSkillSyncResult | undefined;
      if (editing) {
        const payload: Record<string, any> = { ...base };
        if (form.api_key) payload.api_key = form.api_key.trim();
        const res = await adminService.updateFastClawAgent(editing.id, payload);
        sync = (res as FastClawAgentConfig & { skill_sync?: FastClawSkillSyncResult })?.skill_sync;
      } else {
        const res = await adminService.createFastClawAgent({ ...base, api_key: form.api_key.trim() });
        sync = (res as FastClawAgentConfig & { skill_sync?: FastClawSkillSyncResult })?.skill_sync;
      }
      if (sync?.warning) {
        showToast(`配置已保存，但技能同步未完成：${sync.warning}`, { type: 'error' });
      } else if (sync) {
        showToast(
          `配置已保存，同步 ${sync.synced.length} 个技能（${sync.unchanged} 个无变化，移除 ${sync.removed.length} 个）`,
          { type: 'success' }
        );
      } else {
        showToast(wasEditing ? 'Agent 配置已更新' : 'Agent 配置已创建', { type: 'success' });
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
      setItems((prev) => {
        const next = prev.filter((it) => it.id !== c.id);
        cachedFastclawAgentsData = next;
        return next;
      });
      void load(true);
    } catch (e: any) {
      showToast(e?.message || '删除失败，请重试', { type: 'error' });
    }
  };

  const handleDuplicate = async (c: FastClawAgentConfig) => {
    try {
      await adminService.duplicateFastClawAgent(c.id);
      showToast(`已复制「${c.name}」`, { type: 'success' });
      void load(true);
    } catch (e: any) {
      showToast(e?.message || '复制失败，请重试', { type: 'error' });
    }
  };

  /** 按当前 DB 配置重推技能到 FastClaw 数据目录（skill 包更新 / 目录被外部清理后使用）。 */
  const handleSyncSkills = async (c: FastClawAgentConfig) => {
    setSyncingId(c.id);
    try {
      const res = await adminService.syncFastClawAgentSkills(c.id);
      if (res.warning) {
        showToast(`技能同步未完成：${res.warning}`, { type: 'error' });
      } else {
        showToast(
          `已同步 ${res.synced.length} 个技能（${res.unchanged} 个无变化，移除 ${res.removed.length} 个）`,
          { type: 'success' }
        );
      }
    } catch (e: any) {
      showToast(e?.message || '技能同步失败，请重试', { type: 'error' });
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="FastClaw Agent"
        subtitle="FastClaw Agent 接入参数（Base URL + API Key + Agent ID）与 Agent 级共享技能"
        actions={
          !showCreate && !editing && (
            <Button size="sm" onClick={openCreate}>
              <Plus size={15} strokeWidth={2} className="mr-1" />
              新建配置
            </Button>
          )
        }
      />

      {/* 新建/编辑表单弹窗：宽面板 + 双栏布局；底部操作区固定在 footer，不会被内容滚动裁切 */}
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
        panelClassName={
          pullAgents
            ? 'max-w-lg h-[560px] max-h-[88vh] flex flex-col'
            : 'max-w-4xl h-[620px] max-h-[88vh] flex flex-col'
        }
        // 大屏固定高度，滚动交给两栏内部；窄屏回退为整块滚动
        contentClassName="overflow-y-auto md:overflow-hidden"
        footer={
          pullAgents ? (
            <div className="w-full flex justify-end gap-3 pr-3">
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
          ) : (
            <div className="w-full flex items-center justify-between gap-4 pr-3">
              <div className="flex items-center gap-2.5 shrink-0">
                <Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="启用状态" />
                <span className="text-sm font-sans text-ink-light">{form.is_active ? '启用' : '停用'}</span>
              </div>
              <div className="flex items-center gap-3 min-w-0">
                {formError && (
                  <p className="text-xs text-error font-sans truncate max-w-[320px]" title={formError}>
                    {formError}
                  </p>
                )}
                <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                  取消
                </Button>
                <Button type="submit" form="fastclaw-agent-form" size="sm" isLoading={saving}>
                  保存
                </Button>
              </div>
            </div>
          )
        }
      >
        {pullAgents ? (
          /* 拉取结果单选列表：手动点选后「确定」才写入 agent_id */
          <div className="h-full flex flex-col gap-3 min-h-0">
            <p className="text-xs text-ink-light font-sans shrink-0">
              共拉取到 {pullAgents.length} 个 Agent
              {pullSearch.trim() ? `，匹配 ${filteredPullAgents.length} 个` : ''}
              ，选择要绑定到本配置的 Agent：
            </p>
            <div className="relative shrink-0">
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
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
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
          </div>
        ) : (
        <form id="fastclaw-agent-form" onSubmit={handleSubmit} className="md:h-full flex flex-col gap-4">
          {/* 保存按钮位于 Dialog footer（form 之外）；隐藏 submit 保证输入框回车仍能提交 */}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-7 md:gap-8 md:flex-1 md:min-h-0">
            {/* 左栏：连接信息。字段内 6px、字段间 16px、栏间 32px，靠留白分组 */}
            <section className="flex flex-col gap-4 min-h-0 md:overflow-y-auto md:pr-2 custom-scrollbar">
              <div className="flex items-center gap-2 shrink-0">
                <Link2 size={15} strokeWidth={1.5} className="text-accent" />
                <h3 className="font-serif text-sm font-semibold text-ink">连接信息</h3>
                <span className="text-[11px] text-ink-faint font-sans">Base URL / API Key / Agent ID</span>
              </div>

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
                    variant="secondary"
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
                <p className="text-xs text-ink-faint font-sans flex items-start gap-1 leading-relaxed">
                  <Link2 size={11} strokeWidth={1.5} className="shrink-0 mt-0.5" />
                  从 FastClaw 拉取并选择 Agent；编辑时 Key 留空沿用已保存值
                </p>
                {form.agent_name && (
                  <p className="text-xs text-ink-light font-sans">已识别 Agent：{form.agent_name}</p>
                )}
              </div>
            </section>

            {/* 右栏：Agent 级共享技能。列表弹性填充剩余高度，是弹窗内唯一常态滚动区 */}
            <section className="flex flex-col gap-3 min-h-0 rounded-md border border-dashed border-paper-grid bg-paper-grid/10 p-4">
              <div className="flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Puzzle size={15} strokeWidth={1.5} className="text-accent" />
                  <h3 className="font-serif text-sm font-semibold text-ink">Agent 技能</h3>
                </div>
                <span className="text-[11px] text-ink-faint font-mono tabular-nums shrink-0">
                  已选 {form.skills.length} / {skillCatalog.length}
                </span>
              </div>
              <p className="text-xs text-ink-faint font-sans leading-relaxed shrink-0">
                技能为 Agent 级共享，对该 Agent 的所有会话生效（会话仅隔离对话历史）。保存后同步到 FastClaw 数据目录。
              </p>
              <div className="relative shrink-0">
                <Search
                  size={14}
                  strokeWidth={1.5}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
                />
                <Input
                  value={skillQuery}
                  onChange={(e) => setSkillQuery(e.target.value)}
                  placeholder="搜索可同步的共享技能"
                  className="pl-8"
                />
              </div>
              {skillCatalogError && (
                <p className="text-xs text-error font-sans shrink-0">{skillCatalogError}</p>
              )}
              <div className="max-h-[220px] md:max-h-none md:flex-1 md:min-h-0 overflow-y-auto custom-scrollbar rounded-md border border-dashed border-paper-grid bg-node-bg/60 divide-y divide-paper-grid/50">
                {filteredSkills.length === 0 ? (
                  <p className="text-xs text-ink-faint font-sans text-center py-8">
                    {skillCatalog.length === 0
                      ? '共享区暂无已安装技能（请先到 Bifrost Skills 安装）'
                      : '没有匹配的技能'}
                  </p>
                ) : (
                  filteredSkills.map((s) => {
                    const checked = form.skills.includes(s.name);
                    return (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => toggleFormSkill(s.name)}
                        className={`group w-full flex items-start gap-3 px-3 py-2.5 text-left border-l-2 transition-colors ${
                          checked ? 'border-accent bg-accent-surface/60' : 'border-transparent hover:bg-paper-grid/30'
                        }`}
                      >
                        <span
                          className={`mt-0.5 w-4 h-4 rounded-sm border shrink-0 flex items-center justify-center transition-colors ${
                            checked ? 'border-accent bg-accent text-paper' : 'border-paper-grid group-hover:border-accent/50'
                          }`}
                        >
                          {checked && <Check size={11} strokeWidth={3} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium text-ink font-mono truncate">
                            {s.name}
                          </span>
                          {s.description && (
                            <span className="block text-[11px] text-ink-faint font-sans truncate mt-1">
                              {s.description}
                            </span>
                          )}
                        </span>
                        <span
                          className={`shrink-0 text-[10px] font-sans px-1.5 py-0.5 rounded-pill border ${
                            s.source === 'shared'
                              ? 'border-accent/30 text-accent bg-accent-surface'
                              : 'border-paper-grid text-ink-faint'
                          }`}
                        >
                          {s.source === 'shared' ? '共享' : '同捆'}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="shrink-0 border-t border-dashed border-paper-grid pt-3">
                {form.skills.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 max-h-[68px] overflow-y-auto custom-scrollbar">
                    {form.skills.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => toggleFormSkill(name)}
                        title={`移除 ${name}`}
                        className="text-[11px] font-mono text-accent bg-accent-surface border border-accent/30 rounded-pill px-2 py-1 hover:border-accent/60 transition-colors"
                      >
                        {name} ×
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-ink-faint font-sans">尚未选择，点击上方条目添加</p>
                )}
              </div>
            </section>
          </div>
        </form>
        )}
      </Dialog>

      {/* 首次冷启动骨架屏 */}
      {loading && items.length === 0 && (
        <div className="space-y-3 animate-pulse" aria-busy="true" aria-label="正在加载 Agent 配置">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-4 rounded-lg border border-dashed border-paper-grid bg-node-bg space-y-2.5">
              <div className="flex justify-between items-center">
                <div className="h-5 w-44 bg-paper-grid/50 rounded" />
                <div className="h-4 w-12 bg-paper-grid/35 rounded" />
              </div>
              <div className="h-4 w-64 bg-paper-grid/30 rounded" />
            </div>
          ))}
        </div>
      )}

      {error && items.length === 0 && (
        <div className="py-12 flex flex-col items-center gap-3">
          <span className="text-sm text-error font-sans">{error}</span>
          <Button variant="ghost" size="sm" onClick={() => void load(true)}>
            <RefreshCw size={14} strokeWidth={1.5} className="mr-1" />
            重试
          </Button>
        </div>
      )}

      {/* 列表 */}
      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((c) => (
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
                    <span title="Agent 级共享技能，所有会话生效">
                      skills: {c.skills?.length ?? 0}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Toggle checked={c.is_active} onChange={(v) => handleToggleActive(c, v)} label={c.is_active ? '停用' : '启用'} />
                  <button
                    onClick={() => void handleSyncSkills(c)}
                    disabled={syncingId === c.id}
                    title="按当前配置重新同步技能到 FastClaw 数据目录"
                    className="p-1.5 rounded-md text-ink-light hover:text-accent hover:bg-accent-surface transition-colors active:scale-[0.96] disabled:opacity-50"
                  >
                    <RefreshCw
                      size={15}
                      strokeWidth={1.5}
                      className={syncingId === c.id ? 'animate-spin' : ''}
                    />
                  </button>
                  <button
                    onClick={() => handleDuplicate(c)}
                    title="复制（沿用 Base URL / API Key / Agent ID）"
                    className="p-1.5 rounded-md text-ink-light hover:text-accent hover:bg-accent-surface transition-colors active:scale-[0.96]"
                  >
                    <Copy size={15} strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={() => openEdit(c)}
                    title="编辑"
                    className="p-1.5 rounded-md text-ink-light hover:text-accent hover:bg-accent-surface transition-colors active:scale-[0.96]"
                  >
                    <Pencil size={15} strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={() => handleDelete(c)}
                    title="删除"
                    className="p-1.5 rounded-md text-ink-light hover:text-error hover:bg-error/5 transition-colors active:scale-[0.96]"
                  >
                    <Trash2 size={15} strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <Card className="py-14 flex flex-col items-center gap-3 text-center">
          <Bot size={36} strokeWidth={1} className="text-ink-faint" />
          <p className="font-serif text-base text-ink">还没有 Agent 配置</p>
          <p className="text-sm text-ink-light font-sans">配置后可在「阶段配置」中为各阶段选择 Agent 模式</p>
        </Card>
      )}
    </div>
  );
};

export default FastClawAgentsPage;
