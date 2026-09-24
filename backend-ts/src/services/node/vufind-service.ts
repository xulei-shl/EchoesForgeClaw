import { chromium } from 'playwright-core';
import { getDb } from '../../config/database.js';
import { getAppSettingsMap, getServiceProxy } from '../../repositories/index.js';
import { connectCdpOverProxy } from '../platform/cdp-websocket.js';
import { fetchWithProxy } from '../platform/http-proxy.js';

/** 本地 Lightpanda CDP 默认地址（可经 BROWSER_ADDRESS 环境变量覆盖） */
const DEFAULT_LOCAL_WS_URL = 'ws://127.0.0.1:9222';
const VUFIND_BASE_URL = 'https://vufind.library.sh.cn';
/** 单页导航超时：检索页 + 详情页两步，需控制在前端 30s 总超时内 */
const PAGE_TIMEOUT_MS = 15_000;
/** 强制中文界面：Lightpanda 新会话默认按英文 locale 渲染，馆藏字段（借阅类型/状态）会返回英文 */
const VUFIND_LANG = 'zh-cn';

/** 给 vufind URL 追加中文语言参数（VuFind 标准语言切换机制） */
function withZhLang(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}lng=${VUFIND_LANG}`;
}

export class VuFindError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VuFindError';
  }
}

/** 浏览器上下文内的最小 DOM 结构类型（后端 tsconfig 无 DOM lib） */
interface EvalElement {
  querySelector(sel: string): EvalElement | null;
  querySelectorAll(sel: string): EvalElement[];
  textContent: string | null;
  getAttribute(name: string): string | null;
}

interface EvalDocument {
  querySelector(sel: string): EvalElement | null;
  querySelectorAll(sel: string): EvalElement[];
}

/** 检索结果页提取的书目信息（与索书号同源，无需二次请求） */
export interface VuFindBiblio {
  title: string;
  author: string;
  /** 其他责任者（译者等） */
  contributor: string;
  publisher: string;
  pubYear: string;
}

/** 单条复本的馆藏信息 */
export interface VuFindHoldingItem {
  callnumber: string;
  barcode: string;
  loanType: string;
  status: string;
}

/** 按馆藏地分组的复本列表 */
export interface VuFindHoldingGroup {
  location: string;
  items: VuFindHoldingItem[];
}

export interface VuFindRecord {
  /** 索书号（检索结果页即可取得，始终尽力返回） */
  callNumber: string;
  /** 书目信息（检索页同步提取；缺失字段为空串） */
  bibliographic: VuFindBiblio;
  /** 图书详情页 URL（馆藏信息来源；仅索书号场景可能为空） */
  recordUrl: string;
  /** 馆藏分组列表；详情页无馆藏信息时为空数组（不算失败） */
  holdings: VuFindHoldingGroup[];
}

/**
 * 识别 VuFind 站点 WAF 的「权限验证」人机验证页（被拦截时 302 到 /verification，标题「权限验证」）。
 * 实测：本机 Lightpanda（可信出口 IP）直连正常；云端 Lightpanda（境外数据中心出口 IP，
 * `proxy=datacenter&country=cn` 与 `browser=chrome` 均无效）会被拦截，检索页 HTML 拿不到索书号。
 */
export function isVufindChallengePage(url: string, html: string): boolean {
  return (
    url.includes('/verification') ||
    html.includes('/verification/js/tac.min.js') ||
    /<title>\s*权限验证\s*<\/title>/.test(html)
  );
}

/** 从 vufind 检索结果 HTML 中提取索书号（中文页「索书号: K835.465.6/2212-11」或英文页「Call Number: ...」） */
function extractCallNumber(html: string): string {
  const match = html.match(/(?:索书号|Call Number)\s*[:：]\s*([^<\n]+)/);
  const value = match?.[1]?.trim() ?? '';
  if (!value) {
    throw new VuFindError('未找到索书号');
  }
  return value;
}

/** 去标签、去实体、压缩空白 */
function stripHtmlTags(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 从检索结果 HTML 提取首条结果的书目信息（纯字符串解析，DOM/HTTP 兑底路径均可用）。
 * 结构依据 vufind 检索项 result-body：a.title.getFull 为题名，各字段「label: value <br>」排列。
 */
export function extractBibliographic(html: string): VuFindBiblio {
  const title = stripHtmlTags(html.match(/class="title getFull"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '');
  // 著者等字段的值含嵌套标签（链接、角色标注），取标签后到 <br> 的片段再剥标签
  const labelValue = (...labels: string[]): string => {
    for (const label of labels) {
      const m = html.match(new RegExp(`${label}\\s*[:：]\\s*([\\s\\S]*?)<br`));
      if (!m) continue;
      const value = stripHtmlTags(m[1] ?? '');
      if (value) return value;
    }
    return '';
  };

  return {
    title,
    author: labelValue('著者', 'Author'),
    contributor: labelValue('其他责任者', 'Contributor(s)?'),
    publisher: labelValue('出版社', 'Publisher'),
    pubYear: labelValue('出版时间', 'Publication Year', 'Year'),
  };
}

/** 从检索结果 HTML 取首条结果的详情页链接（与浏览器路径的 a.title.getFull 同源） */
export function extractRecordPath(html: string): string {
  const href = html.match(/href="([^"]*\/Record\/[^"]+)"/)?.[1] ?? '';
  return href.replace(/&amp;/g, '&');
}

/**
 * 详情页 URL → 馆藏 tab 片段 URL。`/Record/{id}/AjaxTab?tab=holdings` 由 VuFind 服务端
 * 渲染（详情页主体里只有空壳 tab，馆藏靠前端异步填充），因此纯 HTTP 也能取到完整馆藏。
 */
export function holdingsTabUrl(recordUrl: string): string {
  const [path] = recordUrl.split('?');
  const id = (path ?? '').replace(/\/+$/, '').split('/').pop() ?? '';
  if (!id) return '';
  return withZhLang(`${VUFIND_BASE_URL}/Record/${encodeURIComponent(id)}/AjaxTab?tab=holdings`);
}

/** Lightpanda 浏览器接入点：CDP WebSocket 地址 + 有效 HTTP 代理（空 = 直连） */
export interface LightpandaEndpoint {
  url: string;
  proxy: string;
}

/** 回环地址（本机部署的 Lightpanda）：本身不出网，无需也不应经代理连接 */
export function isLoopbackWsUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/**
 * 按系统设置解析 Lightpanda 接入点（admin「系统设置 → Lightpanda 浏览器」）：
 * - `lightpanda.mode` = `cloud` 时连接云端，地址取 `lightpanda.cloud_wss_url`，凭据取
 *   `lightpanda.cloud_api_key`（拼为 `?token=` 查询参数，与官方 CDP 端点约定一致）；
 * - 其余（含未配置）走本机 CDP：`BROWSER_ADDRESS` 环境变量，缺省 ws://127.0.0.1:9222；
 * - 代理取 `lightpanda.use_proxy` + 全局 `http.proxy`，仅对外部端点生效（回环地址直连）。
 * 云端模式缺地址 / 密钥时抛出配置错误（调用方降级为 HTTP 兜底并留日志）。
 */
export function resolveLightpandaEndpoint(settings: Record<string, string>): LightpandaEndpoint {
  const proxy = getServiceProxy(settings, 'lightpanda');
  if ((settings['lightpanda.mode'] ?? 'local').trim().toLowerCase() === 'cloud') {
    const base = (settings['lightpanda.cloud_wss_url'] ?? '').trim();
    const token = (settings['lightpanda.cloud_api_key'] ?? '').trim();
    if (!base) throw new Error('云端 Lightpanda 未配置：请在「系统设置 → Lightpanda 浏览器」填写 lightpanda.cloud_wss_url');
    if (!token) throw new Error('云端 Lightpanda 未配置：请在「系统设置 → Lightpanda 浏览器」填写 lightpanda.cloud_api_key');
    const url = `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    return { url, proxy: isLoopbackWsUrl(url) ? '' : proxy };
  }
  const url = (process.env.BROWSER_ADDRESS || '').trim() || DEFAULT_LOCAL_WS_URL;
  return { url, proxy: isLoopbackWsUrl(url) ? '' : proxy };
}

