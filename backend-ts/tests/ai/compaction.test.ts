import { afterEach, describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import {
  compactModelMessages,
  computeCompactionBudgets,
  estimateTokens,
  estimateContextTokens,
} from '../../src/infrastructure/ai/compaction.js';
import { chatStream } from '../../src/infrastructure/ai/language-model/chat-stream.js';
import { startMockOpenAIServer, sseChunk, type MockOpenAIServer } from '../helpers/mock-openai-server.js';

/**
 * LLM 模式上下文自动压缩（复用 pi 压缩语义）：
 * - 阈值来自所选模型 contextWindow；超阈才压缩；
 * - 旧历史被摘要注意成前缀 summary，近距消息原样保留；
 * - 不足阈值不压缩；摘要失败回退原消息。
 */

const openServers: MockOpenAIServer[] = [];
afterEach(async () => {
  await Promise.all(openServers.splice(0).map((s) => s.close()));
});

const u = (content: string): ModelMessage => ({ role: 'user', content });
const a = (content: string): ModelMessage => ({ role: 'assistant', content });

describe('estimateTokens / budgets', () => {
  it('CJK 每字符≈1 token，ASCII 每 4 字符≈1 token', () => {
    // '甲'*100 → 100 CJK + 4 缓冲 = 104
    expect(estimateTokens('甲'.repeat(100))).toBe(104);
    // 80 个 ASCII → ceil(80/4)=20 + 4 = 24
    expect(estimateTokens('a'.repeat(80))).toBe(24);
    expect(estimateTokens('')).toBe(0);
  });

  it('预算钳制：小窗口下 reserve/keep 退到最小值，触发阈值为窗口-预留', () => {
    const b = computeCompactionBudgets(500);
    expect(b.reserveTokens).toBe(512); // min(16384, max(512, floor(500*0.2)=100))
    expect(b.keepRecentTokens).toBe(1024); // min(20000, max(1024, floor((500-512)*0.5)))
    expect(b.triggerTokens).toBe(500 - 512);
  });

  it('缺省窗口与 pi 一致为 128000', () => {
    const b = computeCompactionBudgets(null);
    expect(b.triggerTokens).toBe(128000 - b.reserveTokens);
  });

  it('estimateContextTokens: 无锚点时全部启发式估算', () => {
    const messages = [u('甲'.repeat(100)), a('乙'.repeat(100))];
    const tokens = estimateContextTokens(messages);
    // 甲*100 → 100 CJK + 4 = 104; 乙*100 → 100 CJK + 4 = 104; + role overhead
    expect(tokens).toBeGreaterThan(0);
  });

  it('estimateContextTokens: 有锚点时锚点后逐条启发式', () => {
    const messages = [u('甲'.repeat(100)), a('乙'.repeat(100)), u('丙'.repeat(100))];
    // 锚点：index=1 的 assistant 消息，usage.totalTokens=500
    const tokens = estimateContextTokens(messages, { totalTokens: 500, messageIndex: 1 });
    // 500 (锚点前含) + 丙*100 的启发式 (≈104)
    expect(tokens).toBeGreaterThan(500);
    expect(tokens).toBeLessThan(700);
  });

  it('estimateContextTokens: 锚点 index 超出范围时回退全部启发式', () => {
    const messages = [u('甲'.repeat(100))];
    const tokens = estimateContextTokens(messages, { totalTokens: 500, messageIndex: 5 });
    // 锚点无效，回退全部启发式
    const fallback = estimateContextTokens(messages);
    expect(tokens).toBe(fallback);
  });
});

describe('compactModelMessages', () => {
  it('低于阈值：不压缩，原样返回', async () => {
    const messages = [u('你好'), a('你好'), u('今天天气如何')];
    const called: string[] = [];
    const out = await compactModelMessages(messages, 'system', 1_000_000, async (t) => {
      called.push(t);
      return '摘要';
    });
    expect(out.compacted).toBe(false);
    expect(out.summary).toBeNull();
    expect(out.messages).toEqual(messages);
    expect(called.length).toBe(0);
  });

  it('超阈值：旧历史摘要注意，近距原样保留，摘要注入为起始 user 消息', async () => {
    // contextWindow=500 → keep 预算钳到 1024；三段 800 字历史（各≈804）+ 问题
    // → 近距约只能保留最近一段，前两段被摘要注意。
    const bigA = u('甲'.repeat(800)); // ≈804
    const bigB = u('乙'.repeat(800)); // ≈804
    const bigC = u('丙'.repeat(800)); // ≈804
    const question = u('现在的问题是什么');
    const messages = [bigA, bigB, bigC, question];
    const called: string[] = [];
    const out = await compactModelMessages(messages, 'system提示', 500, async (text) => {
      called.push(text);
      return '合并后的目标与进展';
    });
    expect(out.compacted).toBe(true);
    expect(out.summary).toBe('合并后的目标与进展');
    // 摘要输入应包含被压缩的旧历史（甲、乙两段）与 system
    expect(called[0]).toContain('甲');
    expect(called[0]).toContain('乙');
    expect(called[0]).toContain('[System]: system提示');
    // 输出 = 摘要起始消息 + 保留的近距（长度变短）
    expect(out.messages.length).toBeLessThan(messages.length);
    expect(out.messages[0]!.role).toBe('user');
    expect(out.messages[0]!.content).toContain('[对话历史摘要]');
    // 最后一条仍是当前问题（回答可达）
    expect(out.messages[out.messages.length - 1]).toEqual(question);
    // 原样保留的近距（丙段 + 问题）不含被压缩的甲乙两段
    const keptText = out.messages
      .slice(1)
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('');
    expect(keptText).toContain('丙');
    expect(keptText).not.toContain('甲');
    expect(keptText).not.toContain('乙');
  });

  it('摘要为空（失败）/近距全保留：不压缩，安全回退', async () => {
    const messages = [u('你好'), a('嗨'), u('下一句')];
    const empty = await compactModelMessages(messages, '', 500, async () => '');
    expect(empty.compacted).toBe(false);
    expect(empty.messages).toEqual(messages);

    const noSummarize = await compactModelMessages(
      [u('短的')],
      '',
      500,
      async () => '摘要'
    );
    expect(noSummarize.compacted).toBe(false);
  });

  it('锚点校准：有锚点时不触发压缩（锚点降低估算值）', async () => {
    // 三条大消息，每条 ≈804 tokens
    const bigA = u('甲'.repeat(800));
    const bigB = u('乙'.repeat(800));
    const bigC = u('丙'.repeat(800));
    const messages = [bigA, bigB, bigC];
    const called: string[] = [];

    // 无锚点：总估算 ≈ 2412，contextWindow=2000 时超阈值 → 会压缩
    const noAnchor = await compactModelMessages(messages, '', 2000, async (t) => {
      called.push(t);
      return '摘要';
    });
    expect(noAnchor.compacted).toBe(true);
    expect(called.length).toBe(1);

    // 有锚点：假设 index=1 的真实 usage=100，总估算 = 100 + 第3条 ≈ 104 → 204 < 阈值 → 不压缩
    called.length = 0;
    const withAnchor = await compactModelMessages(messages, '', 2000, async (t) => {
      called.push(t);
      return '摘要';
    }, { totalTokens: 100, messageIndex: 1 });
    expect(withAnchor.compacted).toBe(false);
    expect(called.length).toBe(0);
  });
});

describe('chatStream 压缩集成', () => {
  it('超阈值时：先调一次摘要生成，再以「摘要+近距」发给模型', async () => {
    const big = '甲'.repeat(800); // 每段≈804，三段历史超 keep 预算（钳到 1024）
    const srv = await startMockOpenAIServer((req, send) => {
      if (req.body?.stream !== true) {
        // 摘要调用（generateText 非流式）：返回纯 JSON completion
        return JSON.stringify({
          id: 'cmpl-summary',
          object: 'chat.completion',
          created: 0,
          model: 'mock-model',
          choices: [{ index: 0, message: { role: 'assistant', content: '压缩后的历史概要' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      }
      // 正式对话（streamText SSE）
      const base = { id: 'chatcmpl-c', object: 'chat.completion.chunk', created: 0, model: 'mock-model' };
      send(sseChunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }));
      send(sseChunk({ ...base, choices: [{ index: 0, delta: { content: '回答' }, finish_reason: null }] }));
      send(sseChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
      send(sseChunk({ ...base, choices: [], usage: { total_tokens: 5 } }));
    });
    openServers.push(srv);

    const messages = [
      { role: 'user', content: big },
      { role: 'assistant', content: '收到A' },
      { role: 'user', content: big },
      { role: 'assistant', content: '收到B' },
      { role: 'user', content: big },
      { role: 'user', content: '最后的问题' },
    ];
    const events = [];
    for await (const e of chatStream(messages, {
      apiKey: 'sk-mock',
      base_url: srv.baseURL,
      model_name: 'mock-model',
      contextWindow: 500,
    })) {
      events.push(e);
    }
    expect(events.filter((e) => e.type === 'content').length).toBeGreaterThan(0);

    // 两轮调用：摘要（非流式 JSON）+ 正式对话（SSE）
    expect(srv.requests.length).toBe(2);
    const finalMessages = (srv.requests[1]?.body?.messages ?? []);
    const finalTexts = finalMessages.map((m: any) =>
      typeof m.content === 'string' ? m.content : m.content?.[0]?.text ?? ''
    ).join('\n');
    // 正式对话收到的是「摘要起始 + 近距」，而非完整的大段历史
    expect(finalTexts).toContain('压缩后的历史概要');
    expect(finalMessages.length).toBeLessThan(messages.length);
    // 最后一条仍是用户问题
    expect(finalMessages[finalMessages.length - 1].role).toBe('user');
  });
});