import type { AgentStep } from '../../../../shared/types/index.js';

/**
 * 单个问答条目结构化数据。
 */
export interface ParsedQuestionItem {
  questionIndex: number;
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: Array<{ label: string; description?: string; preview?: string }>;
  /** 用户选中的选项或输入的文本（单选/自定义输入） */
  answer?: string;
  /** 多选选中的标签列表 */
  selected?: string[];
  /** 作答类型：option=单选，custom=自定义输入，multi=多选，confirm=确认 */
  kind?: 'option' | 'custom' | 'multi' | 'confirm';
  /** 是否已被回答（或有答案数据） */
  answered: boolean;
}

/**
 * 一次问答交互的完整数据模型。
 */
export interface ParsedQuestionnaireInteraction {
  toolCallId: string;
  toolName: string;
  /** 是否已整卷取消/拒绝 */
  cancelled: boolean;
  /** 是否已产生工具执行结果 */
  hasResult: boolean;
  /** 问答条目列表 */
  items: ParsedQuestionItem[];
}

/**
 * 从文本信封中解析问答对（例如 `User has answered your questions: "Q1"="A1". "Q2"="A2". You can now continue...`）
 */
function parseEnvelopeText(text: string): {
  cancelled: boolean;
  answers: Map<string, { answer: string; selected?: string[] }>;
} {
  const trimmed = text.trim();
  if (trimmed.includes('User declined to answer questions') || trimmed.includes('declined')) {
    return { cancelled: true, answers: new Map() };
  }

  const answers = new Map<string, { answer: string; selected?: string[] }>();
  // 匹配形如 "Question"="Answer" 或 "Question"="A, B"
  const regex = /"([^"]+)"\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(trimmed)) !== null) {
    const qText = match[1]?.trim();
    const aText = match[2]?.trim();
    if (qText && aText !== undefined) {
      answers.set(qText, { answer: aText });
    }
  }

  return { cancelled: false, answers };
}

/**
 * 从 agentSteps 中提取所有 ask_user_question 问答交互数据。
 * 支持同时解析结构化 JSON details 与历史纯文本 envelope。
 */
export function parseQuestionnaireInteractions(
  steps?: AgentStep[]
): ParsedQuestionnaireInteraction[] {
  if (!steps || !Array.isArray(steps) || steps.length === 0) return [];

  const results: ParsedQuestionnaireInteraction[] = [];

  // 1. 查找所有 ask_user_question 工具调用
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || step.type !== 'agent_tool_call') continue;

    const toolName = step.name || '';
    if (toolName !== 'ask_user_question') continue;

    const toolCallId = step.id || `call-${i}`;

    // 解析入参 questions
    let rawQuestions: any[] = [];
    try {
      if (step.arguments) {
        const parsedArgs = JSON.parse(step.arguments);
        if (Array.isArray(parsedArgs.questions)) {
          rawQuestions = parsedArgs.questions;
        }
      }
    } catch {
      // JSON 解析失败则作为空处理
    }

    // 2. 寻找对应的 tool_result
    const resultStep = steps.find(
      (s) => s && s.type === 'agent_tool_result' && (s.id === toolCallId || (s.name === 'ask_user_question' && !s.id))
    );

    let cancelled = false;
    let hasResult = !!resultStep;
    const answeredMap = new Map<number | string, {
      answer?: string;
      selected?: string[];
      kind?: 'option' | 'custom' | 'multi' | 'confirm';
    }>();

    if (resultStep && resultStep.result) {
      const rawResult = resultStep.result;
      let parsedJson: any = null;
      try {
        parsedJson = JSON.parse(rawResult);
      } catch {
        // 纯文本格式
      }

      // 情况 A：含有 details 对象
      const details = parsedJson?.details ?? (parsedJson && typeof parsedJson === 'object' && !parsedJson.content ? parsedJson : null);
      if (details) {
        if (details.cancelled) {
          cancelled = true;
        }
        if (Array.isArray(details.answers)) {
          for (const a of details.answers) {
            const qIdx = typeof a.questionIndex === 'number' ? a.questionIndex : -1;
            const qText = typeof a.question === 'string' ? a.question : '';
            const key = qIdx >= 0 ? qIdx : qText;
            answeredMap.set(key, {
              answer: a.answer != null ? String(a.answer) : undefined,
              selected: Array.isArray(a.selected) ? a.selected.map(String) : undefined,
              kind: a.kind || (Array.isArray(a.selected) ? 'multi' : 'option'),
            });
          }
        }
      }

      // 情况 B：从 content 文本或 rawResult 中用正则回退提取
      const contentText =
        typeof parsedJson?.content?.[0]?.text === 'string'
          ? parsedJson.content[0].text
          : typeof parsedJson?.content === 'string'
            ? parsedJson.content
            : rawResult;

      if (!details || (!details.cancelled && answeredMap.size === 0)) {
        const envelope = parseEnvelopeText(contentText);
        if (envelope.cancelled) {
          cancelled = true;
        } else {
          for (const [qText, val] of envelope.answers.entries()) {
            answeredMap.set(qText, {
              answer: val.answer,
              kind: val.answer.includes(', ') ? 'multi' : 'option',
            });
          }
        }
      }
    }

    // 3. 构建题目与答案项
    const items: ParsedQuestionItem[] = rawQuestions.map((q, idx) => {
      const questionText = q?.question || `问题 ${idx + 1}`;
      const header = q?.header || undefined;
      const multiSelect = !!q?.multiSelect;
      const options = Array.isArray(q?.options)
        ? q.options.map((opt: any) => ({
            label: String(opt?.label ?? opt ?? ''),
            description: opt?.description ? String(opt.description) : undefined,
            preview: opt?.preview ? String(opt.preview) : undefined,
          }))
        : undefined;

      // 匹配答案：优先按序号，其次按题目文本
      const ans = answeredMap.get(idx) ?? answeredMap.get(questionText);

      let answer = ans?.answer;
      let selected = ans?.selected;
      if (multiSelect && !selected && answer && answer.includes(', ')) {
        selected = answer.split(', ').map((s) => s.trim()).filter(Boolean);
      }

      return {
        questionIndex: idx,
        question: questionText,
        header,
        multiSelect,
        options,
        answer,
        selected,
        kind: ans?.kind,
        answered: !!(answer || (selected && selected.length > 0)),
      };
    });

    // 如果 questions 为空但有答案（容错），直接根据 answers 补充条目
    if (items.length === 0 && answeredMap.size > 0) {
      let idx = 0;
      for (const [key, ans] of answeredMap.entries()) {
        items.push({
          questionIndex: idx++,
          question: typeof key === 'string' ? key : `问题 ${idx}`,
          answer: ans.answer,
          selected: ans.selected,
          kind: ans.kind,
          answered: true,
        });
      }
    }

    if (items.length > 0 || hasResult) {
      results.push({
        toolCallId,
        toolName,
        cancelled,
        hasResult,
        items,
      });
    }
  }

  return results;
}
