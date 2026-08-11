import React, { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Eraser, Link2, MessageSquare, Send, Copy, Check, Loader2, Square, RefreshCw, ChevronUp, ChevronDown, Lock } from 'lucide-react';
import { Streamdown, cjk, code } from '../../../platform/utils/markdown';
import { normalizeMarkdown } from '../../../platform/utils/normalizeMarkdown';
import { CanvasNode } from '../../../platform/components/node/CanvasNode';
import { NodeActionBar } from '../../../platform/components/node/NodeActionBar';
import { AgentActivity } from '../../../platform/components/agent/AgentActivity';
import { Toggle } from '../../../platform/components/ui/Toggle';
import type { ChatMessage, ChatNodeSettings } from '../../../platform/types';
import { NODE_COLORS } from '../nodeTypes';

const STYLE_INJECTIONS = `
@keyframes msg-enter {
  0% { opacity: 0; transform: translateY(8px); }
  100% { opacity: 1; transform: translateY(0); }
}
.msg-enter-anim { animation: msg-enter 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
@keyframes pop-enter {
  0% { opacity: 0; transform: scale(0.96); transform-origin: bottom right; }
  100% { opacity: 1; transform: scale(1); transform-origin: bottom right; }
}
.pop-enter-anim { animation: pop-enter 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
`;

export interface ChatNodeProps {
  id: string;
  initialX?: number;
  initialY?: number;
  title?: string;
  /** 对话消息列表（含正在流式的最后一条 assistant 消息） */
  messages?: ChatMessage[];
  /** Agent 名称（该节点配置为 agent 模式时展示） */
  agentName?: string;
  isGenerating: boolean;
  error?: string | null;
  /** 上下文加载设置 */
  settings: ChatNodeSettings;
  onRemove?: (id: string) => void;
  /** 发送一条用户消息（多轮对话） */
  onSend?: (id: string, text: string) => void;
  /** 停止当前生成（点击后中止本次调用） */
  onStop?: (id: string) => void;
  /** 重试最后一轮（失败 / 中断后重新发送调用） */
  onRetry?: (id: string) => void;
  /** 更新上下文加载设置 */
  onUpdateSettings?: (id: string, settings: ChatNodeSettings) => void;
  /** 清空当前对话 */
  onClearChat?: (id: string) => void;
  onPositionChange?: (id: string, x: number, y: number) => void;
  onSizeChange?: (id: string, width: number, height: number) => void;
  onDrag?: (id: string, x: number, y: number) => void;
  /** 卡片底部「+」插槽 */
  footer?: React.ReactNode;
  /** 根节点右键菜单回调 */
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** 所属自定义分组（配置了分组时在标题旁展示小标签） */
  group?: string;
  /** 是否有下级节点关联 */
  hasDownstream?: boolean;
  /** 标题旁的类型不匹配提示 */
  mismatchBadge?: string | null;
}

