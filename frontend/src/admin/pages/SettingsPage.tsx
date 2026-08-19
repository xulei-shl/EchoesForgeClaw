import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  BookOpen,
  Calendar,
  Check,
  HelpCircle,
  Image as ImageIcon,
  Landmark,
  Layers,
  Loader2,
  Globe,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { adminService } from '../../platform/services/admin';
import type { AppSetting, BifrostFolder } from '../../platform/types';
import { Button } from '../../platform/components/ui/Button';
import { Input } from '../../platform/components/ui/Input';
import { Card } from '../../platform/components/ui/Card';
import { Dialog } from '../../platform/components/ui/Dialog';
import { FieldLabel } from '../components/AdminBits';
import { useFeedback } from '../../platform/components/ui/FeedbackProvider';

/** 需要默认展示的设置项说明（新增时用于输入提示） */
const KNOWN_KEYS: { key: string; description: string }[] = [
  { key: 'douban.base_url', description: '豆瓣 API 基础地址' },
  { key: 'douban.qps', description: '豆瓣请求速率（次/秒）' },
  { key: 'bifrost.base_url', description: 'Bifrost Gateway 基础地址' },
  { key: 'bifrost.username', description: 'Bifrost 管理账号（Basic Auth 用户名，初始来自 .env）' },
  { key: 'bifrost.password', description: 'Bifrost 管理密码（敏感，仅显示掩码）' },
  { key: 'bifrost.allowed_folders', description: 'Bifrost 白名单文件夹（逗号分隔，建议填文件夹 ID 也可填名称；留空=允许全部；仅白名单内的提示词出现在管理页与画布检索列表）' },
  { key: 'mxnzp.app_id', description: '万年历节点 MXNZP 应用 ID（初始来自 .env）' },
  { key: 'mxnzp.app_secret', description: '万年历节点 MXNZP 应用密钥（敏感，仅显示掩码）' },
  { key: 'mxnzp.base_url', description: '万年历节点 MXNZP API 基础地址（一般无需修改）' },
  { key: 'unsplash.access_key', description: '图片检索节点 Unsplash Access Key（https://unsplash.com/developers 注册获取；敏感，仅显示掩码）' },
  { key: 'pixabay.api_key', description: '图片检索节点 Pixabay API Key（https://pixabay.com/api/docs 获取；敏感，仅显示掩码）' },
  { key: 'harvard.api_key', description: '艺术图片检索节点 Harvard Art Museums API Key（https://harvardartmuseums.org/collections/api 获取；敏感，仅显示掩码）' },
  { key: 'nypl.api_key', description: '艺术图片检索节点 NYPL Digital Collections API Key（https://api.repo.nypl.org/ 获取；敏感，仅显示掩码）' },
  { key: 'smithsonian.api_key', description: '艺术图片检索节点 Smithsonian Open Access API Key（https://api.data.gov/signup/ 获取；敏感，仅显示掩码）' },
  { key: 'paris.api_key', description: '艺术图片检索节点 Paris Musées API Key（https://www.parismusees.paris.fr/fr/les-collections-en-ligne/lapi-collections 获取；敏感，仅显示掩码）' },
  { key: 'europeana.api_key', description: '艺术图片检索节点 Europeana API Key（https://apis.europeana.eu/en/apis 获取；敏感，仅显示掩码）' },
  { key: 'zhihu.access_secret', description: '知乎检索节点（知乎开发者平台开放 API）Access Secret（敏感，仅显示掩码；初始来自 .env）' },
  { key: 'http.proxy', description: '全局 HTTP 代理地址（如 http://127.0.0.1:7890；留空 = 全部直连）' },
  { key: 'loc.use_proxy', description: 'LoC 国会图书馆检索/图片是否使用全局代理（true = 启用，false = 直连）' },
  { key: 'google_translate.use_proxy', description: 'Google 翻译是否使用全局代理（true = 启用，false = 直连）' },
  { key: 'deeplx.use_proxy', description: 'DeepLX 翻译是否使用全局代理（true = 启用，false = 直连；未配置默认直连）' },
];

