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
 * 企业微信群机器人「消息推送」markdown 正文上限：4096 字节（UTF-8，非字符数；
 * 中文约 3 字节/字 ≈ 1365 字），超长会返回 errcode 40058 整体拒收。
 */
const WECHAT_MARKDOWN_MAX_BYTES = 4096;

/** 推送超时（毫秒）：机器人接口偶发慢响应，不阻塞用户请求 */
const WECHAT_PUSH_TIMEOUT_MS = 10000;

/** 按 UTF-8 字节数安全截断（不切断多字节字符） */
function utf8Bytes(char: string): number {
  const code = char.codePointAt(0)!;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** 单行按字节硬切（不切断多字节字符），每段 ≤ maxBytes */
function hardSplit(line: string, maxBytes: number): string[] {
  const segments: string[] = [];
  let current = '';
  let used = 0;
  for (const char of line) {
    const size = utf8Bytes(char);
    if (used + size > maxBytes) {
      segments.push(current);
      current = '';
      used = 0;
    }
    current += char;
    used += size;
  }
  if (current) segments.push(current);
  return segments;
}

/** 按 UTF-8 字节上限切分文本：优先按行边界，单行超限时按字符硬切 */
function splitByBytes(text: string, maxBytes: number): string[] {
  if (maxBytes <= 0) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (byteLength(line) > maxBytes) {
      if (current) chunks.push(current);
      current = '';
      chunks.push(...hardSplit(line, maxBytes));
      continue;
    }
    const candidate = current ? `${current}\n${line}` : line;
    if (byteLength(candidate) > maxBytes) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [''];
}

/** webhook 地址掩码：日志只保留地址结构，key 一律打码，禁止整体回显 */
function maskWebhook(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('key')) parsed.searchParams.set('key', '***');
    return parsed.toString();
  } catch {
    return '（无法解析的 webhook 地址）';
  }
}

/** 企业微信错误码 → 可执行提示（面向管理员/用户，不含敏感信息） */
const WECHAT_ERRCODE_HINTS: Record<number, string> = {
  40058: '反馈正文超过企业微信 4096 字节上限',
  93000: '企业微信 Webhook 地址无效或机器人已被移出群，请联系管理员更新 wechat.webhook_url',
  45009: '企业微信推送频率超限（20 条/分钟），请稍后重试',
};

interface WechatPushResult {
  delivered: boolean;
  errcode?: number;
  errmsg?: string;
  /** 本条实际发送的 markdown 字节数（用于诊断 40058 类超长问题） */
  bytes: number;
}

/**
 * 推送一条企业微信机器人消息并回传**真实送达结果**。
 *
 * 关键事实：该接口无论成败都返回 HTTP 200，真实结果在响应体的 errcode
 * （0 = 成功；93000 = webhook 无效；40058 = 内容超长；45009 = 超频）。
 * 因此这里必须解析 errcode——只判 resp.ok 会把「被拒收」记成「推送成功」。
 */