/** 按设置连接 Lightpanda（云端 / 本地，必要时经全局 HTTP 代理） */
async function connectLightpanda(settings: Record<string, string>) {
  const { url, proxy } = resolveLightpandaEndpoint(settings);
  if (!proxy) return chromium.connectOverCDP(url);
  return chromium.connectOverCDP(await connectCdpOverProxy(url, proxy));
}

/**
 * 连接 Lightpanda 浏览器实例，两步抓取：
 * 1. 导航至 vufind 检索页，提取索书号 + 首条结果的详情页链接；
 * 2. 打开详情页，解析馆藏地 / 条码 / 借阅类型 / 状态。
 * 详情页无馆藏时不视为失败，返回仅含索书号的部分结果。
 * 若浏览器不可用，降级为 HTTP fetch（检索页 + 馆藏 tab 片段，同样能取到馆藏）。
 */
export async function fetchVuFindRecord(isbn: string): Promise<VuFindRecord> {
  const url = `${VUFIND_BASE_URL}/Search/Results?searchtype=vague&lookfor=${encodeURIComponent(isbn)}&type=AllFields&limit=20`;

  const settings = getAppSettingsMap(getDb());
  try {
    return await fetchViaLightpanda(url, settings);
  } catch (err) {
    // 索书号都没拿到（检索无结果等）才是真失败
    if (err instanceof VuFindError) throw err;
    console.warn(
      `[vufind] Lightpanda 抓取不可用，降级为 HTTP 兜底: ${err instanceof Error ? err.message : String(err)}`
    );
    return fetchRecordViaHttp(url, getServiceProxy(settings, 'lightpanda'));
  }
}

