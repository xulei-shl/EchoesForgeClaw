import { useState } from 'react';
import {
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Loader2,
  PanelRight,
  Pin,
  PinOff,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { NodeSideDrawer } from '../../../../platform/components/node/NodeSideDrawer';
import { useFeedback } from '../../../../platform/components/ui/FeedbackProvider';
import { FilePreviewModal } from '../FilePreviewModal';
import { authHeaders } from '../../authUtils';
import { sortWorkspaceFilesByTime, WORKSPACE_FILE_CATEGORIES } from '../../workspaceFiles';
import type { AgentFile } from '../../../../platform/types';
import type { ConversationSessionSummary } from '../../piSessionApi';

/**
 * 节点侧边面板（单一右侧吸附抽屉，Tab 切换内容）：
 *
 * - Tab 1/2 AI 产物 / 我的上传：服务端工作区文件（skill_agent + FastClaw agent 共用）；
 * - Tab 3 对话历史：该用户**全部** pi 会话（跨节点全局列表），点击载入节点 / 置顶 / 删除
 *   （仅 skill_agent 模式提供）；来源节点由宿主按 workspaceId 前缀解析并标注。
 *
 * 替代旧的双抽屉方案（左侧对话历史 + 右侧工作区文件）：节点底部只保留一个通用入口按钮
 * （「侧边面板」），点击展开同一右侧抽屉，三个 Tab 互斥切换。
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
  onDeleteSession?: (workspaceId: string) => Promise<void>;
  /** 文件行删除（AI 产物 / 我的上传；缺省 = 不展示删除按钮，FastClaw 模式等外部存储不可删） */
  onDeleteFile?: (file: AgentFile) => Promise<void>;
  /** 来源节点解析（全局列表时按 workspaceId 前缀找画布节点标题；缺省 = 不标注） */
  sourceNodeOf?: (workspaceId: string) => { title: string } | null;
}

/** 图片扩展名（行首图标区分；预览统一走 FilePreviewModal） */
const IMAGE_EXT_RE = /\\.(png|jpe?g|gif|webp|svg)$/i;

