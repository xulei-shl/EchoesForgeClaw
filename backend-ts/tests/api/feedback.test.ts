import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { initDb, setDb, type DB } from '../../src/config/database.js';
import { buildApp } from '../../src/server.js';
import { appSettings } from '../../src/db/schema.js';

describe('用户反馈 /api/feedback API 测试', () => {
  let db: DB;
  let app: Awaited<ReturnType<typeof buildApp>>;

  /** 写入企业微信 Webhook 配置（先清后写，避免唯一键冲突） */
  function setWebhook(value: string): void {
    db.delete(appSettings).where(eq(appSettings.key, 'wechat.webhook_url')).run();
    db.insert(appSettings)
      .values({
        key: 'wechat.webhook_url',
        value,
        description: '企业微信测试 Webhook',
      })
      .run();
  }

  function clearWebhook(): void {
    db.delete(appSettings).where(eq(appSettings.key, 'wechat.webhook_url')).run();
  }

  beforeAll(async () => {
    db = initDb(':memory:');
    setDb(db);
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    clearWebhook();
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

    // 邮箱超长（头部长度的上界决定分片预算，必须限长）
    const res5 = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: {
        name: '张三',
        email: `${'a'.repeat(250)}@example.com`,
        content: '测试内容',
      },
    });
    expect(res5.statusCode).toBe(400);
    expect(res5.json().detail).toContain('邮箱长度不能超过');

    // 反馈模块超长
    const res6 = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: {
        name: '张三',
        email: 'test@example.com',
        module: '模'.repeat(101),
        content: '测试内容',
      },
    });
    expect(res6.statusCode).toBe(400);
    expect(res6.json().detail).toContain('反馈模块长度不能超过');
  });

  it('未配置 wechat.webhook_url 时回传 delivered=false（不再谎报已送达）', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

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
    expect(body.delivered).toBe(false);
    expect(body.message).toContain('未送达');
    // 未配置时不得发起任何推送请求
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('企业微信返回 errcode=0 时回传 delivered=true', async () => {
    setWebhook('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=mock-key-123456');

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
        module: '画板节点',
        content: '希望可以调整吉祥物大小！',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().delivered).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [calledUrl, calledInit] = fetchSpy.mock.calls[0]!;
    expect(calledUrl).toContain('mock-key-123456');
    const sentBody = JSON.parse(calledInit?.body as string);
    expect(sentBody.msgtype).toBe('markdown');
    expect(sentBody.markdown.content).toContain('王五');
    expect(sentBody.markdown.content).toContain('wangwu@example.com');
    expect(sentBody.markdown.content).toContain('反馈模块');
    expect(sentBody.markdown.content).toContain('画板节点');
    expect(sentBody.markdown.content).toContain('希望可以调整吉祥物大小！');

    fetchSpy.mockRestore();
  });

  it('企业微信 HTTP 200 但 errcode 非 0 时回传 delivered=false（真实拒收不再被当成成功）', async () => {
    setWebhook('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=stale-key');

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ errcode: 93000, errmsg: 'invalid webhook url' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { name: '赵六', email: 'zhaoliu@example.com', content: '反馈内容' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.delivered).toBe(false);
    expect(body.errcode).toBe(93000);
    expect(body.message).toContain('wechat.webhook_url');

    fetchSpy.mockRestore();
  });

  it('推送网络异常时回传 delivered=false 并保留 HTTP 200', async () => {
    setWebhook('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=mock-key-123456');

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { name: '钱七', email: 'qianqi@example.com', content: '反馈内容' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.delivered).toBe(false);
    expect(body.message).toContain('未送达');

    fetchSpy.mockRestore();
  });

  /** 长正文：首尾用可区分的标记，便于断言「没有截断、头尾都送达」 */
  const HEAD_MARK = '【开头】';
  const TAIL_MARK = '【结尾】';
  /** 三段合计约 9000 字节 → 3 个分片（也顺带覆盖「续 N/总数」序号） */
  const longContent = () =>
    `${HEAD_MARK}${'甲'.repeat(1000)}\n${'乙'.repeat(1000)}\n${'丙'.repeat(1000)}${TAIL_MARK}`;

  /** 创建独立 Response 实例：单实例的 body 只能读一次，多次 fetch 必须每次新建 */
  const okResponse = () =>
    new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  it('正文超过企业微信 4096 字节上限时按字节自动分片（不截断、不丢内容）', async () => {
    setWebhook('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=mock-key-123456');

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okResponse());

    const content = longContent();
    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { name: '孙八', email: 'sunba@example.com', content },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.delivered).toBe(true);
    expect(body.parts_total).toBeGreaterThan(1);
    expect(body.parts_delivered).toBe(body.parts_total);
    expect(fetchSpy).toHaveBeenCalledTimes(body.parts_total);

    const sentContents = fetchSpy.mock.calls.map(
      ([, init]) => JSON.parse(init?.body as string).markdown.content as string
    );
    // 每条分片都必须落在企业微信 4096 字节上限内
    for (const sent of sentContents) {
      expect(Buffer.byteLength(sent, 'utf8')).toBeLessThanOrEqual(4096);
    }
    const merged = sentContents.join('');
    expect(merged).toContain(HEAD_MARK);
    expect(merged).toContain(TAIL_MARK);
    expect(merged).not.toContain('已截断');
    expect(sentContents[0]).toContain('分片');
    expect(sentContents[1]).toContain(`（续 2/${body.parts_total}）`);
    expect(sentContents[2]).toContain(`（续 3/${body.parts_total}）`);

    fetchSpy.mockRestore();
  });

  it('分片中途失败时停止发送并如实回传已送达条数', async () => {
    setWebhook('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=mock-key-123456');

    let call = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      if (call === 1) return okResponse();
      return new Response(JSON.stringify({ errcode: 45009, errmsg: 'api freq out of limit' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { name: '周九', email: 'zhoujiu@example.com', content: longContent() },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.delivered).toBe(false);
    expect(body.errcode).toBe(45009);
    expect(body.parts_delivered).toBe(1);
    expect(body.parts_total).toBeGreaterThan(1);
    // 首个失败分片之后不再继续发送
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(body.message).toContain('未完整送达');
    expect(body.message).toContain(`1/${body.parts_total}`);

    fetchSpy.mockRestore();
  });
});
