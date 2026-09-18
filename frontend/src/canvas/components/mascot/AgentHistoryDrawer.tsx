import React, { useState } from 'react';
import {
  History,
  Plus,
  RefreshCw,
  X,
  Loader2,
} from 'lucide-react';
import { useFeedback } from '../../../shared/components/ui/FeedbackProvider';
import { ConversationRow } from '../../nodes/ai/chat/ChatSidePanel';
import type { ConversationSessionSummary } from '../../nodes/ai/infra/piSessionApi';

export interface AgentHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  sessions: ConversationSessionSummary[];
  loading: boolean;
  currentWorkspaceId: string | null;
  onRefresh: () => void;
  onSelectSession: (workspaceId: string) => void;
  onNewChat: () => void;
  onTogglePin: (workspaceId: string, pinned: boolean) => Promise<void>;
  onRenameSession: (workspaceId: string, title: string) => Promise<void>;
  onDeleteSession: (workspaceId: string) => Promise<void>;
}

/**
 * Mascot Agent（画板智能助手）向左吸附展示的对话历史侧边抽屉
 */
export const AgentHistoryDrawer: React.FC<AgentHistoryDrawerProps> = ({
  open,
  onClose,
  sessions,
  loading,
  currentWorkspaceId,
  onRefresh,
  onSelectSession,
  onNewChat,
  onTogglePin,
  onRenameSession,
  onDeleteSession,
}) => {
  const { dialog, showToast } = useFeedback();

  const [pinningId, setPinningId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (!open) return null;

  // 置顶切换处理
  const handleTogglePin = async (session: ConversationSessionSummary) => {
    setPinningId(session.workspaceId);
    try {
      await onTogglePin(session.workspaceId, !session.pinned);
      showToast(session.pinned ? '已取消置顶' : '已置顶会话', { type: 'success' });
    } catch {
      showToast('置顶操作失败，请重试', { type: 'error' });
    } finally {
      setPinningId(null);
    }
  };

  // 重命名处理
  const handleRename = async (session: ConversationSessionSummary, newTitle: string) => {
    setRenamingId(session.workspaceId);
    try {
      await onRenameSession(session.workspaceId, newTitle);
      showToast('已修改会话标题', { type: 'success' });
    } catch {
      showToast('重命名失败，请重试', { type: 'error' });
      throw new Error('重命名失败');
    } finally {
      setRenamingId(null);
    }
  };

  // 单会话删除二次确认
  const handleDelete = async (session: ConversationSessionSummary) => {
    const ok = await dialog.confirm({
      title: '删除会话',
      message: `确定要彻底删除对话「${session.title}」吗？此操作将永久移除该会话的所有记录与数据，无法恢复。`,
      confirmText: '删除',
      cancelText: '取消',
      danger: true,
    });
    if (!ok) return;

    setDeletingId(session.workspaceId);
    try {
      await onDeleteSession(session.workspaceId);
      showToast('已删除会话', { type: 'success' });
    } catch {
      showToast('删除会话失败，请重试', { type: 'error' });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div
      className="w-[280px] shrink-0 h-[calc(100dvh-92px)] max-h-[calc(100dvh-92px)] flex flex-col bg-paper/95 backdrop-blur-md border border-paper-grid rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-right-3 fade-in duration-200 select-none z-[9985]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 1. 顶栏：标题、新建对话按钮、刷新、关闭 */}
      <div className="px-3.5 py-3 border-b border-paper-grid bg-paper/90 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-accent/10 text-accent flex items-center justify-center shrink-0">
            <History size={14} />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-serif font-bold text-ink truncate leading-tight">对话历史</h4>
            <span className="text-[10px] text-ink-faint font-sans tabular-nums block truncate">
              {sessions.length} 个历史会话
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* 新建对话按钮 */}
          <button
            type="button"
            onClick={onNewChat}
            title="新建对话"
            aria-label="新建对话"
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-accent text-white text-[11px] font-sans font-medium shadow-xs hover:bg-accent/90 active:scale-95 transition-all"
          >
            <Plus size={12} strokeWidth={2.5} />
            <span>新对话</span>
          </button>

          {/* 刷新列表 */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            title="刷新历史"
            aria-label="刷新历史"
            className="p-1.5 rounded-lg text-ink-faint hover:text-accent hover:bg-paper-grid/30 active:scale-95 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>

          {/* 关闭抽屉 */}
          <button
            type="button"
            onClick={onClose}
            title="收起抽屉"
            aria-label="收起抽屉"
            className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-paper-grid/30 active:scale-95 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 2. 列表主体 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-1.5 font-sans">
        {loading && sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-12 gap-2 text-ink-faint text-xs">
            <Loader2 size={16} className="animate-spin text-accent" />
            <span>正在加载对话历史…</span>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-12 px-3 text-ink-faint space-y-1.5">
            <History size={24} className="opacity-30 stroke-[1.5]" />
            <p className="text-xs font-medium text-ink-light">暂无历史对话</p>
            <p className="text-[11px] leading-relaxed text-ink-faint/80">
              与画板助手的每次对话都会自动保存在这里，方便随时回看或继续讨论。
            </p>
          </div>
        ) : (
          sessions.map((s) => (
            <ConversationRow
              key={s.workspaceId}
              session={s}
              isCurrent={s.workspaceId === currentWorkspaceId}
              pinning={pinningId === s.workspaceId}
              renaming={renamingId === s.workspaceId}
              deleting={deletingId === s.workspaceId}
              onSelect={(item) => onSelectSession(item.workspaceId)}
              onTogglePin={handleTogglePin}
              onRename={handleRename}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );
};
