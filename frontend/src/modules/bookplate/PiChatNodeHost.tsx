import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { nodesRef, edgesRef } from '../../platform/stores/useCanvasState';
import { ChatNode } from './components/ChatNode';
import type { ChatSidePanel } from './components/chat/ChatSidePanel';
import { useConversationHistoryPanel } from './useConversationHistoryPanel';
import { getNodeTitle } from './nodeTypes';
import { buildContextBlocks } from './contextBlocks';
import { isBookCoverEnabled } from './execution';
import { authHeaders, handleUnauthorized } from './authUtils';
import { makeIdleTimeout } from './idleTimeout';
import { urlToDataUrl } from './imageUpload';
import { PROMPT_SSE_IDLE_TIMEOUT_MS } from '../../platform/utils/timeouts';
import { mismatchBadgeOf, type NodeViewHelpers } from './CanvasNodeViews';
import { mergeAgentFiles } from './workspaceFiles';
import { useWorkspaceFilesPanel } from './useWorkspaceFilesPanel';
import {
  cachedSessionOf,
  putSessionCache,
  evictSessionCache,
  fetchPiSession,
  fetchWorkspaceFiles,
  uploadWorkspaceFile,
  importInheritedImages,
  postUiResponse,
  setConversationPinned,
  deleteConversationSession,
  type UploadedWorkspaceFile,
} from './piSessionApi';
import {
  piStreamReducer,
  INITIAL_PI_STREAM,
  parseSseStream,
  type PendingUiRequest,
} from './piStream';
import {
  MAX_CHAT_IMAGES,
  DEFAULT_CHAT_SETTINGS,
  buildChatContext,
  collectBlockImageUrls,
  collectSkillNames,
  stripInjectedContext,
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
 * 与 ChatNodeHost（LLM/FastClaw 共用，走 AI SDK useChat）的本质差异：
 * - pi 会话持久化在服务端 `.pi-agent/run/chat.jsonl`，后端完全忽略前端回传历史；
 *   因此本宿主不做 useChat ↔ store 双向镜像，而是「挂载/收尾时从服务端水合」
 *   （GET /chat/session）。
 * - 流式输出改为「原始 SSE + 纯 reducer」（piStream）：后端以 `data: ChatStreamEvent`
 *   推流（stream.ts chatStreamToSseResponse），前端逐条归约出当轮 assistant 消息，
 *   流结束后原子交换为服务端水合历史——借鉴 pi-web 的 streamReducer 设计，取代
 *   此前 useChat 作一次性 live 缓冲 + 收尾重建实例的做法。
 * - 历史工具调用卡片 / 推理文本 / 内联图片由水合端点反向构建（含鉴权图片卡），
 *   刷新、重挂载后不再依赖 sessionStorage 快照——会话连续性问题的根治方案。
 * - 装配逻辑（AGENTS.md 软链 / skills 软链 / models.json / 会话路径）保持不变，
 *   本宿主只是消费侧的替换。
 */

// ---------------------------------------------------------------------------
// 服务端会话 API（水合 / 文件 / 上传 / 导入 / UI 作答）见 piSessionApi.ts
// ---------------------------------------------------------------------------

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

/**
 * Skill Agent 节点宿主（mode==='skill_agent' 的 chat 节点由此渲染）。
 */
function PiChatNodeHostInner({
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
  /** 当轮运行代际号（竞态保护：新一轮 send / 工作区切换 / 卸载后，陈旧 SSE 事件与水合结果一律丢弃） */
  const runSeqRef = useRef(0);
  /** 用户主动停止标记（停止后的收尾不自动续发排队消息） */
  const interruptedByUserRef = useRef(false);
  /** 当轮以错误收尾标记（错误后的收尾不自动续发排队消息） */
  const runErroredRef = useRef(false);
  /** 排队消息自动续发开关（自然收尾置位；出队/用户停止后复位） */
  const autoNextArmedRef = useRef(false);
  /** send 的最新闭包（自动续发 effect 经 ref 调用，避免陈旧闭包） */
  const sendRef = useRef<(text: string, images?: string[]) => void>(() => {});
  /** 首轮上下文已发送标记（首轮注入后置位；清空对话/workspaceId 变化时复位） */
  const contextSentRef = useRef(false);
  /** 首轮用户原始输入（不含注入上下文），水合后用于还原首条 user 消息展示 */
  const firstUserTextRef = useRef<string | null>(null);

  // ---------- 服务端会话状态 ----------
  const wsId =
    typeof node.data?.workspaceId === 'string' && node.data.workspaceId
      ? node.data.workspaceId
      : null;
  const [sessionMsgs, setSessionMsgs] = useState<ChatMessage[] | null>(() =>
    wsId ? (cachedSessionOf(wsId)?.messages ?? null) : []
  );
  const sessionMsgsRef = useRef(sessionMsgs);
  sessionMsgsRef.current = sessionMsgs;
  const wsIdRef = useRef(wsId);
  wsIdRef.current = wsId;
  /** 当前 live 请求实际使用的工作区，避免 setNodes 异步更新导致收尾读取旧值 */
  const activeRequestWsRef = useRef<string | null>(wsId);

  // ---------- 侧边面板（工作区文件 + 对话历史合并为单一右侧抽屉，Tab 切换） ----------
  // 单一展开态 sideOpen 统一驱动两个面板状态机（openOverride 受控模式）；
  // 文件面板：展开时加载 / 收尾自动刷新，loader 返回 null 表示跳过；
  // 对话历史面板：展开时加载该节点名下 pi 会话列表 / 收尾自动刷新。
  const [sideOpen, setSideOpen] = useState(false);
  const panel = useWorkspaceFilesPanel(
    async () => {
      const ws = wsIdRef.current;
      if (!ws) return null;
      return fetchWorkspaceFiles(ws);
    },
    sideOpen
  );
  const convPanel = useConversationHistoryPanel(sideOpen);

  // ---------- 排队消息 / 重试横幅 ----------
  const [msgQueue, setMsgQueue] = useState<QueuedMessage[]>([]);
  const msgQueueRef = useRef(msgQueue);
  msgQueueRef.current = msgQueue;
  const queueIdRef = useRef(1);
  const [retryNotice, setRetryNotice] = useState<RetryNoticeState | null>(null);

  // ---------- 流式状态：原始 SSE + 纯 reducer（替代 useChat 一次性 live 缓冲） ----------
  // streamState.steps 按「每条助手消息」拆分（思考 + 正文 + 工具步骤，见 piStream），
  // 流式期逐条独立气泡展示；流结束后保留至水合提交（dispatch end），
  // 避免「实时已清、持久未到」的闪烁空档；isStreaming 驱动打字光标与 isGenerating。
  const [streamState, dispatchStream] = useReducer(piStreamReducer, INITIAL_PI_STREAM);
  const [settledSeq, setSettledSeq] = useState(0);

  /**
   * 水合消息清洗：剥离首条用户消息开头的注入上下文，只保留纯用户输入（上下文已在顶部折叠卡片展示）。
   */
  const sanitizeHydrated = useCallback(
    (rawMsgs: ChatMessage[]): ChatMessage[] => {
      const cur = nodesRef.current.find((n) => n.id === nodeId);
      const curSettings: ChatNodeSettings = cur?.data?.settings ?? DEFAULT_CHAT_SETTINGS;
      const blocks = cur
        ? buildContextBlocks(
            cur,
            curSettings,
            nodesRef.current,
            edgesRef.current,
            portTypesRef.current
          )
        : [];
      return rawMsgs.map((m, idx) => {
        if (m.role !== 'user' || idx !== 0) return m;
        let content = stripInjectedContext(m.content, blocks);
        if (!content && firstUserTextRef.current) {
          content = firstUserTextRef.current;
        }
        return { ...m, content };
      });
    },
    [nodeId, portTypesRef]
  );

  /**
   * 流结束收尾：重新从服务端水合并原子交换（同批更新水合历史 + 复位 live 状态，
   * 消除「实时已清、持久未到」的闪烁空档；代际号防旧流覆盖新一轮）。
   * 经 ref 间接调用（供 SSE 消费循环的 finally 使用）。
   */
  const finishRunRef = useRef<() => void>(() => {});
  const finishRun = useCallback(() => {
    setRetryNotice(null);
    const seq = ++swapSeqRef.current;
    const run = runSeqRef.current;
    const ws = activeRequestWsRef.current ?? wsIdRef.current;
    if (!ws) return;
    void fetchPiSession(ws)
      .then(({ messages: rawMsgs, widgets }) => {
        if (seq !== swapSeqRef.current || run !== runSeqRef.current) return;
        const msgs = sanitizeHydrated(rawMsgs);
        putSessionCache(ws, { messages: msgs, widgets });
        setSessionMsgs(msgs);
        dispatchStream({ type: 'end' });
        dispatchStream({ type: 'widget_set_all', widgets });
        pendingFilesRef.current.clear();
        optimisticUserRef.current = null;
        activeRequestWsRef.current = ws;
        setSettledSeq((v) => v + 1);
        panel.bump();
        panel.refreshIfOpen();
        // 对话历史列表在展开状态下同步刷新（新会话 / 新轮次进入列表）
        convPanel.bump();
        // 自然收尾（非用户停止/出错中断）才自动续发排队消息
        autoNextArmedRef.current =
          !interruptedByUserRef.current && !runErroredRef.current && msgQueueRef.current.length > 0;
      })
      .catch(() => {
        /* 水合失败：保留 live 展示（下次挂载/收尾再对齐服务端） */
      });
  }, [panel.refreshIfOpen, sanitizeHydrated, convPanel.bump]);
  finishRunRef.current = finishRun;

  // workspaceId 变化（含清空对话再生）：作废旧轮（SSE/水合）、复位 live 状态与缓存。
  // 必须在「水合拉取」effect 之前执行：先清空旧工作区的 widget/会话态，再装载新工作区数据。
  useEffect(() => {
    // 首轮发送会自行生成并持久化 workspaceId（null → `${nodeId}_${ts}`）。若该转换
    // 是当前在途 run 自己产生的（activeRequestWsRef 已指向新 ws 且 run 未结束），在此
    // 作废旧轮会把首条消息整个丢弃：前端拦截器 run !== runSeqRef 判定通过、SSE 被
    // idle abort 中断 → 界面「无输出」；同时 contextSentRef 被复位 → 后续补发不再注入
    // 上级上下文。仅对「非在途 self 工作区赋值」（清空对话再生、外部写入）作废旧轮。
    const selfAssigned =
      activeRequestWsRef.current === wsId &&
      (statusRef.current === 'submitted' || statusRef.current === 'streaming');
    if (!selfAssigned) {
      runSeqRef.current += 1;
      idleRef.current?.controller.abort();
      dispatchStream({ type: 'end' });
      dispatchStream({ type: 'widget_set_all', widgets: [] });
      panel.reset();
      forcedErrorRef.current = null;
      pendingFilesRef.current.clear();
      contextSentRef.current = false;
      firstUserTextRef.current = null;
      statusRef.current = 'ready';
    }
    activeRequestWsRef.current = wsId;
  }, [wsId]);

  // ---------- 水合：挂载 / workspaceId 变化（清空对话再生）时拉取服务端会话 ----------
  useEffect(() => {
    if (!wsId) {
      setSessionMsgs([]);
      return;
    }
    const cached = cachedSessionOf(wsId);
    if (cached) {
      setSessionMsgs(cached.messages);
      dispatchStream({ type: 'widget_set_all', widgets: cached.widgets });
      // 会话产生过完整助手回复才视为「上下文已注入」：仅剩孤立 user 消息（首轮被
      // 中断/未落完整）时保持未发送态，下次发送仍会重新注入上级上下文。
      if (cached.messages.some((m) => m.role === 'assistant')) contextSentRef.current = true;
      return;
    }
    const seq = ++loadSeqRef.current;
    setSessionMsgs(null); // loading 态
    void fetchPiSession(wsId)
      .then(({ messages: rawMsgs, widgets }) => {
        if (seq !== loadSeqRef.current) return;
        const msgs = sanitizeHydrated(rawMsgs);
        putSessionCache(wsId, { messages: msgs, widgets });
        setSessionMsgs(msgs);
        dispatchStream({ type: 'widget_set_all', widgets });
        // 会话产生过完整助手回复才视为「上下文已注入」：仅剩孤立 user 消息（首轮被
        // 中断/未落完整）时保持未发送态，下次发送仍会重新注入上级上下文。
        if (msgs.some((m) => m.role === 'assistant')) contextSentRef.current = true;
      })
      .catch(() => {
        if (seq === loadSeqRef.current) setSessionMsgs([]);
      });
  }, [wsId, sanitizeHydrated]);

  // 卸载清理：作废在途请求（中止 SSE 读取与水合），清理空闲计时
  useEffect(
    () => () => {
      runSeqRef.current += 1;
      idleRef.current?.controller.abort();
      idleRef.current?.idle.clear();
    },
    []
  );

  // ---------- 显示消息合成：水合历史 + 当轮乐观用户消息 + 当轮 live assistant ----------
  // 乐观用户消息：记录当轮用户输入纯文本与图片（不含注入的上下文），
  // 在流式执行及水合完成前始终作为当轮用户消息稳定显示，确保思考期间气泡不消失。
  const optimisticUserRef = useRef<ChatMessage | null>(null);
  const nodeSteps: AgentStep[] = Array.isArray(node.data?.agentSteps) ? node.data.agentSteps : [];
  const bufFiles = pendingFilesRef.current.size ? [...pendingFilesRef.current.values()] : [];

  // 当轮 live assistant 消息列表：按 streamState.steps 逐条助手消息拆分成独立气泡
  // （每步 = 思考 + 正文 + 工具步骤 + 问答卡片），与水合后的分消息形态对齐。
  // 仅最后一条（在跑步骤）打 streaming 标记；已完结步骤以静态消息展示。
  // 流结束后 steps 保留至水合提交（消除收尾闪烁），水合完成即让位给历史。
  const liveMessages: ChatMessage[] = (() => {
    const inFlight = optimisticUserRef.current !== null || streamState.isStreaming;
    if (!inFlight) return [];
    const steps = streamState.steps;
    if (!steps.some((s) => s.content || s.reasoning || s.agentSteps.length) && !bufFiles.length) {
      return [];
    }
    const lastIdx = steps.length - 1;
    const out: ChatMessage[] = [];
    steps.forEach((s, i) => {
      const isActive = i === lastIdx;
      const files = isActive && bufFiles.length ? mergeAgentFiles(undefined, bufFiles) : null;
      if (!s.content && !s.reasoning && !s.agentSteps.length && !files?.length) return;
      out.push({
        role: 'assistant',
        content: s.content,
        ...(s.reasoning ? { reasoning: s.reasoning } : {}),
        ...(s.agentSteps.length ? { agentSteps: s.agentSteps } : {}),
        streaming: streamState.isStreaming && isActive,
        ...(files?.length ? { files } : {}),
      });
    });
    return out;
  })();

  const messages: ChatMessage[] = [
    ...(sessionMsgs ?? []),
    ...(optimisticUserRef.current ? [optimisticUserRef.current] : []),
    ...liveMessages,
  ];

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
    const errMsg = forced ?? streamState.error ?? null;
    const stateChanged =
      json !== lastMirroredRef.current ||
      streamState.isStreaming !== !!nodeNow?.data?.isGenerating ||
      errMsg !== (nodeNow?.data?.error ?? null);
    if (!stateChanged) return;
    lastMirroredRef.current = json;
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    // 输出 = 最后一条有正文的助手回复（错误/中断/流式中不覆盖既有输出）
    const output =
      streamState.isStreaming || errMsg || lastAssistant?.interrupted || !lastAssistant?.content
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
                isGenerating: streamState.isStreaming,
                error: errMsg,
                ...(output !== undefined ? { output } : {}),
              },
            }
          : n
      )
    );
    if (forced && !streamState.isStreaming) forcedErrorRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, streamState.isStreaming, streamState.error]);

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
      const run = ++runSeqRef.current;
      statusRef.current = 'submitted';
      // 首轮：记录用户原始输入以便水合后还原展示（剥离注入的上下文前缀）
      if (!contextSentRef.current) {
        firstUserTextRef.current = text;
      }
      // 立即记录用户消息；不等待上下文构建或首个 SSE 事件（确保思考期间气泡不消失）。
      optimisticUserRef.current = {
        role: 'user',
        content: text,
        ...(images?.length ? { images } : {}),
      };
      dispatchStream({ type: 'start' });
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, agentSteps: [], error: null, isGenerating: true } }
            : n
        )
      );

      void (async () => {
        const cur = nodesRef.current.find((n) => n.id === nodeId) ?? null;
        const nodeSettings: ChatNodeSettings = cur?.data?.settings ?? DEFAULT_CHAT_SETTINGS;
        const skillNames = cur ? collectSkillNames(cur) : [];
        // 本轮装配的 Skill 名挂到乐观 user 消息（气泡下方 chips）
        if (skillNames.length && optimisticUserRef.current) {
          optimisticUserRef.current = { ...optimisticUserRef.current, skills: skillNames };
        }

        // 节点工作区标识：首轮生成并持久化（Skill Agent 产物/文件跨轮保留）。
        // 在上下文注入之前确定：继承图片需先落盘 inputs/ 才能以路径引用。
        let ws = typeof cur?.data?.workspaceId === 'string' ? cur.data.workspaceId : '';
        if (!ws) {
          ws = `${nodeId}_${Date.now()}`;
        }
        // 先写 ref，再异步持久化到节点 store；本轮收尾必须使用同一个工作区。
        activeRequestWsRef.current = ws;
        if (cur && cur.data?.workspaceId !== ws) {
          setNodes((prev) =>
            prev.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, workspaceId: ws } } : n
            )
          );
        }

        // 首轮上下文注入：仅当本节点尚未发送过上下文时执行一次
        // （contextSentRef 主动标记，避免水合失败后误判 freshSession 导致重复注入）
        const contextBlocksForMeta: InjectedContextBlock[] = [];
        let contextImages: string[] = [];
        let wireText = text;
        if (!contextSentRef.current && cur) {
          contextBlocksForMeta.push(
            ...buildContextBlocks(
              cur,
              nodeSettings,
              nodesRef.current,
              edgesRef.current,
              portTypesRef.current
            )
          );
          const context = buildChatContext(contextBlocksForMeta);
          // 继承图片分流：/static/ 本地文件、豆瓣封面代理、data URL（图片上传节点）→ 服务端
          // 拷入工作区 inputs/ 并以路径引用注入（【继承图片】块置于上下文之前，水合剥离依赖
          // stripInjectedContext 的通用前缀规则）；仅剩的外部 URL（如豆瓣直链）走 base64 兜底。
          const allImgUrls = collectBlockImageUrls(contextBlocksForMeta);
          const staticUrls = allImgUrls.filter((u) => u.startsWith('/static/'));
          const coverUrls = allImgUrls.filter((u) => u.startsWith('/api/modules/bookplate/cover?'));
          const dataUrls = allImgUrls.filter((u) => u.startsWith('data:'));
          const base64Urls = allImgUrls.filter(
            (u) => !u.startsWith('/static/') && !u.startsWith('/api/modules/bookplate/cover?') && !u.startsWith('data:')
          );
          let inheritedPaths: string[] = [];
          const base64Fallback: string[] = [...base64Urls];
          if (staticUrls.length || coverUrls.length || dataUrls.length) {
            try {
              inheritedPaths = await importInheritedImages(ws, {
                urls: [...staticUrls, ...coverUrls],
                dataUrls,
              });
            } catch {
              // 导入失败（接口异常/离线）：这些图降级 base64 通道，不阻断对话
              base64Fallback.push(...staticUrls, ...coverUrls, ...dataUrls);
            }
          }
          contextImages = [];
          for (const u of base64Fallback) {
            if (contextImages.length >= MAX_CHAT_IMAGES) break;
            if (u.startsWith('data:')) {
              contextImages.push(u);
              continue;
            }
            try {
              const dataUrl = await urlToDataUrl(u);
              if (dataUrl && contextImages.length < MAX_CHAT_IMAGES) contextImages.push(dataUrl);
            } catch {
              // 无法访问 / 非图片的 URL 直接跳过，不阻断对话
            }
          }
          const wireParts: string[] = [];
          if (inheritedPaths.length) {
            wireParts.push(`【继承图片】\n${inheritedPaths.map((p) => `- ${p}`).join('\n')}`);
          }
          if (context) wireParts.push(context);
          wireParts.push(text);
          wireText = wireParts.join('\n\n');
          if (contextBlocksForMeta.length && optimisticUserRef.current) {
            optimisticUserRef.current = {
              ...optimisticUserRef.current,
              contextBlocks: contextBlocksForMeta,
            };
          }
          contextSentRef.current = true;
        }

        const turnImages = [...(images ?? []), ...contextImages].slice(0, MAX_CHAT_IMAGES);

        const controller = new AbortController();
        const idle = makeIdleTimeout(controller, PROMPT_SSE_IDLE_TIMEOUT_MS);
        idle.arm();
        idleRef.current = { idle, controller };
        controller.signal.addEventListener('abort', () => {
          if (idle.isTimedOut() && run === runSeqRef.current) {
            forcedErrorRef.current = '对话超时，请重试';
          }
        });

        try {
          const resp = await fetch('/api/modules/bookplate/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            signal: controller.signal,
            body: JSON.stringify({
              // pi 后端忽略前端历史；messages 留空以明确语义
              messages: [],
              message: wireText,
              images: turnImages,
              config_id: cur?.configId ?? null,
              node_id: nodeId,
              epoch: cur?.data?.epoch ?? 0,
              skills: skillNames,
              workspace_id: ws || null,
              model_name: null,
              agent_config_id: null,
              // thinking 开关（on/off/空 = 跟随模型默认；后端映射 --thinking high/off）
              thinking: nodeSettings.piThinking || null,
            }),
          });
          if (run !== runSeqRef.current) return;
          if (resp.status === 401) {
            handleUnauthorized();
            throw new Error('401');
          }
          if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
          if (statusRef.current === 'submitted') statusRef.current = 'streaming';

          for await (const evt of parseSseStream(resp.body)) {
            if (run !== runSeqRef.current) return;
            // 收到任何事件即证明连接活跃，重置空闲计时（避免重试期间被误杀）
            idleRef.current?.idle.reset();
            switch (evt.type) {
              case 'content_delta':
                if (evt.delta) dispatchStream({ type: 'content', delta: evt.delta });
                break;
              case 'reasoning_delta':
                if (evt.delta) dispatchStream({ type: 'reasoning', delta: evt.delta });
                break;
              case 'agent_file': {
                const f = evt.file;
                if (f && typeof f.url === 'string' && f.url) {
                  pendingFilesRef.current.set(f.url, f);
                }
                break;
              }
              case 'agent_retry':
                // 结构化自动重试：驱动倒计时横幅（成功恢复的 status 会随后覆盖步骤日志）
                if (typeof evt.attempt === 'number' && typeof evt.delaySec === 'number') {
                  setRetryNotice({
                    attempt: evt.attempt,
                    maxAttempts: evt.maxAttempts ?? 0,
                    delaySec: evt.delaySec,
                    reason: evt.reason || '上游请求失败',
                  });
                }
                break;
              case 'turn_start':
                // 空闲监听续轮起始（后台子代理完成自动续轮）：强制开启新步骤气泡
                dispatchStream({ type: 'turn_start' });
                break;
              case 'heartbeat':
                // 心跳仅保持连接活跃（idle 计时已在上方统一 reset），无渲染
                break;
              case 'status':
                // 自动重试成功恢复：立即撤下倒计时横幅（步骤日志仍保留该状态）
                if (evt.message.includes('已自动恢复')) setRetryNotice(null);
                dispatchStream({ type: 'status', message: evt.message });
                break;
              case 'tool_call':
                dispatchStream({
                  type: 'tool_call',
                  id: evt.id,
                  name: evt.name,
                  arguments: evt.arguments,
                });
                break;
              case 'tool_result':
                dispatchStream({
                  type: 'tool_result',
                  id: evt.id,
                  name: evt.name,
                  result: evt.result,
                });
                break;
              case 'extension_widget':
                // 扩展 widget 更新（服务端快照的流式镜像；同 key 幂等覆盖）
                dispatchStream({
                  type: 'widget_update',
                  key: evt.key,
                  label: evt.label,
                  lines: evt.lines,
                  placement: evt.placement,
                });
                break;
              case 'extension_widget_clear':
                dispatchStream({ type: 'widget_clear', key: evt.key });
                break;
              case 'extension_ui_request': {
                const request: PendingUiRequest = {
                  id: evt.id,
                  method: evt.method,
                  title: evt.title ?? '',
                  ...(evt.options ? { options: evt.options } : {}),
                  ...(evt.message ? { message: evt.message } : {}),
                  ...(evt.placeholder ? { placeholder: evt.placeholder } : {}),
                  ...(evt.prefill ? { prefill: evt.prefill } : {}),
                  ...(evt.timeout !== undefined ? { timeout: evt.timeout } : {}),
                };
                dispatchStream({ type: 'ui_request', request });
                break;
              }
              case 'error':
                statusRef.current = 'error';
                runErroredRef.current = true;
                // 错误即本轮终止：关闭残存的交互弹层（RPC 子进程已由后端收尾）
                dispatchStream({ type: 'ui_cancel' });
                dispatchStream({ type: 'error', message: evt.message || '对话失败，请重试' });
                break;
            }
          }
          // 正常结束（含用户停止：后端 abort 后收尾返回）：停流式标记，content/reasoning 保留至水合提交
          if (statusRef.current !== 'error') {
            statusRef.current = 'ready';
            dispatchStream({ type: 'settle' });
          }
        } catch (err) {
          if (run !== runSeqRef.current) return;
          if (idle.isTimedOut()) {
            // 空闲超时：forcedErrorRef 已在 abort 监听里置位
            const timeoutMsg = forcedErrorRef.current || '对话超时，请重试';
            if (!forcedErrorRef.current) forcedErrorRef.current = timeoutMsg;
            runErroredRef.current = true;
            statusRef.current = 'error';
            dispatchStream({ type: 'error', message: timeoutMsg });
          } else if (interruptedByUserRef.current) {
            // 用户主动停止：不视为错误（后端已杀进程，水合展示 interrupted 消息）
            statusRef.current = 'ready';
            dispatchStream({ type: 'settle' });
          } else {
            const msg = err instanceof Error ? err.message : '对话失败，请重试';
            if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('token')) {
              handleUnauthorized();
            }
            runErroredRef.current = true;
            statusRef.current = 'error';
            dispatchStream({ type: 'error', message: msg });
          }
        } finally {
          if (run === runSeqRef.current) {
            idle.clear();
            idleRef.current = null;
            if (statusRef.current === 'submitted' || statusRef.current === 'streaming') {
              statusRef.current = 'ready';
            }
            finishRunRef.current();
          }
        }
      })();
    },
    [nodeId, setNodes, portTypesRef]
  );
  sendRef.current = send;

  /**
   * 任意文件附件：上传到工作区 inputs/（与 send 同款工作区创建/持久化逻辑）。
   * 附件先于首轮消息落盘——用户选中文件即上传，消息发送时以 inputs/ 路径引用。
   */
  const handleUploadFile = useCallback(
    async (file: File): Promise<UploadedWorkspaceFile> => {
      const cur = nodesRef.current.find((n) => n.id === nodeId) ?? null;
      let ws = typeof cur?.data?.workspaceId === 'string' && cur.data.workspaceId ? cur.data.workspaceId : '';
      if (!ws) {
        ws = `${nodeId}_${Date.now()}`;
        activeRequestWsRef.current = ws;
        if (cur && cur.data?.workspaceId !== ws) {
          setNodes((prev) =>
            prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, workspaceId: ws } } : n))
          );
        }
      }
      return uploadWorkspaceFile(ws, file);
    },
    [nodeId, setNodes]
  );

  // 自动续发：上一轮自然收尾（水合落地）且队列非空时出队首条发送（effect 中调用最新 send 闭包）
  useEffect(() => {
    if (streamState.isStreaming || !autoNextArmedRef.current) return;
    autoNextArmedRef.current = false;
    if (interruptedByUserRef.current || runErroredRef.current) return;
    const q = msgQueueRef.current;
    if (!q.length) return;
    const first = q[0]!;
    setMsgQueue((prev) => prev.filter((m) => m.id !== first.id));
    sendRef.current(first.text, first.images);
  }, [streamState.isStreaming, settledSeq, msgQueue]);

  const stop = useCallback(() => {
    if (statusRef.current !== 'submitted' && statusRef.current !== 'streaming') return;
    interruptedByUserRef.current = true;
    autoNextArmedRef.current = false;
    idleRef.current?.controller.abort();
    // 停止 = 作废当前交互：关闭待答弹层（RPC 子进程由后端 abort 终止）
    dispatchStream({ type: 'ui_cancel' });
  }, []);

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
   * 重试：重发最后一条用户消息。首条消息的上下文已由 pi 后端持久化，
   * 重试它会发送无上下文的纯文本（contextSentRef 已置位），不符合预期——
   * 该场景直接退出（错误态随 reset 消失；用户可清空对话重新发送）。
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
      dispatchStream({ type: 'end' });
      statusRef.current = 'ready';
      return;
    }
    if (statusRef.current === 'error') {
      dispatchStream({ type: 'end' });
      statusRef.current = 'ready';
    }
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, agentSteps: [], error: null, isGenerating: true } }
          : n
      )
    );
    sendRef.current(lastUser.content);
  }, [nodeId, setNodes]);

  /**
   * 扩展交互作答：POST 写回 → 成功关闭弹层；失败（进程已结束）静默取消弹层。
   * （RPC 协议要求 cancelled 也必须回写，否则 pi 工具挂起到超时。）
   */
  const answerUi = useCallback(
    (id: string, response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      const ws = activeRequestWsRef.current ?? wsIdRef.current ?? wsId;
      const call = async () => {
        if (ws) {
          const ok = await postUiResponse(ws, id, response);
          if (ok) {
            dispatchStream({ type: 'ui_response', id });
            return;
          }
        }
        // 回写失败（离线 / 会话已结束）：关闭弹层
        dispatchStream({ type: 'ui_cancel' });
      };
      void call();
    },
    [wsId]
  );

  // ---------- 对话历史操作（载入 / 置顶 / 删除） ----------
  /** 载入历史会话：切换 workspaceId（宿主 effect 作废旧轮并自动水合服务端历史） */
  const handleSelectConversation = useCallback(
    (workspaceId: string) => h.handleLoadChatSessionFor(node.id, workspaceId),
    [h, node.id]
  );

  /** 置顶 / 取消置顶：后端写 .pi-agent/meta.json，成功后刷新列表（展开状态下自动生效） */
  const handleToggleConversationPin = useCallback(
    async (workspaceId: string, pinned: boolean) => {
      await setConversationPinned(workspaceId, pinned);
      convPanel.bump();
    },
    [convPanel.bump]
  );

  /** 删除会话：后端整目录删除；若删的是当前会话，同步把节点重置为全新工作区 */
  const handleDeleteConversation = useCallback(
    async (workspaceId: string) => {
      await deleteConversationSession(workspaceId);
      evictSessionCache(workspaceId);
      if (workspaceId === wsIdRef.current) {
        h.handleResetChatWorkspaceFor(node.id);
      }
      convPanel.bump();
    },
    [h, node.id, convPanel.bump]
  );

  // ---------- 渲染 ----------
  const config = h.configOf(node);
  const settings: ChatNodeSettings = node.data?.settings ?? DEFAULT_CHAT_SETTINGS;

  // 上下文块展示：使用 useMemo 缓存，仅在依赖实际变化时重算，避免画布交互时反复重绘
  const contextBlocks = useMemo(
    () =>
      buildContextBlocks(
        node,
        settings,
        h.nodes,
        h.edges,
        portTypesRef.current
      ),
    [node, settings, h.nodes, h.edges, portTypesRef]
  );

  const handleRemove = useCallback(() => h.handleRemove(node.id), [h, node.id]);
  const handleSend = useCallback((_id: string, text: string, images?: string[]) => send(text, images), [send]);
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => h.handleNodeContextMenu(e, node.id), [h, node.id]);

  /**
   * 来源节点解析（全局对话列表用）：workspaceId 遵循 `{nodeId}_{ts}` 命名约定，前缀即创建
   * 节点 id；本节点自身的历史不标注（默认归属），节点已从画布删除时也返回 null 不标注。
   */
  const sourceNodeOf = useCallback(
    (workspaceId: string) => {
      const sep = workspaceId.lastIndexOf('_');
      if (sep <= 0) return null;
      const srcNodeId = workspaceId.slice(0, sep);
      if (srcNodeId === node.id) return null;
      const srcNode = h.nodes.find((n) => n.id === srcNodeId);
      if (!srcNode) return null;
      return { title: getNodeTitle(srcNode) };
    },
    [h.nodes, node.id]
  );

  const sidePanelProp = useMemo<ChatSidePanel>(() => ({
    open: sideOpen,
    onToggle: () => setSideOpen((v) => !v),
    filesLoading: panel.loading,
    files: panel.files,
    onRefreshFiles: panel.refresh,
    sessions: convPanel.sessions,
    sessionsLoading: convPanel.loading,
    currentWorkspaceId: wsId,
    onRefreshSessions: convPanel.refresh,
    onSelectSession: handleSelectConversation,
    onTogglePin: handleToggleConversationPin,
    onDeleteSession: handleDeleteConversation,
    sourceNodeOf,
  }), [
    sideOpen,
    panel.loading,
    panel.files,
    panel.refresh,
    convPanel.sessions,
    convPanel.loading,
    convPanel.refresh,
    wsId,
    handleSelectConversation,
    handleToggleConversationPin,
    handleDeleteConversation,
    sourceNodeOf,
  ]);

  const messageQueueProp = useMemo(() => (
    msgQueue.length > 0
      ? {
          items: msgQueue,
          onRecall: recallQueued,
          onSendNow: sendQueuedNow,
        }
      : null
  ), [msgQueue, recallQueued, sendQueuedNow]);

  const extensionDialogProp = useMemo(() => (
    streamState.pendingUi
      ? {
          request: streamState.pendingUi,
          onAnswer: answerUi,
        }
      : null
  ), [streamState.pendingUi, answerUi]);

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
      isGenerating={!!node.data?.isGenerating}
      error={node.data?.error ?? null}
      settings={settings}
      bookCoverEnabled={isBookCoverEnabled(node, h.nodes, h.edges)}
      onRemove={handleRemove}
      onSend={handleSend}
      onUploadFile={handleUploadFile}
      onUpdateSettings={h.handleUpdateChatSettingsFor}
      onClearChat={h.handleClearChatFor}
      onStop={stop}
      onRetry={retry}
      onPositionChange={h.handlePositionChange}
      onSizeChange={h.handleSizeChange}
      onDrag={h.handleNodeDrag}
      onResizeLive={h.handleNodeResizeLive}
      footer={h.renderFooter(node)}
      onContextMenu={handleContextMenu}
      sidePanel={sidePanelProp}
      retryNotice={retryNotice}
      messageQueue={messageQueueProp}
      widgets={streamState.widgets}
      extensionDialog={extensionDialogProp}
    />
  );
}

export const PiChatNodeHost = memo(PiChatNodeHostInner);
PiChatNodeHost.displayName = 'PiChatNodeHost';
