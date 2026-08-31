import React, { memo, useState } from 'react';
import { Bot, Check, ChevronDown, ChevronUp, Clock, Loader2, X } from 'lucide-react';
import type { ParsedSubagentRun, SubagentResultRow } from '../utils/subagentParser';

/**
 * 子代理运行卡片（对话流内独立折叠组件，参考 QuestionAnswerBlock 的挂载/样式惯例）。
 *
 * - 数据来自消息自身的 agentSteps（parseSubagentRuns），按对话顺序排列、水合后仍可见；
 * - 折叠交互：单条默认展开，多条默认只展开最后一条（最新运行），其余收起；
 * - 展开区：流式完整结构（details.results 逐行）或水合文本摘要（resultText 回退）。
 */

function fmtTokens(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k`;
  return String(Math.max(0, Math.round(total)));
}

function rowIcon(row: SubagentResultRow): 'ok' | 'err' | 'run' | 'idle' {
  if (row.status === 'running') return 'run';
  if (row.status === 'complete' || row.status === 'completed') return 'ok';
  if (row.status === 'failed' || row.status === 'rejected') return 'err';
  if (row.exitCode !== undefined && row.exitCode !== 0) return 'err';
  if (row.status) return 'idle';
  return 'idle';
}

const ROW_ICON: Record<'ok' | 'err' | 'run' | 'idle', React.ReactNode> = {
  ok: <Check size={11} strokeWidth={2.5} className="text-emerald-500 shrink-0 mt-0.5" />,
  err: <X size={11} strokeWidth={2.5} className="text-error shrink-0 mt-0.5" />,
  run: <Loader2 size={11} className="animate-spin text-accent shrink-0 mt-0.5" />,
  idle: <span className="text-ink-faint shrink-0 mt-0.5">·</span>,
};

function runBadge(run: ParsedSubagentRun): { text: string; tone: 'ok' | 'err' | 'run' } {
  if (!run.hasResult) {
    return { text: run.background ? '后台运行中' : '运行中', tone: 'run' };
  }
  const rows = run.details?.results;
  if (rows && rows.length > 0) {
    const anyErr = rows.some((r) => r.exitCode !== undefined && r.exitCode !== 0);
    const anyRun = rows.some((r) => r.status === 'running');
    if (anyRun) return { text: '运行中', tone: 'run' };
    if (anyErr) return { text: '有失败', tone: 'err' };
    return { text: '完成', tone: 'ok' };
  }
  if (run.background) return { text: '已启动', tone: 'ok' };
  return { text: '完成', tone: 'ok' };
}

const BADGE_TONE: Record<'ok' | 'err' | 'run', string> = {
  ok: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/25',
  err: 'bg-error/10 text-error border-error/25',
  run: 'bg-accent/15 text-accent border-accent/30',
};

function renderRows(run: ParsedSubagentRun): React.ReactNode {
  // 流式完整结构：逐行子代理结果
  if (run.details?.results && run.details.results.length > 0) {
    return (
      <div className="space-y-1">
        {run.details.results.map((row, idx) => {
          const icon = ROW_ICON[rowIcon(row)];
          const agent = row.agent || 'subagent';
          const tokens =
            row.usage && typeof row.usage.total === 'number'
              ? ` · ${fmtTokens(row.usage.total)} tokens`
              : '';
          return (
            <div key={idx} className="flex items-start gap-1.5 text-[11px] font-sans leading-snug">
              {icon}
              <span className="text-ink-light font-mono font-medium">{agent}</span>
              {tokens && <span className="text-ink-faint">{tokens}</span>}
            </div>
          );
        })}
      </div>
    );
  }
  // 水合回退：结果文本摘要（服务端截断后的纯文本）
  if (run.resultText) {
    const preview = run.resultText.split('\n').filter((l) => l.trim()).slice(0, 6).join('\n');
    return (
      <pre className="text-[11px] font-sans text-ink-light whitespace-pre-wrap break-words leading-relaxed max-h-40 overflow-y-auto custom-scrollbar select-text">
        {preview || '（无输出）'}
      </pre>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-sans text-ink-faint">
      <Loader2 size={11} className="animate-spin" />
      等待子代理返回…
    </div>
  );
}

export interface SubagentRunBlockProps {
  run: ParsedSubagentRun;
  /** 默认展开（多卡片同现时仅最后一条传 true） */
  defaultExpanded?: boolean;
}

export const SubagentRunBlock: React.FC<SubagentRunBlockProps> = memo(
  ({ run, defaultExpanded = true }) => {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const badge = runBadge(run);
    const title = run.action ? `子代理 · ${run.agent}（${run.action}）` : `子代理 · ${run.agent}`;

    return (
      <div className="rounded-xl border border-paper-grid bg-paper-grid/15 overflow-hidden shadow-2xs text-xs font-sans msg-enter-anim">
        {/* 头部：可点击折叠触发器 */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-1.5 px-3 py-2 text-left hover:bg-paper-grid/20 transition cursor-pointer"
        >
          <Bot size={13} className="text-accent shrink-0" />
          <span className="font-semibold text-ink truncate">{title}</span>
          {run.background && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium bg-paper-grid/40 text-ink-faint">
              <Clock size={9} /> 后台
            </span>
          )}
          <span
            className={`ml-auto shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border ${BADGE_TONE[badge.tone]}`}
          >
            {badge.tone === 'run' && <Loader2 size={9} className="animate-spin" />}
            {badge.text}
          </span>
          {expanded ? (
            <ChevronUp size={13} className="text-ink-faint shrink-0" />
          ) : (
            <ChevronDown size={13} className="text-ink-faint shrink-0" />
          )}
        </button>

        {/* 展开区 */}
        {expanded && (
          <div className="px-3 pb-2.5 pt-0.5 border-t border-paper-grid/30">{renderRows(run)}</div>
        )}
      </div>
    );
  }
);

SubagentRunBlock.displayName = 'SubagentRunBlock';
export default SubagentRunBlock;
