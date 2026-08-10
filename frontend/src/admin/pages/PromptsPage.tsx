import React, { useCallback, useEffect, useState } from 'react';
import {
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { adminService } from '../../platform/services/admin';
import type { PromptTemplate } from '../../platform/types';
import { Select } from '../../platform/components/ui/Select';
import { Button } from '../../platform/components/ui/Button';
import { Dialog } from '../../platform/components/ui/Dialog';
import { Input } from '../../platform/components/ui/Input';
import { Toggle } from '../../platform/components/ui/Toggle';
import { Badge } from '../../platform/components/ui/Badge';
import { Card } from '../../platform/components/ui/Card';
import { Textarea } from '../../platform/components/ui/Textarea';
import { FieldLabel, PageHeader } from '../components/AdminBits';
import { useFeedback } from '../../platform/components/ui/FeedbackProvider';

const NODE_TYPE_OPTIONS: { label: string; value: string }[] = [
  { label: '提示词生成', value: 'prompt_generation' },
  { label: '图片分析', value: 'image_analysis' },
  { label: '图像生成', value: 'image_generation' },
];

const NODE_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  NODE_TYPE_OPTIONS.map((o) => [o.value, o.label])
);

interface FormState {
  name: string;
  node_type: string;
  content: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  node_type: 'prompt_generation',
  content: '',
  is_active: true,
};

export const PromptsPage: React.FC = () => {
  const [items, setItems] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [nodeTypeFilter, setNodeTypeFilter] = useState('');

  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const { dialog, showToast } = useFeedback();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: { node_type?: string } = {};
      if (nodeTypeFilter) params.node_type = nodeTypeFilter;
      const res = await adminService.listPrompts(params);
      setItems(res);
    } catch (e: any) {
      setError(e?.message || '加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [nodeTypeFilter]);

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

  const openEdit = (p: PromptTemplate) => {
    setShowCreate(false);
    setEditing(p);
    setForm({
      name: p.name,
      node_type: p.node_type,
      content: p.content,
      is_active: p.is_active,
    });
    setFormError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setFormError('请输入模板名称');
    if (!form.content.trim()) return setFormError('模板内容不能为空');

    setSaving(true);
    setFormError('');
    try {
      const payload = {
        name: form.name.trim(),
        node_type: form.node_type,
        content: form.content,
        is_active: form.is_active,
      };
      if (editing) {
        await adminService.updatePrompt(editing.id, payload);
        showToast('提示词模板已更新', { type: 'success' });
      } else {
        await adminService.createPrompt(payload);
        showToast('提示词模板已创建', { type: 'success' });
      }
      resetForm();
      load();
    } catch (err: any) {
      setFormError(err?.message || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (p: PromptTemplate, next: boolean) => {
    try {
      await adminService.updatePrompt(p.id, { is_active: next });
      showToast(next ? `已启用 ${p.name}` : `已停用 ${p.name}`, { type: 'success' });
      load();
    } catch (e: any) {
      showToast(e?.message || '操作失败，请重试', { type: 'error' });
    }
  };

  const handleDelete = async (p: PromptTemplate) => {
    const ok = await dialog.confirm({
      title: '删除提示词模板',
      message: `确定删除提示词模板「${p.name}」吗？引用它的节点配置将解除绑定。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await adminService.deletePrompt(p.id);
      showToast('提示词模板已删除', { type: 'success' });
      load();
    } catch (e: any) {
      showToast(e?.message || '删除失败，请重试', { type: 'error' });
    }
  };

  return (
    <div>
      <PageHeader
        title="提示词管理"
        subtitle="各节点模板类型使用的系统提示词模板（作为 LLM 的 system prompt）"
        actions={
          !showCreate && !editing && (
            <Button size="sm" onClick={openCreate}>
              <Plus size={15} strokeWidth={2} className="mr-1" />
              新建模板
            </Button>
          )
        }
      />

      {/* 筛选栏 */}
      <div className="flex items-center gap-3 mb-4">
        <Select
          value={nodeTypeFilter}
          onChange={(val) => setNodeTypeFilter(val)}
          className="w-44"
          options={[
            { label: '全部节点类型', value: '' },
            ...NODE_TYPE_OPTIONS,
          ]}
        />
        {nodeTypeFilter && (
          <button
            onClick={() => setNodeTypeFilter('')}
            className="text-sm text-accent hover:text-accent-hover font-sans active:scale-95 transition"
          >
            清除筛选
          </button>
        )}
      </div>

      {/* 新建/编辑表单弹窗 */}
      <Dialog
        open={showCreate || !!editing}
        onClose={resetForm}
        title={
          <div className="flex items-center gap-2">
            <FileText size={18} strokeWidth={1.5} className="text-accent" />
            {editing ? `编辑模板：${editing.name}` : '新建提示词模板'}
          </div>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <FieldLabel required>模板名称</FieldLabel>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：藏书票提示词生成"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>节点模板类型</FieldLabel>
              <Select
                value={form.node_type}
                onChange={(val) => setForm({ ...form, node_type: val })}
                options={NODE_TYPE_OPTIONS}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <FieldLabel required>模板内容（system prompt）</FieldLabel>
            <Textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={7}
              placeholder="你是一名资深藏书票设计师，请根据图书元数据设计一张富有文学气息的藏书票……"
            />
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
              <FileText size={36} strokeWidth={1} className="text-ink-faint" />
              <p className="font-serif text-base text-ink">没有匹配的提示词模板</p>
              <p className="text-sm text-ink-light font-sans">点击「新建模板」创建第一条提示词</p>
            </Card>
          ) : (
            items.map((p) => (
              <Card key={p.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-serif text-base font-semibold text-ink">{p.name}</span>
                      <span className="text-xs text-ink-light border border-dashed border-paper-grid rounded-pill px-2 py-px font-mono">
                        {NODE_TYPE_LABEL[p.node_type] ?? p.node_type}
                      </span>
                      <Badge variant={p.is_active ? 'success' : 'default'} showDot>
                        {p.is_active ? '启用' : '停用'}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-sm text-ink-light font-sans line-clamp-2 whitespace-pre-wrap">
                      {p.content || '（空内容）'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Toggle checked={p.is_active} onChange={(v) => handleToggleActive(p, v)} label={p.is_active ? '停用' : '启用'} />
                    <button
                      onClick={() => openEdit(p)}
                      title="编辑"
                      className="p-1.5 rounded-md text-ink-light hover:text-accent hover:bg-accent-surface transition-colors active:scale-95"
                    >
                      <Pencil size={15} strokeWidth={1.5} />
                    </button>
                    <button
                      onClick={() => handleDelete(p)}
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

export default PromptsPage;
