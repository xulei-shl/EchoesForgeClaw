import React, { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Settings as SettingsIcon,
  Trash2,
} from 'lucide-react';
import { adminService } from '../../platform/services/admin';
import type { AppSetting } from '../../platform/types';
import { Button } from '../../platform/components/ui/Button';
import { Input } from '../../platform/components/ui/Input';
import { Card } from '../../platform/components/ui/Card';
import { FieldLabel, PageHeader } from '../components/AdminBits';
import { useFeedback } from '../../platform/components/ui/FeedbackProvider';

/** 需要默认展示的设置项说明（新增时用于输入提示） */
const KNOWN_KEYS: { key: string; description: string }[] = [
  { key: 'douban.base_url', description: '豆瓣 API 基础地址' },
  { key: 'douban.qps', description: '豆瓣请求速率（次/秒）' },
  { key: 'douban.proxy', description: '豆瓣请求 HTTP 代理' },
  { key: 'bitfrost.base_url', description: 'Bifrost Gateway 基础地址' },
  { key: 'bitfrost.api_key', description: 'Bifrost Management API Key（敏感，仅显示掩码）' },
];

/** 敏感设置项的值展示 / 编辑提示 */
function SensitiveValueHint({ setting }: { setting: AppSetting }) {
  if (!setting.sensitive) return null;
  return (
    <p className="mt-1 text-xs text-ink-faint font-sans">
      敏感项：仅显示掩码，留空保存表示不修改密钥
    </p>
  );
}

interface EditState {
  id: number | null;
  key: string;
  value: string;
  description: string;
}

const EMPTY_EDIT: EditState = { id: null, key: '', value: '', description: '' };

export const SettingsPage: React.FC = () => {
  const [items, setItems] = useState<AppSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const { dialog, showToast } = useFeedback();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminService.listSettings();
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
    setEdit(EMPTY_EDIT);
    setFormError('');
    setShowCreate(false);
  };

  const openCreate = () => {
    resetForm();
    setShowCreate(true);
  };

  const openEdit = (s: AppSetting) => {
    setShowCreate(false);
    setEdit({ id: s.id, key: s.key, value: s.value, description: s.description });
    setFormError('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit.key.trim()) return setFormError('设置键名不能为空');
    setSaving(true);
    setFormError('');
    try {
      if (edit.id !== null) {
        await adminService.updateSetting(edit.key, { value: edit.value, description: edit.description });
        showToast('设置已更新', { type: 'success' });
      } else {
        await adminService.createSetting({
          key: edit.key.trim(),
          value: edit.value,
          description: edit.description,
        });
        showToast('设置已创建', { type: 'success' });
      }
      resetForm();
      load();
    } catch (err: any) {
      setFormError(err?.message || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (s: AppSetting) => {
    const ok = await dialog.confirm({
      title: '删除设置项',
      message: `确定删除设置项「${s.key}」吗？删除后将回退到默认行为。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await adminService.deleteSetting(s.key);
      showToast('设置项已删除', { type: 'success' });
      load();
    } catch (e: any) {
      showToast(e?.message || '删除失败，请重试', { type: 'error' });
    }
  };

  return (
    <div>
      <PageHeader
        title="系统设置"
        subtitle="豆瓣代理、请求速率等平台级键值配置；修改后对后续请求立即生效"
        actions={
          !showCreate && (
            <Button size="sm" onClick={openCreate}>
              <Plus size={15} strokeWidth={2} className="mr-1" />
              新建设置项
            </Button>
          )
        }
      />

      {/* 新建/编辑表单 */}
      {showCreate && (
        <Card className="p-5 mb-6">
          <form onSubmit={handleSave} className="space-y-4">
            <div className="flex items-center gap-2 text-ink font-serif text-base font-semibold">
              <Plus size={16} strokeWidth={1.5} className="text-accent" />
              新建设置项
            </div>
            <div className="space-y-1.5">
              <FieldLabel required>键名（key）</FieldLabel>
              <Input
                value={edit.key}
                onChange={(e) => setEdit({ ...edit, key: e.target.value })}
                placeholder="如 douban.proxy"
                list="known-setting-keys"
              />
              <datalist id="known-setting-keys">
                {KNOWN_KEYS.map((k) => (
                  <option key={k.key} value={k.key} label={k.description} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <FieldLabel>值（value）</FieldLabel>
              <Input
                value={edit.value}
                onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                placeholder="设置值"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>说明（description）</FieldLabel>
              <Input
                value={edit.description}
                onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                placeholder="该项的用途说明"
              />
            </div>
            {formError && <p className="text-sm text-error font-sans">{formError}</p>}
            <div className="flex gap-3 pt-1">
              <Button type="submit" size="sm" isLoading={saving}>
                保存
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                取消
              </Button>
            </div>
          </form>
        </Card>
      )}

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
              <SettingsIcon size={36} strokeWidth={1} className="text-ink-faint" />
              <p className="font-serif text-base text-ink">暂无系统设置</p>
              <p className="text-sm text-ink-light font-sans">点击「新建设置项」添加配置</p>
            </Card>
          ) : (
            items.map((s) =>
              edit.id === s.id && !showCreate ? (
                /* 行内编辑态 */
                <Card key={s.id} className="p-4">
                  <form onSubmit={handleSave} className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-accent border border-dashed border-accent/40 bg-accent/5 rounded-pill px-2.5 py-0.5">
                        {s.key}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <FieldLabel>值</FieldLabel>
                        <Input
                          value={edit.value}
                          onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                          placeholder={
                            s.sensitive ? '留空 / 保持 **** 不修改密钥' : undefined
                          }
                        />
                        {s.sensitive && (
                          <p className="text-xs text-ink-faint font-sans">
                            敏感项：留空或保持掩码保存将不修改密钥
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel>说明</FieldLabel>
                        <Input
                          value={edit.description}
                          onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                        />
                      </div>
                    </div>
                    {formError && <p className="text-sm text-error font-sans">{formError}</p>}
                    <div className="flex gap-3">
                      <Button type="submit" size="sm" isLoading={saving}>
                        <Save size={14} strokeWidth={2} className="mr-1" />
                        保存
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                        取消
                      </Button>
                    </div>
                  </form>
                </Card>
              ) : (
                <Card key={s.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm text-accent border border-dashed border-accent/40 bg-accent/5 rounded-pill px-2.5 py-0.5">
                          {s.key}
                        </span>
                        <span className="text-xs text-ink-faint font-sans tabular-nums">
                          {new Date(s.updated_at).toLocaleString('zh-CN', { hour12: false })}
                        </span>
                      </div>
                      <p className="mt-2 font-mono text-sm text-ink break-all">
                        {s.sensitive
                          ? s.value
                            ? '••••••••（已配置）'
                            : '（未配置）'
                          : s.value || '（空）'}
                      </p>
                      <SensitiveValueHint setting={s} />
                      {s.description && (
                        <p className="mt-1 text-xs text-ink-light font-sans">{s.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => openEdit(s)}
                        title="编辑"
                        className="p-1.5 rounded-md text-ink-light hover:text-accent hover:bg-accent-surface transition-colors active:scale-95"
                      >
                        <Pencil size={15} strokeWidth={1.5} />
                      </button>
                      <button
                        onClick={() => handleDelete(s)}
                        title="删除"
                        className="p-1.5 rounded-md text-ink-light hover:text-error hover:bg-error/5 transition-colors active:scale-95"
                      >
                        <Trash2 size={15} strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                </Card>
              )
            )
          )}
        </div>
      )}

    </div>
  );
};

export default SettingsPage;
