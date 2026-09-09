import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchConversationSessions, type ConversationSessionSummary } from './piSessionApi';

/**
 * 对话历史面板共享状态机（PiChatNodeHost / ChatNodeHost 复用）：
 * - 抽屉展开时拉取该用户**全部**对应模式会话（跨节点全局列表，不按节点过滤；来源节点由前端
 *   按 workspaceId 前缀标注）；mode 指定模式（'pi' 默认 / 'llm' / 'agent'），三类互斥不混显——
 *   每个节点抽屉只看得到自己模式的对话历史；version 递增
 *   （收尾 / 置顶 / 删除等时机）时展开状态下自动刷新；
 * - openOverride：外部受控展开态（对话历史与工作区文件合并为单一侧边抽屉时由宿主统一驱动）；
 *   缺省 = 内部自管理。返回的 open 恒为生效值（openOverride ?? 内部状态）。
 */
export function useConversationHistoryPanel(openOverride?: boolean, mode?: 'pi' | 'llm' | 'agent') {
  const [open, setOpen] = useState(false);
  const effectiveOpen = openOverride ?? open;
  const [sessions, setSessions] = useState<ConversationSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);

  const openRef = useRef(effectiveOpen);
  openRef.current = effectiveOpen;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(await fetchConversationSessions(mode));
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    if (effectiveOpen) void load();
  }, [effectiveOpen, version, load]);

  /** 无条件重新拉取（抽屉内「刷新」按钮；面板隐藏时也执行） */
  const refresh = useCallback(() => void load(), [load]);
  /** 版本递增：展开状态下自动刷新（对话收尾 / 置顶 / 删除后调用） */
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  return { open: effectiveOpen, setOpen, sessions, setSessions, loading, refresh, bump };
}