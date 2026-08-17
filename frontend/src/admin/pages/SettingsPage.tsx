import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { adminService } from '../../platform/services/admin';
import type { AppSetting, BifrostFolder } from '../../platform/types';
import { Button } from '../../platform/components/ui/Button';
import { Input } from '../../platform/components/ui/Input';
import { Card } from '../../platform/components/ui/Card';
import { Dialog } from '../../platform/components/ui/Dialog';
import { FieldLabel, PageHeader } from '../components/AdminBits';
import { useFeedback } from '../../platform/components/ui/FeedbackProvider';

/** 需要默认展示的设置项说明（新增时用于输入提示） */
const KNOWN_KEYS: { key: string; description: string }[] = [
  { key: 'douban.base_url', description: '豆瓣 API 基础地址' },
  { key: 'douban.qps', description: '豆瓣请求速率（次/秒）' },
  { key: 'douban.proxy', description: '豆瓣请求 HTTP 代理' },
  { key: 'bifrost.base_url', description: 'Bifrost Gateway 基础地址' },
  { key: 'bifrost.username', description: 'Bifrost 管理账号（Basic Auth 用户名，初始来自 .env）' },
  { key: 'bifrost.password', description: 'Bifrost 管理密码（敏感，仅显示掩码）' },
  { key: 'bifrost.allowed_folders', description: 'Bifrost 白名单文件夹（逗号分隔，建议填文件夹 ID 也可填名称；留空=允许全部；仅白名单内的提示词出现在管理页与画布检索列表）' },
  { key: 'mxnzp.app_id', description: '万年历节点 MXNZP 应用 ID（初始来自 .env）' },
  { key: 'mxnzp.app_secret', description: '万年历节点 MXNZP 应用密钥（敏感，仅显示掩码）' },
  { key: 'mxnzp.base_url', description: '万年历节点 MXNZP API 基础地址（一般无需修改）' },
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
  sensitive: boolean;
}

const EMPTY_EDIT: EditState = { id: null, key: '', value: '', description: '', sensitive: false };

