import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ListChecks,
  Loader2,
  MoreVertical,
  PanelRight,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { NodeSideDrawer } from '../../../../platform/components/node/NodeSideDrawer';
import { useFeedback } from '../../../../platform/components/ui/FeedbackProvider';
import { FilePreviewModal } from '../FilePreviewModal';
import { WorkspaceFileTree } from './WorkspaceFileTree';
import { authHeaders } from '../../authUtils';
import { WORKSPACE_FILE_CATEGORIES } from '../../workspaceFiles';
import type { AgentFile } from '../../../../platform/types';
import type { ConversationSessionSummary } from '../../piSessionApi';

/**
 * 节点侧边面板（单一右侧吸附抽屉，Tab 切换内容）：
 *
 * - 顶部三个常驻 Tab 与旧版一致：AI 产物 / 我的上传（树形、可删除）/ 对话历史（载入 / 置顶 / 删除）；
 * - 「全部文件」折叠在「⋮」溢出下拉：工作区完整清单（含 .pi-agent 配置与任意深度 .env* 的名字与目录结构，
 *   敏感文件带锁图标仅可看名字，预览/下载被 skill-files 拒绝；非敏感文件可预览），只读总览；
 * - 文件叶子点击打开统一预览弹层；对话历史 Tab 来源节点由宿主按 workspaceId 前缀解析并标注；
 * - 未来新增 Tab：追加 SideTabId 分支 + tabDescs 条目（primary=false 即落「⋮」溢出），渲染逻辑零改动。
 *
 * 替代旧的双抽屉方案（左侧对话历史 + 右侧工作区文件）：节点底部只保留一个通用入口按钮
 * （「侧边面板」），点击展开同一右侧抽屉，Tab 互斥切换。
 */
export interface ChatSidePanel {
  open: boolean;
  onToggle: () => void;
  filesLoading: boolean;
  files: AgentFile[];
  onRefreshFiles: () => void;
  /** 对话历史区（skill_agent 模式提供；LLM/FastClaw 模式缺省 = 无该 Tab） */
  sessions?: ConversationSessionSummary[];
  sessionsLoading?: boolean;
  currentWorkspaceId?: string | null;
  onRefreshSessions?: () => void;
  onSelectSession?: (workspaceId: string) => void;
  onTogglePin?: (workspaceId: string, pinned: boolean) => Promise<void>;
  onRenameSession?: (workspaceId: string, title: string) => Promise<void>;
  onDeleteSession?: (workspaceId: string) => Promise<void>;
  /** 文件行删除（AI 产物 / 我的上传 Tab；「全部文件」Tab 恒只读，不展示删除入口） */
  onDeleteFile?: (file: AgentFile) => Promise<void>;
  /**
   * 批量删除文件（多选删除 / 全部清空共用；AI 产物 / 我的上传 Tab）。
   * 宿主内串行复用单删接口、删除结束只刷新一次；返回成功 / 失败计数。
   */
  onBatchDeleteFiles?: (files: AgentFile[]) => Promise<{ ok: number; failed: number }>;
  /**
   * 批量删除会话（多选删除 / 全部清空共用；对话历史 Tab，作用于该模式全局列表）。
   * 宿主内串行复用单删接口、删除结束只刷新一次；返回成功 / 失败计数。
   * 缺省 = 不展示对话历史 Tab 的批量入口。
   */
  onBatchDeleteSessions?: (workspaceIds: string[]) => Promise<{ ok: number; failed: number }>;
  /** 来源节点解析（全局列表时按 workspaceId 前缀找画布节点标题；缺省 = 不标注） */
  sourceNodeOf?: (workspaceId: string) => { title: string } | null;
}

