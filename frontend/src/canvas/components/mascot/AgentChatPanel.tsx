import React, { useState, useRef, useEffect } from 'react';
import {
  Bot,
  X,
  Send,
  Trash2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Paperclip,
  Square,
} from 'lucide-react';
import { authHeaders, handleUnauthorized } from '../../nodes/ai/infra/authUtils';
import { parseSseStream } from '../../nodes/ai/infra/piStream';
import { Streamdown } from '../../../shared/utils/markdown';
import { executeCanvasOp } from './canvasExecutor';

export interface AgentChatPanelProps {
  open: boolean;
  onClose: () => void;
  workspaceId?: string;
}

interface MessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls?: Array<{ id: string; name: string; args?: string; result?: string }>;
  isStreaming?: boolean;
}

const QUICK_PROMPTS = [
  '帮我做一张图书推荐卡片',
  '把上传的图片变成水墨画风格',
  '我想申请定制一个写七言绝句的大模型节点',
];

export const AgentChatPanel: React.FC<AgentChatPanelProps> = ({
  open,
  onClose,
  workspaceId = 'canvas-agent_default',
}) => {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [reasoningExpanded, setReasoningExpanded] = useState<Record<string, boolean>>({});
  const [pendingDialog, setPendingDialog] = useState<{
    id: string;
    title: string;
    message?: string;
    options?: string[];
  } | null>(null);
  const [showQuickPrompts, setShowQuickPrompts] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 滚动到底部
  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isStreaming, open]);

  // 打开时自动聚焦输入框
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  // 发送消息
  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || inputValue).trim();
    if (!text || isStreaming) return;

    setInputValue('');
    if (inputRef.current) {
      inputRef.current.style.height = '36px';
    }
    const userMsgId = `user_${Date.now()}`;
    const assistantMsgId = `assistant_${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: text },
      { id: assistantMsgId, role: 'assistant', content: '', reasoning: '', isStreaming: true, toolCalls: [] },
    ]);

    setIsStreaming(true);
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
          workspace_id: workspaceId,
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
          case 'content_delta': {
            if (evt.delta) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, content: m.content + evt.delta } : m
                )
              );
            }
            break;
          }

          case 'reasoning_delta': {
            if (evt.delta) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, reasoning: (m.reasoning || '') + evt.delta } : m
                )
              );
            }
            break;
          }

          case 'tool_call': {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      toolCalls: [
                        ...(m.toolCalls || []),
                        { id: evt.id, name: evt.name, args: evt.arguments },
                      ],
                    }
                  : m
              )
            );
            break;
          }

          case 'tool_result': {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      toolCalls: (m.toolCalls || []).map((t) =>
                        t.id === evt.id ? { ...t, result: evt.result } : t
                      ),
                    }
                  : m
              )
            );
            break;
          }

          case 'extension_ui_request': {
            // 核心设计：拦截 CANVAS_OP: 自动在画布执行
            if (evt.title?.startsWith('CANVAS_OP:')) {
              const op = evt.title.slice('CANVAS_OP:'.length);
              let params: Record<string, unknown> = {};
              try {
                params = evt.options?.[0] ? JSON.parse(evt.options[0]) : {};
              } catch {
                /* ignore */
              }
              const result = executeCanvasOp(op, params);

              // 自动写回 UI 响应
              fetch('/api/modules/bookplate/canvas-agent/ui-response', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({
                  workspace_id: workspaceId,
                  id: evt.id,
                  answer: JSON.stringify(result),
                }),
              }).catch(console.error);
            } else {
              // 普通交互弹层（用户确认 / 选择）
              setPendingDialog({
                id: evt.id,
                title: evt.title || '请选择',
                message: evt.message,
                options: evt.options,
              });
            }
            break;
          }

          case 'error': {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: m.content
                        ? `${m.content}\n\n> ⚠️ **执行异常**: ${evt.message}`
                        : `> ⚠️ **执行失败**: ${evt.message}`,
                    }
                  : m
              )
            );
            break;
          }
        }
      }
    } catch (err: any) {
      if (!controller.signal.aborted) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: m.content
                    ? `${m.content}\n\n> ⚠️ **连接中断**: ${err.message || '网络连接异常'}`
                    : `> ⚠️ **发送失败**: ${err.message || '网络连接异常'}`,
                }
              : m
          )
        );
      }
    } finally {
      setIsStreaming(false);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsgId ? { ...m, isStreaming: false } : m))
      );
      abortControllerRef.current = null;
    }
  };

  // 停止生成
  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
      setMessages((prev) =>
        prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
      );
    }
  };

  // 响应普通 UI 弹窗
  const handleDialogAnswer = async (answer: string) => {
    if (!pendingDialog) return;
    const dialogId = pendingDialog.id;
    setPendingDialog(null);

    await fetch('/api/modules/bookplate/canvas-agent/ui-response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        workspace_id: workspaceId,
        id: dialogId,
        answer,
      }),
    }).catch(console.error);
  };

  // 清空会话
  const handleClear = async () => {
    if (window.confirm('确定要清空与画板助手的对话历史吗？')) {
      handleStop();
      setMessages([]);
      setPendingDialog(null);
      await fetch('/api/modules/bookplate/canvas-agent/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ workspace_id: workspaceId }),
      }).catch(console.error);
    }
  };

  // 格式化工具名称展示
  const renderToolBadge = (tool: { id: string; name: string; args?: string; result?: string }) => {
    let label = tool.name;
    let icon = '🔧';
    if (tool.name === 'canvas_create_node') {
      icon = '🎨';
      label = '创建节点';
      try {
        const parsed = JSON.parse(tool.args || '{}');
        if (parsed.type) label = `创建节点: ${parsed.type}`;
      } catch {
        /* ignore */
      }
    } else if (tool.name === 'canvas_connect_nodes') {
      icon = '🔗';
      label = '连接连线';
    } else if (tool.name === 'canvas_send_feedback') {
      icon = '📨';
      label = '推送企业微信反馈';
    } else if (tool.name === 'canvas_get_presets') {
      icon = '🔍';
      label = '查询效果预设';
    }

    return (
      <div
        key={tool.id}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-sans bg-paper-grid/30 border border-paper-grid text-ink-light my-1"
      >
        <span>{icon}</span>
        <span className="font-medium text-ink">{label}</span>
        {tool.result ? (
          <CheckCircle2 size={12} className="text-emerald-500 ml-1 shrink-0" />
        ) : (
          <Loader2 size={12} className="text-accent animate-spin ml-1 shrink-0" />
        )}
      </div>
    );
  };

  if (!open) return null;

  return (
    <div
      className="fixed right-4 bottom-24 w-[430px] h-[640px] max-h-[80vh] z-[9985] flex flex-col bg-paper border border-paper-grid rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-right-4 duration-200"
      style={{ transformOrigin: 'bottom right' }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 1. 顶栏 */}
      <div className="px-4 py-3 border-b border-paper-grid bg-paper/90 backdrop-blur-sm flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600">
            <Bot size={17} />
          </div>
          <div>
            <h3 className="text-sm font-serif font-bold text-ink leading-tight">Canvas Agent</h3>
            <span className="text-[10px] text-ink-faint font-sans flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              智能画布助手 · 连线与反馈
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleClear}
            title="清空对话"
            className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-paper-grid/30 active:scale-95 transition-colors"
          >
            <Trash2 size={14} />
          </button>
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

      {/* 2. 消息流视口 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 font-sans text-xs">
        {messages.length === 0 && (
          <div className="py-6 flex flex-col items-center text-center space-y-3 animate-in fade-in duration-200">
            <div className="w-12 h-12 rounded-full bg-accent/10 text-accent flex items-center justify-center shadow-xs">
              <Sparkles size={22} />
            </div>
            <div>
              <p className="text-sm font-bold text-ink font-serif">你好！我是智能画板助手</p>
              <p className="text-xs text-ink-faint mt-1 max-w-[280px] leading-relaxed">
                告诉我你的创作想法，我能为你推荐内置节点、配置参数并自动创建连线；遇到特殊 AI 需求也能帮你直发企业微信！
              </p>
            </div>
            <div className="w-full pt-2 flex flex-col gap-1.5">
              <span className="text-[11px] text-ink-faint self-start font-medium px-1">你可以试试：</span>
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

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            {msg.role === 'user' ? (
              <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-tr-xs bg-accent text-paper shadow-xs leading-relaxed text-xs">
                {msg.content}
              </div>
            ) : (
              <div className="max-w-[95%] space-y-2">
                {/* 思考过程折叠块 */}
                {msg.reasoning && (
                  <div className="rounded-lg border border-paper-grid/70 bg-paper-grid/10 overflow-hidden text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        setReasoningExpanded((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))
                      }
                      className="w-full px-2.5 py-1.5 flex items-center justify-between text-ink-faint hover:text-ink transition-colors"
                    >
                      <span className="flex items-center gap-1.5 font-medium">
                        <Sparkles size={12} className="text-accent" />
                        思考过程
                      </span>
                      {reasoningExpanded[msg.id] ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                    {reasoningExpanded[msg.id] && (
                      <div className="px-3 py-2 border-t border-paper-grid/50 text-ink-faint text-[11px] leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {msg.reasoning}
                      </div>
                    )}
                  </div>
                )}

                {/* 工具执行标签 */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {msg.toolCalls.map(renderToolBadge)}
                  </div>
                )}

                {/* 消息正文 */}
                {msg.content ? (
                  <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-xs bg-paper-grid/20 border border-paper-grid/60 text-ink leading-relaxed shadow-xs">
                    <Streamdown>{msg.content}</Streamdown>
                  </div>
                ) : (
                  msg.isStreaming &&
                  (!msg.toolCalls || msg.toolCalls.length === 0) && (
                    <div className="flex items-center gap-1.5 text-ink-faint py-1 px-2 text-xs">
                      <Loader2 size={13} className="animate-spin text-accent" />
                      <span>正在规划并分析中...</span>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        ))}

        {/* 交互 Dialog 请求卡片 */}
        {pendingDialog && (
          <div className="p-3.5 rounded-xl border border-accent/40 bg-accent/5 space-y-2.5 animate-in fade-in">
            <div className="flex items-start gap-2">
              <AlertCircle size={15} className="text-accent mt-0.5 shrink-0" />
              <div>
                <h4 className="font-bold text-xs text-ink">{pendingDialog.title}</h4>
                {pendingDialog.message && (
                  <p className="text-[11px] text-ink-light mt-0.5">{pendingDialog.message}</p>
                )}
              </div>
            </div>
            {pendingDialog.options && pendingDialog.options.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {pendingDialog.options.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleDialogAnswer(opt)}
                    className="px-3 py-1 rounded-lg text-xs font-medium bg-paper border border-paper-grid hover:border-accent hover:text-accent active:scale-95 transition-all shadow-xs"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleDialogAnswer('yes')}
                  className="px-3 py-1 rounded-lg text-xs font-medium bg-accent text-paper hover:bg-accent/90 active:scale-95 transition-all"
                >
                  确认
                </button>
                <button
                  type="button"
                  onClick={() => handleDialogAnswer('no')}
                  className="px-3 py-1 rounded-lg text-xs font-medium bg-paper border border-paper-grid hover:bg-paper-grid/20 active:scale-95 transition-all"
                >
                  取消
                </button>
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 3. 输入控制栏（对齐画板 Chat 节点经典设计） */}
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
            disabled={isStreaming}
            aria-label="快捷创作灵感"
            title="快捷创作灵感"
            className="flex shrink-0 items-center justify-center w-9 h-9 rounded-lg border border-paper-grid/70 text-ink-faint hover:text-accent hover:border-accent/40 hover:bg-accent/5 active:scale-[0.96] transition-[color,background-color,border-color,transform] duration-150 ease-out disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Paperclip size={15} strokeWidth={2} />
          </button>

          {/* 中间输入框：独立圆角边框，自适应高度 */}
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
              placeholder={isStreaming ? '回复生成中…' : '输入消息，Enter 发送，Shift+Enter 换行'}
              disabled={isStreaming}
              className="relative z-10 block w-full min-h-[36px] max-h-32 overflow-y-auto resize-none rounded-lg border border-paper-grid/70 bg-transparent px-3 py-1.5 text-sm font-sans text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-[border-color,box-shadow] duration-150 disabled:opacity-60 [text-wrap:pretty]"
            />
          </div>

          {/* 右侧操作按钮：发送 / 停止生成 */}
          {isStreaming ? (
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
  );
};
