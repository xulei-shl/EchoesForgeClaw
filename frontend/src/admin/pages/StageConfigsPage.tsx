import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  GitBranch,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { adminService } from '../../platform/services/admin';
import type { FastClawAgentConfig, LLMConfig, PromptTemplate, StageConfig } from '../../platform/types';
import { Button } from '../../platform/components/ui/Button';
import { Dialog } from '../../platform/components/ui/Dialog';
import { Select } from '../../platform/components/ui/Select';
import { Card } from '../../platform/components/ui/Card';
import { FieldLabel, PageHeader } from '../components/AdminBits';
import { useFeedback } from '../../platform/components/ui/FeedbackProvider';

/** 模型类型短标签（下拉选项展示） */
const KIND_SHORT_LABEL: Record<string, string> = {
  text: '文本',
  multimodal: '多模态',
  image: '图像',
  video: '视频',
  audio: '音频',
};

/** bookplate 模块各阶段说明（模型/提示词由阶段配置手动绑定，不做类型过滤） */
const STAGE_META: { value: string; label: string; hint: string }[] = [
  { value: 'stage2', label: 'Stage 2', hint: '文本模型生成提示词' },
  { value: 'stage2.cover', label: 'Stage 2 · 封面分析', hint: '多模态模型分析封面' },
  { value: 'stage3', label: 'Stage 3', hint: '图像模型生成藏书票' },
];

interface FormState {
  module: string;
  stage: string;
  /** 模式：llm（提示词 + 大模型）/ agent（FastClaw Agent） */
  mode: 'llm' | 'agent';
  llm_config_id: number | '';
  prompt_id: number | '';
  agent_config_id: number | '';
}

const EMPTY_FORM: FormState = {
  module: 'bookplate',
  stage: 'stage2',
  mode: 'llm',
  llm_config_id: '',
  prompt_id: '',
  agent_config_id: '',
};

