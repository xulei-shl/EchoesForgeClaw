import type { Dispatch, RefObject, SetStateAction } from 'react';
import { postSSEStream } from '../../platform/services/sse';
import { PROMPT_SSE_IDLE_TIMEOUT_MS } from '../../platform/utils/timeouts';
import { bookMetadataText, nodeOutputImages, nodeOutputText } from './nodeTypes';
import { resolveNodeRunInputs, type PortTypesLookup } from './execution';
import { toWireChatMessages, type EdgeData, type NodeData } from './graphTypes';
import { handleAgentSseMessage } from './agentSteps';
import { makeIdleTimeout } from './idleTimeout';
import { urlToDataUrl } from './imageUpload';
import type { AgentFile, ChatMessage, ChatNodeSettings, SkillSelection } from '../../platform/types';

// AI 对话单轮携带的图片上限（附件 + 上下文图片合计）：防止超大 base64 请求体拖垮传输
const MAX_CHAT_IMAGES = 4;

/** 上下文设置兜底（旧节点持久化的 settings 缺少 includeUpstreamImages，undefined 视为开启） */
const DEFAULT_CHAT_SETTINGS: ChatNodeSettings = {
  includeBook: true,
  includeUpstream: true,
  includeUpstreamImages: true,
};

/** AI 对话执行依赖（由画布注入：refs + 稳定 setter） */
export interface ChatExecutionContext {
  nodesRef: RefObject<NodeData[]>;
  edgesRef: RefObject<EdgeData[]>;
  streamControllers: RefObject<Map<string, AbortController>>;
  portTypesRef: RefObject<PortTypesLookup>;
  setNodes: Dispatch<SetStateAction<NodeData[]>>;
}

export interface ChatExecution {
  /** 发送一条用户消息；images 为本轮附带图片（data URL） */
  runChatTurn: (node: NodeData, text: string, images?: string[]) => void;
  retryChatTurn: (node: NodeData) => void;
}

