import { memo, useEffect, useRef, useState } from 'react';
import { Bot, Brain, ChevronDown, Loader2, TerminalSquare, Wrench } from 'lucide-react';
import type { AgentStep } from '../../../../shared/types';

const TRUNCATE_STEP_TEXT = 300;
const truncateStepText = (s: string) => (s.length > TRUNCATE_STEP_TEXT ? s.slice(0, TRUNCATE_STEP_TEXT) + '…' : s);

/**
 * 助手消息一体化步骤卡片（思考过程 + 工具执行步骤）：
 * - 将同一步骤内的思考过程与 Agent 工具执行日志深度融合成单个步骤折叠卡片；
 * - 顶部显示清晰的步骤序号（如「步骤 1 · Agent 思考与执行」）与工具步数；
 * - 思考阶段实时展开，正文出现或执行完毕后平滑收起；
 * - 支持点击一键展开/收起，内部清晰分栏展示思考推理与工具明细。
 */
export const StepActivityCard: React.FC<{
  stepNumber?: number;
  reasoning?: string;
  agentSteps?: AgentStep[];
  agentName?: string;
  streaming?: boolean;
  hasContent?: boolean;
  kaomoji?: string;
}> = memo(({ stepNumber, reasoning, agentSteps = [], agentName, streaming = false, hasContent = false, kaomoji }) => {
  const hasReasoning = Boolean(reasoning && reasoning.trim().length > 0);
  const hasSteps = agentSteps.length > 0;

  // 展开状态逻辑：若用户手动开合则尊重用户选择；若未手动操作，流式且无正文时自动展开，有正文后自动收起
  const [userToggledOpen, setUserToggledOpen] = useState<boolean | null>(null);
  const sawContentRef = useRef(hasContent);

  // 正文首次出现时自动平滑收起（仅一次）
  useEffect(() => {
    if (hasContent && !sawContentRef.current) {
      sawContentRef.current = true;
      setUserToggledOpen(false);
    }
  }, [hasContent]);

  if (!hasReasoning && !hasSteps && !streaming) return null;

  const open = userToggledOpen ?? (streaming && !hasContent);

  const toggleOpen = () => setUserToggledOpen((v) => (v === null ? !open : !v));

  // 摘要预览文本
  const tailReasoning = hasReasoning ? reasoning!.slice(-40).replace(/\n/g, ' ') : '';
  const lastStepName = hasSteps ? agentSteps[agentSteps.length - 1]?.name : '';
  const previewText = tailReasoning || (lastStepName ? `调用工具 ${lastStepName}` : '');

  // 步骤标题生成
  const stepPrefix = stepNumber ? `步骤 ${stepNumber}` : 'Agent 思考与执行';
  const mainTitle = agentName
    ? `${stepPrefix} · ${agentName}`
    : `${stepPrefix} · ${hasReasoning && hasSteps ? '思考与执行' : hasReasoning ? '思考过程' : '运行过程'}`;

  const renderAgentStep = (step: AgentStep, idx: number) => {
    switch (step.type) {
      case 'agent_tool_call':
        return (
          <div key={idx} className="px-2.5 py-1.5 border-b border-dashed border-paper-grid/40 last:border-0">
            <p className="flex items-center gap-1.5 text-[10.5px] font-mono text-accent">
              <Wrench size={10.5} strokeWidth={1.75} className="shrink-0" />
              <span>调用工具</span>
              <span className="font-semibold text-ink-light bg-accent/10 px-1 py-0.5 rounded text-[10px]">
                {step.name || '未知工具'}
              </span>
            </p>
            {step.arguments ? (
              <pre className="mt-1 text-[9.5px] leading-snug text-ink-light font-mono whitespace-pre-wrap break-words max-h-24 overflow-y-auto custom-scrollbar bg-paper-grid/20 p-1.5 rounded select-text">
                {truncateStepText(step.arguments)}
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
                {truncateStepText(step.result)}
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

  return (
    <div className="w-full mb-1 rounded-lg border border-dashed border-paper-grid/80 bg-paper-grid/15 overflow-hidden transition-all duration-200">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-left text-[10px] text-ink-faint hover:text-ink-light font-sans transition-[color,background-color,transform] duration-150 ease-out overflow-hidden select-none active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        title={open ? '收起步骤详情' : '展开步骤详情'}
      >
        <Bot size={11} strokeWidth={1.75} className={open ? 'text-accent shrink-0' : 'shrink-0'} />
        <span className={`shrink-0 ${open ? 'text-ink-light font-medium' : ''}`}>
          {mainTitle}
        </span>

        {!open && previewText && (
          <span className="flex-1 min-w-0 mx-1 overflow-hidden whitespace-nowrap text-right text-ink-faint/70 select-none truncate text-[9.5px]">
            {previewText}
          </span>
        )}

        <span className={`flex items-center gap-1 shrink-0 ${open || !previewText ? 'ml-auto' : ''}`}>
          {streaming && <Loader2 size={10} className="animate-spin text-accent shrink-0" />}
          {hasSteps && (
            <span className="text-[9.5px] font-mono tabular-nums text-ink-faint bg-paper-grid/30 px-1 py-0.2 rounded">
              {agentSteps.length} 步
            </span>
          )}
          <ChevronDown
            size={11}
            strokeWidth={2}
            className={`shrink-0 transition-transform duration-200 ease-out ${open ? 'rotate-180 text-accent' : ''}`}
          />
        </span>
      </button>

      {/* grid-rows 0fr/1fr 过渡：折叠/展开平滑动画 */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-dashed border-paper-grid/50">
            {/* 思考推理板块 */}
            {hasReasoning && (
              <div className="px-2.5 pt-2 pb-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-sans font-medium text-ink-faint mb-1">
                  <Brain size={10.5} strokeWidth={1.75} className="text-accent shrink-0" />
                  <span>思考推理</span>
                  {streaming && !hasContent && kaomoji && (
                    <span className="px-1.5 py-0.5 rounded-full bg-accent/15 border border-accent/25 text-[8.5px] leading-tight text-accent animate-pulse shadow-[0_0_6px_rgba(var(--color-accent),0.25)]">
                      {kaomoji}
                    </span>
                  )}
                </div>
                <pre className="text-[10.5px] text-ink-light font-sans whitespace-pre-wrap leading-relaxed max-h-44 overflow-y-auto custom-scrollbar select-text bg-paper-grid/10 p-2 rounded border border-paper-grid/30">
                  {reasoning}
                </pre>
              </div>
            )}

            {/* 分隔线 */}
            {hasReasoning && hasSteps && (
              <div className="border-t border-dashed border-paper-grid/30 mx-2.5 my-1" />
            )}

            {/* 工具执行步骤板块 */}
            {hasSteps && (
              <div className="px-2.5 pt-1.5 pb-2">
                <div className="flex items-center gap-1.5 text-[10px] font-sans font-medium text-ink-faint mb-1">
                  <Wrench size={10.5} strokeWidth={1.75} className="text-accent shrink-0" />
                  <span>工具执行明细</span>
                  <span className="text-[9.5px] font-mono tabular-nums text-ink-faint">({agentSteps.length} 步)</span>
                </div>
                <div className="max-h-48 overflow-y-auto custom-scrollbar rounded border border-paper-grid/30 bg-paper-grid/10">
                  {agentSteps.map(renderAgentStep)}
                  {streaming && (
                    <div className="px-2.5 py-1.5 flex items-center gap-1.5 text-[10px] text-accent bg-accent/5 font-sans">
                      <Loader2 size={10} strokeWidth={2} className="animate-spin shrink-0" />
                      {kaomoji && (
                        <span className="px-1 py-0.2 rounded-full bg-accent/15 border border-accent/25 text-[8.5px] leading-tight">
                          {kaomoji}
                        </span>
                      )}
                      <span>Agent 执行中…</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
StepActivityCard.displayName = 'StepActivityCard';