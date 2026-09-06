import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchConversationSessions, type ConversationSessionSummary } from './piSessionApi';

/**
 * 对话历史面板共享状态机（PiChatNodeHost 专用）：
 * - 抽屉展开时拉取该节点的对话历史列表；version 递增（收尾 / 置顶 / 删除等时机）时展开状态下自动刷新；
 * - 与 useWorkspaceFilesPanel 同构：loader 经 ref 读取，调用方可直接传入依赖节点 id 的内联函数。
 */
export function useConversationHistoryPanel(nodeId: string) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<ConversationSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);

  const openRef = useRef(open);
  openRef.current = open;

  const nodeIdRef = useRef(nodeId);
  nodeIdRef.current = nodeId;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(await fetchConversationSessions(nodeIdRef.current));
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, version, load]);

  /** 无条件重新拉取（抽屉内「刷新」按钮；面板隐藏时也执行） */
  const refresh = useCallback(() => void load(), [load]);
  /** 版本递增：展开状态下自动刷新（对话收尾 / 置顶 / 删除后调用） */
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  return { open, setOpen, sessions, setSessions, loading, refresh, bump };
}