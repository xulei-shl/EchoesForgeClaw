import React, { memo, useState } from 'react';
import { Bot, ChevronDown, ChevronUp, Wrench, Loader2, TerminalSquare } from 'lucide-react';
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
  /** 默认是否展开（未指定时，运行中展开、结束后折叠） */
  defaultOpen?: boolean;
}

const AgentActivityInner: React.FC<AgentActivityProps> = ({
  steps = [],
  agentName,
  running,
  defaultOpen,
}) => {
  // 展开状态逻辑：若用户手动开合则尊重用户选择；若未手动操作且指定了 defaultOpen 则以 defaultOpen 为准；未指定则运行中展开、结束后折叠
  const [userToggledOpen, setUserToggledOpen] = useState<boolean | null>(null);
  const open = userToggledOpen ?? (defaultOpen !== undefined ? defaultOpen : !!running);

  if (steps.length === 0 && !running) return null;

  const toggleOpen = () => setUserToggledOpen(!open);

  const renderStep = (step: AgentStep, idx: number) => {
    switch (step.type) {
      case 'agent_tool_call':
        return (
          <div key={idx} className="px-2.5 py-1.5 border-b border-dashed border-paper-grid/40 last:border-0">
            <p className="flex items-center gap-1.5 text-[10.5px] font-mono text-accent">
              <Wrench size={10.5} strokeWidth={1.75} className="shrink-0" />
              <span>调用工具</span>
              <span className="font-semibold text-ink-light bg-accent/10 px-1 py-0.5 rounded text-[10px]">{step.name || '未知工具'}</span>
            </p>
            {step.arguments ? (
              <pre className="mt-1 text-[9.5px] leading-snug text-ink-light font-mono whitespace-pre-wrap break-words max-h-24 overflow-y-auto custom-scrollbar bg-paper-grid/20 p-1.5 rounded select-text">
                {truncate(step.arguments)}
              </pre>
            ) : null}
          </div>
        );
      case 'agent_tool_result':
        return (
          <div key={idx} className="px-2.5 py-1.5 border-b border-dashed border-paper-grid/40 last:border-0">
            <p className="flex items-center gap-1.5 text-[10.5px] font-mono text-ink-light">
              <TerminalSquare size={10.5} strokeWidth={1.75} className="shrink-0 text-ink-faint" />
              <span>{step.name || '工具'} 返回结果</span>
            </p>
            {step.result ? (
              <pre className="mt-1 text-[9.5px] leading-snug text-ink-faint font-mono whitespace-pre-wrap break-words max-h-24 overflow-y-auto custom-scrollbar bg-paper-grid/20 p-1.5 rounded select-text">
                {truncate(step.result)}
              </pre>
            ) : null}
          </div>
        );
      case 'agent_status':
      default:
        return (
          <div key={idx} className="px-2.5 py-1.5 border-b border-dashed border-paper-grid/40 last:border-0">
            <p className="text-[10px] leading-snug text-ink-light font-sans select-text">
              {step.message || '状态更新'}
            </p>
          </div>
        );
    }
  };

  const count = steps.length;

  return (
    <div className="w-full mb-1 rounded-lg border border-dashed border-paper-grid/80 bg-paper-grid/15 overflow-hidden transition-all duration-200">
      <button
        type="button"
        onClick={toggleOpen}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-left text-[10px] text-ink-faint hover:text-ink-light font-sans transition-colors overflow-hidden select-none active:scale-[0.99]"
        title={open ? '收起 Agent 运行过程' : '展开 Agent 运行过程'}
      >
        <Bot size={11} strokeWidth={1.75} className={open ? 'text-accent shrink-0' : 'shrink-0'} />
        <span className={open ? 'text-ink-light shrink-0' : 'shrink-0'}>
          Agent 运行过程{agentName ? ` · ${agentName}` : ''}
        </span>
        <span className="ml-auto flex items-center gap-1 shrink-0">
          {running && <Loader2 size={10} strokeWidth={2} className="text-accent animate-spin" />}
          <span className="text-[9.5px] font-mono tabular-nums text-ink-faint">{count} 步</span>
          {open ? (
            <ChevronUp size={11} strokeWidth={2} />
          ) : (
            <ChevronDown size={11} strokeWidth={2} />
          )}
        </span>
      </button>
      {/* grid-rows 0fr/1fr 过渡：折叠/展开平滑动画 */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-dashed border-paper-grid/50 max-h-48 overflow-y-auto custom-scrollbar">
            {steps.map(renderStep)}
            {running && (
              <div className="px-2.5 py-1.5 flex items-center gap-1.5 text-[10px] text-accent bg-accent/5 font-sans">
                <Loader2 size={10} strokeWidth={2} className="animate-spin" />
                <span>Agent 执行中…</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const AgentActivity = memo(AgentActivityInner);
export default AgentActivity;
