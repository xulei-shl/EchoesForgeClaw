import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { nodesRef, edgesRef } from '../../platform/stores/useCanvasState';
import { ChatNode } from './components/ChatNode';
import { getNodeTitle } from './nodeTypes';
import { buildInjectedContextBlocks } from './contextBlocks';
import { handleAgentSseMessage } from './agentSteps';
import { authHeaders, handleUnauthorized } from './authUtils';
import { makeIdleTimeout } from './idleTimeout';
import { PROMPT_SSE_IDLE_TIMEOUT_MS } from '../../platform/utils/timeouts';
import {
  attachContextToFirstUser,
  attachSkillsToLastUser,
  uiToStore,
} from './chatMessages';
import { mismatchBadgeOf, hasDownstreamOf, type NodeViewHelpers } from './CanvasNodeViews';
import { mergeAgentFiles } from './workspaceFiles';
import {
  MAX_CHAT_IMAGES,
  DEFAULT_CHAT_SETTINGS,
  buildChatContext,
  buildChatImagesFromBlocks,
  collectSkillNames,
  type ChatHostDeps,
} from './chatSendHelpers';
import type {
  AgentFile,
  AgentStep,
  ChatMessage,
  ChatNodeSettings,
  InjectedContextBlock,
} from '../../platform/types';
import type { NodeData } from './graphTypes';

/**
 * Skill Agent（pi）专用节点宿主：服务端会话为唯一真相源。
 *
 * 与 ChatNodeHost（LLM/FastClaw 共用）的本质差异：
 * - pi 会话持久化在服务端 `.pi-agent/run/chat.jsonl`，后端完全忽略前端回传历史；
 *   因此本宿主不做 useChat ↔ store 双向镜像，而是「挂载/收尾时从服务端水合」
 *   （GET /chat/session），useChat 仅作当轮一次性 live 缓冲，流结束后原子交换。
 * - 历史工具调用卡片 / 推理文本 / 内联图片由水合端点反向构建（含鉴权图片卡），
 *   刷新、重挂载后不再依赖 sessionStorage 快照——会话连续性问题的根治方案。
 * - 装配逻辑（AGENTS.md 软链 / skills 软链 / models.json / 会话路径）保持不变，
 *   本宿主只是消费侧的替换。
 */

// ---------------------------------------------------------------------------
// 服务端水合（会话真相源）
// ---------------------------------------------------------------------------

/** GET /chat/session 返回的消息 DTO（与后端 pi-session-hydrate.ts 对齐）。 */
interface HydratedMessageDto {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  agentSteps?: AgentStep[];
  files?: AgentFile[];
  interrupted?: boolean;
}

/** 排队消息（流式中发送不中断当前轮；当前轮结束后自动依次发出，借鉴 Proma followUp 队列） */
interface QueuedMessage {
  id: number;
  text: string;
  images?: string[];
}

/** 自动重试横幅数据（后端 auto_retry_start 结构化事件驱动） */
interface RetryNoticeState {
  attempt: number;
  maxAttempts: number;
  delaySec: number;
  reason: string;
}

const MAX_QUEUE = 10;

const SESSION_CACHE_MAX = 8;
/** 模块级 LRU：key = workspaceId（含节点创建时间戳，跨账号碰撞概率可忽略） */
const sessionCache = new Map<string, ChatMessage[]>();

function cachedSessionOf(ws: string): ChatMessage[] | null {
  const hit = sessionCache.get(ws);
  if (hit) {
    sessionCache.delete(ws);
    sessionCache.set(ws, hit);
  }
  return hit ?? null;
}

function putSessionCache(ws: string, msgs: ChatMessage[]): void {
  sessionCache.delete(ws);
  sessionCache.set(ws, msgs);
  while (sessionCache.size > SESSION_CACHE_MAX) {
    const oldest = sessionCache.keys().next().value;
    if (oldest === undefined) break;
    sessionCache.delete(oldest);
  }
}

function dtoToChatMessage(m: HydratedMessageDto): ChatMessage {
  return {
    role: m.role,
    content: m.content ?? '',
    ...(m.reasoning ? { reasoning: m.reasoning } : {}),
    ...(m.agentSteps?.length ? { agentSteps: m.agentSteps } : {}),
    ...(m.files?.length ? { files: m.files } : {}),
    ...(m.interrupted ? { interrupted: true } : {}),
  };
}