/** 文件大小人类可读格式（B / KB / MB） */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 文件修改时间展示（本年省略年份：MM-DD HH:mm；跨年带年份），无时间戳返回空 */
function formatFileTime(mtimeMs?: number): string {
  if (!mtimeMs || !(mtimeMs > 0) || !Number.isFinite(mtimeMs)) return '';
  const d = new Date(mtimeMs);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date =
    d.getFullYear() === now.getFullYear()
      ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 文件行元信息：大小 · 时间（任一缺失时只展示另一项） */
function fileMetaLine(file: AgentFile): string {
  const parts: string[] = [];
  if (file.size > 0) parts.push(formatFileSize(file.size));
  const time = formatFileTime(file.mtimeMs);
  if (time) parts.push(time);
  return parts.join(' · ');
}

/** 带鉴权下载文件（skill-files / fastclaw-files 接口要求登录鉴权，统一 fetch → blob → 触发保存）。 */
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

/** 抽屉 Tab：前两个为文件类别（WORKSPACE_FILE_CATEGORIES 注册表），第三个为对话历史。 */
type SideTabId = 'artifacts' | 'uploads' | 'history';

/**
 * 侧边面板抽屉（挂在 CanvasNode 的 sideDrawer 根级插槽，见 docs/节点侧边吸附抽屉使用指南.md）：
 * - Tab 常驻展示（计数含 0）：文件类别空桶置灰不可点（沿用旧工作区文件抽屉设计，让
 *   「上传 / 产物」归属一目了然）；对话历史 Tab 始终可点（空态有引导文案）；
 * - 列表按文件修改时间倒序（最新在前），无时间戳来源（FastClaw）保持原相对顺序；
 * - 图片与其它文件一律以「文件名行」展示，点击行打开统一预览弹层（FilePreviewModal，
 *   图片 / 文本 / PDF 内联预览，二进制给下载引导）；
 * - 对话历史行：点击载入会话到节点，行内置顶 / 删除（带危险确认框）。
 */
export const ChatSidePanelDrawer: React.FC<{ panel: ChatSidePanel }> = ({ panel }) => {
  const { dialog, showToast } = useFeedback();
  const [activeTab, setActiveTab] = useState<SideTabId>('artifacts');
  const [previewFile, setPreviewFile] = useState<AgentFile | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);

  const sessions = panel.sessions;
  const hasHistory = !!sessions;
  // 全量类别分桶（含空桶）：Tab 常驻展示全部类别（计数含 0）
  const fileTabs = WORKSPACE_FILE_CATEGORIES.map((category) => ({
    category,
    files: panel.files.filter(category.matches),
  }));
  // 激活 Tab = 用户所选且仍有效（文件类别非空 / 对话历史可用），否则回退到第一个非空
  // 文件类别（全空时回退到对话历史），避免选中 Tab 随列表刷新后悬空
  const resolvedTab: SideTabId = (() => {
    if (activeTab === 'history' && hasHistory) return 'history';
    if (fileTabs.some((t) => t.category.id === activeTab && t.files.length > 0)) return activeTab;
    const firstNonEmpty = fileTabs.find((t) => t.files.length > 0);
    if (firstNonEmpty) return firstNonEmpty.category.id;
    return hasHistory ? 'history' : 'artifacts';
  })();

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
          {/* Tab 栏：文件类别（空桶置灰禁用）+ 对话历史（始终可点） */}
          <div className="shrink-0 flex items-center gap-1 p-0.5 rounded-lg bg-paper-grid/30 border border-paper-grid/50 mb-2">
            {fileTabs.map(({ category, files }) => {
              const disabled = files.length === 0;
              const isActive = category.id === resolvedTab;
              return (
                <button
                  key={category.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setActiveTab(category.id)}
                  title={disabled ? `${category.label}暂无文件` : undefined}
                  className={`flex-1 px-2 py-1 rounded-md text-[11px] font-sans transition select-none ${
                    isActive
                      ? 'bg-paper text-accent shadow-2xs font-medium'
                      : disabled
                        ? 'text-ink-faint/60 cursor-not-allowed'
                        : 'text-ink-light hover:text-ink cursor-pointer'
                  }`}
                >
                  {category.label} ({files.length})
                </button>
              );
            })}
            {hasHistory && (
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={`flex-1 px-2 py-1 rounded-md text-[11px] font-sans transition select-none ${
                  'history' === resolvedTab
                    ? 'bg-paper text-accent shadow-2xs font-medium'
                    : 'text-ink-light hover:text-ink cursor-pointer'
                }`}
              >
                对话历史 ({sessions!.length})
              </button>
            )}
          </div>

          {/* 列表主体：加载 / 空态 / 行列表 */}
          {resolvedTab === 'history' ? (
            <HistoryBody
              sessions={sessions!}
              loading={!!panel.sessionsLoading}
              currentWorkspaceId={panel.currentWorkspaceId ?? null}
              sourceNodeOf={panel.sourceNodeOf}
              pinningId={pinningId}
              deletingId={deletingId}
              onSelect={handleSelect}
              onTogglePin={handleTogglePin}
              onDelete={handleDelete}
            />
          ) : (
            <FilesBody
              fileTab={fileTabs.find((t) => t.category.id === resolvedTab)}
              loading={panel.filesLoading}
              deletingPath={deletingPath}
              onDelete={panel.onDeleteFile ? handleDeleteFile : undefined}
              onPreview={setPreviewFile}
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

/** 文件类别 Tab 主体：加载 / 空态 / 按时间倒序的行列表。 */
const FilesBody: React.FC<{
  fileTab: { category: { id: string; label: string }; files: AgentFile[] } | undefined;
  loading: boolean;
  deletingPath: string | null;
  onDelete?: (file: AgentFile) => void;
  onPreview: (file: AgentFile) => void;
}> = ({ fileTab, loading, deletingPath, onDelete, onPreview }) => {
  if (loading && !fileTab?.files.length) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] font-sans text-ink-faint py-3">
        <Loader2 size={12} className="animate-spin" /> 加载中…
      </div>
    );
  }
  if (!fileTab?.files.length) {
    return <p className="text-[11px] font-sans text-ink-faint py-3">暂无文件</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      {sortWorkspaceFilesByTime(fileTab.files).map((f) => (
        <WorkspaceFileRow
          key={f.url || f.path}
          file={f}
          deleting={deletingPath === f.path}
          onDelete={onDelete}
          onPreview={onPreview}
        />
      ))}
    </div>
  );
};

