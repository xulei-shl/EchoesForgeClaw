/**
 * 知乎检索节点外部 API（知乎开发者平台开放接口）。
 *
 * 3 类检索（由节点内模式选择器切换）：
 * - 知乎搜索（zhihu）：`/api/v1/content/zhihu_search` 知乎站内内容搜索（问题 / 回答 / 文章）；
 * - 全网搜索（global）：`/api/v1/content/global_search` 全网内容搜索（支持 Filter 高级语法 / SearchDB 索引库）；
 * - 直答（zhida）：`/v1/chat/completions` 知乎直答问答（快速回答 / 深度思考 / 智能思考 3 档模型）。
 *
 * 鉴权统一：`Authorization: Bearer <access_secret>` + `X-Request-Timestamp`（秒级 Unix 时间戳）。
 * Access Secret 在 `/admin/settings`（zhihu.access_secret）配置，初始种子自 .env（ZHIHU_ACCESS_SECRET），
 * 纯 .env 值作回退（与 mxnzp.* 同口径）。
 */

const ZHIHU_SEARCH_URL = 'https://developer.zhihu.com/api/v1/content/zhihu_search';
const GLOBAL_SEARCH_URL = 'https://developer.zhihu.com/api/v1/content/global_search';
const ZHIDA_CHAT_URL = 'https://developer.zhihu.com/v1/chat/completions';

/** 外部请求超时（ms）：三类接口均为轻量请求，15s 足够。 */
const TOOL_REQUEST_TIMEOUT_MS = 15_000;

/** 知乎站内搜索单次最大条数（服务端上限 10） */
const ZHIHU_MAX_COUNT = 10;
/** 全网搜索单次最大条数（服务端上限 20） */
const GLOBAL_MAX_COUNT = 20;

/** 知乎检索外部 API 调用失败（网络 / 响应异常 / 业务错误码），由路由映射为 502 + detail。 */
export class ZhihuError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZhihuError';
  }
}

/** 内容类型英文 → 中文（未收录回退原值） */
const CONTENT_TYPE_ZH: Record<string, string> = {
  Article: '文章',
  Answer: '回答',
  Question: '问题',
  Column: '专栏',
  Pin: '想法',
  Video: '视频',
  Book: '书籍',
  Topic: '话题',
};

/** 秒级 Unix 时间戳 → 本地时间 "YYYY-MM-DD HH:mm"（非法值返回空串） */
function formatUnixTs(ts?: number | string): string {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n * 1000);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 去除摘要中的 <em> 高亮标签（全网搜索结果用 HTML 标签标注命中词） */
function stripHighlightTags(text: string): string {
  return text.replace(/<\/?em>/gi, '');
}

/** 鉴权 Header（三类接口共用） */
function authHeaders(accessSecret: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessSecret}`,
    'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
    'Content-Type': 'application/json',
  };
}

/** 搜索结果项（知乎搜索 / 全网搜索共用字段） */
interface ZhihuSearchItem {
  Title?: string;
  ContentType?: string;
  ContentText?: string;
  Url?: string;
  CommentCount?: number;
  VoteUpCount?: number;
  AuthorName?: string;
  AuthorBadgeText?: string;
  EditTime?: number | string;
}

/** 搜索结果 → 对外文本输出（Markdown：标题链接 + 摘要 + 元信息行；项间以 --- 分隔） */
function formatSearchResults(
  title: string,
  query: string,
  items: ZhihuSearchItem[],
  emptyReason?: string
): string {
  const lines = [`# ${title} · ${query}`];
  if (items.length === 0) {
    lines.push('', `> ${emptyReason || '未找到相关内容，换个关键词试试'}`);
    return lines.join('\n');
  }
  for (const item of items) {
    const t = (item.Title ?? '').trim();
    const url = (item.Url ?? '').trim();
    const summary = (item.ContentText ?? '').trim();
    const typeZh = CONTENT_TYPE_ZH[item.ContentType ?? ''] ?? (item.ContentType || '');
    const time = formatUnixTs(item.EditTime);
    const parts: string[] = [];
    if (item.AuthorName) {
      const author = item.AuthorName.trim();
      parts.push(item.AuthorBadgeText ? `${author}（${item.AuthorBadgeText.trim()}）` : author);
    }
    if (typeof item.VoteUpCount === 'number') parts.push(`赞同 ${item.VoteUpCount}`);
    if (typeof item.CommentCount === 'number') parts.push(`评论 ${item.CommentCount}`);
    if (typeZh) parts.push(typeZh);
    if (time) parts.push(time);
    lines.push('', url && t ? `### [${t}](${url})` : t ? `### ${t}` : '### 未命名内容');
    if (summary) lines.push('', stripHighlightTags(summary));
    if (parts.length > 0) lines.push('', `> ${parts.join(' · ')}`);
    lines.push('', '---');
  }
  return lines.join('\n');
}

