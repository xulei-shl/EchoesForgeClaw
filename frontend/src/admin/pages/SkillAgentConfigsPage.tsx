import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Copy,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { adminService } from '../../shared/services/admin';
import type { LLMConfig, PromptTemplate, SkillAgentConfig } from '../../shared/types';
import { Button } from '../../shared/components/ui/Button';
import { Dialog } from '../../shared/components/ui/Dialog';
import { Input } from '../../shared/components/ui/Input';
import { Select } from '../../shared/components/ui/Select';
import { Toggle } from '../../shared/components/ui/Toggle';
import { Badge } from '../../shared/components/ui/Badge';
import { Card } from '../../shared/components/ui/Card';
import { FieldLabel, PageHeader } from '../components/AdminBits';
import { useFeedback } from '../../shared/components/ui/FeedbackProvider';

/** 模型类型短标签（下拉选项展示） */
const KIND_SHORT_LABEL: Record<string, string> = {
  text: '文本',
  multimodal: '多模态',
  image: '图像',
  video: '视频',
  audio: '音频',
};

interface FormState {
  name: string;
  llm_config_id: number | '';
  prompt_id: number | '';
  image_llm_config_id: number | '';
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  llm_config_id: '',
  prompt_id: '',
  image_llm_config_id: '',
  is_active: true,
};

/** 内存级 SWR 缓存：页面切换 0ms 瞬间秒开 */
let cachedSkillAgentsData: SkillAgentConfig[] | null = null;
let cachedSkillDropdownsData: {
  llmConfigs: LLMConfig[];
  prompts: PromptTemplate[];
} | null = null;

