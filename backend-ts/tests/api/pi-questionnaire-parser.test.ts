import { describe, expect, it } from 'vitest';
import { parseQuestionnaireInteractions } from '../../../frontend/src/modules/bookplate/utils/piQuestionnaireParser.js';
import type { AgentStep } from '../../../frontend/src/platform/types.js';

describe('parseQuestionnaireInteractions（问答交互数据解析）', () => {
  it('空步骤或无问答工具时返回空数组', () => {
    expect(parseQuestionnaireInteractions(undefined)).toEqual([]);
    expect(parseQuestionnaireInteractions([])).toEqual([]);
    expect(
      parseQuestionnaireInteractions([
        { type: 'agent_tool_call', id: '1', name: 'read', arguments: '{"path":"a.txt"}' },
        { type: 'agent_tool_result', id: '1', name: 'read', result: 'file content' },
      ])
    ).toEqual([]);
  });

  it('单选场景：从 arguments 与 details 解析题目、选项与用户答案', () => {
    const steps: AgentStep[] = [
      {
        type: 'agent_tool_call',
        id: 'call-ask-1',
        name: 'ask_user_question',
        arguments: JSON.stringify({
          questions: [
            {
              question: '你想使用哪个前端框架？',
              header: '技术栈',
              multiSelect: false,
              options: [
                { label: 'React + Tailwind', description: '现代化前端' },
                { label: 'Vue 3', description: '渐进式框架' },
              ],
            },
          ],
        }),
      },
      {
        type: 'agent_tool_result',
        id: 'call-ask-1',
        name: 'ask_user_question',
        result: JSON.stringify({
          content: [
            {
              type: 'text',
              text: 'User has answered your questions: "你想使用哪个前端框架？"="React + Tailwind". You can now continue with the user\'s answers in mind.',
            },
          ],
          details: {
            answers: [
              {
                questionIndex: 0,
                question: '你想使用哪个前端框架？',
                kind: 'option',
                answer: 'React + Tailwind',
              },
            ],
            cancelled: false,
          },
        }),
      },
    ];

    const results = parseQuestionnaireInteractions(steps);
    expect(results.length).toBe(1);
    const interaction = results[0]!;
    expect(interaction.toolCallId).toBe('call-ask-1');
    expect(interaction.cancelled).toBe(false);
    expect(interaction.hasResult).toBe(true);
    expect(interaction.items.length).toBe(1);

    const item = interaction.items[0]!;
    expect(item.question).toBe('你想使用哪个前端框架？');
    expect(item.header).toBe('技术栈');
    expect(item.multiSelect).toBe(false);
    expect(item.options?.length).toBe(2);
    expect(item.answer).toBe('React + Tailwind');
    expect(item.kind).toBe('option');
    expect(item.answered).toBe(true);
  });

  it('多选与自定义输入场景：从 details 正确提取 selected 数组与 custom 答案', () => {
    const steps: AgentStep[] = [
      {
        type: 'agent_tool_call',
        id: 'call-multi',
        name: 'ask_user_question',
        arguments: JSON.stringify({
          questions: [
            {
              question: '需要包含哪些模块？',
              header: '功能列表',
              multiSelect: true,
              options: [
                { label: '用户认证' },
                { label: '文件上传' },
                { label: '支付网关' },
              ],
            },
            {
              question: '自定义要求',
              header: '补充说明',
              multiSelect: false,
              options: [{ label: '默认配置' }],
            },
          ],
        }),
      },
      {
        type: 'agent_tool_result',
        id: 'call-multi',
        name: 'ask_user_question',
        result: JSON.stringify({
          details: {
            answers: [
              {
                questionIndex: 0,
                question: '需要包含哪些模块？',
                kind: 'multi',
                selected: ['用户认证', '文件上传'],
              },
              {
                questionIndex: 1,
                question: '自定义要求',
                kind: 'custom',
                answer: '需要支持暗色模式',
              },
            ],
            cancelled: false,
          },
        }),
      },
    ];

    const results = parseQuestionnaireInteractions(steps);
    expect(results.length).toBe(1);
    const items = results[0]!.items;
    expect(items.length).toBe(2);

    expect(items[0]!.selected).toEqual(['用户认证', '文件上传']);
    expect(items[0]!.kind).toBe('multi');
    expect(items[0]!.answered).toBe(true);

    expect(items[1]!.answer).toBe('需要支持暗色模式');
    expect(items[1]!.kind).toBe('custom');
    expect(items[1]!.answered).toBe(true);
  });

  it('取消作答场景：cancelled: true 正确识别', () => {
    const steps: AgentStep[] = [
      {
        type: 'agent_tool_call',
        id: 'call-cancel',
        name: 'ask_user_question',
        arguments: JSON.stringify({
          questions: [{ question: '是否继续？', options: [{ label: '是' }, { label: '否' }] }],
        }),
      },
      {
        type: 'agent_tool_result',
        id: 'call-cancel',
        name: 'ask_user_question',
        result: JSON.stringify({
          content: [{ type: 'text', text: 'User declined to answer questions' }],
          details: {
            answers: [],
            cancelled: true,
          },
        }),
      },
    ];

    const results = parseQuestionnaireInteractions(steps);
    expect(results.length).toBe(1);
    expect(results[0]!.cancelled).toBe(true);
    expect(results[0]!.hasResult).toBe(true);
    expect(results[0]!.items[0]!.answered).toBe(false);
  });

  it('历史纯文本信封解析（从 chat.jsonl 水合）：正确正则提取问答对', () => {
    const steps: AgentStep[] = [
      {
        type: 'agent_tool_call',
        id: 'call-legacy',
        name: 'ask_user_question',
        arguments: JSON.stringify({
          questions: [
            { question: 'Q1', header: 'H1', options: [{ label: 'Opt1' }, { label: 'Opt2' }] },
            { question: 'Q2', header: 'H2', options: [{ label: 'OptA' }, { label: 'OptB' }] },
          ],
        }),
      },
      {
        type: 'agent_tool_result',
        id: 'call-legacy',
        name: 'ask_user_question',
        result:
          'User has answered your questions: "Q1"="Opt1". "Q2"="OptA". You can now continue with the user\'s answers in mind.',
      },
    ];

    const results = parseQuestionnaireInteractions(steps);
    expect(results.length).toBe(1);
    expect(results[0]!.cancelled).toBe(false);
    expect(results[0]!.items[0]!.answer).toBe('Opt1');
    expect(results[0]!.items[1]!.answer).toBe('OptA');
  });

  it('实时等待阶段（仅有 tool_call 尚无 tool_result）：正确返回题目且标记未回答', () => {
    const steps: AgentStep[] = [
      {
        type: 'agent_tool_call',
        id: 'call-live',
        name: 'ask_user_question',
        arguments: JSON.stringify({
          questions: [
            {
              question: '你的学科背景是什么？',
              header: '学科背景',
              options: [{ label: '计算机科学' }, { label: '人文社科' }],
            },
            {
              question: '你读这本书的主要目的是什么？',
              header: '阅读目的',
              options: [{ label: '学术研究' }, { label: '兴趣爱好' }],
            },
          ],
        }),
      },
    ];

    const results = parseQuestionnaireInteractions(steps);
    expect(results.length).toBe(1);
    expect(results[0]!.items.length).toBe(2);
    expect(results[0]!.items[0]!.options?.map((o) => o.label)).toEqual(['计算机科学', '人文社科']);
    expect(results[0]!.items[1]!.options?.map((o) => o.label)).toEqual(['学术研究', '兴趣爱好']);
    expect(results[0]!.items[0]!.answered).toBe(false);
    expect(results[0]!.items[1]!.answered).toBe(false);
  });
});
