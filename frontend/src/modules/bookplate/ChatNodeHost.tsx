import { useCallback, useEffect, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { nodesRef, edgesRef } from '../../platform/stores/useCanvasState';
import { ChatNode } from './components/ChatNode';
import { getNodeTitle, bookMetadataText, nodeOutputImages, nodeOutputText } from './nodeTypes';
import { resolveNodeRunInputs, type PortTypesLookup } from './execution';
import { toWireChatMessages, type NodeData } from './graphTypes';
import { handleAgentSseMessage } from './agentSteps';
import { urlToDataUrl } from './imageUpload';
import { makeIdleTimeout } from './idleTimeout';
import { PROMPT_SSE_IDLE_TIMEOUT_MS } from '../../platform/utils/timeouts';
import {
  attachContextToFirstUser,
  hasContextInStore,
  storeToUI,
  uiToStore,
} from './chatMessages';
import { mismatchBadgeOf, hasDownstreamOf, type NodeViewHelpers } from './CanvasNodeViews';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { AgentFile, ChatMessage, ChatNodeSettings, InjectedContextBlock, SkillSelection } from '../../platform/types';
import type { EdgeData } from './graphTypes';

// AI 对话单轮携带的图片上限（附件 + 上下文图片合计）：防止超大 base64 请求体拖垮传输
const MAX_CHAT_IMAGES = 4;

/** 上下文设置兜底（旧节点持久化的 settings 缺少 includeUpstreamImages，undefined 视为开启） */
const DEFAULT_CHAT_SETTINGS: ChatNodeSettings = {
  includeBook: false,
  includeUpstream: true,
  includeUpstreamImages: true,
};

/** ChatHost 依赖（画布注入：state setter + 端口类型查找；nodesRef/edgesRef 为模块级单例） */
export interface ChatHostDeps {
  setNodes: Dispatch<SetStateAction<NodeData[]>>;
  portTypesRef: RefObject<PortTypesLookup>;
}

/** 收集对话上下文块（按图书元数据与每个直接父节点拆分，用于顶部折叠卡片展示） */
function buildInjectedContextBlocks(
  node: NodeData,
  portTypesRef: RefObject<PortTypesLookup>,
  nodes: NodeData[] = nodesRef.current,
  edges: EdgeData[] = edgesRef.current
): InjectedContextBlock[] {
  const settings: ChatNodeSettings = node.data?.settings ?? DEFAULT_CHAT_SETTINGS;
  const blocks: InjectedContextBlock[] = [];

  // 1. 图书元数据
  if (settings.includeBook) {
    const book = resolveNodeRunInputs(node, nodes, edges, portTypesRef.current).book;
    if (book) {
      const metaText = bookMetadataText(book.data);
      if (metaText.trim()) {
        blocks.push({
          id: `book_${book.id}`,
          title: `图书元数据 · ${getNodeTitle(book)}`,
          nodeType: 'book_info',
          text: metaText,
        });
      }
    }
  }

  // 2. 直接父节点
  const includeText = settings.includeUpstream !== false;
  const includeImages = settings.includeUpstreamImages !== false;

  if (includeText || includeImages) {
    const parents = nodes.filter((n) =>
      edges.some((e) => e.target === node.id && e.source === n.id)
    );
    for (const p of parents) {
      const text = includeText ? nodeOutputText(p).trim() : '';
      const rawImages = includeImages ? nodeOutputImages(p) : [];
      const images: string[] = [];
      for (const img of rawImages) {
        if (img && !images.includes(img)) images.push(img);
      }

      if (text || images.length > 0) {
        blocks.push({
          id: `parent_${p.id}`,
          title: getNodeTitle(p),
          nodeType: p.type,
          text: text || undefined,
          images: images.length > 0 ? images : undefined,
        });
      }
    }
  }

  return blocks;
}

/** 从上下文块拼接送给模型的文本上下文。 */
function buildChatContext(blocks: InjectedContextBlock[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const b of blocks) {
    if (!b.text || seen.has(b.text)) continue;
    seen.add(b.text);
    parts.push(`【${b.title}】\n${b.text}`);
  }
  return parts.join('\n\n');
}

/** 收集对话上下文图片：直接父节点的图片输出（受设置开关控制），本地静态路径转 data URL。 */
async function buildChatImagesFromBlocks(blocks: InjectedContextBlock[]): Promise<string[]> {
  const urls: string[] = [];
  for (const b of blocks) {
    for (const u of b.images ?? []) {
      if (!urls.includes(u)) urls.push(u);
    }
  }
  const result: string[] = [];
  for (const u of urls) {
    if (result.length >= MAX_CHAT_IMAGES) break;
    if (u.startsWith('data:')) {
      result.push(u);
      continue;
    }
    try {
      const dataUrl = await urlToDataUrl(u);
      if (dataUrl && result.length < MAX_CHAT_IMAGES) result.push(dataUrl);
    } catch {
      // 无法访问 / 非图片的 URL 直接跳过，不阻断对话
    }
  }
  return result;
}

/** 收集连线上游「Skill 检索」节点选中的 skill 名（Skill Agent 模式按需加载；空 = 全部已装 skill）。 */
function collectSkillNames(node: NodeData): string[] {
  const names: string[] = [];
  for (const p of nodesRef.current) {
    if (
      p.type === 'skill_search' &&
      edgesRef.current.some((e) => e.target === node.id && e.source === p.id)
    ) {
      const selections: SkillSelection[] = Array.isArray(p.data?.skillSelections)
        ? p.data.skillSelections
        : [];
      for (const s of selections) {
        if (s && typeof s.name === 'string' && s.name && !names.includes(s.name)) {
          names.push(s.name);
        }
      }
    }
  }
  return names;
}

/** 单条消息图片数截断到上限（上下文与附件合计）。 */
const capWireImages = (msgs: ChatMessage[]): ChatMessage[] =>
  msgs.map((m) =>
    m.images && m.images.length > MAX_CHAT_IMAGES
      ? { ...m, images: m.images.slice(0, MAX_CHAT_IMAGES) }
      : m
  );

/** 鉴权请求头（每次请求时读取最新 token）。
 * 注意不要带 Content-Type：AI SDK 传输层会自动设置 `Content-Type: application/json`；
 * 若这里也带上，normalize 成小写 `content-type` 后与传输层的键并存，浏览器 fetch 会把
 * 大小写相同的头合并成 `application/json, application/json`，Fastify 5 严格解析判为非法 → 415。 */
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 401 统一处理：清除本地凭据并跳转登录（与 postSSEStream 行为一致）。 */
function handleUnauthorized(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  if (window.location.pathname !== '/login') {
    sessionStorage.setItem(
      'redirectAfterLogin',
      window.location.pathname + window.location.search
    );
    window.location.href = '/login';
  }
}

/**
 * AI 对话节点宿主（useChat 迁移核心）：
 *
 * - 每个 chat 节点一个 ChatNodeHost 实例，持有一个 `useChat`（AI SDK v7 UI Message Stream 原生消费）；
 * - useChat 消息是流式权威状态，镜像写回节点 store（node.data.messages）持久化（sessionStorage）；
 * - 外部变更（清空对话 / 撤销 / 恢复）经「store 与镜像不一致且非流式中」检测恢复进 useChat；
 * - 上下文注入 / agent 步骤 / 文件 / 重试 / 中断语义与旧 useChatExecution 逐项对齐。
 */
export function ChatNodeHost({
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
          const blocks = buildInjectedContextBlocks(cur, portTypesRef);
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

        // 节点工作区标识：首轮生成并持久化（Skill Agent 产物/文件跨轮保留）
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
          appendAgentFile(nodeId, file, setNodes, setMessages);
        }
        return;
      }
      handleAgentSseMessage(setNodes, nodeId, name, JSON.stringify(part.data));
    },
    onFinish: () => {
      idleRef.current?.idle.clear();
      idleRef.current = null;
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

  // 首次渲染时的 store 快照作为镜像基线（挂载恢复 = 持久化消息 → useChat）
  const lastMirroredRef = useRef<string>(
    JSON.stringify(Array.isArray(node.data?.messages) ? node.data.messages : [])
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

    let next = uiToStore(uiMessages);

    // 流式中：最后一条 assistant 标记 streaming（打字光标 / 思考中...）
    if (streaming && next.length) {
      const i = next.length - 1;
      if (next[i].role === 'assistant') next[i] = { ...next[i], streaming: true };
    }
    // 错误且无任何产出：移除空的 assistant 占位（保留已流出的部分）
    if (status === 'error' && next.length) {
      const i = next.length - 1;
      const last = next[i];
      if (last.role === 'assistant' && !last.content && !last.reasoning) next = next.slice(0, -1);
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

      // 流式中进行 80ms 节流写入顶层 store，流式结束（或出错）时立即 flush 最终状态
      if (streaming) {
        if (throttleTimerRef.current === null) {
          throttleTimerRef.current = setTimeout(() => {
            throttleTimerRef.current = null;
            flushPendingPatch();
          }, 80);
        }
      } else {
        flushPendingPatch();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiMessages, status, nodeId, setNodes, setMessages, flushPendingPatch]);

  // ---------- 外部变更检测：清空对话 / 撤销 / 恢复时 store 与 useChat 不同步 ----------
  useEffect(() => {
    const storeMsgs = Array.isArray(node.data?.messages) ? node.data.messages : [];
    const json = JSON.stringify(storeMsgs);
    if (json === lastMirroredRef.current) return;
    // 流式中 store 的 agentSteps 等增量写入不视为外部变更（镜像会收敛）
    if (status === 'submitted' || status === 'streaming') return;
    lastMirroredRef.current = json;
    setMessages(storeToUI(storeMsgs));
    if (status === 'error') clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.data?.messages, status, nodeId, setMessages]);

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
      // 重置本轮状态（agent 步骤 / 错误横幅）
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, agentSteps: [], error: null } }
            : n
        )
      );
      // 空闲超时：120s 无数据自动中止（与旧 SSE 行为一致，超时置错误提示）
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
        n.id === nodeId ? { ...n, data: { ...n.data, agentSteps: [], error: null } } : n
      )
    );
    void regenerate();
  }, [status, clearError, regenerate, nodeId, setNodes]);

  // ---------- 渲染 ----------
  const config = h.configOf(node);
  const settings: ChatNodeSettings =
    node.data?.settings ?? DEFAULT_CHAT_SETTINGS;
  const isStreaming = status === 'submitted' || status === 'streaming';
  const messages: ChatMessage[] =
    isStreaming && pendingPatchRef.current
      ? pendingPatchRef.current.next
      : Array.isArray(node.data?.messages)
        ? node.data.messages
        : [];

  // 计算上下文块：未发消息时实时根据画布连线与配置动态重算；已发消息时从首条 user 消息获取已锁定的上下文
  const firstUser = messages.find((m: ChatMessage) => m.role === 'user');
  const contextBlocks: InjectedContextBlock[] =
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
      : buildInjectedContextBlocks(node, portTypesRef, h.nodes, h.edges);

  return (
    <ChatNode
      id={node.id}
      initialX={node.x}
      initialY={node.y}
      title={getNodeTitle(node)}
      messages={messages}
      contextBlocks={contextBlocks}
      agentName={
        config?.mode === 'agent'
          ? (config.agent_name ?? undefined)
          : config?.mode === 'skill_agent'
            ? (config.skill_agent_config_name ?? undefined)
            : undefined
      }
      agentSteps={Array.isArray(node.data?.agentSteps) ? node.data.agentSteps : []}
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
    />
  );
}