/**
 * 知乎站内搜索：检索问题 / 回答 / 文章等站内内容。
 * @param query 关键词（必填）
 * @param count 请求数量（1-10，服务端超出自动截断 / 非法回退 10）
 */
export async function zhihuSearch(
  accessSecret: string,
  query: string,
  count: number
): Promise<{ output: string; query: string; count: number }> {
  const q = query.trim();
  if (!q) throw new ZhihuError('检索关键词不能为空');
  const c = Math.max(1, Math.min(Math.trunc(count) || 10, ZHIHU_MAX_COUNT));
  const params = new URLSearchParams({ Query: q, Count: String(c) });
  const res = await fetch(`${ZHIHU_SEARCH_URL}?${params.toString()}`, {
    method: 'GET',
    headers: authHeaders(accessSecret),
    signal: AbortSignal.timeout(TOOL_REQUEST_TIMEOUT_MS),
  });
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new ZhihuError('知乎搜索返回了无法解析的内容');
  }
  if (!res.ok) {
    throw new ZhihuError(body?.Message || `知乎搜索失败（HTTP ${res.status}）`);
  }
  if (body?.Code !== 0) {
    throw new ZhihuError(body?.Message || '知乎搜索失败，请检查 Access Secret 是否有效');
  }
  const data = body?.Data ?? {};
  const items: ZhihuSearchItem[] = Array.isArray(data.Items) ? data.Items : [];
  return {
    output: formatSearchResults('知乎搜索', q, items, data.EmptyReason),
    query: q,
    count: c,
  };
}

/**
 * 全网搜索：检索全网内容（可带 Filter 高级语法与 SearchDB 索引库）。
 * @param query 关键词（必填）
 * @param count 请求数量（1-20）
 * @param filter 高级筛选表达式（如 `host=="example.com" AND publish_time>=1778494631`；空 = 不过滤）
 * @param searchDb 索引库：all / realtime / static（默认 all）
 */
export async function globalSearch(
  accessSecret: string,
  query: string,
  count: number,
  filter: string,
  searchDb: string
): Promise<{ output: string; query: string; count: number }> {
  const q = query.trim();
  if (!q) throw new ZhihuError('检索关键词不能为空');
  const c = Math.max(1, Math.min(Math.trunc(count) || 10, GLOBAL_MAX_COUNT));
  const params = new URLSearchParams({ Query: q, Count: String(c) });
  const db = (searchDb ?? '').trim();
  if (db === 'realtime' || db === 'static') params.set('SearchDB', db);
  const f = (filter ?? '').trim();
  if (f) params.set('Filter', f);
  const res = await fetch(`${GLOBAL_SEARCH_URL}?${params.toString()}`, {
    method: 'GET',
    headers: authHeaders(accessSecret),
    signal: AbortSignal.timeout(TOOL_REQUEST_TIMEOUT_MS),
  });
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new ZhihuError('全网搜索返回了无法解析的内容');
  }
  if (!res.ok) {
    throw new ZhihuError(body?.Message || `全网搜索失败（HTTP ${res.status}）`);
  }
  if (body?.Code !== 0) {
    throw new ZhihuError(body?.Message || '全网搜索失败，请检查 Access Secret 是否有效');
  }
  const data = body?.Data ?? {};
  const items: ZhihuSearchItem[] = Array.isArray(data.Items) ? data.Items : [];
  return {
    output: formatSearchResults('全网搜索', q, items),
    query: q,
    count: c,
  };
}

/** 直答模型档位常量（与前端 ZhihuSearchNode 下拉保持一致） */
export const ZHIDA_MODELS = ['zhida-fast-1p5', 'zhida-thinking-1p5', 'zhida-agent'] as const;
export type ZhidaModel = (typeof ZHIDA_MODELS)[number];

/**
 * 知乎直答：向指定模型档位提问，返回回答正文（非流式）。
 * @param model 模型档位（zhida-fast-1p5 / zhida-thinking-1p5 / zhida-agent）
 * @param question 问题内容（必填）
 */
export async function zhidaAnswer(
  accessSecret: string,
  model: string,
  question: string
): Promise<{ output: string; model: string }> {
  const q = question.trim();
  if (!q) throw new ZhihuError('直答问题不能为空');
  const m = ZHIDA_MODELS.includes(model as ZhidaModel) ? model : 'zhida-fast-1p5';
  const res = await fetch(ZHIDA_CHAT_URL, {
    method: 'POST',
    headers: authHeaders(accessSecret),
    body: JSON.stringify({ model: m, messages: [{ role: 'user', content: q }], stream: false }),
    signal: AbortSignal.timeout(TOOL_REQUEST_TIMEOUT_MS),
  });
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new ZhihuError('直答返回了无法解析的内容');
  }
  if (!res.ok || body?.error) {
    throw new ZhihuError(body?.error?.message || `直答失败（HTTP ${res.status}）`);
  }
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new ZhihuError('直答未返回有效回答，请重试或更换模型档位');
  }
  return { output: content.trim(), model: m };
}
