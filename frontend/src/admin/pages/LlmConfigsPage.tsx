import React, { useCallback, useEffect, useState } from 'react';
import {
  CircleAlert,
  CircleCheck,
  Copy,
  Cpu,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Zap,
  Search,
} from 'lucide-react';
import { adminService } from '../../shared/services/admin';
import type { LLMConfig, LLMKind } from '../../shared/types';
import { Button } from '../../shared/components/ui/Button';
import { Dialog } from '../../shared/components/ui/Dialog';
import { Input } from '../../shared/components/ui/Input';
import { Select } from '../../shared/components/ui/Select';
import { Toggle } from '../../shared/components/ui/Toggle';
import { Badge } from '../../shared/components/ui/Badge';
import { Card } from '../../shared/components/ui/Card';
import { FieldLabel, PageHeader } from '../components/AdminBits';
import { useFeedback } from '../../shared/components/ui/FeedbackProvider';

const KIND_LABEL: Record<string, string> = {
  text: '文本模型',
  multimodal: '多模态模型',
  image: '图像模型',
  video: '视频模型',
  audio: '音频模型',
};

const THINKING_FORMAT_OPTIONS = [
  { label: '自动（reasoning_effort）', value: '' },
  { label: 'deepseek（thinking.type + reasoning_effort）', value: 'deepseek' },
  { label: 'qwen-chat-template（chat_template_kwargs.enable_thinking，agnes 类）', value: 'qwen-chat-template' },
  { label: 'zai（thinking.type）', value: 'zai' },
  { label: 'together（reasoning.enabled）', value: 'together' },
  { label: 'openrouter（reasoning.effort）', value: 'openrouter' },
];

interface FormState {
  name: string;
  kind: LLMKind;
  api_key: string;
  base_url: string;
  model_name: string;
  api_format: string;
  thinking_format: string;
  context_window: string;
  max_tokens: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  kind: 'text',
  api_key: '',
  base_url: '',
  model_name: '',
  api_format: '',
  thinking_format: '',
  context_window: '',
  max_tokens: '',
  is_active: true,
};

/** 内存级 SWR 缓存：页面切换 0ms 瞬间秒开 */
let cachedLlmConfigsData: LLMConfig[] | null = null;

