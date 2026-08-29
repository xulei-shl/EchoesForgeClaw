import React, { memo, useEffect, useRef, useState } from 'react';
import { Sparkles, Check, X, CornerDownRight, HelpCircle, Keyboard, CornerDownLeft, Send, RotateCcw } from 'lucide-react';
import type { ParsedQuestionnaireInteraction } from '../utils/piQuestionnaireParser';
import type { PendingUiRequest } from '../piStream';

export interface QuestionAnswerBlockProps {
  /** 问答结构化数据（从 agentSteps 解析） */
  interactions?: ParsedQuestionnaireInteraction[];
  /** 当前待处理的交互提问（来自 SSE extension_ui_request） */
  pendingUi?: PendingUiRequest | null;
  /** 作答写回回调 */
  onAnswer?: (
    id: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean }
  ) => void;
  className?: string;
}

/** 解析 input 模式下可能由多选题降级带来的多行选项编号与提示 */
function parseInputPrompt(rawTitle?: string, rawMessage?: string) {
  const combined = [rawTitle, rawMessage].filter(Boolean).join('\n');
  const lines = combined
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return {
      questionText: rawMessage || rawTitle || '',
      options: [] as { index: string; label: string }[],
      instruction: '',
    };
  }

  const questionText = lines[0] || '';
  const options: { index: string; label: string }[] = [];
  const instructions: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const match = line.match(/^(\d+)[\.、\s]+(.+)$/);
    if (match) {
      options.push({ index: match[1]!, label: match[2]! });
    } else {
      instructions.push(line);
    }
  }

  return {
    questionText: options.length > 0 ? questionText : (rawMessage || rawTitle || ''),
    options,
    instruction: instructions.join(' '),
  };
}

/**
 * 过滤选项列表中扩展私有的“自定义输入/Type something.”哨兵选项（前端自带更友好的就地自定义按钮）
 */
function sanitizeSelectOptions(options?: string[]): string[] {
  if (!options || !Array.isArray(options)) return [];
  return options.filter((opt) => {
    const lower = opt.toLowerCase();
    return !lower.includes('type something') && !lower.includes('自定义输入') && !lower.includes('other');
  });
}

/**
 * 内联交互表单（Select / Input / Confirm）
 */
