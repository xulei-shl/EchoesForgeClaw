import { useEffect, useState } from 'react';
import { ChevronDown, Clock, RefreshCw, Send, X } from 'lucide-react';

/** 自动重试横幅数据（Skill Agent 结构化 agent_retry 事件驱动；倒计时在横幅内自走） */
export interface ChatRetryNotice {
  attempt: number;
  maxAttempts: number;
  delaySec: number;
  reason: string;
}

/** 排队消息（流式中发送进入队列，当前轮结束后自动依次发出） */
export interface ChatMessageQueue {
  items: { id: number; text: string; images?: string[] }[];
  onRecall: (id: number) => void;
  onSendNow: (id: number) => void;
}

/** 自动重试横幅：倒计时自走（delaySec 递减），可展开查看原因；借鉴 Proma RetryingNotice。 */
export const RetryNoticeBanner: React.FC<{ notice: ChatRetryNotice }> = ({ notice }) => {
  const [remaining, setRemaining] = useState(notice.delaySec);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setRemaining(notice.delaySec);
    const timer = setInterval(() => {
      setRemaining((v: number) => (v > 0 ? v - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [notice.attempt, notice.delaySec]);
  return (
    <div className="mb-2 p-2 rounded-md border border-accent/25 bg-accent/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left select-none"
        title="点击查看详情"
      >
        <RefreshCw size={12} strokeWidth={2} className="text-accent animate-spin shrink-0" />
        <span className="flex-1 min-w-0 text-[11px] font-sans text-accent/90 leading-snug">
          {notice.reason}，<span className="tabular-nums font-mono font-medium">{remaining}s</span> 后自动重试（第 <span className="tabular-nums font-mono">{notice.attempt}</span>/{notice.maxAttempts || '?'} 次）
        </span>
        <ChevronDown
          size={11}
          strokeWidth={2}
          className={`shrink-0 text-accent/70 transition-transform duration-200 ease-out ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <p className="mt-1.5 pl-[22px] text-[10px] font-sans text-ink-light leading-relaxed break-all select-text">
          上游错误：{notice.reason}。pi 正以指数退避自动重试，期间无需操作；多次失败将以错误横幅提示。
        </p>
      )}
    </div>
  );
};

/** 排队消息行：撤回 / 立即发送（流式中发送的消息先进队列，借鉴 Proma AgentMessageQueue）。 */
export const QueuedMessageRow: React.FC<{
  item: { id: number; text: string; images?: string[] };
  onRecall: (id: number) => void;
  onSendNow: (id: number) => void;
}> = ({ item, onRecall, onSendNow }) => (
  <div className="flex items-center gap-1.5 max-w-full rounded-lg border border-paper-grid bg-paper-grid/20 px-2 py-1 group/queue">
    <Clock size={11} strokeWidth={2} className="text-ink-faint shrink-0" />
    <p className="flex-1 min-w-0 truncate text-[11px] font-sans text-ink-light" title={item.text}>
      {item.text || `图片 ×${item.images?.length ?? 0}`}
    </p>
    {!!item.images?.length && item.text && (
      <span className="shrink-0 text-[9px] font-sans tabular-nums text-ink-faint">+{item.images.length}图</span>
    )}
    <button
      type="button"
      onClick={() => onSendNow(item.id)}
      aria-label="立即发送"
      title="立即发送"
      className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md text-ink-faint hover:text-accent hover:bg-accent/10 active:scale-[0.96] transition-[color,background-color,transform] duration-150 opacity-60 group-hover/queue:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <Send size={11} strokeWidth={2} />
    </button>
    <button
      type="button"
      onClick={() => onRecall(item.id)}
      aria-label="撤回排队消息"
      title="撤回"
      className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md text-ink-faint hover:text-error hover:bg-error/10 active:scale-[0.96] transition-[color,background-color,transform] duration-150 opacity-60 group-hover/queue:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error"
    >
      <X size={11} strokeWidth={2.5} />
    </button>
  </div>
);