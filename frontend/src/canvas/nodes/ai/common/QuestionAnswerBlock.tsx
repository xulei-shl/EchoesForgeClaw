import React, { memo, useEffect, useRef, useState } from 'react';
import { Sparkles, Check, X, CornerDownRight, Send, CheckSquare, Square, Loader2 } from 'lucide-react';
import type { ParsedQuestionnaireInteraction, ParsedQuestionItem } from '../utils/piQuestionnaireParser';
import type { PendingUiRequest } from '../infra/piStream';

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

/**
 * 过滤选项列表中扩展私有的“自定义输入/Type something.”哨兵选项
 */
function sanitizeSelectOptions(options?: string[]): string[] {
  if (!options || !Array.isArray(options)) return [];
  return options.filter((opt) => {
    const lower = opt.toLowerCase();
    return !lower.includes('type something') && !lower.includes('自定义输入') && !lower.includes('other');
  });
}

/**
 * 单选题值格式化：
 * 若是预设选项，返回符合 RPC 格式的选项字符串（带编号 "1. 选项 — ..." 或数字 "1"）
 * 若是自定义输入，返回 "Type something." 哨兵选项以触发二级 input 提问
 */
function formatSingleSelectValue(
  selectedLabel: string | undefined,
  options: Array<{ label: string }>,
  isCustom: boolean,
  pendingOptions?: string[]
): string {
  if (isCustom) {
    const sentinelIdx = options.length + 1;
    if (pendingOptions && pendingOptions.length >= sentinelIdx) {
      return pendingOptions[sentinelIdx - 1]!;
    }
    return `${sentinelIdx}`;
  }

  if (!selectedLabel) {
    return pendingOptions?.[0] ?? '1';
  }

  const idx = options.findIndex((o) => o.label === selectedLabel);
  if (idx >= 0) {
    if (pendingOptions && pendingOptions[idx]) {
      return pendingOptions[idx]!;
    }
    return `${idx + 1}`;
  }

  return pendingOptions?.[0] ?? '1';
}

/**
 * 将多选题选中的 labels 转换为符合 RPC 期望的逗号分隔编号（例如 "1, 2"）或纯文本
 */
function formatMultiSelectValue(
  selectedLabels: string[],
  options: Array<{ label: string }>,
  customText?: string
): string {
  const trimmedCustom = (customText || '').trim();
  const indices: number[] = [];

  for (const lbl of selectedLabels) {
    const idx = options.findIndex((o) => o.label === lbl);
    if (idx >= 0) {
      indices.push(idx + 1);
    }
  }

  indices.sort((a, b) => a - b);

  if (indices.length > 0) {
    return indices.join(', ');
  }

  if (trimmedCustom) {
    return trimmedCustom;
  }

  return '1';
}

/**
 * 智能计算当前 pendingUi 属于问卷中的哪道题
 */
function resolveActiveQuestionIndex(
  items: ParsedQuestionItem[],
  pendingUi: PendingUiRequest | null
): { index: number; matchScore: number } {
  if (!pendingUi || items.length === 0) return { index: 0, matchScore: 0 };

  const targetTitle = (pendingUi.title || '').toLowerCase();
  const targetMessage = (pendingUi.message || '').toLowerCase();
  const targetOptions = (pendingUi.options || []).map((o) => o.toLowerCase());

  let bestIndex = -1;
  let highestScore = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    let score = 0;
    const qText = item.question.toLowerCase();
    const hText = (item.header || '').toLowerCase();

    // 1. 题目文本匹配
    if (qText && (targetTitle.includes(qText) || targetMessage.includes(qText))) {
      score += 30;
    }
    // 2. Header 分组匹配
    if (hText && (targetTitle.includes(hText) || targetMessage.includes(hText))) {
      score += 15;
    }
    // 3. 候选选项匹配度
    if (Array.isArray(item.options) && item.options.length > 0 && targetOptions.length > 0) {
      for (const opt of item.options) {
        const optLabel = opt.label.toLowerCase();
        if (targetOptions.some((to) => to.includes(optLabel) || optLabel.includes(to))) {
          score += 10;
        }
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestIndex = i;
    }
  }

  return {
    index: bestIndex >= 0 ? bestIndex : 0,
    matchScore: highestScore,
  };
}

