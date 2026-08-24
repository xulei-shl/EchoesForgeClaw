import React, { memo, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, Wrench, Loader2, TerminalSquare } from 'lucide-react';
import type { AgentStep } from '../../types';

/** 截断过长的参数/结果文本，避免节点被撑爆 */
const TRUNCATE = 300;

const truncate = (s: string) => (s.length > TRUNCATE ? s.slice(0, TRUNCATE) + '…' : s);

export interface AgentActivityProps {
  /** 中间步骤列表（按时间序） */
  steps?: AgentStep[];
  /** Agent 名称（可选，展示在标题上） */
  agentName?: string;
  /** 是否正在运行（末尾显示动画） */
  running?: boolean;
}

const AgentActivityInner: React.FC<AgentActivityProps> = ({ steps = [], agentName, running }) => {
  // 运行中默认展开（工具调用 / 结果实时可见）；用户手动开合后尊重用户选择；
  // 结束后未手动操作则收起为摘要条，避免撑爆节点
  const [userToggledOpen, setUserToggledOpen] = useState<boolean | null>(null);
  const open = userToggledOpen ?? !!running;

  if (steps.length === 0 && !running) return null;

  const toggleOpen = () => setUserToggledOpen(!open);

  const renderStep = (step: AgentStep, idx: number) => {
    switch (step.type) {
      case 'agent_tool_call':
        return (
          <div key={idx} className="px-3 py-1.5 border-b border-paper-grid/50 last:border-0">
            <p className="flex items-center gap-1.5 text-[11px] font-mono text-accent">
              <Wrench size={11} strokeWidth={1.5} className="shrink-0" />
              调用工具
              <span className="font-semibold">{step.name || '未知工具'}</span>
            </p>
            {step.arguments ? (
              <pre className="mt-1 text-[10px] leading-snug text-ink-light font-mono whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                {truncate(step.arguments)}
              </pre>
            ) : null}
          </div>
        );
      case 'agent_tool_result':
        return (
          <div key={idx} className="px-3 py-1.5 border-b border-paper-grid/50 last:border-0">
            <p className="flex items-center gap-1.5 text-[11px] font-mono text-ink-light">
              <TerminalSquare size={11} strokeWidth={1.5} className="shrink-0" />
              {step.name || '工具'} 返回结果
            </p>
            {step.result ? (
              <pre className="mt-1 text-[10px] leading-snug text-ink-faint font-mono whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                {truncate(step.result)}
              </pre>
            ) : null}
          </div>
        );
      case 'agent_status':
      default:
        return (
          <div key={idx} className="px-3 py-1.5 border-b border-paper-grid/50 last:border-0">
            <p className="text-[11px] leading-snug text-ink-light">
              {step.message || '状态更新'}
            </p>
          </div>
        );
    }
  };

  const count = steps.length;

  return (
    <div className="shrink-0 min-h-0 border-b border-dashed border-paper-grid pb-2 mb-2">
      <button
        onClick={toggleOpen}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-xs text-ink-light hover:text-ink hover:bg-paper-grid/30 transition-colors"
      >
        {open ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
        <Bot size={13} strokeWidth={1.5} className="text-accent" />
        <span className="font-serif">
          Agent 运行过程{agentName ? ` · ${agentName}` : ''}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {running && <Loader2 size={11} strokeWidth={2} className="text-accent animate-spin" />}
          <span className="text-[10px] font-mono text-ink-faint">{count} 步</span>
        </span>
      </button>
      {open && (
        <div className="mt-1 max-h-44 overflow-y-auto rounded-md border border-paper-grid/60 bg-paper-grid/10">
          {steps.map(renderStep)}
          {running && (
            <div className="px-3 py-2 flex items-center gap-1.5 text-[11px] text-accent">
              <Loader2 size={11} strokeWidth={2} className="animate-spin" />
              Agent 执行中...
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const AgentActivity = memo(AgentActivityInner);
export default AgentActivity;
