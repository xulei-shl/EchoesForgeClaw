import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { initDb, setDb, type DB } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import { appSettings } from '../../src/db/schema.js';

describe('用户反馈 /api/feedback API 测试', () => {
  let db: DB;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    db = initDb(':memory:');
    setDb(db);
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('字段缺失时返回 400 校验错误', async () => {
    // 缺少 name
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { name: '', email: 'test@example.com', content: '测试内容' },
    });
    expect(res1.statusCode).toBe(400);
    expect(res1.json().detail).toContain('姓名不能为空');

    // 缺少 email
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { name: '张三', email: '', content: '测试内容' },
    });
    expect(res2.statusCode).toBe(400);
    expect(res2.json().detail).toContain('邮箱不能为空');

    // 邮箱格式非法
    const res3 = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { name: '张三', email: 'invalid-email', content: '测试内容' },
    });
    expect(res3.statusCode).toBe(400);
    expect(res3.json().detail).toContain('邮箱格式不正确');

    // 缺少 content
    const res4 = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { name: '张三', email: 'test@example.com', content: '   ' },
    });
    expect(res4.statusCode).toBe(400);
    expect(res4.json().detail).toContain('反馈内容不能为空');
  });

  it('未配置 wechat.webhook_url 时正常接收反馈并提示', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: {
        name: '李四',
        email: 'lisi@example.com',
        content: '画板很好用，希望支持更多动物头像！',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain('反馈已记录');
  });

  it('配置了 wechat.webhook_url 时尝试推送通知', async () => {
    // 先清理已有空记录，避免唯一键冲突
    db.delete(appSettings)
      .where(eq(appSettings.key, 'wechat.webhook_url'))
      .run();

    // 写入 webhook url 配置
    db.insert(appSettings)
      .values({
        key: 'wechat.webhook_url',
        value: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=mock-key-123456',
        description: '企业微信测试 Webhook',
      })
      .run();

    // Mock 全局 fetch
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: {
        name: '王五',
        email: 'wangwu@example.com',
        content: '希望可以调整吉祥物大小！',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(calledUrl).toContain('mock-key-123456');
    const sentBody = JSON.parse(calledInit?.body as string);
    expect(sentBody.msgtype).toBe('markdown');
    expect(sentBody.markdown.content).toContain('王五');
    expect(sentBody.markdown.content).toContain('wangwu@example.com');
    expect(sentBody.markdown.content).toContain('希望可以调整吉祥物大小！');

    fetchSpy.mockRestore();
  });
});