export const SettingsPage: React.FC = () => {
  const [items, setItems] = useState<AppSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const { dialog, showToast } = useFeedback();

  // Bifrost 白名单文件夹（bifrost.allowed_folders）专用配置 UI
  const [bifrostFolders, setBifrostFolders] = useState<BifrostFolder[]>([]);
  const [wlOpen, setWlOpen] = useState(false);
  const [wlSelected, setWlSelected] = useState<Set<string>>(new Set());
  const [wlSaving, setWlSaving] = useState(false);
  const [wlLoadError, setWlLoadError] = useState('');

  const grouped = useMemo(() => {
    const groups: {
      key: string;
      title: string;
      configs: AppSetting[];
    }[] = [];
    const groupMap = new Map<string, typeof groups[number]>();
    const ungrouped: AppSetting[] = [];

    for (const s of items) {
      const parts = s.key.split('.');
      if (parts.length > 1) {
        const category = parts[0];
        let grp = groupMap.get(category);
        if (!grp) {
          grp = { key: `group:${category}`, title: category, configs: [] };
          groupMap.set(category, grp);
          groups.push(grp);
        }
        grp.configs.push(s);
      } else {
        ungrouped.push(s);
      }
    }

    groups.sort((a, b) => a.title.localeCompare(b.title));
    if (ungrouped.length > 0) {
      groups.push({
        key: 'group:other',
        title: '其他',
        configs: ungrouped,
      });
    }

    return groups;
  }, [items]);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setWlLoadError('');
    try {
      const [res, folderRes] = await Promise.all([
        adminService.listSettings(),
        adminService
          .listBifrostFolders({ all: true })
          .catch((e: any) => {
            setWlLoadError(e?.message || 'Bifrost 未配置或不可用');
            return null;
          }),
      ]);
      setItems(res);
      const folders = folderRes?.folders ?? [];
      setBifrostFolders(folders);
      // 同步白名单回显（卡片与弹窗共用同一状态）
      const raw = (res.find((s) => s.key === 'bifrost.allowed_folders')?.value || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const selected = new Set<string>();
      if (raw.length) {
        for (const f of folders) {
          if (raw.includes(String(f.id).toLowerCase()) || raw.includes((f.name || '').toLowerCase())) {
            selected.add(f.id);
          }
        }
      }
      setWlSelected(selected);
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
    setEdit({ id: s.id, key: s.key, value: s.value, description: s.description, sensitive: s.sensitive ?? false });
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

  /** 打开白名单编辑：回显当前设置值（兼容 ID 或名称） */
  const openWhitelistEditor = async () => {
    try {
      const res = await adminService.listSettings();
      const raw = (res.find((s) => s.key === 'bifrost.allowed_folders')?.value || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const selected = new Set<string>();
      if (raw.length) {
        for (const f of bifrostFolders) {
          if (raw.includes(String(f.id).toLowerCase()) || raw.includes((f.name || '').toLowerCase())) {
            selected.add(f.id);
          }
        }
      }
      setWlSelected(selected);
      setWlOpen(true);
    } catch (e: any) {
      showToast(e?.message || '加载白名单失败', { type: 'error' });
    }
  };

  const toggleWhitelist = (folderId: string) => {
    setWlSelected((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const saveWhitelist = async () => {
    setWlSaving(true);
    try {
      const ids = [...wlSelected];
      // createSetting 为 upsert 语义：键不存在时创建、存在时覆盖（修复「配置项不存在」）
      await adminService.createSetting({
        key: 'bifrost.allowed_folders',
        value: ids.join(','),
        description:
          'Bifrost 白名单文件夹（逗号分隔的文件夹 ID；留空 = 允许全部；仅白名单内的提示词出现在管理页与画布检索列表）',
      });
      showToast(ids.length ? `已保存白名单：${ids.length} 个文件夹` : '已清空白名单（允许全部）', {
        type: 'success',
      });
      setWlOpen(false);
      load();
    } catch (e: any) {
      showToast(e?.message || '保存白名单失败，请重试', { type: 'error' });
    } finally {
      setWlSaving(false);
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

      {/* 新建/编辑表单弹窗 */}
      <Dialog
        open={showCreate || edit.id !== null}
        onClose={resetForm}
        panelClassName="max-w-xl"
        title={
          <div className="flex items-center gap-2">
            <SettingsIcon size={18} strokeWidth={1.5} className="text-accent" />
            {edit.id !== null ? `编辑设置项：${edit.key}` : '新建设置项'}
          </div>
        }
      >
        <form onSubmit={handleSave} className="space-y-5">
          <div className="space-y-1.5">
            <FieldLabel required>键名（key）</FieldLabel>
            <Input
              value={edit.key}
              onChange={(e) => setEdit({ ...edit, key: e.target.value })}
              placeholder="如 douban.proxy"
              list="known-setting-keys"
              disabled={edit.id !== null}
            />
            {edit.id === null && (
              <datalist id="known-setting-keys">
                {KNOWN_KEYS.map((k) => (
                  <option key={k.key} value={k.key} label={k.description} />
                ))}
              </datalist>
            )}
            {edit.id !== null && (
              <p className="text-xs text-ink-faint font-sans">
                编辑时不可修改键名
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <FieldLabel>值（value）</FieldLabel>
            <Input
              value={edit.value}
              onChange={(e) => setEdit({ ...edit, value: e.target.value })}
              placeholder={
                edit.sensitive ? '留空 / 保持 **** 不修改密钥' : '设置值'
              }
            />
            {edit.sensitive && (
              <p className="text-xs text-ink-faint font-sans">
                敏感项：留空或保持掩码保存将不修改密钥
              </p>
            )}
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
          <div className="flex justify-end gap-3 pt-5 border-t border-dashed border-paper-grid">
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
        <div className="space-y-6">
          {items.length === 0 ? (
            <Card className="py-14 flex flex-col items-center gap-3 text-center">
              <SettingsIcon size={36} strokeWidth={1} className="text-ink-faint" />
              <p className="font-serif text-base text-ink">暂无系统设置</p>
              <p className="text-sm text-ink-light font-sans">点击「新建设置项」添加配置</p>
            </Card>
          ) : (
            grouped.map((group) => {
              const isCollapsed = !!collapsedGroups[group.key];
              return (
                <div key={group.key}>
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }))
                    }
                    title={isCollapsed ? '展开分组' : '折叠分组'}
                    className="w-full mb-2 flex items-center gap-2 text-left group hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded"
                  >
                    {isCollapsed ? (
                      <ChevronRight size={15} strokeWidth={1.5} className="text-ink-faint shrink-0 transition-transform" />
                    ) : (
                      <ChevronDown size={15} strokeWidth={1.5} className="text-ink-faint shrink-0 transition-transform" />
                    )}
                    <span className="font-serif text-sm font-semibold text-ink capitalize">
                      {group.title === 'other' ? '其他' : group.title}
                    </span>
                    <span className="ml-auto text-xs text-ink-faint font-sans tabular-nums">
                      {group.configs.length} 项
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="space-y-3">
                      {/* bifrost 分组：白名单文件夹专用配置卡片（普通 KV 行隐藏，避免重复） */}
                      {group.key === 'group:bifrost' && (
                        <Card className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-sm text-accent border border-dashed border-accent/40 bg-accent/5 rounded-pill px-2.5 py-0.5">
                                  bifrost.allowed_folders
                                </span>
                                <ShieldCheck size={14} strokeWidth={1.5} className="text-accent" />
                              </div>
                              <p className="mt-2 text-sm text-ink font-sans">
                                {wlSelected.size > 0
                                  ? `当前白名单：${bifrostFolders
                                      .filter((f) => wlSelected.has(f.id))
                                      .map((f) => f.name)
                                      .join('、') || '已选择但文件夹不可用'}`
                                  : '未配置（允许全部文件夹）'}
                              </p>
                              <p className="mt-1 text-xs text-ink-light font-sans">
                                仅白名单文件夹下的提示词出现在 Bifrost 管理页与画布检索列表
                              </p>
                              {wlLoadError && (
                                <p className="mt-1 text-xs text-error font-sans">{wlLoadError}</p>
                              )}
                            </div>
                            <button
                              onClick={() => void openWhitelistEditor()}
                              title="编辑白名单"
                              className="p-1.5 rounded-md text-ink-light hover:text-accent hover:bg-accent-surface transition-colors active:scale-95"
                            >
                              <Pencil size={15} strokeWidth={1.5} />
                            </button>
                          </div>
                        </Card>
                      )}
                      {group.configs
                        .filter((s) => !(group.key === 'group:bifrost' && s.key === 'bifrost.allowed_folders'))
                        .map((s) => (
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
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Bifrost 白名单文件夹多选弹窗 */}
      <Dialog
        open={wlOpen}
        onClose={() => setWlOpen(false)}
        title="Bifrost 白名单文件夹"
        panelClassName="max-w-md"
      >
        <div className="space-y-3">
          <p className="text-xs text-ink-light font-sans">
            勾选后仅这些文件夹下的提示词会出现在 Bifrost 管理页与画布检索列表；不选 = 允许全部
          </p>
          <div className="max-h-72 overflow-y-auto border border-dashed border-paper-grid rounded-md p-1">
            {bifrostFolders.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-faint font-sans">
                {wlLoadError ? wlLoadError : '未获取到文件夹（请确认 Bifrost 已配置）'}
              </p>
            ) : (
              bifrostFolders.map((f) => {
                const checked = wlSelected.has(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggleWhitelist(f.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left rounded hover:bg-paper-grid/40 transition-colors"
                  >
                    <span
                      className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ${
                        checked ? 'bg-accent border-accent text-white' : 'border-paper-grid text-transparent'
                      }`}
                    >
                      <Check size={12} strokeWidth={2.5} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    {typeof f.prompts_count === 'number' && (
                      <span className="shrink-0 text-[10px] text-ink-faint font-mono tabular-nums">
                        {f.prompts_count}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-dashed border-paper-grid">
            <Button type="button" variant="ghost" size="sm" onClick={() => setWlOpen(false)}>
              取消
            </Button>
            <Button type="button" size="sm" isLoading={wlSaving} onClick={() => void saveWhitelist()}>
              保存
            </Button>
          </div>
        </div>
      </Dialog>

    </div>
  );
};

export default SettingsPage;
