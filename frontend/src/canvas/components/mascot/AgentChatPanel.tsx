import React, { useState, useRef, useEffect, useReducer, useMemo, useCallback } from 'react';
import {
  Bot,
  X,
  Send,
  Trash2,
  Sparkles,
  Paperclip,
  Square,
  Maximize2,
  Minimize2,
  History,
} from 'lucide-react';
import { PhotoProvider } from 'react-photo-view';
import { useFeedback } from '../../../shared/components/ui/FeedbackProvider';
import { ChatMessageItem } from '../../nodes/ai/chat/ChatMessageItem';
import { authHeaders, handleUnauthorized } from '../../nodes/ai/infra/authUtils';
import {
  parseSseStream,
  piStreamReducer,
  INITIAL_PI_STREAM,
} from '../../nodes/ai/infra/piStream';
import {
  fetchPiSession,
  setConversationPinned,
  renameConversation,
  deleteConversationSession,
} from '../../nodes/ai/infra/piSessionApi';
import { useConversationHistoryPanel } from '../../nodes/ai/infra/useConversationHistoryPanel';
import { copyTextToClipboard } from '../../../shared/utils/clipboard';
import { executeCanvasOp } from './canvasExecutor';
import { AgentHistoryDrawer } from './AgentHistoryDrawer';
import { MASCOT_AGENT_WORKSPACE_STORAGE_KEY } from './constants';
import type { ChatMessage } from '../../../shared/types';

export interface AgentChatPanelProps {
  open: boolean;
  onClose: () => void;
  workspaceId?: string;
}

const QUICK_PROMPTS = [
  '帮我做一张图书推荐卡片',
  '把上传的图片变成水墨画风格',
  '我想申请定制一个写七言绝句的大模型节点',
];

/**
 * 过滤小模型在正文中幻觉输出的伪 XML 标签（如 <canvas_op>...</canvas_op> 和 <result>...</result>）
 */
function sanitizeCanvasAgentContent(content: string): string {
  if (!content) return '';
  let cleaned = content.replace(/<canvas_op>[\s\S]*?<\/canvas_op>/gi, '');
  cleaned = cleaned.replace(/<result>[\s\S]*?<\/result>/gi, '');
  cleaned = cleaned.replace(
    /<\/?(?:canvas_op|action_name|params_key|arg_key|arg_value|result|success|node_id)>/gi,
    ''
  );
  return cleaned.trim();
}