/** 单个文件列表行：图标 + 文件名 + 元信息（大小 · 时间）；点击整行打开预览，行内可删除。 */
const WorkspaceFileRow: React.FC<{
  file: AgentFile;
  deleting: boolean;
  onDelete?: (file: AgentFile) => void;
  onPreview: (file: AgentFile) => void;
}> = ({ file, deleting, onDelete, onPreview }) => {
  const isImage = IMAGE_EXT_RE.test(file.name);
  const meta = fileMetaLine(file);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPreview(file)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPreview(file);
        }
      }}
      title={`预览 ${file.name}`}
      className="group flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-paper-grid/60 bg-paper-grid/20 text-xs font-sans cursor-pointer hover:border-accent/40 hover:bg-accent/5 transition select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      {isImage ? (
        <ImageIcon size={14} className="shrink-0 text-accent" />
      ) : (
        <FileText size={14} className="shrink-0 text-accent" />
      )}
      <span className="flex flex-col min-w-0 flex-1 leading-tight">
        <span className="truncate text-ink font-medium" title={file.path || file.name}>
          {file.name}
        </span>
        {meta && (
          <span className="truncate text-[10px] text-ink-faint tabular-nums font-mono">{meta}</span>
        )}
      </span>

      {/* 行内删除（stopPropagation：不触发行点击预览） */}
      {onDelete && (
        <button
          type="button"
          disabled={deleting}
          onClick={(e) => {
            e.stopPropagation();
            void onDelete(file);
          }}
          title="删除文件"
          aria-label={`删除 ${file.name}`}
          className="flex items-center justify-center w-6 h-6 rounded-md text-ink-faint hover:text-error hover:bg-error/10 active:scale-[0.96] transition disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error"
        >
          {deleting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Trash2 size={12} strokeWidth={2} />
          )}
        </button>
      )}
    </div>
  );
};

/** 对话历史 Tab 主体：加载 / 空态 / 会话行列表（置顶在前，服务端已排序）。 */
const HistoryBody: React.FC<{
  sessions: ConversationSessionSummary[];
  loading: boolean;
  currentWorkspaceId: string | null;
  sourceNodeOf?: (workspaceId: string) => { title: string } | null;
  pinningId: string | null;
  deletingId: string | null;
  onSelect: (s: ConversationSessionSummary) => void;
  onTogglePin: (s: ConversationSessionSummary) => void;
  onDelete: (s: ConversationSessionSummary) => void;
}> = ({
  sessions,
  loading,
  currentWorkspaceId,
  sourceNodeOf,
  pinningId,
  deletingId,
  onSelect,
  onTogglePin,
  onDelete,
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
          deleting={deletingId === s.workspaceId}
          onSelect={onSelect}
          onTogglePin={onTogglePin}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
};

/** 单个会话行：标题 + 元信息（时间 · 轮次 · 来源节点）；行点击载入，行内提供置顶与删除。 */
const ConversationRow: React.FC<{
  session: ConversationSessionSummary;
  isCurrent: boolean;
  sourceTitle?: string | null;
  pinning: boolean;
  deleting: boolean;
  onSelect: (s: ConversationSessionSummary) => void;
  onTogglePin: (s: ConversationSessionSummary) => void;
  onDelete: (s: ConversationSessionSummary) => void;
}> = ({ session, isCurrent, sourceTitle, pinning, deleting, onSelect, onTogglePin, onDelete }) => {
  const meta = sessionMetaLine(session);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(session)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(session);
        }
      }}
      title={isCurrent ? '当前对话' : `载入「${session.title}」到节点`}
      className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-sans transition select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
        isCurrent
          ? 'border-accent/40 bg-accent/10 cursor-default'
          : 'border-paper-grid/60 bg-paper-grid/20 cursor-pointer hover:border-accent/40 hover:bg-accent/5'
      }`}
    >
      <span className="flex flex-col min-w-0 flex-1 leading-tight">
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
        {meta && (
          <span className="truncate text-[10px] text-ink-faint tabular-nums font-mono">{meta}</span>
        )}
        {sourceTitle && (
          <span className="truncate text-[10px] text-ink-faint">来自「{sourceTitle}」</span>
        )}
      </span>

      {/* 行内操作（stopPropagation：不触发行点击载入） */}
      <span className="shrink-0 flex items-center gap-0.5">
        <button
          type="button"
          disabled={pinning || deleting}
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
          disabled={pinning || deleting}
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
      </span>
    </div>
  );
};