const InlineInteractiveForm: React.FC<{
  request: PendingUiRequest;
  onAnswer: (id: string, response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
}> = ({ request, onAnswer }) => {
  const method = request.method || 'select';
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('');
  const [inputValue, setInputValue] = useState(request.prefill ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (customMode || method === 'input' || method === 'editor') {
      inputRef.current?.focus();
    }
  }, [customMode, method]);

  // 单选提交
  const handleSelectOption = (opt: string) => {
    onAnswer(request.id, { value: opt });
  };

  // 自定义输入提交
  const handleCustomSubmit = () => {
    const v = customText.trim();
    if (v) {
      setCustomMode(false);
      setCustomText('');
      onAnswer(request.id, { value: v });
    }
  };

  // 纯 input 提交
  const handleInputSubmit = () => {
    const v = inputValue.trim();
    if (v) {
      onAnswer(request.id, { value: v });
    }
  };

  // 确认提交
  const handleConfirm = (confirmed: boolean) => {
    onAnswer(request.id, { confirmed });
  };

  // 1. 确认类型 (Confirm)
  if (method === 'confirm') {
    return (
      <div className="pt-2 pb-1 space-y-2">
        {request.message && (
          <p className="text-xs font-sans text-ink leading-relaxed select-text">
            {request.message}
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleConfirm(true)}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium font-sans text-white hover:bg-accent/90 active:scale-[0.96] transition cursor-pointer shadow-xs"
          >
            <Check size={13} strokeWidth={2.5} /> 是
          </button>
          <button
            type="button"
            onClick={() => handleConfirm(false)}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-paper-grid bg-paper px-3 py-1.5 text-xs font-medium font-sans text-ink hover:border-accent/40 hover:text-accent hover:bg-accent/5 active:scale-[0.96] transition cursor-pointer"
          >
            否
          </button>
        </div>
      </div>
    );
  }

  // 2. 单选类型 (Select)
  if (method === 'select') {
    const rawOptions = request.options ?? [];
    const cleanOptions = sanitizeSelectOptions(rawOptions);
    const optionsToRender = cleanOptions.length > 0 ? cleanOptions : rawOptions;

    return (
      <div className="pt-2 pb-1 space-y-2">
        {request.message && (
          <p className="text-xs font-sans text-ink-light leading-relaxed select-text">
            {request.message}
          </p>
        )}

        {!customMode ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {optionsToRender.map((opt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSelectOption(opt)}
                className="group flex items-center gap-1.5 rounded-lg border border-paper-grid/80 bg-paper px-2.5 py-1.5 text-xs font-sans text-ink hover:border-accent/60 hover:bg-accent/5 hover:text-accent active:scale-[0.97] transition shadow-2xs cursor-pointer"
              >
                <span>{opt}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCustomMode(true)}
              className="group flex items-center gap-1 rounded-lg border border-dashed border-paper-grid bg-paper px-2.5 py-1.5 text-xs font-sans text-ink-faint hover:text-accent hover:border-accent/50 hover:bg-accent/5 active:scale-[0.97] transition cursor-pointer"
              title="自由输入自定义内容"
            >
              <Keyboard size={12} className="text-ink-faint group-hover:text-accent" />
              <span>自定义输入</span>
            </button>
          </div>
        ) : (
          <div className="space-y-1.5 pt-0.5">
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCustomSubmit();
                  }
                  if (e.key === 'Escape') {
                    // 安全切回选项列表，绝不向后端发送 cancel！
                    e.preventDefault();
                    setCustomMode(false);
                    setCustomText('');
                  }
                }}
                placeholder="输入回答后按 Enter 提交（按 Esc 返回选项）…"
                className="flex-1 min-w-0 rounded-lg border border-accent/40 bg-paper px-2.5 py-1.5 text-xs font-sans text-ink placeholder:text-ink-faint focus:outline-hidden focus:border-accent focus:ring-2 focus:ring-accent/20 transition shadow-2xs"
              />
              <button
                type="button"
                onClick={handleCustomSubmit}
                disabled={!customText.trim()}
                className="inline-flex items-center justify-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium font-sans text-white hover:bg-accent/90 active:scale-[0.96] transition disabled:opacity-40 disabled:pointer-events-none cursor-pointer shadow-xs"
              >
                <CornerDownLeft size={12} strokeWidth={2.5} />
                <span>确认</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCustomMode(false);
                  setCustomText('');
                }}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-paper-grid bg-paper px-2 py-1.5 text-xs font-sans text-ink-faint hover:text-ink hover:bg-paper-grid/30 transition cursor-pointer"
                title="返回选项列表"
              >
                <RotateCcw size={11} />
                <span>返回选项</span>
              </button>
            </div>
            <p className="text-[10px] text-ink-faint pl-0.5">
              按 <kbd className="px-1 py-0.2 rounded bg-paper-grid/40 font-mono text-[9px]">Enter</kbd> 提交 · 按 <kbd className="px-1 py-0.2 rounded bg-paper-grid/40 font-mono text-[9px]">Esc</kbd> 或点击返回选项列表
            </p>
          </div>
        )}
      </div>
    );
  }

  // 3. 输入类型 (Input / Editor)
  const parsed = parseInputPrompt(request.title, request.message);
  const selectedIndices = inputValue
    .split(/[,\s]+/)
    .map((t) => t.replace(/[^\d]/g, '').trim())
    .filter(Boolean);

  const toggleMultiOption = (index: string) => {
    let next: string[];
    if (selectedIndices.includes(index)) {
      next = selectedIndices.filter((i) => i !== index);
    } else {
      next = [...selectedIndices, index].sort((a, b) => Number(a) - Number(b));
    }
    setInputValue(next.join(', '));
  };

  return (
    <div className="pt-2 pb-1 space-y-2">
      {parsed.options.length > 0 && (
        <div className="space-y-1.5">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {parsed.options.map((opt) => {
              const isSelected = selectedIndices.includes(opt.index);
              return (
                <button
                  key={opt.index}
                  type="button"
                  onClick={() => toggleMultiOption(opt.index)}
                  className={`group flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-xs font-sans transition active:scale-[0.98] cursor-pointer ${
                    isSelected
                      ? 'border-accent bg-accent/10 text-accent font-medium shadow-2xs'
                      : 'border-paper-grid/80 bg-paper text-ink hover:border-accent/40 hover:bg-accent/5'
                  }`}
                >
                  <span
                    className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded text-[9.5px] font-mono shrink-0 mt-0.5 ${
                      isSelected
                        ? 'bg-accent text-white'
                        : 'bg-paper-grid/40 text-ink-faint group-hover:text-accent'
                    }`}
                  >
                    {isSelected ? '✓' : opt.index}
                  </span>
                  <span className="leading-snug break-words flex-1">{opt.label}</span>
                </button>
              );
            })}
          </div>
          {parsed.instruction && (
            <p className="text-[10.5px] font-sans text-ink-faint leading-normal">
              {parsed.instruction}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleInputSubmit();
            }
            if (e.key === 'Escape') {
              // 仅让输入框失焦，不向后端发送 cancel！
              inputRef.current?.blur();
            }
          }}
          placeholder={
            parsed.options.length > 0
              ? '可点选上方选项，或输入编号如 "1, 2" / 自定义文本…'
              : (request.placeholder ?? '输入回答…')
          }
          className="flex-1 min-w-0 rounded-lg border border-accent/40 bg-paper px-2.5 py-1.5 text-xs font-sans text-ink placeholder:text-ink-faint focus:outline-hidden focus:border-accent focus:ring-2 focus:ring-accent/20 transition shadow-2xs"
        />
        <button
          type="button"
          onClick={handleInputSubmit}
          disabled={!inputValue.trim()}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium font-sans text-white hover:bg-accent/90 active:scale-[0.96] transition disabled:opacity-40 disabled:pointer-events-none cursor-pointer shadow-xs"
        >
          <Send size={12} strokeWidth={2} />
          <span>提交</span>
        </button>
      </div>
    </div>
  );
};

/**
 * 交互问答卡片组件：支持就地内联作答表单与历史问答结果展示。
 */
export const QuestionAnswerBlock: React.FC<QuestionAnswerBlockProps> = memo(({
  interactions = [],
  pendingUi = null,
  onAnswer,
  className = '',
}) => {
  const hasInteractions = interactions.length > 0;
  const hasPendingUi = pendingUi !== null;

  if (!hasInteractions && !hasPendingUi) return null;

  // 显式取消本轮提问
  const handleCancelQuestionnaire = (id?: string) => {
    if (!id || !onAnswer) return;
    onAnswer(id, { cancelled: true });
  };

  // 场景 A：有结构化问答列表（多题问卷，如 ask_user_question）
  if (hasInteractions) {
    return (
      <div className={`w-full space-y-2 mb-1.5 ${className}`}>
        {interactions.map((interaction, idx) => {
          const { cancelled, items, toolCallId } = interaction;
          const hasAnyAnswer = items.some((it) => it.answered);
          const activeIndex = items.findIndex((it) => !it.answered);

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
                <div className="shrink-0 flex items-center gap-1.5">
                  {cancelled ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-error/10 text-error border border-error/20">
                      <X size={10} strokeWidth={2.5} /> 已取消作答
                    </span>
                  ) : hasPendingUi ? (
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-accent/20 text-accent animate-pulse">
                        ● 正在作答 (第 {activeIndex >= 0 ? activeIndex + 1 : 1}/{items.length} 题)
                      </span>
                      {onAnswer && (
                        <button
                          type="button"
                          onClick={() => handleCancelQuestionnaire(pendingUi?.id)}
                          className="text-[10px] text-ink-faint hover:text-error hover:bg-error/10 px-1.5 py-0.5 rounded transition cursor-pointer"
                          title="取消本轮问卷提问"
                        >
                          取消作答
                        </button>
                      )}
                    </div>
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

              {/* 题目列表 */}
              <div className="px-3 py-2 space-y-2.5 divide-y divide-paper-grid/40">
                {items.map((item, qIdx) => {
                  const isCurrentActive = hasPendingUi && (qIdx === activeIndex || (activeIndex === -1 && qIdx === 0));
                  const answerList = item.selected && item.selected.length > 0
                    ? item.selected
                    : item.answer
                      ? [item.answer]
                      : [];

                  return (
                    <div key={item.questionIndex ?? qIdx} className={qIdx > 0 ? 'pt-2.5' : ''}>
                      {/* 题目抬头 */}
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
                            <span className={`leading-snug break-words ${isCurrentActive ? 'text-ink font-semibold' : 'text-ink font-medium'}`}>
                              {item.question}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* 状态 A：当前正在作答此题（就地展开内嵌表单） */}
                      {isCurrentActive && pendingUi && onAnswer ? (
                        <div className="mt-1 pl-4">
                          <InlineInteractiveForm request={pendingUi} onAnswer={onAnswer} />
                        </div>
                      ) : (
                        /* 状态 B：已答复或等待后续题 */
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
                                {hasPendingUi ? '待上一题完成后作答…' : '等待作答…'}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // 场景 B：独立提问（无问卷元数据时的单个通用 dialog，自适应展示）
  if (hasPendingUi && pendingUi && onAnswer) {
    const rawTitle = (pendingUi.title || '模型提问').split('\n')[0] || '模型提问';
    return (
      <div className={`w-full mb-1.5 ${className}`}>
        <div className="rounded-xl border border-accent/35 bg-accent/5 dark:bg-accent/10 overflow-hidden shadow-2xs text-xs font-sans msg-enter-anim">
          <div className="flex items-center justify-between px-3 py-1.5 bg-accent/10 border-b border-accent/15">
            <div className="flex items-center gap-1.5 min-w-0">
              <Sparkles size={12} className="text-accent shrink-0" />
              <span className="font-semibold text-accent truncate text-[11px]">
                {rawTitle}
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleCancelQuestionnaire(pendingUi.id)}
              className="text-[10px] text-ink-faint hover:text-error hover:bg-error/10 px-1.5 py-0.5 rounded transition cursor-pointer"
              title="取消本次提问"
            >
              取消
            </button>
          </div>
          <div className="px-3 py-2">
            <InlineInteractiveForm request={pendingUi} onAnswer={onAnswer} />
          </div>
        </div>
      </div>
    );
  }

  return null;
});

QuestionAnswerBlock.displayName = 'QuestionAnswerBlock';
export default QuestionAnswerBlock;