async function fetchViaLightpanda(searchUrl: string, settings: Record<string, string>): Promise<VuFindRecord> {
  const browser = await connectLightpanda(settings);
  try {
    const page = await browser.newPage({
      extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
    });

    // 第一步：检索页 → 索书号 + 详情页链接
    await page.goto(withZhLang(searchUrl), { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS });
    const searchHtml = await page.content();
    if (isVufindChallengePage(page.url(), searchHtml)) {
      // 出口 IP 被站点 WAF 拦截（云端 Lightpanda 的境外数据中心 IP 必然触发）：交给 HTTP 兜底路径重试
      throw new Error(`VuFind 站点返回人机验证页（出口 IP 被拦截）: ${page.url()}`);
    }
    const callNumber = extractCallNumber(searchHtml);
    const bibliographic = extractBibliographic(searchHtml);

    const detailPath = await page.evaluate((): string => {
      const doc = (globalThis as unknown as { document?: EvalDocument }).document;
      return doc?.querySelector('a.title.getFull')?.getAttribute('href') ?? '';
    });

    let recordUrl = '';
    let holdings: VuFindHoldingGroup[] = [];
    if (detailPath) {
      recordUrl = detailPath.startsWith('http') ? detailPath : `${VUFIND_BASE_URL}${detailPath}`;
      try {
        await page.goto(withZhLang(recordUrl), { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS });
        // Lightpanda 对 networkidle 支持有限，馆藏可能异步渲染：显式等待复本行出现
        await page
          .waitForSelector('.location-item tr[typeof="Offer"]', { timeout: 8_000 })
          .catch(() => {});
        const locationItemCount = await countLocationItems(page);
        holdings = await parseHoldingsViaDom(page);
        if (holdings.length === 0) {
          // DOM 解析为空（Lightpanda 选择器/evaluate 兼容性问题）→ 纯正则兑底解析 HTML
          console.warn(
            `[vufind] DOM 馆藏解析为空（location-item=${locationItemCount}），改用正则兑底: ${recordUrl}`
          );
          holdings = parseHoldingsFromHtml(await page.content());
        }
      } catch (err) {
        // 详情页打开失败或无馆藏：保留索书号部分结果，不整体报错
        console.warn(
          `[vufind] 详情页馆藏抓取失败（保留索书号部分结果）: ${err instanceof Error ? err.message : String(err)}`
        );
        holdings = [];
      }
    }

    return { callNumber, bibliographic, recordUrl, holdings };
  } finally {
    await browser.close();
  }
}

async function countLocationItems(page: import('playwright-core').Page): Promise<number> {
  try {
    return await page.evaluate((): number => {
      const doc = (globalThis as unknown as { document?: EvalDocument }).document;
      return doc ? doc.querySelectorAll('.branch .location-item').length : -1;
    });
  } catch {
    return -1;
  }
}

/** DOM 解析详情页馆藏：按 .location-item 分组，条码全局去重 */
async function parseHoldingsViaDom(page: import('playwright-core').Page): Promise<VuFindHoldingGroup[]> {
  return page.evaluate((): VuFindHoldingGroup[] => {
    const doc = (globalThis as unknown as { document?: EvalDocument }).document;
    if (!doc) return [];
    const seenBarcodes = new Set<string>();
    const groups: VuFindHoldingGroup[] = [];

    doc.querySelectorAll('.branch .location-item').forEach((loc) => {
      const location = loc.querySelector('h3')?.textContent?.trim() ?? '';
      const items: VuFindHoldingItem[] = [];
      // 移动端复本是 div.row 而非 tr，天然不会重复；条码去重再兕底
      loc.querySelectorAll('tr[typeof="Offer"]').forEach((tr) => {
        const fieldText = (cls: string): string => {
          const el = tr.querySelector(`.holding-field.${cls}`);
          if (!el) return '';
          // 状态列内含隐藏的「预计归还时间」节点与脚本文本，只取首个可见状态标签
          const tag = el.querySelector('span.text-success, span.text-danger');
          if (tag) return tag.textContent?.trim() ?? '';
          return (
            (el.textContent ?? '')
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean)[0] ?? ''
          );
        };
        const barcode = fieldText('barcode');
        if (!barcode || seenBarcodes.has(barcode)) return;
        seenBarcodes.add(barcode);
        items.push({
          callnumber: fieldText('callnumber'),
          barcode,
          loanType: fieldText('loanType'),
          status: fieldText('availability'),
        });
      });
      if (items.length > 0) groups.push({ location, items });
    });

    return groups;
  });
}