/** 把 skill 执行产生的文件附加到最后一条 assistant 消息（store + useChat metadata 双写，去重）。 */
function appendAgentFile(
  nodeId: string,
  file: AgentFile,
  setNodes: Dispatch<SetStateAction<NodeData[]>>,
  setMessages: Dispatch<SetStateAction<UIMessage[]>>
): void {
  setNodes((prev) =>
    prev.map((n) => {
      if (n.id !== nodeId) return n;
      const msgs = Array.isArray(n.data.messages) ? [...n.data.messages] : [];
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== 'assistant') return n;
      const files = Array.isArray(last.files) ? [...last.files] : [];
      if (!files.some((f) => f.url === file.url)) files.push(file);
      msgs[msgs.length - 1] = { ...last, files };
      return { ...n, data: { ...n.data, messages: msgs } };
    })
  );
  // 同步进 useChat metadata，保证镜像写回 store 时不丢
  setMessages((prev) => {
    const idx = prev.length - 1;
    if (idx < 0 || prev[idx].role !== 'assistant') return prev;
    const meta = {
      ...((prev[idx].metadata as { bookplate?: Record<string, unknown> } | undefined)
        ?.bookplate ?? {}),
      files: [
        ...(((prev[idx].metadata as { bookplate?: { files?: AgentFile[] } } | undefined)
          ?.bookplate?.files) ?? []),
        file,
      ],
    };
    const copy = [...prev];
    copy[idx] = { ...prev[idx], metadata: { bookplate: meta } };
    return copy;
  });
}
