import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb } from '../config/database.js';
import { appSettings } from '../db/schema.js';

interface FeedbackBody {
  name?: string;
  email?: string;
  module?: string;
  content?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 用户反馈路由：
 * - POST /api/feedback（接收画板吉祥物弹窗填写的反馈，推送到企业微信 Webhook）
 */
export async function registerFeedbackRouter(app: FastifyInstance): Promise<void> {
  app.post<{ Body: FeedbackBody }>('/api/feedback', async (request, reply) => {
    const { name, email, module, content } = request.body || {};

    const cleanName = (name ?? '').trim();
    const cleanEmail = (email ?? '').trim();
    const cleanModule = (module ?? '画板节点').trim();
    const cleanContent = (content ?? '').trim();

    // 必填字段校验
    if (!cleanName) {
      return reply.code(400).send({ detail: '姓名不能为空' });
    }
    if (cleanName.length > 100) {
      return reply.code(400).send({ detail: '姓名长度不能超过 100 字符' });
    }
    if (!cleanEmail) {
      return reply.code(400).send({ detail: '邮箱不能为空' });
    }
    if (!EMAIL_REGEX.test(cleanEmail)) {
      return reply.code(400).send({ detail: '邮箱格式不正确' });
    }
    if (!cleanContent) {
      return reply.code(400).send({ detail: '反馈内容不能为空' });
    }
    if (cleanContent.length > 4000) {
      return reply.code(400).send({ detail: '反馈内容不能超过 4000 字符' });
    }

    // 从 app_settings 中读取企业微信 Webhook 配置
    let webhookUrl: string | null = null;
    try {
      const db = getDb();
      const setting = db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, 'wechat.webhook_url'))
        .get();
      if (setting?.value) {
        webhookUrl = setting.value.trim();
      }
    } catch (e: any) {
      app.log.error({ err: e }, '读取 wechat.webhook_url 配置失败');
    }

    if (!webhookUrl) {
      app.log.warn('已接收用户反馈，但未配置 wechat.webhook_url，跳过企业微信机器人推送');
      return { success: true, message: '反馈已记录，感谢您的宝贵建议！' };
    }

    // 异步推送企业微信 Markdown 消息（fail-safe 尽力而为，超时 10 秒，异常不阻断用户）
    try {
      const timestamp = new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
      });

      const markdownContent = [
        '### 📋 画板用户反馈通知',
        `> **提交时间**：${timestamp}`,
        `> **反馈模块**：${cleanModule}`,
        `> **反馈用户**：${cleanName}`,
        `> **联系邮箱**：${cleanEmail}`,
        '',
        '**反馈内容**：',
        cleanContent,
      ].join('\n');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'markdown',
          markdown: {
            content: markdownContent,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => '');
        app.log.error(
          { status: resp.status, errorText },
          '企业微信 Webhook 响应非 200'
        );
      } else {
        app.log.info({ name: cleanName, email: cleanEmail }, '企业微信反馈推送成功');
      }
    } catch (pushErr: any) {
      app.log.error({ err: pushErr }, '推送企业微信机器人异常（已安全捕获）');
    }

    return { success: true, message: '反馈已成功发送，感谢您的支持！' };
  });
}