export const AgentChatPanel: React.FC<AgentChatPanelProps> = ({
  open,
  onClose,
  workspaceId: propWorkspaceId,
}) => {
  const { dialog, showToast } = useFeedback();

  // 活跃工作区 ID：优先使用 prop 显式传入；缺省时从 localStorage 恢复或置 null（延迟分配）
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() => {
    if (propWorkspaceId) return propWorkspaceId;
    try {
      const saved = localStorage.getItem(MASCOT_AGENT_WORKSPACE_STORAGE_KEY);
      return saved && saved.trim() ? saved.trim() : null;
    } catch {
      return null;
    }
  });

  // 外部 propWorkspaceId 变更时同步
  useEffect(() => {
    if (propWorkspaceId && propWorkspaceId !== activeWorkspaceId) {
      setActiveWorkspaceId(propWorkspaceId);
    }
  }, [propWorkspaceId]);

  // 1. 服务端水合历史与流式状态机（复用 Pi Agent 的 piStreamReducer）
  const [sessionMsgs, setSessionMsgs] = useState<ChatMessage[] | null>(null);
  const [streamState, dispatchStream] = useReducer(piStreamReducer, INITIAL_PI_STREAM);

  // 2. 输入与界面状态
  const [inputValue, setInputValue] = useState('');
  const [showQuickPrompts, setShowQuickPrompts] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // 3. 对话历史侧边抽屉状态机（向左吸附，专属 canvas-agent 前缀隔离）
  const [historyOpen, setHistoryOpen] = useState(false);
  const convPanel = useConversationHistoryPanel(historyOpen, 'pi', 'canvas-agent');

  // 4. 乐观用户消息与在途请求控制
  const optimisticUserRef = useRef<ChatMessage | null>(null);
  const [optimisticUser, setOptimisticUser] = useState<ChatMessage | null>(null);
  const interruptedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 打开或工作区变化时：从服务端水合历史会话（与 PiChatNodeHost 延迟分配对齐）
  useEffect(() => {
    if (!open) return;
    if (!activeWorkspaceId) {
      setSessionMsgs([]);
      return;
    }
    let cancelled = false;
    void fetchPiSession(activeWorkspaceId)
      .then(({ messages }) => {
        if (!cancelled) {
          setSessionMsgs(messages);
        }
      })
      .catch((err) => {
        console.warn('水合画板助手历史失败:', err);
        if (!cancelled) setSessionMsgs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeWorkspaceId]);

  // 新消息到达时平滑滚动到底部
  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [sessionMsgs, streamState.steps, optimisticUser, open]);

  // 打开时自动聚焦输入框
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  // 发送消息（复用 piStreamReducer 状态归约）
  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || inputValue).trim();
    if (!text || streamState.isStreaming) return;

    // 延迟分配：首轮发送时分配专属工作区（与 pi-agent 节点模式对齐，新对话创建新目录）
    let currentWs = activeWorkspaceId;
    if (!currentWs) {
      currentWs = `canvas-agent_${Date.now()}`;
      setActiveWorkspaceId(currentWs);
      try {
        localStorage.setItem(MASCOT_AGENT_WORKSPACE_STORAGE_KEY, currentWs);
      } catch {
        /* ignore */
      }
    }

    setInputValue('');
    if (inputRef.current) {
      inputRef.current.style.height = '36px';
    }

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
    };
    optimisticUserRef.current = userMsg;
    setOptimisticUser(userMsg);
    interruptedRef.current = false;

    dispatchStream({ type: 'start' });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const resp = await fetch('/api/modules/bookplate/canvas-agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: text,
          workspace_id: currentWs,
        }),
      });

      if (resp.status === 401) {
        handleUnauthorized();
        throw new Error('未授权，请重新登录');
      }

      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP 错误: ${resp.status}`);
      }

      for await (const evt of parseSseStream(resp.body)) {
        if (controller.signal.aborted) break;

        switch (evt.type) {
          case 'content_delta':
            if (evt.delta) dispatchStream({ type: 'content', delta: evt.delta });
            break;
          case 'reasoning_delta':
            if (evt.delta) dispatchStream({ type: 'reasoning', delta: evt.delta });
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
          case 'status':
            dispatchStream({ type: 'status', message: evt.message });
            break;
          case 'turn_start':
            dispatchStream({ type: 'turn_start' });
            break;
          case 'token_usage':
            dispatchStream({
              type: 'token_usage',
              input: evt.input,
              output: evt.output,
              cacheRead: evt.cacheRead,
              cacheWrite: evt.cacheWrite,
              totalTokens: evt.totalTokens,
              contextWindow: evt.contextWindow,
              percent: evt.percent,
            });
            break;
          case 'extension_ui_request': {
            // 核心设计：拦截 CANVAS_OP: 自动在画布执行
            if (evt.title?.startsWith('CANVAS_OP:')) {
              const op = evt.title.slice('CANVAS_OP:'.length);
              let params: Record<string, unknown> = {};
              try {
                const raw = evt.options?.[0] ? JSON.parse(evt.options[0]) : {};
                params =
                  raw && typeof raw === 'object' && 'params' in raw && typeof raw.params === 'object' && raw.params !== null
                    ? (raw.params as Record<string, unknown>)
                    : (raw as Record<string, unknown>);
              } catch {
                /* ignore */
              }
              const result = executeCanvasOp(op, params);

              // 自动写回 UI 响应
              fetch('/api/modules/bookplate/canvas-agent/ui-response', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({
                  workspace_id: currentWs,
                  id: evt.id,
                  answer: JSON.stringify(result),
                }),
              }).catch(console.error);
            } else {
              // 普通扩展问答 / 确认请求，交给 piStream 驱动 QuestionAnswerBlock
              dispatchStream({
                type: 'ui_request',
                request: {
                  id: evt.id,
                  method: evt.method ?? 'select',
                  title: evt.title || '请选择',
                  options: evt.options,
                  message: evt.message,
                  placeholder: evt.placeholder,
                  prefill: evt.prefill,
                  timeout: evt.timeout,
                },
              });
            }
            break;
          }
          case 'error':
            dispatchStream({ type: 'error', message: evt.message });
            break;
        }
      }
    } catch (err: any) {
      if (!controller.signal.aborted) {
        dispatchStream({ type: 'error', message: err.message || '网络连接异常' });
      }
    } finally {
      abortControllerRef.current = null;
      dispatchStream({ type: 'settle' });

      // 流式收尾：从服务端水合持久化历史，原子对齐会话
      try {
        const { messages: refreshedMsgs } = await fetchPiSession(currentWs);
        setSessionMsgs(refreshedMsgs);
        dispatchStream({ type: 'end' });
        convPanel.bump();
        optimisticUserRef.current = null;
        setOptimisticUser(null);
      } catch {
        /* 保留 live 状态展示 */
      }
    }
  };

  // 停止生成
  const handleStop = () => {
    if (abortControllerRef.current) {
      interruptedRef.current = true;
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      dispatchStream({ type: 'settle' });
    }
  };

  // 切换到指定历史会话
  const handleSelectSession = useCallback((ws: string) => {
    if (ws === activeWorkspaceId) return;
    handleStop();
    setOptimisticUser(null);
    setActiveWorkspaceId(ws);
    try {
      localStorage.setItem(MASCOT_AGENT_WORKSPACE_STORAGE_KEY, ws);
    } catch {
      /* ignore */
    }
    dispatchStream({ type: 'end' });
  }, [activeWorkspaceId]);

  // 新建对话：置空当前活跃工作区并重置消息（历史列表完好保留）
  const handleNewChat = useCallback(() => {
    handleStop();
    setOptimisticUser(null);
    setActiveWorkspaceId(null);
    setSessionMsgs([]);
    try {
      localStorage.removeItem(MASCOT_AGENT_WORKSPACE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    dispatchStream({ type: 'end' });
  }, []);

  // 置顶 / 取消置顶
  const handleTogglePin = useCallback(async (ws: string, pinned: boolean) => {
    await setConversationPinned(ws, pinned);
    convPanel.bump();
  }, [convPanel]);

  // 重命名会话
  const handleRenameSession = useCallback(async (ws: string, title: string) => {
    await renameConversation(ws, title);
    convPanel.bump();
  }, [convPanel]);

  // 彻底删除会话
  const handleDeleteSession = useCallback(async (ws: string) => {
    await deleteConversationSession(ws);
    if (ws === activeWorkspaceId) {
      handleNewChat();
    }
    convPanel.bump();
  }, [activeWorkspaceId, handleNewChat, convPanel]);

  // 响应普通扩展 UI 交互（select / confirm 等）
  const handleDialogAnswer = async (
    id: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean }
  ) => {
    if (!activeWorkspaceId) return;
    dispatchStream({ type: 'ui_response', id });
    await fetch('/api/modules/bookplate/canvas-agent/ui-response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        workspace_id: activeWorkspaceId,
        id,
        ...response,
      }),
    }).catch(console.error);
  };

  // 清空会话：对齐全站统一的藏书票风格弹窗
  const handleClear = async () => {
    const ok = await dialog.confirm({
      title: '清空会话',
      message: '确定要清空与画板助手的对话历史吗？此操作将开启全新会话。',
      confirmText: '清空',
      cancelText: '取消',
      danger: true,
    });
    if (!ok) return;

    const oldWs = activeWorkspaceId;
    handleStop();
    setSessionMsgs([]);
    setOptimisticUser(null);
    setActiveWorkspaceId(null);
    try {
      localStorage.removeItem(MASCOT_AGENT_WORKSPACE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    dispatchStream({ type: 'end' });

    if (oldWs) {
      await fetch('/api/modules/bookplate/canvas-agent/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ workspace_id: oldWs }),
      }).catch(console.error);
    }
    convPanel.bump();
  };

  // 复制正文
  const handleCopy = useCallback(
    async (content: string, idx: number) => {
      try {
        await copyTextToClipboard(content);
        setCopiedId(idx);
        setTimeout(() => setCopiedId(null), 2000);
        showToast('已复制回复内容', { type: 'success' });
      } catch {
        showToast('复制失败，请手动选择文本复制', { type: 'error' });
      }
    },
    [showToast]
  );

  // 当轮 live assistant 消息合成（按 streamState.steps 拆分，过滤 XML 伪代码）
  const liveAssistantMsgs: ChatMessage[] = useMemo(() => {
    if (!streamState.steps.length) return [];
    return streamState.steps.map((step, idx) => ({
      id: `live_assistant_${idx}`,
      role: 'assistant' as const,
      content: sanitizeCanvasAgentContent(step.content),
      reasoning: step.reasoning || undefined,
      agentSteps: step.agentSteps,
      tokenUsage: step.tokenUsage,
      streaming: streamState.isStreaming && idx === streamState.steps.length - 1,
      interrupted: interruptedRef.current,
    }));
  }, [streamState.steps, streamState.isStreaming]);

  // 显示消息列表合成：水合历史 + 当轮乐观用户消息 + 当轮 live assistant
  const displayMessages: ChatMessage[] = useMemo(() => {
    const base = (sessionMsgs ?? []).map((m) => ({
      ...m,
      content: sanitizeCanvasAgentContent(m.content),
    }));
    if (!optimisticUser && !liveAssistantMsgs.length) return base;
    const out = [...base];
    if (optimisticUser) out.push(optimisticUser);
    out.push(...liveAssistantMsgs);
    return out;
  }, [sessionMsgs, optimisticUser, liveAssistantMsgs]);

  if (!open) return null;

  // 尺寸计算：遵循 better-layout 视口安全边距与通行侧边助手设计规范
  // 吉祥物小组件已默认移至左下角，右侧整条垂直通道完全释放
  // 底部下探贴近底边 bottom-4 (16px)，顶部避让 64px 导航栏并保留 12px 呼吸微距 (76px)
  // 纵向尺寸达到最大化：h-[calc(100dvh-92px)]，呈现通行的垂直长方形 AI 侧边伴随栏
  const panelSizeClass = isExpanded
    ? 'w-[760px] max-w-[calc(100vw-2rem)] h-[calc(100dvh-92px)] max-h-[calc(100dvh-92px)]'
    : 'w-[500px] max-w-[calc(100vw-2rem)] h-[calc(100dvh-92px)] max-h-[calc(100dvh-92px)]';

  return (
    <div
      className="fixed right-4 bottom-4 z-[9985] flex items-end gap-3 pointer-events-none"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 对话历史侧边抽屉（向左吸附展示） */}
      <div className="pointer-events-auto">
        <AgentHistoryDrawer
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          sessions={convPanel.sessions}
          loading={convPanel.loading}
          currentWorkspaceId={activeWorkspaceId}
          onRefresh={convPanel.refresh}
          onSelectSession={handleSelectSession}
          onNewChat={handleNewChat}
          onTogglePin={handleTogglePin}
          onRenameSession={handleRenameSession}
          onDeleteSession={handleDeleteSession}
        />
      </div>

      {/* 主聊天对话面板 */}
      <div
        className={`pointer-events-auto ${panelSizeClass} flex flex-col bg-paper border border-paper-grid rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-right-4 duration-200 transition-[width,height]`}
        style={{ transformOrigin: 'bottom right' }}
      >
        {/* 1. 顶栏：标题、状态、历史抽屉、宽屏展开、清空与关闭 */}
        <div className="px-4 py-3 border-b border-paper-grid bg-paper/90 backdrop-blur-sm flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600">
              <Bot size={17} />
            </div>
            <div>
              <h3 className="text-sm font-serif font-bold text-ink leading-tight">Canvas Agent</h3>
              <span className="text-[10px] text-ink-faint font-sans flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                智能画布助手
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {/* 对话历史侧边抽屉切换按钮 */}
            <button
              type="button"
              onClick={() => setHistoryOpen((prev) => !prev)}
              title={historyOpen ? '收起对话历史' : '展开对话历史'}
              aria-label="对话历史"
              className={`p-1.5 rounded-lg transition-colors active:scale-95 ${
                historyOpen
                  ? 'text-accent bg-accent/10 font-medium'
                  : 'text-ink-faint hover:text-ink hover:bg-paper-grid/30'
              }`}
            >
              <History size={15} />
            </button>
            {/* 尺寸展开 / 收缩切换 */}
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              title={isExpanded ? '还原标准宽度 (540px)' : '展开为宽屏模式 (720px)'}
              className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-paper-grid/30 active:scale-95 transition-colors"
            >
              {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            {/* 清空会话 */}
            <button
              type="button"
              onClick={handleClear}
              title="清空对话"
              className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-paper-grid/30 active:scale-95 transition-colors"
            >
              <Trash2 size={14} />
            </button>
            {/* 关闭面板 */}
            <button
              type="button"
              onClick={onClose}
              title="关闭面板"
              className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-paper-grid/30 active:scale-95 transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>

      {/* 2. 消息流视口：完全复用 ChatMessageItem 呈现 */}
      <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 font-sans text-xs">
          {displayMessages.length === 0 && (
            <div className="py-8 flex flex-col items-center text-center space-y-3 animate-in fade-in duration-200">
              <div className="w-12 h-12 rounded-full bg-accent/10 text-accent flex items-center justify-center shadow-xs">
                <Sparkles size={22} />
              </div>
              <div>
                <p className="text-sm font-bold text-ink font-serif">你好！我是智能画板助手</p>
                <p className="text-xs text-ink-faint mt-1 max-w-[320px] leading-relaxed">
                  告诉我你的创作想法，我能为你推荐内置节点、配置参数并自动创建连线；遇到特殊 AI
                  需求也能帮你直发企业微信！
                </p>
              </div>
              <div className="w-full pt-2 flex flex-col gap-1.5">
                <span className="text-[11px] text-ink-faint self-start font-medium px-1">
                  你可以试试：
                </span>
                {QUICK_PROMPTS.map((prompt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSend(prompt)}
                    className="text-left px-3 py-2 rounded-xl border border-paper-grid bg-paper hover:bg-paper-grid/20 hover:border-accent/40 text-ink text-xs transition-colors active:scale-[0.98]"
                  >
                    💡 {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {displayMessages.map((msg, idx) => {
            // 计算当前 assistant 消息在其所属交互轮次中的步骤序号（以 user 消息为轮次分界）
            let stepNumber: number | undefined = undefined;
            if (msg.role === 'assistant') {
              let count = 0;
              for (let i = 0; i <= idx; i++) {
                if (displayMessages[i].role === 'user') {
                  count = 0;
                } else if (displayMessages[i].role === 'assistant') {
                  count++;
                }
              }
              stepNumber = count;
            }

            return (
              <ChatMessageItem
                key={msg.id || `${msg.role}-${idx}`}
                msg={msg}
                idx={idx}
                stepNumber={stepNumber}
                isLast={idx === displayMessages.length - 1}
                agentName="Canvas Agent"
                workspaceId={activeWorkspaceId || ''}
                onCopy={handleCopy}
                isCopied={copiedId === idx}
                onRetry={() => handleSend(optimisticUser?.content || '')}
                isGenerating={streamState.isStreaming}
                extensionDialog={{
                  request: streamState.pendingUi,
                  onAnswer: handleDialogAnswer,
                }}
              />
            );
          })}

          <div ref={messagesEndRef} />
        </div>
      </PhotoProvider>

      {/* 3. 输入控制栏 */}
      <div className="relative p-3 border-t border-paper-grid bg-paper shrink-0">
        {/* 快捷创作灵感弹出卡片 */}
        {showQuickPrompts && (
          <div className="absolute bottom-full mb-2 left-3 right-3 p-2 bg-paper/95 backdrop-blur-sm border border-paper-grid rounded-xl shadow-lg flex flex-col gap-1 z-30 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center justify-between px-1 pb-1 text-[11px] text-ink-faint font-medium border-b border-paper-grid/50">
              <span>快捷创作灵感：</span>
              <button
                type="button"
                onClick={() => setShowQuickPrompts(false)}
                className="text-ink-faint hover:text-ink"
              >
                <X size={12} />
              </button>
            </div>
            {QUICK_PROMPTS.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setShowQuickPrompts(false);
                  handleSend(prompt);
                }}
                className="text-left px-2.5 py-1.5 rounded-lg hover:bg-paper-grid/30 text-ink text-xs transition-colors"
              >
                💡 {prompt}
              </button>
            ))}
          </div>
        )}

        <div className="relative flex items-end gap-1.5">
          {/* 左侧操作按钮：Paperclip 快捷灵感 */}
          <button
            type="button"
            onClick={() => setShowQuickPrompts((prev) => !prev)}
            disabled={streamState.isStreaming}
            aria-label="快捷创作灵感"
            title="快捷创作灵感"
            className="flex shrink-0 items-center justify-center w-9 h-9 rounded-lg border border-paper-grid/70 text-ink-faint hover:text-accent hover:border-accent/40 hover:bg-accent/5 active:scale-[0.96] transition-[color,background-color,border-color,transform] duration-150 ease-out disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Paperclip size={15} strokeWidth={2} />
          </button>

          {/* 中间输入框：自适应高度 */}
          <div className="relative flex-1 min-w-0 rounded-lg bg-node-bg">
            <textarea
              ref={inputRef}
              rows={1}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                if (inputRef.current) {
                  inputRef.current.style.height = '36px';
                  if (inputRef.current.scrollHeight > 36) {
                    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 128)}px`;
                  }
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={streamState.isStreaming ? '回复生成中…' : '输入消息，Enter 发送，Shift+Enter 换行'}
              disabled={streamState.isStreaming}
              className="relative z-10 block w-full min-h-[36px] max-h-32 overflow-y-auto resize-none rounded-lg border border-paper-grid/70 bg-transparent px-3 py-1.5 text-sm font-sans text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-[border-color,box-shadow] duration-150 disabled:opacity-60 [text-wrap:pretty]"
            />
          </div>

          {/* 右侧操作按钮：发送 / 停止生成 */}
          {streamState.isStreaming ? (
            <button
              type="button"
              onClick={handleStop}
              aria-label="停止生成"
              title="停止生成"
              className="flex shrink-0 items-center justify-center w-9 h-9 rounded-lg border border-error/30 bg-error/5 text-error hover:bg-error/10 active:scale-[0.96] transition-[color,background-color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
            >
              <Square size={14} strokeWidth={2} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleSend()}
              disabled={!inputValue.trim()}
              aria-label="发送消息 (Enter)"
              title="发送 (Enter)"
              className="flex shrink-0 items-center justify-center w-9 h-9 rounded-lg bg-accent text-white shadow-xs hover:bg-accent/90 active:scale-[0.96] transition-[background-color,transform] duration-150 ease-out disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Send size={15} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  </div>
);
};
