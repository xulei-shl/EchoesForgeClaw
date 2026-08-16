/**
 * 豆瓣 ISBN API 极简客户端（原样移植 Python `douban_client.py`）。
 *
 * 接口: GET {base_url}/{isbn}（豆瓣移动版内部接口，必须携带
 * Referer: https://m.douban.com/，否则 403 / 业务错误码）。
 *
 * 内置：ISBN 标准化、响应字段映射、并发信号量 + QPS 节流、UA 轮换、
 * 随机延迟 + 批次冷却、指数退避重试。
 * 注意：HTTP 代理（ClientConfig.proxy）暂未移植（Node fetch 无内置代理，
 * 需要时经 undici ProxyAgent 或环境级代理接入）。
 */

export const DOUBAN_BASE_URL = 'https://m.douban.com/rexxar/api/v2/book/isbn';

export const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 11; Pixel 4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Mobile Safari/537.36',
];

/** 封面图片 CDN 请求头：豆瓣图片 CDN 接受以下任一 Referer（反爬/限流时轮换使用）。 */
export const COVER_REFERERS = ['https://m.douban.com/', 'https://book.douban.com/', 'https://www.douban.com/'];

const BASE_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://m.douban.com/',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

const ISBN_PATTERN = /^(\d{10}|\d{13})$/;
/** 豆瓣业务错误码：请求被判定为非法（通常是反爬拦截）。 */
const INVALID_REQUEST_CODES = new Set([1287, 1284]);
/** 可重试的 HTTP 状态码。 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503]);

/** 标准化 ISBN，返回 10 位或 13 位纯数字；无效返回 null。 */
export function normalizeIsbn(isbn: unknown): string | null {
  if (isbn == null) return null;
  let text: string;
  if (typeof isbn === 'number') {
    if (Number.isNaN(isbn)) return null;
    text = String(Math.trunc(isbn));
  } else {
    text = String(isbn).trim();
  }
  if (!text) return null;
  const cleaned = text.replace(/[^0-9]/g, '');
  return ISBN_PATTERN.test(cleaned) ? cleaned : null;
}

function join(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean).join(' / ');
  }
  return String(value ?? '').trim();
}

function first(value: unknown): string {
  if (Array.isArray(value)) return value.length ? String(value[0]).trim() : '';
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return '';
  return String(value).trim();
}

/** 将豆瓣原始响应映射为扁平的统一字段。 */
export function mapBookPayload(payload: Record<string, any> | null | undefined): Record<string, any> {
  if (!payload) return {};
  const rating = (payload.rating ?? {}) as Record<string, any>;
  const series = (payload.book_series ?? {}) as Record<string, any>;
  const data: Record<string, any> = {
    title: payload.title || '',
    subtitle: join(payload.subtitle),
    original_title: payload.origin_title || '',
    author: join(payload.author),
    translator: join(payload.translator),
    publisher: first(payload.press),
    producer: first(payload.producers),
    pub_year: first(payload.pubdate),
    isbn: payload.isbn || '',
    pages: first(payload.pages),
    price: first(payload.price),
    binding: payload.binding || '',
    series: series.title || '',
    series_link: series.url || '',
    rating: rating.value || 0,
    rating_count: rating.count || 0,
    cover_image: (payload.cover?.url) || payload.cover_url || '',
    summary: payload.intro || '',
    author_intro: payload.author_intro || '',
    catalog: payload.catalog || '',
    url: payload.url || payload.share_url || '',
  };
  const r = Number(data.rating);
  data.rating = Number.isFinite(r) ? r : 0;
  const rc = Number(data.rating_count);
  data.rating_count = Number.isInteger(rc) ? rc : 0;
  return data;
}

function isBusinessError(data: Record<string, any>): boolean {
  const code = Number(data.code ?? 0);
  const msg = String(data.msg ?? '');
  return INVALID_REQUEST_CODES.has(code) || msg.includes('invalid_request');
}

export interface DoubanClientConfig {
  base_url: string;
  timeoutMs: number;
  proxy?: string;
  maxConcurrent: number;
  qps: number;
  randomDelay: boolean;
  delayMinMs: number;
  delayMaxMs: number;
  cooldownEnabled: boolean;
  cooldownInterval: number;
  cooldownMinMs: number;
  cooldownMaxMs: number;
  retryTimes: number;
  retryBackoffMs: number[];
}

const DEFAULT_CONFIG: DoubanClientConfig = {
  base_url: DOUBAN_BASE_URL,
  timeoutMs: 15_000,
  proxy: '',
  maxConcurrent: 2,
  qps: 0.5,
  randomDelay: true,
  delayMinMs: 1500,
  delayMaxMs: 3500,
  cooldownEnabled: true,
  cooldownInterval: 20,
  cooldownMinMs: 30_000,
  cooldownMaxMs: 60_000,
  retryTimes: 3,
  retryBackoffMs: [2000, 5000, 10_000],
};