export const LlmConfigsPage: React.FC = () => {
  const [items, setItems] = useState<LLMConfig[]>(() => cachedLlmConfigsData ?? []);
  const [loading, setLoading] = useState(() => !cachedLlmConfigsData);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState<LLMConfig | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  // 连通性测试：testingForm / testResult = 弹窗内测试；testingId = 列表卡片测试中状态（记录正在测试的配置 id）
  const [testingForm, setTestingForm] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const { dialog, showToast } = useFeedback();

  const load = useCallback(async (force = false) => {
    const hasCache = !force && !!cachedLlmConfigsData;
    if (!hasCache) setLoading(true);
    setError('');
    try {
      const res = await adminService.listLlmConfigs();
      cachedLlmConfigsData = res;
      setItems(res);
    } catch (e: any) {
      if (!cachedLlmConfigsData) setError(e?.message || '加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, []);

  /** Models.dev / 本地预设模型参数查询：自动填充 context_window / max_tokens */
  const handleLookupModel = useCallback(async (silent = false) => {
    const name = form.model_name.trim();
    if (!name) return;
    setLookingUp(true);
    try {
      const res = await adminService.lookupModel(name);
      if (res.found) {
        setForm(prev => ({
          ...prev,
          context_window: res.context_window != null ? String(res.context_window) : prev.context_window,
          max_tokens: res.max_tokens != null ? String(res.max_tokens) : prev.max_tokens,
          // 若识别为支持视觉且当前为纯文本，自动建议升级为多模态
          kind: res.is_multimodal && prev.kind === 'text' ? 'multimodal' : prev.kind,
        }));
        if (!silent) {
          const src = res.source === 'local' ? '离线预设' : 'Models.dev';
          const extra = res.is_multimodal && form.kind === 'text' ? '（已自动切换为多模态）' : '';
          showToast(`已从 ${src} 获取参数${extra}`, { type: 'success' });
        }
      } else if (!silent) {
        showToast('未匹配到该模型参数，请手动填写', { type: 'warning' });
      }
    } catch {
      if (!silent) showToast('模型参数查询失败', { type: 'error' });
    } finally {
      setLookingUp(false);
    }
  }, [form.model_name, form.kind, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setFormError('');
    setEditing(null);
    setShowCreate(false);
    setTestResult('');
    setTestOk(null);
  };

  const openCreate = () => {
    resetForm();
    setShowCreate(true);
  };

  const openEdit = (c: LLMConfig) => {
    setShowCreate(false);
    setEditing(c);
    setForm({
      name: c.name,
      kind: c.kind,
      api_key: '',
      base_url: c.base_url,
      model_name: c.model_name,
      api_format: c.api_format || '',
      thinking_format: c.thinking_format || '',
      context_window: c.context_window != null ? String(c.context_window) : '',
      max_tokens: c.max_tokens != null ? String(c.max_tokens) : '',
      is_active: c.is_active,
    });
    setFormError('');
    setTestResult('');
    setTestOk(null);
  };

  /** 列表卡片测试：用已保存的配置（含库中 Key）验证连通性 */
  const handleTestConfig = async (c: LLMConfig) => {
    if (testingId !== null) return; // 已有测试进行中，防止并发
    setTestingId(c.id);
    try {
      const res = await adminService.testLlmConfig({ id: c.id });
      showToast(res.message, { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || '测试失败，请检查配置', { type: 'error' });
    } finally {
      setTestingId(null);
    }
  };

  /** 弹窗内测试：用当前表单值验证（编辑时 Key 留空则回退使用已保存的 Key） */
  const handleTestForm = async () => {
    if (!form.model_name.trim()) {
      setFormError('请先填写模型名称再测试');
      return;
    }
    if (!form.api_key.trim() && !editing?.has_api_key) {
      setFormError('请先填写 API Key 再测试');
      return;
    }
    setTestingForm(true);
    setFormError('');
    setTestResult('');
    setTestOk(null);
    try {
      const res = await adminService.testLlmConfig({
        id: editing?.id,
        kind: form.kind,
        api_key: form.api_key.trim() || undefined,
        base_url: form.base_url.trim(),
        model_name: form.model_name.trim(),
      });
      setTestOk(true);
      setTestResult(res.message);
    } catch (err: any) {
      setTestOk(false);
      setTestResult(err?.message || '测试失败，请检查配置');
    } finally {
      setTestingForm(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setFormError('请输入配置名称');
    if (!form.model_name.trim()) return setFormError('请输入模型名称');

    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        const payload: Partial<{
          name: string;
          kind: LLMKind;
          api_key: string;
          base_url: string;
          model_name: string;
          api_format: string;
          thinking_format: string;
          context_window: number | null;
          max_tokens: number | null;
          is_active: boolean;
        }> = {
          name: form.name.trim(),
          kind: form.kind,
          base_url: form.base_url.trim(),
          model_name: form.model_name.trim(),
          api_format: form.api_format,
          thinking_format: form.thinking_format,
          context_window: form.context_window ? Number(form.context_window) : null,
          max_tokens: form.max_tokens ? Number(form.max_tokens) : null,
          is_active: form.is_active,
        };
        if (form.api_key) payload.api_key = form.api_key.trim();
        await adminService.updateLlmConfig(editing.id, payload);
        showToast('模型配置已更新', { type: 'success' });
      } else {
        await adminService.createLlmConfig({
          name: form.name.trim(),
          kind: form.kind,
          api_key: form.api_key.trim(),
          base_url: form.base_url.trim(),
          model_name: form.model_name.trim(),
          api_format: form.api_format,
          thinking_format: form.thinking_format,
          context_window: form.context_window ? Number(form.context_window) : null,
          max_tokens: form.max_tokens ? Number(form.max_tokens) : null,
          is_active: form.is_active,
        });
        showToast('模型配置已创建', { type: 'success' });
      }
      resetForm();
      load();
    } catch (err: any) {
      setFormError(err?.message || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (c: LLMConfig, next: boolean) => {
    try {
      await adminService.updateLlmConfig(c.id, { is_active: next });
      showToast(next ? `已启用 ${c.name}` : `已停用 ${c.name}`, { type: 'success' });
      load();
    } catch (e: any) {
      showToast(e?.message || '操作失败，请重试', { type: 'error' });
    }
  };

  const handleDuplicate = async (c: LLMConfig) => {
    try {
      await adminService.duplicateLlmConfig(c.id);
      showToast(`已复制「${c.name}」`, { type: 'success' });
      void load(true);
    } catch (e: any) {
      showToast(e?.message || '复制失败，请重试', { type: 'error' });
    }
  };

  const handleDelete = async (c: LLMConfig) => {
    const ok = await dialog.confirm({
      title: '删除模型配置',
      message: `确定删除模型配置「${c.name}」吗？引用它的阶段配置将解除绑定。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await adminService.deleteLlmConfig(c.id);
      showToast('模型配置已删除', { type: 'success' });
      setItems((prev) => {
        const next = prev.filter((it) => it.id !== c.id);
        cachedLlmConfigsData = next;
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
        title="模型配置"
        subtitle="大模型 API 密钥、Base URL 与模型名称（统一 OpenAI 兼容格式）"
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
        panelClassName="max-w-2xl"
        title={
          <div className="flex items-center gap-2">
            <Cpu size={18} strokeWidth={1.5} className="text-accent" />
            {editing ? `编辑配置：${editing.name}` : '新建模型配置'}
          </div>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <FieldLabel required>配置名称</FieldLabel>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：主文本模型 / 图像生成模型"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>类型</FieldLabel>
              <Select
                value={form.kind}
                onChange={(val) => setForm({ ...form, kind: val as LLMKind })}
                options={[
                  { label: '文本模型', value: 'text' },
                  { label: '多模态模型', value: 'multimodal' },
                  { label: '图像模型', value: 'image' },
                  { label: '视频模型', value: 'video' },
                  { label: '音频模型', value: 'audio' },
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel required>模型名称</FieldLabel>
              <Input
                value={form.model_name}
                onChange={(e) => setForm({ ...form, model_name: e.target.value })}
                onBlur={() => { if (!form.context_window) handleLookupModel(true); }}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>Base URL</FieldLabel>
              <Input
                value={form.base_url}
                onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                placeholder="如：https://api.openai.com/v1"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>pi 集成 API 格式（仅 Skill Agent 节点生效）</FieldLabel>
              <Select
                value={form.api_format}
                onChange={(val) => setForm({ ...form, api_format: val })}
                options={[
                  { label: 'OpenAI 兼容（默认）', value: '' },
                  { label: 'Anthropic Messages', value: 'anthropic' },
                ]}
              />
              <p className="text-xs text-ink-faint font-sans leading-snug">
                Anthropic 格式下思考自动映射为 thinking.type=enabled/disabled + budget_tokens；普通 Chat 节点仍走 OpenAI 兼容调用
              </p>
            </div>
            <div className="space-y-1.5">
              <FieldLabel>思考参数格式（OpenAI 兼容路径）</FieldLabel>
              <Select
                value={form.thinking_format}
                onChange={(val) => setForm({ ...form, thinking_format: val })}
                options={THINKING_FORMAT_OPTIONS}
              />
              <p className="text-xs text-ink-faint font-sans leading-snug">
                agnes 选 qwen-chat-template，deepseek 选 deepseek；Anthropic 格式下忽略
              </p>
            </div>
            {/* 上下文窗口 + 最大输出 Token */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">上下文窗口（token）</label>
                <div className="flex gap-1.5">
                  <Input
                    type="number"
                    placeholder="128000"
                    value={form.context_window}
                    onChange={e => setForm(f => ({ ...f, context_window: e.target.value }))}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => handleLookupModel()}
                    disabled={lookingUp || !form.model_name.trim()}
                    title="从 Models.dev / 离线预设自动获取参数"
                    className="px-2.5 shrink-0"
                  >
                    {lookingUp ? <Loader2 size={14} className="animate-spin text-accent" /> : <Search size={14} />}
                  </Button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">最大输出 Token</label>
                <Input
                  type="number"
                  placeholder="16384"
                  value={form.max_tokens}
                  onChange={e => setForm(f => ({ ...f, max_tokens: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <FieldLabel>{editing?.has_api_key ? 'API Key（留空保持原 Key 不变）' : 'API Key'}</FieldLabel>
              <Input
                type="password"
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                placeholder={editing?.has_api_key ? '已配置 · 留空不修改' : 'sk-...'}
                autoComplete="off"
              />
              {editing?.has_api_key && (
                <p className="text-xs text-ink-faint font-sans flex items-center gap-1">
                  <KeyRound size={11} strokeWidth={1.5} />
                  当前已配置 Key，出于安全考虑不会回显
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2.5 pt-2">
            <Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="启用状态" />
            <span className="text-sm font-sans text-ink-light">{form.is_active ? '启用' : '停用'}</span>
          </div>
          {formError && <p className="text-sm text-error font-sans">{formError}</p>}
          {testResult && (
            <p
              className={`text-sm font-sans flex items-start gap-1.5 ${testOk ? 'text-success' : 'text-error'}`}
            >
              {testOk ? (
                <CircleCheck size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
              ) : (
                <CircleAlert size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
              )}
              <span className="break-words leading-snug">{testResult}</span>
            </p>
          )}
          <div className="flex items-center justify-between pt-4 border-t border-dashed border-paper-grid">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              isLoading={testingForm}
              onClick={handleTestForm}
              title="用当前表单值测试连通性（编辑时 Key 留空则使用已保存的 Key）"
            >
              <Zap size={14} strokeWidth={1.5} className="mr-1" />
              测试连接
            </Button>
            <div className="flex gap-3">
              <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                取消
              </Button>
              <Button type="submit" size="sm" isLoading={saving}>
                保存
              </Button>
            </div>
          </div>
        </form>
      </Dialog>

      {/* 首次冷启动骨架屏 */}
      {loading && items.length === 0 && (
        <div className="space-y-3 animate-pulse" aria-busy="true" aria-label="正在加载模型配置">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-4 rounded-lg border border-dashed border-paper-grid bg-node-bg space-y-2.5">
              <div className="flex justify-between items-center">
                <div className="h-5 w-48 bg-paper-grid/50 rounded" />
                <div className="h-4 w-16 bg-paper-grid/35 rounded" />
              </div>
              <div className="h-4 w-80 bg-paper-grid/30 rounded" />
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
                      {KIND_LABEL[c.kind] ?? c.kind}
                    </span>
                    <Badge variant={c.is_active ? 'success' : 'default'} showDot>
                      {c.is_active ? '启用' : '停用'}
                    </Badge>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3 flex-wrap text-xs text-ink-faint font-mono">
                    <span>model: {c.model_name || '—'}</span>
                    <span className="max-w-[260px] truncate" title={c.base_url}>
                      base_url: {c.base_url || '默认'}
                    </span>
                    <span>api: {c.api_format === 'anthropic' ? 'anthropic' : 'openai'}</span>
                    {c.thinking_format && <span>thinking: {c.thinking_format}</span>}
                    {c.context_window && <span>ctx: {c.context_window.toLocaleString()}</span>}
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
                    title="复制（沿用 Base URL / API Key / 模型名称）"
                    className="p-1.5 rounded-md text-ink-light hover:text-accent hover:bg-accent-surface transition-colors active:scale-[0.96]"
                  >
                    <Copy size={15} strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={() => handleTestConfig(c)}
                    title={testingId === c.id ? '正在测试连接…' : '测试连通性（使用已保存的 API Key）'}
                    disabled={testingId !== null}
                    aria-busy={testingId === c.id}
                    className="inline-flex items-center gap-1.5 p-1.5 rounded-md text-ink-light hover:text-accent hover:bg-accent-surface transition-colors active:scale-[0.96] disabled:opacity-70 disabled:cursor-wait disabled:hover:bg-transparent disabled:hover:text-ink-light"
                  >
                    {testingId === c.id ? (
                      <>
                        <Loader2 size={15} strokeWidth={1.5} className="animate-spin text-accent" />
                        <span className="text-xs text-accent whitespace-nowrap">测试中</span>
                      </>
                    ) : (
                      <Zap size={15} strokeWidth={1.5} />
                    )}
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
          <Cpu size={36} strokeWidth={1} className="text-ink-faint" />
          <p className="font-serif text-base text-ink">还没有模型配置</p>
          <p className="text-sm text-ink-light font-sans">配置后可在「阶段配置」中为各阶段绑定模型</p>
        </Card>
      )}

    </div>
  );
};

export default LlmConfigsPage;
