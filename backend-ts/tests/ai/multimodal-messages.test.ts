import { describe, expect, it } from 'vitest';
import { toAIMessages } from '../../src/infrastructure/ai/messages.js';

/**
 * 契约测试：前端 wire 消息（OpenAI 风格）→ AI SDK ModelMessage 转换。
 *
 * 对应 Python `_multimodal_messages`：
 * - 携带 images 的 user 消息 → 多模态 content（text + image parts）；
 * - 不携带图片的消息原样透传；
 * - assistant 消息保持字符串 content；
 * - system 角色被跳过（由 system 选项注入）。
 */

const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('toAIMessages（OpenAI 格式 → AI SDK 消息）', () => {
  it('user 消息带图片时转为 text + image parts', () => {
    const msgs = toAIMessages([
      { role: 'user', content: '分析这张图', images: [DATA_URL] },
    ]);
    expect(msgs).toHaveLength(1);
    const m = msgs[0]!;
    expect(m.role).toBe('user');
    expect(Array.isArray(m.content)).toBe(true);
    const parts = m.content as Array<{ type: string; text?: string; image?: string }>;
    expect(parts[0]).toEqual({ type: 'text', text: '分析这张图' });
    expect(parts[1]).toEqual({ type: 'image', image: DATA_URL });
  });

  it('不携带图片的 user 消息保持字符串 content', () => {
    const msgs = toAIMessages([{ role: 'user', content: '你好' }]);
    expect(msgs).toEqual([{ role: 'user', content: '你好' }]);
  });

  it('assistant 消息保持字符串 content（多轮历史正确回传）', () => {
    const msgs = toAIMessages([
      { role: 'user', content: '第一轮' },
      { role: 'assistant', content: '第一轮回答' },
      { role: 'user', content: '第二轮' },
    ]);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(msgs[1]).toEqual({ role: 'assistant', content: '第一轮回答' });
  });

  it('system 角色被跳过（由 system 选项注入）', () => {
    const msgs = toAIMessages([
      { role: 'system', content: '你是助手' },
      { role: 'user', content: 'hi' },
    ]);
    expect(msgs.map((m) => m.role)).toEqual(['user']);
  });

  it('空 images / 非对象元素安全跳过', () => {
    const msgs = toAIMessages([
      null,
      { role: 'user', content: '无图', images: [] },
      'junk',
    ]);
    expect(msgs).toEqual([{ role: 'user', content: '无图' }]);
  });
});
