import { useState } from 'react';
import {
  ChevronDown,
  History,
  Loader2,
  Pin,
  PinOff,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { NodeSideDrawer } from '../../../../platform/components/node/NodeSideDrawer';
import { useFeedback } from '../../../../platform/components/ui/FeedbackProvider';
import type { ConversationSessionSummary } from '../../piSessionApi';

/**
 * 对话历史面板（skill_agent / pi 模式专用）：节点底部入口条 + 左侧吸附抽屉。
 *
 * - 抽屉仅展示会话列表（标题 / 时间 / 轮次），不做消息预览——点击某条即把该会话
 *   workspaceId 载入节点，宿主 effect 自动从服务端水合重载历史；
 * - 支持置顶 / 取消置顶（服务端 .pi-agent/meta.json 持久化，列表按「置顶在前」排序）；
 * - 支持删除：点击弹确认框（危险操作），确认后完整删除该会话的 workspace 目录
 *   （会话历史 / 产物文件 / 上传附件一并清除）。
 *
 * 抽屉挂在 CanvasNode 的 sideDrawer 根级插槽（渲染在内容区 overflow 之外）；因工作区文件
 * 抽屉占用右侧，本抽屉固定吸附在节点左侧（side="left"），两者可同时展开互不遮挡。
 */
export interface ChatConversationsPanel {
  open: boolean;
  loading: boolean;
  sessions: ConversationSessionSummary[];
  /** 当前节点正在展示的会话（列表行高亮与「当前」徽标依据） */
  currentWorkspaceId: string | null;
  onToggle: () => void;
  onRefresh: () => void;
  /** 载入指定会话到节点（切换 workspaceId，宿主自动水合） */
  onSelect: (workspaceId: string) => void;
  /** 置顶 / 取消置顶（后端持久化后刷新列表） */
  onTogglePin: (workspaceId: string, pinned: boolean) => Promise<void>;
  /** 删除会话（后端删目录；若为当前会话，宿主同步重置节点为全新工作区） */
  onDelete: (workspaceId: string) => Promise<void>;
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

/** 行元信息：更新时间 · 轮次数（任一缺失时只展示另一项）。 */
function sessionMetaLine(s: ConversationSessionSummary): string {
  const parts: string[] = [];
  const time = formatConversationTime(s.updatedAt);
  if (time) parts.push(time);
  if (s.messageCount > 0) parts.push(`${s.messageCount} 轮`);
  return parts.join(' · ');
}

/** 对话历史入口条（节点底部，输入区上方）：点击展开/收起左侧吸附抽屉。 */
export const ChatHistoryTrigger: React.FC<{ panel: ChatConversationsPanel }> = ({ panel }) => {
  const total = panel.sessions.length;
  return (
    <div className="shrink-0 flex items-center gap-1.5">
      <button
        type="button"
        onClick={panel.onToggle}
        aria-expanded={panel.open}
        title={panel.open ? '收起对话历史抽屉' : '展开对话历史抽屉'}
        className={`flex items-center gap-1.5 text-[11px] font-sans transition-[color] duration-150 cursor-pointer select-none active:scale-[0.98] ${
          panel.open ? 'text-accent font-medium' : 'text-ink-faint hover:text-accent'
        }`}
      >
        <History size={12} strokeWidth={2} />
        <span>对话历史{total > 0 ? ` (${total})` : ''}</span>
        <ChevronDown
          size={11}
          strokeWidth={2}
          className={`transition-transform duration-200 ease-out ${panel.open ? 'rotate-180' : ''}`}
        />
      </button>
      {panel.loading && <Loader2 size={10} className="animate-spin text-ink-faint" />}
    </div>
  );
};

/**
 * 对话历史侧边吸附抽屉：会话列表（置顶在前，服务端已排序），行内提供置顶与删除操作。
 */
export const ChatHistoryDrawer: React.FC<{ panel: ChatConversationsPanel }> = ({ panel }) => {
  const { dialog, showToast } = useFeedback();
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleTogglePin = async (s: ConversationSessionSummary) => {
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
    const ok = await dialog.confirm({
      title: '删除对话',
      message: `确定删除「${s.title}」吗？该对话的完整数据（会话历史、产物文件与上传附件）将被永久删除，无法恢复。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    setDeletingId(s.workspaceId);
    try {
      await panel.onDelete(s.workspaceId);
      showToast('对话已删除', { type: 'success' });
    } catch {
      showToast('删除失败，请重试', { type: 'error' });
    } finally {
      setDeletingId(null);
    }
  };

  const handleSelect = (s: ConversationSessionSummary) => {
    panel.onSelect(s.workspaceId);
    panel.onToggle(); // 选中后收起抽屉，让位于节点内的对话重载
  };

  const headerExtra = (
    <button
      type="button"
      onClick={panel.onRefresh}
      disabled={panel.loading}
      title="刷新对话列表"
      aria-label="刷新对话列表"
      className="flex items-center justify-center w-6 h-6 rounded-md text-ink-faint hover:text-accent hover:bg-accent/10 active:scale-[0.96] transition-[color,background-color,transform] duration-150 disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <RefreshCw size={12} strokeWidth={2} className={panel.loading ? 'animate-spin' : ''} />
    </button>
  );

  return (
    <NodeSideDrawer
      isOpen={panel.open}
      onClose={panel.onToggle}
      title="对话历史"
      subtitle="点击会话载入节点 · 置顶优先"
      icon={<History size={14} strokeWidth={1.75} />}
      headerExtra={headerExtra}
      side="left"
      width={300}
    >
      <div className="flex flex-col min-h-0">
        {panel.loading && !panel.sessions.length ? (
          <div className="flex items-center gap-1.5 text-[11px] font-sans text-ink-faint py-3">
            <Loader2 size={12} className="animate-spin" /> 加载中…
          </div>
        ) : !panel.sessions.length ? (
          <p className="text-[11px] font-sans text-ink-faint py-3">
            暂无对话历史。发送消息后将在此列出可回看的会话。
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {panel.sessions.map((s) => (
              <ConversationRow
                key={s.workspaceId}
                session={s}
                isCurrent={s.workspaceId === panel.currentWorkspaceId}
                pinning={pinningId === s.workspaceId}
                deleting={deletingId === s.workspaceId}
                onSelect={handleSelect}
                onTogglePin={handleTogglePin}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </NodeSideDrawer>
  );
};

/** 单个会话行：标题 + 元信息（时间 · 轮次）；行点击载入，行内提供置顶与删除。 */
const ConversationRow: React.FC<{
  session: ConversationSessionSummary;
  isCurrent: boolean;
  pinning: boolean;
  deleting: boolean;
  onSelect: (s: ConversationSessionSummary) => void;
  onTogglePin: (s: ConversationSessionSummary) => void;
  onDelete: (s: ConversationSessionSummary) => void;
}> = ({ session, isCurrent, pinning, deleting, onSelect, onTogglePin, onDelete }) => {
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
          <span className={`truncate ${isCurrent ? 'text-accent font-medium' : 'text-ink font-medium'}`}>
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
        {meta && <span className="truncate text-[10px] text-ink-faint tabular-nums font-mono">{meta}</span>}
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