async function fetchPiSessionMessages(ws: string): Promise<ChatMessage[]> {
  const resp = await fetch(
    `/api/modules/bookplate/chat/session?workspace_id=${encodeURIComponent(ws)}`,
    { headers: authHeaders() }
  );
  if (resp.status === 401) {
    handleUnauthorized();
    throw new Error('401');
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as { messages?: HydratedMessageDto[] };
  return (data.messages ?? []).map(dtoToChatMessage);
}

async function fetchWorkspaceFiles(ws: string): Promise<AgentFile[]> {
  const resp = await fetch(
    `/api/modules/bookplate/chat/files?workspace_id=${encodeURIComponent(ws)}`,
    { headers: authHeaders() }
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as { files?: AgentFile[] };
  // 已删除的历史产物不进面板（manifest 可追溯语义由服务端保留）
  return (data.files ?? []).filter((f) => f.exists !== false);
}

/** 剥离 live 段末尾的空气泡占位（零输出失败轮，服务端水合后自然消失，此处仅防闪烁）。 */
function stripEmptyTail(msgs: ChatMessage[]): ChatMessage[] {
  if (!msgs.length) return msgs;
  const last = msgs[msgs.length - 1];
  if (
    last.role === 'assistant' &&
    !last.content &&
    !last.reasoning &&
    !(last.agentSteps && last.agentSteps.length) &&
    !(last.files && last.files.length)
  ) {
    return msgs.slice(0, -1);
  }
  return msgs;
}

// ---------------------------------------------------------------------------

/**
 * Skill Agent 节点宿主（mode==='skill_agent' 的 chat 节点由此渲染）。
 */
export function PiChatNodeHost({
  node,
  h,
  deps,
}: {
  node: NodeData;
  h: NodeViewHelpers;
  deps: ChatHostDeps;
}) {
  const { setNodes, portTypesRef } = deps;
  const nodeId = node.id;

  const statusRef = useRef<'submitted' | 'streaming' | 'ready' | 'error'>('ready');
  const forcedErrorRef = useRef<string | null>(null);
  const idleRef = useRef<{ idle: ReturnType<typeof makeIdleTimeout>; controller: AbortController } | null>(null);
  /** 当轮 agent_file 缓冲：流中只入队，展示与落库在流边界统一并入 */
  const pendingFilesRef = useRef<Map<string, AgentFile>>(new Map());
  /** 水合请求代际号（竞态保护：仅最新一次加载允许写入状态） */
  const loadSeqRef = useRef(0);
  /** 收尾交换代际号（竞态保护：仅最后一轮流的水合结果允许落地） */
  const swapSeqRef = useRef(0);
  /** 用户主动停止标记（停止后的收尾不自动续发排队消息） */
  const interruptedByUserRef = useRef(false);
  /** 当轮以错误收尾标记（错误后的收尾不自动续发排队消息） */
  const runErroredRef = useRef(false);
  /** 排队消息自动续发开关（自然收尾置位；出队/用户停止后复位） */
  const autoNextArmedRef = useRef(false);
  /** send 的最新闭包（自动续发 effect 经 ref 调用，避免陈旧闭包） */
  const sendRef = useRef<(text: string, images?: string[]) => void>(() => {});

  // ---------- 服务端会话状态 ----------
  const wsId =
    typeof node.data?.workspaceId === 'string' && node.data.workspaceId
      ? node.data.workspaceId
      : null;
  const [sessionMsgs, setSessionMsgs] = useState<ChatMessage[] | null>(() =>
    wsId ? cachedSessionOf(wsId) : []
  );
  const sessionMsgsRef = useRef(sessionMsgs);
  sessionMsgsRef.current = sessionMsgs;
  const wsIdRef = useRef(wsId);
  wsIdRef.current = wsId;

  // ---------- 工作区文件面板 ----------
  const [panelOpen, setPanelOpen] = useState(false);
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;
  const [panelFiles, setPanelFiles] = useState<AgentFile[] | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  /** 流收尾时递增，驱动展开状态下的面板刷新 */
  const [panelVersion, setPanelVersion] = useState(0);

  // ---------- 排队消息 / 重试横幅 ----------
  const [msgQueue, setMsgQueue] = useState<QueuedMessage[]>([]);
  const msgQueueRef = useRef(msgQueue);
  msgQueueRef.current = msgQueue;
  const queueIdRef = useRef(1);
  const [retryNotice, setRetryNotice] = useState<RetryNoticeState | null>(null);
  const loadPanel = useCallback(async () => {
    const ws = wsIdRef.current;
    if (!ws) return;
    setPanelLoading(true);
    try {
      const files = await fetchWorkspaceFiles(ws);
      setPanelFiles(files);
    } catch {
      setPanelFiles([]);
    } finally {
      setPanelLoading(false);
    }
  }, []);

  useEffect(() => {
    if (panelOpen) void loadPanel();
  }, [panelOpen, panelVersion, loadPanel]);

  // ---------- useChat：仅作当轮 live 缓冲（不与 store 双向镜像） ----------
  // runSeq 变化重建实例：收尾清空缓冲后，旧 id 的残留状态不会复活
  const [runSeq, setRunSeq] = useState(0);
  const chat = useChat({
    id: `pi:${nodeId}:${runSeq}`,
    transport: new DefaultChatTransport({
      api: '/api/modules/bookplate/chat',
      prepareSendMessagesRequest: async ({ messages, requestMetadata }) => {
        const cur = nodesRef.current.find((n) => n.id === nodeId) ?? null;
        const nodeSettings: ChatNodeSettings = cur?.data?.settings ?? DEFAULT_CHAT_SETTINGS;
        const msgs = uiToStore(messages);
        const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
        let text = lastUser?.content ?? '';

        // 本轮装配的 Skill 名：随请求下发 + 挂到乐观 user 消息 metadata（气泡下方 chips）
        const skillNames = cur ? collectSkillNames(cur) : [];
        if (skillNames.length) {
          setMessages((prev) => attachSkillsToLastUser(prev, skillNames));
        }

        // 首轮上下文注入：仅当服务端会话尚无任何用户消息时执行一次
        // （水合后的首条 user 消息天然携带上下文全文，无需 hasContextInStore 判定）
        const freshSession = !(sessionMsgsRef.current ?? []).some((m) => m.role === 'user');
        let contextImages: string[] = [];
        let contextBlocksForMeta: InjectedContextBlock[] = [];
        if (freshSession && cur) {
          contextBlocksForMeta = buildInjectedContextBlocks(
            cur,
          {
            includeBook: nodeSettings.includeBook,
            includeBookCover: nodeSettings.includeBookCover !== false,
            includeUpstreamText: nodeSettings.includeUpstream !== false,
            includeUpstreamImages: nodeSettings.includeUpstreamImages !== false,
            includeSkills: true,
          },
          nodesRef.current,
          edgesRef.current,
          portTypesRef.current
        );
          const context = buildChatContext(contextBlocksForMeta);
          contextImages = await buildChatImagesFromBlocks(contextBlocksForMeta);
          if (context) text = `${context}\n\n${text}`;
          if (context || contextImages.length || contextBlocksForMeta.length) {
            // 展示用：上下文块挂到乐观 user 消息 metadata（live 气泡下方折叠卡）
            setMessages((prev) =>
              attachContextToFirstUser(prev, '', contextImages, contextBlocksForMeta)
            );
          }
        }

        const turnImages = (
          (requestMetadata as { bookplate?: { images?: string[] } } | undefined)?.bookplate
            ?.images ?? []
        ) as string[];
        const agentImages = [...turnImages, ...contextImages].slice(0, MAX_CHAT_IMAGES);

        // 节点工作区标识：首轮生成并持久化（Skill Agent 产物/文件跨轮保留）
        let ws = typeof cur?.data?.workspaceId === 'string' ? cur.data.workspaceId : '';
        if (cur && !ws) {
          ws = `${nodeId}_${Date.now()}`;
          setNodes((prev) =>
            prev.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, workspaceId: ws } } : n
            )
          );
        }

        return {
          body: {
            // pi 后端忽略前端历史；messages 留空以明确语义
            messages: [],
            message: text,
            images: agentImages,
            config_id: cur?.configId ?? null,
            node_id: nodeId,
            epoch: cur?.data?.epoch ?? 0,
            skills: skillNames,
            workspace_id: ws || null,
            model_name: null,
            agent_config_id: null,
            // thinking level（节点设置；off/空 = 跟随 pi 默认，后端校验白名单）
            thinking: nodeSettings.piThinking || null,
          },
          headers: authHeaders(),
        };
      },
    }),
    onData: (part) => {
      const name = part.type.startsWith('data-') ? part.type.slice('data-'.length) : part.type;
      if (!name.startsWith('agent_')) return;
      if (name === 'agent_file') {
        const file = (part.data ?? {}) as AgentFile;
        if (file && typeof file.url === 'string' && file.url) {
          pendingFilesRef.current.set(file.url, file);
        }
        return;
      }
      if (name === 'agent_retry') {
        // 结构化自动重试：驱动倒计时横幅（成功恢复的 status 会随后覆盖步骤日志）
        const d = (part.data ?? {}) as Partial<RetryNoticeState>;
        if (typeof d.attempt === 'number' && typeof d.delaySec === 'number') {
          setRetryNotice({
            attempt: d.attempt,
            maxAttempts: typeof d.maxAttempts === 'number' ? d.maxAttempts : 0,
            delaySec: d.delaySec,
            reason: typeof d.reason === 'string' ? d.reason : '上游请求失败',
          });
        }
        return;
      }
      if (name === 'agent_status') {
        // 自动重试成功恢复：立即撤下倒计时横幅（步骤日志仍保留该状态）
        const msgText = (part.data as { message?: string } | null)?.message ?? '';
        if (msgText.includes('已自动恢复')) setRetryNotice(null);
      }
      handleAgentSseMessage(setNodes, nodeId, name, JSON.stringify(part.data));
    },
    onFinish: () => {
      idleRef.current?.idle.clear();
      idleRef.current = null;
      runErroredRef.current = false;
      finishRunRef.current();
    },
    onError: (err) => {
      const msg = err?.message ?? '';
      if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('token')) {
        handleUnauthorized();
      }
      idleRef.current?.idle.clear();
      idleRef.current = null;
      runErroredRef.current = true;
      finishRunRef.current();
    },
  });
  const { status, messages: uiMessages, error: chatError, setMessages } = chat;
  const { sendMessage, stop: chatStop, clearError } = chat;
  statusRef.current = status;

  /**
   * 流结束收尾：重新从服务端水合并原子交换（同批更新水合历史 + 清空 live 缓冲，
   * 消除「实时已清、持久未到」的闪烁空档；代际号防旧流覆盖新一轮）。
   * 经 ref 间接调用（声明于 useChat 之后）。
   */
  const finishRunRef = useRef<() => void>(() => {});
  const finishRun = useCallback(() => {
    setRetryNotice(null);
    const seq = ++swapSeqRef.current;
    const ws = wsIdRef.current;
    if (!ws) return;
    void fetchPiSessionMessages(ws)
      .then((msgs) => {
        if (seq !== swapSeqRef.current) return;
        putSessionCache(ws, msgs);
        setSessionMsgs(msgs);
        setMessages([]);
        pendingFilesRef.current.clear();
        setRunSeq((v) => v + 1); // 丢弃旧 live 实例
        setPanelVersion((v) => v + 1);
        if (panelOpenRef.current) void loadPanel();
        // 自然收尾（非用户停止/出错中断）才自动续发排队消息
        autoNextArmedRef.current =
          !interruptedByUserRef.current && !runErroredRef.current && msgQueueRef.current.length > 0;
      })
      .catch(() => {
        /* 水合失败：保留 live 展示（下次挂载/收尾再对齐服务端） */
      });
  }, [loadPanel, setMessages]);
  finishRunRef.current = finishRun;

  // ---------- 水合：挂载 / workspaceId 变化（清空对话再生）时拉取服务端会话 ----------
  useEffect(() => {
    if (!wsId) {
      setSessionMsgs([]);
      return;
    }
    const cached = cachedSessionOf(wsId);
    if (cached) {
      setSessionMsgs(cached);
      return;
    }
    const seq = ++loadSeqRef.current;
    setSessionMsgs(null); // loading 态
    void fetchPiSessionMessages(wsId)
      .then((msgs) => {
        if (seq !== loadSeqRef.current) return;
        putSessionCache(wsId, msgs);
        setSessionMsgs(msgs);
      })
      .catch(() => {
        if (seq === loadSeqRef.current) setSessionMsgs([]);
      });
  }, [wsId]);

  // workspaceId 变化（含清空对话再生）：清掉旧 live 缓冲、面板缓存与错误态
  useEffect(() => {
    try {
      setMessages([]);
    } catch {
      /* 实例已重建 */
    }
    setPanelFiles(null);
    forcedErrorRef.current = null;
    pendingFilesRef.current.clear();
  }, [wsId, setMessages]);

  // 卸载清理：空闲计时器
  useEffect(
    () => () => {
      idleRef.current?.idle.clear();
    },
    []
  );

  // ---------- 显示消息合成：水合历史 + 当轮 live 段 ----------
  const isStreaming = status === 'submitted' || status === 'streaming';
  const nodeSteps: AgentStep[] = Array.isArray(node.data?.agentSteps) ? node.data.agentSteps : [];
  const bufFiles = pendingFilesRef.current.size ? [...pendingFilesRef.current.values()] : [];

  const liveSegment = (() => {
    const live = uiToStore(uiMessages);
    if (!live.length) return live;
    const cleaned = stripEmptyTail(live);
    const lastIdx = cleaned.length - 1;
    if (isStreaming && cleaned[lastIdx]?.role === 'assistant') {
      cleaned[lastIdx] = {
        ...cleaned[lastIdx],
        streaming: true,
        agentSteps: nodeSteps.length ? nodeSteps : cleaned[lastIdx].agentSteps,
        ...(bufFiles.length
          ? { files: mergeAgentFiles(cleaned[lastIdx].files, bufFiles) }
          : {}),
      };
    }
    return cleaned;
  })();
  const messages: ChatMessage[] = [...(sessionMsgs ?? []), ...liveSegment];

  // ---------- 单向镜像：显示消息 → 节点 store（下游 output 与画布持久化） ----------
  const lastMirroredRef = useRef<string>(
    JSON.stringify(Array.isArray(node.data?.messages) ? node.data.messages : [])
  );

  useEffect(() => {
    // 水合未就绪：绝不动 store（防止冷启动加载窗口内空快照覆盖既有消息）
    if (sessionMsgsRef.current === null) return;
    const json = JSON.stringify(messages);
    const nodeNow = nodesRef.current.find((n) => n.id === nodeId);
    const forced = forcedErrorRef.current;
    const errMsg =
      forced ?? (status === 'error' ? (chatError?.message ?? '对话失败，请重试') : null);
    const stateChanged =
      json !== lastMirroredRef.current ||
      isStreaming !== !!nodeNow?.data?.isGenerating ||
      errMsg !== (nodeNow?.data?.error ?? null);
    if (!stateChanged) return;
    lastMirroredRef.current = json;
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    // 输出 = 最后一条有正文的助手回复（错误/中断/流式中不覆盖既有输出）
    const output =
      isStreaming || errMsg || lastAssistant?.interrupted || !lastAssistant?.content
        ? undefined
        : lastAssistant.content;
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                messages,
                isGenerating: isStreaming,
                error: errMsg,
                ...(output !== undefined ? { output } : {}),
              },
            }
          : n
      )
    );
    if (forced && !isStreaming) forcedErrorRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isStreaming, status]);

  // ---------- 对外操作 ----------
  const send = useCallback(
    (text: string, images?: string[]) => {
      // 流式中不拒绝：进入本地队列（借鉴 Proma followUp），当前轮自然结束后自动发出
      if (statusRef.current === 'submitted' || statusRef.current === 'streaming') {
        if (!text && !images?.length) return;
        setMsgQueue((q) =>
          q.length >= MAX_QUEUE
            ? q
            : [...q, { id: queueIdRef.current++, text, images }]
        );
        return;
      }
      const nodeNow = nodesRef.current.find((n) => n.id === nodeId);
      if (!nodeNow || nodeNow.type !== 'chat') return;
      interruptedByUserRef.current = false;
      runErroredRef.current = false;
      pendingFilesRef.current.clear();
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, agentSteps: [], error: null, isGenerating: true } }
            : n
        )
      );
      const controller = new AbortController();
      const idle = makeIdleTimeout(controller, PROMPT_SSE_IDLE_TIMEOUT_MS);
      idle.arm();
      idleRef.current = { idle, controller };
      controller.signal.addEventListener('abort', () => {
        if (idle.isTimedOut()) forcedErrorRef.current = '对话超时，请重试';
        void chatStop();
      });
      void sendMessage({ text }, { metadata: { bookplate: { images } } });
    },
    [nodeId, setNodes, chatStop, sendMessage]
  );
  sendRef.current = send;

  // 自动续发：上一轮自然收尾且队列非空时出队首条发送（effect 中调用最新 send 闭包）
  useEffect(() => {
    const streaming = status === 'submitted' || status === 'streaming';
    if (streaming || !autoNextArmedRef.current) return;
    autoNextArmedRef.current = false;
    if (interruptedByUserRef.current || runErroredRef.current) return;
    const q = msgQueueRef.current;
    if (!q.length) return;
    const first = q[0]!;
    setMsgQueue((prev) => prev.filter((m) => m.id !== first.id));
    sendRef.current(first.text, first.images);
  }, [status, msgQueue]);

  const stop = useCallback(() => {
    if (statusRef.current !== 'submitted' && statusRef.current !== 'streaming') return;
    interruptedByUserRef.current = true;
    autoNextArmedRef.current = false;
    void chatStop();
  }, [chatStop]);

  /** 撤回排队消息 */
  const recallQueued = useCallback((qid: number) => {
    setMsgQueue((prev) => prev.filter((m) => m.id !== qid));
  }, []);

  /** 立即发送排队消息（空闲时有效；流式中忽略——继续留在队列） */
  const sendQueuedNow = useCallback(
    (qid: number) => {
      if (statusRef.current === 'submitted' || statusRef.current === 'streaming') return;
      const item = msgQueueRef.current.find((m) => m.id === qid);
      if (!item) return;
      setMsgQueue((prev) => prev.filter((m) => m.id !== qid));
      sendRef.current(item.text, item.images);
    },
    []
  );

  /**
   * 重试：重发最后一条用户消息。首条会话消息内联了注入上下文（服务端真相），
   * 原样重发会向 pi 会话重复注入大块上下文——该场景直接退出（横幅随 clearError 消失）。
   * （messages 经 ref 读取：数组每次渲染重建，不进依赖数组）
   */
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const retry = useCallback(() => {
    if (statusRef.current !== 'ready' && statusRef.current !== 'error') return;
    const lastUser = [...messagesRef.current].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const firstHydrated = (sessionMsgsRef.current ?? []).find((m) => m.role === 'user');
    if (firstHydrated && lastUser.content === firstHydrated.content) {
      clearError();
      return;
    }
    if (statusRef.current === 'error') clearError();
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, agentSteps: [], error: null, isGenerating: true } }
          : n
      )
    );
    void sendMessage({ text: lastUser.content });
  }, [nodeId, setNodes, sendMessage, clearError]);

  // ---------- 渲染 ----------
  const config = h.configOf(node);
  const settings: ChatNodeSettings = node.data?.settings ?? DEFAULT_CHAT_SETTINGS;

  const firstUser = messages.find((m: ChatMessage) => m.role === 'user');
  const contextBlocks =
    messages.length > 0 && firstUser
      ? firstUser.contextBlocks ??
        (firstUser.context || firstUser.contextImages?.length
          ? [
              {
                id: 'injected_context',
                title: '注入上下文',
                text: firstUser.context,
                images: firstUser.contextImages,
              },
            ]
          : [])
      : buildInjectedContextBlocks(
          node,
          {
            includeBook: settings.includeBook,
            includeBookCover: settings.includeBookCover !== false,
            includeUpstreamText: settings.includeUpstream !== false,
            includeUpstreamImages: settings.includeUpstreamImages !== false,
            includeSkills: true,
          },
          h.nodes,
          h.edges,
          portTypesRef.current
        );

  return (
    <ChatNode
      id={node.id}
      initialX={node.x}
      initialY={node.y}
      title={getNodeTitle(node)}
      messages={messages}
      contextBlocks={contextBlocks}
      workspaceId={wsId}
      agentName={config?.skill_agent_config_name ?? undefined}
      mode="skill_agent"
      configId={node.configId ?? null}
      agentSteps={nodeSteps}
      group={config?.group?.trim() || undefined}
      mismatchBadge={mismatchBadgeOf(node, h)}
      hasDownstream={hasDownstreamOf(node, h.edges)}
      isGenerating={!!node.data?.isGenerating}
      error={node.data?.error ?? null}
      settings={settings}
      onRemove={() => h.handleRemove(node.id)}
      onSend={(_id, text, images) => send(text, images)}
      onUpdateSettings={h.handleUpdateChatSettingsFor}
      onClearChat={h.handleClearChatFor}
      onStop={stop}
      onRetry={retry}
      onPositionChange={h.handlePositionChange}
      onSizeChange={h.handleSizeChange}
      onDrag={h.handleNodeDrag}
      footer={h.renderFooter(node)}
      onContextMenu={(e) => h.handleNodeContextMenu(e, node.id)}
      workspaceFiles={{
        open: panelOpen,
        loading: panelLoading,
        files: panelFiles ?? [],
        onToggle: () => setPanelOpen((v) => !v),
        onRefresh: () => void loadPanel(),
      }}
      retryNotice={retryNotice}
      messageQueue={{
        items: msgQueue,
        onRecall: recallQueued,
        onSendNow: sendQueuedNow,
      }}
    />
  );
}