/** 文件下载（skill-files / fastclaw-files 接口要求登录鉴权，统一 fetch → blob → 触发保存）。 */
async function downloadAgentFile(file: AgentFile): Promise<void> {
  const resp = await fetch(file.url, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 会话更新时间展示（本年省略年份：MM-DD HH:mm；跨年带年份）。 */
function formatConversationTime(ts: number): string {
  if (!ts || !Number.isFinite(ts) || ts <= 0) return '';
  const d = new Date(ts);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date =
    d.getFullYear() === now.getFullYear()
      ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 会话行元信息：更新时间 · 轮次数（任一缺失时只展示另一项）。 */
function sessionMetaLine(s: ConversationSessionSummary): string {
  const parts: string[] = [];
  const time = formatConversationTime(s.updatedAt);
  if (time) parts.push(time);
  if (s.messageCount > 0) parts.push(`${s.messageCount} 轮`);
  return parts.join(' · ');
}

/**
 * 侧边面板入口条（节点底部，输入区上方）：点击展开/收起右侧吸附抽屉。
 * 单一通用按钮，不区分内容类别——抽屉内用 Tab 承载工作区文件与对话历史。
 */
export const ChatSidePanelTrigger: React.FC<{ panel: ChatSidePanel }> = ({ panel }) => {
  const loading = panel.filesLoading || !!panel.sessionsLoading;
  return (
    <div className="shrink-0 flex items-center gap-1.5">
      <button
        type="button"
        onClick={panel.onToggle}
        aria-expanded={panel.open}
        title={panel.open ? '收起侧边面板' : '展开侧边面板（工作区文件 / 对话历史）'}
        className={`flex items-center gap-1.5 text-[11px] font-sans transition-[color] duration-150 cursor-pointer select-none active:scale-[0.98] ${
          panel.open ? 'text-accent font-medium' : 'text-ink-faint hover:text-accent'
        }`}
      >
        <PanelRight size={12} strokeWidth={2} />
        <span>侧边面板</span>
        <ChevronDown
          size={11}
          strokeWidth={2}
          className={`transition-transform duration-200 ease-out ${panel.open ? 'rotate-180' : ''}`}
        />
      </button>
      {loading && <Loader2 size={10} className="animate-spin text-ink-faint" />}
    </div>
  );
};

/** 抽屉 Tab：全部文件 / 两个文件类别（WORKSPACE_FILE_CATEGORIES 注册表）/ 对话历史。
 *  未来新增 Tab：追加 SideTabId 分支 + tabDescs 条目（primary=false 时自动落入「…」溢出下拉），
 *  无需改动 Tab 栏渲染逻辑。 */
type SideTabId = 'all' | 'artifacts' | 'uploads' | 'history';

interface SideTabDesc {
  id: SideTabId;
  label: string;
  /** Tab 计数（文件类别 = 文件数；对话历史 = 会话数） */
  badge: number;
  /** 空桶置灰（文件类别无文件时不可点） */
  disabled?: boolean;
  /** 常驻 Tab 栏；false = 折叠进「…」溢出下拉 */
  primary: boolean;
}

/**
 * 侧边面板抽屉（挂在 CanvasNode 的 sideDrawer 根级插槽，见 docs/节点侧边吸附抽屉使用指南.md）：
 * - 顶部 = 三个常驻主 Tab（文件类别空桶置灰不可点 / 对话历史始终可点）+ 「⋮」溢出下拉
 *   （「全部文件」只读总览初始落折叠；未来新增 Tab 追加 tabDescs 的 primary=false 条目即可）；
 * - 文件 Tab：按 path 构建目录树（目录在前、文件在后，默认全展开）；
 *   AI 产物 / 我的上传 Tab 行内删除 + 批量删除；「全部文件」Tab 只读（敏感文件带锁图标仅看名字）；
 *   叶子点击打开统一预览弹层（FilePreviewModal，图片 / 文本 / PDF 内联预览，二进制给下载引导）；
 * - 对话历史行：点击载入会话到节点，行内置顶 / 重命名 / 删除（带危险确认框）。
 */
export const ChatSidePanelDrawer: React.FC<{ panel: ChatSidePanel }> = ({ panel }) => {
  const { dialog, showToast } = useFeedback();
  const [activeTab, setActiveTab] = useState<SideTabId>('artifacts');
  const [previewFile, setPreviewFile] = useState<AgentFile | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  /** 批量管理选择态：进入后行点击 = 勾选切换，行内操作 / 预览 / 载入暂停 */
  const [selectMode, setSelectMode] = useState(false);
  /** 批量勾选集合：文件行键 = path（兜底 url）；会话行键 = workspaceId */
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  /** 批量删除进行中（工具条按钮禁用 + 加载态） */
  const [batchBusy, setBatchBusy] = useState(false);
  /** 「…」溢出下拉展开态（未来非 primary Tab 的收纳菜单） */
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  // 溢出下拉点击外部关闭：NodeSideDrawer 在冒泡阶段 stopPropagation，需用捕获阶段监听才能收到抽屉内点击
  useEffect(() => {
    if (!overflowOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) setOverflowOpen(false);
    };
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  }, [overflowOpen]);

  const sessions = panel.sessions;
  const hasHistory = !!sessions;
  // 文件数据源（单请求 include_agent_runtime=1）：
  // - allFiles = 完整清单（含 .pi-agent 配置名与 .env* 名字，敏感文件 previewable=false）；「全部文件」Tab 用全量；
  // - regularFiles = 排除 .pi-agent 与不可预览密钥文件的可预览常规文件；AI 产物 / 我的上传 分桶用。
  const allFiles = panel.files;
  const regularFiles = allFiles.filter(
    (f) => !f.path.startsWith('.pi-agent/') && f.previewable !== false
  );
  const fileTabs = WORKSPACE_FILE_CATEGORIES.map((category) => ({
    category,
    files: regularFiles.filter(category.matches),
  }));
  // 激活 Tab = 用户所选且仍有效（全部文件非空 / 文件类别非空 / 对话历史可用），
  // 否则回退：全部文件 → 第一个非空类别 → 对话历史，避免选中 Tab 随列表刷新后悬空
  const resolvedTab: SideTabId = (() => {
    const activeValid =
      (activeTab === 'all' && allFiles.length > 0) ||
      (activeTab === 'history' && hasHistory) ||
      (activeTab !== 'all' &&
        activeTab !== 'history' &&
        fileTabs.some((t) => t.category.id === activeTab && t.files.length > 0));
    if (activeValid) return activeTab;
    if (allFiles.length > 0) return 'all';
    const firstNonEmpty = fileTabs.find((t) => t.files.length > 0);
    if (firstNonEmpty) return firstNonEmpty.category.id;
    return hasHistory ? 'history' : 'all';
  })();
  // 激活文件 Tab 的叶子集（全部 / 类别分桶）
  const activeFiles =
    resolvedTab === 'all'
      ? allFiles
      : (fileTabs.find((t) => t.category.id === resolvedTab)?.files ?? []);
  // 批量工具条：文件 Tab（AI 产物 / 我的上传，缺省「全部文件」只读无批量）与对话历史 Tab
  const sessionsAll = sessions ?? [];
  const isFileTab = resolvedTab !== 'all' && resolvedTab !== 'history';
  const showFileBatchBar = isFileTab && !!panel.onBatchDeleteFiles && activeFiles.length > 0;
  const showHistoryBatchBar = resolvedTab === 'history' && !!panel.onBatchDeleteSessions && sessionsAll.length > 0;
  const canDeleteFiles = isFileTab && !!panel.onDeleteFile;

  // Tab 注册表：顶部三个常驻主 Tab（AI 产物 / 我的上传 / 对话历史）+ 「全部文件」折叠进「…」溢出下拉
  // （用户视角：默认看到与旧版一致的三个 Tab；「全部文件」只读总览走竖向三点菜单）。
  // 未来新增 Tab：追加条目（primary=false 即落溢出），无需改动 Tab 栏渲染逻辑。
  const tabDescs: SideTabDesc[] = [
    ...fileTabs.map(({ category, files }) => ({
      id: category.id as SideTabId,
      label: category.label,
      badge: files.length,
      disabled: files.length === 0,
      primary: true,
    })),
    ...(hasHistory
      ? [{ id: 'history' as const, label: '对话历史', badge: sessions!.length, primary: true }]
      : []),
    {
      id: 'all' as const,
      label: '全部文件',
      badge: allFiles.length,
      disabled: allFiles.length === 0,
      primary: false,
    },
  ];
  const primaryTabs = tabDescs.filter((t) => t.primary);
  const overflowTabs = tabDescs.filter((t) => !t.primary);
  const activeInOverflow = overflowTabs.some((t) => t.id === resolvedTab);

  // 切换 Tab / 收起抽屉：退出批量选择态并清空勾选
  useEffect(() => {
    setSelectMode(false);
    setSelectedKeys(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTab, panel.open]);

  const handleTogglePin = async (s: ConversationSessionSummary) => {
    if (!panel.onTogglePin) return;
    setPinningId(s.workspaceId);
    try {
      await panel.onTogglePin(s.workspaceId, !s.pinned);
    } catch {
      showToast('置顶操作失败，请重试', { type: 'error' });
    } finally {
      setPinningId(null);
    }
  };

  const handleRename = async (s: ConversationSessionSummary, title: string) => {
    if (!panel.onRenameSession) return;
    setRenamingId(s.workspaceId);
    try {
      await panel.onRenameSession(s.workspaceId, title);
      showToast('对话已重命名', { type: 'success' });
    } catch {
      showToast('重命名失败，请重试', { type: 'error' });
    } finally {
      setRenamingId(null);
    }
  };

  const handleDelete = async (s: ConversationSessionSummary) => {
    if (!panel.onDeleteSession) return;
    const ok = await dialog.confirm({
      title: '删除对话',
      message: `确定删除「${s.title}」吗？该对话的完整数据（会话历史、产物文件与上传附件）将被永久删除，无法恢复。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    setDeletingId(s.workspaceId);
    try {
      await panel.onDeleteSession(s.workspaceId);
      showToast('对话已删除', { type: 'success' });
    } catch {
      showToast('删除失败，请重试', { type: 'error' });
    } finally {
      setDeletingId(null);
    }
  };

  const handleSelect = (s: ConversationSessionSummary) => {
    // 只载入会话到节点，不自动收起抽屉——抽屉仅由用户手动关闭（Esc / 关闭按钮 / 底部入口条）
    panel.onSelectSession?.(s.workspaceId);
  };

  /** AI 产物 / 我的上传 Tab 单删（「全部文件」Tab 只读，不回调） */
  const handleDeleteFile = async (file: AgentFile) => {
    if (!panel.onDeleteFile) return;
    const ok = await dialog.confirm({
      title: '删除文件',
      message: `确定删除「${file.name}」吗？该文件将从工作区中永久删除，无法恢复。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    setDeletingPath(file.path);
    try {
      await panel.onDeleteFile(file);
      showToast('文件已删除', { type: 'success' });
    } catch {
      showToast('删除失败，请重试', { type: 'error' });
    } finally {
      setDeletingPath(null);
    }
  };

  const handleDownload = async (file: AgentFile) => {
    try {
      await downloadAgentFile(file);
    } catch {
      showToast('文件下载失败，请重试', { type: 'error' });
    }
  };

  // ---------- 批量删除（多选 / 清空；文件 Tab（AI 产物 / 我的上传）与对话历史 Tab；宿主批量回调复用单删接口，删后只刷新一次） ----------
  const fileKeyOf = (f: AgentFile) => f.path || f.url;
  const exitBatchSelect = () => {
    setSelectMode(false);
    setSelectedKeys(new Set());
  };
  const toggleBatchKey = (key: string) =>
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const runFileBatchDelete = async (files: AgentFile[], all: boolean) => {
    if (!files.length || !panel.onBatchDeleteFiles) return;
    const label = resolvedTab === 'uploads' ? '我的上传' : 'AI 产物';
    const ok = await dialog.confirm({
      title: all ? '清空文件' : '删除文件',
      message: all
        ? `将清空当前工作区的「${label}」全部 ${files.length} 个文件。删除后将从工作区永久移除，无法恢复。`
        : `将删除选中的 ${files.length} 个「${label}」文件。删除后将永久移除，无法恢复。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    setBatchBusy(true);
    try {
      const res = await panel.onBatchDeleteFiles(files);
      showToast(
        res.failed > 0 ? `已删除 ${res.ok} 个，${res.failed} 个失败` : `已删除 ${res.ok} 个文件`,
        { type: res.failed > 0 ? (res.ok > 0 ? 'warning' : 'error') : 'success' }
      );
    } catch {
      showToast('批量删除失败，请重试', { type: 'error' });
    } finally {
      setBatchBusy(false);
      exitBatchSelect();
    }
  };

  const runSessionBatchDelete = async (workspaceIds: string[], all: boolean) => {
    const ids = workspaceIds.filter(Boolean);
    if (!ids.length || !panel.onBatchDeleteSessions) return;
    const ok = await dialog.confirm({
      title: all ? '清空对话历史' : '删除对话',
      message: all
        ? `将清空「对话历史」中的全部 ${ids.length} 个对话（含其它画布节点与当前节点的对话）。每个对话的完整数据（会话历史、产物文件与上传附件）将被永久删除，无法恢复；若其中存在正在进行的对话，其进程将被终止。`
        : `将删除选中的 ${ids.length} 个对话（含其它画布节点的对话）。每个对话的完整数据（会话历史、产物文件与上传附件）将被永久删除，无法恢复。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    setBatchBusy(true);
    try {
      const res = await panel.onBatchDeleteSessions(ids);
      showToast(
        res.failed > 0 ? `已删除 ${res.ok} 个，${res.failed} 个失败` : `已删除 ${res.ok} 个对话`,
        { type: res.failed > 0 ? (res.ok > 0 ? 'warning' : 'error') : 'success' }
      );
    } catch {
      showToast('批量删除失败，请重试', { type: 'error' });
    } finally {
      setBatchBusy(false);
      exitBatchSelect();
    }
  };

  const deleteSelectedFiles = () =>
    void runFileBatchDelete(activeFiles.filter((f) => selectedKeys.has(fileKeyOf(f))), false);
  const clearAllFiles = () => void runFileBatchDelete(activeFiles, true);
  const deleteSelectedSessions = () =>
    void runSessionBatchDelete(
      sessionsAll.filter((s) => selectedKeys.has(s.workspaceId)).map((s) => s.workspaceId),
      false
    );
  const clearAllSessions = () => void runSessionBatchDelete(sessionsAll.map((s) => s.workspaceId), true);
  const batchSelectedCount = showHistoryBatchBar
    ? sessionsAll.filter((s) => selectedKeys.has(s.workspaceId)).length
    : activeFiles.filter((f) => selectedKeys.has(fileKeyOf(f))).length;

  const loading = panel.filesLoading || !!panel.sessionsLoading;
  const headerExtra = (
    <button
      type="button"
      onClick={() => {
        panel.onRefreshFiles();
        panel.onRefreshSessions?.();
      }}
      disabled={loading}
      title="刷新列表"
      aria-label="刷新列表"
      className="flex items-center justify-center w-6 h-6 rounded-md text-ink-faint hover:text-accent hover:bg-accent/10 active:scale-[0.96] transition-[color,background-color,transform] duration-150 disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <RefreshCw size={12} strokeWidth={2} className={loading ? 'animate-spin' : ''} />
    </button>
  );

  return (
    <>
      <NodeSideDrawer
        isOpen={panel.open}
        onClose={panel.onToggle}
        title="侧边面板"
        subtitle={hasHistory ? 'AI 产物 · 我的上传 · 对话历史' : 'AI 产物 · 我的上传'}
        icon={<PanelRight size={14} strokeWidth={1.75} />}
        headerExtra={headerExtra}
        width={300}
      >
        <div className="flex flex-col min-h-0">
          {/* Tab 栏：常驻主 Tab（文件类别空桶置灰禁用 / 对话历史始终可点）+ 「…」溢出下拉承载未来新增 Tab */}
          <div className="shrink-0 flex items-center gap-1 p-0.5 rounded-lg bg-paper-grid/30 border border-paper-grid/50 mb-2">
            {primaryTabs.map((tab) => {
              const isActive = tab.id === resolvedTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  disabled={tab.disabled}
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.disabled ? `${tab.label}暂无文件` : undefined}
                  className={`flex-1 px-2 py-1 rounded-md text-[11px] font-sans transition select-none ${
                    isActive
                      ? 'bg-paper text-accent shadow-2xs font-medium'
                      : tab.disabled
                        ? 'text-ink-faint/60 cursor-not-allowed'
                        : 'text-ink-light hover:text-ink cursor-pointer'
                  }`}
                >
                  {tab.label} ({tab.badge})
                </button>
              );
            })}
            {overflowTabs.length > 0 && (
              <div className="relative shrink-0" ref={overflowRef}>
                <button
                  type="button"
                  onClick={() => setOverflowOpen((v) => !v)}
                  aria-expanded={overflowOpen}
                  aria-label="更多面板"
                  title="更多面板"
                  className={`flex items-center justify-center w-7 h-6 rounded-md transition select-none cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                    activeInOverflow
                      ? 'bg-paper text-accent shadow-2xs font-medium'
                      : 'text-ink-light hover:text-ink hover:bg-paper-grid/40'
                  }`}
                >
                  <MoreVertical size={13} strokeWidth={2.25} />
                </button>
                {overflowOpen && (
                  <div className="absolute right-0 top-full mt-1 z-10 min-w-[150px] rounded-lg border border-paper-grid bg-paper shadow-xl p-1 flex flex-col gap-0.5">
                    {overflowTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setActiveTab(tab.id);
                          setOverflowOpen(false);
                        }}
                        className={`flex items-center justify-between gap-2 px-2 py-1 rounded-md text-[11px] font-sans transition select-none cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                          tab.id === resolvedTab
                            ? 'bg-accent/10 text-accent font-medium'
                            : 'text-ink-light hover:text-ink hover:bg-paper-grid/40'
                        }`}
                      >
                        <span className="truncate">{tab.label}</span>
                        <span className="text-[10px] text-ink-faint tabular-nums font-mono">({tab.badge})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 批量删除工具条：文件 Tab（AI 产物 / 我的上传；「全部文件」只读无批量）与对话历史 Tab；
              选择态下切换为全选 / 删除选中 */}
          {showFileBatchBar && (
            <BatchDeleteToolbar
              scopeLabel={resolvedTab === 'uploads' ? '我的上传' : 'AI 产物'}
              count={activeFiles.length}
              busy={batchBusy}
              selectMode={selectMode}
              selectedCount={batchSelectedCount}
              onEnterSelect={() => setSelectMode(true)}
              onClearAll={clearAllFiles}
              onDeleteSelected={deleteSelectedFiles}
              onToggleAll={() => {
                const keys = activeFiles.map(fileKeyOf);
                setSelectedKeys(
                  keys.length && keys.every((k) => selectedKeys.has(k)) ? new Set() : new Set(keys)
                );
              }}
              onExitSelect={exitBatchSelect}
            />
          )}
          {showHistoryBatchBar && (
            <BatchDeleteToolbar
              scopeLabel="对话历史"
              count={sessionsAll.length}
              busy={batchBusy}
              selectMode={selectMode}
              selectedCount={batchSelectedCount}
              onEnterSelect={() => setSelectMode(true)}
              onClearAll={clearAllSessions}
              onDeleteSelected={deleteSelectedSessions}
              onToggleAll={() => {
                const keys = sessionsAll.map((s) => s.workspaceId);
                setSelectedKeys(
                  keys.length && keys.every((k) => selectedKeys.has(k)) ? new Set() : new Set(keys)
                );
              }}
              onExitSelect={exitBatchSelect}
            />
          )}

          {/* 列表主体：加载 / 空态 / 文件树 / 会话行列表 */}
          {resolvedTab === 'history' ? (
            <HistoryBody
              sessions={sessions!}
              loading={!!panel.sessionsLoading}
              currentWorkspaceId={panel.currentWorkspaceId ?? null}
              sourceNodeOf={panel.sourceNodeOf}
              pinningId={pinningId}
              renamingId={renamingId}
              deletingId={deletingId}
              onSelect={handleSelect}
              onTogglePin={handleTogglePin}
              onRename={panel.onRenameSession ? handleRename : undefined}
              onDelete={handleDelete}
              selectMode={selectMode}
              selectedKeys={selectedKeys}
              busy={batchBusy}
              onToggleSelect={(id) => toggleBatchKey(id)}
            />
          ) : (
            <FilesBody
              files={activeFiles}
              loading={panel.filesLoading}
              onPreview={setPreviewFile}
              onDelete={canDeleteFiles ? handleDeleteFile : undefined}
              selectMode={selectMode}
              selectedKeys={selectedKeys}
              busy={batchBusy}
              deletingPath={deletingPath}
              onToggleSelect={(file) => toggleBatchKey(fileKeyOf(file))}
            />
          )}
        </div>
      </NodeSideDrawer>

      {/* 行点击 → 统一预览弹层（portal 到 body，图片同样以文件名行进入此处） */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
          onDownload={handleDownload}
        />
      )}
    </>
  );
};

/** 列表上方批量删除工具条：常规态 = 「多选删除 / 全部清空」；选择态 = 「全选 / 已选 / 删除选中 / 取消」。 */
const BatchDeleteToolbar: React.FC<{
  scopeLabel: string;
  count: number;
  busy: boolean;
  selectMode: boolean;
  selectedCount: number;
  onEnterSelect: () => void;
  onClearAll: () => void;
  onDeleteSelected: () => void;
  onToggleAll: () => void;
  onExitSelect: () => void;
}> = ({
  scopeLabel,
  count,
  busy,
  selectMode,
  selectedCount,
  onEnterSelect,
  onClearAll,
  onDeleteSelected,
  onToggleAll,
  onExitSelect,
}) => {
  const btnBase =
    'flex items-center gap-1 text-[11px] font-sans transition select-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded-md px-1.5 py-1';
  if (selectMode) {
    const allSelected = count > 0 && selectedCount === count;
    return (
      <div className="shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5 px-1.5 py-1 rounded-md border border-accent/25 bg-accent/5">
        <button
          type="button"
          onClick={onToggleAll}
          disabled={busy || count === 0}
          className={`${btnBase} text-accent hover:bg-accent/10`}
        >
          <Check size={11} strokeWidth={2.5} />
          {allSelected ? '取消全选' : '全选'}
        </button>
        <span className="text-[10px] font-sans text-ink-light tabular-nums">
          已选 {selectedCount} / {count}
        </span>
        <button
          type="button"
          onClick={onDeleteSelected}
          disabled={busy || selectedCount === 0}
          title="删除已勾选条目"
          className={`${btnBase} text-error hover:bg-error/10 ml-auto`}
        >
          <Trash2 size={11} strokeWidth={2} />
          删除选中 ({selectedCount})
        </button>
        <button
          type="button"
          onClick={onExitSelect}
          disabled={busy}
          title="退出多选"
          className={`${btnBase} text-ink-faint hover:text-ink hover:bg-ink/10`}
        >
          <X size={11} strokeWidth={2} />
          取消
        </button>
      </div>
    );
  }
  return (
    <div className="shrink-0 flex items-center justify-between gap-1 mb-1.5">
      <button
        type="button"
        onClick={onEnterSelect}
        disabled={busy}
        title={`多选${scopeLabel}后批量删除`}
        className={`${btnBase} text-ink-light hover:text-accent hover:bg-accent/10`}
      >
        <ListChecks size={12} strokeWidth={2} />
        多选删除
      </button>
      <button
        type="button"
        onClick={onClearAll}
        disabled={busy}
        title={`清空「${scopeLabel}」全部 ${count} 项`}
        className={`${btnBase} text-ink-faint hover:text-error hover:bg-error/10`}
      >
        <Trash2 size={12} strokeWidth={2} />
        全部清空 ({count})
      </button>
    </div>
  );
};

/** 文件类别 Tab 主体：加载 / 空态 / 工作区文件树（「全部文件」只读，AI 产物 / 我的上传 可删除）。 */
const FilesBody: React.FC<{
  files: AgentFile[];
  loading: boolean;
  onPreview: (file: AgentFile) => void;
  /** AI 产物 / 我的上传 Tab 传删除回调；「全部文件」Tab 不传 = 只读树 */
  onDelete?: (file: AgentFile) => void;
  selectMode?: boolean;
  selectedKeys?: ReadonlySet<string>;
  busy?: boolean;
  deletingPath?: string | null;
  onToggleSelect?: (file: AgentFile) => void;
}> = ({
  files,
  loading,
  onPreview,
  onDelete,
  selectMode = false,
  selectedKeys,
  busy = false,
  deletingPath = null,
  onToggleSelect,
}) => {
  if (loading && files.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] font-sans text-ink-faint py-3">
        <Loader2 size={12} className="animate-spin" /> 加载中…
      </div>
    );
  }
  if (files.length === 0) {
    return <p className="text-[11px] font-sans text-ink-faint py-3">暂无文件</p>;
  }
  return (
    <WorkspaceFileTree
      files={files}
      onPreview={onPreview}
      onDelete={onDelete}
      selectable={selectMode}
      selectedKeys={selectedKeys}
      busy={busy}
      deletingPath={deletingPath}
      onToggleSelect={onToggleSelect}
    />
  );
};

/** 对话历史 Tab 主体：加载 / 空态 / 会话行列表（置顶在前，服务端已排序）。 */
const HistoryBody: React.FC<{
  sessions: ConversationSessionSummary[];
  loading: boolean;
  currentWorkspaceId: string | null;
  sourceNodeOf?: (workspaceId: string) => { title: string } | null;
  pinningId: string | null;
  renamingId: string | null;
  deletingId: string | null;
  onSelect: (s: ConversationSessionSummary) => void;
  onTogglePin: (s: ConversationSessionSummary) => void;
  onRename?: (s: ConversationSessionSummary, title: string) => Promise<void>;
  onDelete: (s: ConversationSessionSummary) => void;
  /** 批量选择态：行点击 = 勾选切换，暂停载入 / 置顶 / 重命名 / 行内删除 */
  selectMode?: boolean;
  selectedKeys?: ReadonlySet<string>;
  busy?: boolean;
  onToggleSelect?: (workspaceId: string) => void;
}> = ({
  sessions,
  loading,
  currentWorkspaceId,
  sourceNodeOf,
  pinningId,
  renamingId,
  deletingId,
  onSelect,
  onTogglePin,
  onRename,
  onDelete,
  selectMode = false,
  selectedKeys,
  busy = false,
  onToggleSelect,
}) => {
  if (loading && !sessions.length) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] font-sans text-ink-faint py-3">
        <Loader2 size={12} className="animate-spin" /> 加载中…
      </div>
    );
  }
  if (!sessions.length) {
    return (
      <p className="text-[11px] font-sans text-ink-faint py-3">
        暂无对话历史。发送消息后将在此列出可回看的会话。
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {sessions.map((s) => (
        <ConversationRow
          key={s.workspaceId}
          session={s}
          isCurrent={s.workspaceId === currentWorkspaceId}
          sourceTitle={sourceNodeOf ? (sourceNodeOf(s.workspaceId)?.title ?? null) : null}
          pinning={pinningId === s.workspaceId}
          renaming={renamingId === s.workspaceId}
          deleting={deletingId === s.workspaceId}
          onSelect={onSelect}
          onTogglePin={onTogglePin}
          onRename={onRename}
          onDelete={onDelete}
          selectable={selectMode}
          selected={!!selectedKeys?.has(s.workspaceId)}
          busy={busy}
          onToggleSelect={
            onToggleSelect ? () => onToggleSelect(s.workspaceId) : undefined
          }
        />
      ))}
    </div>
  );
};

/**
 * 单个会话行：标题 + 元信息（时间 · 轮次 · 来源节点）；行点击载入，行内提供重命名 / 置顶 / 删除。
 * 重命名为行内编辑态：铅笔进入，输入框回车 / 勾确认（空白 = 恢复自动标题），Esc / 取消退出。
 */
const ConversationRow: React.FC<{
  session: ConversationSessionSummary;
  isCurrent: boolean;
  sourceTitle?: string | null;
  pinning: boolean;
  renaming: boolean;
  deleting: boolean;
  onSelect: (s: ConversationSessionSummary) => void;
  onTogglePin: (s: ConversationSessionSummary) => void;
  onRename?: (s: ConversationSessionSummary, title: string) => Promise<void>;
  onDelete: (s: ConversationSessionSummary) => void;
  /** 批量选择态：行点击 = 勾选切换，暂停载入 / 行内操作 */
  selectable?: boolean;
  selected?: boolean;
  busy?: boolean;
  onToggleSelect?: () => void;
}> = ({
  session,
  isCurrent,
  sourceTitle,
  pinning,
  renaming,
  deleting,
  onSelect,
  onTogglePin,
  onRename,
  onDelete,
  selectable = false,
  selected = false,
  busy = false,
  onToggleSelect,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const [saving, setSaving] = useState(false);
  const meta = sessionMetaLine(session);

  const startEdit = () => {
    setDraft(session.title);
    setEditing(true);
  };
  const commit = async () => {
    if (saving || !onRename) return;
    const trimmed = draft.trim();
    if (trimmed === session.title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onRename(session, trimmed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const activate = () => {
    if (busy) return;
    if (selectable) {
      onToggleSelect?.();
      return;
    }
    if (!editing) onSelect(session); // 编辑态下行点击不触发载入
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selectable ? selected : undefined}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}
      title={
        selectable
          ? selected
            ? '已选，点击取消勾选'
            : '点击勾选'
          : isCurrent
            ? '当前对话'
            : `载入「${session.title}」到节点`
      }
      className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-sans transition select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
        selectable
          ? selected
            ? 'border-accent/60 bg-accent/10 cursor-pointer hover:border-accent/60'
            : 'border-paper-grid/60 bg-paper-grid/20 cursor-pointer hover:border-accent/40 hover:bg-accent/5'
          : isCurrent
            ? 'border-accent/40 bg-accent/10 cursor-default'
            : 'border-paper-grid/60 bg-paper-grid/20 cursor-pointer hover:border-accent/40 hover:bg-accent/5'
      }`}
    >
      {selectable && (
        <span
          aria-hidden
          className={`shrink-0 flex items-center justify-center w-3.5 h-3.5 rounded border transition ${
            selected ? 'bg-accent border-accent text-paper' : 'border-ink-light/50 bg-paper'
          }`}
        >
          {selected && <Check size={10} strokeWidth={3} />}
        </span>
      )}
      <span className="flex flex-col min-w-0 flex-1 leading-tight">
        {editing && !selectable ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                void commit();
              } else if (e.key === 'Escape') {
                setEditing(false);
              }
            }}
            onBlur={() => {
              if (!saving) setEditing(false);
            }}
            placeholder="留空恢复自动标题"
            title="编辑标题（回车保存，Esc 取消，留空恢复自动标题）"
            className="w-full min-w-0 bg-paper border border-accent/50 rounded px-1.5 py-0.5 text-xs text-ink font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          />
        ) : (
          <span className="flex items-center gap-1 min-w-0">
            <span
              className={`truncate ${isCurrent ? 'text-accent font-medium' : 'text-ink font-medium'}`}
            >
              {session.title}
            </span>
            {isCurrent && (
              <span className="shrink-0 text-[9px] font-sans text-accent border border-accent/30 rounded-pill px-1 py-px">
                当前
              </span>
            )}
            {session.pinned && (
              <Pin size={10} strokeWidth={2.25} className="shrink-0 text-accent" fill="currentColor" />
            )}
          </span>
        )}
        {meta && !(editing && !selectable) && (
          <span className="truncate text-[10px] text-ink-faint tabular-nums font-mono">{meta}</span>
        )}
        {sourceTitle && !(editing && !selectable) && (
          <span className="truncate text-[10px] text-ink-faint">来自「{sourceTitle}」</span>
        )}
      </span>

      {/* 行内操作（stopPropagation：不触发行点击载入）；编辑态替换为确认 / 取消；批量选择态整体隐藏 */}
      {!selectable && (
      <span className="shrink-0 flex items-center gap-0.5">
        {editing ? (
          <>
            <button
              type="button"
              disabled={saving}
              onClick={(e) => {
                e.stopPropagation();
                void commit();
              }}
              onMouseDown={(e) => e.preventDefault()} // 防失焦先于点击触发 onBlur 取消编辑
              title="保存标题"
              aria-label="保存标题"
              className="flex items-center justify-center w-6 h-6 rounded-md text-accent hover:bg-accent/10 active:scale-[0.96] transition disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              {saving ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Check size={12} strokeWidth={2.25} />
              )}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={(e) => {
                e.stopPropagation();
                setEditing(false);
              }}
              title="取消"
              aria-label="取消编辑"
              className="flex items-center justify-center w-6 h-6 rounded-md text-ink-faint hover:text-ink hover:bg-ink/10 active:scale-[0.96] transition disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink"
            >
              <X size={12} strokeWidth={2} />
            </button>
          </>
        ) : (
          <>
            {onRename && (
              <button
                type="button"
                disabled={pinning || renaming || deleting}
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit();
                }}
                title="重命名对话"
                aria-label="重命名对话"
                className="flex items-center justify-center w-6 h-6 rounded-md text-ink-faint hover:text-accent hover:bg-accent/10 active:scale-[0.96] transition disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                <Pencil size={12} strokeWidth={2} />
              </button>
            )}
            <button
              type="button"
              disabled={pinning || renaming || deleting}
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin(session);
              }}
              title={session.pinned ? '取消置顶' : '置顶'}
              aria-label={session.pinned ? '取消置顶' : '置顶'}
              className="flex items-center justify-center w-6 h-6 rounded-md text-ink-faint hover:text-accent hover:bg-accent/10 active:scale-[0.96] transition disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              {pinning ? (
                <Loader2 size={12} className="animate-spin" />
              ) : session.pinned ? (
                <Pin size={12} strokeWidth={2} className="text-accent" fill="currentColor" />
              ) : (
                <PinOff size={12} strokeWidth={2} />
              )}
            </button>
            <button
              type="button"
              disabled={pinning || renaming || deleting}
              onClick={(e) => {
                e.stopPropagation();
                void onDelete(session);
              }}
              title="删除对话"
              aria-label="删除对话"
              className="flex items-center justify-center w-6 h-6 rounded-md text-ink-faint hover:text-error hover:bg-error/10 active:scale-[0.96] transition disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error"
            >
              {deleting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Trash2 size={12} strokeWidth={2} />
              )}
            </button>
          </>
        )}
      </span>
      )}
    </div>
  );
};