async function pushToWechat(
  webhookUrl: string,
  markdownContent: string,
  part: { index: number; total: number }
): Promise<WechatPushResult> {
  const bytes = byteLength(markdownContent);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WECHAT_PUSH_TIMEOUT_MS);
  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content: markdownContent } }),
      signal: controller.signal,
    });
    const raw = await resp.text().catch(() => '');
    if (!resp.ok) {
      return { delivered: false, errcode: resp.status, errmsg: `HTTP ${resp.status}`, bytes };
    }
    let parsed: { errcode?: unknown; errmsg?: unknown } | null = null;
    try {
      parsed = JSON.parse(raw) as { errcode?: unknown; errmsg?: unknown };
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed.errcode !== 'number') {
      return {
        delivered: false,
        errmsg: `webhook 响应不是合法 JSON: ${raw.slice(0, 200)}`,
        bytes,
      };
    }
    const errmsg = typeof parsed.errmsg === 'string' ? parsed.errmsg : '';
    return { delivered: parsed.errcode === 0, errcode: parsed.errcode, errmsg, bytes };
  } catch (err: any) {
    return { delivered: false, errmsg: `${part.index}/${part.total} 推送异常: ${err?.message || String(err)}`, bytes };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 用户反馈路由：
 * - POST /api/feedback（接收画板吉祥物弹窗 / 画板 Agent 提交的反馈，推送到企业微信 Webhook）
 *
 * 长文处理：企业微信 markdown 上限 4096 字节，超出会整条被拒收（errcode 40058）。
 * 因此按字节预算**自动分片**成多条消息顺序发送（不截断、不丢内容），
 * 首个分片失败即停止（webhook 失效 / 超频 / 网络异常时继续发送无意义）。
 *
 * 响应契约（HTTP 200 = 请求已受理，不代表已送达）：
 * - success: 固定 true（表单校验通过即受理）
 * - delivered: 是否**全部分片**真实送达企业微信
 * - parts_total / parts_delivered: 分片数与实际送达数（便于如实转述"未完整送达"）
 * - errcode / message: 失败原因（可在用户界面如实转述）
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
    // 头部长度的上界决定分片预算：这里限长后，正文 4000 字符最多约 4 个分片
    if (cleanEmail.length > 254) {
      return reply.code(400).send({ detail: '邮箱长度不能超过 254 字符' });
    }
    if (cleanModule.length > 100) {
      return reply.code(400).send({ detail: '反馈模块长度不能超过 100 字符' });
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
      app.log.warn('已接收用户反馈，但未配置 wechat.webhook_url，无法推送企业微信');
      return {
        success: true,
        delivered: false,
        parts_total: 1,
        parts_delivered: 0,
        message: '反馈未送达：系统尚未配置企业微信推送通道，请联系管理员设置 wechat.webhook_url。',
      };
    }

    const timestamp = new Date().toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
    });

    /** 首个分片的头部（withParts=true 时含分片说明，仅多分片场景使用） */
    const firstPrefix = (withParts: boolean): string =>
      [
        '### 📋 画板用户反馈通知',
        `> **提交时间**：${timestamp}`,
        `> **反馈模块**：${cleanModule}`,
        `> **反馈用户**：${cleanName}`,
        `> **联系邮箱**：${cleanEmail}`,
        ...(withParts ? [`> **分片**：本条为第 1 条`] : []),
        '',
        '**反馈内容**：',
        '',
      ].join('\n');

    /** 后续分片的头部（不含时间/邮箱，只标续接序号与用户） */
    const continuationPrefix = (index: number, total: number): string =>
      [`### 📋 画板用户反馈通知（续 ${index + 1}/${total}）`, `> **反馈用户**：${cleanName}`, '', '**反馈内容（续）**：', ''].join('\n');

    // 分片预算：从「最坏形态的头部字节数」里扣，保证任何分片拼上头部都不超上限。
    // 邮箱/模块已限长，正文 ≤4000 字符时最多约 5 个分片（头部里最多 1 位数字），
    // 再留 16 字节余量足以覆盖分片计数的位数变化。
    const worstPrefixBytes = Math.max(
      byteLength(firstPrefix(false)),
      byteLength(firstPrefix(true)),
      byteLength(continuationPrefix(4, 4))
    );
    const chunkBudget = Math.max(
      WECHAT_MARKDOWN_MAX_BYTES - worstPrefixBytes - 16,
      1
    );

    const chunks = splitByBytes(cleanContent, chunkBudget);
    const total = chunks.length;
    const parts = chunks.map((chunk, index) =>
      `${index === 0 ? firstPrefix(total > 1) : continuationPrefix(index, total)}${chunk}`
    );

    if (total > 1) {
      app.log.info(
        { total, contentBytes: byteLength(cleanContent), chunkBudget },
        '反馈正文超出企业微信单条上限，已按字节自动分片发送'
      );
    }

    const hook = maskWebhook(webhookUrl);
    let partsDelivered = 0;
    let failure: WechatPushResult | null = null;
    for (let index = 0; index < parts.length; index++) {
      const result = await pushToWechat(webhookUrl, parts[index]!, {
        index: index + 1,
        total,
      });
      if (result.delivered) {
        partsDelivered += 1;
        continue;
      }
      // 首个分片失败即停止：webhook 失效 / 超频 / 网络异常时继续发送无意义
      failure = result;
      break;
    }

    if (!failure) {
      app.log.info(
        { hook, parts: total, bytes: byteLength(cleanContent) },
        `企业微信反馈推送成功（${partsDelivered}/${total} 条）`
      );
      return {
        success: true,
        delivered: true,
        parts_total: total,
        parts_delivered: partsDelivered,
        message:
          total > 1
            ? `反馈已分 ${total} 条发送并全部送达，感谢您的支持！`
            : '反馈已成功发送，感谢您的支持！',
      };
    }

    const hint = failure.errcode != null ? WECHAT_ERRCODE_HINTS[failure.errcode] : undefined;
    app.log.error(
      {
        hook,
        errcode: failure.errcode,
        errmsg: failure.errmsg,
        bytes: failure.bytes,
        partsDelivered,
        parts: total,
      },
      '企业微信反馈推送失败（已回传 delivered=false）'
    );
    const reason = hint ?? failure.errmsg ?? '未知原因';
    return {
      success: true,
      delivered: false,
      errcode: failure.errcode ?? null,
      parts_total: total,
      parts_delivered: partsDelivered,
      message:
        partsDelivered > 0
          ? `反馈未完整送达：${partsDelivered}/${total} 条已送达，第 ${partsDelivered + 1} 条失败（${reason}）。请稍后重试或直接联系管理员。`
          : `反馈未送达企业微信：${reason}。请稍后重试或直接联系管理员。`,
    };
  });
}