/** AI 对话节点执行：多轮发送 / 重试 / 停止（SSE 流式）。 */
export function useChatExecution(ctx: ChatExecutionContext): ChatExecution {
  const { streamControllers } = ctx;

  /** 收集对话上下文：连线上游图书元数据（无连通时回退画布根节点）+ 直接父节点输出（受节点设置控制）。
   *  按内容主体去重：直接父节点恰为图书元数据时，includeBook 与 includeUpstream
   *  两条路径会注入同一份元数据（仅标题不同），逐块去重后只保留一份。 */
  const buildChatContext = (node: NodeData): string => {
    const settings: ChatNodeSettings = node.data?.settings ?? DEFAULT_CHAT_SETTINGS;
    const blocks: { title: string; body: string }[] = [];
    if (settings.includeBook) {
      const book = resolveNodeRunInputs(
        node,
        ctx.nodesRef.current,
        ctx.edgesRef.current,
        ctx.portTypesRef.current
      ).book;
      const metaText = bookMetadataText(book?.data);
      if (metaText.trim()) blocks.push({ title: '图书元数据', body: metaText });
    }
    if (settings.includeUpstream) {
      // 「紧随的上一级节点内容」= 全部直接父节点的输出文本（支持 AI 对话节点链式串联）
      const parents = ctx.nodesRef.current.filter((n) =>
        ctx.edgesRef.current.some((e) => e.target === node.id && e.source === n.id)
      );
      for (const p of parents) {
        const text = nodeOutputText(p).trim();
        if (text) blocks.push({ title: '上级节点内容', body: text });
      }
    }
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const b of blocks) {
      if (seen.has(b.body)) continue;
      seen.add(b.body);
      parts.push(`【${b.title}】\n${b.body}`);
    }
    return parts.join('\n\n');
  };

  /** 收集对话上下文图片：直接父节点的图片输出（图片上传 / 图像生成节点），受设置开关控制。
   *  本地静态路径（如 /static/generated/xxx.png）需转换为 data URL 才能被模型 / Agent 消费；
   *  转换失败或超限时静默跳过，不阻断对话。 */
  const buildChatImages = async (node: NodeData): Promise<string[]> => {
    const settings: ChatNodeSettings = node.data?.settings ?? DEFAULT_CHAT_SETTINGS;
    if (settings.includeUpstreamImages === false) return [];
    const parents = ctx.nodesRef.current.filter((n) =>
      ctx.edgesRef.current.some((e) => e.target === node.id && e.source === n.id)
    );
    const urls: string[] = [];
    for (const p of parents) {
      for (const u of nodeOutputImages(p)) {
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
  };

  /** 发送给后端的消息：合并 contextImages 后单条消息图片数截断到上限（上下文与附件合计） */
  const capWireImages = (msgs: ChatMessage[]): ChatMessage[] =>
    msgs.map((m) =>
      m.images && m.images.length > MAX_CHAT_IMAGES
        ? { ...m, images: m.images.slice(0, MAX_CHAT_IMAGES) }
        : m
    );

  /** 收集连线上游「Skill 检索」节点选中的 skill 名（Skill Agent 模式按需加载；空 = 全部已装 skill）。
   *  读取节点的 skillSelections 数组（多选），跨节点幂等去重；旧单数字段节点默认为空。
   *  Skill Agent 的多轮历史由后端 messages 驱动，skills 每轮随请求重传（上游引用稳定，天然幂等）。 */
  const collectSkillNames = (node: NodeData): string[] => {
    const names: string[] = [];
    for (const p of ctx.nodesRef.current) {
      if (
        p.type === 'skill_search' &&
        ctx.edgesRef.current.some((e) => e.target === node.id && e.source === p.id)
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
  };

  /** 把 skill 执行产生的文件（agent_file 事件）追加到最后一条 assistant 消息上（去重渲染下载卡片） */
  const appendAgentFile = (nodeId: string, file: AgentFile) => {
    ctx.setNodes((prev) =>
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
  };

  /** AI 对话节点核心发送逻辑：把指定历史 + 用户消息发送到后端，SSE 流式接收助手回复。
   *  供新消息（runChatTurn）与重试（retryChatTurn）复用，保证两次请求负载完全一致。
   *  @param preAcquired 可选：runChatTurn 在收集上下文图片前预注册的控制器（首轮防并发窗口） */
  const executeChatTurn = (
    node: NodeData,
    opts: {
      history: ChatMessage[];
      userMsg: ChatMessage;
      userText: string;
      wireMessages: ChatMessage[];
    },
    preAcquired?: AbortController
  ) => {
    // 防抖：该节点已有进行中的流时直接忽略（preAcquired 时跳过——首轮已预注册占位）
    if (streamControllers.current.has(node.id) && !preAcquired) return;
    // 节点工作区标识：首轮生成（{node_id}_{timestamp}）并持久化到 node.data.workspaceId，
    // 同节点多轮复用同一工作区（Skill Agent 产物/文件跨轮保留）；清空对话时由清空逻辑重置
    const workspaceId =
      typeof node.data?.workspaceId === 'string' && node.data.workspaceId
        ? node.data.workspaceId
        : `${node.id}_${Date.now()}`;
    const pendingMsg: ChatMessage = { role: 'assistant', content: '', streaming: true };
    // 乐观更新：追加 user 消息 + assistant 流式占位
    ctx.setNodes((prev) =>
      prev.map((n) =>
        n.id === node.id
          ? {
              ...n,
              data: {
                ...n.data,
                messages: [...opts.history, opts.userMsg, pendingMsg],
                isGenerating: true,
                error: null,
                agentSteps: [],
                workspaceId,
              },
            }
          : n
      )
    );

    const controller = preAcquired ?? new AbortController();
    streamControllers.current.set(node.id, controller);

    const idle = makeIdleTimeout(controller, PROMPT_SSE_IDLE_TIMEOUT_MS);
    idle.arm();

    // Agent 模式携带的图片：本轮用户附件优先，其次首条 user 消息持久化的上下文图片
    // （仅首轮注入，与文本 context 语义一致）；合计截断到上限
    const agentImages = [...(opts.userMsg.images ?? []), ...(opts.userMsg.contextImages ?? [])].slice(
      0,
      MAX_CHAT_IMAGES
    );
    postSSEStream({
      url: '/api/modules/bookplate/chat',
      body: {
        // LLM 模式：context 经 toWireChatMessages 展开进首条 user 消息 content（历史持久、多轮延续），
        //         contextImages 经 toWireChatMessages 并入 messages[].images（多模态 content）；
        // Agent 模式：上下文直接拼进下方 message 字段（FastClaw 以 session key 服务端维护历史），
        //         图片经下方 images 字段（imageUrls）随本轮透传。
        messages: opts.wireMessages,
        message: opts.userText,
        images: agentImages,
        config_id: node.configId ?? null,
        node_id: node.id,
        epoch: node.data?.epoch ?? 0,
        skills: collectSkillNames(node),
        // Skill Agent 模式：节点工作区标识（后端据此装配软链 skill / AGENTS.md）
        workspace_id: workspaceId,
      },
      signal: controller.signal,
      onMessage: (event, data) => {
        idle.arm(); // 收到数据，重置空闲计时
        // Agent 模式中间步骤（工具调用 / 思考状态）单独处理，不注入回复文本
        if (
          event === 'agent_tool_call' ||
          event === 'agent_tool_result' ||
          event === 'agent_status'
        ) {
          handleAgentSseMessage(ctx.setNodes, node.id, event, data);
          return;
        }
        if (event === 'message') {
          // 追加增量到最后一条 assistant 消息（流式打字机）
          ctx.setNodes((prev) =>
            prev.map((n) => {
              if (n.id !== node.id) return n;
              const msgs = Array.isArray(n.data.messages) ? [...n.data.messages] : [];
              const last = msgs[msgs.length - 1];
              if (!last || last.role !== 'assistant') return n;
              msgs[msgs.length - 1] = { ...last, content: last.content + data };
              return { ...n, data: { ...n.data, messages: msgs } };
            })
          );
          return;
        }
        if (event === 'reasoning') {
          // 思考过程增量：累积到该轮 assistant 消息的独立字段（不并入 content，
          // 不随多轮历史回传，仅 UI 折叠展示）；模型无思考时后端不产出该事件
          ctx.setNodes((prev) =>
            prev.map((n) => {
              if (n.id !== node.id) return n;
              const msgs = Array.isArray(n.data.messages) ? [...n.data.messages] : [];
              const last = msgs[msgs.length - 1];
              if (!last || last.role !== 'assistant') return n;
              msgs[msgs.length - 1] = { ...last, reasoning: (last.reasoning ?? '') + data };
              return { ...n, data: { ...n.data, messages: msgs } };
            })
          );
          return;
        }
        if (event === 'agent_file') {
          // Skill Agent 执行产生的文件：解析后附加到本轮 assistant 消息（渲染下载/预览卡片）
          let file: AgentFile | null = null;
          try {
            file = JSON.parse(data);
          } catch {
            file = null;
          }
          if (file && typeof file?.url === 'string' && file.url) {
            appendAgentFile(node.id, file);
          }
          return;
        }
        if (event === 'error') {
          // 失败：移除空的流式占位，保留已流出的部分，切换到错误态（错误横幅带重试）
          ctx.setNodes((prev) =>
            prev.map((n) => {
              if (n.id !== node.id) return n;
              const msgs = Array.isArray(n.data.messages) ? [...n.data.messages] : [];
              const last = msgs[msgs.length - 1];
              if (last && last.role === 'assistant' && !last.content) msgs.pop();
              return {
                ...n,
                data: { ...n.data, messages: msgs, isGenerating: false, error: data },
              };
            })
          );
          return;
        }
      },
    })
      .then(() => {
        // 正常结束：封口流式消息；节点输出 = 最后一轮助手回复（供下一级节点作为输入）。
        // 若期间发生过 error（部分回复），不把残缺内容写入 output，避免污染下游输入
        ctx.setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== node.id) return n;
            const msgs = Array.isArray(n.data.messages) ? [...n.data.messages] : [];
            const last = msgs[msgs.length - 1];
            const output = n.data.error
              ? (n.data.output ?? '')
              : last && last.role === 'assistant'
                ? last.content
                : (n.data.output ?? '');
            return {
              ...n,
              data: {
                ...n.data,
                isGenerating: false,
                messages: msgs.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
                output,
              },
            };
          })
        );
      })
      .catch((err) => {
        // 用户主动停止：中止流并保留已流出的部分（标记中断态，消息下方出现重试入口）；
        // 其余中断（节点删除 / 画布清空 / 撤销回退）静默忽略，避免写回已移除节点
        const userInterrupted = !!(controller as any).userInterrupted;
        if (!idle.isTimedOut() && err?.name === 'AbortError' && !userInterrupted) return;
        console.error('SSE chat error:', err);
        ctx.setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== node.id) return n;
            const msgs = Array.isArray(n.data.messages) ? [...n.data.messages] : [];
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'assistant') {
              if (userInterrupted) {
                // 停止生成：保留已流出的部分，标记中断态（展示「重试」），不写入输出
                msgs[msgs.length - 1] = { ...last, streaming: false, interrupted: true };
              } else if (!last.content) {
                msgs.pop(); // 失败且无任何输出：移除空占位
              }
            }
            return {
              ...n,
              data: {
                ...n.data,
                messages: msgs,
                isGenerating: false,
                error: userInterrupted
                  ? null
                  : idle.isTimedOut()
                    ? '对话超时，请重试'
                    : '对话失败，请重试',
              },
            };
          })
        );
      })
      .finally(() => {
        idle.clear();
        streamControllers.current.delete(node.id);
      });
  };

  /** AI 对话节点：发送一条用户消息（多轮），SSE 流式返回助手回复。 */
  const runChatTurn = async (node: NodeData, text: string, images?: string[]) => {
    // 防抖：该节点已有进行中的流（含正在收集上下文图片的 await 窗口期）时直接忽略，
    // 与旧同步流程的语义一致，避免快速连发被静默丢弃
    if (streamControllers.current.has(node.id)) return;
    // 首轮收集上级图片可能发起网络请求：先注册占位控制器并交给 executeChatTurn，
    // 保证 await 期间节点级防抖仍然生效（再次发送会被上方 guard 拦截）
    const preAcquired = new AbortController();
    streamControllers.current.set(node.id, preAcquired);
    const existing: ChatMessage[] = Array.isArray(node.data?.messages)
      ? node.data.messages
      : [];
    // 上下文仅在首次注入一次并持久在首条 user 消息的隐藏 context 字段上（UI 不展示）：
    // LLM 模式每轮随完整历史重发、模型始终可见；再次注入会造成重复。
    // Agent 模式以 session key 服务端维护，同理避免重复。
    // 是否注入由「上下文设置」决定（buildChatContext 内读取 includeBook / includeUpstream）。
    const alreadyHasContext = existing.some((m) => m.role === 'user' && !!m.context);
    const context = !alreadyHasContext ? buildChatContext(node) : '';
    // 上下文图片同理：仅在首轮收集一次，持久在首条 user 消息的隐藏 contextImages 字段上
    const alreadyHasContextImages = existing.some(
      (m) => m.role === 'user' && !!m.contextImages
    );
    const contextImages = !alreadyHasContextImages ? await buildChatImages(node) : [];
    const userText = (context ? context + '\n\n' : '') + text;

    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      images: images?.length ? images : undefined,
      ...(context ? { context } : {}),
      ...(contextImages.length ? { contextImages } : {}),
    };
    executeChatTurn(
      node,
      {
        history: existing,
        userMsg,
        userText,
        wireMessages: capWireImages(toWireChatMessages([...existing, userMsg])),
      },
      preAcquired
    );
  };

  /** AI 对话节点：重试最后一轮（失败 / 中断后重新调用 API）。 */
  const retryChatTurn = (node: NodeData) => {
    if (streamControllers.current.has(node.id)) return;
    const msgs: ChatMessage[] = Array.isArray(node.data?.messages) ? node.data.messages : [];
    let userIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        userIdx = i;
        break;
      }
    }
    if (userIdx === -1) return; // 没有可重试的轮次
    const history = msgs.slice(0, userIdx);
    const userMsg = msgs[userIdx];
    executeChatTurn(node, {
      history,
      userMsg,
      userText: userMsg.context ? `${userMsg.context}\n\n${userMsg.content}` : userMsg.content,
      wireMessages: capWireImages(toWireChatMessages([...history, userMsg])),
    });
  };

  return { runChatTurn, retryChatTurn };
}
