import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { nodesRef, edgesRef } from '../../platform/stores/useCanvasState';
import { useConversationHistoryPanel } from './useConversationHistoryPanel';
import {
  deleteConversationSession,
  evictSessionCache,
  fetchPiSession,
  fetchWorkspaceFiles,
  renameConversation,
  setConversationPinned,
} from './piSessionApi';
import { ChatNode } from './components/ChatNode';
import { getNodeTitle } from './nodeTypes';
import { buildContextBlocks } from './contextBlocks';
import { isBookCoverEnabled } from './execution';
import { toWireChatMessages } from './graphTypes';
import { useWorkspaceFilesPanel } from './useWorkspaceFilesPanel';
import { handleAgentSseMessage } from './agentSteps';
import { authHeaders, handleUnauthorized } from './authUtils';
import { makeIdleTimeout } from './idleTimeout';
import { PROMPT_SSE_IDLE_TIMEOUT_MS } from '../../platform/utils/timeouts';
import {
  attachContextToFirstUser,
  hasContextInStore,
  storeToUI,
  uiToStore,
} from './chatMessages';
import { mismatchBadgeOf, type NodeViewHelpers } from './CanvasNodeViews';
import type { ChatSidePanel } from './components/chat/ChatSidePanel';
import { mergeAgentFiles } from './workspaceFiles';
import {
  MAX_CHAT_IMAGES,
  DEFAULT_CHAT_SETTINGS,
  buildChatContext,
  buildChatImagesFromBlocks,
  collectSkillNames,
  capWireImages,
  stripInjectedContext,
  type ChatHostDeps,
} from './chatSendHelpers';
import type { AgentFile, ChatMessage, ChatNodeSettings, InjectedContextBlock } from '../../platform/types';
import type { NodeData } from './graphTypes';

// AI SDK 依赖的共享发送辅助已抽至 chatSendHelpers.ts（与 PiChatNodeHost 复用）
export type { ChatHostDeps } from './chatSendHelpers';

/**
 * 拉取 FastClaw（Agent 模式）当前会话工作区文件列表。
 * 节点内手动覆盖的 Agent（agentOverride）优先，空 = 跟随节点绑定 Agent。
 *
 * FastClaw 工作区 = 服务端会话目录，文件随 agent 工具调用产生，跨轮保留；
 * 与 Skill Agent 的「本节点工作区」面板语义对齐。
 */