/**
 * 单张多题问卷卡片：每个问卷轮次具有完全独立的草稿状态与提交生命周期
 */
const SingleQuestionnaireCard: React.FC<{
  interaction: ParsedQuestionnaireInteraction;
  pendingUi: PendingUiRequest | null;
  onAnswer?: (
    id: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean }
  ) => void;
}> = memo(({ interaction, pendingUi, onAnswer }) => {
  const { cancelled, items, hasResult } = interaction;
  const isDone = hasResult || cancelled;

  // 严格隔离在当前问卷实例中的草稿状态
  const [drafts, setDrafts] = useState<Record<number, { selected: string[]; customText: string }>>(() => {
    const initial: Record<number, { selected: string[]; customText: string }> = {};
    items.forEach((it, idx) => {
      if (!it.multiSelect && it.options && it.options.length > 0) {
        initial[idx] = { selected: [it.options[0]!.label], customText: '' };
      } else {
        initial[idx] = { selected: [], customText: '' };
      }
    });
    return initial;
  });

  // 当前问卷专属的提交状态（初始必为 false）
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittedDraftsRef = useRef<Record<number, { selected: string[]; customText: string }>>({});
  const autoHandledUiIdsRef = useRef<Set<string>>(new Set());

  // 防卡死熔断定时器：提交超过 8 秒未结束自动恢复，避免界面死锁
  useEffect(() => {
    if (!isSubmitting) return;
    const timeout = setTimeout(() => {
      setIsSubmitting(false);
    }, 8000);
    return () => clearTimeout(timeout);
  }, [isSubmitting]);

  // 当服务端结果到达后，自动关闭提交中动效
  useEffect(() => {
    if (isDone) {
      setIsSubmitting(false);
    }
  }, [isDone]);

  // 显式取消本轮提问
  const handleCancelQuestionnaire = (id?: string) => {
    if (!onAnswer) return;
    setIsSubmitting(false);
    onAnswer(id ?? pendingUi?.id ?? '', { cancelled: true });
  };

  // 自动流水线处理：当用户点击了提交按钮后，随后的各题 pendingUi 到达时自动秒级回写
  useEffect(() => {
    if (isDone || !isSubmitting || !pendingUi || !onAnswer) return;
    if (autoHandledUiIdsRef.current.has(pendingUi.id)) return;

    autoHandledUiIdsRef.current.add(pendingUi.id);

    const match = resolveActiveQuestionIndex(items, pendingUi);
    const activeIdx = match.index >= 0 ? match.index : 0;
    const draft = submittedDraftsRef.current[activeIdx] ?? { selected: [], customText: '' };
    const item = items[activeIdx];

    let valueToSubmit = '';
    const method = pendingUi.method || 'select';

    if (method === 'input' && !item?.multiSelect) {
      valueToSubmit = draft.customText.trim() || '默认回答';
    } else if (item?.multiSelect) {
      valueToSubmit = formatMultiSelectValue(draft.selected, item?.options ?? [], draft.customText);
    } else {
      const isCustom = !!draft.customText.trim();
      valueToSubmit = formatSingleSelectValue(
        draft.selected[0],
        item?.options ?? [],
        isCustom,
        pendingUi.options
      );
    }

    const timer = setTimeout(() => {
      onAnswer(pendingUi.id, { value: valueToSubmit });
    }, 40);

    return () => clearTimeout(timer);
  }, [isDone, isSubmitting, pendingUi, onAnswer, items]);

  // 切换多选选项
  const toggleMultiOption = (qIdx: number, label: string) => {
    if (isDone || isSubmitting) return;
    setDrafts((prev) => {
      const current = prev[qIdx]?.selected ?? [];
      const next = current.includes(label)
        ? current.filter((l) => l !== label)
        : [...current, label];
      return {
        ...prev,
        [qIdx]: {
          selected: next,
          customText: prev[qIdx]?.customText ?? '',
        },
      };
    });
  };

  // 切换单选选项
  const selectSingleOption = (qIdx: number, label: string) => {
    if (isDone || isSubmitting) return;
    setDrafts((prev) => ({
      ...prev,
      [qIdx]: {
        selected: [label],
        customText: '',
      },
    }));
  };

  // 更新自定义文本
  const updateCustomText = (qIdx: number, text: string) => {
    if (isDone || isSubmitting) return;
    setDrafts((prev) => ({
      ...prev,
      [qIdx]: {
        selected: prev[qIdx]?.selected ?? [],
        customText: text,
      },
    }));
  };

  // 用户点击「统一确认提交回答」
  const handleSubmitAll = () => {
    if (!onAnswer) return;
    submittedDraftsRef.current = drafts;
    setIsSubmitting(true);

    if (pendingUi) {
      const match = resolveActiveQuestionIndex(items, pendingUi);
      const activeIdx = match.index >= 0 ? match.index : 0;
      autoHandledUiIdsRef.current.add(pendingUi.id);

      const draft = drafts[activeIdx] ?? { selected: [], customText: '' };
      const item = items[activeIdx];
      let valueToSubmit = '';

      if (item?.multiSelect) {
        valueToSubmit = formatMultiSelectValue(draft.selected, item?.options ?? [], draft.customText);
      } else {
        const isCustom = !!draft.customText.trim();
        valueToSubmit = formatSingleSelectValue(
          draft.selected[0],
          item?.options ?? [],
          isCustom,
          pendingUi.options
        );
      }

      onAnswer(pendingUi.id, { value: valueToSubmit });
    }
  };

  // 统计已填写的题目数
  const filledCount = items.filter((_, i) => {
    const d = drafts[i];
    return (d && d.selected.length > 0) || (d && d.customText.trim().length > 0);
  }).length;

  return (
    <div className="rounded-xl border border-accent/25 bg-accent/5 dark:bg-accent/10 overflow-hidden shadow-2xs text-xs font-sans msg-enter-anim">
      {/* 顶栏标题与状态 */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-accent/10 dark:bg-accent/15 border-b border-accent/15">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles size={13} className="text-accent shrink-0" />
          <span className="font-semibold text-accent truncate text-xs">
            交互问答
          </span>
          <span className="text-[10px] text-ink-faint">
            (共 {items.length} 题)
          </span>
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          {cancelled ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-error/10 text-error border border-error/20">
              <X size={10} strokeWidth={2.5} /> 已取消
            </span>
          ) : isDone ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-accent/15 text-accent border border-accent/30">
              <Check size={10} strokeWidth={2.5} /> 已完成
            </span>
          ) : isSubmitting ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-accent/20 text-accent animate-pulse">
              <Loader2 size={11} className="animate-spin" /> 正在提交…
            </span>
          ) : !isDone ? (
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] font-medium text-accent">
                已选 {filledCount}/{items.length} 题
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
          ) : null}
        </div>
      </div>

      {/* 题目列表与选项交互区 */}
      <div className="px-3.5 py-3 space-y-3.5 divide-y divide-paper-grid/40">
        {items.map((item, qIdx) => {
          const draft = drafts[qIdx] ?? { selected: [], customText: '' };
          const options = item.options ?? [];

          // 历史/完成态答案
          const historicalAnswers = item.selected && item.selected.length > 0
            ? item.selected
            : item.answer
              ? [item.answer]
              : [];

          return (
            <div key={item.questionIndex ?? qIdx} className={qIdx > 0 ? 'pt-3' : ''}>
              {/* 题目抬头 */}
              <div className="flex items-start gap-2">
                <span className="text-accent/80 font-mono text-[11px] font-semibold shrink-0 mt-0.5">
                  {qIdx + 1}.
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.header && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/15 text-accent">
                        {item.header}
                      </span>
                    )}
                    <span className="text-ink font-medium leading-snug break-words text-xs">
                      {item.question}
                    </span>
                    {item.multiSelect && !isDone && (
                      <span className="text-[10px] font-normal text-ink-faint bg-paper-grid/30 px-1.5 py-0.2 rounded">
                        可多选
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 交互区：正在编辑中（!isDone） */}
              {!isDone ? (
                <div className="mt-2 pl-4 space-y-2">
                  {/* 1. 多选模式：真 Checkbox 卡片网格 */}
                  {item.multiSelect ? (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {options.map((opt) => {
                          const isSelected = draft.selected.includes(opt.label);
                          return (
                            <button
                              key={opt.label}
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => toggleMultiOption(qIdx, opt.label)}
                              className={`group flex items-start gap-2 rounded-lg border p-2 text-left text-xs font-sans transition active:scale-[0.98] cursor-pointer ${
                                isSelected
                                  ? 'border-accent bg-accent/10 text-accent font-medium shadow-2xs'
                                  : 'border-paper-grid/80 bg-paper text-ink hover:border-accent/50 hover:bg-accent/5'
                              }`}
                            >
                              <span className="mt-0.5 shrink-0 text-accent">
                                {isSelected ? (
                                  <CheckSquare size={14} className="text-accent" />
                                ) : (
                                  <Square size={14} className="text-ink-faint group-hover:text-accent" />
                                )}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="leading-snug break-words font-medium">
                                  {opt.label}
                                </div>
                                {opt.description && (
                                  <p className="text-[10.5px] text-ink-faint leading-normal mt-0.5">
                                    {opt.description}
                                  </p>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* 自定义补充输入（选填） */}
                      <div className="pt-1">
                        <input
                          type="text"
                          disabled={isSubmitting}
                          value={draft.customText}
                          onChange={(e) => updateCustomText(qIdx, e.target.value)}
                          placeholder="自定义补充说明（选填）…"
                          className="w-full rounded-lg border border-paper-grid bg-paper px-2.5 py-1.5 text-xs font-sans text-ink placeholder:text-ink-faint focus:outline-hidden focus:border-accent focus:ring-1 focus:ring-accent/30 transition shadow-2xs"
                        />
                      </div>
                    </div>
                  ) : (
                    /* 2. 单选模式：高亮单选按钮组 + 自定义输入 */
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {options.map((opt) => {
                          const isSelected = draft.selected.includes(opt.label) && !draft.customText;
                          return (
                            <button
                              key={opt.label}
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => selectSingleOption(qIdx, opt.label)}
                              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-sans transition active:scale-[0.97] cursor-pointer shadow-2xs ${
                                isSelected
                                  ? 'border-accent bg-accent text-white font-medium shadow-xs'
                                  : 'border-paper-grid/80 bg-paper text-ink hover:border-accent/50 hover:bg-accent/5 hover:text-accent'
                              }`}
                            >
                              {isSelected && <Check size={12} strokeWidth={2.5} />}
                              <span>{opt.label}</span>
                            </button>
                          );
                        })}
                      </div>

                      {/* 自定义文本输入（输入即自动覆盖选项） */}
                      <div className="pt-0.5">
                        <input
                          type="text"
                          disabled={isSubmitting}
                          value={draft.customText}
                          onChange={(e) => updateCustomText(qIdx, e.target.value)}
                          placeholder="输入自定义答案（输入后将优先以此为准）…"
                          className={`w-full rounded-lg border px-2.5 py-1.5 text-xs font-sans text-ink placeholder:text-ink-faint focus:outline-hidden transition shadow-2xs ${
                            draft.customText
                              ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
                              : 'border-paper-grid bg-paper focus:border-accent focus:ring-1 focus:ring-accent/30'
                          }`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* 完成态：展示已保存的答案 Chip */
                <div className="mt-1.5 pl-4 flex items-start gap-1.5">
                  <CornerDownRight size={12} className="text-accent/70 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    {cancelled && historicalAnswers.length === 0 ? (
                      <span className="text-[11px] text-ink-faint italic">
                        未作答（已取消提问）
                      </span>
                    ) : historicalAnswers.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-ink-faint mr-0.5">
                          {item.kind === 'custom' ? '输入回答：' : '你的选择：'}
                        </span>
                        {historicalAnswers.map((ans, aIdx) => (
                          <span
                            key={aIdx}
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-sans shadow-2xs ${
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
              )}
            </div>
          );
        })}
      </div>

      {/* 底部统一提交操作栏（仅在编辑未提交态展示） */}
      {!isDone && (
        <div className="px-3.5 py-2.5 bg-accent/5 border-t border-accent/15 flex items-center justify-between gap-3">
          <span className="text-[10.5px] text-ink-faint leading-snug flex-1 min-w-0">
            支持自由修改，确认无误后点击右侧按钮提交
          </span>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleSubmitAll}
            className="shrink-0 whitespace-nowrap inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium font-sans text-white hover:bg-accent/90 active:scale-[0.96] transition disabled:opacity-70 disabled:pointer-events-none cursor-pointer shadow-xs min-w-[72px]"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                <span>正在提交…</span>
              </>
            ) : (
              <>
                <Send size={12} strokeWidth={2} />
                <span>提交</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
});

SingleQuestionnaireCard.displayName = 'SingleQuestionnaireCard';

/**
 * 交互问答卡片入口：按 toolCallId 严格实例化隔离每个问卷轮次
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

  // 场景 A：有结构化问答列表（多题问卷）
  if (hasInteractions) {
    return (
      <div className={`w-full space-y-2 mb-1.5 ${className}`}>
        {interactions.map((interaction, idx) => (
          <SingleQuestionnaireCard
            key={interaction.toolCallId || `q-${idx}`}
            interaction={interaction}
            pendingUi={pendingUi}
            onAnswer={onAnswer}
          />
        ))}
      </div>
    );
  }

  // 场景 B：独立提问（无问卷元数据时的单个通用 dialog）
  if (hasPendingUi && pendingUi && onAnswer) {
    const rawTitle = (pendingUi.title || '模型提问').split('\n')[0] || '模型提问';
    const method = pendingUi.method || 'select';
    const options = sanitizeSelectOptions(pendingUi.options);

    return (
      <div className={`w-full mb-1.5 ${className}`}>
        <div className="rounded-xl border border-accent/35 bg-accent/5 dark:bg-accent/10 overflow-hidden shadow-2xs text-xs font-sans msg-enter-anim">
          <div className="flex items-center justify-between px-3.5 py-2 bg-accent/10 border-b border-accent/15">
            <div className="flex items-center gap-1.5 min-w-0">
              <Sparkles size={12} className="text-accent shrink-0" />
              <span className="font-semibold text-accent truncate text-xs">
                {rawTitle}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onAnswer(pendingUi.id, { cancelled: true })}
              className="text-[10px] text-ink-faint hover:text-error hover:bg-error/10 px-1.5 py-0.5 rounded transition cursor-pointer"
              title="取消本次提问"
            >
              取消
            </button>
          </div>
          <div className="px-3.5 py-3 space-y-2">
            {pendingUi.message && (
              <p className="text-xs font-sans text-ink leading-relaxed select-text">
                {pendingUi.message}
              </p>
            )}
            {method === 'confirm' ? (
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onAnswer(pendingUi.id, { confirmed: true })}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium font-sans text-white hover:bg-accent/90 active:scale-[0.96] transition cursor-pointer shadow-xs"
                >
                  <Check size={13} strokeWidth={2.5} /> 是
                </button>
                <button
                  type="button"
                  onClick={() => onAnswer(pendingUi.id, { confirmed: false })}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-paper-grid bg-paper px-3.5 py-1.5 text-xs font-medium font-sans text-ink hover:border-accent/40 hover:text-accent hover:bg-accent/5 active:scale-[0.96] transition cursor-pointer"
                >
                  否
                </button>
              </div>
            ) : options.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => onAnswer(pendingUi.id, { value: opt })}
                    className="flex items-center gap-1.5 rounded-lg border border-paper-grid/80 bg-paper px-3 py-1.5 text-xs font-sans text-ink hover:border-accent/60 hover:bg-accent/5 hover:text-accent active:scale-[0.97] transition shadow-2xs cursor-pointer"
                  >
                    <span>{opt}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 pt-1">
                <input
                  type="text"
                  placeholder={pendingUi.placeholder || '输入回答…'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const v = (e.currentTarget.value || '').trim();
                      if (v) onAnswer(pendingUi.id, { value: v });
                    }
                  }}
                  className="flex-1 rounded-lg border border-paper-grid bg-paper px-2.5 py-1.5 text-xs font-sans text-ink placeholder:text-ink-faint focus:outline-hidden focus:border-accent focus:ring-1 focus:ring-accent/30 transition shadow-2xs"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
});

QuestionAnswerBlock.displayName = 'QuestionAnswerBlock';
export default QuestionAnswerBlock;
