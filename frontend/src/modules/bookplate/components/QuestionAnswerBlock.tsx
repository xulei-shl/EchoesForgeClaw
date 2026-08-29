import React, { memo } from 'react';
import { Sparkles, Check, X, CornerDownRight, HelpCircle } from 'lucide-react';
import type { ParsedQuestionnaireInteraction } from '../utils/piQuestionnaireParser';

export interface QuestionAnswerBlockProps {
  interactions: ParsedQuestionnaireInteraction[];
  /** 自定义外层样式 */
  className?: string;
}

/**
 * 交互问答卡片组件：在对话气泡中展示模型提问与用户的选择/输入结果。
 */
export const QuestionAnswerBlock: React.FC<QuestionAnswerBlockProps> = memo(({
  interactions,
  className = '',
}) => {
  if (!interactions || interactions.length === 0) return null;

  return (
    <div className={`w-full space-y-2 mb-1.5 ${className}`}>
      {interactions.map((interaction, idx) => {
        const { cancelled, items, toolCallId } = interaction;
        const hasAnyAnswer = items.some((it) => it.answered);

        return (
          <div
            key={toolCallId || idx}
            className="rounded-xl border border-accent/25 bg-accent/5 dark:bg-accent/10 overflow-hidden shadow-2xs text-xs font-sans msg-enter-anim"
          >
            {/* 顶栏标题 */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-accent/10 dark:bg-accent/15 border-b border-accent/15">
              <div className="flex items-center gap-1.5 min-w-0">
                <Sparkles size={12} className="text-accent shrink-0" />
                <span className="font-semibold text-accent truncate text-[11px]">
                  交互问答
                </span>
                <span className="text-[10px] text-ink-faint">
                  ({items.length} 题)
                </span>
              </div>
              <div className="shrink-0 flex items-center gap-1">
                {cancelled ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-error/10 text-error border border-error/20">
                    <X size={10} strokeWidth={2.5} /> 已取消作答
                  </span>
                ) : hasAnyAnswer ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-accent/15 text-accent border border-accent/30">
                    <Check size={10} strokeWidth={2.5} /> 已确认选择
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-paper-grid/40 text-ink-faint">
                    <HelpCircle size={10} strokeWidth={2} /> 待作答
                  </span>
                )}
              </div>
            </div>

            {/* 问题列表 */}
            <div className="px-3 py-2 space-y-2 divide-y divide-paper-grid/40">
              {items.map((item, qIdx) => {
                const answerList = item.selected && item.selected.length > 0
                  ? item.selected
                  : item.answer
                    ? [item.answer]
                    : [];

                return (
                  <div key={item.questionIndex ?? qIdx} className={qIdx > 0 ? 'pt-2' : ''}>
                    {/* 问题标题 */}
                    <div className="flex items-start gap-1.5">
                      <span className="text-ink-faint font-mono text-[10px] shrink-0 mt-0.5">
                        {qIdx + 1}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1">
                          {item.header && (
                            <span className="px-1.5 py-0.2 rounded text-[9.5px] font-medium bg-accent/15 text-accent">
                              {item.header}
                            </span>
                          )}
                          <span className="text-ink font-medium leading-snug break-words">
                            {item.question}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 用户回答展示 */}
                    <div className="mt-1.5 pl-4 flex items-start gap-1.5">
                      <CornerDownRight size={12} className="text-accent/70 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        {cancelled && answerList.length === 0 ? (
                          <span className="text-[11px] text-ink-faint italic">
                            未作答（已取消提问）
                          </span>
                        ) : answerList.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] text-ink-faint mr-0.5">
                              {item.kind === 'custom' ? '输入回答：' : '已选：'}
                            </span>
                            {answerList.map((ans, aIdx) => (
                              <span
                                key={aIdx}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-sans shadow-2xs ${
                                  item.kind === 'custom'
                                    ? 'bg-paper border border-accent/40 text-accent font-mono font-medium'
                                    : 'bg-accent text-white font-medium'
                                }`}
                              >
                                {item.kind !== 'custom' && <Check size={11} strokeWidth={2.5} />}
                                <span>{ans}</span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[11px] text-ink-faint">
                            等待作答…
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
});

QuestionAnswerBlock.displayName = 'QuestionAnswerBlock';
export default QuestionAnswerBlock;