const ChatNodeInner: React.FC<ChatNodeProps> = ({
  id,
  initialX,
  initialY,
  title,
  messages = [],
  agentName,
  isGenerating,
  error,
  settings,
  onRemove,
  onSend,
  onStop,
  onRetry,
  onUpdateSettings,
  onClearChat,
  onPositionChange,
  onSizeChange,
  onDrag,
  footer,
  onContextMenu,
  group,
  hasDownstream,
  mismatchBadge,
}) => {
  const [draft, setDraft] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 是否「贴底」：贴底时新消息自动滚动到底部，向上翻阅历史时不打扰
  const stickBottomRef = useRef(true);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const scrollRafRef = useRef<number | null>(null);

  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  const handleCopy = (content: string, idx: number) => {
    navigator.clipboard.writeText(content);
    setCopiedId(idx);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDownload = () => {
    if (messages.length === 0) return;
    
    let md = `# ${title || 'AI 对话记录'}\n\n`;
    messages.forEach(msg => {
      if (msg.role === 'user') {
        md += `**You**:\n${msg.content}\n\n`;
      } else {
        md += `**AI**:\n${msg.content}\n\n`;
      }
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'chat'}_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '36px';
      if (draft) {
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      }
    }
  }, [draft]);

  const handleScroll = () => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) {
        const { scrollTop, scrollHeight, clientHeight } = el;
        stickBottomRef.current = scrollHeight - scrollTop - clientHeight < 40;
        setShowScrollTop(scrollTop > 200);
        setShowScrollBottom(scrollHeight - scrollTop - clientHeight > 100);
      }
      scrollRafRef.current = null;
    });
  };

  // 新消息 / 流式增量到达时自动滚到底（贴底状态下）
  useEffect(() => {
    const el = listRef.current;
    if (el) {
      if (stickBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
      handleScroll();
    }
  }, [messages]);

  // 设置弹层：点击外部 / Esc 关闭
  useEffect(() => {
    if (!settingsOpen) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (
        settingsBtnRef.current?.contains(e.target as Node) ||
        popupRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setSettingsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [settingsOpen]);

  const toggleSettings = () => {
    if (!settingsOpen && settingsBtnRef.current) {
      const rect = settingsBtnRef.current.getBoundingClientRect();
      setCoords({
        x: window.innerWidth - rect.right,
        y: window.innerHeight - rect.top + 8,
      });
    }
    setSettingsOpen((v) => !v);
  };

  const handleSend = () => {
    const text = draft.trim();
    if (!text || isGenerating) return;
    onSend?.(id, text);
    setDraft('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderActionBar = () => {
    return (
      <NodeActionBar>
        {messages.length > 0 && (
          <NodeActionBar.Download onClick={handleDownload} disabled={isGenerating} />
        )}
        <NodeActionBar.SettingsTrigger
          ref={settingsBtnRef}
          onClick={toggleSettings}
          disabled={isGenerating}
          active={messages.length > 0}
          tooltip={messages.length > 0 ? "上下文设置 (已锁定)" : "上下文设置"}
        />
        {messages.length > 0 && (
          <NodeActionBar.Eraser
            onClick={() => onClearChat?.(id)}
            disabled={isGenerating || hasDownstream}
            hasDownstream={hasDownstream}
          />
        )}
      </NodeActionBar>
    );
  };

  const renderMessage = (msg: ChatMessage, idx: number) => {
    if (msg.role === 'user') {
      return (
        <div key={idx} className="flex flex-col items-end gap-0.5 msg-enter-anim">
          {msg.context && (
            <span className="text-[10px] text-ink-faint font-sans flex items-center gap-1">
              <Link2 size={9} strokeWidth={2} />
              已附带上下文
            </span>
          )}
          <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm bg-accent text-white text-[13px] leading-relaxed whitespace-pre-wrap break-words font-sans shadow-sm">
            {msg.content}
          </div>
        </div>
      );
    }
    const isThinking = msg.streaming && !msg.content;

    return (
      <div key={idx} className="flex flex-col items-start gap-1 relative group msg-enter-anim">
        {msg.agentSteps && msg.agentSteps.length > 0 && (
          <div className="w-full mb-1">
            <AgentActivity
              steps={msg.agentSteps}
              agentName={agentName}
              running={!!msg.streaming}
            />
          </div>
        )}
        <div className="flex items-end w-full min-w-0">
          <div className={`max-w-[92%] px-3 py-2 rounded-2xl rounded-bl-sm bg-paper-grid/25 border border-paper-grid/60 text-[13px] leading-relaxed font-sans min-w-0 ${isThinking ? 'flex items-center gap-1.5 text-ink-faint' : ''}`}>
            {isThinking ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>思考中...</span>
              </>
            ) : (
              <Streamdown
                plugins={{ cjk, code }}
                isAnimating={!!msg.streaming}
                caret="block"
                linkSafety={{ enabled: false }}
              >
                {normalizeMarkdown(msg.content) || (msg.interrupted ? '已中断' : '…')}
              </Streamdown>
            )}
          </div>
          {!msg.streaming && (
            <div className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                onClick={() => handleCopy(msg.content, idx)}
                className="p-1.5 text-ink-faint hover:text-ink hover:bg-paper-grid/40 rounded-md transition-colors"
                title="复制回复"
              >
                {copiedId === idx ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          )}
        </div>
        {/* 被用户停止的回复：展示「重试」入口（仅当该消息是最后一条时，重试目标 = 本轮） */}
        {msg.interrupted && !msg.streaming && idx === messages.length - 1 && (
          <div className="flex items-center gap-1.5 text-[10px] font-sans text-ink-faint pl-1">
            <span className="flex items-center gap-1">
              <Square size={8} strokeWidth={2} fill="currentColor" />
              已中断
            </span>
            <button
              onClick={() => onRetry?.(id)}
              title="重新发送该轮对话"
              className="flex items-center gap-1 rounded-md border border-paper-grid px-1.5 py-0.5 text-ink-light hover:text-accent hover:border-accent/40 hover:bg-accent/5 active:scale-95 transition"
            >
              <RefreshCw size={9} strokeWidth={2} />
              重试
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <CanvasNode
      id={id}
      initialX={initialX}
      initialY={initialY}
      title={title || 'AI 对话'}
      dotColor={NODE_COLORS.chat}
      onRemove={() => onRemove?.(id)}
      onPositionChange={onPositionChange}
      onSizeChange={onSizeChange}
      onDrag={onDrag}
      onContextMenu={onContextMenu}
      resizable
      defaultSize={{ width: 420, height: 560 }}
      className={`transition-[box-shadow,border-color,opacity] duration-200 ${isGenerating && messages.length === 0 ? 'border-transparent' : ''}`}
      showLeftAnchor={true}
      showRightAnchor={true}
      footer={footer}
      groupBadge={group}
      mismatchBadge={mismatchBadge}
      actionBar={renderActionBar()}
    >
      <style dangerouslySetInnerHTML={{ __html: STYLE_INJECTIONS }} />
      <div className="relative h-full flex flex-col flex-1 min-h-0">
        {error && !isGenerating && (
          <div className="mb-2 p-2.5 rounded-md border border-error/20 bg-error/5 flex items-start gap-2">
            <AlertTriangle size={13} strokeWidth={2} className="text-error shrink-0 mt-0.5" />
            <p className="flex-1 min-w-0 text-[11px] text-error/90 leading-relaxed break-words font-sans">
              {error}
            </p>
            {/* 无用户消息时没有可重试的轮次（如异常初始状态），隐藏重试避免空转 */}
            {messages.some((m) => m.role === 'user') && (
              <button
                onClick={() => onRetry?.(id)}
                title="重新发送最后一轮对话"
                className="shrink-0 flex items-center gap-1 rounded-md border border-error/25 px-2 py-1 text-[10px] font-sans text-error hover:bg-error/10 active:scale-95 transition"
              >
                <RefreshCw size={11} strokeWidth={2} />
                重试
              </button>
            )}
          </div>
        )}

        {/* 消息列表 */}
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-2.5 pr-0.5"
        >
          {messages.length === 0 ? (
            <div className="h-full min-h-[120px] flex flex-col items-center justify-center gap-2 text-center px-4">
              <MessageSquare size={22} strokeWidth={1.25} className="text-ink-faint/70" />
              <p className="text-xs text-ink-faint font-sans leading-relaxed">
                输入消息开始多轮对话
                <br />
                支持绑定大模型或 FastClaw Agent（工具调用）
              </p>
            </div>
          ) : (
            messages.map(renderMessage)
          )}
        </div>

        {/* 悬浮滚动按钮 */}
        <div className="absolute right-4 bottom-14 flex flex-col gap-2 z-20 pointer-events-none">
          <div className={`transition-all duration-300 ${showScrollTop ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
            <button
              onClick={() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
              className="pointer-events-auto flex items-center justify-center w-7 h-7 rounded-full bg-paper/90 border border-paper-grid/60 shadow-sm text-ink-faint hover:text-ink hover:bg-paper-grid hover:shadow backdrop-blur-md transition-all active:scale-95"
              title="回到顶部"
            >
              <ChevronUp size={16} strokeWidth={2} />
            </button>
          </div>
          <div className={`transition-all duration-300 ${showScrollBottom ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}>
            <button
              onClick={() => listRef.current?.scrollTo({ top: listRef.current?.scrollHeight, behavior: 'smooth' })}
              className="pointer-events-auto flex items-center justify-center w-7 h-7 rounded-full bg-paper/90 border border-paper-grid/60 shadow-sm text-ink-faint hover:text-ink hover:bg-paper-grid hover:shadow backdrop-blur-md transition-all active:scale-95"
              title="回到底部"
            >
              <ChevronDown size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* 输入区（当前仅支持文本，后续可扩展图片 / 本地文档上传） */}
        <div className="shrink-0 mt-2 pt-2 border-t border-solid border-black/5 dark:border-white/5">
          <div className="flex items-end gap-1.5">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isGenerating}
              rows={1}
              placeholder={isGenerating ? '回复生成中…' : '输入消息，Enter 发送，Shift+Enter 换行'}
              className="flex-1 min-w-0 min-h-[36px] max-h-32 overflow-y-auto resize-none rounded-lg border border-dashed border-paper-grid bg-node-bg px-3 py-1.5 text-[13px] font-sans text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors disabled:opacity-60"
            />
            {isGenerating ? (
              <button
                onClick={() => onStop?.(id)}
                title="停止生成"
                className="flex shrink-0 items-center justify-center w-9 h-9 rounded-lg border border-error/30 bg-error/5 text-error hover:bg-error/10 active:scale-95 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
              >
                <Square size={15} strokeWidth={2} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!draft.trim()}
                title="发送 (Enter)"
                className="flex items-center justify-center w-9 h-9 rounded-lg bg-accent text-white shadow-sm hover:bg-accent/90 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Send size={15} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 设置弹层（portal 定位，避免被节点滚动容器裁剪） */}
      {settingsOpen && typeof document !== 'undefined' && createPortal(
        <div ref={popupRef} className="fixed z-[9999]" style={{ right: coords.x, bottom: coords.y }}>
          <div className="w-64 pop-enter-anim">
            <div className="bg-paper border border-paper-grid rounded-xl shadow-xl overflow-hidden">
              <div className="px-3 py-2.5 border-b border-dashed border-paper-grid bg-paper-grid/10">
                <p className="text-xs font-sans font-medium text-ink-light">上下文设置</p>
              </div>
              <div className="p-3 space-y-3">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-sans text-ink">加载图书元数据</p>
                    <p className="text-[10px] text-ink-faint font-sans mt-0.5 leading-snug">
                      连线上游的图书元数据（无连线时取画布根节点）
                    </p>
                  </div>
                  <Toggle
                    checked={settings.includeBook}
                    onChange={(v) => onUpdateSettings?.(id, { ...settings, includeBook: v })}
                    label="加载图书元数据"
                    disabled={messages.length > 0}
                  />
                </div>
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-sans text-ink">加载上一级节点内容</p>
                    <p className="text-[10px] text-ink-faint font-sans mt-0.5 leading-snug">
                      紧随的上级节点输出（支持对话节点串联）
                    </p>
                  </div>
                  <Toggle
                    checked={settings.includeUpstream}
                    onChange={(v) => onUpdateSettings?.(id, { ...settings, includeUpstream: v })}
                    label="加载上一级节点内容"
                    disabled={messages.length > 0}
                  />
                </div>
                {messages.length > 0 ? (
                  <div className="flex items-start gap-1.5 p-2 rounded-md bg-paper-grid/40 border border-paper-grid text-ink-light">
                    <Lock size={12} strokeWidth={1.5} className="shrink-0 mt-0.5" />
                    <p className="text-[10px] font-sans leading-snug flex-1">
                      对话已开始，上下文配置已锁定。如需修改，请先清空对话。
                    </p>
                  </div>
                ) : (
                  <p className="text-[10px] text-ink-faint font-sans leading-snug">
                    上下文在首轮自动注入并随消息历史保持；清空对话后可重新注入。
                  </p>
                )}
                {messages.length > 0 && (
                  <div title={hasDownstream ? "已连接下级节点，无法清空对话" : undefined}>
                    <button
                      onClick={() => {
                        setSettingsOpen(false);
                        onClearChat?.(id);
                      }}
                      disabled={hasDownstream}
                      className={`w-full flex items-center justify-center gap-1.5 rounded-md border border-dashed py-1.5 text-[11px] font-sans transition ${
                        hasDownstream
                          ? 'border-paper-grid/50 text-ink-faint/50 bg-paper-grid/10 cursor-not-allowed'
                          : 'border-error/30 text-error/90 hover:bg-error/5 active:scale-[0.98]'
                      }`}
                    >
                      <Eraser size={11} strokeWidth={2} />
                      清空对话（清空后重新注入上下文）
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </CanvasNode>
  );
};

export const ChatNode = memo(ChatNodeInner);
ChatNode.displayName = 'ChatNode';
export default ChatNode;
