import React, { useCallback, useEffect, useState } from 'react';
import {
  Cpu,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { adminService } from '../../platform/services/admin';
import type { LLMConfig, LLMKind } from '../../platform/types';
import { Button } from '../../platform/components/ui/Button';
import { Dialog } from '../../platform/components/ui/Dialog';
import { Input } from '../../platform/components/ui/Input';
import { Select } from '../../platform/components/ui/Select';
import { Toggle } from '../../platform/components/ui/Toggle';
import { Badge } from '../../platform/components/ui/Badge';
import { Card } from '../../platform/components/ui/Card';
import { FieldLabel, PageHeader } from '../components/AdminBits';
import { useFeedback } from '../../platform/components/ui/FeedbackProvider';

const KIND_LABEL: Record<string, string> = {
  text: '文本模型',
  multimodal: '多模态模型',
  image: '图像模型',
  video: '视频模型',
  audio: '音频模型',
};

interface FormState {
  name: string;
  kind: LLMKind;
  api_key: string;
  base_url: string;
  model_name: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  kind: 'text',
  api_key: '',
  base_url: '',
  model_name: '',
  is_active: true,
};

export const LlmConfigsPage: React.FC = () => {
  const [items, setItems] = useState<LLMConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState<LLMConfig | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const { dialog, showToast } = useFeedback();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminService.listLlmConfigs();
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

  const openEdit = (c: LLMConfig) => {
    setShowCreate(false);
    setEditing(c);
    setForm({
      name: c.name,
      kind: c.kind,
      api_key: '',
      base_url: c.base_url,
      model_name: c.model_name,
      is_active: c.is_active,
    });
    setFormError('');
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
          is_active: boolean;
        }> = {
          name: form.name.trim(),
          kind: form.kind,
          base_url: form.base_url.trim(),
          model_name: form.model_name.trim(),
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
      load();
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
        title={
          <div className="flex items-center gap-2">
            <Cpu size={18} strokeWidth={1.5} className="text-accent" />
            {editing ? `编辑配置：${editing.name}` : '新建模型配置'}
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
                placeholder="如 gpt-4o-mini / dall-e-3"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>Base URL</FieldLabel>
              <Input
                value={form.base_url}
                onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                placeholder="留空使用官方地址；第三方兼容服务填接口地址"
              />
            </div>
            <div className="space-y-1.5">
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
              <Cpu size={36} strokeWidth={1} className="text-ink-faint" />
              <p className="font-serif text-base text-ink">还没有模型配置</p>
              <p className="text-sm text-ink-light font-sans">配置后可在「阶段配置」中为各阶段绑定模型</p>
            </Card>
          ) : (
            items.map((c) => (
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

export default LlmConfigsPage;