export const StageConfigsPage: React.FC = () => {
  const [items, setItems] = useState<StageConfig[]>([]);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfig[]>([]);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [fastclawAgents, setFastclawAgents] = useState<FastClawAgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState<StageConfig | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const { dialog, showToast } = useFeedback();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [stageRes, llmRes, promptRes, agentRes] = await Promise.all([
        adminService.listStageConfigs(),
        adminService.listLlmConfigs(),
        adminService.listPrompts(),
        adminService.listFastClawAgents(),
      ]);
      setItems(stageRes);
      setLlmConfigs(llmRes);
      setPrompts(promptRes);
      setFastclawAgents(agentRes);
    } catch (e: any) {
      setError(e?.message || '加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** 模型配置候选：全量展示（与提示词下拉一致，不按 kind 过滤；阶段配置本就是手动绑定） */
  const availableModels = useMemo(() => llmConfigs, [llmConfigs]);

  /** 提示词模板候选：按所选阶段过滤（创建提示词时必须填写 stage）；已绑定提示词兜底显示，避免 select 为空 */
  const availablePrompts = useMemo(() => {
    const filtered = prompts.filter((p) => p.stage === form.stage);
    // 已绑定提示词不在过滤结果中时补上，保证下拉框能显示当前值
    if (editing && form.prompt_id !== '') {
      const bound = prompts.find((p) => p.id === form.prompt_id);
      if (bound && !filtered.some((p) => p.id === bound.id)) {
        return [...filtered, bound];
      }
    }
    return filtered;
  }, [prompts, form.stage, form.prompt_id, editing]);

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

  const openEdit = (sc: StageConfig) => {
    setShowCreate(false);
    setEditing(sc);
    setForm({
      module: sc.module,
      stage: sc.stage,
      mode: sc.agent_config_id ? 'agent' : 'llm',
      llm_config_id: sc.llm_config_id ?? '',
      prompt_id: sc.prompt_id ?? '',
      agent_config_id: sc.agent_config_id ?? '',
    });
    setFormError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      // 模式互斥：提交前只保留所选模式的字段，另一组置空
      const payload = {
        module: form.module.trim() || 'bookplate',
        stage: form.stage,
        llm_config_id: form.mode === 'llm' && form.llm_config_id !== '' ? Number(form.llm_config_id) : null,
        prompt_id: form.mode === 'llm' && form.prompt_id !== '' ? Number(form.prompt_id) : null,
        agent_config_id: form.mode === 'agent' && form.agent_config_id !== '' ? Number(form.agent_config_id) : null,
      };
      if (editing) {
        await adminService.updateStageConfig(editing.id, payload);
        showToast('阶段配置已更新', { type: 'success' });
      } else {
        await adminService.upsertStageConfig(payload);
        showToast('阶段配置已保存（同阶段重复保存自动覆盖）', { type: 'success' });
      }
      resetForm();
      load();
    } catch (err: any) {
      setFormError(err?.message || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (sc: StageConfig) => {
    const ok = await dialog.confirm({
      title: '删除阶段绑定',
      message: `确定删除「${sc.module} / ${sc.stage}」的绑定吗？删除后将回退到环境变量配置。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await adminService.deleteStageConfig(sc.id);
      showToast('阶段配置已删除', { type: 'success' });
      load();
    } catch (e: any) {
      showToast(e?.message || '删除失败，请重试', { type: 'error' });
    }
  };

  const stageLabel = (stage: string) => STAGE_META.find((s) => s.value === stage)?.label ?? stage;

  return (
    <div>
      <PageHeader
        title="阶段配置"
        subtitle="为每个模块的每个阶段绑定「模型 + 提示词模板」；未绑定时自动回退环境变量"
        actions={
          !showCreate && !editing && (
            <Button size="sm" onClick={openCreate}>
              <Plus size={15} strokeWidth={2} className="mr-1" />
              新建绑定
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
            <Link2 size={18} strokeWidth={1.5} className="text-accent" />
            {editing ? `编辑绑定：${editing.module} / ${editing.stage}` : '新建阶段绑定'}
          </div>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 模式互斥选择：提示词+大模型 / Agent */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setForm({ ...form, mode: 'llm', agent_config_id: '' })}
              className={`rounded-md border p-3 text-left transition-all active:scale-[0.98] ${
                form.mode === 'llm'
                  ? 'border-accent/60 bg-accent-surface ring-1 ring-accent/40'
                  : 'border-paper-grid hover:border-paper-grid/70 hover:bg-paper-grid/20'
              }`}
            >
              <p className={`text-sm font-medium font-sans ${form.mode === 'llm' ? 'text-accent' : 'text-ink'}`}>
                <Link2 size={13} strokeWidth={1.5} className="inline mr-1 -mt-0.5" />
                提示词 + 大模型
              </p>
              <p className="text-xs text-ink-faint font-sans mt-1">绑定提示词模板与 OpenAI 兼容模型</p>
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, mode: 'agent', llm_config_id: '', prompt_id: '' })}
              className={`rounded-md border p-3 text-left transition-all active:scale-[0.98] ${
                form.mode === 'agent'
                  ? 'border-accent/60 bg-accent-surface ring-1 ring-accent/40'
                  : 'border-paper-grid hover:border-paper-grid/70 hover:bg-paper-grid/20'
              }`}
            >
              <p className={`text-sm font-medium font-sans ${form.mode === 'agent' ? 'text-accent' : 'text-ink'}`}>
                <Bot size={13} strokeWidth={1.5} className="inline mr-1 -mt-0.5" />
                Agent 模式
              </p>
              <p className="text-xs text-ink-faint font-sans mt-1">调用 FastClaw Agent（工具/思考）</p>
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-1.5">
              <FieldLabel>模块</FieldLabel>
              <input
                value={form.module}
                onChange={(e) => setForm({ ...form, module: e.target.value })}
                placeholder="bookplate"
                className="flex h-10 w-full rounded-md border border-dashed border-paper-grid bg-transparent px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>阶段</FieldLabel>
              <Select
                value={form.stage}
                onChange={(val) => setForm({ ...form, stage: val })}
                options={STAGE_META.map(s => ({ label: `${s.label} · ${s.hint}`, value: s.value }))}
              />
            </div>
            {form.mode === 'agent' ? (
              <div className="space-y-1.5">
                <FieldLabel>FastClaw Agent</FieldLabel>
                <Select
                  value={String(form.agent_config_id || '')}
                  onChange={(val) => setForm({ ...form, agent_config_id: val === '' ? '' : Number(val) })}
                  options={[
                    { label: '请选择 Agent', value: '' },
                    ...fastclawAgents.filter(a => a.is_active).map(a => {
                      // 优先展示 FastClaw 真实名字（如 Xulei），与配置名不同时并列展示
                      const real = a.agent_name || '';
                      return {
                        label: real && real !== a.name ? `${real}（${a.name}）` : a.name,
                        value: String(a.id),
                      };
                    })
                  ]}
                />
                {fastclawAgents.filter((a) => a.is_active).length === 0 && (
                  <p className="text-xs text-ink-faint font-sans">
                    暂无启用的 Agent 配置，可先在「Agent 配置」中创建
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <FieldLabel>模型配置</FieldLabel>
                  <Select
                    value={String(form.llm_config_id || '')}
                    onChange={(val) => setForm({ ...form, llm_config_id: val === '' ? '' : Number(val) })}
                    options={[
                      { label: '请选择模型配置', value: '' },
                      ...availableModels.map(c => ({
                        label: `${c.model_name || c.name}（${KIND_SHORT_LABEL[c.kind] ?? c.kind}）`,
                        value: String(c.id),
                      }))
                    ]}
                  />
                  {availableModels.length === 0 && (
                    <p className="text-xs text-ink-faint font-sans">
                      暂无模型配置，可先在「模型配置」中创建
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <FieldLabel>提示词模板</FieldLabel>
                  <Select
                    value={String(form.prompt_id || '')}
                    onChange={(val) => setForm({ ...form, prompt_id: val === '' ? '' : Number(val) })}
                    options={[
                      { label: '请选择提示词模板', value: '' },
                      ...availablePrompts.map(p => ({
                        label: p.name,
                        value: String(p.id),
                      }))
                    ]}
                  />
                  {availablePrompts.length === 0 && (
                    <p className="text-xs text-ink-faint font-sans">
                      当前阶段暂无提示词模板，将使用内置默认提示词；可先在「提示词管理」中创建
                    </p>
                  )}
                </div>
              </>
            )}
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
              <GitBranch size={36} strokeWidth={1} className="text-ink-faint" />
              <p className="font-serif text-base text-ink">还没有阶段绑定</p>
              <p className="text-sm text-ink-light font-sans">创建绑定后，生成流程将按绑定调用对应模型与提示词</p>
            </Card>
          ) : (
            items.map((sc) => (
              <Card key={sc.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm text-accent border border-dashed border-accent/40 bg-accent/5 rounded-pill px-2.5 py-0.5">
                        {sc.module}
                      </span>
                      <span className="font-serif text-base font-semibold text-ink">{stageLabel(sc.stage)}</span>
                    </div>
                    {sc.agent_config_id ? (
                      <div className="mt-2 flex items-center gap-2 flex-wrap text-sm font-sans">
                        <span className="inline-flex items-center gap-1.5 text-accent">
                          <Bot size={14} strokeWidth={1.5} />
                          <span className="text-ink-faint text-xs">Agent 模式</span>
                          {sc.agent_config_agent_name ?? sc.agent_config_name ?? (
                            <span className="text-ink-faint">未命名 Agent</span>
                          )}
                        </span>
                      </div>
                    ) : (
                      <div className="mt-2 flex items-center gap-2 flex-wrap text-sm font-sans">
                        <span className="inline-flex items-center gap-1.5 text-ink">
                          <span className="text-ink-faint text-xs">模型</span>
                          {sc.llm_config_name ?? <span className="text-ink-faint">未绑定（环境变量）</span>}
                        </span>
                        <span className="text-ink-faint">→</span>
                        <span className="inline-flex items-center gap-1.5 text-ink">
                          <span className="text-ink-faint text-xs">提示词</span>
                          {sc.prompt_name ?? <span className="text-ink-faint">内置默认</span>}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => openEdit(sc)}
                      title="编辑"
                      className="p-1.5 rounded-md text-ink-light hover:text-accent hover:bg-accent-surface transition-colors active:scale-95"
                    >
                      <Pencil size={15} strokeWidth={1.5} />
                    </button>
                    <button
                      onClick={() => handleDelete(sc)}
                      title="删除（回退环境变量）"
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

export default StageConfigsPage;