/** 业务分类配置定义 */
interface CategoryDef {
  id: string;
  name: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  description: string;
  match: (key: string) => boolean;
}

const CATEGORY_DEFS: CategoryDef[] = [
  {
    id: 'proxy',
    name: '网络代理',
    icon: Shield,
    description: '全局 HTTP 代理地址与各服务的代理启用开关（修改后对后续网络请求立即生效）',
    match: (key) => key === 'http.proxy' || key.endsWith('.use_proxy'),
  },
  {
    id: 'bifrost',
    name: 'Bifrost 网关',
    icon: Sparkles,
    description: 'Bifrost 提示词与 Skill 网关地址、认证账号密码及白名单文件夹配置',
    match: (key) => key.startsWith('bifrost.'),
  },
  {
    id: 'glam',
    name: '艺术馆藏 (GLAM)',
    icon: Landmark,
    description: '用于画布「艺术图片检索 (GLAM)」节点的 5 大博物馆/典藏馆 API Key。未配置 Key 的馆藏仍可使用免鉴权开放接口（如 MET、Rijksmuseum、AIC、SMK 等）',
    match: (key) =>
      key.startsWith('europeana.') ||
      key.startsWith('harvard.') ||
      key.startsWith('nypl.') ||
      key.startsWith('paris.') ||
      key.startsWith('smithsonian.') ||
      (key.startsWith('loc.') && !key.endsWith('.use_proxy')),
  },
  {
    id: 'image',
    name: '图片检索',
    icon: ImageIcon,
    description: '用于画布「图片检索」节点的公共图库 API Key（Unsplash、Pixabay）；「NASA 图片检索」为公开接口无需配置',
    match: (key) => key.startsWith('unsplash.') || key.startsWith('pixabay.'),
  },
  {
    id: 'douban',
    name: '豆瓣图书',
    icon: BookOpen,
    description: '豆瓣图书元数据 API 请求地址与速率限制 (QPS) 设置',
    match: (key) => key.startsWith('douban.'),
  },
  {
    id: 'mxnzp',
    name: '万年历',
    icon: Calendar,
    description: '万年历节点（MXNZP 节假日、公农历与黄历服务）的应用 ID 与密钥配置',
    match: (key) => key.startsWith('mxnzp.'),
  },
  {
    id: 'websearch',
    name: '网络检索',
    icon: Globe,
    description: '用于画布网络检索类节点（知乎检索、全网搜索等）的 API Key 与访问凭据配置',
    match: (key) =>
      key.startsWith('zhihu.') ||
      key.startsWith('websearch.') ||
      key.startsWith('search.') ||
      key.startsWith('tavily.') ||
      key.startsWith('serper.') ||
      key.startsWith('brave.') ||
      key.startsWith('bocha.'),
  },
];

