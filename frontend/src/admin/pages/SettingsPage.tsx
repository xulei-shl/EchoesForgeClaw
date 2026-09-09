import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  BookOpen,
  Bot,
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
  Server,
  Settings as SettingsIcon,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { adminService } from '../../shared/services/admin';
import type { AppSetting, BifrostFolder } from '../../shared/types';
import { Button } from '../../shared/components/ui/Button';
import { Input } from '../../shared/components/ui/Input';
import { Card } from '../../shared/components/ui/Card';
import { Dialog } from '../../shared/components/ui/Dialog';
import { Select } from '../../shared/components/ui/Select';
import { Toggle } from '../../shared/components/ui/Toggle';
import { FieldLabel } from '../components/AdminBits';
import { useFeedback } from '../../shared/components/ui/FeedbackProvider';

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
  { key: 'tavily.api_key', description: '网络搜索节点 Tavily API Key（https://tavily.com 注册获取；敏感，仅显示掩码）' },
  { key: 'exa.api_key', description: '网络搜索节点 Exa API Key（https://exa.ai 注册获取；敏感，仅显示掩码）' },
  { key: 'anysearch.api_key', description: '网络搜索节点 AnySearch API Key（https://anysearch.com 注册获取；敏感，仅显示掩码；支持匿名调用）' },
  { key: 'doubao.api_key', description: '网络搜索节点豆包搜索 API Key（https://console.volcengine.com/search-infinity 获取；敏感，仅显示掩码）' },
  { key: 'service.map_poster.base_url', description: '城市地图海报 FastAPI 基础地址（默认 http://127.0.0.1:8100）' },
  { key: 'service.map_art.base_url', description: '艺术地图海报 (prettymaps) FastAPI 基础地址（默认 http://127.0.0.1:8101）' },
  { key: 'service.patterns.base_url', description: '中国传统纹样 FastAPI 基础地址（默认 http://127.0.0.1:8102）' },
  { key: 'service.colors.base_url', description: '中国传统配色 FastAPI 基础地址（默认 http://127.0.0.1:8103）' },
  { key: 'http.proxy', description: '全局 HTTP 代理地址（如 http://127.0.0.1:7890；留空 = 全部直连）' },
  { key: 'loc.use_proxy', description: 'LoC 国会图书馆检索/图片是否使用全局代理（true = 启用，false = 直连）' },
  { key: 'google_translate.use_proxy', description: 'Google 翻译是否使用全局代理（true = 启用，false = 直连）' },
  { key: 'deeplx.use_proxy', description: 'DeepLX 翻译是否使用全局代理（true = 启用，false = 直连；未配置默认直连）' },
  { key: 'pi.guardrails.enabled', description: 'Pi Agent 安全护栏总开关（false = 关闭全部 Guardrails 检查，不建议）' },
  { key: 'pi.guardrails.features.policies', description: 'Pi Agent 文件保护策略（.env / 私钥等敏感文件禁止 Agent 读取与修改）' },
  { key: 'pi.guardrails.features.permission_gate', description: 'Pi Agent 危险命令确认（递归删除 / 提权 / 格式化等危险命令触发确认）' },
  { key: 'pi.guardrails.features.path_access', description: 'Pi Agent 越界路径访问控制（工作区外的文件访问拦截）' },
  { key: 'pi.guardrails.path_access.mode', description: 'Pi Agent 越界路径访问模式：block/ask/allow' },
  { key: 'pi.guardrails.path_access.allowed_paths', description: 'Pi Agent 越界路径放行白名单（JSON 数组，如 [{"kind":"file","path":"/data/x.txt"},{"kind":"directory","path":"/data/y"}]）' },
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
    id: 'microservices',
    name: '本地微服务',
    icon: Server,
    description: '画布多模态节点依赖的本地 Python FastAPI 扩展微服务基础地址（城市地图海报、艺术地图海报、中国传统纹样与中国传统配色）',
    match: (key) => key.startsWith('service.') || key.startsWith('services.'),
  },
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
      key.startsWith('exa.') ||
      key.startsWith('anysearch.') ||
      key.startsWith('doubao.') ||
      key.startsWith('serper.') ||
      key.startsWith('brave.') ||
      key.startsWith('bocha.'),
  },
  {
    id: 'pi',
    name: 'Pi Agent',
    icon: Bot,
    description: 'Skill Agent（pi）运行时配置：安全护栏（Guardrails）的文件保护策略 / 危险命令确认 / 越界路径访问控制',
    match: (key) => key.startsWith('pi.'),
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

/** 内存级 SWR 缓存：支持路由切换/返回时 0ms 瞬间直出，并在后台静默更新 */
let cachedSettingsData: AppSetting[] | null = null;
let cachedBifrostFoldersData: BifrostFolder[] | null = null;

/** Pi Agent 安全护栏（guardrails）设置键 → admin/settings 键名（与后端 seed.ts / guardrails.ts 对齐） */
const PI_GUARDRAILS_KEYS: Record<string, string> = {
  enabled: 'pi.guardrails.enabled',
  policies: 'pi.guardrails.features.policies',
  permissionGate: 'pi.guardrails.features.permission_gate',
  pathAccess: 'pi.guardrails.features.path_access',
  accessMode: 'pi.guardrails.path_access.mode',
  allowedPaths: 'pi.guardrails.path_access.allowed_paths',
  prefix: 'pi.guardrails.',
};

const PI_GUARDRAILS_FEATURE_DEFS: { key: string; label: string; desc: string }[] = [
  {
    key: PI_GUARDRAILS_KEYS.policies,
    label: '文件保护策略（policies）',
    desc: '保护 .env / 私钥等敏感文件，禁止 Agent 读取与修改；内置 agent-runtime 规则额外保护 .pi-agent/**（含真实 API Key）',
  },
  {
    key: PI_GUARDRAILS_KEYS.permissionGate,
    label: '危险命令确认（permissionGate）',
    desc: '递归删除 / 提权 / 格式化等危险命令在执行前经确认弹窗二次确认（Allow once / Deny / Stop）',
  },
  {
    key: PI_GUARDRAILS_KEYS.pathAccess,
    label: '越界路径访问控制（pathAccess）',
    desc: '拦截工作区之外的路径访问；mode=block 时越界一律拒绝（RPC 交互不可用，确定性最高）',
  },
];

/**
 * 从已加载的 settings 项解析 Pi Agent 安全护栏配置（缺键 → 内置默认值）。
 * 用于渲染可管理的护栏配置面板：开关 + 模式选择 + 放行路径列表。
 */
function resolvePiGuardrails(items: AppSetting[]) {
  const get = (key: string, fallback: string): string => {
    const s = items.find((it) => it.key === key);
    return s ? s.value : fallback;
  };
  const enabled = get(PI_GUARDRAILS_KEYS.enabled, 'true') === 'true';
  const policies = get(PI_GUARDRAILS_KEYS.policies, 'true') === 'true';
  const permissionGate = get(PI_GUARDRAILS_KEYS.permissionGate, 'true') === 'true';
  const pathAccess = get(PI_GUARDRAILS_KEYS.pathAccess, 'true') === 'true';
  const mode = get(PI_GUARDRAILS_KEYS.accessMode, 'block');
  const raw = get(PI_GUARDRAILS_KEYS.allowedPaths, '[]');
  let allowedPaths: { kind: string; path: string }[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) allowedPaths = parsed;
  } catch {
    /* 非法 JSON：视为空 */
  }
  return { enabled, policies, permissionGate, pathAccess, mode, allowedPaths, rawAllowedPaths: raw };
}