async function fetchFastClawWorkspaceFiles(params: {
  nodeId: string;
  epoch: number;
  configId: number | null;
  agentConfigId: number | null;
  /** 当前会话工作区（FastClaw 会话 key 一对话一 key，与服务端 /chat 同参） */
  workspaceId: string | null;
}): Promise<AgentFile[]> {
  const qs = new URLSearchParams({
    node_id: params.nodeId,
    epoch: String(params.epoch),
    config_id: params.configId != null ? String(params.configId) : '',
    agent_config_id: params.agentConfigId != null ? String(params.agentConfigId) : '',
    workspace_id: params.workspaceId ?? '',
  });
  const resp = await fetch(`/api/modules/bookplate/chat/fastclaw-files?${qs.toString()}`, {
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = (await resp.json()) as { files?: AgentFile[] };
  return data.files ?? [];
}

/**
 * AI 对话节点宿主（useChat 迁移核心）：
 *
 * - 每个 chat 节点一个 ChatNodeHost 实例，持有一个 `useChat`（AI SDK v7 UI Message Stream 原生消费）；
 * - useChat 消息是流式权威状态，镜像写回节点 store（node.data.messages）持久化（sessionStorage）；
 * - 外部变更（清空对话 / 撤销 / 恢复）经「store 与镜像不一致且非流式中」检测恢复进 useChat；
 * - 上下文注入 / agent 步骤 / 文件 / 重试 / 中断语义与旧 useChatExecution 逐项对齐。
 */
function ChatNodeHostInner({
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
  const interruptPendingRef = useRef(false);
  const forcedErrorRef = useRef<string | null>(null);
  const idleRef = useRef<{ idle: ReturnType<typeof makeIdleTimeout>; controller: AbortController } | null>(null);
  // 本轮 skill 产物文件缓冲：流中只入队（流中写状态会与事件处理竞态丢失），
  // 流结束后一次性并入最后一条 assistant 消息（metadata + store 镜像）
  const pendingFilesRef = useRef<Map<string, AgentFile>>(new Map());

  // 当前会话工作区（首轮发送时生成并持久化；清空对话 / 载入历史会话时切换）
  const wsId =
    typeof node.data?.workspaceId === 'string' && node.data.workspaceId
      ? node.data.workspaceId
      : null;
  const wsIdRef = useRef(wsId);
  wsIdRef.current = wsId;
  // 在途请求实际使用的工作区（首轮发送自生成 workspaceId 属 self-assigned，不得触发水合 / 中断）
  const activeWsRef = useRef<string | null>(wsId);

  // ---------- 侧边面板（工作区文件 + 对话历史合并为单一右侧抽屉，Tab 切换） ----------
  // 单一展开态 sideOpen 统一驱动两个面板状态机（openOverride 受控模式，与 PiChatNodeHost 同构）：
  // - 文件面板：FastClaw 走服务端会话文件 API；LLM 走工作区本地产物（transcript 已被服务端差分排除）；
  // - 对话历史面板：该用户全部 LLM/FastClaw transcript 会话（与 pi 会话按存储族隔离），
  //   点击载入 / 置顶 / 重命名 / 删除
  const [sideOpen, setSideOpen] = useState(false);
  const panel = useWorkspaceFilesPanel(async () => {
    const cur = nodesRef.current.find((n) => n.id === nodeId) ?? null;
    if (!cur || cur.type !== 'chat') return null;
    const settings: ChatNodeSettings = cur.data?.settings ?? DEFAULT_CHAT_SETTINGS;
    const cfg = h.configOf(cur);
    const curWs =
      typeof cur.data?.workspaceId === 'string' && cur.data.workspaceId
        ? cur.data.workspaceId
        : null;
    if (cfg?.mode === 'agent') {
      // FastClaw：数据源是 FastClaw 服务端当前会话目录（跨轮保留），与 Skill Agent 面板对齐；
      // loader 返回 null 表示跳过本次刷新（工作区未就绪时不触碰已有列表）
      return fetchFastClawWorkspaceFiles({
        nodeId,
        epoch: cur.data?.epoch ?? 0,
        configId: cur.configId ?? null,
        agentConfigId: settings.agentOverride ?? null,
        workspaceId: curWs,
      });
    }
    // LLM：工作区本地产物 / inputs（LLM 模式无产物桥接，通常为空列表）
    if (!curWs) return null;
    return fetchWorkspaceFiles(curWs);
  }, sideOpen);
  // LLM / FastClaw 共用 transcript 存储族：历史抽屉只显示该存储族的会话（不含 pi 会话）
  // 历史抽屉按节点实际模式过滤：LLM 节点只看 LLM 会话，FastClaw 节点只看 Agent 会话（互不混显）
  const convPanel = useConversationHistoryPanel(
    sideOpen,
    h.configOf(node)?.mode === 'agent' ? 'agent' : 'llm'
  );

  const chat = useChat({
    id: nodeId,
    messages: storeToUI(Array.isArray(node.data?.messages) ? node.data.messages : []),
    transport: new DefaultChatTransport({
      api: '/api/modules/bookplate/chat',
      prepareSendMessagesRequest: async ({ messages, requestMetadata }) => {
        const cur = nodesRef.current.find((n) => n.id === nodeId) ?? null;
        let chatMsgs = uiToStore(messages);

        // 上下文注入：仅首轮一次，持久在首条 user 消息（首条折叠卡片展示；清空对话后可重新注入）
        const firstUserIdx = chatMsgs.findIndex((m) => m.role === 'user');
        const alreadyHasContext = hasContextInStore(chatMsgs);
        if (!alreadyHasContext && cur) {
          const chatSettings: ChatNodeSettings =
            cur.data?.settings ?? DEFAULT_CHAT_SETTINGS;
          const blocks = buildContextBlocks(
            cur,
            chatSettings,
            nodesRef.current,
            edgesRef.current,
            portTypesRef.current
          );
          const context = buildChatContext(blocks);
          const contextImages = await buildChatImagesFromBlocks(blocks);
          if (context || contextImages.length || blocks.length) {
            if (firstUserIdx >= 0) {
              chatMsgs[firstUserIdx] = {
                ...chatMsgs[firstUserIdx],
                ...(context ? { context } : {}),
                ...(contextImages.length ? { contextImages } : {}),
                ...(blocks.length ? { contextBlocks: blocks } : {}),
              };
            }
            // 同步进 useChat metadata → 镜像写入 store，后续轮次不再重复注入
            setMessages((prev) => attachContextToFirstUser(prev, context, contextImages, blocks));
          }
        }

        // 本轮附件图片（sendMessage metadata 传入）并入最后一条 user 消息（多模态 + 展示）
        const turnImages = (
          (requestMetadata as { bookplate?: { images?: string[] } } | undefined)?.bookplate
            ?.images ?? []
        ) as string[];
        const lastUserIdx = chatMsgs.findLastIndex((m) => m.role === 'user');
        if (turnImages.length && lastUserIdx >= 0) {
          const last = chatMsgs[lastUserIdx];
          chatMsgs[lastUserIdx] = {
            ...last,
            images: [...(last.images ?? []), ...turnImages].slice(0, MAX_CHAT_IMAGES),
          };
        }

        const wire = capWireImages(toWireChatMessages(chatMsgs));
        const lastUser = chatMsgs.findLast((m) => m.role === 'user');
        const userText = lastUser
          ? lastUser.context
            ? `${lastUser.context}\n\n${lastUser.content}`
            : lastUser.content
          : '';
        // Agent 模式携带的图片：本轮附件优先，其次首条 user 消息持久化的上下文图片
        const agentImages = [...turnImages, ...(lastUser?.contextImages ?? [])].slice(
          0,
          MAX_CHAT_IMAGES
        );

        // 节点工作区标识：首轮生成并持久化（Skill Agent 产物/文件跨轮保留；
        // LLM/FastClaw 会话 transcript 与 FastClaw 会话 key 均以它为会话标识）
        const workspaceId =
          typeof cur?.data?.workspaceId === 'string' && cur.data.workspaceId
            ? cur.data.workspaceId
            : `${nodeId}_${Date.now()}`;
        if (cur && !cur.data.workspaceId) {
          setNodes((prev) =>
            prev.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, workspaceId } } : n
            )
          );
        }
        // 记录在途请求的工作区：首轮生成 workspaceId 属 self-assigned（水合 effect 据此跳过）
        activeWsRef.current = workspaceId;

        return {
          body: {
            // LLM 模式：context 经 toWireChatMessages 展开进首条 user 消息 content；
            // Agent 模式：上下文拼进 message 字段，图片经 images 字段透传
            messages: wire,
            message: userText,
            images: agentImages,
            config_id: cur?.configId ?? null,
            node_id: nodeId,
            epoch: cur?.data?.epoch ?? 0,
            skills: cur ? collectSkillNames(cur) : [],
            workspace_id: workspaceId,
            // 节点内手动选择的模型名（仅 LLM 模式生效；空 = 跟随节点配置的默认模型）
            model_name:
              (cur?.data?.settings as ChatNodeSettings | undefined)?.modelOverride ?? null,
            // 节点内手动覆盖的 Base URL（仅 LLM 模式生效；空 = 跟随节点配置的默认 Base URL）
            base_url:
              (cur?.data?.settings as ChatNodeSettings | undefined)?.baseUrlOverride ?? null,
            // 节点内手动覆盖的 API Key（仅 LLM 模式生效；空 = 跟随节点配置的默认 API Key）
            api_key:
              (cur?.data?.settings as ChatNodeSettings | undefined)?.apiKeyOverride ?? null,
            // 节点内手动选择的 FastClaw Agent（仅 Agent 模式生效；空 = 跟随节点绑定的 Agent）
            agent_config_id:
              (cur?.data?.settings as ChatNodeSettings | undefined)?.agentOverride ?? null,
          },
          headers: authHeaders(),
        };
      },
    }),
    onData: (part) => {
      // 空闲超时按「收到任意有效流事件」续期，而不是仅依赖首包计时。
      // FastClaw 工具调用阶段可能长时间没有正文，但会持续发送 status/tool 事件。
      idleRef.current?.idle.arm();
      const name = part.type.startsWith('data-') ? part.type.slice('data-'.length) : part.type;
      if (!name.startsWith('agent_')) return;
      if (name === 'agent_file') {
        const file = (part.data ?? {}) as AgentFile;
        if (file && typeof file.url === 'string' && file.url) {
          pendingFilesRef.current.set(file.url, file);
        }
        return;
      }
      handleAgentSseMessage(setNodes, nodeId, name, JSON.stringify(part.data));
    },
    onFinish: () => {
      idleRef.current?.idle.clear();
      idleRef.current = null;
      // 本轮收尾：对话历史列表在展开状态下同步刷新（新会话 / 新轮次进入列表）
      convPanel.bump();
    },
    onError: (err) => {
      const msg = err?.message ?? '';
      if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('token')) {
        handleUnauthorized();
      }
      idleRef.current?.idle.clear();
      idleRef.current = null;
    },
  });
  const { status, messages: uiMessages, error: chatError, setMessages } = chat;
  const { sendMessage, regenerate, clearError, stop: chatStop } = chat;
  statusRef.current = status;
  // FastClaw 工作区文件面板：该轮生成结束（status → ready）且面板展开时自动刷新，
  // 使新产生的会话文件（图片/报告等）及时出现在面板里
  const panelStatusReady = status === 'ready';
  useEffect(() => {
    if (panelStatusReady && panel.open) panel.bump();
  }, [panelStatusReady, panel.open, panel.bump]);
  // 外部变更检测 effect 经此读取最新 useChat 消息（不进依赖数组，避免流式高频重跑）
  const uiMessagesRef = useRef(uiMessages);
  uiMessagesRef.current = uiMessages;

  // 首次渲染时的 store 快照作为镜像基线（挂载恢复 = 持久化消息 → useChat）
  const lastMirroredRef = useRef<string>(
    JSON.stringify(Array.isArray(node.data?.messages) ? node.data.messages : [])
  );
  // 最近一次落 store 时的消息条数（方案 A：流式中条数变化也立即持久化）与
  // 最近一次镜像时的 workspaceId（方案 B：区分「主动清空」与「意外回滚」）
  const lastFlushedCountRef = useRef<number>(
    Array.isArray(node.data?.messages) ? node.data.messages.length : 0
  );
  const mirroredWsRef = useRef<string | null>(
    typeof node.data?.workspaceId === 'string' ? node.data.workspaceId : null
  );

  // 节流写入顶层 store 的定时器与最新待写入状态
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatchRef = useRef<{
    next: ChatMessage[];
    streaming: boolean;
    errMsg: string | null;
    output: string;
    json: string;
  } | null>(null);

  const flushPendingPatch = useCallback(() => {
    if (throttleTimerRef.current !== null) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    const patch = pendingPatchRef.current;
    if (!patch) return;
    pendingPatchRef.current = null;
    lastMirroredRef.current = patch.json;
    lastFlushedCountRef.current = patch.next.length;
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                messages: patch.next,
                isGenerating: patch.streaming,
                error: patch.errMsg,
                ...(!patch.streaming && !patch.errMsg ? { output: patch.output } : {}),
              },
            }
          : n
      )
    );
  }, [nodeId, setNodes]);

  // ---------- 镜像：useChat 消息 / 状态 → 节点 store ----------
  useEffect(() => {
    const streaming = status === 'submitted' || status === 'streaming';
    const forced = forcedErrorRef.current;
    const errMsg = forced ?? (status === 'error' ? (chatError?.message ?? '对话失败，请重试') : null);
    const nodeSteps = Array.isArray(node.data?.agentSteps) ? node.data.agentSteps : [];

    // 流已结束：把缓冲的本轮产物文件一次性并入最后一条 assistant 消息 metadata。
    // 此处 setMessages 在流收尾后执行（流中写入会与事件处理竞态导致后续 chunk / 元数据丢失）；
    // 写入后 uiMessages 变更会再次触发本 effect，下一轮镜像即携带文件落盘。
    if (!streaming && pendingFilesRef.current.size && uiMessages.length) {
      const lastUi = uiMessages[uiMessages.length - 1];
      if (lastUi.role === 'assistant') {
        const buf = [...pendingFilesRef.current.values()];
        pendingFilesRef.current.clear();
        setMessages((prev) => {
          const idx = prev.length - 1;
          if (idx < 0 || prev[idx].role !== 'assistant') return prev;
          const bookplate = {
            ...((prev[idx].metadata as { bookplate?: Record<string, unknown> } | undefined)
              ?.bookplate ?? {}),
            files: mergeAgentFiles(
              ((prev[idx].metadata as { bookplate?: { files?: AgentFile[] } } | undefined)?.bookplate
                ?.files) ?? [],
              buf
            ),
          };
          const copy = [...prev];
          copy[idx] = { ...prev[idx], metadata: { bookplate } };
          return copy;
        });
      }
    }

    let next = uiToStore(uiMessages);

    // 流式中：最后一条 assistant 标记 streaming（打字光标 / 思考中...）
    if (streaming && next.length) {
      const i = next.length - 1;
      if (next[i].role === 'assistant') next[i] = { ...next[i], streaming: true };
    }
    // 本轮结束仍无产出（限流/中断等零输出失败）：移除末尾空的 assistant 占位，
    // 保留此前全部内容以便从断点继续；并同步移除 useChat 内的残留，
    // 否则该空气泡会在下一轮变成夹在中间的脏历史（镜像只在 error 态剥离挡不住它）。
    // 携带产物文件的消息不视为空（纯生图零文本零步骤的轮次靠 files 承载卡片）
    if (!streaming && next.length) {
      const i = next.length - 1;
      const last = next[i];
      if (
        last.role === 'assistant' &&
        !last.content &&
        !last.reasoning &&
        !(last.agentSteps && last.agentSteps.length) &&
        !(last.files && last.files.length) &&
        // 本轮缓冲的产物文件尚未并入该消息：上方 pendingFiles 块的 setMessages 是异步的，
        // 本次的 next 快照还不含 files，而 useChat 侧的 hasVisible 已能看到 files——
        // 此时剥离会让 store 丢消息而 useChat 保留（store/useChat 分叉、文件卡片消失）。
        // 等 files 并入 metadata 后的下一轮镜像再判断是否真的为空。
        pendingFilesRef.current.size === 0
      ) {
        next = next.slice(0, -1);
        setMessages((prev) => {
          if (!prev.length || prev[prev.length - 1].role !== 'assistant') return prev;
          const lastUi = prev[prev.length - 1];
          const meta = (lastUi.metadata as { bookplate?: { files?: unknown[] } } | undefined)
            ?.bookplate;
          const hasVisible =
            lastUi.parts.some((p) => p.type === 'text' || p.type === 'reasoning') ||
            !!(meta?.files && meta.files.length);
          return hasVisible ? prev : prev.slice(0, -1);
        });
      }
    }
    // 用户主动停止：保留已流出部分并标记中断（展示「重试」入口），不写入输出
    if (interruptPendingRef.current && !streaming && next.length) {
      const i = next.length - 1;
      if (next[i].role === 'assistant') {
        next[i] = { ...next[i], streaming: false, interrupted: true };
        interruptPendingRef.current = false;
      }
    }
    // 本轮结束仍无 assistant 消息（工具执行但无文本产出：工具-only / 报错 / 停止）：
    // 合成一条携带 agentSteps 的空 assistant 消息，保证 AgentActivity 日志可见、步骤不丢。
    // 刻意不写回 useChat（空正文消息不应随 LLM 模式历史重发），下一轮镜像会自然收敛。
    if (!streaming && nodeSteps.length && next.length) {
      const i = next.length - 1;
      if (next[i].role !== 'assistant') {
        const interrupted = interruptPendingRef.current;
        if (interrupted) interruptPendingRef.current = false;
        next = [
          ...next,
          {
            role: 'assistant',
            content: '',
            agentSteps: nodeSteps,
            ...(interrupted ? { interrupted: true } : {}),
          },
        ];
      }
    }
    // 当前轮 agent 步骤附加到最后一条 assistant 消息，并同步进 UI metadata（镜像不丢、跨轮持久）
    if (nodeSteps.length && next.length) {
      const i = next.length - 1;
      if (next[i].role === 'assistant') {
        const cur = next[i];
        const have = Array.isArray(cur.agentSteps) ? cur.agentSteps : [];
        if (have.length !== nodeSteps.length) {
          next[i] = { ...cur, agentSteps: nodeSteps };
          setMessages((prev) => {
            const idx = prev.length - 1;
            if (idx < 0 || prev[idx].role !== 'assistant') return prev;
            const meta = {
              ...((prev[idx].metadata as { bookplate?: Record<string, unknown> } | undefined)
                ?.bookplate ?? {}),
              agentSteps: nodeSteps,
            };
            const copy = [...prev];
            copy[idx] = { ...prev[idx], metadata: { bookplate: meta } };
            return copy;
          });
        }
      }
    }
    if (forced) forcedErrorRef.current = null;

    const json = JSON.stringify(next);
    const nodeNow = nodesRef.current.find((n) => n.id === nodeId);
    const prevOutput = typeof nodeNow?.data?.output === 'string' ? nodeNow.data.output : '';
    const lastAssistant = [...next].reverse().find((m) => m.role === 'assistant');
    // 输出 = 最后一轮助手回复（错误 / 中断 / 无正文时不覆盖，避免污染下游输入：
    // 工具执行但无文本产出的轮次由合成空消息承载步骤，不应清空既有输出）
    const output =
      streaming || errMsg || lastAssistant?.interrupted || !lastAssistant?.content
        ? prevOutput
        : lastAssistant.content;

    const stateChanged =
      json !== lastMirroredRef.current ||
      streaming !== !!nodeNow?.data?.isGenerating ||
      errMsg !== (nodeNow?.data?.error ?? null);

    if (stateChanged) {
      pendingPatchRef.current = { next, streaming, errMsg, output, json };

      // 非流式状态（生成结束/报错/中断）立即写入顶层 store；流式进行期间仅在本地
      // 实时渲染，避免高频 setNodes 引发整板重绘——但消息条数变化（每轮 user/
      // assistant 各落定一次，频率极低）仍立即 flush：刷新/HMR 重挂载后 store 至少
      // 保有已完成轮次，不再从零开始（docs/pi-skill-agent-会话连续性与节点状态分析.md 方案 A）
      if (!streaming || next.length !== lastFlushedCountRef.current) {
        flushPendingPatch();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiMessages, status, nodeId, setNodes, setMessages, flushPendingPatch]);

  // ---------- 外部变更检测：清空对话 / 撤销 / 恢复时 store 与 useChat 不同步 ----------
  // store 真相必须读模块级 nodesRef（setNodes 同步更新）而非本提交的 node prop：
  // 流结束的同一提交里，镜像 effect 先 flush（nodesRef 已是最新），而 node prop 仍滞后一帧——
  // 若按 prop 采纳，会把镜像刚写入的最终消息误判为「外部变更」回灌 useChat（覆盖实时消息，
  // 空尾逻辑随后把刚流出的回复从 store/useChat 一起永久剥离，整段回复消失）。
  // nodesRef 永远是 store 最新值：镜像自写（lastMirroredRef 匹配）与真正的外部变更自然区分。
  useEffect(() => {
    const nodeNow = nodesRef.current.find((n) => n.id === nodeId);
    const storeMsgs = Array.isArray(nodeNow?.data?.messages) ? nodeNow.data.messages : [];
    const wsNow =
      typeof nodeNow?.data?.workspaceId === 'string' && nodeNow.data.workspaceId
        ? nodeNow.data.workspaceId
        : null;
    const json = JSON.stringify(storeMsgs);
    if (json === lastMirroredRef.current) {
      mirroredWsRef.current = wsNow;
      return;
    }
    // 流式中 store 的 agentSteps 等增量写入不视为外部变更（镜像会收敛）
    if (status === 'submitted' || status === 'streaming') return;

    // 方案 B 空 store 采纳保护：store 历史为空、本地仍持有会话、且 workspaceId 未再生，
    // 判定为快照回退（意外清空）而非主动操作 → 不采纳空历史，反向用本地恢复 store。
    // 真正的「清空对话」必然伴随 workspaceId 再生 → 守卫放行，行为不变；
    // 历史保住则 hasContextInStore 成立，上下文重复注入问题随之消失。
    // （uiMessages 经 ref 读取：不进依赖数组，避免流式期间每 delta 重跑本 effect）
    if (
      !storeMsgs.length &&
      uiMessagesRef.current.length &&
      mirroredWsRef.current !== null &&
      wsNow === mirroredWsRef.current
    ) {
      const recovered = uiToStore(uiMessagesRef.current);
      lastMirroredRef.current = JSON.stringify(recovered);
      lastFlushedCountRef.current = recovered.length;
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, messages: recovered } } : n
        )
      );
      return;
    }

    mirroredWsRef.current = wsNow;
    lastMirroredRef.current = json;
    setMessages(storeToUI(storeMsgs));
    // 仅在主动清空会话（历史变空）时清理错误态，避免在失败轮次误清空错误横幅
    if (!storeMsgs.length && status === 'error') clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.data?.messages, node.data?.workspaceId, status, nodeId, setMessages, setNodes]);

  // ---------- 会话水合：workspaceId 变化（载入历史 / 挂载恢复）→ 服务端真相源 ----------
  // LLM/FastClaw 模式的会话历史由后端落盘（{ws}/conversation.jsonl，见 chat-conversations.ts）；
  // 载入历史 = 切换 workspaceId（handleLoadChatSessionFor），此处拉取服务端 transcript 水合进 useChat。
  // - 首轮发送自生成 workspaceId（self-assigned）不得当作「切换」触发水合/中断；
  // - 服务端无该会话记录（改造前的存量对话无 transcript）：保留本地 store，不采纳空历史；
  // - 水合消息首条 user 剥离注入上下文（与 PiChatNodeHost 同口径），避免与顶部折叠卡片重复、
  //   也避免续聊时把旧上下文再次喂给模型（hasContextInStore 判定依赖 context 字段而非正文）。
  const hydrateSeqRef = useRef(0);
  useEffect(() => {
    if (!wsId) {
      activeWsRef.current = null;
      panel.reset();
      return;
    }
    const selfAssigned =
      activeWsRef.current === wsId &&
      (statusRef.current === 'submitted' || statusRef.current === 'streaming');
    activeWsRef.current = wsId;
    if (selfAssigned) return;
    // 外部切换（载入历史 / 挂载）：文件面板同步重置并拉取**新工作区**的文件列表
    // （与 PiChatNodeHost 同口径），否则「AI 产物」会停留在旧会话列表直到手动刷新。
    // refreshIfOpen 读 openRef：面板展开才拉取（loader 内部读最新 workspaceId），关闭时跳过。
    panel.reset();
    panel.refreshIfOpen();
    // 先中止在途流，避免水合结果与旧流写入竞态
    if (statusRef.current === 'submitted' || statusRef.current === 'streaming') {
      void chatStop();
    }
    idleRef.current?.idle.clear();
    idleRef.current = null;
    const seq = ++hydrateSeqRef.current;
    void fetchPiSession(wsId)
      .then(({ messages }) => {
        if (seq !== hydrateSeqRef.current || wsIdRef.current !== wsId) return;
        if (!messages.length) return; // 服务端无记录：保留本地 store（存量会话 / 空会话）
        // 首条 user 消息剥离注入上下文（以当前画布上下文块为准，与发送侧 buildChatContext 同口径）
        const cur = nodesRef.current.find((n) => n.id === nodeId);
        const settings: ChatNodeSettings = cur?.data?.settings ?? DEFAULT_CHAT_SETTINGS;
        const blocks = cur
          ? buildContextBlocks(
              cur,
              settings,
              nodesRef.current,
              edgesRef.current,
              portTypesRef.current
            )
          : [];
        const sanitized = messages.map((m, idx) => {
          if (m.role !== 'user' || idx !== 0 || !m.content) return m;
          const stripped = stripInjectedContext(m.content, blocks);
          return stripped ? { ...m, content: stripped } : m;
        });
        const ui = storeToUI(sanitized);
        const storeForm = uiToStore(ui);
        // 以服务端水合结果为新的镜像基线：先更新基线再写 store，避免被外部变更检测误判回灌
        lastMirroredRef.current = JSON.stringify(storeForm);
        lastFlushedCountRef.current = storeForm.length;
        mirroredWsRef.current = wsId;
        setMessages(ui);
        setNodes((prev) =>
          prev.map((n) =>
            n.id === nodeId ? { ...n, data: { ...n.data, messages: storeForm } } : n
          )
        );
      })
      .catch(() => {
        /* 水合失败：保留当前展示（下次挂载 / 切换再对齐服务端） */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, nodeId, setNodes, setMessages, chatStop, panel.reset, panel.refreshIfOpen]);

  // 卸载清理：空闲计时器与节流定时器（立即 flush 待提交数据）
  useEffect(
    () => () => {
      idleRef.current?.idle.clear();
      flushPendingPatch();
    },
    [flushPendingPatch]
  );

  // ---------- 对外操作：发送 / 停止 / 重试（ChatNode 回调） ----------
  const send = useCallback(
    (text: string, images?: string[]) => {
      // 仅流式中拦截（与旧实现一致：错误态下仍允许发新消息，makeRequest 会清除错误态）
      if (statusRef.current === 'submitted' || statusRef.current === 'streaming') return;
      const nodeNow = nodesRef.current.find((n) => n.id === nodeId);
      if (!nodeNow || nodeNow.type !== 'chat') return;
      if (statusRef.current === 'error') clearError();
      // 重置本轮状态（agent 步骤 / 产物文件缓冲 / 错误横幅），标记 isGenerating: true
      pendingFilesRef.current.clear();
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, agentSteps: [], error: null, isGenerating: true } }
            : n
        )
      );
      // 空闲超时：120s 无数据自动中止（与旧 SSE 行为一致，超时置错误提示）
      const controller = new AbortController();
      const idle = makeIdleTimeout(controller, PROMPT_SSE_IDLE_TIMEOUT_MS);
      idle.arm();
      idleRef.current = { idle, controller };
      controller.signal.addEventListener('abort', () => {
        if (idle.isTimedOut()) {
          forcedErrorRef.current = '对话超时，请重试';
          void chatStop();
        }
        // 用户点击停止时，chatStop 由 stop() 主动调用；这里仅记录超时。
      });
      void sendMessage({ text }, { metadata: { bookplate: { images } } });
    },
    [nodeId, setNodes, chatStop, sendMessage]
  );

  const stop = useCallback(() => {
    if (statusRef.current !== 'submitted' && statusRef.current !== 'streaming') return;
    interruptPendingRef.current = true;
    void chatStop();
  }, [chatStop]);

  const retry = useCallback(() => {
    if (statusRef.current !== 'ready' && statusRef.current !== 'error') return;
    if (status === 'error') clearError();
    // 重置本轮 agent 步骤：重试是新一轮执行，旧步骤（含失败轮残留）不应混入新回复
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, agentSteps: [], error: null, isGenerating: true } } : n
      )
    );
    void regenerate();
  }, [status, clearError, regenerate, nodeId, setNodes]);

  // ---------- 渲染 ----------
  const config = h.configOf(node);
  const settings: ChatNodeSettings =
    node.data?.settings ?? DEFAULT_CHAT_SETTINGS;
  const isStreaming = status === 'submitted' || status === 'streaming';
  const nodeSteps = Array.isArray(node.data?.agentSteps) ? node.data.agentSteps : [];

  // 计算展示消息：流式中直接由 uiMessages 实时转换，并在最后一条 assistant 注入 streaming 标志与 agentSteps
  // 本轮缓冲的产物文件（尚未随流收尾并入 metadata）在流式分支实时并入最后一条 assistant 展示
  const bufFiles = pendingFilesRef.current.size ? [...pendingFilesRef.current.values()] : [];
  // useChat 实时消息 → 展示消息：最后一条 assistant 注入 nodeSteps / 缓冲文件（streaming 标志仅流式中注入）
  const buildLiveMessages = (markStreaming: boolean): ChatMessage[] => {
    let next = uiToStore(uiMessages);
    if (next.length) {
      const lastIdx = next.length - 1;
      if (next[lastIdx].role === 'assistant') {
        next[lastIdx] = {
          ...next[lastIdx],
          ...(markStreaming ? { streaming: true } : {}),
          agentSteps: nodeSteps.length ? nodeSteps : next[lastIdx].agentSteps,
          ...(bufFiles.length ? { files: mergeAgentFiles(next[lastIdx].files, bufFiles) } : {}),
        };
      }
    }
    return next;
  };
  let messages: ChatMessage[];
  if (isStreaming) {
    messages = buildLiveMessages(true);
  } else {
    const stored = Array.isArray(node.data?.messages) ? node.data.messages : [];
    // 镜像 flush 滞后一帧：流刚结束（status 已 ready）时，store 仍持有流中最后一次落盘的
    // 空占位（streaming:true 的 assistant）——镜像 effect 要到本次渲染之后才把最终正文写入
    // store。此时直接展示 store 会看到「正文先流出又消失一帧（变回思考中…占位）」的闪烁。
    // 改为以 useChat 实时消息（已是最终正文）兜底渲染；镜像 flush 落盘后占位被替换，自然回到 store。
    const lastStored = stored[stored.length - 1];
    messages =
      lastStored?.role === 'assistant' && lastStored.streaming === true
        ? buildLiveMessages(false)
        : stored;
  }

  // 计算上下文块：使用 useMemo 缓存，仅在依赖实际变化时重算，避免画布交互时反复重绘
  const contextBlocks: InjectedContextBlock[] = useMemo(
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

  // ---------- 对话历史操作（载入 / 置顶 / 重命名 / 删除，LLM + FastClaw 共用） ----------
  /** 载入历史会话：切换 workspaceId（宿主水合 effect 自动从服务端拉取会话） */
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

  /** 重命名会话：后端写 meta.json 的 title（空白 = 恢复自动标题），成功后刷新列表 */
  const handleRenameConversation = useCallback(
    async (workspaceId: string, title: string) => {
      await renameConversation(workspaceId, title);
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

  // 侧边面板：文件区两个 Tab（AI 产物 / 我的上传）+ 对话历史 Tab（LLM + FastClaw 均提供）
  const sidePanelProp = useMemo<ChatSidePanel | undefined>(
    () => ({
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
      onRenameSession: handleRenameConversation,
      onDeleteSession: handleDeleteConversation,
      sourceNodeOf,
    }),
    [
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
      handleRenameConversation,
      handleDeleteConversation,
      sourceNodeOf,
    ]
  );

  return (
    <ChatNode
      id={node.id}
      initialX={node.x}
      initialY={node.y}
      title={getNodeTitle(node)}
      messages={messages}
      contextBlocks={contextBlocks}
      workspaceId={typeof node.data?.workspaceId === 'string' ? node.data.workspaceId : null}
      agentName={
        config?.mode === 'agent'
          ? (config.agent_name ?? undefined)
          : config?.mode === 'skill_agent'
            ? (config.skill_agent_config_name ?? undefined)
            : undefined
      }
      mode={config?.mode}
      configId={node.configId ?? null}
      agentSteps={Array.isArray(node.data?.agentSteps) ? node.data.agentSteps : []}
      group={config?.group?.trim() || undefined}
      mismatchBadge={mismatchBadgeOf(node, h)}
      isGenerating={!!node.data?.isGenerating}
      error={node.data?.error ?? null}
      settings={settings}
      bookCoverEnabled={isBookCoverEnabled(node, h.nodes, h.edges)}
      onRemove={handleRemove}
      onSend={handleSend}
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
    />
  );
}

export const ChatNodeHost = memo(ChatNodeHostInner);
ChatNodeHost.displayName = 'ChatNodeHost';