/** 去除标签与实体，压缩空白后取首个非空行 */
function extractTextField(raw: string): string {
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)[0];
  return text ?? '';
}

/**
 * 正则兑底解析馆藏 HTML（不依赖浏览器 DOM 实现，用于 Lightpanda evaluate/选择器异常时）。
 * 结构依据 vufind 详情页：每个 <div class="location-item"> 块内含一个 h3 馆藏地标题，
 * 桌面端复本为 <tr typeof="Offer"> 行（移动端为 div.row，天然不会被匹配）。
 */
export function parseHoldingsFromHtml(html: string): VuFindHoldingGroup[] {
  const seenBarcodes = new Set<string>();
  const groups: VuFindHoldingGroup[] = [];

  const chunks = html.split('<div class="location-item').slice(1);
  for (const chunk of chunks) {
    const rawLocation = chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? '';
    const location = extractTextField(rawLocation);
    const items: VuFindHoldingItem[] = [];

    const rowRe = /<tr[^>]*typeof="Offer"[^>]*>([\s\S]*?)<\/tr>/g;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(chunk)) !== null) {
      const row = rowMatch[1] ?? '';
      const fieldRaw = (cls: string): string =>
        row.match(new RegExp(`<span class="holding-field ${cls}">([\\s\\S]*?)</span>`))?.[1] ?? '';

      // 状态列优先取可见的 text-success / text-danger 标签文本
      let status = '';
      const availRaw = fieldRaw('availability');
      const statusTag = availRaw.match(/<span class="text-(?:success|danger)">\s*([^<]*?)\s*</);
      if (statusTag?.[1] != null) {
        status = statusTag[1].trim();
      } else {
        status = extractTextField(availRaw);
      }

      const barcode = extractTextField(fieldRaw('barcode'));
      if (!barcode || seenBarcodes.has(barcode)) continue;
      seenBarcodes.add(barcode);
      items.push({
        callnumber: extractTextField(fieldRaw('callnumber')),
        barcode,
        loanType: extractTextField(fieldRaw('loanType')),
        status,
      });
    }
    if (items.length > 0) groups.push({ location, items });
  }

  return groups;
}

async function fetchViaHttp(url: string, proxy: string): Promise<string> {
  const res = await fetchWithProxy(
    url,
    {
      signal: AbortSignal.timeout(30_000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    },
    proxy
  );
  const html = await res.text();
  return html;
}

/**
 * HTTP 兜底（不依赖浏览器）：检索页静态 HTML 取索书号 + 书目 + 详情页链接，
 * 再请求详情页馆藏 tab 片段（服务端渲染的 `AjaxTab?tab=holdings`）解析馆藏。
 * 详情页主体 HTML 里没有馆藏标记，仅有空壳 tab，所以必须走该片段端点。
 */
export async function fetchRecordViaHttp(url: string, proxy: string): Promise<VuFindRecord> {
  const html = await fetchViaHttp(url, proxy);
  if (isVufindChallengePage(url, html)) {
    // 服务端出口 IP 也被拦截：如实报出真实原因，避免误报成「藏书不存在」
    throw new VuFindError(
      'VuFind 站点要求人机验证（权限验证页），当前出口 IP 被拦截，未能获取索书号；云端 Lightpanda 与境外服务器 IP 无法访问该站点，请改用本机 Lightpanda（lightpanda.mode=local）'
    );
  }
  const callNumber = extractCallNumber(html);
  const bibliographic = extractBibliographic(html);

  const recordPath = extractRecordPath(html);
  const recordUrl = recordPath
    ? recordPath.startsWith('http')
      ? recordPath
      : `${VUFIND_BASE_URL}${recordPath}`
    : '';

  let holdings: VuFindHoldingGroup[] = [];
  if (recordUrl) {
    const tabUrl = holdingsTabUrl(recordUrl);
    try {
      const tabHtml = await fetchViaHttp(tabUrl, proxy);
      if (isVufindChallengePage(tabUrl, tabHtml)) {
        console.warn(`[vufind] 馆藏 tab 返回人机验证页（出口 IP 被拦截），保留索书号与书目: ${tabUrl}`);
      } else {
        holdings = parseHoldingsFromHtml(tabHtml);
      }
    } catch (err) {
      // 馆藏抓取失败不影响索书号（与浏览器路径同一策略：部分结果优于整体报错）
      console.warn(
        `[vufind] HTTP 兜底抓取馆藏失败（保留索书号部分结果）: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { callNumber, bibliographic, recordUrl, holdings };
}