/** 判断配置项所属分类 ID */
function resolveCategoryId(key: string): string {
  const found = CATEGORY_DEFS.find((c) => c.match(key));
  return found ? found.id : 'other';
}

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

  const [activeTab, setActiveTab] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

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

  /** 统计各 Tab 项的数量与定义列表 */
  const tabList = useMemo(() => {
    const counts: Record<string, number> = { all: items.length };
    let otherCount = 0;

    for (const item of items) {
      const catId = resolveCategoryId(item.key);
      counts[catId] = (counts[catId] || 0) + 1;
      if (catId === 'other') otherCount++;
    }

    const list: {
      id: string;
      name: string;
      icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
      count: number;
      description?: string;
    }[] = [
      {
        id: 'all',
        name: '全部',
        icon: Layers,
        count: items.length,
        description: '系统内全部配置项总览',
      },
      ...CATEGORY_DEFS.map((c) => ({
        id: c.id,
        name: c.name,
        icon: c.icon,
        count: counts[c.id] || 0,
        description: c.description,
      })),
    ];

    // 如果存在未归类的自定义项，增加「其他」Tab
    if (otherCount > 0) {
      list.push({
        id: 'other',
        name: '其他',
        icon: HelpCircle,
        count: otherCount,
        description: '未归类的其他自定义配置项',
      });
    }

    return list;
  }, [items]);

  /** 当前激活 Tab 的元数据 */
  const activeTabMeta = useMemo(() => {
    return tabList.find((t) => t.id === activeTab) || tabList[0];
  }, [tabList, activeTab]);

  /** 过滤后的显示列表 */
  const filteredItems = useMemo(() => {
    let list = items;

    // 分类筛选
    if (activeTab !== 'all') {
      list = list.filter((item) => resolveCategoryId(item.key) === activeTab);
    }

    // 关键词搜索
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (item) =>
          item.key.toLowerCase().includes(q) ||
          (item.description && item.description.toLowerCase().includes(q)) ||
          (item.value && !item.sensitive && item.value.toLowerCase().includes(q))
      );
    }

    return list;
  }, [items, activeTab, searchQuery]);

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

  const handleToggleSetting = async (s: AppSetting) => {
    const isCurrentlyTrue = s.value === 'true';
    const nextVal = isCurrentlyTrue ? 'false' : 'true';
    try {
      await adminService.updateSetting(s.key, { value: nextVal });
      showToast(`已${nextVal === 'true' ? '启用' : '关闭'}代理`, { type: 'success' });
      load();
    } catch (err: any) {
      showToast(err?.message || '更新失败', { type: 'error' });
    }
  };

  const shouldShowBifrostWhitelistCard =
    (activeTab === 'all' || activeTab === 'bifrost') &&
    (!searchQuery || 'bifrost.allowed_folders'.includes(searchQuery.toLowerCase()) || '白名单'.includes(searchQuery));

  return (
    <div className="space-y-6">
      {/* 页面主标题说明 */}
      <div>
        <h2 className="font-serif text-xl font-semibold text-ink">系统设置</h2>
        <p className="text-sm text-ink-light font-sans mt-1">
          平台级服务密钥、接口代理与请求速率配置；修改后对后续请求立即生效
        </p>
      </div>

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
              placeholder="如 douban.proxy 或 harvard.api_key"
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
            {edit.key.endsWith('.use_proxy') ? (
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setEdit({ ...edit, value: edit.value === 'true' ? 'false' : 'true' })}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    edit.value === 'true'
                      ? 'bg-accent/15 text-accent border-accent/30'
                      : 'bg-paper-grid/40 text-ink-light border-paper-grid'
                  }`}
                >
                  {edit.value === 'true' ? '✓ 已启用代理 (true)' : '✗ 已关闭代理 (false)'}
                </button>
                <span className="text-xs text-ink-faint font-sans">点击切换 true / false</span>
              </div>
            ) : (
              <Input
                value={edit.value}
                onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                placeholder={
                  edit.sensitive ? '留空 / 保持 **** 不修改密钥' : '设置值'
                }
              />
            )}
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

      {/* 核心配置两栏工作台：左侧极简 Sticky 导航 + 右侧主内容区 */}
      {!loading && !error && (
        <div className="flex flex-col md:flex-row items-start gap-8">
          {/* 左侧一体化极简分类侧栏 (Sticky 固定) */}
          <aside className="w-full md:w-52 shrink-0 md:sticky md:top-6 space-y-1">
            <div className="px-3 py-1.5 text-xs font-serif font-medium text-ink-light tracking-wide">
              配置分类
            </div>
            <nav className="space-y-1" aria-label="设置分类导航" role="tablist">
              {tabList.map((tab) => {
                const isActive = activeTab === tab.id;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-sans transition-all duration-150 active:scale-[0.96] text-left ${
                      isActive
                        ? 'bg-accent text-white font-medium shadow-xs'
                        : 'text-ink-light hover:text-ink hover:bg-paper-grid/40'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 truncate">
                      <Icon
                        size={15}
                        strokeWidth={1.5}
                        className={isActive ? 'text-white shrink-0' : 'text-ink-faint shrink-0'}
                      />
                      <span className="truncate">{tab.name}</span>
                    </div>
                    <span
                      className={`ml-2 px-1.5 py-0.5 text-[10px] rounded-pill font-mono tabular-nums leading-none shrink-0 ${
                        isActive
                          ? 'bg-white/20 text-white font-semibold'
                          : 'bg-paper-grid/60 text-ink-faint'
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </nav>

            {/* 左侧底部概览 */}
            <div className="pt-3 mt-4 border-t border-dashed border-paper-grid px-3 flex items-center justify-between text-[11px] text-ink-faint font-sans">
              <span>共 {items.length} 项设置</span>
              <span className="text-accent font-medium font-mono tabular-nums">已就绪</span>
            </div>
          </aside>

          {/* 右侧主配置内容区 */}
          <div className="flex-1 min-w-0 w-full space-y-4">
            {/* 顶栏控制条：搜索过滤框 + 新建设置项按钮 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-dashed border-paper-grid">
              <div className="relative flex-1 max-w-sm">
                <Search
                  size={14}
                  strokeWidth={1.5}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索配置键名、值或说明..."
                  className="w-full h-9 pl-9 pr-8 text-xs rounded-lg border border-dashed border-paper-grid bg-node-bg text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition font-sans"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    title="清除搜索"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink transition-colors"
                  >
                    <X size={13} strokeWidth={2} />
                  </button>
                )}
              </div>

              <Button
                size="sm"
                onClick={openCreate}
                className="h-9 px-4 active:scale-[0.96] transition-transform shadow-xs shrink-0"
              >
                <Plus size={14} strokeWidth={2} className="mr-1" />
                新建设置项
              </Button>
            </div>

            {/* 分类说明与提示条 */}
            {activeTabMeta.description && (
              <div className="px-4 py-3 rounded-lg bg-accent-surface/30 border border-dashed border-accent/25 text-xs text-ink-light font-sans flex items-start gap-2.5">
                <div className="min-w-0 flex-1 leading-relaxed">
                  <div className="flex items-center gap-1.5 font-medium text-ink mb-0.5">
                    <activeTabMeta.icon size={14} strokeWidth={1.5} className="text-accent" />
                    <span>{activeTabMeta.name}</span>
                    <span className="font-mono text-ink-faint text-[11px] tabular-nums">({filteredItems.length})</span>
                  </div>
                  <span>{activeTabMeta.description}</span>
                  {activeTab === 'glam' && (
                    <p className="mt-1 text-[11px] text-ink-faint font-mono">
                      包含：Europeana · Harvard Art Museums · NYPL · Paris Musées · Smithsonian Open Access
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* 配置项卡片列表 */}
            <div className="space-y-3">
              {/* Bifrost 白名单文件夹专用卡片 */}
              {shouldShowBifrostWhitelistCard && (
                <Card className="p-5 transition-all hover:border-accent/40 shadow-xs">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="font-mono text-xs font-semibold text-accent bg-accent/8 border border-dashed border-accent/30 rounded-md px-2.5 py-1">
                        bifrost.allowed_folders
                      </span>
                      <ShieldCheck size={14} strokeWidth={1.5} className="text-accent" />
                    </div>
                    <button
                      onClick={() => void openWhitelistEditor()}
                      title="编辑白名单"
                      className="p-1.5 rounded-md text-ink-light hover:text-accent hover:bg-accent-surface transition-colors active:scale-[0.96]"
                    >
                      <Pencil size={15} strokeWidth={1.5} />
                    </button>
                  </div>

                  <div className="mt-3 px-3 py-2 rounded-md bg-paper-grid/25 border border-dashed border-paper-grid/80 font-sans text-xs text-ink">
                    {wlSelected.size > 0
                      ? `当前白名单：${bifrostFolders
                          .filter((f) => wlSelected.has(f.id))
                          .map((f) => f.name)
                          .join('、') || '已选择但文件夹不可用'}`
                      : '未配置（允许全部文件夹）'}
                  </div>

                  <p className="mt-2 text-xs text-ink-light font-sans">
                    仅白名单文件夹下的提示词出现在 Bifrost 管理页与画布检索列表
                  </p>
                  {wlLoadError && (
                    <p className="mt-1 text-xs text-error font-sans">{wlLoadError}</p>
                  )}
                </Card>
              )}

              {/* 普通配置项卡片 */}
              {filteredItems
                .filter((s) => s.key !== 'bifrost.allowed_folders')
                .map((s) => (
                  <Card key={s.id} className="p-5 transition-all hover:border-accent/40 shadow-xs">
                    {/* 第一层：Key 徽章 + 时间戳 + 操作按钮 */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                        <span className="font-mono text-xs font-semibold text-accent bg-accent/8 border border-dashed border-accent/30 rounded-md px-2.5 py-1">
                          {s.key}
                        </span>
                        <span className="text-[11px] text-ink-faint font-mono tabular-nums">
                          {new Date(s.updated_at).toLocaleString('zh-CN', { hour12: false })}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => openEdit(s)}
                          title="编辑"
                          className="p-1.5 rounded-md text-ink-light hover:text-accent hover:bg-accent-surface transition-colors active:scale-[0.96]"
                        >
                          <Pencil size={15} strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={() => handleDelete(s)}
                          title="删除"
                          className="p-1.5 rounded-md text-ink-light hover:text-error hover:bg-error/10 transition-colors active:scale-[0.96]"
                        >
                          <Trash2 size={15} strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>

                    {/* 第二层：配置值（use_proxy 采用开关按钮，其余为轻底色等宽框） */}
                    {s.key.endsWith('.use_proxy') ? (
                      <div className="mt-3 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void handleToggleSetting(s)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 active:scale-[0.97] ${
                            s.value === 'true'
                              ? 'bg-accent/15 text-accent border border-accent/30 hover:bg-accent/20'
                              : 'bg-paper-grid/40 text-ink-light border border-dashed border-paper-grid hover:text-ink'
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full transition-colors ${
                              s.value === 'true' ? 'bg-accent animate-pulse' : 'bg-ink-faint'
                            }`}
                          />
                          <span>{s.value === 'true' ? '已启用（走全局代理）' : '已关闭（直连）'}</span>
                        </button>
                        <span className="text-[11px] text-ink-faint font-sans">点击可快速切换</span>
                      </div>
                    ) : (
                      <div className="mt-3 px-3 py-2 rounded-md bg-paper-grid/25 border border-dashed border-paper-grid/80 font-mono text-xs text-ink break-all select-all">
                        {s.sensitive
                          ? s.value
                            ? '••••••••（敏感项已配置掩码保护）'
                            : '（未配置）'
                          : s.value || '（空值）'}
                      </div>
                    )}

                    {/* 第三层：说明文本与提示 */}
                    {s.description && (
                      <p className="mt-2 text-xs text-ink-light font-sans leading-relaxed">{s.description}</p>
                    )}
                    <SensitiveValueHint setting={s} />
                  </Card>
              ))}

              {/* 空状态 */}
              {filteredItems.length === 0 && !shouldShowBifrostWhitelistCard && (
                <Card className="py-14 flex flex-col items-center gap-3 text-center">
                  <SettingsIcon size={32} strokeWidth={1} className="text-ink-faint" />
                  <p className="font-serif text-base text-ink">
                    {searchQuery ? `未找到匹配「${searchQuery}」的配置项` : '当前分类下暂无配置项'}
                  </p>
                  <p className="text-xs text-ink-light font-sans">
                    {searchQuery ? (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="text-accent underline hover:opacity-80 transition"
                      >
                        清空搜索条件
                      </button>
                    ) : (
                      '可点击上方「新建设置项」进行添加'
                    )}
                  </p>
                </Card>
              )}
            </div>
          </div>
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
          <div className="max-h-72 overflow-y-auto border border-dashed border-paper-grid rounded-md p-1 custom-scrollbar">
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

