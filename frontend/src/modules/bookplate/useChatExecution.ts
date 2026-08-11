import type { Dispatch, RefObject, SetStateAction } from 'react';
import { postSSEStream } from '../../platform/services/sse';
import { PROMPT_SSE_IDLE_TIMEOUT_MS } from '../../platform/utils/timeouts';
import { bookMetadataText, nodeOutputText } from './nodeTypes';
import { resolveNodeRunInputs } from './execution';
import { toWireChatMessages, type EdgeData, type NodeData } from './graphTypes';
import { handleAgentSseMessage } from './agentSteps';
import { makeIdleTimeout } from './idleTimeout';
import type { ChatMessage, ChatNodeSettings } from '../../platform/types';

/** AI 对话执行依赖（由画布注入：refs + 稳定 setter） */
export interface ChatExecutionContext {
  nodesRef: RefObject<NodeData[]>;
  edgesRef: RefObject<EdgeData[]>;
  streamControllers: RefObject<Map<string, AbortController>>;
  setNodes: Dispatch<SetStateAction<NodeData[]>>;
}

export interface ChatExecution {
  runChatTurn: (node: NodeData, text: string) => void;
  retryChatTurn: (node: NodeData) => void;
}

/** AI 对话节点执行：多轮发送 / 重试 / 停止（SSE 流式）。 */
export function useChatExecution(ctx: ChatExecutionContext): ChatExecution {
  const { streamControllers } = ctx;

  /** 收集对话上下文：连线上游图书元数据（无连通时回退画布根节点）+ 直接父节点输出（受节点设置控制）。
   *  按内容主体去重：直接父节点恰为图书元数据时，includeBook 与 includeUpstream
   *  两条路径会注入同一份元数据（仅标题不同），逐块去重后只保留一份。 */
  const buildChatContext = (node: NodeData): string => {
    const settings: ChatNodeSettings = node.data?.settings ?? {
      includeBook: true,
      includeUpstream: true,
    };
    const blocks: { title: string; body: string }[] = [];
    if (settings.includeBook) {
      const book = resolveNodeRunInputs(node, ctx.nodesRef.current, ctx.edgesRef.current).book;
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

  /** AI 对话节点核心发送逻辑：把指定历史 + 用户消息发送到后端，SSE 流式接收助手回复。
   *  供新消息（runChatTurn）与重试（retryChatTurn）复用，保证两次请求负载完全一致。 */
  const executeChatTurn = (
    node: NodeData,
    opts: {
      history: ChatMessage[];
      userMsg: ChatMessage;
      userText: string;
      wireMessages: ChatMessage[];
    }
  ) => {
    // 重试防抖：该节点已有进行中的流时直接忽略
    if (streamControllers.current.has(node.id)) return;
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
              },
            }
          : n
      )
    );

    const controller = new AbortController();
    streamControllers.current.set(node.id, controller);

    const idle = makeIdleTimeout(controller, PROMPT_SSE_IDLE_TIMEOUT_MS);
    idle.arm();

    postSSEStream({
      url: '/api/modules/bookplate/chat',
      body: {
        // LLM 模式：context 经 toWireChatMessages 展开进首条 user 消息 content（历史持久、多轮延续）；
        // Agent 模式：上下文直接拼进下方 message 字段（FastClaw 以 session key 服务端维护历史）
        messages: opts.wireMessages,
        message: opts.userText,
        config_id: node.configId ?? null,
        node_id: node.id,
        epoch: node.data?.epoch ?? 0,
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
  const runChatTurn = (node: NodeData, text: string) => {
    const existing: ChatMessage[] = Array.isArray(node.data?.messages)
      ? node.data.messages
      : [];
    // 上下文仅在首次注入一次并持久在首条 user 消息的隐藏 context 字段上（UI 不展示）：
    // LLM 模式每轮随完整历史重发、模型始终可见；再次注入会造成重复。
    // Agent 模式以 session key 服务端维护，同理避免重复。
    // 是否注入由「上下文设置」决定（buildChatContext 内读取 includeBook / includeUpstream）。
    const alreadyHasContext = existing.some((m) => m.role === 'user' && !!m.context);
    const context = !alreadyHasContext ? buildChatContext(node) : '';
    const userText = (context ? context + '\n\n' : '') + text;

    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      ...(context ? { context } : {}),
    };
    executeChatTurn(node, {
      history: existing,
      userMsg,
      userText,
      wireMessages: toWireChatMessages([...existing, userMsg]),
    });
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
      wireMessages: toWireChatMessages([...history, userMsg]),
    });
  };

  return { runChatTurn, retryChatTurn };
}