interface AllowedPathRow {
  kind: 'file' | 'directory';
  path: string;
}

const PI_PATHACCESS_MODE_OPTIONS = [
  { label: 'block（一律拒绝，RPC 推荐）', value: 'block' },
  { label: 'ask（询问用户）', value: 'ask' },
  { label: 'allow（放行并记录）', value: 'allow' },
];

/**
 * Pi Agent 安全护栏（Guardrails）可视化管理卡片：
 * 开关（总控 + 三档功能）+ 越界路径模式 + 放行路径列表。
 * 每个开关即时落库（upsert app_settings），放行路径列表以 JSON 数组整体保存。
 */
function PiGuardrailsConfigCard({
  items,
  onChanged,
}: {
  items: AppSetting[];
  onChanged: (next: AppSetting[]) => void;
}) {
  const { showToast } = useFeedback();
  const [saving, setSaving] = useState(false);
  const g = resolvePiGuardrails(items);

  // 放行路径编辑草稿（独立于 items，保存前不写入选区）
  const [pathRows, setPathRows] = useState<AllowedPathRow[]>(() =>
    g.allowedPaths.filter(
      (p): p is AllowedPathRow => (p.kind === 'file' || p.kind === 'directory') && !!p.path
    )
  );
  const [pathsSaved, setPathsSaved] = useState(false);

  // items 变化（如外部刷新）时同步放行路径草稿，避免显示过期数据
  const rawAllowed = g.rawAllowedPaths;
  const lastRawRef = useRef(rawAllowed);
  useEffect(() => {
    if (lastRawRef.current !== rawAllowed) {
      lastRawRef.current = rawAllowed;
      setPathRows(
        g.allowedPaths.filter(
          (p): p is AllowedPathRow => (p.kind === 'file' || p.kind === 'directory') && !!p.path
        )
      );
      setPathsSaved(false);
    }
  }, [rawAllowed, g.allowedPaths]);

  const setSetting = async (key: string, value: string, description = '') => {
    const existing = items.find((it) => it.key === key);
    const updated = existing
      ? await adminService.updateSetting(key, { value })
      : await adminService.createSetting({ key, value, description });
    onChanged(
      existing ? items.map((it) => (it.key === key ? updated : it)) : [...items, updated]
    );
    return updated;
  };

  const toggleBoolean = async (key: string, current: boolean, label: string) => {
    try {
      setSaving(true);
      await setSetting(key, current ? 'false' : 'true');
      showToast(`已${current ? '关闭' : '开启'}${label}`, { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || '保存失败，请重试', { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const changeMode = async (value: string) => {
    try {
      setSaving(true);
      await setSetting(PI_GUARDRAILS_KEYS.accessMode, value);
      showToast(`越界路径模式已更新为 ${value}`, { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || '保存失败，请重试', { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const validatePathRows = (): string | null => {
    const cleaned = pathRows.filter((r) => r.path.trim());
    if (pathRows.some((r) => !r.path.trim())) return '存在未填写路径的空行，请补全或删除';
    if (cleaned.some((r) => r.kind !== 'file' && r.kind !== 'directory')) return '放行路径类型非法';
    return null;
  };

  const savePaths = async () => {
    const err = validatePathRows();
    if (err) {
      showToast(err, { type: 'error' });
      return;
    }
    try {
      setSaving(true);
      const cleaned = pathRows.filter((r) => r.path.trim());
      const json = JSON.stringify(cleaned);
      await setSetting(PI_GUARDRAILS_KEYS.allowedPaths, json);
      setPathsSaved(true);
      showToast(cleaned.length ? `已保存 ${cleaned.length} 条放行路径` : '已清空放行路径', { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || '保存失败，请重试', { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const renderToggleRow = (label: string, desc: string, checked: boolean, onToggle: () => void) => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-sm text-ink font-medium font-sans">{label}</p>
        <p className="text-xs text-ink-light font-sans leading-relaxed mt-0.5">{desc}</p>
      </div>
      <Toggle checked={checked} onChange={onToggle} disabled={saving} className="shrink-0" />
    </div>
  );

  return (
    <Card className="p-5 border-accent/30 shadow-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Bot size={16} strokeWidth={1.5} className="text-accent shrink-0" />
          <span className="font-serif text-base font-semibold text-ink">Pi Agent 安全护栏（Guardrails）</span>
        </div>
        <span className="text-[11px] text-ink-faint font-mono shrink-0">pi.guardrails.*</span>
      </div>
      <p className="mt-1 text-xs text-ink-light font-sans leading-relaxed">
        Skill Agent（pi）装配期自动写入 <code className="font-mono text-accent">.pi-agent/extensions/guardrails.json</code>，
        新对话工作区生效；此处修改即时入库，无需重启后端
      </p>

      <div className="mt-4 border-t border-dashed border-paper-grid pt-3 space-y-1">
        {renderToggleRow(
          '安全护栏总开关',
          '关闭后全部 Guardrails 检查均不生效（泄露 .env / 私钥等风险自负，不建议）',
          g.enabled,
          () => void toggleBoolean(PI_GUARDRAILS_KEYS.enabled, g.enabled, '安全护栏')
        )}
        {PI_GUARDRAILS_FEATURE_DEFS.map((f) => {
          const checked =
            f.key === PI_GUARDRAILS_KEYS.policies
              ? g.policies
              : f.key === PI_GUARDRAILS_KEYS.permissionGate
                ? g.permissionGate
                : g.pathAccess;
          return renderToggleRow(f.label, f.desc, checked, () =>
            void toggleBoolean(f.key, checked, f.label.split('（')[0])
          );
        })}
      </div>

      <div className="mt-4 border-t border-dashed border-paper-grid pt-4">
        <p className="text-sm text-ink font-medium font-sans">越界路径访问模式</p>
        <div className="mt-2 max-w-xs">
          <Select
            size="sm"
            value={g.mode}
            onChange={(v) => void changeMode(v)}
            options={PI_PATHACCESS_MODE_OPTIONS}
            disabled={saving}
          />
        </div>
        <p className="mt-1.5 text-xs text-ink-faint font-sans">
          RPC 模式下 ask 会退化为「一律拒绝」且语义含糊，block 确定性最高；模式变更需新装配工作区生效
        </p>
      </div>

      <div className="mt-4 border-t border-dashed border-paper-grid pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-ink font-medium font-sans">越界放行路径（allowedPaths）</p>
            <p className="text-xs text-ink-light font-sans mt-0.5">
              仅 mode=allow 时有意义：file 精确匹配 / directory 匹配目录及其后代；支持 <code className="font-mono">~/</code> 前缀
            </p>
          </div>
          {pathsSaved && <span className="text-[11px] text-accent font-sans shrink-0">已保存</span>}
        </div>
        <div className="mt-3 space-y-2">
          {pathRows.map((row, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Select
                size="sm"
                className="w-28 shrink-0"
                value={row.kind}
                onChange={(v) =>
                  setPathRows((prev) =>
                    prev.map((r, i) => (i === idx ? { ...r, kind: v as AllowedPathRow['kind'] } : r))
                  )
                }
                options={[
                  { label: 'file（文件）', value: 'file' },
                  { label: 'directory（目录）', value: 'directory' },
                ]}
              />
              <Input
                className="flex-1"
                value={row.path}
                placeholder="如 /data/export"
                onChange={(e) =>
                  setPathRows((prev) =>
                    prev.map((r, i) => (i === idx ? { ...r, path: e.target.value } : r))
                  )
                }
              />
              <button
                type="button"
                onClick={() => setPathRows((prev) => prev.filter((_, i) => i !== idx))}
                title="删除此行"
                className="p-1.5 rounded-md text-ink-light hover:text-error hover:bg-error/10 transition-colors active:scale-[0.96] shrink-0"
              >
                <Trash2 size={14} strokeWidth={1.5} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPathRows((prev) => [...prev, { kind: 'file', path: '' }])}
            className="inline-flex items-center gap-1 text-xs text-accent font-medium hover:opacity-80 transition-opacity"
          >
            <Plus size={13} strokeWidth={2} />
            添加放行路径
          </button>
        </div>
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={() => void savePaths()} isLoading={saving}>
            保存放行路径
          </Button>
        </div>
      </div>
    </Card>
  );
}

export const SettingsPage: React.FC = () => {
  const [items, setItems] = useState<AppSetting[]>(() => cachedSettingsData ?? []);
  const [loading, setLoading] = useState(() => !cachedSettingsData);
  const [error, setError] = useState('');

  const [activeTab, setActiveTab] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [showCreate, setShowCreate] = useState(false);
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const { dialog, showToast } = useFeedback();

  // Bifrost 白名单文件夹（bifrost.allowed_folders）专用配置 UI
  const [bifrostFolders, setBifrostFolders] = useState<BifrostFolder[]>(() => cachedBifrostFoldersData ?? []);
  const [bifrostLoading, setBifrostLoading] = useState(false);
  const [wlOpen, setWlOpen] = useState(false);
  const [wlSelected, setWlSelected] = useState<Set<string>>(() => {
    if (cachedSettingsData && cachedBifrostFoldersData) {
      const raw = (cachedSettingsData.find((s) => s.key === 'bifrost.allowed_folders')?.value || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const selected = new Set<string>();
      if (raw.length) {
        for (const f of cachedBifrostFoldersData) {
          if (raw.includes(String(f.id).toLowerCase()) || raw.includes((f.name || '').toLowerCase())) {
            selected.add(f.id);
          }
        }
      }
      return selected;
    }
    return new Set();
  });
  const [wlSaving, setWlSaving] = useState(false);
  const [wlLoadError, setWlLoadError] = useState('');

  // 1. 加载本地系统设置：毫秒级响应，优先渲染主界面，不被外部网关阻塞
  const loadSettings = useCallback(async (silent = false) => {
    if (!silent && !cachedSettingsData) {
      setLoading(true);
    }
    setError('');
    try {
      const res = await adminService.listSettings();
      cachedSettingsData = res;
      setItems(res);
      // 同步回显白名单勾选（基于当前已有的 bifrostFolders）
      setBifrostFolders((currFolders) => {
        const raw = (res.find((s) => s.key === 'bifrost.allowed_folders')?.value || '')
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        const selected = new Set<string>();
        if (raw.length && currFolders.length) {
          for (const f of currFolders) {
            if (raw.includes(String(f.id).toLowerCase()) || raw.includes((f.name || '').toLowerCase())) {
              selected.add(f.id);
            }
          }
        }
        setWlSelected(selected);
        return currFolders;
      });
    } catch (e: any) {
      if (!cachedSettingsData) {
        setError(e?.message || '加载失败，请重试');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // 2. 独立异步后台加载 Bifrost 文件夹：网络抖动或服务不可用绝不影响主系统设置
  const loadBifrostFolders = useCallback(async (force = false) => {
    setBifrostLoading(true);
    setWlLoadError('');
    try {
      const folderRes = await adminService.listBifrostFolders({ all: true, force });
      const folders = folderRes?.folders ?? [];
      cachedBifrostFoldersData = folders;
      setBifrostFolders(folders);

      // 同步白名单勾选项
      setItems((currItems) => {
        const raw = (currItems.find((s) => s.key === 'bifrost.allowed_folders')?.value || '')
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
        return currItems;
      });
    } catch (e: any) {
      setWlLoadError(e?.message || 'Bifrost 未配置或不可用');
    } finally {
      setBifrostLoading(false);
    }
  }, []);

  const load = useCallback(async (force = false) => {
    const isCached = !force && !!cachedSettingsData;
    void loadSettings(isCached);
    void loadBifrostFolders(force);
  }, [loadSettings, loadBifrostFolders]);

  useEffect(() => {
    void load();
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
        const updated = await adminService.updateSetting(edit.key, { value: edit.value, description: edit.description });
        showToast('设置已更新', { type: 'success' });
        setItems((prev) => {
          const next = prev.map((it) => (it.key === edit.key ? updated : it));
          cachedSettingsData = next;
          return next;
        });
      } else {
        const created = await adminService.createSetting({
          key: edit.key.trim(),
          value: edit.value,
          description: edit.description,
        });
        showToast('设置已创建', { type: 'success' });
        setItems((prev) => {
          const next = [...prev, created];
          cachedSettingsData = next;
          return next;
        });
      }
      resetForm();
      void loadSettings(true);
    } catch (err: any) {
      setFormError(err?.message || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  /** 打开白名单编辑：直接基于当前已加载的配置回显，不发起多余网络请求 */
  const openWhitelistEditor = () => {
    // 如果尚未获取文件夹数据且不在加载中，触发后台拉取
    if (bifrostFolders.length === 0 && !bifrostLoading) {
      void loadBifrostFolders();
    }
    const raw = (items.find((s) => s.key === 'bifrost.allowed_folders')?.value || '')
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
      // 即时局部更新状态与内存缓存
      setItems((prev) => {
        const next = prev.map((it) =>
          it.key === 'bifrost.allowed_folders' ? { ...it, value: ids.join(',') } : it
        );
        cachedSettingsData = next;
        return next;
      });
      void loadSettings(true);
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
      setItems((prev) => {
        const next = prev.filter((it) => it.key !== s.key);
        cachedSettingsData = next;
        return next;
      });
      void loadSettings(true);
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
      setItems((prev) => {
        const next = prev.map((it) => (it.key === s.key ? { ...it, value: nextVal } : it));
        cachedSettingsData = next;
        return next;
      });
      void loadSettings(true);
    } catch (err: any) {
      showToast(err?.message || '更新失败', { type: 'error' });
    }
  };

  const shouldShowBifrostWhitelistCard =
    (activeTab === 'all' || activeTab === 'bifrost') &&
    (!searchQuery || 'bifrost.allowed_folders'.includes(searchQuery.toLowerCase()) || '白名单'.includes(searchQuery));

  const shouldShowPiGuardrailsCard =
    (activeTab === 'all' || activeTab === 'pi') &&
    (!searchQuery || 'pi.guardrails'.includes(searchQuery.toLowerCase()) || '护栏'.includes(searchQuery) || 'Pi Agent'.toLowerCase().includes(searchQuery.toLowerCase()));

  const applyItems = (next: AppSetting[]) => {
    cachedSettingsData = next;
    setItems(next);
  };

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

      {/* 首次冷启动骨架屏（保持两栏同构布局，消除 CLS 视效跳跃） */}
      {loading && items.length === 0 && (
        <div className="flex flex-col md:flex-row items-start gap-8 animate-pulse" aria-busy="true" aria-label="正在加载系统设置">
          {/* 左侧侧栏骨架 */}
          <aside className="w-full md:w-52 shrink-0 space-y-2">
            <div className="h-4 w-16 bg-paper-grid/60 rounded px-3 py-1.5 mb-2" />
            <div className="space-y-1.5">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-8 w-full bg-paper-grid/35 rounded-lg" />
              ))}
            </div>
            <div className="pt-3 mt-4 border-t border-dashed border-paper-grid px-3 flex justify-between">
              <div className="h-3 w-16 bg-paper-grid/40 rounded" />
              <div className="h-3 w-10 bg-paper-grid/40 rounded" />
            </div>
          </aside>

          {/* 右侧内容区骨架 */}
          <div className="flex-1 min-w-0 w-full space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-dashed border-paper-grid">
              <div className="h-9 w-64 bg-paper-grid/45 rounded-lg" />
              <div className="h-9 w-28 bg-paper-grid/45 rounded-lg" />
            </div>
            <div className="h-16 w-full bg-paper-grid/25 rounded-lg border border-dashed border-paper-grid" />
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="p-5 rounded-lg border border-dashed border-paper-grid bg-node-bg space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="h-5 w-40 bg-paper-grid/50 rounded" />
                    <div className="h-4 w-28 bg-paper-grid/35 rounded" />
                  </div>
                  <div className="h-8 w-full bg-paper-grid/25 rounded" />
                  <div className="h-3.5 w-3/4 bg-paper-grid/35 rounded" />
                </div>
              ))}
            </div>
          </div>
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

      {/* 核心配置两栏工作台：有数据时立即渲染（支持 SWR 零等待直出） */}
      {items.length > 0 && (
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
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-sans transition-colors duration-150 active:scale-[0.96] text-left ${
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
                <Card className="p-5 transition-colors duration-150 hover:border-accent/40 shadow-xs">
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
                    {bifrostLoading && bifrostFolders.length === 0 ? (
                      <span className="flex items-center gap-2 text-ink-faint">
                        <Loader2 size={12} className="animate-spin text-accent" />
                        <span>正在同步 Bifrost 文件夹...</span>
                      </span>
                    ) : wlSelected.size > 0 ? (
                      `当前白名单：${bifrostFolders
                          .filter((f) => wlSelected.has(f.id))
                          .map((f) => f.name)
                          .join('、') || (
                            items.find((s) => s.key === 'bifrost.allowed_folders')?.value || '已选择'
                          )}`
                    ) : (
                      '未配置（允许全部文件夹）'
                    )}
                  </div>

                  <p className="mt-2 text-xs text-ink-light font-sans">
                    仅白名单文件夹下的提示词出现在 Bifrost 管理页与画布检索列表
                  </p>
                  {wlLoadError && (
                    <p className="mt-1 text-xs text-error font-sans">{wlLoadError}</p>
                  )}
                </Card>
              )}

              {/* Pi Agent 安全护栏专用卡片（可视化管理，覆盖 pi.guardrails.* 全部键） */}
              {shouldShowPiGuardrailsCard && (
                <PiGuardrailsConfigCard items={items} onChanged={applyItems} />
              )}

              {/* 普通配置项卡片 */}
              {filteredItems
                .filter((s) => s.key !== 'bifrost.allowed_folders' && !s.key.startsWith(PI_GUARDRAILS_KEYS.prefix))
                .map((s) => (
                  <Card key={s.id} className="p-5 transition-colors duration-150 hover:border-accent/40 shadow-xs">
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
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 active:scale-[0.97] ${
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
              {filteredItems.length === 0 && !shouldShowBifrostWhitelistCard && !shouldShowPiGuardrailsCard && (
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
                        className="text-accent underline hover:opacity-80 transition-opacity"
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
            {bifrostLoading && bifrostFolders.length === 0 ? (
              <div className="py-8 flex flex-col items-center justify-center gap-2 text-ink-light text-xs font-sans">
                <Loader2 size={16} className="animate-spin text-accent" />
                <span>正在加载 Bifrost 文件夹...</span>
              </div>
            ) : bifrostFolders.length === 0 ? (
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