/** 并发信号量 + QPS 节流。 */
export class AsyncRateLimiter {
  private inFlight = 0;
  private queue: Array<() => void> = [];
  private lastTs = 0;

  constructor(
    private maxConcurrent = 2,
    private qps = 0.5
  ) {}

  /** 请求前 acquire（信号量 + QPS 间隔）。 */
  async acquire(): Promise<void> {
    if (this.inFlight >= Math.max(1, this.maxConcurrent)) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.inFlight += 1;
    if (this.qps > 0) {
      const now = Date.now();
      const wait = 1000 / this.qps - (now - this.lastTs);
      if (wait > 0) await sleep(wait);
      this.lastTs = Date.now();
    }
  }

  release(): void {
    this.inFlight -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DoubanIsbnClient {
  private config: DoubanClientConfig;
  private limiter: AsyncRateLimiter;
  private count = 0;
  private uaIndex = 0;

  constructor(config: Partial<DoubanClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.limiter = new AsyncRateLimiter(this.config.maxConcurrent, this.config.qps);
  }

  private rotateUa(): string {
    this.uaIndex = (this.uaIndex + 1) % USER_AGENTS.length;
    return USER_AGENTS[this.uaIndex]!;
  }

  private async pace(): Promise<void> {
    if (this.config.randomDelay) {
      await sleep(
        this.config.delayMinMs + Math.random() * (this.config.delayMaxMs - this.config.delayMinMs)
      );
    }
    if (
      this.config.cooldownEnabled &&
      this.count > 0 &&
      this.count % this.config.cooldownInterval === 0
    ) {
      const cooldown =
        this.config.cooldownMinMs +
        Math.random() * (this.config.cooldownMaxMs - this.config.cooldownMinMs);
      console.warn(`[cooldown] 已处理 ${this.count} 条，休息 ${(cooldown / 1000).toFixed(1)}s`);
      await sleep(cooldown);
    }
  }

  /** 获取豆瓣原始响应 JSON；未找到或失败返回 null。 */
  async fetchRaw(isbn: unknown): Promise<Record<string, any> | null> {
    const normalized = normalizeIsbn(isbn);
    if (!normalized) {
      console.warn(`[warn] 无效 ISBN: ${isbn}`);
      return null;
    }
    this.count += 1;
    const ua = this.rotateUa();
    await this.pace();

    for (let attempt = 1; attempt <= this.config.retryTimes; attempt++) {
      let resp: Response | null = null;
      try {
        await this.limiter.acquire();
        try {
          resp = await fetch(`${this.config.base_url}/${normalized}`, {
            headers: { ...BASE_HEADERS, 'User-Agent': ua },
            signal: AbortSignal.timeout(this.config.timeoutMs),
          });
        } finally {
          this.limiter.release();
        }
      } catch (err) {
        console.warn(`[warn] 请求异常 isbn=${normalized} attempt=${attempt}: ${messageOf(err)}`);
        await sleep(this.backoffAt(attempt));
        continue;
      }
      if (resp.status === 200) {
        try {
          const data = (await resp.json()) as Record<string, any>;
          if (isBusinessError(data)) {
            console.warn(`[warn] 业务错误（可能被反爬拦截） isbn=${normalized}`);
            return null;
          }
          return data;
        } catch {
          console.warn(`[warn] JSON 解析失败 isbn=${normalized}`);
          return null;
        }
      }
      if (resp.status === 404) {
        console.info(`[info] 未收录 isbn=${normalized}`);
        return null;
      }
      if (RETRYABLE_STATUS.has(resp.status)) {
        const delay = this.backoffAt(attempt);
        console.warn(`[warn] HTTP ${resp.status}，${delay}ms 后重试 isbn=${normalized}`);
        await sleep(delay);
        continue;
      }
      console.error(`[error] 异常状态 ${resp.status} isbn=${normalized}`);
      return null;
    }
    console.error(`[error] 重试耗尽仍失败 isbn=${normalized}`);
    return null;
  }

  /** 获取图书信息并映射为统一字段；失败返回 null。 */
  async fetch(isbn: unknown): Promise<Record<string, any> | null> {
    const payload = await this.fetchRaw(isbn);
    return payload ? mapBookPayload(payload) : null;
  }

  private backoffAt(attempt: number): number {
    const idx = Math.min(Math.max(attempt - 1, 0), this.config.retryBackoffMs.length - 1);
    return this.config.retryBackoffMs[Math.max(0, idx)] ?? attempt * 1000;
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 单例（对应 Python 每请求 new DoubanIsbnClient，此处按配置构造，调用方传入）。 */
export const doubanClientFactory = (config?: Partial<DoubanClientConfig>) => new DoubanIsbnClient(config);