export const SkillAgentConfigsPage: React.FC = () => {
  const [items, setItems] = useState<SkillAgentConfig[]>(() => cachedSkillAgentsData ?? []);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfig[]>(() => cachedSkillDropdownsData?.llmConfigs ?? []);
  const [prompts, setPrompts] = useState<PromptTemplate[]>(() => cachedSkillDropdownsData?.prompts ?? []);
  const [loading, setLoading] = useState(() => !cachedSkillAgentsData);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState<SkillAgentConfig | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const { dialog, showToast } = useFeedback();

  // 1. 优先加载 Skill Agent 列表：毫秒级直出，不被弹窗依赖阻塞
  const loadAgents = useCallback(async (silent = false) => {
    if (!silent && !cachedSkillAgentsData) setLoading(true);
    setError('');
    try {
      const res = await adminService.listSkillAgentConfigs();
      cachedSkillAgentsData = res;
      setItems(res);
    } catch (e: any) {
      if (!cachedSkillAgentsData) setError(e?.message || '加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, []);

  // 2. 独立异步后台加载弹窗下拉字典
  const loadDropdowns = useCallback(async () => {
    try {
      const [llmRes, promptRes] = await Promise.all([
        adminService.listLlmConfigs(),
        adminService.listPrompts(),
      ]);
      cachedSkillDropdownsData = { llmConfigs: llmRes, prompts: promptRes };
      setLlmConfigs(llmRes);
      setPrompts(promptRes);
    } catch {
      /* 字典加载异常不影响主列表呈现 */
    }
  }, []);

  const load = useCallback(async (force = false) => {
    const isCached = !force && !!cachedSkillAgentsData;
    void loadAgents(isCached);
    void loadDropdowns();
  }, [loadAgents, loadDropdowns]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 可选的模型配置：仅启用且已配置 Key 的（Skill Agent 的 url/key/model 全部来自它）。
   *  编辑时若绑定项已停用/删除，追加到末尾兜底展示，避免下拉为空 */
  const usableLlmConfigs = useMemo(() => {
    const usable = llmConfigs.filter((c) => c.is_active && c.has_api_key);
    if (editing && editing.llm_config_id != null) {
      const bound = llmConfigs.find((c) => c.id === editing.llm_config_id);
      if (bound && !usable.some((c) => c.id === bound.id)) return [...usable, bound];
    }
    return usable;
  }, [llmConfigs, editing]);

  /** 提示词模板候选：全部模板可选（Skill Agent 与具体节点模板类型无关）；编辑时绑定项兜底展示 */
  const availablePrompts = useMemo(() => {
    const usable = prompts.filter((p) => p.is_active);
    if (editing && editing.prompt_id != null) {
      const bound = prompts.find((p) => p.id === editing.prompt_id);
      if (bound && !usable.some((p) => p.id === bound.id)) return [...usable, bound];
    }
    return usable;
  }, [prompts, editing]);

  /** 绘图模型候选：仅启用且有 Key 的 image 类配置；编辑时绑定项兜底展示 */
  const usableImageLlmConfigs = useMemo(() => {
    const usable = llmConfigs.filter((c) => c.kind === 'image' && c.is_active && c.has_api_key);
    if (editing && editing.image_llm_config_id != null) {
      const bound = llmConfigs.find((c) => c.id === editing.image_llm_config_id);
      if (bound && !usable.some((c) => c.id === bound.id)) return [...usable, bound];
    }
    return usable;
  }, [llmConfigs, editing]);

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

  const openEdit = (c: SkillAgentConfig) => {
    setShowCreate(false);
    setEditing(c);
    setForm({
      name: c.name,
      llm_config_id: c.llm_config_id ?? '',
      prompt_id: c.prompt_id ?? '',
      image_llm_config_id: c.image_llm_config_id ?? '',
      is_active: c.is_active,
    });
    setFormError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setFormError('请输入配置名称');
    if (form.llm_config_id === '') return setFormError('请选择模型配置（模型 url/key 复用于「模型配置」）');

    setSaving(true);
    setFormError('');
    try {
      const base = {
        name: form.name.trim(),
        llm_config_id: Number(form.llm_config_id),
        prompt_id: form.prompt_id === '' ? null : Number(form.prompt_id),
        image_llm_config_id: form.image_llm_config_id === '' ? null : Number(form.image_llm_config_id),
        is_active: form.is_active,
      };
      if (editing) {
        await adminService.updateSkillAgentConfig(editing.id, base);
        showToast('Skill Agent 配置已更新', { type: 'success' });
      } else {
        await adminService.createSkillAgentConfig(base);
        showToast('Skill Agent 配置已创建', { type: 'success' });
      }
      resetForm();
      void loadAgents(true);
    } catch (err: any) {
      setFormError(err?.message || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (c: SkillAgentConfig, next: boolean) => {
    try {
      await adminService.updateSkillAgentConfig(c.id, { is_active: next });
      showToast(next ? `已启用 ${c.name}` : `已停用 ${c.name}`, { type: 'success' });
      void loadAgents(true);
    } catch (e: any) {
      showToast(e?.message || '操作失败，请重试', { type: 'error' });
    }
  };

  const handleDelete = async (c: SkillAgentConfig) => {
    const ok = await dialog.confirm({
      title: '删除 Skill Agent 配置',
      message: `确定删除「${c.name}」吗？引用它的节点配置将解除绑定。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await adminService.deleteSkillAgentConfig(c.id);
      showToast('Skill Agent 配置已删除', { type: 'success' });
      setItems((prev) => {
        const next = prev.filter((it) => it.id !== c.id);
        cachedSkillAgentsData = next;
        return next;
      });
      void loadAgents(true);
    } catch (e: any) {
      showToast(e?.message || '删除失败，请重试', { type: 'error' });
    }
  };

  const handleDuplicate = async (c: SkillAgentConfig) => {
    try {
      await adminService.duplicateSkillAgentConfig(c.id);
      showToast(`已复制「${c.name}」`, { type: 'success' });
      void loadAgents(true);
    } catch (e: any) {
      showToast(e?.message || '复制失败，请重试', { type: 'error' });
    }
  };

  return (
    <div>
      <PageHeader
        title="Skill Agent 配置"
        subtitle="Pi-Agent 多步执行：模型 url/key 复用「模型配置」，系统提示词复用「提示词模板」"
        actions={
          !showCreate && !editing && (
            <Button size="sm" onClick={openCreate}>
              <Plus size={15} strokeWidth={2} className="mr-1" />
              新建配置
            </Button>
          )
        }
      />

      <Dialog
        open={showCreate || !!editing}
        onClose={resetForm}
        panelClassName="max-w-xl"
        title={
          <div className="flex items-center gap-2">
            <Bot size={18} strokeWidth={1.5} className="text-accent" />
            {editing ? `编辑配置：${editing.name}` : '新建 Skill Agent 配置'}
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
                placeholder="如：图书整理 Agent / 分析 Agent"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel required>模型配置</FieldLabel>
              <Select
                value={String(form.llm_config_id || '')}
                onChange={(val) => setForm({ ...form, llm_config_id: val === '' ? '' : Number(val) })}
                options={[
                  { label: '请选择模型配置', value: '' },
                  ...usableLlmConfigs.map((c) => ({
                    label: `${c.model_name || c.name}（${KIND_SHORT_LABEL[c.kind] ?? c.kind}）`,
                    value: String(c.id),
                  })),
                ]}
              />
              {usableLlmConfigs.length === 0 && (
                <p className="text-xs text-ink-faint font-sans">
                  暂无可用模型配置，可先在「模型配置」中创建并配置 API Key
                </p>
              )}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <FieldLabel>绘图模型（可选）</FieldLabel>
              <Select
                value={String(form.image_llm_config_id || '')}
                onChange={(val) =>
                  setForm({ ...form, image_llm_config_id: val === '' ? '' : Number(val) })
                }
                options={[
                  { label: '不使用绘图工具', value: '' },
                  ...usableImageLlmConfigs.map((c) => ({
                    label: `${c.model_name || c.name}（图像生成）`,
                    value: String(c.id),
                  })),
                ]}
              />
              {usableImageLlmConfigs.length === 0 && (
                <p className="text-xs text-ink-faint font-sans">
                  暂无「图像生成」类型模型配置；配置后 Agent 可调用 image_generate 工具生成图片
                </p>
              )}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <FieldLabel>系统提示词（提示词模板，可选）</FieldLabel>
              <Select
                value={String(form.prompt_id || '')}
                onChange={(val) => setForm({ ...form, prompt_id: val === '' ? '' : Number(val) })}
                options={[
                  { label: '不使用提示词模板（仅由 skill 指令驱动）', value: '' },
                  ...availablePrompts.map((p) => ({ label: p.name, value: String(p.id) })),
                ]}
              />
              {availablePrompts.length === 0 && (
                <p className="text-xs text-ink-faint font-sans">
                  暂无提示词模板，可先在「提示词管理」中创建
                </p>
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
      </Dialog>

      {/* 首次冷启动骨架屏 */}
      {loading && items.length === 0 && (
        <div className="space-y-3 animate-pulse" aria-busy="true" aria-label="正在加载 Skill Agent">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-4 rounded-lg border border-dashed border-paper-grid bg-node-bg space-y-2.5">
              <div className="flex justify-between items-center">
                <div className="h-5 w-48 bg-paper-grid/50 rounded" />
                <div className="h-4 w-12 bg-paper-grid/35 rounded" />
              </div>
              <div className="h-4 w-72 bg-paper-grid/30 rounded" />
              <div className="h-3 w-52 bg-paper-grid/25 rounded" />
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

      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-serif text-base font-semibold text-ink">{c.name}</span>
                    <span className="text-xs text-ink-light border border-dashed border-paper-grid rounded-pill px-2 py-px font-sans">
                      Skill Agent
                    </span>
                    <Badge variant={c.is_active ? 'success' : 'default'} showDot>
                      {c.is_active ? '启用' : '停用'}
                    </Badge>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3 flex-wrap text-xs text-ink-faint font-mono">
                    <span className="inline-flex items-center gap-1">
                      <Sparkles size={11} strokeWidth={1.5} className="text-accent" />
                      模型：{c.model_name || '—'}
                      {c.llm_config_name && <span className="text-ink-faint/70">（{c.llm_config_name}）</span>}
                    </span>
                    <span className="max-w-[240px] truncate" title={c.base_url}>
                      {c.base_url || '官方地址'}
                    </span>
                    <span className="flex items-center gap-1">
                      <KeyRound size={11} strokeWidth={1.5} />
                      {c.has_api_key ? '已配置 Key' : '未配置 Key'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-light font-sans">
                    提示词：
                    {c.prompt_name ? (
                      <span className="text-ink">{c.prompt_name}</span>
                    ) : (
                      <span className="text-ink-faint">无（仅由已加载 skill 的 SKILL.md 指令驱动）</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-light font-sans">
                    绘图模型：
                    {c.image_llm_config_name ? (
                      <span className="text-ink">{c.image_llm_config_name}</span>
                    ) : (
                      <span className="text-ink-faint">无（不启用绘图工具）</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Toggle checked={c.is_active} onChange={(v) => handleToggleActive(c, v)} label={c.is_active ? '停用' : '启用'} />
                  <button
                    onClick={() => handleDuplicate(c)}
                    title="复制（沿用模型 / 提示词引用）"
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
          <p className="font-serif text-base text-ink">还没有 Skill Agent 配置</p>
          <p className="text-sm text-ink-light font-sans">
            配置后可在「节点管理」中为 AI 对话节点选择 Skill Agent 模式
          </p>
        </Card>
      )}
    </div>
  );
};

export default SkillAgentConfigsPage;
